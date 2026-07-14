"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { nav, profile } from "@/lib/portfolio";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { MenuIcon, CloseIcon, GitHubIcon } from "@/components/icons";

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

  const closeMenu = () => setOpen(false);
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-50">
      <div
        className={`border-b transition-all duration-200 ${
          scrolled
            ? "border-ink-700 bg-ink-900/80 backdrop-blur"
            : "border-transparent bg-transparent"
        }`}
      >
        <div className="container-page flex h-16 items-center justify-between">
          <Logo uid="hdr" />

          <nav className="hidden items-center gap-1 text-sm lg:flex">
            {nav.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-2 transition-colors ${
                    active ? "text-mist-100" : "text-mist-400 hover:text-mist-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <ThemeSwitcher />
            {profile.socials.github && (
              <a
                href={profile.socials.github}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-mist-400 transition-colors hover:bg-ink-700 hover:text-green-400"
              >
                <GitHubIcon className="h-5 w-5" />
              </a>
            )}
            <Button href="/contact" variant="gold">
              Let&rsquo;s talk
            </Button>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <ThemeSwitcher />
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-mist-200 hover:bg-ink-700"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
            >
              {open ? <CloseIcon className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div className="border-b border-ink-700 bg-ink-900 lg:hidden">
          <nav className="container-page flex flex-col gap-1 py-4">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMenu}
                className={`rounded-md px-4 py-3 text-base ${
                  isActive(item.href)
                    ? "bg-ink-700 text-mist-100"
                    : "text-mist-300 hover:bg-ink-700"
                }`}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 border-t border-ink-700 pt-4">
              <Button href="/contact" variant="gold" size="lg" className="w-full" onClick={closeMenu}>
                Let&rsquo;s talk
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
