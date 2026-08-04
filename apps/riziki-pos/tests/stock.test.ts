/**
 * Stock module tests.
 *
 * RIZIKI_DB is pointed at a throwaway file BEFORE anything is imported, because
 * `db.ts` reads it at module load — importing first would open the shop's real
 * database and these tests post movements that can never be deleted.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-stock-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { get, all, postMovement, stockOf } = await import("../src/lib/db.ts");
const { seed } = await import("../src/lib/seed.ts");
const {
  performRepack,
  voidRepack,
  planRepack,
  performStocktake,
  planStocktake,
  repackTotals,
  stockStatus,
  stockView,
  repackOptions,
} = await import("../src/lib/stock-service.ts");

seed();

const OWNER = 1;

function itemId(name: string): number {
  const row = get<{ id: number }>(`SELECT id FROM items WHERE name = ?`, name);
  assert.ok(row, `no item called "${name}"`);
  return row!.id;
}

/** The ledger is the only truth; every assertion re-derives stock from it. */
function ledgerSum(id: number): number {
  const row = get<{ n: number }>(
    `SELECT COALESCE(SUM(delta_milli), 0) AS n FROM stock_movements WHERE item_id = ?`,
    id,
  );
  return row!.n;
}

// --------------------------------------------------------------- pure bits

test("stockStatus steps from in stock through low to reorder", () => {
  assert.equal(stockStatus(100_000, 20_000), "in");
  assert.equal(stockStatus(25_000, 20_000), "low");
  assert.equal(stockStatus(20_000, 20_000), "reorder");
  assert.equal(stockStatus(0, 0), "reorder");
  assert.equal(stockStatus(5_000, 0), "in");
});

test("repackTotals reports the loss percentage the owner never used to see", () => {
  const t = repackTotals(340_000, 335_000);
  assert.equal(t.lossMilli, 5_000);
  assert.ok(Math.abs(t.lossPct - 1.4706) < 0.001);
});

// ------------------------------------------------------------ (a) balanced

test("a balanced repack of one 50 kg Salt bag produces zero loss", () => {
  const bag = itemId("Salt — 50 kg bag");
  const one = itemId("Salt — 1 kg");
  const half = itemId("Salt — 500 g");
  const quarter = itemId("Salt — 250 g");

  const bagBefore = stockOf(bag);
  const oneBefore = stockOf(one);

  // 30 x 1 kg + 20 x 0.5 kg + 40 x 0.25 kg = 30 + 10 + 10 = exactly 50 kg
  const result = performRepack({
    fromItemId: bag,
    bulkUnits: 1,
    lines: [
      { itemId: one, units: 30 },
      { itemId: half, units: 20 },
      { itemId: quarter, units: 40 },
    ],
    userId: OWNER,
  });

  assert.equal(result.inMilli, 50_000);
  assert.equal(result.outMilli, 50_000);
  assert.equal(result.lossMilli, 0);
  assert.equal(result.lossPct, 0);

  // No loss means no loss movement at all — a zero row would be noise.
  const lossRows = all<{ n: number }>(
    `SELECT COUNT(*) AS n FROM stock_movements WHERE reason = 'repack_loss' AND ref_id = ?`,
    result.repackId,
  );
  assert.equal(lossRows[0].n, 0);

  assert.equal(ledgerSum(bag), bagBefore - 50_000);
  assert.equal(ledgerSum(one), oneBefore + 30_000);
  assert.equal(ledgerSum(half), 12 * 500 + 20 * 500);
  assert.equal(ledgerSum(quarter), 26 * 250 + 40 * 250);

  const stored = get<{ in_milli: number; out_milli: number; loss_milli: number }>(
    `SELECT in_milli, out_milli, loss_milli FROM repacks WHERE id = ?`,
    result.repackId,
  );
  assert.equal(stored?.in_milli, 50_000);
  assert.equal(stored?.out_milli, 50_000);
  assert.equal(stored?.loss_milli, 0);
});

// ---------------------------------------------------------- (b) unbalanced

