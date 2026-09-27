/**
 * What a mixed product earns — and what it must not appear to earn.
 *
 * A recipe sold at the counter is one economic act written as several rows: a
 * priced line for the product, and unpriced ingredient lines underneath it
 * carrying the cost. The ledger is right that way — the receipt shows one
 * charge, the stock shows five chemicals leaving — but any report that asks
 * "what did this earn" has to put the two halves back together.
 *
 * Reading the rows as they lie says the mix was free to make (revenue, no cost:
 * a 100% margin) and that the chemicals under it were given away (cost, no
 * revenue: a loss). Both are false, both are loud, and the owner is right to
 * stop believing the screen. These tests hold the two halves together.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-mix-profit-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, all, postMovement } = await import("../src/lib/db.ts");
const cat = await import("../src/lib/catalog.ts");
const bundles = await import("../src/lib/bundles.ts");
const prod = await import("../src/lib/production.ts");
const sales = await import("../src/lib/sales.ts");
const { profitSummary, profitPerProduct, businessLineSplit } = await import("../src/lib/reports.ts");

seed();

// ---------------------------------------------------------------- fixture

const RANGE = { from: "2000-01-01", to: "2100-01-01" };

const formula = prod.listFormulas()[0];
const version = prod.currentVersion(formula.id)!;

/** Every ingredient, stocked far beyond what the batches need. */
const ingredientItems: number[] = [];
for (const need of prod.scaleFormula(version.id, 5000)) {
  const src = get<{ id: number }>(
    `SELECT id FROM items WHERE chemical_id = ? AND sellable = 1 AND active = 1
      AND price_basis = 'unit' LIMIT 1`,
    need.chemicalId,
  );
  if (!src) continue;
  ingredientItems.push(src.id);
  postMovement({
    itemId: src.id,
    deltaMilli: Math.max(need.neededMilli * 100, 100_000),
    reason: "opening",
    userId: 1,
    note: "stocked for the mix-profit test",
  });
}
assert.ok(ingredientItems.length >= 2, "the seeded recipe has ingredients to buy");

bundles.saveBundles({ formulaId: formula.id }, [
  { sizeMilli: 5000, priceCents: 90000, floorCents: 80000 },
  { sizeMilli: 20000, priceCents: 320000, floorCents: 300000 },
]);
const [small, big] = bundles.formulaBundles(formula.id);

// Two 5 L of the mix, and — on the same bill — one 20 L, which is the case
// that makes a naive allocation lose a cent.
sales.recordSale({
  clientUuid: "mix-profit-1",
  userId: 1,
  tier: "retail",
  lines: [
    { bundleId: small.id, units: 2, unitPriceCents: small.priceCents },
    { bundleId: big.id, units: 1, unitPriceCents: big.priceCents },
  ],
  tenders: [{ method: "cash", amountCents: small.priceCents * 2 + big.priceCents }],
});

// And a plain sale of one of the chemicals the recipe uses, neat, so its own
// row can be checked for the cost of somebody else's mix leaking into it.
const neat = cat.listProducts().find((i) => i.id === ingredientItems[0])!;
sales.recordSale({
  clientUuid: "mix-profit-2",
  userId: 1,
  tier: "retail",
  lines: [{ itemId: neat.id, units: 1, qtyMilli: 2000, unitPriceCents: neat.price_cents }],
  tenders: [{ method: "cash", amountCents: Math.round((neat.price_cents * 2000) / 1000) }],
});

const mixName = get<{ name_snapshot: string }>(
  `SELECT name_snapshot FROM sale_lines WHERE bundle_id = ? LIMIT 1`,
  small.id,
)!.name_snapshot;

// ------------------------------------------------------------------ tests

