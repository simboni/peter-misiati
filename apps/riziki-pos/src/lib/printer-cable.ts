"use client";

/**
 * The printer on the end of a cable.
 *
 * WHY THIS EXISTS. Bluetooth is the counter phone's answer and it is a good one
 * there. On the desktop in the office it is not: Chrome's Web Bluetooth speaks
 * only Low Energy, and the cheap ESC/POS printers sold here are Bluetooth
 * Classic machines that happen to advertise. So the device appears in the
 * chooser, the pairing is accepted, the connection opens — and there is no
 * characteristic to write a receipt on, so the app has to let the device go
 * again. Nothing is broken and no amount of trying again will change it. The
 * desktop wants the USB lead that came in the box.
 *
 * TWO CABLES, BECAUSE THERE ARE TWO KINDS OF PRINTER.
 *
 *   **Web Serial** is for a printer that shows up as a serial port. Nearly
 *   every 58 mm machine with a USB lead is this: a CH340, a PL2303 or an FTDI
 *   chip bridging USB to the printer's own serial board. The browser opens the
 *   port, and the only thing that can go wrong is the speed — a printer set to
 *   9600 fed at 115200 prints a page of rubbish, which is why the speed is a
 *   setting and not a guess.
 *
 *   **WebUSB** is for a printer that presents itself as a printer: USB class 7,
 *   with a bulk endpoint to push ESC/POS at. It is the cleaner of the two and
 *   the fussier, because an operating system that already has a driver for
 *   printers will have claimed the device before the browser can — Windows does
 *   this always, Linux does it through `usblp`. Where it is free, it is faster
 *   and needs no speed setting at all.
 *
 * Both are tried, serial first, because serial is what the shop's printer
 * almost certainly is and it is the one an operating system does not fight over.
 *
 * What is NOT here: a paper-out query. A printer on a cable is on the desk in
 * front of whoever pressed the button; reading a status line back over a serial
 * port means locking the stream and waiting on a printer that may never answer,
 * and the failure mode of that is a till that hangs. They can look at it.
 */

import { chunks, withTimeout, type Channel } from "./printer-channel.ts";

// --------------------------------------------- minimal Web Serial / WebUSB

/*
  Neither API is in TypeScript's DOM library. These are the few members this
  file actually calls; adding @types/w3c-web-serial and @types/w3c-web-usb would
  mean touching package.json for two dozen lines of declarations.
*/

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo?(): SerialPortInfo;
}

interface SerialApi {
  requestPort(options?: unknown): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

export interface UsbEndpoint {
  endpointNumber: number;
  direction: "in" | "out";
  type: "bulk" | "interrupt" | "isochronous";
}

export interface UsbAlternate {
  interfaceClass: number;
  endpoints: UsbEndpoint[];
}

export interface UsbInterface {
  interfaceNumber: number;
  alternate: UsbAlternate;
}

export interface UsbConfiguration {
  interfaces: UsbInterface[];
}

interface UsbDeviceLike {
  productName?: string;
  manufacturerName?: string;
  serialNumber?: string;
  vendorId: number;
  productId: number;
  opened: boolean;
  configuration: UsbConfiguration | null;
  configurations?: UsbConfiguration[];
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(value: number): Promise<void>;
  transferOut(endpointNumber: number, data: Uint8Array): Promise<{ status: string }>;
}

interface UsbApi {
  requestDevice(options: unknown): Promise<UsbDeviceLike>;
  getDevices(): Promise<UsbDeviceLike[]>;
}

function serialApi(): SerialApi | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as unknown as { serial?: SerialApi }).serial;
}

function usbApi(): UsbApi | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as unknown as { usb?: UsbApi }).usb;
}

/** Whether this browser can talk down a cable at all, and which way. */
export function cableWays(): { serial: boolean; usb: boolean } {
  return { serial: Boolean(serialApi()), usb: Boolean(usbApi()) };
}

export function cableSupported(): boolean {
  const ways = cableWays();
  return ways.serial || ways.usb;
}

// ------------------------------------------------------------------ speed

