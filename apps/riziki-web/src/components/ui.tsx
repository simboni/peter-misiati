/**
 * Shared building blocks for the public site.
 *
 * Kept deliberately small: this is a four-page brochure, and every abstraction
 * that exists has to earn its place in the bundle a customer downloads on
 * mobile data.
 */

import Link from "next/link";
import type { ReactNode } from "react";

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-5xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

/** A page band. `tone` sets the background so sections separate without borders. */
export function Section({
  children,
  tone = "page",
  className = "",
  id,
}: {
  children: ReactNode;
  tone?: "page" | "surface" | "wash";
  className?: string;
  id?: string;
}) {
  const bg =
    tone === "surface" ? "bg-surface" : tone === "wash" ? "bg-surface-2" : "bg-transparent";
  return (
    <section id={id} className={`${bg} py-12 sm:py-16 ${className}`}>
      <Container>{children}</Container>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  as: Tag = "h2",
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  as?: "h1" | "h2";
}) {
  return (
    <header className="max-w-2xl">
      {eyebrow ? (
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-accent">{eyebrow}</p>
      ) : null}
      <Tag className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</Tag>
      {lead ? <p className="mt-3 text-base leading-relaxed text-muted">{lead}</p> : null}
    </header>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-line bg-surface p-5 ${className}`}>{children}</div>
  );
}

type ButtonTone = "whatsapp" | "brand" | "outline";

const TONE_CLASSES: Record<ButtonTone, string> = {
  whatsapp: "bg-leaf-strong text-white hover:brightness-95",
  brand: "bg-brand text-white hover:brightness-110",
  outline: "border border-line bg-surface text-ink hover:bg-surface-2",
};

/**
 * Calls to action are plain anchors, not buttons: `tel:` and `wa.me` are
 * navigations, and a link is what a screen reader and a long-press both expect.
 */
export function CtaLink({
  href,
  tone = "brand",
  children,
  className = "",
  external = false,
}: {
  href: string;
  tone?: ButtonTone;
  children: ReactNode;
  className?: string;
  external?: boolean;
}) {
  const classes = `inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition-[filter,background-color] ${TONE_CLASSES[tone]} ${className}`;

  if (external || href.startsWith("http") || href.startsWith("tel:")) {
    return (
      <a
        href={href}
        className={classes}
        {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}

/** A small labelled tag — pack sizes, categories. */
export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "leaf" }) {
  const classes =
    tone === "accent"
      ? "bg-accent-soft text-accent"
      : tone === "leaf"
        ? "bg-leaf-soft text-leaf-ink"
        : "bg-surface-2 text-muted";
  return (
    <span className={`inline-block rounded-md px-2 py-1 text-xs font-semibold ${classes}`}>
      {children}
    </span>
  );
}

/**
 * Content the client still has to supply. Marked in the UI rather than filled
 * with a plausible guess, so nothing untrue about a real business ships.
 */
export function ToConfirm({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-leaf-soft px-2 py-1 text-sm font-semibold text-leaf-ink">
      {children}
    </span>
  );
}

export function WhatsAppIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.02h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.39c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.24 8.24c0 4.54-3.7 8.24-8.24 8.24Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.09-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.85.84-.85 2.04s.87 2.37.99 2.53c.12.16 1.71 2.61 4.14 3.66.58.25 1.03.4 1.38.51.58.19 1.11.16 1.53.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.11-.22-.17-.47-.29Z" />
    </svg>
  );
}

export function PhoneIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.7 21 3 13.3 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .7-.2 1l-2.3 2.2Z" />
    </svg>
  );
}
