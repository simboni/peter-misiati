/**
 * Why a day came out the way it did.
 *
 * The shop asked "what happened on the 22nd" and the honest answer was that
 * three quite different things put a minus sign on a day and they want three
 * quite different answers. Getting the verdict wrong is worse than giving none:
 * a shop sent hunting for a costing mistake on the day it paid its rent has
 * been sent the wrong way by the thing it trusts.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-day-why-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, all, run, stockOf, postMovement } = await import("../src/lib/db.ts");
const { explainDay, causeOf } = await import("../src/lib/day-why.ts");

seed();

for (const it of all<{ id: number }>(`SELECT id FROM items WHERE active = 1`)) {
  const q = stockOf(it.id);
  if (q !== 0) postMovement({ itemId: it.id, deltaMilli: -q, reason: "stocktake", userId: 1 });
  run(`UPDATE items SET cost_cents = 0 WHERE id = ?`, it.id);
}

const ungerol = get<{ id: number }>(`SELECT id FROM items WHERE name = 'Ungerol'`)!;
const flares = get<{ id: number }>(`SELECT id FROM items WHERE name = 'Flares'`)!;
run(`UPDATE items SET price_cents = 51300, cost_cents = 32000 WHERE id = ?`, ungerol.id);
run(`UPDATE items SET price_cents = 47300, cost_cents = 54395 WHERE id = ?`, flares.id);

/** A completed sale on a chosen day, written at the time it is meant to have. */
let n = 0;
function sell(day: string, itemId: number, qtyMilli: number, rateCents: number, costCents: number) {
  const total = Math.round((rateCents * qtyMilli) / 1000);
  const { lastInsertRowid } = run(
    `INSERT INTO sales (client_uuid, at, user_id, tier, total_cents, paid_cents, status)
     VALUES (?, ?, 1, 'retail', ?, ?, 'completed')`,
    `why-${++n}`,
    `${day} 10:00:00`,
    total,
    total,
  );
  const id = Number(lastInsertRowid);
  run(
    `INSERT INTO sale_lines (sale_id, item_id, name_snapshot, units, qty_milli,
                             unit_price_cents, rate_cents, list_price_cents, line_total_cents, cost_cents)
     VALUES (?, ?, (SELECT name FROM items WHERE id = ?), 1, ?, ?, ?, ?, ?, ?)`,
    id, itemId, itemId, qtyMilli, total, rateCents, rateCents, total, costCents,
  );
  run(
    `INSERT INTO payments (sale_id, at, method, amount_cents, user_id) VALUES (?, ?, 'cash', ?, 1)`,
    id, `${day} 10:00:00`, total,
  );
  return id;
}

const QUIET = "2026-09-20";
const UNDER = "2026-09-21";
const LATE = "2026-09-22";
const GOOD = "2026-09-23";

// ------------------------------------------------------------ the verdicts

test("a day nobody traded on says so, rather than blaming something", () => {
  const d = explainDay("2026-09-01");
  assert.equal(d.cause, "nothing");
  assert.equal(d.summary.salesCents, 0);
  assert.equal(d.sales.length, 0);
});

test("a profitable day is not a problem looking for a cause", () => {
  sell(GOOD, ungerol.id, 20000, 51300, 640000);
  const d = explainDay(GOOD);
  assert.equal(d.cause, "positive");
  assert.ok(d.summary.netProfitCents > 0);
});

test("an expense on a quiet day is money spent, not money lost", () => {
  // The verdict that means nothing is wrong. Getting this one wrong sends a
  // shop hunting for a costing mistake on the day it paid its rent.
  sell(QUIET, ungerol.id, 20000, 51300, 640000);
  run(
    `INSERT INTO expenses (at, category, amount_cents, method, note, user_id)
     VALUES (?, 'Rent', 4500000, 'mpesa', 'shop rent', 1)`,
    `${QUIET} 08:00:00`,
  );

  const d = explainDay(QUIET);
  assert.equal(d.cause, "expenses");
  assert.ok(d.summary.grossProfitCents > 0, "the goods still sold at a profit");
  assert.ok(d.summary.netProfitCents < 0, "and the day is still negative");
  assert.equal(d.spend.length, 1);
  assert.equal(d.spend[0].amountCents, 4500000);
  assert.equal(d.spend[0].category, "Rent");
});

