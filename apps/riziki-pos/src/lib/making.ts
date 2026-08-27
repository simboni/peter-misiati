/**
 * Making one product out of another.
 *
 * Two of the things this shop sells are not bought in the form they are sold
 * in. Perfume arrives as a concentrate and is let down with water — one and a
 * half kilograms makes twenty litres. Hypochlorite arrives at twenty-four
 * kilograms of concentrate, is worked twelve at a time, and twelve makes
 * twenty-three of the diluted. Both ends are sold: a customer can buy the
 * concentrate by the eighth of a kilogram or the dilution by the five litres.
 *
 * Everything else about them is ordinary, and that is the point of keeping this
 * one operation separate. Each form is its own product with its own price, its
 * own sizes, its own place at the counter and its own right to be an ingredient
 * in a recipe. The only thing the rest of the system never has to know is how
 * the stock got from one to the other — which is all this file does.
 *
 * Two rules worth stating, because both were paid for elsewhere in this system:
 *
 *   Stock moves as a matched pair inside one transaction. The concentrate comes
 *   off and the dilution goes on together or neither happens, so the shelf can
 *   never gain twenty-three kilograms that nothing was spent on.
 *
 *   The MONEY moves with it. Twelve kilograms of concentrate at KES 300 makes
 *   twenty-three kilograms that cost KES 156.52 each, and the shop's margin on
 *   the diluted product is honest. Without this the dilution would cost nothing,
 *   report infinite profit, and quietly tell the owner his real earner was the
 *   thing he barely sells.
 *
 * Nothing here imports from `next/*`, so it runs under plain Node in tests.
 */

import { all, get, run, tx, audit, postMovement, stockOf } from "./db.ts";
import { formatQty, MILLI } from "./units.ts";

export class MakeError extends Error {}

// ------------------------------------------------------------------ the ratio

export interface Conversion {
  id: number;
  toItemId: number;
  fromItemId: number;
  /** How much of the concentrate goes in, in milli of ITS unit. */
  inMilli: number;
  /** How much comes out, in milli of the MADE product's unit. */
  outMilli: number;
}

export interface ConversionView extends Conversion {
  fromName: string;
  fromUnit: string;
  toName: string;
  toUnit: string;
  /** What is on the shelf of the thing it is made from, right now. */
  fromOnHandMilli: number;
}

function rowToConversion(r: {
  id: number;
  to_item_id: number;
  from_item_id: number;
  in_milli: number;
  out_milli: number;
}): Conversion {
  return {
    id: r.id,
    toItemId: r.to_item_id,
    fromItemId: r.from_item_id,
    inMilli: r.in_milli,
    outMilli: r.out_milli,
  };
}

/** What this product is made from, if anything. */
export function conversionFor(toItemId: number): Conversion | undefined {
  const row = get<{
    id: number;
    to_item_id: number;
    from_item_id: number;
    in_milli: number;
    out_milli: number;
  }>(
    `SELECT id, to_item_id, from_item_id, in_milli, out_milli
       FROM conversions WHERE to_item_id = ? AND active = 1`,
    toItemId,
  );
  return row ? rowToConversion(row) : undefined;
}

/** Everything the shop makes, with both names and what is on the shelf to make it from. */
export function madeProducts(): ConversionView[] {
  return all<{
    id: number;
    to_item_id: number;
    from_item_id: number;
    in_milli: number;
    out_milli: number;
    from_name: string;
    from_unit: string;
    to_name: string;
    to_unit: string;
  }>(
    `SELECT c.id, c.to_item_id, c.from_item_id, c.in_milli, c.out_milli,
            f.name AS from_name, f.canonical_unit AS from_unit,
            t.name AS to_name,   t.canonical_unit AS to_unit
       FROM conversions c
       JOIN items f ON f.id = c.from_item_id
       JOIN items t ON t.id = c.to_item_id
      WHERE c.active = 1 AND t.active = 1 AND f.active = 1
      ORDER BY t.name COLLATE NOCASE`,
  ).map((r) => ({
    ...rowToConversion(r),
    fromName: r.from_name,
    fromUnit: r.from_unit,
    toName: r.to_name,
    toUnit: r.to_unit,
    fromOnHandMilli: stockOf(r.from_item_id),
  }));
}

export interface ConversionInput {
  toItemId: number;
  /** Zero or absent clears it — this product is bought, not made. */
  fromItemId: number | null;
  /** In the units the owner typed, not milli. */
  inQty: number;
  outQty: number;
}

