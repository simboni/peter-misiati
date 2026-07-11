import Link from "next/link";
import type { Program } from "@/lib/cosdep";
import { ArrowRightIcon, CheckIcon } from "@/components/icons";

/** A programme pillar card — image, summary and its key activities. */
export function ProgramCard({ program }: { program: Program }) {
  return (
    <Link
      href={`/programs#${program.slug}`}
      className="group card flex flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-lift"
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={program.image}
          alt={program.imageAlt}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-forest-950/55 to-transparent" />
        <span className="absolute bottom-3 left-4 font-display text-xs font-semibold uppercase tracking-wider text-white/90">
          {program.tagline}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-6">
        <h3 className="font-display text-xl font-bold text-ink-900">
          {program.title}
        </h3>
        <p className="mt-3 flex-1 text-sm leading-relaxed text-ink-500">
          {program.summary}
        </p>

        <ul className="mt-5 grid gap-1.5">
          {program.activities.slice(0, 3).map((a) => (
            <li key={a} className="flex items-center gap-2 text-sm text-ink-600">
              <CheckIcon className="h-4 w-4 shrink-0 text-forest-500" />
              {a}
            </li>
          ))}
        </ul>

        <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-forest-600 transition-colors group-hover:text-forest-700">
          Explore programme
          <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
