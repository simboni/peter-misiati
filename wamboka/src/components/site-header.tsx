"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { nav } from "@/lib/data";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href.replace(/\/$/, ""));

  return (
    <header className="sticky top-0 z-40 border-b border-paper-600 bg-paper-900/90 backdrop-blur">
      <div className="kenya-band h-1" aria-hidden />
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
        <Link href="/" className="group flex items-baseline gap-2">
          <span className="font-display text-lg font-bold tracking-tight text-ink-100">
            Wamboka
          </span>
          <span className="font-mono text-[10px] tracking-[0.25em] text-green-600 uppercase">
            The Record
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                isActive(item.href)
                  ? "bg-green-400 font-medium text-on-accent"
                  : "text-ink-400 hover:bg-paper-700 hover:text-ink-200"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-paper-600 p-2 text-ink-300 md:hidden"
          aria-expanded={open}
          aria-label="Toggle navigation"
        >
          <svg viewBox="0 0 20 20" className="size-4 fill-current">
            {open ? (
              <path d="M4.3 3 3 4.3 8.7 10 3 15.7 4.3 17 10 11.3l5.7 5.7 1.3-1.3-5.7-5.7L17 4.3 15.7 3 10 8.7Z" />
            ) : (
              <path d="M2 4h16v2H2zm0 5h16v2H2zm0 5h16v2H2z" />
            )}
          </svg>
        </button>
      </div>

      {open ? (
        <nav className="border-t border-paper-600 px-5 py-3 md:hidden">
          <ul className="flex flex-col gap-1">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`block rounded-md px-3 py-2 text-sm ${
                    isActive(item.href)
                      ? "bg-green-400 font-medium text-on-accent"
                      : "text-ink-400 hover:bg-paper-700"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
