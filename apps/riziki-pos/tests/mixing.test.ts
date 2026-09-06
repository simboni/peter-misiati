/**
 * Mixing a recipe in advance, in the shop's own numbers.
 *
 * Hypochlorite: a 24 kg drum of concentrate, worked half at a time —
 * 12 kg makes 23 kg of mild. The two things this must get right are the
 * arithmetic of a batch that makes MORE than went into it, and the interlock
 * that stops the concentrate leaving the books twice.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "mix-")), "t.db");

import test from "node:test";
import assert from "node:assert/strict";
const { seed } = await import("../src/lib/seed.ts");
const { get, all, run, stockOf } = await import("../src/lib/db.ts");
const { createProduct } = await import("../src/lib/catalog.ts");
const { saveBundles } = await import("../src/lib/bundles.ts");
const { createFormula, currentVersion, listFormulas } = await import("../src/lib/production.ts");
const { setFormulaOutput, planMix, recordMix, mixableFormulas, recentBatches, MixError } =
  await import("../src/lib/mixing.ts");
const { deletableReason } = await import("../src/lib/catalog.ts");

seed();
const OWNER = 1;

function product(name: string, container: number, price: number) {
  return createProduct({
    name,
    unit: "kg",
    aliases: "",
    containerValue: container,
    containerLabel: "drum",
    price,
    floor: 0,
    ceiling: 0,
    byUserId: OWNER,
  });
}

/** Put stock on the shelf without going through a purchase. */
function stockIn(itemId: number, milli: number) {
  run(
    `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id, note)
     VALUES (?, ?, 'opening', ?, 'test')`,
    itemId,
    milli,
    OWNER,
  );
}

const concId = product("Hypochlorite (concentrate)", 24, 300);
const conc = get<{ chemical_id: number }>(`SELECT chemical_id FROM items WHERE id = ?`, concId)!;
const mildId = product("Hypochlorite mild", 23, 160);

// The concentrate cost KES 300/kg. Set it the way a delivery would.
run(`UPDATE items SET cost_cents = 30000 WHERE id = ?`, concId);
stockIn(concId, 48_000); // two drums

const { formulaId } = createFormula({
  name: "Hypochlorite — mild",
  refSizeMilli: 23_000,
  refUnit: "kg",
  steps: "12 kg of concentrate brought up to 23 kg with water.",
  note: "",
  items: [{ chemicalId: conc.chemical_id, qtyMilli: 12_000 }],
  userId: OWNER,
});
const versionId = currentVersion(formulaId)!.id;

test("a recipe with no output product cannot be mixed", () => {
  assert.throws(
    () => planMix(versionId, 23_000),
    /mixed to order/,
    "it should say why, and what to do about it",
  );
});

test("a recipe cannot be told to make one of its own ingredients", () => {
  assert.throws(
    () => setFormulaOutput(formulaId, concId, OWNER),
    /cannot also be what the recipe makes/,
  );
});

test("pointing the recipe at what it makes", () => {
  setFormulaOutput(formulaId, mildId, OWNER);
  const row = get<{ output_item_id: number }>(
    `SELECT output_item_id FROM formulas WHERE id = ?`,
    formulaId,
  );
  assert.equal(row?.output_item_id, mildId);
});

test("the plan says what one batch needs and how much the store could carry", () => {
  const plan = planMix(versionId, 23_000);
  assert.equal(plan.lines.length, 1);
  assert.equal(plan.lines[0].neededMilli, 12_000, "23 kg needs 12 kg of concentrate");
  assert.equal(plan.lines[0].availableMilli, 48_000);
  assert.equal(plan.canMake, true);
  // 48 kg of concentrate, 12 kg per 23 kg made => 92 kg of mild.
  assert.equal(plan.possibleMilli, 92_000);
  assert.equal(plan.totalCostCents, 360_000, "12 kg at KES 300 = KES 3,600");
});

test("a batch takes the concentrate and puts the mild on the shelf, in one move", () => {
  const before = stockOf(concId);
  const res = recordMix({
    versionId,
    targetMilli: 23_000,
    actualMilli: 23_000,
    userId: OWNER,
  });

  assert.equal(stockOf(concId), before - 12_000, "12 kg left the drum");
  assert.equal(stockOf(mildId), 23_000, "23 kg arrived as mild");
  assert.equal(res.madeMilli, 23_000);
  assert.match(res.batchNo, /^B-\d{6}-\d+$/);

  const moves = all<{ reason: string; delta_milli: number; item_id: number }>(
    `SELECT reason, delta_milli, item_id FROM stock_movements WHERE ref_type = 'batch' AND ref_id = ?`,
    res.batchId,
  );
  assert.equal(moves.length, 2, "one movement out, one in");
  assert.ok(moves.some((m) => m.reason === "batch_consume" && m.delta_milli === -12_000));
  assert.ok(moves.some((m) => m.reason === "batch_output" && m.delta_milli === 23_000));
});

test("the cost of the mild is the concentrate's money spread over more kilograms", () => {
  const mild = get<{ cost_cents: number }>(`SELECT cost_cents FROM items WHERE id = ?`, mildId)!;
  // KES 3,600 over 23 kg = 15,652 cents/kg, to the cent.
  assert.equal(mild.cost_cents, Math.round(360_000 / 23));
  assert.equal(mild.cost_cents, 15_652);

  const conc2 = get<{ cost_cents: number }>(`SELECT cost_cents FROM items WHERE id = ?`, concId)!;
  assert.equal(conc2.cost_cents, 30_000, "the concentrate's own cost is untouched");

  assert.ok(
    mild.cost_cents < conc2.cost_cents,
    "diluting must make it cheaper per kg, not dearer — this is the error that hides",
  );
});

