"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface PickCustomer {
  id: number;
  name: string;
  phone: string;
  kind: string;
}

/**
 * One field for "who is this for".
 *
 * There were two — a dropdown of people on the books and a free-text name for
 * everyone else — and between them they asked the counter to understand a
 * distinction the counter does not care about. At the moment a quote is raised
 * the only question is whose name goes on it; whether that person already has a
 * record is the app's problem, not theirs.
 *
 * So: type a name. If it matches somebody, pick them and the quote is attached
 * to their account. If it does not, the name is used as typed, and a record is
 * written later only if the bill actually goes on credit — which is the first
 * moment the shop genuinely needs one.
 */
export default function CustomerPicker({
  customers,
  customerId,
  customerName,
  onPick,
}: {
  customers: PickCustomer[];
  customerId: number | null;
  customerName: string;
  onPick: (id: number | null, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers.slice(0, 30);
    return customers.filter((c) => `${c.name} ${c.phone}`.toLowerCase().includes(q)).slice(0, 30);
  }, [customers, query]);

  const chosen = customers.find((c) => c.id === customerId);
  const typed = query.trim();
  // Offering to use the typed name only makes sense when it is not simply one
  // of the names already on the list.
  const isNew =
    typed.length > 1 && !customers.some((c) => c.name.toLowerCase() === typed.toLowerCase());

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setActive(0);
        }}
        aria-expanded={open}
        aria-label="Customer"
        className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-line bg-white px-3 text-left text-sm font-semibold"
      >
        <span className={`min-w-0 flex-1 truncate ${customerName ? "text-ink" : "text-muted"}`}>
          {customerName || "Search or type a name…"}
        </span>
        {chosen ? null : customerName ? (
          <span className="shrink-0 rounded px-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
            new
          </span>
        ) : null}
        <span aria-hidden className="shrink-0 text-muted">
          ▾
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-line bg-white shadow-lift">
          <input
            autoFocus
            className="w-full border-b border-line px-3 py-2.5 text-sm outline-none"
            placeholder="Name or phone…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, matches.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (matches[active]) {
                  onPick(matches[active].id, matches[active].name);
                } else if (isNew) {
                  onPick(null, typed);
                }
                setQuery("");
                setOpen(false);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            aria-label="Search customers"
          />

          <ul className="max-h-64 overflow-y-auto">
            {isNew ? (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onPick(null, typed);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="flex w-full items-baseline gap-2 border-b border-line px-3 py-2.5 text-left"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-brand-dark">
                    Use “{typed}”
                  </span>
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted">
                    not on the books
                  </span>
                </button>
              </li>
            ) : null}

            {matches.map((c, k) => (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(k)}
                  onClick={() => {
                    onPick(c.id, c.name);
                    setQuery("");
                    setOpen(false);
                  }}
                  className={`flex w-full items-baseline gap-2 px-3 py-2 text-left ${
                    k === active ? "bg-brand-soft" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">
                    {c.name}
                  </span>
                  {c.phone ? (
                    <span className="shrink-0 text-[11px] text-muted tnum">{c.phone}</span>
                  ) : null}
                  {c.kind === "wholesale" ? (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted">
                      wholesale
                    </span>
                  ) : null}
                </button>
              </li>
            ))}

            {!matches.length && !isNew ? (
              <li className="px-3 py-4 text-center text-sm text-muted">Nobody matches.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
