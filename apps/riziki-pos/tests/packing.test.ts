/**
 * Filling the mild into jerricans, and counting them.
 *
 * The thing every test here is really checking is one sentence: what is packed
 * is a SHARE of what is held, never a second pile beside it. So the total in
 * kilogrammes must come out the same before and after every fill, every
 * opening, and every rearrangement — and it must be impossible to claim more in
 * containers than the shop actually has.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "pack-")), "t.db");

import test from "node:test";
import assert from "node:assert/strict";
const { seed } = await import("../src/lib/seed.ts");
const { get, all, run, stockOf } = await import("../src/lib/db.ts");
const { createProduct } = await import("../src/lib/catalog.ts");
const { saveBundles, itemBundles } = await import("../src/lib/bundles.ts");
const { packState, setPacked, fill, filledCounts, looseMilli, PackError } = await import(
  "../src/lib/packing.ts"
);

seed();
const OWNER = 1;

const mildId = createProduct({
  name: "Hypochlorite mild",
  unit: "kg",
  containerValue: 23,
  containerLabel: "jerrican",
  price: 320,
  floor: 0,
  ceiling: 0,
  aliases: "",
  byUserId: OWNER,
});
saveBundles({ itemId: mildId }, [
  { sizeMilli: 23_000, priceCents: 700_000, floorCents: 0 },
  { sizeMilli: 5_000, priceCents: 160_000, floorCents: 0 },
  { sizeMilli: 1_000, priceCents: 34_000, floorCents: 0 },
]);
const sizes = itemBundles(mildId);
const size = (milli: number) => sizes.find((b) => b.sizeMilli === milli)!.id;

/** 46 kg of mild on the shelf, as one batch would have put it there. */
run(
  `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id, note)
   VALUES (?, 46000, 'batch_output', ?, 'two 23s mixed')`,
  mildId,
  OWNER,
);

test("a product is not counted in containers until the owner says so", () => {
  const s = packState(mildId);
  assert.equal(s.packed, false);
  assert.equal(s.stockMilli, 46_000);
  assert.equal(s.packedMilli, 0);
  assert.equal(s.looseMilli, 46_000, "all of it is loose until somebody pours it");
  assert.throws(() => fill(mildId, [{ bundleId: size(23_000), delta: 1 }], OWNER), PackError);
});

test("turning it on needs the sizes to exist first", () => {
  const plainId = createProduct({
    name: "Ungerol (weighed out, never pre-filled)",
    unit: "kg",
    containerValue: 25,
    containerLabel: "bag",
    price: 200,
    floor: 0,
    ceiling: 0,
    aliases: "",
    byUserId: OWNER,
  });
  assert.throws(
    () => setPacked(plainId, true, OWNER),
    (e: Error) => e instanceof PackError && /no container sizes/.test(e.message),
  );
});

test("filling two 23 kg jerricans moves no stock at all", () => {
  setPacked(mildId, true, OWNER);
  const before = stockOf(mildId);

  const res = fill(mildId, [{ bundleId: size(23_000), delta: 2 }], OWNER);

  assert.equal(stockOf(mildId), before, "the shelf still holds exactly what it held");
  assert.equal(res.looseMilli, 0, "and all of it is now in jerricans");

  const s = packState(mildId);
  assert.equal(s.stockMilli, 46_000);
  assert.equal(s.packedMilli, 46_000);
  assert.equal(s.looseMilli, 0);
  assert.equal(s.sizes.find((x) => x.sizeMilli === 23_000)!.filled, 2);
});

