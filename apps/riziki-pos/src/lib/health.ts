/**
 * Things worth a second look.
 *
 * WHY THIS EXISTS. The shop found a day that made no sense, and working out why
 * took an export, a spreadsheet and somebody who knew what to compare against
 * what. The errors behind it were all the same shape — a quantity or a
 * container size typed wrong on a delivery — and not one of them announced
 * itself. A cost price is just a number; nothing about 2,000 a kilo looks
 * wrong until you know the next drum came in at 132.
 *
 * So the comparisons are in the app now, and the shop can run them. Nothing
 * here is clever: each check is a question somebody would ask if they had the
 * time to look, asked of every row instead of the one that happened to be on
 * screen.
 *
 * WHAT IT IS CAREFUL NOT TO DO. It never changes anything, and it never says
 * something IS wrong — it says it is worth checking, because the shop has the
 * delivery note and this does not. A 0.42 kg delivery of EDTA is bizarre and
 * might be a genuine sample. The judgement stays with the person holding the
 * paper.
 */

import { all, get } from "./db.ts";

const MILLI = 1000;

/**
 * How much a delivery has to be over the asking price before it is worth
 * saying. Two thousand shillings is about the smallest errand the shop would
 * thank you for; below it the check would be reporting rounding.
 */
const OVER_PAID_FLOOR_CENTS = 200_000;

export type Severity = "high" | "medium" | "low";

export interface Finding {
  /** Stable, so a screen can key rows and a person can refer to one. */
  id: string;
  severity: Severity;
  /** What kind of thing this is, for grouping. */
  kind: string;
  title: string;
  /** What was seen, in figures. */
  detail: string;
  /** What to do about it, where there is a clear answer. */
  fix?: string;
  href?: string;
}

