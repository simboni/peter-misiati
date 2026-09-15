/**
 * M22 Orders (CPOE) and M30 Laboratory (LIS).
 *
 * The two tests that matter most here are about things not happening: a reading
 * reaching a clinician before a licensed technologist released it, and a
 * critical result sitting on a worklist nobody looks at. Everything else is
 * bookkeeping around those two.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-lab-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const { seedDemo } = await import("../src/lib/seed.ts");
const O = await import("../src/lib/orders.ts");
const L = await import("../src/lib/laboratory.ts");
const P = await import("../src/lib/patients.ts");
const E = await import("../src/lib/encounters.ts");
const B = await import("../src/lib/billing.ts");
const N = await import("../src/lib/notifications.ts");
const D = await import("../src/lib/documents.ts");
const C = await import("../src/lib/claims.ts");
const Pay = await import("../src/lib/payers.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get, all, run } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId, labTechId } = seedDemo();
registerDevice({ facilityId, code: "LBT1", label: "Lab test bench", byUserId: adminId, byUserName: "admin" });

const DEV = "LBT1";
const DOC = { ordererId: clinicianId, ordererName: "Dr. Achieng Wanjiru" };
const TECH = { enteredBy: labTechId, enteredByName: "Samuel Mutiso" };
const RELEASER = { releaserId: labTechId, releaserName: "Samuel Mutiso" };

let nid = 60_000_000;
function newPatient(given: string, sex: "male" | "female" = "female", dob?: string): string {
  return P.registerPatient({
    facilityId, deviceCode: DEV, givenName: given, familyName: "Lab", sex,
    dateOfBirth: dob, nationalId: String(++nid), byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
}

function consultation(mrn: string): string {
  const enc = E.openEncounter({
    facilityId, patientMrn: mrn, kind: "outpatient",
    clinicianId, clinicianName: "Dr. Achieng Wanjiru", deviceCode: DEV,
  });
  E.addDiagnosis({ encounterId: enc, code: "1F40", byUserId: clinicianId, byUserName: DOC.ordererName, deviceCode: DEV });
  E.writeNote({
    encounterId: enc, complaint: "Fever", assessment: "Query malaria", plan: "MRDT",
    authorId: clinicianId, authorName: DOC.ordererName, deviceCode: DEV,
  });
  return enc;
}

/** An order with its specimen collected, ready for a reading. */
function collected(mrn: string, service = "LAB-CBC"): { enc: string; order: string } {
  const enc = consultation(mrn);
  const order = O.placeOrder({
    encounterId: enc, kind: "lab", serviceCode: service, payerCode: "CASH",
    clinicalQuestion: "Rule out anaemia", deviceCode: DEV, ...DOC,
  });
  L.collectSpecimen({
    orderId: order, kind: "EDTA whole blood",
    collectorId: labTechId, collectorName: "Samuel Mutiso", deviceCode: DEV,
  });
  return { enc, order };
}

// ================================================================ M22 orders

test("ordering raises the charge in the same breath", () => {
  const mrn = newPatient("Ordered");
  const enc = consultation(mrn);

  const id = O.placeOrder({
    encounterId: enc, kind: "lab", serviceCode: "LAB-MRDT", payerCode: "CASH",
    clinicalQuestion: "Fever 3 days, rule out malaria", deviceCode: DEV, ...DOC,
  });

  const order = O.getOrder(id)!;
  assert.equal(order.status, "ordered");
  assert.equal(order.orderer_licence, "KMPDC-DEMO-4471", "a claim cites the ordering licence");
  assert.match(order.clinical_question, /rule out malaria/);

  const charge = B.chargesFor(enc).find((c) => c.service_code === "LAB-MRDT")!;
  assert.ok(charge, "an investigation done and not billed is revenue the facility never sees");
  assert.equal(charge.source_ref, id);
  assert.ok(charge.amount_cents > 0);
});