test("two 170 kg Ungerol drums giving 335 kg of packs records exactly 5 kg loss", () => {
  const drum = itemId("Ungerol — 170 kg drum");
  const p20 = itemId("Ungerol — 20 kg");
  const p5 = itemId("Ungerol — 5 kg");

  // The shop only holds one drum in the seed; buy in enough for two.
  postMovement({
    itemId: drum,
    deltaMilli: 3 * 170_000,
    reason: "purchase",
    userId: OWNER,
    note: "test top-up",
  });
  const drumBefore = stockOf(drum);

  // 16 x 20 kg + 3 x 5 kg = 335 kg out of 340 kg in
  const result = performRepack({
    fromItemId: drum,
    bulkUnits: 2,
    lines: [
      { itemId: p20, units: 16 },
      { itemId: p5, units: 3 },
    ],
    userId: OWNER,
  });

  assert.equal(result.inMilli, 340_000);
  assert.equal(result.outMilli, 335_000);
  assert.equal(result.lossMilli, 5_000);
  assert.ok(Math.abs(result.lossPct - 1.4706) < 0.001, "≈1.5% — the Ungerol figure");

  const loss = get<{ delta_milli: number }>(
    `SELECT delta_milli FROM stock_movements WHERE reason = 'repack_loss' AND ref_id = ?`,
    result.repackId,
  );
  assert.equal(loss?.delta_milli, -5_000);

  const out = get<{ delta_milli: number }>(
    `SELECT delta_milli FROM stock_movements WHERE reason = 'repack_out' AND ref_id = ?`,
    result.repackId,
  );
  assert.equal(out?.delta_milli, -335_000);

  // out + loss must remove exactly what was broken down, no more, no less.
  assert.equal(ledgerSum(drum), drumBefore - 340_000);

  const stored = get<{ loss_milli: number }>(`SELECT loss_milli FROM repacks WHERE id = ?`, result.repackId);
  assert.equal(stored?.loss_milli, 5_000);
});

// ------------------------------------------------------------ (c) refusals

test("repacking more than you hold is rejected and writes nothing", () => {
  const drum = itemId("Ungerol — 170 kg drum");
  const p20 = itemId("Ungerol — 20 kg");

  const before = stockOf(drum);
  const movementsBefore = get<{ n: number }>(`SELECT COUNT(*) AS n FROM stock_movements`)!.n;
  const repacksBefore = get<{ n: number }>(`SELECT COUNT(*) AS n FROM repacks`)!.n;

  assert.throws(
    () =>
      performRepack({
        fromItemId: drum,
        bulkUnits: 99,
        lines: [{ itemId: p20, units: 800 }],
        userId: OWNER,
      }),
    /Not enough stock/,
  );

  assert.equal(stockOf(drum), before);
  assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM stock_movements`)!.n, movementsBefore);
  assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM repacks`)!.n, repacksBefore);
});

test("packing out more than went in is physically impossible and refused", () => {
  const bag = itemId("Salt — 50 kg bag");
  const one = itemId("Salt — 1 kg");

  assert.throws(
    () => planRepack({ fromItemId: bag, bulkUnits: 1, lines: [{ itemId: one, units: 51 }] }),
    /Impossible/,
  );
});

test("a repack cannot mix chemicals", () => {
  const bag = itemId("Salt — 50 kg bag");
  const ungerol = itemId("Ungerol — 1 kg");

  assert.throws(
    () => planRepack({ fromItemId: bag, bulkUnits: 1, lines: [{ itemId: ungerol, units: 1 }] }),
    /different chemical/,
  );
});

// ----------------------------------------------------------- (d) stocktake

test("a stocktake variance posts the right movement and the ledger still sums", () => {
  const p1 = itemId("Magadi — 1 kg"); // seeded at 45 packs of 1 kg
  const systemBefore = stockOf(p1);
  assert.equal(systemBefore, 45_000);

  const plan = planStocktake([{ itemId: p1, countedUnits: 41 }]);
  assert.equal(plan.lines[0].deltaMilli, -4_000);
  assert.equal(plan.lines[0].deltaUnits, -4);
  assert.equal(plan.varianceMilli, -4_000);

  const cost = get<{ cost_cents: number }>(`SELECT cost_cents FROM items WHERE id = ?`, p1)!.cost_cents;
  assert.equal(plan.varianceCents, -4 * cost);

  const result = performStocktake({
    counts: [{ itemId: p1, countedUnits: 41 }],
    reason: "monthly count — 4 packs missing from the shelf",
    userId: OWNER,
  });
  assert.equal(result.posted, 1);

  const move = get<{ delta_milli: number; note: string }>(
    `SELECT delta_milli, note FROM stock_movements
      WHERE item_id = ? AND reason = 'stocktake' ORDER BY id DESC LIMIT 1`,
    p1,
  );
  assert.equal(move?.delta_milli, -4_000);
  assert.match(move!.note, /monthly count/);

  // The counted figure is now the truth, and it is the ledger that says so.
  assert.equal(ledgerSum(p1), 41_000);
  assert.equal(stockOf(p1), 41_000);
});