const kes = (cents: number) =>
  "KES " + (cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const qty = (milli: number, unit: string) =>
  `${(milli / MILLI).toLocaleString("en-KE", { maximumFractionDigits: 3 })} ${unit}`;

/** The order a person would want to be told, worst first. */
const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

// ------------------------------------------------------- price against cost

/**
 * Sold for at or under what it costs.
 *
 * The plainest loss there is, and invisible on every screen that shows one
 * number or the other but never both.
 */
function pricedUnderCost(): Finding[] {
  return all<{
    id: number;
    name: string;
    price_cents: number;
    cost_cents: number;
    canonical_unit: string;
  }>(
    `SELECT id, name, price_cents, cost_cents, canonical_unit
       FROM items
      WHERE active = 1 AND sellable = 1 AND price_cents > 0 AND cost_cents >= price_cents
      ORDER BY (cost_cents - price_cents) DESC`,
  ).map((i) => ({
    id: `under-cost:${i.id}`,
    severity: "high" as const,
    kind: "Priced under cost",
    title: `${i.name} costs more than it is sold for`,
    detail:
      `Asking ${kes(i.price_cents)} a ${i.canonical_unit}, costed at ${kes(i.cost_cents)} — ` +
      `losing ${kes(i.cost_cents - i.price_cents)} every ${i.canonical_unit} sold.`,
    fix: "Either the price is too low or the cost on file is wrong. Check the last delivery before moving the price.",
    href: `/stock/${i.id}`,
  }));
}

/** On the shelf and for sale, with no price on it. It cannot be sold. */
function notPriced(): Finding[] {
  return all<{ id: number; name: string }>(
    `SELECT id, name FROM items
      WHERE active = 1 AND sellable = 1 AND price_cents = 0
      ORDER BY name`,
  ).map((i) => ({
    id: `no-price:${i.id}`,
    severity: "medium" as const,
    kind: "Not priced",
    title: `${i.name} has no price`,
    detail: "It is on the sellable list with nothing to charge for it.",
    fix: "Set a price under Products and prices, or mark it not for sale.",
    href: "/items",
  }));
}

/**
 * Held in quantity with no cost at all.
 *
 * Everything sold from it counts as pure profit, which it is not — and the day
 * it is finally costed, every one of those sales is re-valued at once.
 */
function heldWithNoCost(): Finding[] {
  return all<{ id: number; name: string; held: number; unit: string }>(
    `SELECT i.id, i.name, i.canonical_unit AS unit,
            COALESCE((SELECT SUM(m.delta_milli) FROM stock_movements m WHERE m.item_id = i.id), 0) AS held
       FROM items i
      WHERE i.active = 1 AND i.cost_cents = 0
      ORDER BY held DESC`,
  )
    .filter((i) => i.held > 0)
    .map((i) => ({
      id: `no-cost:${i.id}`,
      severity: "medium" as const,
      kind: "No cost on file",
      title: `${i.name} is on the shelf with no cost`,
      detail: `${qty(i.held, i.unit)} held, costed at nothing. Anything sold from it reads as pure profit.`,
      fix: "Record what the last delivery cost, under Suppliers and purchases.",
      href: `/stock/${i.id}`,
    }));
}

// --------------------------------------------------------- the deliveries

interface LineRow {
  line_id: number;
  purchase_id: number;
  item_id: number;
  item: string;
  unit: string;
  usual_size: number;
  at: string;
  units: number;
  size_milli: number;
  qty_milli: number;
  cost_cents: number;
}

function deliveryLines(): LineRow[] {
  return all<LineRow>(
    `SELECT pl.id AS line_id, pl.purchase_id, pl.item_id,
            i.name AS item, i.canonical_unit AS unit, i.size_milli AS usual_size,
            p.at, pl.units, pl.size_milli, pl.qty_milli, pl.cost_cents
       FROM purchase_lines pl
       JOIN purchases p ON p.id = pl.purchase_id
       JOIN items i ON i.id = pl.item_id
      ORDER BY pl.item_id, p.at`,
  );
}

const rateOf = (l: LineRow) => (l.qty_milli > 0 ? (l.cost_cents * MILLI) / l.qty_milli : 0);
const day = (at: string) => at.slice(0, 10);

/**
 * A delivery that landed at far more than the thing is sold for.
 *
 * THE STRONGEST CHECK HERE, and the one that needs no neighbours. Comparing an
 * item's deliveries against each other cannot see a mistake on an item bought
 * once; comparing against the asking price can, because the shop always knows
 * what it charges. BLUE landing at 2,000 a kilo against a 250 asking price is
 * not a judgement call.
 *
 * The bar is one and a half times the price rather than merely above it: a
 * genuinely thin margin is the shop's business and this must not nag about it.
 */
export function landedAbovePrice(lines: LineRow[]): Finding[] {
  return all<{ id: number; price_cents: number }>(
    `SELECT id, price_cents FROM items WHERE price_cents > 0`,
  ).flatMap((item) =>
    lines
      .filter((l) => l.item_id === item.id && rateOf(l) >= item.price_cents * 1.5)
      .map((l) => {
        const rate = Math.round(rateOf(l));
        return {
          id: `overprice:${l.line_id}`,
          severity: "high" as const,
          kind: "Delivery dearer than the selling price",
          title: `${l.item} on ${day(l.at)} landed at ${kes(rate)} a ${l.unit}`,
          detail:
            `The shop asks ${kes(item.price_cents)} a ${l.unit} for it — this delivery cost ` +
            `${(rate / item.price_cents).toFixed(1)} times that. ${l.units} × ` +
            `${qty(l.size_milli || Math.round(l.qty_milli / Math.max(1, l.units)), l.unit)} for ` +
            `${kes(l.cost_cents)}.`,
          fix: "Check the delivery note against the quantity and the total. A wrong container size or a missing zero both land here.",
          href: "/purchases",
        };
      }),
  );
}

/**
 * A delivery bought for more than the shop charges for it.
 *
 * WHY THIS IS SEPARATE from the check above. That one is looking for a typing
 * mistake and so it waits until a delivery is half again the asking price;
 * below that bar it keeps quiet, because a thin margin is the shop's business
 * and a check that nags about thin margins stops being read.
 *
 * But there is a line beneath a thin margin, and it is not a judgement call:
 * paying MORE for a drum than you sell it for. UNGEROL is a third of this
 * shop's turnover, it asks 395 a kilo, and on 18 September 1,125 kg of it
 * landed at 450 — under the other check's bar at 1.14 times the price, so
 * nothing was said, and it dragged the average cost of every kilo on the shelf
 * above the asking price for the next six days. The day the shop asked about
 * was one of those six.
 *
 * So this says nothing about margin and only ever fires above the price — and
 * only when the money at stake is worth an errand, because a 0.42 kg sample
 * bought dear is not news. What it reports is the shillings, not the ratio:
 * "55 a kilo over, 1,125 kg, 61,875 down" is a sentence somebody can act on.
 */
export function boughtAboveShelf(lines: LineRow[]): Finding[] {
  return all<{ id: number; price_cents: number }>(
    `SELECT id, price_cents FROM items WHERE price_cents > 0`,
  ).flatMap((item) =>
    lines
      .filter((l) => {
        const rate = rateOf(l);
        // Above the asking price, but under the other check's bar, which has
        // already spoken for anything dearer than that.
        return rate > item.price_cents && rate < item.price_cents * 1.5 && l.item_id === item.id;
      })
      .map((l) => {
        const rate = Math.round(rateOf(l));
        const over = rate - item.price_cents;
        const bleed = Math.round((over * l.qty_milli) / MILLI);
        return { l, rate, over, bleed };
      })
      .filter((x) => x.bleed >= OVER_PAID_FLOOR_CENTS)
      .map(({ l, rate, over, bleed }) => ({
        id: `dear:${l.line_id}`,
        severity: "high" as const,
        kind: "Bought for more than it sells for",
        title: `${l.item} on ${day(l.at)} landed at ${kes(rate)} a ${l.unit}`,
        detail:
          `The shop asks ${kes(item.price_cents)} a ${l.unit} — this delivery is ` +
          `${kes(over)} a ${l.unit} over it. ${qty(l.qty_milli, l.unit)} came in, ` +
          `so ${kes(bleed)} is lost if it all sells at the asking price. It also pulls the ` +
          `average cost of the stock already on the shelf up with it.`,
        fix: "Check the delivery note. If the price is right, the asking price has to move before this drum is sold.",
        href: `/stock/${l.item_id}`,
      })),
  );
}

/**
 * A delivery that landed at a rate nothing like the others of the same thing.
 *
 * NEEDS THREE. With two deliveries there is no way to tell from the figures
 * alone which of them is the odd one, and this used to guess — it took the
 * larger of two as the middle and then accused the cheaper, correct delivery of
 * being wrong. Being confidently wrong is worse than being silent, so with
 * fewer than three it says nothing and leaves the job to the price check above,
 * which needs no neighbours.
 */
export function rateOutliers(lines: LineRow[]): Finding[] {
  const byItem = new Map<number, LineRow[]>();
  for (const l of lines) {
    const list = byItem.get(l.item_id);
    if (list) list.push(l);
    else byItem.set(l.item_id, [l]);
  }

  const out: Finding[] = [];
  for (const rows of byItem.values()) {
    const rates = rows.map(rateOf).filter((r) => r > 0);
    if (rates.length < 3) continue;

    const sorted = [...rates].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median =
      sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    if (!median) continue;

    for (const l of rows) {
      const r = rateOf(l);
      if (!r) continue;
      const ratio = r > median ? r / median : median / r;
      if (ratio < 3) continue;
      out.push({
        id: `rate:${l.line_id}`,
        severity: "high",
        kind: "Delivery priced unlike the others",
        title: `${l.item} on ${day(l.at)} landed at ${kes(Math.round(r))} a ${l.unit}`,
        detail:
          `The other deliveries of it are around ${kes(Math.round(median))} — this one is ` +
          `${ratio.toFixed(1)} times ${r > median ? "dearer" : "cheaper"}. ` +
          `${l.units} × ${qty(l.size_milli || Math.round(l.qty_milli / Math.max(1, l.units)), l.unit)} ` +
          `for ${kes(l.cost_cents)}.`,
        fix: "Check the delivery note. A wrong container size or a missing zero both land here.",
        href: "/purchases",
      });
    }
  }
  return out;
}

/**
 * A delivery whose containers are nothing like the size that thing comes in.
 *
 * This is the check that catches what comparing deliveries against each other
 * cannot: an item bought once, entered wrong, with nothing to compare against.
 * 0.42 kg of EDTA against a usual 5 kg is the shape of it.
 */
export function oddContainers(lines: LineRow[]): Finding[] {
  const out: Finding[] = [];
  for (const l of lines) {
    const each = l.size_milli > 0 ? l.size_milli : Math.round(l.qty_milli / Math.max(1, l.units));
    if (!each || !l.usual_size) continue;
    const ratio = each > l.usual_size ? each / l.usual_size : l.usual_size / each;
    if (ratio < 10) continue;
    out.push({
      id: `size:${l.line_id}`,
      severity: "high",
      kind: "Container size unlike the usual",
      title: `${l.item} on ${day(l.at)} came in ${qty(each, l.unit)} containers`,
      detail:
        `It is normally ${qty(l.usual_size, l.unit)} — this is ${ratio.toFixed(0)} times ` +
        `${each > l.usual_size ? "bigger" : "smaller"}, so ${l.units} of them booked ` +
        `${qty(l.qty_milli, l.unit)} at ${kes(Math.round(rateOf(l)))} a ${l.unit}.`,
      fix: "If the size is wrong, both the stock and the cost are wrong. Correct the delivery rather than adjusting the price.",
      href: "/purchases",
    });
  }
  return out;
}

/** Goods booked in with no money against them. */
export function freeDeliveries(lines: LineRow[]): Finding[] {
  return lines
    .filter((l) => l.cost_cents === 0 && l.qty_milli > 0)
    .map((l) => ({
      id: `free:${l.line_id}`,
      severity: "medium" as const,
      kind: "Delivery with no cost",
      title: `${l.item} on ${day(l.at)} was booked in at nothing`,
      detail: `${qty(l.qty_milli, l.unit)} arrived with no price against it.`,
      fix: "If the invoice came later, correct the delivery — everything sold from it meanwhile is costed at today's price.",
      href: "/purchases",
    }));
}

// ------------------------------------------------------------- the sales

/**
 * Sales carrying no cost of their own.
 *
 * These are the ones that move when a cost price is touched — the only route by
 * which a day already closed can change. Worth knowing how much of the book is
 * in that state.
 */
function uncostedSales(): Finding[] {
  const row = get<{ n: number; total: number; oldest: string | null }>(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(sl.line_total_cents), 0) AS total,
            MIN(date(s.at, '+3 hours')) AS oldest
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
       JOIN items i ON i.id = sl.item_id
      WHERE s.status = 'completed' AND sl.cost_cents = 0 AND sl.line_total_cents > 0`,
  );
  if (!row?.n) return [];
  return [
    {
      id: "uncosted-sales",
      severity: "medium",
      kind: "Sales with no cost of their own",
      title: `${row.n} sale line${row.n === 1 ? "" : "s"} are valued at today's cost price`,
      detail:
        `${kes(row.total)} of sales, the oldest on ${row.oldest}, carry no cost of their own — ` +
        `they were rung up before one was recorded. The reports value them at what those ` +
        `products cost today, so changing a cost moves those past days.`,
      fix: "Put the right cost on the deliveries behind them and the figures settle.",
      href: "/landed",
    },
  ];
}