/**
 * The speeds these printers are shipped at, commonest first.
 *
 * 9600 is the factory setting on nearly every 58 mm machine sold here. A
 * printer fed at the wrong speed does not fail — it prints, and what comes out
 * is a page of accented rubbish, which is the single most confusing way this
 * can go wrong. Every printer prints its own speed on its self-test slip: hold
 * the feed button while switching it on.
 */
export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200] as const;
export type Baud = (typeof BAUD_RATES)[number];
export const DEFAULT_BAUD: Baud = 9600;

export function isBaud(value: unknown): value is Baud {
  return BAUD_RATES.includes(Number(value) as Baud);
}

/** A cable takes a whole receipt at once; only BLE needs it cut small. */
const CABLE_CHUNK_BYTES = 4096;
const WRITE_TIMEOUT_MS = 30_000;
const OPEN_TIMEOUT_MS = 15_000;

// ----------------------------------------------------------- a serial port

/**
 * Whether anything was actually plugged in to make this port exist.
 *
 * Chrome tells us a serial port's USB vendor and product only when the port
 * comes from a USB device. A port with neither is one the computer already had
 * — the nine-pin socket on the back of a desktop — and on the machine this was
 * written for that was the ONLY entry in the chooser, because the printer's
 * USB-serial driver had never been installed. It opened, it took the whole
 * receipt without a word of complaint, and the bytes went into an empty socket.
 */
export function isUsbPort(port: { getInfo?(): SerialPortInfo }): boolean {
  return port.getInfo?.()?.usbVendorId != null;
}

/**
 * What to call it on screen.
 *
 * This used to call a port with no USB behind it "Printer on the cable", which
 * is the friendliest possible way of saying something untrue: the shop read
 * "Printer on the cable — connected", believed it, and spent an afternoon
 * wondering why a COM1 socket would not print. A thing is called what it is.
 */
function portLabel(port: SerialPortLike): string {
  const info = port.getInfo?.();
  if (info?.usbVendorId != null) {
    const v = info.usbVendorId.toString(16).padStart(4, "0");
    const p = (info.usbProductId ?? 0).toString(16).padStart(4, "0");
    return `USB printer ${v}:${p}`;
  }
  return "This computer's own serial port";
}

/**
 * What to say about a port nothing was plugged in to make.
 *
 * Not an error: a genuine RS-232 printer on that socket is a real thing and
 * the shop may have one. But it is the likeliest reason for a test slip that
 * reports itself sent and never appears, so it is said out loud at the moment
 * of connecting rather than left for somebody to work out.
 */
export const ONBOARD_PORT_CAUTION =
  "That is this computer's own serial socket, not anything plugged into it — so if the printer is " +
  "on a USB lead, nothing typed here will reach it. Windows needs the printer's USB driver (CH340 " +
  "or Prolific on most of these machines) before the printer gets a COM port of its own; install " +
  "it, plug the printer back in, and connect again, choosing the new port. Ignore this only if the " +
  "printer really is wired into that nine-pin socket.";

/** A stable-enough name for a port, which the API gives no id of its own. */
function portId(port: SerialPortLike): string {
  const info = port.getInfo?.();
  return `serial:${info?.usbVendorId ?? 0}:${info?.usbProductId ?? 0}`;
}

async function openSerial(port: SerialPortLike, baud: Baud): Promise<Channel> {
  await withTimeout(
    port.open({ baudRate: baud }),
    OPEN_TIMEOUT_MS,
    "The cable did not answer. Check it is plugged in at both ends and the printer is switched on.",
  );

  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let open = true;

  const close = () => {
    open = false;
    try {
      writer?.releaseLock();
    } catch {
      // already gone
    }
    writer = null;
    void port.close().catch(() => {});
  };

  return {
    transport: "serial",
    name: portLabel(port),
    id: portId(port),
    onboard: !isUsbPort(port),
    alive: () => open && port.writable !== null,
    async write(bytes) {
      if (!port.writable) throw new Error("The cable is no longer open. Plug it back in and try again.");
      writer ??= port.writable.getWriter();
      const w = writer;
      await withTimeout(
        (async () => {
          for (const chunk of chunks(bytes, CABLE_CHUNK_BYTES)) await w.write(chunk);
        })(),
        WRITE_TIMEOUT_MS,
        "The printer stopped part-way through. Check the paper roll, then print again.",
      );
    },
    close,
  };
}

