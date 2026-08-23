/**
 * Demo trading data, and the switch that takes it all away again.
 *
 * The shop is being shown the system before it goes live, and an empty app
 * demonstrates nothing: every report reads zero, every list says "nothing yet",
 * and the one thing the owner wants to see — what a working month looks like —
 * is exactly what is missing. So this fills a month.
 *
 * Two rules shape how it is written.
 *
 * It goes in through the real service functions — `recordPurchase`,
 * `recordSale`, `recordPayment`, `saveQuote`, `performRepack` — not through
 * hand-written INSERTs. Hand-written rows can describe a shop that could never
 * have existed: stock that was sold before it arrived, a sale whose payments do
 * not add up, a balance that no invoice explains. Demo data that cannot occur
 * in practice teaches the owner the wrong thing and hides the bugs that matter.
 *
 * And it is deterministic. The same seed gives the same shop every time, so a
 * screenshot taken today can be compared with the same screen next week, and a
 * bug found while demonstrating can be reproduced.
 *
 * Clearing is deliberately blunt: it empties the trading records and keeps the
 * catalogue, the staff and the settings. Trying to delete "only the demo rows"
 * would mean tracking which of a fortnight's testing was real, and getting that
 * wrong means deleting something the shop wanted. "Everything that has been
 * traded" is a promise that can actually be kept.
 */

import { all, get, run, tx, audit } from "./db.ts";
import { toCents, toMilli } from "./units.ts";
import { recordSale, voidSale } from "./sales.ts";
import { createCustomer, recordPayment } from "./credit.ts";
import { createSupplier, recordPurchase } from "./purchasing.ts";
import { saveQuote, setQuoteStatus } from "./quotes.ts";
import { applyPrices } from "./pricing.ts";

export class DemoError extends Error {}

/** Deterministic, so the same demo shop appears every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const CUSTOMERS: Array<[string, string, "wholesale" | "retail", number]> = [
  ["Mama Njeri Hardware", "0722140233", "wholesale", 20000],
  ["Westlands Cleaners Ltd", "0733481920", "wholesale", 50000],
  ["Gikomba Wholesalers", "0721558104", "wholesale", 80000],
  ["Karen Suds Company", "0720994417", "wholesale", 35000],
  ["Thika Road Superstore", "0711302856", "wholesale", 60000],
  ["Athi River Laundry", "0729664130", "wholesale", 25000],
  ["Ngong Road Hotel", "0705118472", "wholesale", 40000],
  ["Buruburu Cleaning Services", "0736920145", "wholesale", 15000],
  ["Kasarani Chem Supplies", "0717445208", "wholesale", 0],
  ["Embakasi Depot", "0728310674", "wholesale", 45000],
  ["Rose Wanjiru", "0724889301", "retail", 0],
  ["Peter Otieno", "0715623948", "retail", 0],
];

const SUPPLIERS: Array<[string, string]> = [
  ["Dodhia Chemicals (K) Ltd", "020 6534120"],
  ["Indian Peroxide Kenya", "0733 210455"],
  ["SK Industrial Imports", "020 2298744"],
];

const EXPENSES: Array<[string, number, string]> = [
  ["rent", 25000, "Shop rent"],
  ["transport", 3500, "Delivery to Industrial Area"],
  ["wages", 18000, "Attendant wages"],
  ["utilities", 4200, "Electricity and water"],
  ["transport", 1800, "Pick-up from the port"],
  ["other", 2500, "Packaging tape and labels"],
  ["utilities", 900, "Airtime and bundles"],
  ["transport", 2600, "Delivery to Westlands"],
];

export interface DemoSummary {
  customers: number;
  suppliers: number;
  purchases: number;
  sales: number;
  voided: number;
  payments: number;
  quotes: number;
  expenses: number;
  priceChanges: number;
}

export function demoDataPresent(): boolean {
  const n = get<{ n: number }>(`SELECT COUNT(*) AS n FROM sales`)?.n ?? 0;
  return n > 0;
}

/** Rough size of what a clear would remove, for the confirmation screen. */
export function tradingCounts(): Record<string, number> {
  const tables = [
    "sales",
    "payments",
    "customers",
    "quotes",
    "purchases",
    "expenses",
    "stock_movements",
    "price_changes",
    "day_closes",
  ];
  const out: Record<string, number> = {};
  for (const t of tables) {
    out[t] = get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n ?? 0;
  }
  return out;
}

