"use client";

import { useState } from "react";
import { projects, projectTags } from "@/lib/portfolio";
import { ProjectCard } from "@/components/project-card";

const PAGE_SIZE = 6;

export function WorkDirectory() {
  const [active, setActive] = useState("All");
  const [page, setPage] = useState(1);

  const filtered =
    active === "All" ? projects : projects.filter((p) => p.tags.includes(active));

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamp in case the filter shrank the list below the current page.
  const current = Math.min(page, totalPages);
  const start = (current - 1) * PAGE_SIZE;
  const paged = filtered.slice(start, start + PAGE_SIZE);

  function selectTag(tag: string) {
    setActive(tag);
    setPage(1);
  }

  return (
    <div>
      {/* Filter pills */}
      <div className="flex flex-wrap gap-2 font-mono text-sm">
        {projectTags.map((tag) => {
          const on = tag === active;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => selectTag(tag)}
              aria-pressed={on}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                on
                  ? "bg-green-400 text-ink-950"
                  : "border border-ink-600 text-mist-400 hover:border-green-400/60 hover:text-green-300"
              }`}
            >
              {tag === "All" ? "all" : tag}
            </button>
          );
        })}
      </div>

      {/* Grid */}
      <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {paged.map((p) => (
          <ProjectCard key={p.slug} project={p} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="mt-12 text-center text-mist-500">
          No projects in this category yet.
        </p>
      )}

      {totalPages > 1 && (
        <Pagination
          page={current}
          totalPages={totalPages}
          count={filtered.length}
          onChange={setPage}
        />
      )}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  count,
  onChange,
}: {
  page: number;
  totalPages: number;
  count: number;
  onChange: (page: number) => void;
}) {
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, count);

  return (
    <nav
      className="mt-12 flex flex-col items-center gap-4 text-sm"
      aria-label="Work directory pages"
    >
      <p className="text-mist-500">
        {`Showing ${from}–${to} of ${count}`}
      </p>

      <div className="flex items-center gap-2">
        <PagerButton
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
          aria-label="Previous page"
        >
          ←
        </PagerButton>

        {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => {
          const on = n === page;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              aria-current={on ? "page" : undefined}
              className={`h-9 w-9 rounded-md transition-colors ${
                on
                  ? "bg-green-400 text-ink-950"
                  : "border border-ink-600 text-mist-400 hover:border-green-400/60 hover:text-green-300"
              }`}
            >
              {n}
            </button>
          );
        })}

        <PagerButton
          disabled={page === totalPages}
          onClick={() => onChange(page + 1)}
          aria-label="Next page"
        >
          →
        </PagerButton>
      </div>
    </nav>
  );
}

function PagerButton({
  disabled,
  onClick,
  children,
  ...rest
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-md border border-ink-600 text-mist-300 transition-colors hover:border-green-400/60 hover:text-green-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-ink-600 disabled:hover:text-mist-300"
      {...rest}
    >
      {children}
    </button>
  );
}