test("the ledger still writes the price on the product and the cost underneath", () => {
  // Not a thing to change — the rest of the system depends on this shape. It is
  // asserted here so that a later "fix" to the write path shows up as this
  // test failing rather than as a silent double count.
  const parent = get<{ line_total_cents: number; cost_cents: number; item_id: number | null }>(
    `SELECT line_total_cents, cost_cents, item_id FROM sale_lines WHERE bundle_id = ? LIMIT 1`,
    small.id,
  )!;
  assert.equal(parent.item_id, null, "a mixed product is on no shelf");
  assert.ok(parent.line_total_cents > 0, "the priced line carries the charge");
  assert.equal(parent.cost_cents, 0, "and not the cost, which sits on the ingredients");

  const parts = all<{ cost_cents: number; line_total_cents: number }>(
    `SELECT cost_cents, line_total_cents FROM sale_lines
      WHERE sale_id = (SELECT sale_id FROM sale_lines WHERE bundle_id = ? LIMIT 1)
        AND bundle_id IS NULL`,
    small.id,
  );
  assert.ok(parts.length > 0, "the ingredients are written down");
  assert.ok(
    parts.every((p) => p.line_total_cents === 0),
    "an ingredient of a mix is an amount, not a charge",
  );
  assert.ok(
    parts.some((p) => p.cost_cents > 0),
    "and it carries what it cost",
  );
});

test("a mixed product is not free to make", () => {
  const rows = profitPerProduct(RANGE, 50);
  const mix = rows.find((r) => r.name === mixName);
  assert.ok(mix, `the mix appears in the product list as "${mixName}"`);

  assert.ok(mix.cost_cents > 0, "the chemicals that went into it are its cost");
  assert.ok(
    mix.margin_pct < 99,
    `a mix cannot earn a ${mix.margin_pct.toFixed(0)}% margin — that is its cost gone missing`,
  );
  assert.ok(mix.profit_cents < mix.revenue_cents, "profit is less than the whole price");
  assert.ok(mix.profit_cents > 0, "and this recipe is sold above what it costs");
});

test("the chemicals under a mix do not show up as products given away", () => {
  const rows = profitPerProduct(RANGE, 50);
  const phantom = rows.filter((r) => r.revenue_cents === 0 && r.cost_cents > 0);
  assert.deepEqual(
    phantom.map((r) => r.name),
    [],
    "a row with a cost and no sales is somebody else's cost, wrongly filed",
  );
});

test("a chemical sold neat keeps its own margin, whatever it is mixed into", () => {
  const rows = profitPerProduct(RANGE, 50);
  const row = rows.find((r) => r.item_id === neat.id);
  assert.ok(row, "the chemical sold on its own is listed");

  // Its cost is the cost of the 2 kg that were actually sold, not that plus
  // whatever the mix on the other bill poured out of the same drum.
  assert.equal(row.revenue_cents, Math.round((neat.price_cents * 2000) / 1000));
  assert.equal(row.cost_cents, Math.round((neat.cost_cents * 2000) / 1000));
});

test("the product list adds up to the period's own total, to the cent", () => {
  const summary = profitSummary(RANGE);
  const rows = profitPerProduct(RANGE, 500);

  assert.equal(
    rows.reduce((n, r) => n + r.revenue_cents, 0),
    summary.salesCents,
    "every shilling taken is on one of these rows",
  );
  assert.equal(
    rows.reduce((n, r) => n + r.cost_cents, 0),
    summary.cogsCents,
    "and every shilling of cost, allocated and not lost to rounding",
  );
});

test("the split by line of business puts the mix and its cost on the same side", () => {
  const lines = businessLineSplit(RANGE);
  const summary = profitSummary(RANGE);

  assert.equal(
    lines.reduce((n, l) => n + l.revenue_cents, 0),
    summary.salesCents,
    "the split accounts for all of the sales",
  );
  assert.equal(
    lines.reduce((n, l) => n + l.cost_cents, 0),
    summary.cogsCents,
    "and all of the cost",
  );

  for (const l of lines) {
    if (l.revenue_cents > 0) {
      assert.ok(
        l.margin_pct < 99,
        `${l.line} shows a ${l.margin_pct.toFixed(0)}% margin, which means its cost is on another line`,
      );
    }
  }

  const chemicals = lines.find((l) => l.line === "Chemicals")!;
  assert.ok(chemicals.revenue_cents > 0, "a mixed chemical is a chemical");
});
