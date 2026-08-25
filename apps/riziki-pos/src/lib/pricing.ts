/**
 * The morning price check.
 *
 * Chemical prices at this shop move with the supplier, sometimes weekly, and
 * until now only the owner could change them — on the catalogue screen, four
 * fields deep, among every product the shop sells. That is the wrong screen for
 * the job and the wrong person for it too: the attendant is the one who opens
 * in the morning, and the one who will be asked the price at ten o'clock.
 *
 * So this is a separate, narrow thing: a list of what the shop sells, the price
 * it went out at yesterday, and a box to type today's. Two rules keep it safe
 * to hand to an attendant:
 *
 *   - a price may be raised freely, and lowered only as far as the item's floor.
 *     That is the rule the till already applies to a discount, so the shop has
 *     one rule about the floor rather than two.
 *   - every change is written to `price_changes` with who and when, so the owner
 *     can see the morning's work and a customer arguing about last week's price
 *     can be answered from the record.
 *
 * What this deliberately does NOT touch: the floor itself, the cost, and
 * whether an item is sold at all. Those stay the owner's, on the owner's screen.
 * An attendant who could move the floor could sell at any price they liked, and
 * the guard rail would be decorative.
 */

import { all, get, run, tx, audit } from "./db.ts";
import { priceBandCheck } from "./sales.ts";
import { formatKes, fromCents, toCents } from "./units.ts";

export class PriceError extends Error {}

/** Prices set before this many days ago are worth a second look. */
export const STALE_DAYS = 14;

export interface PriceEdit {
  itemId: number;
  /** What the shop asks for one unit, in shillings. */
  price: number;
}

export interface PriceResult {
  changed: number;
  skipped: number;
  /** One line per change, already phrased for a person. */
  lines: string[];
}

/**
 * Apply price changes, all or nothing.
 *
 * A batch rather than one at a time because a price sweep is one pass down a
 * list, and six round trips would be six chances to be interrupted half way.
 * One transaction, so an unacceptable price in row four does not leave rows one
 * to three applied and whoever typed them unsure what actually took.
 */
export function applyPrices(
  edits: PriceEdit[],
  userId: number,
  opts: { allowOutsideBand?: boolean; source?: "check" | "admin" | "counter" } = {},
): PriceResult {
  if (!edits.length) return { changed: 0, skipped: 0, lines: [] };

  return tx(() => {
    const lines: string[] = [];
    let changed = 0;
    let skipped = 0;

    for (const edit of edits) {
      const item = get<{
        id: number;
        name: string;
        price_cents: number;
        floor_cents: number;
        ceiling_cents: number;
      }>(
        `SELECT id, name, price_cents, floor_cents, ceiling_cents FROM items WHERE id = ?`,
        edit.itemId,
      );
      if (!item) throw new PriceError("One of those items no longer exists. Reload and try again.");

      const price = money(edit.price, `${item.name} price`);

      if (price === item.price_cents) {
        skipped++;
        continue;
      }

      /*
        The band is the whole guard rail.

        Both ends, and for the same reason: the owner decided the range this
        price may move in, and a price outside it is his decision rather than
        one made at a counter with somebody waiting. A price of zero is exempt —
        it means "not priced yet", which is a state the catalogue has to be able
        to be in while a new chemical is being set up.
      */
      if (!opts.allowOutsideBand && price > 0) {
        const breach = priceBandCheck({ ...item, price_cents: price }, price);
        if (breach === "below_floor") {
          throw new PriceError(
            `${item.name}: ${formatKes(price)} is below the least it may go for ` +
              `(${formatKes(item.floor_cents)}). The owner's PIN is needed to go under it.`,
          );
        }
        if (breach === "above_ceiling") {
          throw new PriceError(
            `${item.name}: ${formatKes(price)} is above the most it may go for ` +
              `(${formatKes(item.ceiling_cents)}). The owner's PIN is needed to go over it.`,
          );
        }
      }

      run(
        `INSERT INTO price_changes (item_id, old_price, new_price, user_id, source)
         VALUES (?, ?, ?, ?, ?)`,
        item.id,
        item.price_cents,
        price,
        userId,
        opts.source ?? "check",
      );
      run(`UPDATE items SET price_cents = ? WHERE id = ?`, price, item.id);

      changed++;
      lines.push(`${item.name}: ${formatKes(item.price_cents)} → ${formatKes(price)}`);
    }

    if (changed) {
      audit(userId, "price_checked", "item", null, `${changed} price${changed === 1 ? "" : "s"} changed`);
    }
    return { changed, skipped, lines };
  });
}