test("a stocktake without a reason is refused", () => {
  const p1 = itemId("Magadi — 1 kg");
  assert.throws(
    () => performStocktake({ counts: [{ itemId: p1, countedUnits: 40 }], reason: "   ", userId: OWNER }),
    /reason is required/,
  );
  assert.equal(stockOf(p1), 41_000);
});

test("a negative physical count is refused", () => {
  const p1 = itemId("Magadi — 1 kg");
  assert.throws(
    () => performStocktake({ counts: [{ itemId: p1, countedUnits: -2 }], reason: "typo", userId: OWNER }),
    /cannot be negative/,
  );
  assert.equal(stockOf(p1), 41_000);
});

// ------------------------------------------------------------------ views

test("the stock view groups every pack size under its chemical", () => {
  const view = stockView();
  const ungerol = view.reagents.find((g) => g.name === "Ungerol");
  assert.ok(ungerol, "Ungerol block missing");

  // drum + 20 / 5 / 1 / 0.5 / 0.25 kg read as one block
  assert.equal(ungerol!.lines.length, 6);
  assert.equal(ungerol!.lines[0].kind, "bulk");
  assert.equal(
    ungerol!.totalMilli,
    ungerol!.lines.reduce((s, l) => s + l.qtyMilli, 0),
  );

  // Search has to find the chemical by the name the client says out loud.
  assert.ok(ungerol!.search.includes("sles"));
  const magadi = view.reagents.find((g) => g.name === "Magadi");
  assert.ok(magadi!.search.includes("soda ash"));

  assert.ok(view.packaging.length > 0);
  assert.ok(view.finished.length > 0);
  assert.ok(view.totalValueCents > 0);
});

test("repack options only offer bulk that has somewhere to go", () => {
  const options = repackOptions();
  assert.ok(options.every((o) => o.packs.length > 0));
  const ungerol = options.find((o) => o.name === "Ungerol — 170 kg drum");
  assert.equal(ungerol?.packs.length, 5);
  // Blue Colour has no pack sizes, so it must not appear.
  assert.ok(!options.some((o) => o.name.startsWith("Blue Colour")));
});

// ------------------------------------------------------------- (f) voiding

test("voiding a repack puts the bulk back, removes the packs, and reverses the loss", () => {
  const bag = itemId("Salt — 50 kg bag");
  const one = itemId("Salt — 1 kg");

  const bagBefore = stockOf(bag);
  const oneBefore = stockOf(one);

  // 49 x 1 kg from a 50 kg bag: 1 kg booked as loss.
  const result = performRepack({
    fromItemId: bag,
    bulkUnits: 1,
    lines: [{ itemId: one, units: 49 }],
    userId: OWNER,
  });
  assert.equal(result.lossMilli, 1_000);

  voidRepack(result.repackId, OWNER, "wrong bag scanned");

  assert.equal(stockOf(bag), bagBefore, "bulk restored, loss included");
  assert.equal(stockOf(one), oneBefore, "packs removed again");

  const reversals = all<{ n: number }>(
    `SELECT COUNT(*) AS n FROM stock_movements WHERE ref_type = 'repack_void' AND ref_id = ?`,
    result.repackId,
  );
  assert.equal(reversals[0].n, 3, "out + in + loss all reversed");

  assert.equal(
    get<{ status: string }>(`SELECT status FROM repacks WHERE id = ?`, result.repackId)!.status,
    "voided",
  );
  assert.throws(() => voidRepack(result.repackId, OWNER, "again"), /already voided/i);
  assert.throws(() => voidRepack(result.repackId, OWNER, " "), /why/i);
});
