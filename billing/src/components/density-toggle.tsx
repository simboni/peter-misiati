"use client";

import { useEffect, useState } from "react";

type Density = "comfortable" | "compact";

const OPTIONS: { id: Density; label: string; path: string }[] = [
  // three widely-spaced rows
  { id: "comfortable", label: "Comfortable", path: "M3 6h18M3 12h18M3 18h18" },
  // five tight rows
  { id: "compact", label: "Compact", path: "M3 5h18M3 9h18M3 13h18M3 17h18M3 21h18" },
];

/**
 * Row density. Mirrors ThemeToggle: sets an attribute on <html>, persists the
 * choice, and a script in the root layout applies it before first paint so the
 * layout does not visibly reflow.
 *
 * Spacing only — see globals.css. Shrinking type to fit more rows just makes a
 * dense table harder to read, which defeats the point.
 */
export function DensityToggle({ className = "" }: { className?: string }) {
  const [density, setDensity] = useState<Density>("comfortable");

  useEffect(() => {
    const d = (document.documentElement.getAttribute("data-density") as Density) || "comfortable";
    setDensity(d);
  }, []);

  const pick = (d: Density) => {
    document.documentElement.setAttribute("data-density", d);
    try {
      localStorage.setItem("tp:density", d);
    } catch {
      /* private mode — the preference just won't persist */
    }
    setDensity(d);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Row density"
      className={`inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 ${className}`}
    >
      {OPTIONS.map((o) => {
        const active = density === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.label}
            onClick={() => pick(o.id)}
            className={`grid h-7 w-7 place-items-center rounded-md transition-colors ${
              active ? "bg-brand-600 text-white" : "text-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              className="h-4 w-4"
            >
              <path d={o.path} />
            </svg>
            <span className="sr-only">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
