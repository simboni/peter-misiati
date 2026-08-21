"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

/**
 * Navigation, one client component, three renderings by breakpoint:
 *   - phone: bottom tab bar, thumb-reachable at the counter;
 *   - tablet (md): the same bar as a floating island;
 *   - desktop (lg+): a fixed left rail carrying the tabs AND the More groups,
 *     so every destination is one click on a big screen.
 * Owner-only destinations are filtered by the server before this renders.
 *
 * The desktop rail collapses, because navigation is space the counter screen
 * cannot use for products. It collapses to icons rather than to nothing: a rail
 * that disappears takes every destination with it, and an attendant hunting for
 * Stock behind a hidden menu is slower than one who never had the space back.
 * Collapsed, the five tabs and More stay one click away.
 *
 * Its width is not fixed either — `--rail-w` in globals.css steps 12rem / 13rem
 * / 15rem with the screen, because on a 13" laptop a 15rem rail was 18% of the
 * width. Collapsing it saves a further 7.5rem on top of that.
 *
 * The choice is remembered in a cookie the server reads, so the rail is already
 * the right width on the first paint.
 */

type Tab = { href: string; label: string; icon: React.ReactNode; ownerOnly?: boolean };

const I = (d: string) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const TABS: Tab[] = [
  { href: "/sell", label: "Sell", icon: I("M3 4h2l2.5 11.5h10L20 8H6 M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2 M17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2") },
  { href: "/stock", label: "Stock", icon: I("M3 9l9-5 9 5v10l-9 5-9-5z M3 9l9 5 9-5 M12 14v10") },
  // Production runs the secret recipe; owner-only, so the tab is too.
  { href: "/batch", label: "Batch", icon: I("M10 3v6l-5.5 9a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3 M8 3h8 M7 15h10"), ownerOnly: true },
  { href: "/customers", label: "Debts", icon: I("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87") },
  // Reports is owner-only; previously it rendered for staff then bounced them
  // home — a dead tab. Now it simply isn't shown to them.
  { href: "/reports", label: "Reports", icon: I("M4 20V10 M10 20V4 M16 20v-8 M22 20H2"), ownerOnly: true },
  // "More" opens the everything-else grid — the only path to day close, sales
  // history and the rest on a phone. The desktop rail lists them directly.
  { href: "/more", label: "More", icon: I("M4 6h16 M4 12h16 M4 18h16") },
];

// Repack and stock take both read raw-reagent quantities off the shelf.
// Those numbers are how a formula could be reverse-engineered, so both are
// owner-only, alongside the rest of raw-chemical handling.
const MORE_GROUPS: Array<{
  label: string;
  /**
   * `short` is the rail's version of the name. The rail is 12rem on a small
   * laptop and one label — "Suppliers & purchases" — overruns that by a single
   * pixel and wraps to two lines, which makes the whole column look ragged. The
   * More grid has the room, so it keeps the full name; only the rail shortens.
   */
  links: Array<{ href: string; label: string; short?: string; owner: boolean }>;
}> = [
  {
    label: "Every day",
    links: [
      { href: "/sales", label: "Sales history", owner: false },
      { href: "/day-close", label: "Day close", owner: false },
      { href: "/expenses", label: "Expenses", owner: false },
      { href: "/purchases", label: "Suppliers & purchases", short: "Purchases", owner: false },
    ],
  },
  {
    label: "Stock & making",
    links: [
      { href: "/repack", label: "Repack", owner: true },
      { href: "/stocktake", label: "Stock take", owner: true },
      { href: "/formulas", label: "Formulas", owner: true },
      { href: "/items", label: "Products & prices", owner: true },
    ],
  },
  {
    label: "Setup & records",
    links: [
      { href: "/activity", label: "Activity log", owner: true },
      { href: "/settings", label: "Users & settings", owner: true },
      { href: "/settings/printer", label: "Receipt printer", owner: true },
      { href: "/pin", label: "Change my PIN", owner: false },
    ],
  },
  // Its own group rather than an entry under Setup: the handbook is the thing
  // somebody reaches for when they are stuck mid-task, and hunting for it
  // among the settings is the moment they give up and phone the owner instead.
  // Not owner-only — an attendant is who it is mostly for. They are served a
  // copy with the owner's screens cut out; see `@/lib/handbook`.
  {
    label: "Help",
    links: [{ href: "/handbook", label: "My handbook", owner: false }],
  },
];

