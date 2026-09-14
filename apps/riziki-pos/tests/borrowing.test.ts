/**
 * Selling past zero, and the debt that leaves behind.
 *
 * The shop runs out of Ungerol on a Tuesday, fetches twenty kilos from the yard
 * next door, sells it, and puts it back when the lorry comes. Two things have
 * to be true for that to be worth building: the till must let it through only
 * as far as the owner said it may, and the delivery must settle it without
 * anybody reconciling anything.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "borrow-")), "t.db");

import test from "node:test";
import assert from "node:assert/strict";
const { seed } = await import("../src/lib/seed.ts");
const { get, run, stockOf } = await import("../src/lib/db.ts");
const { createProduct } = await import("../src/lib/catalog.ts");
const { recordSale, SaleError } = await import("../src/lib/sales.ts");
const { borrowed, allowanceOf, sellableMilli, oversellPolicy, setOversellPolicy } = await import(
  "../src/lib/borrowing.ts"
);

seed();
const OWNER = 1;

/*
  The shop's own rule comes first, because everything below is about it.

  These tests were written when the allowance was per item and the shop had no
  general rule at all. That rule now ships switched ON, so the per-item half is
  tested with it deliberately OFF — otherwise "refuses past the shelf" would be
  testing the default rather than the allowance — and the general half gets
  tests of its own at the end.
*/
setOversellPolicy({ all: false, capMilli: 0 }, OWNER);

const ungerol = createProduct({
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
run(
  `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id)
   VALUES (?, 10000, 'purchase', ?)`,
  ungerol,
  OWNER,
);

const sell = (qtyMilli: number, rateCents: number) =>
  recordSale({
    clientUuid: `b-${Math.random().toString(36).slice(2)}`,
    lines: [{ itemId: ungerol, units: 1, qtyMilli, unitPriceCents: rateCents }],
    tenders: [{ method: "cash", amountCents: Math.round((rateCents * qtyMilli) / 1000) }],
    userId: OWNER,
    tier: "retail",
  } as never);

test("with no allowance, the till refuses past the shelf — as it always has", () => {
  assert.equal(allowanceOf({ id: ungerol }), 0);
  assert.throws(
    () => sell(15_000, 44_000),
    (e: Error) => e instanceof SaleError && /10 kg .* left/.test(e.message),
  );
  assert.equal(stockOf(ungerol), 10_000, "and nothing moved");
});

test("an allowance lets the shop fetch from next door and sell it", () => {
  run(`UPDATE items SET oversell_milli = 20000 WHERE id = ?`, ungerol);
  const item = get<{ id: number; oversell_milli: number }>(
    `SELECT id, oversell_milli FROM items WHERE id = ?`,
    ungerol,
  )!;
  assert.equal(allowanceOf(item), 20_000);
  assert.equal(sellableMilli(item, stockOf(ungerol)), 30_000, "10 on the shelf, 20 next door");

  sell(15_000, 44_000);
  assert.equal(stockOf(ungerol), -5_000, "five kilos are owed next door");
});

test("what is owed shows up as a debt to walk over with", () => {
  const list = borrowed();
  const row = list.find((b) => b.itemId === ungerol);
  assert.ok(row, "it is on the list");
  assert.equal(row!.owedMilli, 5_000);
  assert.equal(row!.roomLeftMilli, 15_000, "and there is still room for fifteen more");
});

test("it refuses once the shop has fetched as much as it said it would", () => {
  assert.throws(
    () => sell(16_000, 44_000),
    (e: Error) =>
      e instanceof SaleError &&
      /already owed next door/.test(e.message) &&
      /past the 20 kg it may be sold short by/.test(e.message),
  );
  assert.equal(stockOf(ungerol), -5_000, "and the debt did not grow");
});

test("the delivery settles it, with nothing to reconcile", () => {
  run(
    `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id, note)
     VALUES (?, 80000, 'purchase', ?, 'the lorry came')`,
    ungerol,
    OWNER,
  );
  assert.equal(stockOf(ungerol), 75_000, "minus five plus eighty — it balances itself");
  assert.ok(
    !borrowed().some((b) => b.itemId === ungerol),
    "and it is off the list of what is owed",
  );
});

test("an item nobody has borrowed against never appears on that list", () => {
  const plain = createProduct({
    name: "Sodium Tripolyphosphate",
    unit: "kg",
    containerValue: 25,
    containerLabel: "bag",
    price: 300,
    floor: 0,
    ceiling: 0,
    aliases: "",
    byUserId: OWNER,
  });
  assert.ok(!borrowed().some((b) => b.itemId === plain));
});

// ------------------------------------------------- the shop's general rule

test("the rule ships switched on, covering everything with no number of its own", () => {
  const fresh = createProduct({
    name: "Caustic Soda Flakes",
    unit: "kg",
    containerValue: 25,
    containerLabel: "bag",
    price: 300,
    floor: 0,
    ceiling: 0,
    aliases: "",
    byUserId: OWNER,
  });
  run(
    `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id)
     VALUES (?, 5000, 'purchase', ?)`,
    fresh,
    OWNER,
  );

  setOversellPolicy({ all: true, capMilli: 0 }, OWNER);
  const item = get<{ id: number; oversell_milli: number }>(
    `SELECT id, oversell_milli FROM items WHERE id = ?`,
    fresh,
  )!;
  assert.equal(item.oversell_milli, 0, "nobody gave this one an allowance");
  assert.equal(allowanceOf(item), Number.POSITIVE_INFINITY, "the shop's rule covers it anyway");

  recordSale({
    clientUuid: `g-${Math.random().toString(36).slice(2)}`,
    lines: [{ itemId: fresh, units: 1, qtyMilli: 12_000, unitPriceCents: 30_000 }],
    tenders: [{ method: "cash", amountCents: 360_000 }],
    userId: OWNER,
    tier: "retail",
  } as never);

  assert.equal(stockOf(fresh), -7_000, "seven kilos fetched from next door");
  const row = borrowed().find((b) => b.itemId === fresh)!;
  assert.equal(row.owedMilli, 7_000);
  assert.equal(row.roomLeftMilli, null, "no limit was named, so there is no figure to give");
});

test("a limit on the general rule is enforced, and an item's own allowance beats it", () => {
  setOversellPolicy({ all: true, capMilli: 2_000 }, OWNER);
  assert.equal(oversellPolicy().capMilli, 2_000);

  // Nothing of its own: it gets the shop's two kilogrammes.
  assert.equal(allowanceOf({ id: -1 }), 2_000);
  // Its own twenty is more generous than the shop's two, so its own stands.
  assert.equal(allowanceOf({ id: -1, oversell_milli: 20_000 }), 20_000);

  setOversellPolicy({ all: false, capMilli: 0 }, OWNER);
  assert.equal(allowanceOf({ id: -1 }), 0, "and switched off, nothing may go past zero");
  assert.equal(
    allowanceOf({ id: -1, oversell_milli: 20_000 }),
    20_000,
    "except what was given a number by hand",
  );

  // Put it back the way the shop runs.
  setOversellPolicy({ all: true, capMilli: 0 }, OWNER);
});
