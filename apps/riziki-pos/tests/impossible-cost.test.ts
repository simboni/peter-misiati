/**
 * A sale costed at a price the shop has never paid.
 *
 * The cost on a sale line is frozen at the moment of sale, deliberately: moving
 * a cost price today must not rewrite last month's profit. The weakness is the
 * mirror of that strength. A delivery entered with the wrong figures drags the
 * running average down the instant it is saved; every sale made before anybody
 * notices takes that wrong cost as its own; and correcting the delivery
 * afterwards puts the ITEM right while leaving those sales exactly as wrong as
 * they were. The profit simply reads better than the shop did.
 *
 * This is the net for it, and the test is arithmetic rather than a guess: a
 * weighted average cannot fall below the cheapest delivery that went into it.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-impossible-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, run, all, postMovement } = await import("../src/lib/db.ts");
const { createSupplier, recordPurchase, voidPurchase } = await import("../src/lib/purchasing.ts");
const { recordSale } = await import("../src/lib/sales.ts");
const { checkBooks } = await import("../src/lib/health.ts");

seed();
const supplier = createSupplier({ name: "Kel Chemicals Ltd" }, 1);

function product(name: string, costCents: number) {
  run(
    `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, price_basis, price_cents, cost_cents)
     VALUES (NULL, ?, 'bulk', 'kg', 170000, 'drum', 1, 'unit', 40000, ?)`,
    name,
    costCents,
  );
  return get<{ id: number }>(`SELECT id FROM items WHERE name = ?`, name)!.id;
}

let uuid = 0;
const sell = (itemId: number, qtyMilli: number, rateCents: number) =>
  recordSale({
    clientUuid: `imp-${++uuid}`,
    userId: 1,
    tier: "retail",
    lines: [{ itemId, units: 1, qtyMilli, unitPriceCents: rateCents }],
    tenders: [{ method: "cash", amountCents: Math.round((rateCents * qtyMilli) / 1000) }],
  });

const findingsFor = (itemId: number) =>
  checkBooks().findings.filter((f) => f.id === `impossible-cost:${itemId}`);

test("a sale costed below the cheapest delivery ever is reported", () => {
  /*
    The shape of 23 October. Ungerol landed at 345 a kilo; a delivery typed
    wrong dropped the average to about 70; a sale went out at that cost; the
    delivery was corrected and the item came right, leaving the sale behind.
  */
  const ung = product("UNGEROL IMPOSSIBLE", 34_500);
  recordPurchase({
    supplierId: supplier, ref: "DN-1", transportCents: 0, userId: 1, clientUuid: "imp-p1",
    lines: [{ itemId: ung, units: 1, sizeMilli: 170_000, costCents: 5_865_000 }], // 345/kg
  });

  // The wrong cost, as the mistyped delivery left it, and a sale taken at it.
  run(`UPDATE items SET cost_cents = 6951 WHERE id = ?`, ung);
  sell(ung, 20_000, 37_000);
  // Then the delivery is corrected and the item is right again.
  run(`UPDATE items SET cost_cents = 34_603 WHERE id = ?`, ung);

  const found = findingsFor(ung);
  assert.equal(found.length, 1, "the sale is reported even though the item is now right");
  assert.match(found[0].title, /1 sale of UNGEROL IMPOSSIBLE/);
  assert.match(found[0].detail, /never landed below/);
  assert.equal(found[0].severity, "high");
});

test("it says how much the profit is overstated by", () => {
  const blue = product("BLUE IMPOSSIBLE", 8_900);
  recordPurchase({
    supplierId: supplier, ref: "DN-2", transportCents: 0, userId: 1, clientUuid: "imp-p2",
    lines: [{ itemId: blue, units: 1, sizeMilli: 50_000, costCents: 445_000 }], // 89/kg
  });

  run(`UPDATE items SET cost_cents = 2017 WHERE id = ?`, blue);
  sell(blue, 3_000, 25_000); // 3 kg costed at 20.17 instead of at least 89
  run(`UPDATE items SET cost_cents = 9_534 WHERE id = ?`, blue);

  const found = findingsFor(blue)[0];
  assert.ok(found, "reported");
  // 3 kg at the cheapest it has ever landed (89.00) is 267.00; it was booked at
  // 60.51, so the profit on that one line is about 206 too good.
  assert.match(found.detail, /overstated by about KES 206/);
});

test("an ordinary sale at an ordinary cost is not reported", () => {
  const salt = product("SALT ORDINARY", 1_600);
  recordPurchase({
    supplierId: supplier, ref: "DN-3", transportCents: 0, userId: 1, clientUuid: "imp-p3",
    lines: [{ itemId: salt, units: 1, sizeMilli: 50_000, costCents: 80_000 }], // 16/kg
  });
  sell(salt, 10_000, 2_000);
  assert.equal(findingsFor(salt).length, 0);
});

test("a cost a little below the cheapest delivery is left alone", () => {
  /*
    An opening cost somebody set by hand, and rounding, both land slightly under
    the cheapest delivery. Flagging those would bury the one that matters.
  */
  const cma = product("CMA NEARLY", 9_500);
  recordPurchase({
    supplierId: supplier, ref: "DN-4", transportCents: 0, userId: 1, clientUuid: "imp-p4",
    lines: [{ itemId: cma, units: 1, sizeMilli: 50_000, costCents: 500_000 }], // 100/kg
  });
  run(`UPDATE items SET cost_cents = 9_500 WHERE id = ?`, cma); // 95, just under 100
  sell(cma, 5_000, 20_000);
  assert.equal(findingsFor(cma).length, 0, "95 against a floor of 100 is not a fault");
});

test("an item that has never been bought cannot be judged this way", () => {
  // No delivery, no floor, nothing to compare against — and saying nothing is
  // the honest answer rather than inventing a threshold.
  const mystery = product("NEVER DELIVERED", 500);
  postMovement({ itemId: mystery, deltaMilli: 100_000, reason: "opening", userId: 1 });
  sell(mystery, 10_000, 20_000);
  assert.equal(findingsFor(mystery).length, 0);
});

test("a voided delivery does not set the floor", () => {
  /*
    An undone delivery never happened, so a cheap one that was cancelled must
    not drag the floor down and hide a real fault behind it.
  */
  const ung = product("UNGEROL VOIDED FLOOR", 34_500);
  recordPurchase({
    supplierId: supplier, ref: "DN-5", transportCents: 0, userId: 1, clientUuid: "imp-p5",
    lines: [{ itemId: ung, units: 1, sizeMilli: 170_000, costCents: 5_865_000 }],
  });
  const cheap = recordPurchase({
    supplierId: supplier, ref: "DN-6", transportCents: 0, userId: 1, clientUuid: "imp-p6",
    lines: [{ itemId: ung, units: 1, sizeMilli: 170_000, costCents: 170_000 }], // 1/kg
  });
  voidPurchase(cheap.purchaseId, 1, "typed wrong");

  run(`UPDATE items SET cost_cents = 6951 WHERE id = ?`, ung);
  sell(ung, 20_000, 37_000);
  run(`UPDATE items SET cost_cents = 34_603 WHERE id = ?`, ung);

  assert.equal(findingsFor(ung).length, 1, "the cancelled delivery is not a floor");
});