/**
 * Say what a product is made from, or stop saying it.
 *
 * Switched off rather than deleted, the same way a retired bundle is: a batch
 * made last month points at nothing here, but the shop's own habit of turning
 * a thing on and off again should not accumulate rows.
 */
export function saveConversion(input: ConversionInput): void {
  const to = get<{ id: number; name: string; canonical_unit: string }>(
    `SELECT id, name, canonical_unit FROM items WHERE id = ?`,
    input.toItemId,
  );
  if (!to) throw new MakeError("That product no longer exists.");

  if (!input.fromItemId) {
    run(`UPDATE conversions SET active = 0 WHERE to_item_id = ?`, input.toItemId);
    return;
  }
  if (input.fromItemId === input.toItemId) {
    throw new MakeError("A product cannot be made out of itself.");
  }

  const from = get<{ id: number; name: string; canonical_unit: string }>(
    `SELECT id, name, canonical_unit FROM items WHERE id = ?`,
    input.fromItemId,
  );
  if (!from) throw new MakeError("The thing it is made from is not on the list.");

  const inMilli = Math.round((Number(input.inQty) || 0) * MILLI);
  const outMilli = Math.round((Number(input.outQty) || 0) * MILLI);
  if (inMilli <= 0 || outMilli <= 0) {
    throw new MakeError("Say how much goes in and how much comes out — both above zero.");
  }

  /*
    A chain, not a cycle.

    Making A out of B out of A is not a thing a shop can do, and left unchecked
    it is a batch screen that offers to make a product out of itself through one
    more step. Walked rather than checked one deep, because the shop may well
    grow a three-step chain and the second link is the one nobody would notice.
  */
  const seen = new Set<number>([input.toItemId]);
  let cursor: number | null = input.fromItemId;
  while (cursor !== null) {
    if (seen.has(cursor)) {
      throw new MakeError(
        `That would make ${to.name} out of itself, round through ${from.name}.`,
      );
    }
    seen.add(cursor);
    cursor = conversionFor(cursor)?.fromItemId ?? null;
  }

  tx(() => {
    run(`UPDATE conversions SET active = 0 WHERE to_item_id = ?`, input.toItemId);
    const existing = get<{ id: number }>(
      `SELECT id FROM conversions WHERE to_item_id = ? AND from_item_id = ?`,
      input.toItemId,
      input.fromItemId,
    );
    if (existing) {
      run(
        `UPDATE conversions SET in_milli = ?, out_milli = ?, active = 1 WHERE id = ?`,
        inMilli,
        outMilli,
        existing.id,
      );
    } else {
      run(
        `INSERT INTO conversions (to_item_id, from_item_id, in_milli, out_milli, active)
         VALUES (?, ?, ?, ?, 1)`,
        input.toItemId,
        input.fromItemId,
        inMilli,
        outMilli,
      );
    }
  });
}

// ------------------------------------------------------------- making a batch

export interface MakeInput {
  toItemId: number;
  /** What actually went in, in the concentrate's own unit. */
  inQty: number;
  /** What actually came out, in the made product's own unit. */
  outQty: number;
  byUserId: number;
}

export interface MakeResult {
  repackId: number;
  inMilli: number;
  outMilli: number;
  /** Cost of one unit of the made product afterwards, in cents. */
  newCostCents: number;
  /** Both ends, so the screen can say what happened without asking again. */
  fromName: string;
  fromUnit: string;
  toName: string;
  toUnit: string;
}

/**
 * Make a batch: take the concentrate off the shelf, put the dilution on.
 *
 * Both quantities are typed rather than derived from the ratio, because the
 * ratio is what the shop aims at and not what the jug gave it. A litre of
 * perfume concentrate is treated as a kilogram and is not exactly one; twenty
 * three kilograms of hypochlorite is twenty three by eye. The stored ratio
 * fills the boxes in, and what is typed over it is what the ledger believes.
 * The difference is nobody's to reconcile until the next stock take, which is
 * the screen that exists for exactly that.
 */
