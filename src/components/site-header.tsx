"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { projects, services, profile, type Project } from "@/lib/portfolio";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui";
import { ThemeSwitcher } from "@/components/theme-switcher";
import {
  MenuIcon,
  CloseIcon,
  GitHubIcon,
  ChevronDownIcon,
  ArrowRightIcon,
  ServiceIcon,
} from "@/components/icons";

/* --------------------------------------------------------------------------
   Header with mega menus.
   - "Work" opens a panel of projects grouped by category + a featured card.
   - "Services" opens a grid of what SMP offers.
   - Desktop: hover / focus / click to open; Escape and click-outside close.
   - Mobile: single hamburger → accordion with the same two sections.
   -------------------------------------------------------------------------- */

const CATEGORY_ORDER = ["Web Apps", "Business", "NGOs", "Political"] as const;

/** Projects grouped in the category order above (skips empties, keeps order). */
const workGroups = CATEGORY_ORDER.map((category) => ({
  category,
  items: projects.filter((p) => p.category === category),
})).filter((g) => g.items.length > 0);

/** The card shown on the right of the Work panel. */
const spotlight =
  projects.find((p) => p.slug === "stackup") ??
  projects.find((p) => p.featured) ??
  projects[0];

type MenuKey = "work" | "services";

export function SiteHeader() {
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSection, setMobileSection] = useState<MenuKey | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Open/close helpers with a short close delay so the pointer can travel
  // from the trigger down into the panel without it disappearing (the gap).
  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openPanel = (key: MenuKey) => {
    cancelClose();
    setOpenMenu(key);
  };
  const closePanel = () => {
    cancelClose();
    setOpenMenu(null);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpenMenu(null), 180);
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Clear any pending close timer on unmount.
  useEffect(() => () => cancelClose(), []);

  // Close the desktop panel on route change.
  useEffect(() => {
    setOpenMenu(null);
    setMobileOpen(false);
  }, [pathname]);

  // Escape closes everything; click outside the header closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const closeMobile = () => {
    setMobileOpen(false);
    setMobileSection(null);
  };

  return (
    <header ref={headerRef} className="sticky top-0 z-50">
      <div
        className={`relative border-b transition-all duration-200 ${
          scrolled || openMenu
            ? "border-ink-700 bg-ink-900/90 backdrop-blur"
            : "border-transparent bg-transparent"
        }`}
      >
        <div className="container-page flex h-16 items-center justify-between">
          <Logo uid="hdr" />

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 text-sm lg:flex">
            <TopLink href="/" active={isActive("/")} onMouseEnter={scheduleClose}>
              Home
            </TopLink>

            <MenuTrigger
              label="Work"
              isOpen={openMenu === "work"}
              active={isActive("/work")}
              onOpen={() => openPanel("work")}
              onLeave={scheduleClose}
              onToggle={() =>
                openMenu === "work" ? closePanel() : openPanel("work")
              }
            />
            <MenuTrigger
              label="Services"
              isOpen={openMenu === "services"}
              active={false}
              onOpen={() => openPanel("services")}
              onLeave={scheduleClose}
              onToggle={() =>
                openMenu === "services" ? closePanel() : openPanel("services")
              }
            />

            <TopLink
              href="/about"
              active={isActive("/about")}
              onMouseEnter={scheduleClose}
            >
              About
            </TopLink>
            <TopLink
              href="/contact"
              active={isActive("/contact")}
              onMouseEnter={scheduleClose}
            >
              Contact
            </TopLink>
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

          <div className="flex shrink-0 items-center gap-1.5 lg:hidden">
            <ThemeSwitcher />
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-mist-200 hover:bg-ink-700"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? (
                <CloseIcon className="h-6 w-6" />
              ) : (
                <MenuIcon className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>

        {/* Desktop mega panel — full width, anchored to the header bar. */}
        {openMenu && (
          <div
            className="absolute inset-x-0 top-full hidden lg:block"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className="container-page pb-4">
              <div className="rounded-2xl border border-ink-700 bg-ink-850 p-6 shadow-[0_30px_70px_-40px_rgba(0,0,0,0.75)]">
                {openMenu === "work" ? <WorkPanel /> : <ServicesPanel />}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-b border-ink-700 bg-ink-900 lg:hidden">
          <nav className="container-page flex flex-col gap-1 py-4">
            <MobileLink href="/" active={isActive("/")} onClick={closeMobile}>
              Home
            </MobileLink>

            <MobileAccordion
              label="Work"
              open={mobileSection === "work"}
              onToggle={() =>
                setMobileSection((s) => (s === "work" ? null : "work"))
              }
            >
              <div className="flex flex-col gap-4 px-3 pb-2 pt-1">
                {workGroups.map((group) => (
                  <div key={group.category}>
                    <p className="kicker mb-1.5 text-mist-500">
                      {group.category}
                    </p>
                    <div className="flex flex-col">
                      {group.items.map((p) => (
                        <Link
                          key={p.slug}
                          href={`/work/${p.slug}`}
                          onClick={closeMobile}
                          className="rounded-md py-1.5 text-sm text-mist-300 hover:text-green-300"
                        >
                          {p.title}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
                <Link
                  href="/work"
                  onClick={closeMobile}
                  className="inline-flex items-center gap-1.5 py-1 text-sm font-semibold text-green-300"
                >
                  View all work <ArrowRightIcon className="h-4 w-4" />
                </Link>
              </div>
            </MobileAccordion>

            <MobileAccordion
              label="Services"
              open={mobileSection === "services"}
              onToggle={() =>
                setMobileSection((s) => (s === "services" ? null : "services"))
              }
            >
              <div className="flex flex-col gap-1 px-3 pb-2 pt-1">
                {services.map((s) => (
                  <Link
                    key={s.title}
                    href={s.href}
                    onClick={closeMobile}
                    className="flex items-start gap-3 rounded-md py-2 text-mist-300 hover:text-green-300"
                  >
                    <ServiceIcon
                      name={s.icon}
                      className="mt-0.5 h-5 w-5 shrink-0 text-green-400"
                    />
                    <span className="text-sm">{s.title}</span>
                  </Link>
                ))}
              </div>
            </MobileAccordion>

            <MobileLink
              href="/about"
              active={isActive("/about")}
              onClick={closeMobile}
            >
              About
            </MobileLink>
            <MobileLink
              href="/contact"
              active={isActive("/contact")}
              onClick={closeMobile}
            >
              Contact
            </MobileLink>

            <div className="mt-3 border-t border-ink-700 pt-4">
              <Button
                href="/contact"
                variant="gold"
                size="lg"
                className="w-full"
                onClick={closeMobile}
              >
                Let&rsquo;s talk
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

/* ------------------------------ Desktop bits ----------------------------- */

function TopLink({
  href,
  active,
  onMouseEnter,
  children,
}: {
  href: string;
  active: boolean;
  onMouseEnter?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onMouseEnter={onMouseEnter}
      className={`rounded-md px-3 py-2 transition-colors ${
        active ? "text-mist-100" : "text-mist-400 hover:text-mist-100"
      }`}
    >
      {children}
    </Link>
  );
}

function MenuTrigger({
  label,
  isOpen,
  active,
  onOpen,
  onLeave,
  onToggle,
}: {
  label: string;
  isOpen: boolean;
  active: boolean;
  onOpen: () => void;
  onLeave: () => void;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-haspopup="true"
      aria-expanded={isOpen}
      onMouseEnter={onOpen}
      onFocus={onOpen}
      onMouseLeave={onLeave}
      onClick={onToggle}
      className={`inline-flex items-center gap-1 rounded-md px-3 py-2 transition-colors ${
        isOpen || active
          ? "text-mist-100"
          : "text-mist-400 hover:text-mist-100"
      }`}
    >
      {label}
      <ChevronDownIcon
        className={`h-3.5 w-3.5 transition-transform duration-200 ${
          isOpen ? "rotate-180" : ""
        }`}
      />
    </button>
  );
}

function WorkPanel() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      {/* Projects by category */}
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {workGroups.map((group) => (
          <div key={group.category}>
            <p className="kicker mb-2 text-mist-500">{group.category}</p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/work/${p.slug}`}
                    className="group flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-mist-300 transition-colors hover:bg-ink-800 hover:text-mist-100"
                  >
                    <span className="truncate">{p.title}</span>
                    <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-transparent transition-colors group-hover:text-green-400" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Featured card */}
      <SpotlightCard project={spotlight} />
    </div>
  );
}

function SpotlightCard({ project }: { project: Project }) {
  const img = project.media[0];
  return (
    <Link
      href={`/work/${project.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900"
    >
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={img.src}
          alt={img.alt}
          loading="lazy"
          className="aspect-[16/10] w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
        />
      )}
      <div className="p-4">
        <p className="kicker text-green-400">Featured</p>
        <p className="mt-1 font-display font-semibold text-mist-100">
          {project.title}
        </p>
        <p className="mt-1 line-clamp-2 text-sm text-mist-400">
          {project.summary}
        </p>
        <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-green-300">
          Read the case study <ArrowRightIcon className="h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}

function ServicesPanel() {
  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((s) => (
          <Link
            key={s.title}
            href={s.href}
            className="group flex gap-3 rounded-xl border border-transparent p-3 transition-colors hover:border-ink-600 hover:bg-ink-800"
          >
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ink-600 bg-ink-900 text-green-400 transition-colors group-hover:border-green-400/50">
              <ServiceIcon name={s.icon} className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-mist-100">{s.title}</span>
              <span className="mt-0.5 block text-sm leading-snug text-mist-400">
                {s.blurb}
              </span>
            </span>
          </Link>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-ink-700 pt-4">
        <p className="text-sm text-mist-400">
          Not sure what you need? Let&rsquo;s scope it together.
        </p>
        <Button href="/contact" variant="gold">
          Start a project
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------- Mobile bits ----------------------------- */

function MobileLink({
  href,
  active,
  onClick,
  children,
}: {
  href: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`rounded-md px-4 py-3 text-base ${
        active ? "bg-ink-700 text-mist-100" : "text-mist-300 hover:bg-ink-700"
      }`}
    >
      {children}
    </Link>
  );
}

function MobileAccordion({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex w-full items-center justify-between rounded-md px-4 py-3 text-base ${
          open ? "text-mist-100" : "text-mist-300 hover:bg-ink-700"
        }`}
      >
        {label}
        <ChevronDownIcon
          className={`h-4 w-4 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && <div className="ml-1 border-l border-ink-700 pl-2">{children}</div>}
    </div>
  );
}