test("opening one 23 and pouring it into 5s and 1s, in a single act", () => {
  const before = stockOf(mildId);

  // One 23 kg opened; four 5 kg and three 1 kg filled from it. 20 + 3 = 23.
  fill(
    mildId,
    [
      { bundleId: size(23_000), delta: -1 },
      { bundleId: size(5_000), delta: 4 },
      { bundleId: size(1_000), delta: 3 },
    ],
    OWNER,
    "broke one down for the counter",
  );

  assert.equal(stockOf(mildId), before, "still 46 kg — only the shape changed");
  const s = packState(mildId);
  assert.equal(s.sizes.find((x) => x.sizeMilli === 23_000)!.filled, 1);
  assert.equal(s.sizes.find((x) => x.sizeMilli === 5_000)!.filled, 4);
  assert.equal(s.sizes.find((x) => x.sizeMilli === 1_000)!.filled, 3);
  assert.equal(s.packedMilli, 23_000 + 20_000 + 3_000);
  assert.equal(s.packedMilli, 46_000);
  assert.equal(s.looseMilli, 0);
});

test("the order the lines are typed in does not matter", () => {
  // The same errand as above, written the other way round: the fills first and
  // the opening after. Per-line checking would refuse this one and allow the
  // other, which is not something the shelf should have an opinion about.
  const before = packState(mildId);
  fill(
    mildId,
    [
      { bundleId: size(1_000), delta: 5 },
      { bundleId: size(5_000), delta: -1 },
    ],
    OWNER,
  );
  const after = packState(mildId);
  assert.equal(after.stockMilli, before.stockMilli);
  assert.equal(after.packedMilli, before.packedMilli, "5 × 1 kg replaced one 5 kg exactly");
});

test("it refuses to claim more in containers than the shop holds", () => {
  const before = packState(mildId);
  assert.throws(
    () => fill(mildId, [{ bundleId: size(23_000), delta: 5 }], OWNER),
    (e: Error) => e instanceof PackError && /more than there is/.test(e.message),
  );
  const after = packState(mildId);
  assert.deepEqual(
    after.sizes.map((s) => s.filled),
    before.sizes.map((s) => s.filled),
    "a refused fill leaves every count exactly as it was",
  );
});

test("it refuses to open jerricans that are not there", () => {
  assert.throws(
    () => fill(mildId, [{ bundleId: size(23_000), delta: -9 }], OWNER),
    (e: Error) => e instanceof PackError && /cannot open/.test(e.message),
  );
});

test("the tally is a ledger — filling and opening are rows, not edits", () => {
  const rows = all<{ delta: number; reason: string }>(
    `SELECT delta, reason FROM pack_moves WHERE item_id = ? ORDER BY id`,
    mildId,
  );
  assert.ok(rows.length >= 6, "every fill and every opening left its own row");
  assert.ok(rows.some((r) => r.reason === "fill" && r.delta > 0));
  assert.ok(rows.some((r) => r.reason === "open" && r.delta < 0));

  assert.throws(
    () => run(`DELETE FROM pack_moves WHERE item_id = ?`, mildId),
    /append-only/,
    "a jerrican that was filled and then opened is two rows, never an erasure",
  );
  assert.throws(() => run(`UPDATE pack_moves SET delta = 99 WHERE item_id = ?`, mildId), /append-only/);
});

test("selling loose still works, and eats into the loose share first", () => {
  // Put another 10 kg on the shelf without pouring it.
  run(
    `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id)
     VALUES (?, 10000, 'batch_output', ?)`,
    mildId,
    OWNER,
  );
  const s = packState(mildId);
  assert.equal(s.stockMilli, 56_000);
  assert.equal(s.looseMilli, 10_000, "the new stock is loose until somebody pours it");
  assert.equal(looseMilli(mildId), 10_000);
});

test("switching it off keeps the count rather than throwing it away", () => {
  const before = filledCounts(mildId);
  setPacked(mildId, false, OWNER);
  assert.equal(packState(mildId).packed, false);
  setPacked(mildId, true, OWNER);
  assert.deepEqual(
    [...filledCounts(mildId).entries()].sort(),
    [...before.entries()].sort(),
    "a count somebody took by hand survives the switch",
  );
});

