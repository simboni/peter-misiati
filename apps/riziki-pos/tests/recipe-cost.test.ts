/**
 * Costing a mixed product from its recipe.
 *
 * The shop sells twenty litres of multipurpose soap and never buys a drop of
 * it. There is no delivery behind it and no cost price on it, so its cost can
 * only be the chemicals that went in. A sale already does that sum; what these
 * cover is the sum before the sale, and the two ways the answer can be wrong
 * while every figure still adds up:
 *
 *   - a mix parent reported as "no cost price" when its cost is simply on the
 *     ingredient lines underneath — a false alarm the owner acted on;
 *   - a chemical with no cost price contributing nothing, so the mix reports a
 *     margin better than the shop is making and nothing anywhere disagrees.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-recipe-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, run, all } = await import("../src/lib/db.ts");
const { recipeCost, bundleMargin } = await import("../src/lib/recipe-cost.ts");
const { currentVersion } = await import("../src/lib/production.ts");
const { saveBundles, formulaBundles } = await import("../src/lib/bundles.ts");
const { recordSale } = await import("../src/lib/sales.ts");
const { profitSummary } = await import("../src/lib/reports.ts");
const { attentionDetail } = await import("../src/lib/dashboard.ts");
const { businessDate } = await import("../src/lib/units.ts");

seed();

const formulaNamed = (like: string) =>
  get<{ id: number; name: string }>(`SELECT id, name FROM formulas WHERE name LIKE ?`, `%${like}%`)!;

const costOf = (name: string) =>
  get<{ cost_cents: number }>(`SELECT cost_cents FROM items WHERE name = ?`, name)!.cost_cents;

const setCost = (name: string, cents: number) =>
  run(`UPDATE items SET cost_cents = ? WHERE name = ?`, cents, name);

const today = businessDate();
const range = { from: today, to: today };

let uuid = 0;
function sellBundle(bundleId: number, priceCents: number) {
  return recordSale({
    clientUuid: `recipe-test-${++uuid}`,
    userId: 1,
    tier: "retail",
    lines: [{ bundleId, units: 1, unitPriceCents: priceCents }],
    tenders: [{ method: "cash", amountCents: priceCents }],
  });
}

// ------------------------------------------------------- the sum itself

test("a batch costs what its chemicals cost", () => {
  const f = formulaNamed("Multipurpose");
  const v = currentVersion(f.id)!;
  const cost = recipeCost(v.id, 20_000);

  assert.ok(cost.ingredients.length > 1, "a recipe has several chemicals in it");
  assert.equal(
    cost.totalCents,
    cost.ingredients.reduce((s, i) => s + i.costCents, 0),
    "the total is the lines and nothing else",
  );
  assert.ok(cost.totalCents > 0);
  assert.equal(cost.complete, true, "every chemical in the seeded shop has a cost");
  assert.deepEqual(cost.missing, []);
});

test("it scales with the batch", () => {
  const v = currentVersion(formulaNamed("Multipurpose").id)!;
  const twenty = recipeCost(v.id, 20_000).totalCents;
  const forty = recipeCost(v.id, 40_000).totalCents;
  // Not exactly double: each line rounds once, which is the same rounding a
  // sale does. Within a shilling of double is the honest assertion.
  assert.ok(Math.abs(forty - twenty * 2) <= 100, `${forty} is about twice ${twenty}`);
});

test("a chemical with no cost price is named, not silently skipped", () => {
  const v = currentVersion(formulaNamed("Multipurpose").id)!;
  const was = costOf("Ungerol");
  setCost("Ungerol", 0);

  const cost = recipeCost(v.id, 20_000);
  assert.equal(cost.complete, false);
  assert.ok(cost.missing.includes("Ungerol"), "and says which one");
  const ung = cost.ingredients.find((i) => i.name === "Ungerol")!;
  assert.equal(ung.costCents, 0);
  assert.equal(ung.noCost, true);

  setCost("Ungerol", was);
});

// ------------------------------------------------------------ the margin

test("the margin is profit over the price, and carries what it does not know", () => {
  const v = currentVersion(formulaNamed("Multipurpose").id)!;
  const cost = recipeCost(v.id, 20_000).totalCents;

  const m = bundleMargin(v.id, { sizeMilli: 20_000, priceCents: cost * 2 });
  assert.equal(m.costCents, cost);
  assert.equal(m.profitCents, cost);
  assert.equal(m.marginPct, 50, "half the price is profit");
  assert.deepEqual(m.missing, []);

  const was = costOf("Perfume");
  setCost("Perfume", 0);
  const short = bundleMargin(v.id, { sizeMilli: 20_000, priceCents: cost * 2 });
  assert.ok(short.missing.includes("Perfume"), "an unpriced chemical travels with the figure");
  assert.ok(short.marginPct > m.marginPct, "and flatters the margin until it is fixed");
  setCost("Perfume", was);
});

test("selling below what the chemicals cost reads as a loss", () => {
  const v = currentVersion(formulaNamed("Multipurpose").id)!;
  const cost = recipeCost(v.id, 20_000).totalCents;
  const m = bundleMargin(v.id, { sizeMilli: 20_000, priceCents: Math.round(cost / 2) });
  assert.ok(m.profitCents < 0, "the shop pays to sell it");
  assert.ok(m.marginPct < 0);
});

// -------------------------------------------- what the screens now report

test("a mix sold with every chemical costed is not called uncosted", () => {
  const f = formulaNamed("Shower Gel");
  const v = currentVersion(f.id)!;
  saveBundles({ formulaId: f.id }, [{ sizeMilli: 20_000, priceCents: 300_000, floorCents: 0 }]);
  const b = formulaBundles(f.id)[0];

  sellBundle(b.id, b.priceCents);

  const detail = attentionDetail(range);
  assert.equal(
    detail.uncostedSales.some((u) => u.name.includes("Shower Gel")),
    false,
    "the parent carries no cost by design — its cost is on the lines beneath it",
  );
  assert.equal(
    detail.mixShort.length,
    0,
    "and nothing is short, because every chemical has a price",
  );
  assert.equal(profitSummary(range).mixShortCents, 0);
});

test("a mix sold with an unpriced chemical is reported, and the chemical is named", () => {
  const f = formulaNamed("Toilet Cleaner");
  const v = currentVersion(f.id)!;
  const ingredient = recipeCost(v.id, 5_000).ingredients[0];
  const was = ingredient.unitCostCents;
  setCost(ingredient.name, 0);

  saveBundles({ formulaId: f.id }, [{ sizeMilli: 5_000, priceCents: 90_000, floorCents: 0 }]);
  const b = formulaBundles(f.id).find((x) => x.sizeMilli === 5_000)!;
  sellBundle(b.id, b.priceCents);

  const summary = profitSummary(range);
  assert.equal(summary.mixShortCents, 90_000, "the mix went out at 900 and was costed short");

  const detail = attentionDetail(range);
  const named = detail.mixShort.find((m) => m.name === ingredient.name);
  assert.ok(named, `${ingredient.name} is named as the reason`);
  assert.match(named!.said, /no cost price/);

  setCost(ingredient.name, was);
});

test("the mix's own line never appears as an uncosted sale", () => {
  // The regression this all started from: every mixed product the shop sells
  // was listed as having no cost price, which read as "booked at 100% profit".
  const parents = all<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sale_lines
      WHERE bundle_id IS NOT NULL AND formula_version_id IS NOT NULL AND item_id IS NULL`,
  )[0];
  assert.ok(parents.n > 0, "there are mix parents in this book to get wrong");

  for (const row of attentionDetail(range).uncostedSales) {
    assert.ok(row.id !== null && row.id > 0, `${row.name} is a real item, not a mix parent`);
  }
});
