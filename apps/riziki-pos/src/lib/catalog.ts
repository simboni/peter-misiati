/**
 * Catalog administration — the owner adding and re-pricing what the shop sells,
 * without a developer.
 *
 * This was the biggest gap in the audit: new items and prices lived only in the
 * seed file, so a detergent shop that invents and drops SKUs constantly would
 * have to call someone every time. Everything here is owner-only at the action
 * layer; the arithmetic stays in cents and milli and is unit-tested under Node.
 *
 * What this does NOT touch: a chemical's `cost_cents` is the weighted average set
 * by purchases, never typed here — a made-up cost would poison every margin. A
 * new chemical starts at zero cost and gains a real one the first time it is
 * bought.
 */

import { all, get, run, tx, audit } from "./db.ts";
import { toMilli } from "./units.ts";

export class CatalogError extends Error {}

export type Unit = "kg" | "L" | "pcs";

export interface AdminItem {
  id: number;
  name: string;
  kind: "bulk" | "pack" | "finished" | "packaging";
  canonical_unit: Unit;
  size_milli: number;
  unit_label: string;
  sellable: number;
  retail_cents: number;
  wholesale_cents: number;
  floor_cents: number;
  cost_cents: number;
  reorder_level_milli: number;
  active: number;
}

export interface AdminChemical {
  id: number;
  name: string;
  canonical_unit: Unit;
  aliases: string;
  active: number;
  items: AdminItem[];
}

// -------------------------------------------------------------------- reads

export function listFinished(): AdminItem[] {
  return all<AdminItem>(`SELECT * FROM items WHERE kind = 'finished' ORDER BY active DESC, name`);
}

export function listPackaging(): AdminItem[] {
  return all<AdminItem>(`SELECT * FROM items WHERE kind = 'packaging' ORDER BY active DESC, name`);
}

/** Chemicals with their bulk + pack rows nested, for the admin screen. */
export function listChemicals(): AdminChemical[] {
  const chems = all<Omit<AdminChemical, "items">>(
    `SELECT id, name, canonical_unit, aliases, active FROM chemicals ORDER BY active DESC, name`,
  );
  const items = all<AdminItem>(
    `SELECT * FROM items WHERE kind IN ('bulk', 'pack') ORDER BY size_milli DESC`,
  );
  return chems.map((c) => ({
    ...c,
    items: items.filter((i) => (i as AdminItem & { chemical_id: number }).chemical_id === c.id),
  }));
}

export function getItem(id: number): AdminItem | undefined {
  return get<AdminItem>(`SELECT * FROM items WHERE id = ?`, id);
}

// ---------------------------------------------------------------- validation

function cents(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new CatalogError(`${label} must be zero or more.`);
  return Math.round(value * 100);
}

function positiveMilli(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new CatalogError(`${label} must be more than zero.`);
  return toMilli(value);
}

// -------------------------------------------------------------------- prices

export interface PricingInput {
  itemId: number;
  retail: number;
  wholesale: number;
  floor: number;
  reorderUnits: number;
  byUserId: number;
}

/**
 * Edit an item's selling prices and reorder level. Cost is deliberately absent —
 * it comes from purchases. The floor is the lowest an attendant may haggle to
 * before an owner PIN is needed, so it can't sit above the wholesale price.
 */
export function updatePricing(input: PricingInput): void {
  const item = getItem(input.itemId);
  if (!item) throw new CatalogError("That item no longer exists.");

  const retail = cents(input.retail, "Retail price");
  const wholesale = cents(input.wholesale, "Wholesale price");
  const floor = cents(input.floor, "Floor price");
  if (input.reorderUnits < 0 || !Number.isFinite(input.reorderUnits)) {
    throw new CatalogError("Reorder level must be zero or more.");
  }
  const reorderMilli = Math.round(input.reorderUnits * item.size_milli);

  if (floor > retail) throw new CatalogError("The floor price can't be above the retail price.");

  run(
    `UPDATE items SET retail_cents = ?, wholesale_cents = ?, floor_cents = ?, reorder_level_milli = ?
      WHERE id = ?`,
    retail,
    wholesale,
    floor,
    reorderMilli,
    input.itemId,
  );
  audit(input.byUserId, "price_changed", "item", input.itemId, `${item.name} → retail ${retail}c`);
}

export function setItemActive(itemId: number, active: boolean, byUserId: number): void {
  const item = getItem(itemId);
  if (!item) throw new CatalogError("That item no longer exists.");
  run(`UPDATE items SET active = ? WHERE id = ?`, active ? 1 : 0, itemId);
  audit(byUserId, active ? "item_activated" : "item_retired", "item", itemId, item.name);
}

