/**
 * M41 Inventory & Stores and M40 Pharmacy & Dispensing.
 *
 * The commercially important test in this file is the last section: ONE EVENT,
 * FOUR CONSEQUENCES. A pharmacist hands medicine over once, and the stock
 * ledger, the bill, the prescription and the controlled register all move
 * together. Every re-keyed number is a number that eventually disagrees.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-stock-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const { seedDemo } = await import("../src/lib/seed.ts");
const S = await import("../src/lib/inventory.ts");
const Ph = await import("../src/lib/pharmacy.ts");
const P = await import("../src/lib/patients.ts");
const E = await import("../src/lib/encounters.ts");
const Rx = await import("../src/lib/prescribing.ts");
const B = await import("../src/lib/billing.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get, all, run } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId, pharmacistId } = seedDemo();
registerDevice({ facilityId, code: "STK1", label: "Store bench", byUserId: adminId, byUserName: "admin" });

const DEV = "STK1";
const STORE = "PHARM";
const KEEPER = { byUserId: adminId, byUserName: "Facility Administrator" };
const PHARMACIST = { dispenserId: pharmacistId, dispenserName: "Grace Kimani" };

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let nid = 50_000_000;
function newPatient(given: string): string {
  return P.registerPatient({
    facilityId, deviceCode: DEV, givenName: given, familyName: "Stock", sex: "female",
    nationalId: String(++nid), byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
}

/** An open consultation with a prescription on it. */
function prescribed(product: string, quantity: number): { mrn: string; enc: string; rx: string } {
  const mrn = newPatient("Patient");
  const enc = E.openEncounter({
    facilityId, patientMrn: mrn, kind: "outpatient",
    clinicianId, clinicianName: "Dr. Achieng Wanjiru", deviceCode: DEV,
  });
  E.addDiagnosis({ encounterId: enc, code: "1F40", byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru", deviceCode: DEV });
  E.writeNote({
    encounterId: enc, complaint: "Fever", assessment: "Falciparum malaria", plan: "Treat",
    authorId: clinicianId, authorName: "Dr. Achieng Wanjiru", deviceCode: DEV,
  });
  const rx = Rx.prescribe({
    encounterId: enc, productCode: product, dose: "1 tab", frequency: "BD", quantity,
    prescriberId: clinicianId, prescriberName: "Dr. Achieng Wanjiru", deviceCode: DEV,
  });
  return { mrn, enc, rx };
}

// ================================================================ M41 stores

test("a clinic is seeded with a store that receives and a counter that dispenses", () => {
  const stores = S.listStores(facilityId);
  assert.deepEqual(stores.map((s) => s.code).sort(), ["MAIN", "PHARM"]);
  assert.equal(S.getStore("PHARM")!.dispensing, 1);
  assert.equal(S.getStore("MAIN")!.dispensing, 0, "stock must not leave from somewhere nobody is counting");
});

test("a delivery is refused without a batch number and an expiry date", () => {
  const base = {
    storeCode: STORE, productCode: "PARA-500", quantity: 100,
    deviceCode: DEV, ...KEEPER,
  };
  assert.throws(() => S.receiveStock({ ...base, batchNumber: " ", expiresOn: inDays(400) }), /batch number/);
  assert.throws(() => S.receiveStock({ ...base, batchNumber: "B1", expiresOn: "next year" }), /YYYY-MM-DD/);
  assert.throws(() => S.receiveStock({ ...base, batchNumber: "B1", expiresOn: inDays(-1) }), /must not be taken into stock/);
  assert.throws(() => S.receiveStock({ ...base, batchNumber: "B1", expiresOn: inDays(400), quantity: 0 }), /greater than zero/);
});

test("a product with no PPB registration cannot be taken into stock at all", () => {
  Rx.importProducts({
    source: "test",
    products: [{ code: "UNREG-1", name: "Unregistered tonic", genericName: "tonic", form: "syrup", strength: "x" }],
    byUserName: "test",
  });
  assert.throws(
    () => S.receiveStock({
      storeCode: STORE, productCode: "UNREG-1", batchNumber: "U1", expiresOn: inDays(300),
      quantity: 10, deviceCode: DEV, ...KEEPER,
    }),
    /no PPB registration/,
  );
});

test("a delivery lands in a batch and shows on the shelf", () => {
  const id = S.receiveStock({
    storeCode: STORE, productCode: "PARA-500", batchNumber: "PA-1001", expiresOn: inDays(400),
    quantity: 500, unitCostCents: 120, deviceCode: DEV, ...KEEPER,
  });
  assert.ok(id);
  assert.equal(S.onHand(STORE, "PARA-500"), 500);

  const card = S.stockCard(id);
  assert.equal(card.length, 1);
  assert.equal(card[0].kind, "receipt");
  assert.equal(card[0].balance_after, 500, "the card reads without replaying the whole ledger");
});

test("the same batch delivered again adds to it, and a contradictory expiry is refused", () => {
  S.receiveStock({
    storeCode: STORE, productCode: "PARA-500", batchNumber: "PA-1001", expiresOn: inDays(400),
    quantity: 100, deviceCode: DEV, ...KEEPER,
  });
  assert.equal(S.onHand(STORE, "PARA-500"), 600);

  assert.throws(
    () => S.receiveStock({
      storeCode: STORE, productCode: "PARA-500", batchNumber: "PA-1001", expiresOn: inDays(200),
      quantity: 10, deviceCode: DEV, ...KEEPER,
    }),
    /check the pack/,
  );
});

test("picking is first-expiry-first-out, not first-in-first-out", () => {
  S.receiveStock({
    storeCode: STORE, productCode: "AMOX-500", batchNumber: "AM-LATE", expiresOn: inDays(500),
    quantity: 60, deviceCode: DEV, ...KEEPER,
  });
  // Received second, expires first — this is the one that must go out.
  S.receiveStock({
    storeCode: STORE, productCode: "AMOX-500", batchNumber: "AM-SOON", expiresOn: inDays(40),
    quantity: 30, deviceCode: DEV, ...KEEPER,
  });

  const plan = S.allocate(STORE, "AMOX-500", 40);
  assert.equal(plan.allocated, 40);
  assert.equal(plan.short, 0);
  assert.deepEqual(plan.allocations.map((a) => a.batchNumber), ["AM-SOON", "AM-LATE"]);
  assert.deepEqual(plan.allocations.map((a) => a.quantity), [30, 10], "the soonest expiry is emptied first");
});

test("an expired batch is not stock, whatever is on the shelf", () => {
  const id = S.receiveStock({
    storeCode: STORE, productCode: "ORS-1L", batchNumber: "OR-OLD", expiresOn: inDays(2),
    quantity: 40, deviceCode: DEV, ...KEEPER,
  });
  assert.equal(S.onHand(STORE, "ORS-1L"), 40);

  // Ask as at a date after it has expired.
  const later = inDays(10);
  assert.equal(S.onHand(STORE, "ORS-1L", later), 0);
  assert.equal(S.allocate(STORE, "ORS-1L", 5, later).allocated, 0);
  assert.equal(S.pickable(STORE, "ORS-1L", later).length, 0);
  assert.ok(S.stockCard(id).length > 0, "but the batch and its history are still there");
});

test("a quarantined batch stops being pickable without leaving the books", () => {
  S.receiveStock({
    storeCode: STORE, productCode: "CTX-960", batchNumber: "CT-RECALL", expiresOn: inDays(300),
    quantity: 90, deviceCode: DEV, ...KEEPER,
  });
  const batch = S.pickable(STORE, "CTX-960")[0];

  assert.throws(() => S.quarantineBatch({ batchId: batch.id, reason: " ", ...KEEPER }), /record why/);
  S.quarantineBatch({ batchId: batch.id, reason: "PPB recall notice 2026/04", ...KEEPER });

  assert.equal(S.onHand(STORE, "CTX-960"), 0);
  assert.equal(S.allocate(STORE, "CTX-960", 1).allocated, 0);
  const still = get<{ quantity: number }>(`SELECT quantity FROM stock_batches WHERE id = ?`, batch.id)!;
  assert.equal(still.quantity, 90, "it is locked, not lost");

  S.releaseBatch({ batchId: batch.id, reason: "Recall lifted", ...KEEPER });
  assert.equal(S.onHand(STORE, "CTX-960"), 90);
});

test("a stock take posts the difference as an adjustment and refuses to do it silently", () => {
  const batch = S.pickable(STORE, "PARA-500")[0];
  const before = batch.quantity;

  assert.equal(S.recordCount({ batchId: batch.id, counted: before, reason: "", ...KEEPER }).difference, 0);
  assert.throws(
    () => S.recordCount({ batchId: batch.id, counted: before - 14, reason: "  ", ...KEEPER }),
    /under by 14/,
  );

  const result = S.recordCount({ batchId: batch.id, counted: before - 14, reason: "Monthly count — breakage", ...KEEPER });
  assert.equal(result.difference, -14);
  assert.equal(S.onHand(STORE, "PARA-500"), before - 14);

  const last = S.stockCard(batch.id).at(-1)!;
  assert.equal(last.kind, "adjustment");
  assert.equal(last.quantity, -14);
  assert.match(last.reason, /breakage/, "a discrepancy has a history, not a mystery");
});

test("the ledger can never take a batch below zero", () => {
  const batch = S.pickable(STORE, "AMOX-500")[0];
  assert.throws(
    () => S.writeOff({ batchId: batch.id, quantity: batch.quantity + 1, reason: "test", ...KEEPER }),
    /would take it to -1/,
  );
});

test("the reorder report says what to order, and says what nobody has decided", () => {
  S.setReorderLevel({ storeCode: STORE, productCode: "ZINC-20", reorderAt: 50, reorderTo: 300 });
  assert.throws(
    () => S.setReorderLevel({ storeCode: STORE, productCode: "ZINC-20", reorderAt: 50, reorderTo: 50 }),
    /every order is one unit/,
  );

  S.receiveStock({
    storeCode: STORE, productCode: "ZINC-20", batchNumber: "ZN-1", expiresOn: inDays(300),
    quantity: 20, deviceCode: DEV, ...KEEPER,
  });

  const report = S.reorderReport(STORE);
  const zinc = report.order.find((l) => l.productCode === "ZINC-20")!;
  assert.equal(zinc.orderQuantity, 280, "top back up to the reorder-to level");

  // Levels for the starter formulary are seeded; a product loaded later is not.
  assert.ok(report.noLevelSet.every((l) => l.reorderAt === null));
});

test("the expiry report ranks what is about to be wasted", () => {
  const soon = S.expiryReport(STORE, 90);
  assert.ok(soon.some((b) => b.batch_number === "AM-SOON"));
  assert.deepEqual(
    soon.map((b) => b.expires_on),
    [...soon.map((b) => b.expires_on)].sort(),
    "soonest first, because that is what turns into a write-off",
  );
});

test("the stock position is everything a storekeeper looks at, in one place", () => {
  const line = S.stockPosition(STORE).find((l) => l.productCode === "AMOX-500")!;
  assert.ok(line.onHand > 0);
  assert.equal(line.controlled, false);
  assert.ok(line.nextExpiry);
  assert.ok(line.expiringSoon > 0, "AM-SOON is inside ninety days");
  assert.equal(typeof line.quarantined, "number");

  const value = S.stockValue(STORE);
  assert.ok(value.valueCents > 0, "paracetamol was received with a unit cost");
});

// ============================================================ M40 dispensing

test("a prescription appears on the counter worklist with its stock position", () => {
  const { rx } = prescribed("PARA-500", 20);
  const item = Ph.worklist(STORE).find((w) => w.prescription.id === rx)!;
  assert.ok(item);
  assert.equal(item.outstanding, 20);
  assert.equal(item.short, false);
  assert.ok(item.onHand >= 20, "the pharmacist's first question is whether it can be filled");
});

test("dispensing takes the right batch off the shelf and records which one", () => {
  const { rx, mrn } = prescribed("AMOX-500", 10);
  const before = S.onHand(STORE, "AMOX-500");

  const result = Ph.dispense({
    prescriptionId: rx, storeCode: STORE, payerCode: "CASH",
    deviceCode: DEV, ...PHARMACIST,
  });

  assert.equal(result.quantity, 10);
  assert.equal(result.outstanding, 0);
  assert.equal(S.onHand(STORE, "AMOX-500"), before - 10);

  const batches = Ph.batchesDispensed(result.dispenseId);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].batch_number, "AM-SOON", "first expiry out");
  assert.equal(batches[0].quantity, 10);

  assert.equal(get<{ status: string }>(`SELECT status FROM prescriptions WHERE id = ?`, rx)!.status, "dispensed");
  assert.ok(Ph.dispensingHistory(mrn).some((d) => d.product_code === "AMOX-500"));
});

