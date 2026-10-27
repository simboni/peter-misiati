import Link from "next/link";
import {
  profile,
  about,
  skills,
  services,
  serviceHref,
  serviceProofCount,
  experience,
  testimonials,
  projects,
} from "@/lib/portfolio";
import { Button, Section, SectionHeading, Eyebrow } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { Chip } from "@/components/project-card";
import { ReviewCard } from "@/components/review-card";
import { ClientLogos } from "@/components/client-logos";
import { FlagshipSpotlights } from "@/components/flagship-spotlight";
import { VisualWall } from "@/components/visual-wall";
import { HeroSlider } from "@/components/hero-slider";
import {
  ServiceIcon,
  MailIcon,
  CheckIcon,
  WhatsAppIcon,
  ArrowRightIcon,
} from "@/components/icons";

/** The hero carousel. Dashboards only — the screen a business actually works
    in, rather than the front page it shows the public. All five are cropped to
    exactly 1600x900 so the track cannot change shape as it advances. */
const heroSlides = [
  { src: "/hero/hero-gym.webp", alt: "Fit Generations Gym — money in, money out and what is still owed" },
  { src: "/hero/hero-credits.webp", alt: "SMP Credits — the outstanding loan book and work queues" },
  { src: "/hero/hero-expenses.webp", alt: "Fit Generations Gym — the month's expenses and where they went" },
  { src: "/hero/hero-reports.webp", alt: "SMP Credits — lending reports" },
  { src: "/hero/hero-stackup.webp", alt: "StackUp — the planning dashboard" },
];