test("selling under cost is a costing problem, and the product is named", () => {
  sell(UNDER, flares.id, 150000, 47300, 8159250);
  const d = explainDay(UNDER);

  assert.equal(d.cause, "under-cost");
  assert.ok(d.summary.grossProfitCents < 0, "negative before a single expense");
  assert.ok(
    d.losers.some((p) => p.name.startsWith("Flares")),
    "the thing that lost the money is on the list",
  );
  assert.ok(
    d.underwater.some((i) => i.name === "Flares" && i.lossCents === 54395 - 47300),
    "and it is flagged as losing money on every sale, whatever this day did",
  );
});

test("a cost typed in afterwards is named as that, not as selling under cost", () => {
  /*
    The only one of the three that rewrites history. Sold while no cost was
    known, so the line froze at zero; a wrong cost saved later is then applied
    backwards at today's rate. Reporting this as "sold under cost" would send
    the shop looking at a price that was perfectly fine on the day.
  */
  run(`UPDATE items SET cost_cents = 0 WHERE id = ?`, ungerol.id);
  sell(LATE, ungerol.id, 40000, 51300, 0);

  const before = explainDay(LATE);
  assert.equal(before.cause, "positive", "with no cost known it reads as all profit");
  assert.ok(before.summary.uncostedSalesCents > 0, "and says so out loud");

  // A whole drum's price typed into a box that means "per kilo".
  run(`UPDATE items SET cost_cents = ? WHERE id = ?`, 32000 * 250, ungerol.id);

  const after = explainDay(LATE);
  assert.equal(after.cause, "late-cost");
  assert.ok(after.summary.estimatedCostCents > 0);
  assert.equal(
    after.borrowed.length,
    1,
    "the product being valued at today's price is named",
  );
  assert.equal(after.borrowed[0].rateCents, 32000 * 250);
  assert.equal(after.borrowed[0].qtyMilli, 40000);
});

test("the day did not change — only what is charged against it", () => {
  // Worth stating separately, because it is the fact that makes the verdict
  // actionable: nothing happened on the 22nd, so nothing on the 22nd needs
  // correcting.
  const d = explainDay(LATE);
  assert.equal(d.sales.length, 1);
  assert.equal(d.sales[0].costCents, 0, "the line still carries the zero it was sold with");
});

// ------------------------------------------------------- the order of the rules

test("an expense is checked before a costing verdict", () => {
  const s = {
    salesCents: 10000, cogsCents: 5000, grossProfitCents: 5000,
    expensesCents: 20000, netProfitCents: -15000, saleCount: 1,
    estimatedCostCents: 5000, uncostedSalesCents: 0,
  };
  assert.equal(causeOf(s, true), "expenses", "gross is positive, so it cannot be a costing fault");
});

test("a borrowed cost is checked before a plain under-cost verdict", () => {
  // Both show a negative gross. Only one of them is about this day at all.
  const borrowed = {
    salesCents: 20000, cogsCents: 30000, grossProfitCents: -10000,
    expensesCents: 0, netProfitCents: -10000, saleCount: 1,
    estimatedCostCents: 30000, uncostedSalesCents: 0,
  };
  assert.equal(causeOf(borrowed, true), "late-cost");

  const real = { ...borrowed, estimatedCostCents: 0 };
  assert.equal(causeOf(real, true), "under-cost");
});

test("half the cost borrowed is enough to blame the borrowing", () => {
  // The line has to be somewhere. Half is the point at which the figure being
  // argued about is mostly not this day's.
  const half = {
    salesCents: 20000, cogsCents: 30000, grossProfitCents: -10000,
    expensesCents: 0, netProfitCents: -10000, saleCount: 1,
    estimatedCostCents: 15000, uncostedSalesCents: 0,
  };
  assert.equal(causeOf(half, true), "late-cost");
  assert.equal(causeOf({ ...half, estimatedCostCents: 14999 }, true), "under-cost");
});