test("the whole picture never contradicts itself", () => {
  const s = packState(mildId);
  const summed = s.sizes.reduce((n, x) => n + x.filled * x.sizeMilli, 0);
  assert.equal(summed, s.packedMilli);
  assert.equal(s.packedMilli + s.looseMilli, s.stockMilli, "packed plus loose IS the stock");
  assert.ok(s.looseMilli >= 0, "the loose share can never go negative");
  assert.ok(s.sizes.every((x) => x.filled >= 0));
});

// ---------------------------------------------------------------- at the till

const { recordSale, voidSale, SaleError } = await import("../src/lib/sales.ts");

function sell(lines: unknown, dueCents: number) {
  return recordSale({
    clientUuid: `pack-${Math.random().toString(36).slice(2)}`,
    lines,
    tenders: [{ method: "cash", amountCents: dueCents }],
    userId: OWNER,
    tier: "retail",
  } as never);
}

test("selling a jerrican takes the kilogrammes AND the jerrican", () => {
  const before = packState(mildId);
  const filled5 = before.sizes.find((x) => x.sizeMilli === 5_000)!.filled;
  assert.ok(filled5 > 0, "there is a 5 kg standing filled to sell");

  sell([{ itemId: mildId, bundleId: size(5_000), units: 1, unitPriceCents: 160_000 }], 160_000);

  const after = packState(mildId);
  assert.equal(after.stockMilli, before.stockMilli - 5_000, "5 kg left the shelf");
  assert.equal(
    after.sizes.find((x) => x.sizeMilli === 5_000)!.filled,
    filled5 - 1,
    "and one fewer 5 kg is standing there",
  );
  assert.equal(after.packedMilli + after.looseMilli, after.stockMilli, "still one number");
});

test("voiding that sale stands the jerrican back on the shelf", () => {
  const before = packState(mildId);
  const filled5 = before.sizes.find((x) => x.sizeMilli === 5_000)!.filled;

  const sale = sell([{ itemId: mildId, bundleId: size(5_000), units: 2, unitPriceCents: 160_000 }], 320_000);
  assert.equal(packState(mildId).sizes.find((x) => x.sizeMilli === 5_000)!.filled, filled5 - 2);

  voidSale(sale.saleId, OWNER, "wrong customer");

  const after = packState(mildId);
  assert.equal(after.stockMilli, before.stockMilli, "the kilogrammes came back");
  assert.equal(
    after.sizes.find((x) => x.sizeMilli === 5_000)!.filled,
    filled5,
    "and so did the two jerricans — they are sealed and standing again",
  );
  assert.equal(after.packedMilli + after.looseMilli, after.stockMilli, "still one number");

  // A return, like everything else here, is a row and not an edit.
  const back = all<{ delta: number }>(
    `SELECT delta FROM pack_moves WHERE ref_type = 'sale' AND ref_id = ? AND reason = 'sale_void'`,
    sale.saleId,
  );
  assert.deepEqual(back.map((r) => r.delta), [2]);
});

test("voiding a loose sale returns the liquid loose, not as a sealed container", () => {
  // Leave nothing loose, so the sale has to break a seal to be poured.
  const s0 = packState(mildId);
  const spare = Math.floor(s0.looseMilli / 1_000);
  if (spare > 0) fill(mildId, [{ bundleId: size(1_000), delta: spare }], OWNER);

  const before = packState(mildId);
  const sale = sell([{ itemId: mildId, units: 1, qtyMilli: 2_000, unitPriceCents: 32_000 }], 64_000);
  const opened = before.packedMilli - packState(mildId).packedMilli;
  assert.ok(opened > 0, "a container was opened to pour it");

  voidSale(sale.saleId, OWNER, "poured back");

  const after = packState(mildId);
  assert.equal(after.stockMilli, before.stockMilli, "every kilogramme is back");
  assert.equal(after.packedMilli, before.packedMilli - opened, "the opened container stays open");
  assert.equal(after.looseMilli, before.looseMilli + opened, "its contents are loose, which is where they are");
  assert.equal(after.packedMilli + after.looseMilli, after.stockMilli);
});

