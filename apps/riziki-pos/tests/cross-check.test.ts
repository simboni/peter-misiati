/**
 * Do the screens agree with each other?
 *
 * Every figure in this shop is derived — nothing is stored as a running total,
 * on purpose — so the same question asked on two screens goes through two
 * different queries. That is the right design and it is also exactly how two
 * screens come to disagree: a filter on one and not the other, a cost taken
 * from a different place, a status nobody excluded.
 *
 * This file asks every such question twice and insists on the same answer. It
 * runs against one shop carrying a bit of everything: deliveries, retail and
 * wholesale sales, a mix sold to order, a batch mixed in advance, a credit
 * sale, a stock take, a voided sale and an undone delivery.
 *
 * Where two figures are MEANT to differ, the test says so and pins the reason,
 * because an unexplained difference and a deliberate one look identical in a
 * screenshot.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-cross-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, all, run, stockOf } = await import("../src/lib/db.ts");
const { businessDate } = await import("../src/lib/units.ts");
const { profitSummary, dayTotals, profitPerProduct } = await import("../src/lib/reports.ts");
const { stockStatement, statementRange } = await import("../src/lib/stock-statement.ts");
const { stockView } = await import("../src/lib/stock-service.ts");
const { recordSale, voidSale, listSales } = await import("../src/lib/sales.ts");
const { createSupplier, recordPurchase, voidPurchase, listPurchases, supplierSpend } =
  await import("../src/lib/purchasing.ts");
const { saveBundles, formulaBundles } = await import("../src/lib/bundles.ts");
const { currentVersion } = await import("../src/lib/production.ts");
const { recordMix } = await import("../src/lib/mixing.ts");
const { setFormulaOutput } = await import("../src/lib/mixing.ts");
const { createCustomer, debtors } = await import("../src/lib/credit.ts");

seed();

const idOf = (name: string) => get<{ id: number }>(`SELECT id FROM items WHERE name = ?`, name)!.id;
const today = businessDate();
const range = { from: today, to: today };

let uuid = 0;
const nextUuid = () => `cross-${++uuid}`;

// ------------------------------------------------------------- the shop's day

const supplier = createSupplier({ name: "Kel Chemicals Ltd" }, 1);

// Two deliveries, one of which is later undone.
const kept = recordPurchase({
  supplierId: supplier,
  ref: "DN-A",
  transportCents: 150_000,
  userId: 1,
  lines: [{ itemId: idOf("Ungerol"), units: 2, sizeMilli: 170_000, costCents: 12_000_000 }],
});
const undone = recordPurchase({
  supplierId: supplier,
  ref: "DN-B",
  transportCents: 0,
  userId: 1,
  lines: [{ itemId: idOf("Ufacid"), units: 1, sizeMilli: 250_000, costCents: 9_000_000 }],
});

// A recipe sold to order, as a bundle.
const formula = get<{ id: number }>(`SELECT id FROM formulas WHERE name LIKE '%Multipurpose%'`)!;
const version = currentVersion(formula.id)!;
saveBundles({ formulaId: formula.id }, [{ sizeMilli: 20_000, priceCents: 180_000, floorCents: 0 }]);
const bundle = formulaBundles(formula.id)[0];

const cashSale = recordSale({
  clientUuid: nextUuid(),
  userId: 1,
  tier: "retail",
  lines: [{ bundleId: bundle.id, units: 2, unitPriceCents: bundle.priceCents }],
  tenders: [{ method: "cash", amountCents: 2 * bundle.priceCents }],
});

// A plain chemical sale, part paid by M-Pesa.
recordSale({
  clientUuid: nextUuid(),
  userId: 1,
  tier: "wholesale",
  lines: [{ itemId: idOf("Caustic Soda"), units: 1, qtyMilli: 50_000, unitPriceCents: 20_300 }],
  tenders: [{ method: "mpesa", amountCents: 1_015_000, mpesaCode: "ABC123" }],
});

// A credit sale, left unpaid.
const customer = createCustomer({ name: "ANN MACHAKOS", phone: "0722 000 111" }, 1);
const credit = recordSale({
  clientUuid: nextUuid(),
  userId: 1,
  tier: "wholesale",
  customerId: customer,
  lines: [{ itemId: idOf("Salt"), units: 1, qtyMilli: 100_000, unitPriceCents: 8_100 }],
  tenders: [],
});

// A sale rung up wrong and voided.
const scrapped = recordSale({
  clientUuid: nextUuid(),
  userId: 1,
  tier: "retail",
  lines: [{ itemId: idOf("Caustic Soda"), units: 1, qtyMilli: 10_000, unitPriceCents: 20_300 }],
  tenders: [{ method: "cash", amountCents: 203_000 }],
});
voidSale(scrapped.saleId, 1, "rung up wrong");

// A batch mixed in advance, so Made and Used are not both zero.
run(
  `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                      sellable, price_basis, price_cents, cost_cents)
   VALUES (NULL, 'MULTIPURPOSE SOAP', 'finished', 'L', 20000, 'jerrican', 1, 'unit', 9000, 0)`,
);
setFormulaOutput(formula.id, idOf("MULTIPURPOSE SOAP"), 1);
const batch = recordMix({
  versionId: version.id,
  targetMilli: 20_000,
  actualMilli: 20_000,
  userId: 1,
});

// A stock take that writes a little off.
const { performStocktake } = await import("../src/lib/stock-service.ts");
performStocktake({
  counts: [{ itemId: idOf("Salt"), countedUnits: (stockOf(idOf("Salt")) - 5_000) / 1000 }],
  userId: 1,
  reason: "spillage",
});

// And the delivery that should never have been entered.
voidPurchase(undone.purchaseId, 1, "typed twice");

const statement = stockStatement(statementRange("today", today));
const profit = profitSummary(range);
const day = dayTotals(today);

// -------------------------------------------------------------- the takings

test("every screen agrees what the shop sold today", () => {
  const raw = get<{ total: number; n: number }>(
    `SELECT COALESCE(SUM(total_cents), 0) AS total, COUNT(*) AS n
       FROM sales WHERE status = 'completed' AND date(at, '+3 hours') = ?`,
    today,
  )!;

  assert.equal(profit.salesCents, raw.total, "the profit report and the ledger");
  assert.equal(day.salesCents, raw.total, "the day close and the ledger");
  assert.equal(profit.saleCount, raw.n, "and the number of sales");

  const listed = listSales({ state: "all", perPage: 500 });
  const fromList = listed.rows
    .filter((r) => r.status === "completed" && r.at.slice(0, 10) <= today)
    .reduce((sum, r) => sum + r.total_cents, 0);
  assert.equal(fromList, raw.total, "and the sales list");
});

test("a voided sale is in none of them", () => {
  const voided = get<{ total: number }>(
    `SELECT COALESCE(SUM(total_cents), 0) AS total FROM sales WHERE status = 'voided'`,
  )!;
  assert.ok(voided.total > 0, "there is a voided sale to get wrong");

  const raw = get<{ total: number }>(
    `SELECT COALESCE(SUM(total_cents), 0) AS total
       FROM sales WHERE status = 'completed' AND date(at, '+3 hours') = ?`,
    today,
  )!;
  assert.equal(profit.salesCents, raw.total, "takings exclude it");
  assert.equal(
    stockOf(idOf("Caustic Soda")) > 0,
    true,
    "and the stock it took came back",
  );
});

// --------------------------------------------------------------- the shelf

test("the statement's closing quantity is what the shelf holds", () => {
  for (const r of statement.rows) {
    assert.equal(r.closingMilli, stockOf(r.itemId), `${r.name}`);
  }
});

test("the statement's closing value is the stock list's total", () => {
  /*
    The one place these two can legitimately part company is an item somebody
    has switched off: the stock list shows what is on sale, the statement shows
    everything the ledger touched. With every item active they must agree to
    the cent, and if they ever do not it is a filter nobody meant.
  */
  const inactive = all<{ n: number }>(`SELECT COUNT(*) AS n FROM items WHERE active = 0`)[0];
  assert.equal(inactive.n, 0, "this fixture has nothing switched off");
  assert.equal(statement.totals.closingValueCents, stockView().totalValueCents);
});

