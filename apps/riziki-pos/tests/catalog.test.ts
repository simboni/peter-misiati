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

test("updatePricing: writes prices and converts the reorder level from units to milli", () => {
  const item = cat.listFinished()[0];
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
  // 12 bottles of size_milli each, stored in milli.
  assert.equal(after.reorder_level_milli, 12 * item.size_milli);
});

test("updatePricing: refuses a floor above the retail price", () => {
  const item = cat.listFinished()[0];
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
  const item = cat.listFinished().find((i) => i.cost_cents > 0) ?? cat.listFinished()[0];
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

test("createChemical: creates the chemical plus a non-sellable bulk row and sellable packs", () => {
  const chemId = cat.createChemical({
    name: "Test Surfactant",
    unit: "kg",
    aliases: "tsf,test",
    bulkSizeValue: 200,
    bulkLabel: "drum",
    packSizes: [20, 1, 0.5],
    byUserId: OWNER,
  });

  const chems = cat.listChemicals();
  const chem = chems.find((c) => c.id === chemId)!;
  assert.ok(chem, "chemical is listed");

  const bulk = chem.items.find((i) => i.kind === "bulk")!;
  assert.equal(bulk.sellable, 0, "bulk drum is not sold whole over the counter");
  assert.equal(bulk.cost_cents, 0);
  assert.equal(bulk.size_milli, 200_000);

  const packs = chem.items.filter((i) => i.kind === "pack");
  assert.equal(packs.length, 3);
  assert.ok(packs.every((p) => p.sellable === 1 && p.cost_cents === 0));

  assert.throws(
    () =>
      cat.createChemical({
        name: "Test Surfactant",
        unit: "kg",
        aliases: "",
        bulkSizeValue: 200,
        bulkLabel: "drum",
        packSizes: [],
        byUserId: OWNER,
      }),
    /already in the list/i,
  );
});

test("addPackSize: adds a new size and refuses a duplicate", () => {
  const chemId = cat.createChemical({
    name: "Test Thickener",
    unit: "kg",
    aliases: "",
    bulkSizeValue: 25,
    bulkLabel: "bag",
    packSizes: [1],
    byUserId: OWNER,
  });

  const id = cat.addPackSize(chemId, 0.5, OWNER);
  const item = cat.getItem(id)!;
  assert.equal(item.kind, "pack");
  assert.equal(item.size_milli, 500);
  assert.equal(item.name, "Test Thickener — 500 g");

  assert.throws(() => cat.addPackSize(chemId, 0.5, OWNER), /already exists/i);
  assert.throws(() => cat.addPackSize(chemId, 1, OWNER), /already exists/i);
});

test("addPackSize: labels a whole-unit pack in the canonical unit", () => {
  const chemId = cat.createChemical({
    name: "Test Builder",
    unit: "kg",
    aliases: "",
    bulkSizeValue: 50,
    bulkLabel: "bag",
    packSizes: [],
    byUserId: OWNER,
  });
  const id = cat.addPackSize(chemId, 2, OWNER);
  assert.equal(cat.getItem(id)!.name, "Test Builder — 2 kg");
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
