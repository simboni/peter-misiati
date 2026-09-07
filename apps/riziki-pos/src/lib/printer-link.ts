"use client";

/**
 * The link to the counter's printer — one connection, for as long as the tab is open.
 *
 * WHY THIS IS A MODULE AND NOT A HOOK. The printer handle used to live in a
 * `useRef` inside the print button. A ref dies with its component, and the
 * counter unmounts that component constantly: every completed sale navigates to
 * the receipt, every receipt sheet closes, every trip to Stock and back. So the
 * app forgot which printer it was talking to several times an hour, and Chrome
 * will only hand back a device through `requestDevice`, which by specification
 * must be answered by a human. That is the whole reason the shop was choosing a
 * printer "every now and then": not a missing feature, a handle stored in the
 * wrong place.
 *
 * Here the device, the GATT connection and the write characteristic live at
 * module scope. They survive every remount and every client-side navigation, so
 * the chooser is answered once — when the browser is opened — and never again
 * that session. The connection is also kept OPEN rather than dropped after each
 * receipt: reconnecting a BLE printer costs two or three seconds with a customer
 * waiting, and there is nothing to gain by giving the link back between sales.
 *
 * What cannot be fixed here: after a full page reload, a browser that does not
 * implement `navigator.bluetooth.getDevices()` — which is most Chrome builds on
 * Android — can only be given back a device by asking. One tap when the phone is
 * restarted is the floor, and the app now spends that tap once instead of once
 * per receipt.
 *
 * Nothing in this file renders. It exposes a snapshot and a subscription so
 * React can watch it through `useSyncExternalStore`, which is the correct shape
 * for state that lives outside React and changes on its own.
 */

import { CMD, isPaperOut } from "@/lib/escpos";

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
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Nothing may wait forever: a spinner with no end is worse than an error. */
function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Turn a DOMException into something the person at the counter can act on. */
function explain(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  const raw = err instanceof Error ? err.message : String(err);

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
    return "This printer did not offer a channel we can print on. Pair it again and choose the printer itself, not a phone or a watch.";
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
    "Bluetooth printing needs a secure page. This one was opened over plain http, which Chrome will not give Bluetooth access. " +
    "Open the app on the counter phone itself at http://localhost:3100, or put the shop server behind https.",
  unsupported:
    "This browser cannot talk to Bluetooth printers. Use Chrome on the Android counter phone — Firefox, Safari and Chrome on iPhone all lack Web Bluetooth.",
  "adapter-off": "Bluetooth is switched off on this phone. Turn it on, then tap Print again.",
};

interface Remembered {
  id: string;
  name: string;
}