export default function HomePage() {
  return (
    <>
      {/* ============================= HERO ============================= */}
      {/* The work is still the hero: one line of who, one line of what, one
          line of what that means, and then the screens. No chips, no stat
          strip, no availability line — those are on /about, and here they
          competed with the sentence that has to land first.

          It is not wordless any more, though, and that was not a style choice.
          The page shipped with NO <h1> at all. A visitor who already knows
          what SMP does reads the screenshots fine; a search engine saw a
          carousel, and a screen reader landing here was read the name of an
          image. Three lines fix all of that and still clear the fold. */}
      <section className="relative overflow-hidden border-b border-ink-700 glow-bg">
        <div className="container-page relative py-8 sm:py-12">
          <p className="kicker">
            {profile.name} &middot; {profile.location}
          </p>
          <h1 className="mt-3 max-w-4xl font-display text-3xl font-bold leading-tight tracking-tight text-mist-100 text-balance sm:text-4xl lg:text-5xl">
            {profile.headline}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-mist-400 text-pretty sm:text-lg">
            {profile.headlineSupport}
          </p>

          <div className="mt-8 overflow-hidden rounded-2xl border border-ink-600 bg-ink-800 shadow-[0_40px_90px_-50px_rgba(0,0,0,0.7)]">
            <HeroSlider slides={heroSlides} />
          </div>

          {/* One button that is obviously the button.
              These were `primary` and `outline`, which in the light theme are
              a grey slab and a grey outline — the same weight, side by side,
              so neither read as the action. And the first said "Let's talk",
              the same words as the green button in the header two inches
              above it: two identical labels, two different styles, for the
              same destination. The gold variant is the site's one CTA colour
              and is already what the footer CTA uses. */}
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button href="/contact" variant="gold" size="lg" withArrow className="w-full sm:w-auto">
              Start a project
            </Button>
            <Button href="#proof" variant="outline" size="lg" className="w-full sm:w-auto">
              See the work
            </Button>
          </div>
        </div>
      </section>

      {/* =========================== THE WALL ========================== */}
      {/* Pictures first, and specifically pictures of the parts nobody else
          shows. A landing page says "I make websites"; an admin screen with
          real money on it says "I build the thing a business runs on". The
          architecture is one click away in the case study for whoever wants
          it — which is a different person from the one deciding to call. */}
      <Section id="proof">
        <SectionHeading
          eyebrow="see it working"
          title="Not mockups. Screens out of systems running today."
          intro="Every one of these is live right now, and the link goes straight to it."
        />
        <div className="mt-12">
          <VisualWall />
        </div>
      </Section>

      {/* ==================== FLAGSHIP PRODUCTS ======================== */}
      <FlagshipSpotlights />

      {/* ===================== WORKED-WITH LOGO WALL ==================== */}
      <ClientLogos />

      {/* ========================== WHAT I BUILD ======================= */}
      {/* Before the work, not after it. A buyer scanning fifteen projects is
          doing the categorising this section should have done for them — and
          "do you build the thing I need?" is the question that decides whether
          they read on or close the tab. The technology stack stays further
          down: it answers a question only another engineer is asking. */}
      <Section id="services">
        <SectionHeading
          eyebrow="what I build"
          title="Systems for organisations that have outgrown spreadsheets"
          intro="Six things I'm hired for. Each card opens the projects on this site that back it up."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service, i) => {
            const count = serviceProofCount(service);
            return (
              <Reveal key={service.title} delay={i * 50}>
                <Link
                  href={serviceHref(service)}
                  prefetch={false}
                  className="group/svc flex h-full flex-col rounded-xl border border-ink-600 bg-ink-800 p-5 transition-colors hover:border-green-400/40"
                >
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-green-400/10 text-green-400">
                    <ServiceIcon name={service.icon} className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-display font-semibold text-mist-100">
                    {service.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-mist-400">{service.blurb}</p>
                  {/* The label was "See the work" on all six, and it only
                      appeared on hover — so on a phone, where there is no
                      hover, the cards had no visible destination at all. It
                      is always on now, and it says where it goes: how many
                      projects are behind the claim, or that this one is a
                      conversation rather than a case study. */}
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm text-green-400 transition-transform group-hover/svc:translate-x-0.5">
                    {count > 0
                      ? `See ${count} ${count === 1 ? "project" : "projects"}`
                      : "Talk to me about it"}
                    <ArrowRightIcon className="h-4 w-4" />
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </Section>

      {/* ========================= WORK INDEX ========================== */}
      {/* The filterable grid lives on /work now. It was here as well, directly
          underneath the wall, showing the same projects a second time — and a
          visitor who has just scrolled past the screens does not need the
          thumbnails again, they need somewhere to go next. */}
      <Section id="work">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading
            eyebrow="selected work"
            title="Every project, filterable"
            // Counted, not typed. This said "Seventeen builds" while the
            // catalogue held fifteen — a number nobody would check, on the
            // page where every other number is checkable, next to the links
            // that let you count them.
            intro={`${projects.length} builds — web apps, sites and internal systems — each with a full case study behind it.`}
          />
          <Button href="/work" variant="outline" withArrow className="shrink-0">
            all projects
          </Button>
        </div>
      </Section>

      {/* ============================ SKILLS =========================== */}
      <Section id="skills" className="border-y border-ink-700 bg-ink-850">
        <SectionHeading
          eyebrow="stack"
          title="What I build with"
          intro="A modern, TypeScript-first toolkit — plus the WordPress, mobile and fintech range to back it up."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((group, i) => (
            <Reveal key={group.title} delay={i * 50}>
              <div className="h-full rounded-xl border border-ink-600 bg-ink-800 p-5 transition-colors hover:border-green-400/40">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-green-400/10 text-green-400">
                    <ServiceIcon name={group.icon} className="h-5 w-5" />
                  </span>
                  <h3 className="font-display font-semibold text-mist-100">{group.title}</h3>
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {group.items.map((item) => (
                    <Chip key={item}>{item}</Chip>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ========================== EXPERIENCE ========================= */}
      <Section>
        <SectionHeading eyebrow="experience" title="Where I've been building" />
        <div className="mt-12 space-y-4">
          {experience.map((job, i) => (
            <Reveal key={`${job.company}-${i}`} delay={i * 60}>
              <div className="grid gap-4 rounded-xl border border-ink-600 bg-ink-800 p-6 sm:grid-cols-12 sm:p-7">
                <div className="sm:col-span-4">
                  <div className="font-mono text-xs text-green-400">{job.period}</div>
                  <h3 className="mt-1 font-display text-lg font-semibold text-mist-100">
                    {job.role}
                  </h3>
                  <div className="text-sm text-mist-400">{job.company}</div>
                  {job.location && (
                    <div className="mt-1 font-mono text-xs text-mist-600">{job.location}</div>
                  )}
                </div>
                <div className="sm:col-span-8">
                  <p className="text-sm leading-relaxed text-mist-400">{job.summary}</p>
                  <ul className="mt-3 space-y-2">
                    {job.highlights.map((h) => (
                      <li key={h} className="flex gap-2.5 text-sm text-mist-300">
                        <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* =========================== ABOUT ============================= */}
      <Section className="border-y border-ink-700 bg-ink-850">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Eyebrow>about</Eyebrow>
            <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-mist-100 text-balance sm:text-4xl">
              Engineer, builder, and relentless finisher.
            </h2>
            <p className="mt-5 leading-relaxed text-mist-400">{about.paragraphs[0]}</p>
            <Button href="/about" variant="outline" withArrow className="mt-7">
              more about me
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
            {about.principles.map((p, i) => (
              <Reveal key={p.title} delay={i * 50}>
                <div className="h-full rounded-xl border border-ink-600 bg-ink-800 p-5">
                  <h3 className="font-display font-semibold text-green-300">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-mist-400">{p.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      {/* ========================= TESTIMONIALS ======================== */}
      {testimonials.length > 0 && (
        <Section>
          <SectionHeading
            eyebrow="reviews"
            title="What clients say"
            align="center"
            className="mx-auto"
          />
          <div
            className={`mx-auto mt-12 grid gap-6 ${
              testimonials.length === 1
                ? "max-w-2xl"
                : "sm:grid-cols-2 lg:grid-cols-3"
            }`}
          >
            {testimonials.map((review, i) => (
              <Reveal key={review.author + i} delay={i * 80} className="h-full min-w-0">
                <ReviewCard review={review} />
              </Reveal>
            ))}
          </div>
        </Section>
      )}

      {/* ============================= CTA ============================= */}
      <section className="relative overflow-hidden border-t border-ink-700 glow-bg">
        <div className="container-page py-24 text-center">
          <Eyebrow>Let&rsquo;s build</Eyebrow>
          <h2 className="mx-auto mt-4 max-w-2xl font-display text-3xl font-bold leading-tight tracking-tight text-mist-100 text-balance sm:text-4xl">
            Got a process you&rsquo;d like to stop doing by hand?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-mist-400">
            Tell me what you&rsquo;re trying to solve &mdash; the spreadsheet, the paper file, the
            reconciliation that eats a day a week. I&rsquo;ll tell you what it would take to
            replace it.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button href="/contact" variant="gold" size="lg" withArrow>
              start a project
            </Button>
            <Button
              href={`https://wa.me/${profile.whatsapp}`}
              variant="outline"
              size="lg"
              target="_blank"
              rel="noopener noreferrer"
            >
              <WhatsAppIcon className="h-5 w-5" /> WhatsApp
            </Button>
            <Button href={`mailto:${profile.email}`} variant="outline" size="lg">
              <MailIcon className="h-5 w-5" /> {profile.email}
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

