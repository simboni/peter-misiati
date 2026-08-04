"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/about/", label: "About" },
  { href: "/products/", label: "Products" },
  { href: "/contact/", label: "Contact" },
];

/**
 * Four pages fit on one row even on a small phone, so there is no hamburger to
 * open and no menu state to get stuck. The only reason this is a Client
 * Component is `usePathname`, for the current-page marker.
 */
export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="border-t border-line bg-surface">
      <div className="mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto px-2 sm:px-4">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 border-b-2 px-3 py-3 text-sm font-bold transition-colors ${
                active
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
