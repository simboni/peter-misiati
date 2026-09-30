"use client";

/**
 * The link to the counter's printer — one connection, for as long as the tab is open.
 *
 * WHY THIS IS A MODULE AND NOT A HOOK. The printer handle used to live in a
 * `useRef` inside the print button. A ref dies with its component, and the
 * counter unmounts that component constantly: every completed sale navigates to
 * the receipt, every receipt sheet closes, every trip to Stock and back. So the
 * app forgot which printer it was talking to several times an hour, and a
 * browser will only hand back a device through a chooser, which by specification
 * must be answered by a human. That is the whole reason the shop was choosing a
 * printer "every now and then": not a missing feature, a handle stored in the
 * wrong place.
 *
 * Here the open channel lives at module scope. It survives every remount and
 * every client-side navigation, so the chooser is answered once — when the
 * browser is opened — and never again that session. The connection is also kept
 * OPEN rather than dropped after each receipt: reconnecting a BLE printer costs
 * two or three seconds with a customer waiting, and there is nothing to gain by
 * giving the link back between sales.
 *
 * THREE WAYS IN, AND WHY. Bluetooth is the counter phone's answer. The desktop
 * in the office cannot use it — a browser speaks only Bluetooth Low Energy and
 * these printers are Classic machines, so the desktop pairs, finds nothing to
 * write on, and has to let go again. That is the "it agrees and then releases
 * it" the shop sees, and it is not a fault that can be retried away. The
 * desktop's answer is the USB lead, which is `@/lib/printer-cable`. Everything
 * below treats all three the same, as a `Channel`.
 *
 * What cannot be fixed here: after a full page reload, a browser that does not
 * implement `navigator.bluetooth.getDevices()` — which is most Chrome builds on
 * Android — can only be given back a device by asking. One tap when the phone is
 * restarted is the floor, and the app now spends that tap once instead of once
 * per receipt. A cable has no such problem: both cable APIs hand back what they
 * were already granted, so a desktop reconnects itself for good.
 *
 * Nothing in this file renders. It exposes a snapshot and a subscription so
 * React can watch it through `useSyncExternalStore`, which is the correct shape
 * for state that lives outside React and changes on its own.
 */

import { CMD, isPaperOut } from "@/lib/escpos";
import { chunks, sleep, withTimeout, TRANSPORT_LABEL, type Channel, type Transport } from "@/lib/printer-channel";
import {
  BAUD_RATES,
  DEFAULT_BAUD,
  ONBOARD_PORT_CAUTION,
  cableSupported,
  cableWays,
  chooseSerial,
  chooseUsb,
  explainCable,
  isBaud,
  onWindows,
  reopenSerial,
  reopenUsb,
  type Baud,
} from "@/lib/printer-cable";

export { BAUD_RATES, DEFAULT_BAUD, ONBOARD_PORT_CAUTION, onWindows, type Baud };
export { TRANSPORT_LABEL, type Transport };

// ------------------------------------------------- minimal Web Bluetooth

/*
  TypeScript's DOM library still has no Web Bluetooth definitions, and pulling in
  @types/web-bluetooth would mean touching package.json, which belongs to another
  module. These are the few members this file actually calls.
*/

interface BtCharacteristic {
  uuid: string;
  properties: {
    write: boolean;
    writeWithoutResponse: boolean;
    notify: boolean;
    indicate: boolean;
  };
  writeValue(value: Uint8Array): Promise<void>;
  writeValueWithResponse?(value: Uint8Array): Promise<void>;
  writeValueWithoutResponse?(value: Uint8Array): Promise<void>;
  startNotifications?(): Promise<BtCharacteristic>;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

interface BtService {
  uuid: string;
  getCharacteristics(): Promise<BtCharacteristic[]>;
}

interface BtServer {
  connected: boolean;
  connect(): Promise<BtServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<BtService[]>;
}

interface BtDevice {
  id: string;
  name?: string;
  gatt?: BtServer;
  /** Fires when the printer is switched off, sleeps, or walks out of range. */
  addEventListener?(type: string, listener: (event: Event) => void): void;
}

interface BtApi {
  requestDevice(options: unknown): Promise<BtDevice>;
  getDevices?(): Promise<BtDevice[]>;
  getAvailability?(): Promise<boolean>;
}

function bluetooth(): BtApi | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as unknown as { bluetooth?: BtApi }).bluetooth;
}

