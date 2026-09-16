/**
 * M13 Scheduling & Appointments and M24 Inpatient & Ward.
 *
 * The tests that earn their keep here are the ones about beds: one patient per
 * bed enforced by the database rather than by looking first, and a bed the
 * patient cannot occupy not counting as an empty bed.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-ward-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const { seedDemo } = await import("../src/lib/seed.ts");
const S = await import("../src/lib/scheduling.ts");
const W = await import("../src/lib/inpatient.ts");
const P = await import("../src/lib/patients.ts");
const E = await import("../src/lib/encounters.ts");
const B = await import("../src/lib/billing.ts");
const N = await import("../src/lib/notifications.ts");
const Rx = await import("../src/lib/prescribing.ts");
const F = await import("../src/lib/frontdesk.ts");
const D = await import("../src/lib/documents.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get, all, run } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "WRD1", label: "Ward station", byUserId: adminId, byUserName: "admin" });

const DEV = "WRD1";
const DOC = { byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru" };
const DESK = { byUserId: receptionistId, byUserName: "Joseph Otieno" };

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const TOMORROW = inDays(1);

let nid = 70_000_000;
function newPatient(given: string, sex: "male" | "female" = "male", phone?: string): string {
  return P.registerPatient({
    facilityId, deviceCode: DEV, givenName: given, familyName: "Ward", sex,
    phone, nationalId: String(++nid), ...DESK,
  });
}

function consultation(mrn: string): string {
  const enc = E.openEncounter({
    facilityId, patientMrn: mrn, kind: "inpatient",
    clinicianId, clinicianName: DOC.byUserName, deviceCode: DEV,
  });
  E.addDiagnosis({ encounterId: enc, code: "CA40", ...DOC, deviceCode: DEV });
  E.writeNote({
    encounterId: enc, complaint: "Cough, breathless", assessment: "Community-acquired pneumonia",
    plan: "Admit for IV antibiotics", authorId: clinicianId, authorName: DOC.byUserName, deviceCode: DEV,
  });
  return enc;
}

// ============================================================ M13 scheduling

test("a clinic lays out as individual slots, and running it twice does not double it", () => {
  const first = S.openClinic({
    facilityId, providerId: clinicianId, date: TOMORROW, from: "09:00", to: "10:00",
    minutes: 15, deviceCode: DEV,
  });
  assert.equal(first.length, 4);

  const again = S.openClinic({
    facilityId, providerId: clinicianId, date: TOMORROW, from: "09:00", to: "10:00",
    minutes: 15, deviceCode: DEV,
  });
  assert.deepEqual(again, first, "somebody will run it twice");

  const times = S.availability({ facilityId, date: TOMORROW }).map((s) => s.start_time);
  assert.deepEqual(times, ["09:00", "09:15", "09:30", "09:45"]);
});

test("a nonsensical clinic is refused rather than producing nothing quietly", () => {
  const base = { facilityId, providerId: clinicianId, deviceCode: DEV };
  assert.throws(() => S.openClinic({ ...base, date: "tomorrow", from: "09:00", to: "10:00" }), /YYYY-MM-DD/);
  assert.throws(() => S.openClinic({ ...base, date: TOMORROW, from: "9am", to: "10:00" }), /24-hour HH:MM/);
  assert.throws(() => S.openClinic({ ...base, date: TOMORROW, from: "11:00", to: "10:00" }), /not after/);
});

test("booking fills a slot, and a full slot is refused", () => {
  const alice = newPatient("Alice", "female");
  const slot = S.availability({ facilityId, date: TOMORROW })[0];

  const id = S.book({ slotId: slot.id, patientMrn: alice, reason: "Review", deviceCode: DEV, ...DESK });
  assert.ok(id);
  assert.equal(S.getAppointment(id)!.status, "booked");

  assert.throws(
    () => S.book({ slotId: slot.id, patientMrn: alice, deviceCode: DEV, ...DESK }),
    /already booked into that slot/,
  );

  const bob = newPatient("Bob");
  assert.throws(() => S.book({ slotId: slot.id, patientMrn: bob, deviceCode: DEV, ...DESK }), /is full/);

  assert.ok(
    !S.availability({ facilityId, date: TOMORROW }).some((s) => s.id === slot.id),
    "and it stops being offered",
  );
});

test("a slot in the past cannot be booked", () => {
  S.openClinic({ facilityId, providerId: clinicianId, date: inDays(-3), from: "09:00", to: "09:30", deviceCode: DEV });
  const past = all<{ id: string }>(`SELECT id FROM slots WHERE slot_date = ?`, inDays(-3))[0];
  const mrn = newPatient("Late");
  assert.throws(() => S.book({ slotId: past.id, patientMrn: mrn, deviceCode: DEV, ...DESK }), /in the past/);
});

test("a slot with patients in it cannot be blocked over their heads", () => {
  const booked = all<{ slot_id: string }>(`SELECT slot_id FROM appointments WHERE status = 'booked'`)[0];
  assert.throws(
    () => S.blockSlot({ slotId: booked.slot_id, reason: "Clinician on leave", ...DESK }),
    /booked into this slot — move them first/,
  );

  const free = S.availability({ facilityId, date: TOMORROW })[0];
  S.blockSlot({ slotId: free.id, reason: "Clinician on leave", ...DESK });
  assert.ok(!S.availability({ facilityId, date: TOMORROW }).some((s) => s.id === free.id));
});

test("a reminder goes through the hub, and a patient with no number is reported not skipped", () => {
  const withPhone = newPatient("Reachable", "female", "0712345670");
  const withoutPhone = newPatient("Unreachable");
  const free = S.availability({ facilityId, date: TOMORROW });

  S.book({ slotId: free[0].id, patientMrn: withPhone, deviceCode: DEV, ...DESK });
  S.book({ slotId: free[1].id, patientMrn: withoutPhone, deviceCode: DEV, ...DESK });

  const result = S.sendReminders({ facilityId, date: TOMORROW });
  assert.ok(result.sent >= 1);
  assert.ok(result.noNumber.includes(withoutPhone), "a data-quality job for the front desk, not a silent skip");

  const logged = all<{ endpoint: string; mode: string }>(
    `SELECT endpoint, mode FROM integration_log WHERE operation = 'send' ORDER BY id DESC LIMIT 1`,
  )[0];
  assert.equal(logged.endpoint, "SMS");
  assert.equal(logged.mode, "demo", "a reminder sent in a demonstration is recorded as simulated");

  const second = S.sendReminders({ facilityId, date: TOMORROW });
  assert.equal(second.sent, 0, "and nobody is texted twice");
});

test("closing out the day turns silence into a no-show rate", () => {
  const alice = all<{ id: string; patient_mrn: string }>(`SELECT id, patient_mrn FROM appointments WHERE status = 'booked'`);
  assert.ok(alice.length > 0);

  // One patient did arrive.
  const visit = F.checkIn({ facilityId, patientMrn: alice[0].patient_mrn, deviceCode: DEV, ...DESK });
  S.markArrived({ appointmentId: alice[0].id, visitId: visit.id });

  const result = S.closeOutDay({ facilityId, date: TOMORROW });
  assert.equal(result.didNotAttend, alice.length - 1);

  const stats = S.attendance({ facilityId, from: TOMORROW, to: TOMORROW });
  assert.equal(stats.attended, 1);
  assert.equal(stats.didNotAttend, alice.length - 1);
  assert.ok(stats.noShowRatePercent! > 0, "the number that separates a busy-looking clinic from an earning one");
  assert.ok(stats.utilisationPercent !== null);

  assert.ok(N.inbox(facilityId, "receptionist").some((n) => n.kind === "did_not_attend"));
});

test("a cancellation must say why, and frees the slot", () => {
  const date = inDays(2);
  S.openClinic({ facilityId, providerId: clinicianId, date, from: "14:00", to: "14:30", deviceCode: DEV });
  const slot = S.availability({ facilityId, date })[0];
  const mrn = newPatient("Cancelling");
  const appointment = S.book({ slotId: slot.id, patientMrn: mrn, deviceCode: DEV, ...DESK });

  assert.throws(() => S.cancelAppointment({ appointmentId: appointment, reason: " ", ...DESK }), /record why/);
  S.cancelAppointment({ appointmentId: appointment, reason: "Patient travelling", ...DESK });

  assert.equal(S.getAppointment(appointment)!.status, "cancelled");
  assert.ok(S.availability({ facilityId, date }).some((s) => s.id === slot.id), "the slot is free again");
});

// ============================================================= M24 inpatient

test("the bed board shows the whole estate, occupied and not", () => {
  const board = W.bedBoard(facilityId);
  assert.equal(board.length, 10, "six general and four maternity");
  assert.ok(board.every((b) => !b.occupied), "nothing admitted yet");
  assert.ok(board.some((b) => b.ward.code === "MAT" && b.ward.admits_sex === "female"));
});

test("admitting puts a patient in a bed, with the licence it was done under", () => {
  const mrn = newPatient("Admitted");
  const enc = consultation(mrn);

  const id = W.admit({
    encounterId: enc, wardCode: "GEN", bedCode: "GEN-1",
    reason: "Community-acquired pneumonia, needs IV antibiotics",
    deviceCode: DEV, byUserId: clinicianId, byUserName: DOC.byUserName,
  });

  const admission = W.getAdmission(id)!;
  assert.equal(admission.bed_code, "GEN-1");
  assert.equal(admission.admitter_licence, "KMPDC-DEMO-4471");
  assert.equal(W.occupant("GEN-1")!.id, id);
  assert.equal(W.currentAdmission(mrn)!.id, id);

  const history = W.bedHistory(id);
  assert.equal(history.length, 1);
  assert.equal(history[0].to_bed, "GEN-1");
});

test("a bed holds one patient, and the database is what says so", () => {
  const other = newPatient("Second");
  const enc = consultation(other);

  assert.throws(
    () => W.admit({
      encounterId: enc, wardCode: "GEN", bedCode: "GEN-1", reason: "Also unwell",
      deviceCode: DEV, byUserId: clinicianId, byUserName: DOC.byUserName,
    }),
    /is occupied by/,
  );

  // And the guard that actually holds: the partial unique index, reached by
  // going round the check the way a second clerk's transaction does.
  assert.throws(
    () => run(
      `INSERT INTO admissions (id, encounter_id, patient_mrn, ward_code, bed_code, admitter_name, reason, admitted_at)
       VALUES ('RACE-1', ?, ?, 'GEN', 'GEN-1', 'Race', 'x', ?)`,
      enc, other, new Date().toISOString(),
    ),
    /UNIQUE constraint failed/,
    "two clerks admitting at once is exactly when this happens",
  );
});

test("a bed a patient cannot occupy is not an empty bed", () => {
  const man = newPatient("Male", "male");
  const woman = newPatient("Female", "female");

  const forMan = W.bedsAvailableFor(facilityId, man);
  assert.ok(forMan.every((b) => b.ward.code !== "MAT"), "a maternity bed is not availability for him");

  const forWoman = W.bedsAvailableFor(facilityId, woman);
  assert.ok(forWoman.some((b) => b.ward.code === "MAT"));

  const enc = consultation(man);
  assert.throws(
    () => W.admit({
      encounterId: enc, wardCode: "MAT", bedCode: "MAT-1", reason: "no beds elsewhere",
      deviceCode: DEV, byUserId: clinicianId, byUserName: DOC.byUserName,
    }),
    /admits female patients only/,
  );
});

test("admitting is licence-gated", () => {
  const mrn = newPatient("Unlicensed");
  const enc = consultation(mrn);
  assert.throws(
    () => W.admit({
      encounterId: enc, wardCode: "GEN", bedCode: "GEN-2", reason: "x",
      deviceCode: DEV, byUserId: receptionistId, byUserName: "Joseph Otieno",
    }),
    /role does not include this/,
  );
});

test("a bed out of service is not offered and cannot be admitted to", () => {
  W.takeBedOutOfService({ bedCode: "GEN-6", reason: "Broken frame", byUserName: "admin" });
  assert.ok(!W.bedsAvailableFor(facilityId, newPatient("Anyone")).some((b) => b.bed.code === "GEN-6"));

  assert.throws(() => W.takeBedOutOfService({ bedCode: "GEN-1", reason: "x", byUserName: "admin" }), /occupied/);
  W.returnBedToService("GEN-6");
});

test("a transfer keeps the trail, which is an infection-control question", () => {
  const admission = W.occupant("GEN-1")!;
  assert.throws(() => W.transfer({ admissionId: admission.id, toBedCode: "GEN-1", reason: "x", byUserId: clinicianId, byUserName: DOC.byUserName }), /already in/);

  W.transfer({
    admissionId: admission.id, toBedCode: "GEN-3", reason: "Closer to the nurses' station",
    byUserId: clinicianId, byUserName: DOC.byUserName,
  });

  assert.equal(W.getAdmission(admission.id)!.bed_code, "GEN-3");
  assert.equal(W.occupant("GEN-1"), undefined, "the old bed is free");

  const history = W.bedHistory(admission.id);
  assert.equal(history.length, 2);
  assert.equal(history[1].from_bed, "GEN-1");
  assert.equal(history[1].to_bed, "GEN-3");
});

test("NEWS2 scores the standard table", () => {
  assert.equal(W.news2({ respRate: 16, spo2: 98, systolic: 120, pulse: 72, temp: 36.8 }), 0);
  assert.equal(W.news2({ respRate: 26 }), 3);
  assert.equal(W.news2({ spo2: 90 }), 3);
  assert.equal(W.news2({ systolic: 88 }), 3);
  // A septic-looking set: tachypnoea, hypoxia, hypotension, tachycardia, fever.
  assert.ok(W.news2({ respRate: 26, spo2: 92, systolic: 95, pulse: 118, temp: 38.9 }) >= W.NEWS2_ESCALATION);
});

test("a deteriorating patient escalates instead of being filed", () => {
  const admission = W.currentAdmission(all<{ patient_mrn: string }>(`SELECT patient_mrn FROM admissions WHERE discharged_at IS NULL LIMIT 1`)[0].patient_mrn)!;

  const normal = W.recordObservation({
    admissionId: admission.id, observation: { respRate: 16, spo2: 98, systolic: 120, pulse: 72, temp: 36.8 },
    byUserId: clinicianId, byUserName: DOC.byUserName,
  });
  assert.equal(normal.score, 0);
  assert.equal(normal.escalated, false);

  const bad = W.recordObservation({
    admissionId: admission.id, observation: { respRate: 26, spo2: 92, systolic: 95, pulse: 118, temp: 38.9 },
    note: "Looks unwell", byUserId: clinicianId, byUserName: DOC.byUserName,
  });
  assert.equal(bad.escalated, true);

  const alarm = N.inbox(facilityId, "clinician").find((n) => n.kind === "deteriorating_patient")!;
  assert.ok(alarm);
  assert.match(alarm.subject, /NEWS2/);

  const trend = W.observationsFor(admission.id);
  assert.equal(trend.length, 2);
  assert.equal(trend[0].news2_score, 0, "the score is stored, so a round sees what was acted on");
  assert.equal(trend[1].temp_tenths_c, 389, "temperature in tenths, never a float");
});

test("an impossible observation is refused rather than charted", () => {
  const admission = all<{ id: string }>(`SELECT id FROM admissions WHERE discharged_at IS NULL LIMIT 1`)[0];
  const by = { byUserId: clinicianId, byUserName: DOC.byUserName };
  assert.throws(() => W.recordObservation({ admissionId: admission.id, observation: { temp: 52 }, ...by }), /not survivable/);
  assert.throws(() => W.recordObservation({ admissionId: admission.id, observation: { spo2: 140 }, ...by }), /percentage/);
  assert.throws(
    () => W.recordObservation({ admissionId: admission.id, observation: { systolic: 70, diastolic: 120 }, ...by }),
    /wrong way round/,
  );
});

test("bed nights are billed by a job, and a second run does not double-bill", () => {
  const admission = all<Record<string, string>>(`SELECT * FROM admissions WHERE discharged_at IS NULL LIMIT 1`)[0];
  // Backdate the admission so there are nights to bill.
  run(`UPDATE admissions SET admitted_at = ? WHERE id = ?`, `${inDays(-3)}T09:00:00.000Z`, admission.id);

  const first = W.billBedNights({ facilityId, payerCode: "CASH", deviceCode: DEV, ...DOC });
  assert.equal(first.nights, 3);
  assert.equal(first.admissions, 1);

  const second = W.billBedNights({ facilityId, payerCode: "CASH", deviceCode: DEV, ...DOC });
  assert.equal(second.nights, 0, "somebody will run it twice");

  const charges = B.chargesFor(admission.encounter_id).filter((c) => c.service_code === "BED-DAY");
  assert.equal(charges.length, 3);
  assert.ok(charges.every((c) => c.amount_cents === 250_000));
  assert.match(charges[0].description, /Bed night/);
});

test("a dose not given is a record, not a blank", () => {
  const admission = all<{ id: string; encounter_id: string; patient_mrn: string }>(
    `SELECT id, encounter_id, patient_mrn FROM admissions WHERE discharged_at IS NULL LIMIT 1`,
  )[0];

  const rx = Rx.prescribe({
    encounterId: admission.encounter_id, productCode: "AMOX-500", dose: "1 cap", frequency: "TDS",
    quantity: 21, prescriberId: clinicianId, prescriberName: DOC.byUserName, deviceCode: DEV,
  });

  const created = W.scheduleDoses({
    admissionId: admission.id, prescriptionId: rx, times: ["08:00", "14:00", "20:00"], days: 2, deviceCode: DEV,
  });
  assert.equal(created, 6);

  const again = W.scheduleDoses({
    admissionId: admission.id, prescriptionId: rx, times: ["08:00", "14:00", "20:00"], days: 2, deviceCode: DEV,
  });
  assert.equal(again, 0, "scheduling twice does not double the chart");

  const doses = all<{ id: string }>(`SELECT id FROM medication_administrations WHERE prescription_id = ? ORDER BY due_at`, rx);
  const by = { byUserId: clinicianId, byUserName: DOC.byUserName };

  W.recordAdministration({ administrationId: doses[0].id, given: true, ...by });
  assert.throws(() => W.recordAdministration({ administrationId: doses[1].id, given: false, ...by }), /must record why/);
  W.recordAdministration({ administrationId: doses[1].id, given: false, omittedReason: "Patient vomiting", ...by });
  assert.throws(() => W.recordAdministration({ administrationId: doses[0].id, given: true, ...by }), /already been signed for/);

  const signed = all<{ given_at: string | null; omitted_reason: string | null }>(
    `SELECT given_at, omitted_reason FROM medication_administrations WHERE id IN (?, ?)`,
    doses[0].id, doses[1].id,
  );
  assert.ok(signed.some((d) => d.given_at));
  assert.ok(signed.some((d) => d.omitted_reason === "Patient vomiting"));

  assert.ok(W.missedDoses(facilityId).length > 0, "what a shift handover asks about");
});

test("discharging needs a summary, signs it, and frees the bed", () => {
  const admission = W.occupant("GEN-3")!;

  assert.throws(
    () => W.discharge({ admissionId: admission.id, type: "home", summary: " ", deviceCode: DEV, byUserId: clinicianId, byUserName: DOC.byUserName }),
    /needs a summary/,
  );
  assert.throws(
    () => W.discharge({
      admissionId: admission.id, type: "home", summary: "Improved", deviceCode: DEV,
      byUserId: receptionistId, byUserName: "Joseph Otieno",
    }),
    /role does not include this/,
  );

  W.discharge({
    admissionId: admission.id, type: "home",
    summary: "Completed IV antibiotics, afebrile 48 hours. Oral amoxicillin to complete seven days. Review in one week.",
    deviceCode: DEV, byUserId: clinicianId, byUserName: DOC.byUserName,
  });

  assert.ok(W.getAdmission(admission.id)!.discharged_at);
  assert.equal(W.occupant("GEN-3"), undefined, "the bed is free the moment it commits");

  const signature = D.signedFor("admission", admission.id, "discharge_summary")!;
  assert.equal(signature.signer_name, DOC.byUserName);
  assert.equal(signature.licence_regulator, "KMPDC");

  assert.throws(
    () => W.discharge({ admissionId: admission.id, type: "home", summary: "again", deviceCode: DEV, byUserId: clinicianId, byUserName: DOC.byUserName }),
    /already been discharged/,
  );
});

test("an incomplete drug chart follows the patient out of the door", () => {
  const told = N.inbox(facilityId, "nurse").find((n) => n.kind === "unsigned_doses");
  assert.ok(told, "the ward sister has to know before the notes are filed");
  assert.match(told!.subject, /unsigned/);
});

test("the census is what a bed manager lives by", () => {
  const wards = W.census(facilityId);
  const general = wards.find((w) => w.wardCode === "GEN")!;
  assert.equal(general.beds, 6);
  assert.ok(general.dischargesToday >= 1);
  assert.ok(general.occupancyPercent >= 0 && general.occupancyPercent <= 100);
  assert.equal(wards.find((w) => w.wardCode === "MAT")!.beds, 4);
});

test("the audit chain survives scheduling and the ward", () => {
  const v = verifyAuditChain();
  assert.equal(v.ok, true, v.ok ? "" : `broken at entry ${v.failedAtId}`);
});

// ------------------------------------------------- NEWS2, all seven parameters

/** Somebody in a bed, so an observation has an admission to hang off. */
let newsBed = 0;
function admitSomebody(reason: string): string {
  const mrn = newPatient(`News${++newsBed}`);
  const enc = consultation(mrn);
  // Each in their own bed, because a bed holds one patient and that is enforced.
  return W.admit({
    encounterId: enc, wardCode: "GEN", bedCode: `GEN-${newsBed}`,
    reason, deviceCode: DEV, byUserId: clinicianId, byUserName: DOC.byUserName,
  });
}