/**
 * Fill the shop with a month of trading.
 *
 * Deliberately NOT one transaction. Each sale, purchase and payment is its own
 * unit of work in the service layer, and `tx()` is not re-entrant — wrapping
 * the lot would deadlock on the first nested BEGIN. It also means a failure
 * half way leaves a smaller demo shop rather than none, which is recoverable.
 */
export function loadDemoData(userId: number): DemoSummary {
  const items = all<{ id: number; size_milli: number; retail_cents: number; kind: string }>(
    `SELECT id, size_milli, retail_cents, kind FROM items WHERE active = 1 AND sellable = 1
      AND retail_cents > 0 ORDER BY id`,
  );
  if (items.length < 3) {
    throw new DemoError(
      "There is almost nothing priced in the catalogue yet, so there is nothing to trade. Add products and prices first.",
    );
  }

  const rnd = rng(20260823);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const summary: DemoSummary = {
    customers: 0, suppliers: 0, purchases: 0, sales: 0, voided: 0,
    payments: 0, quotes: 0, expenses: 0, priceChanges: 0,
  };

  // --- people ------------------------------------------------------------
  const customerIds: number[] = [];
  for (const [name, phone, kind, limit] of CUSTOMERS) {
    const existing = get<{ id: number }>(`SELECT id FROM customers WHERE name = ?`, name);
    if (existing) { customerIds.push(existing.id); continue; }
    customerIds.push(
      createCustomer({ name, phone, kind, creditLimitCents: toCents(limit) }, userId),
    );
    summary.customers++;
  }

  const supplierIds: number[] = [];
  for (const [name, phone] of SUPPLIERS) {
    const existing = get<{ id: number }>(`SELECT id FROM suppliers WHERE name = ?`, name);
    if (existing) { supplierIds.push(existing.id); continue; }
    supplierIds.push(createSupplier({ name, phone }, userId));
    summary.suppliers++;
  }

  // --- stock arrives before anything is sold ------------------------------
  /*
    Every sellable item is bought at least once, and how much is bought is
    tracked, because the selling loop below is only allowed to sell what has
    actually arrived.

    The first version of this bought four random items per delivery and then
    sold from the whole catalogue, which left two thirds of the shop at negative
    stock — a shop that could not have existed. The app permits overselling on
    purpose (the customer is standing there holding the goods), but a demo that
    leans on that teaches the owner that negative stock is normal, and hides the
    real ones behind sixty fake ones.

    Bulk drums arrive by the handful, packs and bottles by the dozen: buying
    thirty 250 kg drums of LABSA would be six tonnes, which is not this shop.
  */
  const stockUnits = new Map<number, number>();
  const deliveries = 6;
  const batches: Array<Array<{ itemId: number; units: number; costCents: number }>> = Array.from(
    { length: deliveries },
    () => [],
  );

  shuffled(items, rnd).forEach((it, i) => {
    const bulk = it.kind === "bulk";
    const units = bulk ? 3 + Math.floor(rnd() * 5) : 18 + Math.floor(rnd() * 30);
    // Buy at roughly 55-75% of the shelf price, which is where this trade sits.
    const unitCost = Math.max(1, Math.round(it.retail_cents * (0.55 + rnd() * 0.2)));
    batches[i % deliveries].push({ itemId: it.id, units, costCents: unitCost * units });
    stockUnits.set(it.id, (stockUnits.get(it.id) ?? 0) + units);
  });

  batches.forEach((lines, i) => {
    if (!lines.length) return;
    recordPurchase({
      supplierId: pick(supplierIds),
      lines,
      transportCents: toCents(500 + Math.floor(rnd() * 2500)),
      ref: `DN-${4820 + i}`,
      userId,
    });
    summary.purchases++;
  });

  // --- a month of selling -------------------------------------------------
  const madeSales: Array<{ id: number; customerId: number | null; outstanding: number }> = [];
  for (let i = 0; i < 90; i++) {
    const wholesale = rnd() < 0.35;
    const customerId = wholesale || rnd() < 0.25 ? pick(customerIds) : null;

    // Only items that still have stock, and never more units than are left.
    // Roughly a third of what arrived is sold over the month, which leaves the
    // Stock screen with a believable mix of full, low and reorder-level rows.
    const wanted = 1 + Math.floor(rnd() * 3);
    const lines: Array<{ itemId: number; units: number; unitPriceCents: number }> = [];
    for (const it of shuffled(items, rnd)) {
      if (lines.length >= wanted) break;
      const left = stockUnits.get(it.id) ?? 0;
      if (left <= 0) continue;
      const cap = Math.min(left, wholesale ? 14 : 3);
      const units = 1 + Math.floor(rnd() * cap);
      stockUnits.set(it.id, left - units);
      lines.push({ itemId: it.id, units, unitPriceCents: it.retail_cents });
    }
    if (!lines.length) continue;

    const total = lines.reduce((t, l) => t + l.units * l.unitPriceCents, 0);

    // Most walk-ins pay in full; wholesale often part-pays and leaves a balance,
    // which is what makes the debtors and invoice screens worth looking at.
    const roll = rnd();
    const paid = !customerId
      ? total
      : roll < 0.5
        ? total
        : roll < 0.85
          ? Math.round(total * (0.2 + rnd() * 0.5))
          : 0;

    const tenders = paid > 0
      ? [rnd() < 0.55
          ? { method: "mpesa" as const, amountCents: paid, mpesaCode: code(rnd) }
          : { method: "cash" as const, amountCents: paid }]
      : [];

    try {
      const res = recordSale({
        clientUuid: `demo-${i}-${Math.floor(rnd() * 1e9)}`,
        userId,
        tier: wholesale ? "wholesale" : "retail",
        customerId,
        lines,
        tenders,
        note: rnd() < 0.2 ? "Collecting Friday" : "",
        floorOverrideBy: userId,
      });
      summary.sales++;
      madeSales.push({ id: res.saleId, customerId, outstanding: res.outstandingCents });
    } catch {
      // A line that would go below its floor, or an item that ran out — skip it
      // rather than abandoning the whole demo shop for one awkward row.
      continue;
    }
  }

  // A couple of cancelled sales, so the voided state is visible somewhere.
  for (const s of madeSales.slice(0, 3)) {
    try { voidSale(s.id, userId, "Keyed twice"); summary.voided++; } catch { /* already settled */ }
  }

  // --- somebody comes in and pays off part of their account ---------------
  for (const cid of customerIds.slice(0, 5)) {
    const owed = get<{ owed: number }>(
      `SELECT COALESCE(SUM(total_cents - paid_cents), 0) AS owed FROM sales
        WHERE customer_id = ? AND status = 'completed' AND total_cents > paid_cents`,
      cid,
    )?.owed ?? 0;
    if (owed <= 0) continue;
    const amount = Math.max(1, Math.round(owed * (0.3 + rnd() * 0.5)));
    try {
      recordPayment({ customerId: cid, amountCents: amount, method: "mpesa", mpesaCode: code(rnd), userId });
      summary.payments++;
    } catch { /* the balance moved under us; not worth failing the load for */ }
  }

  // --- quotes in every state ----------------------------------------------
  const STATES = ["draft", "sent", "approved", "declined"] as const;
  for (let i = 0; i < 14; i++) {
    const cid = pick(customerIds);
    const name = get<{ name: string }>(`SELECT name FROM customers WHERE id = ?`, cid)!.name;
    const it = pick(items);
    const { quoteId } = saveQuote({
      customerId: cid,
      customerName: name,
      note: rnd() < 0.4 ? "Delivery to Industrial Area" : "",
      validUntil: isoDaysFromNow(rnd() < 0.25 ? -6 : 14 + Math.floor(rnd() * 14)),
      lines: [{ itemId: it.id, units: 2 + Math.floor(rnd() * 25), unitPriceCents: it.retail_cents }],
      userId,
    });
    const st = STATES[Math.floor(rnd() * STATES.length)];
    if (st !== "draft") setQuoteStatus(quoteId, st, userId);
    summary.quotes++;
  }

  // --- the running costs --------------------------------------------------
  for (const [category, amount, note] of EXPENSES) {
    run(
      `INSERT INTO expenses (category, amount_cents, method, note, user_id) VALUES (?, ?, ?, ?, ?)`,
      category,
      toCents(amount),
      rnd() < 0.5 ? "cash" : "mpesa",
      note,
      userId,
    );
    summary.expenses++;
  }

  // --- a few price moves, so the history screen has something in it -------
  const movers = shuffled(items, rnd).slice(0, 5);
  for (const it of movers) {
    const row = get<{ retail_cents: number; wholesale_cents: number }>(
      `SELECT retail_cents, wholesale_cents FROM items WHERE id = ?`,
      it.id,
    )!;
    const factor = 1 + (rnd() * 0.16 - 0.05); // mostly up, occasionally down
    try {
      applyPrices(
        [{
          itemId: it.id,
          retail: Math.round(row.retail_cents * factor) / 100,
          wholesale: Math.round(row.wholesale_cents * factor) / 100,
        }],
        userId,
        { allowBelowFloor: true, source: "check" },
      );
      summary.priceChanges++;
    } catch { /* a floor got in the way; fine */ }
  }

  spreadOverTime(rnd);
  closePastDays(userId, rnd);

  audit(userId, "demo_data_loaded", "shop", null, JSON.stringify(summary));
  return summary;
}

