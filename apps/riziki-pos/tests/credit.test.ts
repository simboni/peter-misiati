/**
 * Credit, ageing and purchasing arithmetic.
 *
 * RIZIKI_DB is pointed at a throwaway file *before* anything imports db.ts,
 * because db.ts resolves the path once at module load. The imports below are
 * therefore dynamic — a static `import` would be hoisted above the assignment
 * and the tests would chew on the shop's real data.
 */

import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const DIR = mkdtempSync(join(tmpdir(), "riziki-credit-"));
process.env.RIZIKI_DB = join(DIR, "test.db");

const dbm = await import("../src/lib/db.ts");
const credit = await import("../src/lib/credit.ts");
const purchasing = await import("../src/lib/purchasing.ts");
const { toCents, toMilli } = await import("../src/lib/units.ts");

process.on("exit", () => {
  try {
    dbm.closeDb();
  } catch {}
  rmSync(DIR, { recursive: true, force: true });
});

// ------------------------------------------------------------------ fixtures

const OWNER = dbm.run(
  `INSERT INTO users (name, role, pin_hash) VALUES ('Owner', 'owner', 'x')`,
).lastInsertRowid;

function newCustomer(name: string, limit = 0): number {
  return credit.createCustomer({ name, phone: "0722111222", kind: "wholesale", creditLimitCents: limit }, OWNER);
}

let uuid = 0;

/** A completed sale, optionally back-dated so the ageing bands can be exercised. */
function newSale(customerId: number, totalCents: number, paidCents: number, daysAgo = 0): number {
  const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
  const { lastInsertRowid } = dbm.run(
    `INSERT INTO sales (client_uuid, at, user_id, customer_id, tier, total_cents, paid_cents, status)
     VALUES (?, ?, ?, ?, 'wholesale', ?, ?, 'completed')`,
    `test-${++uuid}`,
    at,
    OWNER,
    customerId,
    totalCents,
    paidCents,
  );
  if (paidCents > 0) {
    dbm.run(
      `INSERT INTO payments (sale_id, method, amount_cents, user_id) VALUES (?, 'cash', ?, ?)`,
      lastInsertRowid,
      paidCents,
      OWNER,
    );
  }
  return lastInsertRowid;
}

/** A one-unit-per-kg stock item holding `units` at `costCents` each. */
function newItem(name: string, onHandUnits: number, costCents: number): number {
  const { lastInsertRowid: id } = dbm.run(
    `INSERT INTO items (name, kind, canonical_unit, size_milli, unit_label, sellable, cost_cents)
     VALUES (?, 'bulk', 'kg', ?, 'drum', 0, ?)`,
    name,
    toMilli(1),
    costCents,
  );
  if (onHandUnits > 0) {
    dbm.postMovement({ itemId: id, deltaMilli: toMilli(onHandUnits), reason: "opening", userId: OWNER });
  }
  return id;
}

// -------------------------------------------------------------------- tests

test("a credit sale of 5,000 with 2,000 paid leaves a 3,000 balance", () => {
  const id = newCustomer("Mama Njeri");
  newSale(id, toCents(5000), toCents(2000));

  assert.equal(credit.balanceOf(id), toCents(3000));

  const row = credit.debtors().find((d) => d.id === id);
  assert.ok(row, "the customer should appear in the debtors book");
  assert.equal(row.balance_cents, toCents(3000));
  assert.equal(row.open_sales, 1);
});

test("recording a 3,000 payment clears the balance to zero", () => {
  const id = newCustomer("Kariobangi Hardware");
  const saleId = newSale(id, toCents(5000), toCents(2000));

  const parts = credit.recordPayment({
    customerId: id,
    amountCents: toCents(3000),
    method: "mpesa",
    mpesaCode: "TFG7HJ2K90",
    userId: OWNER,
  });

  assert.equal(parts.length, 1);
  assert.equal(parts[0].saleId, saleId);
  assert.equal(parts[0].amountCents, toCents(3000));
  assert.equal(parts[0].clearedSale, true);

  assert.equal(credit.balanceOf(id), 0);
  // paid_cents must move with the payment row, not instead of it
  const sale = dbm.get<{ paid_cents: number }>(`SELECT paid_cents FROM sales WHERE id = ?`, saleId);
  assert.equal(sale?.paid_cents, toCents(5000));
  assert.equal(credit.openSales(id).length, 0);
  assert.equal(credit.debtors().some((d) => d.id === id), false);
});