test("it refuses to sell a jerrican nobody has filled", () => {
  const s = packState(mildId);
  const twentyThree = s.sizes.find((x) => x.sizeMilli === 23_000)!;
  const askFor = twentyThree.filled + 3;
  assert.ok(s.stockMilli > askFor * 23_000 - 23_000 || true);

  assert.throws(
    () => sell([{ itemId: mildId, bundleId: size(23_000), units: askFor, unitPriceCents: 700_000 }], 700_000 * askFor),
    (e: Error) => e instanceof SaleError && /filled/.test(e.message),
    "the weight might allow it; the shelf does not",
  );
});

test("a loose sale off a fully packed shelf opens a jerrican rather than refusing", () => {
  // Pour every loose kilogramme away into 1 kg bottles first.
  const s0 = packState(mildId);
  const spare = Math.floor(s0.looseMilli / 1_000);
  if (spare > 0) fill(mildId, [{ bundleId: size(1_000), delta: spare }], OWNER);
  assert.ok(packState(mildId).looseMilli < 1_000, "nothing meaningful left loose");

  const before = packState(mildId);
  sell([{ itemId: mildId, units: 1, qtyMilli: 2_000, unitPriceCents: 32_000 }], 64_000);

  const after = packState(mildId);
  assert.equal(after.stockMilli, before.stockMilli - 2_000, "2 kg left the shelf");
  assert.ok(after.packedMilli < before.packedMilli, "a container was opened to pour it");
  assert.ok(after.looseMilli >= 0, "and the tally never goes upside down");
  assert.equal(after.packedMilli + after.looseMilli, after.stockMilli);

  const opened = all<{ note: string }>(
    `SELECT note FROM pack_moves WHERE item_id = ? AND reason = 'open' AND ref_type = 'sale'`,
    mildId,
  );
  assert.ok(opened.length > 0, "and it said in the ledger why it was opened");
});

test("a product that is NOT packed sells exactly as it always did", () => {
  // Ungerol: sold by the 5 kg, weighed out of the drum, never pre-filled.
  const ungerolId = createProduct({
    name: "Ungerol Thickener",
    unit: "kg",
    containerValue: 25,
    containerLabel: "drum",
    price: 440,
    floor: 0,
    ceiling: 0,
    aliases: "",
    byUserId: OWNER,
  });
  saveBundles({ itemId: ungerolId }, [{ sizeMilli: 20_000, priceCents: 800_000, floorCents: 0 }]);
  const twenty = itemBundles(ungerolId)[0].id;
  run(
    `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id)
     VALUES (?, 50000, 'purchase', ?)`,
    ungerolId,
    OWNER,
  );

  // Not one 20 kg jerrican is "filled" — and that must not stop the sale.
  assert.equal(filledCounts(ungerolId).size, 0);
  const res = sell([{ itemId: ungerolId, bundleId: twenty, units: 2, unitPriceCents: 800_000 }], 1_600_000);
  assert.ok(res.saleId > 0);
  assert.equal(stockOf(ungerolId), 10_000, "40 kg came off the drum, as always");
  assert.equal(
    all(`SELECT 1 FROM pack_moves WHERE item_id = ?`, ungerolId).length,
    0,
    "and nothing was written to a tally it does not keep",
  );
});

// ------------------------------------------------------- dividing a jerrican

const { divide } = await import("../src/lib/packing.ts");

