/**
 * Opening stock → bought → made → sold → used → adjusted → closing stock.
 *
 * The statement an accountant asks for and the shop could not produce. Every
 * figure the system already held was either "right now" (the stock list) or
 * "one item's history" (the stock card). Neither answers "what did we start the
 * month with, what happened to it, and what is left" — which is the question
 * the books are closed on.
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP:
 *
 *     opening + bought + made − sold − used + adjusted = closing
 *
 * exactly, for every item, in every period, with no rounding slack. That is why
 * each movement reason is sorted into exactly one column with a fixed sign
 * rather than being counted by whether it went up or down — a column that
 * double-counts or drops a reason produces a statement that nearly balances,
 * which is worse than one that obviously does not.
 *
 * Quantities are per item, in that item's own unit, and are never totalled
 * across items: kilos and litres and pieces do not add up, and a "total stock
 * 4,312" that silently mixes all three is a number somebody will act on. The
 * shop-wide totals are MONEY, which does add up.
 */

import { all } from "./db.ts";
import { periodRange, type DateRange } from "./reports.ts";

const MILLI = 1000;

// ----------------------------------------------------------- the period

/**
 * The periods a stock statement is read over.
 *
 * Yesterday earns its place and is not in the list every other screen uses:
 * the stock question is asked in the morning about the day that just finished,
 * before anything has moved today. "All" is deliberately absent — a statement
 * over all time opens at zero and is just the stock list with extra columns.
 */
export const STATEMENT_PERIODS = [
  "today",
  "yesterday",
  "week",
  "month",
  "last-month",
  "custom",
] as const;
export type StatementPeriod = (typeof STATEMENT_PERIODS)[number];

export const STATEMENT_PERIOD_LABEL: Record<StatementPeriod, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  month: "This month",
  "last-month": "Last month",
  custom: "Pick dates",
};

export function isStatementPeriod(v: string | undefined | null): v is StatementPeriod {
  return !!v && (STATEMENT_PERIODS as readonly string[]).includes(v);
}

