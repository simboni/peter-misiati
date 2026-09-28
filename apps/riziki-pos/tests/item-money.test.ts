/**
 * The money behind one chemical: the cost trail, the price trail, the earnings.
 *
 * The shop's own question, and the one this has to get right: a drum is bought
 * at one price, half of it is sold, the next drum costs something else. What is
 * the shelf worth now, what will the next sale be costed at, and what happened
 * to the sales already made? Then the same from the other side — the asking
 * price moves while the same stock is still on the floor.
 *
 * Every figure below has to match what the tills and the reports use, because
 * the screen these feed is the one an owner will hold up to a supplier.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-item-money-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, all, run, stockOf, postMovement } = await import("../src/lib/db.ts");
const { createSupplier, recordPurchase, replayCost } = await import("../src/lib/purchasing.ts");
const { recordSale } = await import("../src/lib/sales.ts");
const { applyPrices } = await import("../src/lib/pricing.ts");
const money = await import("../src/lib/item-money.ts");

seed();

/** A clean shelf, so every figure below is one this file put there. */
for (const it of all<{ id: number }>(`SELECT id FROM items WHERE active = 1`)) {
  const q = stockOf(it.id);
  if (q !== 0) postMovement({ itemId: it.id, deltaMilli: -q, reason: "stocktake", userId: 1 });
  run(`UPDATE items SET cost_cents = 0 WHERE id = ?`, it.id);
}

const ungerol = get<{ id: number }>(`SELECT id FROM items WHERE name = 'Ungerol'`)!;
run(`UPDATE items SET price_cents = 51300, floor_cents = 30000, ceiling_cents = 80000 WHERE id = ?`, ungerol.id);
const supplier = createSupplier({ name: "Chemi Traders Ltd" }, 1);

/** One 250 kg drum, at a supplier price plus a lorry. */
function drum(goodsCents: number, transportCents: number, ref: string) {
  return recordPurchase({
    supplierId: supplier,
    ref,
    transportCents,
    lines: [{ itemId: ungerol.id, units: 1, sizeMilli: 250000, costCents: goodsCents }],
    userId: 1,
  });
}

function sell(tag: string, qtyMilli: number) {
  const price = get<{ price_cents: number }>(`SELECT price_cents FROM items WHERE id = ?`, ungerol.id)!;
  return recordSale({
    clientUuid: tag,
    userId: 1,
    tier: "retail",
    lines: [{ itemId: ungerol.id, units: 1, qtyMilli, unitPriceCents: price.price_cents }],
    tenders: [{ method: "cash", amountCents: Math.round((price.price_cents * qtyMilli) / 1000) }],
  });
}

/*
  The story runs in order, a step to a test.

  `node:test` collects every test before it runs any of them, so a purchase
  written at module scope would already have happened by the time the first
  assertion looked at it — and the whole point here is what each figure was
  BETWEEN two deliveries.
*/

// ------------------------------------------------------- the first drum

test("transport is part of what a delivery landed at", () => {
  drum(7800000, 200000, "INV-5501"); // 78,000 + 2,000 over 250 kg = 320.00/kg
  const [first] = money.deliveriesOf(ungerol.id);
  assert.equal(first.inCents, 8000000, "78,000 at the supplier plus a 2,000 lorry");
  assert.equal(first.inRateCents, 32000, "KES 320.00 a kilo, not KES 312.00");
  assert.equal(first.deliveryTransportCents, 200000);
});

test("an arrival onto an empty shelf is its own cost", () => {
  const [first] = money.deliveriesOf(ungerol.id);
  assert.equal(first.heldMilli, 0);
  assert.equal(first.costBeforeCents, 0);
  assert.equal(first.costAfterCents, 32000);
});

test("the shelf is valued at cost, which is money held and not money made", () => {
  const head = money.itemHead(ungerol.id)!;
  assert.equal(head.heldMilli, 250000);
  assert.equal(head.costCents, 32000);
  assert.equal(head.stockValueCents, 8000000, "250 kg at KES 320.00");
  assert.equal(head.unitProfitCents, 51300 - 32000);
  assert.ok(Math.abs(head.marginPct - 37.62) < 0.01);
  assert.equal(head.underwater, false);
});

// ------------------------------------------------- sold, then a dearer drum

let saleAId = 0;

test("a sale freezes what it cost, and the trail agrees with it", () => {
  saleAId = sell("money-a", 90000).saleId;
  const [line] = money.soldLinesOf(ungerol.id);
  assert.equal(line.saleId, saleAId);
  assert.equal(line.costRateCents, 32000);
  assert.equal(line.revenueCents, 4617000);
  assert.equal(line.costCents, 2880000);
  assert.equal(line.profitCents, 1737000);
});

test("the next drum blends into what was left, and only from there on", () => {
  drum(9500000, 300000, "INV-5622"); // 95,000 + 3,000 over 250 kg = 392.00/kg
  const [newest] = money.deliveriesOf(ungerol.id);
  assert.equal(newest.inRateCents, 39200, "the drum itself landed at KES 392.00");
  assert.equal(newest.heldMilli, 160000, "160 kg was still on the shelf");
  assert.equal(newest.costBeforeCents, 32000);
  // (160 × 320.00 + 98,000) ÷ 410 = 363.90
  assert.equal(newest.costAfterCents, 36390);
});