test("a short pharmacy dispenses what it has and says so — it is not an error", () => {
  const { rx } = prescribed("ZINC-20", 60);
  const available = S.onHand(STORE, "ZINC-20");
  assert.ok(available < 60, "the shelf is deliberately short for this test");

  const check = Ph.checkDispense({ prescriptionId: rx, storeCode: STORE, dispenserId: pharmacistId });
  assert.equal(check.canDispense, true);
  assert.ok(check.warnings.some((w) => /short/.test(w)));

  const result = Ph.dispense({ prescriptionId: rx, storeCode: STORE, payerCode: "CASH", deviceCode: DEV, ...PHARMACIST });
  assert.equal(result.quantity, available);
  assert.equal(result.outstanding, 60 - available);
  assert.equal(
    get<{ status: string }>(`SELECT status FROM prescriptions WHERE id = ?`, rx)!.status,
    "active",
    "part-dispensed is still outstanding, not quietly complete",
  );
});

test("the rest can be dispensed when stock arrives, and the prescription then closes", () => {
  const outstanding = Ph.worklist(STORE).find((w) => w.prescription.product_code === "ZINC-20" && w.outstanding > 0)!;
  S.receiveStock({
    storeCode: STORE, productCode: "ZINC-20", batchNumber: "ZN-2", expiresOn: inDays(300),
    quantity: 500, deviceCode: DEV, ...KEEPER,
  });

  const result = Ph.dispense({
    prescriptionId: outstanding.prescription.id, storeCode: STORE, payerCode: "CASH",
    deviceCode: DEV, ...PHARMACIST,
  });
  assert.equal(result.quantity, outstanding.outstanding);
  assert.equal(result.outstanding, 0);
  assert.equal(
    get<{ status: string }>(`SELECT status FROM prescriptions WHERE id = ?`, outstanding.prescription.id)!.status,
    "dispensed",
  );
});