/**
 * The serial-over-BLE services cheap ESC/POS printers advertise. Listing them
 * keeps the chooser down to plausible printers instead of every fitness band in
 * the building; "show every device" is offered as a fallback when a printer uses
 * something exotic.
 */
const PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb", // by far the most common
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", // ISSC / Microchip transparent UART
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
];

/** Small enough for the smallest MTU these printers negotiate in practice. */
const CHUNK_BYTES = 180;
const CONNECT_TIMEOUT_MS = 20_000;
const WRITE_TIMEOUT_MS = 45_000;
const REMEMBERED_KEY = "riziki.printer";

/** Turn a failure into something the person at the counter can act on. */
function explain(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  const raw = err instanceof Error ? err.message : String(err);

  // A cable failure knows its own words, and they are different words — and
  // which of the two cables was tried changes the answer, so it is passed on.
  if (lastAttempt !== "bluetooth") return explainCable(err, lastAttempt);

  if (name === "NotFoundError") {
    return "No printer was chosen. Tap Print again, switch the printer on, and pick it from the list.";
  }
  if (name === "SecurityError") {
    return "This browser blocked Bluetooth on this page. Open the app over https, or on the phone itself as localhost.";
  }
  if (name === "NetworkError") {
    return "Could not reach the printer. Check it is switched on, has paper, and is within a few metres.";
  }
  if (name === "NotSupportedError") {
    return (
      "That entry paired but offers nothing to print on. On a phone, most of " +
      "these printers show up twice — the same machine, listed once for its " +
      "old Bluetooth and once for the kind a browser can use — so tap Print " +
      "again and choose the other one. On a desktop there is no other one: a " +
      "computer's Bluetooth cannot reach these printers at all, and the USB " +
      "lead is the way. Use Connect by cable."
    );
  }
  if (name === "InvalidStateError") {
    return "The printer dropped the connection. Switch it off and on, then try again.";
  }
  if (/user gesture|cancelled|canceled/i.test(raw)) {
    return "Printing was cancelled.";
  }
  return raw || "Printing failed. Try again.";
}

type Support = "checking" | "ok" | "insecure" | "unsupported" | "adapter-off";

const SUPPORT_MESSAGE: Record<Exclude<Support, "checking" | "ok">, string> = {
  insecure:
    "Printing needs a secure page. This one was opened over plain http, which a browser will not give " +
    "Bluetooth or a cable access to. Open the app on the counter phone itself at http://localhost:3100, " +
    "or put the shop server behind https.",
  unsupported:
    "This browser cannot reach a printer at all. Use Chrome or Edge — on the counter phone for Bluetooth, " +
    "or on a desktop with the printer's USB lead. Safari and Firefox support neither, on any device.",
  "adapter-off": "Bluetooth is switched off on this phone. Turn it on, or plug the printer in by cable.",
};

interface Remembered {
  id: string;
  name: string;
  transport: Transport;
  baud?: number;
}

function readRemembered(): Remembered | null {
  try {
    const raw = window.localStorage.getItem(REMEMBERED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Remembered;
    if (!parsed || typeof parsed.id !== "string") return null;
    // Anything saved before there was more than one way in was Bluetooth.
    return { ...parsed, transport: parsed.transport ?? "bluetooth" };
  } catch {
    return null;
  }
}

function writeRemembered(value: Remembered): void {
  try {
    window.localStorage.setItem(REMEMBERED_KEY, JSON.stringify(value));
  } catch {
    // A phone with storage blocked still prints; it just asks which printer.
  }
}

/** The cable speed this browser last printed at. Meaningless for the other two. */
export function savedBaud(): Baud {
  const saved = readRemembered();
  return isBaud(saved?.baud) ? (saved.baud as Baud) : DEFAULT_BAUD;
}

// ----------------------------------------------------- the Bluetooth channel

async function findWriteCharacteristic(server: BtServer): Promise<{
  write: BtCharacteristic;
  notify?: BtCharacteristic;
}> {
  const services = await server.getPrimaryServices();
  let write: BtCharacteristic | undefined;
  let notify: BtCharacteristic | undefined;

  for (const service of services) {
    let chars: BtCharacteristic[];
    try {
      chars = await service.getCharacteristics();
    } catch {
      continue; // some firmware refuses to enumerate a service it advertises
    }
    for (const c of chars) {
      if (!write && (c.properties.write || c.properties.writeWithoutResponse)) write = c;
      if (!notify && (c.properties.notify || c.properties.indicate)) notify = c;
    }
    if (write) break;
  }

  if (!write) {
    const err = new Error("no writable characteristic");
    (err as { name?: string }).name = "NotSupportedError";
    throw err;
  }
  return { write, notify };
}

/**
 * Ask the printer whether it still has paper.
 *
 * Best effort by design: DLE EOT 4 is a real-time command, but only some of
 * these printers wire a notify characteristic to answer it. A silent printer is
 * treated as fine — we wait a fraction of a second, not forever.
 */
async function paperOut(chars: { write: BtCharacteristic; notify?: BtCharacteristic }): Promise<boolean> {
  const { write, notify } = chars;
  if (!notify?.startNotifications) return false;

  try {
    await notify.startNotifications();
  } catch {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      notify.removeEventListener("characteristicvaluechanged", onValue);
      resolve(value);
    };
    const onValue = (event: Event) => {
      const value = (event.target as unknown as { value?: DataView })?.value;
      if (!value || value.byteLength === 0) return done(false);
      done(isPaperOut(value.getUint8(0)));
    };

    notify.addEventListener("characteristicvaluechanged", onValue);
    const query = Uint8Array.from(CMD.paperStatus);
    (write.writeValueWithoutResponse ?? write.writeValue).call(write, query).catch(() => done(false));
    setTimeout(() => done(false), 600);
  });
}

