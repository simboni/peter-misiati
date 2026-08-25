/**
 * Recipes: scaling, versioning, and what a recipe comes to at the counter.
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

const { all, get, run } = await import("../src/lib/db.ts");
const { seed } = await import("../src/lib/seed.ts");
const { toMilli, toCents } = await import("../src/lib/units.ts");
const {
  scaleFormula,
  createFormula,
  createFormulaVersion,
  currentVersion,
  formulaItems,
  listFormulas,
  minimumTargetMilli,
  mixFor,
  salesUsingVersion,
  versionsOf,
} = await import("../src/lib/production.ts");
const { recordSale } = await import("../src/lib/sales.ts");

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

/** The one sellable row a chemical has: its container, priced per kg / L. */
function sourceRow(chemicalName: string) {
  const row = get<{ id: number; price_cents: number; canonical_unit: string }>(
    `SELECT i.id, i.price_cents, i.canonical_unit
       FROM items i JOIN chemicals c ON c.id = i.chemical_id
      WHERE c.name = ? AND i.price_basis = 'unit'`,
    chemicalName,
  );
  assert.ok(row, `${chemicalName} should have one unit-priced row`);
  return row!;
}

// ------------------------------------------------------------ a new recipe

test("a recipe can be written from nothing, and comes out as version 1", () => {
  const magadi = get<{ id: number }>(`SELECT id FROM chemicals WHERE name = 'Magadi'`)!;
  const salt = get<{ id: number }>(`SELECT id FROM chemicals WHERE name = 'Salt'`)!;

  const { formulaId } = createFormula({
    name: "Test Bench Cleaner",
    refSizeMilli: toMilli(20),
    steps: "Dissolve the magadi first.",
    note: "",
    items: [
      { chemicalId: magadi.id, qtyMilli: toMilli(2) },
      { chemicalId: salt.id, qtyMilli: toMilli(0.5) },
    ],
    userId: OWNER,
  });

  const version = currentVersion(formulaId);
  assert.ok(version, "the name and its first version are written together");
  assert.equal(version!.version, 1);
  assert.equal(version!.ref_size_milli, toMilli(20));

  const items = formulaItems(version!.id);
  assert.equal(items.length, 2);
  assert.equal(items[0].qty_milli, toMilli(2), "in the order they were given");

  assert.ok(
    listFormulas("bench").some((f) => f.id === formulaId),
    "and it is on the recipe list straight away",
  );
});

test("a new recipe is scaled by the counter like any other", () => {
  const id = formula("Test Bench Cleaner").id;
  const lines = scaleFormula(currentVersion(id)!.id, toMilli(60));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].neededMilli, toMilli(6), "three times the batch, three times the magadi");
});

test("a second recipe cannot take a name the book already uses", () => {
  const magadi = get<{ id: number }>(`SELECT id FROM chemicals WHERE name = 'Magadi'`)!;
  const again = () =>
    createFormula({
      name: "test bench cleaner", // same name, different case
      refSizeMilli: toMilli(20),
      steps: "",
      note: "",
      items: [{ chemicalId: magadi.id, qtyMilli: toMilli(1) }],
      userId: OWNER,
    });

  assert.throws(again, /already a recipe called/i);
  assert.equal(
    all(`SELECT id FROM formulas WHERE lower(name) = 'test bench cleaner'`).length,
    1,
    "and the refused one left nothing behind",
  );
});

test("a recipe with no name, or no ingredients, is refused before anything is written", () => {
  const magadi = get<{ id: number }>(`SELECT id FROM chemicals WHERE name = 'Magadi'`)!;
  const before = all(`SELECT id FROM formulas`).length;

  assert.throws(
    () =>
      createFormula({
        name: "   ",
        refSizeMilli: toMilli(20),
        steps: "",
        note: "",
        items: [{ chemicalId: magadi.id, qtyMilli: toMilli(1) }],
        userId: OWNER,
      }),
    /name/i,
  );

  assert.throws(
    () =>
      createFormula({
        name: "Test Nothing In It",
        refSizeMilli: toMilli(20),
        steps: "",
        note: "",
        items: [],
        userId: OWNER,
      }),
    /at least one ingredient/i,
  );

  assert.equal(all(`SELECT id FROM formulas`).length, before, "no half-written recipe");
});

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