/** Shift a business date by whole days, staying in "YYYY-MM-DD". */
function shiftDays(date: string, days: number): string {
  // Midday, so a daylight-saving step can never roll the date over.
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function statementRange(
  period: StatementPeriod,
  today: string,
  from?: string,
  to?: string,
): DateRange {
  if (period === "yesterday") {
    const y = shiftDays(today, -1);
    return { from: y, to: y };
  }
  return periodRange(period, today, from, to);
}

/** Read a period off the query string. A pair of dates alone means those dates. */
export function readStatementPeriod(params: {
  period?: string;
  from?: string;
  to?: string;
}): StatementPeriod {
  if (isStatementPeriod(params.period)) return params.period;
  if (params.from || params.to) return "custom";
  return "today";
}

// -------------------------------------------------------- what moved it

/**
 * Every movement reason, sorted into exactly one column.
 *
 * Kept here, named, rather than inline in the SQL, because the correctness of
 * the whole statement is this mapping: a reason in two columns counts twice, a
 * reason in none vanishes, and either way the arithmetic still LOOKS right.
 *
 *  - `purchase`      goods bought in                             → Bought  (+)
 *  - `batch_output`  made by a mixing batch                      → Made    (+)
 *  - `repack_in`     the pack that came out of a drum            → Made    (+)
 *  - `sale`          sold over the counter                       → Sold    (−)
 *  - `sale_void`     a sale undone, so less was sold after all   → Sold    (+, nets off)
 *  - `batch_consume` weighed into a mix                          → Used    (−)
 *  - `repack_out`    poured out of the drum to be packed         → Used    (−)
 *  - `repack_loss`   spilt or left in the drum                   → Adjusted
 *  - `stocktake`     the book corrected to a count               → Adjusted
 *  - `adjustment`    moved by hand, including an undone delivery → Adjusted
 *  - `opening`       the go-live count, if it falls in range     → Adjusted
 */
const BOUGHT = ["purchase"];
const MADE = ["batch_output", "repack_in"];
const SOLD = ["sale", "sale_void"];
const USED = ["batch_consume", "repack_out"];
const ADJUSTED = ["repack_loss", "stocktake", "adjustment", "opening"];

const list = (xs: string[]) => xs.map((x) => `'${x}'`).join(", ");

export interface StatementRow {
  itemId: number;
  name: string;
  /** kg, L or pcs. */
  unit: string;
  openingMilli: number;
  boughtMilli: number;
  madeMilli: number;
  /** Positive = went out of the shop as a sale. */
  soldMilli: number;
  /** Positive = went into a mix or a repack. */
  usedMilli: number;
  /** Signed: a stock take can go either way. */
  adjustedMilli: number;
  closingMilli: number;
  /** Cost per kg / L / piece today. Zero when nothing is known. */
  costCents: number;
  openingValueCents: number;
  closingValueCents: number;
  /** True when anything at all happened in the period. */
  moved: boolean;
}

export interface StatementTotals {
  openingValueCents: number;
  boughtValueCents: number;
  madeValueCents: number;
  soldValueCents: number;
  usedValueCents: number;
  adjustedValueCents: number;
  closingValueCents: number;
}

export interface StockStatement {
  range: DateRange;
  /** Every item that held stock or moved. Alphabetical. */
  rows: StatementRow[];
  totals: StatementTotals;
  /** How many of the rows actually moved in the period. */
  movedCount: number;
  /**
   * Items carrying stock with no cost price, by name. The money columns are
   * short by whatever these are worth, and saying so is the difference between
   * a valuation and a guess.
   */
  uncosted: string[];
}

/**
 * The statement, for one period.
 *
 * One pass over the ledger. The opening balance is every movement before the
 * first day of the range — not a stored figure, because there is no stored
 * figure: stock in this system is the sum of its movements and nothing else,
 * which is exactly why it can be asked as at any date at all.
 */
export function stockStatement(range: DateRange): StockStatement {
  const inRange = `date(m.at, '+3 hours') BETWEEN @from AND @to`;
  const before = `date(m.at, '+3 hours') < @from`;

  const rows = all<{
    id: number;
    name: string;
    unit: string;
    cost_cents: number;
    opening: number;
    bought: number;
    made: number;
    sold: number;
    used: number;
    adjusted: number;
    moves: number;
  }>(
    `SELECT i.id, i.name, i.canonical_unit AS unit, i.cost_cents,
            COALESCE(SUM(CASE WHEN ${before} THEN m.delta_milli END), 0) AS opening,
            COALESCE(SUM(CASE WHEN ${inRange} AND m.reason IN (${list(BOUGHT)})
                              THEN m.delta_milli END), 0) AS bought,
            COALESCE(SUM(CASE WHEN ${inRange} AND m.reason IN (${list(MADE)})
                              THEN m.delta_milli END), 0) AS made,
            COALESCE(SUM(CASE WHEN ${inRange} AND m.reason IN (${list(SOLD)})
                              THEN -m.delta_milli END), 0) AS sold,
            COALESCE(SUM(CASE WHEN ${inRange} AND m.reason IN (${list(USED)})
                              THEN -m.delta_milli END), 0) AS used,
            COALESCE(SUM(CASE WHEN ${inRange} AND m.reason IN (${list(ADJUSTED)})
                              THEN m.delta_milli END), 0) AS adjusted,
            COALESCE(SUM(CASE WHEN ${inRange} THEN 1 END), 0) AS moves
       FROM items i
       LEFT JOIN stock_movements m ON m.item_id = i.id
      GROUP BY i.id
      ORDER BY i.name`,
    { from: range.from, to: range.to },
  );

  const value = (milli: number, costCents: number) => Math.round((milli * costCents) / MILLI);

  const out: StatementRow[] = [];
  const totals: StatementTotals = {
    openingValueCents: 0,
    boughtValueCents: 0,
    madeValueCents: 0,
    soldValueCents: 0,
    usedValueCents: 0,
    adjustedValueCents: 0,
    closingValueCents: 0,
  };
  const uncosted: string[] = [];

  for (const r of rows) {
    const closing = r.opening + r.bought + r.made - r.sold - r.used + r.adjusted;
    const moved = r.moves > 0;

    // A row is worth printing if it held stock, holds stock, or moved. An item
    // that was zero throughout is not news, and forty of them bury the six
    // that are.
    if (!moved && r.opening === 0 && closing === 0) continue;

    out.push({
      itemId: r.id,
      name: r.name,
      unit: r.unit,
      openingMilli: r.opening,
      boughtMilli: r.bought,
      madeMilli: r.made,
      soldMilli: r.sold,
      usedMilli: r.used,
      adjustedMilli: r.adjusted,
      closingMilli: closing,
      costCents: r.cost_cents,
      openingValueCents: value(r.opening, r.cost_cents),
      closingValueCents: value(closing, r.cost_cents),
      moved,
    });

    totals.openingValueCents += value(r.opening, r.cost_cents);
    totals.boughtValueCents += value(r.bought, r.cost_cents);
    totals.madeValueCents += value(r.made, r.cost_cents);
    totals.soldValueCents += value(r.sold, r.cost_cents);
    totals.usedValueCents += value(r.used, r.cost_cents);
    totals.adjustedValueCents += value(r.adjusted, r.cost_cents);
    totals.closingValueCents += value(closing, r.cost_cents);

    if (r.cost_cents <= 0 && (closing !== 0 || moved)) uncosted.push(r.name);
  }

  return {
    range,
    rows: out,
    totals,
    movedCount: out.filter((r) => r.moved).length,
    uncosted,
  };
}

/**
 * The biggest movers first, for the summary on the front page.
 *
 * Ranked by what moved rather than by what is held: a drum that sat still all
 * month is not what the owner opened the page to see, however much it is worth.
 */
export function topMovers(statement: StockStatement, limit = 8): StatementRow[] {
  return statement.rows
    .filter((r) => r.moved)
    .sort((a, b) => moveSize(b) - moveSize(a))
    .slice(0, limit);
}

function moveSize(r: StatementRow): number {
  const milli =
    Math.abs(r.boughtMilli) +
    Math.abs(r.madeMilli) +
    Math.abs(r.soldMilli) +
    Math.abs(r.usedMilli) +
    Math.abs(r.adjustedMilli);
  // Ranked by value where there is one, so a drum of Ungerol outranks a sack of
  // salt; by quantity where there is not, so an uncosted item still shows up
  // instead of sorting to the bottom for ever.
  return r.costCents > 0 ? Math.round((milli * r.costCents) / MILLI) : milli;
}
