/**
 * Costing: what a weighed sale line is worth to the shop.
 *
 * This used to test bottling — a batch's reagent cost plus its packaging,
 * divided over the bottles it filled. The shop stopped mixing and bottling, so
 * the only costing question left is the one that matters at the counter: when
 * 250 g comes out of a drum, how much of the drum's money went with it.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "cf-")), "t.db");

import test from "node:test";
import assert from "node:assert/strict";
const { seed } = await import("../src/lib/seed.ts");
const { get, stockOf, updateAverageCost } = await import("../src/lib/db.ts");
const { recordSale } = await import("../src/lib/sales.ts");
const { toMilli } = await import("../src/lib/units.ts");

seed();

const OWNER = 1;

interface Row {
  id: number;
  size_milli: number;
  cost_cents: number;
  retail_cents: number;
}

function chemical(name: string): Row {
  const row = get<Row>(
    `SELECT i.id, i.size_milli, i.cost_cents, i.retail_cents
       FROM items i JOIN chemicals c ON c.id = i.chemical_id
      WHERE c.name = ? AND i.price_basis = 'unit'`,
    name,
  );
  assert.ok(row, `${name} should have a unit-priced row`);
  return row!;
}

test("a weighed line carries its share of the drum's cost, not a whole drum's", () => {
  const ungerol = chemical("Ungerol");
  assert.ok(ungerol.cost_cents > 0, "the seed lands a cost per drum from the delivery price");

  const { saleId } = recordSale({
    clientUuid: "cost-weighed-1",
    userId: OWNER,
    tier: "retail",
    lines: [
      { itemId: ungerol.id, units: 1, unitPriceCents: ungerol.retail_cents, qtyMilli: toMilli(0.25) },
    ],
    tenders: [{ method: "cash", amountCents: Math.round((ungerol.retail_cents * 250) / 1000) }],
  });

  const line = get<{ cost_cents: number; qty_milli: number; rate_cents: number }>(
    `SELECT cost_cents, qty_milli, rate_cents FROM sale_lines WHERE sale_id = ?`,
    saleId,
  )!;

  assert.equal(line.qty_milli, 250);
  assert.equal(line.rate_cents, ungerol.retail_cents, "the rate is snapshotted, not the amount");

  // cost_cents on the item is per ONE container. A quarter kilogram out of a
  // 170 kg drum carries 250/170000 of it, and nothing more — booking a whole
  // drum's cost against a 250 g sale is how a margin report turns into fiction.
  const expected = Math.round((ungerol.cost_cents * 250) / ungerol.size_milli);
  assert.equal(line.cost_cents, expected);
  assert.ok(expected > 0, "and it is not rounded away to nothing");
});

test("selling by weight takes exactly that weight out of the ledger", () => {
  const caustic = chemical("Caustic Soda");
  const before = stockOf(caustic.id);

  recordSale({
    clientUuid: "cost-weighed-2",
    userId: OWNER,
    tier: "retail",
    lines: [{ itemId: caustic.id, units: 1, unitPriceCents: caustic.retail_cents, qtyMilli: 1500 }],
    tenders: [{ method: "cash", amountCents: Math.round((caustic.retail_cents * 1500) / 1000) }],
  });

  assert.equal(stockOf(caustic.id), before - 1500, "1.5 kg, to the gram");
});

test("a delivery moves the average cost, and the next sale is costed at the new one", () => {
  const salt = chemical("Salt");
  const before = salt.cost_cents;

  // One more container, bought dearer. The weighted average is per container,
  // which is what makes the fraction taken by a weighed line meaningful.
  updateAverageCost(salt.id, 1, before * 2);
  const after = get<Row>(`SELECT id, size_milli, cost_cents, retail_cents FROM items WHERE id = ?`, salt.id)!;
  assert.ok(after.cost_cents > before, "buying dearer raises the average");

  const { saleId } = recordSale({
    clientUuid: "cost-weighed-3",
    userId: OWNER,
    tier: "retail",
    lines: [{ itemId: salt.id, units: 1, unitPriceCents: after.retail_cents, qtyMilli: toMilli(2) }],
    tenders: [{ method: "cash", amountCents: Math.round((after.retail_cents * 2000) / 1000) }],
  });

  const line = get<{ cost_cents: number }>(
    `SELECT cost_cents FROM sale_lines WHERE sale_id = ?`,
    saleId,
  )!;
  assert.equal(line.cost_cents, Math.round((after.cost_cents * 2000) / after.size_milli));
});

test("something sold whole still costs one container per unit", () => {
  const jerrican = get<Row>(
    `SELECT id, size_milli, cost_cents, retail_cents FROM items
      WHERE kind = 'packaging' AND cost_cents > 0 ORDER BY id LIMIT 1`,
  )!;
  assert.ok(jerrican, "the seed stocks containers");

  const { saleId } = recordSale({
    clientUuid: "cost-whole-1",
    userId: OWNER,
    tier: "retail",
    lines: [{ itemId: jerrican.id, units: 3, unitPriceCents: jerrican.retail_cents }],
    tenders: [{ method: "cash", amountCents: jerrican.retail_cents * 3 }],
  });

  const line = get<{ cost_cents: number; rate_cents: number; units: number }>(
    `SELECT cost_cents, rate_cents, units FROM sale_lines WHERE sale_id = ?`,
    saleId,
  )!;
  assert.equal(line.units, 3);
  assert.equal(line.rate_cents, 0, "nothing was weighed, so there is no rate to snapshot");
  assert.equal(line.cost_cents, jerrican.cost_cents * 3);
});
