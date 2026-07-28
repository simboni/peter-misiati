import Link from "next/link";
import type { Project } from "@/lib/keysa";
import { getProgram } from "@/lib/keysa";
import { Chip } from "@/components/ui";
import { ArrowRightIcon, CalendarIcon, MapPinIcon } from "@/components/icons";

export function ProjectCard({ project }: { project: Project }) {
  const program = getProgram(project.programSlug);
  return (
    <Link
      href={`/projects/${project.slug}/`}
      className="group flex h-full flex-col rounded-2xl border border-ink-600 bg-ink-800 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-green-400/50 hover:shadow-[0_24px_48px_-24px_rgba(15,40,20,0.35)] sm:p-7"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={project.status === "Completed" ? "green" : "red"}>
          {project.status}
        </Chip>
        {program && <Chip>{program.short}</Chip>}
      </div>
      <h3 className="mt-4 font-display text-xl font-bold tracking-tight text-mist-100 transition-colors group-hover:text-green-300">
        {project.title}
      </h3>
      <p className="mt-1 text-sm font-medium text-mist-500">{project.subtitle}</p>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-mist-400">
        {project.summary}
      </p>
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-ink-600 pt-4 text-xs text-mist-500">
        <span className="inline-flex items-center gap-1.5">
          <CalendarIcon className="h-3.5 w-3.5" />
          {project.duration}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MapPinIcon className="h-3.5 w-3.5" />
          Namamali Ward
        </span>
      </div>
      <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-green-400">
        View project
        <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </span>
    </Link>
  );
}
