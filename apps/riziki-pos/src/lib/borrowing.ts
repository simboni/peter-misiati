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

import { all, audit, type Item } from "./db.ts";
import { getSetting, setSetting } from "./users.ts";
import { formatQty } from "./units.ts";

/*
  THE SHOP'S GENERAL RULE, and why it is not per item any more.

  The allowance started per item, because twenty kilos of Ungerol is a phone
  call to a neighbour and twenty kilos of a perfume concentrate nobody else
  stocks is a promise that cannot be kept. In this trade that turned out to be
  a distinction without a difference: when a customer is standing there, the
  shop finds the goods somewhere or loses the sale, and nobody is going to walk
  to Products & prices to raise a limit first. So the rule is the shop's, set
  once, and it covers every product, every chemical, and every ingredient a
  recipe reaches for — the same permission whether the goods leave by the
  counter or into a drum.

  An item's own allowance is not thrown away: it is a floor, not a ceiling. The
  shop's rule, or this item's own number, whichever is the more generous.
*/
export interface OversellPolicy {
  /** Whether anything at all may be sold past zero without its own allowance. */
  all: boolean;
  /**
   * How far, in thousandths of each thing's own unit. Zero means no limit —
   * which is what "allow it everywhere" means to a shop that cannot know in
   * advance how much the yard next door will have.
   */
  capMilli: number;
}

const KEY_ALL = "oversell_all";
const KEY_CAP = "oversell_cap_milli";

/**
 * The rule as it stands. On by default: a till that refuses what the shop can
 * fetch in two minutes sends the goods out of the door unrecorded, which is
 * worse than a negative number somebody can see and settle.
 */
export function oversellPolicy(): OversellPolicy {
  const capRaw = Number(getSetting(KEY_CAP, "0"));
  return {
    all: getSetting(KEY_ALL, "1") !== "0",
    capMilli: Number.isFinite(capRaw) && capRaw > 0 ? Math.round(capRaw) : 0,
  };
}

export function setOversellPolicy(policy: OversellPolicy, userId: number | null): OversellPolicy {
  const cap = Number.isFinite(policy.capMilli) && policy.capMilli > 0 ? Math.round(policy.capMilli) : 0;
  setSetting(KEY_ALL, policy.all ? "1" : "0", userId);
  setSetting(KEY_CAP, String(cap), userId);
  audit(
    userId,
    "oversell_policy",
    "settings",
    null,
    policy.all ? (cap > 0 ? `allowed, up to ${cap / 1000}` : "allowed, no limit") : "refused",
  );
  return oversellPolicy();
}

/**
 * How far below zero this item may be taken. Zero means it may not; Infinity
 * means the shop has said yes and named no limit.
 *
 * The policy is passed in rather than read here because one sale asks this of
 * a dozen items and the answer cannot change halfway down a bill.
 */
export function allowanceOf(
  item: Pick<Item, "id"> & { oversell_milli?: number },
  policy?: OversellPolicy,
): number {
  const own = Math.max(0, item.oversell_milli ?? 0);
  const rule = policy ?? oversellPolicy();
  if (!rule.all) return own;
  return rule.capMilli > 0 ? Math.max(own, rule.capMilli) : Number.POSITIVE_INFINITY;
}

/** For a screen: what the allowance is called when there is no number to say. */
export function allowanceLabel(allowanceMilli: number, unit: string): string {
  return Number.isFinite(allowanceMilli) ? formatQty(allowanceMilli, unit) : "as much as it takes";
}

/**
 * The most that may leave the shelf right now: what is on it, plus what may be
 * fetched from next door.
 */
export function sellableMilli(
  item: Pick<Item, "id"> & { oversell_milli?: number },
  onHandMilli: number,
  policy?: OversellPolicy,
): number {
  return onHandMilli + allowanceOf(item, policy);
}

export interface Borrowed {
  itemId: number;
  name: string;
  unit: string;
  /** How much is owed — always positive, however the shelf says it. */
  owedMilli: number;
  /** What may still be fetched on top of what already has been. Null: no limit. */
  roomLeftMilli: number | null;
}

/**
 * Everything currently sold past zero, and by how much.
 *
 * This is the list somebody walks next door with. Sorted by what is owed, most
 * first, because that is the order the errands get done in.
 */
export function borrowed(policy?: OversellPolicy): Borrowed[] {
  const rule = policy ?? oversellPolicy();
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
      roomLeftMilli: (() => {
        const allow = allowanceOf({ id: r.id, oversell_milli: r.oversell_milli }, rule);
        return Number.isFinite(allow) ? Math.max(0, allow + r.qty) : null;
      })(),
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
