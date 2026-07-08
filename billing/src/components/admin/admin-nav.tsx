"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; icon: string; exact?: boolean };

const base: NavItem[] = [
  { href: "/admin", label: "Overview", icon: "◆", exact: true },
  { href: "/admin/vendors", label: "Vendors", icon: "▦" },
  { href: "/admin/requests", label: "Upgrade requests", icon: "✦" },
  { href: "/admin/payments", label: "Payments", icon: "₿" },
  { href: "/admin/audit", label: "Audit log", icon: "❐" },
];
const superOnly: NavItem[] = [
  { href: "/admin/users", label: "Users & admins", icon: "◍" },
  { href: "/admin/settings", label: "Platform settings", icon: "⚙" },
];

export function AdminNav({ isSuper }: { isSuper: boolean }) {
  const pathname = usePathname();
  const items = isSuper ? [...base.slice(0, 4), ...superOnly, base[4]] : base;
  return (
    <nav className="space-y-1">
      {items.map((it) => {
        const active = it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-slate-800 text-white"
                : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
            }`}
          >
            <span className="w-5 text-center text-base leading-none" aria-hidden>
              {it.icon}
            </span>
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
