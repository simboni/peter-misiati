"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "./status-badge";
import { deleteDeliveryNoteAction } from "@/server/actions/delivery-notes";

type Row = {
  id: string;
  number: string;
  status: string;
  date: string;
  dateMs: number;
  client: string;
  shareToken: string;
};

export function DeliveryNoteListView({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");

  const statuses = useMemo(() => Array.from(new Set(rows.map((r) => r.status))).sort(), [rows]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (n && !`${r.number} ${r.client}`.toLowerCase().includes(n)) return false;
      return true;
    });
  }, [rows, q, status]);

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
        </div>
      </div>

      <div className="px-1 text-xs text-muted">Showing {filtered.length} of {rows.length}</div>

      <div className="space-y-2.5 md:hidden">
        {filtered.map((r) => (
          <div key={r.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/delivery-notes/${r.id}`} className="min-w-0 flex-1">
                <div className="font-bold text-ink">{r.number}</div>
                <div className="truncate text-sm text-muted">{r.client}</div>
                <div className="mt-0.5 text-xs text-muted">{r.date}</div>
              </Link>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={r.status} />
              </div>
            </div>
            <div className="mt-2 flex justify-end gap-1 border-t border-line pt-2">
              <a href={`/d/${r.shareToken}`} target="_blank" rel="noreferrer" className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">View</a>
              <Link href={`/delivery-notes/${r.id}/edit`} className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">Edit</Link>
              <form action={deleteDeliveryNoteAction} onSubmit={(e) => { if (!confirm("Delete this delivery note?")) e.preventDefault(); }}>
                <input type="hidden" name="id" value={r.id} />
                <button className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-red-50 hover:text-red-600">Delete</button>
              </form>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="card p-6 text-center text-sm text-muted">No delivery notes match your filters.</div>
        )}
      </div>

      <div className="card overflow-x-auto hidden md:block">
        <table className="w-full min-w-[560px]">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Number</th>
              <th className="th">Client</th>
              <th className="th">Date</th>
              <th className="th">Status</th>
              <th className="th w-28 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-canvas">
                <td className="td font-medium"><Link href={`/delivery-notes/${r.id}`} className="hover:text-brand-700">{r.number}</Link></td>
                <td className="td">{r.client}</td>
                <td className="td whitespace-nowrap text-muted">{r.date}</td>
                <td className="td"><StatusBadge status={r.status} /></td>
                <td className="td">
                  <div className="flex items-center justify-end gap-1">
                    <a href={`/d/${r.shareToken}`} target="_blank" rel="noreferrer" className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">View</a>
                    <Link href={`/delivery-notes/${r.id}/edit`} className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">Edit</Link>
                    <form action={deleteDeliveryNoteAction} onSubmit={(e) => { if (!confirm("Delete this delivery note?")) e.preventDefault(); }}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-red-50 hover:text-red-600">Delete</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td className="td text-muted" colSpan={5}>No delivery notes match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