test("a payment spanning two sales settles the oldest first, then the next", () => {
  const id = newCustomer("Gikomba Traders");
  const older = newSale(id, toCents(2000), 0, 10); // ten days ago
  const newer = newSale(id, toCents(3000), 0, 2); //  two days ago

  const parts = credit.recordPayment({
    customerId: id,
    amountCents: toCents(2500),
    method: "cash",
    userId: OWNER,
  });

  assert.equal(parts.length, 2);
  assert.deepEqual(
    parts.map((p) => [p.saleId, p.amountCents, p.clearedSale]),
    [
      [older, toCents(2000), true],
      [newer, toCents(500), false],
    ],
  );

  assert.equal(credit.balanceOf(id), toCents(2500));

  const open = credit.openSales(id);
  assert.equal(open.length, 1, "the older sale should be fully settled");
  assert.equal(open[0].id, newer);
  assert.equal(open[0].due_cents, toCents(2500));
});

test("a payment larger than the debt is refused, and nothing is written", () => {
  const id = newCustomer("Overpayer Ltd");
  newSale(id, toCents(1000), 0);

  assert.throws(
    () => credit.recordPayment({ customerId: id, amountCents: toCents(1500), method: "cash", userId: OWNER }),
    /more than this customer owes/,
  );
  assert.equal(credit.balanceOf(id), toCents(1000), "the rollback must leave the balance untouched");
  assert.equal(
    dbm.all(`SELECT p.id FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.customer_id = ?`, id).length,
    0,
  );
});

test("ageing buckets put a 40-day-old unpaid sale in 30+", () => {
  const id = newCustomer("Slow Payer");
  newSale(id, toCents(4000), 0, 40);
  newSale(id, toCents(1000), 0, 1); // a fresh sale must not rescue the bucket

  const row = credit.debtors().find((d) => d.id === id);
  assert.ok(row);
  assert.equal(row.days, 40);
  assert.equal(row.band, "old");
  assert.equal(credit.AGE_LABEL[row.band], "30+ days");
  assert.equal(credit.AGE_TONE[row.band], "bad");

  // the neighbouring bands, so the boundaries stay where they are documented
  assert.equal(credit.ageBand(0), "fresh");
  assert.equal(credit.ageBand(7), "fresh");
  assert.equal(credit.ageBand(8), "mid");
  assert.equal(credit.ageBand(30), "mid");
  assert.equal(credit.ageBand(31), "old");
});

test("the debtors book totals and sorts by what is owed", () => {
  const before = credit.totalOwed();
  const id = newCustomer("Biggest Debtor");
  newSale(id, toCents(90000), 0, 3);

  assert.equal(credit.totalOwed(), before + toCents(90000));
  assert.equal(credit.debtors()[0].id, id, "largest balance leads the list");
});

test("credit limits are compared against the derived balance", () => {
  const id = newCustomer("Limited Ltd", toCents(2000));
  newSale(id, toCents(2500), 0);

  const c = credit.getCustomer(id)!;
  assert.equal(credit.isOverLimit(c, credit.balanceOf(id)), true);
  assert.equal(credit.isOverLimit(c, toCents(2000)), false, "exactly at the limit is not over it");
  assert.equal(credit.isOverLimit({ credit_limit_cents: 0 }, toCents(999999)), false, "no limit set, no warning");
});

test("invoice numbers are sequential and issued once", () => {
  const id = newCustomer("Invoice Co");
  const a = newSale(id, toCents(100), toCents(100));
  const b = newSale(id, toCents(200), toCents(200));

  const first = credit.issueInvoiceNo(a, OWNER);
  const second = credit.issueInvoiceNo(b, OWNER);

  assert.match(first, /^INV-\d{5}$/);
  assert.equal(Number(second.slice(4)), Number(first.slice(4)) + 1);
  assert.equal(credit.issueInvoiceNo(a, OWNER), first, "re-issuing must not burn a new number");
});

