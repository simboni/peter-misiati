/**
 * The checks that would have found it.
 *
 * The shop hit a day that made no sense and working out why took an export, a
 * spreadsheet and somebody who knew what to compare against what. Every error
 * behind it was the same shape — a quantity or a container size typed wrong on
 * a delivery — and not one announced itself. A cost price is just a number;
 * nothing about 2,000 a kilo looks wrong until you know the next drum came in
 * at 132.
 *
 * So these are written from the real errors, with the real figures. If a check
 * stops catching the thing it was built for, that is what fails here.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-health-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, all, run, stockOf, postMovement } = await import("../src/lib/db.ts");
const { createSupplier, recordPurchase } = await import("../src/lib/purchasing.ts");
const { checkBooks } = await import("../src/lib/health.ts");

seed();
for (const it of all<{ id: number }>(`SELECT id FROM items WHERE active = 1`)) {
  const q = stockOf(it.id);
  if (q !== 0) postMovement({ itemId: it.id, deltaMilli: -q, reason: "stocktake", userId: 1 });
  run(`UPDATE items SET cost_cents = 0 WHERE id = ?`, it.id);
}
const supplier = createSupplier({ name: "Chemi Traders Ltd" }, 1);

/** A product of our own, so the figures below are exactly the shop's. */
function product(name: string, unit: "kg" | "L" | "pcs", usualSizeKg: number, priceKes: number) {
  run(
    `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, price_basis, price_cents, cost_cents)
     VALUES (NULL, ?, 'bulk', ?, ?, 'drum', 1, 'unit', ?, 0)`,
    name,
    unit,
    Math.round(usualSizeKg * 1000),
    Math.round(priceKes * 100),
  );
  return get<{ id: number }>(`SELECT id FROM items WHERE name = ?`, name)!.id;
}

/** A delivery, in the shop's own terms: how many containers, how big, what it cost. */
function delivery(itemId: number, units: number, eachKg: number, totalKes: number, ref: string) {
  return recordPurchase({
    supplierId: supplier,
    ref,
    transportCents: 0,
    userId: 1,
    lines: [
      {
        itemId,
        units,
        sizeMilli: Math.round(eachKg * 1000),
        costCents: Math.round(totalKes * 100),
      },
    ],
  });
}

const titles = () => checkBooks().findings.map((f) => f.title);
const kinds = (needle: string) =>
  checkBooks().findings.filter((f) => f.title.includes(needle)).map((f) => f.kind);

// --------------------------------------------- the errors that were really there

test("BLUE: one delivery at fifteen times the rate of the other", () => {
  // 23 kg for 46,000 → 2,000/kg, against 51 kg for 6,760 → 132.55/kg.
  const blue = product("BLUE", "kg", 25, 250);
  delivery(blue, 1, 23, 46000, "INV-B1");
  delivery(blue, 1, 51, 6760, "INV-B2");

  /*
    Named by the price check, not by comparing the two deliveries: with only
    two there is no way to tell from the figures alone which is the odd one,
    and guessing got it backwards. The shop always knows what it charges.
  */
  const found = checkBooks().findings.filter((f) => f.title.startsWith("BLUE on"));
  assert.equal(found.length, 1, "one finding, about one delivery");
  assert.ok(found[0].title.includes("2,000.00"), "and it is the 2,000 a kilo one");
  assert.equal(found[0].kind, "Delivery dearer than the selling price");
});

test("AFRIC SALT: the container size typed as 5 kg instead of 50", () => {
  // 5 × 5 kg for 4,750 → 190/kg, where 5 × 50 kg → 19/kg.
  const salt = product("AFRIC SALT (SPECIAL)", "kg", 50, 25);
  delivery(salt, 5, 5, 4750, "INV-A1");
  delivery(salt, 1, 225, 4750, "INV-A2");
  delivery(salt, 10, 50, 9500, "INV-A3");

  assert.ok(
    kinds("AFRIC SALT").includes("Container size unlike the usual"),
    "a 5 kg container of something that comes in 50 is the finding",
  );
});

