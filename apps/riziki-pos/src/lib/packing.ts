/**
 * Packing — how much of what the shop holds is already in containers.
 *
 * The shop mixes 46 kg of mild and then pours it: two 23 kg jerricans, or one
 * 23 and four 5s and three 1s. The counter sells jerricans, not weight, and the
 * attendant needs to know how many are standing there.
 *
 * THE ONE IDEA. This is not stock. The item holds exactly one quantity — 46 kg
 * — and everything in this file is a BREAKDOWN of it:
 *
 *     46 kg held
 *       1 × 23 kg filled  = 23 kg
 *       4 ×  5 kg filled  = 20 kg
 *                loose    =  3 kg
 *
 * Filling a jerrican moves no stock. It is the same 46 kg, in a different
 * shape. Opening one moves no stock either. Only a sale, a delivery or a
 * stock take changes the 46.
 *
 * That is the whole difference from the pack rows this shop tried and retired.
 * Those were separate items each holding their own stock, so the drum and its
 * packs were two numbers that had to be carried across by hand and could
 * disagree. These cannot disagree with anything, because what is packed is a
 * subset of what is held, checked on the way in:
 *
 *     Σ(filled × size)  ≤  stock
 *
 * WHY IT IS OPT-IN. `items.packed` is off for everything until the owner turns
 * it on. Ungerol is sold by the 5, 10 and 20 kg and none of those is ever
 * pre-filled — it is weighed out of the drum with the customer waiting. A
 * counter that asked "how many 20 kg jerricans are filled?" would refuse a sale
 * the shop makes every day. So the tally is kept, and enforced, only for the
 * things the owner says are actually poured in advance.
 *
 * Nothing here imports from `next/*`, so it can be unit-tested under Node.
 */

import { all, get, run, tx, audit, stockOf, type Item } from "./db.ts";
import { itemBundles, type Bundle } from "./bundles.ts";
import { formatQty } from "./units.ts";

export class PackError extends Error {}

export interface FilledSize {
  bundleId: number;
  sizeMilli: number;
  priceCents: number;
  /** How many of this size are standing filled. Never negative. */
  filled: number;
  /** What those containers hold between them. */
  heldMilli: number;
}

export interface PackState {
  itemId: number;
  itemName: string;
  unit: string;
  /** Whether this item is counted in containers at all. */
  packed: boolean;
  /** The one quantity the shop holds. Everything below is a share of it. */
  stockMilli: number;
  sizes: FilledSize[];
  /** What all the filled containers hold. */
  packedMilli: number;
  /** What is left in the drum, unpoured. Can never be negative if fills are checked. */
  looseMilli: number;
}

/** How many of each size are filled, keyed by bundle. */
export function filledCounts(itemId: number): Map<number, number> {
  const rows = all<{ bundle_id: number; filled: number }>(
    `SELECT bundle_id, SUM(delta) AS filled FROM pack_moves
      WHERE item_id = ? GROUP BY bundle_id`,
    itemId,
  );
  const out = new Map<number, number>();
  for (const r of rows) out.set(r.bundle_id, r.filled ?? 0);
  return out;
}

/**
 * The whole picture for one item: what is held, what is poured, what is loose.
 *
 * Returned even for an item that is not packed — with every count at zero and
 * the loose quantity equal to the stock — so a caller never has to branch on
 * the flag just to read a figure.
 */
export function packState(itemId: number): PackState {
  const item = get<Item & { packed: number }>(`SELECT * FROM items WHERE id = ?`, itemId);
  if (!item) throw new PackError("That product is not on the catalogue.");

  const stockMilli = Math.max(0, stockOf(itemId));
  const counts = item.packed ? filledCounts(itemId) : new Map<number, number>();

  const sizes: FilledSize[] = itemBundles(itemId).map((b: Bundle) => {
    const filled = Math.max(0, counts.get(b.id) ?? 0);
    return {
      bundleId: b.id,
      sizeMilli: b.sizeMilli,
      priceCents: b.priceCents,
      filled,
      heldMilli: filled * b.sizeMilli,
    };
  });

  const packedMilli = sizes.reduce((n, s) => n + s.heldMilli, 0);
  return {
    itemId,
    itemName: item.name,
    unit: item.canonical_unit,
    packed: item.packed === 1,
    stockMilli,
    sizes,
    packedMilli,
    looseMilli: stockMilli - packedMilli,
  };
}

