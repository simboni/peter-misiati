"use client";

import { useState } from "react";
import { projects, programs } from "@/lib/cosdep";
import { ProjectCard } from "@/components/project-card";

const FILTERS = [
  { slug: "all", label: "All projects" },
  ...programs.map((p) => ({ slug: p.slug, label: p.title })),
];

export function ProjectsDirectory() {
  const [active, setActive] = useState("all");
  const shown =
    active === "all"
      ? projects
      : projects.filter((p) => p.program === active);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const isActive = active === f.slug;
          const count =
            f.slug === "all"
              ? projects.length
              : projects.filter((p) => p.program === f.slug).length;
          return (
            <button
              key={f.slug}
              type="button"
              onClick={() => setActive(f.slug)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-forest-600 text-white shadow-soft"
                  : "bg-sand-100 text-ink-600 hover:bg-forest-50 hover:text-forest-700"
              }`}
            >
              {f.label}
              <span
                className={`rounded-full px-1.5 text-xs ${
                  isActive ? "bg-white/20" : "bg-white text-ink-500"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {shown.map((p) => (
          <ProjectCard key={p.slug} project={p} />
        ))}
      </div>
    </div>
  );
}