// ------------------------------------------------------------- new products

export interface FinishedInput {
  name: string;
  unit: Unit;
  sizeValue: number;
  unitLabel: string;
  retail: number;
  wholesale: number;
  byUserId: number;
}

/** A new bottled product the shop mixes and sells. */
export function createFinished(input: FinishedInput): number {
  const name = input.name.trim();
  if (name.length < 2) throw new CatalogError("Give the product a name.");
  if (get(`SELECT 1 FROM items WHERE name = ? AND active = 1`, name)) {
    throw new CatalogError(`There is already something called "${name}".`);
  }
  const sizeMilli = positiveMilli(input.sizeValue, "Size");
  const retail = cents(input.retail, "Retail price");
  const wholesale = cents(input.wholesale, "Wholesale price");

  const { lastInsertRowid } = run(
    `INSERT INTO items (name, kind, canonical_unit, size_milli, unit_label,
                        sellable, retail_cents, wholesale_cents, floor_cents, cost_cents, reorder_level_milli)
     VALUES (?, 'finished', ?, ?, ?, 1, ?, ?, ?, 0, ?)`,
    name,
    input.unit,
    sizeMilli,
    input.unitLabel.trim() || "bottle",
    retail,
    wholesale,
    Math.round(wholesale * 0.9),
    sizeMilli * 10,
  );
  audit(input.byUserId, "product_created", "item", lastInsertRowid, name);
  return lastInsertRowid;
}

export interface ChemicalInput {
  name: string;
  unit: Unit;
  aliases: string;
  bulkSizeValue: number;
  bulkLabel: string;
  packSizes: number[];
  byUserId: number;
}

/**
 * A new raw chemical: the substance, its bulk container, and any resale pack
 * sizes. Cost and stock start at zero — they arrive with the first purchase.
 */
export function createChemical(input: ChemicalInput): number {
  const name = input.name.trim();
  if (name.length < 2) throw new CatalogError("Give the chemical a name.");
  if (get(`SELECT 1 FROM chemicals WHERE name = ?`, name)) {
    throw new CatalogError(`"${name}" is already in the list.`);
  }
  const bulkMilli = positiveMilli(input.bulkSizeValue, "Bulk size");

  return tx(() => {
    const { lastInsertRowid: chemId } = run(
      `INSERT INTO chemicals (name, canonical_unit, aliases) VALUES (?, ?, ?)`,
      name,
      input.unit,
      input.aliases.trim(),
    );
    run(
      `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                          sellable, cost_cents, reorder_level_milli)
       VALUES (?, ?, 'bulk', ?, ?, ?, 0, 0, ?)`,
      chemId,
      `${name} — ${input.bulkSizeValue} ${input.unit} ${input.bulkLabel.trim() || "unit"}`,
      input.unit,
      bulkMilli,
      input.bulkLabel.trim() || "unit",
      bulkMilli * 2,
    );
    for (const size of input.packSizes) {
      if (size <= 0) continue;
      addPackRow(chemId, name, input.unit, size);
    }
    audit(input.byUserId, "chemical_created", "chemical", chemId, name);
    return chemId;
  });
}

export function addPackSize(chemicalId: number, sizeValue: number, byUserId: number): number {
  const chem = get<{ name: string; canonical_unit: Unit }>(
    `SELECT name, canonical_unit FROM chemicals WHERE id = ?`,
    chemicalId,
  );
  if (!chem) throw new CatalogError("That chemical no longer exists.");
  const sizeMilli = positiveMilli(sizeValue, "Pack size");
  if (get(`SELECT 1 FROM items WHERE chemical_id = ? AND kind = 'pack' AND size_milli = ?`, chemicalId, sizeMilli)) {
    throw new CatalogError("That pack size already exists for this chemical.");
  }
  const id = addPackRow(chemicalId, chem.name, chem.canonical_unit, sizeValue);
  audit(byUserId, "pack_size_added", "item", id, `${chem.name} ${sizeValue}${chem.canonical_unit}`);
  return id;
}

/** Shared pack-row insert. Label mirrors the seed: "500 g" / "1 kg". */
function addPackRow(chemId: number, chemName: string, unit: Unit, size: number): number {
  const label =
    size >= 1 ? `${size} ${unit}` : `${size * 1000} ${unit === "kg" ? "g" : unit === "L" ? "ml" : unit}`;
  const { lastInsertRowid } = run(
    `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, cost_cents, reorder_level_milli)
     VALUES (?, ?, 'pack', ?, ?, 'pack', 1, 0, ?)`,
    chemId,
    `${chemName} — ${label}`,
    unit,
    toMilli(size),
    toMilli(size * 5),
  );
  return lastInsertRowid;
}
