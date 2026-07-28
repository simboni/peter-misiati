import Link from "next/link";
import {
  coreValues,
  identity,
  impactStats,
  programs,
  projects,
  site,
} from "@/lib/keysa";
import { Button, Chip, Eyebrow, SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { CountUp } from "@/components/count-up";
import { ProjectCard } from "@/components/project-card";
import { ProgramIcon } from "@/components/program-icon";
import {
  ArrowRightIcon,
  CheckIcon,
  HeartIcon,
  MapPinIcon,
  UsersIcon,
} from "@/components/icons";

export default function HomePage() {
  const featured = projects.slice(0, 3);

  return (
    <>
      {/* ------------------------------------------------ Hero */}
      <section className="relative overflow-hidden border-b border-ink-600">
        <div className="absolute inset-0 bg-grid" aria-hidden />
        <div className="absolute inset-0 glow-bg" aria-hidden />
        <div
          className="hero-orb left-[-10%] top-[-20%] h-96 w-96 bg-green-400/20"
          style={{ animation: "floatY 9s ease-in-out infinite" }}
          aria-hidden
        />
        <div
          className="hero-orb bottom-[-30%] right-[-5%] h-80 w-80 bg-accent-400/10"
          style={{ animation: "floatY 11s ease-in-out infinite reverse" }}
          aria-hidden
        />

        <div className="container-page relative grid items-center gap-12 py-20 sm:py-28 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="hero-stagger">
            <p className="inline-flex items-center gap-2 rounded-full border border-green-400/30 bg-green-400/10 px-4 py-1.5 text-xs font-semibold text-green-300">
              <MapPinIcon className="h-3.5 w-3.5" />
              Kakamega County, Kenya · Founded {site.founded}
            </p>
            <h1 className="mt-6 font-display text-4xl font-bold leading-[1.08] tracking-tight text-mist-100 sm:text-6xl text-balance">
              Every young person deserves the tools to{" "}
              <span className="text-green-400">lead tomorrow</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-mist-400">
              {site.shortName} — the Kenya Youth Support Association — cultivates and
              empowers young people through education, sports and talents, technology,
              financial literacy and community development. Confident, competent,
              compassionate leaders start here.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button href="/donate/" variant="donate">
                <HeartIcon className="h-4 w-4" />
                Donate now
              </Button>
              <Button href="/programs/" variant="ghost">
                Explore our programs
                <ArrowRightIcon className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-8 max-w-md">
              <div className="tricolor" aria-hidden />
              <p className="mt-3 text-xs font-medium tracking-wide text-mist-500">
                HARAMBEE — “all pull together.” Kenya’s spirit, KEYSA’s method.
              </p>
            </div>
          </div>

          {/* Mission panel */}
          <Reveal variant="scale">
            <div className="win relative p-7 sm:p-8">
              <span className="absolute -top-3 left-7 inline-flex items-center gap-1.5 rounded-full bg-green-400 px-3 py-1 text-xs font-bold text-on-accent">
                Our mission
              </span>
              <blockquote className="font-display text-xl font-semibold leading-relaxed text-mist-100">
                “{identity.mission}”
              </blockquote>
              <div className="mt-6 space-y-3">
                {[
                  "Youth are the primary drivers of any nation's development",
                  "Inclusive by design — every background, equal opportunity",
                  "Community-rooted since day one in Namamali Ward",
                ].map((line) => (
                  <p key={line} className="flex items-start gap-2.5 text-sm text-mist-400">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                    {line}
                  </p>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------ Impact stats */}
      <section className="border-b border-ink-600 bg-ink-850">
        <div className="container-page grid grid-cols-2 gap-8 py-14 lg:grid-cols-4">
          {impactStats.map((stat, i) => (
            <Reveal key={stat.label} delay={i * 80}>
              <div className="text-center">
                <p className="font-display text-4xl font-bold text-green-400 sm:text-5xl">
                  {stat.format ? (
                    <span>100k</span>
                  ) : (
                    <CountUp end={stat.end} suffix={stat.suffix} />
                  )}
                </p>
                <p className="mt-2 text-sm font-medium text-mist-500">{stat.label}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ Programs */}
      <section className="py-20 sm:py-24">
        <div className="container-page">
          <Reveal>
            <SectionHeading
              eyebrow="What we do"
              title="Five thematic areas, one goal: self-reliant youth"
              lede="From classrooms and TVET workshops to football pitches, tech labs and tree nurseries — each program attacks a different barrier holding young people back."
            />
          </Reveal>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {programs.map((program, i) => (
              <Reveal key={program.slug} delay={i * 70}>
                <Link
                  href={`/programs/${program.slug}/`}
                  className="group flex h-full flex-col rounded-2xl border border-ink-600 bg-ink-800 p-7 transition-all duration-300 hover:-translate-y-1 hover:border-green-400/50"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-green-400/10 text-green-400">
                    <ProgramIcon name={program.icon} />
                  </span>
                  <h3 className="mt-5 font-display text-lg font-bold text-mist-100 group-hover:text-green-300">
                    {program.name}
                  </h3>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-mist-500">
                    {program.tagline}
                  </p>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-mist-400">
                    {program.summary}
                  </p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-green-400">
                    Learn more
                    <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              </Reveal>
            ))}
            {/* CTA tile completes the grid */}
            <Reveal delay={programs.length * 70}>
              <div className="flex h-full flex-col justify-center rounded-2xl border border-dashed border-green-400/40 bg-green-400/5 p-7 text-center">
                <UsersIcon className="mx-auto h-8 w-8 text-green-400" />
                <h3 className="mt-4 font-display text-lg font-bold text-mist-100">
                  Power a program
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-mist-400">
                  Sponsor a student, kit a team, fund a workshop — your support runs
                  straight into these five areas.
                </p>
                <div className="mt-5">
                  <Button href="/donate/" variant="donate" className="w-full">
                    Give today
                  </Button>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Featured projects */}
      <section className="border-y border-ink-600 bg-ink-850 py-20 sm:py-24">
        <div className="container-page">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <Reveal>
              <SectionHeading
                eyebrow="Projects"
                title="Work you can fund today"
                lede="Fully designed initiatives with clear targets, budgets and sustainability plans — ready for donors and partners."
              />
            </Reveal>
            <Reveal delay={120}>
              <Button href="/projects/" variant="ghost">
                All projects
                <ArrowRightIcon className="h-4 w-4" />
              </Button>
            </Reveal>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {featured.map((project, i) => (
              <Reveal key={project.slug} delay={i * 90}>
                <ProjectCard project={project} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Values */}
      <section className="py-20 sm:py-24">
        <div className="container-page grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <Reveal>
            <div>
              <SectionHeading
                eyebrow="Why it works"
                title="Values that shape every decision"
              />
              <p className="mt-5 text-sm leading-relaxed text-mist-400">
                KEYSA was founded by people deeply rooted in the local community. Our
                five core values aren’t wall art — they’re the criteria we use to
                design programs, choose partners and measure ourselves.
              </p>
              <div className="mt-8">
                <Button href="/about/">
                  Meet the team behind KEYSA
                  <ArrowRightIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Reveal>
          <div className="grid gap-4 sm:grid-cols-2">
            {coreValues.map((value, i) => (
              <Reveal key={value.name} delay={i * 70}>
                <div className="h-full rounded-2xl border border-ink-600 bg-ink-800 p-6">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent-400/10 text-accent-400">
                    <ProgramIcon name={value.icon} className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-display text-base font-bold text-mist-100">
                    {value.name}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-mist-400">
                    {value.description}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Donate CTA band */}
      <section className="relative overflow-hidden border-t border-ink-600 bg-ink-850">
        <div className="absolute inset-0 bg-grid" aria-hidden />
        <div className="absolute inset-0 glow-bg" aria-hidden />
        <div className="container-page relative py-20 text-center sm:py-24">
          <Reveal>
            <Eyebrow className="justify-center">Join the movement</Eyebrow>
            <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold tracking-tight text-mist-100 sm:text-4xl text-balance">
              A generation is waiting for its chance. Be the one who gives it.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-mist-400">
              Ksh 3,500 puts a match ball on the pitch. Ksh 50,000 puts a young mother
              through a term of vocational training. Every shilling is accounted for.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button href="/donate/" variant="donate">
                <HeartIcon className="h-4 w-4" />
                Donate
              </Button>
              <Button href="/get-involved/" variant="ghost">
                Volunteer or partner
              </Button>
            </div>
            <div className="mt-8 flex justify-center">
              <Chip tone="green">100% community-rooted · Registered non-profit</Chip>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
