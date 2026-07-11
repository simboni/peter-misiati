import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ministries, getMinistry } from "@/lib/site";
import { Button, Eyebrow, Section } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import {
  MinistryIcon,
  CheckIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  HeartHandIcon,
} from "@/components/icons";

export function generateStaticParams() {
  return ministries.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const m = getMinistry(slug);
  if (!m) return { title: "Ministry not found" };
  return {
    title: m.name,
    description: m.summary,
    openGraph: { title: m.name, description: m.summary, images: [m.image] },
  };
}

const accentText: Record<string, string> = {
  terra: "text-terra-600",
  gold: "text-gold-600",
  sky: "text-sky-600",
  sage: "text-sage-600",
};
const accentBg: Record<string, string> = {
  terra: "bg-terra-50",
  gold: "bg-gold-200/40",
  sky: "bg-sky-500/10",
  sage: "bg-sage-500/12",
};

export default async function MinistryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const m = getMinistry(slug);
  if (!m) notFound();

  const index = ministries.findIndex((x) => x.slug === m.slug);
  const next = ministries[(index + 1) % ministries.length];

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-terra-900 text-cream-100">
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.image} alt={m.name} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-terra-900/95 via-terra-900/80 to-terra-900/45" />
        </div>
        <div className="container-page relative py-16 sm:py-20 lg:py-24">
          <nav className="mb-6 text-sm text-cream-200/70" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-gold-300">
              Home
            </Link>
            <span className="mx-2">/</span>
            <Link href="/ministries" className="hover:text-gold-300">
              Ministries
            </Link>
            <span className="mx-2">/</span>
            <span className="text-cream-100">{m.name}</span>
          </nav>
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-cream-50/95 text-terra-700">
            <MinistryIcon name={m.icon} className="h-7 w-7" />
          </span>
          <Eyebrow className="mt-6 !text-gold-300">{m.tagline}</Eyebrow>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-[1.05] text-cream-50 sm:text-5xl">
            {m.name}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-cream-200/90">{m.summary}</p>
        </div>
      </section>

      {/* Body */}
      <Section className="bg-cream-50">
        <div className="grid gap-12 lg:grid-cols-12">
          <article className="lg:col-span-7">
            {m.quote && (
              <blockquote className="mb-8 border-l-2 border-gold-400 pl-5">
                <p className="font-display text-2xl font-medium italic leading-snug text-terra-700">
                  “{m.quote.text}”
                </p>
                {m.quote.by && (
                  <cite className="mt-2 block text-sm font-semibold not-italic text-ink-500">
                    — {m.quote.by}
                  </cite>
                )}
              </blockquote>
            )}
            <div className="space-y-5 text-lg leading-relaxed text-ink-600">
              {m.body.map((p, i) => (
                <Reveal key={i} delay={i * 40}>
                  <p>{p}</p>
                </Reveal>
              ))}
            </div>

            {m.gallery && m.gallery.length > 1 && (
              <div className="mt-10 grid gap-4 sm:grid-cols-2">
                {m.gallery.map((src) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={src}
                    src={src}
                    alt={m.name}
                    loading="lazy"
                    className="h-56 w-full rounded-2xl border border-line object-cover"
                  />
                ))}
              </div>
            )}
          </article>

          {/* Sidebar */}
          <aside className="lg:col-span-5">
            <div className="sticky top-28 space-y-6">
              <div className="card p-6">
                <h2 className={`text-xs font-semibold uppercase tracking-[0.18em] ${accentText[m.accent]}`}>
                  What this looks like
                </h2>
                <ul className="mt-4 space-y-3">
                  {m.highlights.map((h) => (
                    <li key={h} className="flex gap-3 text-ink-700">
                      <span className={`mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${accentBg[m.accent]} ${accentText[m.accent]}`}>
                        <CheckIcon className="h-3.5 w-3.5" />
                      </span>
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="card overflow-hidden bg-terra-50 p-6 text-center">
                <p className="font-display text-lg font-medium text-ink-900">
                  Help us carry this ministry further
                </p>
                <Button href="/donate" variant="primary" className="mt-4 w-full">
                  <HeartHandIcon className="h-4 w-4" /> Support this work
                </Button>
                <Link
                  href="/contact"
                  className="mt-3 inline-flex items-center justify-center gap-1.5 text-sm font-medium text-terra-600 hover:text-terra-700"
                >
                  <ArrowUpRightIcon className="h-4 w-4" /> Volunteer with us
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </Section>

      {/* Next ministry */}
      <section className="border-t border-line bg-cream-100">
        <div className="container-page py-12">
          <Link
            href={`/ministries/${next.slug}`}
            className="group flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"
          >
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-terra-500">
                Next ministry
              </div>
              <div className="mt-1 font-display text-2xl font-semibold text-ink-900 group-hover:text-terra-600">
                {next.name}
              </div>
            </div>
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-line-strong bg-white text-terra-600 transition-transform group-hover:translate-x-1">
              <ArrowRightIcon className="h-5 w-5" />
            </span>
          </Link>
        </div>
      </section>
    </>
  );
}
