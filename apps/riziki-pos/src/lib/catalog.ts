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

import { all, get, run, tx, audit, postMovement, stockOf, type PriceBasis } from "./db.ts";
import { formatQty, sizeToMilli, sizeUnit, type SizeUnit } from "./units.ts";

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
  price_basis: PriceBasis;
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

/**
 * Chemicals with their stock rows nested, for the admin screen.
 *
 * Retired pack rows are left out. They are the old way of saying "this
 * chemical, at this size, for this price" — one number on the bulk row now —
 * and listing forty-six of them under the chemicals they belong to would put
 * the thing the owner no longer edits above the thing he does.
 */
export function listChemicals(): AdminChemical[] {
  const chems = all<Omit<AdminChemical, "items">>(
    `SELECT id, name, canonical_unit, aliases, active FROM chemicals ORDER BY active DESC, name`,
  );
  const items = all<AdminItem>(
    `SELECT * FROM items
      WHERE kind IN ('bulk', 'pack') AND (kind = 'bulk' OR active = 1)
      ORDER BY (kind = 'bulk') DESC, size_milli DESC`,
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
 *
 * All three prices mean whatever the item's `price_basis` says they mean: the
 * price of one jerrican, or the price of one kilogram. The form asks in those
 * words; the arithmetic here does not care which.
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
  // A reorder level is counted in containers for something sold whole and in
  // kilograms for something weighed — "tell me when there is less than 50 kg
  // left" is the question, and it has nothing to do with drum sizes.
  const reorderMilli =
    item.price_basis === "unit"
      ? Math.round(input.reorderUnits * 1000)
      : Math.round(input.reorderUnits * item.size_milli);

  if (floor > retail) throw new CatalogError("The floor price can't be above the retail price.");

  // The owner's screen writes the same history the morning price check does.
  // Two ways in, one record — otherwise "when did this last change?" would
  // depend on which screen happened to be used, and the answer would be wrong
  // exactly when the owner had been the one to change it.
  if (retail !== item.retail_cents || wholesale !== item.wholesale_cents) {
    run(
      `INSERT INTO price_changes
         (item_id, old_retail, new_retail, old_wholesale, new_wholesale, user_id, source)
       VALUES (?, ?, ?, ?, ?, ?, 'admin')`,
      input.itemId,
      item.retail_cents,
      retail,
      item.wholesale_cents,
      wholesale,
      input.byUserId,
    );
  }

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
  /**
   * What the size was typed in — g, kg, ml, L or pcs. The database still holds
   * kg / L / pcs; this is only how the shop said it.
   */
  unit: SizeUnit;
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
  const u = sizeUnit(input.unit);
  const sizeMilli = sizeToMilli(input.sizeValue, input.unit);
  const retail = cents(input.retail, "Retail price");
  const wholesale = cents(input.wholesale, "Wholesale price");

  const { lastInsertRowid } = run(
    `INSERT INTO items (name, kind, canonical_unit, size_milli, unit_label,
                        sellable, retail_cents, wholesale_cents, floor_cents, cost_cents, reorder_level_milli)
     VALUES (?, 'finished', ?, ?, ?, 1, ?, ?, ?, 0, ?)`,
    name,
    u.canonical,
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
  /** As typed: g, kg, ml, L or pcs. */
  unit: SizeUnit;
  aliases: string;
  bulkSizeValue: number;
  bulkLabel: string;
  /** What one kilogram / litre sells for. Zero is allowed — set it later. */
  ratePerUnit?: number;
  byUserId: number;
}

/**
 * A new raw chemical: the substance and the container it arrives in.
 *
 * One row, not six. This used to create a bulk row plus a pack row for every
 * resale size the owner could think of, and those pack rows were the whole of
 * what made this screen confusing — five near-identical "Ungerol" entries whose
 * only difference was a number, each needing its own price kept up to date.
 * A chemical has one price now, per kilogram, and the size the customer wants
 * is a quantity typed at the counter.
 *
 * Cost and stock start at zero — they arrive with the first purchase. The rate
 * may start at zero too, which shows on the counter as "No price set" rather
 * than as free.
 */
export function createChemical(input: ChemicalInput): number {
  const name = input.name.trim();
  if (name.length < 2) throw new CatalogError("Give the chemical a name.");
  if (get(`SELECT 1 FROM chemicals WHERE name = ?`, name)) {
    throw new CatalogError(`"${name}" is already in the list.`);
  }
  const cu = sizeUnit(input.unit);
  const bulkMilli = sizeToMilli(input.bulkSizeValue, input.unit);
  const rate = cents(input.ratePerUnit ?? 0, "Price");

  return tx(() => {
    const { lastInsertRowid: chemId } = run(
      `INSERT INTO chemicals (name, canonical_unit, aliases) VALUES (?, ?, ?)`,
      name,
      cu.canonical,
      input.aliases.trim(),
    );
    run(
      `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                          sellable, price_basis, retail_cents, cost_cents, reorder_level_milli)
       VALUES (?, ?, 'bulk', ?, ?, ?, 1, 'unit', ?, 0, ?)`,
      chemId,
      name,
      cu.canonical,
      bulkMilli,
      input.bulkLabel.trim() || "unit",
      rate,
      bulkMilli * 2,
    );
    audit(input.byUserId, "chemical_created", "chemical", chemId, name);
    return chemId;
  });
}

/**
 * The one-off move from pack prices to a price per kilogram.
 *
 * The shop was delivered with forty-six `pack` rows: Ungerol at 250 g, 500 g,
 * 1 kg, 5 kg and 20 kg, Ufacid at six sizes, and so on down the list. Every one
 * of them existed to hold a price, and every one of them had to be kept up to
 * date by hand when the supplier moved — which is why prices drifted.
 *
 * This does three things, once, inside one transaction:
 *
 *   1. gives each chemical's bulk row a price per kilogram, worked out from the
 *      pack the shop was already selling closest to one kilogram — that is the
 *      price the owner has in his head, and the one his customers quote back;
 *   2. pours the stock sitting in pack rows back into the bulk row it came out
 *      of, as an equal pair of ledger movements, so nothing is created or lost
 *      and the pair can be read back years later;
 *   3. retires the pack rows.
 *
 * Nothing is deleted. A retired pack row still carries the sales that were made
 * from it, and a sale whose item vanished is a hole in the books.
 *
 * Safe to run twice: a chemical whose bulk row is already priced per unit is
 * skipped, and a pack row already retired holds no stock to move.
 */
export interface AdoptionReport {
  /** Chemicals that came away with a price per kilogram. */
  priced: Array<{ chemicalId: number; name: string; rateCents: number; from: string }>;
  /** Chemicals with no priced pack to work from. The owner sets these by hand. */
  unpriced: string[];
  /** Pack rows retired, and how much substance moved back to the bulk row. */
  packsRetired: number;
  movedMilli: number;
}

export function adoptUnitPricing(byUserId: number | null): AdoptionReport {
  return tx(() => {
    const report: AdoptionReport = { priced: [], unpriced: [], packsRetired: 0, movedMilli: 0 };

    const chemicals = all<{ id: number; name: string; canonical_unit: Unit }>(
      `SELECT id, name, canonical_unit FROM chemicals ORDER BY name`,
    );

    for (const chem of chemicals) {
      const bulk = get<AdminItem>(
        `SELECT * FROM items WHERE chemical_id = ? AND kind = 'bulk' ORDER BY id LIMIT 1`,
        chem.id,
      );
      if (!bulk) continue;

      const packs = all<AdminItem>(
        `SELECT * FROM items WHERE chemical_id = ? AND kind = 'pack' ORDER BY size_milli`,
        chem.id,
      );

      /*
        The row stops calling itself a drum.

        It was named "Ungerol — 170 kg drum" because that is what you bought and
        what you sold: one drum. It is now the row a kilogram comes out of, and a
        receipt for 1 kg that says "Ungerol — 170 kg drum" is a receipt the
        customer will ask about. Past sales keep the name they were rung up under
        — `sale_lines.name_snapshot` is frozen — so this only changes what is
        printed from here on.

        Outside the pricing branch, so that re-running this fixes a name even
        when the price was already moved. Only the seeded "name — size unit"
        shape is touched; anything the owner renamed by hand is left alone.
      */
      if (bulk.name.includes(" — ")) {
        run(`UPDATE items SET name = ? WHERE id = ?`, chem.name, bulk.id);
      }

      if (bulk.price_basis !== "unit") {
        /*
          Which pack sets the rate.

          The pack nearest one kilogram, not the smallest and not the biggest.
          The smallest carries the markup that pays for the packing — 250 g of
          caustic never cost a quarter of what a kilo did — so deriving from it
          would raise every price in the shop. The biggest runs the other way.
          The one-kilo price is the one the owner quotes on the phone.
        */
        const priced = packs.filter((p) => p.retail_cents > 0 && p.size_milli > 0);
        const source = priced.length
          ? priced.reduce((best, p) =>
              Math.abs(p.size_milli - 1000) < Math.abs(best.size_milli - 1000) ? p : best,
            )
          : null;

        const per = (cents: number, sizeMilli: number) => Math.round((cents * 1000) / sizeMilli);
        const rate = source ? per(source.retail_cents, source.size_milli) : 0;
        const wholesale =
          source && source.wholesale_cents > 0 ? per(source.wholesale_cents, source.size_milli) : 0;
        const floor = source && source.floor_cents > 0 ? per(source.floor_cents, source.size_milli) : 0;

        run(
          `UPDATE items
              SET price_basis = 'unit', sellable = 1,
                  retail_cents = ?, wholesale_cents = ?, floor_cents = ?,
                  reorder_level_milli = ?
            WHERE id = ?`,
          rate,
          wholesale,
          floor,
          // Reorder levels were counted in drums. Two drums of one chemical and
          // two of another are wildly different quantities; 50 kg is a number
          // the owner can read off the shelf.
          Math.max(bulk.reorder_level_milli, 50_000),
          bulk.id,
        );

        if (source) {
          report.priced.push({
            chemicalId: chem.id,
            name: chem.name,
            rateCents: rate,
            from: `${formatQty(source.size_milli, chem.canonical_unit)} pack`,
          });
        } else {
          report.unpriced.push(chem.name);
        }
      }

      for (const pack of packs) {
        const onHand = stockOf(pack.id);
        if (onHand > 0) {
          // Two movements, not one net adjustment: the pair is what makes the
          // move readable as a move. A single line would look like stock
          // appearing from nowhere in one row and vanishing in another.
          postMovement({
            itemId: pack.id,
            deltaMilli: -onHand,
            reason: "adjustment",
            refType: "unit_pricing",
            refId: bulk.id,
            userId: byUserId,
            note: `Moved to ${bulk.name}: chemicals are now weighed out of the container`,
          });
          postMovement({
            itemId: bulk.id,
            deltaMilli: onHand,
            reason: "adjustment",
            refType: "unit_pricing",
            refId: pack.id,
            userId: byUserId,
            note: `Moved from ${pack.name}`,
          });
          report.movedMilli += onHand;
        }
        if (pack.active || pack.sellable) {
          run(`UPDATE items SET active = 0, sellable = 0 WHERE id = ?`, pack.id);
          report.packsRetired += 1;
        }
      }
    }

    audit(
      byUserId,
      "unit_pricing_adopted",
      "item",
      null,
      `${report.priced.length} chemicals priced per unit, ${report.packsRetired} pack rows retired, ` +
        `${formatQty(report.movedMilli, "kg")} moved back to bulk`,
    );

    return report;
  });
}
