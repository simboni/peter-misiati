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
import { formatKes, fromCents, toCents } from "./units.ts";

export class PriceError extends Error {}

/** Prices set before this many days ago are worth a second look. */
export const STALE_DAYS = 14;

export interface PriceEdit {
  itemId: number;
  /** Shillings, as typed. Blank or unchanged rows should not be sent. */
  retail: number;
  wholesale: number;
}

export interface PriceResult {
  changed: number;
  skipped: number;
  /** Human-readable, for reading back at the counter. */
  lines: string[];
}

/**
 * Apply a batch of price edits.
 *
 * A batch rather than one at a time because the morning check is one pass down
 * a list: typing six prices and pressing Save once is the job, and six separate
 * round trips would be six chances to be interrupted half way.
 *
 * One transaction, so an unacceptable price in row four does not leave rows one
 * to three applied and the attendant unsure what actually took.
 */
export function applyPrices(
  edits: PriceEdit[],
  userId: number,
  opts: { allowBelowFloor?: boolean; source?: "check" | "admin" | "counter" } = {},
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
        retail_cents: number;
        wholesale_cents: number;
        floor_cents: number;
      }>(
        `SELECT id, name, retail_cents, wholesale_cents, floor_cents FROM items WHERE id = ?`,
        edit.itemId,
      );
      if (!item) throw new PriceError("One of those items no longer exists. Reload and try again.");

      const retail = money(edit.retail, `${item.name} retail price`);
      const wholesale = money(edit.wholesale, `${item.name} wholesale price`);

      if (retail === item.retail_cents && wholesale === item.wholesale_cents) {
        skipped++;
        continue;
      }

      // The floor is the whole guard rail. A wholesale price of zero means "not
      // sold at wholesale", so it is exempt — otherwise every item without a
      // wholesale price would be unsavable.
      if (!opts.allowBelowFloor && item.floor_cents > 0) {
        if (retail > 0 && retail < item.floor_cents) {
          throw new PriceError(
            `${item.name}: ${formatKes(retail)} is below the floor of ${formatKes(item.floor_cents)}. The owner's PIN is needed to go under it.`,
          );
        }
        if (wholesale > 0 && wholesale < item.floor_cents) {
          throw new PriceError(
            `${item.name}: wholesale ${formatKes(wholesale)} is below the floor of ${formatKes(item.floor_cents)}. The owner's PIN is needed to go under it.`,
          );
        }
      }

      run(
        `INSERT INTO price_changes
           (item_id, old_retail, new_retail, old_wholesale, new_wholesale, user_id, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        item.id,
        item.retail_cents,
        retail,
        item.wholesale_cents,
        wholesale,
        userId,
        opts.source ?? "check",
      );
      run(
        `UPDATE items SET retail_cents = ?, wholesale_cents = ? WHERE id = ?`,
        retail,
        wholesale,
        item.id,
      );

      changed++;
      lines.push(
        retail === item.retail_cents
          ? `${item.name}: wholesale ${formatKes(item.wholesale_cents)} → ${formatKes(wholesale)}`
          : `${item.name}: ${formatKes(item.retail_cents)} → ${formatKes(retail)}`,
      );
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
 * Only the tier being sold on is touched. Changing the retail price because a
 * trade buyer negotiated a wholesale one would move a number nobody discussed.
 *
 * Everything else is the same guard the price sheet had: the floor still holds
 * unless an owner authorised going under it, and the change is written to the
 * append-only history with the name of whoever made it.
 */
export function setCounterPrice(input: {
  itemId: number;
  tier: "retail" | "wholesale";
  priceCents: number;
  userId: number;
  allowBelowFloor?: boolean;
}): { name: string; oldCents: number; newCents: number; changed: boolean } {
  const item = get<{ id: number; name: string; retail_cents: number; wholesale_cents: number }>(
    `SELECT id, name, retail_cents, wholesale_cents FROM items WHERE id = ?`,
    input.itemId,
  );
  if (!item) throw new PriceError("That item is no longer on the price list.");

  const oldCents = input.tier === "wholesale" ? item.wholesale_cents : item.retail_cents;

  /*
    Delegated rather than reimplemented.

    `applyPrices` owns the floor check, the history row and the transaction, and
    a second copy of that logic here would be a second place for the floor to
    stop being enforced. It takes shillings because that is what the forms hand
    it; `money()` rounds back to the same integer cents on the way in.
  */
  const result = applyPrices(
    [
      {
        itemId: item.id,
        retail: fromCents(input.tier === "retail" ? input.priceCents : item.retail_cents),
        wholesale: fromCents(input.tier === "wholesale" ? input.priceCents : item.wholesale_cents),
      },
    ],
    input.userId,
    { allowBelowFloor: input.allowBelowFloor, source: "counter" },
  );

  return { name: item.name, oldCents, newCents: input.priceCents, changed: result.changed > 0 };
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
  old_retail: number;
  new_retail: number;
  old_wholesale: number;
  new_wholesale: number;
  user_name: string | null;
  source: string;
}

export function priceHistory(itemId?: number, limit = 60): HistoryRow[] {
  return all<HistoryRow>(
    `SELECT p.at, i.name AS item_name, p.old_retail, p.new_retail,
            p.old_wholesale, p.new_wholesale, u.name AS user_name, p.source
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