test("dispensing more than is outstanding is refused", () => {
  const { rx } = prescribed("PARA-500", 10);
  Ph.dispense({ prescriptionId: rx, storeCode: STORE, quantity: 10, payerCode: "CASH", deviceCode: DEV, ...PHARMACIST });

  const check = Ph.checkDispense({ prescriptionId: rx, storeCode: STORE, dispenserId: pharmacistId });
  assert.equal(check.canDispense, false);
  assert.ok(check.blockers.some((b) => /already been dispensed in full/.test(b)));
});

test("medicine cannot be handed over from a store that is not a dispensing point", () => {
  const { rx } = prescribed("PARA-500", 5);
  S.receiveStock({
    storeCode: "MAIN", productCode: "PARA-500", batchNumber: "PA-MAIN", expiresOn: inDays(400),
    quantity: 200, deviceCode: DEV, ...KEEPER,
  });
  assert.throws(
    () => Ph.dispense({ prescriptionId: rx, storeCode: "MAIN", payerCode: "CASH", deviceCode: DEV, ...PHARMACIST }),
    /not a dispensing point/,
  );
});

test("a cancelled prescription cannot be dispensed", () => {
  const { rx } = prescribed("PARA-500", 5);
  Rx.cancelPrescription({
    prescriptionId: rx, reason: "Patient allergic", byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru",
  });
  assert.throws(
    () => Ph.dispense({ prescriptionId: rx, storeCode: STORE, payerCode: "CASH", deviceCode: DEV, ...PHARMACIST }),
    /was cancelled/,
  );
});

