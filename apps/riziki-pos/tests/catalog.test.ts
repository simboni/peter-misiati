import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "cat-")), "t.db");

import test from "node:test";
import assert from "node:assert/strict";
const { seed } = await import("../src/lib/seed.ts");
const { get } = await import("../src/lib/db.ts");
const cat = await import("../src/lib/catalog.ts");

seed();

const OWNER = 1;

/** Something sold whole — a jerrican — as opposed to a chemical sold by weight. */
function wholeItem() {
  const item = cat.listPackaging()[0];
  assert.ok(item, "the seed stocks containers");
  return item;
}

test("updatePricing: writes prices and converts the reorder level from units to milli", () => {
  const item = wholeItem();
  cat.updatePricing({
    itemId: item.id,
    retail: 250,
    wholesale: 220,
    floor: 200,
    reorderUnits: 12,
    byUserId: OWNER,
  });
  const after = cat.getItem(item.id)!;
  assert.equal(after.retail_cents, 25000);
  assert.equal(after.wholesale_cents, 22000);
  assert.equal(after.floor_cents, 20000);
  // 12 jerricans of size_milli each, stored in milli.
  assert.equal(after.reorder_level_milli, 12 * item.size_milli);
});

test("updatePricing: a chemical's reorder level is counted in kilograms, not containers", () => {
  /*
    The two bases part company here. "Warn me at 12" against a jerrican means
    twelve jerricans; against Ungerol it means twelve kilograms, because there
    is no such thing as a countable number of half-empty drums once the shop
    weighs out of them.
  */
  const ungerol = cat.listChemicals().find((c) => c.name === "Ungerol")!;
  const bulk = ungerol.items.find((i) => i.kind === "bulk")!;
  assert.equal(bulk.price_basis, "unit");

  cat.updatePricing({
    itemId: bulk.id,
    retail: 50,
    wholesale: 45,
    floor: 40,
    reorderUnits: 60,
    byUserId: OWNER,
  });

  const after = cat.getItem(bulk.id)!;
  assert.equal(after.retail_cents, 5000, "KES 50 a kilogram");
  assert.equal(after.reorder_level_milli, 60_000, "60 kg, not 60 drums");
});

test("updatePricing: refuses a floor above the retail price", () => {
  const item = wholeItem();
  assert.throws(
    () =>
      cat.updatePricing({
        itemId: item.id,
        retail: 100,
        wholesale: 90,
        floor: 150,
        reorderUnits: 0,
        byUserId: OWNER,
      }),
    /floor price can't be above/i,
  );
});

test("updatePricing: never touches cost", () => {
  const item = cat.listPackaging().find((i) => i.cost_cents > 0) ?? wholeItem();
  const before = cat.getItem(item.id)!.cost_cents;
  cat.updatePricing({
    itemId: item.id,
    retail: 300,
    wholesale: 280,
    floor: 260,
    reorderUnits: 5,
    byUserId: OWNER,
  });
  assert.equal(cat.getItem(item.id)!.cost_cents, before);
});

test("createFinished: creates a sellable, zero-cost bottle and rejects a duplicate name", () => {
  const id = cat.createFinished({
    name: "Test Bleach Gel",
    unit: "L",
    sizeValue: 1,
    unitLabel: "bottle",
    retail: 180,
    wholesale: 150,
    byUserId: OWNER,
  });
  const item = cat.getItem(id)!;
  assert.equal(item.kind, "finished");
  assert.equal(item.sellable, 1);
  assert.equal(item.cost_cents, 0, "cost arrives from production, not typed");
  assert.equal(item.size_milli, 1000);
  assert.equal(item.retail_cents, 18000);

  assert.throws(
    () =>
      cat.createFinished({
        name: "Test Bleach Gel",
        unit: "L",
        sizeValue: 1,
        unitLabel: "bottle",
        retail: 180,
        wholesale: 150,
        byUserId: OWNER,
      }),
    /already something called/i,
  );
});

test("createFinished: rejects an empty name", () => {
  assert.throws(
    () =>
      cat.createFinished({
        name: " ",
        unit: "L",
        sizeValue: 1,
        unitLabel: "bottle",
        retail: 100,
        wholesale: 90,
        byUserId: OWNER,
      }),
    /name/i,
  );
});

