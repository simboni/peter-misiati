"use client";

/**
 * The hardware half of receipt printing: Web Bluetooth.
 *
 * Deliberately thin. Every decision about what a receipt *says* lives in
 * `@/lib/escpos`, which is pure and unit-tested; this file only opens a
 * connection, pushes the bytes it is given, and explains — in words an
 * attendant can act on — whatever went wrong. Nothing here can be tested
 * without a printer in the room, so there is as little of it as possible.
 *
 * Three things the cheap printers force on us:
 *
 *  1. **Chunked writes.** A BLE characteristic write is capped by the negotiated
 *     MTU, and the 58 mm printers sold locally drop everything past roughly half
 *     a kilobyte in one go. The stream is therefore cut into small pieces with a
 *     breath between them.
 *  2. **A secure context.** Chrome only exposes `navigator.bluetooth` on https or
 *     localhost. The shop may well open the app over plain http on the LAN, so
 *     that case is detected and explained rather than left to fail as "undefined".
 *  3. **No single service UUID.** Every OEM picks its own. We ask for the handful
 *     that actually ship, then fall back to showing every device.
 */

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import {
  CMD,
  isPaperOut,
  receiptBytes,
  receiptText,
  testReceipt,
  type PaperWidth,
  type Receipt,
} from "@/lib/escpos";

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

// ------------------------------------------------------------ the button