/** What is in the drum rather than in a container. */
export function looseMilli(itemId: number): number {
  return packState(itemId).looseMilli;
}

/**
 * Say whether a thing is poured into containers in advance.
 *
 * Turning it OFF leaves the tally where it is rather than clearing it: the
 * owner who switches a product off for a week and back on again should find the
 * jerricans still counted, and a cleared tally would be a silent loss of a
 * count somebody took by hand.
 */
export function setPacked(itemId: number, packed: boolean, userId: number): void {
  const item = get<Item>(`SELECT * FROM items WHERE id = ?`, itemId);
  if (!item) throw new PackError("That product is not on the catalogue.");
  if (packed && !itemBundles(itemId).length) {
    throw new PackError(
      `${item.name} has no container sizes yet. Add the sizes it is filled into ` +
        `— under Products & prices — before counting them.`,
    );
  }
  run(`UPDATE items SET packed = ? WHERE id = ?`, packed ? 1 : 0, itemId);
  audit(userId, packed ? "item_packed_on" : "item_packed_off", "item", itemId, item.name);
}

export interface FillLine {
  bundleId: number;
  /** Containers filled (positive) or opened back into the drum (negative). */
  delta: number;
}

export interface FillResult {
  itemName: string;
  unit: string;
  /** What each size went from and to. */
  moved: Array<{ sizeMilli: number; delta: number; nowFilled: number }>;
  looseMilli: number;
}

/**
 * Pour some of the drum into containers, or open containers back into it.
 *
 * Both directions in one call because they are one errand: filling four 5 kg
 * jerricans out of a 23 kg one is a negative and a positive, and doing it as
 * two saves would leave the shelf briefly holding neither.
 *
 * NO STOCK MOVES HERE. The kilogrammes were already on the shelf and they are
 * on it afterwards. What changes is only their shape, which is why this cannot
 * put the ledger wrong however wrong the numbers typed into it are — the worst
 * it can do is claim a jerrican is filled when it is not, and that is a
 * miscount the stock take already exists to answer.
 */
