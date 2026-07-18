"use client";

import { useState } from "react";
import Link from "next/link";
import { projects, type Project } from "@/lib/portfolio";
import { Chip } from "@/components/project-card";
import { ArrowRightIcon } from "@/components/icons";

/**
 * Editorial work index for the home page — a compact, name-first list that
 * scales to many projects without overwhelming the reader. Each row expands
 * in place (one at a time) to show the preview: image, one-liner, tags and
 * the link to the full case study. The first row starts open so the section
 * leads with a visual.
 */

const works = projects.filter((p) => p.slug !== "smp-portfolio");

export function WorkIndex() {
  const [open, setOpen] = useState<string | null>(works[0]?.slug ?? null);

  return (
    <div className="mt-10 border-t border-ink-600">
      {works.map((p, i) => (
        <IndexRow
          key={p.slug}
          project={p}
          index={i}
          open={open === p.slug}
          onToggle={() => setOpen(open === p.slug ? null : p.slug)}
        />
      ))}
    </div>
  );
}

function IndexRow({
  project: p,
  index,
  open,
  onToggle,
}: {
  project: Project;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-ink-600">
      {/* Name row — the whole line is the toggle */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`work-panel-${p.slug}`}
        className="group flex w-full items-baseline gap-3 py-4 text-left sm:gap-5 sm:py-5"
      >
        <span className="w-7 shrink-0 text-xs font-semibold tabular-nums text-mist-600">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span
          className={`min-w-0 flex-1 truncate font-display text-lg font-bold tracking-tight transition-colors sm:text-2xl ${
            open ? "text-green-400" : "text-mist-100 group-hover:text-green-400"
          }`}
        >
          {p.title}
        </span>
        <span className="hidden shrink-0 text-xs text-mist-500 sm:inline">
          {p.category ?? p.type}
        </span>
        <span className="hidden shrink-0 text-xs text-mist-600 sm:inline">{p.year}</span>
        <span
          aria-hidden
          className={`shrink-0 self-center text-lg leading-none text-mist-500 transition-transform duration-300 ${
            open ? "rotate-45 text-green-400" : "group-hover:text-green-400"
          }`}
        >
          +
        </span>
      </button>

      {/* Preview panel — animates open via the 0fr -> 1fr grid trick */}
      <div
        id={`work-panel-${p.slug}`}
        className={`grid transition-[grid-template-rows] duration-500 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="grid gap-5 pb-7 sm:grid-cols-5 sm:items-center sm:gap-8 sm:pb-8 sm:pl-12">
            <Link
              href={`/work/${p.slug}`}
              className="sm:col-span-3"
              tabIndex={open ? 0 : -1}
              aria-label={`${p.title} — case study`}
            >
              {p.media[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.media[0].src}
                  alt={p.media[0].alt}
                  loading="lazy"
                  className="aspect-[16/9] w-full rounded-xl border border-ink-600 object-cover object-top"
                />
              ) : (
                <div
                  className={`relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-xl border border-ink-600 bg-gradient-to-br ${p.cover.from} ${p.cover.to}`}
                >
                  <div className="absolute inset-0 bg-black/45" />
                  <span className="relative font-mono text-4xl font-bold tracking-tight text-white/90">
                    {p.cover.initials}
                  </span>
                </div>
              )}
            </Link>

            <div className="sm:col-span-2">
              <p className="text-sm leading-relaxed text-mist-400">{p.summary}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {p.tags.slice(0, 3).map((t) => (
                  <Chip key={t}>{t}</Chip>
                ))}
              </div>
              <Link
                href={`/work/${p.slug}`}
                tabIndex={open ? 0 : -1}
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-green-400 transition-colors hover:text-green-300"
              >
                View case study
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
