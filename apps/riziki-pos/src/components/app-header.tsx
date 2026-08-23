"use client";

import { useEffect, useState } from "react";

/**
 * The band across the top, folded away by default.
 *
 * It carried the shop's name, the signed-in person, the connection light and
 * Sign out — 68px of it, on every screen, permanently. On a 768px-tall laptop
 * that is a row of products; on a tablet it is closer to two. None of what it
 * held is needed while selling: the name does not change, the attendant knows
 * who they are, and Sign out is wanted once a day.
 *
 * So it collapses to a 34px strip and pulls back down when asked. Two things
 * stay visible in the strip regardless, because they are the exceptions:
 *
 *   - the menu, which is the way off this screen; and
 *   - the connection light, because an attendant who cannot see that the till
 *     has gone offline is an attendant who does not know their sales are
 *     queuing. That one is not a decoration to be folded away.
 *
 * The choice is remembered per device, so a counter that wants the band can
 * keep it and everyone else gets the space back.
 */
export default function AppHeader({
  menu,
  status,
  children,
}: {
  /** The hamburger. Stays in the strip when collapsed. */
  menu: React.ReactNode;
  /** The online/offline light. Also stays. */
  status: React.ReactNode;
  /** Name, user and Sign out — the part that folds. */
  children: React.ReactNode;
}) {
  // Collapsed until told otherwise: the space matters more than the banner, and
  // one tap brings it back.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem("riziki_header") === "open");
    } catch {
      // Private mode, or storage refused. The default stands.
    }
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem("riziki_header", next ? "open" : "shut");
    } catch {
      // Not remembering is survivable; not toggling would not be.
    }
  }

  return (
    <header
      className={`no-print header-deep relative flex items-center gap-3 px-4 text-white md:px-6 lg:px-5 xl:px-6 2xl:px-8 ${
        open ? "py-3" : "py-1"
      }`}
    >
      {menu}

      {open ? children : null}

      {/* Pushed to the right when collapsed, where there is nothing else. */}
      <div className={`flex items-center gap-2 ${open ? "" : "ml-auto"}`}>
        {status}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={open ? "Hide the top bar" : "Show the top bar"}
          title={open ? "Hide the top bar" : "Show the top bar"}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-frost transition-colors hover:bg-white/10 hover:text-white"
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-4 w-4 transition-transform duration-200 ${open ? "" : "rotate-180"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 15l6-6 6 6" />
          </svg>
        </button>
      </div>

      <span aria-hidden className="brand-thread absolute inset-x-0 bottom-0 h-[3px]" />
    </header>
  );
}
