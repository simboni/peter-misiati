/**
 * Bundles — the sizes a thing is sold in, each at its own price.
 *
 * Ungerol has one price per kilogram and is weighed out to whatever is asked
 * for. It is also sold as a 5 kg, a 10 kg and a 20 kg, and those are cheaper
 * per kilogram — that is the whole point of them. A bundle is therefore a
 * PRICE, attached to the thing that already exists, and never a thing of its
 * own: selling a 20 kg bundle takes 20 kg off the one drum.
 *
 * That distinction is the lesson of the pack rows this replaces. Those were
 * separate items, each holding its own stock, and the shop spent real time
 * moving kilos between a drum and its packs so that both numbers would be
 * right. There is one number now.
 *
 * A bundle belongs to an item, or to a formula, never both:
 *
 *   item     a size of something on the shelf. Stock comes off that item.
 *   formula  a size of something mixed to order. The ingredients are what
 *            leave the store, priced by the bundle rather than by the sum of
 *            their parts — which is what lets the shop sell a 5 L of Carwash
 *            Shampoo for a round number.
 */

import { all, get, run, tx } from "./db.ts";
import { MILLI } from "./units.ts";

export interface Bundle {
  id: number;
  sizeMilli: number;
  priceCents: number;
  /** Never below this without the owner's PIN. Zero means no floor set. */
  floorCents: number;
  sortOrder: number;
}

/** What one bundle works out at per kilogram or litre. */
export function bundleRateCents(b: Pick<Bundle, "sizeMilli" | "priceCents">): number {
  if (b.sizeMilli <= 0) return 0;
  return Math.round((b.priceCents * MILLI) / b.sizeMilli);
}

/**
 * What a bundle saves against buying the same quantity loose, in cents.
 *
 * Zero when the item has no per-unit price to compare against, and zero when
 * the bundle is the dearer of the two — a "saving" that is really a mark-up is
 * not something to put on a screen.
 */
export function bundleSavingCents(
  b: Pick<Bundle, "sizeMilli" | "priceCents">,
  unitPriceCents: number,
): number {
  if (unitPriceCents <= 0) return 0;
  const loose = Math.round((unitPriceCents * b.sizeMilli) / MILLI);
  return Math.max(0, loose - b.priceCents);
}

interface Row {
  id: number;
  size_milli: number;
  price_cents: number;
  floor_cents: number;
  sort_order: number;
}

const shape = (r: Row): Bundle => ({
  id: r.id,
  sizeMilli: r.size_milli,
  priceCents: r.price_cents,
  floorCents: r.floor_cents,
  sortOrder: r.sort_order,
});

/*
  Smallest first.

  `sort_order` is kept so the owner could reorder them later, but the natural
  reading of "5, 10, 20" is by size, and a counter hunting for the 20 kg wants
  it where it was last time rather than wherever it was typed.
*/
const ORDER = "ORDER BY sort_order, size_milli";

export function itemBundles(itemId: number, includeHidden = false): Bundle[] {
  return all<Row>(
    `SELECT id, size_milli, price_cents, floor_cents, sort_order
       FROM bundles
      WHERE item_id = ? ${includeHidden ? "" : "AND active = 1"}
      ${ORDER}`,
    itemId,
  ).map(shape);
}

export function formulaBundles(formulaId: number, includeHidden = false): Bundle[] {
  return all<Row>(
    `SELECT id, size_milli, price_cents, floor_cents, sort_order
       FROM bundles
      WHERE formula_id = ? ${includeHidden ? "" : "AND active = 1"}
      ${ORDER}`,
    formulaId,
  ).map(shape);
}

/**
 * Every item's bundles in one query.
 *
 * The counter needs these for the whole board at once, and asking per item
 * would be a hundred round trips on a phone that is often on one bar.
 */
