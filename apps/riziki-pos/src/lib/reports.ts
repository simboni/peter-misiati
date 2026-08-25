/**
 * Reporting, day-close and export queries.
 *
 * Three rules shape everything in this file:
 *
 *  1. **Africa/Nairobi, always.** The shop is UTC+3 with no daylight saving.
 *     Every grouping uses `date(at, '+3 hours')` (or `strftime('%Y-%m', at,
 *     '+3 hours')`). Group by raw UTC and a 22:30 sale lands on tomorrow, the
 *     drawer disagrees with the report, and the owner accuses staff of theft
 *     over an arithmetic bug. This is the single most important line here.
 *
 *  2. **Snapshots, never re-joins.** Revenue and cost of goods come from
 *     `sale_lines.line_total_cents` / `sale_lines.cost_cents`, which were frozen
 *     at the moment of sale. `items` is joined only for things that are not
 *     money-in-history: the item's `kind` (business line) and its current cost
 *     when valuing stock still on the shelf.
 *
 *  3. **Aggregate in SQL.** These screens run on a cheap Android phone over a
 *     slow link. Nothing here pulls a row per sale; the exports page through in
 *     bounded chunks.
 *
 * `sale_lines.cost_cents` is the cost of the WHOLE line, matching the
 * `purchase_lines.cost_cents` convention ("total for the line"). Cost of goods
 * sold is therefore a plain SUM of it.
 */

import { all, get } from "./db.ts";
import { businessDate, pct } from "./units.ts";

/** SQL modifier that turns a stored UTC timestamp into shop time. */
export const SHOP_SHIFT = "+3 hours";

// --------------------------------------------------------------- date helpers

/** "2026-08-03" -> "2026-08" */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** First calendar day of a month key. */
export function monthStart(ym: string): string {
  return `${ym}-01`;
}

/** Last calendar day of a month key, so range filters are exact. */
export function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(last).padStart(2, "0")}`;
}

/**
 * The last `n` month keys ending with the month `from` falls in, oldest first.
 * Built from the shop-time business date, not the server's local clock.
 */
export function lastMonths(n: number, from: string = businessDate()): string[] {
  const [y, m] = from.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Month name the owner reads on the chart: "Aug". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
}

export interface DateRange {
  from: string; // inclusive business date, "YYYY-MM-DD"
  to: string; // inclusive business date
}

export function monthRange(ym: string): DateRange {
  return { from: monthStart(ym), to: monthEnd(ym) };
}

export function dayRange(date: string): DateRange {
  return { from: date, to: date };
}

// ------------------------------------------------------------- the period

/**
 * The periods a report is read over.
 *
 * Named rather than free-form because the owner asks the same six questions —
 * how did today go, this week, this month, last month, the year — and typing
 * two dates to answer one of them is work the screen should have done. "Custom"
 * is there for the seventh question, which is usually an auditor's.
 */
export const PERIODS = ["today", "week", "month", "last-month", "year", "custom"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<Period, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  "last-month": "Last month",
  year: "This year",
  custom: "Pick dates",
};

export function isPeriod(v: string | undefined): v is Period {
  return !!v && (PERIODS as readonly string[]).includes(v);
}

/** Shift a business date by whole days, staying in "YYYY-MM-DD". */
function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`); // midday, so a DST step cannot roll the date
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * What a named period means, ending today.
 *
 * The week runs Monday to today rather than the last seven days: the shop
 * closes its books by the calendar week, and "this week" meaning "since
 * Monday" is what the owner means when he says it.
 */
export function periodRange(period: Period, today: string, from?: string, to?: string): DateRange {
  if (period === "custom") {
    const a = from || today;
    const b = to || today;
    // Typed backwards is a typo, not an empty report.
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  }
  if (period === "today") return dayRange(today);

  if (period === "week") {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
    const backToMonday = dow === 0 ? 6 : dow - 1;
    return { from: shiftDays(today, -backToMonday), to: today };
  }

  if (period === "month") return { from: `${today.slice(0, 7)}-01`, to: today };

  if (period === "last-month") {
    const first = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
    first.setUTCMonth(first.getUTCMonth() - 1);
    return monthRange(first.toISOString().slice(0, 7));
  }

  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}

/** "1–25 Aug 2026", or one date when the period is a single day. */
export function describeRange(range: DateRange): string {
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });

  if (range.from === range.to) return fmt(range.from, { day: "numeric", month: "short", year: "numeric" });

  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  const sameMonth = sameYear && range.from.slice(0, 7) === range.to.slice(0, 7);

  const left = sameMonth
    ? fmt(range.from, { day: "numeric" })
    : fmt(range.from, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });

  return `${left} – ${fmt(range.to, { day: "numeric", month: "short", year: "numeric" })}`;
}

// ------------------------------------------------------------------ day close

export interface DayTotals {
  date: string;
  salesCents: number;
  saleCount: number;
  cashInCents: number;
  mpesaCents: number;
  creditCents: number;
  expenseCashCents: number;
  expenseMpesaCents: number;
  /** What should physically be in the drawer: cash taken minus cash paid out. */
  floatCents: number;
  expectedCashCents: number;
}

