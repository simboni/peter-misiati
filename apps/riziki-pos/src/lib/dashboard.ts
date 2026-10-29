/**
 * The owner's dashboard: the figures, and nothing about how they are drawn.
 *
 * WHY IT IS ITS OWN FILE. `reports.ts` answers questions one at a time —
 * "profit for this range", "discounts by person" — and each answer is honest on
 * its own. A dashboard is a different thing: a dozen figures on one screen that
 * must agree with each other, and with the screens they link to, or the owner
 * stops believing any of them. So they are computed together, from one range,
 * with the same rules, in one place that can be tested as a whole.
 *
 * THREE RULES, and they are the difference between a dashboard and decoration:
 *
 *  1. **Every figure is derived, none is assumed.** The trend chart and the
 *     day-by-day table come from the same rows (`dailyProfit`), so they cannot
 *     disagree. The period total is the sum of its own buckets, checked in the
 *     tests.
 *  2. **A number with nothing to compare it to says nothing.** "KES 19,204"
 *     is not information; "KES 19,204, a fifth better than last week" is. Every
 *     headline carries the same figure for the period immediately before it,
 *     the same number of days long.
 *  3. **Money in is not the same question as sales.** Sales are counted on the
 *     day the goods left; money is counted on the day it arrived, because a
 *     debtor settling an old invoice puts cash in today's drawer and nothing on
 *     today's sales. Both are shown, and each is labelled as what it is.
 *
 * Nothing here imports from `next/*`, so the whole dashboard is unit-testable
 * under plain Node.
 */

import { all, get } from "./db.ts";
import { businessDate, formatKes } from "./units.ts";
import {
  booksStart,
  clampRange,
  dailyProfit,
  profitSummary,
  type DateRange,
  type ProfitSummary,
} from "./reports.ts";

// --------------------------------------------------------------- the ranges