test("consciousness and oxygen are worth five points between them", () => {
  // The patient they catch — confused, on oxygen, with unremarkable
  // observations — is exactly the one a numbers-only score misses.
  const numbersOnly = { temp: 37, systolic: 120, pulse: 80, respRate: 16, spo2: 97 };
  assert.equal(W.news2(numbersOnly), 0);

  assert.equal(W.news2({ ...numbersOnly, consciousness: "alert", onOxygen: false }), 0);
  assert.equal(W.news2({ ...numbersOnly, consciousness: "confused", onOxygen: false }), 3);
  assert.equal(W.news2({ ...numbersOnly, consciousness: "alert", onOxygen: true }), 2);
  assert.equal(W.news2({ ...numbersOnly, consciousness: "confused", onOxygen: true }), 5);
});

test("any response short of alert scores the same three", () => {
  const base = { temp: 37, systolic: 120, pulse: 80, respRate: 16, spo2: 97 };
  for (const level of ["confused", "voice", "pain", "unresponsive"] as const) {
    assert.equal(W.news2({ ...base, consciousness: level }), 3, level);
  }
});

test("an unanswered parameter is not an answer, and the score says so", () => {
  const partial = { temp: 37, systolic: 120, pulse: 80 };
  assert.deepEqual(W.missingParameters(partial).sort(), ["consciousness", "onOxygen", "respRate", "spo2"]);
  assert.deepEqual(W.missingParameters({
    temp: 37, systolic: 120, pulse: 80, respRate: 16, spo2: 97,
    consciousness: "alert", onOxygen: false,
  }), []);
});

