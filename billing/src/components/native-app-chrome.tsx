"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-toggle";
import { NAV, ICONS, Icon, type NavItem } from "./app-shell";

/**
 * Native app chrome — a bottom tab bar + contextual title bar + slide-up
 * sheets, shown only inside the installed app (html[data-app="native"], set by
 * AppShell). This is what turns the wrapped website into something that reads
 * and behaves like a real app. The desktop website keeps its sidebar.
 */

// Section labels shown in the singular on detail/create screens.
const SINGULAR: Record<string, string> = {
  "/invoices": "Invoice",
  "/quotations": "Quotation",
  "/receipts": "Receipt",
  "/credit-notes": "Credit note",
  "/clients": "Client",
  "/items": "Item",
  "/delivery-notes": "Delivery note",
  "/recurring": "Recurring invoice",
  "/expenses": "Expense",
  "/reports": "Reports",
  "/settings": "Settings",
  "/dashboard": "Home",
};

// The five bottom-bar slots. The middle one is the raised Create button.
const TABS = [
  { href: "/dashboard", label: "Home", icon: "grid" as const, exact: true },
  { href: "/invoices", label: "Invoices", icon: "invoice" as const },
  { kind: "create" as const },
  { href: "/clients", label: "Clients", icon: "users" as const },
  { kind: "more" as const, label: "More" },
];

// Quick-create actions surfaced from the center button.
const CREATE: { href: string; label: string; icon: keyof typeof ICONS; primary?: boolean }[] = [
  { href: "/invoices/new", label: "Invoice", icon: "invoice", primary: true },
  { href: "/quotations/new", label: "Quotation", icon: "quote" },
  { href: "/clients/new", label: "Client", icon: "users" },
  { href: "/expenses/new", label: "Expense", icon: "wallet" },
  { href: "/delivery-notes/new", label: "Delivery note", icon: "truck" },
  { href: "/items/new", label: "Item", icon: "box" },
];

function isActive(pathname: string, it: { href: string; exact?: boolean }) {
  return it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(it.href + "/");
}

function activeSection(pathname: string): NavItem | null {
  let best: NavItem | null = null;
  for (const it of NAV) {
    if (isActive(pathname, it) && (!best || it.href.length > best.href.length)) best = it;
  }
  return best;
}