test("PURECARE SALT: a missing zero on the total", () => {
  // Three deliveries at 14.00/kg, then 500 kg for 700 instead of 7,000.
  const salt = product("PURECARE SALT", "kg", 50, 20);
  delivery(salt, 15, 50, 10500, "INV-P1");
  delivery(salt, 15, 50, 10500, "INV-P2");
  delivery(salt, 10, 50, 7000, "INV-P3");
  delivery(salt, 10, 50, 700, "INV-P4");

  assert.ok(
    titles().some((t) => t.startsWith("PURECARE SALT on") && t.includes("1.40")),
    "the tenth-of-the-price delivery is named",
  );
});

test("EDTA: bought once at 0.42 kg, with nothing to compare it against", () => {
  /*
    The check that earns its place. Comparing an item's deliveries against each
    other cannot see this one — there is only one delivery. What gives it away
    is the container: 0.42 kg of something that comes in 5 kg lots.
  */
  const edta = product("EDTA", "kg", 5, 700);
  delivery(edta, 1, 0.42, 600, "INV-E1");

  assert.ok(
    kinds("EDTA").includes("Container size unlike the usual"),
    "caught on the container, not on the rate",
  );
});

test("CITRIC ACID: priced at 50 and costing 330", () => {
  const acid = product("CITRIC ACID", "kg", 25, 50);
  delivery(acid, 1, 0.91, 300, "INV-C1");

  const found = checkBooks().findings.filter((f) => f.title.includes("CITRIC ACID"));
  assert.ok(
    found.some((f) => f.kind === "Priced under cost"),
    "the plainest loss there is, and invisible on any screen showing one number",
  );
});

// ------------------------------------------------- how it behaves as a list

test("one mistake is one row, not two", () => {
  /*
    A wrong container size also produces a wrong rate, so it trips both checks.
    Telling somebody twice about one mistake makes the list look worse than the
    shop is, which is how a list like this stops being read. The cause wins over
    the symptom.
  */
  // One finding about that delivery, not one per check it trips.
  const rows = checkBooks().findings.filter((f) => /AFRIC SALT \(SPECIAL\) on/.test(f.title));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "Container size unlike the usual");
});

test("the worst is first", () => {
  const order = checkBooks().findings.map((f) => f.severity);
  const rank = { high: 0, medium: 1, low: 2 };
  for (let i = 1; i < order.length; i++) {
    assert.ok(rank[order[i]] >= rank[order[i - 1]], "severity never goes back up the list");
  }
});

test("every finding says what was seen and where to put it right", () => {
  for (const f of checkBooks().findings) {
    assert.ok(f.title.length > 10, `${f.id} has no title`);
    assert.ok(f.detail.length > 20, `${f.id} says nothing about what was seen`);
    assert.ok(f.href, `${f.id} leads nowhere`);
  }
});

test("a delivery booked in at nothing is worth knowing about", () => {
  const free = product("OCEAN BREEZE MILD", "L", 20, 400);
  delivery(free, 1, 16.5, 0, "INV-F1");
  assert.ok(
    checkBooks().findings.some((f) => f.title.includes("OCEAN BREEZE MILD") && f.kind === "Delivery with no cost"),
  );
});

test("an ordinary shop produces an empty list", () => {
  // The check has to be able to say nothing is wrong, or it is just noise.
  const fine = product("PLAIN SOAP", "kg", 25, 200);
  delivery(fine, 4, 25, 10000, "INV-OK1");
  delivery(fine, 4, 25, 10400, "INV-OK2");

  assert.equal(
    checkBooks().findings.filter((f) => f.title.includes("PLAIN SOAP")).length,
    0,
    "two sensible deliveries of a sensibly priced thing raise nothing",
  );
});