test("a confused patient on oxygen escalates on those two parameters alone", () => {
  const admission = admitSomebody("Confused");
  const out = W.recordObservation({
    admissionId: admission,
    observation: {
      temp: 37, systolic: 120, pulse: 80, respRate: 16, spo2: 97,
      consciousness: "confused", onOxygen: true,
    },
    byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru",
  });

  assert.equal(out.score, 5);
  assert.equal(out.escalated, true);
  assert.equal(out.complete, true);
  assert.equal(out.red, "consciousness");
});

test("a single parameter scoring three escalates even when the total is low", () => {
  // NEWS2's own rule, and the one an aggregate hides: a saturation of 88 with
  // everything else normal totals 3 and still needs somebody now.
  const admission = admitSomebody("Hypoxic");
  const out = W.recordObservation({
    admissionId: admission,
    observation: {
      temp: 37, systolic: 120, pulse: 80, respRate: 16, spo2: 88,
      consciousness: "alert", onOxygen: false,
    },
    byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru",
  });

  assert.ok(out.score < W.NEWS2_ESCALATION, "the aggregate alone would not have escalated");
  assert.equal(out.red, "oxygen saturation");
  assert.equal(out.escalated, true);
});

test("an incomplete score is stored as incomplete, because it can only under-read", () => {
  const admission = admitSomebody("Partial");
  const out = W.recordObservation({
    admissionId: admission,
    observation: { temp: 37, systolic: 120, pulse: 80 },
    byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru",
  });

  assert.equal(out.complete, false);
  assert.ok(out.missing.includes("consciousness"));

  const [row] = W.observationsFor(admission);
  assert.equal(row.news2_complete, 0);
});

test("the alert says the score was incomplete rather than letting it read as a full one", () => {
  const admission = admitSomebody("Sick and partial");
  W.recordObservation({
    admissionId: admission,
    observation: { respRate: 6, systolic: 85 },
    byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru",
  });

  const alert = N.inbox(facilityId).find(
    (n) => n.kind === "deteriorating_patient" && n.entity_id === admission,
  )!;
  assert.match(alert.body, /incomplete set/);
  assert.match(alert.body, /consciousness/);
});
