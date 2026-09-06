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
import { formatQty, sizeToMilli, sizeUnit, MILLI, type SizeUnit } from "./units.ts";

export class CatalogError extends Error {}

export type Unit = "kg" | "L" | "pcs";

export interface AdminItem {
  id: number;
  /** The substance this row is of, when it is a chemical. */
  chemical_id?: number | null;
  chemical_name?: string | null;
  aliases?: string | null;
  name: string;
  kind: "bulk" | "pack" | "finished" | "packaging";
  canonical_unit: Unit;
  size_milli: number;
  unit_label: string;
  sellable: number;
  price_basis: PriceBasis;
  price_cents: number;
  floor_cents: number;
  ceiling_cents: number;
  cost_cents: number;
  reorder_level_milli: number;
  active: number;
}

// -------------------------------------------------------------------- reads

/**
 * Everything the shop sells, in one list.
 *
 * There used to be three: finished products, chemicals with their pack sizes
 * nested under them, and packaging. Three lists for one question — "what do we
 * sell and what does it cost" — and the owner had to know which of the three a
 * thing lived in before he could change its price. They are one kind of row
 * now: a name, a unit, a price per unit, and a band.
 *
 * Retired rows come last rather than being hidden, because "where did it go" is
 * a worse question than a greyed-out line.
 */
export function listProducts(): AdminItem[] {
  return all<AdminItem>(
    `SELECT i.*, c.name AS chemical_name, c.aliases AS aliases
       FROM items i
       LEFT JOIN chemicals c ON c.id = i.chemical_id
      WHERE i.kind <> 'pack'
      ORDER BY i.active DESC, i.name COLLATE NOCASE`,
  );
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
  /** What the shop asks for one unit, in shillings. */
  price: number;
  /** The least it may go for. Zero means no floor. */
  floor: number;
  /** The most it may go for. Zero means no ceiling. */
  ceiling: number;
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

  const price = cents(input.price, "Price");
  const floor = cents(input.floor, "Least it may go for");
  const ceiling = cents(input.ceiling, "Most it may go for");
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

  /*
    The band has to contain the price, and has to be a band.

    Checked here rather than left to the counter to discover: a floor above the
    ceiling is not a rule anybody can obey, and a price outside its own band
    would refuse every sale at the asking price — which reads as the till being
    broken rather than as a catalogue that needs fixing.
  */
  if (floor > 0 && ceiling > 0 && floor > ceiling) {
    throw new CatalogError("The least it may go for can't be above the most it may go for.");
  }
  if (price > 0 && floor > 0 && price < floor) {
    throw new CatalogError("The price can't be below the least it may go for.");
  }
  if (price > 0 && ceiling > 0 && price > ceiling) {
    throw new CatalogError("The price can't be above the most it may go for.");
  }

  // The owner's screen writes the same history the counter does. Two ways in,
  // one record — otherwise "when did this last change?" would depend on which
  // screen happened to be used, and the answer would be wrong exactly when the
  // owner had been the one to change it.
  if (price !== item.price_cents) {
    run(
      `INSERT INTO price_changes (item_id, old_price, new_price, user_id, source)
       VALUES (?, ?, ?, ?, 'admin')`,
      input.itemId,
      item.price_cents,
      price,
      input.byUserId,
    );
  }

  run(
    `UPDATE items SET price_cents = ?, floor_cents = ?, ceiling_cents = ?, reorder_level_milli = ?
      WHERE id = ?`,
    price,
    floor,
    ceiling,
    reorderMilli,
    input.itemId,
  );
  audit(input.byUserId, "price_changed", "item", input.itemId, `${item.name} → ${price}c`);
}

// ----------------------------------------------------------------- identity

export interface ProductEditInput extends PricingInput {
  /** What the counter will call it. */
  name: string;
  /** Comma-separated other names, for search. Chemicals only. */
  aliases: string;
  /** kg, L or pcs — what the price is per and what stock is counted in. */
  unit: Unit;
  /** What one drum, bag or jerrican holds, counted in `unit`. */
  containerValue: number;
  /** drum, bag, jerrican… */
  containerLabel: string;
}

