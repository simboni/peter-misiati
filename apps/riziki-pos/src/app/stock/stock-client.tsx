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
import Link from "next/link";
import { formatKes, formatQty, formatUnits } from "@/lib/units";
import { Card, Chip, Empty, PageTitle, SectionLabel, Stat, inputClass } from "@/components/ui";
import type { ReagentGroup, StockLine, StockStatus, StockView } from "@/lib/stock-service";

const LABEL: Record<StockStatus, string> = {
  in: "In stock",
  low: "Low",
  reorder: "Reorder",
};

const TONE = { in: "good", low: "warn", reorder: "bad" } as const;

function StatusChip({ status }: { status: StockStatus }) {
  return <Chip tone={TONE[status]}>{LABEL[status]}</Chip>;
}

function Row({ line, owner }: { line: StockLine; owner: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-line py-2 first:border-t-0 break-inside-avoid">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold leading-snug">{line.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <StatusChip status={line.status} />
          {owner ? (
            <span className="text-[11px] text-muted tnum">{formatKes(line.valueCents)} at cost</span>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {/* the count he says out loud, then the amount the formulas need */}
        <div className="text-sm font-bold tnum">
          {formatUnits(line.qtyMilli, line.sizeMilli, line.unitLabel)}
        </div>
        <div className="text-[11px] text-muted tnum">{formatQty(line.qtyMilli, line.unit)}</div>
      </div>
    </div>
  );
}

function Group({ group, owner }: { group: ReagentGroup; owner: boolean }) {
  return (
    <Card className="mb-3 break-inside-avoid xl:mb-4">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold tracking-tight">{group.name}</h3>
          {group.aliases ? (
            <p className="truncate text-[11px] text-muted">{group.aliases.split(",").join(" · ")}</p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-extrabold tnum">{formatQty(group.totalMilli, group.unit)}</div>
          <div className="text-[11px] text-muted">all sizes</div>
        </div>
      </div>
      {group.lines.map((l) => (
        <Row key={l.id} line={l} owner={owner} />
      ))}
    </Card>
  );
}

function matches(haystack: string, terms: string[]): boolean {
  return terms.every((t) => haystack.includes(t));
}

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

  // A hit on the chemical (name or alias) keeps the whole block, so typing
  // "SLES" shows the Ungerol drum and every pack size under it at once.
  const reagents = useMemo(() => {
    if (!terms.length) return view.reagents;
    const out: ReagentGroup[] = [];
    for (const g of view.reagents) {
      if (matches(g.search, terms)) {
        out.push(g);
        continue;
      }
      const lines = g.lines.filter((l) => matches(l.search, terms));
      if (lines.length) out.push({ ...g, lines });
    }
    return out;
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

  return (
    <div>
      <PageTitle title="Stock" subtitle={`${view.itemCount} items across the shop`} />

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
      {/* From lg the two shortcuts and the search box share one line: on a
          laptop this block is chrome, and it was costing two rows of stock. */}
      <div className="lg:col-span-8 lg:flex lg:items-start lg:gap-2 xl:col-span-9 2xl:col-span-10">
      <div className="mb-3 grid grid-cols-2 gap-2 lg:mb-0 lg:shrink-0">
        <Link
          href="/purchases"
          className="flex min-h-11 items-center justify-center rounded-xl border border-line bg-white px-4 text-center text-sm font-bold hover:bg-wash xl:min-h-9"
        >
          Delivery in
        </Link>
        <Link
          href="/stocktake"
          className="flex min-h-11 items-center justify-center rounded-xl border border-line bg-white px-4 text-center text-sm font-bold hover:bg-wash xl:min-h-9"
        >
          Stock take
        </Link>
      </div>

      <input
        className={`${inputClass} lg:min-w-0 lg:flex-1`}
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

      {reagents.length ? (
        <>
          <SectionLabel>Reagents</SectionLabel>
          <div className="gap-3 md:columns-2 xl:columns-3 xl:gap-4 2xl:columns-4 3xl:columns-5">
            {reagents.map((g) => (
              <Group key={g.chemicalId} group={g} owner={owner} />
            ))}
          </div>
        </>
      ) : null}

      {finished.length ? (
        <>
          <SectionLabel>Finished goods</SectionLabel>
          <Card className="mb-3 gap-x-6 md:columns-2 xl:columns-3 2xl:columns-4 3xl:columns-5">
            {finished.map((l) => (
              <Row key={l.id} line={l} owner={owner} />
            ))}
          </Card>
        </>
      ) : null}

      {packaging.length ? (
        <>
          <SectionLabel>Packaging</SectionLabel>
          <Card className="mb-3 gap-x-6 md:columns-2 xl:columns-3 2xl:columns-4 3xl:columns-5">
            {packaging.map((l) => (
              <Row key={l.id} line={l} owner={owner} />
            ))}
          </Card>
        </>
      ) : null}
    </div>
  );
}
