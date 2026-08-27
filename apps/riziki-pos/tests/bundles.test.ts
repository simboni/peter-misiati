import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "bun-")), "t.db");

import test from "node:test";
import assert from "node:assert/strict";
const { seed } = await import("../src/lib/seed.ts");
const { get, all } = await import("../src/lib/db.ts");
const cat = await import("../src/lib/catalog.ts");
const b = await import("../src/lib/bundles.ts");

seed();

/** A weighed chemical — the case bundles exist for. */
function weighedItem() {
  const item = cat.listProducts().find((i) => i.price_basis === "unit") ?? cat.listProducts()[0];
  assert.ok(item, "the seed puts something on the list");
  return item;
}

const ITEM = weighedItem().id;

test("a bundle's per-unit rate is the price spread over its size", () => {
  // A 20 kg bundle at KES 8,800 is KES 440 the kilogram.
  assert.equal(b.bundleRateCents({ sizeMilli: 20000, priceCents: 880000 }), 44000);
  // 5 L at 2,400 is 480 the litre.
  assert.equal(b.bundleRateCents({ sizeMilli: 5000, priceCents: 240000 }), 48000);
  // A size of nothing has no rate rather than an infinite one.
  assert.equal(b.bundleRateCents({ sizeMilli: 0, priceCents: 100 }), 0);
});

test("the saving is against buying the same weight loose, and never negative", () => {
  // Loose at 511.94/kg, 20 kg would be 10,238.80. The bundle is 8,800.
  assert.equal(b.bundleSavingCents({ sizeMilli: 20000, priceCents: 880000 }, 51194), 1023880 - 880000);
  // A bundle dearer than loose is not a saving of a negative amount.
  assert.equal(b.bundleSavingCents({ sizeMilli: 20000, priceCents: 1200000 }, 51194), 0);
  // Nothing to compare against.
  assert.equal(b.bundleSavingCents({ sizeMilli: 20000, priceCents: 880000 }, 0), 0);
});

test("bundles save, read back smallest first, and replace as a set", () => {
  b.saveBundles({ itemId: ITEM }, [
    { sizeMilli: 20000, priceCents: 880000, floorCents: 800000 },
    { sizeMilli: 5000, priceCents: 240000, floorCents: 0 },
    { sizeMilli: 10000, priceCents: 460000, floorCents: 0 },
  ]);

  const list = b.itemBundles(ITEM);
  assert.equal(list.length, 3);
  // Saved in the order given — the editor's order is the counter's order.
  assert.deepEqual(list.map((x) => x.sizeMilli), [20000, 5000, 10000]);
  assert.equal(list[0].floorCents, 800000);

  // Saving a shorter set retires the missing one rather than deleting it.
  b.saveBundles({ itemId: ITEM }, [
    { sizeMilli: 5000, priceCents: 250000, floorCents: 0 },
    { sizeMilli: 10000, priceCents: 460000, floorCents: 0 },
  ]);
  const after = b.itemBundles(ITEM);
  assert.deepEqual(after.map((x) => x.sizeMilli), [5000, 10000]);
  assert.equal(after[0].priceCents, 250000, "the kept one takes its new price");

  const hidden = b.itemBundles(ITEM, true);
  assert.equal(hidden.length, 3, "the dropped size is switched off, not removed");
  assert.ok(
    all<{ id: number }>(`SELECT id FROM bundles WHERE item_id = ? AND active = 0`, ITEM).length === 1,
    "exactly one is off",
  );
});

test("bringing a retired size back reuses its row rather than colliding", () => {
  b.saveBundles({ itemId: ITEM }, [
    { sizeMilli: 5000, priceCents: 250000, floorCents: 0 },
    { sizeMilli: 10000, priceCents: 460000, floorCents: 0 },
    { sizeMilli: 20000, priceCents: 900000, floorCents: 0 },
  ]);
  const list = b.itemBundles(ITEM);
  assert.equal(list.length, 3);
  assert.equal(list.find((x) => x.sizeMilli === 20000)!.priceCents, 900000);
  // Still three rows in all — the old 20 kg was woken up, not duplicated.
  assert.equal(
    get<{ n: number }>(`SELECT count(*) AS n FROM bundles WHERE item_id = ?`, ITEM)!.n,
    3,
  );
});

test("two bundles of the same size are refused", () => {
  assert.throws(
    () =>
      b.saveBundles({ itemId: ITEM }, [
        { sizeMilli: 5000, priceCents: 240000, floorCents: 0 },
        { sizeMilli: 5000, priceCents: 250000, floorCents: 0 },
      ]),
    /one size, one price/i,
  );
});

