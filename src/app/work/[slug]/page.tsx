import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { projects, getProject } from "@/lib/portfolio";
import { Button, Eyebrow } from "@/components/ui";
import { Chip } from "@/components/project-card";
import {
  ExternalLinkIcon,
  GitHubIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  CheckIcon,
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
  // Share the project's own preview when it has one; otherwise fall back to
  // the site-wide card so every case-study link still unfurls with an image.
  const image = project.media[0]?.src ?? "/opengraph-image.png";
  return {
    title: project.title,
    description: project.summary,
    openGraph: {
      title: project.title,
      description: project.summary,
      images: [image],
    },
    twitter: {
      title: project.title,
      description: project.summary,
      images: [image],
    },
  };
}

export default async function CaseStudyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) notFound();

  const index = projects.findIndex((p) => p.slug === project.slug);
  const next = projects[(index + 1) % projects.length];

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-ink-700 bg-grid glow-bg">
        <div className="container-page py-14 sm:py-16 lg:py-20">
          <nav className="mb-6 font-mono text-sm text-mist-500" aria-label="Breadcrumb">
            <Link href="/" className="transition-colors hover:text-green-400">
              ~
            </Link>
            <span className="mx-1.5 text-mist-600">/</span>
            <Link href="/work" className="transition-colors hover:text-green-400">
              work
            </Link>
            <span className="mx-1.5 text-mist-600">/</span>
            <span className="text-mist-200">{project.slug}</span>
          </nav>

          <Eyebrow>{project.type}</Eyebrow>
          <h1 className="mt-4 max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight text-mist-100 text-balance sm:text-5xl">
            {project.title}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-mist-400">
            {project.summary}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {project.links.live ? (
              <Button href={project.links.live} variant="gold" target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon className="h-4 w-4" /> access this platform
              </Button>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-4 py-2.5 font-mono text-sm text-mist-400">
                <span className="h-2 w-2 rounded-full bg-amber-400" /> platform coming soon
              </span>
            )}
            {project.links.code && (
              <Button href={project.links.code} variant="outline" target="_blank" rel="noopener noreferrer">
                <GitHubIcon className="h-4 w-4" /> view code
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Snapshot bar */}
      <div className="border-b border-ink-700 bg-ink-850">
        <div className="container-page grid grid-cols-2 gap-6 py-7 sm:grid-cols-4">
          <Meta label="year" value={project.year} />
          <Meta label="role" value={project.role} />
          <Meta label="type" value={project.type} />
          <Meta label="stack" value={`${project.stack.length} technologies`} />
        </div>
      </div>

      {/* Body */}
      <div className="container-page grid gap-12 py-16 lg:grid-cols-12 lg:py-20">
        <article className="lg:col-span-8">
          {project.media.length > 0 ? (
            <div className="space-y-6">
              {project.media.map((m) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={m.src} src={m.src} alt={m.alt} className="w-full rounded-xl border border-ink-600" />
              ))}
            </div>
          ) : (
            <div
              className={`relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-xl border border-ink-600 bg-gradient-to-br ${project.cover.from} ${project.cover.to}`}
            >
              {/* Fixed dark scrim keeps the white initials readable in every theme */}
              <div className="absolute inset-0 bg-black/45" />
              <div className="absolute inset-0 bg-grid opacity-40" />
              <span className="relative font-mono text-6xl font-bold text-white/90">
                {project.cover.initials}
              </span>
            </div>
          )}

          <Block title="The problem">
            <p>{project.problem}</p>
          </Block>
          <Block title="My approach">
            <p>{project.approach}</p>
          </Block>
          <Block title="How it's built">
            <ul className="space-y-3">
              {project.architecture.map((a) => (
                <li key={a} className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </Block>
          <Block title="Highlights">
            <ul className="space-y-3">
              {project.highlights.map((h) => (
                <li key={h} className="flex gap-3">
                  <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </Block>
        </article>

        {/* Sidebar */}
        <aside className="lg:col-span-4">
          <div className="sticky top-24 space-y-6">
            <div className="rounded-xl border border-ink-600 bg-ink-800 p-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-mist-500">Tech stack</h3>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {project.stack.map((s) => (
                  <Chip key={s}>{s}</Chip>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-ink-600 bg-ink-800 p-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-mist-500">Impact</h3>
              <div className="mt-4 space-y-4">
                {project.impact.map((m) => (
                  <div key={m.label}>
                    <div className="font-display text-2xl font-bold text-mist-100">{m.value}</div>
                    <div className="text-sm text-mist-400">{m.label}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-ink-600 bg-ink-800 p-6 text-center">
              <p className="text-sm text-mist-300">Like what you see?</p>
              <Button href="/contact" variant="gold" className="mt-3 w-full" withArrow>
                work with me
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {/* Next project */}
      <section className="border-t border-ink-700 bg-ink-850">
        <div className="container-page py-14">
          <Link
            href={`/work/${next.slug}`}
            className="group flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"
          >
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist-500">Next project</div>
              <div className="mt-1 font-display text-2xl font-bold text-mist-100 group-hover:text-green-300">
                {next.title}
              </div>
            </div>
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-md border border-ink-600 bg-ink-800 text-green-400 transition-transform group-hover:translate-x-1">
              <ArrowRightIcon className="h-5 w-5" />
            </span>
          </Link>
          <Link
            href="/work"
            className="mt-8 inline-flex items-center gap-1.5 font-mono text-sm text-mist-400 hover:text-green-400"
          >
            <ArrowUpRightIcon className="h-4 w-4" /> back to all work
          </Link>
        </div>
      </section>
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-xs text-green-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-mist-100">{value}</div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="font-display text-2xl font-bold tracking-tight text-mist-100">{title}</h2>
      <div className="mt-4 text-base leading-relaxed text-mist-400">{children}</div>
    </section>
  );
}
