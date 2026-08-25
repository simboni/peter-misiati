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
const { performStocktake, planStocktake, stockStatus, stockView } = await import(
  "../src/lib/stock-service.ts"
);

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

// ------------------------------------------------------------ (a) balanced

// ---------------------------------------------------------- (b) unbalanced

// ------------------------------------------------------------ (c) refusals

// ----------------------------------------------------------- (d) stocktake

test("a stocktake variance posts the right movement and the ledger still sums", () => {
  // 15 bags of 50 kg plus 45 one-kilo packs on the stock sheet is 795 kg, all
  // of it on one row now, and counted in kilograms rather than containers.
  const p1 = itemId("Magadi");
  const systemBefore = stockOf(p1);
  assert.equal(systemBefore, 795_000);

  const plan = planStocktake([{ itemId: p1, countedUnits: 791 }]);
  assert.equal(plan.lines[0].deltaMilli, -4_000);
  assert.equal(plan.lines[0].deltaUnits, -4, "four kilograms short, not four bags");
  assert.equal(plan.varianceMilli, -4_000);

  const result = performStocktake({
    counts: [{ itemId: p1, countedUnits: 791 }],
    reason: "monthly count — 4 kg short",
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
  assert.equal(ledgerSum(p1), 791_000);
  assert.equal(stockOf(p1), 791_000);
});

test("a stocktake without a reason is refused", () => {
  const p1 = itemId("Magadi");
  assert.throws(
    () => performStocktake({ counts: [{ itemId: p1, countedUnits: 780 }], reason: "   ", userId: OWNER }),
    /reason is required/,
  );
  assert.equal(stockOf(p1), 791_000);
});

test("a negative physical count is refused", () => {
  const p1 = itemId("Magadi");
  assert.throws(
    () => performStocktake({ counts: [{ itemId: p1, countedUnits: -2 }], reason: "typo", userId: OWNER }),
    /cannot be negative/,
  );
  assert.equal(stockOf(p1), 791_000);
});

// ------------------------------------------------------------------ views

test("the stock view puts one row under each chemical", () => {
  const view = stockView();
  const ungerol = view.reagents.find((g) => g.name === "Ungerol");
  assert.ok(ungerol, "Ungerol block missing");

  // One row, not six. The five pack sizes were five names for one substance.
  assert.equal(ungerol!.lines.length, 1);
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
  assert.ok(view.totalValueCents > 0);
});

// ------------------------------------------------------------- (f) voiding
