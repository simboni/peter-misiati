"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

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

type Tab = {
  href: string;
  label: string;
  icon: React.ReactNode;
  ownerOnly?: boolean;
};

const I = (d: string) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const TABS: Tab[] = [
  { href: "/sell", label: "Sell", icon: I("M3 4h2l2.5 11.5h10L20 8H6 M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2 M17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2") },
  { href: "/stock", label: "Stock", icon: I("M3 9l9-5 9 5v10l-9 5-9-5z M3 9l9 5 9-5 M12 14v10") },
  /*
    "Batch" used to be a tab here. It is gone, and Recipes has not taken its
    place: the recipe book is a reference now, not a place work happens. A mix
    is sold from the Products board on the till, so the owner opens /formulas to
    correct a quantity, which is a monthly errand and belongs under More.

    That also gives the phone's bottom bar back a slot. Seven tabs at 390px put
    "Recipes" and "Wholesale" hard against each other with no gap between them;
    six fit.
  */
  // Quotes and wholesale invoices. A tab rather than a menu entry because it is
  // a place the shop works from, not something it configures — and because the
  // owner asked for it to be one tap from the till.
  { href: "/wholesale", label: "Wholesale", icon: I("M4 7h16v13H4z M4 7l2-3h12l2 3 M9 12h6") },
  { href: "/customers", label: "Customers", icon: I("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87") },
  // Reports is owner-only; previously it rendered for staff then bounced them
  // home — a dead tab. Now it simply isn't shown to them.
  { href: "/reports", label: "Reports", icon: I("M4 20V10 M10 20V4 M16 20v-8 M22 20H2"), ownerOnly: true },
  // "More" opens the everything-else grid — the only path to day close, sales
  // history and the rest on a phone. The desktop rail lists them directly.
  { href: "/more", label: "More", icon: I("M4 6h16 M4 12h16 M4 18h16") },
];

