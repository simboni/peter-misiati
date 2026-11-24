"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/server/money";
import { whatsappCopy, type Tone } from "@/server/reminders";
import { SubmitButton } from "./submit-button";
import {
  markChasedAction,
  sendReminderNowAction,
  setInvoiceRemindersAction,
  setClientRemindersAction,
} from "@/server/actions/reminders";

export type QueueRow = {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  currency: string;
  balanceDue: number;
  dueDateText: string;
  daysOverdue: number;
  step: number | null;
  tone: Tone;
  sentCount: number;
  lastRemindedText: string | null;
  lastFailed: boolean;
  shareToken: string;
  remindersPaused: boolean;
  blocked: "paused" | "client-opted-out" | "too-old" | "no-email" | "below-minimum" | null;
};

const BLOCKED_LABEL: Record<string, string> = {
  paused: "Reminders paused",
  "client-opted-out": "Client opted out",
  "too-old": "Too old to auto-chase",
  "no-email": "No email on file",
  "below-minimum": "Below your minimum",
};

/** How late something is, in words a person would use. */
function ageText(days: number): string {
  if (days === 0) return "Due today";
  if (days < 0) return `Due in ${-days} day${days === -1 ? "" : "s"}`;
  return `${days} day${days === 1 ? "" : "s"} overdue`;
}

function ageTone(days: number): string {
  if (days <= 0) return "bg-blue-50 text-blue-700";
  if (days <= 7) return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-700";
}

type Bucket = "due" | "waiting" | "upcoming" | "blocked";

const BUCKET_COPY: Record<Bucket, { title: string; blurb: string }> = {
  due: {
    title: "Chase now",
    blurb: "A reminder is due on these. Send it and move on.",
  },
  waiting: {
    title: "Already chased",
    blurb: "Still unpaid, but the last reminder went out recently — the next one is scheduled.",
  },
  upcoming: {
    title: "Not due yet",
    blurb: "Nothing to do. These appear here so you can see what's coming.",
  },
  blocked: {
    title: "Not being chased",
    blurb: "These are outstanding but excluded from reminders. Each row says why.",
  },
};

export function ChaseQueueView({
  rows,
  emailReady,
  businessName,
}: {
  rows: QueueRow[];
  emailReady: boolean;
  businessName: string;
}) {
  const [q, setQ] = useState("");
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return rows;
    return rows.filter((r) => `${r.number} ${r.clientName}`.toLowerCase().includes(n));
  }, [rows, q]);

  const buckets = useMemo(() => {
    const out: Record<Bucket, QueueRow[]> = { due: [], waiting: [], upcoming: [], blocked: [] };
    for (const r of filtered) {
      if (r.blocked) out.blocked.push(r);
      else if (r.step !== null) out.due.push(r);
      else if (r.daysOverdue >= 0) out.waiting.push(r);
      else out.upcoming.push(r);
    }
    return out;
  }, [filtered]);

  const owed = filtered.reduce((s, r) => s + r.balanceDue, 0);
  const cur = rows[0]?.currency ?? "KES";

  return (
    <div className="space-y-4">
      {!emailReady && (
        <div className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <b>Email isn&apos;t set up yet.</b> Automatic reminders are paused until an email sender is
          configured, but you can still chase on WhatsApp and log it here.
        </div>
      )}

      <div className="card p-3">
        <div className="relative">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" strokeLinecap="round" />
          </svg>
          <input
            className="input pl-9"
            placeholder="Search invoice or client…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-muted">
        <span>
          {buckets.due.length} to chase · {filtered.length} outstanding
        </span>
        <span>
          Total owed: <b className="tabular-nums text-ink">{formatMoney(owed, cur)}</b>
        </span>
      </div>

      {(["due", "waiting", "upcoming", "blocked"] as Bucket[]).map((b) =>
        buckets[b].length === 0 ? null : (
          <section key={b} className="space-y-2.5">
            <div className="px-1">
              <h2 className="text-sm font-bold text-ink">
                {BUCKET_COPY[b].title}{" "}
                <span className="font-normal text-muted">({buckets[b].length})</span>
              </h2>
              <p className="text-xs text-muted">{BUCKET_COPY[b].blurb}</p>
            </div>
            {buckets[b].map((r) => (
              <QueueCard
                key={r.id}
                r={r}
                origin={origin}
                emailReady={emailReady}
                businessName={businessName}
              />
            ))}
          </section>
        ),
      )}

      {filtered.length === 0 && (
        <div className="card p-6 text-center text-sm text-muted">Nothing matches that search.</div>
      )}
    </div>
  );
}

