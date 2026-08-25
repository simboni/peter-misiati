/**
 * The morning price check.
 *
 * The thing worth protecting is the guard rail. This screen is open to
 * attendants, which is the whole point of it, and the only reason that is safe
 * is that the band holds. So these tests push on it from both ends — under the
 * floor and over the ceiling — and check that a refused batch leaves nothing
 * behind, because a half-applied price list is worse than none.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "riziki-pricing-"));
process.env.RIZIKI_DB = join(TMP, "test.db");

const { get, all, run } = await import("../src/lib/db.ts");
const { toCents, toMilli } = await import("../src/lib/units.ts");
const {
  applyPrices,
  setCounterPrice,
  priceHistory,
  priceHistoryPage,
  PriceError,
} = await import("../src/lib/pricing.ts");

process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

const OWNER = Number(
  run(`INSERT INTO users (name, role, pin_hash) VALUES ('Owner', 'owner', 'x')`).lastInsertRowid,
);
const STAFF = Number(
  run(`INSERT INTO users (name, role, pin_hash) VALUES ('Amina', 'staff', 'x')`).lastInsertRowid,
);

function item(name: string, price: number, floor: number, ceiling: number): number {
  return Number(
    run(
      `INSERT INTO items (name, kind, canonical_unit, size_milli, unit_label, sellable,
                          price_basis, price_cents, floor_cents, ceiling_cents)
       VALUES (?, 'bulk', 'kg', ?, 'bag', 1, 'unit', ?, ?, ?)`,
      name,
      toMilli(1),
      toCents(price),
      toCents(floor),
      toCents(ceiling),
    ).lastInsertRowid,
  );
}

const CAUSTIC = item("Caustic Soda", 200, 150, 260);
const SLES = item("Ungerol", 500, 400, 650);
const NOBAND = item("Salt", 20, 0, 0);

test("an attendant may raise a price, and the old one is kept", () => {
  const res = applyPrices([{ itemId: CAUSTIC, price: 230 }], STAFF);

  assert.equal(res.changed, 1);
  assert.equal(
    get<{ price_cents: number }>(`SELECT price_cents FROM items WHERE id = ?`, CAUSTIC)!.price_cents,
    toCents(230),
  );

  const hist = priceHistory(CAUSTIC);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].old_price, toCents(200), "what it was is still on the record");
  assert.equal(hist[0].new_price, toCents(230));
  assert.equal(hist[0].user_name, "Amina", "and who changed it");
});

test("the band holds against an attendant at both ends", () => {
  // Ungerol: asks 500, never below 400, never beyond 650.
  assert.throws(
    () => applyPrices([{ itemId: SLES, price: 350 }], STAFF),
    (e: unknown) => e instanceof PriceError && /below the least/.test((e as Error).message),
  );
  assert.throws(
    () => applyPrices([{ itemId: SLES, price: 900 }], STAFF),
    (e: unknown) => e instanceof PriceError && /above the most/.test((e as Error).message),
  );

  assert.equal(
    get<{ price_cents: number }>(`SELECT price_cents FROM items WHERE id = ?`, SLES)!.price_cents,
    toCents(500),
    "nothing was written",
  );
});

test("a refused batch applies none of it, not the rows before the bad one", () => {
  const before = get<{ n: number }>(`SELECT COUNT(*) AS n FROM price_changes`)!.n;

  assert.throws(
    () =>
      applyPrices(
        [
          { itemId: CAUSTIC, price: 250 }, // fine on its own
          { itemId: SLES, price: 10 }, // under the floor
        ],
        STAFF,
      ),
    PriceError,
  );

  assert.equal(
    get<{ price_cents: number }>(`SELECT price_cents FROM items WHERE id = ?`, CAUSTIC)!.price_cents,
    toCents(230),
    "the good row in front of the bad one must not have stuck",
  );
  assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM price_changes`)!.n, before);
});

test("the owner's PIN opens both ends of the band, and the change is still recorded", () => {
  const under = applyPrices([{ itemId: SLES, price: 350 }], OWNER, { allowOutsideBand: true });
  assert.equal(under.changed, 1);
  assert.equal(priceHistory(SLES)[0].new_price, toCents(350));

  const over = applyPrices([{ itemId: SLES, price: 900 }], OWNER, { allowOutsideBand: true });
  assert.equal(over.changed, 1);
  assert.equal(
    get<{ price_cents: number }>(`SELECT price_cents FROM items WHERE id = ?`, SLES)!.price_cents,
    toCents(900),
  );

  // Put it back inside its band for the tests that follow.
  applyPrices([{ itemId: SLES, price: 500 }], OWNER, { allowOutsideBand: true });
});

test("an item with no band set is not accidentally frozen", () => {
  // Zero at either end means "not set", never "a limit of nothing".
  const res = applyPrices([{ itemId: NOBAND, price: 15 }], STAFF);
  assert.equal(res.changed, 1, "no band means no guard rail to trip over");

  const up = applyPrices([{ itemId: NOBAND, price: 9_999 }], STAFF);
  assert.equal(up.changed, 1, "and none at the top either");
});

test("rows that did not move are skipped, not rewritten as history", () => {
  const before = priceHistory(CAUSTIC).length;
  const res = applyPrices(
    [
      { itemId: CAUSTIC, price: 230 }, // exactly what it already is
      { itemId: NOBAND, price: 16 }, // a real change
    ],
    STAFF,
  );
  assert.equal(res.changed, 1);
  assert.equal(res.skipped, 1);
  assert.equal(
    priceHistory(CAUSTIC).length,
    before,
    "an unchanged row must not add a row saying nothing changed",
  );
});

test("history is append-only", () => {
  const id = get<{ id: number }>(`SELECT id FROM price_changes ORDER BY id LIMIT 1`)!.id;
  assert.throws(() => run(`UPDATE price_changes SET new_price = 1 WHERE id = ?`, id), /append-only/);
  assert.throws(() => run(`DELETE FROM price_changes WHERE id = ?`, id), /append-only/);
});


test("a negative price is refused before it reaches the database", () => {
  assert.throws(
    () => applyPrices([{ itemId: CAUSTIC, price: -5 }], STAFF),
    (e: unknown) => e instanceof PriceError && /zero or more/.test((e as Error).message),
  );
  assert.equal(all(`SELECT id FROM items WHERE price_cents < 0`).length, 0);
});


// ----------------------------------------------- prices agreed at the counter

/*
  The morning price sheet is gone. A price is changed where it is argued about —
  on the line at the till — so the guard that used to live on that screen has to
  live here instead, and be the same guard.
*/

