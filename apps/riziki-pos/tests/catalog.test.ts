import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "cat-")), "t.db");

import test from "node:test";
import assert from "node:assert/strict";
const { seed } = await import("../src/lib/seed.ts");
const { get, all } = await import("../src/lib/db.ts");
const cat = await import("../src/lib/catalog.ts");

seed();

const OWNER = 1;

/** Anything on the list. They are all one kind of row now. */
function anyItem() {
  const item = cat.listProducts()[0];
  assert.ok(item, "the seed puts something on the list");
  return item;
}

test("updatePricing: writes the price and the band, and converts the reorder level", () => {
  const item = anyItem();
  cat.updatePricing({
    itemId: item.id,
    price: 250,
    floor: 200,
    ceiling: 300,
    reorderUnits: 12,
    byUserId: OWNER,
  });
  const after = cat.getItem(item.id)!;
  assert.equal(after.price_cents, 25000);
  assert.equal(after.floor_cents, 20000);
  assert.equal(after.ceiling_cents, 30000);
  // Weighed rows count the reorder level in kilograms; whole ones in containers.
  const per = after.price_basis === "unit" ? 1000 : item.size_milli;
  assert.equal(after.reorder_level_milli, 12 * per);
});

test("updatePricing: a chemical's reorder level is counted in kilograms, not containers", () => {
  /*
    The two bases part company here. "Warn me at 12" against a jerrican means
    twelve jerricans; against Ungerol it means twelve kilograms, because there
    is no such thing as a countable number of half-empty drums once the shop
    weighs out of them.
  */
  const bulk = cat.listProducts().find((i) => i.price_basis === "unit" && i.chemical_id)!;
  assert.ok(bulk, "the seed prices chemicals per unit");

  cat.updatePricing({
    itemId: bulk.id,
    price: 50,
    floor: 40,
    ceiling: 60,
    reorderUnits: 60,
    byUserId: OWNER,
  });

  const after = cat.getItem(bulk.id)!;
  assert.equal(after.price_cents, 5000, "KES 50 a kilogram");
  assert.equal(after.reorder_level_milli, 60_000, "60 kg, not 60 drums");
});

test("updatePricing: the band has to be a band, and has to contain the price", () => {
  const item = anyItem();
  const args = { itemId: item.id, reorderUnits: 0, byUserId: OWNER };

  assert.throws(
    () => cat.updatePricing({ ...args, price: 100, floor: 150, ceiling: 120 }),
    /can't be above the most/i,
    "a floor over the ceiling is a rule nobody can obey",
  );
  assert.throws(
    () => cat.updatePricing({ ...args, price: 100, floor: 150, ceiling: 300 }),
    /below the least/i,
    "and a price under its own floor refuses every sale at the asking price",
  );
  assert.throws(
    () => cat.updatePricing({ ...args, price: 400, floor: 100, ceiling: 300 }),
    /above the most/i,
  );
});

test("updatePricing: never touches cost", () => {
  const item = cat.listProducts().find((i) => i.cost_cents > 0) ?? anyItem();
  const before = cat.getItem(item.id)!.cost_cents;
  cat.updatePricing({
    itemId: item.id,
    price: 300,
    floor: 0,
    ceiling: 0,
    reorderUnits: 5,
    byUserId: OWNER,
  });
  assert.equal(cat.getItem(item.id)!.cost_cents, before, "cost comes from purchases, never typed");
});

test("createProduct: one row, priced per unit, with its band", () => {
  const id = cat.createProduct({
    name: "Test Surfactant",
    unit: "kg",
    aliases: "tsf,test",
    containerValue: 200,
    containerLabel: "drum",
    price: 90,
    floor: 70,
    ceiling: 110,
    byUserId: OWNER,
  });

  const item = cat.getItem(id)!;
  assert.equal(item.kind, "bulk");
  assert.equal(item.price_basis, "unit");
  assert.equal(item.sellable, 1, "the counter weighs out of the drum");
  assert.equal(item.price_cents, 9000, "KES 90 a kilogram");
  assert.equal(item.floor_cents, 7000);
  assert.equal(item.ceiling_cents, 11000);
  assert.equal(item.cost_cents, 0, "cost arrives with the first delivery, never typed");
  assert.equal(item.size_milli, 200_000, "the container is still 200 kg");

  assert.throws(
    () =>
      cat.createProduct({
        name: "Test Surfactant",
        unit: "kg",
        aliases: "",
        containerValue: 200,
        containerLabel: "drum",
        price: 90,
        floor: 0,
        ceiling: 0,
        byUserId: OWNER,
      }),
    /already in the list/i,
  );
});

test("createProduct: a jerrican is the same kind of row, measured in pieces", () => {
  /*
    Not a trick. A shop sells things by some unit; the unit is the only thing
    that varies. Three separate screens for products, chemicals and packaging
    were three ways of saying that badly.
  */
  const id = cat.createProduct({
    name: "Test 20 L Jerrican",
    unit: "pcs",
    aliases: "",
    containerValue: 1,
    containerLabel: "piece",
    price: 180,
    floor: 150,
    ceiling: 250,
    byUserId: OWNER,
  });

  const item = cat.getItem(id)!;
  assert.equal(item.canonical_unit, "pcs");
  assert.equal(item.price_basis, "unit", "priced per piece, like everything is priced per its unit");
  assert.equal(item.price_cents, 18000);
});