test("substituting the same generic is allowed, and must say why", () => {
  const { rx } = prescribed("AMOX-500", 6);
  S.receiveStock({
    storeCode: STORE, productCode: "AMOX-125S", batchNumber: "AS-1", expiresOn: inDays(300),
    quantity: 50, deviceCode: DEV, ...KEEPER,
  });

  assert.throws(
    () => Ph.dispense({
      prescriptionId: rx, storeCode: STORE, productCode: "AMOX-125S",
      payerCode: "CASH", deviceCode: DEV, ...PHARMACIST,
    }),
    /must record why/,
  );

  const result = Ph.dispense({
    prescriptionId: rx, storeCode: STORE, productCode: "AMOX-125S",
    substitutionReason: "Capsules out of stock; patient cannot swallow them",
    payerCode: "CASH", deviceCode: DEV, ...PHARMACIST,
  });

  const row = get<{ product_code: string; substitution_reason: string }>(
    `SELECT product_code, substitution_reason FROM dispenses WHERE id = ?`, result.dispenseId,
  )!;
  assert.equal(row.product_code, "AMOX-125S", "what the patient took is what was handed over");
  assert.match(row.substitution_reason, /cannot swallow/);
});

test("substituting a different medicine is not substitution and is refused", () => {
  const { rx } = prescribed("AMOX-500", 6);
  assert.throws(
    () => Ph.dispense({
      prescriptionId: rx, storeCode: STORE, productCode: "METRO-400",
      substitutionReason: "out of stock", payerCode: "CASH", deviceCode: DEV, ...PHARMACIST,
    }),
    /change of medicine, not a substitution/,
  );
});