// --------------------------------------------------- (b) a recipe, priced up

test("a recipe is billed as its chemicals, weighed and priced per kilogram", () => {
  const version = versionOf("Carwash Shampoo");
  const mix = mixFor(version.id, version.ref_size_milli);

  assert.equal(mix.ingredients.length, formulaItems(version.id).length);
  assert.ok(mix.sellable, "the seeded shop can supply its own reference batch");

  for (const ing of mix.ingredients) {
    const source = sourceRow(ing.chemicalName);
    assert.equal(ing.itemId, source.id, `${ing.chemicalName} comes out of its own container`);
    assert.equal(ing.rateCents, source.price_cents, "the rate is the item's own price per unit");
    assert.equal(
      ing.amountCents,
      Math.round((ing.rateCents * ing.qtyMilli) / 1000),
      `${ing.chemicalName} is charged for exactly what the recipe asks for`,
    );
  }

  assert.equal(
    mix.totalCents,
    mix.ingredients.reduce((s, i) => s + i.amountCents, 0),
    "the total is the sum of its lines and nothing else",
  );
});

test("the quantity a recipe needs is not rounded up to anything", () => {
  /*
    This is the whole point of the change. Carwash Shampoo asks for one gram of
    C.D.E in a 20 L batch, and the smallest tub of C.D.E the shop ever stocked
    was 5 kg — so the pack-filling this replaced could not sell that batch at
    all: it would have billed 5 kg for the 25 g the recipe wanted, two hundred
    times too much, and the screen refused rather than do that.
  */
  const version = versionOf("Carwash Shampoo");
  const mix = mixFor(version.id, toMilli(20));

  const cde = mix.ingredients.find((i) => i.chemicalName === "C.D.E");
  assert.ok(cde, "Carwash Shampoo contains C.D.E");
  assert.equal(cde!.qtyMilli, 25, "25 g, to the gram");
  assert.ok(cde!.amountCents > 0, "and it is charged for");
  assert.ok(cde!.amountCents < 10_000, "at grams-worth of money, not a whole tub's");
});

test("doubling the batch doubles the quantities and the bill", () => {
  const version = versionOf("Shower Gel");
  const one = mixFor(version.id, toMilli(20));
  const two = mixFor(version.id, toMilli(40));

  for (const line of two.ingredients) {
    const half = one.ingredients.find((i) => i.chemicalName === line.chemicalName)!;
    assert.equal(line.qtyMilli, half.qtyMilli * 2, `${line.chemicalName} doubles`);
  }
  // Each line is rounded once, so the totals may differ by a cent per line at
  // most — never by a shilling, and never systematically.
  assert.ok(Math.abs(two.totalCents - one.totalCents * 2) <= two.ingredients.length);
});

test("a recipe is priced the same however it is billed", () => {
  /*
    There is one price. A recipe used to be priced twice — once at retail and
    once at wholesale — which meant two answers to "what will twenty litres cost
    me" and an attendant choosing between them with a customer waiting. The
    concession now happens on the line, inside the band, and is recorded as a
    discount rather than hidden in which list was open.
  */
  const version = versionOf("Handwash");
  const once = mixFor(version.id, toMilli(20));
  const again = mixFor(version.id, toMilli(20));

  assert.equal(once.totalCents, again.totalCents);
  for (const line of once.ingredients) {
    assert.ok(line.rateCents > 0, `${line.chemicalName} is never given away`);
  }
});

test("a batch bigger than the store can supply says how big a batch it can", () => {
  const version = versionOf("Shower Gel");
  const huge = mixFor(version.id, toMilli(500_000));

  assert.equal(huge.sellable, false);
  assert.ok(huge.ingredients.some((i) => i.short), "something has run out");
  assert.ok(huge.possibleMilli > 0, "and there is still a batch size that works");

  const offered = mixFor(version.id, huge.possibleMilli);
  assert.ok(
    offered.ingredients.every((i) => !i.short),
    "the size it offers is one the store can actually supply",
  );
});