test("a batch counted in jerricans fills those jerricans", async () => {
  // The whole point: saying "two 23s" to the mixing board must not have to be
  // said again to the shelf.
  const { createFormula, currentVersion } = await import("../src/lib/production.ts");
  const { setFormulaOutput, recordMix } = await import("../src/lib/mixing.ts");

  const concId = createProduct({
    name: "Hypochlorite strong",
    unit: "kg",
    containerValue: 24,
    containerLabel: "drum",
    price: 300,
    floor: 0,
    ceiling: 0,
    aliases: "",
    byUserId: OWNER,
  });
  const conc = get<{ chemical_id: number }>(`SELECT chemical_id FROM items WHERE id = ?`, concId)!;
  run(
    `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id)
     VALUES (?, 240000, 'purchase', ?)`,
    concId,
    OWNER,
  );

  const { formulaId } = createFormula({
    name: "Strong to mild",
    refSizeMilli: 23_000,
    refUnit: "kg",
    steps: "",
    note: "",
    items: [{ chemicalId: conc.chemical_id, qtyMilli: 12_000 }],
    userId: OWNER,
  });
  setFormulaOutput(formulaId, mildId, OWNER);
  const version = currentVersion(formulaId)!;

  const before = packState(mildId);
  const was23 = before.sizes.find((x) => x.sizeMilli === 23_000)!.filled;

  recordMix({
    versionId: version.id,
    targetMilli: 46_000,
    actualMilli: 46_000,
    filled: [{ bundleId: size(23_000), units: 2 }],
    userId: OWNER,
  });

  const after = packState(mildId);
  assert.equal(after.stockMilli, before.stockMilli + 46_000, "46 kg landed on the shelf");
  assert.equal(
    after.sizes.find((x) => x.sizeMilli === 23_000)!.filled,
    was23 + 2,
    "and it landed as two jerricans, without being counted a second time",
  );
  assert.equal(after.packedMilli + after.looseMilli, after.stockMilli);
});

test("take one 23 kg and fill four 5 kg and three 1 kg out of it", () => {
  const before = packState(mildId);
  const b23 = before.sizes.find((x) => x.sizeMilli === 23_000)!;
  const b5 = before.sizes.find((x) => x.sizeMilli === 5_000)!;
  const b1 = before.sizes.find((x) => x.sizeMilli === 1_000)!;

  const res = divide(
    mildId,
    {
      fromBundleId: size(23_000),
      fromUnits: 1,
      into: [
        { bundleId: size(5_000), units: 4 },
        { bundleId: size(1_000), units: 3 },
      ],
    },
    OWNER,
  );

  assert.equal(res.tookMilli, 23_000);
  assert.equal(res.filledMilli, 23_000);
  assert.equal(res.remainderMilli, 0);

  const after = packState(mildId);
  assert.equal(after.stockMilli, before.stockMilli, "dividing moves no stock at all");
  assert.equal(after.sizes.find((x) => x.sizeMilli === 23_000)!.filled, b23.filled - 1);
  assert.equal(after.sizes.find((x) => x.sizeMilli === 5_000)!.filled, b5.filled + 4);
  assert.equal(after.sizes.find((x) => x.sizeMilli === 1_000)!.filled, b1.filled + 3);
});

test("what will not go into a smaller container goes back in the drum", () => {
  const before = packState(mildId);
  const res = divide(
    mildId,
    { fromBundleId: size(23_000), fromUnits: 1, into: [{ bundleId: size(5_000), units: 4 }] },
    OWNER,
  );
  assert.equal(res.remainderMilli, 3_000, "23 into four 5s leaves 3 kg");
  const after = packState(mildId);
  assert.equal(after.looseMilli, before.looseMilli + 3_000, "and the 3 kg is loose, not lost");
  assert.equal(after.stockMilli, before.stockMilli);
});

test("it refuses to fill more than comes out of the container", () => {
  assert.throws(
    () =>
      divide(
        mildId,
        { fromBundleId: size(23_000), fromUnits: 1, into: [{ bundleId: size(5_000), units: 9 }] },
        OWNER,
      ),
    (e: Error) => e instanceof PackError && /more than comes out/.test(e.message),
  );
});

