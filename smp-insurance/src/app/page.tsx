import Link from "next/link";
import type { Metadata } from "next";
import { Container, SectionHeading, btnPrimary, btnWhatsApp, btnOutline, Card } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { CountUp } from "@/components/count-up";
import { FaqList } from "@/components/faq-list";
import {
  ProductIcon,
  ArrowRightIcon,
  CheckIcon,
  ShieldIcon,
  WhatsAppIcon,
  StarIcon,
  PhoneIcon,
} from "@/components/icons";
import { products } from "@/lib/products";
import { underwriters, stats, howItWorks, whyUs, testimonials, generalFaqs } from "@/lib/content";
import { site, waLink, defaultWaMessage } from "@/lib/site";

export const metadata: Metadata = {
  title: `${site.name} — Motor, Medical, Life & Business Insurance in Kenya`,
  description:
    "Compare motor, medical, life, WIBA and business insurance quotes from Kenya's leading underwriters. IRA-regulated agency. Quotes in 2 hours — on WhatsApp, paid by M-PESA.",
};

export default function HomePage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-navy-950">
        {/* Decorative shield grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, #7fa3cd 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-navy-600/30 blur-3xl"
        />
        <Container className="relative py-20 sm:py-28">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-bold text-navy-200">
              <ShieldIcon className="h-4 w-4 text-cta-400" />
              Regulated by the Insurance Regulatory Authority (IRA)
            </p>
            <h1 className="mt-6 font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-6xl">
              Insurance that shows up{" "}
              <span className="text-cta-400">when it matters.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-navy-200">
              Motor, medical, life and business covers compared across
              Kenya&apos;s leading underwriters — quoted in plain language,
              paid by M-PESA, and backed by an agency that fights for your
              claim.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/quote/" className={btnPrimary}>
                Get a free quote <ArrowRightIcon className="h-5 w-5" />
              </Link>
              <a
                href={waLink(defaultWaMessage)}
                target="_blank"
                rel="noopener noreferrer"
                className={btnWhatsApp}
              >
                <WhatsAppIcon className="h-5 w-5" /> WhatsApp us
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-navy-200">
              {[site.quotePromise, "Pay via M-PESA — instalments available", "Claims support 7 days a week"].map(
                (t) => (
                  <li key={t} className="inline-flex items-center gap-2">
                    <CheckIcon className="h-4 w-4 text-cta-400" /> {t}
                  </li>
                ),
              )}
            </ul>
          </div>
        </Container>
      </section>

      {/* ── Products ──────────────────────────────────────────────────── */}
      <section className="py-16 sm:py-24">
        <Container>
          <SectionHeading
            eyebrow="What we cover"
            title="Every cover your life and business need"
            lead="One agency, one number to call — for your car, your health, your family, your staff and your shamba."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p, i) => (
              <Reveal key={p.slug} delay={Math.min(i * 60, 300)}>
                <Link
                  href={`/products/${p.slug}/`}
                  className="group flex h-full flex-col rounded-2xl border border-paper-300 bg-paper-50 p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-navy-400 hover:shadow-md"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-navy-50 text-navy-600 transition group-hover:bg-navy-900 group-hover:text-cta-400">
                    <ProductIcon name={p.icon} className="h-6 w-6" />
                  </span>
                  <h3 className="mt-4 font-display text-lg font-bold text-slate-900">
                    {p.name}
                  </h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">
                    {p.tagline}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-navy-600 transition group-hover:gap-2.5">
                    Learn more <ArrowRightIcon className="h-4 w-4" />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Stats band ────────────────────────────────────────────────── */}
      <section className="bg-navy-900 py-14">
        <Container>
          <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="text-center">
                <p className="font-display text-4xl font-extrabold text-white">
                  <CountUp value={s.value} suffix={s.suffix} />
                </p>
                <p className="mt-2 text-sm leading-snug text-navy-200">{s.label}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Underwriters ──────────────────────────────────────────────── */}
      <section className="border-b border-paper-300 bg-paper-200 py-10">
        <Container>
          <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
            We compare covers from Kenya&apos;s leading IRA-licensed underwriters
          </p>
        </Container>
        <div className="mt-6 overflow-hidden" aria-hidden>
          <div className="flex w-max animate-marquee gap-4 pr-4">
            {[...underwriters, ...underwriters].map((u, i) => (
              <span
                key={`${u}-${i}`}
                className="whitespace-nowrap rounded-full border border-paper-400 bg-paper-50 px-5 py-2 font-display text-sm font-bold text-navy-700"
              >
                {u}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────── */}
      <section className="py-16 sm:py-24">
        <Container>
          <SectionHeading
            eyebrow="How it works"
            title="From 'I need cover' to covered — in four steps"
          />
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {howItWorks.map((s, i) => (
              <Reveal key={s.title} delay={i * 80}>
                <Card className="h-full">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy-900 font-display text-base font-extrabold text-cta-400">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 font-display text-base font-bold text-slate-900">
                    {s.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-500">{s.text}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Why SMP / claims promise ──────────────────────────────────── */}
      <section className="bg-navy-950 py-16 sm:py-24">
        <Container>
          <div className="grid items-start gap-12 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <SectionHeading
                eyebrow="Why SMP"
                title="The agency that earns its keep at claim time"
                lead="Anyone can sell you a policy. Our job is making sure it pays."
                align="left"
                dark
              />
              <Link href="/about/" className={`${btnOutline} mt-8`}>
                More about us <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {whyUs.map((w, i) => (
                <Reveal key={w.title} delay={i * 70}>
                  <div className="h-full rounded-2xl border border-white/10 bg-white/5 p-6">
                    <h3 className="font-display text-base font-bold text-white">
                      {w.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-navy-200">{w.text}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </Container>
      </section>

      {/* ── Testimonials ──────────────────────────────────────────────── */}
      <section className="py-16 sm:py-24">
        <Container>
          <SectionHeading
            eyebrow="Client stories"
            title="Claims paid. Promises kept."
          />
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {testimonials.map((t, i) => (
              <Reveal key={t.name} delay={i * 80}>
                <Card className="flex h-full flex-col">
                  <div className="flex gap-1 text-cta-500" aria-label="5 star rating">
                    {Array.from({ length: 5 }).map((_, s) => (
                      <StarIcon key={s} className="h-4 w-4" />
                    ))}
                  </div>
                  <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-slate-700">
                    “{t.quote}”
                  </blockquote>
                  <footer className="mt-4 border-t border-paper-300 pt-4">
                    <p className="font-display text-sm font-bold text-slate-900">{t.name}</p>
                    <p className="text-xs text-slate-500">{t.detail}</p>
                  </footer>
                </Card>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ── FAQ preview ───────────────────────────────────────────────── */}
      <section className="pb-16 sm:pb-24">
        <Container className="max-w-3xl">
          <SectionHeading eyebrow="Good to know" title="Questions Kenyans ask us" />
          <div className="mt-10">
            <FaqList faqs={generalFaqs.slice(0, 4)} />
          </div>
          <p className="mt-6 text-center text-sm text-slate-500">
            More questions?{" "}
            <Link href="/faq/" className="font-bold text-navy-600 hover:text-navy-500">
              Read the full FAQ →
            </Link>
          </p>
        </Container>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────── */}
      <section className="bg-navy-900 py-16 sm:py-20">
        <Container className="text-center">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Two minutes now. Peace of mind for the year.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-navy-200">
            Tell us what you need to protect — we&apos;ll bring back real
            quotes from Kenya&apos;s top underwriters, {site.quotePromise.toLowerCase()}.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/quote/" className={btnPrimary}>
              Get a free quote <ArrowRightIcon className="h-5 w-5" />
            </Link>
            <a href={`tel:${site.phoneHref}`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/25 px-6 py-3.5 font-display text-base font-bold text-white transition hover:bg-white/10">
              <PhoneIcon className="h-5 w-5" /> {site.phone}
            </a>
          </div>
        </Container>
      </section>
    </>
  );
}
