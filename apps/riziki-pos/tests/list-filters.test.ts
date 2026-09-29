/**
 * The lists, filtered.
 *
 * Every screen in this app that only grows — sales, expenses, deliveries, price
 * changes, an item's ledger — now takes a search term, a window of dates and a
 * standing. The risk with all of them is the same and it is quiet: a filter
 * that stops filtering does not throw, it just shows everything, and everything
 * is what the screen showed before. So each one is checked by counting.
 *
 * The other quiet failure is the count itself. A pager that says "402 sales"
 * over a filtered eleven is lying about both, so every total below is asserted
 * against the rows it claims to describe.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-list-filters-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, run, stockOf, postMovement } = await import("../src/lib/db.ts");
const { listSales, saleFilterCounts, voidSale } = await import("../src/lib/sales.ts");
const { listExpenses, expenseCategoryTotals } = await import("../src/lib/reports.ts");
const { createSupplier, recordPurchase, listPurchases } = await import("../src/lib/purchasing.ts");
const { applyPrices, priceHistoryPage, priceSourceCounts } = await import("../src/lib/pricing.ts");
const { movementHistory, movementHistoryPage } = await import("../src/lib/stock-service.ts");

seed();

const ungerol = get<{ id: number; price_cents: number }>(
  `SELECT id, price_cents FROM items WHERE name = 'Ungerol'`,
)!;
run(`UPDATE items SET floor_cents = 100, ceiling_cents = 200000 WHERE id = ?`, ungerol.id);

// Two customers, so "whose sale was it" has an answer to search for.
run(`INSERT INTO customers (name, phone, kind) VALUES ('Mama Njeri', '+254700000001', 'retail')`);
run(`INSERT INTO customers (name, phone, kind) VALUES ('Westlands Laundry', '+254700000002', 'wholesale')`);
const njeri = get<{ id: number }>(`SELECT id FROM customers WHERE name = 'Mama Njeri'`)!;
const laundry = get<{ id: number }>(`SELECT id FROM customers WHERE name = 'Westlands Laundry'`)!;

/**
 * A sale on a chosen day, written straight into the ledger.
 *
 * Not through `recordSale`, and not back-dated afterwards either: a sale's
 * time is fixed by a trigger — "void it and enter a new one" — which is the
 * ledger doing its job. A window needs something outside it to exclude, so the
 * rows are written with the time they are meant to have.
 */
function saleOn(at: string, customerId: number | null, paidInFull: boolean, tag: string) {
  const total = Math.round((ungerol.price_cents * 10000) / 1000);
  const paid = paidInFull ? total : Math.round(total / 2);
  const { lastInsertRowid } = run(
    `INSERT INTO sales (client_uuid, at, user_id, customer_id, tier, total_cents, paid_cents, status)
     VALUES (?, ?, 1, ?, 'retail', ?, ?, 'completed')`,
    tag,
    at,
    customerId,
    total,
    paid,
  );
  const saleId = Number(lastInsertRowid);
  run(
    `INSERT INTO sale_lines (sale_id, item_id, name_snapshot, units, qty_milli,
                             unit_price_cents, rate_cents, list_price_cents,
                             line_total_cents, cost_cents)
     VALUES (?, ?, 'Ungerol', 1, 10000, ?, ?, ?, ?, 0)`,
    saleId,
    ungerol.id,
    total,
    ungerol.price_cents,
    ungerol.price_cents,
    total,
  );
  run(
    `INSERT INTO payments (sale_id, at, method, amount_cents, user_id) VALUES (?, ?, 'cash', ?, 1)`,
    saleId,
    at,
    paid,
  );
  return saleId;
}

postMovement({ itemId: ungerol.id, deltaMilli: 5_000_000, reason: "stocktake", userId: 1 });

const AUG = "2026-08-15";
const SEP = "2026-09-20";

const aug1 = saleOn(`${AUG} 10:00:00`, njeri.id, true, "f-aug-1");
const aug2 = saleOn(`${AUG} 11:00:00`, laundry.id, false, "f-aug-2");
const sep1 = saleOn(`${SEP} 10:00:00`, njeri.id, true, "f-sep-1");
const sep2 = saleOn(`${SEP} 11:00:00`, null, true, "f-sep-2");

// ------------------------------------------------------------------- sales

test("with nothing asked of it, the list is everything", () => {
  const { total, rows } = listSales({});
  assert.equal(total, 4);
  assert.equal(rows.length, 4);
});

test("a window keeps what was sold inside it and nothing else", () => {
  const aug = listSales({ range: { from: "2026-08-01", to: "2026-08-31" } });
  assert.equal(aug.total, 2);
  assert.deepEqual(aug.rows.map((r) => r.id).sort(), [aug1, aug2].sort());

  assert.equal(listSales({ range: { from: "1900-01-01", to: "1900-01-02" } }).total, 0);
});

