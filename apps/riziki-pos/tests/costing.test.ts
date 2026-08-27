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
const { get, run, stockOf, updateAverageCost } = await import("../src/lib/db.ts");
const { recordSale } = await import("../src/lib/sales.ts");
const { recordPurchase } = await import("../src/lib/purchasing.ts");
const { toMilli } = await import("../src/lib/units.ts");

seed();

const OWNER = 1;

interface Row {
  id: number;
  size_milli: number;
  cost_cents: number;
  price_cents: number;
}

function chemical(name: string): Row {
  const row = get<Row>(
    `SELECT i.id, i.size_milli, i.cost_cents, i.price_cents
       FROM items i JOIN chemicals c ON c.id = i.chemical_id
      WHERE c.name = ? AND i.price_basis = 'unit'`,
    name,
  );
  assert.ok(row, `${name} should have a unit-priced row`);
  return row!;
}

test("a weighed line carries its share of the drum's cost, not a whole drum's", () => {
  const ungerol = chemical("Ungerol");
  assert.ok(ungerol.cost_cents > 0, "the seed lands a cost per kilogram from the delivery price");

  const { saleId } = recordSale({
    clientUuid: "cost-weighed-1",
    userId: OWNER,
    tier: "retail",
    lines: [
      { itemId: ungerol.id, units: 1, unitPriceCents: ungerol.price_cents, qtyMilli: toMilli(0.25) },
    ],
    tenders: [{ method: "cash", amountCents: Math.round((ungerol.price_cents * 250) / 1000) }],
  });

  const line = get<{ cost_cents: number; qty_milli: number; rate_cents: number }>(
    `SELECT cost_cents, qty_milli, rate_cents FROM sale_lines WHERE sale_id = ?`,
    saleId,
  )!;

  assert.equal(line.qty_milli, 250);
  assert.equal(line.rate_cents, ungerol.price_cents, "the rate is snapshotted, not the amount");

  /*
    cost_cents on the item is the cost of ONE KILOGRAM. A quarter kilogram
    carries a quarter of it and nothing more — booking a whole drum's cost
    against a 250 g sale is how a margin report turns into fiction.

    Per kilogram rather than per drum because Ufacid arrives in 250 kg drums and
    in 200 kg drums: an average "cost of a drum" across two different drums is
    the cost of nothing at all.
  */
  const expected = Math.round((ungerol.cost_cents * 250) / 1000);
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
    lines: [{ itemId: caustic.id, units: 1, unitPriceCents: caustic.price_cents, qtyMilli: 1500 }],
    tenders: [{ method: "cash", amountCents: Math.round((caustic.price_cents * 1500) / 1000) }],
  });

  assert.equal(stockOf(caustic.id), before - 1500, "1.5 kg, to the gram");
});

test("a delivery moves the average cost, and the next sale is costed at the new one", () => {
  const salt = chemical("Salt");
  const before = salt.cost_cents;

  // One more kilogram, bought at twice the going rate. The weighted average is
  // per kilogram, which is what makes the fraction taken by a weighed line
  // meaningful when drums come in more than one size.
  updateAverageCost(salt.id, 1000, before * 2);
  const after = get<Row>(`SELECT id, size_milli, cost_cents, price_cents FROM items WHERE id = ?`, salt.id)!;
  assert.ok(after.cost_cents > before, "buying dearer raises the average");

  const { saleId } = recordSale({
    clientUuid: "cost-weighed-3",
    userId: OWNER,
    tier: "retail",
    lines: [{ itemId: salt.id, units: 1, unitPriceCents: after.price_cents, qtyMilli: toMilli(2) }],
    tenders: [{ method: "cash", amountCents: Math.round((after.price_cents * 2000) / 1000) }],
  });

  const line = get<{ cost_cents: number }>(
    `SELECT cost_cents FROM sale_lines WHERE sale_id = ?`,
    saleId,
  )!;
  assert.equal(line.cost_cents, Math.round((after.cost_cents * 2000) / 1000));
});