/** Open the port chooser. Must be called from a real tap: Chrome requires a gesture. */
export async function chooseSerial(baud: Baud = DEFAULT_BAUD): Promise<Channel> {
  const api = serialApi();
  if (!api) throw new Error("This browser cannot open a serial port.");
  const port = await api.requestPort({});
  return openSerial(port, baud);
}

/** Take back a port this browser was already given, without asking anybody. */
export async function reopenSerial(id: string, baud: Baud = DEFAULT_BAUD): Promise<Channel | null> {
  const api = serialApi();
  if (!api) return null;
  try {
    const ports = await api.getPorts();
    const match = ports.find((p) => portId(p) === id) ?? (ports.length === 1 ? ports[0] : undefined);
    if (!match) return null;
    return await openSerial(match, baud);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- a USB device

/** USB's own number for "this is a printer". */
export const USB_PRINTER_CLASS = 7;

/**
 * The interface and endpoint to push ESC/POS down, or null if there is none.
 *
 * A printer's interface is class 7 and carries a bulk endpoint pointing out of
 * the computer. Some devices put a second alternate setting, or a vendor
 * interface, alongside it — hence a search rather than taking the first one.
 * Pure, and tested, because getting this wrong is a receipt that vanishes with
 * no error anywhere.
 */
export function pickPrinterEndpoint(
  configuration: UsbConfiguration | null | undefined,
): { interfaceNumber: number; endpointNumber: number } | null {
  if (!configuration?.interfaces?.length) return null;

  const isOutBulk = (e: UsbEndpoint) => e.direction === "out" && e.type === "bulk";

  // A real printer interface first.
  for (const iface of configuration.interfaces) {
    if (iface.alternate?.interfaceClass !== USB_PRINTER_CLASS) continue;
    const out = iface.alternate.endpoints?.find(isOutBulk);
    if (out) return { interfaceNumber: iface.interfaceNumber, endpointNumber: out.endpointNumber };
  }

  // Failing that, anything at all with a bulk endpoint going out: plenty of
  // these machines declare themselves vendor-specific and print perfectly well.
  for (const iface of configuration.interfaces) {
    const out = iface.alternate?.endpoints?.find(isOutBulk);
    if (out) return { interfaceNumber: iface.interfaceNumber, endpointNumber: out.endpointNumber };
  }

  return null;
}

function usbLabel(device: UsbDeviceLike): string {
  return device.productName || device.manufacturerName || "Printer on the cable";
}

function usbId(device: UsbDeviceLike): string {
  return `usb:${device.vendorId}:${device.productId}:${device.serialNumber ?? ""}`;
}

async function openUsb(device: UsbDeviceLike): Promise<Channel> {
  if (!device.opened) {
    await withTimeout(
      device.open(),
      OPEN_TIMEOUT_MS,
      "The cable did not answer. Check it is plugged in at both ends and the printer is switched on.",
    );
  }
  if (!device.configuration) await device.selectConfiguration(1);

  const found = pickPrinterEndpoint(device.configuration);
  if (!found) {
    const err = new Error("no printing endpoint");
    (err as { name?: string }).name = "NotSupportedError";
    throw err;
  }

  await device.claimInterface(found.interfaceNumber);
  let open = true;

  return {
    transport: "usb",
    name: usbLabel(device),
    id: usbId(device),
    alive: () => open && device.opened,
    async write(bytes) {
      await withTimeout(
        (async () => {
          for (const chunk of chunks(bytes, CABLE_CHUNK_BYTES)) {
            await device.transferOut(found.endpointNumber, chunk);
          }
        })(),
        WRITE_TIMEOUT_MS,
        "The printer stopped part-way through. Check the paper roll, then print again.",
      );
    },
    close() {
      open = false;
      void device.close().catch(() => {});
    },
  };
}

export async function chooseUsb(): Promise<Channel> {
  const api = usbApi();
  if (!api) throw new Error("This browser cannot open a USB device.");
  const device = await api.requestDevice({ filters: [{ classCode: USB_PRINTER_CLASS }, {}] });
  return openUsb(device);
}

export async function reopenUsb(id: string): Promise<Channel | null> {
  const api = usbApi();
  if (!api) return null;
  try {
    const devices = await api.getDevices();
    const match = devices.find((d) => usbId(d) === id);
    if (!match) return null;
    return await openUsb(match);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ what went wrong

/**
 * Cable failures, in words somebody at a desk can act on.
 *
 * The one worth the most: on Windows and on Linux the operating system has its
 * own printer driver, and it takes the device before the browser can. That is
 * not a fault in the app and retrying will never fix it — the way out is the
 * serial route, which no printer driver claims.
 */
export function explainCable(err: unknown, tried?: "serial" | "usb"): string {
  const name = (err as { name?: string })?.name ?? "";
  const raw = err instanceof Error ? err.message : String(err);

  if (name === "NotFoundError" || /no (port|device) selected/i.test(raw)) {
    return "No printer was chosen. Plug the printer in, switch it on, then try again and pick it from the list.";
  }
  if (name === "SecurityError") {
    /*
      THREE DIFFERENT FAULTS WEARING ONE ERROR NAME, and telling somebody the
      wrong one costs them an afternoon. This answered "open the app over
      https" for all of them, and sent a shop to look at a certificate that was
      never wrong.

      Which one it is can be worked out without guessing.

      The cable buttons are only drawn at all when the page IS already secure —
      `supported()` returns "insecure" otherwise and the whole panel is hidden
      — so an insecure page is the one case that can only happen somewhere
      other than that screen, and it keeps the old wording.

      On a secure page, which route was tried decides the rest. A USB attempt
      that gets this far has already been GRANTED the device — the browser
      names it in the site panel with a Reset permission button beside it — so
      there is nothing to unblock, and what refused is underneath the browser:
      Windows and Linux bind a printer to their own driver and will not let it
      go. No amount of permission will move that, and the serial route is the
      answer, because no printer driver claims a COM port.

      A serial attempt is the only one where a blocked permission is really the
      likely cause, because Chrome remembers a "Block" for good and then
      refuses the chooser without ever asking again.
    */
    const secure = typeof window !== "undefined" && window.isSecureContext;
    if (!secure) {
      return (
        "This page was opened over plain http, which a browser will not give a cable to. Open the app " +
        "over https, or as http://localhost on the machine itself."
      );
    }
    if (tried === "usb") {
      return (
        "The browser has the printer but cannot take hold of it: on Windows and on Linux the " +
        "operating system's own printer driver has it first, and no permission will move that. " +
        "Use Connect by cable instead and pick the printer's COM port — nothing claims a serial " +
        "port. If there is no port in the list, install the printer's USB driver (CH340 or Prolific " +
        "on most of these machines) and plug it back in."
      );
    }
    return (
      "This browser has this site blocked from reaching serial ports — somebody answered Block when " +
      "it asked, and it does not ask twice. Click the icon at the left of the address bar, open Site " +
      "settings, find Serial ports, set it back to Ask, then reload the page and try again."
    );
  }
  if (name === "NetworkError" || /failed to open|access denied|unable to claim/i.test(raw)) {
    return (
      "Windows and Linux both hand a USB printer to their own driver before the browser can reach it, " +
      "and that is what has happened here. Use Connect by cable and pick the printer's COM port instead — " +
      "nothing claims a serial port. If there is no port in the list, install the printer's USB driver " +
      "(CH340 or Prolific on most of these machines) and plug it back in."
    );
  }
  if (name === "NotSupportedError") {
    return "That device opened but offers nothing to print on. Try the other cable option, or a different USB socket.";
  }
  if (name === "InvalidStateError" || /already open/i.test(raw)) {
    return "That port is already open somewhere else. Close any other printing program or browser tab using it, then try again.";
  }
  if (/user gesture|cancelled|canceled/i.test(raw)) {
    return "Printing was cancelled.";
  }
  return raw || "The printer on the cable could not be reached. Try again.";
}
