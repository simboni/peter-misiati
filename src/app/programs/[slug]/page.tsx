import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgram, programs, projects } from "@/lib/keysa";
import { Button, Chip, Eyebrow } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { ProjectCard } from "@/components/project-card";
import { ProgramIcon } from "@/components/program-icon";
import { ArrowRightIcon, CheckIcon, HeartIcon } from "@/components/icons";

export function generateStaticParams() {
  return programs.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const program = getProgram(slug);
  if (!program) return { title: "Program not found" };
  return {
    title: program.name,
    description: program.summary,
  };
}

export default async function ProgramPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const program = getProgram(slug);
  if (!program) notFound();

  const related = projects.filter((p) => p.programSlug === program.slug);
  const index = programs.findIndex((p) => p.slug === program.slug);
  const next = programs[(index + 1) % programs.length];

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-ink-600 bg-ink-850">
        <div className="absolute inset-0 bg-grid" aria-hidden />
        <div className="absolute inset-0 glow-bg" aria-hidden />
        <div className="container-page relative py-16 sm:py-20">
          <div className="hero-stagger max-w-3xl">
            <Eyebrow>Program · {program.tagline}</Eyebrow>
            <div className="flex items-start gap-5">
              <span className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-green-400/10 text-green-400 sm:inline-flex">
                <ProgramIcon name={program.icon} className="h-7 w-7" />
              </span>
              <h1 className="font-display text-4xl font-bold tracking-tight text-mist-100 sm:text-5xl text-balance">
                {program.name}
              </h1>
            </div>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-mist-400">
              {program.summary}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button href="/donate/" variant="donate">
                <HeartIcon className="h-4 w-4" />
                Fund this program
              </Button>
              <Button href="/get-involved/" variant="ghost">
                Volunteer with us
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Body */}
      <section className="py-16 sm:py-20">
        <div className="container-page grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <Reveal>
            <div>
              <h2 className="font-display text-2xl font-bold text-mist-100">
                Why this program exists
              </h2>
              <div className="mt-5 space-y-5 text-base leading-relaxed text-mist-400">
                {program.description.map((p) => (
                  <p key={p.slice(0, 40)}>{p}</p>
                ))}
              </div>
            </div>
          </Reveal>

          <div className="space-y-5">
            <Reveal delay={80}>
              <div className="win p-7">
                <h3 className="kicker">Key activities</h3>
                <ul className="mt-4 space-y-3">
                  {program.activities.map((a) => (
                    <li
                      key={a}
                      className="flex items-start gap-2.5 text-sm leading-relaxed text-mist-400"
                    >
                      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
            <Reveal delay={160}>
              <div className="rounded-2xl border border-green-400/30 bg-green-400/5 p-7">
                <h3 className="kicker">What changes</h3>
                <ul className="mt-4 space-y-3">
                  {program.outcomes.map((o) => (
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
          </div>
        </div>
      </section>

      {/* Related projects */}
      {related.length > 0 && (
        <section className="border-t border-ink-600 bg-ink-850 py-16 sm:py-20">
          <div className="container-page">
            <Reveal>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h2 className="font-display text-2xl font-bold text-mist-100">
                  Projects under this program
                </h2>
                <Chip tone="green">
                  {related.length} project{related.length > 1 ? "s" : ""}
                </Chip>
              </div>
            </Reveal>
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              {related.map((project, i) => (
                <Reveal key={project.slug} delay={i * 90}>
                  <ProjectCard project={project} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Next program */}
      <section className="border-t border-ink-600 py-10">
        <div className="container-page flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/programs/"
            className="text-sm font-medium text-mist-500 transition-colors hover:text-mist-100"
          >
            ← All programs
          </Link>
          <Link
            href={`/programs/${next.slug}/`}
            className="group inline-flex items-center gap-2 text-sm font-semibold text-green-400"
          >
            Next: {next.name}
            <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </section>
    </>
  );
}
