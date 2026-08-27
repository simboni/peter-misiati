import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "cat-")), "t.db");

import test from "node:test";
import assert from "node:assert/strict";
const { seed } = await import("../src/lib/seed.ts");
const { get, all, run, closeDb } = await import("../src/lib/db.ts");
const cat = await import("../src/lib/catalog.ts");
const { saveBundles } = await import("../src/lib/bundles.ts");

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

test("deleteProduct: something that has traded is refused, and says what holds it", () => {
  const id = throwaway("Test Bought In");

  // A delivery is money that left the account, against a document the shop
  // keeps. Delete the item under it and the record points at nothing.
  const { lastInsertRowid: purchaseId } = run(
    `INSERT INTO purchases (supplier_id, total_cents, transport_cents, ref, user_id)
     VALUES (NULL, 100000, 0, 'DN test', ?)`,
    OWNER,
  );
  run(
    `INSERT INTO purchase_lines (purchase_id, item_id, units, size_milli, qty_milli, cost_cents)
     VALUES (?, ?, 1, 25000, 25000, 100000)`,
    Number(purchaseId),
    id,
  );

  const held = cat.deletableReason(id);
  assert.ok(held, "the row is held");
  assert.match(held!, /bought in/);

  assert.throws(
    () => cat.deleteProduct(id, OWNER),
    (e: unknown) =>
      e instanceof cat.CatalogError && /Hide it from the counter instead/.test((e as Error).message),
  );
  assert.ok(cat.getItem(id), "still there — a refused delete removes nothing");
});

test("deleteProduct: a price, a shelf count and bundle sizes do not hold a typo", () => {
  /*
    The case this exists for, and the bug it was written after.

    Foreign keys are on, and nothing cleared an item's bundles before deleting
    it — so any product that had been given sizes could not be removed at all,
    and the owner was told "that did not work" with nothing to act on. A price
    history and an opening count held it too, though neither says anything to
    anybody once the item is gone. None of the three is a record of trading.
  */
  const id = throwaway("Test Mistake With Everything");
  cat.updateProduct({
    itemId: id,
    name: "Test Mistake With Everything",
    aliases: "",
    unit: "kg",
    containerValue: 25,
    containerLabel: "bag",
    price: 250,
    floor: 0,
    ceiling: 0,
    reorderUnits: 0,
    byUserId: OWNER,
  });
  saveBundles({ itemId: id }, [{ sizeMilli: 5000, priceCents: 100000, floorCents: 0 }]);
  run(
    `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id)
     VALUES (?, 50000, 'opening', ?)`,
    id,
    OWNER,
  );

  assert.ok(get(`SELECT 1 FROM price_changes WHERE item_id = ?`, id), "it has a price history");
  assert.ok(get(`SELECT 1 FROM bundles WHERE item_id = ?`, id), "it has a size");
  assert.ok(get(`SELECT 1 FROM stock_movements WHERE item_id = ?`, id), "and a count");

  assert.equal(cat.deletableReason(id), null, "none of that is trading");
  cat.deleteProduct(id, OWNER);

  assert.equal(cat.getItem(id), undefined, "gone");
  assert.equal(get(`SELECT 1 FROM bundles WHERE item_id = ?`, id), undefined, "its sizes went too");
  assert.equal(get(`SELECT 1 FROM price_changes WHERE item_id = ?`, id), undefined);
  assert.equal(get(`SELECT 1 FROM stock_movements WHERE item_id = ?`, id), undefined);
});

test("deleteProduct: the substance goes with it, so it stops offering itself to recipes", () => {
  const id = throwaway("Test Orphan Substance");
  const chemId = cat.getItem(id)!.chemical_id!;
  assert.ok(get(`SELECT 1 FROM chemicals WHERE id = ?`, chemId));

  cat.deleteProduct(id, OWNER);
  assert.equal(
    get(`SELECT 1 FROM chemicals WHERE id = ?`, chemId),
    undefined,
    "a chemical outliving its only item keeps appearing in the ingredient list",
  );
});

