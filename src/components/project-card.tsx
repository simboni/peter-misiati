import Link from "next/link";
import type { Project } from "@/lib/portfolio";
import { SpotlightCard } from "@/components/spotlight-card";
import { ArrowUpRightIcon, GitHubIcon, ExternalLinkIcon } from "@/components/icons";

/** A mono tech-stack / tag chip. */
export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-ink-600 bg-ink-700/60 px-2 py-0.5 font-mono text-[0.7rem] text-mist-300">
      {children}
    </span>
  );
}

export function ProjectCard({ project }: { project: Project }) {
  const href = `/work/${project.slug}`;
  return (
    <SpotlightCard className="group flex h-full flex-col overflow-hidden rounded-xl border border-ink-600 bg-ink-800 transition-all duration-300 hover:-translate-y-1 hover:border-green-400/50 hover:shadow-[0_20px_50px_-30px_rgba(0,0,0,0.8)]">
      {/* Cover */}
      <Link href={href} className="block" aria-label={project.title}>
        <div
          className={`relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-gradient-to-br ${project.cover.from} ${project.cover.to}`}
        >
          {project.media[0] ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={project.media[0].src}
                alt={project.media[0].alt}
                className="absolute inset-0 h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink-950/80 via-ink-950/10 to-transparent" />
            </>
          ) : (
            <>
              <div className="absolute inset-0 bg-grid opacity-40" />
              <span className="relative font-mono text-4xl font-bold tracking-tight text-white/90">
                {project.cover.initials}
              </span>
            </>
          )}
          <span className="absolute right-3 top-3 rounded-md bg-black/40 px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-wide text-white/90 backdrop-blur">
            {project.type}
          </span>
        </div>
      </Link>

      {/* Body */}
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center gap-2 font-mono text-[0.72rem] text-mist-600">
          <span className="text-green-500">{project.year}</span>
          <span>·</span>
          <span>{project.role}</span>
        </div>

        <h3 className="mt-2 flex items-center gap-1.5 font-display text-lg font-semibold text-mist-100">
          <Link href={href} className="after:absolute after:inset-0">
            {project.title}
          </Link>
          <ArrowUpRightIcon className="h-4 w-4 text-mist-600 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-green-400" />
        </h3>

        <p className="mt-2 flex-1 text-sm leading-relaxed text-mist-400">
          {project.summary}
        </p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {project.stack.slice(0, 4).map((s) => (
            <Chip key={s}>{s}</Chip>
          ))}
          {project.stack.length > 4 && <Chip>+{project.stack.length - 4}</Chip>}
        </div>

        <div className="relative z-10 mt-4 flex items-center justify-between gap-4 border-t border-ink-600 pt-3 font-mono text-sm">
          {project.links.live ? (
            <a
              href={project.links.live}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-green-400 transition-colors hover:text-green-300"
            >
              <ExternalLinkIcon className="h-4 w-4" /> access platform
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-mist-500">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> coming soon
            </span>
          )}
          {project.links.code && (
            <a
              href={project.links.code}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-mist-400 transition-colors hover:text-green-400"
            >
              <GitHubIcon className="h-4 w-4" /> code
            </a>
          )}
        </div>
      </div>
    </SpotlightCard>
  );
}