export function recordMake(input: MakeInput): MakeResult {
  const conv = conversionFor(input.toItemId);
  if (!conv) throw new MakeError("That product is not made out of anything.");

  const from = get<{ id: number; name: string; canonical_unit: string; cost_cents: number }>(
    `SELECT id, name, canonical_unit, cost_cents FROM items WHERE id = ?`,
    conv.fromItemId,
  );
  const to = get<{ id: number; name: string; canonical_unit: string; cost_cents: number }>(
    `SELECT id, name, canonical_unit, cost_cents FROM items WHERE id = ?`,
    input.toItemId,
  );
  if (!from || !to) throw new MakeError("One end of that no longer exists.");

  const inMilli = Math.round((Number(input.inQty) || 0) * MILLI);
  const outMilli = Math.round((Number(input.outQty) || 0) * MILLI);
  if (inMilli <= 0) throw new MakeError("Say how much went in.");
  if (outMilli <= 0) throw new MakeError("Say how much came out.");

  const onHand = stockOf(conv.fromItemId);
  if (inMilli > onHand) {
    throw new MakeError(
      `There is only ${formatQty(Math.max(0, onHand), from.canonical_unit)} of ${from.name} left. ` +
        `Record the delivery first, or make a smaller batch.`,
    );
  }

  /*
    The money that goes with it.

    What the concentrate consumed was worth, spread over what came out. The
    made product's own average moves the way a delivery moves it — what is
    already on its shelf keeps the cost it had, and this batch arrives at the
    cost of the concentrate it ate.
  */
  const consumedCents = Math.round((inMilli * from.cost_cents) / MILLI);
  const alreadyMilli = Math.max(0, stockOf(input.toItemId));
  const alreadyCents = Math.round((alreadyMilli * to.cost_cents) / MILLI);
  const totalMilli = alreadyMilli + outMilli;
  const newCostCents =
    totalMilli > 0
      ? Math.round(((alreadyCents + consumedCents) * MILLI) / totalMilli)
      : to.cost_cents;

  return tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO repacks (from_item_id, in_milli, out_milli, loss_milli, user_id)
       VALUES (?, ?, ?, 0, ?)`,
      conv.fromItemId,
      inMilli,
      outMilli,
      input.byUserId,
    );
    const repackId = Number(lastInsertRowid);

    // `units` is 1 because a batch of a weighed product is one pouring, not a
    // count of packets. The quantity that matters is the milli beside it.
    run(
      `INSERT INTO repack_lines (repack_id, item_id, units, qty_milli) VALUES (?, ?, 1, ?)`,
      repackId,
      input.toItemId,
      outMilli,
    );

    postMovement({
      itemId: conv.fromItemId,
      deltaMilli: -inMilli,
      reason: "repack_out",
      refType: "repack",
      refId: repackId,
      userId: input.byUserId,
      note: `made ${formatQty(outMilli, to.canonical_unit)} of ${to.name}`,
    });
    postMovement({
      itemId: input.toItemId,
      deltaMilli: outMilli,
      reason: "repack_in",
      refType: "repack",
      refId: repackId,
      userId: input.byUserId,
      note: `from ${formatQty(inMilli, from.canonical_unit)} of ${from.name}`,
    });

    run(`UPDATE items SET cost_cents = ? WHERE id = ?`, newCostCents, input.toItemId);

    audit(
      input.byUserId,
      "made",
      "item",
      input.toItemId,
      `${formatQty(inMilli, from.canonical_unit)} ${from.name} → ` +
        `${formatQty(outMilli, to.canonical_unit)} ${to.name}`,
    );

    return {
      repackId,
      inMilli,
      outMilli,
      newCostCents,
      fromName: from.name,
      fromUnit: from.canonical_unit,
      toName: to.name,
      toUnit: to.canonical_unit,
    };
  });
}

export interface MadeBatchRow {
  id: number;
  at: string;
  from_name: string;
  from_unit: string;
  in_milli: number;
  to_name: string;
  to_unit: string;
  out_milli: number;
  user_name: string | null;
}

/** What has been made, newest first. */
export function recentMakes(limit = 30): MadeBatchRow[] {
  return all<MadeBatchRow>(
    `SELECT r.id, r.at, r.in_milli, r.out_milli,
            f.name AS from_name, f.canonical_unit AS from_unit,
            t.name AS to_name,   t.canonical_unit AS to_unit,
            u.name AS user_name
       FROM repacks r
       JOIN items f       ON f.id = r.from_item_id
       JOIN repack_lines l ON l.repack_id = r.id
       JOIN items t       ON t.id = l.item_id
       LEFT JOIN users u  ON u.id = r.user_id
      WHERE r.status = 'completed'
      ORDER BY r.at DESC, r.id DESC
      LIMIT ?`,
    limit,
  );
}
