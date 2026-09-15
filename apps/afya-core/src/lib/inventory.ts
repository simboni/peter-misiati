/**
 * M41 Inventory & Stores — stock that is always in a place, always in a batch.
 *
 * Three rules, and every function here exists to keep one of them:
 *
 *  STOCK IS HELD PER BATCH. Never a single number per product. A recall names
 *  a batch; an expiry belongs to a batch; a pharmacist asked which batch a
 *  patient received must be able to answer. A system that tracks "400 tablets
 *  of amoxicillin" cannot answer any of those questions.
 *
 *  THE LEDGER IS APPEND-ONLY. A correction is another movement with a reason,
 *  never an edit. The sum of movements equals what is on the shelf, so a
 *  discrepancy has a history instead of being a mystery. This is also what
 *  makes theft visible.
 *
 *  PICKING IS FIRST-EXPIRY-FIRST-OUT. Not first-in-first-out: what matters is
 *  what expires soonest, because that is what turns into a write-off. Expired
 *  and quarantined batches are never picked at all.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { getProduct } from "./prescribing.ts";

export class StockError extends Error {}

export type StoreKind = "main" | "pharmacy" | "ward" | "theatre" | "lab";
export type MovementKind =
  | "receipt"
  | "issue"
  | "dispense"
  | "return"
  | "adjustment"
  | "write_off"
  | "transfer_in"
  | "transfer_out";

export interface Store {
  code: string;
  facility_id: number;
  name: string;
  kind: StoreKind;
  dispensing: number;
  active: number;
  created_at: string;
}

export interface Batch {
  id: string;
  store_code: string;
  product_code: string;
  batch_number: string;
  expires_on: string;
  quantity: number;
  unit_cost_cents: number;
  quarantined: number;
  quarantine_reason: string | null;
  received_at: string;
}

export interface Movement {
  id: number;
  batch_id: string;
  store_code: string;
  product_code: string;
  kind: MovementKind;
  quantity: number;
  balance_after: number;
  reference: string | null;
  reason: string;
  patient_mrn: string | null;
  by_user_id: number | null;
  by_user_name: string;
  at: string;
}

// --------------------------------------------------------------------- stores

export function defineStore(input: {
  facilityId: number;
  code: string;
  name: string;
  kind: StoreKind;
  dispensing?: boolean;
}): void {
  run(
    `INSERT INTO stores (code, facility_id, name, kind, dispensing, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name, kind = excluded.kind,
       dispensing = excluded.dispensing`,
    input.code.trim().toUpperCase(),
    input.facilityId,
    input.name.trim(),
    input.kind,
    (input.dispensing ?? input.kind === "pharmacy") ? 1 : 0,
    now(),
  );
}

export function getStore(code: string): Store | undefined {
  return get<Store>(`SELECT * FROM stores WHERE code = ?`, code.trim().toUpperCase());
}

export function listStores(facilityId: number): Store[] {
  return all<Store>(`SELECT * FROM stores WHERE facility_id = ? AND active = 1 ORDER BY kind, name`, facilityId);
}

// -------------------------------------------------------------------- receipt

/**
 * Take delivery of stock.
 *
 * An expiry date is not optional and a batch number is not optional: without
 * them the two questions stock control exists to answer — what expires next,
 * and who received the recalled batch — cannot be answered at all.
 */