/**
 * Everything the evening cash count needs, for one Nairobi business date.
 *
 * Payments are grouped by the payment's own timestamp rather than the sale's,
 * because a debtor settling an old invoice puts money in *today's* drawer.
 */
export function dayTotals(date: string = businessDate()): DayTotals {
  const sales = get<{ total: number; n: number }>(
    `SELECT COALESCE(SUM(total_cents), 0) AS total, COUNT(*) AS n
       FROM sales
      WHERE status = 'completed'
        AND date(at, '+3 hours') = ?`,
    date,
  );

  // Cash and M-Pesa are counted by when the money arrived (payment date), because
  // that is what's in the drawer tonight — including a debtor paying off an old
  // invoice today.
  const tenders = get<{ cash: number; mpesa: number }>(
    `SELECT COALESCE(SUM(CASE WHEN p.method = 'cash'  THEN p.amount_cents END), 0) AS cash,
            COALESCE(SUM(CASE WHEN p.method = 'mpesa' THEN p.amount_cents END), 0) AS mpesa
       FROM payments p
       JOIN sales s ON s.id = p.sale_id
      WHERE s.status = 'completed'
        AND date(p.at, '+3 hours') = ?`,
    date,
  );

  // Credit *given* today = today's sales minus what was actually collected on
  // them. An explicit "Credit" tender only ever recorded part of this — the
  // ordinary case (an attendant simply under-paying the bill) left no row at all,
  // so this line used to read low on nearly every real part-payment. Deriving it
  // from the shortfall captures both.
  const creditRow = get<{ credit: number }>(
    `SELECT COALESCE(SUM(s.total_cents), 0)
            - COALESCE(SUM((SELECT COALESCE(SUM(p.amount_cents), 0)
                              FROM payments p
                             WHERE p.sale_id = s.id
                               AND p.method IN ('cash', 'mpesa'))), 0) AS credit
       FROM sales s
      WHERE s.status = 'completed'
        AND date(s.at, '+3 hours') = ?`,
    date,
  );

  const expenses = get<{ cash: number; mpesa: number }>(
    `SELECT COALESCE(SUM(CASE WHEN method = 'cash'  THEN amount_cents END), 0) AS cash,
            COALESCE(SUM(CASE WHEN method = 'mpesa' THEN amount_cents END), 0) AS mpesa
       FROM expenses
      WHERE date(at, '+3 hours') = ?`,
    date,
  );

  const cashIn = tenders?.cash ?? 0;
  const expenseCash = expenses?.cash ?? 0;

  const floatRow = get<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'cash_float_cents'`,
  );
  const floatCents = Number(floatRow?.value ?? 0) || 0;

  return {
    date,
    salesCents: sales?.total ?? 0,
    saleCount: sales?.n ?? 0,
    cashInCents: cashIn,
    mpesaCents: tenders?.mpesa ?? 0,
    creditCents: creditRow?.credit ?? 0,
    expenseCashCents: expenseCash,
    expenseMpesaCents: expenses?.mpesa ?? 0,
    floatCents,
    // The float is money that was in the drawer before trading started, so the
    // count at close should find it on top of the day's takings. Without it a
    // shop that keeps change would read as over by the same amount every night,
    // and a real shortage would hide inside that noise.
    expectedCashCents: floatCents + cashIn - expenseCash,
  };
}

export interface DayCloseRow {
  id: number;
  business_date: string;
  expected_cash_cents: number;
  counted_cash_cents: number;
  variance_cents: number;
  mpesa_cents: number;
  credit_cents: number;
  note: string;
  closed_by: number | null;
  closed_by_name: string | null;
  closed_at: string;
}

/** The last few closes, so a pattern of shortages is visible at a glance. */
export function recentCloses(limit = 7): DayCloseRow[] {
  return all<DayCloseRow>(
    `SELECT d.*, u.name AS closed_by_name
       FROM day_closes d
       LEFT JOIN users u ON u.id = d.closed_by
      ORDER BY d.business_date DESC
      LIMIT ?`,
    limit,
  );
}

export function closeForDate(date: string): DayCloseRow | undefined {
  return get<DayCloseRow>(
    `SELECT d.*, u.name AS closed_by_name
       FROM day_closes d
       LEFT JOIN users u ON u.id = d.closed_by
      WHERE d.business_date = ?`,
    date,
  );
}

/**
 * How alarming a variance is. A few shillings is rounding or a mis-keyed price;
 * a large gap is a conversation. Thresholds are absolute because the shop thinks
 * in shillings, not percentages.
 */
export type VarianceTone = "good" | "warn" | "bad";

export const VARIANCE_WARN_CENTS = 5_00; // KES 5
export const VARIANCE_BAD_CENTS = 100_00; // KES 100

export function varianceTone(varianceCents: number): VarianceTone {
  const gap = Math.abs(varianceCents);
  if (gap === 0) return "good";
  if (gap <= VARIANCE_WARN_CENTS) return "good";
  if (gap <= VARIANCE_BAD_CENTS) return "warn";
  return "bad";
}

// ------------------------------------------------------------------- expenses

export const EXPENSE_CATEGORIES = [
  "Rent",
  "Transport",
  "Airtime",
  "Casual labour",
  "Packaging",
  "Utilities",
  "Other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export function isExpenseCategory(v: string): v is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(v);
}

export interface ExpenseRow {
  id: number;
  at: string;
  business_date: string;
  category: string;
  amount_cents: number;
  method: "cash" | "mpesa";
  note: string;
  user_name: string | null;
}

export function expensesForMonth(ym: string, limit = 200): ExpenseRow[] {
  return all<ExpenseRow>(
    `SELECT e.id, e.at, date(e.at, '+3 hours') AS business_date, e.category,
            e.amount_cents, e.method, e.note, u.name AS user_name
       FROM expenses e
       LEFT JOIN users u ON u.id = e.user_id
      WHERE strftime('%Y-%m', e.at, '+3 hours') = ?
      ORDER BY e.at DESC
      LIMIT ?`,
    ym,
    limit,
  );
}

export function expenseTotalForMonth(ym: string): { totalCents: number; count: number } {
  const row = get<{ total: number; n: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS n
       FROM expenses
      WHERE strftime('%Y-%m', at, '+3 hours') = ?`,
    ym,
  );
  return { totalCents: row?.total ?? 0, count: row?.n ?? 0 };
}

