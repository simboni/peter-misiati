"use client";

import { useState } from "react";

/**
 * A card whose body collapses/expands from a tappable header. Used on the
 * dashboard so Recent invoices and Top clients can be folded away.
 */
export function Collapsible({
  title,
  meta,
  defaultOpen = true,
  bodyClassName = "",
  children,
}: {
  title: string;
  meta?: string;
  defaultOpen?: boolean;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
      >
        <span className="flex items-baseline gap-2">
          <span className="font-semibold text-ink">{title}</span>
          {meta && <span className="text-xs text-muted">{meta}</span>}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-5 w-5 flex-none text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className={`border-t border-line ${bodyClassName}`}>{children}</div>}
    </div>
  );
}