test("a controlled drug needs the controlled-dispensing capability", () => {
  S.receiveStock({
    storeCode: STORE, productCode: "MORPH-10", batchNumber: "MO-1", expiresOn: inDays(300),
    quantity: 40, deviceCode: DEV, ...KEEPER,
  });
  const { rx } = prescribed("MORPH-10", 6);

  // The receptionist has neither capability.
  const denied = Ph.checkDispense({ prescriptionId: rx, storeCode: STORE, dispenserId: receptionistId });
  assert.equal(denied.canDispense, false);
  assert.ok(denied.blockers.length > 0);

  const allowed = Ph.checkDispense({ prescriptionId: rx, storeCode: STORE, dispenserId: pharmacistId });
  assert.equal(allowed.canDispense, true);
  assert.ok(allowed.warnings.some((w) => /register the PPB inspects/.test(w)));

  Ph.dispense({ prescriptionId: rx, storeCode: STORE, payerCode: "CASH", deviceCode: DEV, ...PHARMACIST });
});

test("the controlled-drug register names the patient, the batch and the dispenser", () => {
  const register = S.controlledRegister({ storeCode: STORE });
  const handedOver = register.filter((r) => r.kind === "dispense");
  assert.ok(handedOver.length > 0);

  const entry = handedOver.at(-1)!;
  assert.equal(entry.product_name, "Morphine sulphate 10mg");
  assert.equal(entry.batch_number, "MO-1");
  assert.ok(entry.patient_mrn, "an inspector asks who received it");
  assert.equal(entry.by_user_name, "Grace Kimani");
  assert.equal(entry.quantity, -6);

  assert.ok(
    register.every((r) => r.product_code === "MORPH-10"),
    "the register is controlled products only — everything else is noise to an inspector",
  );
});

test("a recall can name every patient a batch reached", () => {
  const batch = get<{ id: string }>(`SELECT id FROM stock_batches WHERE batch_number = 'AM-SOON'`)!;
  const trace = S.recallTrace(batch.id);
  assert.ok(trace.length > 0);
  assert.ok(trace.every((t) => t.patientMrn && t.quantity > 0));
  assert.ok(trace.every((t) => t.dispenseId), "and which dispensing event each came from");
});

// =============================================== one event, four consequences

test("dispensing once moves the stock, the bill, the prescription and the register together", () => {
  const { rx, enc, mrn } = prescribed("MORPH-10", 4);

  const stockBefore = S.onHand(STORE, "MORPH-10");
  const chargesBefore = B.chargesFor(enc).length;
  const registerBefore = S.controlledRegister({ storeCode: STORE }).length;

  const result = Ph.dispense({
    prescriptionId: rx, storeCode: STORE, payerCode: "CASH",
    counselling: "Take with food. Do not drive.", deviceCode: DEV, ...PHARMACIST,
  });

  // 1. The shelf.
  assert.equal(S.onHand(STORE, "MORPH-10"), stockBefore - 4);

  // 2. The bill — priced from the tariff, citing the dispensing event.
  const charges = B.chargesFor(enc);
  assert.equal(charges.length, chargesBefore + 1);
  const charge = charges.find((c) => c.service_code === "MORPH-10")!;
  assert.equal(charge.quantity, 4);
  assert.equal(charge.source_ref, result.dispenseId, "a query about a line leads back to the pack");
  assert.ok(charge.amount_cents > 0);
  assert.ok(charge.tariff_source, "and it was priced from a dated tariff, so the claim's gate 5 passes");

  // 3. The prescription.
  assert.equal(get<{ status: string }>(`SELECT status FROM prescriptions WHERE id = ?`, rx)!.status, "dispensed");

  // 4. The register the PPB inspects.
  assert.equal(S.controlledRegister({ storeCode: STORE }).length, registerBefore + 1);

  // And the record of who did it.
  const entry = get<{ action: string; detail: string }>(
    `SELECT action, detail FROM audit_log WHERE action = 'medicine_dispensed' ORDER BY id DESC LIMIT 1`,
  )!;
  const detail = JSON.parse(entry.detail);
  assert.equal(detail.controlled, true);
  assert.deepEqual(detail.batches, ["MO-1"]);
  assert.equal(
    get<{ dispenser_licence: string }>(`SELECT dispenser_licence FROM dispenses WHERE id = ?`, result.dispenseId)!
      .dispenser_licence,
    "PPB-DEMO-2219",
    "the licence as it stood at the counter",
  );
  assert.ok(mrn);
});

