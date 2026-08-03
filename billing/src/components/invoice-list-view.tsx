"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { formatMoney } from "@/server/money";
import { StatusBadge } from "./status-badge";
import { InvoiceRowActions } from "./invoice-row-actions";

type Row = {
  id: string;
  number: string;
  client: string;
  date: string;
  status: string;
  total: number;
  balance: number;
  received: number;
  currency: string;
  shareToken: string;
};

type Filters = { q: string; status: string; client: string; sort: string };

const STATUSES = ["all", "draft", "sent", "partial", "paid", "overdue", "void"];
const STATUS_LABELS: Record<string, string> = { all: "All statuses", partial: "Part-paid" };

export function InvoiceListView({
  rows,
  clients,
  total,
  outstanding,
  page,
  pageSize,
  filters,
}: {
  rows: Row[];
  clients: { id: string; name: string }[];
  total: number;
  outstanding: number;
  page: number;
  pageSize: number;
  filters: Filters;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  // Local mirror of the URL filters so inputs feel instant; the server query is
  // the source of truth and runs as we navigate.
  const [q, setQ] = useState(filters.q);
  const [status, setStatus] = useState(filters.status);
  const [client, setClient] = useState(filters.client);
  const [sort, setSort] = useState(filters.sort);

  // Keep local state in sync if the user navigates back/forward.
  useEffect(() => {
    setQ(filters.q);
    setStatus(filters.status);
    setClient(filters.client);
    setSort(filters.sort);
  }, [filters.q, filters.status, filters.client, filters.sort]);

  function navigate(next: Partial<Filters & { page: number }>) {
    const merged = { q, status, client, sort, page: 1, ...next };
    const params = new URLSearchParams();
    if (merged.q) params.set("q", merged.q);
    if (merged.status && merged.status !== "all") params.set("status", merged.status);
    if (merged.client && merged.client !== "all") params.set("client", merged.client);
    if (merged.sort && merged.sort !== "newest") params.set("sort", merged.sort);
    if (merged.page && merged.page > 1) params.set("page", String(merged.page));
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  // Debounce the free-text search so we don't navigate on every keystroke.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onSearch(value: string) {
    setQ(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => navigate({ q: value, page: 1 }), 350);
  }

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const cur = rows[0]?.currency ?? "KES";
  const anyFilter = q !== "" || status !== "all" || client !== "all";

  return (
    <div className={`space-y-3 ${pending ? "opacity-60 transition-opacity" : ""}`}>
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
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
          <select className="input sm:w-auto" value={status} onChange={(e) => { setStatus(e.target.value); navigate({ status: e.target.value, page: 1 }); }}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s] ?? s[0].toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <select className="input sm:w-auto" value={client} onChange={(e) => { setClient(e.target.value); navigate({ client: e.target.value, page: 1 }); }}>
            <option value="all">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select className="input sm:w-auto" value={sort} onChange={(e) => { setSort(e.target.value); navigate({ sort: e.target.value, page: 1 }); }}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="total">Highest total</option>
            <option value="balance">Highest balance</option>
          </select>
          {anyFilter && (
            <button
              type="button"
              onClick={() => { setQ(""); setStatus("all"); setClient("all"); navigate({ q: "", status: "all", client: "all", page: 1 }); }}
              className="text-sm font-medium text-brand-700 hover:underline sm:ml-1"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-muted">
        <span>{total === 0 ? "No matches" : `Showing ${start}–${end} of ${total}`}</span>
        <span>Outstanding{anyFilter ? " (filtered)" : ""}: <b className="text-ink tabular-nums">{formatMoney(outstanding, cur)}</b></span>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-2.5 md:hidden">
        {rows.map((r) => (
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
        {rows.length === 0 && (
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
            {rows.map((r) => (
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
            {rows.length === 0 && (
              <tr><td className="td text-muted" colSpan={8}>No invoices match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pager */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1 pt-1">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => navigate({ page: page - 1 })}
            className="btn-ghost px-4 py-2 text-sm disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="text-xs text-muted">Page {page} of {totalPages}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => navigate({ page: page + 1 })}
            className="btn-ghost px-4 py-2 text-sm disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