/** How long the rail remembers: a year, i.e. until somebody changes it back. */
const RAIL_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function BottomNav({ isOwner, rail = "wide" }: { isOwner: boolean; rail?: "wide" | "mini" }) {
  const path = usePathname();
  const tabs = TABS.filter((t) => !t.ownerOnly || isOwner);

  // Seeded from the server's cookie read, so this matches what was painted.
  const [mini, setMini] = useState(rail === "mini");

  function toggleRail() {
    const next = mini ? "wide" : "mini";
    setMini(!mini);
    // The CSS variable lives on <html>; moving it here rather than re-rendering
    // through the server keeps the rail instant and the layout in step with it.
    document.documentElement.dataset.rail = next;
    document.cookie = `riziki_rail=${next}; path=/; max-age=${RAIL_COOKIE_MAX_AGE}; samesite=lax`;
  }

  return (
    <>
      {/* Phone bottom bar; floating island at md; gone at lg. */}
      <nav
        className="no-print fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-lg rounded-t-3xl bg-white pt-1.5 pb-[env(safe-area-inset-bottom)] shadow-nav md:bottom-3 md:max-w-xl md:rounded-3xl md:shadow-lift md:ring-1 md:ring-ink/5 lg:hidden"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((t) => {
          const active = path === t.href || path.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[52px] flex-col items-center gap-0.5 pt-2 pb-2 text-[10.5px] font-semibold transition-colors ${
                active ? "text-brand-deep" : "text-muted"
              }`}
            >
              <span
                className={
                  active ? "rounded-full bg-brand px-4 py-1 text-white shadow-sm" : "rounded-full px-4 py-1"
                }
              >
                {t.icon}
              </span>
              {t.label}
            </Link>
          );
        })}
      </nav>

      {/* Desktop rail. Same tabs, then the More groups laid out flat — or, when
          collapsed, the tabs alone as icons with More at the end of them. */}
      <nav
        aria-label="Main"
        className="no-print fixed inset-y-0 left-0 z-30 hidden w-[var(--rail-w)] flex-col overflow-y-auto overflow-x-hidden bg-white pb-6 pt-5 shadow-[6px_0_24px_-8px_rgb(13_43_48/0.18)] transition-[width] duration-200 lg:flex"
      >
        <div className={`mb-4 flex px-3 ${mini ? "flex-col items-center gap-2" : "items-center gap-2.5"}`}>
          <Link href="/" className="flex min-w-0 items-center gap-2.5" title="Riziki POS">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-deep text-xs font-extrabold text-white">
              RZ
            </span>
            {mini ? null : (
              <span className="truncate text-sm font-bold text-brand-deep">Riziki POS</span>
            )}
          </Link>
          <button
            type="button"
            onClick={toggleRail}
            aria-expanded={!mini}
            aria-label={mini ? "Show the menu labels" : "Collapse the menu to icons"}
            title={mini ? "Show labels" : "Collapse menu"}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-wash hover:text-ink ${
              mini ? "" : "ml-auto"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-4 w-4 transition-transform duration-200 ${mini ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
        </div>

        <div className={mini ? "px-2" : "px-3"}>
          {(mini ? tabs : tabs.filter((t) => t.href !== "/more")).map((t) => {
            const active = path === t.href || path.startsWith(t.href + "/");
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                title={mini ? t.label : undefined}
                className={`mb-0.5 flex items-center rounded-2xl text-sm font-semibold transition-colors ${
                  mini ? "h-11 w-11 justify-center" : "gap-3 px-3.5 py-2.5"
                } ${active ? "bg-brand text-white shadow-sm" : "text-muted hover:bg-wash hover:text-ink"}`}
              >
                {t.icon}
                {mini ? <span className="sr-only">{t.label}</span> : t.label}
              </Link>
            );
          })}
        </div>

        {/* The twelve secondary destinations have no sensible icons, so
            collapsed they fold behind the More tab above rather than becoming a
            column of guesses. */}
        {mini
          ? null
          : MORE_GROUPS.map((g) => {
              const links = g.links.filter((l) => !l.owner || isOwner);
              if (!links.length) return null;
              return (
                <div key={g.label} className="px-3">
                  <div className="mt-5 mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                    {g.label}
                  </div>
                  {links.map((l) => {
                    const active = path === l.href;
                    return (
                      <Link
                        key={l.href}
                        href={l.href}
                        className={`flex items-center rounded-xl px-3.5 py-2 text-[13px] font-semibold ${
                          active ? "bg-brand-soft text-brand-dark" : "text-muted hover:bg-wash hover:text-ink"
                        }`}
                      >
                        {l.short ?? l.label}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
      </nav>
    </>
  );
}

/** Secondary links that don't earn a tab, grouped by how often they're used. */
export function MoreMenu({ isOwner }: { isOwner: boolean }) {
  return (
    <div className="space-y-1 lg:max-w-4xl">
      {MORE_GROUPS.map((g) => {
        const links = g.links.filter((l) => !l.owner || isOwner);
        if (!links.length) return null;
        return (
          <div key={g.label}>
            <h2 className="mt-5 mb-2 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted after:h-px after:flex-1 after:bg-line after:content-['']">
              {g.label}
            </h2>
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="flex min-h-14 items-center rounded-2xl bg-white px-4 text-sm font-semibold text-ink shadow-card ring-1 ring-ink/5 transition-shadow hover:shadow-lift"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