test("deleteProduct: a substance a recipe still uses is left alone", () => {
  const id = throwaway("Test Substance In Use");
  const chemId = cat.getItem(id)!.chemical_id!;

  const { lastInsertRowid: fid } = run(`INSERT INTO formulas (name) VALUES ('Test Holder')`);
  const { lastInsertRowid: vid } = run(
    `INSERT INTO formula_versions (formula_id, version, ref_size_milli, ref_unit, is_current)
     VALUES (?, 1, 20000, 'L', 1)`,
    Number(fid),
  );
  run(
    `INSERT INTO formula_items (formula_version_id, chemical_id, qty_milli) VALUES (?, ?, 1000)`,
    Number(vid),
    chemId,
  );

  cat.deleteProduct(id, OWNER);
  assert.ok(
    get(`SELECT 1 FROM chemicals WHERE id = ?`, chemId),
    "the recipe still names it, so it stays",
  );
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

// ------------------------------------------------- editing what a thing IS

test("updateProduct: renames a chemical everywhere, not just on the item row", () => {
  const id = cat.createProduct({
    name: "Test Ungrol",
    unit: "kg",
    aliases: "ungrl",
    containerValue: 25,
    containerLabel: "drum",
    price: 500,
    floor: 0,
    ceiling: 0,
    byUserId: OWNER,
  });

  cat.updateProduct({
    itemId: id,
    name: "Test Ungerol",
    aliases: "ungerol, sles",
    unit: "kg",
    containerValue: 25,
    containerLabel: "drum",
    price: 500,
    floor: 0,
    ceiling: 0,
    reorderUnits: 0,
    byUserId: OWNER,
  });

  const item = cat.getItem(id)!;
  assert.equal(item.name, "Test Ungerol");
  // The substance carries the name the counter searches on, so both have to move
  // or search would still be finding the typo.
  const chem = get<{ name: string; aliases: string }>(
    `SELECT name, aliases FROM chemicals WHERE id = ?`,
    item.chemical_id,
  )!;
  assert.equal(chem.name, "Test Ungerol");
  assert.equal(chem.aliases, "ungerol, sles");
});

test("updateProduct: the container and the unit are editable", () => {
  const id = cat.createProduct({
    name: "Test Wrong Unit",
    unit: "kg",
    aliases: "",
    containerValue: 25,
    containerLabel: "drum",
    price: 100,
    floor: 0,
    ceiling: 0,
    byUserId: OWNER,
  });

  cat.updateProduct({
    itemId: id,
    name: "Test Wrong Unit",
    aliases: "",
    unit: "L",
    containerValue: 20,
    containerLabel: "jerrican",
    price: 100,
    floor: 0,
    ceiling: 0,
    reorderUnits: 0,
    byUserId: OWNER,
  });

  const item = cat.getItem(id)!;
  assert.equal(item.canonical_unit, "L");
  assert.equal(item.size_milli, 20_000);
  assert.equal(item.unit_label, "jerrican");
  // The substance has to agree, or a recipe reading the chemical would still
  // think the thing is weighed.
  const chem = get<{ canonical_unit: string }>(
    `SELECT canonical_unit FROM chemicals WHERE id = ?`,
    item.chemical_id,
  )!;
  assert.equal(chem.canonical_unit, "L");
});

test("updateProduct: refuses a name something else already answers to", () => {
  const first = cat.createProduct({
    name: "Test Taken Name",
    unit: "kg",
    aliases: "",
    containerValue: 25,
    containerLabel: "drum",
    price: 10,
    floor: 0,
    ceiling: 0,
    byUserId: OWNER,
  });
  const second = cat.createProduct({
    name: "Test Other Name",
    unit: "kg",
    aliases: "",
    containerValue: 25,
    containerLabel: "drum",
    price: 10,
    floor: 0,
    ceiling: 0,
    byUserId: OWNER,
  });

  assert.throws(
    () =>
      cat.updateProduct({
        itemId: second,
        name: "test taken name",
        aliases: "",
        unit: "kg",
        containerValue: 25,
        containerLabel: "drum",
        price: 10,
        floor: 0,
        ceiling: 0,
        reorderUnits: 0,
        byUserId: OWNER,
      }),
    /already called/i,
    "two rows with one name are indistinguishable at the till",
  );
  assert.equal(cat.getItem(first)!.name, "Test Taken Name", "the first one is untouched");
});

test("updateProduct: keeps the band rules, and refuses without writing the name", () => {
  const id = cat.createProduct({
    name: "Test Band Rules",
    unit: "kg",
    aliases: "",
    containerValue: 25,
    containerLabel: "drum",
    price: 100,
    floor: 0,
    ceiling: 0,
    byUserId: OWNER,
  });

  assert.throws(
    () =>
      cat.updateProduct({
        itemId: id,
        name: "Test Band Renamed",
        aliases: "",
        unit: "kg",
        containerValue: 25,
        containerLabel: "drum",
        price: 100,
        floor: 200,
        ceiling: 150,
        reorderUnits: 0,
        byUserId: OWNER,
      }),
    /can't be above/i,
  );
  // The whole save is one transaction: a refused band must not leave a renamed
  // row behind it.
  assert.equal(cat.getItem(id)!.name, "Test Band Rules");
});

test("updateProduct: a container of nothing is refused", () => {
  const id = cat.createProduct({
    name: "Test Empty Drum",
    unit: "kg",
    aliases: "",
    containerValue: 25,
    containerLabel: "drum",
    price: 10,
    floor: 0,
    ceiling: 0,
    byUserId: OWNER,
  });
  assert.throws(
    () =>
      cat.updateProduct({
        itemId: id,
        name: "Test Empty Drum",
        aliases: "",
        unit: "kg",
        containerValue: 0,
        containerLabel: "drum",
        price: 10,
        floor: 0,
        ceiling: 0,
        reorderUnits: 0,
        byUserId: OWNER,
      }),
    /one container holds/i,
  );
});

test("deleting a product puts the append-only guards straight back", () => {
  /*
    The one thing that could go quietly wrong here.

    `clearOwnRecords` drops two triggers to remove an untraded item's own
    bookkeeping. If either failed to come back, the shop's ledger would be
    silently editable from then on — no error, no symptom, until somebody
    noticed a sale had been deleted rather than voided.
  */
  const id = throwaway("Test Guard Check");
  run(
    `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id) VALUES (?, 1000, 'opening', ?)`,
    id,
    OWNER,
  );
  cat.deleteProduct(id, OWNER);

  for (const name of ["stock_movements_no_delete", "price_changes_no_delete"]) {
    assert.ok(
      get(`SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?`, name),
      `${name} is back`,
    );
  }

  // And it bites: the ledger of something that HAS traded stays untouchable.
  assert.throws(
    () => run(`DELETE FROM stock_movements WHERE id = (SELECT MIN(id) FROM stock_movements)`),
    /append-only/,
  );
});

test("a refused delete leaves the guards on", () => {
  const id = throwaway("Test Guard Rollback");
  const { lastInsertRowid: pid } = run(
    `INSERT INTO purchases (supplier_id, total_cents, transport_cents, ref, user_id)
     VALUES (NULL, 1, 0, 'x', ?)`,
    OWNER,
  );
  run(
    `INSERT INTO purchase_lines (purchase_id, item_id, units, size_milli, qty_milli, cost_cents)
     VALUES (?, ?, 1, 1000, 1000, 1)`,
    Number(pid),
    id,
  );

  assert.throws(() => cat.deleteProduct(id, OWNER), cat.CatalogError);
  assert.ok(
    get(`SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'stock_movements_no_delete'`),
  );
});

test("deleteProduct: a batch made by the old Make screen does not hold a product", () => {
  /*
    The residue of a feature that was built and then removed.

    While the shop had a screen for diluting a concentrate into another product,
    every batch wrote a `repacks` row against the concentrate and a
    `repack_lines` row against what came out. Both point at items by foreign
    key. Nothing cleared them and nothing listed them as history, so Delete was
    offered, pressed, and refused by the database with "that did not work" — on
    BOTH products, which is exactly the pair the shop then wanted gone.
  */
  const conc = throwaway("Test Old Concentrate");
  const made = throwaway("Test Old Dilution");

  const { lastInsertRowid: repackId } = run(
    `INSERT INTO repacks (from_item_id, in_milli, out_milli, loss_milli, user_id)
     VALUES (?, 12000, 23000, 0, ?)`,
    conc,
    OWNER,
  );
  run(
    `INSERT INTO repack_lines (repack_id, item_id, units, qty_milli) VALUES (?, ?, 1, 23000)`,
    Number(repackId),
    made,
  );

  assert.equal(cat.deletableReason(made), null, "a batch is not somebody's document");
  cat.deleteProduct(made, OWNER);
  assert.equal(cat.getItem(made), undefined, "the dilution goes");

  // The whole batch went with it, rather than a row with no lines behind it.
  assert.equal(get(`SELECT 1 FROM repack_lines WHERE repack_id = ?`, Number(repackId)), undefined);
  assert.equal(get(`SELECT 1 FROM repacks WHERE id = ?`, Number(repackId)), undefined);

  // And the concentrate, held by the same batch from the other end, goes too.
  cat.deleteProduct(conc, OWNER);
  assert.equal(cat.getItem(conc), undefined, "the concentrate goes");
});

test("a table from a retired feature is dropped, not left to block deletes", () => {
  /*
    The failure this is for was invisible from every screen.

    `conversions` shipped for one version, behind a screen for diluting a
    concentrate into another product. Its rows point at items by foreign key, so
    a database that ran that version refused to delete either end — the Delete
    button appeared, because nothing listed the table as history, and pressing it
    produced "that did not work" with no way forward.
  */
  assert.equal(
    get(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'conversions'`),
    undefined,
    "boot drops it",
  );

  // And a database that still has it survives the next boot: put it back, with a
  // row holding a product, and check the product can be deleted afterwards.
  const from = throwaway("Test Retired From");
  const to = throwaway("Test Retired To");
  run(`CREATE TABLE conversions (
         id INTEGER PRIMARY KEY,
         to_item_id INTEGER NOT NULL REFERENCES items(id),
         from_item_id INTEGER NOT NULL REFERENCES items(id),
         in_milli INTEGER NOT NULL,
         out_milli INTEGER NOT NULL,
         active INTEGER NOT NULL DEFAULT 1)`);
  run(
    `INSERT INTO conversions (to_item_id, from_item_id, in_milli, out_milli) VALUES (?, ?, 1, 2)`,
    to,
    from,
  );
  assert.throws(() => cat.deleteProduct(to, OWNER), /FOREIGN KEY/, "held, as the shop found");

  // A reboot: closing the handle means the next query reopens and migrates.
  closeDb();
  assert.equal(
    get(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'conversions'`),
    undefined,
    "and the next boot clears it",
  );
  cat.deleteProduct(to, OWNER);
  assert.equal(cat.getItem(to), undefined);
});