export function bundlesByItem(): Map<number, Bundle[]> {
  const rows = all<Row & { item_id: number }>(
    `SELECT item_id, id, size_milli, price_cents, floor_cents, sort_order
       FROM bundles
      WHERE item_id IS NOT NULL AND active = 1
      ${ORDER}`,
  );
  const out = new Map<number, Bundle[]>();
  for (const r of rows) {
    const list = out.get(r.item_id) ?? [];
    list.push(shape(r));
    out.set(r.item_id, list);
  }
  return out;
}

export function bundlesByFormula(): Map<number, Bundle[]> {
  const rows = all<Row & { formula_id: number }>(
    `SELECT formula_id, id, size_milli, price_cents, floor_cents, sort_order
       FROM bundles
      WHERE formula_id IS NOT NULL AND active = 1
      ${ORDER}`,
  );
  const out = new Map<number, Bundle[]>();
  for (const r of rows) {
    const list = out.get(r.formula_id) ?? [];
    list.push(shape(r));
    out.set(r.formula_id, list);
  }
  return out;
}

/** One bundle, with the owner it belongs to — for checking a sale against. */
export function findBundle(
  id: number,
): (Bundle & { itemId: number | null; formulaId: number | null; active: boolean }) | null {
  const r = get<Row & { item_id: number | null; formula_id: number | null; active: number }>(
    `SELECT id, item_id, formula_id, size_milli, price_cents, floor_cents, sort_order, active
       FROM bundles WHERE id = ?`,
    id,
  );
  if (!r) return null;
  return { ...shape(r), itemId: r.item_id, formulaId: r.formula_id, active: r.active === 1 };
}

export class BundleError extends Error {}

export interface BundleInput {
  /** Present when editing one that already exists. */
  id?: number;
  sizeMilli: number;
  priceCents: number;
  floorCents: number;
}

/**
 * Replace the whole set of bundles for one owner.
 *
 * The editor hands back every row it is showing, so this is a set operation
 * rather than a stream of adds and deletes — which means the screen and the
 * database cannot drift apart if a request is lost halfway.
 *
 * A bundle that has been dropped from the set is switched OFF rather than
 * deleted, because sale lines point at it: a receipt from last week has to go
 * on saying it was a 20 kg bundle even after the shop stops selling that size.
 */
export function saveBundles(
  owner: { itemId: number } | { formulaId: number },
  inputs: BundleInput[],
): void {
  const isItem = "itemId" in owner;
  const column = isItem ? "item_id" : "formula_id";
  const ownerId = isItem ? owner.itemId : owner.formulaId;

  const seen = new Set<number>();
  for (const b of inputs) {
    if (b.sizeMilli <= 0) throw new BundleError("A bundle needs a size bigger than nothing.");
    if (b.priceCents < 0) throw new BundleError("A bundle price cannot be negative.");
    if (b.floorCents > 0 && b.floorCents > b.priceCents) {
      throw new BundleError("A bundle's floor cannot be above its own price.");
    }
    if (seen.has(b.sizeMilli)) {
      throw new BundleError("Two bundles of the same size — one size, one price.");
    }
    seen.add(b.sizeMilli);
  }

  tx(() => {
    // Off first, then on: a size that was switched off and is being brought
    // back must not collide with itself on the way through.
    run(`UPDATE bundles SET active = 0 WHERE ${column} = ?`, ownerId);

    inputs.forEach((b, i) => {
      const existing = get<{ id: number }>(
        `SELECT id FROM bundles WHERE ${column} = ? AND size_milli = ?`,
        ownerId,
        b.sizeMilli,
      );
      if (existing) {
        run(
          `UPDATE bundles
              SET price_cents = ?, floor_cents = ?, sort_order = ?, active = 1
            WHERE id = ?`,
          b.priceCents,
          b.floorCents,
          i,
          existing.id,
        );
      } else {
        run(
          `INSERT INTO bundles (${column}, size_milli, price_cents, floor_cents, sort_order, active)
           VALUES (?, ?, ?, ?, ?, 1)`,
          ownerId,
          b.sizeMilli,
          b.priceCents,
          b.floorCents,
          i,
        );
      }
    });
  });
}