test("createProduct: the band is checked before anything is written", () => {
  const before = cat.listProducts().length;
  assert.throws(
    () =>
      cat.createProduct({
        name: "Test Bad Band",
        unit: "kg",
        aliases: "",
        containerValue: 25,
        containerLabel: "bag",
        price: 100,
        floor: 200,
        ceiling: 150,
        byUserId: OWNER,
      }),
    /can't be above the most/i,
  );
  assert.equal(cat.listProducts().length, before, "and no half-made chemical is left behind");
});

test("createProduct: something with no price yet is listed, not sold", () => {
  const id = cat.createProduct({
    name: "Test Unpriced Base",
    unit: "L",
    aliases: "",
    containerValue: 200,
    containerLabel: "drum",
    price: 0,
    floor: 0,
    ceiling: 0,
    byUserId: OWNER,
  });
  const item = cat.getItem(id)!;
  assert.equal(item.price_cents, 0);
  // Sellable, but at zero — the counter renders that as "No price set" rather
  // than as free. Refusing to create it would strand a delivery nobody can book.
  assert.equal(item.sellable, 1);
});

test("setItemActive: retires and restores an item", () => {
  const id = cat.createProduct({
    name: "Test Retire Me",
    unit: "L",
    aliases: "",
    containerValue: 5,
    containerLabel: "jerrican",
    price: 100,
    floor: 0,
    ceiling: 0,
    byUserId: OWNER,
  });

  cat.setItemActive(id, false, OWNER);
  assert.equal(cat.getItem(id)!.active, 0);
  assert.ok(
    cat.listProducts().some((i) => i.id === id),
    "a retired row is still listed, greyed — 'where did it go' is a worse question",
  );

  cat.setItemActive(id, true, OWNER);
  assert.equal(cat.getItem(id)!.active, 1);
});

/*
  Deleting a product.

  The distinction being tested is the one the shop cares about: a row typed by
  mistake is rubbish and should go, and a row that has traded is part of the
  books and must not. Nothing in between.
*/

function throwaway(name: string): number {
  return cat.createProduct({
    name,
    unit: "kg",
    aliases: "",
    containerValue: 25,
    containerLabel: "bag",
    price: 0,
    floor: 0,
    ceiling: 0,
    byUserId: OWNER,
  });
}

test("deleteProduct: a row nothing points at is removed outright", () => {
  const id = throwaway("Test Typo Sodium");
  assert.equal(cat.deletableReason(id), null, "nothing is holding it");

  const result = cat.deleteProduct(id, OWNER);
  assert.equal(result.name, "Test Typo Sodium");
  assert.equal(cat.getItem(id), undefined, "gone, not hidden");
  assert.ok(!cat.listProducts().some((i) => i.id === id));
});

test("deleteProduct: the name is on the audit entry, because the id will point at nothing", () => {
  const id = throwaway("Test Deleted Trace");
  cat.deleteProduct(id, OWNER);

  const entry = get<{ action: string; detail: string }>(
    `SELECT action, detail FROM audit_log WHERE action = 'item_deleted' ORDER BY id DESC LIMIT 1`,
  );
  assert.ok(entry, "a deletion is recorded");
  assert.equal(entry!.detail, "Test Deleted Trace");
});

test("deleteProduct: anything that has traded is refused, and says what holds it", () => {
  const id = throwaway("Test Sold Once");
  // A price is history in its own right — the owner set a number and that is
  // recorded — so this alone should be enough to hold the row.
  cat.updatePricing({ itemId: id, price: 250, floor: 0, ceiling: 0, reorderUnits: 0, byUserId: OWNER });

  const held = cat.deletableReason(id);
  assert.ok(held, "the row is held");
  assert.match(held!, /price history/);

  assert.throws(
    () => cat.deleteProduct(id, OWNER),
    (e: unknown) => e instanceof cat.CatalogError && /Hide it from the counter instead/.test((e as Error).message),
  );
  assert.ok(cat.getItem(id), "still there — a refused delete removes nothing");
});

test("deleteProduct: a seeded chemical with stock behind it cannot be deleted", () => {
  const stocked = cat.listProducts().find((i) => i.price_basis === "unit" && i.kind === "bulk");
  assert.ok(stocked, "the seed stocks chemicals");

  const held = cat.deletableReason(stocked!.id);
  assert.ok(held, `${stocked!.name} has history: ${held}`);
  assert.throws(() => cat.deleteProduct(stocked!.id, OWNER), cat.CatalogError);
});

test("every catalog change is written to the audit log", () => {
  const id = cat.createProduct({
    name: "Test Audited",
    unit: "kg",
    aliases: "",
    containerValue: 25,
    containerLabel: "bag",
    price: 40,
    floor: 0,
    ceiling: 0,
    byUserId: OWNER,
  });
  cat.updatePricing({ itemId: id, price: 45, floor: 0, ceiling: 0, reorderUnits: 0, byUserId: OWNER });

  const actions = all<{ action: string }>(
    `SELECT action FROM audit_log WHERE entity_id = ? ORDER BY id`,
    id,
  ).map((r) => r.action);
  assert.ok(actions.includes("product_created"));
  assert.ok(actions.includes("price_changed"));
});

test("sizes are typed the way the shelf label reads", () => {
  // "500 g", not "0.5 kg" — the second was the single most confusing thing on
  // this screen, and the conversion belongs in the code not the owner's head.
  const id = cat.createProduct({
    name: "Test Sachet Base",
    unit: "g",
    aliases: "",
    containerValue: 500,
    containerLabel: "sachet",
    price: 2,
    floor: 0,
    ceiling: 0,
    byUserId: OWNER,
  });
  const item = cat.getItem(id)!;
  assert.equal(item.canonical_unit, "kg", "grams are stored as thousandths of a kilogram");
  assert.equal(item.size_milli, 500);
});