test("the window is read in shop time, not UTC", () => {
  // 23:30 in Nairobi is 20:30 UTC the same day, and belongs to that day. A
  // list comparing raw timestamps would put it on the day before and disagree
  // with the dashboard, which groups by date(at, '+3 hours').
  const late = saleOn("2026-09-21 20:30:00", null, true, "f-late");
  const day = listSales({ range: { from: "2026-09-21", to: "2026-09-21" } });
  assert.equal(day.total, 1);
  assert.equal(day.rows[0].id, late);
});

test("a name finds the sales made to that account", () => {
  const found = listSales({ q: "njeri" });
  assert.equal(found.total, 2);
  assert.ok(found.rows.every((r) => r.customer_name === "Mama Njeri"));
  assert.equal(listSales({ q: "NJERI" }).total, 2, "case is not the customer's problem");
  assert.equal(listSales({ q: "laundry" }).total, 1);
});

test("a receipt number finds that receipt, not every total containing it", () => {
  const one = listSales({ q: String(sep1) });
  assert.equal(one.total, 1);
  assert.equal(one.rows[0].id, sep1);
  assert.equal(listSales({ q: `#${sep1}` }).total, 1, "typed with a hash, as it is printed");
});

test("standing: unpaid means unpaid, and voided means voided", () => {
  assert.deepEqual(listSales({ state: "unpaid" }).rows.map((r) => r.id), [aug2]);
  assert.equal(listSales({ state: "voided" }).total, 0);

  voidSale(sep2, 1, "entered twice");
  assert.deepEqual(listSales({ state: "voided" }).rows.map((r) => r.id), [sep2]);
  assert.equal(
    listSales({ state: "unpaid" }).total,
    1,
    "a voided sale is not an unpaid one, whatever its balance says",
  );
});

test("a void reason is searchable, because that is what it is for", () => {
  assert.deepEqual(listSales({ q: "entered twice" }).rows.map((r) => r.id), [sep2]);
});

test("the filters compose instead of clearing each other", () => {
  const found = listSales({ q: "njeri", range: { from: "2026-09-01", to: "2026-09-30" } });
  assert.equal(found.total, 1);
  assert.equal(found.rows[0].id, sep1);
});

test("the count is the count of what matches, and the pages follow it", () => {
  const page1 = listSales({ perPage: 2, page: 1 });
  assert.equal(page1.total, 5);
  assert.equal(page1.pages, 3);
  assert.equal(page1.rows.length, 2);

  const page3 = listSales({ perPage: 2, page: 3 });
  assert.equal(page3.rows.length, 1);
  // Asking past the end lands on the last page rather than on nothing.
  assert.equal(listSales({ perPage: 2, page: 99 }).page, 3);

  const seen = new Set([...page1.rows, ...listSales({ perPage: 2, page: 2 }).rows, ...page3.rows]);
  assert.equal(seen.size, 5, "no sale is on two pages, and none is missed between them");
});

test("the chip counts are counted over the same window as the list", () => {
  const counts = saleFilterCounts({ from: "2026-08-01", to: "2026-08-31" });
  assert.equal(counts.all, 2);
  assert.equal(counts.unpaid, 1);
  assert.equal(counts.voided, 0, "the void was in September");
});

test("the old call shape still works, because screens still use it", () => {
  const byPosition = listSales(1, 2);
  assert.equal(byPosition.rows.length, 2);
  assert.equal(byPosition.page, 1);
});

// ---------------------------------------------------------------- expenses

test("expenses filter by window, category and note together", () => {
  run(
    `INSERT INTO expenses (at, category, amount_cents, method, note, user_id)
     VALUES ('2026-08-10 09:00:00', 'Rent', 4500000, 'mpesa', 'August rent', 1)`,
  );
  run(
    `INSERT INTO expenses (at, category, amount_cents, method, note, user_id)
     VALUES ('2026-09-10 09:00:00', 'Rent', 4500000, 'mpesa', 'September rent', 1)`,
  );
  run(
    `INSERT INTO expenses (at, category, amount_cents, method, note, user_id)
     VALUES ('2026-09-12 09:00:00', 'Transport', 300000, 'cash', 'lorry from Industrial Area', 1)`,
  );

  assert.equal(listExpenses({}).total, 3);
  assert.equal(listExpenses({ range: { from: "2026-09-01", to: "2026-09-30" } }).total, 2);
  assert.equal(listExpenses({ category: "Rent" }).total, 2);
  assert.equal(listExpenses({ q: "lorry" }).total, 1);
  assert.equal(
    listExpenses({ category: "Rent", range: { from: "2026-08-01", to: "2026-08-31" } }).total,
    1,
  );
  assert.equal(listExpenses({ range: { from: "1900-01-01", to: "1900-01-02" } }).total, 0);
});