/**
 * Keep a price agreed at the counter as the shop's new price.
 *
 * The counter has always let an attendant come down on a price, but only for
 * the sale in front of them — which is right for haggling and wrong for the
 * other half of what happens at a counter: the supplier's price moved, the
 * attendant learns the real number from the first customer of the day, and it
 * should be the shelf price from then on. Without this, that fact lived in one
 * person's head until somebody opened a separate screen to type it in again.
 *
 * The band still holds, and the change is written to the append-only history
 * with the name of whoever made it.
 */
export function setCounterPrice(input: {
  itemId: number;
  priceCents: number;
  userId: number;
  allowOutsideBand?: boolean;
}): { name: string; oldCents: number; newCents: number; changed: boolean } {
  const item = get<{ id: number; name: string; price_cents: number }>(
    `SELECT id, name, price_cents FROM items WHERE id = ?`,
    input.itemId,
  );
  if (!item) throw new PriceError("That item is no longer on the price list.");

  /*
    Delegated rather than reimplemented.

    `applyPrices` owns the band check, the history row and the transaction, and
    a second copy of that logic here would be a second place for the floor to
    stop being enforced. It takes shillings because that is what the forms hand
    it; `money()` rounds back to the same integer cents on the way in.
  */
  const result = applyPrices([{ itemId: item.id, price: fromCents(input.priceCents) }], input.userId, {
    allowOutsideBand: input.allowOutsideBand,
    source: "counter",
  });

  return {
    name: item.name,
    oldCents: item.price_cents,
    newCents: input.priceCents,
    changed: result.changed > 0,
  };
}

function money(shillings: number, label: string): number {
  if (!Number.isFinite(shillings) || shillings < 0) {
    throw new PriceError(`${label} must be a number, zero or more.`);
  }
  return toCents(shillings);
}

// -------------------------------------------------------------- the record

export interface HistoryRow {
  at: string;
  item_name: string;
  old_price: number;
  new_price: number;
  user_name: string | null;
  source: string;
}

/**
 * One page of price history, and how many there are in all.
 *
 * `priceHistory` below takes a limit and hands back whatever fits, which is
 * right for the strip of recent changes on the purchases screen but wrong for
 * the history screen: a limit with no count cannot say whether anything was
 * left behind, so the screen quietly stopped at 120 changes and looked
 * complete. The count comes from the database rather than from the rows,
 * because the whole point is to know about the rows that were not fetched.
 */
export function priceHistoryPage(
  page: number,
  perPage: number,
  itemId?: number,
): { rows: HistoryRow[]; total: number; pages: number } {
  const where = itemId ? "WHERE p.item_id = ?" : "";
  const args = itemId ? [itemId] : [];

  const total =
    get<{ n: number }>(`SELECT count(*) AS n FROM price_changes p ${where}`, ...args)?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), pages);

  const rows = all<HistoryRow>(
    `SELECT p.at, i.name AS item_name, p.old_price, p.new_price,
            u.name AS user_name, p.source
       FROM price_changes p
       JOIN items i ON i.id = p.item_id
       LEFT JOIN users u ON u.id = p.user_id
      ${where}
      ORDER BY p.at DESC, p.id DESC
      LIMIT ? OFFSET ?`,
    ...args,
    perPage,
    (current - 1) * perPage,
  );

  return { rows, total, pages };
}

export function priceHistory(itemId?: number, limit = 60): HistoryRow[] {
  return all<HistoryRow>(
    `SELECT p.at, i.name AS item_name, p.old_price, p.new_price,
            u.name AS user_name, p.source
       FROM price_changes p
       JOIN items i ON i.id = p.item_id
       LEFT JOIN users u ON u.id = p.user_id
      ${itemId ? "WHERE p.item_id = ?" : ""}
      ORDER BY p.at DESC, p.id DESC
      LIMIT ?`,
    ...(itemId ? [itemId] : []),
    limit,
  );
}