test("ordering is licence-gated", () => {
  const mrn = newPatient("Unlicensed");
  const enc = consultation(mrn);
  assert.throws(
    () => O.placeOrder({
      encounterId: enc, kind: "lab", serviceCode: "LAB-CBC", payerCode: "CASH",
      deviceCode: DEV, ordererId: receptionistId, ordererName: "Joseph Otieno",
    }),
    /role does not include this/,
  );
});

test("an order cannot be placed on a closed encounter", () => {
  const mrn = newPatient("Closed");
  const enc = consultation(mrn);
  E.closeEncounter({ encounterId: enc, byUserId: clinicianId, byUserName: DOC.ordererName, deviceCode: DEV });
  assert.throws(
    () => O.placeOrder({ encounterId: enc, kind: "lab", serviceCode: "LAB-CBC", payerCode: "CASH", deviceCode: DEV, ...DOC }),
    /closed/,
  );
});

test("a stat order reaches someone rather than joining a list", () => {
  const mrn = newPatient("Urgent");
  const enc = consultation(mrn);
  const id = O.placeOrder({
    encounterId: enc, kind: "lab", serviceCode: "LAB-CBC", priority: "stat", payerCode: "CASH",
    clinicalQuestion: "Collapsed in the corridor", deviceCode: DEV, ...DOC,
  });

  const raised = N.inbox(facilityId).find((n) => n.entity_id === id)!;
  assert.ok(raised);
  assert.equal(raised.severity, "critical");
  assert.equal(raised.owner_role, "lab_technologist");
  assert.match(raised.subject, /^STAT/);
});

