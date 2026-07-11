import Link from "next/link";
import { Eyebrow } from "@/components/ui";

/**
 * Compact page banner for interior pages — warm wash, breadcrumb, and an
 * optional right-hand slot. Keeps every non-home page visually consistent.
 */
export function PageHero({
  eyebrow,
  title,
  intro,
  crumb,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  crumb?: string;
}) {
  return (
    <section className="relative overflow-hidden border-b border-line bg-cream-100 glow-warm">
      <div className="hero-orb -left-24 top-0 h-64 w-64 bg-gold-300/30" />
      <div className="container-page relative py-14 sm:py-16 lg:py-20">
        {crumb && (
          <nav className="mb-5 text-sm text-ink-500" aria-label="Breadcrumb">
            <Link href="/" className="transition-colors hover:text-terra-600">
              Home
            </Link>
            <span className="mx-2 text-ink-400">/</span>
            <span className="text-ink-800">{crumb}</span>
          </nav>
        )}
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-[1.05] tracking-tight text-ink-900 sm:text-5xl">
          {title}
        </h1>
        {intro && (
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-600">{intro}</p>
        )}
      </div>
    </section>
  );
}
