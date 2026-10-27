"use client";

import { useEffect, useRef, useState } from "react";
import { projects, projectTags } from "@/lib/portfolio";
import { ProjectCard } from "@/components/project-card";

const PAGE_SIZE = 6;

export function WorkDirectory() {
  const [active, setActive] = useState("All");
  const [page, setPage] = useState(1);

  /* ?tag= in the URL picks the filter.
   *
   * The services cards on the home page promise a category and used to land
   * everybody on the same unfiltered fifteen, which asked the visitor to redo
   * the sorting the card had just offered to do. Now they link to
   * /work/?tag=Fintech and arrive on that shelf.
   *
   * Read on mount rather than in the initial state: this is a static export,
   * so the HTML is prerendered with no query string, and initialising from
   * location.search during the first render is a hydration mismatch. One
   * frame shows "all" before the filter applies, which is cheaper than
   * `useSearchParams` — that forces this whole page into a Suspense
   * boundary under `output: export`.
   *
   * An unknown tag is ignored rather than shown as an empty grid: a stale
   * link should degrade to the full directory, not to "No projects".
   */
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tag = new URLSearchParams(window.location.search).get("tag");
    if (!tag || tag === "All" || !projectTags.includes(tag)) return;
    setActive(tag);
    // Land on the filtered grid, the way an #anchor would. The page hero is
    // most of a screen tall, so arriving at the very top from a card that
    // said "See 4 projects" shows the same unfiltered-looking heading and
    // gives no sign the filter took — the pills are below the fold.
    top.current?.scrollIntoView({ block: "start" });
  }, []);

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
    // Keep the URL honest, so a filtered view can be copied out of the address
    // bar and sent to somebody. replaceState rather than push: the filter is
    // not a place, and twelve pills tapped in a row should not mean twelve
    // presses of the back button to leave the page.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (tag === "All") url.searchParams.delete("tag");
      else url.searchParams.set("tag", tag);
      window.history.replaceState(null, "", url.toString());
    }
  }

  return (
    // scroll-mt clears the sticky header when we jump here from a ?tag= link.
    <div ref={top} className="scroll-mt-24">
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
                  ? "bg-green-400 text-on-accent"
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
                  ? "bg-green-400 text-on-accent"
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