/**
 * Spread the month over a month.
 *
 * Everything above is written through the service layer, which stamps each row
 * with the time it was created — so without this the demo is ninety sales in
 * one afternoon. Reports by month would have a single bar, every debt would be
 * nought days old, the ageing bands would all read "fresh", and the owner would
 * be shown none of the things he actually wants to look at.
 *
 * Backdating means moving `sales.at`, which the immutability trigger exists to
 * forbid. It is lifted here for the same reason the wipe lifts it — a
 * deliberate, owner-authorised setup operation — inside one transaction, with
 * the trigger's own definition read back out of the database so it is restored
 * exactly rather than from a copy that could drift. Purchases are placed in the
 * first week and sales after them, so stock still arrives before it is sold.
 */
function spreadOverTime(rnd: () => number): void {
  const defs = all<{ name: string; sql: string }>(
    `SELECT name, sql FROM sqlite_master WHERE type = 'trigger'
      AND name IN ('sales_no_money_update', 'stock_movements_no_update')`,
  );

  const purchases = all<{ id: number }>(`SELECT id FROM purchases ORDER BY id`);
  const sales = all<{ id: number }>(`SELECT id FROM sales ORDER BY id`);

  tx(() => {
    for (const d of defs) run(`DROP TRIGGER IF EXISTS ${d.name}`);

    // Deliveries land across the first week of the window.
    purchases.forEach((p, i) => {
      const days = 34 - Math.floor((i / Math.max(1, purchases.length - 1)) * 6);
      const at = `-${days} days`;
      run(`UPDATE purchases SET at = datetime('now', ?) WHERE id = ?`, at, p.id);
      run(
        `UPDATE stock_movements SET at = datetime('now', ?)
          WHERE ref_type = 'purchase' AND ref_id = ?`,
        at,
        p.id,
      );
    });

    // Selling runs from the day after the first delivery up to today, weighted
    // slightly towards the recent end so the last week looks busiest.
    sales.forEach((sale) => {
      const days = Math.floor(Math.pow(rnd(), 1.4) * 27);
      const at = `-${days} days`;
      run(`UPDATE sales SET at = datetime('now', ?) WHERE id = ?`, at, sale.id);
      run(`UPDATE payments SET at = datetime('now', ?) WHERE sale_id = ?`, at, sale.id);
      run(
        `UPDATE stock_movements SET at = datetime('now', ?)
          WHERE ref_type = 'sale' AND ref_id = ?`,
        at,
        sale.id,
      );
    });

    for (const d of defs) run(d.sql);
  });
}

