/**
 * "I have dealt with this", and the thing it must not be able to do.
 *
 * The shop asked for a way to tick a finding off when it will not go away by
 * itself — a correction made on paper, a price that is simply right. The danger
 * in granting it is obvious: an owner who can silence a row can silence next
 * week's row without ever seeing it. So a dismissal is tied to what the finding
 * was saying at the time, and these are the tests that hold it there.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-dismiss-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, all, run, stockOf, postMovement } = await import("../src/lib/db.ts");
const { createSupplier, recordPurchase } = await import("../src/lib/purchasing.ts");
const { checkBooks } = await import("../src/lib/health.ts");
const { fingerprint, dismiss, restore, isDismissed, activeDismissals, setAside, setAsideCount } =
  await import("../src/lib/dismissals.ts");

seed();
for (const it of all<{ id: number }>(`SELECT id FROM items WHERE active = 1`)) {
  const q = stockOf(it.id);
  if (q !== 0) postMovement({ itemId: it.id, deltaMilli: -q, reason: "stocktake", userId: 1 });
  run(`UPDATE items SET cost_cents = 0 WHERE id = ?`, it.id);
}
const supplier = createSupplier({ name: "Chemi Traders Ltd" }, 1);

function product(name: string, usualSizeKg: number, priceKes: number) {
  run(
    `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, price_basis, price_cents, cost_cents)
     VALUES (NULL, ?, 'bulk', 'kg', ?, 'drum', 1, 'unit', ?, 0)`,
    name,
    Math.round(usualSizeKg * 1000),
    Math.round(priceKes * 100),
  );
  return get<{ id: number }>(`SELECT id FROM items WHERE name = ?`, name)!.id;
}

function delivery(itemId: number, units: number, eachKg: number, totalKes: number, ref: string) {
  return recordPurchase({
    supplierId: supplier,
    ref,
    transportCents: 0,
    userId: 1,
    lines: [{ itemId, units, sizeMilli: Math.round(eachKg * 1000), costCents: Math.round(totalKes * 100) }],
  });
}

// ------------------------------------------------------------ the digest

test("the same words give the same digest, every time and across restarts", () => {
  assert.equal(fingerprint("23 kg at 2,000.00 a kg"), fingerprint("23 kg at 2,000.00 a kg"));
  assert.match(fingerprint("anything"), /^[0-9a-f]{8}$/);
});

test("one figure moving changes it", () => {
  // The whole mechanism rests on this. If a digest survived a changed number,
  // dismissing today's finding would hide tomorrow's.
  const was = fingerprint("23 kg arrived at KES 2,000.00 a kg");
  assert.notEqual(was, fingerprint("23 kg arrived at KES 2,001.00 a kg"));
  assert.notEqual(was, fingerprint("24 kg arrived at KES 2,000.00 a kg"));
  assert.notEqual(was, fingerprint(""));
});

// ------------------------------------------------- a finding, set aside

/** The one the first test answers, carried to the tests that follow it. */
let answered = { key: "", said: "" };

test("a finding the owner has answered stops being shown", () => {
  // Priced under cost: the shop asks 250 a kilo for something costing 695.
  const blue = product("BLUE", 25, 250);
  delivery(blue, 1, 23, 46000, "INV-B1");

  const before = checkBooks().findings.filter((f) => f.title.startsWith("BLUE"));
  assert.ok(before.length > 0, "it is being reported to begin with");

  const one = before[0];
  answered = { key: one.id, said: one.detail };
  dismiss(one.id, one.detail, 1, "checked the delivery note, the price is right");

  const after = checkBooks();
  assert.equal(
    after.findings.filter((f) => f.id === one.id).length,
    0,
    "and now it is not",
  );
  assert.ok(after.setAside >= 1, "but the screen is told how many are set aside");
});

test("the same finding saying something NEW comes back", () => {
  /*
    The point of the whole design. An owner answers "BLUE is costed at 695" and
    a fortnight later it is costed at 1,400 — a different fact, never answered,
    and it must not inherit the old silence.
  */
  const dismissed = activeDismissals();
  const { key, said } = answered;

  assert.equal(isDismissed(dismissed, key, said), true, "answered, in those words");
  assert.equal(
    isDismissed(dismissed, key, said + " (and one drum more)"),
    false,
    "the same product, a different figure, and the silence does not carry over",
  );
});

test("a dismissal can be taken back, and the row returns", () => {
  const { key } = answered;

  restore(key, 1);
  assert.equal(activeDismissals().has(key), false, "no longer standing");
  assert.ok(
    checkBooks().findings.some((f) => f.id === key),
    "and the finding is back on the screen",
  );
});

test("taking one back keeps the record of who hid it", () => {
  // Append-only, like the rest of the ledger: the row is marked, not removed.
  const rows = all<{ key: string; undone_at: string | null; said: string }>(
    `SELECT key, undone_at, said FROM dismissals ORDER BY id`,
  );
  assert.ok(rows.length > 0);
  assert.ok(rows.some((r) => r.undone_at !== null), "the undone one is still there");
  assert.ok(rows.every((r) => r.said.length > 0), "and still says what it was about");
});

// --------------------------------------------------- what it must not do

test("answering one finding does not silence another", () => {
  const acid = product("CITRIC ACID", 2, 50);
  delivery(acid, 1, 0.91, 300, "INV-C1");

  const found = checkBooks().findings.filter((f) => f.title.includes("CITRIC ACID"));
  assert.ok(found.length > 0);
  dismiss(found[0].id, found[0].detail, 1);

  const still = checkBooks().findings.filter((f) => f.title.includes("CITRIC ACID"));
  assert.equal(
    still.length,
    found.length - 1,
    "one answered, the rest of that product's findings untouched",
  );
});

test("the count of what is set aside is honest", () => {
  const n = setAsideCount();
  assert.equal(n, setAside().length, "the number and the list agree");
  assert.ok(
    setAside().every((d) => d.said.length > 0 && d.at.length > 0),
    "and every one says what it was and when",
  );
});
