"use client";

import { useEffect, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Brand, BrandMark } from "./brand";
import { ThemeToggle } from "./theme-toggle";

/** Small spinner shown on a nav item while its route is loading. */
function NavPending({ collapsed }: { collapsed: boolean }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      className={`${collapsed ? "absolute right-1 top-1" : "ml-auto"} h-3.5 w-3.5 flex-none animate-spin rounded-full border-2 border-current border-r-transparent opacity-70`}
      aria-hidden
    />
  );
}

type NavItem = { href: string; label: string; icon: keyof typeof ICONS; exact?: boolean };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "grid", exact: true },
  { href: "/invoices", label: "Invoices", icon: "invoice" },
  { href: "/recurring", label: "Recurring", icon: "repeat" },
  { href: "/quotations", label: "Quotations", icon: "quote" },
  { href: "/receipts", label: "Receipts", icon: "receipt" },
  { href: "/credit-notes", label: "Credit notes", icon: "creditNote" },
  { href: "/expenses", label: "Expenses", icon: "wallet" },
  { href: "/reports", label: "Reports", icon: "chart" },
  { href: "/clients", label: "Clients", icon: "users" },
  { href: "/items", label: "Items & Services", icon: "box" },
  { href: "/delivery-notes", label: "Delivery Notes", icon: "truck" },
  { href: "/settings", label: "Settings", icon: "gear" },
];

const ICONS = {
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  invoice: "M6 2h9l3 3v17l-3-2-3 2-3-2-3 2V2zM9 8h6M9 12h6M9 16h4",
  quote: "M6 2h8l4 4v16H6zM14 2v4h4M9 13h6M9 17h4",
  receipt: "M5 3h14v18l-2.5-1.6L14 21l-2-1.4L10 21l-2.5-1.6L5 21zM8.5 8h7M8.5 12h7",
  wallet: "M3 7a2 2 0 012-2h12a2 2 0 012 2v2M3 7v10a2 2 0 002 2h14a2 2 0 002-2v-4M21 13h-4a2 2 0 010-4h4z",
  chart: "M3 3v18h18M8 15v3M13 10v8M18 6v12",
  repeat: "M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3",
  creditNote: "M6 2h9l3 3v17l-3-2-3 2-3-2-3 2V2zM9 13h6M14 9l-4 4M10 9l4 4",
  users: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87M16 3.13A4 4 0 0116 11",
  box: "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8",
  truck: "M1 4h13v10H1zM14 8h4l3 3v3h-7zM5.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM18.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-2.9 1.09V22a2 2 0 01-4 0v-.09A1.65 1.65 0 007 20.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 003.6 15a1.65 1.65 0 00-1.51-1H2a2 2 0 010-4h.09A1.65 1.65 0 003.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 3.6a1.65 1.65 0 001-1.51V2a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0020.4 9a1.65 1.65 0 001.51 1H22a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
  spark: "M12 2l1.9 5.8L20 9.6l-4.8 3.7L16.6 20 12 16.5 7.4 20l1.4-6.7L4 9.6l6.1-1.8z",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
};

function Icon({ name, className = "h-5 w-5" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={ICONS[name]} />
    </svg>
  );
}