test("an invoice reads its money from the sale_lines snapshot, not from items", () => {
  const customerId = credit.createCustomer(
    { name: "Snapshot Traders", phone: "0733444555", kind: "wholesale", kraPin: "p051234567x" },
    OWNER,
  );
  const itemId = newItem("Ungerol — 20 kg pack", 100, toCents(760));
  const saleId = newSale(customerId, toCents(1600), toCents(600));

  dbm.run(
    `INSERT INTO sale_lines (sale_id, item_id, name_snapshot, units, qty_milli, unit_price_cents, line_total_cents)
     VALUES (?, ?, 'Ungerol — 20 kg pack', 2, ?, ?, ?)`,
    saleId,
    itemId,
    toMilli(2),
    toCents(800),
    toCents(1600),
  );

  // the item's price moves after the sale; the invoice must not follow it
  dbm.run(`UPDATE items SET cost_cents = ? WHERE id = ?`, toCents(9999), itemId);

  const inv = credit.getInvoice(saleId)!;
  assert.equal(inv.lines.length, 1);
  assert.equal(inv.lines[0].unit_price_cents, toCents(800));
  assert.equal(inv.lines[0].line_total_cents, toCents(1600));
  assert.equal(inv.lines[0].canonical_unit, "kg");
  assert.equal(inv.balanceCents, toCents(1000));
  assert.equal(inv.sale.customer_name, "Snapshot Traders");
  assert.equal(inv.sale.customer_kra_pin, "P051234567X", "the buyer PIN eTIMS will need is stored upper-cased");

  // tenders are grouped per method for the "Payment" block on the printout
  credit.recordPayment({ customerId, amountCents: toCents(400), method: "mpesa", mpesaCode: "QWE123", userId: OWNER });
  const after = credit.getInvoice(saleId)!;
  assert.deepEqual(
    after.tenders.map((t) => [t.method, t.amount_cents]),
    [
      ["cash", toCents(600)],
      ["mpesa", toCents(400)],
    ],
  );
  assert.equal(after.balanceCents, toCents(600));
  assert.ok(credit.invoiceMessage(after).includes("balance KES 600"));
});

test("wa.me links normalise Kenyan numbers and encode the message", () => {
  assert.equal(credit.waPhone("0722 111 222"), "254722111222");
  assert.equal(credit.waPhone("+254 733 444 555"), "254733444555");
  assert.equal(credit.waPhone("722111222"), "254722111222");
  assert.ok(credit.waLink("0722111222", "Balance KES 3,000").startsWith("https://wa.me/254722111222?text="));
  assert.ok(credit.waLink("", "hi").startsWith("https://wa.me/?text="), "no number still gives a share link");
  assert.ok(credit.reminderMessage("Mama Njeri", toCents(3000)).includes("KES 3,000"));
});

test("a purchase raises stock by the units bought and moves the average cost", () => {
  // Holding 10 units at 80 cents each; buying 10 more for 1,000 cents in total.
  const itemId = newItem("Ungerol — 1 kg drum", 10, 80);

  const res = purchasing.recordPurchase({
    supplierId: null,
    lines: [{ itemId, units: 10, costCents: 1000 }],
    userId: OWNER,
  });

  assert.equal(dbm.stockOf(itemId), toMilli(20), "stock must rise by exactly the units bought");

  const item = dbm.get<{ cost_cents: number }>(`SELECT cost_cents FROM items WHERE id = ?`, itemId);
  assert.equal(item?.cost_cents, 90, "(10 x 80 + 1000) / 20 = 90");

  assert.equal(res.totalCents, 1000);
  const move = dbm.get<{ reason: string; delta_milli: number; ref_id: number }>(
    `SELECT reason, delta_milli, ref_id FROM stock_movements WHERE item_id = ? ORDER BY id DESC LIMIT 1`,
    itemId,
  );
  assert.equal(move?.reason, "purchase");
  assert.equal(move?.delta_milli, toMilli(10));
  assert.equal(move?.ref_id, res.purchaseId);
});

test("transport is prorated by value and the lines still sum to the total", () => {
  const dear = newItem("Dear drum", 0, 0);
  const cheap = newItem("Cheap bag", 0, 0);

  const res = purchasing.recordPurchase({
    supplierId: null,
    transportCents: 1000,
    lines: [
      { itemId: dear, units: 1, costCents: 9000 },
      { itemId: cheap, units: 1, costCents: 1000 },
    ],
    userId: OWNER,
  });

  assert.deepEqual(res.lines.map((l) => l.transportCents), [900, 100]);
  assert.deepEqual(res.lines.map((l) => l.landedCents), [9900, 1100]);
  assert.equal(res.totalCents, 11000);

  const lineSum = dbm.get<{ n: number }>(
    `SELECT SUM(cost_cents) AS n FROM purchase_lines WHERE purchase_id = ?`,
    res.purchaseId,
  );
  assert.equal(lineSum?.n, res.totalCents, "landed lines must reconcile to the purchase total");

  // the landed cost, not the invoice cost, is what the average is built from
  const item = dbm.get<{ cost_cents: number }>(`SELECT cost_cents FROM items WHERE id = ?`, dear);
  assert.equal(item?.cost_cents, 9900);
});

