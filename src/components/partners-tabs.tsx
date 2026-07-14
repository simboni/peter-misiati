"use client";

import { useMemo, useState } from "react";
import type { Project } from "@/lib/portfolio";
import { BrandLogo } from "@/components/client-logos";
import { ExternalLinkIcon, ArrowUpRightIcon } from "@/components/icons";

const CATEGORY_ORDER = ["Web Apps", "Business", "NGOs", "Political"];

export function PartnersTabs({ works }: { works: Project[] }) {
  // Ordered list of categories present in the data.
  const categories = useMemo(() => {
    const present = Array.from(new Set(works.map((w) => w.category).filter(Boolean))) as string[];
    present.sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a);
      const ib = CATEGORY_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return present;
  }, [works]);

  const tabs = ["All", ...categories];
  const [active, setActive] = useState("All");

  const shown = active === "All" ? works : works.filter((w) => w.category === active);

  return (
    <div>
      {/* Tabs */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Partner categories">
        {tabs.map((tab) => {
          const count = tab === "All" ? works.length : works.filter((w) => w.category === tab).length;
          const isActive = active === tab;
          return (
            <button
              key={tab}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(tab)}
              className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 font-mono text-sm transition-all duration-200 ${
                isActive
                  ? "border-green-400/60 bg-green-400/10 text-green-300"
                  : "border-ink-600 bg-ink-800 text-mist-400 hover:border-ink-500 hover:text-mist-200"
              }`}
            >
              {tab}
              <span className={`text-xs ${isActive ? "text-green-400/70" : "text-mist-600"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Grid */}
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((w) => (
          <PartnerCard key={w.slug} project={w} />
        ))}
      </div>
    </div>
  );
}

function PartnerCard({ project }: { project: Project }) {
  const live = project.links.live;
  const href = live ?? `/work/${project.slug}`;

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-ink-600 bg-ink-800 transition-all duration-300 hover:-translate-y-1 hover:border-green-400/50 hover:shadow-[0_20px_50px_-30px_rgba(0,0,0,0.8)]">
      {/* Brand logo on its native background */}
      <a
        href={href}
        target={live ? "_blank" : undefined}
        rel={live ? "noopener noreferrer" : undefined}
        aria-label={`${project.title} — visit`}
        style={project.logoBg ? { background: project.logoBg } : undefined}
        className="flex h-28 items-center justify-center border-b border-ink-600 px-8"
      >
        <BrandLogo project={project} />
      </a>

      {/* Meta */}
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-lg font-semibold text-mist-100">{project.title}</h3>
          {project.category && (
            <span className="shrink-0 rounded-md border border-ink-600 bg-ink-700/60 px-2 py-0.5 font-mono text-[0.65rem] text-mist-400">
              {project.category}
            </span>
          )}
        </div>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-mist-400">{project.summary}</p>

        <div className="mt-4 flex items-center gap-4 border-t border-ink-600 pt-3 font-mono text-sm">
          {live ? (
            <a
              href={live}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-green-400 transition-colors hover:text-green-300"
            >
              <ExternalLinkIcon className="h-4 w-4" /> visit
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-mist-500">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> coming soon
            </span>
          )}
          <a
            href={`/work/${project.slug}`}
            className="inline-flex items-center gap-1.5 text-mist-400 transition-colors hover:text-green-400"
          >
            <ArrowUpRightIcon className="h-4 w-4" /> case study
          </a>
        </div>
      </div>
    </div>
  );
}