function QueueCard({
  r,
  origin,
  emailReady,
  businessName,
}: {
  r: QueueRow;
  origin: string;
  emailReady: boolean;
  businessName: string;
}) {
  const amount = formatMoney(r.balanceDue, r.currency);
  const waMessage = whatsappCopy({
    tone: r.tone,
    step: r.daysOverdue,
    businessName,
    clientName: r.clientName,
    invoiceNumber: r.number,
    amountText: amount,
    dueDateText: r.dueDateText,
    payUrl: `${origin}/d/${r.shareToken}`,
  });
  const digits = (r.clientPhone ?? "").replace(/[^0-9]/g, "");
  const waHref = `https://wa.me/${digits}?text=${encodeURIComponent(waMessage)}`;

  const canEmail = Boolean(r.clientEmail) && emailReady;

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/invoices/${r.id}`} className="font-semibold text-ink hover:text-brand-700">
              {r.number}
            </Link>
            <span className={`badge ${ageTone(r.daysOverdue)}`}>{ageText(r.daysOverdue)}</span>
            {r.blocked && <span className="badge bg-slate-100 text-slate-500">{BLOCKED_LABEL[r.blocked]}</span>}
            {r.lastFailed && <span className="badge bg-red-50 text-red-700">Last send failed</span>}
          </div>
          <div className="mt-0.5 truncate text-sm text-muted">
            {r.clientName} · due {r.dueDateText}
          </div>
          <div className="text-xs text-muted">
            {r.sentCount === 0
              ? "Not chased yet"
              : `${r.sentCount} reminder${r.sentCount === 1 ? "" : "s"} sent${
                  r.lastRemindedText ? ` · last ${r.lastRemindedText}` : ""
                }`}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-semibold tabular-nums text-ink">{amount}</div>
          <div className="text-[11px] text-muted">owed</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
        {canEmail ? (
          <form action={sendReminderNowAction}>
            <input type="hidden" name="invoiceId" value={r.id} />
            <SubmitButton
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition-transform active:scale-95"
              pendingText="Sending…"
            >
              Send reminder
            </SubmitButton>
          </form>
        ) : (
          <span className="rounded-lg bg-canvas px-3 py-1.5 text-xs font-medium text-muted">
            {r.clientEmail ? "Email not set up" : "No email on file"}
          </span>
        )}

        {digits && (
          <a
            href={waHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-1.5 text-xs font-bold text-white transition-transform active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
              <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Z" />
            </svg>
            WhatsApp
          </a>
        )}

        <form action={markChasedAction}>
          <input type="hidden" name="invoiceId" value={r.id} />
          <input type="hidden" name="channel" value="whatsapp" />
          <SubmitButton
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-canvas hover:text-ink"
            pendingText="Saving…"
          >
            Mark chased
          </SubmitButton>
        </form>

        <form action={setInvoiceRemindersAction} className="ml-auto">
          <input type="hidden" name="invoiceId" value={r.id} />
          <input type="hidden" name="paused" value={r.remindersPaused ? "0" : "1"} />
          <SubmitButton
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-canvas hover:text-ink"
            pendingText="Updating…"
          >
            {r.remindersPaused ? "Resume reminders" : "Stop chasing this"}
          </SubmitButton>
        </form>

        {r.blocked === "client-opted-out" && (
          <form action={setClientRemindersAction}>
            <input type="hidden" name="clientId" value={r.clientId} />
            <input type="hidden" name="optOut" value="0" />
            <SubmitButton
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-canvas hover:text-ink"
              pendingText="Updating…"
            >
              Opt client back in
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