test("rounding leftovers land on the last line, never as a negative share", () => {
  const lines = [
    { itemId: 1, units: 1, costCents: 333 },
    { itemId: 2, units: 1, costCents: 333 },
    { itemId: 3, units: 1, costCents: 334 },
  ];
  const out = purchasing.prorateTransport(lines, 100);
  assert.equal(out.reduce((s, l) => s + l.transportCents, 0), 100);
  assert.ok(out.every((l) => l.transportCents >= 0));
});

test("a failing line rolls the whole purchase back", () => {
  const good = newItem("Good item", 0, 0);
  const before = dbm.all(`SELECT id FROM purchases`).length;

  assert.throws(
    () =>
      purchasing.recordPurchase({
        supplierId: null,
        lines: [
          { itemId: good, units: 1, costCents: 500 },
          { itemId: 999999, units: 1, costCents: 500 },
        ],
        userId: OWNER,
      }),
    /unknown item/,
  );

  assert.equal(dbm.all(`SELECT id FROM purchases`).length, before, "no half-recorded delivery");
  assert.equal(dbm.stockOf(good), 0, "and no stock from the line that did succeed");
});

test("price history reports the landed cost of one container over time", () => {
  const supplierId = purchasing.createSupplier({ name: "Test Chemicals Ltd", phone: "0720000009" }, OWNER);
  const itemId = newItem("Price-watch drum", 0, 0);

  purchasing.recordPurchase({ supplierId, lines: [{ itemId, units: 2, costCents: 20000 }], userId: OWNER });
  purchasing.recordPurchase({ supplierId, lines: [{ itemId, units: 2, costCents: 24000 }], userId: OWNER });

  const hist = purchasing.priceHistory(itemId);
  assert.equal(hist.length, 2);
  assert.deepEqual(
    hist.map((h) => h.unit_cost_cents).sort((a, b) => a - b),
    [10000, 12000],
  );
  assert.equal(hist[0].supplier_name, "Test Chemicals Ltd");
});

// ------------------------------------------------------------- the statement

test("a statement debits sales, credits money received, and closes on balanceOf", () => {
  const id = newCustomer("Statement Buyer");
  // 5,000 sale paid 2,000 cash at the till; later 1,000 more by M-Pesa.
  newSale(id, toCents(5000), toCents(2000), 10);
  credit.recordPayment({ customerId: id, amountCents: toCents(1000), method: "mpesa", mpesaCode: "STMT01", userId: OWNER });
  // A second, unpaid sale.
  newSale(id, toCents(700), 0, 2);

  const rows = credit.statement(id);
  assert.equal(rows.filter((r) => r.kind === "sale").length, 2);
  assert.equal(rows.filter((r) => r.kind === "payment").length, 2, "cash at till + later M-Pesa");

  // Chronological with a running balance, closing on the derived balance.
  const closing = rows[rows.length - 1].balance_cents;
  assert.equal(closing, credit.balanceOf(id));
  assert.equal(closing, toCents(5000 - 2000 - 1000 + 700));

  // The M-Pesa code is on the statement — that's what reconciles it.
  assert.ok(rows.some((r) => r.ref.includes("STMT01")));
});

test("a statement excludes credit-tender markers and voided sales", () => {
  const id = newCustomer("Void Statement");
  const saleId = newSale(id, toCents(900), 0, 5);
  // The unpaid part recorded as a 'credit' tender must not appear as money in.
  dbm.run(`INSERT INTO payments (sale_id, method, amount_cents, user_id) VALUES (?, 'credit', ?, ?)`,
    saleId, toCents(900), OWNER);

  let rows = credit.statement(id);
  assert.equal(rows.filter((r) => r.kind === "payment").length, 0, "credit marker is not a payment");
  assert.equal(rows[rows.length - 1].balance_cents, toCents(900));

  // Void the sale: it and its rows leave the statement, balance returns to zero.
  dbm.run(`UPDATE sales SET status = 'voided', void_reason = 'test', voided_by = ? WHERE id = ?`, OWNER, saleId);
  rows = credit.statement(id);
  assert.equal(rows.length, 0);
  assert.equal(credit.balanceOf(id), 0);
});
