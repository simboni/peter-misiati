"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/server/money";
import { StatusBadge } from "./status-badge";
import { InvoiceRowActions } from "./invoice-row-actions";

type Row = {
  id: string;
  number: string;
  client: string;
  date: string;
  issueMs: number;
  status: string;
  total: number;
  balance: number;
  received: number;
  currency: string;
  shareToken: string;
};

const STATUSES = ["all", "draft", "sent", "partial", "paid", "overdue", "void"];
const STATUS_LABELS: Record<string, string> = { all: "All statuses", partial: "Part-paid" };

export function InvoiceListView({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [client, setClient] = useState("all");
  const [sort, setSort] = useState("newest");

  const clients = useMemo(
    () => Array.from(new Set(rows.map((r) => r.client))).sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (client !== "all" && r.client !== client) return false;
      if (needle && !`${r.number} ${r.client}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    out.sort((a, b) => {
      if (sort === "oldest") return a.issueMs - b.issueMs;
      if (sort === "total") return b.total - a.total;
      if (sort === "balance") return b.balance - a.balance;
      return b.issueMs - a.issueMs; // newest
    });
    return out;
  }, [rows, q, status, client, sort]);

  const outstanding = filtered.reduce((s, r) => s + r.balance, 0);
  const cur = rows[0]?.currency ?? "KES";

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="card p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative flex-1 sm:min-w-[220px]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted">
              <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" />
            </svg>
            <input
              className="input pl-9"
              placeholder="Search number or client…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select className="input sm:w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s] ?? s[0].toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <select className="input sm:w-auto" value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="all">All clients</option>
            {clients.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select className="input sm:w-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="total">Highest total</option>
            <option value="balance">Highest balance</option>
          </select>
          {(q || status !== "all" || client !== "all") && (
            <button
              type="button"
              onClick={() => { setQ(""); setStatus("all"); setClient("all"); }}
              className="text-sm font-medium text-brand-700 hover:underline sm:ml-1"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-muted">
        <span>Showing {filtered.length} of {rows.length}</span>
        <span>Outstanding: <b className="text-ink tabular-nums">{formatMoney(outstanding, cur)}</b></span>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.map((r) => (
          <div key={r.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/invoices/${r.id}`} className="min-w-0 flex-1">
                <p className="font-bold text-ink">{r.number}</p>
                <p className="truncate text-sm text-muted">{r.client}</p>
                <p className="mt-0.5 text-xs text-muted">{r.date}</p>
              </Link>
              <div className="flex flex-col items-end gap-1">
                <p className="font-bold text-ink tabular-nums">{formatMoney(r.total, r.currency)}</p>
                <StatusBadge status={r.status} />
              </div>
            </div>
            {r.balance > 0 && (
              <p className="mt-2 text-xs text-muted">
                Balance due <b className="text-ink tabular-nums">{formatMoney(r.balance, r.currency)}</b>
              </p>
            )}
            <div className="mt-2 flex justify-end border-t border-line pt-2">
              <InvoiceRowActions id={r.id} shareToken={r.shareToken} canPay={r.balance > 0 && r.status !== "void"} label={r.number} />
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="card p-6 text-center text-sm text-muted">No invoices match your filters.</div>
        )}
      </div>

      {/* Desktop: table */}
      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Number</th>
              <th className="th">Client</th>
              <th className="th">Date</th>
              <th className="th">Status</th>
              <th className="th text-right">Total</th>
              <th className="th text-right">Balance</th>
              <th className="th text-right">Received</th>
              <th className="th w-12 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-canvas">
                <td className="td font-medium">
                  <Link href={`/invoices/${r.id}`} className="hover:text-brand-700">{r.number}</Link>
                </td>
                <td className="td">{r.client}</td>
                <td className="td whitespace-nowrap text-muted">{r.date}</td>
                <td className="td"><StatusBadge status={r.status} /></td>
                <td className="td text-right tabular-nums">{formatMoney(r.total, r.currency)}</td>
                <td className="td text-right tabular-nums">{r.balance > 0 ? formatMoney(r.balance, r.currency) : "—"}</td>
                <td className="td text-right tabular-nums text-muted">{r.received > 0 ? formatMoney(r.received, r.currency) : "—"}</td>
                <td className="td">
                  <InvoiceRowActions id={r.id} shareToken={r.shareToken} canPay={r.balance > 0 && r.status !== "void"} label={r.number} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td className="td text-muted" colSpan={8}>No invoices match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
