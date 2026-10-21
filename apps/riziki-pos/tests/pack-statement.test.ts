/**
 * What the kilogrammes are standing in, at both ends of a period.
 *
 * "203 kg of Ungerol" is a true answer to a question nobody asks. The shop
 * keeps seven 20 kg jerricans, ten 5 kg jerricans and the rest in the drum —
 * and the opening and closing of a period are exactly where that matters,
 * because that is what somebody walks out and counts.
 *
 * `pack_moves` is dated, so the counts rebuild as at any date the same way the
 * quantities do. What these check is that they rebuild CONSISTENTLY: the
 * containers and the drum must come to the item's own quantity, or the two
 * halves of the screen disagree.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-packs-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, run } = await import("../src/lib/db.ts");
const { stockStatement, statementRange } = await import("../src/lib/stock-statement.ts");
const { sizeLabel } = await import("../src/lib/pack-statement.ts");
const { saveBundles, itemBundles } = await import("../src/lib/bundles.ts");

seed();

const TODAY = "2026-10-21";
const YESTERDAY = "2026-10-20";
const ITEM = "PACKED DRUM";

run(
  `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                      sellable, price_basis, price_cents, cost_cents, packed)
   VALUES (NULL, ?, 'bulk', 'kg', 200000, 'drum', 1, 'unit', 50000, 40000, 1)`,
  ITEM,
);
const drum = get<{ id: number }>(`SELECT id FROM items WHERE name = ?`, ITEM)!.id;

saveBundles({ itemId: drum }, [
  { sizeMilli: 20_000, priceCents: 90_000, floorCents: 0 },
  { sizeMilli: 5_000, priceCents: 24_000, floorCents: 0 },
]);
const [big, small] = itemBundles(drum).sort((a, b) => b.sizeMilli - a.sizeMilli);

const at = (date: string) => `${date} 06:00:00`;
const stock = (date: string, delta: number, reason: string) =>
  run(
    `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id, at) VALUES (?, ?, ?, 1, ?)`,
    drum,
    delta,
    reason,
    at(date),
  );
const pack = (date: string, bundleId: number, delta: number, reason: string) =>
  run(
    `INSERT INTO pack_moves (item_id, bundle_id, delta, reason, user_id, at) VALUES (?, ?, ?, ?, 1, ?)`,
    drum,
    bundleId,
    delta,
    reason,
    at(date),
  );

// 400 kg in before the window, poured into 10 × 20 kg and 10 × 5 kg.
stock(YESTERDAY, 400_000, "purchase");
pack(YESTERDAY, big.id, 10, "fill");
pack(YESTERDAY, small.id, 10, "fill");

// Today: two 20 kg jerricans sold, one 20 kg tipped back, four more 5 kg filled.
stock(TODAY, -40_000, "sale");
pack(TODAY, big.id, -2, "sale");
pack(TODAY, big.id, -1, "open");
pack(TODAY, small.id, 4, "fill");

const row = (period: "today" | "yesterday") =>
  stockStatement(statementRange(period, TODAY)).rows.find((r) => r.name === ITEM)!;

test("a size reads the way the shop says it", () => {
  assert.equal(sizeLabel(20_000, "kg"), "20 kg");
  assert.equal(sizeLabel(500, "L"), "500 ml");
  assert.equal(sizeLabel(1_500, "L"), "1.5 L");
});

test("the containers are counted at both ends of the period", () => {
  const today = row("today");
  assert.ok(today.packs, "a packed item carries its containers");

  const twenty = today.packs!.sizes.find((s) => s.sizeMilli === 20_000)!;
  assert.equal(twenty.openingPacks, 10, "ten stood there this morning");
  assert.equal(twenty.soldPacks, 2);
  assert.equal(twenty.openedPacks, 1, "one was tipped back into the drum");
  assert.equal(twenty.closingPacks, 7, "seven are standing tonight");

  const five = today.packs!.sizes.find((s) => s.sizeMilli === 5_000)!;
  assert.equal(five.openingPacks, 10);
  assert.equal(five.filledPacks, 4);
  assert.equal(five.closingPacks, 14);
});

test("the containers and the drum come to the item's own quantity", () => {
  /*
    The check that matters. If these two disagree the screen shows a total in
    one place and a breakdown in another that cannot be made to add up, and an
    owner counting the yard has no way to tell which half is lying.
  */
  for (const period of ["yesterday", "today"] as const) {
    const r = row(period);
    const p = r.packs!;
    assert.equal(
      p.closingPackedMilli + p.closingLooseMilli,
      r.closingMilli,
      `${period}: containers plus drum is the closing quantity`,
    );
    assert.equal(
      p.openingPackedMilli + p.openingLooseMilli,
      r.openingMilli,
      `${period}: and the same at the opening`,
    );
  }
});

test("yesterday's containers are today's opening containers", () => {
  const y = row("yesterday").packs!;
  const t = row("today").packs!;
  for (const size of t.sizes) {
    const was = y.sizes.find((s) => s.bundleId === size.bundleId);
    assert.equal(size.openingPacks, was ? was.closingPacks : 0, `${size.label} carries over`);
  }
});

test("something weighed straight out of the drum carries no containers", () => {
  const plain = stockStatement(statementRange("today", TODAY)).rows.find(
    (r) => r.name === "Ungerol",
  );
  assert.ok(plain, "Ungerol is on the statement");
  assert.equal(plain!.packs, undefined, "it is not counted in containers, so there is nothing to show");
});

test("a sale put back takes the container off what was sold", () => {
  const before = row("today").packs!.sizes.find((s) => s.sizeMilli === 20_000)!.soldPacks;
  pack(TODAY, big.id, 1, "sale_void");
  const after = row("today").packs!.sizes.find((s) => s.sizeMilli === 20_000)!;
  assert.equal(after.soldPacks, before - 1, "one fewer went out after all");
  assert.equal(after.closingPacks, 8, "and it is standing there again");
});
