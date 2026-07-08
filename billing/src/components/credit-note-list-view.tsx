"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/server/money";
import { deleteCreditNoteAction } from "@/server/actions/credit-notes";

type Row = {
  id: string;
  number: string;
  date: string;
  client: string;
  invoiceNumber: string;
  reason: string;
  total: number;
  currency: string;
  refunded: boolean;
  applied: boolean;
};

export function CreditNoteListView({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return rows;
    return rows.filter((r) => `${r.number} ${r.client} ${r.invoiceNumber} ${r.reason}`.toLowerCase().includes(n));
  }, [rows, q]);

  const total = filtered.reduce((s, r) => s + r.total, 0);
  const cur = rows[0]?.currency ?? "KES";

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <div className="relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" />
          </svg>
          <input className="input pl-9" placeholder="Search number, client, invoice or reason…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-muted">
        <span>Showing {filtered.length} of {rows.length}</span>
        <span>Total credited: <b className="text-ink tabular-nums">{formatMoney(total, cur)}</b></span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Number</th>
              <th className="th">Date</th>
              <th className="th">Client</th>
              <th className="th">Against</th>
              <th className="th">Reason</th>
              <th className="th text-right">Amount</th>
              <th className="th w-20 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-canvas">
                <td className="td"><Link href={`/credit-notes/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.number}</Link></td>
                <td className="td whitespace-nowrap text-muted">{r.date}</td>
                <td className="td">{r.client}</td>
                <td className="td text-muted">{r.invoiceNumber || "—"}</td>
                <td className="td">
                  <span className="text-ink">{r.reason || "—"}</span>
                  {r.refunded && <span className="badge ml-2 bg-slate-100 text-slate-600">refunded</span>}
                  {r.applied && <span className="badge ml-2 bg-emerald-50 text-emerald-700">applied</span>}
                </td>
                <td className="td text-right font-medium tabular-nums">− {formatMoney(r.total, r.currency)}</td>
                <td className="td">
                  <div className="flex items-center justify-end gap-1">
                    <Link href={`/credit-notes/${r.id}/edit`} className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">Edit</Link>
                    <form action={deleteCreditNoteAction} onSubmit={(e) => { if (!confirm("Delete this credit note? Any linked invoice balance is restored.")) e.preventDefault(); }}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-red-50 hover:text-red-600">Delete</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td className="td text-muted" colSpan={7}>No credit notes match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