async function writeChunks(char: BtCharacteristic, bytes: Uint8Array): Promise<void> {
  // With-response writes give us flow control for free; without-response needs a
  // pause or the printer's buffer overruns and the tail of the receipt is lost.
  const withResponse = char.properties.write && typeof char.writeValueWithResponse === "function";

  for (const chunk of chunks(bytes, CHUNK_BYTES)) {
    if (withResponse) await char.writeValueWithResponse!(chunk);
    else await (char.writeValueWithoutResponse ?? char.writeValue).call(char, chunk);
    await sleep(withResponse ? 10 : 30);
  }
}

/**
 * Hold a Bluetooth device and open a channel on it.
 *
 * Deliberately does NOT remember the device on the tap. Cheap ESC/POS printers
 * are dual-mode — they run Bluetooth Classic for their own driver AND Low Energy
 * for everything else — and on Android that can put two entries in the chooser
 * for one printer on the counter. Only one of them offers a GATT characteristic
 * to write on; the other pairs happily and then has nothing to print to.
 * Remembering on the tap meant a shop that picked the wrong twin once was stuck
 * with it. A printer is remembered below, after it has actually offered a
 * channel — which is the first moment there is anything worth remembering.
 */
async function openBluetooth(d: BtDevice): Promise<Channel> {
  const gatt = d.gatt;
  if (!gatt) {
    const err = new Error("that device does not accept a printing connection");
    (err as { name?: string }).name = "NotSupportedError";
    throw err;
  }

  const server = gatt.connected
    ? gatt
    : await withTimeout(
        gatt.connect(),
        CONNECT_TIMEOUT_MS,
        "The printer did not answer. Check it is switched on and within a few metres.",
      );
  const found = await withTimeout(
    findWriteCharacteristic(server),
    CONNECT_TIMEOUT_MS,
    "Connected, but the printer never offered a channel to print on. Switch it off and on, then try again.",
  );

  /*
    A BLE printer switched off, carried out of range, or simply asleep fires
    this. The channel goes dead; the device handle is kept, which is what lets
    the next receipt reconnect without asking anybody anything.
  */
  let up = true;
  d.addEventListener?.("gattserverdisconnected", () => {
    up = false;
    if (status !== "printing") status = "idle";
    publish();
  });

  return {
    transport: "bluetooth",
    name: d.name ?? "printer",
    id: d.id,
    alive: () => up && Boolean(gatt.connected),
    write: (bytes) =>
      withTimeout(
        writeChunks(found.write, bytes),
        WRITE_TIMEOUT_MS,
        "The printer stopped part-way through. Check the paper roll, then print again.",
      ),
    paperOut: () => paperOut(found),
    close: () => {
      up = false;
      try {
        gatt.disconnect();
      } catch {
        // already gone
      }
    },
  };
}

// --------------------------------------------------------------- the link

export type LinkStatus =
  | "idle"          // nothing chosen yet
  | "connecting"    // opening or reopening the connection
  | "ready"         // connected, with a channel to print on
  | "printing";

