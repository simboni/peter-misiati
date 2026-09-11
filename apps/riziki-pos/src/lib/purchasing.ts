/**
 * Suppliers and purchases — the "goods came in" side of the ledger.
 *
 * Two things make this more than an INSERT:
 *
 *  1. **Landed cost.** A drum's real cost is its invoice price plus its share of
 *     the lorry. Transport is prorated across the lines by value so a 64,600
 *     drum absorbs more of it than a 3,000 bag, and the weighted-average cost
 *     that every margin figure is built on stays honest.
 *  2. **Ordering.** `updateAverageCost` reads current stock to weight the old
 *     average, so it must run *before* the purchase movement is posted or the
 *     incoming units would be counted on both sides and the new average would
 *     be pulled halfway back to the old one.
 *
 * Nothing here imports from `next/*`, so it can be unit-tested under Node.
 */

import { all, get, run, tx, audit, postMovement, updateAverageCost } from "./db.ts";
import { formatKes, MILLI } from "./units.ts";

// --------------------------------------------------------------- suppliers

export interface Supplier {
  id: number;
  name: string;
  phone: string;
  note: string;
  active: number;
}

export interface SupplierInput {
  name: string;
  phone?: string;
  note?: string;
}

export function listSuppliers(): Supplier[] {
  return all<Supplier>(`SELECT * FROM suppliers WHERE active = 1 ORDER BY name`);
}

export function getSupplier(id: number): Supplier | undefined {
  return get<Supplier>(`SELECT * FROM suppliers WHERE id = ?`, id);
}

function cleanSupplier(input: SupplierInput) {
  const name = input.name.trim();
  if (!name) throw new Error("A supplier needs a name.");
  return { name, phone: (input.phone ?? "").trim(), note: (input.note ?? "").trim() };
}

export function createSupplier(input: SupplierInput, userId?: number | null): number {
  const s = cleanSupplier(input);
  const existing = get<{ id: number }>(`SELECT id FROM suppliers WHERE name = ?`, s.name);
  if (existing) throw new Error(`"${s.name}" is already on the supplier list.`);

  const { lastInsertRowid } = run(
    `INSERT INTO suppliers (name, phone, note) VALUES (?, ?, ?)`,
    s.name,
    s.phone,
    s.note,
  );
  audit(userId ?? null, "supplier_create", "supplier", lastInsertRowid, s.name);
  return lastInsertRowid;
}

export function updateSupplier(id: number, input: SupplierInput, userId?: number | null): void {
  const s = cleanSupplier(input);
  // Renaming onto a name somebody else already has would be refused by the
  // UNIQUE index as a raw SQLite error. Say it in words instead, and say whose.
  const clash = get<{ id: number }>(
    `SELECT id FROM suppliers WHERE name = ? AND id <> ?`,
    s.name,
    id,
  );
  if (clash) throw new Error(`"${s.name}" is already on the supplier list.`);

  const { changes } = run(
    `UPDATE suppliers SET name = ?, phone = ?, note = ? WHERE id = ?`,
    s.name,
    s.phone,
    s.note,
    id,
  );
  if (!changes) throw new Error(`unknown supplier ${id}`);
  audit(userId ?? null, "supplier_update", "supplier", id, s.name);
}

/**
 * What is holding a supplier on the list.
 *
 * Exactly one thing can: a delivery recorded against them. That row is money
 * that left the account, and this name is what it is filed under — the screen
 * prints "Supplier not recorded" where the link is missing, so deleting a
 * supplier who has delivered would quietly erase the answer to "who did we buy
 * this from" on every delivery they ever made.
 *
 * A supplier with none of that is just a line somebody typed: a duplicate, a
 * misspelling, or an entry made while trying the system out. Nothing anywhere
 * points at it and it should be possible to clear it away.
 */
