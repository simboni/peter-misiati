import Link from "next/link";
import {
  org,
  figures,
  programs,
  projects,
  testimonials,
  gallery,
  involve,
  site,
} from "@/lib/cosdep";
import { Hero } from "@/components/hero";
import { Section, SectionHeading, Button, Eyebrow, Pill } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { CountUp } from "@/components/count-up";
import { ProgramCard } from "@/components/program-card";
import { ProjectCard } from "@/components/project-card";
import { TestimonialCard } from "@/components/testimonial-card";
import {
  ArrowRightIcon,
  LeafIcon,
  HeartIcon,
  HandshakeIcon,
} from "@/components/icons";

const involveIcons = [HeartIcon, LeafIcon, HandshakeIcon];

export default function HomePage() {
  const featured = projects.filter((p) => p.featured);

  return (
    <>
      <Hero />

      {/* --------------------------- Welcome / intro --------------------------- */}
      <Section>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal variant="right">
            <div className="relative">
              <div className="overflow-hidden rounded-[1.75rem] shadow-lift">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/cosdep-signboard.jpg"
                  alt="A COSDEP signboard standing in a thriving kitchen garden"
                  className="aspect-[4/3] w-full object-cover"
                />
              </div>
              {/* Floating figure chip */}
              <div className="absolute -bottom-6 -right-4 hidden rounded-2xl bg-forest-600 px-6 py-4 text-white shadow-lift sm:block">
                <p className="font-display text-3xl font-extrabold">
                  {new Date().getFullYear() - site.established}+
                </p>
                <p className="text-xs font-medium text-forest-100">
                  years growing rural resilience
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal variant="left">
            <Eyebrow>{org.welcome}</Eyebrow>
            <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-ink-900 text-balance sm:text-4xl">
              {org.headline}
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-ink-600 text-pretty">
              {org.intro}
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {org.approach.slice(0, 4).map((a) => (
                <div
                  key={a.title}
                  className="flex items-start gap-2.5 rounded-xl bg-sand-50 p-3.5"
                >
                  <LeafIcon className="mt-0.5 h-5 w-5 shrink-0 text-forest-500" />
                  <span className="text-sm font-medium text-ink-700">
                    {a.title}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-8">
              <Button href="/about" variant="primary" withArrow>
                Read our story
              </Button>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ------------------------------ Key figures ---------------------------- */}
      <section className="relative overflow-hidden bg-forest-900 py-16 sm:py-20">
        <div className="absolute inset-0 bg-dots opacity-[0.15]" />
        <div className="container-page relative">
          <div className="mb-10 text-center">
            <Eyebrow center className="!text-leaf-400 justify-center">
              Our impact so far
            </Eyebrow>
            <h2 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">
              Measurable change in the field
            </h2>
          </div>
          <div className="grid gap-8 sm:grid-cols-3">
            {figures.map((f) => (
              <Reveal key={f.label} variant="up">
                <div className="text-center">
                  <p className="font-display text-5xl font-extrabold tracking-tight text-leaf-400 sm:text-6xl">
                    <CountUp end={f.value} suffix={f.suffix} />
                  </p>
                  <p className="mt-2 text-base font-medium text-forest-100/85">
                    {f.label}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------ Programmes ----------------------------- */}
      <Section>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            eyebrow="What we do"
            title="Three pillars, one healthy future"
            intro="Every project we run grows out of three connected programme areas — food on the table, forests on the hills, and income in the household."
          />
          <Button href="/programs" variant="outline" withArrow className="shrink-0">
            All programmes
          </Button>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {programs.map((p, i) => (
            <Reveal key={p.slug} variant="up" delay={i * 80}>
              <ProgramCard program={p} />
            </Reveal>
          ))}
        </div>
      </Section>

      {/* --------------------------- COSDEP in Action -------------------------- */}
      <Section className="bg-sand-50">
        <SectionHeading
          align="center"
          eyebrow="COSDEP in action"
          title="Real people, real fields, real change"
          intro="A glimpse of our work with farmers, schoolchildren and communities across Kiambu and beyond."
          className="mx-auto text-center"
        />
        <div className="mt-12 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
          {gallery.map((g, i) => (
            <Reveal
              key={g.src}
              variant="scale"
              delay={i * 60}
              className={
                i === 0 ? "col-span-2 row-span-2 min-h-[16rem] md:col-span-2" : ""
              }
            >
              <div className="group h-full overflow-hidden rounded-2xl shadow-soft">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={g.src}
                  alt={g.alt}
                  className={`w-full object-cover transition-transform duration-500 group-hover:scale-105 ${
                    i === 0 ? "h-full min-h-[16rem]" : "aspect-square"
                  }`}
                  loading="lazy"
                />
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ------------------------------- Projects ------------------------------ */}
      <Section>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            eyebrow="Our recent projects"
            title="Where the work is happening"
            intro="From watershed restoration in the Aberdares to organic market outlets in Githunguri — here is a selection of our current and upcoming projects."
          />
          <Button href="/projects" variant="outline" withArrow className="shrink-0">
            All projects
          </Button>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {featured.map((p, i) => (
            <Reveal key={p.slug} variant="up" delay={i * 80}>
              <ProjectCard project={p} />
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ----------------------------- Testimonials ---------------------------- */}
      <Section className="bg-sand-50">
        <SectionHeading
          align="center"
          eyebrow="What farmers say"
          title="Hope, harvest and confidence"
          className="mx-auto text-center"
        />
        <div className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-2">
          {testimonials.map((t, i) => (
            <Reveal key={t.name} variant="up" delay={i * 80}>
              <TestimonialCard testimonial={t} />
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ------------------------------ Get involved --------------------------- */}
      <Section>
        <SectionHeading
          align="center"
          eyebrow="Get involved"
          title="Grow this future with us"
          intro="COSDEP's work is powered by people who believe rural communities can feed themselves and heal the land. Here's how you can help."
          className="mx-auto text-center"
        />
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {involve.map((item, i) => {
            const Icon = involveIcons[i] ?? HeartIcon;
            return (
              <Reveal key={item.title} variant="up" delay={i * 80}>
                <Link
                  href={item.href}
                  className="group card flex h-full flex-col p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-lift"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-forest-50 text-forest-600">
                    <Icon className="h-6 w-6" />
                  </span>
                  <h3 className="mt-5 font-display text-xl font-bold text-ink-900">
                    {item.title}
                  </h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-500">
                    {item.body}
                  </p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-forest-600">
                    {item.cta}
                    <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </Section>

      {/* -------------------------------- CTA band ----------------------------- */}
      <section className="relative isolate overflow-hidden bg-forest-800">
        <div className="absolute inset-0 -z-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/school-tree-planting.jpg"
            alt=""
            className="h-full w-full object-cover opacity-25"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-forest-900/95 to-forest-800/80" />
        </div>
        <div className="container-page py-20 text-center sm:py-24">
          <Pill tone="white" className="mb-6">
            <HeartIcon className="h-3.5 w-3.5" /> Every gift plants a future
          </Pill>
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-extrabold leading-tight text-white text-balance sm:text-4xl lg:text-5xl">
            Help a farmer secure their future today
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-forest-100/85 text-pretty">
            Your support funds seedlings, training and tools that put safe food
            on rural tables and forests back on the hills.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button href="/get-involved#donate" variant="leaf" size="lg" withArrow>
              Donate now
            </Button>
            <Button href="/contact" variant="white" size="lg">
              Talk to us
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
