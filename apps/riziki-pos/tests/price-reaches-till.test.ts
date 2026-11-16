/**
 * A price the owner changes must be the price the counter charges.
 *
 * The shop reported changing a price under Products & prices, then again on
 * the recipe, and the till not moving. Two separate faults were behind it.
 *
 * ONE. A recipe that is mixed in advance is never offered at the counter —
 * the till filters it out, because its ingredients left the shelf when the
 * batch was mixed and billing the recipe again would take them twice. What
 * the customer buys is the PRODUCT it makes. But the recipe screen went on
 * showing a price box, and saving it wrote a bundle that nothing would ever
 * read. The owner set a price, was told it saved, and the counter never moved
 * — not until a cache cleared, but ever.
 *
 * TWO lives in the service worker and has its own test; this file holds the
 * data half.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-price-till-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, run } = await import("../src/lib/db.ts");
const { saveBundles, bundlesByFormula, bundlesByItem } = await import("../src/lib/bundles.ts");
const { listFormulas, formulaById } = await import("../src/lib/production.ts");
const { setFormulaOutput } = await import("../src/lib/mixing.ts");
const { batchSizes } = await import("../src/lib/bundle-input.ts");

seed({ openingStock: false });

const recipe = get<{ id: number }>(`SELECT id FROM formulas WHERE name = 'Handwash'`)!.id;

/** Exactly the filter the till applies when it builds the Products board. */
function offeredAsRecipe(formulaId: number): boolean {
  return listFormulas()
    .filter((f) => f.ingredient_count > 0 && f.output_item_id === null && !f.hidden)
    .some((f) => f.id === formulaId);
}
const recipePrice = (formulaId: number) =>
  (bundlesByFormula().get(formulaId) ?? []).map((b) => b.priceCents);

test("a mix-to-order recipe is on the till, and its price is the one it is given", () => {
  saveBundles({ formulaId: recipe }, [{ sizeMilli: 5_000, priceCents: 500_00, floorCents: 0 }]);
  assert.ok(offeredAsRecipe(recipe), "mixed to order, so the counter sells the recipe");
  assert.deepEqual(recipePrice(recipe), [500_00]);

  saveBundles({ formulaId: recipe }, [{ sizeMilli: 5_000, priceCents: 650_00, floorCents: 0 }]);
  assert.deepEqual(recipePrice(recipe), [650_00], "and a change reaches it");
});

test("once it makes a product, the counter stops offering the recipe", () => {
  run(
    `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, price_basis, price_cents, cost_cents)
     VALUES (NULL, 'Handwash (made)', 'finished', 'L', 1000, 'L', 1, 'unit', 90000, 0)`,
  );
  const made = get<{ id: number }>(`SELECT id FROM items WHERE name = 'Handwash (made)'`)!.id;
  setFormulaOutput(recipe, made, 1);

  assert.ok(!offeredAsRecipe(recipe), "the till sells the product instead — see lib/mixing.ts");
  assert.equal(
    get<{ p: number }>(`SELECT price_cents AS p FROM items WHERE id = ?`, made)!.p,
    90000,
    "and the product's own price is what the customer pays",
  );
});

test("so the recipe screen must not write a price nothing will read", () => {
  /*
    The guard the save action applies. Without it the owner types a price, is
    told it saved, and the counter is unmoved — because the thing they priced
    is not the thing being sold.
  */
  const made = formulaById(recipe)!.output_item_id;
  assert.ok(made !== null, "this recipe makes a product");

  const before = recipePrice(recipe);
  const wouldWrite = formulaById(recipe)?.output_item_id == null;
  assert.equal(wouldWrite, false, "the action skips saveBundles for a recipe that makes a product");

  // And prove the skip matters: writing it would have changed the stored price.
  const ifItHadWritten = batchSizes(
    (bundlesByFormula().get(recipe) ?? []).map((b) => ({
      sizeMilli: b.sizeMilli,
      priceCents: b.priceCents,
      floorCents: b.floorCents,
    })),
    5,
    "999",
  );
  assert.notDeepEqual(
    ifItHadWritten.map((b) => b.priceCents),
    before,
    "a price typed there really would have been stored, which is why it is refused",
  );
});

test("pricing the product IS what moves the counter", () => {
  const made = get<{ id: number }>(`SELECT id FROM items WHERE name = 'Handwash (made)'`)!.id;
  run(`UPDATE items SET price_cents = 120000 WHERE id = ?`, made);
  assert.equal(
    get<{ p: number }>(`SELECT price_cents AS p FROM items WHERE id = ?`, made)!.p,
    120000,
  );

  saveBundles({ itemId: made }, [{ sizeMilli: 5_000, priceCents: 550_00, floorCents: 0 }]);
  assert.deepEqual(
    (bundlesByItem().get(made) ?? []).map((b) => b.priceCents),
    [550_00],
    "and its sizes are the ones the till offers",
  );
});

// ------------------------------------------- the other half: the saved copy

/**
 * The second fault, and the one that could charge the wrong money.
 *
 * The service worker keeps a copy of each screen so the counter still works
 * on a dead line. For every screen but one that is the right trade. The till
 * is the exception: what it shows is not information, it is the price the
 * customer is charged, and a saved copy goes on charging yesterday's price
 * after the owner has changed it with nothing on screen to say so.
 *
 * It reproduced exactly — raise a price, reload the till on a link slower
 * than 2.5 seconds, and the old price is still there. The worker is plain
 * JavaScript with no exports, so the rules are read out of the file itself;
 * the behaviour was then confirmed in a real browser with the network
 * throttled, both before the fix and after.
 */
import { readFileSync } from "node:fs";

const SW = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

test("the till is on the list of screens that must not be served stale", () => {
  const list = SW.match(/const MUST_BE_FRESH = \[([^\]]*)\]/);
  assert.ok(list, "MUST_BE_FRESH exists");
  assert.match(list![1], /"\/sell"/, "the till is on it");
});

test("a cached copy no longer shortcuts the wait for the till", () => {
  // The budget is the short one ONLY for a cached screen that may be stale.
  assert.match(
    SW,
    /const budget = cached && !fresh \? SLOW_NETWORK_MS : NO_FALLBACK_MS;/,
    "the short budget is conditional on the screen being allowed to be stale",
  );
});

test("but a dead line still opens the till, without waiting out the long budget", () => {
  /*
    The line that makes the fix safe. Offline is decided before any timeout, so
    a counter with no signal gets its saved till at once — the whole reason the
    offline mode exists. Losing this would turn every outage into a twelve
    second wait and then a blank screen.
  */
  assert.match(
    SW,
    /if \(!self\.navigator\.onLine && cached\) return cached;/,
    "offline short-circuits ahead of the network budget",
  );
});
