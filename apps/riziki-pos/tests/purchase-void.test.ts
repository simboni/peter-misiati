/**
 * Undoing a delivery that should not be there.
 *
 * The shop can already correct a delivery whose figures are wrong. What it had
 * no answer for was a delivery that did not happen: one typed twice, one
 * entered against the wrong supplier, goods that went back on the lorry. The
 * dangerous part is not the stock — that is one subtraction — it is the cost
 * price, because the weighted average is a running figure and every delivery
 * since has been blended against the number this one produced.
 *
 * So the test that matters is the last one: after undoing, the cost is exactly
 * what it would have been had the delivery never been typed.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-pvoid-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, all, run, stockOf, postMovement } = await import("../src/lib/db.ts");
const {
  createSupplier,
  recordPurchase,
  voidPurchase,
  correctPurchasePrices,
  listPurchases,
  supplierSpend,
} = await import("../src/lib/purchasing.ts");
const { landedHistory } = await import("../src/lib/landed.ts");

seed();
for (const it of all<{ id: number }>(`SELECT id FROM items WHERE active = 1`)) {
  const q = stockOf(it.id);
  if (q !== 0) postMovement({ itemId: it.id, deltaMilli: -q, reason: "stocktake", userId: 1 });
  run(`UPDATE items SET cost_cents = 0 WHERE id = ?`, it.id);
}
const supplier = createSupplier({ name: "Chemi Traders Ltd" }, 1);

function product(name: string) {
  run(
    `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, price_basis, price_cents, cost_cents)
     VALUES (NULL, ?, 'bulk', 'kg', 170000, 'drum', 1, 'unit', 39500, 0)`,
    name,
  );
  return get<{ id: number }>(`SELECT id FROM items WHERE name = ?`, name)!.id;
}

const deliver = (itemId: number, units: number, eachKg: number, totalKes: number, ref: string) =>
  recordPurchase({
    supplierId: supplier,
    ref,
    transportCents: 0,
    userId: 1,
    lines: [{ itemId, units, sizeMilli: Math.round(eachKg * 1000), costCents: Math.round(totalKes * 100) }],
  });

const costOf = (id: number) => get<{ c: number }>(`SELECT cost_cents AS c FROM items WHERE id = ?`, id)!.c;

// ---------------------------------------------------------- the stock

test("the goods come back off the shelf", () => {
  const ung = product("UNGEROL");
  deliver(ung, 2, 170, 124100, "DN-1");
  assert.equal(stockOf(ung), 340_000, "340 kg arrived");

  const second = deliver(ung, 1, 170, 61200, "DN-2");
  assert.equal(stockOf(ung), 510_000);

  voidPurchase(second.purchaseId, 1, "typed twice");
  assert.equal(stockOf(ung), 340_000, "and the second one is off again");
});

test("nothing is deleted — both entries stay on the ledger", () => {
  const rows = all<{ reason: string; delta_milli: number; note: string | null }>(
    `SELECT reason, delta_milli, note FROM stock_movements WHERE ref_type = 'purchase' ORDER BY id`,
  );
  assert.ok(rows.some((r) => r.reason === "purchase" && r.delta_milli === 170_000), "the arrival");
  assert.ok(
    rows.some((r) => r.reason === "adjustment" && r.delta_milli === -170_000),
    "and the reversal beside it",
  );
  assert.ok(
    rows.find((r) => r.delta_milli === -170_000)!.note?.includes("typed twice"),
    "saying why",
  );
});

// ----------------------------------------------------------- the cost

test("the cost price goes back to where it would have been", () => {
  /*
    The whole point. Ungerol at 365 a kilo, then a bad delivery at 450 that
    drags the average up, then the undo. The average has to land back on 365
    exactly — not near it, and not on some figure arrived at by subtracting.
  */
  const ung = product("UNGEROL TWO");
  deliver(ung, 2, 170, 124100, "DN-A"); // 340 kg at 365.00
  const clean = costOf(ung);
  assert.equal(clean, 36_500, "365.00 a kilo");

  const bad = deliver(ung, 5, 225, 506250, "DN-B"); // 1,125 kg at 450.00
  assert.ok(costOf(ung) > clean, "the bad delivery drags the average up");

  voidPurchase(bad.purchaseId, 1, "wrong supplier, never arrived");
  assert.equal(costOf(ung), clean, "and undoing it puts the average back exactly");
});

