"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { nav, contact } from "@/lib/site";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui";
import { MenuIcon, CloseIcon, PhoneIcon, HeartHandIcon } from "@/components/icons";

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
      {/* Utility strip */}
      <div className="hidden bg-terra-700 text-cream-100 lg:block">
        <div className="container-page flex h-9 items-center justify-between text-xs">
          <span className="tracking-wide">Canossian Daughters of Charity · Servants of the Poor</span>
          <a href={contact.phoneHref} className="inline-flex items-center gap-1.5 font-medium hover:text-gold-300">
            <PhoneIcon className="h-3.5 w-3.5" /> {contact.phone}
          </a>
        </div>
      </div>

      <div
        className={`border-b transition-all duration-200 ${
          scrolled
            ? "border-line bg-cream-50/90 backdrop-blur-md"
            : "border-transparent bg-cream-50/70 backdrop-blur-sm"
        }`}
      >
        <div className="container-page flex h-18 items-center justify-between py-3">
          <Logo uid="hdr" />

          <nav className="hidden items-center gap-1 text-sm font-medium lg:flex">
            {nav.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-4 py-2 transition-colors ${
                    active
                      ? "bg-terra-50 text-terra-700"
                      : "text-ink-700 hover:bg-cream-100 hover:text-terra-600"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden lg:block">
            <Button href="/donate" variant="gold" withArrow>
              <HeartHandIcon className="h-4 w-4" /> Donate
            </Button>
          </div>

          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line-strong text-ink-800 lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="fixed inset-0 top-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/40" onClick={closeMenu} />
          <div className="absolute inset-x-0 top-0 origin-top bg-cream-50 shadow-xl">
            <div className="container-page flex h-18 items-center justify-between py-3">
              <Logo uid="mob" />
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line-strong text-ink-800"
                aria-label="Close menu"
                onClick={closeMenu}
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
            <nav className="container-page flex flex-col gap-1 pb-6 pt-2">
              {nav.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={closeMenu}
                    className={`rounded-xl px-4 py-3 text-base font-medium transition-colors ${
                      active ? "bg-terra-50 text-terra-700" : "text-ink-800 hover:bg-cream-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <div className="mt-3 flex flex-col gap-3">
                <Button href="/donate" variant="gold" size="lg" onClick={closeMenu} withArrow>
                  <HeartHandIcon className="h-5 w-5" /> Donate
                </Button>
                <a
                  href={contact.phoneHref}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-line-strong px-5 py-3 text-sm font-medium text-ink-800"
                >
                  <PhoneIcon className="h-4 w-4" /> {contact.phone}
                </a>
              </div>
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
