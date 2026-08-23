/**
 * The morning price check.
 *
 * The thing worth protecting is the guard rail. This screen is open to
 * attendants, which is the whole point of it, and the only reason that is safe
 * is that the floor price holds. So these tests push on the floor from both
 * sides — retail and wholesale — and check that a refused batch leaves nothing
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
  priceList,
  priceHistory,
  checkState,
  ageOfPrice,
  PriceError,
} = await import("../src/lib/pricing.ts");

process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

const OWNER = Number(
  run(`INSERT INTO users (name, role, pin_hash) VALUES ('Owner', 'owner', 'x')`).lastInsertRowid,
);
const STAFF = Number(
  run(`INSERT INTO users (name, role, pin_hash) VALUES ('Amina', 'staff', 'x')`).lastInsertRowid,
);

function item(name: string, retail: number, wholesale: number, floor: number): number {
  return Number(
    run(
      `INSERT INTO items (name, kind, canonical_unit, size_milli, unit_label, sellable,
                          retail_cents, wholesale_cents, floor_cents)
       VALUES (?, 'pack', 'kg', ?, 'pack', 1, ?, ?, ?)`,
      name,
      toMilli(1),
      toCents(retail),
      toCents(wholesale),
      toCents(floor),
    ).lastInsertRowid,
  );
}

const CAUSTIC = item("Caustic Soda — 1 kg", 200, 180, 150);
const SLES = item("Ungerol — 1 kg", 500, 460, 400);
const NOFLOOR = item("Salt — 1 kg", 20, 18, 0);

test("an attendant may raise a price, and the old one is kept", () => {
  const res = applyPrices([{ itemId: CAUSTIC, retail: 230, wholesale: 210 }], STAFF);

  assert.equal(res.changed, 1);
  const row = get<{ retail_cents: number; wholesale_cents: number }>(
    `SELECT retail_cents, wholesale_cents FROM items WHERE id = ?`,
    CAUSTIC,
  )!;
  assert.equal(row.retail_cents, toCents(230));
  assert.equal(row.wholesale_cents, toCents(210));

  const hist = priceHistory(CAUSTIC);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].old_retail, toCents(200), "what it was is still on the record");
  assert.equal(hist[0].new_retail, toCents(230));
  assert.equal(hist[0].user_name, "Amina", "and who changed it");
});

test("the floor holds against an attendant, on retail and on wholesale alike", () => {
  assert.throws(
    () => applyPrices([{ itemId: SLES, retail: 350, wholesale: 460 }], STAFF),
    (e: unknown) => e instanceof PriceError && /below the floor/.test((e as Error).message),
  );
  assert.throws(
    () => applyPrices([{ itemId: SLES, retail: 500, wholesale: 300 }], STAFF),
    (e: unknown) => e instanceof PriceError && /wholesale .* below the floor/.test((e as Error).message),
  );

  const row = get<{ retail_cents: number }>(`SELECT retail_cents FROM items WHERE id = ?`, SLES)!;
  assert.equal(row.retail_cents, toCents(500), "nothing was written");
});

test("a refused batch applies none of it, not the rows before the bad one", () => {
  const before = get<{ n: number }>(`SELECT COUNT(*) AS n FROM price_changes`)!.n;

  assert.throws(
    () =>
      applyPrices(
        [
          { itemId: CAUSTIC, retail: 999, wholesale: 999 }, // fine on its own
          { itemId: SLES, retail: 10, wholesale: 10 }, // under the floor
        ],
        STAFF,
      ),
    PriceError,
  );

  assert.equal(
    get<{ retail_cents: number }>(`SELECT retail_cents FROM items WHERE id = ?`, CAUSTIC)!
      .retail_cents,
    toCents(230),
    "the good row in front of the bad one must not have stuck",
  );
  assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM price_changes`)!.n, before);
});

test("the owner's PIN opens the floor, and the change is still recorded", () => {
  const res = applyPrices([{ itemId: SLES, retail: 350, wholesale: 340 }], OWNER, {
    allowBelowFloor: true,
  });
  assert.equal(res.changed, 1);
  assert.equal(
    get<{ retail_cents: number }>(`SELECT retail_cents FROM items WHERE id = ?`, SLES)!
      .retail_cents,
    toCents(350),
  );
  assert.equal(priceHistory(SLES)[0].new_retail, toCents(350));
});

test("an item with no floor is not accidentally frozen at zero", () => {
  const res = applyPrices([{ itemId: NOFLOOR, retail: 15, wholesale: 14 }], STAFF);
  assert.equal(res.changed, 1, "no floor means no guard rail to trip over");
});

test("rows that did not move are skipped, not rewritten as history", () => {
  const before = priceHistory(CAUSTIC).length;
  const res = applyPrices(
    [
      { itemId: CAUSTIC, retail: 230, wholesale: 210 }, // exactly what it already is
      { itemId: NOFLOOR, retail: 16, wholesale: 14 }, // a real change
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
  assert.throws(() => run(`UPDATE price_changes SET new_retail = 1 WHERE id = ?`, id), /append-only/);
  assert.throws(() => run(`DELETE FROM price_changes WHERE id = ?`, id), /append-only/);
});

test("the list carries when each price last moved, and by whom", () => {
  const rows = priceList();
  const caustic = rows.find((r) => r.id === CAUSTIC)!;
  assert.ok(caustic.changed_at, "a price that has been changed knows when");
  assert.equal(caustic.changed_by, "Amina");
  assert.equal(ageOfPrice(caustic.changed_at), 0, "changed just now reads as today");
  assert.equal(ageOfPrice(null), null, "never changed is not the same as changed long ago");
});

test("the shop can see whether prices were looked at today", () => {
  const s = checkState();
  assert.equal(s.doneToday, true);
  assert.equal(s.lastBy, "Amina");

  // Backdate everything and the answer must flip — this is what the till's
  // reminder reads, and it must not say "checked" because it once was.
  run(`DROP TRIGGER IF EXISTS price_changes_no_update`);
  run(`UPDATE price_changes SET at = datetime('now', '-3 days')`);
  assert.equal(checkState().doneToday, false);
  assert.ok(checkState().lastAt, "but the last change is still known");
});

test("search narrows the sheet", () => {
  assert.equal(priceList("caustic").length, 1);
  assert.equal(priceList("nothing like this").length, 0);
  assert.ok(priceList().length >= 3);
});

test("only sellable, active items appear — the sheet is what the shop charges for", () => {
  const hidden = item("Retired Reagent — 1 kg", 90, 80, 0);
  run(`UPDATE items SET active = 0 WHERE id = ?`, hidden);
  assert.equal(
    priceList().some((r) => r.id === hidden),
    false,
  );

  const notForSale = item("Bottle cap — 1 pcs", 5, 4, 0);
  run(`UPDATE items SET sellable = 0 WHERE id = ?`, notForSale);
  assert.equal(
    priceList().some((r) => r.id === notForSale),
    false,
  );
});

test("a negative price is refused before it reaches the database", () => {
  assert.throws(
    () => applyPrices([{ itemId: CAUSTIC, retail: -5, wholesale: 100 }], STAFF),
    (e: unknown) => e instanceof PriceError && /zero or more/.test((e as Error).message),
  );
  assert.equal(all(`SELECT id FROM items WHERE retail_cents < 0`).length, 0);
});
