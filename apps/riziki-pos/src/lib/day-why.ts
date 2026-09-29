/**
 * Why a day came out the way it did.
 *
 * WHY IT IS A MODULE AND NOT A SCRIPT ANY MORE. It started as
 * `scripts/why-negative.ts`, which was the right thing to write first and the
 * wrong place to leave it: running it meant an ssh session, a password and a
 * terminal, and the person who actually wants the answer is the owner holding a
 * phone. The rules live here now and both the screen and the script print the
 * same verdict from them, because two implementations of "why was the 22nd
 * negative" is two answers and only one of them would be on screen.
 *
 * THREE CAUSES, AND THEY WANT THREE DIFFERENT ANSWERS.
 *
 *   AN EXPENSE. Rent, a lorry, a drum paid for in cash. The goods still sold at
 *   a profit and the shop simply paid out more than it took. Nothing is wrong
 *   and nothing needs correcting.
 *
 *   SELLING UNDER COST. Gross profit itself is negative: either a price is too
 *   low or a cost on file is too high, and a cost that is too high is nearly
 *   always a typing slip.
 *
 *   A COST FILLED IN AFTERWARDS. A sale made before anybody recorded what the
 *   goods cost carries no cost of its own, so it is valued at what that product
 *   costs TODAY. Fix the cost wrongly — a whole drum's price typed into a box
 *   that means "per kilo" — and every past day that sold from it goes negative
 *   at once, without anybody touching those days. It is the only one of the
 *   three that rewrites history, and the only one with a one-field fix.
 *
 * Reads only. Nothing here writes to the books.
 */

import { all, get } from "./db.ts";
import {
  dailyProfit,
  profitSummary,
  profitPerProduct,
  type ProductProfit,
  type ProfitSummary,
} from "./reports.ts";

const MILLI = 1000;

export type DayCause =
  /** Nothing was recorded at all — usually the wrong date. */
  | "nothing"
  /** The day made money. There is nothing to explain. */
  | "positive"
  /** Money spent, not money lost: gross profit is still positive. */
  | "expenses"
  /** The goods cost more than they were sold for. */
  | "under-cost"
  /** Most of the cost is today's price, borrowed because none was recorded. */
  | "late-cost";

export interface DaySpend {
  at: string;
  category: string;
  amountCents: number;
  method: string;
  note: string;
}

export interface DayBorrowed {
  name: string;
  unit: string;
  qtyMilli: number;
  /** What that product costs today — the rate being borrowed. */
  rateCents: number;
  /** What the day is therefore being charged for it. */
  valuedCents: number;
  soldCents: number;
}

export interface DayUnderwater {
  name: string;
  unit: string;
  priceCents: number;
  costCents: number;
  /** What each unit loses at those two numbers. */
  lossCents: number;
}

export interface DaySale {
  id: number;
  at: string;
  totalCents: number;
  costCents: number;
  status: string;
  who: string | null;
  customer: string | null;
}

export interface DayExplanation {
  date: string;
  cause: DayCause;
  summary: ProfitSummary;
  /** What was paid out, biggest first — where a mis-keyed figure shows up. */
  spend: DaySpend[];
  /** What was sold for less than it cost, that day. */
  losers: ProductProfit[];
  /** Priced at or under cost on the shelf today, whatever this day did. */
  underwater: DayUnderwater[];
  /** Sales valued at today's price because they carried no cost of their own. */
  borrowed: DayBorrowed[];
  sales: DaySale[];
}

/**
 * Work out which of the three it was.
 *
 * The order matters. An expense is checked first because it is the one that
 * means nothing is wrong, and a shop told to go hunting for a costing mistake
 * on the day it paid its rent has been sent the wrong way. Then the borrowed
 * cost, before the plain under-cost verdict: both show a negative gross, but
 * only one of them is about this day at all.
 */
export function causeOf(summary: ProfitSummary, hasRow: boolean): DayCause {
  if (!hasRow && summary.salesCents === 0 && summary.expensesCents === 0) return "nothing";
  if (summary.netProfitCents >= 0) return "positive";
  if (summary.grossProfitCents >= 0) return "expenses";
  if (summary.estimatedCostCents * 2 >= summary.cogsCents) return "late-cost";
  return "under-cost";
}

export function explainDay(date: string): DayExplanation {
  const range = { from: date, to: date };
  const summary = profitSummary(range);
  const row = dailyProfit(range)[0];
  const cause = causeOf(summary, Boolean(row));

  const spend = all<{
    at: string;
    category: string;
    amount_cents: number;
    method: string;
    note: string;
  }>(
    `SELECT at, category, amount_cents, method, note
       FROM expenses
      WHERE date(at, '+3 hours') = ?
      ORDER BY amount_cents DESC`,
    date,
  ).map((e) => ({
    at: e.at,
    category: e.category,
    amountCents: e.amount_cents,
    method: e.method,
    note: e.note,
  }));

  const losers = profitPerProduct(range, 100).filter((p) => p.profit_cents < 0);

  const underwater = all<{
    name: string;
    price_cents: number;
    cost_cents: number;
    canonical_unit: string;
  }>(
    `SELECT name, price_cents, cost_cents, canonical_unit
       FROM items
      WHERE active = 1 AND sellable = 1 AND price_cents > 0 AND cost_cents >= price_cents
      ORDER BY (cost_cents - price_cents) DESC`,
  ).map((i) => ({
    name: i.name,
    unit: i.canonical_unit,
    priceCents: i.price_cents,
    costCents: i.cost_cents,
    lossCents: i.cost_cents - i.price_cents,
  }));

  const borrowed = all<{
    name: string;
    qty_milli: number;
    unit: string;
    cost_cents: number;
    sold_cents: number;
  }>(
    `SELECT i.name AS name,
            SUM(sl.qty_milli) AS qty_milli,
            i.canonical_unit AS unit,
            i.cost_cents AS cost_cents,
            SUM(sl.line_total_cents) AS sold_cents
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
       JOIN items i ON i.id = sl.item_id
      WHERE s.status = 'completed'
        AND date(s.at, '+3 hours') = ?
        AND sl.cost_cents = 0
      GROUP BY i.id
      ORDER BY i.cost_cents * SUM(sl.qty_milli) DESC`,
    date,
  ).map((b) => ({
    name: b.name,
    unit: b.unit,
    qtyMilli: b.qty_milli,
    rateCents: b.cost_cents,
    valuedCents: Math.round((b.cost_cents * b.qty_milli) / MILLI),
    soldCents: b.sold_cents,
  }));

  const sales = all<{
    id: number;
    at: string;
    total_cents: number;
    status: string;
    who: string | null;
    customer: string | null;
    cost: number;
  }>(
    `SELECT s.id, s.at, s.total_cents, s.status,
            u.name AS who, c.name AS customer,
            COALESCE((SELECT SUM(cost_cents) FROM sale_lines WHERE sale_id = s.id), 0) AS cost
       FROM sales s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE date(s.at, '+3 hours') = ?
      ORDER BY s.at`,
    date,
  ).map((s) => ({
    id: s.id,
    at: s.at,
    totalCents: s.total_cents,
    costCents: s.cost,
    status: s.status,
    who: s.who,
    customer: s.customer,
  }));

  return { date, cause, summary, spend, losers, underwater, borrowed, sales };
}

/** The day the books start, so a screen can refuse a date before it honestly. */
export function booksStart(): string | null {
  return get<{ value: string }>(`SELECT value FROM settings WHERE key = 'books_start'`)?.value ?? null;
}
