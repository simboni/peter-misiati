/**
 * Opening → bought → made → sold → used → adjusted → closing.
 *
 * The statement is only worth anything if it reconciles, so that is what most
 * of this file checks, and it checks it two ways: that the columns add up to
 * the closing figure, and that the closing figure equals what the shelf
 * independently says it holds. A statement that balances against itself but
 * disagrees with the stock list is the worst of both.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-stmt-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, run, stockOf } = await import("../src/lib/db.ts");
const {
  stockStatement,
  statementRange,
  readStatementPeriod,
  isStatementPeriod,
  topMovers,
} = await import("../src/lib/stock-statement.ts");

seed();

const idOf = (name: string) =>
  get<{ id: number }>(`SELECT id FROM items WHERE name = ?`, name)!.id;

const row = (s: ReturnType<typeof stockStatement>, name: string) =>
  s.rows.find((r) => r.name === name);

const TODAY = "2026-10-14";
const YESTERDAY = "2026-10-13";
const ITEM = "STATEMENT DRUM";

/*
  A week of trading, written straight into the ledger at fixed timestamps.

  Fixed, because the whole point of the statement is which side of a date each
  entry falls on, and a fixture that drifts with the clock cannot test that.
  Inserted rather than posted through `postMovement`, which always stamps now —
  and the ledger is append-only, so the date cannot be corrected afterwards.
  It is a fresh item so nothing the seed did is mixed into the arithmetic.
*/
run(
  `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                      sellable, price_basis, price_cents, cost_cents)
   VALUES (NULL, ?, 'bulk', 'kg', 170000, 'drum', 1, 'unit', 50000, 40000)`,
  ITEM,
);
const drum = idOf(ITEM);

function post(date: string, delta: number, reason: string) {
  run(
    `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id, at)
     VALUES (?, ?, ?, 1, ?)`,
    drum,
    delta,
    reason,
    // Stored in UTC; the shop reads it at +3, so 06:00 UTC is 09:00 in Nairobi
    // and lands unambiguously on the date written here.
    `${date} 06:00:00`,
  );
}

post("2026-10-01", 100_000, "purchase");   // 100 kg in, before the window
post(YESTERDAY, 50_000, "purchase");       // 50 kg bought
post(YESTERDAY, -8_000, "sale");           // 8 kg sold
post(TODAY, 20_000, "purchase");           // 20 kg bought
post(TODAY, -5_000, "sale");               // 5 kg sold
post(TODAY, -3_000, "batch_consume");      // 3 kg into a mix
post(TODAY, 2_000, "batch_output");        // 2 kg made
post(TODAY, -1_000, "stocktake");          // 1 kg written off by a count

// --------------------------------------------------------- the periods

test("yesterday is the day before today, not the last 24 hours", () => {
  const r = statementRange("yesterday", TODAY);
  assert.equal(r.from, YESTERDAY);
  assert.equal(r.to, YESTERDAY);
});

test("today is one day", () => {
  const r = statementRange("today", TODAY);
  assert.deepEqual(r, { from: TODAY, to: TODAY });
});

test("a pair of dates on their own means those dates", () => {
  assert.equal(readStatementPeriod({ from: "2026-10-01", to: "2026-10-07" }), "custom");
  assert.equal(readStatementPeriod({}), "today", "and today is the default");
  assert.equal(isStatementPeriod("yesterday"), true);
  assert.equal(isStatementPeriod("all"), false, "a statement over all time opens at zero");
});

test("dates typed backwards are read as a range, not an empty one", () => {
  const r = statementRange("custom", TODAY, "2026-10-10", "2026-10-02");
  assert.deepEqual(r, { from: "2026-10-02", to: "2026-10-10" });
});

// ------------------------------------------------------ the arithmetic

test("each column holds what it says, for one day", () => {
  const s = stockStatement(statementRange("today", TODAY));
  const r = row(s, ITEM)!;

  assert.equal(r.openingMilli, 142_000, "100 bought, then 50 in and 8 out yesterday");
  assert.equal(r.boughtMilli, 20_000);
  assert.equal(r.madeMilli, 2_000);
  assert.equal(r.soldMilli, 5_000, "reported positive — it went out");
  assert.equal(r.usedMilli, 3_000, "mixed into a batch, which is not a sale");
  assert.equal(r.adjustedMilli, -1_000, "signed, because a count can go either way");
  assert.equal(r.closingMilli, 155_000);
});

