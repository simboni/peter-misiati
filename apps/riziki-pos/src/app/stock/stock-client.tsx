"use client";

/**
 * The stock list.
 *
 * Two numbers on every row on purpose: the owner counts drums, but the recipes
 * and the counter both work in kg, and the shop has lost money before by reading
 * one as the other.
 *
 * Search filters in the browser because all 100-odd items are already on the
 * page — the counter phone is often on a weak connection and a round trip per
 * keystroke would be unusable.
 */

import { useMemo, useState } from "react";
import { formatKes, formatQty, formatUnits } from "@/lib/units";
import { Chip, Empty, Stat, TableWrap, Th, Td, inputClass } from "@/components/ui";
import type { StockStatus, StockView } from "@/lib/stock-service";

const LABEL: Record<StockStatus, string> = {
  in: "In stock",
  low: "Low",
  reorder: "Reorder",
};

const TONE = { in: "good", low: "warn", reorder: "bad" } as const;

function StatusChip({ status }: { status: StockStatus }) {
  return <Chip tone={TONE[status]}>{LABEL[status]}</Chip>;
}

function matches(haystack: string, terms: string[]): boolean {
  return terms.every((t) => haystack.includes(t));
}

/** Enough to fill a laptop screen without the pager sliding out of reach. */
const PER_PAGE = 25;

const KIND_LABEL: Record<string, string> = {
  bulk: "Chemical",
  pack: "Pack",
  finished: "Product",
  packaging: "Container",
};

export function StockClient({
  view,
  owner,
  initialQuery = "",
}: {
  view: StockView;
  owner: boolean;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);

  const terms = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );

  /*
    A hit on the chemical keeps every line under it.

    The reagents arrive grouped by chemical, and the search has to respect that
    grouping even though the table no longer shows it: typing "SLES" should find
    the Ungerol drum, which is named neither SLES nor Ungerol on its own row.
    So the group's search text is tried first and, when it matches, the whole
    block is taken; otherwise the lines are searched one by one. The groups are
    flattened on the way out — they exist to carry the alias, not to be drawn.
  */
  const reagents = useMemo(() => {
    if (!terms.length) return view.reagents.flatMap((g) => g.lines);
    return view.reagents.flatMap((g) =>
      matches(g.search, terms) ? g.lines : g.lines.filter((l) => matches(l.search, terms)),
    );
  }, [view.reagents, terms]);

  const finished = useMemo(
    () => (terms.length ? view.finished.filter((l) => matches(l.search, terms)) : view.finished),
    [view.finished, terms],
  );
  const packaging = useMemo(
    () => (terms.length ? view.packaging.filter((l) => matches(l.search, terms)) : view.packaging),
    [view.packaging, terms],
  );

  const nothing = !reagents.length && !finished.length && !packaging.length;

  /*
    Everything on one list.

    A reagent, a finished product and a jerrican are the same question — what is
    on the shelf and how much of it — so they are one table with a Kind column
    rather than three sections that cannot be compared with each other.
  */
  const rows = useMemo(
    () => [...reagents, ...finished, ...packaging],
    [reagents, finished, packaging],
  );

  /*
    The page, and the search it belongs to.

    A new search is a new list, and staying on page four of the old one shows an
    empty table that reads as "nothing matches". Resetting in an effect would
    mean rendering that empty page first and then correcting it, so the query
    the page was chosen under is remembered instead and a stale one simply
    reads as page 1.
  */
  const [pageFor, setPageFor] = useState({ query: initialQuery, page: 1 });
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const current = pageFor.query === query ? Math.min(pageFor.page, pages) : 1;
  const shown = rows.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  const goTo = (n: number) => setPageFor({ query, page: Math.min(Math.max(1, n), pages) });

  return (
    <div>
      {/*
        The value tile and the search box, side by side from lg.

        There were two shortcut buttons here as well — "Delivery in" and "Stock
        take". The stock take is a tab at the top of this window now, so that
        one was a button that moved you to where you already were; and a
        delivery belongs to Suppliers & purchases, which is a menu entry. Both
        were chrome costing two rows of stock on a laptop.
      */}
      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-4 xl:gap-x-5">
      <div className="lg:col-span-4 xl:col-span-3 2xl:col-span-2">
      {owner ? (
        <div className="mb-3">
          <Stat
            label="Stock value at cost"
            value={formatKes(view.totalValueCents)}
            detail="what is on the shelves, at weighted-average cost"
          />
        </div>
      ) : null}

      </div>
      <div className="lg:col-span-8 xl:col-span-9 2xl:col-span-10">
      <input
        className={`${inputClass} w-full`}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search — try SLES, soda ash, jerrican"
        aria-label="Search stock by name or chemical alias"
        autoComplete="off"
      />

      </div>
      </div>

      {nothing ? <Empty>Nothing matches “{query}”.</Empty> : null}

      {/*
        One table, not three columns of cards.

        The reagents used to be a card per chemical with its pack sizes nested
        inside, which made sense when a chemical was five rows. It is one row
        now — one price, one quantity — so the nesting was a box drawn around a
        single line, and the three sections could not be compared with each
        other because none of their numbers lined up.
      */}
      {shown.length ? (
        <TableWrap>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th>Kind</Th>
              <Th align="right">On the shelf</Th>
              <Th align="right">Containers</Th>
              {owner ? <Th align="right">At cost</Th> : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.id} className="hover:bg-wash/50">
                <Td>
                  <span className="font-bold">{l.name}</span>
                  {l.chemicalName && l.chemicalName !== l.name ? (
                    <span className="ml-1.5 text-[11px] text-muted">{l.chemicalName}</span>
                  ) : null}
                  <div className="mt-0.5">
                    <StatusChip status={l.status} />
                  </div>
                </Td>
                <Td className="text-[11px] uppercase tracking-wide text-muted">{KIND_LABEL[l.kind]}</Td>
                <Td align="right">
                  <span className="font-bold">{formatQty(l.qtyMilli, l.unit)}</span>
                </Td>
                <Td align="right" className="text-muted">
                  {formatUnits(l.qtyMilli, l.sizeMilli, l.unitLabel)}
                </Td>
                {owner ? <Td align="right">{formatKes(l.valueCents)}</Td> : null}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : null}

      {/* Paging inside the window: the whole list is already in the browser, so
          turning a page costs nothing and never leaves Stock. */}
      {pages > 1 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => goTo(current - 1)}
            disabled={current <= 1}
            className="flex min-h-11 items-center rounded-xl border border-line bg-white px-4 text-sm font-bold disabled:opacity-40 xl:min-h-9"
          >
            ← Back
          </button>
          <span className="text-[13px] font-semibold text-muted">
            Page {current} of {pages} · {rows.length} items
          </span>
          <button
            type="button"
            onClick={() => goTo(current + 1)}
            disabled={current >= pages}
            className="flex min-h-11 items-center rounded-xl border border-line bg-white px-4 text-sm font-bold disabled:opacity-40 xl:min-h-9"
          >
            Next →
          </button>
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-muted">
          {rows.length} {rows.length === 1 ? "item" : "items"}
        </p>
      )}
    </div>
  );
}