export interface LinkSnapshot {
  status: LinkStatus;
  /** The name to show. Survives a reload even when the handle does not. */
  name: string;
  /** A printer has been chosen before, so a silent reconnect is worth trying. */
  remembered: boolean;
  /** Live connection right now — an auto-print can go straight out. */
  live: boolean;
  /** How it is reached, so the screen can say "on the cable" and mean it. */
  transport: Transport | null;
  /**
   * Connected to the computer's own serial socket rather than to anything
   * plugged in. The screen says so, because nothing else will.
   */
  onboard: boolean;
}

let channel: Channel | null = null;
/** Re-open the same printer with no chooser and no tap. Null until one is chosen. */
let reopen: (() => Promise<Channel | null>) | null = null;
/** In flight, so two receipts at once share one connection attempt. */
let opening: Promise<Channel> | null = null;
let status: LinkStatus = "idle";
let name = "";
let transport: Transport | null = null;
/** Which way the last attempt went, so a failure is explained in its own terms. */
let lastAttempt: Transport = "bluetooth";

const watchers = new Set<() => void>();
let snapshot: LinkSnapshot = {
  status: "idle",
  name: "",
  remembered: false,
  live: false,
  transport: null,
  onboard: false,
};

function publish(): void {
  snapshot = {
    status,
    name,
    remembered: typeof window !== "undefined" && readRemembered() !== null,
    live: Boolean(channel?.alive()),
    transport,
    onboard: Boolean(channel?.onboard),
  };
  for (const w of watchers) w();
}

export function subscribe(fn: () => void): () => void {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
}

export function getSnapshot(): LinkSnapshot {
  return snapshot;
}

/** The server renders no printer state; this keeps hydration honest. */
export function getServerSnapshot(): LinkSnapshot {
  return { status: "idle", name: "", remembered: false, live: false, transport: null, onboard: false };
}

export function supported(): Support | "ok" {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (!bluetooth() && !cableSupported()) return "unsupported";
  return "ok";
}

/**
 * What this browser can actually do, which is not one answer any more.
 *
 * A desktop has no usable Bluetooth for these printers and a perfectly good
 * cable; the counter phone is the other way round. The screen needs both facts
 * to offer the right button, so it gets both rather than a single verdict.
 */
export interface Ways {
  bluetooth: boolean;
  cable: boolean;
  serial: boolean;
  usb: boolean;
  verdict: Support | "ok";
}

export async function available(): Promise<Ways> {
  const base = supported();
  const cable = cableWays();
  if (base !== "ok") {
    return { bluetooth: false, cable: false, serial: false, usb: false, verdict: base };
  }

  let bt = Boolean(bluetooth());
  const api = bluetooth();
  if (bt && api?.getAvailability) {
    try {
      bt = await api.getAvailability();
    } catch {
      // advisory only — keep offering it
    }
  }

  const anyCable = cable.serial || cable.usb;
  const verdict: Support | "ok" = bt || anyCable ? "ok" : "adapter-off";
  return { bluetooth: bt, cable: anyCable, serial: cable.serial, usb: cable.usb, verdict };
}

export function printerName(): string {
  return name || readRemembered()?.name || "";
}

/** Adopt an open channel: this is the first moment it is worth remembering. */
function adopt(open: Channel, baud?: Baud): void {
  channel = open;
  name = open.name;
  transport = open.transport;
  writeRemembered({ id: open.id, name: open.name, transport: open.transport, baud });
  status = "ready";
  publish();
}

/**
 * Take back a printer this browser has already been given permission for.
 *
 * Silent, and allowed to fail. On Bluetooth, `getDevices` is absent in most
 * Chrome builds on Android — exactly the counter's phone — so the name is
 * restored from storage and the first tap of the session opens the chooser.
 * Both cable APIs do hand back what they granted, so a desktop that has printed
 * once never asks again.
 */
export async function rebind(): Promise<boolean> {
  const saved = readRemembered();
  if (saved) {
    name = saved.name;
    transport = saved.transport;
  }
  publish();

  if (channel?.alive()) return true;
  if (!saved) return false;

  if (saved.transport === "serial") {
    const baud = isBaud(saved.baud) ? (saved.baud as Baud) : DEFAULT_BAUD;
    reopen = () => reopenSerial(saved.id, baud);
    return true;
  }
  if (saved.transport === "usb") {
    reopen = () => reopenUsb(saved.id);
    return true;
  }

  const api = bluetooth();
  if (!api?.getDevices) return false;
  try {
    const granted = await api.getDevices();
    const match = granted.find((d) => d.id === saved.id);
    if (!match) return false;
    reopen = () => openBluetooth(match);
    return true;
  } catch {
    return false;
  }
}