test("an unpriced ingredient is named, and no batch size hides it", () => {
  const chemId = Number(
    run(`INSERT INTO chemicals (name, canonical_unit) VALUES ('Test Unpriced', 'kg')`).lastInsertRowid,
  );
  run(
    `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, price_basis, price_cents)
     VALUES (?, 'Test Unpriced', 'bulk', 'kg', 25000, 'bag', 1, 'unit', 0)`,
    chemId,
  );
  run(`INSERT INTO stock_movements (item_id, delta_milli, reason)
       VALUES ((SELECT id FROM items WHERE chemical_id = ?), 25000, 'opening')`, chemId);

  const fId = Number(run(`INSERT INTO formulas (name) VALUES ('Test Unpriced Recipe')`).lastInsertRowid);
  const vId = Number(
    run(`INSERT INTO formula_versions (formula_id, version, ref_size_milli) VALUES (?, 1, 20000)`, fId)
      .lastInsertRowid,
  );
  run(`INSERT INTO formula_items (formula_version_id, chemical_id, qty_milli) VALUES (?, ?, 500)`, vId, chemId);

  const mix = mixFor(vId, toMilli(20));
  assert.equal(mix.sellable, false);
  assert.equal(mix.ingredients[0].unpriced, true);
  assert.equal(mix.ingredients[0].amountCents, 0, "an unpriced chemical is never billed at zero");
  assert.equal(mix.possibleMilli, 0, "no batch size fixes a missing price");
});

// -------------------------------------------------------------- (c) versions

test("editing a recipe that has been SOLD creates version 2 and leaves version 1 untouched", () => {
  const target = formula("Carwash Shampoo");
  const v1 = currentVersion(target.id)!;
  assert.equal(v1.version, 1);

  // Spread the rows: node:sqlite hands back null-prototype objects, which a
  // strict deep-equal will not match against a plain one.
  const v1Before = { ...get<Record<string, unknown>>(`SELECT * FROM formula_versions WHERE id = ?`, v1.id)! };
  const v1ItemsBefore = all(`SELECT * FROM formula_items WHERE formula_version_id = ? ORDER BY id`, v1.id);
  assert.ok(v1ItemsBefore.length > 0);

  // Sell one batch against version 1 first. Until a customer has been charged
  // for it, the version is only a piece of writing and an edit corrects it
  // where it stands — see the two tests at the end of this file.
  const mix = mixFor(v1.id, toMilli(20));
  recordSale({
    clientUuid: "version-guard-1",
    userId: OWNER,
    tier: "retail",
    lines: mix.ingredients.map((i) => ({
      itemId: i.itemId!,
      units: 1,
      unitPriceCents: i.rateCents,
      qtyMilli: i.qtyMilli,
      formulaVersionId: v1.id,
    })),
    tenders: [{ method: "cash", amountCents: mix.totalCents }],
  });
  assert.ok(salesUsingVersion(v1.id) > 0, "the sale is what makes the version history");

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
  // sales point at it and must still describe what the customer was charged for.
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

  // And the version history says which one carries the sale.
  const history = versionsOf(target.id);
  assert.equal(history.find((v) => v.id === v1.id)!.use_count, 1);
  assert.equal(history.find((v) => v.id === versionId)!.use_count, 0);
});

test("a sale billed on version 1 still points at version 1 after the recipe is edited", () => {
  const target = formula("Multipurpose");
  const v1 = currentVersion(target.id)!;

  const mix = mixFor(v1.id, toMilli(20));
  const { saleId } = recordSale({
    clientUuid: "version-guard-2",
    userId: OWNER,
    tier: "retail",
    lines: mix.ingredients.map((i) => ({
      itemId: i.itemId!,
      units: 1,
      unitPriceCents: i.rateCents,
      qtyMilli: i.qtyMilli,
      formulaVersionId: v1.id,
    })),
    tenders: [{ method: "cash", amountCents: mix.totalCents }],
  });

  createFormulaVersion({
    formulaId: target.id,
    refSizeMilli: v1.ref_size_milli,
    steps: v1.steps,
    note: "",
    items: formulaItems(v1.id).map((i) => ({ chemicalId: i.chemical_id, qtyMilli: i.qty_milli * 2 })),
    userId: OWNER,
  });

  const pinned = all<{ formula_version_id: number }>(
    `SELECT DISTINCT formula_version_id FROM sale_lines WHERE sale_id = ?`,
    saleId,
  );
  assert.deepEqual(pinned.map((p) => p.formula_version_id), [v1.id]);
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
  // Filtered, because other tests in this file add recipes of their own.
  const shopFormulas = listFormulas("").filter((f) => !f.name.startsWith("Test "));
  assert.equal(shopFormulas.length, 14, "the shop has 14 formulas on file");
});

