/**
 * Clearing suppliers off the list.
 *
 * The rule is the catalogue's, applied to the other side of the ledger: a name
 * nothing points at is somebody's typo and may go; a name a delivery is filed
 * under may not, because deleting it would leave that delivery reading
 * "Supplier not recorded" and the shop would lose who it bought from.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "sup-")), "t.db");

import test from "node:test";
import assert from "node:assert/strict";
const { seed } = await import("../src/lib/seed.ts");
const { get, all } = await import("../src/lib/db.ts");
const {
  createSupplier,
  updateSupplier,
  deleteSupplier,
  setSupplierHidden,
  supplierDeletableReason,
  listSuppliers,
  supplierSpend,
  recordPurchase,
  buyableItems,
} = await import("../src/lib/purchasing.ts");

seed();

const OWNER = 1;

/** Something the shop can actually take a delivery of. */
function anItem(): number {
  const items = buyableItems();
  assert.ok(items.length, "the seed should leave something buyable");
  return items[0].id;
}

test("a supplier nobody has bought from can be deleted outright", () => {
  const id = createSupplier({ name: "Test Entry", phone: "0700", note: "trying it out" }, OWNER);

  assert.equal(supplierDeletableReason(id), null, "nothing should be holding it");

  const { name } = deleteSupplier(id, OWNER);
  assert.equal(name, "Test Entry");
  assert.equal(get(`SELECT id FROM suppliers WHERE id = ?`, id), undefined, "the row is gone");
});

test("the delete is recorded under the name, because the id stops meaning anything", () => {
  const id = createSupplier({ name: "Typo Chemicals" }, OWNER);
  deleteSupplier(id, OWNER);

  const entry = get<{ detail: string }>(
    `SELECT detail FROM audit_log WHERE action = 'supplier_delete' ORDER BY id DESC LIMIT 1`,
  );
  assert.ok(entry, "the deletion should be in the audit log");
  assert.match(entry!.detail, /Typo Chemicals/);
});

test("a supplier with a delivery against them is refused, and told what to do instead", () => {
  const id = createSupplier({ name: "Kel Chemicals" }, OWNER);
  recordPurchase({
    supplierId: id,
    ref: "INV-1",
    transportCents: 0,
    lines: [{ itemId: anItem(), units: 1, costCents: 10_000 }],
    userId: OWNER,
  });

  const held = supplierDeletableReason(id);
  assert.ok(held, "a delivery should hold the supplier");
  assert.match(held!, /1 delivery/);

  assert.throws(
    () => deleteSupplier(id, OWNER),
    /cannot be deleted[\s\S]*Hide them instead/,
    "the refusal should name the way forward, not just fail",
  );

  assert.ok(get(`SELECT id FROM suppliers WHERE id = ?`, id), "and the row survives the refusal");
});

test("the delivery keeps its supplier's name after they are hidden", () => {
  const id = createSupplier({ name: "Ungerol Supplies" }, OWNER);
  const purchase = recordPurchase({
    supplierId: id,
    ref: "INV-2",
    transportCents: 0,
    lines: [{ itemId: anItem(), units: 1, costCents: 5_000 }],
    userId: OWNER,
  });

  setSupplierHidden(id, true, OWNER);

  assert.ok(
    !listSuppliers().some((s) => s.id === id),
    "hidden takes them off the list the delivery form picks from",
  );

  const linked = get<{ supplier_id: number }>(
    `SELECT supplier_id FROM purchases WHERE id = ?`,
    purchase.purchaseId,
  );
  assert.equal(linked?.supplier_id, id, "the delivery still points at them");
});

test("a hidden supplier stays on the owner's list, so hiding can be undone", () => {
  const id = createSupplier({ name: "Seasonal Only" }, OWNER);
  setSupplierHidden(id, true, OWNER);

  const row = supplierSpend().find((s) => s.id === id);
  assert.ok(row, "the owner can still see them");
  assert.equal(row!.active, 0, "marked as hidden");

  setSupplierHidden(id, false, OWNER);
  assert.ok(listSuppliers().some((s) => s.id === id), "and they come back");
});

test("a supplier cannot be renamed onto a name already in use", () => {
  const a = createSupplier({ name: "Alpha Traders" }, OWNER);
  createSupplier({ name: "Beta Traders" }, OWNER);

  assert.throws(
    () => updateSupplier(a, { name: "Beta Traders" }, OWNER),
    /already on the supplier list/,
    "the UNIQUE index should be reported in words, not as a raw database error",
  );

  const still = get<{ name: string }>(`SELECT name FROM suppliers WHERE id = ?`, a);
  assert.equal(still?.name, "Alpha Traders", "and nothing changed");
});

test("a supplier can be renamed to fix a misspelling", () => {
  const id = createSupplier({ name: "Ufasid Ltd" }, OWNER);
  updateSupplier(id, { name: "Ufacid Ltd", phone: "0722 000 111", note: "Ufacid" }, OWNER);

  const row = get<{ name: string; phone: string }>(
    `SELECT name, phone FROM suppliers WHERE id = ?`,
    id,
  );
  assert.equal(row?.name, "Ufacid Ltd");
  assert.equal(row?.phone, "0722 000 111");
});

test("deleting one supplier leaves the rest of the list alone", () => {
  const before = all<{ id: number }>(`SELECT id FROM suppliers`).length;
  const id = createSupplier({ name: "Just Passing Through" }, OWNER);
  deleteSupplier(id, OWNER);
  assert.equal(all<{ id: number }>(`SELECT id FROM suppliers`).length, before);
});