/**
 * Everything about a product, changed on one screen.
 *
 * The owner could re-price what the shop sells and could not correct any of it.
 * A chemical entered as "Ungrol", or sold by the litre when the shop weighs it,
 * or with a 20 kg drum recorded as 25, was wrong for good — the only way out
 * was to hide the row and add a second one, which splits its stock and its
 * sales history in two. That is how the shop ended up with pack rows nobody
 * could reconcile, and it must not be the answer to a typo.
 *
 * The unit is editable, deliberately, and that deserves recording: stock is
 * held as milli of the canonical unit, so switching kg to L RELABELS every
 * quantity already on the books rather than converting it — 20 000 milli reads
 * as 20 L where it used to read as 20 kg. That is exactly what an owner fixing
 * a wrongly-entered chemical wants, and exactly not what someone would want if
 * they thought it converted. The form says so beside the box. Refusing the
 * change instead would block the one job this screen exists for.
 *
 * Cost is still absent, for the reason at the top of this file.
 */
export function updateProduct(input: ProductEditInput): void {
  const item = getItem(input.itemId);
  if (!item) throw new CatalogError("That item no longer exists.");

  const name = input.name.trim();
  if (name.length < 2) throw new CatalogError("Give it a name.");

  if (!["kg", "L", "pcs"].includes(input.unit)) {
    throw new CatalogError("Choose whether it is sold by weight, by volume or by the piece.");
  }
  if (!Number.isFinite(input.containerValue) || input.containerValue <= 0) {
    throw new CatalogError("Say what one container holds — it has to be more than nothing.");
  }
  const containerMilli = Math.round(input.containerValue * MILLI);

  /*
    Two names have to stay unique, for two different reasons.

    `chemicals.name` because the database says so, and a save that trips the
    constraint would reach the owner as a raw SQLite error. `items.name`
    because the counter searches on it — two rows both called "Ungerol" are
    indistinguishable at the till, and the attendant would be picking one of
    them at random.
  */
  if (item.chemical_id) {
    const clash = get<{ id: number }>(
      `SELECT id FROM chemicals WHERE lower(name) = lower(?) AND id <> ?`,
      name,
      item.chemical_id,
    );
    if (clash) throw new CatalogError(`Another chemical is already called "${name}".`);
  }
  const twin = get<{ id: number }>(
    `SELECT id FROM items WHERE lower(name) = lower(?) AND id <> ?`,
    name,
    input.itemId,
  );
  if (twin) throw new CatalogError(`Something else on the list is already called "${name}".`);

  tx(() => {
    if (item.chemical_id) {
      run(
        `UPDATE chemicals SET name = ?, canonical_unit = ?, aliases = ? WHERE id = ?`,
        name,
        input.unit,
        input.aliases.trim(),
        item.chemical_id,
      );
    }
    run(
      `UPDATE items SET name = ?, canonical_unit = ?, size_milli = ?, unit_label = ? WHERE id = ?`,
      name,
      input.unit,
      containerMilli,
      input.containerLabel.trim() || "unit",
      input.itemId,
    );

    // After the identity, not before: the reorder level of something sold whole
    // is counted in containers, so it has to be worked out against the size
    // just written and not the one being replaced. `updatePricing` re-reads the
    // row, and opens no transaction of its own — `tx` does not nest.
    updatePricing(input);

    if (name !== item.name || input.unit !== item.canonical_unit) {
      audit(
        input.byUserId,
        "product_edited",
        "item",
        input.itemId,
        `${item.name} (per ${item.canonical_unit}) → ${name} (per ${input.unit})`,
      );
    }
  });
}

export function setItemActive(itemId: number, active: boolean, byUserId: number): void {
  const item = getItem(itemId);
  if (!item) throw new CatalogError("That item no longer exists.");
  run(`UPDATE items SET active = ? WHERE id = ?`, active ? 1 : 0, itemId);
  audit(byUserId, active ? "item_activated" : "item_retired", "item", itemId, item.name);
}

/**
 * What is holding an item in the catalogue, if anything.
 *
 * Every table that points at `items(id)`, asked one at a time so the answer can
 * name what it found. An item nothing points at is a mistake somebody typed and
 * can be removed; an item with one sale against it is part of the books.
 */
/**
 * Records belonging to somebody else, which have to outlive the item.
 *
 * A sale line sits on a customer's invoice; a quote line sits on a quotation in
 * their hand; a purchase line sits against money that left the account. Delete
 * the item under any of those and the document points at a row that is not
 * there any more.
 *
 * That is the whole list, and it is deliberately shorter than it used to be.
 * Price history, stock movements, bundle sizes and a packaging pairing are the
 * item's OWN bookkeeping: they say nothing to anyone once the item is gone, and
 * treating them as history meant a product added with the name spelled wrong
 * and given a price could never be removed — the catalogue filled with
 * greyed-out typos and the only remedy was to hide them.
 */