test("a delivery after the voided one is still counted", () => {
  // The replay walks the whole history; only the undone delivery drops out.
  const ung = product("UNGEROL THREE");
  deliver(ung, 1, 100, 36500, "DN-C"); // 100 kg at 365
  const bad = deliver(ung, 1, 100, 50000, "DN-D"); // 100 kg at 500
  deliver(ung, 1, 100, 35500, "DN-E"); // 100 kg at 355

  voidPurchase(bad.purchaseId, 1, "goods went back on the lorry");

  // 100 kg at 365 then 100 kg at 355 is 360 a kilo.
  assert.equal(costOf(ung), 36_000, "365 and 355 blended, and nothing else");
  assert.equal(stockOf(ung), 200_000, "and 200 kg on the shelf");
});

// -------------------------------------------------------- what it refuses

test("it will not be done twice", () => {
  const ung = product("UNGEROL FOUR");
  const one = deliver(ung, 1, 170, 61200, "DN-F");
  voidPurchase(one.purchaseId, 1, "a mistake");
  assert.throws(() => voidPurchase(one.purchaseId, 1, "again"), /already been undone/);
});

test("it asks why", () => {
  const ung = product("UNGEROL FIVE");
  const one = deliver(ung, 1, 170, 61200, "DN-G");
  assert.throws(() => voidPurchase(one.purchaseId, 1, "   "), /why/i);
  assert.throws(() => voidPurchase(999_999, 1, "gone"), /no longer exists/);
});

// ------------------------------------------------- what it reports rather than blocks

test("goods already sold out of it leave the count below zero, and it says so", () => {
  /*
    Not refused. If a delivery was entered, sold from, and then turns out never
    to have happened, the stock really did leave the shop — and a count below
    zero is the honest record. What matters is that whoever did it is told.
  */
  const ung = product("UNGEROL SIX");
  const one = deliver(ung, 1, 100, 36500, "DN-H");
  postMovement({ itemId: ung, deltaMilli: -80_000, reason: "sale", userId: 1 });

  const res = voidPurchase(one.purchaseId, 1, "never arrived");
  assert.equal(stockOf(ung), -80_000, "80 kg short, which is the truth");
  assert.equal(res.nowBelowZero.length, 1, "and the result says so");
  assert.equal(res.nowBelowZero[0].name, "UNGEROL SIX");
  assert.equal(res.nowBelowZero[0].shortMilli, 80_000);
});

test("it reports where every cost price landed", () => {
  const ung = product("UNGEROL SEVEN");
  deliver(ung, 1, 100, 36500, "DN-I");
  const bad = deliver(ung, 1, 100, 50000, "DN-J");
  const res = voidPurchase(bad.purchaseId, 1, "duplicate");

  assert.equal(res.recosted.length, 1);
  assert.equal(res.recosted[0].name, "UNGEROL SEVEN");
  assert.equal(res.recosted[0].costCents, 36_500, "back to 365.00");
  assert.equal(res.ref, "DN-J", "and names the delivery note it undid");
});

// ------------------------------------------------- what stops counting it

/*
  Undoing has to reach the screens, not just the ledger.

  A delivery that was undone is still a row — it has to be, so whoever typed
  it twice can see the second one was cancelled — but every figure that asks
  "what did we spend" or "what did it land at" must stop including it. Each of
  these reads a different query, and each one of them was adding it up.
*/

test("it stops counting as money spent", () => {
  const ung = product("UNGEROL EIGHT");
  const keep = deliver(ung, 1, 100, 30000, "DN-K");
  const drop = deliver(ung, 1, 100, 90000, "DN-L");

  const before = listPurchases({ q: "DN-", perPage: 50 });
  const spentBefore = before.totalCents;

  voidPurchase(drop.purchaseId, 1, "wrong supplier");

  const after = listPurchases({ q: "DN-", perPage: 50 });
  assert.equal(after.total, before.total, "the row is still on the list");
  assert.equal(after.totalCents, spentBefore - 9_000_000, "but the shilling total drops it");

  const row = after.rows.find((r) => r.id === drop.purchaseId)!;
  assert.ok(row.voided_at, "and the row says it was undone");
  assert.equal(row.void_reason, "wrong supplier");

  const kept = after.rows.find((r) => r.id === keep.purchaseId)!;
  assert.equal(kept.voided_at, null, "the real one is untouched");
});

test("it stops counting against the supplier", () => {
  const ung = product("UNGEROL NINE");
  const drop = deliver(ung, 1, 100, 70000, "DN-M");

  const before = supplierSpend().find((s) => s.id === supplier)!.spend_cents;
  voidPurchase(drop.purchaseId, 1, "returned on the lorry");
  const after = supplierSpend().find((s) => s.id === supplier)!.spend_cents;

  assert.equal(after, before - 7_000_000, "the supplier is not owed for goods that went back");
});