export function AppShell({
  orgName,
  userEmail,
  pro,
  isAdmin,
  signOut,
  children,
}: {
  orgName: string;
  userEmail: string;
  pro: boolean;
  isAdmin: boolean;
  signOut: () => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false); // mobile
  const [collapsed, setCollapsed] = useState(false); // desktop

  // restore desktop collapsed preference
  useEffect(() => {
    setCollapsed(localStorage.getItem("tp_nav_collapsed") === "1");
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const n = !c;
      localStorage.setItem("tp_nav_collapsed", n ? "1" : "0");
      return n;
    });
  };

  // close the mobile drawer on navigation
  useEffect(() => setDrawer(false), [pathname]);

  const nav = [...NAV];
  const upgradeItem: NavItem = { href: "/upgrade", label: pro ? "Plan" : "Upgrade", icon: "spark" };

  const isActive = (it: NavItem) =>
    it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(it.href + "/");

  const NavLinks = ({ collapsed }: { collapsed: boolean }) => (
    <nav className="space-y-1">
      {[...nav, upgradeItem].map((it) => {
        const active = isActive(it);
        const isUpgrade = it.href === "/upgrade";
        return (
          <Link
            key={it.href}
            href={it.href}
            title={collapsed ? it.label : undefined}
            className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-brand-50 text-brand-800"
                : isUpgrade && !pro
                  ? "text-brand-700 hover:bg-brand-50"
                  : "text-muted hover:bg-surface-2 hover:text-ink"
            } ${collapsed ? "justify-center px-2" : ""}`}
          >
            <Icon name={it.icon} className="h-5 w-5 flex-none" />
            {!collapsed && <span className="truncate">{it.label}</span>}
            <NavPending collapsed={collapsed} />
          </Link>
        );
      })}
    </nav>
  );

  const Footer = ({ collapsed }: { collapsed: boolean }) =>
    collapsed ? (
      <form action={signOut}>
        <button className="grid w-full place-items-center rounded-lg py-2 text-muted hover:bg-surface-2 hover:text-ink" title="Sign out">
          <Icon name="logout" />
        </button>
      </form>
    ) : (
      <>
        <p className="truncate text-sm font-semibold text-ink">{orgName}</p>
        <p className="truncate text-xs text-muted">{userEmail}</p>
        {isAdmin && (
          <Link
            href="/admin"
            className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            ◆ Admin console
          </Link>
        )}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs font-medium text-muted">Theme</span>
          <ThemeToggle />
        </div>
        <form action={signOut} className="mt-2">
          <button className="btn-ghost btn-sm w-full">Sign out</button>
        </form>
      </>
    );

  return (
    <div className="min-h-screen bg-canvas">
      {/* ---------- Desktop sidebar (fixed, collapsible) ---------- */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex ${
          collapsed ? "w-[74px]" : "w-64"
        }`}
      >
        <div className={`flex h-16 items-center border-b border-line ${collapsed ? "justify-center px-2" : "justify-between px-4"}`}>
          {collapsed ? (
            <Link href="/dashboard" aria-label="TallyPay"><BrandMark size={30} /></Link>
          ) : (
            <Brand href="/dashboard" />
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks collapsed={collapsed} />
        </div>
        <button
          onClick={toggleCollapsed}
          className="mx-3 mb-2 flex items-center justify-center gap-2 rounded-lg py-1.5 text-xs font-medium text-muted hover:bg-canvas hover:text-ink"
          title={collapsed ? "Expand" : "Collapse"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`}>
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {!collapsed && "Collapse"}
        </button>
        <div className="border-t border-line p-4">
          <Footer collapsed={collapsed} />
        </div>
      </aside>

      {/* ---------- Mobile top bar ---------- */}
      <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur lg:hidden">
        <button
          onClick={() => setDrawer(true)}
          aria-label="Open menu"
          className="grid h-9 w-9 place-items-center rounded-lg text-ink hover:bg-surface-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
            <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
          </svg>
        </button>
        <Brand href="/dashboard" />
        <ThemeToggle className="ml-auto" />
      </header>

      {/* ---------- Mobile drawer ---------- */}
      {drawer && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[82%] flex-col bg-surface shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-line px-4">
              <Brand href="/dashboard" />
              <button onClick={() => setDrawer(false)} aria-label="Close menu" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <NavLinks collapsed={false} />
            </div>
            <div className="border-t border-line p-4">
              <Footer collapsed={false} />
            </div>
          </aside>
        </div>
      )}

      {/* ---------- Main ---------- */}
      <div className={`transition-[padding] duration-200 ${collapsed ? "lg:pl-[74px]" : "lg:pl-64"}`}>
        <main className="min-w-0 p-4 sm:p-6 lg:p-8">
          {!pro && (
            <Link
              href="/upgrade"
              className="no-print mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 transition-colors hover:bg-brand-100/70"
            >
              <span className="text-sm text-brand-800">
                <b>You’re on the free plan.</b> Your invoices carry TallyPay branding — upgrade to
                make the app your own.
              </span>
              <span className="btn-primary btn-sm whitespace-nowrap">Make it yours →</span>
            </Link>
          )}
          {children}
        </main>
        <footer className="no-print px-4 pb-6 pt-2 text-center text-xs text-muted sm:px-6 lg:px-8">
          Designed by <span className="font-semibold text-ink">SMP Developers Ltd</span>
        </footer>
      </div>
    </div>
  );
}
