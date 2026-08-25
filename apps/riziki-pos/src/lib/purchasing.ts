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
import { formatKes } from "./units.ts";

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

// --------------------------------------------------------------- proration

export interface PurchaseLineInput {
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

      // Order matters — see the file header. Average cost first, ledger second.
      updateAverageCost(line.itemId, line.units, line.landedCents);

      run(
        `INSERT INTO purchase_lines (purchase_id, item_id, units, qty_milli, cost_cents)
         VALUES (?, ?, ?, ?, ?)`,
        purchaseId,
        line.itemId,
        line.units,
        line.units * item.size_milli,
        line.landedCents, // landed, so the lines reconcile to purchases.total_cents
      );

      postMovement({
        itemId: line.itemId,
        deltaMilli: line.units * item.size_milli,
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
    `SELECT pl.id, pl.item_id, pl.units, pl.qty_milli, pl.cost_cents,
            i.name AS item_name, i.canonical_unit, i.unit_label, i.size_milli
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
  /** Landed cost of ONE container — the number that tells him prices moved. */
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
            pl.units, pl.cost_cents,
            CAST(pl.cost_cents / pl.units AS INTEGER) AS unit_cost_cents
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
export function purchasedItems(): Array<{ id: number; name: string; deliveries: number }> {
  return all<{ id: number; name: string; deliveries: number }>(
    `SELECT i.id, i.name, COUNT(DISTINCT pl.purchase_id) AS deliveries
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
 */
export function supplierSpend(): SupplierSpendRow[] {
  return all<SupplierSpendRow>(
    `SELECT s.id, s.name, s.phone, s.note,
            COUNT(p.id)                          AS deliveries,
            COALESCE(SUM(p.total_cents), 0)      AS spend_cents,
            MAX(p.at)                            AS last_at
       FROM suppliers s
       LEFT JOIN purchases p ON p.supplier_id = s.id
      WHERE s.active = 1
      GROUP BY s.id
      ORDER BY spend_cents DESC, s.name`,
  );
}
