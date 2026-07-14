"use client";

import { useEffect, useState } from "react";

/**
 * Three-theme selector — Dark (default), Light, Midnight.
 * The choice is stored in localStorage ("smp-theme") and applied as
 * data-theme on <html>; an inline script in the root layout applies it
 * before first paint so there's no flash of the wrong theme.
 */

const THEMES = [
  { id: "dark", label: "Dark", swatch: "#0a0f0c", accent: "#2ee88a" },
  { id: "light", label: "Light", swatch: "#f6f8f6", accent: "#0a9d61" },
  { id: "midnight", label: "Midnight", swatch: "#060b16", accent: "#3fb2ff" },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];

function applyTheme(id: ThemeId) {
  const root = document.documentElement;
  if (id === "dark") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", id);
  try {
    localStorage.setItem("smp-theme", id);
  } catch {
    /* private mode — theme still applies for this visit */
  }
}

export function ThemeSwitcher({ className = "" }: { className?: string }) {
  const [active, setActive] = useState<ThemeId>("dark");

  // Read whatever the pre-paint script applied.
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "light" || current === "midnight") setActive(current);
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={`inline-flex items-center gap-1 rounded-full border border-ink-600 bg-ink-800 p-1 ${className}`}
    >
      {THEMES.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={on}
            title={`${t.label} theme`}
            aria-label={`${t.label} theme`}
            onClick={() => {
              setActive(t.id);
              applyTheme(t.id);
            }}
            className={`flex h-6 w-6 items-center justify-center rounded-full transition-all duration-200 ${
              on ? "ring-2 ring-green-400" : "opacity-70 hover:opacity-100"
            }`}
          >
            <span
              aria-hidden
              className="block h-4 w-4 rounded-full border border-black/20"
              style={{
                background: `linear-gradient(135deg, ${t.swatch} 55%, ${t.accent} 55%)`,
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
