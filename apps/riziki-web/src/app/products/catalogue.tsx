"use client";

import { useId, useMemo, useState } from "react";
import {
  CATEGORIES,
  ITEMS,
  matchesQuery,
  type CategoryId,
} from "@/lib/catalogue";
import { whatsappForItem } from "@/lib/business";
import { Tag, WhatsAppIcon } from "@/components/ui";

type Filter = CategoryId | "all";

/**
 * The catalogue with its search and category filter.
 *
 * The site is a static export, so there is no search endpoint to call: the
 * whole list — around forty items — is prerendered into the HTML and filtered
 * in the browser. That keeps the page usable the instant it paints, works with
 * JavaScript still loading on a slow connection, and costs one keystroke pass
 * over a few dozen strings.
 */
export function Catalogue() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const searchId = useId();

  const visible = useMemo(() => {
    const trimmed = query.trim();
    return ITEMS.filter(
      (item) =>
        (filter === "all" || item.category === filter) && matchesQuery(item.slug, trimmed),
    );
  }, [query, filter]);

  const groups = CATEGORIES.map((category) => ({
    category,
    items: visible.filter((item) => item.category === category.id),
  })).filter((group) => group.items.length > 0);

  return (
    <div>
      {/* Search */}
      <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <label htmlFor={searchId} className="block text-sm font-extrabold">
          Search the catalogue
        </label>
        <p className="mt-1 text-sm text-muted">
          Type a chemical name, a local name or what you are making — try{" "}
          <span className="font-semibold text-ink">sles</span>,{" "}
          <span className="font-semibold text-ink">soda ash</span> or{" "}
          <span className="font-semibold text-ink">shampoo</span>.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. caustic, ungerol, degreaser"
            autoComplete="off"
            className="w-full rounded-xl border border-line bg-page px-4 py-3 text-base text-ink placeholder:text-muted"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="shrink-0 rounded-xl border border-line px-4 py-3 text-sm font-bold text-muted hover:bg-surface-2"
            >
              Clear
            </button>
          ) : null}
        </div>

        {/* Category filter */}
        <div className="mt-4">
          <p id={`${searchId}-cat`} className="text-xs font-bold uppercase tracking-[0.16em] text-muted">
            Filter by group
          </p>
          <div
            role="group"
            aria-labelledby={`${searchId}-cat`}
            className="mt-2 flex flex-wrap gap-2"
          >
            {([{ id: "all" as const, name: "All products" }, ...CATEGORIES]).map((category) => {
              const active = filter === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(category.id as Filter)}
                  className={`rounded-full border px-3.5 py-2 text-sm font-bold transition-colors ${
                    active
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-page text-muted hover:text-ink"
                  }`}
                >
                  {category.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Result count — announced so a screen reader knows the list changed. */}
      <p aria-live="polite" className="mt-5 text-sm font-semibold text-muted">
        Showing {visible.length} of {ITEMS.length} products
        {query.trim() ? ` for “${query.trim()}”` : ""}
      </p>

      {groups.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-line bg-surface p-6">
          <h3 className="text-base font-extrabold">Nothing matched that</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Try a shorter word, or the local name — many chemicals go by two names. If it is
            still not here, send us the name and we will tell you whether we have it.
          </p>
          <a
            href={whatsappForItem(query.trim() || "a chemical not on your list")}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-leaf-strong px-4 py-2.5 text-sm font-bold text-white hover:brightness-95"
          >
            <WhatsAppIcon />
            Ask us about it
          </a>
        </div>
      ) : null}

      {groups.map(({ category, items }) => (
        <section key={category.id} id={category.id} className="mt-10 scroll-mt-32">
          <h3 className="text-xl font-extrabold tracking-tight">{category.name}</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">{category.blurb}</p>

          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {items.map((item) => (
              <li
                key={item.slug}
                className="flex flex-col rounded-2xl border border-line bg-surface p-5"
              >
                <h4 className="text-base font-extrabold tracking-tight">{item.name}</h4>
                {item.aka?.length ? (
                  <p className="mt-1 text-xs font-semibold text-muted">
                    Also known as: {item.aka.slice(0, 3).join(", ")}
                  </p>
                ) : null}

                <p className="mt-3 flex-1 text-sm leading-relaxed text-muted">{item.uses}</p>

                {item.needsClientConfirmation ? (
                  <p className="mt-3 rounded-lg bg-leaf-soft px-3 py-2 text-xs font-semibold text-leaf-ink">
                    Description awaiting confirmation from Riziki — please ask before ordering.
                  </p>
                ) : null}

                <div className="mt-4">
                  <h5 className="text-xs font-bold uppercase tracking-[0.14em] text-muted">
                    Packs
                  </h5>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {item.packs.map((pack) => (
                      <Tag key={pack}>{pack}</Tag>
                    ))}
                  </div>
                </div>

                <a
                  href={whatsappForItem(item.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-accent hover:underline"
                >
                  <WhatsAppIcon />
                  Ask about {item.name}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
