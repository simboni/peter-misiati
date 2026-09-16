/**
 * M42 Procurement — requisition, order, delivery, invoice, and the match.
 *
 * This is where a facility's money actually leaks, and it leaks in three ways:
 * paying for goods nobody can show arrived, paying a price nobody agreed, and
 * one person controlling the whole chain from request to payment. The module is
 * three controls against those three leaks, and everything else is paperwork
 * around them.
 *
 *  THE THREE-WAY MATCH IS COMPUTED, NOT ASSERTED. An invoice is checked line by
 *  line against what was ordered and what was received. You cannot pay for more
 *  than arrived, or at more than was agreed, because `matchInvoice` works it out
 *  from the rows rather than trusting a total. A mismatch does not block
 *  payment — it queries it, names the difference in shillings, and makes
 *  somebody decide. Blocking would simply move the payment off the system.
 *
 *  THE PERSON WHO ASKED CANNOT APPROVE. The oldest control in procurement and
 *  the first one quietly dropped. Enforced here rather than written in a
 *  policy nobody reads, and the refusal names the rule so it is obvious what
 *  happened.
 *
 *  A SUPPLIER WITHOUT A CURRENT PPB LICENCE CANNOT SUPPLY MEDICINES. Checked at
 *  the order, not at the invoice, because by the invoice the drugs are already
 *  on the shelf and somebody has taken them.
 *
 * Two more decisions worth stating:
 *
 *  A DELIVERY IS COUNTED AT THE DOOR, AND A VARIANCE IS RECORDED RATHER THAN
 *  ABSORBED. Ordered 100, delivered 80 is a fact about the order, not a
 *  correction to it. Short-dated stock refused on the day is a supplier
 *  problem; accepted, it becomes the facility's, which is why rejection has its
 *  own column and its own reason.
 *
 *  RECEIVING TAKES GOODS INTO STOCK, ONCE. The goods received note and the
 *  stock batch are created together, so there is no window in which a delivery
 *  exists on paper and not on the shelf, and a recall reaches from the batch to
 *  the delivery to the supplier.
 *
 * ⚠️ Quotation counts and tender thresholds are a legal matter for a public
 * facility (the Public Procurement and Asset Disposal Act) and a policy matter
 * for a private one. The module records how many quotations were obtained and
 * why one was chosen; it does not enforce a threshold, because the right
 * threshold is not something this software can know.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { getProduct } from "./prescribing.ts";
import { getStore, receiveStock, onHand } from "./inventory.ts";
import { notify } from "./notifications.ts";
import { formatKes } from "./billing.ts";

export class ProcurementError extends Error {}

export type RequisitionStatus = "raised" | "approved" | "rejected" | "ordered" | "cancelled";
export type PoStatus = "issued" | "part_received" | "received" | "closed" | "cancelled";
export type InvoiceStatus = "received" | "matched" | "queried" | "approved" | "paid" | "rejected";
export type AgpoCategory = "youth" | "women" | "pwd" | "none";

/**
 * How many quotations a requisition is expected to carry.
 *
 * ⚠️ Advisory. Three is the rule most facilities work to and, below the tender
 * threshold, what the Public Procurement and Asset Disposal Act requires of a
 * public entity. The module counts and warns; it does not refuse, because the
 * threshold that applies here is a matter for the facility's own procurement
 * policy and its legal status.
 */
export const EXPECTED_QUOTATIONS = 3;

export interface Supplier {
  code: string;
  name: string;
  kra_pin: string | null;
  ppb_licence: string | null;
  ppb_expires_on: string | null;
  agpo_category: AgpoCategory | null;
  agpo_certificate: string | null;
  phone: string;
  email: string;
  blocked: number;
  blocked_reason: string;
  active: number;
  created_at: string;
}

export interface PurchaseOrder {
  id: string;
  facility_id: number;
  requisition_id: string | null;
  supplier_code: string;
  store_code: string;
  reference: string;
  status: PoStatus;
  expected_on: string | null;
  total_cents: number;
  cancel_reason: string;
  issued_by: number | null;
  issuer_name: string;
  issued_at: string;
  device_code: string | null;
  created_at: string;
}

// ----------------------------------------------------------------- suppliers

export function defineSupplier(input: {
  code: string;
  name: string;
  kraPin?: string;
  ppbLicence?: string;
  ppbExpiresOn?: string;
  agpoCategory?: AgpoCategory;
  agpoCertificate?: string;
  phone?: string;
  email?: string;
}): void {
  if (input.ppbExpiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.ppbExpiresOn)) {
    throw new ProcurementError("a PPB licence expiry must be YYYY-MM-DD");
  }
  run(
    `INSERT INTO suppliers
       (code, name, kra_pin, ppb_licence, ppb_expires_on, agpo_category, agpo_certificate,
        phone, email, blocked, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
     ON CONFLICT(code) DO UPDATE SET
       name = excluded.name, kra_pin = excluded.kra_pin, ppb_licence = excluded.ppb_licence,
       ppb_expires_on = excluded.ppb_expires_on, agpo_category = excluded.agpo_category,
       agpo_certificate = excluded.agpo_certificate, phone = excluded.phone, email = excluded.email`,
    input.code.trim().toUpperCase(),
    input.name.trim(),
    input.kraPin?.trim().toUpperCase() || null,
    input.ppbLicence?.trim().toUpperCase() || null,
    input.ppbExpiresOn ?? null,
    input.agpoCategory ?? "none",
    input.agpoCertificate?.trim() || null,
    input.phone?.trim() ?? "",
    input.email?.trim() ?? "",
    now(),
  );
}