test("it refuses to fill a container out of a smaller one, or out of itself", () => {
  assert.throws(
    () =>
      divide(
        mildId,
        { fromBundleId: size(1_000), fromUnits: 1, into: [{ bundleId: size(23_000), units: 1 }] },
        OWNER,
      ),
    (e: Error) => e instanceof PackError && /not smaller/.test(e.message),
  );
  assert.throws(
    () =>
      divide(
        mildId,
        { fromBundleId: size(5_000), fromUnits: 1, into: [{ bundleId: size(5_000), units: 1 }] },
        OWNER,
      ),
    (e: Error) => e instanceof PackError && /out of itself/.test(e.message),
  );
});

test("it refuses to open jerricans that are not standing there", () => {
  const state = packState(mildId);
  const have = state.sizes.find((x) => x.sizeMilli === 23_000)!.filled;
  assert.throws(
    () =>
      divide(
        mildId,
        { fromBundleId: size(23_000), fromUnits: have + 1, into: [{ bundleId: size(1_000), units: 1 }] },
        OWNER,
      ),
    (e: Error) => e instanceof PackError && /cannot open/.test(e.message),
  );
});

test("saying a recipe is mixed in advance starts counting its jerricans", async () => {
  const { createFormula } = await import("../src/lib/production.ts");
  const { setFormulaOutput } = await import("../src/lib/mixing.ts");

  const perfumeId = createProduct({
    name: "Perfume (diluted)",
    unit: "L",
    containerValue: 5,
    containerLabel: "jerrican",
    price: 900,
    floor: 0,
    ceiling: 0,
    aliases: "",
    byUserId: OWNER,
  });
  saveBundles({ itemId: perfumeId }, [
    { sizeMilli: 5_000, priceCents: 450_000, floorCents: 0 },
    { sizeMilli: 1_000, priceCents: 95_000, floorCents: 0 },
  ]);

  const conc = createProduct({
    name: "Perfume concentrate",
    unit: "L",
    containerValue: 5,
    containerLabel: "jerrican",
    price: 4000,
    floor: 0,
    ceiling: 0,
    aliases: "",
    byUserId: OWNER,
  });
  const chem = get<{ chemical_id: number }>(`SELECT chemical_id FROM items WHERE id = ?`, conc)!;
  run(
    `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id)
     VALUES (?, 20000, 'purchase', ?)`,
    conc,
    OWNER,
  );

  const { formulaId } = createFormula({
    name: "Perfume — diluted",
    refSizeMilli: 5_000,
    refUnit: "L",
    steps: "",
    note: "",
    items: [{ chemicalId: chem.chemical_id, qtyMilli: 1_000 }],
    userId: OWNER,
  });

  assert.equal(packState(perfumeId).packed, false, "off until the recipe says what it makes");

  setFormulaOutput(formulaId, perfumeId, OWNER);

  assert.equal(
    packState(perfumeId).packed,
    true,
    "a thing mixed in advance is poured into containers — count them without being asked",
  );
});

test("a product with no sizes is left alone, rather than guessed at", async () => {
  const { createFormula } = await import("../src/lib/production.ts");
  const { setFormulaOutput } = await import("../src/lib/mixing.ts");

  const looseId = createProduct({
    name: "Bleach (sold by weight only)",
    unit: "kg",
    containerValue: 20,
    containerLabel: "drum",
    price: 100,
    floor: 0,
    ceiling: 0,
    aliases: "",
    byUserId: OWNER,
  });
  const conc = get<{ chemical_id: number }>(
    `SELECT chemical_id FROM items WHERE name = 'Hypochlorite mild'`,
  )!;
  const { formulaId } = createFormula({
    name: "Bleach — weak",
    refSizeMilli: 10_000,
    refUnit: "kg",
    steps: "",
    note: "",
    items: [{ chemicalId: conc.chemical_id, qtyMilli: 5_000 }],
    userId: OWNER,
  });

  setFormulaOutput(formulaId, looseId, OWNER);
  assert.equal(
    packState(looseId).packed,
    false,
    "nothing to count, so nothing is switched on behind the owner's back",
  );
});