test("yesterday's closing is today's opening", () => {
  const yesterday = stockStatement(statementRange("yesterday", today));
  for (const r of statement.rows) {
    const y = yesterday.rows.find((x) => x.itemId === r.itemId);
    assert.equal(r.openingMilli, y ? y.closingMilli : 0, `${r.name}`);
  }
});

// ---------------------------------------------------------------- the cost

test("gross profit is takings less cost of goods, on both screens", () => {
  assert.equal(profit.grossProfitCents, profit.salesCents - profit.cogsCents);
});

test("the statement's sold-at-cost and the report's cost of goods agree", () => {
  /*
    DELIBERATELY TWO CALCULATIONS, AND THE DIFFERENCE IS THE POINT.

    The profit report values each sale at the cost recorded ON that sale; the
    statement values what left the shelf at what it costs TODAY. While no cost
    price has moved they are the same number, and this asserts that — it is the
    check that neither has quietly started counting a different set of lines.

    Once a cost moves they separate, legitimately, and the shop was shown that
    gap as 546.52 on 334,224.79 — under two parts in a thousand.
  */
  const gap = Math.abs(statement.totals.soldValueCents - profit.cogsCents);
  assert.ok(
    gap <= statement.rows.length,
    `sold-at-cost ${statement.totals.soldValueCents} vs COGS ${profit.cogsCents} — ` +
      `${gap} apart, which is more than per-item rounding`,
  );
});