test("a container is priced per piece the same way a chemical is priced per kilo", () => {
  /*
    A jerrican is not a different kind of thing from a drum of caustic — only a
    different unit. It is priced per piece, sold in pieces, and costed the same
    way: three pieces out of the shelf take three pieces' worth of money with
    them. The only visible difference is that its unit happens to be countable.
  */
  const jerrican = get<Row>(
    `SELECT id, size_milli, cost_cents, price_cents FROM items
      WHERE kind = 'packaging' AND cost_cents > 0 ORDER BY id LIMIT 1`,
  )!;
  assert.ok(jerrican, "the seed stocks containers");

  const { saleId } = recordSale({
    clientUuid: "cost-whole-1",
    userId: OWNER,
    tier: "retail",
    lines: [
      { itemId: jerrican.id, units: 1, unitPriceCents: jerrican.price_cents, qtyMilli: toMilli(3) },
    ],
    tenders: [{ method: "cash", amountCents: jerrican.price_cents * 3 }],
  });

  const line = get<{
    cost_cents: number;
    rate_cents: number;
    qty_milli: number;
    line_total_cents: number;
  }>(
    `SELECT cost_cents, rate_cents, qty_milli, line_total_cents FROM sale_lines WHERE sale_id = ?`,
    saleId,
  )!;
  assert.equal(line.qty_milli, toMilli(3), "three pieces");
  assert.equal(line.rate_cents, jerrican.price_cents, "the rate is the price of one piece");
  assert.equal(line.line_total_cents, jerrican.price_cents * 3);
  assert.equal(line.cost_cents, jerrican.cost_cents * 3);
});

// ------------------------------------------- when a drum is not always a drum

test("a delivery books the drum size it actually came in", () => {
  /*
    Ufacid comes in 250 kg drums and in 200 kg drums.

    The item carries one usual size, and until the size moved onto the delivery
    line, three of the smaller drums were multiplied by the larger size: the
    ledger gained 750 kg where 600 kg had arrived, and nothing on any screen
    said so. Stock that is 150 kg wrong is stock the counter will happily sell.
  */
  const ufacid = chemical("Ufacid");
  const usual = ufacid.size_milli;
  assert.ok(usual > 0, "the seed gives it a usual drum");

  const before = stockOf(ufacid.id);
  recordPurchase({
    supplierId: null,
    lines: [{ itemId: ufacid.id, units: 3, sizeMilli: 200_000, costCents: 6_000_000 }],
    userId: OWNER,
  });

  assert.equal(stockOf(ufacid.id) - before, 600_000, "three 200 kg drums, not three usual ones");

  const line = get<{ units: number; size_milli: number; qty_milli: number }>(
    `SELECT units, size_milli, qty_milli FROM purchase_lines ORDER BY id DESC LIMIT 1`,
  )!;
  assert.equal(line.units, 3);
  assert.equal(line.size_milli, 200_000, "the delivery remembers what one drum held");
  assert.equal(line.qty_milli, 600_000);
  assert.equal(
    get<{ size_milli: number }>(`SELECT size_milli FROM items WHERE id = ?`, ufacid.id)!.size_milli,
    usual,
    "and the substance's usual drum is left alone",
  );
});

test("a delivery with no size given falls back to the usual drum", () => {
  const caustic = chemical("Caustic Soda");
  const before = stockOf(caustic.id);

  recordPurchase({
    supplierId: null,
    lines: [{ itemId: caustic.id, units: 2, costCents: 1_000_000 }],
    userId: OWNER,
  });

  assert.equal(
    stockOf(caustic.id) - before,
    2 * caustic.size_milli,
    "an ordinary delivery still needs nothing typed",
  );
});

test("two drum sizes average to one honest cost per kilogram", () => {
  /*
    The reason cost is held per kilogram and not per container.

    100 kg at KES 100/kg and then 100 kg at KES 200/kg is KES 150/kg, whatever
    shape the containers were. Averaged per container instead, a 100 kg drum and
    a 50 kg drum would each count once and the answer would depend on packaging.
  */
  // A shelf of its own: the ledger is append-only, so a clean slate means a new
  // row rather than deleting somebody else's history.
  const { lastInsertRowid } = run(
    `INSERT INTO items (name, kind, canonical_unit, size_milli, unit_label,
                        sellable, price_basis, price_cents, cost_cents)
     VALUES ('Test Two Drums', 'bulk', 'kg', 100000, 'drum', 1, 'unit', 20000, 0)`,
  );
  const id = Number(lastInsertRowid);

  recordPurchase({
    supplierId: null,
    lines: [{ itemId: id, units: 1, sizeMilli: 100_000, costCents: 1_000_000 }],
    userId: OWNER,
  });
  assert.equal(
    get<{ cost_cents: number }>(`SELECT cost_cents FROM items WHERE id = ?`, id)!.cost_cents,
    10_000,
    "KES 10,000 for 100 kg is KES 100 a kilo",
  );

  // The same weight again, in two smaller drums, at twice the money.
  recordPurchase({
    supplierId: null,
    lines: [{ itemId: id, units: 2, sizeMilli: 50_000, costCents: 2_000_000 }],
    userId: OWNER,
  });
  assert.equal(
    get<{ cost_cents: number }>(`SELECT cost_cents FROM items WHERE id = ?`, id)!.cost_cents,
    15_000,
    "200 kg for KES 30,000 is KES 150 a kilo, whatever it arrived in",
  );
});
