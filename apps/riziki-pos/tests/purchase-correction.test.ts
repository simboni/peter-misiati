/**
 * Putting right what a delivery was charged.
 *
 * A price left blank or a nought missed used to be permanent, and the cost it
 * produced went on deciding the profit on every sale of that chemical
 * afterwards. What has to be true: the money changes, the quantities do not,
 * and the cost price comes out as though the right figure had been typed in the
 * first place — including when a later delivery and some sales have already
 * blended into it.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "fix-")), "t.db");

import test from "node:test";
import assert from "node:assert/strict";
const { seed } = await import("../src/lib/seed.ts");
const { get, all, run, stockOf } = await import("../src/lib/db.ts");
const { createProduct } = await import("../src/lib/catalog.ts");
const { recordPurchase, correctPurchasePrices, recomputeCost } = await import(
  "../src/lib/purchasing.ts"
);
const { recordSale } = await import("../src/lib/sales.ts");

seed();
const OWNER = 1;
const costOf = (id: number) =>
  get<{ cost_cents: number }>(`SELECT cost_cents FROM items WHERE id = ?`, id)!.cost_cents;

const item = createProduct({ name: "Fix Caustic", unit: "kg", containerValue: 25,
  containerLabel: "bag", price: 220, floor: 0, ceiling: 0, aliases: "", byUserId: OWNER });
const other = createProduct({ name: "Fix Ungerol", unit: "kg", containerValue: 20,
  containerLabel: "drum", price: 500, floor: 0, ceiling: 0, aliases: "", byUserId: OWNER });

test("a delivery recorded with NO price leaves the cost at nothing", () => {
  const res = recordPurchase({
    supplierId: null,
    lines: [{ itemId: item, units: 2, sizeMilli: 25_000, costCents: 0 }],
    userId: OWNER,
  });
  assert.equal(stockOf(item), 50_000, "50 kg arrived all the same");
  assert.equal(costOf(item), 0, "and it is on the books as costing nothing");
  void res;
});

test("correcting the price fixes the cost, and moves no stock", () => {
  const p = all<{ id: number }>(`SELECT id FROM purchases ORDER BY id DESC LIMIT 1`)[0];
  const line = all<{ id: number }>(`SELECT id FROM purchase_lines WHERE purchase_id = ?`, p.id)[0];
  const movesBefore = all(`SELECT id FROM stock_movements WHERE item_id = ?`, item).length;

  const res = correctPurchasePrices(p.id, { lines: [{ lineId: line.id, costCents: 900_000 }] }, OWNER);

  assert.equal(stockOf(item), 50_000, "the same drums arrived either way");
  assert.equal(
    all(`SELECT id FROM stock_movements WHERE item_id = ?`, item).length,
    movesBefore,
    "and not one ledger entry was written or rewritten",
  );
  assert.equal(costOf(item), 18_000, "9,000 over 50 kg is 180.00 a kilogramme");
  assert.equal(res.totalCents, 900_000);
  assert.equal(res.repriced[0].costCents, 18_000);
});

test("it holds when a later delivery and sales have blended in already", () => {
  // A second delivery at a different rate, then a sale, then correct the FIRST.
  recordPurchase({
    supplierId: null,
    lines: [{ itemId: item, units: 2, sizeMilli: 25_000, costCents: 1_100_000 }],
    userId: OWNER,
  });
  // 50 kg at 180 + 50 kg at 220 = 200.00
  assert.equal(costOf(item), 20_000, "the running average after the second delivery");

  recordSale({
    clientUuid: `fix-${Math.random()}`,
    lines: [{ itemId: item, units: 1, qtyMilli: 30_000, unitPriceCents: 22_000 }],
    tenders: [{ method: "cash", amountCents: 660_000 }],
    userId: OWNER,
    tier: "retail",
  } as never);
  assert.equal(stockOf(item), 70_000, "100 kg in, 30 kg out");
  assert.equal(costOf(item), 20_000, "selling does not change what a kilogramme cost");

  // Now correct the FIRST delivery: it was really 8,000, not 9,000.
  const first = all<{ id: number }>(`SELECT id FROM purchases ORDER BY id LIMIT 1`)[0];
  const firstLine = all<{ id: number }>(
    `SELECT id FROM purchase_lines WHERE purchase_id = ?`, first.id)[0];
  correctPurchasePrices(first.id, { lines: [{ lineId: firstLine.id, costCents: 800_000 }] }, OWNER);

  // Replayed: 50 kg at 160.00, then 50 kg at 220.00 blended against 50 held
  // => (50×16000 + 1_100_000)/100 = (800000 + 1100000)/100 = 19_000.
  assert.equal(costOf(item), 19_000, "as though 8,000 had been typed in the first place");
  assert.equal(stockOf(item), 70_000, "and the shelf is untouched");
});

test("transport is spread again across the whole delivery, not left as it was", () => {
  const res = recordPurchase({
    supplierId: null,
    transportCents: 100_000,
    lines: [
      { itemId: item, units: 1, sizeMilli: 25_000, costCents: 800_000 },
      { itemId: other, units: 1, sizeMilli: 20_000, costCents: 1_200_000 },
    ],
    userId: OWNER,
  });
  const lines = all<{ id: number; item_id: number; cost_cents: number }>(
    `SELECT id, item_id, cost_cents FROM purchase_lines WHERE purchase_id = ? ORDER BY id`,
    res.purchaseId,
  );
  assert.equal(lines[0].cost_cents, 840_000, "8/20 of the transport");
  assert.equal(lines[1].cost_cents, 1_260_000, "12/20 of it");

  // The first line was really 18,000, not 8,000 — so it should now carry
  // 18/30 of the transport, and the other line only 12/30.
  const fixed = correctPurchasePrices(
    res.purchaseId,
    { lines: [{ lineId: lines[0].id, costCents: 1_800_000 }] },
    OWNER,
  );
  const after = all<{ cost_cents: number }>(
    `SELECT cost_cents FROM purchase_lines WHERE purchase_id = ? ORDER BY id`,
    res.purchaseId,
  );
  assert.equal(fixed.goodsCents, 3_000_000, "18,000 + 12,000");
  assert.equal(fixed.totalCents, 3_100_000, "and the transport still rides on top once");
  assert.equal(after[0].cost_cents, 1_860_000, "18,000 + 18/30 of 1,000 = 600");
  assert.equal(after[1].cost_cents, 1_240_000, "12,000 + 12/30 = 400");
  assert.equal(
    after[0].cost_cents + after[1].cost_cents,
    fixed.totalCents,
    "the lines still reconcile to the whole bill",
  );
});

test("recomputing is self-healing — it fixes a cost nobody can explain", () => {
  run(`UPDATE items SET cost_cents = 999999 WHERE id = ?`, other);
  assert.equal(costOf(other), 999_999, "a figure from nowhere");
  const back = recomputeCost(other);
  assert.equal(back, 62_000, "1,240,000 landed over 20 kg");
  assert.equal(costOf(other), 62_000, "and the item carries it again");
});

test("an item with no priced arrivals keeps the cost it was given", () => {
  const counted = createProduct({ name: "Fix Opening", unit: "kg", containerValue: 25,
    containerLabel: "bag", price: 100, floor: 0, ceiling: 0, aliases: "", byUserId: OWNER });
  run(`UPDATE items SET cost_cents = 7500 WHERE id = ?`, counted);
  run(`INSERT INTO stock_movements (item_id, delta_milli, reason, user_id)
       VALUES (?, 40000, 'stocktake', ?)`, counted, OWNER);
  assert.equal(recomputeCost(counted), 7_500, "a stock take is a count, not a price");
});

test("a wrong count of drums is corrected by its own entry, not by a rewrite", () => {
  const drum = createProduct({ name: "Fix Ufacid", unit: "kg", containerValue: 250,
    containerLabel: "drum", price: 180, floor: 0, ceiling: 0, aliases: "", byUserId: OWNER });

  // Three drums booked; only two came.
  const res = recordPurchase({
    supplierId: null,
    lines: [{ itemId: drum, units: 3, sizeMilli: 250_000, costCents: 4_500_000 }],
    userId: OWNER,
  });
  assert.equal(stockOf(drum), 750_000, "three drums went on the shelf");
  assert.equal(costOf(drum), 6_000, "45,000 over 750 kg is 60.00 a kilogramme");

  const line = all<{ id: number }>(
    `SELECT id FROM purchase_lines WHERE purchase_id = ?`, res.purchaseId)[0];
  const movesBefore = all(`SELECT id FROM stock_movements WHERE item_id = ?`, drum).length;

  correctPurchasePrices(
    res.purchaseId,
    { lines: [{ lineId: line.id, costCents: 3_000_000, units: 2 }] },
    OWNER,
  );

  assert.equal(stockOf(drum), 500_000, "two drums, not three");
  const moves = all<{ delta_milli: number; reason: string; note: string | null }>(
    `SELECT delta_milli, reason, note FROM stock_movements WHERE item_id = ? ORDER BY id`, drum);
  assert.equal(moves.length, movesBefore + 1, "one new entry, and the first one untouched");
  assert.equal(moves[0].delta_milli, 750_000, "what was originally posted still says so");
  assert.equal(moves[1].delta_milli, -250_000, "and the correction is its own row");
  assert.equal(moves[1].reason, "adjustment");
  assert.match(moves[1].note ?? "", /delivery corrected/);

  assert.equal(costOf(drum), 6_000, "30,000 over 500 kg is still 60.00 a kilogramme");

  const row = get<{ units: number; qty_milli: number; cost_cents: number }>(
    `SELECT units, qty_milli, cost_cents FROM purchase_lines WHERE id = ?`, line.id)!;
  assert.equal(row.units, 2, "and the delivery note and the record now agree");
  assert.equal(row.qty_milli, 500_000);
  assert.equal(row.cost_cents, 3_000_000);
});