export function expensesByCategory(ym: string): Array<{ category: string; total_cents: number }> {
  return all<{ category: string; total_cents: number }>(
    `SELECT category, COALESCE(SUM(amount_cents), 0) AS total_cents
       FROM expenses
      WHERE strftime('%Y-%m', at, '+3 hours') = ?
      GROUP BY category
      ORDER BY total_cents DESC`,
    ym,
  );
}

// ---------------------------------------------------------------- profit & loss

export interface ProfitSummary {
  salesCents: number;
  cogsCents: number;
  grossProfitCents: number;
  expensesCents: number;
  netProfitCents: number;
  saleCount: number;
}

/**
 * The headline the owner opens the app for.
 *
 * Net profit = sales − cost of goods sold − expenses. Cost of goods comes from
 * the per-line snapshot, so re-pricing an item tomorrow cannot change what last
 * month earned.
 */
export function profitSummary(range: DateRange): ProfitSummary {
  const sales = get<{ total: number; n: number }>(
    `SELECT COALESCE(SUM(total_cents), 0) AS total, COUNT(*) AS n
       FROM sales
      WHERE status = 'completed'
        AND date(at, '+3 hours') BETWEEN ? AND ?`,
    range.from,
    range.to,
  );

  const cogs = get<{ total: number }>(
    `SELECT COALESCE(SUM(sl.cost_cents), 0) AS total
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
      WHERE s.status = 'completed'
        AND date(s.at, '+3 hours') BETWEEN ? AND ?`,
    range.from,
    range.to,
  );

  const expenses = get<{ total: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM expenses
      WHERE date(at, '+3 hours') BETWEEN ? AND ?`,
    range.from,
    range.to,
  );

  const salesCents = sales?.total ?? 0;
  const cogsCents = cogs?.total ?? 0;
  const expensesCents = expenses?.total ?? 0;
  const grossProfitCents = salesCents - cogsCents;

  return {
    salesCents,
    cogsCents,
    grossProfitCents,
    expensesCents,
    netProfitCents: grossProfitCents - expensesCents,
    saleCount: sales?.n ?? 0,
  };
}

// ------------------------------------------------------------- monthly sales

export interface MonthSales {
  ym: string;
  label: string;
  salesCents: number;
}

/** Sales per month for the bar chart. Missing months come back as zero. */
export function monthlySales(months = 6, from: string = businessDate()): MonthSales[] {
  const keys = lastMonths(months, from);
  const rows = all<{ ym: string; total: number }>(
    `SELECT strftime('%Y-%m', at, '+3 hours') AS ym,
            COALESCE(SUM(total_cents), 0) AS total
       FROM sales
      WHERE status = 'completed'
        AND strftime('%Y-%m', at, '+3 hours') >= ?
        AND strftime('%Y-%m', at, '+3 hours') <= ?
      GROUP BY ym`,
    keys[0],
    keys[keys.length - 1],
  );
  const byKey = new Map(rows.map((r) => [r.ym, r.total]));
  return keys.map((ym) => ({ ym, label: monthLabel(ym), salesCents: byKey.get(ym) ?? 0 }));
}

// ---------------------------------------------------------- profit per product

export interface ProductProfit {
  item_id: number | null;
  name: string;
  units: number;
  /** Last snapshotted selling price, for reference — never the item's price now. */
  unit_price_cents: number;
  revenue_cents: number;
  cost_cents: number;
  profit_cents: number;
  margin_pct: number;
}

/**
 * Which products actually earn.
 *
 * Both revenue and cost read only from `sale_lines`: `line_total_cents` is the
 * snapshotted price after any haggling, `cost_cents` the snapshotted cost. The
 * `items` table is deliberately not joined — doing so would let today's price
 * rewrite last month's margin.
 */
export function profitPerProduct(range: DateRange, limit = 20): ProductProfit[] {
  const rows = all<{
    item_id: number | null;
    name: string;
    units: number;
    unit_price_cents: number;
    revenue_cents: number;
    cost_cents: number;
  }>(
    `SELECT sl.item_id                                 AS item_id,
            sl.name_snapshot                           AS name,
            COALESCE(SUM(sl.units), 0)                 AS units,
            COALESCE(MAX(sl.unit_price_cents), 0)      AS unit_price_cents,
            COALESCE(SUM(sl.line_total_cents), 0)      AS revenue_cents,
            COALESCE(SUM(sl.cost_cents), 0)            AS cost_cents
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
      WHERE s.status = 'completed'
        AND date(s.at, '+3 hours') BETWEEN ? AND ?
      GROUP BY sl.item_id, sl.name_snapshot
      ORDER BY (COALESCE(SUM(sl.line_total_cents), 0) - COALESCE(SUM(sl.cost_cents), 0)) DESC
      LIMIT ?`,
    range.from,
    range.to,
    limit,
  );

  return rows.map((r) => {
    const profit = r.revenue_cents - r.cost_cents;
    return {
      ...r,
      profit_cents: profit,
      margin_pct: r.revenue_cents === 0 ? 0 : (profit / r.revenue_cents) * 100,
    };
  });
}

// ------------------------------------------------------------------ discounts

/*
  What haggling costs, and who is doing it.

  Prices at this counter are negotiated — that is how the trade works here, and
  an attendant who cannot come down loses the sale. So the point of these
  figures is not to stop it. It is to make it a number the owner can look at:
  KES 100 a kilo advertised, KES 80 agreed, and 20 a kilo is the difference
  between a good month and a flat one when it happens fifty times.

  Every one of these reads `sale_lines.list_price_cents` — the price the shop was
  ASKING at the moment of sale, snapshotted on the line. Nothing here re-joins
  to `items`, because the shelf price moves and last month's discount must not
  move with it.

  The SQL below is the same arithmetic as `lineDiscountCents` in sales.ts, said
  in the other language: the difference between what a line would have come to
  at the asking price and what it did come to, floored at zero, and zero for a
  line written before an asking price was recorded.
*/
const DISCOUNT_SQL = `
  MAX(0, CASE WHEN sl.list_price_cents <= 0 THEN 0
              WHEN sl.rate_cents > 0
              THEN CAST(ROUND(sl.list_price_cents * sl.qty_milli / 1000.0) AS INTEGER)
                     - sl.line_total_cents
              ELSE sl.list_price_cents * sl.units - sl.line_total_cents END)`;

/** Lines where a price was recorded at all — the denominator worth quoting. */
const PRICED_SQL = `sl.list_price_cents > 0`;

export interface DiscountSummary {
  /** Total let off across the range. */
  discountCents: number;
  /** What those sales would have come to at the asking price. */
  atListCents: number;
  /** Discount as a percentage of what was asked. */
  pct: number;
  /** How many lines were sold under the asking price. */
  lines: number;
  /** How many of those went below the floor, which needed an owner's PIN. */
  belowFloorLines: number;
}

export function discountSummary(range: DateRange): DiscountSummary {
  const row = get<{ discount: number; at_list: number; n: number; below: number }>(
    `SELECT COALESCE(SUM(${DISCOUNT_SQL}), 0)                       AS discount,
            COALESCE(SUM(CASE WHEN ${PRICED_SQL}
                              THEN sl.line_total_cents + ${DISCOUNT_SQL}
                              ELSE 0 END), 0)                       AS at_list,
            COALESCE(SUM(CASE WHEN ${DISCOUNT_SQL} > 0 THEN 1 ELSE 0 END), 0) AS n,
            COALESCE(SUM(CASE WHEN ${DISCOUNT_SQL} > 0
                               AND i.floor_cents > 0
                               AND COALESCE(NULLIF(sl.rate_cents, 0), sl.unit_price_cents) < i.floor_cents
                              THEN 1 ELSE 0 END), 0)                AS below
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
       LEFT JOIN items i ON i.id = sl.item_id
      WHERE s.status = 'completed'
        AND date(s.at, '+3 hours') BETWEEN ? AND ?`,
    range.from,
    range.to,
  );

  const discountCents = row?.discount ?? 0;
  const atListCents = row?.at_list ?? 0;
  return {
    discountCents,
    atListCents,
    pct: pct(discountCents, atListCents),
    lines: row?.n ?? 0,
    belowFloorLines: row?.below ?? 0,
  };
}

export interface DiscountByPerson {
  user_id: number | null;
  user_name: string | null;
  discount_cents: number;
  at_list_cents: number;
  lines: number;
  sales: number;
}

/**
 * Who gave what away.
 *
 * Not a league table to punish anybody with — a good attendant discounts, and
 * the one who never does may simply be losing the sale instead. It is the
 * question "is this in the range I would have agreed to myself", asked of a
 * number rather than of a memory, and it is the reason the asking price is
 * snapshotted at all.
 */
export function discountsByPerson(range: DateRange): DiscountByPerson[] {
  return all<DiscountByPerson>(
    `SELECT s.user_id                                      AS user_id,
            u.name                                         AS user_name,
            COALESCE(SUM(${DISCOUNT_SQL}), 0)              AS discount_cents,
            COALESCE(SUM(CASE WHEN ${PRICED_SQL}
                              THEN sl.line_total_cents + ${DISCOUNT_SQL}
                              ELSE 0 END), 0)              AS at_list_cents,
            COALESCE(SUM(CASE WHEN ${DISCOUNT_SQL} > 0 THEN 1 ELSE 0 END), 0) AS lines,
            COUNT(DISTINCT CASE WHEN ${DISCOUNT_SQL} > 0 THEN s.id END)       AS sales
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.status = 'completed'
        AND date(s.at, '+3 hours') BETWEEN ? AND ?
      GROUP BY s.user_id
     HAVING discount_cents > 0
      ORDER BY discount_cents DESC`,
    range.from,
    range.to,
  );
}

export interface DiscountByItem {
  item_id: number | null;
  name: string;
  discount_cents: number;
  at_list_cents: number;
  lines: number;
}

/**
 * Which chemicals get argued down, and by how much.
 *
 * A line that is discounted on nearly every sale is usually not a haggling
 * problem — it is a shelf price nobody believes, and the answer is to change
 * the price rather than to keep overriding it.
 */
export function discountsByItem(range: DateRange, limit = 12): DiscountByItem[] {
  return all<DiscountByItem>(
    `SELECT sl.item_id                                     AS item_id,
            sl.name_snapshot                               AS name,
            COALESCE(SUM(${DISCOUNT_SQL}), 0)              AS discount_cents,
            COALESCE(SUM(CASE WHEN ${PRICED_SQL}
                              THEN sl.line_total_cents + ${DISCOUNT_SQL}
                              ELSE 0 END), 0)              AS at_list_cents,
            COALESCE(SUM(CASE WHEN ${DISCOUNT_SQL} > 0 THEN 1 ELSE 0 END), 0) AS lines
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
      WHERE s.status = 'completed'
        AND date(s.at, '+3 hours') BETWEEN ? AND ?
      GROUP BY sl.item_id
     HAVING discount_cents > 0
      ORDER BY discount_cents DESC
      LIMIT ?`,
    range.from,
    range.to,
    limit,
  );
}

export interface DiscountedSale {
  sale_id: number;
  at: string;
  invoice_no: string | null;
  user_name: string | null;
  customer_name: string | null;
  total_cents: number;
  discount_cents: number;
}

/** The individual bills, newest first — where a figure above turns into a name. */
export function discountedSales(range: DateRange, limit = 30): DiscountedSale[] {
  return all<DiscountedSale>(
    `SELECT s.id                                  AS sale_id,
            s.at                                  AS at,
            s.invoice_no                          AS invoice_no,
            u.name                                AS user_name,
            c.name                                AS customer_name,
            s.total_cents                         AS total_cents,
            COALESCE(SUM(${DISCOUNT_SQL}), 0)     AS discount_cents
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.status = 'completed'
        AND date(s.at, '+3 hours') BETWEEN ? AND ?
      GROUP BY s.id
     HAVING discount_cents > 0
      ORDER BY s.at DESC
      LIMIT ?`,
    range.from,
    range.to,
    limit,
  );
}

// ------------------------------------------------------------- business lines

export type BusinessLine = "Chemicals" | "Containers" | "Other";

export interface LineSplit {
  line: BusinessLine;
  revenue_cents: number;
  cost_cents: number;
  profit_cents: number;
  margin_pct: number;
}

/** `items.kind` is not money-in-history, so joining for it is safe. */
function lineOfKind(kind: string | null): BusinessLine {
  if (kind === "bulk" || kind === "pack") return "Chemicals";
  if (kind === "packaging") return "Containers";
  return "Other";
}

/**
 * The chemicals against everything else sold beside them.
 *
 * This used to split repacked chemicals from products the shop mixed and
 * bottled — two businesses sharing one till, and the owner needed to know
 * which one paid. The second business is closed: what sits beside the
 * chemicals now is the containers people carry them home in, and the question
 * is whether those are worth the shelf space. "Other" holds the last of the
 * bottled stock as it sells out.
 */
export function businessLineSplit(range: DateRange): LineSplit[] {
  const rows = all<{ kind: string | null; revenue_cents: number; cost_cents: number }>(
    `SELECT i.kind                                AS kind,
            COALESCE(SUM(sl.line_total_cents), 0) AS revenue_cents,
            COALESCE(SUM(sl.cost_cents), 0)       AS cost_cents
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
       LEFT JOIN items i ON i.id = sl.item_id
      WHERE s.status = 'completed'
        AND date(s.at, '+3 hours') BETWEEN ? AND ?
      GROUP BY i.kind`,
    range.from,
    range.to,
  );

  const merged = new Map<BusinessLine, { revenue: number; cost: number }>();
  for (const r of rows) {
    const line = lineOfKind(r.kind);
    const acc = merged.get(line) ?? { revenue: 0, cost: 0 };
    acc.revenue += r.revenue_cents;
    acc.cost += r.cost_cents;
    merged.set(line, acc);
  }

  return [...merged.entries()]
    .map(([line, v]) => ({
      line,
      revenue_cents: v.revenue,
      cost_cents: v.cost,
      profit_cents: v.revenue - v.cost,
      margin_pct: v.revenue === 0 ? 0 : ((v.revenue - v.cost) / v.revenue) * 100,
    }))
    .sort((a, b) => b.revenue_cents - a.revenue_cents);
}

// ---------------------------------------------------------------- dead stock

export interface DeadStockRow {
  id: number;
  name: string;
  kind: string;
  canonical_unit: string;
  size_milli: number;
  qty_milli: number;
  cost_cents: number;
  last_sold_at: string | null;
  value_cents: number;
}

/**
 * Money sitting on the shelf doing nothing. Valued at cost, not at retail —
 * the question is how much cash is trapped, not what it might fetch.
 */
export function deadStock(days = 60, limit = 25): DeadStockRow[] {
  const rows = all<Omit<DeadStockRow, "value_cents">>(
    `SELECT i.id, i.name, i.kind, i.canonical_unit, i.size_milli, i.cost_cents,
            COALESCE(SUM(m.delta_milli), 0) AS qty_milli,
            (SELECT MAX(s.at)
               FROM sale_lines sl
               JOIN sales s ON s.id = sl.sale_id
              WHERE sl.item_id = i.id AND s.status = 'completed') AS last_sold_at
       FROM items i
       LEFT JOIN stock_movements m ON m.item_id = i.id
      WHERE i.active = 1 AND i.sellable = 1
      GROUP BY i.id
     HAVING qty_milli > 0
        AND (last_sold_at IS NULL OR last_sold_at < datetime('now', ?))
      ORDER BY (qty_milli * i.cost_cents) / i.size_milli DESC
      LIMIT ?`,
    `-${days} days`,
    limit,
  );

  return rows.map((r) => ({
    ...r,
    // Cost is per ONE unit; stock is milli of substance. Round once, at the end.
    value_cents: r.size_milli > 0 ? Math.round((r.qty_milli * r.cost_cents) / r.size_milli) : 0,
  }));
}

// ----------------------------------------------------------------- shrinkage

export interface ShrinkageRow {
  ym: string;
  label: string;
  milli: number;
  value_cents: number;
}

/**
 * Stock that left without being sold.
 *
 * Stock-take corrections, and the repack losses booked while the shop still
 * broke drums down into packs. Negative values are losses. Weighing straight
 * out of the drum has no repacking step to lose anything at, so what shows here
 * from now on is the count against the book — and a gap that grows month on
 * month is the thing this report exists to catch.
 */
export function shrinkageByMonth(months = 6, from: string = businessDate()): ShrinkageRow[] {
  const keys = lastMonths(months, from);
  const rows = all<{ ym: string; milli: number; value_cents: number }>(
    `SELECT strftime('%Y-%m', m.at, '+3 hours') AS ym,
            COALESCE(SUM(m.delta_milli), 0)     AS milli,
            COALESCE(SUM(CAST(ROUND(1.0 * m.delta_milli * i.cost_cents / i.size_milli) AS INTEGER)), 0)
                                                AS value_cents
       FROM stock_movements m
       JOIN items i ON i.id = m.item_id
      WHERE m.reason IN ('stocktake', 'repack_loss')
        AND strftime('%Y-%m', m.at, '+3 hours') >= ?
        AND strftime('%Y-%m', m.at, '+3 hours') <= ?
      GROUP BY ym`,
    keys[0],
    keys[keys.length - 1],
  );

  const byKey = new Map(rows.map((r) => [r.ym, r]));
  return keys
    .map((ym) => {
      const r = byKey.get(ym);
      return {
        ym,
        label: monthLabel(ym),
        milli: r?.milli ?? 0,
        value_cents: r?.value_cents ?? 0,
      };
    })
    .reverse(); // newest first — the month being questioned is at the top
}

// ----------------------------------------------------------------- CSV export

export const EXPORT_TABLES = [
  "sales",
  "sale_lines",
  "payments",
  "purchases",
  "movements",
  "stock",
  "batches",
  "customers",
  "expenses",
] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

export function isExportTable(v: string): v is ExportTable {
  return (EXPORT_TABLES as readonly string[]).includes(v);
}

/**
 * RFC 4180 escaping. A customer called "Njeri, Mama" or a note containing a
 * quote must not shift every following column — the owner opens these in Excel
 * and a silently mangled column is worse than no export at all.
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvField).join(",") + "\r\n";
}

/** Cents -> plain decimal shillings. No separators, so no commas to escape. */
function kes(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toFixed(2);
}

const EXPORT_PAGE = 500;
/** A hard ceiling so a runaway query can never exhaust the phone's memory. */
export const EXPORT_MAX_ROWS = 100_000;

interface ExportSpec {
  header: string[];
  page: (limit: number, offset: number) => unknown[][];
}

const EXPORT_SPECS: Record<ExportTable, ExportSpec> = {
  sales: {
    header: [
      "id", "invoice_no", "business_date", "at_nairobi", "served_by", "customer",
      "tier", "total_kes", "paid_kes", "balance_kes", "status", "void_reason", "note",
    ],
    page: (limit, offset) =>
      all<Record<string, unknown>>(
        `SELECT s.id, s.invoice_no,
                date(s.at, '+3 hours')     AS business_date,
                datetime(s.at, '+3 hours') AS at_nairobi,
                u.name AS served_by, c.name AS customer, s.tier,
                s.total_cents, s.paid_cents, s.status, s.void_reason, s.note
           FROM sales s
           LEFT JOIN users u ON u.id = s.user_id
           LEFT JOIN customers c ON c.id = s.customer_id
          ORDER BY s.id
          LIMIT ? OFFSET ?`,
        limit,
        offset,
      ).map((r: Record<string, unknown>) => [
        r.id, r.invoice_no, r.business_date, r.at_nairobi, r.served_by, r.customer, r.tier,
        kes(r.total_cents as number), kes(r.paid_cents as number),
        kes((r.total_cents as number) - (r.paid_cents as number)),
        r.status, r.void_reason, r.note,
      ]),
  },

  // An accountant reconstructing a period needs the line detail, not just sale
  // totals: what was sold, how many, at what price against what cost.
  sale_lines: {
    header: [
      "id", "sale_id", "invoice_no", "business_date", "item", "units",
      "qty", "unit_price_kes", "line_total_kes", "cost_kes", "sale_status",
    ],
    page: (limit, offset) =>
      all<Record<string, unknown>>(
        `SELECT l.id, l.sale_id, s.invoice_no,
                date(s.at, '+3 hours') AS business_date,
                l.name_snapshot, l.units, l.qty_milli,
                l.unit_price_cents, l.line_total_cents, l.cost_cents,
                s.status AS sale_status
           FROM sale_lines l
           JOIN sales s ON s.id = l.sale_id
          ORDER BY l.id
          LIMIT ? OFFSET ?`,
        limit,
        offset,
      ).map((r: Record<string, unknown>) => [
        r.id, r.sale_id, r.invoice_no, r.business_date, r.name_snapshot, r.units,
        ((r.qty_milli as number) / 1000).toFixed(3),
        kes(r.unit_price_cents as number), kes(r.line_total_cents as number),
        kes(r.cost_cents as number), r.sale_status,
      ]),
  },

  // Every tender, with its M-Pesa code — this is what reconciles against the
  // M-Pesa statement and the cash drawer.
  payments: {
    header: [
      "id", "sale_id", "invoice_no", "business_date", "at_nairobi",
      "method", "amount_kes", "mpesa_code", "taken_by",
    ],
    page: (limit, offset) =>
      all<Record<string, unknown>>(
        `SELECT p.id, p.sale_id, s.invoice_no,
                date(p.at, '+3 hours')     AS business_date,
                datetime(p.at, '+3 hours') AS at_nairobi,
                p.method, p.amount_cents, p.mpesa_code, u.name AS taken_by
           FROM payments p
           JOIN sales s ON s.id = p.sale_id
           LEFT JOIN users u ON u.id = p.user_id
          ORDER BY p.id
          LIMIT ? OFFSET ?`,
        limit,
        offset,
      ).map((r: Record<string, unknown>) => [
        r.id, r.sale_id, r.invoice_no, r.business_date, r.at_nairobi,
        r.method, kes(r.amount_cents as number), r.mpesa_code, r.taken_by,
      ]),
  },

  purchases: {
    header: [
      "line_id", "purchase_id", "business_date", "supplier", "ref", "item",
      "units", "qty", "line_cost_kes", "transport_kes", "entered_by",
    ],
    page: (limit, offset) =>
      all<Record<string, unknown>>(
        `SELECT l.id AS line_id, l.purchase_id,
                date(p.at, '+3 hours') AS business_date,
                sup.name AS supplier, p.ref, i.name AS item,
                l.units, l.qty_milli, l.cost_cents,
                p.transport_cents, u.name AS entered_by
           FROM purchase_lines l
           JOIN purchases p ON p.id = l.purchase_id
           LEFT JOIN suppliers sup ON sup.id = p.supplier_id
           JOIN items i ON i.id = l.item_id
           LEFT JOIN users u ON u.id = p.user_id
          ORDER BY l.id
          LIMIT ? OFFSET ?`,
        limit,
        offset,
      ).map((r: Record<string, unknown>) => [
        r.line_id, r.purchase_id, r.business_date, r.supplier, r.ref, r.item,
        r.units, ((r.qty_milli as number) / 1000).toFixed(3),
        kes(r.cost_cents as number), kes(r.transport_cents as number), r.entered_by,
      ]),
  },

  // The whole append-only ledger. This is the audit trail itself: every kilo
  // in or out, who moved it and why. The one table that proves the others.
  movements: {
    header: [
      "id", "at_nairobi", "item", "kind", "delta", "reason",
      "ref_type", "ref_id", "by", "note",
    ],
    page: (limit, offset) =>
      all<Record<string, unknown>>(
        `SELECT m.id, datetime(m.at, '+3 hours') AS at_nairobi,
                i.name AS item, i.kind, m.delta_milli, m.reason,
                m.ref_type, m.ref_id, u.name AS by_name, m.note
           FROM stock_movements m
           JOIN items i ON i.id = m.item_id
           LEFT JOIN users u ON u.id = m.user_id
          ORDER BY m.id
          LIMIT ? OFFSET ?`,
        limit,
        offset,
      ).map((r: Record<string, unknown>) => [
        r.id, r.at_nairobi, r.item, r.kind,
        ((r.delta_milli as number) / 1000).toFixed(3), r.reason,
        r.ref_type, r.ref_id, r.by_name, r.note,
      ]),
  },

  stock: {
    header: [
      "id", "name", "kind", "unit", "size", "unit_label", "qty", "units_on_hand",
      "cost_kes", "price_kes", "never_below_kes", "never_beyond_kes", "stock_value_kes", "active",
    ],
    page: (limit, offset) =>
      all<Record<string, unknown>>(
        `SELECT i.id, i.name, i.kind, i.canonical_unit, i.size_milli, i.unit_label,
                COALESCE(SUM(m.delta_milli), 0) AS qty_milli,
                i.cost_cents, i.price_cents, i.floor_cents, i.ceiling_cents, i.active
           FROM items i
           LEFT JOIN stock_movements m ON m.item_id = i.id
          GROUP BY i.id
          ORDER BY i.id
          LIMIT ? OFFSET ?`,
        limit,
        offset,
      ).map((r: Record<string, unknown>) => {
        const qty = r.qty_milli as number;
        const size = r.size_milli as number;
        const units = size > 0 ? qty / size : 0;
        return [
          r.id, r.name, r.kind, r.canonical_unit, (size / 1000).toFixed(3), r.unit_label,
          (qty / 1000).toFixed(3), units.toFixed(3),
          kes(r.cost_cents as number), kes(r.price_cents as number),
          kes(r.floor_cents as number), kes(r.ceiling_cents as number),
          kes(Math.round(units * (r.cost_cents as number))), r.active,
        ];
      }),
  },

  batches: {
    header: [
      "id", "at_nairobi", "batch_no", "formula", "formula_version",
      "target_litres", "actual_litres", "cost_kes", "status", "made_by",
    ],
    page: (limit, offset) =>
      all<Record<string, unknown>>(
        `SELECT b.id, datetime(b.at, '+3 hours') AS at_nairobi, b.batch_no,
                f.name AS formula, fv.version AS formula_version,
                b.target_milli, b.actual_milli, b.cost_cents, b.status, u.name AS made_by
           FROM batches b
           JOIN formula_versions fv ON fv.id = b.formula_version_id
           JOIN formulas f ON f.id = fv.formula_id
           LEFT JOIN users u ON u.id = b.user_id
          ORDER BY b.id
          LIMIT ? OFFSET ?`,
        limit,
        offset,
      ).map((r: Record<string, unknown>) => [
        r.id, r.at_nairobi, r.batch_no, r.formula, r.formula_version,
        ((r.target_milli as number) / 1000).toFixed(3),
        r.actual_milli === null ? "" : ((r.actual_milli as number) / 1000).toFixed(3),
        kes(r.cost_cents as number), r.status, r.made_by,
      ]),
  },

  customers: {
    header: ["id", "name", "phone", "kind", "credit_limit_kes", "balance_kes", "last_sale_date", "active"],
    page: (limit, offset) =>
      all<Record<string, unknown>>(
        `SELECT c.id, c.name, c.phone, c.kind, c.credit_limit_cents, c.active,
                COALESCE((SELECT SUM(s.total_cents - s.paid_cents)
                            FROM sales s
                           WHERE s.customer_id = c.id AND s.status = 'completed'), 0) AS balance_cents,
                (SELECT MAX(date(s.at, '+3 hours'))
                   FROM sales s
                  WHERE s.customer_id = c.id AND s.status = 'completed') AS last_sale_date
           FROM customers c
          ORDER BY c.id
          LIMIT ? OFFSET ?`,
        limit,
        offset,
      ).map((r: Record<string, unknown>) => [
        r.id, r.name, r.phone, r.kind,
        kes(r.credit_limit_cents as number), kes(r.balance_cents as number),
        r.last_sale_date, r.active,
      ]),
  },

  expenses: {
    header: ["id", "business_date", "at_nairobi", "category", "amount_kes", "method", "note", "entered_by"],
    page: (limit, offset) =>
      all<Record<string, unknown>>(
        `SELECT e.id,
                date(e.at, '+3 hours')     AS business_date,
                datetime(e.at, '+3 hours') AS at_nairobi,
                e.category, e.amount_cents, e.method, e.note, u.name AS entered_by
           FROM expenses e
           LEFT JOIN users u ON u.id = e.user_id
          ORDER BY e.id
          LIMIT ? OFFSET ?`,
        limit,
        offset,
      ).map((r: Record<string, unknown>) => [
        r.id, r.business_date, r.at_nairobi, r.category,
        kes(r.amount_cents as number), r.method, r.note, r.entered_by,
      ]),
  },
};

/**
 * CSV for one table, a page at a time. Yielding in chunks keeps a big export
 * off the heap — the promise in the quotation is that the owner can always take
 * their data out, including on the day the phone is nearly full.
 */
export function* csvChunks(table: ExportTable): Generator<string> {
  const spec = EXPORT_SPECS[table];
  yield csvRow(spec.header);

  let offset = 0;
  for (;;) {
    const rows = spec.page(EXPORT_PAGE, offset);
    if (rows.length === 0) return;
    yield rows.map(csvRow).join("");
    offset += rows.length;
    if (rows.length < EXPORT_PAGE || offset >= EXPORT_MAX_ROWS) return;
  }
}

/** The whole CSV as one string. Used by tests; the route streams instead. */
export function csvText(table: ExportTable): string {
  let out = "";
  for (const chunk of csvChunks(table)) out += chunk;
  return out;
}

export function csvStream(table: ExportTable): ReadableStream<Uint8Array> {
  const chunks = csvChunks(table);
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
  });
}
