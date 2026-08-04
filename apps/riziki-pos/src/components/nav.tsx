"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Bottom tab bar — thumb-reachable on the counter phone.
 * Owner-only destinations are filtered by the server before this renders.
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
  // history and the rest, which were otherwise reachable only via the logo.
  { href: "/more", label: "More", icon: I("M4 6h16 M4 12h16 M4 18h16") },
];

export function BottomNav({ isOwner }: { isOwner: boolean }) {
  const path = usePathname();
  const tabs = TABS.filter((t) => !t.ownerOnly || isOwner);

  return (
    <nav
      className="no-print fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-lg border-t border-line bg-white pb-[env(safe-area-inset-bottom)]"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((t) => {
        const active = path === t.href || path.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-col items-center gap-1 py-2.5 text-[10.5px] font-semibold transition-colors ${
              active ? "text-brand" : "text-muted"
            }`}
          >
            <span className={active ? "rounded-lg bg-brand-soft px-3 py-0.5" : "px-3 py-0.5"}>
              {t.icon}
            </span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Secondary links that don't earn a tab. */
export function MoreMenu({ isOwner }: { isOwner: boolean }) {
  const links = [
    { href: "/sales", label: "Sales history", owner: false },
    { href: "/day-close", label: "Day close", owner: false },
    { href: "/expenses", label: "Expenses", owner: false },
    { href: "/formulas", label: "Formulas", owner: true },
    // Repack and stock take both read raw-reagent quantities off the shelf.
    // Those numbers are how a formula could be reverse-engineered, so both are
    // owner-only, alongside the rest of raw-chemical handling.
    { href: "/repack", label: "Repack", owner: true },
    { href: "/stocktake", label: "Stock take", owner: true },
    { href: "/purchases", label: "Suppliers & purchases", owner: false },
    { href: "/settings", label: "Users & settings", owner: true },
    { href: "/settings/printer", label: "Receipt printer", owner: true },
  ].filter((l) => !l.owner || isOwner);

  return (
    <div className="grid grid-cols-2 gap-2">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="rounded-xl border border-line bg-white px-3 py-3 text-sm font-semibold hover:bg-wash"
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
