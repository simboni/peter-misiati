"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/clients", label: "Clients", icon: "◍" },
  { href: "/items", label: "Items & Services", icon: "❏" },
  { href: "/quotations", label: "Quotations", icon: "✎" },
  { href: "/invoices", label: "Invoices", icon: "🧾" },
  { href: "/receipts", label: "Receipts", icon: "✔" },
  { href: "/delivery-notes", label: "Delivery Notes", icon: "🚚" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function SidebarNav({ pro = false }: { pro?: boolean }) {
  const pathname = usePathname();
  const nav = [...items, { href: "/upgrade", label: pro ? "Plan" : "Upgrade", icon: "✨" }];
  return (
    <nav className="space-y-1">
      {nav.map((it) => {
        const active = pathname === it.href || pathname.startsWith(it.href + "/");
        const highlight = it.href === "/upgrade" && !pro && !active;
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-brand-50 text-brand-800"
                : highlight
                  ? "text-brand-700 hover:bg-brand-50"
                  : "text-slate-600 hover:bg-canvas hover:text-ink"
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
