/**
 * One chemical, and the money around it.
 *
 * WHY THIS EXISTS. The shop can already see how much of something is on the
 * shelf and every entry that put it there. What it could not see anywhere is
 * the money: what each delivery landed at, how those deliveries blended into
 * the cost the tills are using, what the asking price has been and who moved
 * it, and what the thing has actually earned. Those four facts are the answer
 * to "why is this margin what it is", and until now they lived in three
 * different tables and nowhere on a screen.
 *
 * WHAT IT DOES NOT DO. It computes nothing new. The cost trail comes from
 * `replayCost`, which is the same arithmetic that repairs a cost price; the
 * price trail comes from the append-only `price_changes`; the earnings come
 * from the frozen snapshots on the sale lines. If a figure here disagreed with
 * the dashboard, the dashboard would be right and this would be a bug — so
 * there is no second opinion anywhere in this file.
 */

import { all, get, stockOf } from "./db.ts";
import { replayCost, type CostStep } from "./purchasing.ts";

const MILLI = 1000;

export interface ItemHead {
  id: number;
  name: string;
  unit: string;
  unitLabel: string;
  sizeMilli: number;
  /** On the shelf now. */
  heldMilli: number;
  /** Per kilo, litre or piece — never per drum. */
  costCents: number;
  priceCents: number;
  /** What the shelf is worth at cost: money the shop is holding, not money made. */
  stockValueCents: number;
  /** What one unit earns at today's two numbers, and as a percentage of the price. */
  unitProfitCents: number;
  marginPct: number;
  /** True when the asking price is at or under the cost. Every sale loses money. */
  underwater: boolean;
}

export function itemHead(itemId: number): ItemHead | null {
  const item = get<{
    id: number;
    name: string;
    canonical_unit: string;
    unit_label: string;
    size_milli: number;
    cost_cents: number;
    price_cents: number;
  }>(
    `SELECT id, name, canonical_unit, unit_label, size_milli, cost_cents, price_cents
       FROM items WHERE id = ?`,
    itemId,
  );
  if (!item) return null;

  const heldMilli = stockOf(itemId);
  const unitProfitCents = item.price_cents - item.cost_cents;

  return {
    id: item.id,
    name: item.name,
    unit: item.canonical_unit,
    unitLabel: item.unit_label,
    sizeMilli: item.size_milli,
    heldMilli,
    costCents: item.cost_cents,
    priceCents: item.price_cents,
    stockValueCents: Math.round((Math.max(0, heldMilli) * item.cost_cents) / MILLI),
    unitProfitCents,
    marginPct: item.price_cents > 0 ? (unitProfitCents / item.price_cents) * 100 : 0,
    underwater: item.price_cents > 0 && item.cost_cents >= item.price_cents,
  };
}

// ------------------------------------------------------------- deliveries

export interface Delivery extends CostStep {
  /** Who it came from, and their invoice number. */
  supplier: string | null;
  ref: string;
  /** The transport on the whole delivery — already inside `inCents` below. */
  deliveryTransportCents: number;
  /** What the whole delivery cost, all lines and transport. */
  deliveryTotalCents: number;
  /** How many containers of this item came, and how big one was. */
  units: number;
  sizeMilli: number;
}

/**
 * Every arrival that put cost into this item, newest first, with the blend.
 *
 * The cost trail is the replay, so what is shown here is exactly what the item
 * is costed at — not a recomputation that might disagree with it. The delivery
 * details are hung off each step by its reference.
 *
 * A batch coming off the mixing board is an arrival too, and appears with no
 * supplier: it was made rather than bought, and what it cost is what went into
 * it.
 */
export function deliveriesOf(itemId: number, limit = 24): Delivery[] {
  const replay = replayCost(itemId);

  return replay.steps
    .slice(-limit)
    .reverse()
    .map((step) => {
      let supplier: string | null = null;
      let ref = "";
      let deliveryTransportCents = 0;
      let deliveryTotalCents = 0;
      let units = 0;
      let sizeMilli = 0;

      if (step.reason === "purchase" && step.refId !== null) {
        const p = get<{
          ref: string;
          transport_cents: number;
          total_cents: number;
          supplier: string | null;
        }>(
          `SELECT p.ref, p.transport_cents, p.total_cents, s.name AS supplier
             FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
            WHERE p.id = ?`,
          step.refId,
        );
        const line = get<{ units: number; size_milli: number }>(
          `SELECT units, size_milli FROM purchase_lines WHERE purchase_id = ? AND item_id = ?`,
          step.refId,
          itemId,
        );
        supplier = p?.supplier ?? null;
        ref = p?.ref ?? "";
        deliveryTransportCents = p?.transport_cents ?? 0;
        deliveryTotalCents = p?.total_cents ?? 0;
        units = line?.units ?? 0;
        sizeMilli = line?.size_milli ?? 0;
      }

      return { ...step, supplier, ref, deliveryTransportCents, deliveryTotalCents, units, sizeMilli };
    });
}