export function ThermalPrint({
  receipt,
  paper,
  auto = false,
  openDrawer = false,
  label = "Print receipt",
  className = "",
}: {
  receipt: Receipt;
  paper: PaperWidth;
  /** Print as soon as the screen opens, if a printer is already remembered. */
  auto?: boolean;
  openDrawer?: boolean;
  label?: string;
  className?: string;
}) {
  const [support, setSupport] = useState<Support>("checking");
  const [busy, setBusy] = useState<"" | "connecting" | "printing">("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [printerName, setPrinterName] = useState("");
  const [showAll, setShowAll] = useState(false);
  /** True once a previously-permitted printer has been re-bound without a tap. */
  const [bound, setBound] = useState(false);

  const device = useRef<BtDevice | null>(null);
  const chars = useRef<{ write: BtCharacteristic; notify?: BtCharacteristic } | null>(null);
  const autoFired = useRef(false);

  // Support has to be decided on the client — the server has no idea whether
  // this page arrived over https — so it is state, not a render-time check.
  useEffect(() => {
    let live = true;
    (async () => {
      const api = bluetooth();
      if (!window.isSecureContext) return live && setSupport("insecure");
      if (!api) return live && setSupport("unsupported");
      if (api.getAvailability) {
        try {
          const available = await api.getAvailability();
          if (!available) return live && setSupport("adapter-off");
        } catch {
          // getAvailability is advisory; a throw is not a reason to refuse.
        }
      }
      if (live) setSupport("ok");
    })();
    return () => {
      live = false;
    };
  }, []);

  // Chrome keeps permission for a device the shop has already chosen, so the
  // second print of the day is one tap rather than a trip through the chooser.
  useEffect(() => {
    let live = true;
    (async () => {
      const api = bluetooth();
      const saved = readRemembered();
      if (!api?.getDevices || !saved) {
        if (live && saved) setPrinterName(saved.name);
        return;
      }
      try {
        const granted = await api.getDevices();
        const match = granted.find((d) => d.id === saved.id);
        if (!live) return;
        if (match) {
          device.current = match;
          setPrinterName(match.name ?? saved.name);
          setBound(true);
        } else {
          setPrinterName(saved.name);
        }
      } catch {
        if (live) setPrinterName(saved.name);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const connect = useCallback(async (): Promise<{ write: BtCharacteristic; notify?: BtCharacteristic }> => {
    const api = bluetooth();
    if (!api) throw new Error(SUPPORT_MESSAGE.unsupported);

    if (chars.current && device.current?.gatt?.connected) return chars.current;

    if (!device.current) {
      // requestDevice is deliberately not wrapped in a timeout: the chooser is
      // open in front of a human, and that takes as long as it takes.
      device.current = await api.requestDevice(
        showAll
          ? { acceptAllDevices: true, optionalServices: PRINTER_SERVICES }
          : {
              filters: PRINTER_SERVICES.map((s) => ({ services: [s] })),
              optionalServices: PRINTER_SERVICES,
            },
      );
      writeRemembered(device.current);
      setPrinterName(device.current.name ?? "printer");
      setBound(true);
    }

    const gatt = device.current.gatt;
    if (!gatt) throw new Error("That device does not accept a printing connection.");

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
    chars.current = found;
    return found;
  }, [showAll]);

  const print = useCallback(
    async (silent = false) => {
      setError("");
      setOk("");
      setBusy("connecting");
      try {
        const bytes = receiptBytes(receipt, { paper, openDrawer });

        let found: { write: BtCharacteristic; notify?: BtCharacteristic };
        try {
          found = await connect();
        } catch (err) {
          // A remembered printer that has moved on: forget the handle and let
          // the next tap open the chooser rather than failing forever.
          chars.current = null;
          if (device.current && !(err as { name?: string })?.name) device.current = null;
          throw err;
        }

        if (await paperOut(found)) {
          throw new Error("The printer is out of paper. Load a roll and tap Print again.");
        }

        setBusy("printing");
        try {
          await withTimeout(
            writeChunks(found.write, bytes),
            WRITE_TIMEOUT_MS,
            "The printer stopped part-way through. Check the paper roll, then print again.",
          );
        } catch (err) {
          chars.current = null; // force a fresh connection next time
          throw err;
        }

        setOk(`Sent to ${device.current?.name ?? "the printer"}.`);
      } catch (err) {
        if (!silent) setError(explain(err));
      } finally {
        // Always. A hung spinner on the counter phone means a queue.
        setBusy("");
      }
    },
    [connect, openDrawer, paper, receipt],
  );

  // Auto-print only fires when a printer is already paired and permitted:
  // `requestDevice` needs a tap, so an unpaired shop simply sees the button.
  // `bound` is a state flag rather than the ref, because re-binding the printer
  // finishes asynchronously and this effect must run again when it does.
  useEffect(() => {
    if (!auto || autoFired.current || support !== "ok" || !bound) return;
    if (!device.current) return;
    autoFired.current = true;
    void print(true);
  }, [auto, bound, support, print]);

  const blocked = support !== "ok" && support !== "checking";
  const busyLabel = busy === "connecting" ? "Connecting…" : "Printing…";

  return (
    <div className={className}>
      <Button
        variant="primary"
        className="w-full"
        onClick={() => void print()}
        disabled={!!busy || blocked}
        aria-busy={!!busy}
      >
        {busy ? busyLabel : printerName ? `${label} — ${printerName}` : label}
      </Button>

      {blocked ? (
        <div className="mt-2">
          <Alert tone="warn">{SUPPORT_MESSAGE[support as Exclude<Support, "checking" | "ok">]}</Alert>
        </div>
      ) : null}

      {error ? (
        <div className="mt-2 space-y-2">
          <Alert tone="bad">{error}</Alert>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                device.current = null;
                chars.current = null;
                setBound(false);
                setPrinterName("");
                setError("");
                try {
                  window.localStorage.removeItem(REMEMBERED_KEY);
                } catch {
                  /* nothing to forget */
                }
              }}
            >
              Choose another printer
            </Button>
            {!showAll ? (
              <Button
                variant="ghost"
                onClick={() => {
                  device.current = null;
                  chars.current = null;
                  setBound(false);
                  setShowAll(true);
                  setError("");
                }}
              >
                Show every Bluetooth device
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {ok && !error ? (
        <div className="mt-2">
          <Alert tone="good">{ok}</Alert>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------- settings screen

export interface PrinterFields {
  paper: PaperWidth;
  header: string[];
  footer: string;
  autoPrint: boolean;
}

export interface PrinterFormState {
  error?: string;
  ok?: string;
}

const EMPTY_FORM_STATE: PrinterFormState = {};

/**
 * The setup screen's form.
 *
 * It keeps the fields in local state as well as posting them, so the preview and
 * the test print show what is on screen right now — the owner can try a header,
 * print it, and only then save.
 */
export function PrinterSettingsForm({
  settings,
  action,
}: {
  settings: PrinterFields;
  action: (prev: PrinterFormState, formData: FormData) => Promise<PrinterFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_FORM_STATE);

  const [paper, setPaper] = useState<PaperWidth>(settings.paper);
  const [header, setHeader] = useState(settings.header.join("\n"));
  const [footer, setFooter] = useState(settings.footer);
  const [autoPrint, setAutoPrint] = useState(settings.autoPrint);

  const headerLines = header
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const sample = testReceipt(headerLines, footer);

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3.5">
        {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
        {state.ok ? <Alert tone="good">{state.ok}</Alert> : null}

        <Field label="Paper width" hint="58 mm fits 32 characters a line, 80 mm fits 48.">
          <div className="grid grid-cols-2 gap-2">
            {([58, 80] as PaperWidth[]).map((w) => (
              <label
                key={w}
                className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-bold ${
                  paper === w ? "border-brand bg-brand-soft text-brand" : "border-line bg-white text-ink"
                }`}
              >
                <input
                  type="radio"
                  name="paper"
                  value={w}
                  checked={paper === w}
                  onChange={() => setPaper(w)}
                  className="sr-only"
                />
                {w} mm
              </label>
            ))}
          </div>
        </Field>

        <Field label="Header" hint="The first line is the shop's name and prints large. Up to six lines.">
          <textarea
            className={`${inputClass} min-h-28 font-mono text-sm`}
            name="header"
            value={header}
            onChange={(e) => setHeader(e.target.value)}
            spellCheck={false}
          />
        </Field>

        <Field label="Footer" hint="Printed small and centred at the bottom of every receipt.">
          <input
            className={inputClass}
            name="footer"
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
            placeholder="Asante sana"
          />
        </Field>

        <label className="flex items-center gap-3 rounded-xl border border-line bg-white px-3.5 py-3">
          <input
            type="checkbox"
            name="auto_print"
            checked={autoPrint}
            onChange={(e) => setAutoPrint(e.target.checked)}
            className="h-5 w-5"
          />
          <span className="text-sm font-semibold">
            Print automatically after a sale
            <span className="block text-xs font-normal text-muted">
              Only once a printer has been paired on this phone.
            </span>
          </span>
        </label>

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Saving…" : "Save printer settings"}
        </Button>
      </form>

      <ThermalPrint receipt={sample} paper={paper} label="Print test receipt" />

      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
          What will come out
        </div>
        <pre className="overflow-x-auto rounded-2xl border border-line bg-white p-3 font-mono text-[11px] leading-tight">
          {receiptText(sample, { paper })}
        </pre>
      </div>
    </div>
  );
}
