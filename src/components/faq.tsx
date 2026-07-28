"use client";

import { useState } from "react";

export type FaqItem = { q: string; a: string };

/** Accessible accordion built on native <details>/<summary>. */
export function Faq({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="divide-y divide-ink-600 overflow-hidden rounded-2xl border border-ink-600 bg-ink-800">
      {items.map((item, i) => {
        const open = openIndex === i;
        return (
          <details
            key={item.q}
            open={open}
            className="group"
            onToggle={(e) => {
              if ((e.target as HTMLDetailsElement).open) setOpenIndex(i);
              else if (open) setOpenIndex(null);
            }}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-left text-sm font-semibold text-mist-100 transition-colors hover:bg-ink-850 [&::-webkit-details-marker]:hidden">
              {item.q}
              <span
                aria-hidden
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-ink-500 text-mist-400 transition-transform ${
                  open ? "rotate-45" : ""
                }`}
              >
                +
              </span>
            </summary>
            <p className="px-6 pb-5 text-sm leading-relaxed text-mist-400">{item.a}</p>
          </details>
        );
      })}
    </div>
  );
}
