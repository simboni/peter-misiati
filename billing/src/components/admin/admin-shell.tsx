"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark, Wordmark } from "@/components/brand";
import { NAV_ICONS, type NavIconName } from "./icons";

type Item = { href: string; label: string; icon: NavIconName; exact?: boolean };
type Group = { label: string; items: Item[] };

const GROUPS = (isSuper: boolean): Group[] => [
  {
    label: "Manage",
    items: [
      { href: "/admin", label: "Overview", icon: "overview", exact: true },
      { href: "/admin/vendors", label: "Vendors", icon: "vendors" },
      { href: "/admin/requests", label: "Upgrade requests", icon: "requests" },
      { href: "/admin/payments", label: "Payments", icon: "payments" },
      { href: "/admin/audit", label: "Audit log", icon: "audit" },
    ],
  },
  ...(isSuper
    ? [
        {
          label: "Platform",
          items: [
            { href: "/admin/users", label: "Users & admins", icon: "users" as const },
            { href: "/admin/settings", label: "Platform settings", icon: "settings" as const },
          ],
        },
      ]
    : []),
];

function isActive(pathname: string, it: Item) {
  return it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(it.href + "/");
}

export function AdminShell({
  user,
  isSuper,
  signOut,
  children,
}: {
  user: { name: string; email: string };
  isSuper: boolean;
  signOut: () => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const groups = GROUPS(isSuper);

  // Restore the collapsed preference once mounted (avoids hydration mismatch).
  useEffect(() => {
    setCollapsed(localStorage.getItem("tp:admin:nav") === "collapsed");
  }, []);
  useEffect(() => {
    localStorage.setItem("tp:admin:nav", collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  // Close the mobile drawer on navigation and lock body scroll while it's open.
  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const sidebarW = collapsed ? 76 : 248;

  const NavList = ({ compact }: { compact: boolean }) => (
    <nav className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-1">
          {compact ? (
            <div className="mx-3 mb-1 h-px bg-slate-800" aria-hidden />
          ) : (
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              {g.label}
            </p>
          )}
          {g.items.map((it) => {
            const active = isActive(pathname, it);
            const Icon = NAV_ICONS[it.icon];
            return (
              <Link
                key={it.href}
                href={it.href}
                title={compact ? it.label : undefined}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center rounded-lg text-sm font-medium transition-colors ${
                  compact ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"
                } ${
                  active
                    ? "bg-brand-600 text-white shadow-sm shadow-brand-900/40"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <Icon className="h-5 w-5 flex-none" />
                {!compact && <span className="truncate">{it.label}</span>}
                {active && !compact && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white/80" aria-hidden />
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const Footer = ({ compact }: { compact: boolean }) =>
    compact ? (
      <div className="flex flex-col items-center gap-2 border-t border-slate-800 p-3">
        <span
          className="grid h-9 w-9 place-items-center rounded-full bg-slate-800 text-sm font-bold text-slate-200"
          title={`${user.name} · ${user.email}`}
        >
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <Link
          href="/dashboard"
          title="My workspace"
          className="grid h-9 w-9 place-items-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden>
            <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <form action={signOut}>
          <button
            title="Sign out"
            className="grid h-9 w-9 place-items-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden>
              <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M10 8 6 12l4 4M6 12h11" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      </div>
    ) : (
      <div className="border-t border-slate-800 p-4">
        <p className="truncate text-sm font-semibold">{user.name}</p>
        <p className="truncate text-xs text-slate-400">{user.email}</p>
        <div className="mt-3 flex gap-2">
          <Link
            href="/dashboard"
            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-center text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            My workspace
          </Link>
          <form action={signOut} className="flex-1">
            <button className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">
              Sign out
            </button>
          </form>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-canvas" style={{ ["--sbw" as string]: `${sidebarW}px` }}>
      {/* ---------- Desktop sidebar ---------- */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden flex-col bg-slate-900 text-white transition-[width] duration-200 ease-out lg:flex"
        style={{ width: sidebarW }}
      >
        <div className={`flex items-center border-b border-slate-800 ${collapsed ? "justify-center px-2 py-4" : "gap-2 px-4 py-4"}`}>
          <Link href="/admin" className="flex items-center gap-2 text-white" title="TallyPay Admin">
            <BrandMark size={26} />
            {!collapsed && (
              <span className="font-bold tracking-tight">
                <Wordmark /> <span className="font-medium text-slate-400">Admin</span>
              </span>
            )}
          </Link>
        </div>

        {!collapsed && (
          <p className="px-4 pt-3 text-[11px] uppercase tracking-wider text-slate-500">
            {isSuper ? "Super admin" : "Platform admin"}
          </p>
        )}

        <div className="flex-1 overflow-y-auto p-3">
          <NavList compact={collapsed} />
        </div>

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
          className={`flex items-center border-t border-slate-800 py-2.5 text-slate-400 hover:bg-slate-800 hover:text-white ${
            collapsed ? "justify-center" : "gap-2 px-4"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-5 w-5 transition-transform ${collapsed ? "rotate-180" : ""}`}
            aria-hidden
          >
            <path d="m14 7-5 5 5 5" />
          </svg>
          {!collapsed && <span className="text-xs font-medium">Collapse</span>}
        </button>

        <Footer compact={collapsed} />
      </aside>

      {/* ---------- Mobile top bar ---------- */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3 text-white lg:hidden">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-800"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-5 w-5" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
          <Link href="/admin" className="flex items-center gap-2 font-bold text-white">
            <BrandMark size={22} />
            <span>
              <Wordmark /> <span className="font-medium text-slate-400">Admin</span>
            </span>
          </Link>
        </div>
        <Link href="/dashboard" className="text-sm text-slate-300 hover:text-white">
          Workspace
        </Link>
      </header>

      {/* ---------- Mobile drawer ---------- */}
      <div className={`lg:hidden ${mobileOpen ? "" : "pointer-events-none"}`}>
        <div
          onClick={() => setMobileOpen(false)}
          className={`fixed inset-0 z-40 bg-slate-950/60 transition-opacity duration-200 ${
            mobileOpen ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden
        />
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col bg-slate-900 text-white shadow-2xl transition-transform duration-200 ease-out ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Admin menu"
        >
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-4">
            <Link href="/admin" className="flex items-center gap-2 font-bold">
              <BrandMark size={24} />
              <span>
                <Wordmark /> <span className="font-medium text-slate-400">Admin</span>
              </span>
            </Link>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-slate-800"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-5 w-5" aria-hidden>
                <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <p className="px-4 pt-3 text-[11px] uppercase tracking-wider text-slate-500">
            {isSuper ? "Super admin" : "Platform admin"}
          </p>
          <div className="flex-1 overflow-y-auto p-3">
            <NavList compact={false} />
          </div>
          <Footer compact={false} />
        </aside>
      </div>

      {/* ---------- Main content ---------- */}
      <div className="transition-[padding] duration-200 ease-out lg:pl-[var(--sbw)]">
        <main className="min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