test("a size of nothing, a negative price and a floor above the price are all refused", () => {
  assert.throws(
    () => b.saveBundles({ itemId: ITEM }, [{ sizeMilli: 0, priceCents: 100, floorCents: 0 }]),
    /bigger than nothing/i,
  );
  assert.throws(
    () => b.saveBundles({ itemId: ITEM }, [{ sizeMilli: 5000, priceCents: -1, floorCents: 0 }]),
    /cannot be negative/i,
  );
  assert.throws(
    () => b.saveBundles({ itemId: ITEM }, [{ sizeMilli: 5000, priceCents: 100, floorCents: 500 }]),
    /floor cannot be above/i,
  );
});

test("a refused set leaves the bundles that were already there alone", () => {
  const before = b.itemBundles(ITEM);
  assert.throws(() =>
    b.saveBundles({ itemId: ITEM }, [
      { sizeMilli: 5000, priceCents: 240000, floorCents: 0 },
      { sizeMilli: 5000, priceCents: 250000, floorCents: 0 },
    ]),
  );
  assert.deepEqual(b.itemBundles(ITEM), before, "nothing was switched off on the way out");
});

test("a bundle belongs to an item or a formula, and the database will not have both", () => {
  const formulaId = get<{ id: number }>(`SELECT id FROM formulas LIMIT 1`)?.id;
  assert.ok(formulaId, "the seed has a recipe");

  b.saveBundles({ formulaId }, [
    { sizeMilli: 5000, priceCents: 90000, floorCents: 0 },
    { sizeMilli: 20000, priceCents: 330000, floorCents: 0 },
  ]);
  assert.equal(b.formulaBundles(formulaId).length, 2);
  // The item's bundles are its own — the two sets do not see each other.
  assert.ok(b.itemBundles(ITEM).every((x) => x.priceCents !== 90000));

  assert.throws(
    () =>
      all(
        `INSERT INTO bundles (item_id, formula_id, size_milli, price_cents) VALUES (?, ?, 1000, 100)`,
        ITEM,
        formulaId,
      ),
    /CHECK|constraint/i,
    "a bundle owned by both is refused by the schema",
  );
});

test("the whole board's bundles come back in one read", () => {
  const byItem = b.bundlesByItem();
  assert.ok(byItem.get(ITEM)!.length >= 1);
  const byFormula = b.bundlesByFormula();
  assert.ok([...byFormula.values()].flat().length >= 2);
  // An item with no bundles is absent rather than present-and-empty, so the
  // counter can ask `has(id)` and get the truth.
  const bare = cat.listProducts().find((i) => !byItem.has(i.id));
  assert.ok(bare, "most of the catalogue has no bundles, which is the normal case");
});

test("findBundle says who owns it, for checking a sale against", () => {
  const one = b.itemBundles(ITEM)[0];
  const found = b.findBundle(one.id)!;
  assert.equal(found.itemId, ITEM);
  assert.equal(found.formulaId, null);
  assert.equal(found.sizeMilli, one.sizeMilli);
  assert.equal(found.active, true);
  assert.equal(b.findBundle(999999), null);
});

// ------------------------------------------------- selling one across the counter

const sales = await import("../src/lib/sales.ts");

/** Put enough on the shelf to sell out of. */
function stock(itemId: number, milli: number) {
  const { postMovement } = require("../src/lib/db.ts");
  postMovement({ itemId, deltaMilli: milli, reason: "opening", userId: 1, note: "test" });
}

