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
import { formatKes, toCents } from "./units.ts";

export class PriceError extends Error {}

/** Prices set before this many days ago are worth a second look. */
export const STALE_DAYS = 14;

export interface PriceRow {
  id: number;
  name: string;
  kind: string;
  unit_label: string;
  size_milli: number;
  canonical_unit: string;
  retail_cents: number;
  wholesale_cents: number;
  floor_cents: number;
  cost_cents: number;
  /** Null when the price has never been changed since the shop was set up. */
  changed_at: string | null;
  changed_by: string | null;
}

/**
 * Everything sellable, cheapest-to-scan order.
 *
 * Chemicals first because they are the ones that move — a finished product's
 * price is the shop's own decision and changes when the owner decides, whereas
 * caustic soda changes when the world does.
 */
export function priceList(q = ""): PriceRow[] {
  const like = `%${q.trim().toLowerCase()}%`;
  const searching = q.trim().length > 0;

  return all<PriceRow>(
    `SELECT i.id, i.name, i.kind, i.unit_label, i.size_milli, i.canonical_unit,
            i.retail_cents, i.wholesale_cents, i.floor_cents, i.cost_cents,
            (SELECT p.at FROM price_changes p WHERE p.item_id = i.id ORDER BY p.at DESC LIMIT 1)
              AS changed_at,
            (SELECT u.name FROM price_changes p LEFT JOIN users u ON u.id = p.user_id
              WHERE p.item_id = i.id ORDER BY p.at DESC LIMIT 1)
              AS changed_by
       FROM items i
      WHERE i.active = 1 AND i.sellable = 1
        ${searching ? "AND LOWER(i.name) LIKE ?" : ""}
      ORDER BY CASE i.kind WHEN 'bulk' THEN 0 WHEN 'pack' THEN 0 ELSE 1 END,
               i.name COLLATE NOCASE, i.size_milli`,
    ...(searching ? [like] : []),
  );
}

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
  opts: { allowBelowFloor?: boolean; source?: "check" | "admin" } = {},
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

function money(shillings: number, label: string): number {
  if (!Number.isFinite(shillings) || shillings < 0) {
    throw new PriceError(`${label} must be a number, zero or more.`);
  }
  return toCents(shillings);
}

// ------------------------------------------------------------------ the ritual

export interface CheckState {
  /** Nairobi date of the last check, "YYYY-MM-DD", or null if never. */
  lastAt: string | null;
  lastBy: string | null;
  doneToday: boolean;
  /** Sellable prices not touched in STALE_DAYS — the ones worth looking at. */
  staleCount: number;
}

/**
 * Has anyone looked at prices today, and how much is going stale?
 *
 * The shop keeps Nairobi time (UTC+3) and SQLite stores UTC, so "today" has to
 * be asked for in the shop's day, not the server's — otherwise a check at 8am
 * would read as yesterday's for the first three hours of every morning.
 */
export function checkState(): CheckState {
  const last = get<{ at: string; name: string | null }>(
    `SELECT p.at, u.name
       FROM price_changes p LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.at DESC LIMIT 1`,
  );

  const today = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM price_changes
      WHERE date(at, '+3 hours') = date('now', '+3 hours')`,
  );

  const stale = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM items i
      WHERE i.active = 1 AND i.sellable = 1 AND i.retail_cents > 0
        AND COALESCE(
              (SELECT p.at FROM price_changes p WHERE p.item_id = i.id ORDER BY p.at DESC LIMIT 1),
              '0000-00-00'
            ) < datetime('now', ?)`,
    `-${STALE_DAYS} days`,
  );

  return {
    lastAt: last?.at ?? null,
    lastBy: last?.name ?? null,
    doneToday: (today?.n ?? 0) > 0,
    staleCount: stale?.n ?? 0,
  };
}

/**
 * Whole days since a price last moved, or null if it never has.
 *
 * Never-changed is not the same as changed-long-ago: a price that came in with
 * the shop's opening stock has no history at all, and saying "9,371 days" of it
 * would be nonsense.
 */
export function ageOfPrice(changedAt: string | null, now: Date = new Date()): number | null {
  if (!changedAt) return null;
  const at = new Date(changedAt.includes("T") ? changedAt : changedAt.replace(" ", "T") + "Z");
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86_400_000));
}

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
