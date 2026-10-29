/**
 * The "no cost price" row on the attention panel, and why it would not go away.
 *
 * The shop reported two things about it and both were real.
 *
 * ONE PRODUCT LOOKED LIKE FOUR. The list grouped by the name printed on the
 * receipt, so a product sold loose and in three jerrican sizes arrived as four
 * rows — "Ocean breeze mild", "— 5 L bundle", "— 500 ml bundle", "— 250 ml
 * bundle" — which is one product and one missing cost price.
 *
 * AND "I HAVE CORRECTED THIS" DID NOT STICK. A dismissal holds only while the
 * row goes on saying what it said when it was set aside. The sentence carried
 * a running shilling total, so the next sale of that same product changed it
 * and the row came back. For something sold daily that is the next morning,
 * every morning.
 *
 * Underneath both: the advice was "record what those goods cost on the
 * delivery", which cannot be done for a product the shop mixes and cannot be
 * done at all for one that is neither bought nor made. There is no box that
 * sets a cost price by hand, on purpose.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-attention-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, run } = await import("../src/lib/db.ts");
const { businessDate } = await import("../src/lib/units.ts");
const { saveBundles, itemBundles } = await import("../src/lib/bundles.ts");
const { recordSale } = await import("../src/lib/sales.ts");
const { attentionDetail, namesSaid } = await import("../src/lib/dashboard.ts");
const { fingerprint, isDismissed, dismiss, activeDismissals } = await import(
  "../src/lib/dismissals.ts"
);
const { createSupplier, recordPurchase } = await import("../src/lib/purchasing.ts");

seed({ openingStock: false });
const TODAY = businessDate();
const DAY = { from: TODAY, to: TODAY };

function product(name: string, kind: string, priceCents: number) {
  run(
    `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, price_basis, price_cents, cost_cents, packed)
     VALUES (NULL, ?, ?, 'L', 1000, 'L', 1, 'unit', ?, 0, 1)`,
    name,
    kind,
    priceCents,
  );
  const id = get<{ id: number }>(`SELECT id FROM items WHERE name = ?`, name)!.id;
  run(
    `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id, note)
     VALUES (?, 500000, 'opening', 1, 'count')`,
    id,
  );
  return id;
}

let n = 0;
const loose = (itemId: number, qtyMilli: number, rateCents: number) =>
  recordSale({
    clientUuid: `a-${++n}`,
    userId: 1,
    tier: "retail",
    lines: [{ itemId, units: 1, qtyMilli, unitPriceCents: rateCents }],
    tenders: [{ method: "cash", amountCents: Math.round((rateCents * qtyMilli) / 1000) }],
  });
const bundled = (itemId: number, bundleId: number, priceCents: number) =>
  recordSale({
    clientUuid: `a-${++n}`,
    userId: 1,
    tier: "retail",
    lines: [{ itemId, units: 1, bundleId, unitPriceCents: priceCents }],
    tenders: [{ method: "cash", amountCents: priceCents }],
  });

// The shape from the shop's own screen: one made product, four receipt names.
const RATE = 600_00;
const ocean = product("Ocean breeze mild", "finished", RATE);
saveBundles({ itemId: ocean }, [
  { sizeMilli: 5_000, priceCents: 275_00, floorCents: 0 },
  { sizeMilli: 500, priceCents: 30_00, floorCents: 0 },
  { sizeMilli: 250, priceCents: 15_00, floorCents: 0 },
]);
loose(ocean, 5_000, RATE);
for (const b of itemBundles(ocean)) bundled(ocean, b.id, b.priceCents);

test("a product sold in four sizes is one row, not four", () => {
  const rows = attentionDetail(DAY).uncostedSales;
  const mine = rows.filter((r) => r.id === ocean);
  assert.equal(mine.length, 1, "one product, one missing cost price, one row");
  assert.equal(mine[0].name, "Ocean breeze mild");
  assert.match(mine[0].said, /4 sales/);
  assert.match(mine[0].said, /4 sizes/, "the sizes are said, not listed as separate faults");
});

test("every row says how THAT product gets a cost price", () => {
  const row = attentionDetail(DAY).uncostedSales.find((r) => r.id === ocean)!;
  assert.ok(row.fix, "a row with no route to a fix is a row that never clears");
  // Nothing has ever been delivered and no recipe makes it: say so plainly
  // rather than sending somebody to Deliveries to find nothing there.
  assert.match(row.fix!, /cannot be costed/);
  assert.doesNotMatch(row.fix!, /record what those goods cost on the delivery/i);
});

test("a recipe product is sent to the mixing board, not to deliveries", () => {
  const made = product("Mixed Here", "finished", 200_00);
  const f = get<{ id: number }>(`SELECT id FROM formulas LIMIT 1`)!;
  run(`UPDATE formulas SET output_item_id = ? WHERE id = ?`, made, f.id);
  loose(made, 1_000, 200_00);

  const row = attentionDetail(DAY).uncostedSales.find((r) => r.id === made)!;
  assert.match(row.fix!, /mixing board/);
});

test("a delivered-but-unpriced product is sent to that delivery", () => {
  const bought = product("Came With No Price", "bulk", 300_00);
  const supplier = createSupplier({ name: "A Supplier" }, 1);
  recordPurchase({
    supplierId: supplier,
    ref: "DN-FREE",
    transportCents: 0,
    userId: 1,
    clientUuid: "a-free",
    lines: [{ itemId: bought, units: 1, sizeMilli: 20_000, costCents: 0 }],
  });
  loose(bought, 1_000, 300_00);

  const row = attentionDetail(DAY).uncostedSales.find((r) => r.id === bought)!;
  assert.match(row.fix!, /no money against it/);
});

// ------------------------------------------------- the dismissal that stuck

test("the sentence a dismissal is tied to carries no running total", () => {
  const said = namesSaid(attentionDetail(DAY).uncostedSales);
  assert.doesNotMatch(said, /KES/, "a figure here is a dismissal undone by the next sale");
  assert.match(said, /Ocean breeze mild/);
});

test("another sale of the same product does not bring the row back", () => {
  const before = namesSaid(attentionDetail(DAY).uncostedSales);
  dismiss("attention:uncosted-sales", before, 1, "waiting on the supplier's invoice");

  // The counter sells three more. The money moves; the answer does not.
  loose(ocean, 2_000, RATE);
  loose(ocean, 1_000, RATE);
  for (const b of itemBundles(ocean)) bundled(ocean, b.id, b.priceCents);

  const after = namesSaid(attentionDetail(DAY).uncostedSales);
  assert.equal(fingerprint(after), fingerprint(before), "same claim, same fingerprint");
  assert.ok(
    isDismissed(activeDismissals(), "attention:uncosted-sales", after),
    "it stays set aside, which is what the button promised",
  );
});

test("but a NEW uncosted product does bring it back", () => {
  const fresh = product("Something Else Entirely", "bulk", 100_00);
  loose(fresh, 1_000, 100_00);

  const after = namesSaid(attentionDetail(DAY).uncostedSales);
  assert.match(after, /Something Else Entirely/);
  assert.ok(
    !isDismissed(activeDismissals(), "attention:uncosted-sales", after),
    "a product nobody has judged yet is news, and news comes back",
  );
});

test("and costing the product clears the row outright", () => {
  const supplier = createSupplier({ name: "Kel Chemicals Ltd" }, 1);
  const priced = product("Properly Delivered", "bulk", 500_00);
  loose(priced, 1_000, 500_00);
  assert.ok(
    attentionDetail(DAY).uncostedSales.some((r) => r.id === priced),
    "uncosted while nothing has been paid for it",
  );

  recordPurchase({
    supplierId: supplier,
    ref: "DN-REAL",
    transportCents: 0,
    userId: 1,
    clientUuid: "a-real",
    lines: [{ itemId: priced, units: 1, sizeMilli: 20_000, costCents: 600_000 }],
  });

  assert.ok(
    !attentionDetail(DAY).uncostedSales.some((r) => r.id === priced),
    "a priced delivery is what a cost price is, and the row goes",
  );
});