function tradedHistory(itemId: number): string[] {
  const counts: Array<[string, string]> = [
    [`SELECT COUNT(*) AS n FROM sale_lines WHERE item_id = ?`, "been sold"],
    [`SELECT COUNT(*) AS n FROM quote_lines WHERE item_id = ?`, "been quoted"],
    [`SELECT COUNT(*) AS n FROM purchase_lines WHERE item_id = ?`, "been bought in"],
    /*
      Mixing, at either end.

      A batch is the shop's record of what it made and what that cost, and both
      ends of it point at items. Deleting a product that has been mixed — or
      mixed OUT OF — would leave a run claiming to have made nothing, or to have
      been made from nothing, and the cost on the shelf would have no story
      behind it. This is the same reasoning as a sale: somebody's figures depend
      on the row still being there.
    */
    [`SELECT COUNT(*) AS n FROM batches WHERE output_item_id = ?`, "been mixed"],
    [`SELECT COUNT(*) AS n FROM batch_lines WHERE item_id = ?`, "been mixed with"],
  ];
  return counts
    .filter(([sql]) => (get<{ n: number }>(sql, itemId)?.n ?? 0) > 0)
    .map(([, label]) => label);
}

/**
 * Clear everything the item owns, so the row itself can go.
 *
 * Foreign keys are on, so this is not tidiness — without it the DELETE is
 * refused by the database and the owner is told "that did not work", which was
 * exactly what happened to every product that had been given bundle sizes.
 *
 * `stock_movements` is append-only at the database, by a trigger, and the
 * trigger is dropped and put back around this one delete. That guard exists to
 * protect the record of TRADING: a sale voided rather than deleted, a count
 * corrected by a further entry rather than an edit. An item that has never been
 * sold, quoted or bought has no trading to protect — its movements are an
 * opening count and nothing else — and the caller has already refused anything
 * that has. Inside the transaction, so a failure anywhere puts the guard back.
 */
function clearOwnRecords(itemId: number): void {
  run(`DELETE FROM bundles WHERE item_id = ?`, itemId);
  // A recipe pointing at a product that no longer exists would offer a mixing
  // board with nothing at the end of it. Untrading it is enough — the recipe
  // itself is still good, it just has nowhere to put what it makes.
  run(`UPDATE formulas SET output_item_id = NULL WHERE output_item_id = ?`, itemId);
  run(`DELETE FROM item_packaging WHERE item_id = ? OR packaging_item_id = ?`, itemId, itemId);

  /*
    Batches this item took part in, at either end.

    The shop briefly had a screen for diluting a concentrate into another
    product, and every batch it made left a `repacks` row pointing at the
    concentrate and a `repack_lines` row pointing at what came out. The screen
    is gone; the rows are not, and they hold BOTH products by foreign key with
    nothing on screen to say so — Delete is offered, pressed, and refused by the
    database.

    A batch is an internal working record, not a document anybody holds, so it
    goes. The whole event goes rather than half of it: a repack with its lines
    removed and its row left behind is a batch that made nothing.
  */
  const batches = all<{ id: number }>(
    `SELECT id FROM repacks WHERE from_item_id = ?
     UNION
     SELECT repack_id AS id FROM repack_lines WHERE item_id = ?`,
    itemId,
    itemId,
  ).map((r) => r.id);
  for (const id of batches) {
    run(`DELETE FROM repack_lines WHERE repack_id = ?`, id);
    run(`DELETE FROM repacks WHERE id = ?`, id);
  }

  /*
    Two of these tables are append-only at the database, by trigger, and both
    guards come off around this one delete and go straight back on.

    Those guards protect the record of TRADING: a sale voided rather than
    deleted, a shelf count corrected by a further entry rather than an edit, a
    price change that cannot be quietly rewritten. An item that has never been
    sold, quoted or bought has none of that to protect — the caller has already
    refused anything that has — and what is left is an opening count and the
    prices the owner typed while getting the row wrong. Held forever, they made
    a typo permanent.

    Dropped and recreated inside the caller's transaction, so any failure rolls
    the guards back with everything else.
  */
  run(`DROP TRIGGER IF EXISTS stock_movements_no_delete`);
  run(`DROP TRIGGER IF EXISTS price_changes_no_delete`);
  try {
    run(`DELETE FROM stock_movements WHERE item_id = ?`, itemId);
    run(`DELETE FROM price_changes WHERE item_id = ?`, itemId);
  } finally {
    run(
      `CREATE TRIGGER IF NOT EXISTS stock_movements_no_delete
       BEFORE DELETE ON stock_movements
       BEGIN
         SELECT RAISE(ABORT, 'stock_movements is append-only: post a correcting movement instead');
       END`,
    );
    run(
      `CREATE TRIGGER IF NOT EXISTS price_changes_no_delete
       BEFORE DELETE ON price_changes
       BEGIN
         SELECT RAISE(ABORT, 'price history is append-only: record a new change instead');
       END`,
    );
  }
}