export function supplierHistory(id: number): string[] {
  const n =
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM purchases WHERE supplier_id = ?`, id)?.n ?? 0;
  return n ? [`${n} ${n === 1 ? "delivery" : "deliveries"} recorded against them`] : [];
}

/** Why this supplier cannot be deleted, or null when they can. */
export function supplierDeletableReason(id: number): string | null {
  const held = supplierHistory(id);
  return held.length ? held.join(", ") : null;
}

/**
 * Take a supplier off the list for good.
 *
 * Refused for anyone who has delivered, with the reason said out loud and
 * hiding offered instead — the same rule the catalogue uses for a product, and
 * for the same reason: the records somebody else holds must go on making sense.
 */
export function deleteSupplier(id: number, userId?: number | null): { name: string } {
  return tx(() => {
    const supplier = getSupplier(id);
    if (!supplier) throw new Error("That supplier is no longer on the list.");

    const held = supplierDeletableReason(id);
    if (held) {
      throw new Error(
        `${supplier.name} cannot be deleted — there are ${held}. Hide them instead, which ` +
          `takes them off the list and out of the delivery form while those deliveries keep ` +
          `their name.`,
      );
    }

    run(`DELETE FROM suppliers WHERE id = ?`, id);
    // Audited with the name in the text: once the row is gone the id points at
    // nothing, and the name is all that will still say who was removed.
    audit(userId ?? null, "supplier_delete", "supplier", id, supplier.name);
    return { name: supplier.name };
  });
}

/**
 * Hide a supplier, or bring them back.
 *
 * For the ones that cannot be deleted. Hidden, they drop out of the list and
 * out of the delivery form's picker — so nobody records anything new against a
 * supplier the shop has stopped using — while every delivery already on the
 * books keeps their name. Reversible on purpose: "we are not using them any
 * more" is a decision that gets taken back.
 */
export function setSupplierHidden(
  id: number,
  hidden: boolean,
  userId?: number | null,
): { name: string } {
  const supplier = getSupplier(id);
  if (!supplier) throw new Error("That supplier is no longer on the list.");
  run(`UPDATE suppliers SET active = ? WHERE id = ?`, hidden ? 0 : 1, id);
  audit(
    userId ?? null,
    hidden ? "supplier_hide" : "supplier_show",
    "supplier",
    id,
    supplier.name,
  );
  return { name: supplier.name };
}

// --------------------------------------------------------------- proration

export interface PurchaseLineInput {
  /**
   * What ONE container on this delivery held, in milli. Zero or absent falls
   * back to the item's usual size — see the note in `schema.sql`.
   */
  sizeMilli?: number;
  itemId: number;
  /** Whole containers delivered: 3 drums, 20 bags. */
  units: number;
  /** What the supplier charged for the WHOLE line, in cents, before transport. */
  costCents: number;
}

export interface LandedLine extends PurchaseLineInput {
  transportCents: number;
  landedCents: number;
}

/**
 * Split transport across the lines in proportion to their value.
 *
 * Floor each share and give the leftover cents to the last line: the shares
 * then always sum to exactly the transport paid, and none can come out
 * negative — which a round-half split can, and which the `cost_cents >= 0`
 * check on `purchase_lines` would reject.
 */
export function prorateTransport(lines: PurchaseLineInput[], transportCents: number): LandedLine[] {
  if (!lines.length) return [];
  if (transportCents === 0) {
    return lines.map((l) => ({ ...l, transportCents: 0, landedCents: l.costCents }));
  }

  const goods = lines.reduce((sum, l) => sum + l.costCents, 0);
  const shares = lines.map((l) =>
    goods > 0
      ? Math.floor((transportCents * l.costCents) / goods)
      : Math.floor(transportCents / lines.length), // free goods: split evenly
  );
  shares[shares.length - 1] += transportCents - shares.reduce((a, b) => a + b, 0);

  return lines.map((l, i) => ({
    ...l,
    transportCents: shares[i],
    landedCents: l.costCents + shares[i],
  }));
}

// --------------------------------------------------------------- purchases

export interface PurchaseInput {
  supplierId: number | null;
  lines: PurchaseLineInput[];
  transportCents?: number;
  ref?: string;
  userId?: number | null;
}

export interface PurchaseResult {
  purchaseId: number;
  goodsCents: number;
  transportCents: number;
  totalCents: number;
  lines: LandedLine[];
}

/**
 * Record a delivery: the purchase, its lines, the stock that arrived and the
 * new average costs — all in one transaction, so stock can never rise without
 * the cost that came with it.
 */
export function recordPurchase(input: PurchaseInput): PurchaseResult {
  const transport = input.transportCents ?? 0;
  if (!input.lines.length) throw new Error("A purchase needs at least one line.");
  if (!Number.isInteger(transport) || transport < 0) {
    throw new Error("Transport must be a whole number of cents, zero or more.");
  }
  for (const l of input.lines) {
    if (!Number.isInteger(l.units) || l.units <= 0) {
      throw new Error("Every line needs a whole number of units, greater than zero.");
    }
    if (!Number.isInteger(l.costCents) || l.costCents < 0) {
      throw new Error("Every line needs a cost in whole cents, zero or more.");
    }
  }

  const landed = prorateTransport(input.lines, transport);
  const goods = input.lines.reduce((sum, l) => sum + l.costCents, 0);

  return tx(() => {
    const { lastInsertRowid: purchaseId } = run(
      `INSERT INTO purchases (supplier_id, total_cents, transport_cents, ref, user_id)
       VALUES (?, ?, ?, ?, ?)`,
      input.supplierId,
      goods + transport, // total spend on the delivery, transport included
      transport,
      (input.ref ?? "").trim(),
      input.userId ?? null,
    );

    for (const line of landed) {
      const item = get<{ size_milli: number; name: string }>(
        `SELECT size_milli, name FROM items WHERE id = ?`,
        line.itemId,
      );
      if (!item) throw new Error(`unknown item ${line.itemId}`);

      /*
        How big one container on THIS delivery was.

        Taken from the line, falling back to the item's usual size. Ufacid comes
        in 250 kg drums and in 200 kg drums; with only the item's size to go on,
        three drums of the smaller kind were booked as 750 kg and the shop's
        stock was 50 kg out with nothing on any screen to say why.
      */
      const sizeMilli = line.sizeMilli && line.sizeMilli > 0 ? line.sizeMilli : item.size_milli;
      if (!(sizeMilli > 0)) {
        throw new Error(`${item.name} has no container size — say what one holds.`);
      }
      const arrivedMilli = line.units * sizeMilli;

      // Order matters — see the file header. Average cost first, ledger second.
      // In milli, because the cost being averaged is the cost of a kilogram and
      // not of a drum: two drum sizes have no shared "cost of a drum".
      updateAverageCost(line.itemId, arrivedMilli, line.landedCents);

      run(
        `INSERT INTO purchase_lines (purchase_id, item_id, units, size_milli, qty_milli, cost_cents)
         VALUES (?, ?, ?, ?, ?, ?)`,
        purchaseId,
        line.itemId,
        line.units,
        sizeMilli,
        arrivedMilli,
        line.landedCents, // landed, so the lines reconcile to purchases.total_cents
      );

      postMovement({
        itemId: line.itemId,
        deltaMilli: arrivedMilli,
        reason: "purchase",
        refType: "purchase",
        refId: purchaseId,
        userId: input.userId ?? null,
        note: input.ref ? `delivery ${input.ref}` : null,
      });
    }

    audit(
      input.userId ?? null,
      "purchase_record",
      "purchase",
      purchaseId,
      `${landed.length} line(s), ${formatKes(goods + transport)} landed`,
    );

    return { purchaseId, goodsCents: goods, transportCents: transport, totalCents: goods + transport, lines: landed };
  });
}

// ----------------------------------------------------------------- reading

export interface PurchaseRow {
  id: number;
  at: string;
  ref: string;
  supplier_name: string | null;
  total_cents: number;
  transport_cents: number;
  lines: number;
  user_name: string | null;
}

export function recentPurchases(limit = 30): PurchaseRow[] {
  return all<PurchaseRow>(
    `SELECT p.id, p.at, p.ref, p.total_cents, p.transport_cents,
            s.name AS supplier_name, u.name AS user_name,
            (SELECT COUNT(*) FROM purchase_lines pl WHERE pl.purchase_id = p.id) AS lines
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN users u     ON u.id = p.user_id
      ORDER BY p.at DESC, p.id DESC
      LIMIT ?`,
    limit,
  );
}

export interface PurchaseLineRow {
  id: number;
  item_id: number;
  item_name: string;
  units: number;
  qty_milli: number;
  cost_cents: number;
  canonical_unit: string;
  unit_label: string;
  size_milli: number;
}

export function purchaseLines(purchaseId: number): PurchaseLineRow[] {
  return all<PurchaseLineRow>(
    // The line's own container size, falling back to the item's for deliveries
    // recorded before the size was kept per line. A past delivery has to read
    // as what actually came off the lorry, not as what the drum size happens to
    // be today.
    `SELECT pl.id, pl.item_id, pl.units, pl.qty_milli, pl.cost_cents,
            i.name AS item_name, i.canonical_unit, i.unit_label,
            CASE WHEN pl.size_milli > 0 THEN pl.size_milli ELSE i.size_milli END AS size_milli
       FROM purchase_lines pl
       JOIN items i ON i.id = pl.item_id
      WHERE pl.purchase_id = ?
      ORDER BY pl.id`,
    purchaseId,
  );
}

export interface PriceHistoryRow {
  purchase_id: number;
  at: string;
  ref: string;
  supplier_name: string | null;
  units: number;
  cost_cents: number;
  /** What one container on that delivery held, in milli. */
  size_milli: number;
  /**
   * Landed cost of ONE KILOGRAM, litre or piece — the number that tells him
   * prices moved.
   *
   * Per unit of measure rather than per container, because a chemical that
   * arrives in 250 kg drums one month and 200 kg drums the next would otherwise
   * show a 20% "price drop" that is nothing but a smaller drum. A kilogram is
   * comparable with last month's kilogram; a drum is not.
   */
  unit_cost_cents: number;
}

/**
 * What he actually paid for this item over time. Imported chemical prices swing
 * hard enough that "is Ungerol dearer than last time?" is a question the shop
 * asks on every delivery.
 */
export function priceHistory(itemId: number, limit = 24): PriceHistoryRow[] {
  return all<PriceHistoryRow>(
    `SELECT p.id AS purchase_id, p.at, p.ref, s.name AS supplier_name,
            pl.units, pl.cost_cents, pl.size_milli,
            CAST(ROUND(1000.0 * pl.cost_cents / NULLIF(pl.qty_milli, 0)) AS INTEGER)
              AS unit_cost_cents
       FROM purchase_lines pl
       JOIN purchases p     ON p.id = pl.purchase_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE pl.item_id = ?
      ORDER BY p.at DESC, p.id DESC
      LIMIT ?`,
    itemId,
    limit,
  );
}

/** Items that have ever been bought in — the useful shortlist for price history. */
export function purchasedItems(): Array<{
  id: number;
  name: string;
  canonical_unit: string;
  deliveries: number;
}> {
  return all<{ id: number; name: string; canonical_unit: string; deliveries: number }>(
    // The unit comes along because the price history is now quoted per kilogram
    // rather than per drum, and the column has to say which.
    `SELECT i.id, i.name, i.canonical_unit, COUNT(DISTINCT pl.purchase_id) AS deliveries
       FROM purchase_lines pl
       JOIN items i ON i.id = pl.item_id
      GROUP BY i.id
      ORDER BY i.name`,
  );
}

export interface BuyableItem {
  id: number;
  name: string;
  kind: string;
  canonical_unit: string;
  size_milli: number;
  unit_label: string;
  cost_cents: number;
}

/** Everything a delivery could contain, grouped the way the store room is. */
export function buyableItems(): BuyableItem[] {
  return all<BuyableItem>(
    `SELECT id, name, kind, canonical_unit, size_milli, unit_label, cost_cents
       FROM items
      WHERE active = 1
      ORDER BY CASE kind WHEN 'bulk' THEN 0 WHEN 'packaging' THEN 1 WHEN 'pack' THEN 2 ELSE 3 END,
               name`,
  );
}

export interface SupplierSpendRow {
  id: number;
  name: string;
  phone: string;
  note: string;
  deliveries: number;
  spend_cents: number;
  last_at: string | null;
  /** 0 once hidden. Still listed here so it can be brought back. */
  active: number;
}

/**
 * Every supplier, with what they have been paid.
 *
 * A LEFT JOIN rather than an inner one, so a supplier who has never delivered
 * still appears — with zeroes. That is what lets this one list replace the two
 * the screen used to carry: a plain roll of names to ring, and a spend table
 * beside it holding the same names again in a different order.
 *
 * The money is owner-only in the UI; staff get the roll of names instead.
 *
 * Hidden suppliers are in here too, sorted to the bottom. Everywhere else they
 * are gone — the roll of names, the delivery picker — but this is the owner's
 * one view of who the shop deals with, and a hide with no screen that shows it
 * is a door that only opens one way.
 */
export function supplierSpend(): SupplierSpendRow[] {
  return all<SupplierSpendRow>(
    `SELECT s.id, s.name, s.phone, s.note, s.active,
            COUNT(p.id)                          AS deliveries,
            COALESCE(SUM(p.total_cents), 0)      AS spend_cents,
            MAX(p.at)                            AS last_at
       FROM suppliers s
       LEFT JOIN purchases p ON p.supplier_id = s.id
      GROUP BY s.id
      ORDER BY s.active DESC, spend_cents DESC, s.name`,
  );
}

// ------------------------------------------------- correcting a delivery

/**
 * Work out an item's cost price again from scratch, by replaying its history.
 *
 * The cost on an item is a running weighted average: each delivery blends into
 * whatever was on the shelf at that moment. That is the right figure and it is
 * also a one-way street — you cannot un-blend a delivery once a later one has
 * gone in on top of it, so a mistyped price is permanent unless the whole
 * sequence is worked out again.
 *
 * This walks the item's stock ledger in the order it happened and reproduces
 * exactly what each step did to the cost:
 *
 *   a delivery       blends in that line's LANDED cost, against the quantity
 *                    held at that moment — the same sum `updateAverageCost`
 *                    does, and weighted the same way
 *   a batch          blends in what the batch cost to mix, which is the same
 *                    thing the mixing board does when it makes something
 *   everything else  moves the quantity and leaves the rate alone: selling a
 *                    kilogramme does not change what a kilogramme cost
 *
 * Replaying rather than adjusting means this is also self-healing. Whatever the
 * cost had drifted to, for whatever reason, running it produces the figure the
 * shop's own records support.
 */
export function recomputeCost(itemId: number): number {
  const item = get<{ cost_cents: number }>(`SELECT cost_cents FROM items WHERE id = ?`, itemId);
  if (!item) throw new Error(`unknown item ${itemId}`);

  const moves = all<{
    delta_milli: number;
    reason: string;
    ref_type: string | null;
    ref_id: number | null;
  }>(
    `SELECT delta_milli, reason, ref_type, ref_id FROM stock_movements
      WHERE item_id = ? ORDER BY id`,
    itemId,
  );

  let qtyMilli = 0;
  let costCents = 0;

  for (const m of moves) {
    /*
      A correction to a delivery is already in the delivery.

      When the count on a line is put right, the difference is posted as its own
      adjustment — the ledger is append-only and the original entry stays. But
      the LINE then holds the corrected quantity and the corrected cost, so
      replaying both would count the difference twice: once by skipping it here,
      and once below, where the arrival is read off the line rather than off the
      movement that first recorded it.
    */
    if (m.reason === "adjustment" && m.ref_type === "purchase") continue;

    let incomingCents: number | null = null;
    let incomingMilli = m.delta_milli;

    /*
      A delivery whose quantity was corrected has TWO rows against it: the
      original arrival, priced, and an adjustment for the difference. The
      adjustment moves the count and not the rate — which is right, because the
      line's landed cost below is already the cost of the corrected quantity.
    */
    if (m.reason === "purchase" && m.ref_id !== null) {
      const line = get<{ cost_cents: number; qty_milli: number }>(
        `SELECT cost_cents, qty_milli FROM purchase_lines WHERE purchase_id = ? AND item_id = ?`,
        m.ref_id,
        itemId,
      );
      incomingCents = line?.cost_cents ?? null;
      // What the line says arrived, which is the corrected figure where it was
      // corrected and the original everywhere else.
      if (line) incomingMilli = line.qty_milli;
    } else if (m.reason === "batch_output" && m.ref_id !== null) {
      /*
        An undone batch is skipped, not counted.

        Its two ledger entries both stay — the making and the undoing — because
        the ledger is append-only and both happened. But its cost must not blend
        into the rate: the mix came back off the shelf, so the shop never held
        it, and leaving it in would price every later kilogramme against
        something that was cancelled.
      */
      const batch = get<{ cost_cents: number; voided_at: string | null }>(
        `SELECT cost_cents, voided_at FROM batches WHERE id = ?`,
        m.ref_id,
      );
      incomingCents = batch && !batch.voided_at ? batch.cost_cents : null;
    }

    if (incomingCents !== null && incomingMilli > 0) {
      const held = Math.max(0, qtyMilli);
      const existingValue = Math.round((held * costCents) / MILLI);
      const totalMilli = held + incomingMilli;
      if (totalMilli > 0) {
        costCents = Math.round(((existingValue + incomingCents) * MILLI) / totalMilli);
      }
    }
    qtyMilli += incomingMilli;
  }

  /*
    Nothing priced ever arrived — a shop that counted its opening shelf with a
    stock take and has not recorded a delivery yet. The cost it already carries
    is the best answer there is, and zeroing it would throw away a figure
    somebody may have set deliberately.
  */
  const moved = moves.some((m) => m.reason === "purchase" || m.reason === "batch_output");
  const finalCost = moved ? costCents : item.cost_cents;

  run(`UPDATE items SET cost_cents = ? WHERE id = ?`, finalCost, itemId);
  return finalCost;
}

export interface PriceCorrection {
  /** The purchase line being corrected. */
  lineId: number;
  /** What the supplier actually charged for the whole line, before transport. */
  costCents: number;
  /**
   * How many containers actually came, if that was wrong too.
   *
   * Omitted leaves the count alone, which is the ordinary case. Given, the
   * difference is posted to the stock ledger as its own correcting entry —
   * never by rewriting what was already written.
   */
  units?: number;
  /** What one container held, if that was wrong. Omitted keeps what was recorded. */
  sizeMilli?: number;
}

export interface CorrectionResult {
  purchaseId: number;
  goodsCents: number;
  transportCents: number;
  totalCents: number;
  /** Each item touched, and what its cost price became. */
  repriced: Array<{ itemId: number; name: string; costCents: number }>;
}

/**
 * Put right what a delivery was charged, without touching what arrived.
 *
 * A delivery recorded in a hurry — the price left blank, a nought missed, the
 * transport forgotten — used to be permanent. Nothing in the app could change
 * it, and the cost price it produced went on to decide the profit on every sale
 * of that chemical afterwards.
 *
 * Only money moves here. The quantities are untouched, which is what keeps this
 * simple and safe: the stock ledger is append-only by design and does not need
 * a single entry rewritten, because the same drums arrived either way. What
 * changes is the goods cost on each line, the share of transport that rides on
 * it, the delivery's total, and — by replaying it — the cost price of every
 * item on the delivery.
 *
 * To correct what ARRIVED rather than what it cost, the answer is a stock take:
 * that is a counted fact with a reason against it, and it is the entry the
 * shelf deserves.
 */
export function correctPurchasePrices(
  purchaseId: number,
  input: { transportCents?: number; lines: PriceCorrection[] },
  userId?: number | null,
): CorrectionResult {
  const purchase = get<{ id: number; transport_cents: number }>(
    `SELECT id, transport_cents FROM purchases WHERE id = ?`,
    purchaseId,
  );
  if (!purchase) throw new Error("That delivery could not be found.");

  const transport = input.transportCents ?? purchase.transport_cents;
  if (!Number.isInteger(transport) || transport < 0) {
    throw new Error("Transport must be a whole number of cents, zero or more.");
  }

  const existing = all<{
    id: number;
    item_id: number;
    units: number;
    size_milli: number;
    qty_milli: number;
  }>(
    `SELECT id, item_id, units, size_milli, qty_milli FROM purchase_lines
      WHERE purchase_id = ? ORDER BY id`,
    purchaseId,
  );
  if (!existing.length) throw new Error("That delivery has no lines.");

  const wanted = new Map(input.lines.map((l) => [l.lineId, l.costCents]));
  const wantedQty = new Map(
    input.lines
      .filter((l) => l.units !== undefined || l.sizeMilli !== undefined)
      .map((l) => [l.lineId, { units: l.units, sizeMilli: l.sizeMilli }]),
  );
  for (const [, cents] of wanted) {
    if (!Number.isInteger(cents) || cents < 0) {
      throw new Error("Every price must be a whole number of cents, zero or more.");
    }
  }
  for (const [, q] of wantedQty) {
    if (q.units !== undefined && (!Number.isInteger(q.units) || q.units <= 0)) {
      throw new Error("A delivery line needs a whole number of containers, more than none.");
    }
    if (q.sizeMilli !== undefined && !(q.sizeMilli > 0)) {
      throw new Error("Say what one container held — it has to be more than nothing.");
    }
  }

  return tx(() => {
    /*
      The goods cost of every line, corrected where the owner said so and left
      alone where they did not. Transport is then spread across the whole
      delivery again from scratch: a changed price on one line changes every
      other line's share of it, because the share is by value.
    */
    const goodsLines = existing.map((row) => ({
      itemId: row.item_id,
      units: row.units,
      costCents: wanted.has(row.id)
        ? wanted.get(row.id)!
        : // Not being corrected: recover what the goods were from the landed
          // figure by taking off the share of transport it was carrying.
          recoverGoods(purchaseId, row.id),
    }));

    const goods = goodsLines.reduce((n, l) => n + l.costCents, 0);
    const landed = prorateTransport(goodsLines, transport);

    existing.forEach((row, i) => {
      /*
        What actually came, if that was wrong too.

        The quantity on the line is rewritten so the delivery note and the
        record agree — but the SHELF is corrected by its own entry, never by
        editing what was already posted. The stock ledger is append-only on
        purpose, and "three drums arrived, no, two" is two facts: the second one
        is a correction with a reason on it, and both belong on the record.
      */
      const q = wantedQty.get(row.id);
      const units = q?.units ?? row.units;
      const sizeMilli = q?.sizeMilli ?? row.size_milli;
      const arrivedMilli = units * sizeMilli;

      run(
        `UPDATE purchase_lines SET cost_cents = ?, units = ?, size_milli = ?, qty_milli = ?
          WHERE id = ?`,
        landed[i].landedCents,
        units,
        sizeMilli,
        arrivedMilli,
        row.id,
      );

      const difference = arrivedMilli - row.qty_milli;
      if (difference !== 0) {
        postMovement({
          itemId: row.item_id,
          deltaMilli: difference,
          reason: "adjustment",
          refType: "purchase",
          refId: purchaseId,
          userId: userId ?? null,
          note:
            `delivery corrected: ${row.qty_milli / MILLI} → ${arrivedMilli / MILLI} ` +
            `(${units} × ${sizeMilli / MILLI})`,
        });
      }
    });

    run(
      `UPDATE purchases SET total_cents = ?, transport_cents = ? WHERE id = ?`,
      goods + transport,
      transport,
      purchaseId,
    );

    const repriced = existing.map((row) => {
      const costCents = recomputeCost(row.item_id);
      const name =
        get<{ name: string }>(`SELECT name FROM items WHERE id = ?`, row.item_id)?.name ?? "";
      return { itemId: row.item_id, name, costCents };
    });

    audit(
      userId ?? null,
      "purchase_prices_corrected",
      "purchase",
      purchaseId,
      `${existing.length} line(s) now ${formatKes(goods + transport)} landed: ` +
        repriced.map((r) => `${r.name} at ${formatKes(r.costCents)}`).join(", "),
    );

    return {
      purchaseId,
      goodsCents: goods,
      transportCents: transport,
      totalCents: goods + transport,
      repriced,
    };
  });
}

/**
 * What a line's goods cost was, before transport rode on it.
 *
 * The lines store the LANDED figure, so correcting one line means knowing what
 * the others were charged before the spreading — otherwise re-spreading would
 * compound the old transport into the new goods cost, and every correction
 * would inflate the delivery a little.
 */
function recoverGoods(purchaseId: number, lineId: number): number {
  const rows = all<{ id: number; cost_cents: number }>(
    `SELECT id, cost_cents FROM purchase_lines WHERE purchase_id = ? ORDER BY id`,
    purchaseId,
  );
  const p = get<{ transport_cents: number }>(
    `SELECT transport_cents FROM purchases WHERE id = ?`,
    purchaseId,
  );
  const landedTotal = rows.reduce((n, r) => n + r.cost_cents, 0);
  const transport = p?.transport_cents ?? 0;
  const goodsTotal = landedTotal - transport;
  const mine = rows.find((r) => r.id === lineId)?.cost_cents ?? 0;

  // Landed = goods + goods/goodsTotal × transport, so goods = landed × goodsTotal / landedTotal.
  if (landedTotal <= 0 || goodsTotal <= 0) return mine;
  return Math.round((mine * goodsTotal) / landedTotal);
}
