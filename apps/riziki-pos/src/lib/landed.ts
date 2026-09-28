/**
 * What the shop actually pays for a kilo, delivery by delivery.
 *
 * WHY IT EXISTS. The seller asked for it, and the reason is a pricing decision
 * he makes every week: a drum has gone up, and he has to decide whether to move
 * the price, absorb it, or buy elsewhere. Until now the only cost on any screen
 * was the blended average — which is the right number for valuing stock and the
 * wrong one for that decision, because it is deliberately slow. Ungerol landing
 * at 392 against a blend of 363.90 is the fact he needs; the blend hides it for
 * as long as the old drum lasts.
 *
 * SO THIS IS THE OTHER NUMBER. The landed rate per kilo, litre or piece on each
 * delivery: what the supplier charged plus that line's share of the transport,
 * over what actually arrived. Beside it, the delivery before it, and the
 * difference between the two — which is the thing to act on.
 *
 * COST ON FILE IS STILL THE BLEND, and this screen never argues with it. Stock
 * is worth what it cost on average and a sale is costed at the average; that is
 * what the tills charge against and what the dashboard reports. Landed cost is
 * a forward-looking figure: what the NEXT drum will do to that average.
 *
 * Nothing here recomputes a cost. Every rate below is read off a purchase line
 * whose landed total was written when the delivery was recorded.
 */

import { all, get } from "./db.ts";
import type { DateRange } from "./reports.ts";

const MILLI = 1000;

export interface LandedDelivery {
  at: string;
  ref: string;
  supplier: string | null;
  /** Per kilo, litre or piece — never per drum. */
  rateCents: number;
  /** What the whole line landed at, transport included. */
  totalCents: number;
  qtyMilli: number;
  units: number;
}

export interface LandedRow {
  itemId: number;
  name: string;
  kind: string;
  unit: string;
  /** The weighted average the tills charge against. */
  costCents: number;
  priceCents: number;
  /** What the shop is holding, and what that is worth at the blended cost. */
  heldMilli: number;
  stockValueCents: number;
  /** The most recent delivery in the window, and the one before it. */
  latest: LandedDelivery | null;
  previous: LandedDelivery | null;
  /** latest − previous, and as a percentage of the previous. */
  moveCents: number;
  movePct: number;
  /** How many priced deliveries this item has ever had. */
  deliveries: number;
  /**
   * What the latest landed rate leaves at today's asking price. The margin to
   * decide on, as against the margin being earned today off older stock.
   */
  freshMarginPct: number;
  /** The latest landed rate is at or above the asking price. */
  underwater: boolean;
}

export const LANDED_ORDERS = ["move", "margin", "recent", "name", "value"] as const;
export type LandedOrder = (typeof LANDED_ORDERS)[number];

export const LANDED_ORDER_LABEL: Record<LandedOrder, string> = {
  move: "Biggest change",
  margin: "Thinnest margin",
  recent: "Most recent delivery",
  name: "Name",
  value: "Most money on the shelf",
};

export function isLandedOrder(v: string | undefined | null): v is LandedOrder {
  return !!v && (LANDED_ORDERS as readonly string[]).includes(v);
}

interface LineRow {
  item_id: number;
  at: string;
  ref: string;
  supplier: string | null;
  cost_cents: number;
  qty_milli: number;
  units: number;
}

/**
 * Every item that has ever been delivered, with its last two landed rates.
 *
 * WHAT A DATE RANGE MEANS HERE, and it is not what it means on a report. The
 * range picks which delivery counts as "latest" — the most recent one inside
 * it — but the one it is compared against is simply the delivery before that,
 * in or out of the window. A month with a single delivery in it should still
 * show what that delivery did to the price, and a comparison against nothing
 * would show zero and look like calm.
 */
