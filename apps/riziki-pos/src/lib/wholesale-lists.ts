/**
 * Listing quotes and invoices when there are thousands of them.
 *
 * The first version of these screens rendered every row as a card in a grid,
 * which is a fine shape for twelve things and a wall for a thousand. Two
 * consequences follow, and both are handled here rather than in the page:
 *
 *   - the database does the filtering, not the browser. Fetching 3,000 rows to
 *     show 25 of them is the mistake that makes a POS feel slow on a shop's
 *     phone, and it gets worse every month the business succeeds.
 *   - the count is asked for separately, so the pager can say "page 3 of 41"
 *     rather than guessing from whether a page came back full.
 *
 * Search covers the three things somebody actually has in their hand when they
 * come looking: a name, a document number, and whatever was written in the note.
 */

import { all, get } from "./db.ts";

export const PAGE_SIZE = 25;

export type InvoiceState = "all" | "owing" | "paid" | "voided";
export type QuoteState = "all" | "draft" | "sent" | "approved" | "declined" | "invoiced";

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pages: number;
}

export interface InvoiceRow {
  id: number;
  at: string;
  invoice_no: string | null;
  total_cents: number;
  paid_cents: number;
  status: string;
  note: string;
  customer_id: number | null;
  customer_name: string | null;
  quote_no: string | null;
}

function paging(page: number, total: number) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safe = Math.min(Math.max(1, page), pages);
  return { pages, safe, offset: (safe - 1) * PAGE_SIZE };
}

export function wholesaleInvoices(
  { q = "", state = "all", page = 1 }: { q?: string; state?: InvoiceState; page?: number },
): Page<InvoiceRow> {
  const like = `%${q.trim()}%`;
  const searching = q.trim().length > 0;

  // Written as one predicate string reused by both queries, so the count and the
  // rows can never be answering different questions.
  const where: string[] = ["s.tier = 'wholesale'"];
  if (state === "owing") where.push("s.status = 'completed' AND s.paid_cents < s.total_cents");
  else if (state === "paid") where.push("s.status = 'completed' AND s.paid_cents >= s.total_cents");
  else if (state === "voided") where.push("s.status = 'voided'");
  if (searching) {
    where.push(
      `(c.name LIKE ? OR s.invoice_no LIKE ? OR s.note LIKE ? OR CAST(s.id AS TEXT) = ?)`,
    );
  }
  const clause = `WHERE ${where.join(" AND ")}`;
  const args = searching ? [like, like, like, q.trim()] : [];

  const total =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ${clause}`,
      ...args,
    )?.n ?? 0;

  const { pages, safe, offset } = paging(page, total);

  const rows = all<InvoiceRow>(
    `SELECT s.id, s.at, s.invoice_no, s.total_cents, s.paid_cents, s.status, s.note,
            s.customer_id, c.name AS customer_name,
            (SELECT q.quote_no FROM quotes q WHERE q.sale_id = s.id) AS quote_no
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       ${clause}
      ORDER BY s.at DESC, s.id DESC
      LIMIT ? OFFSET ?`,
    ...args,
    PAGE_SIZE,
    offset,
  );

  return { rows, total, page: safe, pages };
}

/** Totals for the whole filtered set, not just the page on screen — a summary
 *  that only counted the visible 25 would be worse than no summary. */
export function wholesaleInvoiceTotals(): {
  count: number;
  billed: number;
  owed: number;
  owingCount: number;
  overdue: number;
  overdueCount: number;
} {
  // `overdue` is the figure the old debts screen led with, computed here from the
  // invoices themselves so there is only ever one answer to "how much is late".
  const r = get<{
    n: number;
    billed: number;
    owed: number;
    owing: number;
    overdue: number;
    overdue_n: number;
  }>(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(total_cents), 0) AS billed,
            COALESCE(SUM(MAX(total_cents - paid_cents, 0)), 0) AS owed,
            COALESCE(SUM(CASE WHEN paid_cents < total_cents THEN 1 ELSE 0 END), 0) AS owing,
            COALESCE(SUM(CASE WHEN paid_cents < total_cents
                               AND julianday('now') - julianday(at) > 30
                          THEN total_cents - paid_cents ELSE 0 END), 0) AS overdue,
            COALESCE(SUM(CASE WHEN paid_cents < total_cents
                               AND julianday('now') - julianday(at) > 30
                          THEN 1 ELSE 0 END), 0) AS overdue_n
       FROM sales
      WHERE tier = 'wholesale' AND status = 'completed'`,
  );
  return {
    count: r?.n ?? 0,
    billed: r?.billed ?? 0,
    owed: r?.owed ?? 0,
    owingCount: r?.owing ?? 0,
    overdue: r?.overdue ?? 0,
    overdueCount: r?.overdue_n ?? 0,
  };
}

export interface QuoteListRow {
  id: number;
  quote_no: string;
  customer_name: string;
  status: string;
  created_at: string;
  valid_until: string;
  sale_id: number | null;
  total_cents: number;
  line_count: number;
}