export function getSupplier(code: string): Supplier | undefined {
  return get<Supplier>(`SELECT * FROM suppliers WHERE code = ?`, code.trim().toUpperCase());
}

export function listSuppliers(includeBlocked = false): Supplier[] {
  return all<Supplier>(
    `SELECT * FROM suppliers WHERE active = 1 ${includeBlocked ? "" : "AND blocked = 0"} ORDER BY name`,
  );
}

export function blockSupplier(input: {
  code: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const supplier = getSupplier(input.code);
  if (!supplier) throw new ProcurementError("no such supplier");
  if (!input.reason.trim()) throw new ProcurementError("blocking a supplier must record why");

  run(`UPDATE suppliers SET blocked = 1, blocked_reason = ? WHERE code = ?`, input.reason.trim(), supplier.code);
  audit({
    action: "supplier_blocked",
    entity: "supplier",
    entityId: supplier.code,
    actorId: input.byUserId,
    actorName: input.byUserName,
    purpose: "administration",
    detail: { reason: input.reason },
  });
}

/** Whether this supplier may lawfully supply medicines today. */
export function canSupplyMedicines(code: string, asOf = today()): { ok: boolean; why: string } {
  const supplier = getSupplier(code);
  if (!supplier) return { ok: false, why: "no such supplier" };
  if (supplier.blocked) return { ok: false, why: `blocked — ${supplier.blocked_reason}` };
  if (!supplier.ppb_licence) return { ok: false, why: "no PPB licence recorded" };
  if (supplier.ppb_expires_on && supplier.ppb_expires_on < asOf) {
    return { ok: false, why: `PPB licence expired on ${supplier.ppb_expires_on}` };
  }
  return { ok: true, why: "" };
}

// -------------------------------------------------------------- requisitions

export function raiseRequisition(input: {
  facilityId: number;
  storeCode: string;
  reason: string;
  lines: { productCode: string; quantity: number; note?: string }[];
  byUserId: number;
  byUserName: string;
  deviceCode: string;
}): string {
  if (!input.reason.trim()) throw new ProcurementError("a requisition must say why");
  if (input.lines.length === 0) throw new ProcurementError("a requisition needs at least one line");
  if (!getStore(input.storeCode)) throw new ProcurementError(`no such store ${input.storeCode}`);

  for (const line of input.lines) {
    if (!getProduct(line.productCode)) {
      throw new ProcurementError(`${line.productCode} is not in the product catalogue`);
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new ProcurementError(`the quantity for ${line.productCode} must be a whole number above zero`);
    }
  }

  const id = mintLocalId(input.deviceCode, 8);

  return tx(() => {
    run(
      `INSERT INTO requisitions
         (id, facility_id, store_code, reason, status, raised_by, raiser_name, raised_at, device_code, created_at)
       VALUES (?, ?, ?, ?, 'raised', ?, ?, ?, ?, ?)`,
      id,
      input.facilityId,
      input.storeCode.trim().toUpperCase(),
      input.reason.trim(),
      input.byUserId,
      input.byUserName,
      now(),
      input.deviceCode,
      now(),
    );

    for (const line of input.lines) {
      const product = getProduct(line.productCode)!;
      run(
        `INSERT INTO requisition_lines (requisition_id, product_code, product_name, quantity, on_hand_then, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        product.code,
        product.name,
        line.quantity,
        // What the store had at the moment of asking, so an approver can see
        // whether it was justified without going to look.
        onHand(input.storeCode, product.code),
        line.note?.trim() ?? "",
      );
    }

    audit({
      action: "requisition_raised",
      entity: "requisition",
      entityId: id,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      detail: { store: input.storeCode, lines: input.lines.length, reason: input.reason },
    });
    return id;
  });
}

export function getRequisition(id: string) {
  return get<{
    id: string;
    facility_id: number;
    store_code: string;
    reason: string;
    status: RequisitionStatus;
    raised_by: number | null;
    raiser_name: string;
    raised_at: string;
    approved_by: number | null;
    approver_name: string;
    approved_at: string | null;
    decision_note: string;
  }>(`SELECT * FROM requisitions WHERE id = ?`, id);
}

export function requisitionLines(requisitionId: string) {
  return all<{
    id: number;
    product_code: string;
    product_name: string;
    quantity: number;
    on_hand_then: number | null;
    note: string;
  }>(`SELECT * FROM requisition_lines WHERE requisition_id = ? ORDER BY id`, requisitionId);
}

/**
 * Approve or reject a requisition.
 *
 * The person who raised it cannot approve it. This is the oldest control in
 * procurement and the first one quietly dropped, so it lives in code rather
 * than in a policy document.
 */
export function decideRequisition(input: {
  requisitionId: string;
  approve: boolean;
  note?: string;
  byUserId: number;
  byUserName: string;
}): void {
  const requisition = getRequisition(input.requisitionId);
  if (!requisition) throw new ProcurementError("no such requisition");
  if (requisition.status !== "raised") {
    throw new ProcurementError(`that requisition is already ${requisition.status}`);
  }
  if (requisition.raised_by === input.byUserId) {
    throw new ProcurementError(
      "the person who raised a requisition cannot approve it — that is the whole point of approval",
    );
  }
  if (!input.approve && !input.note?.trim()) {
    throw new ProcurementError("a rejection must say why, so the store knows whether to ask again");
  }

  tx(() => {
    run(
      `UPDATE requisitions SET status = ?, approved_by = ?, approver_name = ?, approved_at = ?, decision_note = ?
        WHERE id = ?`,
      input.approve ? "approved" : "rejected",
      input.byUserId,
      input.byUserName,
      now(),
      input.note?.trim() ?? "",
      requisition.id,
    );
    audit({
      action: input.approve ? "requisition_approved" : "requisition_rejected",
      entity: "requisition",
      entityId: requisition.id,
      facilityId: requisition.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { raisedBy: requisition.raiser_name, note: input.note ?? null },
    });
  });
}

// ---------------------------------------------------------------- quotations

export function recordQuotation(input: {
  requisitionId: string;
  supplierCode: string;
  totalCents: number;
  leadDays?: number;
  note?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const requisition = getRequisition(input.requisitionId);
  if (!requisition) throw new ProcurementError("no such requisition");
  const supplier = getSupplier(input.supplierCode);
  if (!supplier) throw new ProcurementError("no such supplier");
  if (supplier.blocked) throw new ProcurementError(`${supplier.name} is blocked — ${supplier.blocked_reason}`);
  if (!Number.isInteger(input.totalCents) || input.totalCents <= 0) {
    throw new ProcurementError("a quotation needs a total above zero");
  }

  const id = mintLocalId(input.deviceCode, 8);
  run(
    `INSERT INTO quotations
       (id, requisition_id, supplier_code, total_cents, lead_days, note, received_at, recorded_by, recorder_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(requisition_id, supplier_code) DO UPDATE SET
       total_cents = excluded.total_cents, lead_days = excluded.lead_days, note = excluded.note,
       received_at = excluded.received_at`,
    id,
    requisition.id,
    supplier.code,
    input.totalCents,
    input.leadDays ?? null,
    input.note?.trim() ?? "",
    now(),
    input.byUserId,
    input.byUserName,
  );
  return id;
}

/**
 * Choose a quotation, and say why.
 *
 * "Cheapest" is a reason. So is "the only one with stock" and "the only one
 * whose licence is current" — and recording which is how a facility defends the
 * decision two years later.
 */
export function selectQuotation(input: {
  requisitionId: string;
  supplierCode: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  if (!input.reason.trim()) {
    throw new ProcurementError("choosing a supplier must record why — especially when it is not the cheapest");
  }
  const quotes = quotationsFor(input.requisitionId);
  const chosen = quotes.find((q) => q.supplier_code === input.supplierCode.trim().toUpperCase());
  if (!chosen) throw new ProcurementError("that supplier has not quoted on this requisition");

  const cheapest = [...quotes].sort((a, b) => a.total_cents - b.total_cents)[0];

  tx(() => {
    run(`UPDATE quotations SET selected = 0, selection_reason = '' WHERE requisition_id = ?`, input.requisitionId);
    run(
      `UPDATE quotations SET selected = 1, selection_reason = ? WHERE requisition_id = ? AND supplier_code = ?`,
      input.reason.trim(),
      input.requisitionId,
      chosen.supplier_code,
    );
    audit({
      action: "quotation_selected",
      entity: "requisition",
      entityId: input.requisitionId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: {
        supplier: chosen.supplier_code,
        totalCents: chosen.total_cents,
        quotations: quotes.length,
        cheapest: cheapest.supplier_code,
        // Recorded rather than refused: the cheapest quotation is often not the
        // right one, and the defensible thing is the reason, not the price.
        notCheapest: chosen.supplier_code !== cheapest.supplier_code,
        reason: input.reason,
      },
    });
  });
}

export function quotationsFor(requisitionId: string) {
  return all<{
    id: string;
    supplier_code: string;
    supplier_name: string;
    total_cents: number;
    lead_days: number | null;
    note: string;
    selected: number;
    selection_reason: string;
    received_at: string;
  }>(
    `SELECT q.*, s.name AS supplier_name FROM quotations q
       JOIN suppliers s ON s.code = q.supplier_code
      WHERE q.requisition_id = ? ORDER BY q.total_cents`,
    requisitionId,
  );
}

// ----------------------------------------------------------- purchase orders

export function issuePurchaseOrder(input: {
  facilityId: number;
  supplierCode: string;
  storeCode: string;
  requisitionId?: string;
  expectedOn?: string;
  lines: { productCode: string; quantity: number; unitCostCents: number }[];
  byUserId: number;
  byUserName: string;
  deviceCode: string;
}): string {
  const supplier = getSupplier(input.supplierCode);
  if (!supplier) throw new ProcurementError("no such supplier");
  if (supplier.blocked) throw new ProcurementError(`${supplier.name} is blocked — ${supplier.blocked_reason}`);
  if (!getStore(input.storeCode)) throw new ProcurementError(`no such store ${input.storeCode}`);
  if (input.lines.length === 0) throw new ProcurementError("a purchase order needs at least one line");

  if (input.requisitionId) {
    const requisition = getRequisition(input.requisitionId);
    if (!requisition) throw new ProcurementError("no such requisition");
    if (requisition.status !== "approved") {
      throw new ProcurementError(
        `that requisition is ${requisition.status} — nothing is ordered against a requisition nobody approved`,
      );
    }
  }

  // Checked at the order, not at the invoice: by the invoice the drugs are on
  // the shelf and somebody has already taken them.
  const licence = canSupplyMedicines(supplier.code);
  if (!licence.ok) {
    throw new ProcurementError(
      `${supplier.name} cannot supply medicines — ${licence.why}. Every line here is a medicine.`,
    );
  }

  for (const line of input.lines) {
    if (!getProduct(line.productCode)) {
      throw new ProcurementError(`${line.productCode} is not in the product catalogue`);
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new ProcurementError(`the quantity for ${line.productCode} must be a whole number above zero`);
    }
    if (!Number.isInteger(line.unitCostCents) || line.unitCostCents < 0) {
      throw new ProcurementError(`the price for ${line.productCode} must be a whole number of cents`);
    }
  }

  const id = mintLocalId(input.deviceCode, 8);
  const reference = `PO-${today().replace(/-/g, "")}-${id.split("-").pop()}`;
  const total = input.lines.reduce((sum, l) => sum + l.quantity * l.unitCostCents, 0);

  return tx(() => {
    run(
      `INSERT INTO purchase_orders
         (id, facility_id, requisition_id, supplier_code, store_code, reference, status,
          expected_on, total_cents, issued_by, issuer_name, issued_at, device_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.facilityId,
      input.requisitionId ?? null,
      supplier.code,
      input.storeCode.trim().toUpperCase(),
      reference,
      input.expectedOn ?? null,
      total,
      input.byUserId,
      input.byUserName,
      now(),
      input.deviceCode,
      now(),
    );

    for (const line of input.lines) {
      const product = getProduct(line.productCode)!;
      run(
        `INSERT INTO purchase_order_lines (po_id, product_code, product_name, quantity, unit_cost_cents)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        product.code,
        product.name,
        line.quantity,
        line.unitCostCents,
      );
    }

    if (input.requisitionId) {
      run(`UPDATE requisitions SET status = 'ordered' WHERE id = ?`, input.requisitionId);
    }

    audit({
      action: "purchase_order_issued",
      entity: "purchase_order",
      entityId: id,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      detail: { reference, supplier: supplier.code, totalCents: total, lines: input.lines.length },
    });
    return id;
  });
}

export function getPurchaseOrder(id: string): PurchaseOrder | undefined {
  return get<PurchaseOrder>(`SELECT * FROM purchase_orders WHERE id = ?`, id);
}

export function poLines(poId: string) {
  return all<{
    id: number;
    product_code: string;
    product_name: string;
    quantity: number;
    unit_cost_cents: number;
  }>(`SELECT * FROM purchase_order_lines WHERE po_id = ? ORDER BY id`, poId);
}

export function cancelPurchaseOrder(input: {
  poId: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const po = getPurchaseOrder(input.poId);
  if (!po) throw new ProcurementError("no such purchase order");
  if (po.status !== "issued") {
    throw new ProcurementError(`that order is ${po.status.replace("_", " ")} — something has already arrived against it`);
  }
  if (!input.reason.trim()) throw new ProcurementError("cancelling an order must record why");

  run(`UPDATE purchase_orders SET status = 'cancelled', cancel_reason = ? WHERE id = ?`, input.reason.trim(), po.id);
  audit({
    action: "purchase_order_cancelled",
    entity: "purchase_order",
    entityId: po.id,
    facilityId: po.facility_id,
    actorId: input.byUserId,
    actorName: input.byUserName,
    purpose: "administration",
    detail: { reference: po.reference, reason: input.reason },
  });
}

// -------------------------------------------------------------- the delivery

/**
 * Receive a delivery against a purchase order.
 *
 * Creates the goods received note and the stock batches together, so there is
 * no window in which a delivery exists on paper and not on the shelf, and a
 * recall reaches from the batch to the delivery to the supplier.
 *
 * Quantities are what was counted at the door. Ordered 100 and delivered 80 is
 * a fact about the order, not a correction to it.
 */
export function receiveDelivery(input: {
  poId: string;
  deliveryNote?: string;
  note?: string;
  lines: {
    productCode: string;
    quantity: number;
    batchNumber: string;
    expiresOn: string;
    rejected?: number;
    rejectReason?: string;
  }[];
  byUserId: number;
  byUserName: string;
  deviceCode: string;
}): { grnId: string; reference: string; shortLines: number } {
  const po = getPurchaseOrder(input.poId);
  if (!po) throw new ProcurementError("no such purchase order");
  if (po.status === "cancelled") throw new ProcurementError("that order was cancelled");
  if (po.status === "closed") throw new ProcurementError("that order is closed");
  if (input.lines.length === 0) throw new ProcurementError("a delivery must record at least one line");

  const ordered = new Map(poLines(po.id).map((l) => [l.product_code, l]));
  for (const line of input.lines) {
    const code = line.productCode.trim().toUpperCase();
    if (!ordered.has(code)) {
      // Receiving something nobody ordered is how unordered stock — and the
      // invoice for it — enters a facility.
      throw new ProcurementError(`${code} is not on ${po.reference}. A delivery cannot bring what was not ordered.`);
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 0) {
      throw new ProcurementError(`the quantity for ${code} must be a whole number`);
    }
  }

  const grnId = mintLocalId(input.deviceCode, 8);
  const reference = `GRN-${today().replace(/-/g, "")}-${grnId.split("-").pop()}`;

  return tx(() => {
    run(
      `INSERT INTO goods_received
         (id, po_id, reference, delivery_note, received_by, receiver_name, received_at, note, device_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      grnId,
      po.id,
      reference,
      input.deliveryNote?.trim() ?? "",
      input.byUserId,
      input.byUserName,
      now(),
      input.note?.trim() ?? "",
      input.deviceCode,
      now(),
    );

    for (const line of input.lines) {
      const code = line.productCode.trim().toUpperCase();
      const orderedLine = ordered.get(code)!;
      let batchId: string | null = null;

      if (line.quantity > 0) {
        // receiveStock does the rest of the checking: PPB registration, batch
        // number, expiry in the future. A delivery that fails those is refused
        // at the door, which is the only place refusing it is cheap.
        batchId = receiveStock({
          storeCode: po.store_code,
          productCode: code,
          batchNumber: line.batchNumber,
          expiresOn: line.expiresOn,
          quantity: line.quantity,
          unitCostCents: orderedLine.unit_cost_cents,
          reference,
          deviceCode: input.deviceCode,
          byUserId: input.byUserId,
          byUserName: input.byUserName,
        });
      }

      run(
        `INSERT INTO goods_received_lines
           (grn_id, product_code, quantity, batch_number, expires_on, batch_id, rejected, reject_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        grnId,
        code,
        line.quantity,
        line.batchNumber.trim(),
        line.expiresOn,
        batchId,
        line.rejected ?? 0,
        line.rejectReason?.trim() ?? "",
      );
    }

    // Received in full, or only in part. Worked out from the rows rather than
    // asserted by whoever is standing at the door.
    const receivedSoFar = receivedTotals(po.id);
    const complete = [...ordered.values()].every((l) => (receivedSoFar.get(l.product_code) ?? 0) >= l.quantity);
    run(`UPDATE purchase_orders SET status = ? WHERE id = ?`, complete ? "received" : "part_received", po.id);

    const shortLines = [...ordered.values()].filter(
      (l) => (receivedSoFar.get(l.product_code) ?? 0) < l.quantity,
    ).length;

    audit({
      action: "goods_received",
      entity: "purchase_order",
      entityId: po.id,
      facilityId: po.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      detail: {
        grn: reference,
        deliveryNote: input.deliveryNote ?? null,
        lines: input.lines.length,
        rejected: input.lines.reduce((sum, l) => sum + (l.rejected ?? 0), 0),
        shortLines,
        complete,
      },
    });

    return { grnId, reference, shortLines };
  });
}

/** Total quantity received against each product on an order, across all GRNs. */
function receivedTotals(poId: string): Map<string, number> {
  const rows = all<{ product_code: string; total: number }>(
    `SELECT l.product_code, SUM(l.quantity) AS total
       FROM goods_received_lines l
       JOIN goods_received g ON g.id = l.grn_id
      WHERE g.po_id = ?
      GROUP BY l.product_code`,
    poId,
  );
  return new Map(rows.map((r) => [r.product_code, r.total]));
}

export function deliveriesFor(poId: string) {
  return all<{
    id: string;
    reference: string;
    delivery_note: string;
    receiver_name: string;
    received_at: string;
    note: string;
  }>(`SELECT * FROM goods_received WHERE po_id = ? ORDER BY received_at`, poId);
}

export function deliveryLines(grnId: string) {
  return all<{
    product_code: string;
    quantity: number;
    batch_number: string;
    expires_on: string;
    batch_id: string | null;
    rejected: number;
    reject_reason: string;
  }>(`SELECT * FROM goods_received_lines WHERE grn_id = ? ORDER BY id`, grnId);
}

// --------------------------------------------------------------- the invoice

export function recordInvoice(input: {
  poId: string;
  invoiceNo: string;
  invoiceDate: string;
  etimsNumber?: string;
  lines: { productCode: string; quantity: number; unitCostCents: number }[];
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const po = getPurchaseOrder(input.poId);
  if (!po) throw new ProcurementError("no such purchase order");
  if (!input.invoiceNo.trim()) throw new ProcurementError("an invoice needs its number");
  if (input.lines.length === 0) throw new ProcurementError("an invoice needs at least one line");

  const duplicate = get<{ id: string }>(
    `SELECT id FROM supplier_invoices WHERE supplier_code = ? AND invoice_no = ?`,
    po.supplier_code,
    input.invoiceNo.trim().toUpperCase(),
  );
  if (duplicate) {
    // Paying the same invoice twice is the simplest fraud there is, and the
    // easiest to make impossible.
    throw new ProcurementError(`invoice ${input.invoiceNo} from this supplier is already recorded`);
  }

  const id = mintLocalId(input.deviceCode, 8);
  const total = input.lines.reduce((sum, l) => sum + l.quantity * l.unitCostCents, 0);

  return tx(() => {
    run(
      `INSERT INTO supplier_invoices
         (id, po_id, supplier_code, invoice_no, invoice_date, total_cents, etims_number,
          status, recorded_by, recorder_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?)`,
      id,
      po.id,
      po.supplier_code,
      input.invoiceNo.trim().toUpperCase(),
      input.invoiceDate,
      total,
      input.etimsNumber?.trim().toUpperCase() ?? "",
      input.byUserId,
      input.byUserName,
      now(),
    );
    for (const line of input.lines) {
      run(
        `INSERT INTO supplier_invoice_lines (invoice_id, product_code, quantity, unit_cost_cents)
         VALUES (?, ?, ?, ?)`,
        id,
        line.productCode.trim().toUpperCase(),
        line.quantity,
        line.unitCostCents,
      );
    }
    return id;
  });
}

export interface MatchLine {
  productCode: string;
  productName: string;
  orderedQuantity: number;
  receivedQuantity: number;
  invoicedQuantity: number;
  orderedUnitCents: number;
  invoicedUnitCents: number;
  /** Invoiced for more than arrived. */
  overInvoiced: boolean;
  /** Invoiced at a price nobody agreed. */
  priceVariance: boolean;
  /** What the difference is worth, in cents. Positive means overcharged. */
  varianceCents: number;
  notes: string[];
}

export interface MatchResult {
  ok: boolean;
  lines: MatchLine[];
  invoicedCents: number;
  /** What the facility should pay: received quantity at the ordered price. */
  payableCents: number;
  varianceCents: number;
  problems: string[];
}

/**
 * The three-way match: order, delivery, invoice.
 *
 * Worked out line by line from the rows rather than trusted from a total. The
 * payable figure is the received quantity at the ordered price — which is the
 * definition of what a facility actually owes, and is almost never the number
 * on the invoice when something has gone wrong.
 */
export function matchInvoice(invoiceId: string): MatchResult {
  const invoice = getInvoice(invoiceId);
  if (!invoice) throw new ProcurementError("no such invoice");

  const ordered = new Map(poLines(invoice.po_id).map((l) => [l.product_code, l]));
  const received = receivedTotals(invoice.po_id);
  const invoiced = all<{ product_code: string; quantity: number; unit_cost_cents: number }>(
    `SELECT * FROM supplier_invoice_lines WHERE invoice_id = ?`,
    invoiceId,
  );

  const lines: MatchLine[] = [];
  const problems: string[] = [];
  let payable = 0;

  for (const line of invoiced) {
    const orderedLine = ordered.get(line.product_code);
    const receivedQuantity = received.get(line.product_code) ?? 0;
    const notes: string[] = [];

    if (!orderedLine) {
      problems.push(`${line.product_code} is invoiced but was never ordered`);
      lines.push({
        productCode: line.product_code,
        productName: getProduct(line.product_code)?.name ?? line.product_code,
        orderedQuantity: 0,
        receivedQuantity,
        invoicedQuantity: line.quantity,
        orderedUnitCents: 0,
        invoicedUnitCents: line.unit_cost_cents,
        overInvoiced: true,
        priceVariance: true,
        varianceCents: line.quantity * line.unit_cost_cents,
        notes: ["never ordered"],
      });
      continue;
    }

    const overInvoiced = line.quantity > receivedQuantity;
    const priceVariance = line.unit_cost_cents !== orderedLine.unit_cost_cents;

    // What is actually owed on this line: what arrived, at what was agreed.
    const linePayable = Math.min(line.quantity, receivedQuantity) * orderedLine.unit_cost_cents;
    payable += linePayable;

    if (overInvoiced) {
      notes.push(`invoiced ${line.quantity}, received ${receivedQuantity}`);
      problems.push(
        `${orderedLine.product_name}: invoiced ${line.quantity} but ${receivedQuantity} arrived`,
      );
    }
    if (priceVariance) {
      notes.push(
        `${formatKes(line.unit_cost_cents)} each, agreed ${formatKes(orderedLine.unit_cost_cents)}`,
      );
      problems.push(
        `${orderedLine.product_name}: invoiced at ${formatKes(line.unit_cost_cents)}, order says ${formatKes(orderedLine.unit_cost_cents)}`,
      );
    }

    lines.push({
      productCode: line.product_code,
      productName: orderedLine.product_name,
      orderedQuantity: orderedLine.quantity,
      receivedQuantity,
      invoicedQuantity: line.quantity,
      orderedUnitCents: orderedLine.unit_cost_cents,
      invoicedUnitCents: line.unit_cost_cents,
      overInvoiced,
      priceVariance,
      varianceCents: line.quantity * line.unit_cost_cents - linePayable,
      notes,
    });
  }

  const variance = invoice.total_cents - payable;

  return {
    ok: problems.length === 0,
    lines,
    invoicedCents: invoice.total_cents,
    payableCents: payable,
    varianceCents: variance,
    problems,
  };
}

/**
 * Run the match and record what it found.
 *
 * A mismatch queries the invoice rather than blocking it. Blocking would move
 * the payment off the system, which is worse than a payment the system can
 * explain: the point is that somebody has to decide, in writing, to pay a
 * figure the match did not agree with.
 */
export function runMatch(input: {
  invoiceId: string;
  facilityId: number;
  byUserId: number | null;
  byUserName: string;
}): MatchResult {
  const invoice = getInvoice(input.invoiceId);
  if (!invoice) throw new ProcurementError("no such invoice");
  if (invoice.status === "paid") throw new ProcurementError("that invoice has been paid");

  const result = matchInvoice(input.invoiceId);

  tx(() => {
    run(
      `UPDATE supplier_invoices SET status = ?, query_note = ? WHERE id = ?`,
      result.ok ? "matched" : "queried",
      result.problems.join("; "),
      invoice.id,
    );

    if (!result.ok) {
      notify({
        facilityId: input.facilityId,
        ownerRole: "admin",
        severity: result.varianceCents > 0 ? "critical" : "warning",
        kind: "invoice_mismatch",
        subject: `Invoice ${invoice.invoice_no} does not match — ${formatKes(Math.abs(result.varianceCents))} ${
          result.varianceCents > 0 ? "overcharged" : "difference"
        }`,
        body: `${result.problems.join("; ")}. Payable on what arrived at the agreed price: ${formatKes(result.payableCents)}.`,
        entity: "supplier_invoice",
        entityId: invoice.id,
        dedupeKey: `invoice_mismatch:${invoice.id}`,
      });
    }

    audit({
      action: "invoice_matched",
      entity: "supplier_invoice",
      entityId: invoice.id,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: {
        invoiceNo: invoice.invoice_no,
        ok: result.ok,
        invoicedCents: result.invoicedCents,
        payableCents: result.payableCents,
        varianceCents: result.varianceCents,
        problems: result.problems,
      },
    });
  });

  return result;
}

/**
 * Approve an invoice for payment.
 *
 * Refuses an unmatched one, and requires a written reason to approve one the
 * match queried. That reason is the record that somebody chose to pay it.
 */
export function approveInvoice(input: {
  invoiceId: string;
  overrideReason?: string;
  byUserId: number;
  byUserName: string;
}): void {
  const invoice = getInvoice(input.invoiceId);
  if (!invoice) throw new ProcurementError("no such invoice");
  if (invoice.status === "received") {
    throw new ProcurementError("that invoice has not been matched against the order and the delivery yet");
  }
  if (invoice.status === "paid") throw new ProcurementError("that invoice has been paid");
  if (invoice.status === "queried" && !input.overrideReason?.trim()) {
    throw new ProcurementError(
      `the match queried this invoice — ${invoice.query_note}. Approving it anyway must record why.`,
    );
  }
  if (invoice.recorded_by === input.byUserId) {
    throw new ProcurementError(
      "the person who recorded an invoice cannot approve it for payment",
    );
  }

  tx(() => {
    run(
      `UPDATE supplier_invoices SET status = 'approved', approved_by = ?, approver_name = ?, approved_at = ?,
              query_note = CASE WHEN ? <> '' THEN query_note || ' | approved anyway: ' || ? ELSE query_note END
        WHERE id = ?`,
      input.byUserId,
      input.byUserName,
      now(),
      input.overrideReason?.trim() ?? "",
      input.overrideReason?.trim() ?? "",
      invoice.id,
    );
    audit({
      action: "invoice_approved",
      entity: "supplier_invoice",
      entityId: invoice.id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: {
        invoiceNo: invoice.invoice_no,
        totalCents: invoice.total_cents,
        wasQueried: invoice.status === "queried",
        overrideReason: input.overrideReason ?? null,
      },
    });
  });
}

export function payInvoice(input: {
  invoiceId: string;
  paymentRef: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const invoice = getInvoice(input.invoiceId);
  if (!invoice) throw new ProcurementError("no such invoice");
  if (invoice.status !== "approved") {
    throw new ProcurementError(`that invoice is ${invoice.status} — only an approved invoice is paid`);
  }
  if (!input.paymentRef.trim()) throw new ProcurementError("a payment must record its reference");

  tx(() => {
    run(
      `UPDATE supplier_invoices SET status = 'paid', paid_at = ?, payment_ref = ? WHERE id = ?`,
      now(),
      input.paymentRef.trim(),
      invoice.id,
    );
    audit({
      action: "invoice_paid",
      entity: "supplier_invoice",
      entityId: invoice.id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { invoiceNo: invoice.invoice_no, totalCents: invoice.total_cents, reference: input.paymentRef },
    });
  });
}

export function getInvoice(id: string) {
  return get<{
    id: string;
    po_id: string;
    supplier_code: string;
    invoice_no: string;
    invoice_date: string;
    total_cents: number;
    etims_number: string;
    status: InvoiceStatus;
    query_note: string;
    approved_by: number | null;
    approver_name: string;
    approved_at: string | null;
    paid_at: string | null;
    payment_ref: string;
    recorded_by: number | null;
    recorder_name: string;
  }>(`SELECT * FROM supplier_invoices WHERE id = ?`, id);
}

export function invoicesFor(poId: string) {
  return all<{ id: string; invoice_no: string; total_cents: number; status: InvoiceStatus; query_note: string }>(
    `SELECT id, invoice_no, total_cents, status, query_note FROM supplier_invoices WHERE po_id = ? ORDER BY created_at`,
    poId,
  );
}

// --------------------------------------------------------------- worklists

export interface PoRow {
  po: PurchaseOrder;
  supplierName: string;
  lines: ReturnType<typeof poLines>;
  received: Map<string, number>;
  /** Ordered but not delivered, across all lines. */
  outstandingUnits: number;
  daysLate: number | null;
  invoices: ReturnType<typeof invoicesFor>;
}

function decoratePo(rows: (PurchaseOrder & { supplier_name: string })[]): PoRow[] {
  return rows.map((po) => {
    const lines = poLines(po.id);
    const received = receivedTotals(po.id);
    return {
      po,
      supplierName: po.supplier_name,
      lines,
      received,
      outstandingUnits: lines.reduce(
        (sum, l) => sum + Math.max(0, l.quantity - (received.get(l.product_code) ?? 0)),
        0,
      ),
      daysLate:
        po.expected_on && po.status !== "received" && po.status !== "closed"
          ? Math.max(0, Math.floor((Date.parse(today()) - Date.parse(po.expected_on)) / 86_400_000))
          : null,
      invoices: invoicesFor(po.id),
    };
  });
}

export function openOrders(facilityId: number): PoRow[] {
  const rows = all<PurchaseOrder & { supplier_name: string }>(
    `SELECT p.*, s.name AS supplier_name FROM purchase_orders p
       JOIN suppliers s ON s.code = p.supplier_code
      WHERE p.facility_id = ? AND p.status IN ('issued','part_received')`,
    facilityId,
  );
  return decoratePo(rows).sort((a, b) => (b.daysLate ?? -1) - (a.daysLate ?? -1));
}

export function orderLog(facilityId: number, limit = 50): PoRow[] {
  const rows = all<PurchaseOrder & { supplier_name: string }>(
    `SELECT p.*, s.name AS supplier_name FROM purchase_orders p
       JOIN suppliers s ON s.code = p.supplier_code
      WHERE p.facility_id = ? ORDER BY p.issued_at DESC LIMIT ?`,
    facilityId,
    limit,
  );
  return decoratePo(rows);
}

export function pendingRequisitions(facilityId: number) {
  return all<{
    id: string;
    store_code: string;
    reason: string;
    status: RequisitionStatus;
    raiser_name: string;
    raised_at: string;
    raised_by: number | null;
    lines: number;
  }>(
    `SELECT r.*, (SELECT COUNT(*) FROM requisition_lines l WHERE l.requisition_id = r.id) AS lines
       FROM requisitions r
      WHERE r.facility_id = ? AND r.status IN ('raised','approved')
      ORDER BY r.raised_at`,
    facilityId,
  );
}

/** Invoices waiting for a decision — matched, queried or not yet matched. */
export function invoicesToSettle(facilityId: number) {
  const rows = all<{
    id: string;
    po_id: string;
    invoice_no: string;
    invoice_date: string;
    total_cents: number;
    etims_number: string;
    status: InvoiceStatus;
    query_note: string;
    supplier_name: string;
    reference: string;
  }>(
    `SELECT i.*, s.name AS supplier_name, p.reference
       FROM supplier_invoices i
       JOIN purchase_orders p ON p.id = i.po_id
       JOIN suppliers s ON s.code = i.supplier_code
      WHERE p.facility_id = ? AND i.status IN ('received','matched','queried','approved')
      ORDER BY i.invoice_date`,
    facilityId,
  );
  return rows.map((i) => ({
    ...i,
    match: i.status === "received" ? null : matchInvoice(i.id),
  }));
}

export interface ProcurementSummary {
  suppliers: number;
  blockedSuppliers: number;
  requisitionsWaiting: number;
  openOrders: number;
  lateOrders: number;
  committedCents: number;
  invoicesWaiting: number;
  queriedInvoices: number;
  /** What the queried invoices are worth in overcharge, in cents. */
  varianceCents: number;
  paidCents: number;
  /** Invoices with no supplier eTIMS number — not claimable against tax. */
  withoutEtims: number;
}

export function procurementSummary(facilityId: number): ProcurementSummary {
  const open = openOrders(facilityId);
  const settle = invoicesToSettle(facilityId);

  const queried = settle.filter((i) => i.status === "queried");

  return {
    suppliers: listSuppliers().length,
    blockedSuppliers: listSuppliers(true).filter((s) => s.blocked).length,
    requisitionsWaiting: pendingRequisitions(facilityId).filter((r) => r.status === "raised").length,
    openOrders: open.length,
    lateOrders: open.filter((o) => (o.daysLate ?? 0) > 0).length,
    committedCents: open.reduce((sum, o) => sum + o.po.total_cents, 0),
    invoicesWaiting: settle.length,
    queriedInvoices: queried.length,
    varianceCents: queried.reduce((sum, i) => sum + Math.max(0, i.match?.varianceCents ?? 0), 0),
    paidCents:
      get<{ total: number }>(
        `SELECT COALESCE(SUM(i.total_cents), 0) AS total FROM supplier_invoices i
           JOIN purchase_orders p ON p.id = i.po_id
          WHERE p.facility_id = ? AND i.status = 'paid'`,
        facilityId,
      )?.total ?? 0,
    withoutEtims: settle.filter((i) => !i.etims_number).length,
  };
}

/** ⚠️ Demonstration suppliers. A real facility loads its own approved list. */
export function seedSuppliers(): void {
  defineSupplier({
    code: "KEMSA", name: "Kenya Medical Supplies Authority",
    kraPin: "P051100000A", ppbLicence: "PPB-WHL-0001", ppbExpiresOn: "2027-06-30",
    agpoCategory: "none", phone: "0709-871000",
  });
  defineSupplier({
    code: "MEDS", name: "Mission for Essential Drugs and Supplies",
    kraPin: "P051200000B", ppbLicence: "PPB-WHL-0044", ppbExpiresOn: "2027-03-31",
    agpoCategory: "none", phone: "020-2418000",
  });
  defineSupplier({
    code: "SURGIPHARM", name: "Surgipharm Limited",
    kraPin: "P051300000C", ppbLicence: "PPB-WHL-0112", ppbExpiresOn: "2026-12-31",
    agpoCategory: "none", phone: "020-2532000",
  });
  defineSupplier({
    code: "AFYA-YOUTH", name: "Afya Youth Suppliers Limited",
    kraPin: "P051400000D", ppbLicence: "PPB-WHL-0309", ppbExpiresOn: "2027-01-31",
    agpoCategory: "youth", agpoCertificate: "AGPO/Y/2026/4471", phone: "0722-000111",
  });
}
