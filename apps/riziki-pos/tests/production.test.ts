/**
 * Production service tests.
 *
 * The database path is set before anything is imported, so these never touch
 * the shop's real file. `db.ts` reads it once at module load, which is why the
 * modules under test are pulled in with dynamic imports below.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "riziki-production-"));
process.env.RIZIKI_DB = join(TMP, "test.db");

const { all, get, run, chemicalStock } = await import("../src/lib/db.ts");
const { seed } = await import("../src/lib/seed.ts");
const { toMilli } = await import("../src/lib/units.ts");
const {
  scaleFormula,
  planBatch,
  runBatch,
  newBatchNo,
  recordYield,
  createFormulaVersion,
  currentVersion,
  formulaItems,
  listFormulas,
  listMixableProducts,
  batchReadiness,
  minimumTargetMilli,
  outputItemsFor,
  listBatches,
  pendingYieldBatches,
  voidBatch,
  allocate,
  buildKit,
  StockShortError,
} = await import("../src/lib/production.ts");

seed();

process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

const OWNER = 1;

function formula(name: string) {
  const row = get<{ id: number; name: string }>(`SELECT id, name FROM formulas WHERE name = ?`, name);
  assert.ok(row, `seed should contain the formula "${name}"`);
  return row!;
}

function versionOf(name: string) {
  const v = currentVersion(formula(name).id);
  assert.ok(v, `formula "${name}" should have a current version`);
  return v!;
}

function ledgerSnapshot() {
  return all<{ id: number; item_id: number; delta_milli: number; reason: string }>(
    `SELECT id, item_id, delta_milli, reason FROM stock_movements ORDER BY id`,
  );
}

// ---------------------------------------------------------------- (a) scaling

test("scaling a 20 L formula to 100 L multiplies every ingredient by exactly 5", () => {
  const version = versionOf("Shower Gel");
  assert.equal(version.ref_size_milli, toMilli(20), "Shower Gel is written for a 20 L batch");

  const reference = formulaItems(version.id);
  const scaled = scaleFormula(version.id, toMilli(100));

  assert.equal(scaled.length, reference.length);
  for (const line of scaled) {
    const source = reference.find((i) => i.chemical_id === line.chemicalId)!;
    assert.equal(
      line.neededMilli,
      source.qty_milli * 5,
      `${line.chemicalName} should scale by exactly 5`,
    );
  }

  // The headline case from the client's sheet: 1.5 kg of Ungerol per 20 L.
  const ungerol = scaled.find((l) => l.chemicalName === "Ungerol")!;
  assert.equal(ungerol.refQtyMilli, toMilli(1.5));
  assert.equal(ungerol.neededMilli, toMilli(7.5), "1.5 kg per 20 L becomes 7.5 kg per 100 L");
});

// ---------------------------------------------------------------- (b) scaling

test("scaling a 5 L formula to 20 L multiplies every ingredient by exactly 4", () => {
  const version = versionOf("Handwash");
  assert.equal(version.ref_size_milli, toMilli(5), "Handwash is written for a 5 L batch");

  const reference = formulaItems(version.id);
  const scaled = scaleFormula(version.id, toMilli(20));

  assert.equal(scaled.length, reference.length);
  for (const line of scaled) {
    const source = reference.find((i) => i.chemical_id === line.chemicalId)!;
    assert.equal(line.neededMilli, source.qty_milli * 4, `${line.chemicalName} should scale by 4`);
  }

  const ungerol = scaled.find((l) => l.chemicalName === "Ungerol")!;
  assert.equal(ungerol.refQtyMilli, toMilli(0.5));
  assert.equal(ungerol.neededMilli, toMilli(2), "0.5 kg per 5 L becomes 2 kg per 20 L");
});

test("allocate takes from the largest container first and reports what is missing", () => {
  const rows = [
    { id: 1, name: "drum 170 kg", size_milli: 170_000, cost_cents: 6_460_000, qty_milli: 10_000 },
    { id: 2, name: "pack 20 kg", size_milli: 20_000, cost_cents: 760_000, qty_milli: 5_000 },
  ];

  const exact = allocate(rows, 12_000);
  assert.deepEqual(
    exact.allocations.map((a) => [a.itemId, a.qtyMilli]),
    [
      [1, 10_000],
      [2, 2_000],
    ],
  );
  assert.equal(exact.shortMilli, 0);

  const short = allocate(rows, 20_000);
  assert.equal(short.shortMilli, 5_000, "15 kg on hand cannot cover 20 kg");
});

// ------------------------------------------------------- (c) batch deductions

test("running a batch deducts exactly the scaled quantities from the ledger", () => {
  const version = versionOf("Jik"); // 20 L reference: chlorine, caustic, magadi
  const target = toMilli(60); // three reference batches

  const scaled = scaleFormula(version.id, target);
  const before = new Map(scaled.map((l) => [l.chemicalId, chemicalStock(l.chemicalId)]));
  const movementsBefore = ledgerSnapshot().length;

  const result = runBatch({ formulaVersionId: version.id, targetMilli: target, userId: OWNER });

  assert.match(result.batchNo, /^RZK-\d{8}-\d{3}$/, "batch numbers are label-printable");

  for (const line of scaled) {
    assert.equal(
      chemicalStock(line.chemicalId),
      before.get(line.chemicalId)! - line.neededMilli,
      `${line.chemicalName} should fall by exactly ${line.neededMilli}`,
    );
  }

  // Every deduction went through the ledger, tagged to this batch.
  const posted = all<{ delta_milli: number; reason: string }>(
    `SELECT delta_milli, reason FROM stock_movements WHERE ref_type = 'batch' AND ref_id = ?`,
    result.batchId,
  );
  assert.ok(posted.length > 0);
  assert.ok(posted.every((m) => m.reason === "batch_consume" && m.delta_milli < 0));
  assert.equal(ledgerSnapshot().length, movementsBefore + posted.length);

  // The batch pins the VERSION, never a bare formula id.
  const batch = get<{ formula_version_id: number; actual_milli: number | null; target_milli: number }>(
    `SELECT formula_version_id, actual_milli, target_milli FROM batches WHERE id = ?`,
    result.batchId,
  )!;
  assert.equal(batch.formula_version_id, version.id);
  assert.equal(batch.target_milli, target);
  assert.equal(batch.actual_milli, null, "yield is unknown until it is measured");

  const lines = all<{ chemical_id: number; qty_milli: number }>(
    `SELECT chemical_id, qty_milli FROM batch_lines WHERE batch_id = ? ORDER BY id`,
    result.batchId,
  );
  assert.deepEqual(
    lines.map((l) => [l.chemical_id, l.qty_milli]).sort(),
    scaled.map((l) => [l.chemicalId, l.neededMilli]).sort(),
  );
});

test("actual yield is recorded against the batch and books the measured litres, not the target", () => {
  const version = versionOf("Jik");
  const target = toMilli(20);
  const { batchId } = runBatch({ formulaVersionId: version.id, targetMilli: target, userId: OWNER });

  const bottle = get<{ id: number }>(`SELECT id FROM items WHERE name = 'Jik 1 L'`)!;
  const before = all<{ q: number }>(
    `SELECT COALESCE(SUM(delta_milli), 0) AS q FROM stock_movements WHERE item_id = ?`,
    bottle.id,
  )[0].q;

  const { varianceMilli } = recordYield({
    batchId,
    actualMilli: toMilli(19.4), // 600 ml stayed in the tank
    outputItemId: bottle.id,
    userId: OWNER,
  });

  assert.equal(varianceMilli, toMilli(-0.6));
  assert.equal(
    get<{ actual_milli: number }>(`SELECT actual_milli FROM batches WHERE id = ?`, batchId)!.actual_milli,
    toMilli(19.4),
  );

  const after = all<{ q: number }>(
    `SELECT COALESCE(SUM(delta_milli), 0) AS q FROM stock_movements WHERE item_id = ?`,
    bottle.id,
  )[0].q;
  assert.equal(after - before, toMilli(19.4), "finished stock is the measured yield, not 20 L");

  assert.throws(
    () => recordYield({ batchId, actualMilli: toMilli(19.4), userId: OWNER }),
    /already been recorded/,
    "a second yield entry would double-count the finished stock",
  );
});

// ----------------------------------------------------------- (d) short stock

test("a batch that exceeds available stock is rejected and leaves the ledger untouched", () => {
  const version = versionOf("Shower Gel");
  // Perfume runs out long before anything else at this size.
  const target = toMilli(5000);

  const plan = planBatch(version.id, target);
  assert.equal(plan.ok, false);
  assert.ok(plan.short.length > 0);

  const ledgerBefore = ledgerSnapshot();
  const batchesBefore = get<{ n: number }>(`SELECT COUNT(*) AS n FROM batches`)!.n;
  const linesBefore = get<{ n: number }>(`SELECT COUNT(*) AS n FROM batch_lines`)!.n;

  assert.throws(
    () => runBatch({ formulaVersionId: version.id, targetMilli: target, userId: OWNER }),
    (err: unknown) => err instanceof StockShortError && err.short.length > 0,
  );

  // Nothing moved — not even the ingredients that WERE in stock. A partial
  // deduction here would be the transaction failing to roll back.
  assert.deepEqual(ledgerSnapshot(), ledgerBefore, "no stock movement survived the rejection");
  assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM batches`)!.n, batchesBefore);
  assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM batch_lines`)!.n, linesBefore);
});

// -------------------------------------------------------------- (e) versions

test("editing a formula creates version 2 and leaves version 1's rows untouched", () => {
  const target = formula("Carwash Shampoo");
  const v1 = currentVersion(target.id)!;
  assert.equal(v1.version, 1);

  // Spread the rows: node:sqlite hands back null-prototype objects, which a
  // strict deep-equal will not match against a plain one.
  const v1Before = { ...get<Record<string, unknown>>(`SELECT * FROM formula_versions WHERE id = ?`, v1.id)! };
  const v1ItemsBefore = all(`SELECT * FROM formula_items WHERE formula_version_id = ? ORDER BY id`, v1.id);
  assert.ok(v1ItemsBefore.length > 0);

  const edited = formulaItems(v1.id).map((i) => ({ chemicalId: i.chemical_id, qtyMilli: i.qty_milli }));
  edited[0].qtyMilli += toMilli(0.25);

  const { versionId, version } = createFormulaVersion({
    formulaId: target.id,
    refSizeMilli: v1.ref_size_milli,
    steps: v1.steps,
    note: "Caustic quantity confirmed with the owner.",
    items: edited,
    userId: OWNER,
  });

  assert.equal(version, 2);

  const v2 = currentVersion(target.id)!;
  assert.equal(v2.id, versionId);
  assert.equal(v2.version, 2);
  assert.equal(v2.is_current, 1);

  // Version 1 is byte-identical apart from losing the "current" flag: past
  // batches point at it and must still describe what they were made of.
  const v1After = get<Record<string, unknown>>(`SELECT * FROM formula_versions WHERE id = ?`, v1.id)!;
  assert.equal(v1After.is_current, 0);
  assert.deepEqual({ ...v1After, is_current: 1 }, v1Before);

  assert.deepEqual(
    all(`SELECT * FROM formula_items WHERE formula_version_id = ? ORDER BY id`, v1.id),
    v1ItemsBefore,
    "version 1's ingredient rows are never rewritten",
  );

  // The edit is only visible on the new version.
  const v2Items = formulaItems(versionId);
  assert.equal(v2Items[0].qty_milli, edited[0].qtyMilli);
  assert.equal(
    all<{ n: number }>(`SELECT COUNT(*) AS n FROM formula_versions WHERE formula_id = ?`, target.id)[0].n,
    2,
  );
});

test("a batch mixed on version 1 still points at version 1 after the recipe is edited", () => {
  const target = formula("Multipurpose");
  const v1 = currentVersion(target.id)!;

  const { batchId } = runBatch({
    formulaVersionId: v1.id,
    targetMilli: toMilli(20),
    userId: OWNER,
  });

  createFormulaVersion({
    formulaId: target.id,
    refSizeMilli: v1.ref_size_milli,
    steps: v1.steps,
    note: "",
    items: formulaItems(v1.id).map((i) => ({ chemicalId: i.chemical_id, qtyMilli: i.qty_milli * 2 })),
    userId: OWNER,
  });

  assert.equal(
    get<{ formula_version_id: number }>(`SELECT formula_version_id FROM batches WHERE id = ?`, batchId)!
      .formula_version_id,
    v1.id,
  );
});

// ------------------------------------------------------------------- search

test("search matches an ingredient as well as the product name", () => {
  const byIngredient = listFormulas("magadi").map((f) => f.name);
  assert.ok(byIngredient.includes("Jik"), "Jik is made with magadi");
  assert.ok(byIngredient.includes("Degreaser"), "Degreaser is made with magadi");
  assert.ok(!byIngredient.includes("Shampoo"), "Shampoo has no magadi in it");

  // Aliases count too — the shop calls magadi "soda ash" half the time.
  assert.ok(listFormulas("soda ash").some((f) => f.name === "Jik"));

  // Renamed from "Harpic" at the owner's request — that's another company's
  // brand. Both confirmed methods are on file.
  assert.deepEqual(
    listFormulas("toilet").map((f) => f.name).sort(),
    ["Toilet Cleaner", "Toilet Cleaner (thickened)"],
  );
  assert.equal(listFormulas("").length, 14, "the shop has 14 formulas on file");
});

test("the staff product picker carries no recipe, and readiness needs no ingredient rows", () => {
  const products = listMixableProducts();
  assert.equal(products.length, 14);
  for (const p of products) {
    // Anything a competitor could use — the note, even the ingredient count —
    // must not be in the list staff receive.
    assert.deepEqual(Object.keys({ ...p }).sort(), [
      "id",
      "name",
      "ref_size_milli",
      "version",
      "version_id",
    ]);
  }

  const jik = versionOf("Jik");
  assert.deepEqual(batchReadiness(jik.id, toMilli(20)), {
    ok: true,
    shortCount: 0,
    tooSmall: false,
  });

  const showerGel = versionOf("Shower Gel");
  const short = batchReadiness(showerGel.id, toMilli(5000));
  assert.equal(short.ok, false);
  assert.ok(short.shortCount > 0);

  // Half a litre of Shower Gel would round 10 ml of pine oil away to nothing.
  assert.equal(batchReadiness(showerGel.id, toMilli(0.5)).tooSmall, true);
  assert.equal(minimumTargetMilli(showerGel.id), toMilli(1));
});

test("the batch list only carries a cost when the owner asked for one", () => {
  const forOwner = listBatches(5, true);
  assert.ok(forOwner.length > 0);
  assert.ok(forOwner.every((b) => typeof b.cost_cents === "number"));
  assert.ok(forOwner.every((b) => typeof b.batch_no === "string" && b.version >= 1));

  const forStaff = listBatches(5, false);
  assert.ok(forStaff.every((b) => !("cost_cents" in b)), "staff must not receive a batch cost");

  // Anything mixed but not yet measured is waiting for its yield.
  const waiting = pendingYieldBatches();
  assert.ok(waiting.every((b) => b.actual_milli === null && b.status === "completed"));
});

test("a finished item is only suggested when it is unmistakably the same product", () => {
  const jik = outputItemsFor("Jik");
  assert.deepEqual(
    jik.filter((o) => o.suggested).map((o) => o.name),
    ["Jik 1 L"],
  );

  // "Jik Coloured" is a different product; suggesting Jik 1 L would inflate the
  // stock of something that was never made.
  assert.deepEqual(outputItemsFor("Jik Coloured").filter((o) => o.suggested), []);

  assert.deepEqual(
    outputItemsFor("Laundry Soap")
      .filter((o) => o.suggested)
      .map((o) => o.name),
    ["Laundry Soap 1 L", "Laundry Soap 5 L"],
  );

  // Everything is still selectable by hand, suggestions first.
  assert.ok(outputItemsFor("Jik Coloured").length > 0);
});

test("batch numbers increment within a business day and never collide", () => {
  const at = new Date("2027-01-05T09:00:00Z");
  const first = newBatchNo(at);
  assert.equal(first, "RZK-20270105-001");

  const version = versionOf("Jik");
  runBatch({ formulaVersionId: version.id, targetMilli: toMilli(20), userId: OWNER });

  const taken = all<{ batch_no: string }>(`SELECT batch_no FROM batches`).map((b) => b.batch_no);
  assert.equal(new Set(taken).size, taken.length, "batch numbers are unique");
});

// -------------------------------------------------------------- (h) voiding

test("voiding a batch restores every chemical and the booked output, and stays visible", () => {
  const version = versionOf("Jik");
  const target = toMilli(20);
  const scaled = scaleFormula(version.id, target);
  const before = new Map(scaled.map((l) => [l.chemicalId, chemicalStock(l.chemicalId)]));

  const bottle = get<{ id: number }>(`SELECT id FROM items WHERE name = 'Jik 1 L'`)!;
  const bottleBefore = ledgerSnapshot()
    .filter((m) => m.item_id === bottle.id)
    .reduce((s, m) => s + m.delta_milli, 0);

  const { batchId } = runBatch({ formulaVersionId: version.id, targetMilli: target, userId: OWNER });
  recordYield({ batchId, actualMilli: toMilli(19), outputItemId: bottle.id, userId: OWNER });

  voidBatch(batchId, OWNER, "meant 2 L, typed 20 L");

  // Every chemical is back where it started.
  for (const line of scaled) {
    assert.equal(chemicalStock(line.chemicalId), before.get(line.chemicalId)!,
      `${line.chemicalName} should be restored`);
  }
  // The finished stock the yield created is gone again.
  const bottleAfter = ledgerSnapshot()
    .filter((m) => m.item_id === bottle.id)
    .reduce((s, m) => s + m.delta_milli, 0);
  assert.equal(bottleAfter, bottleBefore, "booked output is reversed");

  // Nothing was deleted: the reversals are new rows pointing at the batch.
  const reversals = all<{ delta_milli: number; reason: string }>(
    `SELECT delta_milli, reason FROM stock_movements WHERE ref_type = 'batch_void' AND ref_id = ?`,
    batchId,
  );
  assert.ok(reversals.length >= scaled.length + 1, "consumes + output all reversed");
  assert.ok(reversals.every((m) => m.reason === "adjustment"));

  assert.equal(get<{ status: string }>(`SELECT status FROM batches WHERE id = ?`, batchId)!.status, "voided");

  // Voiding twice is refused, as is voiding without a reason.
  assert.throws(() => voidBatch(batchId, OWNER, "again"), /already voided/i);
  assert.throws(() => voidBatch(99999, OWNER, "x"), /no longer exists/i);
});

test("a void without a reason is refused before anything moves", () => {
  const version = versionOf("Jik");
  const { batchId } = runBatch({ formulaVersionId: version.id, targetMilli: toMilli(20), userId: OWNER });
  const before = ledgerSnapshot().length;
  assert.throws(() => voidBatch(batchId, OWNER, "   "), /why/i);
  assert.equal(ledgerSnapshot().length, before, "nothing was written");
  voidBatch(batchId, OWNER, "cleanup"); // leave the fixture tidy
});

// ------------------------------------------------------------------ (k) kits

test("a kit turns a recipe into whole packs, never short, and says what is missing", () => {
  const version = versionOf("Shower Gel");
  const kit = buildKit(version.id, toMilli(20));

  assert.equal(kit.targetMilli, toMilli(20));
  assert.ok(kit.ingredients.length > 0, "a kit has the recipe's ingredients");

  for (const ing of kit.ingredients) {
    if (ing.missing) {
      assert.equal(ing.picks.length, 0, "nothing is picked for a chemical with no pack");
      assert.equal(ing.suppliedMilli, 0);
      continue;
    }

    // Whole units of real, sellable items — the sale stays an ordinary sale.
    for (const p of ing.picks) {
      assert.ok(Number.isInteger(p.units) && p.units > 0, `${p.name} must be whole packs`);
      const item = get<{ kind: string; sellable: number; active: number; size_milli: number }>(
        `SELECT kind, sellable, active, size_milli FROM items WHERE id = ?`,
        p.itemId,
      );
      assert.equal(item!.kind, "pack");
      assert.equal(item!.sellable, 1);
      assert.equal(item!.active, 1);
      assert.equal(item!.size_milli, p.sizeMilli);
    }

    const supplied = ing.picks.reduce((s, p) => s + p.sizeMilli * p.units, 0);
    assert.equal(supplied, ing.suppliedMilli, "the stated total is the packs' total");
    assert.ok(
      ing.suppliedMilli >= ing.neededMilli,
      `${ing.chemicalName}: a kit must never be short (${ing.suppliedMilli} < ${ing.neededMilli})`,
    );
  }
});

test("doubling the batch size doubles what the kit asks for", () => {
  const version = versionOf("Shower Gel");
  const small = buildKit(version.id, toMilli(20));
  const big = buildKit(version.id, toMilli(40));

  for (const [i, ing] of small.ingredients.entries()) {
    assert.equal(big.ingredients[i].chemicalId, ing.chemicalId);
    assert.equal(big.ingredients[i].neededMilli, ing.neededMilli * 2);
  }
});

test("a kit prefers one pack over three that weigh the same", () => {
  // 800 g from 1 kg / 500 g / 250 g packs: largest-first gives 500+250+250,
  // which is the same kilogram in three packs. One 1 kg pack wins.
  const { lastInsertRowid: chem } = run(
    `INSERT INTO chemicals (name, canonical_unit) VALUES ('Kit Test Powder', 'kg')`,
  );
  for (const [size, label] of [[1000, "1 kg"], [500, "500 g"], [250, "250 g"]] as const) {
    run(
      `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                          sellable, retail_cents, active)
       VALUES (?, ?, 'pack', 'kg', ?, 'pack', 1, 100, 1)`,
      chem,
      `Kit Test Powder — ${label}`,
      size,
    );
  }

  const packs = all<{ id: number; name: string; size_milli: number }>(
    `SELECT id, name, size_milli FROM items WHERE chemical_id = ? ORDER BY size_milli DESC`,
    chem,
  );
  assert.equal(packs.length, 3);

  // buildKit works from a formula, so exercise the same rule through one: a
  // recipe needing 800 g of this powder.
  const { lastInsertRowid: f } = run(`INSERT INTO formulas (name) VALUES ('Kit Test Formula')`);
  const { lastInsertRowid: v } = run(
    `INSERT INTO formula_versions (formula_id, version, ref_size_milli, is_current)
     VALUES (?, 1, ?, 1)`,
    f,
    toMilli(20),
  );
  run(
    `INSERT INTO formula_items (formula_version_id, chemical_id, qty_milli, sort_order)
     VALUES (?, ?, 800, 1)`,
    v,
    chem,
  );

  const kit = buildKit(Number(v), toMilli(20));
  const ing = kit.ingredients[0];
  assert.equal(ing.neededMilli, 800);
  assert.equal(ing.suppliedMilli, 1000, "rounds up to a kilogram");
  assert.equal(ing.picks.length, 1, "one pack, not three");
  assert.equal(ing.picks[0].units, 1);
  assert.equal(ing.picks[0].sizeMilli, 1000);
});

test("a kit refuses to bill 5 kg for a recipe that needs 25 g", () => {
  // The real case from the shop's own Carwash Shampoo: C.D.E is stocked in
  // 5 kg packs and the recipe wants 25 g. Rounding up is fine at 1.5 kg; at
  // two hundred times the requirement it is a bill nobody would pay, so the
  // ingredient is flagged and left out rather than added silently.
  const { lastInsertRowid: chem } = run(
    `INSERT INTO chemicals (name, canonical_unit) VALUES ('Overshoot Test Gum', 'kg')`,
  );
  run(
    `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, retail_cents, active)
     VALUES (?, 'Overshoot Test Gum — 5 kg', 'pack', 'kg', 5000, 'pack', 1, 100, 1)`,
    chem,
  );

  const { lastInsertRowid: f } = run(`INSERT INTO formulas (name) VALUES ('Overshoot Test Formula')`);
  const { lastInsertRowid: v } = run(
    `INSERT INTO formula_versions (formula_id, version, ref_size_milli, is_current)
     VALUES (?, 1, ?, 1)`,
    f,
    toMilli(20),
  );
  run(
    `INSERT INTO formula_items (formula_version_id, chemical_id, qty_milli, sort_order)
     VALUES (?, ?, 25, 1)`,
    v,
    chem,
  );

  const ing = buildKit(Number(v), toMilli(20)).ingredients[0];
  assert.equal(ing.neededMilli, 25);
  assert.equal(ing.missing, false, "there IS a pack — it is just far too big");
  assert.equal(ing.oversized, true);
  assert.equal(ing.suppliedMilli, 5000, "the smallest pack is still reported, so it can be shown");

  // And ordinary rounding is not flagged: 1.5 kg from 1 kg packs is 2 kg.
  const { lastInsertRowid: chem2 } = run(
    `INSERT INTO chemicals (name, canonical_unit) VALUES ('Overshoot Test Flour', 'kg')`,
  );
  run(
    `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, retail_cents, active)
     VALUES (?, 'Overshoot Test Flour — 1 kg', 'pack', 'kg', 1000, 'pack', 1, 100, 1)`,
    chem2,
  );
  run(
    `INSERT INTO formula_items (formula_version_id, chemical_id, qty_milli, sort_order)
     VALUES (?, ?, 1500, 2)`,
    v,
    chem2,
  );

  const flour = buildKit(Number(v), toMilli(20)).ingredients.find(
    (i) => i.chemicalName === "Overshoot Test Flour",
  )!;
  assert.equal(flour.suppliedMilli, 2000);
  assert.equal(flour.oversized, false, "2 kg for 1.5 kg is ordinary shopkeeping");
});
