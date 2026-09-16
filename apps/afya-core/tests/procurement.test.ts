/**
 * M42 Procurement.
 *
 * Three controls against the three ways a facility's money leaks: paying for
 * goods nobody can show arrived, paying a price nobody agreed, and one person
 * controlling the chain from request to payment. Everything else in this module
 * is paperwork around those three.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-proc-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const Q = await import("../src/lib/procurement.ts");
const S = await import("../src/lib/inventory.ts");
const N = await import("../src/lib/notifications.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get, today } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, pharmacistId } = seedDemo();
registerDevice({ facilityId, code: "PRC1", label: "Procurement", byUserId: adminId, byUserName: "admin" });
Q.seedSuppliers();

const DEV = "PRC1";
const STORE = "MAIN";
// Three different people, because the module is about them being different.
const STOREKEEPER = { byUserId: pharmacistId!, byUserName: "Grace Kimani" };
const APPROVER = { byUserId: adminId!, byUserName: "Facility Administrator" };
const CLERK = { byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru" };

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** An approved requisition, ready to order against. */
function approved(reason = "Stock down to two weeks of cover") {
  const id = Q.raiseRequisition({
    facilityId, storeCode: STORE, reason,
    lines: [
      { productCode: "PARA-500", quantity: 5000 },
      { productCode: "AMOX-500", quantity: 2000 },
    ],
    ...STOREKEEPER, deviceCode: DEV,
  });
  Q.decideRequisition({ requisitionId: id, approve: true, ...APPROVER });
  return id;
}

/** A purchase order for 1000 paracetamol at 4 shillings each. */
function order(over: Partial<Parameters<typeof Q.issuePurchaseOrder>[0]> = {}) {
  return Q.issuePurchaseOrder({
    facilityId, supplierCode: "KEMSA", storeCode: STORE,
    expectedOn: inDays(7),
    lines: [{ productCode: "PARA-500", quantity: 1000, unitCostCents: 400 }],
    ...APPROVER, deviceCode: DEV, ...over,
  });
}

// ================================================================= suppliers

test("a supplier without a current PPB licence cannot supply medicines", () => {
  Q.defineSupplier({ code: "NOLICENCE", name: "Cheap Drugs Kenya", kraPin: "P051999999X" });
  assert.equal(Q.canSupplyMedicines("NOLICENCE").ok, false);
  assert.match(Q.canSupplyMedicines("NOLICENCE").why, /no PPB licence recorded/);

  Q.defineSupplier({
    code: "EXPIRED", name: "Lapsed Supplies Limited",
    ppbLicence: "PPB-WHL-9999", ppbExpiresOn: "2020-01-31",
  });
  assert.match(Q.canSupplyMedicines("EXPIRED").why, /expired on 2020-01-31/);

  assert.equal(Q.canSupplyMedicines("KEMSA").ok, true);
});

test("the licence is checked at the order, not at the invoice", () => {
  // By the invoice the drugs are on the shelf and somebody has taken them.
  assert.throws(
    () => order({ supplierCode: "NOLICENCE" }),
    /cannot supply medicines — no PPB licence recorded/,
  );
});

test("blocking a supplier records why, and stops them being ordered from", () => {
  Q.defineSupplier({ code: "DODGY", name: "Dodgy Pharma", ppbLicence: "PPB-WHL-4444", ppbExpiresOn: "2027-01-01" });
  assert.throws(() => Q.blockSupplier({ code: "DODGY", reason: "  ", ...APPROVER }), /must record why/);

  Q.blockSupplier({ code: "DODGY", reason: "Two deliveries of short-dated stock in one quarter", ...APPROVER });
  assert.throws(() => order({ supplierCode: "DODGY" }), /is blocked — Two deliveries/);
  assert.ok(!Q.listSuppliers().some((s) => s.code === "DODGY"), "and they leave the list you order from");
  assert.ok(Q.listSuppliers(true).some((s) => s.code === "DODGY"), "but not the list you audit");
});

