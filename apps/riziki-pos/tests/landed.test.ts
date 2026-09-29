/**
 * What the shop pays for a kilo, and which way it is going.
 *
 * The seller asked for this figure to price with, and the reason it is not the
 * cost already on every screen is the whole point: the blended average is
 * deliberately slow. A drum landing 22% dearer moves the blend by a few
 * shillings while the old stock lasts, and the decision he has to make is about
 * the new drum, not the average. These tests hold the two apart.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-landed-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

// Type-only, so it is erased and cannot open the database before the line above
// has said which database to open.
import type { LandedRow } from "../src/lib/landed.ts";

const { seed } = await import("../src/lib/seed.ts");
const { get, all, run, stockOf, postMovement } = await import("../src/lib/db.ts");
const { createSupplier, recordPurchase } = await import("../src/lib/purchasing.ts");
const landed = await import("../src/lib/landed.ts");

seed();

for (const it of all<{ id: number }>(`SELECT id FROM items WHERE active = 1`)) {
  const q = stockOf(it.id);
  if (q !== 0) postMovement({ itemId: it.id, deltaMilli: -q, reason: "stocktake", userId: 1 });
  run(`UPDATE items SET cost_cents = 0 WHERE id = ?`, it.id);
}
// Nothing has been delivered yet, so nothing is watched — every row below is
// one these tests put there.
run(`DELETE FROM purchase_lines`);
run(`DELETE FROM purchases`);

const ungerol = get<{ id: number }>(`SELECT id FROM items WHERE name = 'Ungerol'`)!;
const magadi = get<{ id: number }>(`SELECT id FROM items WHERE name = 'Magadi'`)!;
run(`UPDATE items SET price_cents = 51300 WHERE id = ?`, ungerol.id);
run(`UPDATE items SET price_cents = 14000 WHERE id = ?`, magadi.id);

const supplier = createSupplier({ name: "Chemi Traders Ltd" }, 1);
const drum = (itemId: number, goods: number, transport: number, ref: string, sizeMilli = 250000) =>
  recordPurchase({
    supplierId: supplier,
    ref,
    transportCents: transport,
    userId: 1,
    lines: [{ itemId, units: 1, sizeMilli, costCents: goods }],
  });

const row = (rows: LandedRow[], name: string) => rows.find((r) => r.name.startsWith(name))!;

test("nothing bought is nothing to watch", () => {
  assert.deepEqual(landed.landedCosts(), [], "an item with no delivery has no landed cost at all");
});

test("the landed rate is per unit, transport included", () => {
  drum(ungerol.id, 7800000, 200000, "INV-5501"); // 80,000 over 250 kg
  const r = row(landed.landedCosts(), "Ungerol");
  assert.equal(r.latest?.rateCents, 32000, "KES 320.00 a kilo, not the KES 312.00 on the invoice");
  assert.equal(r.latest?.totalCents, 8000000);
  assert.equal(r.previous, null, "there is nothing to compare a first delivery against");
  assert.equal(r.moveCents, 0);
});

test("the second delivery is compared against the first, not against the blend", () => {
  drum(ungerol.id, 9500000, 300000, "INV-5622"); // 98,000 over 250 kg = 392.00
  const r = row(landed.landedCosts(), "Ungerol");

  assert.equal(r.latest?.rateCents, 39200);
  assert.equal(r.previous?.rateCents, 32000);
  assert.equal(r.moveCents, 7200, "KES 72.00 a kilo dearer");
  assert.ok(Math.abs(r.movePct - 22.5) < 0.01);

  // And the blend has moved by nothing like as much, which is the point: the
  // first drum is still on the shelf, so the rise is averaged away by half.
  assert.equal(r.costCents, 35600, "(250 × 320.00 + 98,000) ÷ 500 kg");
  assert.ok(r.costCents < r.latest!.rateCents);
});

test("the blend lags the landed rate, and the screen shows both", () => {
  // Half a drum left when a dearer one arrives: the blend softens the rise, and
  // a shop reading only the blend does not know what the next drum did.
  drum(magadi.id, 1000000, 0, "INV-A", 100000); // 100.00/kg over 100 kg
  postMovement({ itemId: magadi.id, deltaMilli: -50000, reason: "sale", userId: 1 });
  drum(magadi.id, 1500000, 0, "INV-B", 100000); // 150.00/kg over 100 kg

  const r = row(landed.landedCosts(), "Magadi");
  assert.equal(r.latest?.rateCents, 15000, "the new drum landed at 150.00");
  assert.equal(r.previous?.rateCents, 10000);
  assert.equal(r.moveCents, 5000, "50.00 a kilo dearer");
  // (50 × 100.00 + 150.00 × 100) ÷ 150 = 133.33
  assert.equal(r.costCents, 13333, "but the cost the tills use only moved to 133.33");
  assert.ok(r.costCents < r.latest!.rateCents, "the blend lags, which is what hides a rise");
});

test("the margin is worked out against the new landed rate, not the old blend", () => {
  const r = row(landed.landedCosts(), "Magadi");
  // Asking 140.00, landing at 150.00: every sale off the next drum loses money,
  // while the blend at 133.33 still shows a comfortable 4.8% and says nothing.
  assert.equal(r.priceCents, 14000);
  assert.equal(r.costCents, 13333);
  assert.ok(r.freshMarginPct < 0, "the margin the next sale will actually earn");
  assert.equal(r.underwater, true);
  assert.ok(r.priceCents > r.costCents, "and the blend would have said it was fine");
});

test("a cheaper delivery is news too", () => {
  drum(magadi.id, 800000, 0, "INV-C", 100000); // back down to 80.00/kg
  const r = row(landed.landedCosts(), "Magadi");
  assert.equal(r.moveCents, -7000, "70.00 a kilo cheaper");
  assert.ok(r.movePct < 0);
  assert.equal(r.underwater, false);
});

// ------------------------------------------------------------------ sorting

test("biggest change first, whichever way it went", () => {
  const rows = landed.landedCosts({ order: "move" });
  assert.equal(rows[0].name.startsWith("Magadi"), true, "−46.7% beats +22.5%");
});

test("thinnest margin first, for the prices that need a decision", () => {
  const rows = landed.landedCosts({ order: "margin" });
  assert.ok(rows[0].freshMarginPct <= rows[rows.length - 1].freshMarginPct);
});

test("by name, for finding one thing", () => {
  const rows = landed.landedCosts({ order: "name" });
  assert.deepEqual(
    rows.map((r) => r.name),
    [...rows.map((r) => r.name)].sort((a, b) => a.localeCompare(b)),
  );
});

// ------------------------------------------------------------ search, dates

test("search covers the supplier as well as the name", () => {
  assert.equal(landed.landedCosts({ q: "ungerol" }).length, 1);
  assert.equal(landed.landedCosts({ q: "chemi traders" }).length, 2, "both came from them");
  assert.equal(landed.landedCosts({ q: "bicycle" }).length, 0);
});

test("a window picks which delivery counts as the latest", () => {
  // Everything above was delivered today, so a window ending yesterday holds
  // nothing at all — and an item with no delivery in the window is left out
  // rather than shown with a stale figure.
  const none = landed.landedCosts({ range: { from: "2020-01-01", to: "2020-12-31" } });
  assert.deepEqual(none, []);
});

test("a single delivery in the window is still compared with the one before it", () => {
  // Otherwise a month with one delivery in it reports no change, which reads as
  // calm when it is the opposite.
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const r = row(landed.landedCosts({ range: { from: today, to: today } }), "Ungerol");
  assert.equal(r.previous?.rateCents, 32000);
  assert.equal(r.moveCents, 7200);
});

// ---------------------------------------------------------------- the totals

test("the summary counts which way things went and what it would cost to restock", () => {
  const rows = landed.landedCosts();
  const s = landed.landedSummary(rows);
  assert.equal(s.watched, 2);
  assert.equal(s.dearer, 1, "Ungerol");
  assert.equal(s.cheaper, 1, "Magadi");
  assert.equal(
    s.stockValueCents,
    rows.reduce((n, r) => n + r.stockValueCents, 0),
  );
});

test("the history of one item comes back oldest first, for reading left to right", () => {
  const h = landed.landedHistory(magadi.id);
  assert.deepEqual(h.map((d) => d.rateCents), [10000, 15000, 8000]);
});