test("the smallest accurate batch still holds", () => {
  // Nothing about weighing removes this: below a certain batch the tiniest
  // ingredient rounds away to nothing, and a recipe missing an ingredient is
  // not the recipe. Half a litre of Shower Gel would lose its pine oil.
  const showerGel = versionOf("Shower Gel");
  assert.equal(minimumTargetMilli(showerGel.id), toMilli(1));
});

// ----------------------------------------------------- correcting a new shop

/*
 * The shop was delivered with placeholder recipes, and the owner has to correct
 * them before the first sale. Forking a version each time would walk a product
 * nobody has been charged for to "version 6" and make the number meaningless.
 * The rule is about protecting what a customer paid, so it only has to bite
 * once somebody has paid.
 */
test("editing a recipe nobody has been charged for corrects it in place", () => {
  const target = formula("Handwash");
  const before = currentVersion(target.id)!;
  const chemicalId = formulaItems(before.id)[0].chemical_id;

  const first = createFormulaVersion({
    formulaId: target.id,
    refSizeMilli: toMilli(20),
    steps: "corrected steps",
    note: "",
    items: [{ chemicalId, qtyMilli: toMilli(3) }],
    userId: OWNER,
  });
  assert.equal(first.corrected, true, "a never-sold recipe should be corrected, not forked");
  assert.equal(first.version, before.version, "the version number should not move");
  assert.equal(first.versionId, before.id, "it should be the same row");

  // Correcting again also stays put, and leaves no orphan ingredient behind.
  const second = createFormulaVersion({
    formulaId: target.id,
    refSizeMilli: toMilli(20),
    steps: "corrected twice",
    note: "",
    items: [{ chemicalId, qtyMilli: toMilli(4) }],
    userId: OWNER,
  });
  assert.equal(second.version, before.version);
  const items = formulaItems(second.versionId as number);
  assert.equal(items.length, 1, "the previous ingredient list must be replaced, not appended to");
  assert.equal(items[0].qty_milli, toMilli(4));
  assert.equal(all("SELECT id FROM formula_versions WHERE formula_id = ?", target.id).length, 1,
    "no extra versions should have been created");
});

test("a recipe with no sellable chemical at all is refused by name", () => {
  const chemId = Number(
    run(`INSERT INTO chemicals (name, canonical_unit) VALUES ('Test Unlisted', 'kg')`).lastInsertRowid,
  );
  const fId = Number(run(`INSERT INTO formulas (name) VALUES ('Test Unlisted Recipe')`).lastInsertRowid);
  const vId = Number(
    run(`INSERT INTO formula_versions (formula_id, version, ref_size_milli) VALUES (?, 1, 20000)`, fId)
      .lastInsertRowid,
  );
  run(`INSERT INTO formula_items (formula_version_id, chemical_id, qty_milli) VALUES (?, ?, 500)`, vId, chemId);

  const mix = mixFor(vId, toMilli(20));
  assert.equal(mix.ingredients[0].unlisted, true);
  assert.equal(mix.ingredients[0].itemId, null);
  assert.equal(mix.sellable, false);
  assert.equal(mix.possibleMilli, 0);
  // Still named, so the owner knows which row to add rather than being told
  // "this recipe cannot be sold" with no way forward.
  assert.equal(mix.ingredients[0].chemicalName, "Test Unlisted");
  assert.ok(toCents(0) === 0);
});
