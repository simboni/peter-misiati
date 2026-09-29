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

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatKes, formatQty, formatUnits } from "@/lib/units";
import { Chip, Empty, Stat, TableWrap, Th, Td } from "@/components/ui";
import { ClientSearch, ClientChips, ClientPager } from "@/components/list-controls";
import type { StockStatus, StockView } from "@/lib/stock-service";

const LABEL: Record<StockStatus, string> = {
  in: "In stock",
  low: "Low",
  reorder: "Reorder",
  // Sold and not yet replaced — a debt to the shop next door, not an order.
  owed: "Owed",
};

const TONE = { in: "good", low: "warn", reorder: "bad", owed: "bad" } as const;

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
  /*
    What kind of thing, and what is running out.

    The shelf is forty-six rows of three different kinds and the two questions
    asked of it are never "show me everything": they are "what do I need to
    order" and "how much of the packaging is left". Chips, because that is what
    every other list in the app uses, and instant, because the whole shelf is
    already here.
  */
  const [kind, setKind] = useState<"all" | "attention" | "bulk" | "finished" | "packaging">("all");

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
  const searched = useMemo(
    () => [...reagents, ...finished, ...packaging],
    [reagents, finished, packaging],
  );

  /** Low or out — the rows an owner opens this screen to find. */
  const needsAttention = (l: { status: string }) => l.status === "low" || l.status === "reorder";

  const rows = useMemo(() => {
    if (kind === "all") return searched;
    if (kind === "attention") return searched.filter(needsAttention);
    if (kind === "bulk") return searched.filter((l) => l.kind === "bulk" || l.kind === "pack");
    return searched.filter((l) => l.kind === kind);
  }, [searched, kind]);

  /* Counted over the search, not over the chip: a chip that counts only what is
     already chosen stops being worth reading. */
  const counts = useMemo(
    () => ({
      all: searched.length,
      attention: searched.filter(needsAttention).length,
      bulk: searched.filter((l) => l.kind === "bulk" || l.kind === "pack").length,
      finished: searched.filter((l) => l.kind === "finished").length,
      packaging: searched.filter((l) => l.kind === "packaging").length,
    }),
    [searched],
  );

  /*
    The page, and the search it belongs to.

    A new search is a new list, and staying on page four of the old one shows an
    empty table that reads as "nothing matches". Resetting in an effect would
    mean rendering that empty page first and then correcting it, so the query
    the page was chosen under is remembered instead and a stale one simply
    reads as page 1.
  */
  const [pageFor, setPageFor] = useState({ key: `${initialQuery}|all`, page: 1 });
  const pageKey = `${query}|${kind}`;
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const current = pageFor.key === pageKey ? Math.min(pageFor.page, pages) : 1;
  const shown = rows.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  const goTo = (n: number) => setPageFor({ key: pageKey, page: Math.min(Math.max(1, n), pages) });

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
      <ClientSearch
        value={query}
        onChange={setQuery}
        placeholder="Search — try SLES, soda ash, jerrican"
        label="Search stock by name or chemical alias"
      />
      <ClientChips
        current={kind}
        onPick={(k) => setKind(k as typeof kind)}
        filters={[
          { key: "all", label: "All", count: counts.all },
          { key: "attention", label: "Low or out", count: counts.attention },
          { key: "bulk", label: "Chemicals", count: counts.bulk },
          { key: "finished", label: "Products", count: counts.finished },
          { key: "packaging", label: "Containers", count: counts.packaging },
        ].filter((f) => f.key === "all" || f.count > 0)}
      />
      </div>
      </div>

      {nothing ? (
        <Empty>Nothing matches “{query}”.</Empty>
      ) : rows.length === 0 ? (
        <Empty>Nothing on the shelf is in that group right now.</Empty>
      ) : null}

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
                  {/*
                    The name is the way in to the ledger behind the number.

                    Only for the owner: an attendant who could read what each
                    batch took, line by line, could work the recipe out by
                    subtraction — the same reason they never receive the reagent
                    quantities on this screen at all.
                  */}
                  {owner ? (
                    <Link href={`/stock/${l.id}`} className="font-bold text-ink hover:underline">
                      {l.name}
                    </Link>
                  ) : (
                    <span className="font-bold">{l.name}</span>
                  )}
                  {l.chemicalName && l.chemicalName !== l.name ? (
                    <span className="ml-1.5 text-[11px] text-muted">{l.chemicalName}</span>
                  ) : null}
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <StatusChip status={l.status} />
                    {/*
                      On the shelf, and not on the till.

                      A real state — a concentrate the shop only mixes with is
                      exactly this — and also the one way a product could be
                      stocked, counted and quietly unsellable with nothing
                      anywhere saying why. The shelf is where anybody notices,
                      so the shelf is where it is said.
                    */}
                    {l.sellable ? null : <Chip tone="warn">Not sold at the counter</Chip>}
                  </div>
                </Td>
                <Td className="text-[11px] uppercase tracking-wide text-muted">{KIND_LABEL[l.kind]}</Td>
                <Td align="right">
                  <span className="font-bold">{formatQty(l.qtyMilli, l.unit)}</span>
                </Td>
                <Td align="right" className="text-muted">
                  {/*
                    For a thing poured in advance, "how many containers" is a
                    count of what is standing there, not the weight divided by a
                    container size. Those are different questions and the shop
                    asks the first one: 46 kg is not two jerricans until somebody
                    has poured it into two jerricans.
                  */}
                  {/*
                    A debt has no containers.

                    Dividing minus seven kilogrammes by a 25 kg drum gives
                    "-0.28 kgs", which is arithmetic nobody asked for about a
                    thing that is not on the shelf at all. What is useful is the
                    errand.
                  */}
                  {l.qtyMilli < 0 ? (
                    <span className="whitespace-nowrap font-semibold text-bad">
                      {formatQty(-l.qtyMilli, l.unit)} to replace
                    </span>
                  ) : l.poured ? (
                    <div className="space-y-0.5">
                      {l.poured.sizes.length ? (
                        l.poured.sizes.map((z) => (
                          <div key={z.sizeMilli} className="whitespace-nowrap font-semibold text-ink">
                            {z.filled} × {formatQty(z.sizeMilli, l.unit)}
                          </div>
                        ))
                      ) : (
                        <div className="whitespace-nowrap">none poured yet</div>
                      )}
                      {l.poured.looseMilli > 0 ? (
                        <div className="whitespace-nowrap text-[11px]">
                          {formatQty(l.poured.looseMilli, l.unit)} loose
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    formatUnits(l.qtyMilli, l.sizeMilli, l.unitLabel)
                  )}
                </Td>
                {owner ? <Td align="right">{formatKes(l.valueCents)}</Td> : null}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : null}

      {/* Paging inside the window: the whole list is already in the browser, so
          turning a page costs nothing and never leaves Stock. It reads like the
          pager on every other list, because the shop should only have to learn
          one. */}
      <ClientPager
        page={current}
        pages={pages}
        total={rows.length}
        noun="row"
        note={
          rows.length === view.itemCount
            ? undefined
            : `of ${view.itemCount} on the shelf`
        }
        onGo={goTo}
      />

    </div>
  );
}
