"use client";

/**
 * The connection pill, and everything the staff need to trust it.
 *
 * The fear this component answers is specific: a sale is taken, the network is
 * down, and nobody at the counter can tell whether the money is recorded. So it
 * is never silent. It says whether the phone is online, exactly how many sales
 * are still on the device, and — when one is refused — why, in words the person
 * holding the phone can act on.
 *
 * Draining happens on three triggers, because any one of them alone is a way to
 * lose a morning: the browser's `online` event (which lies often enough on
 * Android to not be trusted alone), a slow interval, and the user's own
 * "Send now". They share one in-flight attempt inside `drainOutbox`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  countOutbox,
  discardQueued,
  drainOutbox,
  listOutbox,
  onOutboxChange,
  type DrainReport,
  type QueuedSale,
} from "@/lib/offline";
import { formatDateTime, formatKes } from "@/lib/units";
import { Alert, Button, inputClass } from "@/components/ui";

/** Slow on purpose: the retry is cheap, but a chatty phone on Safaricom is not. */
const RETRY_MS = 20_000;

export default function OfflineStatus() {
  const router = useRouter();

  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [report, setReport] = useState<DrainReport | null>(null);
  const [ownerPin, setOwnerPin] = useState("");

  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const rows = await listOutbox();
      if (alive.current) setQueue(rows);
    } catch {
      // A browser with no IndexedDB simply has no queue to show.
      if (alive.current) setQueue([]);
    }
  }, []);

  const send = useCallback(
    async (pin?: string) => {
      if (alive.current) setSending(true);
      try {
        const result = await drainOutbox(pin ? { ownerPin: pin } : {});
        if (!alive.current) return result;
        setReport(result);
        await reload();
        // Stock and the day's takings moved on the server; pull them back in
        // so the sell grid stops showing counts from before the sync.
        if (result.accepted > 0) router.refresh();
        return result;
      } finally {
        if (alive.current) setSending(false);
      }
    },
    [reload, router],
  );

  useEffect(() => {
    alive.current = true;
    setOnline(navigator.onLine);
    void reload();

    // On page load, before anything else: yesterday's queue must not wait for
    // the first network flap of the day.
    void countOutbox().then((n) => {
      if (n > 0 && navigator.onLine) void send();
    });

    const goOnline = () => {
      setOnline(true);
      void send();
    };
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const stopWatching = onOutboxChange(() => void reload());

    const timer = window.setInterval(() => {
      setOnline(navigator.onLine);
      void countOutbox().then((n) => {
        if (n > 0 && navigator.onLine) void send();
      });
    }, RETRY_MS);

    return () => {
      alive.current = false;
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      stopWatching();
      window.clearInterval(timer);
    };
  }, [reload, send]);

  const waiting = queue.length;
  const refused = queue.filter((s) => s.lastError);
  const needsPin = refused.some((s) => /minimum price|owner must approve/i.test(s.lastError ?? ""));

  const tone = !online ? "bad" : waiting > 0 ? "warn" : "good";
  const label = !online ? "Offline" : waiting > 0 ? "Sending" : "Online";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={
          waiting
            ? `${label} — ${waiting} sale${waiting === 1 ? "" : "s"} waiting to send`
            : label
        }
        className={`no-print inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
          tone === "bad"
            ? "bg-bad-soft text-bad"
            : tone === "warn"
              ? "bg-warn-soft text-warn"
              : "bg-good-soft text-good"
        }`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
        {label}
        {waiting > 0 ? <span className="tnum">· {waiting}</span> : null}
      </button>

      {open ? (
        <div
          className="no-print fixed inset-0 z-50 flex flex-col bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-label="Connection and unsent sales"
        >
          <button type="button" className="flex-1" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="mx-auto max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <div className="mb-3 flex items-center">
              <h2 className="text-lg font-bold">{online ? "Connected" : "No connection"}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-muted"
              >
                Close
              </button>
            </div>

            <p className="text-sm text-muted">
              {waiting === 0
                ? online
                  ? "Everything is recorded on the till. Nothing is waiting on this phone."
                  : "Nothing is waiting on this phone. You can keep selling — sales taken now are saved here and sent when the network returns."
                : `${waiting} sale${waiting === 1 ? "" : "s"} ${
                    waiting === 1 ? "is" : "are"
                  } saved on this phone and not yet on the till. ${
                    online ? "Sending them now." : "They will send themselves when the network returns."
                  }`}
            </p>

            {report?.error ? (
              <div className="mt-3">
                <Alert tone={report.signedOut ? "bad" : "warn"}>
                  {report.error}
                  {report.signedOut
                    ? " Nothing has been lost — the sales stay on this phone until they are sent."
                    : null}
                </Alert>
              </div>
            ) : null}

            {report && !report.error && report.accepted + report.duplicate > 0 ? (
              <div className="mt-3">
                <Alert tone="good">
                  {report.accepted} sent
                  {report.duplicate ? `, ${report.duplicate} already on the till` : ""}
                  {report.failed ? `, ${report.failed} refused` : ""}.
                </Alert>
              </div>
            ) : null}

            {needsPin ? (
              <div className="mt-3">
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
                  Owner PIN — one of these prices is below the minimum
                </label>
                <input
                  className={inputClass}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={ownerPin}
                  onChange={(e) => setOwnerPin(e.target.value)}
                  placeholder="Owner PIN"
                  aria-label="Owner PIN"
                />
                <p className="mt-1 text-xs text-muted">
                  The PIN is never stored on this phone — it is typed now and sent with the sale.
                </p>
              </div>
            ) : null}

            <Button
              className="mt-4 w-full"
              disabled={sending || waiting === 0}
              onClick={() => void send(ownerPin.trim() || undefined)}
            >
              {sending ? "Sending…" : waiting === 0 ? "Nothing to send" : `Send now — ${waiting}`}
            </Button>

            {queue.length ? (
              <div className="mt-4 space-y-2">
                {queue.map((sale) => (
                  <div
                    key={sale.clientUuid}
                    className={`rounded-xl border p-2.5 ${
                      sale.lastError ? "border-bad/40 bg-bad-soft/40" : "border-line"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-extrabold tnum">{formatKes(sale.totalCents)}</span>
                      <span className="text-[11px] text-muted">
                        {sale.lines.length} line{sale.lines.length === 1 ? "" : "s"}
                        {sale.queuedAt ? ` · ${formatDateTime(sale.queuedAt)}` : ""}
                      </span>
                    </div>
                    {sale.lastError ? (
                      <>
                        <p className="mt-1.5 text-xs font-semibold text-bad">{sale.lastError}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[11px] text-muted tnum">
                            {sale.attempts} attempt{sale.attempts === 1 ? "" : "s"}
                          </span>
                          <button
                            type="button"
                            onClick={() => void discardQueued(sale.clientUuid)}
                            className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[11px] font-bold text-bad"
                          >
                            Discard — ring it up again
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