/**
 * A few days already closed off, so the day-close history is not an empty page.
 *
 * The counted cash is deliberately a shilling or two out on some days: a run of
 * perfect closes teaches nobody what a variance looks like or where to find it.
 */
function closePastDays(userId: number, rnd: () => number): void {
  for (let back = 1; back <= 5; back++) {
    const row = get<{ cash: number; mpesa: number; credit: number; date: string }>(
      `SELECT
         COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount_cents ELSE 0 END), 0)  AS cash,
         COALESCE(SUM(CASE WHEN p.method = 'mpesa' THEN p.amount_cents ELSE 0 END), 0) AS mpesa,
         COALESCE(SUM(s.total_cents - s.paid_cents), 0)                                AS credit,
         date('now', ?, '+3 hours')                                                    AS date
       FROM sales s LEFT JOIN payments p ON p.sale_id = s.id
      WHERE s.status = 'completed'
        AND date(s.at, '+3 hours') = date('now', ?, '+3 hours')`,
      `-${back} days`,
      `-${back} days`,
    );
    if (!row || (row.cash === 0 && row.mpesa === 0)) continue;

    // Out by up to fifty shillings either way on about half the days.
    const slip = rnd() < 0.5 ? 0 : Math.round((rnd() - 0.5) * 10000);
    run(
      `INSERT OR IGNORE INTO day_closes
         (business_date, expected_cash_cents, counted_cash_cents, variance_cents,
          mpesa_cents, credit_cents, note, closed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      row.date,
      row.cash,
      row.cash + slip,
      slip,
      row.mpesa,
      row.credit,
      slip === 0 ? "" : slip > 0 ? "Extra in the till" : "Short — checked the M-Pesa messages",
      userId,
    );
  }
}

function code(rnd: () => number): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 10 }, () => A[Math.floor(rnd() * A.length)]).join("");
}

function isoDaysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function shuffled<T>(xs: readonly T[], rnd: () => number): T[] {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ------------------------------------------------------------------ clearing

/**
 * Tables emptied by a clear, children before parents.
 *
 * What is NOT here is as deliberate as what is: `items`, `chemicals`,
 * `formulas`, `users` and `settings` survive. Those are the shop's own setup,
 * often typed in by hand, and losing them to a button labelled "clear test
 * data" would be a disaster the owner could not undo.
 */
const TRADING_TABLES = [
  "payments",
  "sale_lines",
  "sales",
  "quote_lines",
  "quotes",
  "purchase_lines",
  "purchases",
  "batch_lines",
  "batches",
  "repack_lines",
  "repacks",
  "stock_movements",
  "price_changes",
  "expenses",
  "day_closes",
  "customers",
  "suppliers",
] as const;

/** The append-only guards, which a deliberate wipe has to step around. */
const GUARDS: Array<[string, string]> = [
  ["stock_movements_no_update", "stock_movements"],
  ["stock_movements_no_delete", "stock_movements"],
  ["sales_no_delete", "sales"],
  ["sales_no_money_update", "sales"],
  ["sale_lines_no_update", "sale_lines"],
  ["sale_lines_no_delete", "sale_lines"],
  ["price_changes_no_update", "price_changes"],
  ["price_changes_no_delete", "price_changes"],
];

/**
 * Empty the trading records, keeping the catalogue, the staff and the settings.
 *
 * The append-only triggers exist to stop history being quietly rewritten, and
 * they do their job — a wipe cannot get past them without lifting them first.
 * That is done inside the same transaction that does the deleting, and their
 * definitions are read back out of the database beforehand so they are restored
 * exactly as they were rather than from a copy in this file that could drift
 * from the schema. If anything throws, the transaction rolls back and the
 * triggers come back with it.
 */
export function clearTradingData(userId: number): Record<string, number> {
  const before = tradingCounts();

  const defs = all<{ name: string; sql: string }>(
    `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name IN (${GUARDS.map(() => "?").join(",")})`,
    ...GUARDS.map(([n]) => n),
  );

  tx(() => {
    for (const d of defs) run(`DROP TRIGGER IF EXISTS ${d.name}`);
    for (const t of TRADING_TABLES) run(`DELETE FROM ${t}`);
    for (const d of defs) run(d.sql);
  });

  // Belt and braces: if a guard did not come back, say so loudly rather than
  // leaving the shop running on a ledger that can be edited.
  const restored = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name IN (${GUARDS.map(() => "?").join(",")})`,
    ...GUARDS.map(([n]) => n),
  )?.n ?? 0;
  if (restored !== defs.length) {
    throw new DemoError(
      "The trading data was cleared but a database guard did not come back. Restore from a backup before trading.",
    );
  }

  audit(userId, "trading_data_cleared", "shop", null, JSON.stringify(before));
  return before;
}