// ---------------------------------------------------------------- earnings

export interface Earnings {
  /** Quantity sold, what it was charged at, what it cost, and the difference. */
  qtyMilli: number;
  revenueCents: number;
  costCents: number;
  profitCents: number;
  marginPct: number;
  saleCount: number;
  /** The best and worst rate this went out at, so a spread is visible. */
  lowRateCents: number;
  highRateCents: number;
  /** Cost that had to be taken from today's price because the line carried none. */
  estimatedCents: number;
}

/**
 * What this item has earned over a window of days, from the frozen snapshots.
 *
 * The same fallback the reports use: a line with no cost of its own is valued
 * at what the item costs today, and how much had to be valued that way is
 * reported rather than hidden. A mix's ingredient lines are charged nothing and
 * costed — they are counted here as cost against no revenue on purpose, because
 * that is what a chemical poured into a batch is: stock consumed. The revenue
 * for it belongs to the product it became.
 */
export function earningsOf(itemId: number, days = 30): Earnings {
  const row = get<{
    qty: number;
    revenue: number;
    cost: number;
    n: number;
    low: number | null;
    high: number | null;
    estimated: number;
  }>(
    `SELECT COALESCE(SUM(sl.qty_milli), 0)        AS qty,
            COALESCE(SUM(sl.line_total_cents), 0) AS revenue,
            COALESCE(SUM(
              CASE WHEN sl.cost_cents > 0 THEN sl.cost_cents
                   ELSE CAST(ROUND(1.0 * i.cost_cents * sl.qty_milli / 1000) AS INTEGER)
              END), 0)                            AS cost,
            COUNT(DISTINCT sl.sale_id)            AS n,
            MIN(NULLIF(sl.rate_cents, 0))         AS low,
            MAX(NULLIF(sl.rate_cents, 0))         AS high,
            COALESCE(SUM(
              CASE WHEN sl.cost_cents = 0 AND COALESCE(i.cost_cents, 0) > 0
                   THEN CAST(ROUND(1.0 * i.cost_cents * sl.qty_milli / 1000) AS INTEGER)
                   ELSE 0 END), 0)                AS estimated
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
       JOIN items i ON i.id = sl.item_id
      WHERE sl.item_id = ?
        AND s.status = 'completed'
        AND date(s.at, '+3 hours') >= date('now', '+3 hours', ?)`,
    itemId,
    `-${Math.max(0, Math.floor(days))} days`,
  );

  const revenueCents = row?.revenue ?? 0;
  const costCents = row?.cost ?? 0;
  const profitCents = revenueCents - costCents;

  return {
    qtyMilli: row?.qty ?? 0,
    revenueCents,
    costCents,
    profitCents,
    marginPct: revenueCents > 0 ? (profitCents / revenueCents) * 100 : 0,
    saleCount: row?.n ?? 0,
    lowRateCents: row?.low ?? 0,
    highRateCents: row?.high ?? 0,
    estimatedCents: row?.estimated ?? 0,
  };
}

// ------------------------------------------------------------- the sales

export interface SoldLine {
  saleId: number;
  at: string;
  qtyMilli: number;
  /** What one unit went out at, and what one unit was costed at. */
  rateCents: number;
  costRateCents: number;
  revenueCents: number;
  costCents: number;
  profitCents: number;
  marginPct: number;
  who: string | null;
  customer: string | null;
}

/**
 * The last sales of this item, each with the two numbers it froze.
 *
 * This is the table that answers the question the owner actually asks — "why
 * did that one earn less than this one" — because the rate charged and the rate
 * costed sit side by side on every row, and both of them are what was true on
 * the day rather than what is true now.
 */
export function soldLinesOf(itemId: number, limit = 20): SoldLine[] {
  return all<{
    sale_id: number;
    at: string;
    qty_milli: number;
    rate_cents: number;
    line_total_cents: number;
    cost_cents: number;
    who: string | null;
    customer: string | null;
  }>(
    `SELECT sl.sale_id, s.at, sl.qty_milli, sl.rate_cents, sl.line_total_cents, sl.cost_cents,
            u.name AS who, c.name AS customer
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE sl.item_id = ? AND s.status = 'completed' AND sl.line_total_cents > 0
      ORDER BY s.at DESC, sl.id DESC
      LIMIT ?`,
    itemId,
    limit,
  ).map((r) => {
    const profitCents = r.line_total_cents - r.cost_cents;
    return {
      saleId: r.sale_id,
      at: r.at,
      qtyMilli: r.qty_milli,
      rateCents: r.rate_cents,
      costRateCents: r.qty_milli > 0 ? Math.round((r.cost_cents * MILLI) / r.qty_milli) : 0,
      revenueCents: r.line_total_cents,
      costCents: r.cost_cents,
      profitCents,
      marginPct: r.line_total_cents > 0 ? (profitCents / r.line_total_cents) * 100 : 0,
      who: r.who,
      customer: r.customer,
    };
  });
}