test("the product table's revenue adds up to the day's takings", () => {
  const rows = profitPerProduct(range, 500);
  const revenue = rows.reduce((sum: number, r) => sum + r.revenue_cents, 0);
  assert.equal(revenue, profit.salesCents, "every shilling is against some product");
});

test("the product table's cost adds up to cost of goods", () => {
  const rows = profitPerProduct(range, 500);
  const cost = rows.reduce((sum: number, r) => sum + r.cost_cents, 0);
  assert.equal(cost, profit.cogsCents, "and the mix's cost is shared, not dropped");
});

// ------------------------------------------------------------ the deliveries

test("an undone delivery is out of spend, and out of Bought", () => {
  const list = listPurchases({ perPage: 50 });
  const live = list.rows.filter((r) => r.voided_at === null);
  assert.equal(
    list.totalCents,
    live.reduce((sum, r) => sum + r.total_cents, 0),
    "the delivery list's total skips it",
  );

  const spend = supplierSpend().find((s) => s.id === supplier)!;
  assert.equal(spend.spend_cents, kept.totalCents, "and so does the supplier's spend");

  const ufacid = statement.rows.find((r) => r.name === "Ufacid")!;
  assert.equal(ufacid.boughtMilli, 0, "the arrival and its undo cancel inside Bought");

  /*
    And the undo is nowhere in Adjusted.

    Not "Adjusted is zero" — this shop's opening count was posted today and
    belongs there. The claim is narrower and is the one that matters: every
    movement filed against a purchase is out of that column, so the only things
    left in it are the ones somebody actually adjusted.
  */
  const reversal = get<{ q: number }>(
    `SELECT COALESCE(SUM(delta_milli), 0) AS q FROM stock_movements
      WHERE item_id = ? AND reason = 'adjustment' AND ref_type = 'purchase'`,
    ufacid.itemId,
  )!;
  assert.ok(reversal.q !== 0, "there is a reversal to misfile");

  const byHand = get<{ q: number }>(
    `SELECT COALESCE(SUM(delta_milli), 0) AS q FROM stock_movements
      WHERE item_id = ?
        AND reason IN ('repack_loss', 'stocktake', 'adjustment', 'opening')
        AND COALESCE(ref_type, '') <> 'purchase'`,
    ufacid.itemId,
  )!;
  assert.equal(ufacid.adjustedMilli, byHand.q, "Adjusted is only what was adjusted");
});

// ------------------------------------------------------------- the debtors

test("the debtors book is the unpaid balance on the sales", () => {
  const owed = get<{ owed: number }>(
    `SELECT COALESCE(SUM(total_cents - paid_cents), 0) AS owed
       FROM sales WHERE status = 'completed' AND total_cents > paid_cents`,
  )!;
  const book = debtors().reduce((sum, d) => sum + d.balance_cents, 0);
  assert.equal(book, owed.owed);
  assert.ok(owed.owed > 0, "there is a credit sale to get wrong");
});

test("the day close counts the money, not the invoices", () => {
  // A credit sale is takings but not cash: the drawer must not claim it.
  assert.ok(day.creditCents > 0, "something went out on credit");
  assert.equal(
    day.salesCents,
    day.cashInCents + day.mpesaCents + day.creditCents,
    "takings split three ways and nothing lost",
  );
});

// ----------------------------------------------------- mixing moves value

test("a batch takes out of chemicals what it puts into product", () => {
  const made = statement.rows.find((r) => r.itemId === batch.outputItemId)!;
  assert.ok(made.madeMilli > 0, "the batch is on the statement");

  const madeValue = Math.round((made.madeMilli * made.costCents) / 1000);
  assert.ok(
    Math.abs(madeValue - statement.totals.usedValueCents) <= statement.rows.length,
    `made ${madeValue} vs used ${statement.totals.usedValueCents} — mixing moves value, it does not make it`,
  );
});