test("the concentrate that was not mixed is still there to sell", () => {
  assert.equal(stockOf(concId), 36_000, "48 kg in, 12 kg mixed, 36 kg still on the shelf");
});

test("what actually came out of the jug is what the ledger believes", () => {
  const before = stockOf(mildId);
  // The recipe says 23 kg. The drum gave 22.4.
  const res = recordMix({
    versionId,
    targetMilli: 23_000,
    actualMilli: 22_400,
    userId: OWNER,
  });
  assert.equal(res.madeMilli, 22_400);
  assert.equal(stockOf(mildId), before + 22_400);

  const row = get<{ target_milli: number; actual_milli: number }>(
    `SELECT target_milli, actual_milli FROM batches WHERE id = ?`,
    res.batchId,
  );
  assert.equal(row?.target_milli, 23_000, "the plan is kept");
  assert.equal(row?.actual_milli, 22_400, "and so is what really happened");
});

test("more concentrate than the shelf holds is refused, by name and amount", () => {
  assert.throws(
    () => recordMix({ versionId, targetMilli: 200_000, actualMilli: 200_000, userId: OWNER }),
    /Not enough Hypochlorite \(concentrate\)[\s\S]*in the store/,
  );
});

test("a refused batch changes nothing at all", () => {
  const conc0 = stockOf(concId);
  const mild0 = stockOf(mildId);
  const batches0 = all(`SELECT id FROM batches`).length;

  assert.throws(() =>
    recordMix({ versionId, targetMilli: 500_000, actualMilli: 500_000, userId: OWNER }),
  );

  assert.equal(stockOf(concId), conc0, "no concentrate left the shelf");
  assert.equal(stockOf(mildId), mild0, "no mild arrived");
  assert.equal(all(`SELECT id FROM batches`).length, batches0, "and no batch was written");
});

test("a mixed-in-advance recipe is not offered at the counter", () => {
  // This is the interlock: the sell screen filters on exactly this.
  const offered = listFormulas().filter((f) => f.output_item_id === null);
  assert.ok(
    !offered.some((f) => f.id === formulaId),
    "a recipe that makes stock must not also be billed as its ingredients",
  );
  // But the owner still sees it on the Recipes screen.
  assert.ok(listFormulas().some((f) => f.id === formulaId));
});

test("the board lists what can be mixed, with both shelf figures", () => {
  const rows = mixableFormulas();
  const row = rows.find((r) => r.formulaId === formulaId);
  assert.ok(row, "the recipe is on the board");
  assert.equal(row!.outputItemId, mildId);
  assert.equal(row!.outputOnHandMilli, stockOf(mildId));
  assert.equal(row!.possibleMilli, Math.floor((stockOf(concId) * 23_000) / 12_000));
});

test("the board carries the sizes the made product is sold in, with prices", () => {
  // The shop says "two 23s and four 5s", not "66 kg", so the board has to know
  // the sizes and what each fetches.
  saveBundles({ itemId: mildId }, [
    { sizeMilli: 23_000, priceCents: 700_000, floorCents: 0 },
    { sizeMilli: 5_000, priceCents: 160_000, floorCents: 0 },
  ]);

  const row = mixableFormulas().find((r) => r.formulaId === formulaId)!;
  assert.equal(row.outputBundles.length, 2);
  assert.deepEqual(
    row.outputBundles.map((b) => [b.sizeMilli, b.priceCents]),
    [
      [23_000, 700_000],
      [5_000, 160_000],
    ],
    "in the order the shop set them, with their own prices",
  );
  assert.equal(row.outputPriceCents, 16_000, "and the per-kg price for an odd quantity");
});

test("a batch is remembered, with what went into it", () => {
  const rows = recentBatches(5);
  assert.ok(rows.length >= 2);
  assert.equal(rows[0].outputName, "Hypochlorite mild");
  assert.match(rows[0].inputs, /Hypochlorite \(concentrate\)/);
});

test("a product that has been mixed cannot be deleted", () => {
  assert.match(deletableReason(mildId) ?? "", /been mixed/);
  assert.match(deletableReason(concId) ?? "", /been mixed with/);
});

test("two recipes cannot both claim to make the same product", () => {
  const other = createFormula({
    name: "Another mild",
    refSizeMilli: 10_000,
    refUnit: "kg",
    steps: "",
    note: "",
    items: [{ chemicalId: conc.chemical_id, qtyMilli: 5_000 }],
    userId: OWNER,
  });
  assert.throws(
    () => setFormulaOutput(other.formulaId, mildId, OWNER),
    /already made by the recipe/,
  );
});

test("unpointing a recipe puts it back on the counter", () => {
  setFormulaOutput(formulaId, null, OWNER);
  const row = get<{ output_item_id: number | null }>(
    `SELECT output_item_id FROM formulas WHERE id = ?`,
    formulaId,
  );
  assert.equal(row?.output_item_id, null);
  assert.ok(listFormulas().some((f) => f.id === formulaId && f.output_item_id === null));
  setFormulaOutput(formulaId, mildId, OWNER); // put it back for anything after
});

test("MixError is what callers can catch", () => {
  try {
    planMix(999_999, 1000);
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof MixError);
  }
});
