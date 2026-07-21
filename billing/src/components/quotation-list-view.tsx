"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/server/money";
import { StatusBadge } from "./status-badge";
import { InvoiceRowActions } from "./invoice-row-actions";

type Row = {
  id: string;
  number: string;
  status: string;
  date: string;
  issueMs: number;
  total: number;
  currency: string;
  client: string;
  shareToken: string;
};

export function QuotationListView({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("newest");

  const statuses = useMemo(() => Array.from(new Set(rows.map((r) => r.status))).sort(), [rows]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (n && !`${r.number} ${r.client}`.toLowerCase().includes(n)) return false;
      return true;
    });
    out.sort((a, b) =>
      sort === "oldest" ? a.issueMs - b.issueMs : sort === "amount" ? b.total - a.total : b.issueMs - a.issueMs,
    );
    return out;
  }, [rows, q, status, sort]);

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted">
              <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" />
            </svg>
            <input className="input pl-9" placeholder="Search number or client…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input sm:w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            {statuses.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
          </select>
          <select className="input sm:w-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="amount">Highest amount</option>
          </select>
        </div>
      </div>

      <div className="px-1 text-xs text-muted">Showing {filtered.length} of {rows.length}</div>

      <div className="space-y-2.5 md:hidden">
        {filtered.map((r) => (
          <div key={r.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/quotations/${r.id}`} className="min-w-0 flex-1">
                <p className="font-bold text-ink">{r.number}</p>
                <p className="truncate text-sm text-muted">{r.client}</p>
                <p className="mt-0.5 text-xs text-muted">{r.date}</p>
              </Link>
              <div className="flex flex-col items-end gap-1">
                <p className="font-bold text-ink tabular-nums">{formatMoney(r.total, r.currency)}</p>
                <StatusBadge status={r.status} />
              </div>
            </div>
            <div className="mt-2 flex justify-end border-t border-line pt-2">
              <InvoiceRowActions id={r.id} shareToken={r.shareToken} canPay={false} kind="quotation" label={r.number} />
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="card p-6 text-center text-sm text-muted">No quotations match your filters.</div>
        )}
      </div>

      <div className="card overflow-x-auto hidden md:block">
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Number</th>
              <th className="th">Client</th>
              <th className="th">Date</th>
              <th className="th">Status</th>
              <th className="th text-right">Total</th>
              <th className="th w-12 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-canvas">
                <td className="td font-medium"><Link href={`/quotations/${r.id}`} className="hover:text-brand-700">{r.number}</Link></td>
                <td className="td">{r.client}</td>
                <td className="td whitespace-nowrap text-muted">{r.date}</td>
                <td className="td"><StatusBadge status={r.status} /></td>
                <td className="td text-right tabular-nums">{formatMoney(r.total, r.currency)}</td>
                <td className="td"><InvoiceRowActions id={r.id} shareToken={r.shareToken} canPay={false} kind="quotation" label={r.number} /></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td className="td text-muted" colSpan={6}>No quotations match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