test("a price kept at the counter moves the shelf price and writes the history", () => {
  const before = priceHistory(CAUSTIC).length;

  const result = setCounterPrice({
    itemId: CAUSTIC,
    priceCents: 22000,
    userId: STAFF,
  });

  assert.equal(result.changed, true);
  assert.equal(result.newCents, 22000);
  assert.equal(get<{ price_cents: number }>(`SELECT price_cents FROM items WHERE id = ?`, CAUSTIC)!.price_cents, 22000);

  const rows = priceHistory(CAUSTIC);
  assert.equal(rows.length, before + 1, "the change is on the record");
  assert.equal(rows[0].new_price, 22000);
  assert.equal(rows[0].user_name, "Amina");
});

test("a price kept at the counter is inside the band, or it is not kept", () => {
  const ceiling = get<{ ceiling_cents: number }>(
    `SELECT ceiling_cents FROM items WHERE id = ?`,
    CAUSTIC,
  )!.ceiling_cents;
  assert.ok(ceiling > 0, "this item has a ceiling to test against");

  assert.throws(
    () => setCounterPrice({ itemId: CAUSTIC, priceCents: ceiling + 100, userId: STAFF }),
    /above the most/i,
  );

  const result = setCounterPrice({
    itemId: CAUSTIC,
    priceCents: ceiling + 100,
    userId: STAFF,
    allowOutsideBand: true,
  });
  assert.equal(result.changed, true, "the owner standing there can allow it");
});

test("the floor still holds at the counter, and the owner can still overrule it", () => {
  const floor = get<{ floor_cents: number }>(`SELECT floor_cents FROM items WHERE id = ?`, CAUSTIC)!
    .floor_cents;
  assert.ok(floor > 0, "this item has a floor to test against");

  assert.throws(
    () => setCounterPrice({ itemId: CAUSTIC, priceCents: floor - 100, userId: STAFF }),
    /below the least/i,
  );

  // Unchanged: a refused price must not have half-applied.
  assert.notEqual(
    get<{ price_cents: number }>(`SELECT price_cents FROM items WHERE id = ?`, CAUSTIC)!.price_cents,
    floor - 100,
  );

  const result = setCounterPrice({
    itemId: CAUSTIC,
    priceCents: floor - 100,
    userId: STAFF,
    allowOutsideBand: true,
  });
  assert.equal(result.changed, true);
});

test("keeping the price it already is changes nothing and records nothing", () => {
  const current = get<{ price_cents: number }>(`SELECT price_cents FROM items WHERE id = ?`, CAUSTIC)!
    .price_cents;
  const before = priceHistory(CAUSTIC).length;

  const result = setCounterPrice({ itemId: CAUSTIC, priceCents: current, userId: STAFF });

  assert.equal(result.changed, false);
  assert.equal(priceHistory(CAUSTIC).length, before, "no row saying nothing happened");
});

/*
  Paging the history.

  The screen used to ask for a fixed 120 rows and draw whatever came back, so
  the 121st change was invisible and nothing on the page said so. These are
  about the count being real rather than inferred from the rows in hand.
*/
test("a page of history knows how many pages there are behind it", () => {
  // Enough changes to need paging, alternating so none is a no-op.
  for (let i = 0; i < 12; i++) {
    setCounterPrice({ itemId: CAUSTIC, priceCents: toCents(230 + i), userId: STAFF });
  }

  const total = priceHistory(CAUSTIC, 1000).length;
  assert.ok(total > 5, "there is enough history to page");

  const first = priceHistoryPage(1, 5, CAUSTIC);
  assert.equal(first.rows.length, 5, "a page holds what it was asked for");
  assert.equal(first.total, total, "the count is every change, not the page");
  assert.equal(first.pages, Math.ceil(total / 5));

  const second = priceHistoryPage(2, 5, CAUSTIC);
  assert.notEqual(second.rows[0].at + second.rows[0].new_price, first.rows[0].at + first.rows[0].new_price,
    "page two is not page one again");
});

test("asking past the last page lands on the last page, not on nothing", () => {
  const { pages } = priceHistoryPage(1, 5, CAUSTIC);
  const past = priceHistoryPage(pages + 40, 5, CAUSTIC);

  assert.ok(past.rows.length > 0, "a bad page number still shows history");
  assert.equal(past.pages, pages);
});

test("with no item the history covers the whole shop", () => {
  const one = priceHistoryPage(1, 5, CAUSTIC).total;
  const all = priceHistoryPage(1, 5).total;
  assert.ok(all >= one, "the shop-wide count includes this item's changes");
});