/** Whether this item may be deleted, and what stands in the way if not. */
export function deletableReason(itemId: number): string | null {
  const held = tradedHistory(itemId);
  if (!held.length) return null;
  return held.join(", ");
}

/**
 * Remove a product from the catalogue for good.
 *
 * Only ever a product nothing points at. The shop's books are append-only on
 * purpose — a sale is voided, never deleted; stock moves by a correcting entry,
 * never an edit — and deleting an item that has been sold would leave a line on
 * a customer's invoice pointing at a row that no longer exists. So this refuses
 * anything with history and says what the history is.
 *
 * That still leaves the case it is for: a product added with the name spelled
 * wrong, or added twice, ten seconds ago. Without this the only remedy is to
 * hide it, and the catalogue slowly fills with typos nobody can clear out.
 *
 * For anything that has traded, hiding it is the right answer and remains
 * available — the counter stops offering it and the records stay whole.
 */
export function deleteProduct(itemId: number, byUserId: number): { name: string } {
  return tx(() => {
    const item = getItem(itemId);
    if (!item) throw new CatalogError("That item no longer exists.");

    const held = deletableReason(itemId);
    if (held) {
      throw new CatalogError(
        `${item.name} cannot be deleted — it has ${held}. Hide it from the counter instead, ` +
          `which keeps the records whole and stops it being sold.`,
      );
    }

    clearOwnRecords(itemId);
    run(`DELETE FROM items WHERE id = ?`, itemId);

    /*
      And the substance behind it, when nothing else needs it.

      A chemical row outliving its only item is not harmless: it goes on
      offering itself as an ingredient on the recipe screen, so a product
      deleted from the catalogue reappears in the one place the shop is most
      likely to pick it by mistake.
    */
    if (item.chemical_id) {
      const stillUsed =
        (get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM items WHERE chemical_id = ?`,
          item.chemical_id,
        )?.n ?? 0) > 0 ||
        (get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM formula_items WHERE chemical_id = ?`,
          item.chemical_id,
        )?.n ?? 0) > 0;
      if (!stillUsed) run(`DELETE FROM chemicals WHERE id = ?`, item.chemical_id);
    }
    // Audited before it is gone, with the name in the text: after the row is
    // deleted the id in this entry points at nothing, and the name is the only
    // thing that will still say what was removed.
    audit(byUserId, "item_deleted", "item", itemId, item.name);
    return { name: item.name };
  });
}

// ------------------------------------------------------------- new products

export interface ProductInput {
  name: string;
  /** As typed: g, kg, ml, L or pcs. */
  unit: SizeUnit;
  aliases: string;
  /** How much one container holds, in the unit above. */
  containerValue: number;
  /** What one container is called: drum, bag, jerrican, bottle. */
  containerLabel: string;
  /** What one kilogram / litre / piece sells for. Zero is allowed. */
  price: number;
  /** The least it may go for. Zero means no floor. */
  floor: number;
  /** The most it may go for. Zero means no ceiling. */
  ceiling: number;
  byUserId: number;
}

/**
 * Add something the shop sells.
 *
 * One way in, and everything set here. There used to be two forms — one for
 * products the shop mixed, one for chemicals, with pack sizes added afterwards
 * from a third place and prices from a fourth — so adding a thing and pricing a
 * thing were separate acts and half the catalogue arrived unpriced.
 *
 * Everything is a substance with a container and a price per unit. A jerrican
 * is a "chemical" measured in pieces whose container holds one; that is not a
 * trick, it is the observation that a shop sells things by some unit and the
 * unit is the only thing that varies.
 *
 * Cost is deliberately absent: it comes from what was actually paid on the
 * Purchases screen, so margins stay honest. A made-up cost poisons every one.
 */