test("the sale made before it has not moved", () => {
  const [line] = money.soldLinesOf(ungerol.id);
  assert.equal(line.costRateCents, 32000, "still costed at the drum it actually came out of");
  assert.equal(line.profitCents, 1737000);
});

test("the trail is the same arithmetic the cost repair uses", () => {
  // If these two ever disagree, the screen is showing a number the tills are
  // not charging against — which is the whole reason the replay is shared.
  const head = money.itemHead(ungerol.id)!;
  assert.equal(replayCost(ungerol.id).finalCents, head.costCents);
});

test("the same price to the customer earns less once the blend has moved", () => {
  const saleBId = sell("money-b", 90000).saleId;
  const [newest, older] = money.soldLinesOf(ungerol.id);
  assert.equal(newest.saleId, saleBId);
  assert.equal(newest.rateCents, older.rateCents, "the customer paid the same");
  assert.equal(newest.costRateCents, 36390);
  assert.ok(newest.profitCents < older.profitCents);
  assert.equal(older.profitCents - newest.profitCents, 395100, "KES 3,951.00 of it");
});

// ------------------------------------------------------- the asking price

test("putting the price up moves no stock and rewrites no sale", () => {
  const before = money.itemHead(ungerol.id)!;
  applyPrices([{ itemId: ungerol.id, price: 560 }], 1, { source: "admin" });
  const after = money.itemHead(ungerol.id)!;

  assert.equal(after.heldMilli, before.heldMilli, "the same kilos");
  assert.equal(after.costCents, before.costCents, "at the same cost");
  assert.equal(after.stockValueCents, before.stockValueCents);
  assert.equal(after.priceCents, 56000, "only what the next customer pays changed");

  const [newest] = money.soldLinesOf(ungerol.id);
  assert.equal(newest.rateCents, 51300, "sale B was rung at the old price and still says so");
});

test("the new price and the old cost make the third sale", () => {
  const saleC = sell("money-c", 90000);
  const [line] = money.soldLinesOf(ungerol.id);
  assert.equal(line.saleId, saleC.saleId);
  assert.equal(line.rateCents, 56000);
  assert.equal(line.costRateCents, 36390, "the same stock, costed the same");
});

// ---------------------------------------------------------- what it earned

test("earnings add up to the sales underneath them", () => {
  const e = money.earningsOf(ungerol.id, 30);
  const lines = money.soldLinesOf(ungerol.id, 50);
  assert.equal(e.saleCount, 3);
  assert.equal(e.qtyMilli, 270000);
  assert.equal(e.revenueCents, lines.reduce((n, l) => n + l.revenueCents, 0));
  assert.equal(e.costCents, lines.reduce((n, l) => n + l.costCents, 0));
  assert.equal(e.profitCents, e.revenueCents - e.costCents);
  assert.equal(e.estimatedCents, 0, "every line carried its own cost");
});

test("the spread of what it actually went out at is reported", () => {
  const e = money.earningsOf(ungerol.id, 30);
  assert.equal(e.lowRateCents, 51300);
  assert.equal(e.highRateCents, 56000);
});

// --------------------------------------------------- when nobody wrote a cost

test("a sale with no cost of its own is valued at today's, and said so", () => {
  const flakes = get<{ id: number }>(`SELECT id FROM items WHERE name LIKE 'Flakes%' OR name LIKE 'FLAKES%'`)
    ?? get<{ id: number }>(`SELECT id FROM items WHERE canonical_unit = 'kg' AND id <> ?`, ungerol.id)!;
  run(`UPDATE items SET price_cents = 40000, cost_cents = 0 WHERE id = ?`, flakes.id);
  postMovement({ itemId: flakes.id, deltaMilli: 100000, reason: "stocktake", userId: 1 });
  recordSale({
    clientUuid: "money-uncosted",
    userId: 1,
    tier: "retail",
    lines: [{ itemId: flakes.id, units: 1, qtyMilli: 10000, unitPriceCents: 40000 }],
    tenders: [{ method: "cash", amountCents: 400000 }],
  });

  // Nothing was known when it sold; a cost is entered afterwards.
  run(`UPDATE items SET cost_cents = 25000 WHERE id = ?`, flakes.id);

  const e = money.earningsOf(flakes.id, 30);
  assert.equal(e.costCents, 250000, "10 kg valued at today's KES 250.00");
  assert.equal(e.estimatedCents, 250000, "and every cent of it reported as an estimate");
});

test("a product priced at or under its cost is called out", () => {
  const head = money.itemHead(ungerol.id)!;
  assert.equal(head.underwater, false);

  run(`UPDATE items SET cost_cents = 60000 WHERE id = ?`, ungerol.id);
  const sunk = money.itemHead(ungerol.id)!;
  assert.equal(sunk.underwater, true, "asking 560, costing 600");
  assert.equal(sunk.unitProfitCents, -4000);
});
