/**
 * Selling past zero, and what that means the shop owes.
 *
 * Ungerol runs out on a Tuesday and a customer wants twenty kilos. The shop
 * fetches it from the yard next door, sells it, and puts it back when the lorry
 * comes on Thursday. That is a real and ordinary thing this trade does, and
 * until now the till refused it: the shelf said nothing left, so the sale could
 * not be entered, and the twenty kilos went out of the door unrecorded — which
 * is worse than either alternative, because then nobody owes anybody anything
 * on paper.
 *
 * THE MODEL IS THE LEDGER ITSELF. There is no borrowing table. Stock is a sum
 * of movements, so a shop that has sold twenty kilos it did not have is simply
 * at minus twenty — and that negative IS the debt to the shop next door, in the
 * unit the debt is actually in. When eighty kilos are delivered the count goes
 * to sixty without anybody reconciling anything, which is what "it balances
 * out" means and why nothing else needs building.
 *
 * WHAT IS NEW is only permission: `items.oversell_milli` says how far past zero
 * each thing may go. Zero — the default, and every item until somebody says
 * otherwise — is exactly today's behaviour, a till that refuses what the shelf
 * cannot cover. It is per item because the answer is: twenty kilos of Ungerol
 * is a phone call to a neighbour, and twenty kilos of a perfume concentrate
 * nobody else stocks is a promise that cannot be kept.
 *
 * Nothing here imports from `next/*`, so it can be unit-tested under Node.
 */

import { all, type Item } from "./db.ts";
import { formatQty } from "./units.ts";

/** How far below zero this item may be taken. Zero means it may not. */
export function allowanceOf(item: Pick<Item, "id"> & { oversell_milli?: number }): number {
  return Math.max(0, item.oversell_milli ?? 0);
}

/**
 * The most that may leave the shelf right now: what is on it, plus what may be
 * fetched from next door.
 */
export function sellableMilli(
  item: Pick<Item, "id"> & { oversell_milli?: number },
  onHandMilli: number,
): number {
  return onHandMilli + allowanceOf(item);
}

export interface Borrowed {
  itemId: number;
  name: string;
  unit: string;
  /** How much is owed — always positive, however the shelf says it. */
  owedMilli: number;
  /** What may still be fetched on top of what already has been. */
  roomLeftMilli: number;
}

/**
 * Everything currently sold past zero, and by how much.
 *
 * This is the list somebody walks next door with. Sorted by what is owed, most
 * first, because that is the order the errands get done in.
 */
export function borrowed(): Borrowed[] {
  const rows = all<{
    id: number;
    name: string;
    canonical_unit: string;
    oversell_milli: number;
    qty: number;
  }>(
    `SELECT i.id, i.name, i.canonical_unit, i.oversell_milli,
            COALESCE((SELECT SUM(delta_milli) FROM stock_movements m WHERE m.item_id = i.id), 0) AS qty
       FROM items i
      WHERE i.active = 1
      ORDER BY i.name`,
  );
  return rows
    .filter((r) => r.qty < 0)
    .map((r) => ({
      itemId: r.id,
      name: r.name,
      unit: r.canonical_unit,
      owedMilli: -r.qty,
      roomLeftMilli: Math.max(0, (r.oversell_milli ?? 0) + r.qty),
    }))
    .sort((a, b) => b.owedMilli - a.owedMilli);
}

/**
 * Why a sale cannot go through, said in the shop's own terms.
 *
 * Returns null when it can. The two cases read differently on purpose: a shop
 * that has no borrowing room set is being told the shelf is empty, and a shop
 * that has used all of its room is being told it has already fetched as much as
 * it said it would.
 */
export function refusal(
  name: string,
  unit: string,
  onHandMilli: number,
  allowanceMilli: number,
  wantedMilli: number,
): string | null {
  if (wantedMilli <= onHandMilli + allowanceMilli) return null;

  const left = Math.max(0, onHandMilli);
  if (allowanceMilli <= 0) {
    return (
      `There is ${formatQty(left, unit)} of ${name} left, and this sale asks for ` +
      `${formatQty(wantedMilli, unit)}. If there is more in the store than the book says, ` +
      `do a stock take first.`
    );
  }

  const alreadyOwed = onHandMilli < 0 ? -onHandMilli : 0;
  return (
    `${name} is down to ${formatQty(left, unit)}` +
    (alreadyOwed > 0 ? `, with ${formatQty(alreadyOwed, unit)} already owed next door` : "") +
    `. This sale asks for ${formatQty(wantedMilli, unit)}, which is past the ` +
    `${formatQty(allowanceMilli, unit)} it may be sold short by. Record the delivery, or raise ` +
    `that limit under Products & prices.`
  );
}