export function createProduct(input: ProductInput): number {
  const name = input.name.trim();
  if (name.length < 2) throw new CatalogError("Give it a name.");
  if (get(`SELECT 1 FROM chemicals WHERE name = ?`, name)) {
    throw new CatalogError(`"${name}" is already in the list.`);
  }
  const u = sizeUnit(input.unit);
  const containerMilli = sizeToMilli(input.containerValue, input.unit);
  const price = cents(input.price, "Price");
  const floor = cents(input.floor, "Least it may go for");
  const ceiling = cents(input.ceiling, "Most it may go for");

  if (floor > 0 && ceiling > 0 && floor > ceiling) {
    throw new CatalogError("The least it may go for can't be above the most it may go for.");
  }
  if (price > 0 && floor > 0 && price < floor) {
    throw new CatalogError("The price can't be below the least it may go for.");
  }
  if (price > 0 && ceiling > 0 && price > ceiling) {
    throw new CatalogError("The price can't be above the most it may go for.");
  }

  return tx(() => {
    const { lastInsertRowid: chemId } = run(
      `INSERT INTO chemicals (name, canonical_unit, aliases) VALUES (?, ?, ?)`,
      name,
      u.canonical,
      input.aliases.trim(),
    );
    const { lastInsertRowid: itemId } = run(
      `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                          sellable, price_basis, price_cents, floor_cents, ceiling_cents,
                          cost_cents, reorder_level_milli)
       VALUES (?, ?, 'bulk', ?, ?, ?, 1, 'unit', ?, ?, ?, 0, ?)`,
      chemId,
      name,
      u.canonical,
      containerMilli,
      input.containerLabel.trim() || "unit",
      price,
      floor,
      ceiling,
      50_000,
    );
    audit(input.byUserId, "product_created", "item", itemId, `${name} at ${price}c per ${u.canonical}`);
    return itemId;
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

/**
 * What the move to per-kilogram pricing would do, without doing it.
 *
 * The counter is useless until this has run — every chemical still priced by
 * the pack has no per-kilogram rate, so a recipe reports it "cannot be billed"
 * and the attendant has no way to know why. So the owner is shown the state of
 * it on the catalogue screen, with the numbers, rather than being expected to
 * know a script exists.
 */
export interface PendingAdoption {
  /** Chemicals still priced by the pack rather than by the kilogram. */
  chemicals: number;
  /** Pack rows that would be retired. */
  packRows: number;
  /** Stock sitting on those rows, which moves back to the container. */
  stockMilli: number;
  /** Chemicals with no priced pack to work a rate out from. */
  unpriceable: string[];
}

export function pendingUnitPricing(): PendingAdoption {
  const rows = all<{ id: number; name: string; priced: number }>(
    `SELECT c.id, c.name,
            (SELECT COUNT(*) FROM items p
              WHERE p.chemical_id = c.id AND p.kind = 'pack' AND p.price_cents > 0) AS priced
       FROM chemicals c
       JOIN items b ON b.chemical_id = c.id AND b.kind = 'bulk' AND b.price_basis <> 'unit'
      ORDER BY c.name`,
  );

  const packs = get<{ n: number; milli: number }>(
    `SELECT COUNT(*) AS n,
            COALESCE((SELECT SUM(m.delta_milli)
                        FROM stock_movements m
                        JOIN items p2 ON p2.id = m.item_id
                       WHERE p2.kind = 'pack'), 0) AS milli
       FROM items p WHERE p.kind = 'pack' AND p.active = 1`,
  );

  return {
    chemicals: rows.length,
    packRows: packs?.n ?? 0,
    stockMilli: Math.max(0, packs?.milli ?? 0),
    unpriceable: rows.filter((r) => r.priced === 0).map((r) => r.name),
  };
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
        const priced = packs.filter((p) => p.price_cents > 0 && p.size_milli > 0);
        const source = priced.length
          ? priced.reduce((best, p) =>
              Math.abs(p.size_milli - 1000) < Math.abs(best.size_milli - 1000) ? p : best,
            )
          : null;

        const per = (cents: number, sizeMilli: number) => Math.round((cents * 1000) / sizeMilli);
        const rate = source ? per(source.price_cents, source.size_milli) : 0;
        const floor = source && source.floor_cents > 0 ? per(source.floor_cents, source.size_milli) : 0;
        /*
          A ceiling nobody set, set to something defensible.

          These prices are being carried across from a catalogue that had no
          upper limit at all, so leaving every ceiling at zero would mean the
          band only guards one end until the owner walks the whole list. A fifth
          over the asking price is wide enough that ordinary haggling never
          touches it and narrow enough to catch a fat finger — and it is one
          number on one row to change.
        */
        const ceiling = rate > 0 ? Math.round(rate * 1.2) : 0;

        run(
          `UPDATE items
              SET price_basis = 'unit', sellable = 1,
                  price_cents = ?, floor_cents = ?, ceiling_cents = ?,
                  reorder_level_milli = ?
            WHERE id = ?`,
          rate,
          floor,
          ceiling,
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
