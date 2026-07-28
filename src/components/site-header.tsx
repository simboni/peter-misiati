"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { nav } from "@/lib/keysa";
import { Logo } from "@/components/logo";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { CloseIcon, HeartIcon, MenuIcon } from "@/components/icons";

function subscribeScroll(callback: () => void) {
  window.addEventListener("scroll", callback, { passive: true });
  return () => window.removeEventListener("scroll", callback);
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const scrolled = useSyncExternalStore(
    subscribeScroll,
    () => window.scrollY > 8,
    () => false,
  );

  // Lock page scroll while the mobile menu is open.
  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  const close = () => setOpen(false);
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href.replace(/\/$/, ""));

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-colors duration-300 ${
        scrolled || open
          ? "border-ink-600 bg-ink-900/90 backdrop-blur-md"
          : "border-transparent bg-transparent"
      }`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-green-400 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-accent"
      >
        Skip to content
      </a>
      <div className="container-page flex h-18 items-center justify-between gap-4 py-3">
        <Logo />

        {/* Desktop nav */}
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                isActive(item.href)
                  ? "bg-green-400/10 text-green-300"
                  : "text-mist-400 hover:text-mist-100"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          <ThemeSwitcher />
          <Link
            href="/donate/"
            className="hidden items-center gap-2 rounded-full bg-accent-400 px-5 py-2.5 text-sm font-semibold text-on-red shadow-[0_10px_24px_-12px_var(--color-accent-500)] transition-colors hover:bg-accent-500 sm:inline-flex"
          >
            <HeartIcon className="h-4 w-4" />
            Donate
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-ink-600 text-mist-300 lg:hidden"
          >
            {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="border-t border-ink-600 bg-ink-900 lg:hidden"
        >
          <div className="container-page flex flex-col gap-1 py-4">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`rounded-xl px-4 py-3 text-base font-medium ${
                  isActive(item.href)
                    ? "bg-green-400/10 text-green-300"
                    : "text-mist-300 hover:bg-ink-850"
                }`}
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/donate/"
              onClick={close}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-accent-400 px-5 py-3 text-sm font-semibold text-on-red"
            >
              <HeartIcon className="h-4 w-4" />
              Donate
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
