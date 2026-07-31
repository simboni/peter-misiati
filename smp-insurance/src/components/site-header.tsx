"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { PhoneIcon, WhatsAppIcon, XIcon } from "@/components/icons";
import { products } from "@/lib/products";
import { site, waLink, defaultWaMessage } from "@/lib/site";

const navLinks = [
  { href: "/products/", label: "Products", hasMenu: true },
  { href: "/claims/", label: "Claims" },
  { href: "/about/", label: "About" },
  { href: "/faq/", label: "FAQ" },
  { href: "/contact/", label: "Contact" },
];

export function SiteHeader() {
  const pathname = usePathname();
  // The menu remembers which path it was opened on, so navigating away
  // closes it automatically — no effect needed.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const setOpen = (v: boolean) => setOpenedAt(v ? pathname : null);

  return (
    <header className="sticky top-0 z-40">
      {/* Top strip: phone + credibility */}
      <div className="bg-navy-950 text-navy-200">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-1.5 text-xs sm:px-6">
          <p className="hidden sm:block">
            Regulated by the Insurance Regulatory Authority (IRA)
          </p>
          <div className="flex items-center gap-4">
            <a
              href={`tel:${site.phoneHref}`}
              className="inline-flex items-center gap-1.5 font-semibold text-white transition hover:text-cta-300"
            >
              <PhoneIcon className="h-3.5 w-3.5" />
              {site.phone}
            </a>
            <span className="hidden text-navy-300 md:block">{site.hours}</span>
          </div>
        </div>
      </div>

      {/* Main bar */}
      <div className="border-b border-paper-300 bg-paper-50/95 backdrop-blur supports-[backdrop-filter]:bg-paper-50/85">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="SMP Insurance Agency — home">
            <Logo />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
            {navLinks.map((link) =>
              link.hasMenu ? (
                <div key={link.href} className="group relative">
                  <Link
                    href={link.href}
                    className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition hover:bg-navy-50 hover:text-navy-900 ${
                      pathname?.startsWith("/products")
                        ? "text-navy-900"
                        : "text-slate-700"
                    }`}
                  >
                    {link.label}
                    <span aria-hidden className="ml-1 text-slate-400">
                      ▾
                    </span>
                  </Link>
                  {/* Mega menu — padded wrapper keeps hover alive across the gap */}
                  <div className="invisible absolute left-1/2 top-full z-50 -translate-x-1/2 pt-2 opacity-0 transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                    <div className="w-[560px] rounded-2xl border border-paper-300 bg-paper-50 p-4 shadow-xl">
                      <div className="grid grid-cols-2 gap-1">
                        {products.map((p) => (
                          <Link
                            key={p.slug}
                            href={`/products/${p.slug}/`}
                            className="rounded-xl px-3 py-2.5 transition hover:bg-navy-50"
                          >
                            <span className="block text-sm font-bold text-navy-900">
                              {p.navLabel}
                            </span>
                            <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                              {p.name}
                            </span>
                          </Link>
                        ))}
                      </div>
                      <div className="mt-3 border-t border-paper-300 pt-3 text-center">
                        <Link
                          href="/products/"
                          className="text-sm font-bold text-navy-600 hover:text-navy-500"
                        >
                          View all products →
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition hover:bg-navy-50 hover:text-navy-900 ${
                    pathname === link.href ? "text-navy-900" : "text-slate-700"
                  }`}
                >
                  {link.label}
                </Link>
              ),
            )}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href={waLink(defaultWaMessage)}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-2 rounded-xl border border-paper-300 px-4 py-2.5 text-sm font-bold text-navy-900 transition hover:border-[#25D366] hover:text-[#128C4B] md:inline-flex"
            >
              <WhatsAppIcon className="h-4 w-4 text-[#25D366]" />
              WhatsApp
            </a>
            <Link
              href="/quote/"
              className="inline-flex items-center rounded-xl bg-cta-500 px-4 py-2.5 text-sm font-bold text-navy-950 shadow-md shadow-cta-500/25 transition hover:bg-cta-400"
            >
              Get a Quote
            </Link>

            {/* Mobile menu toggle */}
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-label={open ? "Close menu" : "Open menu"}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-paper-300 text-navy-900 lg:hidden"
            >
              {open ? (
                <XIcon className="h-5 w-5" />
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {open ? (
          <nav
            className="border-t border-paper-300 bg-paper-50 px-4 pb-6 pt-2 lg:hidden"
            aria-label="Mobile"
          >
            <p className="px-2 pb-1 pt-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
              Products
            </p>
            <div className="grid grid-cols-2 gap-1">
              {products.map((p) => (
                <Link
                  key={p.slug}
                  href={`/products/${p.slug}/`}
                  className="rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 transition hover:bg-navy-50 hover:text-navy-900"
                >
                  {p.navLabel}
                </Link>
              ))}
            </div>
            <div className="mt-2 grid gap-1 border-t border-paper-300 pt-2">
              {navLinks
                .filter((l) => !l.hasMenu)
                .map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-lg px-2 py-2.5 text-sm font-bold text-navy-900 transition hover:bg-navy-50"
                  >
                    {link.label}
                  </Link>
                ))}
            </div>
            <div className="mt-3 flex gap-2">
              <a
                href={`tel:${site.phoneHref}`}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-navy-900 px-4 py-3 text-sm font-bold text-white"
              >
                <PhoneIcon className="h-4 w-4" /> Call us
              </a>
              <a
                href={waLink(defaultWaMessage)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-sm font-bold text-[#073b1c]"
              >
                <WhatsAppIcon className="h-4 w-4" /> WhatsApp
              </a>
            </div>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
