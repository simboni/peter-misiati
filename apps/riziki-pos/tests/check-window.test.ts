/**
 * Worth checking, over a window of days.
 *
 * The screen now takes dates, and a date filter on a fault-finding screen is a
 * dangerous thing: every way of getting it wrong ends with the shop being told
 * it is fine when it is not. Three rules, and this file is here to hold them.
 *
 *  1. A WINDOW NARROWS EVENTS, NEVER STANDING FAULTS. A delivery typed wrong on
 *     the Tuesday belongs to Tuesday. A product with no price belongs to today,
 *     every day, until somebody prices it — and narrowing to Yesterday must not
 *     make it disappear.
 *
 *  2. A WINDOW NEVER NARROWS WHAT A CHECK COMPARES AGAINST. An item's cost is
 *     impossible against the cheapest the shop has EVER paid, not the cheapest
 *     inside the window. Narrowing the comparison would let a fault hide in a
 *     week that happens to contain no deliveries.
 *
 *  3. WHAT IT HIDES, IT COUNTS. A short list must never be mistakable for a
 *     clean shop.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-check-window-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, run } = await import("../src/lib/db.ts");
const { createSupplier, recordPurchase } = await import("../src/lib/purchasing.ts");
const { checkBooks } = await import("../src/lib/health.ts");
const { businessDate } = await import("../src/lib/units.ts");
const { listRange, readListPeriod } = await import("../src/lib/list-range.ts");

seed();
const supplier = createSupplier({ name: "Kel Chemicals Ltd" }, 1);

/** Dates derived, never written down: a hardcoded date passes today and fails in March. */
const TODAY = businessDate();
const day = (back: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
};
const YESTERDAY = day(1);
const LONG_AGO = day(40);

function product(name: string, priceCents: number, costCents: number) {
  run(
    `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, price_basis, price_cents, cost_cents)
     VALUES (NULL, ?, 'bulk', 'kg', 5000, 'drum', 1, 'unit', ?, ?)`,
    name,
    priceCents,
    costCents,
  );
  return get<{ id: number }>(`SELECT id FROM items WHERE name = ?`, name)!.id;
}

let n = 0;
/**
 * A delivery on a chosen day.
 *
 * Recorded properly and then back-dated, because a purchase's timestamp is set
 * by the insert and the window is the whole point of this file.
 */
function deliveryOn(date: string, itemId: number, sizeMilli: number, costCents: number) {
  const { purchaseId } = recordPurchase({
    supplierId: supplier,
    ref: `DN-W${++n}`,
    transportCents: 0,
    userId: 1,
    clientUuid: `w-${n}`,
    lines: [{ itemId, units: 1, sizeMilli, costCents }],
  });
  run(`UPDATE purchases SET at = ? WHERE id = ?`, `${date} 09:00:00`, purchaseId);
  return purchaseId;
}

// A product whose container size is wildly unlike the usual, delivered long
// ago. An EVENT, and one with a date on it.
const odd = product("ODD CONTAINER POWDER", 50_000, 10_000);
deliveryOn(LONG_AGO, odd, 5_000, 25_000);
deliveryOn(YESTERDAY, odd, 400_000, 2_000_000); // 80x the usual container

// A product with no price at all. A STATE, with no date anywhere on it.
const unpriced = product("NEVER PRICED GEL", 0, 1_000);

const ids = (fs: Array<{ id: string }>) => fs.map((f) => f.id);

test("with no window at all, everything is reported — the old behaviour", () => {
  const r = checkBooks();
  assert.ok(ids(r.findings).includes(`no-price:${unpriced}`));
  assert.ok(r.findings.some((f) => f.title.includes("ODD CONTAINER POWDER")));
  assert.equal(r.outsideWindow, 0, "nothing can be outside a window that was not asked for");
});

test("a dated finding falls in the window it happened in, and out of the others", () => {
  const yday = checkBooks({ from: YESTERDAY, to: YESTERDAY });
  assert.ok(
    yday.dated.some((f) => f.title.includes("ODD CONTAINER POWDER")),
    "the delivery was yesterday",
  );

  const today = checkBooks({ from: TODAY, to: TODAY });
  assert.ok(
    !today.dated.some((f) => f.title.includes("ODD CONTAINER POWDER")),
    "and it was not today",
  );
});

test("a standing fault survives every window, including one it cannot belong to", () => {
  for (const range of [
    { from: TODAY, to: TODAY },
    { from: YESTERDAY, to: YESTERDAY },
    // A window entirely before the shop existed. Even here it holds.
    { from: "1999-01-01", to: "1999-01-02" },
  ]) {
    const r = checkBooks(range);
    assert.ok(
      ids(r.standing).includes(`no-price:${unpriced}`),
      `an unpriced product vanished under ${range.from}`,
    );
    assert.ok(ids(r.findings).includes(`no-price:${unpriced}`), "and out of the whole list");
  }
});

test("every finding is in exactly one of the two lists", () => {
  const r = checkBooks({ from: YESTERDAY, to: TODAY });
  assert.equal(r.dated.length + r.standing.length, r.findings.length);
  assert.ok(r.dated.every((f) => f.at !== undefined), "a dated finding carries its date");
  assert.ok(r.standing.every((f) => f.at === undefined), "a standing one carries none");
});

test("what the window leaves out, it counts", () => {
  const all = checkBooks();
  const today = checkBooks({ from: TODAY, to: TODAY });
  assert.ok(today.outsideWindow > 0, "the old delivery is being hidden");
  assert.equal(
    today.findings.length + today.outsideWindow,
    all.findings.length,
    "the count has to add up to the whole, or the screen is lying about what it hides",
  );
});

test("the comparison a check makes is never narrowed by the window", () => {
  /*
    The rule that matters most. "This container is 80 times the usual size" is
    only knowable from the item's whole history. A window containing just the
    bad delivery and none of the ordinary ones must still report it — if the
    window narrowed what it compares against, the odd one would become the only
    one, and therefore normal.
  */
  const narrow = checkBooks({ from: YESTERDAY, to: YESTERDAY });
  const found = narrow.dated.filter((f) => f.title.includes("ODD CONTAINER POWDER"));
  assert.equal(found.length, 1, "still an outlier, judged against deliveries outside the window");
});

test("the screen's default is everything, not today", () => {
  /*
    A check screen that opens on Today shows an empty page every morning, and
    an empty check screen reads as "nothing is wrong". Narrowing is something
    the owner does on purpose.
  */
  assert.equal(readListPeriod({}), "all");
  assert.equal(listRange("all", TODAY), null);
});

test("yesterday means the day before, and excludes today", () => {
  const r = listRange("yesterday", TODAY)!;
  assert.equal(r.from, YESTERDAY);
  assert.equal(r.to, YESTERDAY);
  assert.notEqual(r.to, TODAY);
});
