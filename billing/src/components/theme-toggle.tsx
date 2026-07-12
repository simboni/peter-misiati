"use client";

import { useEffect, useState } from "react";

type ThemeId = "light" | "dark" | "midnight";

const THEMES: { id: ThemeId; label: string; path: string }[] = [
  // sun
  { id: "light", label: "Light", path: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z" },
  // moon
  { id: "dark", label: "Dark", path: "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" },
  // stars
  { id: "midnight", label: "Midnight", path: "M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z" },
];

/** Light / Dark / Midnight theme switcher. Applies data-theme on <html> and
 *  persists the choice; a no-flash script in the root layout applies it early. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeId>("light");

  useEffect(() => {
    const t = (document.documentElement.getAttribute("data-theme") as ThemeId) || "light";
    setTheme(t);
  }, []);

  const pick = (t: ThemeId) => {
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem("tp:theme", t);
    } catch {
      /* ignore */
    }
    setTheme(t);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={`inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 ${className}`}
    >
      {THEMES.map((t) => {
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={t.label}
            onClick={() => pick(t.id)}
            className={`grid h-7 w-7 place-items-center rounded-md transition-colors ${
              active ? "bg-brand-600 text-white" : "text-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d={t.path} />
            </svg>
            <span className="sr-only">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