test("an AGPO supplier carries its category and certificate", () => {
  const youth = Q.getSupplier("AFYA-YOUTH")!;
  assert.equal(youth.agpo_category, "youth");
  assert.match(youth.agpo_certificate!, /^AGPO\/Y\//);
});

// ============================================================== requisitions

test("a requisition records what the store had when it was raised", () => {
  const id = Q.raiseRequisition({
    facilityId, storeCode: STORE, reason: "Routine top-up",
    lines: [{ productCode: "PARA-500", quantity: 1000 }],
    ...STOREKEEPER, deviceCode: DEV,
  });
  const [line] = Q.requisitionLines(id);
  assert.equal(line.on_hand_then, S.onHand(STORE, "PARA-500"),
    "so an approver can see whether it was justified without going to look");
});

test("a requisition must say why, and needs a line", () => {
  assert.throws(
    () => Q.raiseRequisition({ facilityId, storeCode: STORE, reason: "  ", lines: [{ productCode: "PARA-500", quantity: 1 }], ...STOREKEEPER, deviceCode: DEV }),
    /must say why/,
  );
  assert.throws(
    () => Q.raiseRequisition({ facilityId, storeCode: STORE, reason: "x", lines: [], ...STOREKEEPER, deviceCode: DEV }),
    /at least one line/,
  );
});

test("THE PERSON WHO RAISED A REQUISITION CANNOT APPROVE IT", () => {
  const id = Q.raiseRequisition({
    facilityId, storeCode: STORE, reason: "Self-approval attempt",
    lines: [{ productCode: "PARA-500", quantity: 100 }],
    ...STOREKEEPER, deviceCode: DEV,
  });
  assert.throws(
    () => Q.decideRequisition({ requisitionId: id, approve: true, ...STOREKEEPER }),
    /that is the whole point of approval/,
    "the oldest control in procurement, and the first one quietly dropped",
  );
  Q.decideRequisition({ requisitionId: id, approve: true, ...APPROVER });
  assert.equal(Q.getRequisition(id)!.status, "approved");
});

test("a rejection must say why", () => {
  const id = Q.raiseRequisition({
    facilityId, storeCode: STORE, reason: "Speculative",
    lines: [{ productCode: "PARA-500", quantity: 100_000 }],
    ...STOREKEEPER, deviceCode: DEV,
  });
  assert.throws(() => Q.decideRequisition({ requisitionId: id, approve: false, ...APPROVER }), /must say why/);
  Q.decideRequisition({
    requisitionId: id, approve: false,
    note: "A hundred thousand is two years of use — order a quarter's worth", ...APPROVER,
  });
  assert.equal(Q.getRequisition(id)!.status, "rejected");
});

test("nothing is ordered against a requisition nobody approved", () => {
  const id = Q.raiseRequisition({
    facilityId, storeCode: STORE, reason: "Unapproved",
    lines: [{ productCode: "PARA-500", quantity: 100 }],
    ...STOREKEEPER, deviceCode: DEV,
  });
  assert.throws(() => order({ requisitionId: id }), /nothing is ordered against a requisition nobody approved/);
});

// ================================================================ quotations

test("choosing a supplier must record why, especially when it is not the cheapest", () => {
  const req = approved("Quarterly order");
  Q.recordQuotation({ requisitionId: req, supplierCode: "KEMSA", totalCents: 480_000, leadDays: 21, ...CLERK, deviceCode: DEV });
  Q.recordQuotation({ requisitionId: req, supplierCode: "MEDS", totalCents: 495_000, leadDays: 7, ...CLERK, deviceCode: DEV });
  Q.recordQuotation({ requisitionId: req, supplierCode: "SURGIPHARM", totalCents: 520_000, leadDays: 3, ...CLERK, deviceCode: DEV });

  assert.equal(Q.quotationsFor(req).length, Q.EXPECTED_QUOTATIONS);
  assert.equal(Q.quotationsFor(req)[0].supplier_code, "KEMSA", "cheapest first");

  assert.throws(
    () => Q.selectQuotation({ requisitionId: req, supplierCode: "MEDS", reason: "  ", ...APPROVER }),
    /must record why/,
  );

  // Not the cheapest, and that is fine — as long as the reason is on the record.
  Q.selectQuotation({
    requisitionId: req, supplierCode: "MEDS",
    reason: "KEMSA quoted 21 days and we have two weeks of cover", ...APPROVER,
  });
  const chosen = Q.quotationsFor(req).find((q) => q.selected)!;
  assert.equal(chosen.supplier_code, "MEDS");
  assert.match(chosen.selection_reason, /two weeks of cover/);

  const entry = get<{ detail: string }>(
    `SELECT detail FROM audit_log WHERE action = 'quotation_selected' ORDER BY id DESC LIMIT 1`,
  )!;
  assert.match(entry.detail, /"notCheapest":true/, "the audit trail says so without anybody having to notice");
});

test("a quotation from a blocked supplier is refused", () => {
  const req = approved();
  assert.throws(
    () => Q.recordQuotation({ requisitionId: req, supplierCode: "DODGY", totalCents: 100_000, ...CLERK, deviceCode: DEV }),
    /is blocked/,
  );
});

test("selecting a supplier who never quoted is refused", () => {
  const req = approved();
  Q.recordQuotation({ requisitionId: req, supplierCode: "KEMSA", totalCents: 400_000, ...CLERK, deviceCode: DEV });
  assert.throws(
    () => Q.selectQuotation({ requisitionId: req, supplierCode: "SURGIPHARM", reason: "preference", ...APPROVER }),
    /has not quoted on this requisition/,
  );
});

// ============================================================ the order

test("an order carries a reference and the agreed prices", () => {
  const id = order();
  const po = Q.getPurchaseOrder(id)!;
  assert.match(po.reference, /^PO-\d{8}-/);
  assert.equal(po.total_cents, 1000 * 400);
  assert.equal(Q.poLines(id)[0].unit_cost_cents, 400);
});

test("an order can be cancelled before anything arrives, and not after", () => {
  const id = order();
  assert.throws(() => Q.cancelPurchaseOrder({ poId: id, reason: "  ", ...APPROVER }), /must record why/);
  Q.cancelPurchaseOrder({ poId: id, reason: "Found stock in the branch store", ...APPROVER });
  assert.equal(Q.getPurchaseOrder(id)!.status, "cancelled");

  const other = order();
  Q.receiveDelivery({
    poId: other,
    lines: [{ productCode: "PARA-500", quantity: 1000, batchNumber: "P-11", expiresOn: inDays(400) }],
    ...STOREKEEPER, deviceCode: DEV,
  });
  assert.throws(
    () => Q.cancelPurchaseOrder({ poId: other, reason: "changed mind", ...APPROVER }),
    /something has already arrived against it/,
  );
});

// ============================================================= the delivery

test("a delivery cannot bring what was not ordered", () => {
  const id = order();
  assert.throws(
    () => Q.receiveDelivery({
      poId: id,
      lines: [{ productCode: "AMOX-500", quantity: 500, batchNumber: "A-1", expiresOn: inDays(300) }],
      ...STOREKEEPER, deviceCode: DEV,
    }),
    /is not on PO-.*A delivery cannot bring what was not ordered/s,
  );
});

test("receiving takes the goods into stock in the same breath", () => {
  const before = S.onHand(STORE, "PARA-500");
  const id = order();
  const { reference } = Q.receiveDelivery({
    poId: id, deliveryNote: "DN-4471",
    lines: [{ productCode: "PARA-500", quantity: 1000, batchNumber: "P-2026-01", expiresOn: inDays(500) }],
    ...STOREKEEPER, deviceCode: DEV,
  });

  assert.equal(S.onHand(STORE, "PARA-500"), before + 1000, "no window in which it exists on paper and not on the shelf");
  assert.match(reference, /^GRN-\d{8}-/);
  assert.equal(Q.getPurchaseOrder(id)!.status, "received");

  const [line] = Q.deliveryLines(Q.deliveriesFor(id)[0].id);
  assert.ok(line.batch_id, "and a recall reaches from the batch to the delivery to the supplier");
});

test("a short delivery leaves the order part received, not closed", () => {
  const id = order();
  const { shortLines } = Q.receiveDelivery({
    poId: id,
    lines: [{ productCode: "PARA-500", quantity: 800, batchNumber: "P-2026-02", expiresOn: inDays(500) }],
    ...STOREKEEPER, deviceCode: DEV,
  });
  assert.equal(shortLines, 1);
  assert.equal(Q.getPurchaseOrder(id)!.status, "part_received", "ordered 1000, delivered 800 is a fact about the order");

  // The rest turns up later.
  Q.receiveDelivery({
    poId: id,
    lines: [{ productCode: "PARA-500", quantity: 200, batchNumber: "P-2026-03", expiresOn: inDays(500) }],
    ...STOREKEEPER, deviceCode: DEV,
  });
  assert.equal(Q.getPurchaseOrder(id)!.status, "received");
});

test("expired stock is refused at the door, which is the only place refusing it is cheap", () => {
  const id = order();
  assert.throws(
    () => Q.receiveDelivery({
      poId: id,
      lines: [{ productCode: "PARA-500", quantity: 1000, batchNumber: "OLD", expiresOn: "2020-01-01" }],
      ...STOREKEEPER, deviceCode: DEV,
    }),
    /must not be taken into stock/,
  );
});

test("a rejected quantity is recorded with its reason", () => {
  const id = order();
  Q.receiveDelivery({
    poId: id,
    lines: [{
      productCode: "PARA-500", quantity: 700, batchNumber: "P-2026-04", expiresOn: inDays(500),
      rejected: 300, rejectReason: "Three hundred tablets in crushed blisters",
    }],
    ...STOREKEEPER, deviceCode: DEV,
  });
  const [line] = Q.deliveryLines(Q.deliveriesFor(id)[0].id);
  assert.equal(line.rejected, 300);
  assert.match(line.reject_reason, /crushed blisters/);
});

// ============================================================== the match

test("a clean invoice matches, and says what is payable", () => {
  const id = order();
  Q.receiveDelivery({
    poId: id,
    lines: [{ productCode: "PARA-500", quantity: 1000, batchNumber: "P-M1", expiresOn: inDays(500) }],
    ...STOREKEEPER, deviceCode: DEV,
  });
  const invoice = Q.recordInvoice({
    poId: id, invoiceNo: "KEMSA-0001", invoiceDate: today(), etimsNumber: "0060000001",
    lines: [{ productCode: "PARA-500", quantity: 1000, unitCostCents: 400 }],
    ...CLERK, deviceCode: DEV,
  });

  const match = Q.runMatch({ invoiceId: invoice, facilityId, ...APPROVER });
  assert.equal(match.ok, true);
  assert.equal(match.payableCents, 400_000);
  assert.equal(match.varianceCents, 0);
  assert.equal(Q.getInvoice(invoice)!.status, "matched");
});

test("INVOICED FOR MORE THAN ARRIVED: the payable figure is what arrived", () => {
  const id = order();
  Q.receiveDelivery({
    poId: id,
    lines: [{ productCode: "PARA-500", quantity: 800, batchNumber: "P-M2", expiresOn: inDays(500) }],
    ...STOREKEEPER, deviceCode: DEV,
  });
  const invoice = Q.recordInvoice({
    poId: id, invoiceNo: "KEMSA-0002", invoiceDate: today(),
    lines: [{ productCode: "PARA-500", quantity: 1000, unitCostCents: 400 }],
    ...CLERK, deviceCode: DEV,
  });

  const match = Q.runMatch({ invoiceId: invoice, facilityId, ...APPROVER });
  assert.equal(match.ok, false);
  assert.equal(match.invoicedCents, 400_000);
  assert.equal(match.payableCents, 320_000, "800 that arrived, at the 400 that was agreed");
  assert.equal(match.varianceCents, 80_000);
  assert.match(match.problems[0], /invoiced 1000 but 800 arrived/);

  const alert = N.inbox(facilityId, "admin").find((n) => n.kind === "invoice_mismatch" && n.entity_id === invoice);
  assert.ok(alert);
  assert.equal(alert!.severity, "critical");
});

test("INVOICED AT A PRICE NOBODY AGREED: the order price wins", () => {
  const id = order();
  Q.receiveDelivery({
    poId: id,
    lines: [{ productCode: "PARA-500", quantity: 1000, batchNumber: "P-M3", expiresOn: inDays(500) }],
    ...STOREKEEPER, deviceCode: DEV,
  });
  const invoice = Q.recordInvoice({
    poId: id, invoiceNo: "KEMSA-0003", invoiceDate: today(),
    lines: [{ productCode: "PARA-500", quantity: 1000, unitCostCents: 550 }],
    ...CLERK, deviceCode: DEV,
  });

  const match = Q.runMatch({ invoiceId: invoice, facilityId, ...APPROVER });
  assert.equal(match.ok, false);
  assert.equal(match.payableCents, 400_000, "what arrived, at what was agreed");
  assert.equal(match.varianceCents, 150_000);
  assert.match(match.problems[0], /order says/);
  assert.equal(match.lines[0].priceVariance, true);
});

test("a line invoiced that was never ordered is caught", () => {
  const id = order();
  Q.receiveDelivery({
    poId: id,
    lines: [{ productCode: "PARA-500", quantity: 1000, batchNumber: "P-M4", expiresOn: inDays(500) }],
    ...STOREKEEPER, deviceCode: DEV,
  });
  const invoice = Q.recordInvoice({
    poId: id, invoiceNo: "KEMSA-0004", invoiceDate: today(),
    lines: [
      { productCode: "PARA-500", quantity: 1000, unitCostCents: 400 },
      { productCode: "AMOX-500", quantity: 500, unitCostCents: 1200 },
    ],
    ...CLERK, deviceCode: DEV,
  });

  const match = Q.runMatch({ invoiceId: invoice, facilityId, ...APPROVER });
  assert.equal(match.ok, false);
  assert.match(match.problems.join(" "), /invoiced but was never ordered/);
  assert.equal(match.payableCents, 400_000, "the unordered line is worth nothing");
});

test("the same invoice number from one supplier cannot be recorded twice", () => {
  const id = order();
  Q.recordInvoice({
    poId: id, invoiceNo: "KEMSA-DUP", invoiceDate: today(),
    lines: [{ productCode: "PARA-500", quantity: 10, unitCostCents: 400 }],
    ...CLERK, deviceCode: DEV,
  });
  assert.throws(
    () => Q.recordInvoice({
      poId: id, invoiceNo: "kemsa-dup", invoiceDate: today(),
      lines: [{ productCode: "PARA-500", quantity: 10, unitCostCents: 400 }],
      ...CLERK, deviceCode: DEV,
    }),
    /already recorded/,
    "paying the same invoice twice is the simplest fraud there is",
  );
});

// ============================================================== approval

test("an unmatched invoice cannot be approved", () => {
  const id = order();
  const invoice = Q.recordInvoice({
    poId: id, invoiceNo: "KEMSA-0005", invoiceDate: today(),
    lines: [{ productCode: "PARA-500", quantity: 10, unitCostCents: 400 }],
    ...CLERK, deviceCode: DEV,
  });
  assert.throws(
    () => Q.approveInvoice({ invoiceId: invoice, ...APPROVER }),
    /has not been matched against the order and the delivery/,
  );
});

test("the person who recorded an invoice cannot approve it", () => {
  const id = order();
  Q.receiveDelivery({
    poId: id,
    lines: [{ productCode: "PARA-500", quantity: 1000, batchNumber: "P-A1", expiresOn: inDays(500) }],
    ...STOREKEEPER, deviceCode: DEV,
  });
  const invoice = Q.recordInvoice({
    poId: id, invoiceNo: "KEMSA-0006", invoiceDate: today(),
    lines: [{ productCode: "PARA-500", quantity: 1000, unitCostCents: 400 }],
    ...CLERK, deviceCode: DEV,
  });
  Q.runMatch({ invoiceId: invoice, facilityId, ...APPROVER });
  assert.throws(() => Q.approveInvoice({ invoiceId: invoice, ...CLERK }), /cannot approve it for payment/);
  Q.approveInvoice({ invoiceId: invoice, ...APPROVER });
  assert.equal(Q.getInvoice(invoice)!.status, "approved");
});

test("a queried invoice can still be approved, but somebody has to say so in writing", () => {
  // Blocking would move the payment off the system, which is worse than a
  // payment the system can explain.
  const id = order();
  Q.receiveDelivery({
    poId: id,
    lines: [{ productCode: "PARA-500", quantity: 900, batchNumber: "P-A2", expiresOn: inDays(500) }],
    ...STOREKEEPER, deviceCode: DEV,
  });
  const invoice = Q.recordInvoice({
    poId: id, invoiceNo: "KEMSA-0007", invoiceDate: today(),
    lines: [{ productCode: "PARA-500", quantity: 1000, unitCostCents: 400 }],
    ...CLERK, deviceCode: DEV,
  });
  Q.runMatch({ invoiceId: invoice, facilityId, ...APPROVER });

  assert.throws(
    () => Q.approveInvoice({ invoiceId: invoice, ...APPROVER }),
    /Approving it anyway must record why/,
  );
  Q.approveInvoice({
    invoiceId: invoice,
    overrideReason: "Supplier credited the 100 on the next delivery note, checked against DN-4490",
    ...APPROVER,
  });
  assert.match(Q.getInvoice(invoice)!.query_note, /approved anyway: Supplier credited/);
});

test("only an approved invoice is paid, and a payment records its reference", () => {
  const id = order();
  Q.receiveDelivery({
    poId: id,
    lines: [{ productCode: "PARA-500", quantity: 1000, batchNumber: "P-P1", expiresOn: inDays(500) }],
    ...STOREKEEPER, deviceCode: DEV,
  });
  const invoice = Q.recordInvoice({
    poId: id, invoiceNo: "KEMSA-0008", invoiceDate: today(),
    lines: [{ productCode: "PARA-500", quantity: 1000, unitCostCents: 400 }],
    ...CLERK, deviceCode: DEV,
  });
  assert.throws(() => Q.payInvoice({ invoiceId: invoice, paymentRef: "CHQ-1", ...APPROVER }), /only an approved invoice/);

  Q.runMatch({ invoiceId: invoice, facilityId, ...APPROVER });
  Q.approveInvoice({ invoiceId: invoice, ...APPROVER });
  assert.throws(() => Q.payInvoice({ invoiceId: invoice, paymentRef: "  ", ...APPROVER }), /must record its reference/);

  Q.payInvoice({ invoiceId: invoice, paymentRef: "EFT-2026-0917", ...APPROVER });
  assert.equal(Q.getInvoice(invoice)!.status, "paid");
  assert.throws(() => Q.runMatch({ invoiceId: invoice, facilityId, ...APPROVER }), /has been paid/);
});

// ============================================================== worklists

test("a late order sorts to the top of the open list", () => {
  const late = order({ expectedOn: inDays(-10) });
  const open = Q.openOrders(facilityId);
  assert.equal(open[0].po.id, late);
  assert.equal(open[0].daysLate, 10);
  assert.ok(open[0].outstandingUnits > 0);
});

test("the summary counts what a procurement office is judged on", () => {
  const s = Q.procurementSummary(facilityId);
  assert.ok(s.suppliers >= 4);
  assert.ok(s.blockedSuppliers >= 1);
  assert.ok(s.openOrders >= 1);
  assert.ok(s.lateOrders >= 1);
  assert.ok(s.committedCents > 0);
  assert.ok(s.queriedInvoices >= 1);
  assert.ok(s.varianceCents > 0, "and what the queried ones are worth in overcharge");
  assert.ok(s.paidCents > 0);
  assert.ok(s.withoutEtims >= 1, "an invoice with no eTIMS number may not be claimable against tax");
});

// ================================================================== audit

test("every step of the chain is on the audit chain, and it verifies", () => {
  const count = (action: string) =>
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`, action)!.n;

  assert.ok(count("requisition_raised") >= 5);
  assert.ok(count("requisition_approved") >= 3);
  assert.ok(count("requisition_rejected") >= 1);
  assert.ok(count("quotation_selected") >= 1);
  assert.ok(count("purchase_order_issued") >= 10);
  assert.ok(count("goods_received") >= 8);
  assert.ok(count("invoice_matched") >= 6);
  assert.ok(count("invoice_approved") >= 2);
  assert.ok(count("invoice_paid") >= 1);
  assert.ok(count("supplier_blocked") >= 1);

  const v = verifyAuditChain();
  assert.equal(v.ok, true);
});