/** Open the Bluetooth chooser. Must be called from a real tap. */
export async function choose(showAll = false): Promise<void> {
  lastAttempt = "bluetooth";
  const api = bluetooth();
  if (!api) throw new Error(SUPPORT_MESSAGE.unsupported);
  const picked = await api.requestDevice(
    showAll
      ? { acceptAllDevices: true, optionalServices: PRINTER_SERVICES }
      : {
          filters: PRINTER_SERVICES.map((s) => ({ services: [s] })),
          optionalServices: PRINTER_SERVICES,
        },
  );
  release();
  reopen = () => openBluetooth(picked);
  name = picked.name ?? "printer";
  transport = "bluetooth";
  publish();
}

/**
 * Open the cable chooser. Must be called from a real tap.
 *
 * `prefer` is what the shop picked on the screen: the serial port is right for
 * nearly every printer with a USB lead, and the direct USB route is there for
 * the machines that present themselves as printers and are not already claimed
 * by the operating system's own driver.
 */
export async function chooseCable(prefer: "serial" | "usb" = "serial", baud: Baud = DEFAULT_BAUD): Promise<void> {
  lastAttempt = prefer;
  const ways = cableWays();
  const use = ways[prefer] ? prefer : ways.serial ? "serial" : ways.usb ? "usb" : null;
  if (!use) throw new Error(SUPPORT_MESSAGE.unsupported);
  lastAttempt = use;

  const open = use === "serial" ? await chooseSerial(baud) : await chooseUsb();
  release();
  adopt(open, use === "serial" ? baud : undefined);
  // The port is already open, so there is nothing to reconnect to — but a later
  // unplug must be recoverable without another tap.
  const id = open.id;
  reopen = use === "serial" ? () => reopenSerial(id, baud) : () => reopenUsb(id);
}

/** Drop whatever is open, keeping what is remembered. */
function release(): void {
  try {
    channel?.close();
  } catch {
    // already gone
  }
  channel = null;
}

/**
 * A channel to print on, reusing whatever is already open.
 *
 * Never opens a chooser. A caller that has a tap to spend calls `choose` or
 * `chooseCable` first; a caller that does not — an automatic receipt — simply
 * fails and says so, rather than throwing a permission prompt at somebody who
 * is not looking.
 */
export async function connect(): Promise<Channel> {
  if (channel?.alive()) return channel;
  if (opening) return opening;
  if (!reopen) throw new Error("No printer chosen yet.");

  const again = reopen;
  status = "connecting";
  publish();

  opening = (async () => {
    const open = await again();
    if (!open) {
      const err = new Error(
        transport === "bluetooth"
          ? "That printer is no longer reachable. Switch it on and choose it again."
          : "The cable is no longer there. Plug the printer back in, then try again.",
      );
      (err as { name?: string }).name = "NetworkError";
      throw err;
    }
    // It printed, or at least it can. Only now is it worth coming back to.
    adopt(open, transport === "serial" ? savedBaud() : undefined);
    return open;
  })();

  try {
    return await opening;
  } catch (err) {
    channel = null;
    /*
      A device that connects and offers nothing to write on is the wrong half of
      a dual-mode printer, or a desktop's Bluetooth reaching for a Classic
      printer it can never speak to. No amount of retrying will change it. Let it
      go, so the next tap opens the chooser instead of reconnecting to the dud
      for the rest of the day.
    */
    if ((err as { name?: string })?.name === "NotSupportedError") {
      reopen = null;
      name = "";
      transport = null;
    }
    status = "idle";
    publish();
    throw err;
  } finally {
    opening = null;
  }
}

/** Push a receipt. Assumes a printer has been chosen; reconnects if the link dropped. */
export async function send(bytes: Uint8Array): Promise<void> {
  const open = await connect();
  lastAttempt = open.transport;

  if (open.paperOut && (await open.paperOut())) {
    throw new Error("The printer is out of paper. Load a roll and tap Print again.");
  }

  status = "printing";
  publish();
  try {
    await open.write(bytes);
    status = "ready";
  } catch (err) {
    // Force a fresh connection next time; the way back to it is still good.
    release();
    status = "idle";
    throw err;
  } finally {
    publish();
  }
}

/** Forget the printer entirely — the shop is pairing a different one. */
export function forget(): void {
  release();
  reopen = null;
  name = "";
  transport = null;
  status = "idle";
  try {
    window.localStorage.removeItem(REMEMBERED_KEY);
  } catch {
    // nothing to clear
  }
  publish();
}

export { explain, SUPPORT_MESSAGE, type Support };
