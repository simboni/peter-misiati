"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { deleteClientAction } from "@/server/actions/clients";

type Row = {
  id: string;
  name: string;
  contact: string;
  kraPin: string;
  currency: string;
};

export function ClientListView({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return rows;
    return rows.filter((r) => `${r.name} ${r.contact} ${r.kraPin}`.toLowerCase().includes(n));
  }, [rows, q]);

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <div className="relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" />
          </svg>
          <input className="input pl-9" placeholder="Search name, contact or KRA PIN…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="px-1 text-xs text-muted">Showing {filtered.length} of {rows.length}</div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Name</th>
              <th className="th">Contact</th>
              <th className="th">KRA PIN</th>
              <th className="th">Currency</th>
              <th className="th w-24 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((c) => (
              <tr key={c.id} className="hover:bg-canvas">
                <td className="td font-medium"><Link href={`/clients/${c.id}`} className="hover:text-brand-700">{c.name}</Link></td>
                <td className="td text-muted">{c.contact || "—"}</td>
                <td className="td text-muted">{c.kraPin || "—"}</td>
                <td className="td text-muted">{c.currency}</td>
                <td className="td">
                  <div className="flex items-center justify-end gap-1">
                    <Link href={`/clients/${c.id}`} className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">Edit</Link>
                    <form action={deleteClientAction} onSubmit={(e) => { if (!confirm("Delete this client?")) e.preventDefault(); }}>
                      <input type="hidden" name="id" value={c.id} />
                      <button className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-red-50 hover:text-red-600">Delete</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td className="td text-muted" colSpan={5}>No clients match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