function Plus({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function Dots({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
    </svg>
  );
}

export function NativeAppChrome({
  orgName,
  userEmail,
  pro,
  isAdmin,
  signOut,
}: {
  orgName: string;
  userEmail: string;
  pro: boolean;
  isAdmin: boolean;
  signOut: () => void;
}) {
  const pathname = usePathname();
  const [sheet, setSheet] = useState<null | "create" | "more">(null);

  // Any navigation closes an open sheet.
  useEffect(() => setSheet(null), [pathname]);

  const section = activeSection(pathname);
  const isSub = !!section && pathname !== section.href;
  const singular = section ? SINGULAR[section.href] ?? section.label : "TallyPay";
  let title = section?.label ?? "TallyPay";
  if (section && isSub) {
    if (pathname.endsWith("/new")) title = "New " + singular.toLowerCase();
    else if (pathname.includes("/edit")) title = "Edit " + singular.toLowerCase();
    else if (pathname.endsWith("/statement")) title = "Statement";
    else title = singular;
  }
  const backHref = isSub ? section!.href : null;
  const initial = (orgName || "T").trim().charAt(0).toUpperCase();

  return (
    <>
      {/* ---------------- Title bar ---------------- */}
      <header
        className="app-only app-chrome sticky top-0 z-30 items-center gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur"
        style={{ paddingTop: "var(--tp-safe-top)", height: "calc(var(--tp-appbar-h) + var(--tp-safe-top))" }}
      >
        {backHref ? (
          <Link href={backHref} aria-label="Back" className="tp-press grid h-10 w-10 place-items-center rounded-full text-ink">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
        ) : (
          <span className="grid h-10 w-10 place-items-center">
            <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden><rect width="64" height="64" rx="17" fill="#059669" /><g fill="none" stroke="#fff" strokeWidth={6.5} strokeLinecap="round" strokeLinejoin="round"><line x1="20" y1="22" x2="20" y2="42" /><line x1="29" y1="22" x2="29" y2="42" /><path d="M36 34 L43 42 L52 22" /></g></svg>
          </span>
        )}
        <h1 className="min-w-0 flex-1 truncate text-center text-[17px] font-bold tracking-tight text-ink">{title}</h1>
        <button
          onClick={() => setSheet("more")}
          aria-label="Menu"
          className="tp-press grid h-10 w-10 place-items-center rounded-full"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">{initial}</span>
        </button>
      </header>

      {/* ---------------- Bottom tab bar ---------------- */}
      <nav
        className="app-only app-chrome fixed inset-x-0 bottom-0 z-30 items-stretch justify-around border-t border-line bg-surface/95 backdrop-blur"
        style={{ height: "calc(var(--tp-tabbar-h) + var(--tp-safe-bottom))", paddingBottom: "var(--tp-safe-bottom)" }}
      >
        {TABS.map((t, i) => {
          if (t.kind === "create") {
            return (
              <button
                key="create"
                onClick={() => setSheet("create")}
                aria-label="Create"
                className="tp-press relative flex flex-1 items-start justify-center"
              >
                <span className="-mt-5 grid h-14 w-14 place-items-center rounded-full bg-brand-600 text-white shadow-[0_8px_20px_-4px_rgba(5,150,105,0.6)] ring-4 ring-surface">
                  <Plus />
                </span>
              </button>
            );
          }
          if (t.kind === "more") {
            const on = sheet === "more";
            return (
              <button
                key="more"
                onClick={() => setSheet("more")}
                className={`tp-press flex flex-1 flex-col items-center justify-center gap-1 pt-1.5 text-[11px] font-medium ${on ? "text-brand-700" : "text-muted"}`}
              >
                <Dots className="h-[22px] w-[22px]" />
                <span>More</span>
              </button>
            );
          }
          const on = isActive(pathname, t) && !sheet;
          return (
            <Link
              key={t.href}
              href={t.href!}
              className={`tp-press flex flex-1 flex-col items-center justify-center gap-1 pt-1.5 text-[11px] font-medium ${on ? "text-brand-700" : "text-muted"}`}
            >
              <Icon name={t.icon!} className={`h-[22px] w-[22px] ${on ? "" : ""}`} />
              <span>{t.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* ---------------- Create sheet ---------------- */}
      {sheet === "create" && (
        <Sheet title="Create" onClose={() => setSheet(null)}>
          <div className="grid grid-cols-3 gap-3">
            {CREATE.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                className="tp-press flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface p-3 text-center"
              >
                <span className={`grid h-12 w-12 place-items-center rounded-xl ${c.primary ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-700"}`}>
                  <Icon name={c.icon} className="h-6 w-6" />
                </span>
                <span className="text-xs font-semibold text-ink">{c.label}</span>
              </Link>
            ))}
          </div>
        </Sheet>
      )}

      {/* ---------------- More sheet ---------------- */}
      {sheet === "more" && (
        <Sheet title="Menu" onClose={() => setSheet(null)}>
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-3">
            <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-brand-600 text-lg font-bold text-white">{initial}</span>
            <div className="min-w-0">
              <p className="truncate font-bold text-ink">{orgName}</p>
              <p className="truncate text-xs text-muted">{userEmail}</p>
            </div>
            <span className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-bold ${pro ? "bg-brand-100 text-brand-700" : "bg-surface text-muted"}`}>
              {pro ? "Pro" : "Free"}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-y-4 gap-x-2">
            {NAV.map((it) => {
              const on = isActive(pathname, it);
              return (
                <Link key={it.href} href={it.href} className="tp-press flex flex-col items-center gap-1.5 text-center">
                  <span className={`grid h-12 w-12 place-items-center rounded-2xl ${on ? "bg-brand-600 text-white" : "bg-surface-2 text-ink"}`}>
                    <Icon name={it.icon} className="h-[22px] w-[22px]" />
                  </span>
                  <span className="text-[11px] font-medium leading-tight text-muted">{it.label}</span>
                </Link>
              );
            })}
            <Link href="/upgrade" className="tp-press flex flex-col items-center gap-1.5 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700">
                <Icon name="spark" className="h-[22px] w-[22px]" />
              </span>
              <span className="text-[11px] font-medium leading-tight text-muted">{pro ? "Plan" : "Upgrade"}</span>
            </Link>
          </div>

          {isAdmin && (
            <Link href="/admin" className="tp-press mt-4 flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white">
              ◆ Admin console
            </Link>
          )}

          <div className="mt-4 flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2.5">
            <span className="text-sm font-medium text-muted">Theme</span>
            <ThemeToggle />
          </div>

          <form action={signOut} className="mt-3">
            <button className="btn-ghost w-full py-3">Sign out</button>
          </form>
        </Sheet>
      )}
    </>
  );
}

/** A slide-up bottom sheet with a scrim and a drag handle. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  // Lock body scroll while the sheet is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="app-chrome fixed inset-0 z-50 flex flex-col justify-end">
      <div className="tp-sheet-backdrop absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className="tp-sheet relative max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-line bg-canvas px-4 pt-2"
        style={{ paddingBottom: "calc(20px + var(--tp-safe-bottom))" }}
      >
        <div className="mx-auto my-2 h-1.5 w-10 rounded-full bg-line" />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="tp-press grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-muted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
