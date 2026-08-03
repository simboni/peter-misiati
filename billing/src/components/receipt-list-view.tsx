"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/server/money";

type Row = {
  id: string;
  number: string;
  date: string;
  paidMs: number;
  client: string;
  invoiceId: string | null;
  invoiceNumber: string;
  method: string;
  methodLabel: string;
  kind: string;
  amount: number;
  currency: string;
  shareToken: string;
};

export function ReceiptListView({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [method, setMethod] = useState("all");

  const methods = useMemo(
    () => Array.from(new Map(rows.map((r) => [r.method, r.methodLabel])).entries()),
    [rows],
  );

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (method !== "all" && r.method !== method) return false;
      if (n && !`${r.number} ${r.client} ${r.invoiceNumber}`.toLowerCase().includes(n)) return false;
      return true;
    });
  }, [rows, q, method]);

  const total = filtered.reduce((s, r) => s + r.amount, 0);
  const cur = rows[0]?.currency ?? "KES";

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted">
              <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" />
            </svg>
            <input className="input pl-9" placeholder="Search receipt, client or invoice…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input sm:w-auto" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="all">All methods</option>
            {methods.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-muted">
        <span>Showing {filtered.length} of {rows.length}</span>
        <span>Total received: <b className="text-ink tabular-nums">{formatMoney(total, cur)}</b></span>
      </div>

      <div className="space-y-2.5 md:hidden">
        {filtered.map((r) => (
          <div key={r.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-ink">{r.number}</p>
                <p className="truncate text-sm text-muted">{r.client}</p>
                <p className="mt-0.5 text-xs text-muted">{r.date}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <p className="font-bold text-ink tabular-nums">{formatMoney(r.amount, r.currency)}</p>
                <span className="text-xs text-muted">{r.methodLabel}</span>
              </div>
            </div>
            <div className="mt-2 flex justify-end gap-3 border-t border-line pt-2 text-sm">
              {r.invoiceId ? <Link href={`/invoices/${r.invoiceId}`} className="text-brand-700 hover:underline">{r.invoiceNumber}</Link> : "—"}
              <Link href={`/d/${r.shareToken}`} target="_blank" className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">View</Link>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="card p-6 text-center text-sm text-muted">No receipts match your filters.</div>
        )}
      </div>

      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Receipt</th>
              <th className="th">Date</th>
              <th className="th">Client</th>
              <th className="th">Invoice</th>
              <th className="th">Method</th>
              <th className="th text-right">Amount</th>
              <th className="th w-16 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-canvas">
                <td className="td font-medium">{r.number}</td>
                <td className="td whitespace-nowrap text-muted">{r.date}</td>
                <td className="td">{r.client}</td>
                <td className="td">
                  {r.invoiceId ? <Link href={`/invoices/${r.invoiceId}`} className="text-brand-700 hover:underline">{r.invoiceNumber}</Link> : "—"}
                </td>
                <td className="td text-muted">{r.methodLabel} <span className="text-xs capitalize">({r.kind})</span></td>
                <td className="td text-right font-medium tabular-nums">{formatMoney(r.amount, r.currency)}</td>
                <td className="td text-right">
                  <Link href={`/d/${r.shareToken}`} target="_blank" className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">View</Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td className="td text-muted" colSpan={7}>No receipts match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