test("the columns add up to the closing figure, for every item", () => {
  for (const period of ["today", "yesterday", "week", "month"] as const) {
    const s = stockStatement(statementRange(period, TODAY));
    for (const r of s.rows) {
      assert.equal(
        r.openingMilli + r.boughtMilli + r.madeMilli - r.soldMilli - r.usedMilli + r.adjustedMilli,
        r.closingMilli,
        `${r.name} does not reconcile over ${period}`,
      );
    }
  }
});

test("the closing figure is what the shelf actually holds", () => {
  // The statement to today must agree with the stock count, or one of the two
  // is lying and the owner has no way to tell which.
  const s = stockStatement(statementRange("month", TODAY));
  for (const r of s.rows) {
    assert.equal(r.closingMilli, stockOf(r.itemId), `${r.name} disagrees with the shelf`);
  }
});

test("one period's closing is the next period's opening", () => {
  const yesterday = stockStatement(statementRange("yesterday", TODAY));
  const today = stockStatement(statementRange("today", TODAY));
  assert.equal(row(yesterday, ITEM)!.closingMilli, row(today, ITEM)!.openingMilli);
});

test("a sale undone comes back off what was sold", () => {
  const before = row(stockStatement(statementRange("today", TODAY)), ITEM)!.soldMilli;
  post(TODAY, 5_000, "sale_void");
  const after = row(stockStatement(statementRange("today", TODAY)), ITEM)!;

  assert.equal(after.soldMilli, before - 5_000, "less was sold after all");
  assert.equal(
    after.openingMilli + after.boughtMilli + after.madeMilli - after.soldMilli - after.usedMilli +
      after.adjustedMilli,
    after.closingMilli,
    "and it still reconciles",
  );
});

// ----------------------------------------------------------- the money

test("the shop total is money, and it is the quantities at cost", () => {
  const s = stockStatement(statementRange("today", TODAY));
  const r = row(s, ITEM)!;
  assert.ok(r.costCents > 0, "the seeded shop costs its chemicals");
  assert.equal(r.openingValueCents, Math.round((r.openingMilli * r.costCents) / 1000));
  assert.equal(r.closingValueCents, Math.round((r.closingMilli * r.costCents) / 1000));

  assert.equal(
    s.totals.openingValueCents,
    s.rows.reduce((sum, x) => sum + x.openingValueCents, 0),
    "the total is its rows",
  );
});

test("stock with no cost price is named rather than valued at nothing", () => {
  run(`UPDATE items SET cost_cents = 0 WHERE name = ?`, ITEM);
  const s = stockStatement(statementRange("today", TODAY));
  assert.ok(s.uncosted.includes(ITEM), "the valuation is short and says so");
  assert.equal(row(s, ITEM)!.closingValueCents, 0);
  assert.ok(row(s, ITEM)!.closingMilli > 0, "while the quantity is still right");
});

// ----------------------------------------------------------- the shape

test("an item that never held anything and never moved is left out", () => {
  run(
    `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, price_basis, price_cents, cost_cents)
     VALUES (NULL, 'NEVER TOUCHED', 'bulk', 'kg', 1000, 'bag', 1, 'unit', 100, 0)`,
  );
  const s = stockStatement(statementRange("today", TODAY));
  assert.equal(row(s, "NEVER TOUCHED"), undefined, "forty empty rows bury the six that matter");
});

test("something that moved and ended at zero is still on the statement", () => {
  const held = stockOf(drum);
  post(TODAY, -held, "sale");
  const s = stockStatement(statementRange("today", TODAY));
  const r = row(s, ITEM)!;
  assert.equal(r.closingMilli, 0);
  assert.ok(r.moved, "it emptied today, which is exactly the day to see it");
  post(TODAY, held, "sale_void"); // put it back for anything after this
});

test("the movers are ranked by what moved, not by what is held", () => {
  const s = stockStatement(statementRange("today", TODAY));
  const top = topMovers(s, 3);
  assert.ok(top.length > 0);
  assert.ok(top.every((r) => r.moved), "a drum that sat still all month is not news");
});
