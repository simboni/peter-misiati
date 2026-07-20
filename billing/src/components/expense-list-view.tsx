"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/server/money";
import { deleteExpenseAction } from "@/server/actions/expenses";

type Row = {
  id: string;
  date: string;
  issueMs: number;
  category: string;
  payee: string;
  description: string;
  amount: number;
  currency: string;
};

export function ExpenseListView({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");

  const cats = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category).filter((c) => c && c !== "—"))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (cat !== "all" && r.category !== cat) return false;
      if (n && !`${r.description} ${r.payee} ${r.category}`.toLowerCase().includes(n)) return false;
      return true;
    });
  }, [rows, q, cat]);

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
            <input className="input pl-9" placeholder="Search description, payee or category…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input sm:w-auto" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">All categories</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-muted">
        <span>Showing {filtered.length} of {rows.length}</span>
        <span>Total: <b className="text-ink tabular-nums">{formatMoney(total, cur)}</b></span>
      </div>

      <div className="space-y-2.5 md:hidden">
        {filtered.map((r) => (
          <div key={r.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-bold text-ink">{r.payee || "—"}</div>
                <div className="truncate text-sm text-muted">{r.description}</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xs text-muted">{r.date}</span>
                  {r.category && r.category !== "—" ? (
                    <span className="badge bg-slate-100 text-slate-600">{r.category}</span>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="font-bold text-ink tabular-nums">{formatMoney(r.amount, r.currency)}</div>
              </div>
            </div>
            <div className="mt-2 flex justify-end gap-1 border-t border-line pt-2">
              <Link href={`/expenses/${r.id}/edit`} className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">Edit</Link>
              <form action={deleteExpenseAction} onSubmit={(e) => { if (!confirm("Delete this expense?")) e.preventDefault(); }}>
                <input type="hidden" name="id" value={r.id} />
                <button className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-red-50 hover:text-red-600">Delete</button>
              </form>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="card p-6 text-center text-sm text-muted">No expenses match your filters.</div>
        )}
      </div>

      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full min-w-[680px]">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Date</th>
              <th className="th">Paid to</th>
              <th className="th">Category</th>
              <th className="th">Description</th>
              <th className="th text-right">Amount</th>
              <th className="th w-20 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-canvas">
                <td className="td whitespace-nowrap text-muted">{r.date}</td>
                <td className="td">{r.payee || "—"}</td>
                <td className="td">
                  {r.category && r.category !== "—" ? (
                    <span className="badge bg-slate-100 text-slate-600">{r.category}</span>
                  ) : "—"}
                </td>
                <td className="td">{r.description}</td>
                <td className="td text-right font-medium tabular-nums">{formatMoney(r.amount, r.currency)}</td>
                <td className="td">
                  <div className="flex items-center justify-end gap-1">
                    <Link href={`/expenses/${r.id}/edit`} className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">Edit</Link>
                    <form action={deleteExpenseAction} onSubmit={(e) => { if (!confirm("Delete this expense?")) e.preventDefault(); }}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-red-50 hover:text-red-600">Delete</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td className="td text-muted" colSpan={6}>No expenses match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