test("createChemical: one sellable row, priced per kilogram", () => {
  const chemId = cat.createChemical({
    name: "Test Surfactant",
    unit: "kg",
    aliases: "tsf,test",
    bulkSizeValue: 200,
    bulkLabel: "drum",
    ratePerUnit: 90,
    byUserId: OWNER,
  });

  const chem = cat.listChemicals().find((c) => c.id === chemId)!;
  assert.ok(chem, "chemical is listed");

  // One row. It used to be a bulk row plus one per resale size, and those pack
  // rows are the whole of what this change deleted.
  assert.equal(chem.items.length, 1);

  const bulk = chem.items[0];
  assert.equal(bulk.kind, "bulk");
  assert.equal(bulk.price_basis, "unit");
  assert.equal(bulk.sellable, 1, "the counter weighs out of the drum");
  assert.equal(bulk.retail_cents, 9000, "KES 90 a kilogram");
  assert.equal(bulk.cost_cents, 0, "cost arrives with the first delivery, never typed");
  assert.equal(bulk.size_milli, 200_000, "the container is still 200 kg");

  assert.throws(
    () =>
      cat.createChemical({
        name: "Test Surfactant",
        unit: "kg",
        aliases: "",
        bulkSizeValue: 200,
        bulkLabel: "drum",
        byUserId: OWNER,
      }),
    /already in the list/i,
  );
});

test("createChemical: a chemical with no price yet is listed, not sold", () => {
  const chemId = cat.createChemical({
    name: "Test Unpriced Base",
    unit: "L",
    aliases: "",
    bulkSizeValue: 200,
    bulkLabel: "drum",
    byUserId: OWNER,
  });
  const bulk = cat.listChemicals().find((c) => c.id === chemId)!.items[0];
  assert.equal(bulk.retail_cents, 0);
  // Sellable, but at zero — the counter renders that as "No price set" rather
  // than as free. Refusing to create it would strand a delivery nobody can book.
  assert.equal(bulk.sellable, 1);
});

test("setItemActive: retires and restores an item", () => {
  const id = cat.createFinished({
    name: "Test Retire Me",
    unit: "L",
    sizeValue: 1,
    unitLabel: "bottle",
    retail: 100,
    wholesale: 90,
    byUserId: OWNER,
  });
  cat.setItemActive(id, false, OWNER);
  assert.equal(cat.getItem(id)!.active, 0);
  cat.setItemActive(id, true, OWNER);
  assert.equal(cat.getItem(id)!.active, 1);
});

test("every catalog change is written to the audit log", () => {
  const before = get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log`)!.n;
  cat.createFinished({
    name: "Test Audited Product",
    unit: "L",
    sizeValue: 5,
    unitLabel: "jerrican",
    retail: 800,
    wholesale: 700,
    byUserId: OWNER,
  });
  const after = get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log`)!.n;
  assert.ok(after > before, "product creation left an audit trail");
});

test("sizes are typed the way the shelf label reads", () => {
  // The whole point of the unit picker: a 500 ml bottle is entered as "500" and
  // "ml", not as "0.5" and "litres", which is what the shop got wrong.
  const bottle = cat.createFinished({
    name: "Test Shower Gel",
    unit: "ml",
    sizeValue: 500,
    unitLabel: "bottle",
    retail: 250,
    wholesale: 220,
    byUserId: OWNER,
  });
  const b = cat.getItem(bottle)!;
  assert.equal(b.size_milli, 500, "500 ml is 500 milli-litres");
  assert.equal(b.canonical_unit, "L", "and it is stored against litres");

  const sachet = cat.createFinished({
    name: "Test Sachet",
    unit: "g",
    sizeValue: 250,
    unitLabel: "sachet",
    retail: 60,
    wholesale: 50,
    byUserId: OWNER,
  });
  const g = cat.getItem(sachet)!;
  assert.equal(g.size_milli, 250);
  assert.equal(g.canonical_unit, "kg");

  // Typing it the old way must land in exactly the same place, or the two
  // routes would create duplicate items that look identical on the till.
  const same = cat.createFinished({
    name: "Test Shower Gel Large",
    unit: "L",
    sizeValue: 0.5,
    unitLabel: "bottle",
    retail: 250,
    wholesale: 220,
    byUserId: OWNER,
  });
  assert.equal(cat.getItem(same)!.size_milli, b.size_milli, "0.5 L and 500 ml are one size");
});
