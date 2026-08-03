"use client";

import { useState } from "react";

type Item = { title: string; meta?: string; bodyClassName?: string; content: React.ReactNode };

/**
 * Single-open accordion of cards. All panels start closed; opening one closes
 * any other. Renders each item's `content` directly (no React.Children helpers),
 * which is the pattern that renders reliably in the Workers runtime.
 */
export function Accordion({ items, defaultOpen = null }: { items: Item[]; defaultOpen?: number | null }) {
  const [open, setOpen] = useState<number | null>(defaultOpen);
  return (
    <div className="space-y-4">
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <div key={i} className="card overflow-hidden">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
            >
              <span className="flex items-baseline gap-2">
                <span className="font-semibold text-ink">{it.title}</span>
                {it.meta && <span className="text-xs text-muted">{it.meta}</span>}
              </span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`h-5 w-5 flex-none text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {isOpen && <div className={`border-t border-line ${it.bodyClassName ?? ""}`}>{it.content}</div>}
          </div>
        );
      })}
    </div>
  );
}
