/**
 * What the kilogrammes are standing in.
 *
 * "203 kg of Ungerol" is a true answer to the wrong question. The shop does not
 * keep 203 kg of Ungerol; it keeps seven 20 kg jerricans, ten 5 kg jerricans,
 * and whatever is left in the drum — and when the owner is deciding what to
 * fill tomorrow, or checking the yard against the book, the containers are the
 * only form of the number that can be counted by eye.
 *
 * The till has shown this since containers existed. The stock statement showed
 * the total and nothing else, on both ends of the period, which is where the
 * question is actually asked: what were we standing on at the start, what did
 * we pour, what went out, what is standing there now.
 *
 * `pack_moves` is a dated ledger exactly like `stock_movements`, so the counts
 * can be rebuilt as at any date by the same method: everything before the first
 * day is the opening, everything inside the range is the movement, and the two
 * added together are the closing. Nothing is stored.
 */

import { all } from "./db.ts";
import type { DateRange } from "./reports.ts";

export interface PackSizeMovement {
  bundleId: number;
  sizeMilli: number;
  /** "20 kg", "500 ml" — the size as the shop says it. */
  label: string;
  openingPacks: number;
  /** Poured into containers during the period. */
  filledPacks: number;
  /** Containers that went out on a sale, net of any sale put back. */
  soldPacks: number;
  /** Containers tipped back into the drum to be weighed out loose. */
  openedPacks: number;
  /** Counted or corrected by hand. Signed. */
  adjustedPacks: number;
  closingPacks: number;
}

export interface PackBreakdown {
  itemId: number;
  unit: string;
  sizes: PackSizeMovement[];
  /** What the containers held at each end, in milli. */
  openingPackedMilli: number;
  closingPackedMilli: number;
  /** The rest of the item's stock — what is still in the drum. */
  openingLooseMilli: number;
  closingLooseMilli: number;
  /** Batch numbers that filled containers of this item during the period. */
  batches: string[];
}

interface MoveRow {
  item_id: number;
  bundle_id: number;
  size_milli: number;
  unit: string;
  before: number;
  filled: number;
  sold: number;
  opened: number;
  adjusted: number;
}

/** "20 kg", "500 ml", "1.5 L" — a size in the words the shop uses for it. */
export function sizeLabel(sizeMilli: number, unit: string): string {
  if (sizeMilli < 1000 && (unit === "kg" || unit === "L")) {
    return `${sizeMilli} ${unit === "kg" ? "g" : "ml"}`;
  }
  const whole = sizeMilli / 1000;
  const shown = Number.isInteger(whole) ? String(whole) : String(Number(whole.toFixed(3)));
  return `${shown} ${unit}`;
}

/**
 * Container movement for every packed item, over one period.
 *
 * Keyed by item, so a statement can attach it to the row it belongs to without
 * a query each. Items that are not counted in containers are absent rather than
 * present-and-empty: a caller showing a breakdown wants to know there is none.
 */
export function packBreakdowns(range: DateRange): Map<number, Omit<PackBreakdown,
  "openingPackedMilli" | "closingPackedMilli" | "openingLooseMilli" | "closingLooseMilli">> {
  const inRange = `date(pm.at, '+3 hours') BETWEEN @from AND @to`;
  const before = `date(pm.at, '+3 hours') < @from`;

  const rows = all<MoveRow>(
    `SELECT pm.item_id, pm.bundle_id, b.size_milli, i.canonical_unit AS unit,
            COALESCE(SUM(CASE WHEN ${before} THEN pm.delta END), 0) AS before,
            COALESCE(SUM(CASE WHEN ${inRange} AND pm.reason = 'fill'
                              THEN pm.delta END), 0) AS filled,
            COALESCE(SUM(CASE WHEN ${inRange} AND pm.reason IN ('sale', 'sale_void')
                              THEN -pm.delta END), 0) AS sold,
            COALESCE(SUM(CASE WHEN ${inRange} AND pm.reason = 'open'
                              THEN -pm.delta END), 0) AS opened,
            COALESCE(SUM(CASE WHEN ${inRange} AND pm.reason IN ('stocktake', 'adjustment')
                              THEN pm.delta END), 0) AS adjusted
       FROM pack_moves pm
       JOIN bundles b ON b.id = pm.bundle_id
       JOIN items i   ON i.id = pm.item_id
      WHERE i.packed = 1
      GROUP BY pm.item_id, pm.bundle_id
      ORDER BY b.size_milli DESC`,
    { from: range.from, to: range.to },
  );

  /*
    Which batches poured them.

    A fill carries the batch it came out of, where it came out of one, and
    "which batch is in those jerricans" is the question asked when something is
    wrong with a drum of soap and the shop needs to know what else went out of
    the same mix.
  */
  const batchRows = all<{ item_id: number; batch_no: string }>(
    `SELECT DISTINCT pm.item_id, bt.batch_no
       FROM pack_moves pm
       JOIN batches bt ON bt.id = pm.ref_id
      WHERE pm.reason = 'fill' AND pm.ref_type = 'batch'
        AND date(pm.at, '+3 hours') BETWEEN @from AND @to
      ORDER BY bt.batch_no`,
    { from: range.from, to: range.to },
  );
  const batchesOf = new Map<number, string[]>();
  for (const r of batchRows) {
    const list = batchesOf.get(r.item_id) ?? [];
    list.push(r.batch_no);
    batchesOf.set(r.item_id, list);
  }

  const out = new Map<number, { itemId: number; unit: string; sizes: PackSizeMovement[]; batches: string[] }>();
  for (const r of rows) {
    const closing = r.before + r.filled - r.sold - r.opened + r.adjusted;
    // A size nobody has ever filled and nobody holds is noise on the screen.
    if (r.before === 0 && closing === 0 && r.filled === 0 && r.sold === 0 && r.opened === 0) {
      continue;
    }

    const entry =
      out.get(r.item_id) ??
      { itemId: r.item_id, unit: r.unit, sizes: [], batches: batchesOf.get(r.item_id) ?? [] };
    entry.sizes.push({
      bundleId: r.bundle_id,
      sizeMilli: r.size_milli,
      label: sizeLabel(r.size_milli, r.unit),
      openingPacks: r.before,
      filledPacks: r.filled,
      soldPacks: r.sold,
      openedPacks: r.opened,
      adjustedPacks: r.adjusted,
      closingPacks: closing,
    });
    out.set(r.item_id, entry);
  }
  return out;
}

/**
 * Finish a breakdown against the quantities the statement already worked out.
 *
 * The loose figure is the item's stock less what the containers hold, and it is
 * floored at nothing: a shop that sold past zero can have jerricans standing
 * against a count that never carried them, and that difference is a debt said
 * in kilogrammes elsewhere — not a negative puddle in the drum.
 */
export function withLoose(
  base: { itemId: number; unit: string; sizes: PackSizeMovement[]; batches: string[] },
  openingMilli: number,
  closingMilli: number,
): PackBreakdown {
  const openingPackedMilli = base.sizes.reduce((n, s) => n + s.openingPacks * s.sizeMilli, 0);
  const closingPackedMilli = base.sizes.reduce((n, s) => n + s.closingPacks * s.sizeMilli, 0);
  return {
    ...base,
    openingPackedMilli,
    closingPackedMilli,
    openingLooseMilli: Math.max(0, openingMilli - openingPackedMilli),
    closingLooseMilli: Math.max(0, closingMilli - closingPackedMilli),
  };
}