/** Whole days between two business dates, inclusive of both. */
export function daysInRange(range: DateRange): number {
  if (range.from > range.to) return 0;
  const a = Date.parse(`${range.from}T12:00:00Z`);
  const b = Date.parse(`${range.to}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The period immediately before this one, the same number of days long.
 *
 * Not "last month" or "last week" — the period the owner is actually looking
 * at, shifted back by its own length. Eleven days of September compare against
 * the eleven days before them, which is the comparison that means something
 * when somebody picks a custom range.
 */
export function previousRange(range: DateRange): DateRange {
  const days = daysInRange(range);
  if (days <= 0) return range;
  return { from: shiftDays(range.from, -days), to: shiftDays(range.to, -days) };
}

// ---------------------------------------------------------------- the trend

export type Grain = "day" | "week" | "month";

export interface TrendPoint {
  /** The bucket's first business date — sortable, and the link target. */
  key: string;
  /** "Mon 21", "22–28 Sep", "Sept" — what the axis says. */
  label: string;
  salesCents: number;
  grossProfitCents: number;
  netProfitCents: number;
  saleCount: number;
}

export interface Trend {
  grain: Grain;
  points: TrendPoint[];
}

/** Monday of the week a business date falls in. */
function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  return shiftDays(date, dow === 0 ? -6 : 1 - dow);
}

function fmt(date: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}

/**
 * The period as a row of buckets, at whatever grain reads.
 *
 * A month drawn as thirty-one bars on a phone is a comb; a year drawn as 365 is
 * a smear. So the grain follows the span — days up to a month, weeks up to four
 * months, months beyond that — and the chart says which it is using rather than
 * leaving the owner to count bars.
 *
 * Built from `dailyProfit`, which is what the day-by-day table below the chart
 * is built from too. One source: the picture and the table cannot disagree.
 */
export function trend(asked: DateRange, grainHint?: Grain): Trend {
  const range = clampRange(asked);
  const span = daysInRange(range);
  const grain: Grain = grainHint ?? (span <= 31 ? "day" : span <= 120 ? "week" : "month");

  const byDay = new Map(dailyProfit(range).map((d) => [d.date, d]));

  // Every bucket in the range, including the empty ones: a day with no sales is
  // information — a gap in the row is not.
  const buckets = new Map<string, TrendPoint>();
  for (let i = 0; i < span; i++) {
    const date = shiftDays(range.from, i);
    const key =
      grain === "day" ? date : grain === "week" ? weekStart(date) : `${date.slice(0, 7)}-01`;

    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label:
          grain === "day"
            ? fmt(key, { weekday: "short", day: "numeric" })
            : grain === "week"
              ? fmt(key, { day: "numeric", month: "short" })
              : fmt(key, { month: "short" }),
        salesCents: 0,
        grossProfitCents: 0,
        netProfitCents: 0,
        saleCount: 0,
      });
    }

    const day = byDay.get(date);
    if (!day) continue;
    const b = buckets.get(key)!;
    b.salesCents += day.salesCents;
    b.grossProfitCents += day.grossProfitCents;
    b.netProfitCents += day.netProfitCents;
    b.saleCount += day.saleCount;
  }

  return { grain, points: [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)) };
}

// ------------------------------------------------------------- money coming in

export interface MoneyIn {
  /** Cash taken in the period, by the day the money arrived. */
  cashCents: number;
  mpesaCents: number;
  /**
   * Of this period's own sales, how much walked out unpaid ON THE DAY.
   *
   * Counted against payments made on the sale's own business date, not against
   * every payment ever made on it — a debt settled a week later was still
   * credit when it was given, and a figure that quietly healed itself would
   * tell the owner his attendants never give credit.
   */
  creditGivenCents: number;
  /** And how much of this period's sales is STILL unpaid, today. */
  stillOwedCents: number;
  /** Paid off old invoices inside the period — money in, no sale behind it. */
  settledOldCents: number;
  totalCollectedCents: number;
}

export function moneyIn(asked: DateRange): MoneyIn {
  const range = clampRange(asked);

  const tenders = get<{ cash: number; mpesa: number }>(
    `SELECT COALESCE(SUM(CASE WHEN p.method = 'cash'  THEN p.amount_cents END), 0) AS cash,
            COALESCE(SUM(CASE WHEN p.method = 'mpesa' THEN p.amount_cents END), 0) AS mpesa
       FROM payments p
       JOIN sales s ON s.id = p.sale_id
      WHERE s.status = 'completed'
        AND date(p.at, '+3 hours') BETWEEN ? AND ?`,
    range.from,
    range.to,
  );

  // Credit GIVEN is the shortfall on this period's own sales — which catches
  // the ordinary case of an attendant simply under-paying the bill, where no
  // "credit" tender row is ever written.
  const credit = get<{ given: number; owed: number }>(
    `SELECT COALESCE(SUM(s.total_cents), 0)
            - COALESCE(SUM((SELECT COALESCE(SUM(p.amount_cents), 0)
                              FROM payments p
                             WHERE p.sale_id = s.id
                               AND p.method IN ('cash', 'mpesa')
                               AND date(p.at, '+3 hours') = date(s.at, '+3 hours'))), 0) AS given,
            COALESCE(SUM(s.total_cents - s.paid_cents), 0) AS owed
       FROM sales s
      WHERE s.status = 'completed'
        AND date(s.at, '+3 hours') BETWEEN ? AND ?`,
    range.from,
    range.to,
  );

  // And money that arrived in the period against a sale from BEFORE it: real
  // money, no sale of its own, and the reason takings and sales differ.
  const settled = get<{ total: number }>(
    `SELECT COALESCE(SUM(p.amount_cents), 0) AS total
       FROM payments p
       JOIN sales s ON s.id = p.sale_id
      WHERE s.status = 'completed'
        AND p.method IN ('cash', 'mpesa')
        AND date(p.at, '+3 hours') BETWEEN ? AND ?
        AND date(s.at, '+3 hours') < ?`,
    range.from,
    range.to,
    range.from,
  );

  const cashCents = tenders?.cash ?? 0;
  const mpesaCents = tenders?.mpesa ?? 0;

  return {
    cashCents,
    mpesaCents,
    creditGivenCents: Math.max(0, credit?.given ?? 0),
    stillOwedCents: Math.max(0, credit?.owed ?? 0),
    settledOldCents: settled?.total ?? 0,
    totalCollectedCents: cashCents + mpesaCents,
  };
}

// ------------------------------------------------------------- what is owed

export interface Debtors {
  totalCents: number;
  customerCount: number;
  /** The oldest unpaid sale, in whole days. Zero when nothing is owed. */
  oldestDays: number;
  top: Array<{ id: number; name: string; owedCents: number; oldestDays: number }>;
}

export function debtors(limit = 5): Debtors {
  const start = booksStart();
  const rows = all<{ id: number; name: string; owed: number; oldest: number }>(
    `SELECT c.id, c.name,
            SUM(s.total_cents - s.paid_cents) AS owed,
            CAST(MAX(julianday('now') - julianday(s.at)) AS INTEGER) AS oldest
       FROM sales s
       JOIN customers c ON c.id = s.customer_id
      WHERE s.status = 'completed'
        AND s.total_cents > s.paid_cents
        AND date(s.at, '+3 hours') >= ?
      GROUP BY c.id
      ORDER BY owed DESC`,
    start || "0000-00-00",
  );

  return {
    totalCents: rows.reduce((n, r) => n + r.owed, 0),
    customerCount: rows.length,
    oldestDays: rows.reduce((n, r) => Math.max(n, r.oldest ?? 0), 0),
    top: rows.slice(0, limit).map((r) => ({
      id: r.id,
      name: r.name,
      owedCents: r.owed,
      oldestDays: r.oldest ?? 0,
    })),
  };
}

// --------------------------------------------------------- what is on the shelf

export interface ShelfNow {
  /** Everything on the shelf, at weighted-average cost. */
  atCostCents: number;
  /** What it would fetch at today's asking prices — the other half of the pair. */
  atRetailCents: number;
  /** Rows at or under the level the owner set. */
  lowCount: number;
  /** Rows below zero: sold and not yet replaced. */
  owedCount: number;
  /** Rows the shop holds and has no cost for, so nothing they earn is knowable. */
  uncostedCount: number;
}

export function shelfNow(): ShelfNow {
  const row = get<{
    at_cost: number;
    at_retail: number;
    low: number;
    owed: number;
    uncosted: number;
  }>(
    `WITH held AS (
       SELECT i.id,
              i.cost_cents,
              i.price_cents,
              i.reorder_level_milli,
              COALESCE((SELECT SUM(m.delta_milli) FROM stock_movements m WHERE m.item_id = i.id), 0) AS qty
         FROM items i
        WHERE i.active = 1
     )
     SELECT COALESCE(SUM(CASE WHEN qty > 0
                              THEN CAST(ROUND(1.0 * qty * cost_cents / 1000) AS INTEGER) END), 0) AS at_cost,
            COALESCE(SUM(CASE WHEN qty > 0
                              THEN CAST(ROUND(1.0 * qty * price_cents / 1000) AS INTEGER) END), 0) AS at_retail,
            COALESCE(SUM(CASE WHEN reorder_level_milli > 0 AND qty <= reorder_level_milli AND qty >= 0
                              THEN 1 ELSE 0 END), 0) AS low,
            COALESCE(SUM(CASE WHEN qty < 0 THEN 1 ELSE 0 END), 0) AS owed,
            COALESCE(SUM(CASE WHEN qty > 0 AND COALESCE(cost_cents, 0) = 0 THEN 1 ELSE 0 END), 0) AS uncosted
       FROM held`,
  );

  return {
    atCostCents: row?.at_cost ?? 0,
    atRetailCents: row?.at_retail ?? 0,
    lowCount: row?.low ?? 0,
    owedCount: row?.owed ?? 0,
    uncostedCount: row?.uncosted ?? 0,
  };
}

// ------------------------------------------------------------ who buys most

export interface TopCustomer {
  id: number | null;
  name: string;
  salesCents: number;
  saleCount: number;
}

export function topCustomers(asked: DateRange, limit = 5): TopCustomer[] {
  const range = clampRange(asked);
  return all<TopCustomer>(
    `SELECT s.customer_id AS id,
            COALESCE(c.name, 'Walk-in customers') AS name,
            COALESCE(SUM(s.total_cents), 0) AS salesCents,
            COUNT(*) AS saleCount
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.status = 'completed'
        AND date(s.at, '+3 hours') BETWEEN ? AND ?
      GROUP BY s.customer_id
      ORDER BY salesCents DESC
      LIMIT ?`,
    range.from,
    range.to,
    limit,
  );
}

// ------------------------------------------------------------ the whole thing

export interface Headline {
  salesCents: number;
  cogsCents: number;
  grossProfitCents: number;
  netProfitCents: number;
  expensesCents: number;
  saleCount: number;
  /** Gross profit as a share of sales. Zero when nothing sold. */
  marginPct: number;
  /** What the average sale came to. */
  averageSaleCents: number;
}

export interface Dashboard {
  range: DateRange;
  previous: DateRange;
  days: number;
  now: Headline;
  before: Headline;
  /** The same figures as `profitSummary`, including what is estimated. */
  summary: ProfitSummary;
  trend: Trend;
  money: MoneyIn;
  debtors: Debtors;
  shelf: ShelfNow;
  /** The best day in the period, for the "best day" line. */
  bestDay: { date: string; salesCents: number } | null;
  /** Today, whatever the period is: the owner always wants to know. */
  today: Headline;
}

function headline(s: ProfitSummary): Headline {
  return {
    salesCents: s.salesCents,
    cogsCents: s.cogsCents,
    grossProfitCents: s.grossProfitCents,
    netProfitCents: s.netProfitCents,
    expensesCents: s.expensesCents,
    saleCount: s.saleCount,
    marginPct: s.salesCents > 0 ? (s.grossProfitCents / s.salesCents) * 100 : 0,
    averageSaleCents: s.saleCount > 0 ? Math.round(s.salesCents / s.saleCount) : 0,
  };
}

/**
 * Everything the dashboard shows, from one range, in one pass.
 *
 * Called once per render. Each part is its own exported function so a test can
 * check it against raw SQL, and so a screen that needs only one of them does
 * not pay for the rest.
 */
export function dashboard(asked: DateRange, grainHint?: Grain): Dashboard {
  const range = clampRange(asked);
  const previous = previousRange(range);
  const summary = profitSummary(range);
  const today = businessDate();

  const days = dailyProfit(range);
  /*
    The best day, and ties broken by the calendar rather than by the order the
    rows happened to arrive in. `dailyProfit` hands them back newest first, so
    without this a second day matching the record would silently take the
    title off the day that set it.
  */
  const best = days.reduce<{ date: string; salesCents: number } | null>((top, d) => {
    if (d.salesCents <= 0) return top;
    if (!top) return { date: d.date, salesCents: d.salesCents };
    if (d.salesCents > top.salesCents) return { date: d.date, salesCents: d.salesCents };
    if (d.salesCents === top.salesCents && d.date < top.date) {
      return { date: d.date, salesCents: d.salesCents };
    }
    return top;
  }, null);

  return {
    range,
    previous,
    days: daysInRange(range),
    now: headline(summary),
    before: headline(profitSummary(previous)),
    summary,
    trend: trend(range, grainHint),
    money: moneyIn(range),
    debtors: debtors(),
    shelf: shelfNow(),
    bestDay: best,
    today: headline(profitSummary({ from: today, to: today })),
  };
}

/**
 * The change from one figure to the one before it, as a percentage.
 *
 * Null rather than zero or Infinity when there is nothing to compare against —
 * a first week in business is not "up 100%", it is a week with no previous
 * week, and a screen that claims otherwise is lying in the owner's favour.
 */
export function change(now: number, before: number): number | null {
  if (before === 0) return null;
  return ((now - before) / Math.abs(before)) * 100;
}

// ---------------------------------------------------- what is behind a row

/**
 * The named things behind the counts on the attention panel.
 *
 * "6 items show below zero" is a fact and a dead end: it tells the owner there
 * is work without telling him what the work is, so the next move is always to
 * go and look somewhere else. These are the lists that make each row answerable
 * where it stands — which six, which forty-four, which one.
 *
 * Loaded with the panel rather than on demand. They are small, bounded queries
 * against the shelf, and a dropdown that has to fetch is a dropdown that is
 * empty for a moment on the counter's connection.
 */
export interface NamedThing {
  id: number;
  name: string;
  /** The figure that put it on the list, already in words. */
  said: string;
  /**
   * How THIS one gets put right, where the answer differs per thing.
   *
   * "Record what it cost on the delivery" is the right answer for a drum of
   * Ungerol and no answer at all for a product the shop mixes, which has no
   * delivery and never will. A row that tells somebody to do an impossible
   * thing is a row that never clears, and they stop believing the panel.
   */
  fix?: string;
}

export interface AttentionDetail {
  owed: NamedThing[];
  low: NamedThing[];
  uncosted: NamedThing[];
  uncostedSales: NamedThing[];
  /**
   * The chemicals that went into a mix with no cost price on them.
   *
   * Named rather than the mixes they went into, because one cost price fixes
   * every mix that chemical is in at once — and the mixes are the symptom.
   */
  mixShort: NamedThing[];
}

const qtyWords = (milli: number, unit: string) =>
  `${(milli / 1000).toLocaleString("en-KE", { maximumFractionDigits: 3 })} ${unit}`;

/**
 * How a particular product gets a cost price — and whether it can.
 *
 * THERE IS NO BOX ANYWHERE THAT SETS ONE BY HAND, deliberately: a cost price
 * is what the shop paid, and a figure somebody types is a figure nobody can
 * check. It is written by exactly two things — a priced delivery, or a mixing
 * batch, which spreads what went in over what came out.
 *
 * Which means the advice this panel gave until now — "record what those goods
 * cost on the delivery" — was simply impossible to follow for a product the
 * shop MIXES, and impossible for anything that is neither bought nor made. The
 * owner went to Deliveries, found nothing to record, came back, and the row was
 * still there. It was never going to go. Saying which of the three cases a
 * product is in is the difference between a job and a dead end.
 */
function howToCost(r: {
  recipes: number;
  priced_arrivals: number;
  arrivals: number;
}): string {
  if (r.recipes > 0) {
    return "made here — record a batch on the mixing board and it takes its cost from what went in";
  }
  if (r.arrivals > 0 && r.priced_arrivals === 0) {
    return "delivered, but with no money against it — correct that delivery's price";
  }
  if (r.arrivals > 0) {
    return "record the next delivery with its price";
  }
  return "never delivered and no recipe makes it — it cannot be costed until one or the other exists";
}

/**
 * The sentence an attention row is set aside about.
 *
 * Here rather than inline on the page so it can be held to its one rule by a
 * test: it names WHAT is wrong and never HOW MUCH. A dismissal holds only
 * while the row goes on saying what it said, so a sentence carrying a running
 * total is a dismissal undone by the next sale — which is what the shop met,
 * and reasonably read as the button not working.
 */
export function namesSaid(things: readonly NamedThing[]): string {
  return `No cost price on: ${things.map((t) => t.name).join(", ")}`;
}

export function attentionDetail(asked: DateRange): AttentionDetail {
  const range = clampRange(asked);

  const shelf = all<{
    id: number;
    name: string;
    unit: string;
    held: number;
    reorder: number;
    cost_cents: number;
  }>(
    `SELECT i.id, i.name, i.canonical_unit AS unit, i.cost_cents,
            COALESCE(i.reorder_level_milli, 0) AS reorder,
            COALESCE((SELECT SUM(m.delta_milli) FROM stock_movements m WHERE m.item_id = i.id), 0) AS held
       FROM items i
      WHERE i.active = 1
      ORDER BY i.name`,
  );

  const owed = shelf
    .filter((r) => r.held < 0)
    .sort((a, b) => a.held - b.held)
    .map((r) => ({ id: r.id, name: r.name, said: `${qtyWords(-r.held, r.unit)} short` }));

  const low = shelf
    .filter((r) => r.reorder > 0 && r.held >= 0 && r.held <= r.reorder)
    .sort((a, b) => a.held / a.reorder - b.held / b.reorder)
    .map((r) => ({
      id: r.id,
      name: r.name,
      said: `${qtyWords(r.held, r.unit)} left, reorder at ${qtyWords(r.reorder, r.unit)}`,
    }));

  const uncosted = shelf
    .filter((r) => r.cost_cents === 0 && r.held > 0)
    .sort((a, b) => b.held - a.held)
    .map((r) => ({ id: r.id, name: r.name, said: `${qtyWords(r.held, r.unit)} held, no cost price` }));

  /*
    And the sales that went out before anything was costed. Grouped by product,
    because "which goods" is the question — the delivery that fixes one of them
    fixes every sale of it at once.

    JOINED to items, and that join is the whole point of the query rather than a
    detail of it. Without it this listed every mixed product the shop sells —
    "Multipurpose Soap — 20 L bundle" and thirty more — because the parent line
    of a recipe sale carries no cost BY DESIGN: its cost sits on the ingredient
    lines underneath it, and those are costed properly. The owner read that list
    as "the shop is booking its biggest sellers at 100% profit", which is what it
    said and not what was happening. Nothing was wrong with the money; the list
    was wrong about the money.
  */
  const uncostedSales = all<{
    id: number;
    name: string;
    cents: number;
    lines: number;
    sizes: number;
    recipes: number;
    priced_arrivals: number;
    arrivals: number;
  }>(
    /*
      ONE ROW PER PRODUCT, and that is a fix rather than a tidy-up.

      This used to group by `name_snapshot` — the name as it was printed on the
      receipt — so a product sold loose and in three jerrican sizes arrived on
      the panel as FOUR rows: "Ocean breeze mild", "— 5 L bundle", "— 500 ml
      bundle", "— 250 ml bundle". One product, one missing cost price, read by
      the owner as four separate faults. He fixes it and three of the four were
      never there. It also contradicted the sentence directly above it in this
      file: one cost price fixes every sale of that product at once, which is
      only true if the product is listed once.

      The name is the item's own, not the snapshot, for the same reason: the
      row is about the product as it stands today, which is the thing that can
      be costed.
    */
    `SELECT i.id                             AS id,
            i.name                           AS name,
            SUM(sl.line_total_cents)         AS cents,
            COUNT(*)                         AS lines,
            COUNT(DISTINCT sl.name_snapshot) AS sizes,
            (SELECT COUNT(*) FROM formulas f
              WHERE f.output_item_id = i.id AND f.active = 1)        AS recipes,
            (SELECT COUNT(*) FROM purchase_lines pl
               JOIN purchases p ON p.id = pl.purchase_id AND p.voided_at IS NULL
              WHERE pl.item_id = i.id AND pl.cost_cents > 0)         AS priced_arrivals,
            (SELECT COUNT(*) FROM purchase_lines pl
               JOIN purchases p ON p.id = pl.purchase_id AND p.voided_at IS NULL
              WHERE pl.item_id = i.id)                               AS arrivals
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
       JOIN items i ON i.id = sl.item_id
      WHERE s.status = 'completed'
        AND sl.cost_cents = 0
        AND COALESCE(i.cost_cents, 0) = 0
        AND sl.line_total_cents > 0
        AND date(s.at, '+3 hours') BETWEEN ? AND ?
      GROUP BY i.id
      ORDER BY cents DESC`,
    range.from,
    range.to,
  ).map((r) => ({
    id: r.id,
    name: r.name,
    said:
      `${formatKes(r.cents)} across ${r.lines} ${r.lines === 1 ? "sale" : "sales"}` +
      (r.sizes > 1 ? ` in ${r.sizes} sizes` : ""),
    fix: howToCost(r),
  }));

  /*
    The real version of the complaint.

    A mix IS costed from its recipe — every chemical that goes in is written to
    the sale as its own line carrying what that much of it cost. But a chemical
    with no cost price contributes nothing, and nothing is a believable number:
    the mix reports a margin better than the shop is making and no figure
    anywhere is out of balance. These are the chemicals doing it.
  */
  const mixShort = all<{
    id: number;
    name: string;
    qty: number;
    unit: string;
    lines: number;
    recipes: number;
    priced_arrivals: number;
    arrivals: number;
  }>(
    // Grouped by the chemical, like the list above and for the same reason:
    // one cost price fixes every mix it goes into, so it is one job.
    `SELECT i.id                     AS id,
            i.name                   AS name,
            SUM(sl.qty_milli)        AS qty,
            COUNT(*)                 AS lines,
            i.canonical_unit         AS unit,
            (SELECT COUNT(*) FROM formulas f
              WHERE f.output_item_id = i.id AND f.active = 1)        AS recipes,
            (SELECT COUNT(*) FROM purchase_lines pl
               JOIN purchases p ON p.id = pl.purchase_id AND p.voided_at IS NULL
              WHERE pl.item_id = i.id AND pl.cost_cents > 0)         AS priced_arrivals,
            (SELECT COUNT(*) FROM purchase_lines pl
               JOIN purchases p ON p.id = pl.purchase_id AND p.voided_at IS NULL
              WHERE pl.item_id = i.id)                               AS arrivals
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
       JOIN items i ON i.id = sl.item_id
      WHERE s.status = 'completed'
        AND sl.formula_version_id IS NOT NULL
        AND sl.bundle_id IS NULL
        AND sl.line_total_cents = 0
        AND sl.cost_cents = 0
        AND date(s.at, '+3 hours') BETWEEN ? AND ?
      GROUP BY i.id
      ORDER BY qty DESC`,
    range.from,
    range.to,
  ).map((r) => ({
    id: r.id,
    name: r.name,
    said: `${qtyWords(r.qty, r.unit)} went into mixes with no cost price`,
    fix: howToCost(r),
  }));

  return { owed, low, uncosted, uncostedSales, mixShort };
}
