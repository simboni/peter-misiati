import Link from "next/link";
import {
  ministries,
  causes,
  stats,
  faqs,
  updates,
  identity,
  founder,
  testimonial,
} from "@/lib/site";
import { Button, Section, SectionHeading, Eyebrow, Rubric } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { CountUp } from "@/components/count-up";
import { MinistryCard } from "@/components/ministry-card";
import { ProgressBar } from "@/components/progress-bar";
import { Faq } from "@/components/faq";
import { ArrowRightIcon, HeartHandIcon, ArrowUpRightIcon } from "@/components/icons";

export default function HomePage() {
  return (
    <>
      <Hero />
      <AnniversaryBanner />
      <IntroSection />
      <MinistriesSection />
      <ImpactSection />
      <CausesSection />
      <ServiceSplit />
      <FaqSection />
      <UpdatesSection />
      <CtaBand />
    </>
  );
}

/* --------------------------------- Hero ---------------------------------- */

function Hero() {
  return (
    <section className="relative overflow-hidden bg-terra-900 text-cream-100">
      <div className="absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/sisters-arusha.jpg"
          alt="Canossian Sisters of the North East Africa Province"
          className="h-full w-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-terra-900/95 via-terra-900/80 to-terra-900/40" />
        <div className="absolute inset-0 bg-gradient-to-t from-terra-900 via-transparent to-transparent" />
      </div>

      <div className="hero-orb right-[8%] top-[12%] h-72 w-72 bg-gold-400/20" />

      <div className="container-page relative">
        <div className="hero-stagger flex max-w-2xl flex-col items-start py-24 sm:py-28 lg:py-36">
          <Eyebrow className="!text-gold-300">
            Daughters of Charity · Servants of the Poor
          </Eyebrow>
          <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.03] tracking-tight text-cream-50 sm:text-5xl lg:text-6xl">
            Loving without measure, in and for the mission of today.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-cream-200/90">
            The Canossian Sisters serve the poor, needy and marginalized across Tanzania,
            Kenya, Uganda and Sudan — through education, evangelization, healthcare and prayer.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Button href="/donate" variant="gold" size="lg">
              <HeartHandIcon className="h-5 w-5" /> Support our mission
            </Button>
            <Button
              href="/ministries"
              size="lg"
              className="border border-cream-100/30 bg-cream-50/5 text-cream-50 hover:bg-cream-50/10"
              withArrow
            >
              Our ministries
            </Button>
          </div>

          <div className="mt-12 flex items-center gap-8">
            <HeroStat value="100,000+" label="Lives touched" />
            <span className="h-10 w-px bg-cream-100/20" />
            <HeroStat value="4" label="Countries served" />
            <span className="hidden h-10 w-px bg-cream-100/20 sm:block" />
            <HeroStat value="5" label="Ministries" className="hidden sm:flex" />
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroStat({
  value,
  label,
  className = "",
}: {
  value: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col ${className}`}>
      <span className="font-display text-2xl font-semibold text-gold-300 sm:text-3xl">
        {value}
      </span>
      <span className="text-xs uppercase tracking-wider text-cream-200/70">{label}</span>
    </div>
  );
}

/* --------------------------- Anniversary banner -------------------------- */

function AnniversaryBanner() {
  return (
    <div className="border-b border-line bg-gold-400">
      <div className="container-page flex flex-col items-center justify-center gap-2 py-3.5 text-center text-sm text-terra-900 sm:flex-row sm:gap-3">
        <span className="inline-flex items-center gap-2 font-semibold">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-terra-900/10">✦</span>
          {founder.anniversary}
        </span>
        <span className="hidden text-terra-900/50 sm:inline">·</span>
        <span>Celebrating 250 years since the birth of {founder.name}</span>
        <Link
          href="/about"
          className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:text-terra-700"
        >
          Learn more <ArrowRightIcon className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

/* -------------------------------- Intro ---------------------------------- */

function IntroSection() {
  return (
    <Section className="bg-cream-50">
      <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-6">
          <Reveal>
            <Eyebrow>Who we are</Eyebrow>
            <h2 className="mt-4 font-display text-3xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-4xl">
              Canossian Daughters of Charity, Servants of the Poor
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-ink-600">{identity.charism}</p>
            <div className="mt-8 space-y-5">
              <ValueLine label="Our vision">{identity.vision}</ValueLine>
              <ValueLine label="Our mission">{identity.mission}</ValueLine>
            </div>
            <div className="mt-8">
              <Button href="/about" variant="outline" withArrow>
                More about us
              </Button>
            </div>
          </Reveal>
        </div>

        <div className="lg:col-span-6">
          <Reveal variant="left" className="relative">
            <div className="grid grid-cols-2 gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/evangelization-bukoba.jpg"
                alt="Canossian Sisters in the community"
                loading="lazy"
                className="col-span-2 h-64 w-full rounded-2xl border border-line object-cover"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/healthcare.jpg"
                alt="Pastoral healthcare ministry"
                loading="lazy"
                className="h-44 w-full rounded-2xl border border-line object-cover"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/education-class.jpg"
                alt="Education ministry"
                loading="lazy"
                className="h-44 w-full rounded-2xl border border-line object-cover"
              />
            </div>
            <div className="card absolute -bottom-6 -left-4 hidden items-center gap-3 px-5 py-4 sm:flex">
              <span className="font-display text-3xl font-semibold text-terra-600">1808</span>
              <span className="max-w-[9rem] text-xs leading-snug text-ink-600">
                Serving the poor since our founding
              </span>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

function ValueLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="mt-1 h-fit shrink-0 rounded-full bg-terra-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-terra-600">
        {label}
      </span>
      <p className="text-ink-600">{children}</p>
    </div>
  );
}

/* ------------------------------ Ministries ------------------------------- */

function MinistriesSection() {
  return (
    <Section className="bg-cream-100 bg-dots">
      <div className="flex flex-col items-center text-center">
        <SectionHeading
          align="center"
          eyebrow="Our ministries"
          title="One mission of charity, lived five ways"
          intro="We dedicate ourselves to serve the poor, needy and the marginalized through our five ministries."
        />
      </div>
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {ministries.map((m, i) => (
          <Reveal key={m.slug} delay={i * 60}>
            <MinistryCard ministry={m} />
          </Reveal>
        ))}
        <Reveal delay={ministries.length * 60}>
          <Link
            href="/ministries"
            className="group flex h-full min-h-64 flex-col justify-between rounded-2xl border border-dashed border-terra-300 bg-terra-50/50 p-6 transition-colors hover:bg-terra-50"
          >
            <span className="font-display text-xl font-semibold text-terra-700">
              Explore every ministry
            </span>
            <span className="inline-flex items-center gap-2 text-sm font-medium text-terra-600">
              See all five in detail
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </span>
          </Link>
        </Reveal>
      </div>
    </Section>
  );
}

/* -------------------------------- Impact --------------------------------- */

function ImpactSection() {
  return (
    <section className="relative overflow-hidden bg-terra-800 text-cream-100">
      <div className="absolute inset-0 bg-dots opacity-30" />
      <div className="container-page relative py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <Rubric className="mx-auto mb-6 max-w-xs" />
          <h2 className="font-display text-3xl font-semibold text-cream-50 sm:text-4xl">
            A charity that has touched lives
          </h2>
          <p className="mt-4 text-cream-200/80">
            The fruit of the Sisters&rsquo; service across the North East Africa Province.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-2 gap-8 lg:grid-cols-4">
          {stats.map((s, i) => (
            <Reveal key={s.label} delay={i * 80} className="text-center">
              <div className="font-display text-4xl font-semibold text-gold-300 sm:text-5xl">
                <CountUp end={s.value} suffix={s.suffix} />
              </div>
              <div className="mt-2 text-sm font-medium text-cream-50">{s.label}</div>
              <div className="mt-1 text-xs leading-snug text-cream-200/60">{s.note}</div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- Causes --------------------------------- */

function CausesSection() {
  return (
    <Section className="bg-cream-50">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeading
          eyebrow="Ongoing causes"
          title="Join us in our ongoing causes"
          intro="Your generosity helps build schools, fund scholarships and equip our hospital."
        />
        <Button href="/causes" variant="ghost" withArrow className="shrink-0 self-start sm:self-auto">
          View all causes
        </Button>
      </div>
      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {causes.map((c, i) => (
          <Reveal key={c.slug} delay={i * 70}>
            <article className="card flex h-full flex-col overflow-hidden p-0">
              <div className="relative aspect-[16/10] overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.image} alt={c.title} loading="lazy" className="h-full w-full object-cover" />
              </div>
              <div className="flex flex-1 flex-col p-6">
                <h3 className="font-display text-lg font-semibold text-ink-900">{c.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-600">{c.summary}</p>
                <div className="mt-5">
                  <ProgressBar value={c.progress} accent={c.accent} />
                </div>
                <Button href="/donate" variant="outline" className="mt-5 w-full" withArrow>
                  Donate to this cause
                </Button>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ----------------------------- Service split ----------------------------- */

function ServiceSplit() {
  return (
    <section className="relative overflow-hidden">
      <div className="grid lg:grid-cols-2">
        <div className="relative min-h-88 lg:min-h-128">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/evangelization.jpg"
            alt="Service to humanity"
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
        <div className="flex items-center bg-sage-700 px-6 py-16 text-cream-100 sm:px-10 lg:px-16 lg:py-20">
          <Reveal className="max-w-xl">
            <Eyebrow className="!text-gold-300">Service to humanity</Eyebrow>
            <h2 className="mt-4 font-display text-3xl font-semibold leading-tight text-cream-50 sm:text-4xl">
              {testimonial.quote}
            </h2>
            <p className="mt-6 text-cream-200/85">
              We dedicate ourselves to serve the poor, needy and the marginalized — regarding
              every person we meet as a living image of Christ Himself.
            </p>
            <div className="mt-8">
              <Button href="/about" variant="white" withArrow>
                Read our story
              </Button>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------- FAQ ---------------------------------- */

function FaqSection() {
  return (
    <Section className="bg-cream-100">
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <SectionHeading
            eyebrow="Questions"
            title="Frequently asked questions"
            intro="A little more about who we are, where we serve, and how you can take part."
          />
          <div className="mt-8 hidden lg:block">
            <Button href="/contact" variant="primary" withArrow>
              Ask us anything
            </Button>
          </div>
        </div>
        <div className="lg:col-span-7">
          <Faq items={faqs} />
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------- Updates -------------------------------- */

function UpdatesSection() {
  return (
    <Section className="bg-cream-50">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeading
          eyebrow="Recent updates"
          title="News from the Province"
          intro="Stories and moments from our communities across North & East Africa."
        />
      </div>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {updates.map((u, i) => (
          <Reveal key={u.title} delay={i * 70}>
            <article className="group card flex h-full flex-col overflow-hidden p-0">
              <div className="aspect-[16/10] overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={u.image}
                  alt={u.title}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div className="flex flex-1 flex-col p-6">
                <time className="text-xs font-semibold uppercase tracking-wide text-terra-500">
                  {formatDate(u.date)}
                </time>
                <h3 className="mt-2 font-display text-lg font-semibold leading-snug text-ink-900">
                  {u.title}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-600">{u.excerpt}</p>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* -------------------------------- CTA band ------------------------------- */

function CtaBand() {
  return (
    <section className="relative overflow-hidden bg-terra-900">
      <div className="absolute inset-0 glow-warm" />
      <div className="container-page relative py-20 text-center">
        <Reveal className="mx-auto max-w-2xl">
          <Eyebrow className="!text-gold-300 justify-center">Let&rsquo;s work together</Eyebrow>
          <h2 className="mt-5 font-display text-3xl font-semibold text-cream-50 sm:text-4xl lg:text-5xl">
            Interested in being our volunteer?
          </h2>
          <p className="mt-5 text-lg text-cream-200/85">
            Give, pray, or serve alongside us. Every act of charity helps bring the love of
            Christ to those who need it most.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <Button href="/donate" variant="gold" size="lg">
              <HeartHandIcon className="h-5 w-5" /> Donate now
            </Button>
            <Button
              href="/contact"
              size="lg"
              className="border border-cream-100/30 bg-cream-50/5 text-cream-50 hover:bg-cream-50/10"
            >
              <ArrowUpRightIcon className="h-4 w-4" /> Get in touch
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* -------------------------------- helpers -------------------------------- */

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
