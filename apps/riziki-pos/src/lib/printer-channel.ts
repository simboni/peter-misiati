/**
 * One open way to a printer, whatever it is on the end of.
 *
 * The counter started with a single transport — Web Bluetooth — and the whole
 * connection was written inline against it. Then the shop tried to print from
 * the desktop, where a cheap ESC/POS printer pairs over Bluetooth *Classic* and
 * a browser can only speak Bluetooth *Low Energy*: the chooser shows it, the
 * pairing is accepted, and the connection then has nothing to write on. To the
 * person at the desk that reads as the app agreeing to a printer and letting go
 * of it again, which is exactly what it is doing.
 *
 * The desktop's answer is the cable, so there are now three ways in and the
 * code above them must not care which. A `Channel` is that: something with a
 * name that is either alive or not, takes bytes, and can be closed. Everything
 * transport-shaped — GATT characteristics, serial writers, USB endpoints —
 * stays behind one of these.
 *
 * Nothing here touches the DOM, so the pieces below can be tested under plain
 * Node instead of being believed.
 */

/** How the printer is reached. Shown to the shop, so the words are theirs. */
export type Transport = "bluetooth" | "serial" | "usb";

export const TRANSPORT_LABEL: Record<Transport, string> = {
  bluetooth: "Bluetooth",
  serial: "the cable",
  usb: "the cable",
};

export interface Channel {
  transport: Transport;
  /** What to call it on screen. */
  name: string;
  /** A stable handle for this exact device, so it can be recognised again. */
  id: string;
  /** Still connected right now — an automatic receipt can go straight out. */
  alive(): boolean;
  write(bytes: Uint8Array): Promise<void>;
  /**
   * Whether the paper ran out, where the transport can ask. Absent rather than
   * false when it cannot: a printer on a cable is sitting in front of whoever
   * pressed the button, and guessing at a status nobody answered is worse than
   * letting them look at it.
   */
  paperOut?(): Promise<boolean>;
  close(): void;
}

/**
 * Cut a job into pieces the transport can actually swallow.
 *
 * A BLE characteristic write is capped by the negotiated MTU and the 58 mm
 * printers sold here lose everything past roughly half a kilobyte in one go. A
 * cable has no such limit worth worrying about, which is the single biggest
 * reason a receipt over USB appears instantly and the same receipt over
 * Bluetooth takes a couple of seconds.
 */
export function chunks(bytes: Uint8Array, size: number): Uint8Array[] {
  const step = Math.max(1, Math.floor(size));
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += step) out.push(bytes.slice(i, i + step));
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Nothing may wait forever: a spinner with no end is worse than an error. */
export function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
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