test("the laboratory worklist is ordered stat, then urgent, then oldest first", () => {
  const pending = O.pendingOrders("lab");
  const ranks = pending.map((o) => ({ stat: 0, urgent: 1, routine: 2 })[o.priority]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.ok(pending.every((o) => o.patient_name), "with a name, because a technologist checks the label");
});

test("an order cannot go backwards through its states", () => {
  const mrn = newPatient("Backwards");
  const { order } = collected(mrn);
  assert.throws(
    () => O.setOrderStatus({ orderId: order, status: "ordered", byUserId: labTechId, byUserName: "Samuel Mutiso" }),
    /cannot go back from collected to ordered/,
  );
});

test("an order already reported cannot be cancelled, only superseded", () => {
  const mrn = newPatient("Reported");
  const { order } = collected(mrn);
  L.enterResult({ orderId: order, analyte: "HB", value: 13.4, ...TECH, deviceCode: DEV });
  L.releaseResults({ orderId: order, deviceCode: DEV, ...RELEASER });

  assert.throws(
    () => O.cancelOrder({ orderId: order, reason: "no longer needed", byUserId: clinicianId, byUserName: DOC.ordererName }),
    /already been reported/,
  );
});

// ============================================================ M30 laboratory

test("a result cannot be entered before a specimen exists", () => {
  const mrn = newPatient("NoSpecimen");
  const enc = consultation(mrn);
  const order = O.placeOrder({
    encounterId: enc, kind: "lab", serviceCode: "LAB-CBC", payerCode: "CASH", deviceCode: DEV, ...DOC,
  });
  assert.throws(
    () => L.enterResult({ orderId: order, analyte: "HB", value: 12, ...TECH, deviceCode: DEV }),
    /no specimen has been collected/,
  );
});

test("a rejected specimen tells the clinician no result is coming", () => {
  const mrn = newPatient("Haemolysed");
  const { order } = collected(mrn);
  const specimen = L.specimensFor(order)[0];

  assert.throws(() => L.rejectSpecimen({ specimenId: specimen.id, reason: " ", byUserId: labTechId, byUserName: "Samuel Mutiso" }), /record why/);
  L.rejectSpecimen({ specimenId: specimen.id, reason: "Haemolysed", byUserId: labTechId, byUserName: "Samuel Mutiso" });

  const told = N.inbox(facilityId, "clinician").find((n) => n.entity_id === order)!;
  assert.ok(told, "the clinician is waiting for an answer that is not coming");
  assert.match(told.subject, /needs re-collecting/);

  assert.throws(
    () => L.enterResult({ orderId: order, analyte: "HB", value: 12, ...TECH, deviceCode: DEV }),
    /every specimen for this order was rejected/,
  );
});

test("values are integers in thousandths, never floating point", () => {
  assert.equal(L.toMilli(11.2), 11200);
  assert.equal(L.toMilli(0.1) + L.toMilli(0.2), L.toMilli(0.3), "the sum that famously is not 0.3 in binary");
  assert.equal(L.formatValue(11200, "g/dL"), "11.2 g/dL");
  assert.equal(L.formatValue(150000, "x10^9/L"), "150 x10^9/L");
  assert.equal(L.formatValue(null), "");
});

test("the reference range used is the one for this particular patient", () => {
  const man = newPatient("Man", "male", "1985-04-02");
  const woman = newPatient("Woman", "female", "1985-04-02");
  const child = newPatient("Child", "female", new Date(Date.now() - 6 * 365.25 * 86_400_000).toISOString().slice(0, 10));

  assert.equal(L.rangeFor("HB", man)!.low_milli, 13000);
  assert.equal(L.rangeFor("HB", woman)!.low_milli, 12000, "10.5 is anaemia in a man and borderline in a woman");
  assert.equal(L.rangeFor("HB", child)!.low_milli, 11000, "and normal in a six-year-old");
});

test("a reading is flagged against that patient's range", () => {
  const man = newPatient("FlaggedMan", "male", "1985-04-02");
  const { order } = collected(man);
  const id = L.enterResult({ orderId: order, analyte: "HB", value: 12.4, ...TECH, deviceCode: DEV });

  const result = get<{ flag: string; low_milli: number; unit: string }>(`SELECT flag, low_milli, unit FROM lab_results WHERE id = ?`, id)!;
  assert.equal(result.flag, "low");
  assert.equal(result.low_milli, 13000, "the range is pinned onto the result, as it stood");
  assert.equal(result.unit, "g/dL", "and the unit comes from the range when the bench does not type one");
});

test("a reading is not a result until a licensed technologist releases it", () => {
  const mrn = newPatient("Unreleased");
  const { order } = collected(mrn);
  L.enterResult({ orderId: order, analyte: "HB", value: 13.1, ...TECH, deviceCode: DEV });

  assert.equal(O.getOrder(order)!.status, "in_progress", "not resulted");
  assert.equal(L.patientResults(mrn).length, 0, "and nothing has reached the clinician");

  assert.throws(
    () => L.releaseResults({ orderId: order, deviceCode: DEV, releaserId: receptionistId, releaserName: "Joseph Otieno" }),
    /role does not include this/,
  );

  const released = L.releaseResults({ orderId: order, deviceCode: DEV, ...RELEASER });
  assert.equal(released.released, 1);
  assert.equal(O.getOrder(order)!.status, "resulted");
  assert.equal(L.patientResults(mrn).length, 1);
  assert.equal(L.resultsFor(order)[0].releaser_licence, "KMLTTB-DEMO-8802");
});

test("releasing attaches the report the claim scrubber looks for", () => {
  const mrn = newPatient("Documented");
  const { enc, order } = collected(mrn);
  L.enterResult({ orderId: order, analyte: "HB", value: 9.8, ...TECH, deviceCode: DEV });
  L.enterResult({ orderId: order, analyte: "WBC", value: 14.2, ...TECH, deviceCode: DEV });
  L.releaseResults({ orderId: order, deviceCode: DEV, ...RELEASER });

  const report = D.attachments("encounter", enc).find((d) => d.kind === "lab_report")!;
  assert.ok(report, "the report a payer asks for is the one the laboratory produced");

  const content = D.read({ documentId: report.id, byUserId: adminId, byUserName: "admin", purpose: "claim" });
  assert.equal(content.intact, true);
  const text = content.content.toString();
  assert.match(text, /Full (Blood|blood) Count|LAB-CBC/);
  assert.match(text, /HB\s+9\.8/);
  assert.match(text, /\[LOW\]/);
  assert.match(text, /Rule out anaemia/, "the clinical question travels with the report");
});

test("a critical value is a telephone call, not a row on a worklist", () => {
  const mrn = newPatient("Critical");
  const { order } = collected(mrn, "LAB-CBC");
  L.enterResult({ orderId: order, analyte: "K", value: 7.1, ...TECH, deviceCode: DEV });

  const released = L.releaseResults({ orderId: order, deviceCode: DEV, ...RELEASER });
  assert.deepEqual(released.panic, ["K"]);

  const alarm = N.inbox(facilityId, "clinician").find((n) => n.kind === "panic_value" && n.entity_id === order)!;
  assert.ok(alarm);
  assert.equal(alarm.severity, "critical");
  assert.match(alarm.subject, /CRITICAL/);
  assert.match(alarm.subject, /K/);

  const report = D.attachments("encounter", O.getOrder(order)!.encounter_id).find((d) => d.kind === "lab_report")!;
  const text = D.read({ documentId: report.id, byUserId: adminId, byUserName: "admin" }).content.toString();
  assert.match(text, /\*\*\* CRITICAL \*\*\*/, "and it is unmissable on the paper too");
});

test("a qualitative result is abnormal when it is positive", () => {
  const mrn = newPatient("Positive");
  const { order } = collected(mrn, "LAB-MRDT");
  const id = L.enterResult({ orderId: order, analyte: "MRDT", valueText: "Positive — P. falciparum", ...TECH, deviceCode: DEV });
  assert.equal(get<{ flag: string }>(`SELECT flag FROM lab_results WHERE id = ?`, id)!.flag, "abnormal");

  const mrn2 = newPatient("Negative");
  const second = collected(mrn2, "LAB-MRDT");
  const id2 = L.enterResult({ orderId: second.order, analyte: "MRDT", valueText: "Negative", ...TECH, deviceCode: DEV });
  assert.equal(get<{ flag: string }>(`SELECT flag FROM lab_results WHERE id = ?`, id2)!.flag, "normal");
});

test("a result with no value at all is refused", () => {
  const mrn = newPatient("Empty");
  const { order } = collected(mrn);
  assert.throws(() => L.enterResult({ orderId: order, analyte: "HB", ...TECH, deviceCode: DEV }), /must have a value/);
});

// ======================================================= closing the loop

test("a released result is outstanding until a clinician says they have seen it", () => {
  const mrn = newPatient("Outstanding");
  const { order } = collected(mrn);
  L.enterResult({ orderId: order, analyte: "HB", value: 8.1, ...TECH, deviceCode: DEV });
  L.releaseResults({ orderId: order, deviceCode: DEV, ...RELEASER });

  const waiting = O.unacknowledged().find((u) => u.order.id === order)!;
  assert.ok(waiting, "a result nobody read is invisible unless it is a recorded state");
  assert.equal(waiting.abnormal, true);

  O.acknowledgeResult({ orderId: order, byUserId: clinicianId, byUserName: DOC.ordererName, action: "Start ferrous sulphate" });
  assert.equal(O.getOrder(order)!.status, "acknowledged");
  assert.ok(!O.unacknowledged().some((u) => u.order.id === order));

  assert.throws(
    () => O.acknowledgeResult({ orderId: order, byUserId: clinicianId, byUserName: DOC.ordererName }),
    /already been acknowledged/,
  );
});

test("the unacknowledged list puts critical results above merely abnormal ones", () => {
  const outstanding = O.unacknowledged();
  assert.ok(outstanding.length > 0);
  const score = outstanding.map((u) => (u.panic ? 2 : u.abnormal ? 1 : 0));
  assert.deepEqual(score, [...score].sort((a, b) => b - a));
});

test("a correction supersedes rather than overwrites, and reopens acknowledgement", () => {
  const mrn = newPatient("Corrected");
  const { order } = collected(mrn);
  const original = L.enterResult({ orderId: order, analyte: "K", value: 4.2, ...TECH, deviceCode: DEV });
  L.releaseResults({ orderId: order, deviceCode: DEV, ...RELEASER });
  O.acknowledgeResult({ orderId: order, byUserId: clinicianId, byUserName: DOC.ordererName });

  assert.throws(
    () => L.correctResult({ resultId: original, value: 6.9, reason: " ", byUserId: labTechId, byUserName: "Samuel Mutiso", deviceCode: DEV }),
    /record why/,
  );

  L.correctResult({
    resultId: original, value: 6.9, reason: "Sample mix-up with the next tube",
    byUserId: labTechId, byUserName: "Samuel Mutiso", deviceCode: DEV,
  });

  const current = L.resultsFor(order);
  assert.equal(current.length, 1);
  assert.equal(current[0].value_milli, 6900);
  assert.equal(current[0].status, "corrected");
  assert.equal(current[0].supersedes, original);

  const history = L.resultHistory(order);
  assert.equal(history.length, 2, "somebody acted on the first one — it stays readable");
  assert.equal(history[0].value_milli, 4200);
  assert.ok(history[0].superseded_at);

  assert.equal(O.getOrder(order)!.status, "resulted", "the clinician saw the old value, so it is outstanding again");
  assert.equal(O.getOrder(order)!.acknowledged_at, null);

  const told = N.inbox(facilityId, "clinician").find((n) => n.kind === "result_corrected")!;
  assert.ok(told, "a correction nobody saw is worse than the original error");
  assert.match(told.body, /Was 4\.2.*now 6\.9/);
});

test("a corrected result cannot be corrected twice from the same version", () => {
  const original = all<{ id: string }>(`SELECT id FROM lab_results WHERE superseded_at IS NOT NULL LIMIT 1`)[0];
  assert.throws(
    () => L.correctResult({
      resultId: original.id, value: 5, reason: "again",
      byUserId: labTechId, byUserName: "Samuel Mutiso", deviceCode: DEV,
    }),
    /already been corrected/,
  );
});

test("turnaround is measured, because it is what a laboratory is judged on", () => {
  const stats = O.turnaround("lab");
  assert.ok(stats.length > 0);
  assert.ok(stats.every((s) => s.n > 0 && s.medianHours >= 0));
  assert.deepEqual(
    stats.map((s) => s.medianHours),
    [...stats.map((s) => s.medianHours)].sort((a, b) => b - a),
    "slowest first",
  );
});

// ============================================ the loop into the claim

test("a lab claim clears its documentation gate because the laboratory reported", () => {
  const mrn = newPatient("Claimable");
  Pay.verifyCoverage({
    patientMrn: mrn, payerCode: "SHA", memberNumber: "SHA-LABLOOP",
    byUserId: receptionistId, byUserName: "Joseph Otieno",
  });

  const enc = consultation(mrn);
  const order = O.placeOrder({
    encounterId: enc, kind: "lab", serviceCode: "LAB-MRDT", payerCode: "SHA",
    clinicalQuestion: "Fever, rule out malaria", deviceCode: DEV, ...DOC,
  });
  B.assembleCharges({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, byUserId: clinicianId, byUserName: DOC.ordererName });
  B.issueInvoice({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, byUserId: clinicianId, byUserName: DOC.ordererName });

  L.collectSpecimen({ orderId: order, kind: "Capillary blood", collectorId: labTechId, collectorName: "Samuel Mutiso", deviceCode: DEV });
  L.enterResult({ orderId: order, analyte: "MRDT", valueText: "Positive — P. falciparum", ...TECH, deviceCode: DEV });
  L.releaseResults({ orderId: order, deviceCode: DEV, ...RELEASER });
  O.acknowledgeResult({ orderId: order, byUserId: clinicianId, byUserName: DOC.ordererName });

  E.closeEncounter({ encounterId: enc, byUserId: clinicianId, byUserName: DOC.ordererName, deviceCode: DEV });
  const claim = C.assembleClaim({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, byUserId: adminId, byUserName: "admin" });

  const gate = C.scrub(claim).gates.find((g) => g.gate === 7)!;
  assert.equal(gate.passed, true, gate.message);
  assert.match(gate.message, /attachment/, "the report the payer wants was produced by doing the work");
});

test("the audit chain survives the whole diagnostic loop", () => {
  const v = verifyAuditChain();
  assert.equal(v.ok, true, v.ok ? "" : `broken at entry ${v.failedAtId}`);
});