test("nothing moves at all when one of the four would fail", () => {
  const { rx, enc } = prescribed("PARA-500", 8);
  const stockBefore = S.onHand(STORE, "PARA-500");

  // No tariff for this payer, so raising the charge throws — and the stock must
  // not have moved, or the shelf and the bill disagree from then on.
  assert.throws(
    () => Ph.dispense({ prescriptionId: rx, storeCode: STORE, payerCode: "NOSUCH", deviceCode: DEV, ...PHARMACIST }),
    /NOSUCH/,
  );

  assert.equal(S.onHand(STORE, "PARA-500"), stockBefore, "the shelf is untouched");
  assert.equal(Ph.dispensedQuantity(rx), 0);
  assert.equal(B.chargesFor(enc).filter((c) => c.service_code === "PARA-500").length, 0);
});

test("a patient billed for a prescription is not billed again when it is dispensed", () => {
  const { rx, enc } = prescribed("PARA-500", 12);

  // The clinic bills at the point of prescribing, before the patient walks to
  // the pharmacy. Both flows are real; being charged twice is not.
  B.assembleCharges({ encounterId: enc, payerCode: "CASH", deviceCode: DEV, ...KEEPER });
  const ordered = B.chargesFor(enc).filter((c) => c.service_code === "PARA-500");
  assert.equal(ordered.length, 1, "billed once when written");

  Ph.dispense({ prescriptionId: rx, storeCode: STORE, payerCode: "CASH", deviceCode: DEV, ...PHARMACIST });

  const live = B.chargesFor(enc).filter((c) => c.service_code === "PARA-500");
  assert.equal(live.length, 1, "and still once when handed over");
  assert.notEqual(live[0].id, ordered[0].id, "replaced by what was actually dispensed");
  assert.equal(live[0].source_ref, Ph.dispensesFor(rx)[0].id);

  // The ordered charge is voided, not deleted — the bill has a history.
  const voided = get<{ void_reason: string }>(
    `SELECT void_reason FROM charges WHERE id = ?`, ordered[0].id,
  )!;
  assert.match(voided.void_reason, /Replaced by what was dispensed/);
});

test("a second, partial collection adds its own line", () => {
  const { rx, enc } = prescribed("ORS-1L", 10);
  S.receiveStock({
    storeCode: STORE, productCode: "ORS-1L", batchNumber: "OR-NEW", expiresOn: inDays(300),
    quantity: 40, deviceCode: DEV, ...KEEPER,
  });
  B.assembleCharges({ encounterId: enc, payerCode: "CASH", deviceCode: DEV, ...KEEPER });

  // The pharmacy gives four now and the rest when the patient comes back.
  Ph.dispense({ prescriptionId: rx, storeCode: STORE, quantity: 4, payerCode: "CASH", deviceCode: DEV, ...PHARMACIST });
  Ph.dispense({ prescriptionId: rx, storeCode: STORE, quantity: 6, payerCode: "CASH", deviceCode: DEV, ...PHARMACIST });

  const lines = B.chargesFor(enc).filter((c) => c.service_code === "ORS-1L");
  assert.equal(lines.length, 2, "two collections, two quantities, two lines");
  assert.equal(lines.reduce((sum, l) => sum + l.quantity, 0), 10, "and they add up to what was prescribed");
});

test("the audit chain survives the whole stock and dispensing cycle", () => {
  const v = verifyAuditChain();
  assert.equal(v.ok, true, v.ok ? "" : `broken at entry ${v.failedAtId}`);
});
