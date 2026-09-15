/**
 * M11 Consent and M14 Queue & Triage.
 *
 * Two tests here carry real weight: consent against superseded wording is not
 * consent, and an emergency case must never wait behind routine ones because
 * the software sorted by arrival time.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-fd-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";
import type { Visit } from "../src/lib/frontdesk.ts";

const { seedDemo } = await import("../src/lib/seed.ts");
const F = await import("../src/lib/frontdesk.ts");
const P = await import("../src/lib/patients.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, run, get } = await import("../src/lib/db.ts");

const { facilityId, adminId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "REC", label: "Reception", byUserId: adminId, byUserName: "admin" });

const DEV = "REC";
const BY = { byUserId: receptionistId, byUserName: "Joseph Otieno" };

function patient(name: string, nid: string): string {
  return P.registerPatient({
    facilityId, deviceCode: DEV, givenName: name, familyName: "Queue", sex: "female",
    nationalId: nid, ...BY,
  });
}

// ------------------------------------------------------------------- consent

test("consent is recorded per purpose, not as one blanket yes", () => {
  const mrn = patient("Consent", "50000001");
  F.recordConsent({ patientMrn: mrn, purpose: "treatment", granted: true, ...BY });

  assert.equal(F.hasConsent(mrn, "treatment"), true);
  assert.equal(
    F.hasConsent(mrn, "data_sharing"),
    false,
    "consent to treatment is not consent to share a record with an employer",
  );
});

test("the front desk is told which consents are still outstanding", () => {
  const mrn = patient("Outstanding", "50000002");
  assert.deepEqual(F.missingConsents(mrn), ["treatment", "billing", "claim"]);

  F.recordConsent({ patientMrn: mrn, purpose: "treatment", granted: true, ...BY });
  F.recordConsent({ patientMrn: mrn, purpose: "billing", granted: true, ...BY });
  assert.deepEqual(F.missingConsents(mrn), ["claim"]);
});

test("a refusal is recorded as a refusal, not an absence", () => {
  const mrn = patient("Refuser", "50000003");
  F.recordConsent({ patientMrn: mrn, purpose: "research", granted: false, ...BY });
  assert.equal(F.hasConsent(mrn, "research"), false);
  assert.equal(F.consentsFor(mrn).length, 1, "the refusal is on the record, so nobody asks again blindly");
});

test("consent against superseded wording is not consent", () => {
  const mrn = patient("Versioned", "50000004");
  F.recordConsent({ patientMrn: mrn, purpose: "treatment", granted: true, ...BY });
  assert.equal(F.hasConsent(mrn, "treatment"), true);

  // The facility revises the wording. What the patient agreed to no longer exists.
  run(`UPDATE consents SET version = 'treatment-v0' WHERE patient_mrn = ?`, mrn);
  assert.equal(
    F.hasConsent(mrn, "treatment"),
    false,
    "agreeing to text that has since changed is not agreeing to the new text",
  );
});

test("consent can be withdrawn, and withdrawal sticks", () => {
  const mrn = patient("Withdrawer", "50000005");
  const id = F.recordConsent({ patientMrn: mrn, purpose: "billing", granted: true, ...BY });
  assert.equal(F.hasConsent(mrn, "billing"), true);

  F.withdrawConsent({ consentId: id, reason: "patient asked at the desk", ...BY });
  assert.equal(F.hasConsent(mrn, "billing"), false);
  assert.throws(() => F.withdrawConsent({ consentId: id, reason: "again", ...BY }), /already been withdrawn/);
});

// --------------------------------------------------------------------- queue

test("checking in issues a token and puts the patient in the queue", () => {
  const mrn = patient("First", "50000010");
  const visit = F.checkIn({ facilityId, patientMrn: mrn, deviceCode: DEV, ...BY });
  assert.match(visit.token, /^REC-\d{3}$/);
  assert.equal(visit.state, "waiting");
  assert.equal(visit.priority, "routine");
});

test("a patient cannot be queued twice", () => {
  const mrn = patient("Twice", "50000011");
  F.checkIn({ facilityId, patientMrn: mrn, deviceCode: DEV, ...BY });
  assert.throws(
    () => F.checkIn({ facilityId, patientMrn: mrn, deviceCode: DEV, ...BY }),
    /already in the queue/,
  );
});

test("an emergency never waits behind routine cases", () => {
  const routineA = patient("RoutineA", "50000020");
  const routineB = patient("RoutineB", "50000021");
  const emergency = patient("Emergency", "50000022");
  const urgent = patient("Urgent", "50000023");

  F.checkIn({ facilityId, patientMrn: routineA, deviceCode: DEV, ...BY });
  F.checkIn({ facilityId, patientMrn: routineB, deviceCode: DEV, ...BY });
  // Arrives last, must be seen first.
  F.checkIn({ facilityId, patientMrn: urgent, priority: "urgent", deviceCode: DEV, ...BY });
  F.checkIn({ facilityId, patientMrn: emergency, priority: "emergency", deviceCode: DEV, ...BY });

  const order = F.queue(facilityId).map((v) => v.patient_mrn);
  assert.equal(order[0], emergency, "sorting by arrival alone is a software-caused harm");
  assert.equal(order[1], urgent);
  assert.ok(order.indexOf(routineA) < order.indexOf(routineB), "within a priority, first come first served");
});

test("triage can raise a priority, and the queue re-orders", () => {
  const mrn = patient("Deteriorating", "50000030");
  const visit = F.checkIn({ facilityId, patientMrn: mrn, deviceCode: DEV, ...BY });
  assert.notEqual(F.queue(facilityId)[0].patient_mrn, mrn);

  F.setPriority({ visitId: visit.id, priority: "emergency", ...BY });

  // Not necessarily first overall — an emergency already waiting keeps its place,
  // because within a priority it is first come first served. What must change is
  // that this patient now ranks above every routine case.
  const order = F.queue(facilityId);
  const moved = order.findIndex((v) => v.patient_mrn === mrn);
  const firstRoutine = order.findIndex((v) => v.priority === "routine");
  assert.ok(moved >= 0);
  assert.ok(
    firstRoutine === -1 || moved < firstRoutine,
    "a patient who deteriorates in the waiting room moves ahead of routine cases",
  );
  assert.equal(order[moved].priority, "emergency");
});

test("a visit advances through its states with timestamps", () => {
  const mrn = patient("Progress", "50000040");
  const visit = F.checkIn({ facilityId, patientMrn: mrn, deviceCode: DEV, ...BY });

  F.advanceVisit({ visitId: visit.id, state: "in_triage", ...BY });
  F.advanceVisit({ visitId: visit.id, state: "in_consultation", ...BY });
  F.advanceVisit({ visitId: visit.id, state: "done", ...BY });

  const done = get<Visit>(`SELECT * FROM visits WHERE id = ?`, visit.id)!;
  assert.equal(done.state, "done");
  assert.ok(done.triaged_at && done.seen_at && done.done_at, "waiting time is measurable, so it can be managed");
  assert.ok(!F.queue(facilityId).some((v) => v.id === visit.id), "and it leaves the queue");
});

// -------------------------------------------------------------------- vitals

test("vitals are stored as integers in fixed units", () => {
  const mrn = patient("Vitals", "50000050");
  const visit = F.checkIn({ facilityId, patientMrn: mrn, deviceCode: DEV, ...BY });

  F.recordVitals({
    visitId: visit.id,
    tempTenthsC: 389,
    weightGrams: 62_400,
    heightMm: 1_680,
    systolicMmhg: 128,
    diastolicMmhg: 82,
    pulseBpm: 92,
    spo2Percent: 97,
    ...BY,
  });

  const v = F.vitalsFor(visit.id)[0];
  assert.equal(v.temp_tenths_c, 389);
  assert.equal(F.show.temp(v.temp_tenths_c), "38.9 °C");
  assert.equal(F.show.weight(v.weight_grams), "62.4 kg");
  assert.equal(F.show.bp(v.systolic_mmhg, v.diastolic_mmhg), "128/82 mmHg");
});

test("an implausible reading is refused — a transposed digit becomes a clinical decision", () => {
  const mrn = patient("Typo", "50000051");
  const visit = F.checkIn({ facilityId, patientMrn: mrn, deviceCode: DEV, ...BY });

  // 380 tenths = 38.0 °C typed as 3800.
  assert.throws(() => F.recordVitals({ visitId: visit.id, tempTenthsC: 3800, ...BY }), /temperature/);
  assert.throws(() => F.recordVitals({ visitId: visit.id, pulseBpm: 900, ...BY }), /pulse/);
  assert.throws(() => F.recordVitals({ visitId: visit.id, spo2Percent: 970, ...BY }), /oxygen saturation/);
});

test("swapped blood pressure readings are caught", () => {
  const mrn = patient("Swapped", "50000052");
  const visit = F.checkIn({ facilityId, patientMrn: mrn, deviceCode: DEV, ...BY });
  assert.throws(
    () => F.recordVitals({ visitId: visit.id, systolicMmhg: 80, diastolicMmhg: 120, ...BY }),
    /look swapped/,
  );
});

test("the audit chain survives a full front-desk session", () => {
  assert.equal(verifyAuditChain().ok, true);
});
