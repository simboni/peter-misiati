"use client";

import { useEffect, useState } from "react";

/**
 * Single-button theme toggle — each press cycles Light → Dark → Midnight.
 * The icon shows the CURRENT theme (sun / moon / moon-with-stars).
 * The choice is stored in localStorage ("smp-theme") and applied as
 * data-theme on <html>; an inline script in the root layout applies it
 * before first paint so there's no flash of the wrong theme.
 */

const ORDER = ["light", "dark", "midnight"] as const;
type ThemeId = (typeof ORDER)[number];

const LABEL: Record<ThemeId, string> = {
  light: "Light",
  dark: "Dark",
  midnight: "Midnight",
};

function applyTheme(id: ThemeId) {
  const root = document.documentElement;
  if (id === "light") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", id);
  try {
    localStorage.setItem("smp-theme", id);
  } catch {
    /* private mode — theme still applies for this visit */
  }
}

function ThemeIcon({ theme }: { theme: ThemeId }) {
  if (theme === "light") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M19 12.79A7.5 7.5 0 1 1 10.71 4.5 5.83 5.83 0 0 0 19 12.79z" />
      <path d="M17.5 4.5h.01M20.5 8h.01M20 3l.5 1.5L22 5l-1.5.5L20 7l-.5-1.5L18 5l1.5-.5L20 3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ThemeSwitcher({ className = "" }: { className?: string }) {
  const [active, setActive] = useState<ThemeId>("light");

  // Read whatever the pre-paint script applied.
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "dark" || current === "midnight") setActive(current);
  }, []);

  const next = ORDER[(ORDER.indexOf(active) + 1) % ORDER.length];

  return (
    <button
      type="button"
      onClick={() => {
        setActive(next);
        applyTheme(next);
      }}
      title={`Theme: ${LABEL[active]} — switch to ${LABEL[next]}`}
      aria-label={`Theme: ${LABEL[active]}. Switch to ${LABEL[next]}`}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-600 bg-ink-800 text-mist-300 transition-colors hover:border-green-400/60 hover:text-green-400 ${className}`}
    >
      <ThemeIcon theme={active} />
    </button>
  );
}