test("its landed rate leaves the cost history", () => {
  const ung = product("UNGEROL TEN");
  deliver(ung, 1, 100, 36500, "DN-N");
  const drop = deliver(ung, 1, 100, 99000, "DN-O");

  assert.equal(landedHistory(ung).length, 2);
  voidPurchase(drop.purchaseId, 1, "typed twice");

  const history = landedHistory(ung);
  assert.equal(history.length, 1, "a delivery that did not happen has no landed rate");
  assert.equal(history[0].ref, "DN-N");
});

test("a delivery that was undone cannot then be corrected", () => {
  const ung = product("UNGEROL ELEVEN");
  const drop = deliver(ung, 1, 100, 36500, "DN-P");
  const line = get<{ id: number }>(
    `SELECT id FROM purchase_lines WHERE purchase_id = ?`,
    drop.purchaseId,
  )!.id;

  voidPurchase(drop.purchaseId, 1, "never came");

  assert.throws(
    () =>
      correctPurchasePrices(
        drop.purchaseId,
        { transportCents: 0, lines: [{ lineId: line, costCents: 40_000 }] },
        1,
      ),
    /undone/,
    "there is nothing to put right on a delivery that did not happen",
  );
});

// ------------------------------------------- the delivery entered twice

/*
  The shop reported recording one delivery and finding two. The form was most
  of the cause — a successful save left every box filled in, so one more press
  sent exactly the same thing again — but a form that clears is a convenience,
  not a guarantee. Two taps a second apart are two requests, and only the
  database can decide which of them is first.
*/

test("the same delivery sent twice is recorded once", () => {
  const ung = product("UNGEROL TWICE");
  const ref = "same-form-abc";

  const first = recordPurchase({
    supplierId: supplier, ref: "DN-T", transportCents: 0, userId: 1, clientUuid: ref,
    lines: [{ itemId: ung, units: 1, sizeMilli: 170_000, costCents: 6_000_000 }],
  });
  const second = recordPurchase({
    supplierId: supplier, ref: "DN-T", transportCents: 0, userId: 1, clientUuid: ref,
    lines: [{ itemId: ung, units: 1, sizeMilli: 170_000, costCents: 6_000_000 }],
  });

  assert.equal(second.purchaseId, first.purchaseId, "the second press finds the first delivery");
  assert.equal(second.duplicate, true, "and says so, rather than reporting a new one");
  assert.equal(stockOf(ung), 170_000, "the stock went up once");
  assert.equal(
    all<{ n: number }>(`SELECT COUNT(*) AS n FROM purchases WHERE client_uuid = ?`, ref)[0].n,
    1,
    "and there is one row, not two",
  );
});

test("two real deliveries of the same goods are both recorded", () => {
  // The guard must not swallow a shop that genuinely took two drums off two
  // lorries on the same afternoon: different form, different reference.
  const ung = product("UNGEROL TWICE OVER");
  const a = recordPurchase({
    supplierId: supplier, ref: "DN-U", transportCents: 0, userId: 1, clientUuid: "form-1",
    lines: [{ itemId: ung, units: 1, sizeMilli: 170_000, costCents: 6_000_000 }],
  });
  const b = recordPurchase({
    supplierId: supplier, ref: "DN-U", transportCents: 0, userId: 1, clientUuid: "form-2",
    lines: [{ itemId: ung, units: 1, sizeMilli: 170_000, costCents: 6_000_000 }],
  });
  assert.notEqual(a.purchaseId, b.purchaseId);
  assert.equal(stockOf(ung), 340_000, "both arrived");
});

test("a delivery with no device reference is still recorded", () => {
  // No JavaScript, no reference. A delivery with no guard is better than one
  // the shop could not enter at all.
  const ung = product("UNGEROL NO REF");
  const a = recordPurchase({
    supplierId: supplier, ref: "DN-V", transportCents: 0, userId: 1,
    lines: [{ itemId: ung, units: 1, sizeMilli: 170_000, costCents: 6_000_000 }],
  });
  const b = recordPurchase({
    supplierId: supplier, ref: "DN-V", transportCents: 0, userId: 1,
    lines: [{ itemId: ung, units: 1, sizeMilli: 170_000, costCents: 6_000_000 }],
  });
  assert.notEqual(a.purchaseId, b.purchaseId, "two nulls are not the same reference");
  assert.equal(stockOf(ung), 340_000);
});
