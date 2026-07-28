import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgram, getProject, projects } from "@/lib/keysa";
import { Button, Chip, Eyebrow } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import {
  ArrowRightIcon,
  CalendarIcon,
  CheckIcon,
  HeartIcon,
  MapPinIcon,
  TargetIcon,
  UsersIcon,
} from "@/components/icons";

export function generateStaticParams() {
  return projects.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) return { title: "Project not found" };
  return {
    title: project.title,
    description: project.summary,
  };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) notFound();

  const program = getProgram(project.programSlug);
  const index = projects.findIndex((p) => p.slug === project.slug);
  const next = projects[(index + 1) % projects.length];

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-ink-600 bg-ink-850">
        <div className="absolute inset-0 bg-grid" aria-hidden />
        <div className="absolute inset-0 glow-bg" aria-hidden />
        <div className="container-page relative py-16 sm:py-20">
          <div className="hero-stagger max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={project.status === "Completed" ? "green" : "red"}>
                {project.status}
              </Chip>
              {program && (
                <Link href={`/programs/${program.slug}/`}>
                  <Chip>{program.name}</Chip>
                </Link>
              )}
            </div>
            <h1 className="mt-5 font-display text-4xl font-bold tracking-tight text-mist-100 sm:text-5xl text-balance">
              {project.title}
            </h1>
            <p className="mt-3 text-lg font-medium text-green-400">{project.subtitle}</p>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-mist-400">
              {project.summary}
            </p>
            <dl className="mt-7 flex flex-wrap gap-x-8 gap-y-3 text-sm">
              <div className="flex items-center gap-2 text-mist-400">
                <CalendarIcon className="h-4 w-4 text-mist-500" />
                <dt className="sr-only">Duration</dt>
                <dd>{project.duration}</dd>
              </div>
              <div className="flex items-center gap-2 text-mist-400">
                <MapPinIcon className="h-4 w-4 text-mist-500" />
                <dt className="sr-only">Location</dt>
                <dd>{project.location}</dd>
              </div>
              <div className="flex items-center gap-2 text-mist-400">
                <UsersIcon className="h-4 w-4 text-mist-500" />
                <dt className="sr-only">Target group</dt>
                <dd>{project.targetGroup}</dd>
              </div>
            </dl>
            {project.status !== "Completed" && (
              <div className="mt-8 flex flex-wrap gap-3">
                <Button href="/donate/" variant="donate">
                  <HeartIcon className="h-4 w-4" />
                  Fund this project
                </Button>
                <Button href="/contact/" variant="ghost">
                  Request the full proposal
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Headline numbers */}
      <section className="border-b border-ink-600">
        <div className="container-page grid grid-cols-2 gap-6 py-10 sm:grid-cols-4">
          {project.stats.map((stat, i) => (
            <Reveal key={stat.label} delay={i * 70}>
              <div>
                <p className="font-display text-3xl font-bold text-green-400 sm:text-4xl">
                  {stat.value}
                </p>
                <p className="mt-1 text-xs font-medium text-mist-500">{stat.label}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Background + objectives */}
      <section className="py-16 sm:py-20">
        <div className="container-page grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <Reveal>
            <div>
              <Eyebrow>The situation</Eyebrow>
              <h2 className="font-display text-2xl font-bold text-mist-100">
                Why this project matters
              </h2>
              <div className="mt-5 space-y-5 text-base leading-relaxed text-mist-400">
                {project.background.map((p) => (
                  <p key={p.slice(0, 40)}>{p}</p>
                ))}
              </div>
              {project.budgetNote && (
                <p className="mt-6 rounded-xl border border-green-400/30 bg-green-400/5 p-5 text-sm leading-relaxed text-mist-300">
                  {project.budgetNote}
                </p>
              )}
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div className="win p-7">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-green-400/10 text-green-400">
                <TargetIcon className="h-5.5 w-5.5" />
              </span>
              <h3 className="mt-4 font-display text-lg font-bold text-mist-100">
                Objectives
              </h3>
              <ul className="mt-4 space-y-3">
                {project.objectives.map((o) => (
                  <li
                    key={o}
                    className="flex items-start gap-2.5 text-sm leading-relaxed text-mist-400"
                  >
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                    {o}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Activities */}
      <section className="border-y border-ink-600 bg-ink-850 py-16 sm:py-20">
        <div className="container-page">
          <Reveal>
            <Eyebrow>Implementation</Eyebrow>
            <h2 className="font-display text-2xl font-bold text-mist-100">
              How the work gets done
            </h2>
          </Reveal>
          <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {project.activities.map((activity, i) => (
              <Reveal key={activity.title} delay={i * 70}>
                <li className="h-full rounded-2xl border border-ink-600 bg-ink-800 p-6">
                  <p className="font-display text-3xl font-bold text-green-400/40">
                    {String(i + 1).padStart(2, "0")}
                  </p>
                  <h3 className="mt-3 font-display text-base font-bold text-mist-100">
                    {activity.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-mist-400">
                    {activity.detail}
                  </p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* Outcomes + sustainability */}
      <section className="py-16 sm:py-20">
        <div className="container-page grid gap-8 lg:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-2xl border border-green-400/30 bg-green-400/5 p-8">
              <h2 className="font-display text-xl font-bold text-mist-100">
                Expected outcomes
              </h2>
              <ul className="mt-5 space-y-3">
                {project.outcomes.map((o) => (
                  <li
                    key={o}
                    className="flex items-start gap-2.5 text-sm font-medium leading-relaxed text-mist-200"
                  >
                    <ArrowRightIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                    {o}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
          {project.sustainability && (
            <Reveal delay={100}>
              <div className="win h-full p-8">
                <h2 className="font-display text-xl font-bold text-mist-100">
                  Built to last
                </h2>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-mist-500">
                  Sustainability plan
                </p>
                <ul className="mt-5 space-y-3">
                  {project.sustainability.map((s) => (
                    <li
                      key={s}
                      className="flex items-start gap-2.5 text-sm leading-relaxed text-mist-400"
                    >
                      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          )}
        </div>
      </section>

      {/* CTA + next */}
      <section className="border-t border-ink-600 bg-ink-850 py-14">
        <div className="container-page">
          <Reveal>
            <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
              <div>
                <h2 className="font-display text-xl font-bold text-mist-100">
                  {project.status === "Completed"
                    ? "Help us run the next one"
                    : "This project starts when you say yes"}
                </h2>
                <p className="mt-1 text-sm text-mist-400">
                  Full proposals with detailed budgets are available to donors and
                  partners on request.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button href="/donate/" variant="donate">
                  <HeartIcon className="h-4 w-4" />
                  Donate
                </Button>
                <Button href="/contact/" variant="ghost">
                  Talk to us
                </Button>
              </div>
            </div>
          </Reveal>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-ink-600 pt-6">
            <Link
              href="/projects/"
              className="text-sm font-medium text-mist-500 transition-colors hover:text-mist-100"
            >
              ← All projects
            </Link>
            <Link
              href={`/projects/${next.slug}/`}
              className="group inline-flex items-center gap-2 text-sm font-semibold text-green-400"
            >
              Next: {next.title}
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