test("a bundle sells at its own price, off the parent's one pile of stock", () => {
  const item = cat.listProducts().find((i) => i.price_basis === "unit")!;
  b.saveBundles({ itemId: item.id }, [
    { sizeMilli: 20000, priceCents: 880000, floorCents: 800000 },
  ]);
  const bundle = b.itemBundles(item.id)[0];

  const before = get<{ n: number }>(
    `SELECT COALESCE(SUM(delta_milli), 0) AS n FROM stock_movements WHERE item_id = ?`,
    item.id,
  )!.n;

  const res = sales.recordSale({
    clientUuid: `bundle-${Date.now()}`,
    userId: 1,
    tier: "retail",
    lines: [{ itemId: item.id, bundleId: bundle.id, units: 2, unitPriceCents: bundle.priceCents }],
    tenders: [{ method: "cash", amountCents: 2 * bundle.priceCents }],
  });

  // Two bundles at the bundle price — NOT two kilograms at the per-kg price.
  assert.equal(res.totalCents, 2 * 880000);

  const line = get<Record<string, number | string>>(
    `SELECT * FROM sale_lines WHERE sale_id = ?`,
    res.saleId,
  )!;
  assert.equal(line.units, 2, "units counts bundles");
  assert.equal(line.qty_milli, 40000, "and the weight follows from the size");
  assert.equal(line.rate_cents, 0, "a bundle is priced whole, not at a rate");
  assert.equal(line.bundle_id, bundle.id);
  // "Ungerol — 20 kg bundle", or "1 L bottle — 20 pcs bundle" for something
  // counted in pieces. Either way the size is on the receipt, in the item's own
  // unit, so a customer holding it can see what they were charged for.
  assert.match(String(line.name_snapshot), /— 20 \w+ bundle$/, "the receipt says which size");
  assert.ok(String(line.name_snapshot).startsWith(item.name), "and which item");

  const after = get<{ n: number }>(
    `SELECT COALESCE(SUM(delta_milli), 0) AS n FROM stock_movements WHERE item_id = ?`,
    item.id,
  )!.n;
  assert.equal(before - after, 40000, "40 kg came off the one drum");
});

test("a bundle is held to its own floor, not the per-kilogram one", () => {
  const item = cat.listProducts().find((i) => i.price_basis === "unit")!;
  b.saveBundles({ itemId: item.id }, [
    { sizeMilli: 20000, priceCents: 880000, floorCents: 800000 },
  ]);
  const bundle = b.itemBundles(item.id)[0];

  // 8,800 for 20 kg is 440/kg — far under any sane per-kilogram floor. The
  // item's band must not be what this is measured against, or every bundle the
  // shop sells would need the owner's PIN.
  assert.doesNotThrow(() =>
    sales.recordSale({
      clientUuid: `band-ok-${Date.now()}`,
      userId: 1,
      tier: "retail",
      lines: [{ itemId: item.id, bundleId: bundle.id, units: 1, unitPriceCents: bundle.priceCents }],
      tenders: [{ method: "cash", amountCents: bundle.priceCents }],
    }),
  );

  // Below the bundle's own floor, though, still needs the owner.
  assert.throws(
    () =>
      sales.recordSale({
        clientUuid: `band-bad-${Date.now()}`,
        userId: 1,
        tier: "retail",
        lines: [{ itemId: item.id, bundleId: bundle.id, units: 1, unitPriceCents: 700000 }],
        tenders: [{ method: "cash", amountCents: 700000 }],
      }),
    /below the least it may go for/i,
  );
});

test("the size and the asking price come from the database, not the payload", () => {
  const item = cat.listProducts().find((i) => i.price_basis === "unit")!;
  b.saveBundles({ itemId: item.id }, [{ sizeMilli: 5000, priceCents: 240000, floorCents: 0 }]);
  const bundle = b.itemBundles(item.id)[0];

  const res = sales.recordSale({
    clientUuid: `tamper-${Date.now()}`,
    userId: 1,
    tier: "retail",
    // A payload claiming a huge quantity: qtyMilli is simply not read on a
    // bundle line, so it cannot be used to empty the shelf at bundle prices.
    lines: [
      { itemId: item.id, bundleId: bundle.id, units: 1, unitPriceCents: 240000, qtyMilli: 900000 },
    ],
    tenders: [{ method: "cash", amountCents: 240000 }],
  });
  const line = get<{ qty_milli: number; list_price_cents: number }>(
    `SELECT qty_milli, list_price_cents FROM sale_lines WHERE sale_id = ?`,
    res.saleId,
  )!;
  assert.equal(line.qty_milli, 5000, "the size is the bundle's, whatever was sent");
  assert.equal(line.list_price_cents, 240000, "and so is what the shop was asking");
});

test("a bundle belonging to another item is refused", () => {
  const [a, other] = cat.listProducts().filter((i) => i.price_basis === "unit");
  b.saveBundles({ itemId: a.id }, [{ sizeMilli: 5000, priceCents: 240000, floorCents: 0 }]);
  const bundle = b.itemBundles(a.id)[0];

  assert.throws(
    () =>
      sales.recordSale({
        clientUuid: `wrong-owner-${Date.now()}`,
        userId: 1,
        tier: "retail",
        lines: [{ itemId: other.id, bundleId: bundle.id, units: 1, unitPriceCents: 240000 }],
        tenders: [{ method: "cash", amountCents: 240000 }],
      }),
    /no longer sold/i,
  );
});