// ---------------------------------------------------------------- the sweep

export interface HealthReport {
  findings: Finding[];
  counts: Record<Severity, number>;
  /** How many things were looked at, so "nothing found" means something. */
  checked: { items: number; deliveries: number };
}

export function checkBooks(): HealthReport {
  const lines = deliveryLines();

  const findings = [
    ...pricedUnderCost(),
    ...oddContainers(lines),
    ...landedAbovePrice(lines),
    ...boughtAboveShelf(lines),
    ...rateOutliers(lines),
    ...notPriced(),
    ...heldWithNoCost(),
    ...freeDeliveries(lines),
    ...uncostedSales(),
  ];

  /*
    One row per thing, not one per check.

    A delivery with the wrong container size also lands at the wrong rate, so it
    trips two checks — and telling somebody twice about one mistake makes the
    list look worse than the shop is, which is how a list like this stops being
    read. The more specific finding wins: the size is the cause, the rate is the
    symptom.
  */
  /*
    The checks are listed cause-first — a wrong container size explains a wrong
    rate and a rate above the selling price — so the first finding about a
    delivery line is the most specific one, and later ones about the same line
    are the same mistake seen again.
  */
  const spokenFor = new Set<number>();
  const deduped: Finding[] = [];
  for (const f of findings) {
    const m = /^(?:size|overprice|dear|rate|free):(\d+)$/.exec(f.id);
    if (m) {
      const line = Number(m[1]);
      if (spokenFor.has(line)) continue;
      spokenFor.add(line);
    }
    deduped.push(f);
  }

  deduped.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.kind.localeCompare(b.kind));

  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of deduped) counts[f.severity]++;

  return {
    findings: deduped,
    counts,
    checked: {
      items: get<{ n: number }>(`SELECT COUNT(*) AS n FROM items WHERE active = 1`)?.n ?? 0,
      deliveries: lines.length,
    },
  };
}