function readRemembered(): Remembered | null {
  try {
    const raw = window.localStorage.getItem(REMEMBERED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Remembered;
    return parsed && typeof parsed.id === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function writeRemembered(device: BtDevice): void {
  try {
    const value: Remembered = { id: device.id, name: device.name ?? "printer" };
    window.localStorage.setItem(REMEMBERED_KEY, JSON.stringify(value));
  } catch {
    // A phone with storage blocked still prints; it just asks which printer.
  }
}

// --------------------------------------------------------- the connection

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

  for (let i = 0; i < bytes.length; i += CHUNK_BYTES) {
    const chunk = bytes.slice(i, i + CHUNK_BYTES);
    if (withResponse) await char.writeValueWithResponse!(chunk);
    else await (char.writeValueWithoutResponse ?? char.writeValue).call(char, chunk);
    await sleep(withResponse ? 10 : 30);
  }
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
}

let device: BtDevice | null = null;
let chars: { write: BtCharacteristic; notify?: BtCharacteristic } | null = null;
/** In flight, so two receipts at once share one connection attempt. */
let opening: Promise<{ write: BtCharacteristic; notify?: BtCharacteristic }> | null = null;
let status: LinkStatus = "idle";
let name = "";

const watchers = new Set<() => void>();
let snapshot: LinkSnapshot = { status: "idle", name: "", remembered: false, live: false };

function publish(): void {
  snapshot = {
    status,
    name,
    remembered: typeof window !== "undefined" && readRemembered() !== null,
    live: Boolean(chars && device?.gatt?.connected),
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
  return { status: "idle", name: "", remembered: false, live: false };
}

export function supported(): Support | "ok" {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (!bluetooth()) return "unsupported";
  return "ok";
}

export async function available(): Promise<Support | "ok"> {
  const basic = supported();
  if (basic !== "ok") return basic;
  const api = bluetooth();
  if (api?.getAvailability) {
    try {
      if (!(await api.getAvailability())) return "adapter-off";
    } catch {
      // advisory only
    }
  }
  return "ok";
}

export function printerName(): string {
  return name || readRemembered()?.name || "";
}

/**
 * Take back a printer this browser has already been given permission for.
 *
 * Silent, and allowed to fail: `getDevices` is absent in most Chrome builds on
 * Android, which is exactly the counter's phone. When it is absent the name is
 * still restored from storage so the button can say which printer it will use,
 * and the first tap of the session opens the chooser.
 */
export async function rebind(): Promise<boolean> {
  const saved = readRemembered();
  if (saved) name = saved.name;
  publish();

  if (device) return true;
  const api = bluetooth();
  if (!api?.getDevices || !saved) return false;

  try {
    const granted = await api.getDevices();
    const match = granted.find((d) => d.id === saved.id);
    if (!match) return false;
    adopt(match);
    return true;
  } catch {
    return false;
  }
}

function adopt(d: BtDevice): void {
  device = d;
  name = d.name ?? readRemembered()?.name ?? "printer";
  writeRemembered(d);
  /*
    A BLE printer switched off, carried out of range, or simply asleep fires
    this. Dropping the characteristic — but KEEPING the device — is what lets
    the next receipt reconnect without asking anybody anything.
  */
  d.addEventListener?.("gattserverdisconnected", () => {
    chars = null;
    if (status !== "printing") status = "idle";
    publish();
  });
  publish();
}

/** Open the chooser. Must be called from a real tap: Chrome requires a gesture. */
export async function choose(showAll = false): Promise<void> {
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
  chars = null;
  adopt(picked);
}

/**
 * A channel to print on, reusing whatever is already open.
 *
 * Never opens the chooser. A caller that has a tap to spend calls `choose`
 * first; a caller that does not — an automatic receipt — simply fails and says
 * so, rather than throwing a permission prompt at somebody who is not looking.
 */
export async function connect(): Promise<{ write: BtCharacteristic; notify?: BtCharacteristic }> {
  if (chars && device?.gatt?.connected) return chars;
  if (opening) return opening;
  if (!device) throw new Error("No printer chosen yet.");

  const gatt = device.gatt;
  if (!gatt) throw new Error("That device does not accept a printing connection.");

  status = "connecting";
  publish();

  opening = (async () => {
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
    chars = found;
    status = "ready";
    publish();
    return found;
  })();

  try {
    return await opening;
  } catch (err) {
    chars = null;
    status = "idle";
    publish();
    throw err;
  } finally {
    opening = null;
  }
}

/** Push a receipt. Assumes a printer has been chosen; reconnects if the link dropped. */
export async function send(bytes: Uint8Array): Promise<void> {
  const found = await connect();

  if (await paperOut(found)) {
    throw new Error("The printer is out of paper. Load a roll and tap Print again.");
  }

  status = "printing";
  publish();
  try {
    await withTimeout(
      writeChunks(found.write, bytes),
      WRITE_TIMEOUT_MS,
      "The printer stopped part-way through. Check the paper roll, then print again.",
    );
    status = "ready";
  } catch (err) {
    // Force a fresh connection next time; the device handle is still good.
    chars = null;
    status = "idle";
    throw err;
  } finally {
    publish();
  }
}

/** Forget the printer entirely — the shop is pairing a different one. */
export function forget(): void {
  try {
    device?.gatt?.disconnect();
  } catch {
    // already gone
  }
  device = null;
  chars = null;
  name = "";
  status = "idle";
  try {
    window.localStorage.removeItem(REMEMBERED_KEY);
  } catch {
    // nothing to clear
  }
  publish();
}

export { explain, SUPPORT_MESSAGE, type Support };