export function wholesaleQuotes(
  { q = "", state = "all", page = 1 }: { q?: string; state?: QuoteState; page?: number },
): Page<QuoteListRow> {
  const like = `%${q.trim()}%`;
  const searching = q.trim().length > 0;

  const where: string[] = ["1 = 1"];
  if (state !== "all") where.push(`qt.status = '${state}'`);
  if (searching) where.push(`(qt.customer_name LIKE ? OR qt.quote_no LIKE ? OR qt.note LIKE ?)`);
  const clause = `WHERE ${where.join(" AND ")}`;
  const args = searching ? [like, like, like] : [];

  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM quotes qt ${clause}`, ...args)?.n ?? 0;
  const { pages, safe, offset } = paging(page, total);

  const rows = all<QuoteListRow>(
    `SELECT qt.id, qt.quote_no, qt.customer_name, qt.status, qt.created_at, qt.valid_until, qt.sale_id,
            COALESCE((SELECT SUM(l.units * l.unit_price_cents) FROM quote_lines l WHERE l.quote_id = qt.id), 0) AS total_cents,
            COALESCE((SELECT COUNT(*) FROM quote_lines l WHERE l.quote_id = qt.id), 0) AS line_count
       FROM quotes qt
       ${clause}
      ORDER BY qt.created_at DESC, qt.id DESC
      LIMIT ? OFFSET ?`,
    ...args,
    PAGE_SIZE,
    offset,
  );

  return { rows, total, page: safe, pages };
}

// --------------------------------------------------------------- customers

export type CustomerState = "all" | "owing" | "wholesale" | "clear";

export interface CustomerListRow {
  id: number;
  name: string;
  phone: string;
  kind: string;
  credit_limit_cents: number;
  balance_cents: number;
  oldest_at: string | null;
  open_sales: number;
}

/**
 * The buyers, with the money each of them owes computed in the same query.
 *
 * This is the per-customer half of what the debts screen used to show. It is
 * derived from `sales` exactly the way `debtors()` derives it — completed bills
 * where paid falls short of the total — so the figure here and the figure on the
 * invoice list are the same arithmetic on the same rows, and cannot drift.
 *
 * Voided bills are excluded, which is the bug the old two-screen arrangement
 * kept re-introducing: a cancelled invoice is not a debt.
 */
export function wholesaleCustomers(
  { q = "", state = "all", page = 1 }: { q?: string; state?: CustomerState; page?: number },
): Page<CustomerListRow> {
  const like = `%${q.trim()}%`;
  const searching = q.trim().length > 0;

  const balance = `COALESCE((SELECT SUM(s.total_cents - s.paid_cents) FROM sales s
                              WHERE s.customer_id = c.id AND s.status = 'completed'
                                AND s.total_cents > s.paid_cents), 0)`;

  const where: string[] = ["c.active = 1"];
  if (state === "owing") where.push(`${balance} > 0`);
  else if (state === "clear") where.push(`${balance} = 0`);
  else if (state === "wholesale") where.push(`c.kind = 'wholesale'`);
  if (searching) where.push(`(c.name LIKE ? OR c.phone LIKE ? OR c.kra_pin LIKE ?)`);
  const clause = `WHERE ${where.join(" AND ")}`;
  const args = searching ? [like, like, like] : [];

  const total =
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM customers c ${clause}`, ...args)?.n ?? 0;
  const { pages, safe, offset } = paging(page, total);

  // Owing first, and among those the oldest debt first — the order somebody
  // works down when they sit with the phone.
  const rows = all<CustomerListRow>(
    `SELECT c.id, c.name, c.phone, c.kind, c.credit_limit_cents,
            ${balance} AS balance_cents,
            (SELECT MIN(s.at) FROM sales s
              WHERE s.customer_id = c.id AND s.status = 'completed'
                AND s.total_cents > s.paid_cents) AS oldest_at,
            (SELECT COUNT(*) FROM sales s
              WHERE s.customer_id = c.id AND s.status = 'completed'
                AND s.total_cents > s.paid_cents) AS open_sales
       FROM customers c
       ${clause}
      ORDER BY (${balance} > 0) DESC, oldest_at ASC, c.name ASC
      LIMIT ? OFFSET ?`,
    ...args,
    PAGE_SIZE,
    offset,
  );

  return { rows, total, page: safe, pages };
}

export function customerStateCounts(): Record<string, number> {
  // `n` rather than `all`: ALL is a keyword, and aliasing to it is a syntax
  // error the page would only have hit at runtime.
  const r = get<{ n: number; owing: number; wholesale: number }>(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN (SELECT COALESCE(SUM(s.total_cents - s.paid_cents), 0) FROM sales s
                                     WHERE s.customer_id = c.id AND s.status = 'completed'
                                       AND s.total_cents > s.paid_cents) > 0
                        THEN 1 ELSE 0 END), 0) AS owing,
            COALESCE(SUM(CASE WHEN c.kind = 'wholesale' THEN 1 ELSE 0 END), 0) AS wholesale
       FROM customers c WHERE c.active = 1`,
  );
  const total = r?.n ?? 0;
  const owing = r?.owing ?? 0;
  return { all: total, owing, wholesale: r?.wholesale ?? 0, clear: total - owing };
}

/** How many quotes sit in each state — the numbers on the filter chips, so a
 *  filter that would show nothing says so before it is pressed. */
export function quoteStateCounts(): Record<string, number> {
  const rows = all<{ status: string; n: number }>(
    `SELECT status, COUNT(*) AS n FROM quotes GROUP BY status`,
  );
  const out: Record<string, number> = { all: 0 };
  for (const r of rows) {
    out[r.status] = r.n;
    out.all += r.n;
  }
  return out;
}
