"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { nav } from "@/lib/cosdep";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui";
import { MenuIcon, CloseIcon, HeartIcon } from "@/components/icons";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll when the mobile menu is open.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const closeMenu = () => setOpen(false);
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-50">
      <div
        className={`border-b transition-all duration-300 ${
          scrolled
            ? "border-sand-200 bg-canvas/85 backdrop-blur-md shadow-soft"
            : "border-transparent bg-transparent"
        }`}
      >
        <div className="container-page flex h-[4.75rem] items-center justify-between">
          <Logo />

          <nav className="hidden items-center gap-0.5 lg:flex">
            {nav.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-forest-50 text-forest-700"
                      : "text-ink-600 hover:bg-forest-50/70 hover:text-forest-700"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-2 lg:flex">
            <Button href="/get-involved#donate" variant="leaf" withArrow>
              <HeartIcon className="h-4 w-4" />
              Donate
            </Button>
          </div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-forest-800 hover:bg-forest-50 lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <CloseIcon className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-b border-sand-200 bg-canvas lg:hidden">
          <nav className="container-page flex flex-col gap-1 py-4">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMenu}
                className={`rounded-xl px-4 py-3 text-base font-medium ${
                  isActive(item.href)
                    ? "bg-forest-50 text-forest-700"
                    : "text-ink-700 hover:bg-forest-50/70"
                }`}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 border-t border-sand-200 pt-4">
              <Button
                href="/get-involved#donate"
                variant="leaf"
                size="lg"
                className="w-full"
                onClick={closeMenu}
              >
                <HeartIcon className="h-5 w-5" />
                Donate
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
