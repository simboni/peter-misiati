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

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Alert, Button, Chip, Field, inputClass } from "@/components/ui";
import { receiptBytes, receiptText, testReceipt, type PaperWidth, type Receipt } from "@/lib/escpos";
import * as link from "@/lib/printer-link";

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
  /*
    The printer lives in `@/lib/printer-link`, not here.

    Everything below watches it. That is the whole point: this component mounts
    and unmounts constantly — every sale navigates to its receipt — and a
    connection stored in a ref died with it, which is why the shop was choosing
    a printer several times an hour.
  */
  const printer = useSyncExternalStore(link.subscribe, link.getSnapshot, link.getServerSnapshot);
  const [support, setSupport] = useState<link.Support | "ok">("ok");
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [showAll, setShowAll] = useState(false);
  const autoFired = useRef(false);

  const busy = printer.status === "connecting" || printer.status === "printing";

  // Support has to be decided on the client — the server has no idea whether
  // this page arrived over https — so it is state, not a render-time check.
  useEffect(() => {
    let live = true;
    (async () => {
      const verdict = await link.available();
      if (!live) return;
      setSupport(verdict);
      setChecking(false);
      if (verdict === "ok") void link.rebind();
    })();
    return () => {
      live = false;
    };
  }, []);

  const send = useCallback(
    async (silent: boolean) => {
      setError("");
      setOk("");
      try {
        await link.send(receiptBytes(receipt, { paper, openDrawer }));
        setOk(`Sent to ${link.printerName() || "the printer"}.`);
      } catch (err) {
        if (!silent) setError(link.explain(err));
      }
    },
    [openDrawer, paper, receipt],
  );

  /**
   * The tap. Chooses a printer only when there is not one already.
   *
   * `requestDevice` must be answered by a human and can only be called from a
   * real gesture, so it lives here and nowhere else — an automatic receipt can
   * never raise a chooser at somebody who is not looking at the screen.
   */
  const print = useCallback(async () => {
    setError("");
    setOk("");
    try {
      if (!printer.name || (!printer.live && !printer.remembered)) {
        await link.choose(showAll);
      }
      await send(false);
    } catch (err) {
      setError(link.explain(err));
    }
  }, [printer.live, printer.name, printer.remembered, send, showAll]);

  const choose = useCallback(async () => {
    setError("");
    setOk("");
    try {
      await link.choose(showAll);
      await send(false);
    } catch (err) {
      setError(link.explain(err));
    }
  }, [send, showAll]);

  /*
    The receipt that prints itself.

    Fires once the link has a printer it can reach without asking anybody. It
    never calls the chooser: an automatic print happens while the attendant is
    counting change and looking at the customer, and a permission prompt thrown
    at a screen nobody is watching is worse than no receipt.

    `printer.live` is the ordinary case — the connection from the last sale is
    still open, and the receipt goes out in well under a second. `remembered`
    covers the reload: there is a printer to reconnect to silently, and the
    attempt is cheap enough to be worth making.
  */
  useEffect(() => {
    if (!auto || autoFired.current || support !== "ok") return;
    if (!printer.live && !printer.remembered) return;
    autoFired.current = true;
    /*
      Deferred out of the effect body on purpose. Printing clears the last
      message, which is a state write, and a state write inside an effect body
      costs an extra render pass before the receipt has even been drawn. The
      receipt is going to a printer, not to this screen — it can wait a tick.
    */
    const t = setTimeout(() => void send(true), 0);
    return () => clearTimeout(t);
  }, [auto, support, printer.live, printer.remembered, send]);

  const blocked = support !== "ok" && !checking;
  const busyLabel = printer.status === "connecting" ? "Connecting…" : "Printing…";

  /*
    The button says which printer it will use, and whether it is already on the
    end of a live connection. "Print — Ready" is the state the counter should be
    in all day; anything else is worth a glance before a customer is waiting.
  */
  const face = busy
    ? busyLabel
    : printer.name
      ? `${label} — ${printer.name}${printer.live ? "" : " ·"}`
      : label;

  return (
    <div className={className}>
      <Button
        variant="primary"
        className="w-full"
        onClick={() => void print()}
        disabled={busy || blocked}
        aria-busy={busy}
      >
        {face}
      </Button>

      {/* Which printer, and whether it is connected — said quietly, under the
          button, because it only matters when something is wrong. */}
      {!blocked && printer.name && !busy ? (
        <p className="mt-1.5 text-[11px] text-muted">
          {printer.live
            ? `Connected to ${printer.name}. Receipts print on their own.`
            : `${printer.name} — it will reconnect on the next receipt.`}
        </p>
      ) : null}

      {blocked ? (
        <div className="mt-2">
          <Alert tone="warn">
            {link.SUPPORT_MESSAGE[support as Exclude<link.Support, "checking" | "ok">]}
          </Alert>
        </div>
      ) : null}

      {error ? (
        <div className="mt-2 space-y-2">
          <Alert tone="bad">{error}</Alert>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                link.forget();
                setError("");
                void choose();
              }}
            >
              Choose another printer
            </Button>
            {!showAll ? (
              <Button
                variant="ghost"
                onClick={() => {
                  link.forget();
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

// -------------------------------------------------------- pairing a printer

/**
 * The printer itself: which one, is it there, and how to change it.
 *
 * This existed nowhere. Pairing happened as a side effect of tapping Print, and
 * the only way to change printers was a button that appeared AFTER a failure —
 * so a shop that had paired the wrong one, or bought a new one, had to make the
 * app fail before it would offer them the choice. On a screen called "Receipt
 * printer" that is the one control that has to be plainly there.
 *
 * Three plain acts: pair one, print a test slip, forget it. Nothing is hidden
 * behind an error and nothing needs a working printer to reach.
 */
export function PrinterPicker({ paper, header, footer }: PrinterFieldsView) {
  const printer = useSyncExternalStore(link.subscribe, link.getSnapshot, link.getServerSnapshot);
  const [support, setSupport] = useState<link.Support | "ok">("ok");
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const verdict = await link.available();
      if (!live) return;
      setSupport(verdict);
      setChecking(false);
      if (verdict === "ok") void link.rebind();
    })();
    return () => {
      live = false;
    };
  }, []);

  const pair = async () => {
    setError("");
    setOk("");
    setWorking(true);
    try {
      await link.choose(showAll);
      // Prove it before saying it works: a device that pairs and offers nothing
      // to print on is the wrong half of a dual-mode printer, and the only way
      // to find out is to ask it for a channel.
      await link.send(receiptBytes(testReceipt(header, footer), { paper }));
      setOk(`Paired with ${link.printerName()}. A test slip should be coming out of it.`);
    } catch (err) {
      setError(link.explain(err));
    } finally {
      setWorking(false);
    }
  };

  const test = async () => {
    setError("");
    setOk("");
    setWorking(true);
    try {
      await link.send(receiptBytes(testReceipt(header, footer), { paper }));
      setOk("Test slip sent.");
    } catch (err) {
      setError(link.explain(err));
    } finally {
      setWorking(false);
    }
  };

  const blocked = support !== "ok" && !checking;

  return (
    <div className="space-y-3 rounded-3xl bg-white p-4 shadow-card ring-1 ring-ink/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            The printer
          </div>
          <div className="mt-0.5 truncate text-base font-bold">
            {printer.name || "None paired yet"}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {!printer.name
              ? "Switch the printer on, then pair it. It only has to be done once on this phone."
              : printer.live
                ? "Connected. Receipts print on their own."
                : "Paired. It will connect itself on the next receipt."}
          </p>
        </div>
        {printer.name ? (
          <Chip tone={printer.live ? "good" : "neutral"}>
            {printer.live ? "Connected" : "Not connected"}
          </Chip>
        ) : null}
      </div>

      {blocked ? (
        <Alert tone="warn">
          {link.SUPPORT_MESSAGE[support as Exclude<link.Support, "checking" | "ok">]}
        </Alert>
      ) : null}
      {error ? <Alert tone="bad">{error}</Alert> : null}
      {ok && !error ? <Alert tone="good">{ok}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void pair()} disabled={working || blocked}>
          {working ? "Working…" : printer.name ? "Pair a different printer" : "Pair a printer"}
        </Button>
        {printer.name ? (
          <>
            <Button variant="ghost" onClick={() => void test()} disabled={working || blocked}>
              Print a test slip
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                link.forget();
                setError("");
                setOk("Forgotten. Pair a printer when you are ready.");
              }}
              disabled={working}
            >
              Forget it
            </Button>
          </>
        ) : null}
      </div>

      {/*
        The way out for a printer that advertises something exotic. Off by
        default because "every Bluetooth device" is a list of watches, phones and
        earbuds, and picking a watch out of it is how the counter ends up paired
        to something that will never print.
      */}
      <label className="flex items-center gap-2.5 text-xs text-muted">
        <input
          type="checkbox"
          checked={showAll}
          onChange={(e) => setShowAll(e.target.checked)}
          className="h-4 w-4"
        />
        Show every Bluetooth device, not just printers — try this only if yours never appears.
      </label>
    </div>
  );
}

export interface PrinterFieldsView {
  paper: PaperWidth;
  header: string[];
  footer: string;
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
