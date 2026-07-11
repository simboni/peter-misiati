import type { Project } from "@/lib/cosdep";
import { programs } from "@/lib/cosdep";
import { Pill } from "@/components/ui";
import { PinIcon } from "@/components/icons";

function programTitle(slug: string) {
  return programs.find((p) => p.slug === slug)?.title ?? "";
}

const statusTone = {
  Ongoing: "leaf",
  Upcoming: "forest",
  Completed: "sand",
} as const;

/** A project card for the projects directory / home grid. */
export function ProjectCard({ project }: { project: Project }) {
  return (
    <article className="group card flex flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-lift">
      <div className="relative aspect-[16/10] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={project.image}
          alt={project.imageAlt}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute left-3 top-3">
          <Pill tone={statusTone[project.status]}>{project.status}</Pill>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-6">
        <span className="font-display text-xs font-semibold uppercase tracking-wider text-forest-600">
          {programTitle(project.program)}
        </span>
        <h3 className="mt-2 font-display text-lg font-bold leading-snug text-ink-900">
          {project.title}
        </h3>
        <p className="mt-3 flex-1 text-sm leading-relaxed text-ink-500">
          {project.summary}
        </p>
        <div className="mt-5 flex items-center gap-1.5 border-t border-sand-200 pt-4 text-sm text-ink-500">
          <PinIcon className="h-4 w-4 shrink-0 text-forest-500" />
          {project.location}
        </div>
      </div>
    </article>
  );
}