/*
  Everything that is not one of the tabs.

  This is the sidebar on a laptop and the More grid on a phone, and it is where
  a destination belongs unless it is one of the six things the counter reaches
  for constantly.

  These were briefly folded into a strip of tabs inside the Stock and Reports
  screens, and that was wrong twice over: Products & prices and Recipes are not
  stock, and a strip inside a window whose every entry navigates somewhere else
  is a second navigation competing with this one. Getting between windows is
  this menu's job. A window's own controls stay inside it.
*/
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
    // Named for what these are rather than where they sit: an attendant looking
    // for the day close is looking for a job, not for a category.
    label: "Every day",
    links: [
      { href: "/day-close", label: "Day close", owner: false },
      { href: "/expenses", label: "Expenses", owner: false },
      // Open to attendants on purpose: the person who opens the shop is the
      // person who gets asked the price, and the band is what makes letting
      // them change it safe.
      { href: "/prices/history", label: "Price history", short: "Prices", owner: false },
      { href: "/sales", label: "Sales history", owner: false },
      { href: "/purchases", label: "Suppliers & purchases", short: "Purchases", owner: false },
    ],
  },
  {
    // What the shop sells and what goes into it. Neither is stock: a price is
    // not a quantity, and a recipe is a piece of writing. They sit beside Stock
    // rather than inside it.
    label: "Products & recipes",
    links: [
      { href: "/items", label: "Products & prices", short: "Products", owner: true },
      { href: "/formulas", label: "Recipes", owner: true },
      { href: "/mix", label: "Mixing board", short: "Mixing", owner: true },
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
];

export function BottomNav({ isOwner }: { isOwner: boolean }) {
  const path = usePathname();
  const tabs = TABS.filter((t) => !t.ownerOnly || isOwner);

  return (
    <>
      {/* Phone bottom bar; floating island at md; gone at lg. */}
      <nav
        /* `gap-x-1` and a slightly smaller label. Six tabs across 390px is
           about sixty pixels each, and "Wholesale" beside "Customers" used
           every one of them — the two words touched, and a bar whose labels
           run together reads as one long word rather than two places to go.
           The words themselves are not shortened: a tab that says something
           different from the screen it opens is the thing this consolidation
           was meant to get rid of. */
        className="no-print fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-lg gap-x-1 rounded-t-3xl bg-white pt-1.5 pb-[env(safe-area-inset-bottom)] shadow-nav md:bottom-3 md:max-w-xl md:rounded-3xl md:shadow-lift md:ring-1 md:ring-ink/5 lg:hidden"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((t) => {
          const active = path === t.href || path.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[52px] min-w-0 flex-col items-center gap-0.5 pt-2 pb-2 text-[10px] font-semibold transition-colors ${
                active ? "text-brand-deep" : "text-muted"
              }`}
            >
              <span
                className={
                  active ? "rounded-full bg-brand px-3.5 py-1 text-white shadow-sm" : "rounded-full px-3.5 py-1"
                }
              >
                {t.icon}
              </span>
              <span className="max-w-full truncate">{t.label}</span>
            </Link>
          );
        })}
      </nav>

    </>
  );
}


/**
 * The menu, on demand.
 *
 * Three lines in the header, and the whole thing slides over the page when
 * asked. It replaces the permanent rail: the same destinations, none of the
 * rent. Rendered from `lg` up only — below that the bottom tab bar is already
 * within thumb reach and a second way in would just be clutter.
 *
 * It closes on Escape, on the scrim, and on navigating: a drawer still standing
 * over the till after the attendant has arrived somewhere is worse than no
 * drawer, because it hides the screen they asked for.
 */
export function MenuDrawer({ isOwner }: { isOwner: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const tabs = TABS.filter((t) => !t.ownerOnly || isOwner);

  // Arriving somewhere is the signal that the menu has done its job.
  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="no-print hidden lg:block">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label="Open the menu"
        className="flex h-10 w-10 items-center justify-center rounded-2xl text-white ring-1 ring-inset ring-white/25 transition-colors hover:bg-white/10"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M4 7h16 M4 12h16 M4 17h16" />
        </svg>
      </button>

      {/* Kept mounted so the panel slides rather than appearing; pointer-events
          are what stop the closed one from swallowing clicks on the till. */}
      <div
        aria-hidden={!open}
        className={`fixed inset-0 z-40 bg-brand-deep/45 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setOpen(false)}
      />
      <nav
        aria-label="Main"
        aria-hidden={!open}
        className={`fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col overflow-y-auto bg-white pb-6 pt-4 shadow-lift transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-3 flex items-center gap-2.5 px-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-deep text-xs font-extrabold text-white">
            RZ
          </span>
          <span className="text-sm font-bold text-brand-deep">Riziki POS</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close the menu"
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-wash hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M6 6l12 12 M18 6l-12 12" />
            </svg>
          </button>
        </div>

        <div className="px-3">
          {tabs
            .filter((t) => t.href !== "/more")
            .map((t) => {
              const active = path === t.href || path.startsWith(t.href + "/");
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  tabIndex={open ? undefined : -1}
                  className={`mb-0.5 flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-semibold transition-colors ${
                    active ? "bg-brand text-white shadow-sm" : "text-muted hover:bg-wash hover:text-ink"
                  }`}
                >
                  {t.icon}
                  {t.label}
                </Link>
              );
            })}
        </div>

        {MORE_GROUPS.map((g) => {
          const links = g.links.filter((l) => !l.owner || isOwner);
          if (!links.length) return null;
          return (
            <div key={g.label} className="px-3">
              <div className="mt-4 mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                {g.label}
              </div>
              {links.map((l) => {
                const active = path === l.href;
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    tabIndex={open ? undefined : -1}
                    className={`flex items-center rounded-xl px-3.5 py-2 text-[13px] font-semibold ${
                      active ? "bg-brand-soft text-brand-dark" : "text-muted hover:bg-wash hover:text-ink"
                    }`}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
    </div>
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
