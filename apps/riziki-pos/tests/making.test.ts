/**
 * The two products this shop does not buy in the form it sells.
 *
 * Perfume arrives concentrated and is let down with water; hypochlorite arrives
 * at 24 kg of concentrate and twelve of it makes twenty-three diluted. Both
 * ends are sold. These are the only two, and the tests are written in the
 * shop's own numbers so that a change here has to argue with the shop rather
 * than with an abstraction.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "riziki-making-"));
process.env.RIZIKI_DB = join(TMP, "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { get, run, stockOf } = await import("../src/lib/db.ts");
const { createProduct } = await import("../src/lib/catalog.ts");
const { saveConversion, recordMake, conversionFor, madeProducts, MakeError } = await import(
  "../src/lib/making.ts"
);

process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

run(`INSERT INTO users (name, role, pin_hash) VALUES ('Owner', 'owner', 'x')`);
const OWNER = 1;

function product(name: string, unit: "kg" | "L", container: number, price: number) {
  return createProduct({
    name,
    unit,
    aliases: "",
    containerValue: container,
    containerLabel: "drum",
    price,
    floor: 0,
    ceiling: 0,
    byUserId: OWNER,
  });
}

function deliver(itemId: number, milli: number, costCents: number) {
  run(
    `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id)
     VALUES (?, ?, 'purchase', ?)`,
    itemId,
    milli,
    OWNER,
  );
  run(`UPDATE items SET cost_cents = ? WHERE id = ?`, costCents, itemId);
}

const costOf = (id: number) =>
  get<{ cost_cents: number }>(`SELECT cost_cents FROM items WHERE id = ?`, id)!.cost_cents;

// --------------------------------------------------------------- hypochlorite

const hypoConc = product("Hypochlorite (concentrate)", "kg", 24, 400);
const hypo = product("Hypochlorite", "kg", 23, 60);

test("a product says what it is made from, in the shop's own numbers", () => {
  // Twelve kilograms of concentrate makes twenty-three of the diluted.
  saveConversion({ toItemId: hypo, fromItemId: hypoConc, inQty: 12, outQty: 23 });

  const c = conversionFor(hypo)!;
  assert.equal(c.fromItemId, hypoConc);
  assert.equal(c.inMilli, 12_000);
  assert.equal(c.outMilli, 23_000);

  const made = madeProducts();
  assert.equal(made.length, 1);
  assert.equal(made[0].toName, "Hypochlorite");
  assert.equal(made[0].fromName, "Hypochlorite (concentrate)");
});

test("making a batch moves the stock as a matched pair", () => {
  // A 24 kg drum arrives, at KES 300 a kilogram.
  deliver(hypoConc, 24_000, 30_000);
  assert.equal(stockOf(hypoConc), 24_000);
  assert.equal(stockOf(hypo), 0);

  recordMake({ toItemId: hypo, inQty: 12, outQty: 23, byUserId: OWNER });

  assert.equal(stockOf(hypoConc), 12_000, "half the drum is gone");
  assert.equal(stockOf(hypo), 23_000, "and twenty-three kilos are on the shelf");

  // The other half, the way the shop actually works it.
  recordMake({ toItemId: hypo, inQty: 12, outQty: 23, byUserId: OWNER });
  assert.equal(stockOf(hypoConc), 0);
  assert.equal(stockOf(hypo), 46_000, "24 kg of concentrate makes 46 kg diluted");
});

test("the money moves with the stock, so the dilution is not free", () => {
  /*
    12 kg at KES 300 is KES 3,600, spread over 23 kg — KES 156.52 a kilogram.
    Without this the diluted product would cost nothing, report an infinite
    margin, and tell the owner his real earner was the thing he barely sells.
  */
  const perKg = costOf(hypo);
  assert.equal(perKg, 15_652, "KES 3,600 over 23 kg, to the cent");

  // Both batches came out of concentrate at the same cost, so the average holds.
  assert.equal(costOf(hypo), 15_652);
  assert.equal(costOf(hypoConc), 30_000, "the concentrate's own cost is untouched");
});

test("a batch bigger than the shelf is refused, by name and by amount", () => {
  assert.throws(
    () => recordMake({ toItemId: hypo, inQty: 12, outQty: 23, byUserId: OWNER }),
    /only .* of Hypochlorite \(concentrate\) left/i,
  );
  assert.equal(stockOf(hypo), 46_000, "and nothing was made");
});

// --------------------------------------------------------------------- perfume

const perfumeConc = product("Perfume (concentrate)", "kg", 5, 4000);
const perfume = product("Perfume", "L", 20, 400);

test("perfume goes in by the kilogram and comes out by the litre", () => {
  // The shop weighs the concentrate and measures the dilution. One litre is
  // taken as one kilogram; where it is not, the stock take is the correction.
  saveConversion({ toItemId: perfume, fromItemId: perfumeConc, inQty: 1.5, outQty: 20 });

  deliver(perfumeConc, 5_000, 400_000); // a 5 kg drum at KES 4,000 a kilo
  recordMake({ toItemId: perfume, inQty: 1.5, outQty: 20, byUserId: OWNER });

  assert.equal(stockOf(perfumeConc), 3_500, "1.5 kg gone");
  assert.equal(stockOf(perfume), 20_000, "20 L made");
  // KES 6,000 of concentrate over 20 litres.
  assert.equal(costOf(perfume), 30_000, "KES 300 a litre");
});

test("a smaller batch at a different ratio is what was typed, not what was stored", () => {
  /*
    The stored ratio is what the shop aims at; the jug is what it gets. Half a
    kilogram making five litres is a different strength from 1.5 making 20, and
    the ledger has to believe the boxes rather than the arithmetic — otherwise
    every hand-measured batch quietly books a quantity nobody poured.
  */
  const before = stockOf(perfume);
  recordMake({ toItemId: perfume, inQty: 0.5, outQty: 5, byUserId: OWNER });
  assert.equal(stockOf(perfumeConc), 3_000);
  assert.equal(stockOf(perfume), before + 5_000);
});

// ------------------------------------------------------------------- the rules

test("a product cannot be made out of itself, however long the way round", () => {
  assert.throws(
    () => saveConversion({ toItemId: hypo, fromItemId: hypo, inQty: 1, outQty: 1 }),
    /out of itself/i,
  );
  // And round a chain: the concentrate must not be made from the dilution.
  assert.throws(
    () => saveConversion({ toItemId: hypoConc, fromItemId: hypo, inQty: 1, outQty: 1 }),
    /out of itself/i,
  );
});

test("clearing what a product is made from leaves its batches alone", () => {
  const madeBefore = stockOf(hypo);
  saveConversion({ toItemId: hypo, fromItemId: null, inQty: 0, outQty: 0 });

  assert.equal(conversionFor(hypo), undefined, "it is bought, not made, from now on");
  assert.equal(stockOf(hypo), madeBefore, "what was already made is still on the shelf");
  assert.throws(
    () => recordMake({ toItemId: hypo, inQty: 1, outQty: 1, byUserId: OWNER }),
    MakeError,
  );
});

test("a half-typed ratio is refused rather than stored", () => {
  assert.throws(
    () => saveConversion({ toItemId: hypo, fromItemId: hypoConc, inQty: 12, outQty: 0 }),
    /how much goes in and how much comes out/i,
  );
});