export function landedCosts(opts: {
  q?: string;
  order?: LandedOrder;
  range?: DateRange | null;
} = {}): LandedRow[] {
  const order = opts.order ?? "move";
  const range = opts.range ?? null;

  const lines = all<LineRow>(
    `SELECT pl.item_id, p.at, p.ref, s.name AS supplier,
            pl.cost_cents, pl.qty_milli, pl.units
       FROM purchase_lines pl
       JOIN purchases p ON p.id = pl.purchase_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE pl.qty_milli > 0
      ORDER BY pl.item_id, p.at DESC, pl.id DESC`,
  );

  const byItem = new Map<number, LandedDelivery[]>();
  for (const l of lines) {
    const d: LandedDelivery = {
      at: l.at,
      ref: l.ref,
      supplier: l.supplier,
      rateCents: Math.round((l.cost_cents * MILLI) / l.qty_milli),
      totalCents: l.cost_cents,
      qtyMilli: l.qty_milli,
      units: l.units,
    };
    const list = byItem.get(l.item_id);
    if (list) list.push(d);
    else byItem.set(l.item_id, [d]);
  }

  const items = all<{
    id: number;
    name: string;
    kind: string;
    canonical_unit: string;
    cost_cents: number;
    price_cents: number;
    held: number;
  }>(
    `SELECT i.id, i.name, i.kind, i.canonical_unit, i.cost_cents, i.price_cents,
            COALESCE((SELECT SUM(m.delta_milli) FROM stock_movements m WHERE m.item_id = i.id), 0) AS held
       FROM items i
      WHERE i.active = 1
      ORDER BY i.name`,
  );

  const needle = (opts.q ?? "").trim().toLowerCase();
  const words = needle ? needle.split(/\s+/) : [];

  const rows: LandedRow[] = [];
  for (const i of items) {
    const history = byItem.get(i.id) ?? []; // newest first
    if (!history.length) continue; // nothing has ever been bought — nothing to watch

    if (words.length) {
      const hay = `${i.name} ${i.kind} ${history[0].supplier ?? ""}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
    }

    // The latest delivery inside the window, and whatever came before it.
    const at = (d: LandedDelivery) => d.at.slice(0, 10);
    const index = range
      ? history.findIndex((d) => at(d) >= range.from && at(d) <= range.to)
      : 0;
    if (index < 0) continue; // nothing delivered in this window

    const latest = history[index] ?? null;
    const previous = history[index + 1] ?? null;

    const moveCents = latest && previous ? latest.rateCents - previous.rateCents : 0;
    const movePct = previous?.rateCents ? (moveCents / previous.rateCents) * 100 : 0;
    const held = Math.max(0, i.held);
    const fresh = latest?.rateCents ?? 0;

    rows.push({
      itemId: i.id,
      name: i.name,
      kind: i.kind,
      unit: i.canonical_unit,
      costCents: i.cost_cents,
      priceCents: i.price_cents,
      heldMilli: held,
      stockValueCents: Math.round((held * i.cost_cents) / MILLI),
      latest,
      previous,
      moveCents,
      movePct,
      deliveries: history.length,
      freshMarginPct: i.price_cents > 0 ? ((i.price_cents - fresh) / i.price_cents) * 100 : 0,
      underwater: i.price_cents > 0 && fresh >= i.price_cents,
    });
  }

  const sorters: Record<LandedOrder, (a: LandedRow, b: LandedRow) => number> = {
    // Biggest rise first, then biggest fall — a fall is news too, and a shop
    // that never sees one never lowers a price when it could.
    move: (a, b) => Math.abs(b.movePct) - Math.abs(a.movePct) || b.moveCents - a.moveCents,
    margin: (a, b) => a.freshMarginPct - b.freshMarginPct,
    recent: (a, b) => (b.latest?.at ?? "").localeCompare(a.latest?.at ?? ""),
    name: (a, b) => a.name.localeCompare(b.name),
    value: (a, b) => b.stockValueCents - a.stockValueCents,
  };
  rows.sort(sorters[order]);
  return rows;
}

export interface LandedSummary {
  /** Items watched: everything that has ever been bought. */
  watched: number;
  /** How many landed dearer than the delivery before, and how many cheaper. */
  dearer: number;
  cheaper: number;
  /** Items whose newest landed rate is at or above the asking price. */
  underwater: number;
  /** What the shelf is worth at the blended cost. */
  stockValueCents: number;
  /**
   * What the same shelf would cost to replace at the newest landed rates.
   *
   * The difference between these two is the pressure the shop has not yet felt:
   * stock bought cheaply is still being sold at yesterday's margin, and when it
   * runs out the margin goes with it.
   */
  replaceValueCents: number;
}

export function landedSummary(rows: LandedRow[]): LandedSummary {
  let dearer = 0;
  let cheaper = 0;
  let underwater = 0;
  let stockValueCents = 0;
  let replaceValueCents = 0;

  for (const r of rows) {
    if (r.previous && r.moveCents > 0) dearer++;
    if (r.previous && r.moveCents < 0) cheaper++;
    if (r.underwater) underwater++;
    stockValueCents += r.stockValueCents;
    replaceValueCents += Math.round((r.heldMilli * (r.latest?.rateCents ?? r.costCents)) / MILLI);
  }

  return {
    watched: rows.length,
    dearer,
    cheaper,
    underwater,
    stockValueCents,
    replaceValueCents,
  };
}

/** Every landed rate for one item, oldest first — the little chart on the row. */
export function landedHistory(itemId: number, limit = 12): LandedDelivery[] {
  const rows = all<LineRow>(
    `SELECT pl.item_id, p.at, p.ref, s.name AS supplier, pl.cost_cents, pl.qty_milli, pl.units
       FROM purchase_lines pl
       JOIN purchases p ON p.id = pl.purchase_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE pl.item_id = ? AND pl.qty_milli > 0
      ORDER BY p.at DESC, pl.id DESC
      LIMIT ?`,
    itemId,
    limit,
  );
  return rows
    .map((l) => ({
      at: l.at,
      ref: l.ref,
      supplier: l.supplier,
      rateCents: Math.round((l.cost_cents * MILLI) / l.qty_milli),
      totalCents: l.cost_cents,
      qtyMilli: l.qty_milli,
      units: l.units,
    }))
    .reverse();
}

/** The day the books start, so a screen can say "since" and mean it. */
export function firstDeliveryDate(): string | null {
  return get<{ at: string }>(`SELECT MIN(at) AS at FROM purchases`)?.at?.slice(0, 10) ?? null;
}
