/**
 * Demo data, and the wipe.
 *
 * Two things are worth pinning. The demo shop has to be a shop that could
 * really have existed — stock arrives before it is sold, debts are explained by
 * invoices, the ledger adds up — because demo data that cannot occur in
 * practice teaches the owner the wrong thing and hides real bugs.
 *
 * And the wipe has to put the append-only guards back. It lifts them to do its
 * work, which is the one legitimate reason to lift them; a wipe that left them
 * off would leave the shop trading on a ledger anyone could edit, and nothing
 * on screen would say so.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "riziki-demo-"));
process.env.RIZIKI_DB = join(TMP, "test.db");

const { get, all, run } = await import("../src/lib/db.ts");
const { seed } = await import("../src/lib/seed.ts");
const { loadDemoData, clearTradingData, tradingCounts, DemoError } = await import(
  "../src/lib/demo.ts"
);

seed();
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

const OWNER = 1;

const GUARDS = [
  "stock_movements_no_update",
  "stock_movements_no_delete",
  "sales_no_delete",
  "sales_no_money_update",
  "sale_lines_no_update",
  "sale_lines_no_delete",
  "price_changes_no_update",
  "price_changes_no_delete",
];

const guardCount = () =>
  get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN (${GUARDS.map(() => "?").join(",")})`,
    ...GUARDS,
  )!.n;

test("the demo shop is one that could really have traded", () => {
  const s = loadDemoData(OWNER);

  assert.ok(s.sales > 40, `expected a month of trading, got ${s.sales} sales`);
  assert.ok(s.customers > 0 && s.purchases > 0 && s.quotes > 0 && s.expenses > 0);

  // Every sale's payments must add up to what the sale says was paid. A demo
  // that fails this makes the day-close variance meaningless.
  const mismatched = all<{ id: number }>(
    `SELECT s.id FROM sales s
      WHERE s.paid_cents <> COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.sale_id = s.id), 0)`,
  );
  assert.deepEqual(mismatched, [], "paid_cents must equal the sum of the payment rows");

  // Nothing may be owed by a customer who does not exist, and nothing may be
  // owed on a voided bill.
  const orphan = all(
    `SELECT s.id FROM sales s WHERE s.customer_id IS NOT NULL
       AND s.customer_id NOT IN (SELECT id FROM customers)`,
  );
  assert.deepEqual(orphan, [], "every credit sale points at a real customer");

  // Stock arrived before it left: no item may have gone negative purely because
  // the demo sold what it had never bought.
  const negatives = all<{ item_id: number; qty: number }>(
    `SELECT item_id, SUM(delta_milli) AS qty FROM stock_movements
      GROUP BY item_id HAVING qty < 0`,
  );
  assert.deepEqual(negatives, [], "the demo must not sell stock it never received");

  // A month, not one very busy afternoon. Without spreading the dates every
  // report has a single bar and every debt is nought days old.
  const span = get<{ days: number }>(
    `SELECT CAST(julianday(MAX(at)) - julianday(MIN(at)) AS INTEGER) AS days FROM sales`,
  )!.days;
  assert.ok(span >= 14, `sales should span weeks, spanned ${span} days`);

  // And stock must still have arrived before it left, after the dates moved.
  const early = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM stock_movements m
      WHERE m.delta_milli < 0
        AND m.at < (SELECT MIN(p.at) FROM stock_movements p
                     WHERE p.item_id = m.item_id AND p.delta_milli > 0)`,
  )!.n;
  assert.equal(early, 0, "nothing may be sold before the delivery that supplied it");

  assert.ok(
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM day_closes`)!.n > 0,
    "past days are closed off, so the day-close history is not empty",
  );
});

test("it is deterministic — same starting shop, same seed, same result", () => {
  // Two loads from the same starting point, compared to each other. Comparing
  // table counts across a wipe would not do it: the seeded catalogue ships with
  // its own customers, so the first load's total includes rows the second one
  // never created, and the test would fail for a reason that is not a bug.
  const prices = all<{ id: number; price_cents: number }>(`SELECT id, price_cents FROM items`);
  const restore = () => {
    for (const p of prices) {
      run(`UPDATE items SET price_cents = ? WHERE id = ?`, p.price_cents, p.id);
    }
  };

  clearTradingData(OWNER);
  restore();
  const a = loadDemoData(OWNER);
  const movementsA = get<{ n: number }>(`SELECT COUNT(*) AS n FROM stock_movements`)!.n;

  clearTradingData(OWNER);
  restore();
  const b = loadDemoData(OWNER);
  const movementsB = get<{ n: number }>(`SELECT COUNT(*) AS n FROM stock_movements`)!.n;

  assert.deepEqual(b, a, "the same seed must build the same shop, down to the counts");
  assert.equal(movementsB, movementsA, "and the same ledger");
});

test("clearing empties the trading records and keeps the shop's own setup", () => {
  const itemsBefore = get<{ n: number }>(`SELECT COUNT(*) AS n FROM items`)!.n;
  const usersBefore = get<{ n: number }>(`SELECT COUNT(*) AS n FROM users`)!.n;
  const chemsBefore = get<{ n: number }>(`SELECT COUNT(*) AS n FROM chemicals`)!.n;
  assert.ok(itemsBefore > 0 && usersBefore > 0);

  const removed = clearTradingData(OWNER);
  assert.ok(removed.sales > 0, "it reports what it removed");

  const after = tradingCounts();
  for (const [table, n] of Object.entries(after)) {
    assert.equal(n, 0, `${table} should be empty after a clear`);
  }

  assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM items`)!.n, itemsBefore, "catalogue kept");
  assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM users`)!.n, usersBefore, "staff kept");
  assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM chemicals`)!.n, chemsBefore, "chemicals kept");
});

test("the append-only guards come back, and still bite", () => {
  assert.equal(guardCount(), GUARDS.length, "every guard was restored");

  loadDemoData(OWNER);
  const saleId = get<{ id: number }>(`SELECT id FROM sales ORDER BY id LIMIT 1`)!.id;
  const moveId = get<{ id: number }>(`SELECT id FROM stock_movements ORDER BY id LIMIT 1`)!.id;

  assert.throws(() => run(`DELETE FROM sales WHERE id = ?`, saleId), /immutable/);
  assert.throws(() => run(`DELETE FROM stock_movements WHERE id = ?`, moveId), /append-only/);
  assert.throws(
    () => run(`UPDATE sales SET total_cents = 1 WHERE id = ?`, saleId),
    /fixed/,
    "and the money guard too",
  );
});

test("a shop with nothing priced is told why it cannot be filled", () => {
  clearTradingData(OWNER);
  run(`UPDATE items SET price_cents = 0`);
  assert.throws(() => loadDemoData(OWNER), DemoError);
  assert.equal(guardCount(), GUARDS.length, "a refused load leaves the guards alone");
});