export function fill(itemId: number, lines: FillLine[], userId: number, note?: string): FillResult {
  const wanted = lines.filter((l) => l.delta !== 0);
  if (!wanted.length) throw new PackError("Nothing to fill or open.");

  return tx(() => {
    const before = packState(itemId);
    if (!before.packed) {
      throw new PackError(`${before.itemName} is not counted in containers.`);
    }

    const bySize = new Map(before.sizes.map((s) => [s.bundleId, s]));
    let looseAfter = before.looseMilli;
    const moved: FillResult["moved"] = [];

    for (const line of wanted) {
      const size = bySize.get(line.bundleId);
      if (!size) throw new PackError("That size is no longer on this product.");

      const nowFilled = size.filled + line.delta;
      if (nowFilled < 0) {
        throw new PackError(
          `There are only ${size.filled} × ${formatQty(size.sizeMilli, before.unit)} filled — ` +
            `you cannot open ${Math.abs(line.delta)}.`,
        );
      }
      // Filling takes from the drum; opening gives back to it.
      looseAfter -= line.delta * size.sizeMilli;
      moved.push({ sizeMilli: size.sizeMilli, delta: line.delta, nowFilled });
    }

    /*
      The invariant, checked once at the end rather than per line.

      Per line it would refuse the ordinary errand: opening one 23 kg to fill
      four 5s is momentarily over the drum if the fills are read before the
      opening, and which order the owner typed them in is not something the
      shelf should have an opinion about.
    */
    if (looseAfter < 0) {
      const wouldHold = before.stockMilli - looseAfter;
      throw new PackError(
        `That is more than there is. ${before.itemName} holds ` +
          `${formatQty(before.stockMilli, before.unit)}, and this would put ` +
          `${formatQty(wouldHold, before.unit)} into containers. ` +
          `Open a bigger one first, or record what arrived.`,
      );
    }

    for (const line of wanted) {
      run(
        `INSERT INTO pack_moves (item_id, bundle_id, delta, reason, user_id, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        itemId,
        line.bundleId,
        line.delta,
        line.delta > 0 ? "fill" : "open",
        userId,
        note ?? null,
      );
    }

    audit(
      userId,
      "item_filled",
      "item",
      itemId,
      moved
        .map((m) => `${m.delta > 0 ? "+" : ""}${m.delta} × ${formatQty(m.sizeMilli, before.unit)}`)
        .join(", "),
    );

    return { itemName: before.itemName, unit: before.unit, moved, looseMilli: looseAfter };
  });
}

/**
 * Take containers off the shelf because they were sold.
 *
 * Called from inside the sale's own transaction, after the stock has been
 * checked — the kilogrammes and the containers must move together or not at
 * all, or a crash between them would leave a jerrican that is sold and still
 * counted.
 */
/**
 * How many of this size are filled, for the counter to check before it sells.
 *
 * Zero for a product that is not counted in containers, which callers must read
 * together with the flag — a weighed-out chemical has no filled jerricans and
 * that is not a shortage.
 */
export function filledOf(itemId: number, bundleId: number): number {
  const row = get<{ filled: number }>(
    `SELECT SUM(delta) AS filled FROM pack_moves WHERE item_id = ? AND bundle_id = ?`,
    itemId,
    bundleId,
  );
  return Math.max(0, row?.filled ?? 0);
}

/**
 * Pour some loose out of the containers, because a sale needed it.
 *
 * A shelf whose every kilogramme is already in jerricans can still sell 2 kg
 * loose — the attendant opens a jerrican and pours it, which is a thing that
 * physically happens with a customer standing there. Refusing the sale to
 * protect a tally would be the tally telling the shop how to trade.
 *
 * Smallest first, because that is what anybody would reach for: the 1 kg
 * bottles go before a 23 kg jerrican is broken into.
 */
export function openForLoose(
  itemId: number,
  neededMilli: number,
  userId: number,
  saleId: number,
): Array<{ sizeMilli: number; opened: number }> {
  const state = packState(itemId);
  let short = neededMilli - state.looseMilli;
  if (short <= 0) return [];

  const opened: Array<{ sizeMilli: number; opened: number }> = [];
  for (const size of [...state.sizes].sort((a, b) => a.sizeMilli - b.sizeMilli)) {
    if (short <= 0) break;
    if (size.filled <= 0) continue;
    const n = Math.min(size.filled, Math.ceil(short / size.sizeMilli));
    run(
      `INSERT INTO pack_moves (item_id, bundle_id, delta, reason, ref_type, ref_id, user_id, note)
       VALUES (?, ?, ?, 'open', 'sale', ?, ?, 'opened to pour a loose sale')`,
      itemId,
      size.bundleId,
      -n,
      saleId,
      userId,
    );
    opened.push({ sizeMilli: size.sizeMilli, opened: n });
    short -= n * size.sizeMilli;
  }
  return opened;
}

export function takeFilled(
  itemId: number,
  bundleId: number,
  units: number,
  userId: number,
  saleId: number,
): void {
  run(
    `INSERT INTO pack_moves (item_id, bundle_id, delta, reason, ref_type, ref_id, user_id)
     VALUES (?, ?, ?, 'sale', 'sale', ?, ?)`,
    itemId,
    bundleId,
    -units,
    saleId,
    userId,
  );
}
