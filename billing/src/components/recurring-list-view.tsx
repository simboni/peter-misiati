"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/server/money";
import { setRecurringStatusAction, deleteRecurringAction } from "@/server/actions/recurring";

type Row = {
  id: string;
  label: string;
  client: string;
  frequencyLabel: string;
  status: string; // active | paused | ended
  nextRun: string;
  nextRunMs: number;
  total: number;
  currency: string;
};

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-700",
  ended: "bg-slate-100 text-slate-500",
};

export function RecurringListView({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (n && !`${r.label} ${r.client}`.toLowerCase().includes(n)) return false;
      return true;
    });
  }, [rows, q, status]);

  const cur = rows[0]?.currency ?? "KES";
  const activeValue = filtered.filter((r) => r.status === "active").reduce((s, r) => s + r.total, 0);

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted">
              <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" />
            </svg>
            <input className="input pl-9" placeholder="Search label or client…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input sm:w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="ended">Ended</option>
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-muted">
        <span>Showing {filtered.length} of {rows.length}</span>
        <span>Active recurring value: <b className="text-ink tabular-nums">{formatMoney(activeValue, cur)}</b></span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Schedule</th>
              <th className="th">Client</th>
              <th className="th">Repeats</th>
              <th className="th">Next invoice</th>
              <th className="th text-right">Amount</th>
              <th className="th">Status</th>
              <th className="th w-28 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-canvas">
                <td className="td font-medium text-ink">{r.label}</td>
                <td className="td">{r.client}</td>
                <td className="td text-muted">{r.frequencyLabel}</td>
                <td className="td whitespace-nowrap text-muted">{r.status === "ended" ? "—" : r.nextRun}</td>
                <td className="td text-right font-medium tabular-nums">{formatMoney(r.total, r.currency)}</td>
                <td className="td">
                  <span className={`badge ${STATUS_STYLE[r.status] ?? "bg-slate-100 text-slate-500"}`}>{r.status}</span>
                </td>
                <td className="td">
                  <div className="flex items-center justify-end gap-1">
                    <Link href={`/recurring/${r.id}/edit`} className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">Edit</Link>
                    {r.status !== "ended" && (
                      <form action={setRecurringStatusAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="status" value={r.status === "active" ? "paused" : "active"} />
                        <button className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">
                          {r.status === "active" ? "Pause" : "Resume"}
                        </button>
                      </form>
                    )}
                    <form action={deleteRecurringAction} onSubmit={(e) => { if (!confirm("Delete this schedule? Invoices already created are kept.")) e.preventDefault(); }}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-red-50 hover:text-red-600">Delete</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td className="td text-muted" colSpan={7}>No schedules match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