export function receiveStock(input: {
  storeCode: string;
  productCode: string;
  batchNumber: string;
  expiresOn: string;
  quantity: number;
  unitCostCents?: number;
  reference?: string;
  deviceCode: string;
  byUserId: number | null;
  byUserName: string;
}): string {
  const store = getStore(input.storeCode);
  if (!store) throw new StockError(`no such store ${input.storeCode}`);

  const product = getProduct(input.productCode);
  if (!product) throw new StockError(`${input.productCode} is not in the product catalogue`);
  if (!product.ppb_registration) {
    // The Pharmacy and Poisons Board registration is what makes a product
    // lawful to hold and dispense. A delivery of something unregistered is a
    // problem to raise at the door, not to discover at the counter.
    throw new StockError(`${product.name} has no PPB registration recorded — it must not be taken into stock`);
  }
  if (!input.batchNumber.trim()) throw new StockError("a delivery must record the batch number");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn)) {
    throw new StockError("a delivery must record the expiry date as YYYY-MM-DD");
  }
  if (input.expiresOn <= today()) {
    throw new StockError(`that batch expires on ${input.expiresOn} — it must not be taken into stock`);
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new StockError("quantity received must be a whole number greater than zero");
  }

  const storeCode = store.code;
  const productCode = product.code;
  const batchNumber = input.batchNumber.trim().toUpperCase();

  return tx(() => {
    const existing = get<Batch>(
      `SELECT * FROM stock_batches WHERE store_code = ? AND product_code = ? AND batch_number = ?`,
      storeCode,
      productCode,
      batchNumber,
    );

    let batchId: string;
    if (existing) {
      if (existing.expires_on !== input.expiresOn) {
        throw new StockError(
          `batch ${batchNumber} is already on file expiring ${existing.expires_on}, not ${input.expiresOn} — check the pack`,
        );
      }
      batchId = existing.id;
    } else {
      batchId = mintLocalId(input.deviceCode, 8);
      run(
        `INSERT INTO stock_batches
           (id, store_code, product_code, batch_number, expires_on, quantity, unit_cost_cents, received_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        batchId,
        storeCode,
        productCode,
        batchNumber,
        input.expiresOn,
        input.unitCostCents ?? 0,
        now(),
      );
    }

    move({
      batchId,
      kind: "receipt",
      quantity: input.quantity,
      reference: input.reference ?? null,
      reason: "",
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });

    audit({
      action: "stock_received",
      entity: "batch",
      entityId: batchId,
      facilityId: store.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      detail: { store: storeCode, product: productCode, batch: batchNumber, quantity: input.quantity, expiresOn: input.expiresOn },
    });

    return batchId;
  });
}

/**
 * Post one movement and update the batch balance.
 *
 * The only place `stock_batches.quantity` is written. Everything else goes
 * through here, which is what keeps the balance equal to the sum of the ledger.
 */
function move(input: {
  batchId: string;
  kind: MovementKind;
  quantity: number;
  reference: string | null;
  reason: string;
  patientMrn?: string | null;
  byUserId: number | null;
  byUserName: string;
}): number {
  const batch = get<Batch>(`SELECT * FROM stock_batches WHERE id = ?`, input.batchId);
  if (!batch) throw new StockError("no such batch");

  const balance = batch.quantity + input.quantity;
  if (balance < 0) {
    throw new StockError(
      `batch ${batch.batch_number} holds ${batch.quantity}; this movement would take it to ${balance}`,
    );
  }

  run(`UPDATE stock_batches SET quantity = ? WHERE id = ?`, balance, input.batchId);
  run(
    `INSERT INTO stock_movements
       (batch_id, store_code, product_code, kind, quantity, balance_after, reference, reason,
        patient_mrn, by_user_id, by_user_name, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.batchId,
    batch.store_code,
    batch.product_code,
    input.kind,
    input.quantity,
    balance,
    input.reference,
    input.reason,
    input.patientMrn ?? null,
    input.byUserId,
    input.byUserName,
    now(),
  );
  return balance;
}

// --------------------------------------------------------------------- levels

/** What is on hand for a product in a store, excluding what cannot be issued. */
export function onHand(storeCode: string, productCode: string, asOf = today()): number {
  const row = get<{ q: number }>(
    `SELECT COALESCE(SUM(quantity), 0) AS q FROM stock_batches
      WHERE store_code = ? AND product_code = ? AND quarantined = 0 AND expires_on > ?`,
    storeCode.trim().toUpperCase(),
    productCode.trim().toUpperCase(),
    asOf,
  )!;
  return row.q ?? 0;
}

/**
 * The batches to pick from, soonest expiry first.
 *
 * Expired and quarantined batches are not here at all — they are not stock a
 * pharmacist may reach for, whatever is physically on the shelf.
 */
export function pickable(storeCode: string, productCode: string, asOf = today()): Batch[] {
  return all<Batch>(
    `SELECT * FROM stock_batches
      WHERE store_code = ? AND product_code = ? AND quantity > 0 AND quarantined = 0 AND expires_on > ?
      ORDER BY expires_on, received_at`,
    storeCode.trim().toUpperCase(),
    productCode.trim().toUpperCase(),
    asOf,
  );
}

export interface Allocation {
  batchId: string;
  batchNumber: string;
  expiresOn: string;
  quantity: number;
}

/**
 * Work out which batches would cover a quantity, first-expiry-first-out.
 *
 * Returns a short allocation when there is not enough, rather than throwing —
 * a pharmacist dispensing 20 of 30 needs to see that, and partial dispensing is
 * normal, not an error.
 */
export function allocate(storeCode: string, productCode: string, quantity: number, asOf = today()): {
  allocations: Allocation[];
  allocated: number;
  short: number;
} {
  const allocations: Allocation[] = [];
  let remaining = quantity;

  for (const batch of pickable(storeCode, productCode, asOf)) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    allocations.push({
      batchId: batch.id,
      batchNumber: batch.batch_number,
      expiresOn: batch.expires_on,
      quantity: take,
    });
    remaining -= take;
  }

  return { allocations, allocated: quantity - remaining, short: remaining };
}

/**
 * Take stock off the shelf against an allocation.
 *
 * Called by dispensing and by ward issue. Deliberately not exported as a
 * general "decrement" — every removal names why and what for.
 */
export function consume(input: {
  allocations: Allocation[];
  kind: Extract<MovementKind, "dispense" | "issue" | "write_off" | "transfer_out">;
  reference: string;
  reason?: string;
  patientMrn?: string | null;
  byUserId: number | null;
  byUserName: string;
}): void {
  for (const a of input.allocations) {
    move({
      batchId: a.batchId,
      kind: input.kind,
      quantity: -a.quantity,
      reference: input.reference,
      reason: input.reason ?? "",
      patientMrn: input.patientMrn ?? null,
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });
  }
}

/** Put stock back — a patient returned it, or a dispense was reversed. */
export function returnStock(input: {
  batchId: string;
  quantity: number;
  reason: string;
  reference?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  if (!input.reason.trim()) throw new StockError("returning stock must record why");
  move({
    batchId: input.batchId,
    kind: "return",
    quantity: Math.abs(input.quantity),
    reference: input.reference ?? null,
    reason: input.reason.trim(),
    byUserId: input.byUserId,
    byUserName: input.byUserName,
  });
}

// ---------------------------------------------------------------- stock takes

/**
 * Record a physical count.
 *
 * The difference is posted as an adjustment with the counted figure and the
 * reason on it. The previous balance is never overwritten — the discrepancy is
 * the finding, and a system that silently agrees with the count hides theft.
 */
export function recordCount(input: {
  batchId: string;
  counted: number;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): { was: number; counted: number; difference: number } {
  const batch = get<Batch>(`SELECT * FROM stock_batches WHERE id = ?`, input.batchId);
  if (!batch) throw new StockError("no such batch");
  if (!Number.isInteger(input.counted) || input.counted < 0) {
    throw new StockError("a count must be a whole number, zero or more");
  }

  const difference = input.counted - batch.quantity;
  if (difference === 0) return { was: batch.quantity, counted: input.counted, difference: 0 };

  if (!input.reason.trim()) {
    throw new StockError(
      `the count is ${difference > 0 ? "over" : "under"} by ${Math.abs(difference)} — an adjustment must record why`,
    );
  }

  return tx(() => {
    move({
      batchId: input.batchId,
      kind: "adjustment",
      quantity: difference,
      reference: null,
      reason: input.reason.trim(),
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });
    audit({
      action: "stock_adjusted",
      entity: "batch",
      entityId: input.batchId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: {
        product: batch.product_code,
        batch: batch.batch_number,
        was: batch.quantity,
        counted: input.counted,
        difference,
        reason: input.reason,
      },
    });
    return { was: batch.quantity, counted: input.counted, difference };
  });
}

// -------------------------------------------------------------------- recalls

/**
 * Quarantine a batch — a recall, damage, or a pharmacist's doubt.
 *
 * The stock stays on the books and in its place; it simply stops being
 * pickable. Writing it off is a separate decision with its own record.
 */
export function quarantineBatch(input: {
  batchId: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  if (!input.reason.trim()) throw new StockError("quarantining a batch must record why");
  const batch = get<Batch>(`SELECT * FROM stock_batches WHERE id = ?`, input.batchId);
  if (!batch) throw new StockError("no such batch");

  tx(() => {
    run(
      `UPDATE stock_batches SET quarantined = 1, quarantine_reason = ? WHERE id = ?`,
      input.reason.trim(),
      input.batchId,
    );
    audit({
      action: "batch_quarantined",
      entity: "batch",
      entityId: input.batchId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { product: batch.product_code, batch: batch.batch_number, quantity: batch.quantity, reason: input.reason },
    });
  });
}

export function releaseBatch(input: {
  batchId: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  if (!input.reason.trim()) throw new StockError("releasing a quarantined batch must record why");
  tx(() => {
    run(`UPDATE stock_batches SET quarantined = 0, quarantine_reason = NULL WHERE id = ?`, input.batchId);
    audit({
      action: "batch_released",
      entity: "batch",
      entityId: input.batchId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { reason: input.reason },
    });
  });
}

/**
 * Who received stock from a batch.
 *
 * The question a recall asks, and the only reason batch-level tracking is worth
 * its cost. Returns every patient the batch reached, with the date.
 */
export function recallTrace(batchId: string): {
  patientMrn: string;
  quantity: number;
  at: string;
  dispenseId: string | null;
}[] {
  return all(
    `SELECT m.patient_mrn AS patientMrn, -m.quantity AS quantity, m.at AS at, m.reference AS dispenseId
       FROM stock_movements m
      WHERE m.batch_id = ? AND m.kind = 'dispense' AND m.patient_mrn IS NOT NULL
      ORDER BY m.at`,
    batchId,
  );
}

/** Write a batch off — expired, damaged, or recalled and returned to supplier. */
export function writeOff(input: {
  batchId: string;
  quantity?: number;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): number {
  if (!input.reason.trim()) throw new StockError("writing stock off must record why");
  const batch = get<Batch>(`SELECT * FROM stock_batches WHERE id = ?`, input.batchId);
  if (!batch) throw new StockError("no such batch");

  const quantity = input.quantity ?? batch.quantity;
  if (quantity <= 0) return 0;

  return tx(() => {
    move({
      batchId: input.batchId,
      kind: "write_off",
      quantity: -quantity,
      reference: null,
      reason: input.reason.trim(),
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });
    audit({
      action: "stock_written_off",
      entity: "batch",
      entityId: input.batchId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: {
        product: batch.product_code,
        batch: batch.batch_number,
        quantity,
        valueCents: quantity * batch.unit_cost_cents,
        reason: input.reason,
      },
    });
    return quantity;
  });
}

// ------------------------------------------------------------------- reorder

export function setReorderLevel(input: {
  storeCode: string;
  productCode: string;
  reorderAt: number;
  reorderTo: number;
}): void {
  if (input.reorderTo <= input.reorderAt) {
    throw new StockError("the reorder-to level must be above the reorder-at level, or every order is one unit");
  }
  run(
    `INSERT INTO reorder_levels (store_code, product_code, reorder_at, reorder_to, set_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(store_code, product_code) DO UPDATE SET
       reorder_at = excluded.reorder_at, reorder_to = excluded.reorder_to, set_at = excluded.set_at`,
    input.storeCode.trim().toUpperCase(),
    input.productCode.trim().toUpperCase(),
    input.reorderAt,
    input.reorderTo,
    now(),
  );
}

export interface StockLine {
  productCode: string;
  productName: string;
  controlled: boolean;
  onHand: number;
  reorderAt: number | null;
  reorderTo: number | null;
  /** Suggested order quantity, or null when nobody has set a level. */
  orderQuantity: number | null;
  nextExpiry: string | null;
  expiringSoon: number;
  expired: number;
  quarantined: number;
}

/**
 * The stock position in a store, product by product.
 *
 * Deliberately one query's worth of everything a storekeeper looks at: what is
 * there, what runs out, what expires, what is locked up. A separate screen for
 * each is how a clinic ends up checking none of them.
 */
export function stockPosition(storeCode: string, asOf = today()): StockLine[] {
  const store = storeCode.trim().toUpperCase();
  const soon = new Date(Date.parse(`${asOf}T00:00:00.000Z`) + 90 * 86_400_000).toISOString().slice(0, 10);

  const rows = all<{
    product_code: string;
    name: string;
    controlled: number;
    on_hand: number;
    next_expiry: string | null;
    expiring_soon: number;
    expired: number;
    quarantined: number;
    reorder_at: number | null;
    reorder_to: number | null;
  }>(
    `SELECT b.product_code,
            p.name,
            p.controlled,
            COALESCE(SUM(CASE WHEN b.quarantined = 0 AND b.expires_on > ? THEN b.quantity ELSE 0 END), 0) AS on_hand,
            MIN(CASE WHEN b.quantity > 0 AND b.quarantined = 0 THEN b.expires_on END) AS next_expiry,
            COALESCE(SUM(CASE WHEN b.expires_on > ? AND b.expires_on <= ? THEN b.quantity ELSE 0 END), 0) AS expiring_soon,
            COALESCE(SUM(CASE WHEN b.expires_on <= ? THEN b.quantity ELSE 0 END), 0) AS expired,
            COALESCE(SUM(CASE WHEN b.quarantined = 1 THEN b.quantity ELSE 0 END), 0) AS quarantined,
            r.reorder_at, r.reorder_to
       FROM stock_batches b
       JOIN products p ON p.code = b.product_code
       LEFT JOIN reorder_levels r ON r.store_code = b.store_code AND r.product_code = b.product_code
      WHERE b.store_code = ?
      GROUP BY b.product_code
      ORDER BY p.name`,
    asOf,
    asOf,
    soon,
    asOf,
    store,
  );

  return rows.map((r) => ({
    productCode: r.product_code,
    productName: r.name,
    controlled: r.controlled === 1,
    onHand: r.on_hand,
    reorderAt: r.reorder_at,
    reorderTo: r.reorder_to,
    orderQuantity:
      r.reorder_at === null || r.reorder_to === null
        ? null
        : r.on_hand <= r.reorder_at
          ? r.reorder_to - r.on_hand
          : 0,
    nextExpiry: r.next_expiry,
    expiringSoon: r.expiring_soon,
    expired: r.expired,
    quarantined: r.quarantined,
  }));
}

/** What to order, and what nobody has set a level for. */
export function reorderReport(storeCode: string, asOf = today()): {
  order: StockLine[];
  noLevelSet: StockLine[];
} {
  const lines = stockPosition(storeCode, asOf);
  return {
    order: lines.filter((l) => l.orderQuantity !== null && l.orderQuantity > 0),
    // Said out loud rather than assumed to be fine: an unset level is a
    // decision nobody has made, not a product that never runs out.
    noLevelSet: lines.filter((l) => l.reorderAt === null),
  };
}

/** Everything expiring inside the window, soonest first. */
export function expiryReport(storeCode: string, withinDays = 90, asOf = today()): (Batch & { product_name: string })[] {
  const until = new Date(Date.parse(`${asOf}T00:00:00.000Z`) + withinDays * 86_400_000).toISOString().slice(0, 10);
  return all(
    `SELECT b.*, p.name AS product_name FROM stock_batches b
       JOIN products p ON p.code = b.product_code
      WHERE b.store_code = ? AND b.quantity > 0 AND b.expires_on <= ?
      ORDER BY b.expires_on`,
    storeCode.trim().toUpperCase(),
    until,
  );
}

/** The stock card for one batch: every movement, oldest first. */
export function stockCard(batchId: string): Movement[] {
  return all<Movement>(`SELECT * FROM stock_movements WHERE batch_id = ? ORDER BY id`, batchId);
}

/**
 * The controlled-drug register.
 *
 * A legal requirement the PPB inspects, and the reason controlled movements
 * carry the patient and the dispenser. Every movement of a controlled product,
 * in date order, with nothing omitted.
 */
export function controlledRegister(input: { storeCode?: string; from?: string; to?: string } = {}): (Movement & {
  product_name: string;
  batch_number: string;
})[] {
  const clauses = ["p.controlled = 1"];
  const params: (string | number)[] = [];
  if (input.storeCode) {
    clauses.push("m.store_code = ?");
    params.push(input.storeCode.trim().toUpperCase());
  }
  if (input.from) {
    clauses.push("m.at >= ?");
    params.push(input.from);
  }
  if (input.to) {
    clauses.push("m.at <= ?");
    params.push(`${input.to}T23:59:59.999Z`);
  }

  return all(
    `SELECT m.*, p.name AS product_name, b.batch_number
       FROM stock_movements m
       JOIN products p ON p.code = m.product_code
       JOIN stock_batches b ON b.id = m.batch_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY m.at`,
    ...params,
  );
}

/** Total value on the shelf, for the balance sheet and for insurance. */
export function stockValue(storeCode: string, asOf = today()): { lines: number; valueCents: number } {
  const row = get<{ n: number; v: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(quantity * unit_cost_cents), 0) AS v
       FROM stock_batches WHERE store_code = ? AND quantity > 0 AND expires_on > ?`,
    storeCode.trim().toUpperCase(),
    asOf,
  )!;
  return { lines: row.n ?? 0, valueCents: row.v ?? 0 };
}