test("the expense total is the total of what matches, not of the table", () => {
  // The screen prints this under the rows. Summing the month while showing a
  // filtered week invites somebody to read one against the other.
  const rent = listExpenses({ category: "Rent" });
  assert.equal(rent.totalCents, 9000000);
  const week = listExpenses({ range: { from: "2026-09-12", to: "2026-09-12" } });
  assert.equal(week.totalCents, 300000);
});

test("the category chips count over the window too", () => {
  const sept = expenseCategoryTotals({ from: "2026-09-01", to: "2026-09-30" });
  assert.equal(sept.find((c) => c.category === "Rent")?.n, 1);
  assert.equal(sept.find((c) => c.category === "Transport")?.n, 1);
});

// -------------------------------------------------------------- deliveries

test("a delivery is found by what came in, not only by who sent it", () => {
  // "When did we last get caustic soda" is asked far more often than anything
  // about an invoice number, and the delivery is filed under a supplier.
  const supplier = createSupplier({ name: "Chemi Traders Ltd" }, 1);
  const caustic = get<{ id: number }>(`SELECT id FROM items WHERE name = 'Caustic Soda'`)!;

  recordPurchase({
    supplierId: supplier,
    ref: "INV-9001",
    transportCents: 0,
    userId: 1,
    lines: [{ itemId: ungerol.id, units: 1, sizeMilli: 250000, costCents: 8000000 }],
  });
  recordPurchase({
    supplierId: supplier,
    ref: "INV-9002",
    transportCents: 0,
    userId: 1,
    lines: [{ itemId: caustic.id, units: 1, sizeMilli: 25000, costCents: 375000 }],
  });

  assert.equal(listPurchases({}).total, 2);
  assert.equal(listPurchases({ q: "caustic" }).total, 1, "by what was on the lorry");
  assert.equal(listPurchases({ q: "INV-9001" }).total, 1, "by the invoice number");
  assert.equal(listPurchases({ q: "chemi" }).total, 2, "by the supplier");
  assert.equal(listPurchases({ range: { from: "1900-01-01", to: "1900-01-02" } }).total, 0);
});

// ----------------------------------------------------------- price history

test("price changes filter by item, by who moved them, and by when", () => {
  applyPrices([{ itemId: ungerol.id, price: 560 }], 1, { source: "admin" });
  applyPrices([{ itemId: ungerol.id, price: 575 }], 1, { source: "counter" });

  assert.equal(priceHistoryPage({}).total, 2);
  assert.equal(priceHistoryPage({ q: "ungerol" }).total, 2);
  assert.equal(priceHistoryPage({ q: "owner" }).total, 2, "by whoever changed it");
  assert.equal(priceHistoryPage({ source: "counter" }).total, 1);
  assert.equal(priceHistoryPage({ range: { from: "1900-01-01", to: "1900-01-02" } }).total, 0);

  const counts = priceSourceCounts(null);
  assert.equal(counts.all, 2);
  assert.equal(counts.counter, 1);
  assert.equal(counts.admin, 1);
});

test("the old price-history call shape still works", () => {
  const page = priceHistoryPage(1, 10, ungerol.id);
  assert.equal(page.total, 2);
});

// ------------------------------------------------------------ item ledger

test("an item's ledger pages without losing or repeating an entry", () => {
  // The sales above were written straight into the ledger, so they moved no
  // stock. A few real movements, to have something worth turning a page over.
  for (let i = 0; i < 5; i++) {
    postMovement({ itemId: ungerol.id, deltaMilli: -1000, reason: "sale", userId: 1 });
  }

  const every = movementHistory(ungerol.id, Number.MAX_SAFE_INTEGER);
  assert.ok(every.length > 3, "there is something to page");

  const p1 = movementHistoryPage(ungerol.id, 1, 2);
  const p2 = movementHistoryPage(ungerol.id, 2, 2);
  assert.equal(p1.total, every.length);
  assert.equal(p1.rows[0].id, every[0].id, "newest first, as the screen reads");
  assert.equal(p2.rows[0].id, every[2].id, "page two carries on where page one stopped");
  assert.equal(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size, 4);
});

test("the running balance is the balance, not a per-page total", () => {
  // Each row says what the shelf held at that moment, walked from the very
  // first movement. Computing it per page would restart it at every page turn.
  const every = movementHistory(ungerol.id, Number.MAX_SAFE_INTEGER);
  const p2 = movementHistoryPage(ungerol.id, 2, 2);
  assert.equal(p2.rows[0].balanceMilli, every[2].balanceMilli);
  assert.equal(every[0].balanceMilli, stockOf(ungerol.id), "and the newest is the shelf now");
});

test("asking for a page past the end lands on the last one", () => {
  const far = movementHistoryPage(ungerol.id, 999, 2);
  assert.equal(far.page, far.pages);
  assert.ok(far.rows.length > 0);
});
