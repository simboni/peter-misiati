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
import { businessDate } from "./units.ts";

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

  const tenders = get<{ cash: number; mpesa: number; credit: number }>(
    `SELECT COALESCE(SUM(CASE WHEN p.method = 'cash'   THEN p.amount_cents END), 0) AS cash,
            COALESCE(SUM(CASE WHEN p.method = 'mpesa'  THEN p.amount_cents END), 0) AS mpesa,
            COALESCE(SUM(CASE WHEN p.method = 'credit' THEN p.amount_cents END), 0) AS credit
       FROM payments p
       JOIN sales s ON s.id = p.sale_id
      WHERE s.status = 'completed'
        AND date(p.at, '+3 hours') = ?`,
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
    creditCents: tenders?.credit ?? 0,
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

// ------------------------------------------------------------- business lines

export type BusinessLine = "Repacked chemicals" | "Finished products" | "Other";

export interface LineSplit {
  line: BusinessLine;
  revenue_cents: number;
  cost_cents: number;
  profit_cents: number;
  margin_pct: number;
}

/** `items.kind` is not money-in-history, so joining for it is safe. */
function lineOfKind(kind: string | null): BusinessLine {
  if (kind === "bulk" || kind === "pack") return "Repacked chemicals";
  if (kind === "finished") return "Finished products";
  return "Other";
}

/**
 * Repacking chemicals versus mixing finished products: two different
 * businesses sharing one till. The owner needs to know which one pays.
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
 * Stock that left without being sold: stock-take corrections and repack loss.
 * Negative values are losses. Repack loss on Ungerol runs about 1.5% and is
 * expected; a stock-take gap that grows month on month is not.
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

export const EXPORT_TABLES = ["sales", "stock", "batches", "customers", "expenses"] as const;
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

  stock: {
    header: [
      "id", "name", "kind", "unit", "size", "unit_label", "qty", "units_on_hand",
      "cost_kes", "retail_kes", "wholesale_kes", "stock_value_kes", "active",
    ],
    page: (limit, offset) =>
      all<Record<string, unknown>>(
        `SELECT i.id, i.name, i.kind, i.canonical_unit, i.size_milli, i.unit_label,
                COALESCE(SUM(m.delta_milli), 0) AS qty_milli,
                i.cost_cents, i.retail_cents, i.wholesale_cents, i.active
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
          kes(r.cost_cents as number), kes(r.retail_cents as number), kes(r.wholesale_cents as number),
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
