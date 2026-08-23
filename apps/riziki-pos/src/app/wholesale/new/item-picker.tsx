"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatKes } from "@/lib/units";

export interface PickItem {
  id: number;
  name: string;
  kind: string;
  wholesaleCents: number;
  retailCents: number;
}

/**
 * Choosing one item out of fifty-eight.
 *
 * A native `<select>` was the wrong instrument: it holds every finished product
 * and every repacked chemical in one scroll, and the counter knows the name it
 * wants long before it can find it in that list. So this is a search box that
 * happens to be a picker — type three letters, press Enter.
 *
 * Products and chemicals are deliberately in the same list rather than behind a
 * pair of tabs. On the till they are separate boards because the counter is
 * browsing; here somebody is building a line on a document and already knows
 * what they are looking for, so making them first decide which half it lives in
 * is a question with no purpose. The kind is shown as a label instead.
 *
 * Matching is on the whole string, so "sles" finds "Ungerol" through its search
 * column upstream, and "20" finds every 20 kg pack.
 */
export default function ItemPicker({
  items,
  value,
  onChange,
  label,
}: {
  items: PickItem[];
  value: number;
  onChange: (itemId: number) => void;
  label: string;
}) {
  const chosen = items.find((i) => i.id === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  // Clicking anywhere else is the ordinary way to abandon a dropdown.
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
    if (!q) return items.slice(0, 40);
    const words = q.split(/\s+/);
    return items
      .filter((i) => {
        const hay = `${i.name} ${i.kind}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 40);
  }, [items, query]);

  function choose(item: PickItem) {
    onChange(item.id);
    setQuery("");
    setOpen(false);
  }

  const price = (i: PickItem) => (i.wholesaleCents > 0 ? i.wholesaleCents : i.retailCents);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setActive(0);
        }}
        aria-label={label}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-line bg-white px-3 text-left text-sm font-semibold text-ink"
      >
        <span className={`min-w-0 flex-1 truncate ${chosen ? "" : "text-muted"}`}>
          {chosen ? chosen.name : "Search for an item…"}
        </span>
        <span aria-hidden className="shrink-0 text-muted">
          ▾
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-line bg-white shadow-lift">
          <input
            autoFocus
            className="w-full border-b border-line px-3 py-2.5 text-sm outline-none"
            placeholder="Type a name — salt, 20 kg, shampoo…"
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
                if (matches[active]) choose(matches[active]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            aria-label="Search items"
          />

          <ul className="max-h-72 overflow-y-auto">
            {matches.length ? (
              matches.map((i, k) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(k)}
                    onClick={() => choose(i)}
                    className={`flex w-full items-baseline gap-2 px-3 py-2 text-left ${
                      k === active ? "bg-brand-soft" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">
                      {i.name}
                    </span>
                    <span className="shrink-0 rounded px-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                      {i.kind === "finished" ? "product" : "chemical"}
                    </span>
                    <span className="shrink-0 text-[12px] font-bold text-brand-dark tnum">
                      {formatKes(price(i))}
                    </span>
                  </button>
                </li>
              ))
            ) : (
              <li className="px-3 py-4 text-center text-sm text-muted">
                Nothing matches “{query}”.
              </li>
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
