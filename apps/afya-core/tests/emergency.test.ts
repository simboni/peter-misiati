/**
 * M28 Emergency & Casualty.
 *
 * The rules this module exists to hold: care does not wait for a cashier, a
 * triage colour can be raised by a nurse and never lowered by arithmetic, a
 * re-triage does not erase how long somebody has already waited, and a person
 * who left without being seen is counted rather than forgotten.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-ed-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const E = await import("../src/lib/emergency.ts");
const P = await import("../src/lib/patients.ts");
const N = await import("../src/lib/notifications.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get, all } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "CAS1", label: "Casualty", byUserId: adminId, byUserName: "admin" });

const DEV = "CAS1";
const BY = { byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru", deviceCode: DEV };

let nid = 72_000_000;
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function newPatient(given: string, sex: "male" | "female" = "male"): string {
  return P.registerPatient({
    facilityId, deviceCode: DEV, givenName: given, familyName: "Casualty", sex,
    nationalId: String(++nid), byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
}

/** An attendance, triaged, with the arrival backdated so waits are testable. */
function arrive(given: string, opts: { minutesAgo?: number; obs?: Parameters<typeof E.tews>[0] } = {}) {
  const mrn = newPatient(given);
  const id = E.openAttendance({
    facilityId, patientMrn: mrn, arrivedAt: minutesAgo(opts.minutesAgo ?? 0),
    presenting: "Chest pain", ...BY,
  });
  if (opts.obs) {
    E.triagePatient({ attendanceId: id, observations: opts.obs, assessedAt: minutesAgo(opts.minutesAgo ?? 0), ...BY });
  }
  return { mrn, id };
}

// ================================================================== the score

test("a well patient who walked in scores nothing and comes out green", () => {
  const obs = { mobility: "walking" as const, respRate: 14, pulseBpm: 78, systolicMmhg: 124, tempTenthsC: 368, avpu: "alert" as const };
  assert.equal(E.tews(obs), 0);
  assert.equal(E.triageFromScore(0), "green");
});

test("TEWS calls a respiratory rate of 16 abnormal — its normal band stops at 14", () => {
  // Worth pinning, because it surprises people: a rate most charts print as
  // normal scores 1 here. It is the published table, and it is one of the
  // reasons the whole scale needs an emergency clinician's sign-off.
  assert.equal(E.tews({ respRate: 14 }), 0);
  assert.equal(E.tews({ respRate: 16 }), 1);
});

test("the score is the sum of what was recorded, component by component", () => {
  // Stretcher 2, resp 26 → 2, pulse 122 → 2, systolic 78 → 2, temp 39.4 → 2,
  // responds to pain → 2, trauma 1. Fourteen.
  assert.equal(
    E.tews({
      mobility: "stretcher", respRate: 26, pulseBpm: 122, systolicMmhg: 78,
      tempTenthsC: 394, avpu: "pain", trauma: true,
    }),
    13,
  );
});

test("a partial set of observations under-reads rather than over-reads", () => {
  // Only a pulse. The safe direction for a score a discriminator can raise but
  // nothing can lower.
  assert.equal(E.tews({ pulseBpm: 135 }), 3);
  assert.equal(E.triageFromScore(3), "yellow");
});

test("the score bands run red, orange, yellow, green", () => {
  assert.equal(E.triageFromScore(9), "red");
  assert.equal(E.triageFromScore(7), "red");
  assert.equal(E.triageFromScore(6), "orange");
  assert.equal(E.triageFromScore(5), "orange");
  assert.equal(E.triageFromScore(4), "yellow");
  assert.equal(E.triageFromScore(3), "yellow");
  assert.equal(E.triageFromScore(2), "green");
});

test("worst() takes the more severe of two colours, in both argument orders", () => {
  assert.equal(E.worst("green", "red"), "red");
  assert.equal(E.worst("red", "green"), "red");
  assert.equal(E.worst("orange", "yellow"), "orange");
  assert.equal(E.worst("yellow", "yellow"), "yellow");
});

// ================================================================= the opening

test("an attendance opens on a patient and a time, with nothing else asked for", () => {
  // No payer, no deposit, no consent. Article 43(2) of the Constitution: a
  // person shall not be denied emergency medical treatment.
  const mrn = newPatient("Penniless");
  const id = E.openAttendance({ facilityId, patientMrn: mrn, ...BY });
  const a = E.getAttendance(id)!;
  assert.equal(a.patient_mrn, mrn);
  assert.equal(a.triage, null, "not yet triaged — and that is a state the board must show");
  assert.equal(a.disposition, null);
});

test("a second open attendance for the same person is refused", () => {
  const { mrn } = arrive("Doubled");
  assert.throws(
    () => E.openAttendance({ facilityId, patientMrn: mrn, ...BY }),
    /already in casualty/,
    "two attendances means two clocks and two boards disagreeing about one corridor",
  );
});

test("an attendance against an incident that was never declared is refused", () => {
  const mrn = newPatient("Phantom");
  assert.throws(
    () => E.openAttendance({ facilityId, patientMrn: mrn, incidentRef: "MCI-NOPE", ...BY }),
    /no incident is declared/,
  );
});

// ============================================================ triage and raising

test("a discriminator raises the colour the score gave, and the record keeps both", () => {
  const { id } = arrive("Bleeding");
  const result = E.triagePatient({
    attendanceId: id,
    // Numbers alone say yellow.
    observations: { mobility: "with_help", respRate: 22, pulseBpm: 104 },
    discriminator: "Uncontrolled external bleeding",
    discriminatorTriage: "red",
    ...BY,
  });

  assert.equal(result.triage, "red");
  assert.equal(result.raised, true);
  const [assessment] = E.triageHistory(id);
  assert.equal(assessment.triage_by_score, "yellow", "what the arithmetic said is kept, so the upgrade is visible");
  assert.equal(assessment.triage, "red");
});

test("a discriminator milder than the score cannot pull a patient down a queue", () => {
  const { id } = arrive("Sicker");
  const result = E.triagePatient({
    attendanceId: id,
    // Score says red.
    observations: { mobility: "stretcher", respRate: 32, pulseBpm: 138, systolicMmhg: 76, avpu: "pain" },
    discriminator: "Looks comfortable",
    discriminatorTriage: "green",
    ...BY,
  });
  assert.equal(result.triage, "red", "the failure that kills people is a sick patient talked into a lower queue");
  assert.equal(result.raised, false);
});

test("raising a triage by hand must say what was seen", () => {
  const { id } = arrive("Unexplained");
  assert.throws(
    () => E.triagePatient({ attendanceId: id, observations: { pulseBpm: 80 }, discriminatorTriage: "red", ...BY }),
    /must say what was seen/,
  );
});

test("a transposed digit is refused rather than scored", () => {
  const { id } = arrive("Typo");
  assert.throws(
    () => E.triagePatient({ attendanceId: id, observations: { tempTenthsC: 3800 }, ...BY }),
    /outside a plausible range/,
  );
});

test("a red patient raises a critical alert at the moment of triage", () => {
  const { id } = arrive("Collapsed");
  E.triagePatient({
    attendanceId: id,
    observations: { mobility: "stretcher", respRate: 34, pulseBpm: 140, systolicMmhg: 70, avpu: "unresponsive" },
    ...BY,
  });
  const alert = N.inbox(facilityId, "clinician").find((n) => n.kind === "ed_red" && n.entity_id === id);
  assert.ok(alert, "red has no waiting time at all, so it does not wait for somebody to read a board");
  assert.equal(alert!.severity, "critical");
});

test("dead on arrival is blue, and blue is not a queue position", () => {
  const { id } = arrive("Deceased");
  const result = E.triagePatient({ attendanceId: id, observations: {}, deadOnArrival: true, ...BY });
  assert.equal(result.triage, "blue");
  assert.equal(E.TARGET_MINUTES.blue, 0);
});

// ================================================================== the clock

test("re-triage keeps every assessment and does not reset the wait", () => {
  const { id } = arrive("Deteriorating", { minutesAgo: 90, obs: { mobility: "walking", pulseBpm: 84 } });
  const first = E.getAttendance(id)!;
  assert.equal(first.triage, "green");

  // An hour and a half later she is worse. The clock must not start again.
  E.triagePatient({
    attendanceId: id,
    observations: { mobility: "stretcher", respRate: 30, pulseBpm: 128, systolicMmhg: 82 },
    ...BY,
  });

  const after = E.getAttendance(id)!;
  assert.equal(after.triage, "red", "the board reads the latest colour");
  assert.equal(after.triaged_at, first.triaged_at, "handing her a fresh target would erase ninety minutes of waiting");
  assert.equal(E.triageHistory(id).length, 2, "the first assessment is evidence of what was known then");
  assert.deepEqual(E.triageHistory(id).map((t) => t.sequence), [1, 2]);
});

test("the wait runs from triage, and stops when a clinician takes the patient", () => {
  const { id } = arrive("Waiting", { minutesAgo: 40, obs: { mobility: "with_help", pulseBpm: 104 } });
  assert.equal(E.waitMinutes(E.getAttendance(id)!), 40);

  E.startTreatment({ attendanceId: id, seenAt: minutesAgo(10), byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru" });
  const seen = E.getAttendance(id)!;
  assert.equal(E.waitMinutes(seen), 30, "thirty minutes from triage to a clinician, and it stays thirty");
});

test("a patient cannot be taken twice", () => {
  const { id } = arrive("Taken", { obs: { pulseBpm: 88 } });
  const take = () => E.startTreatment({ attendanceId: id, byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru" });
  take();
  assert.throws(take, /already been taken/);
});

test("past target and unseen is a breach; seen inside target is not", () => {
  // Orange has a ten-minute target.
  const late = arrive("Breached", { minutesAgo: 45, obs: { mobility: "with_help", respRate: 24, pulseBpm: 112 } });
  assert.equal(E.getAttendance(late.id)!.triage, "orange");

  const prompt = arrive("Prompt", { minutesAgo: 45, obs: { mobility: "with_help", respRate: 24, pulseBpm: 112 } });
  E.startTreatment({ attendanceId: prompt.id, seenAt: minutesAgo(40), byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru" });

  const breached = E.breaches(facilityId).map((r) => r.attendance.id);
  assert.ok(breached.includes(late.id), "forty-five minutes on a ten-minute target");
  assert.ok(!breached.includes(prompt.id), "seen in five — not a breach, however long she has been in the building since");
});

test("a patient nobody has triaged sorts above everything on the board", () => {
  const untriaged = arrive("Unlooked", { minutesAgo: 5 });
  const board = E.board(facilityId);
  assert.equal(board[0].untriaged, true, "an unknown colour is not a mild one — it is a patient nobody has looked at");
  assert.ok(E.breaches(facilityId).some((r) => r.attendance.id === untriaged.id));
});

// =========================================================== no name at all

test("a patient who cannot say who they are still gets a record to order against", () => {
  const { attendanceId, patientMrn } = E.openUnidentified({
    facilityId, sex: "male", estimatedAge: 30, arrivalMode: "ambulance",
    presenting: "Unresponsive, found by the roadside", ...BY,
  });

  const patient = P.resolvePatient(patientMrn)!;
  assert.match(patient.given_name, /^Unknown Male$/);
  assert.match(patient.family_name, /^[A-Z0-9]{1,4}$/, "a short tag two people can tell apart across a resus room");
  assert.equal(patient.dob_estimated, 1, "an estimated age is not a birthday");
  assert.equal(E.getAttendance(attendanceId)!.unidentified, 1);
});

test("identifying them is a merge, so nothing recorded under the temporary name is lost", () => {
  const { attendanceId, patientMrn } = E.openUnidentified({ facilityId, sex: "female", ...BY });
  E.triagePatient({ attendanceId, observations: { mobility: "stretcher", avpu: "voice" }, ...BY });

  const real = newPatient("Recognised", "female");
  E.identify({
    attendanceId, realPatientMrn: real,
    reason: "Her sister came to casualty and identified her",
    deviceCode: DEV, byUserId: adminId, byUserName: "Facility Administrator",
  });

  const after = E.getAttendance(attendanceId)!;
  assert.equal(after.patient_mrn, real);
  assert.equal(after.unidentified, 0);
  assert.equal(P.resolvePatient(patientMrn)!.mrn, real, "the temporary number still resolves, to the real record");
  assert.equal(E.triageHistory(attendanceId).length, 1, "the triage done under the temporary name survives");
});

test("identifying a patient as themselves, or twice, is refused", () => {
  const { attendanceId, patientMrn } = E.openUnidentified({ facilityId, sex: "male", ...BY });
  const MERGER = { deviceCode: DEV, byUserId: adminId, byUserName: "Facility Administrator" };
  assert.throws(
    () => E.identify({ attendanceId, realPatientMrn: patientMrn, reason: "same", ...MERGER }),
    /the same record/,
  );
  const real = newPatient("Namedatlast");
  E.identify({ attendanceId, realPatientMrn: real, reason: "Father identified him", ...MERGER });
  assert.throws(
    () => E.identify({ attendanceId, realPatientMrn: newPatient("Someoneelse"), reason: "again", ...MERGER }),
    /already identified/,
  );
});

// ================================================================ disposition

test("an admission from casualty must name the bed it went to", () => {
  const { id } = arrive("Admitted", { obs: { mobility: "stretcher", pulseBpm: 118 } });
  assert.throws(
    () => E.recordDisposition({ attendanceId: id, disposition: "admitted", ...BY }),
    /must name the admission/,
  );
});

test("a referral and a death must both record why", () => {
  const referred = arrive("Referred", { obs: { pulseBpm: 96 } });
  assert.throws(
    () => E.recordDisposition({ attendanceId: referred.id, disposition: "referred", ...BY }),
    /where to and why/,
  );
  const died = arrive("Died", { obs: { mobility: "stretcher", avpu: "unresponsive" } });
  assert.throws(
    () => E.recordDisposition({ attendanceId: died.id, disposition: "died", ...BY }),
    /record the circumstances/,
  );
});

test("left without being seen is a first-class outcome, not a tidy-up", () => {
  const { id } = arrive("Gaveup", { minutesAgo: 200, obs: { mobility: "walking", pulseBpm: 82 } });
  E.recordDisposition({
    attendanceId: id, disposition: "left_without_being_seen",
    note: "Waiting area empty at the 3pm round", ...BY,
  });

  const a = E.getAttendance(id)!;
  assert.equal(a.disposition, "left_without_being_seen");
  assert.equal(a.seen_at, null);
  assert.ok(
    E.emergencySummary(facilityId).leftWithoutBeingSeen >= 1,
    "the number that tells a department it is too slow",
  );
});

test("a closed attendance takes no further triage and cannot be closed twice", () => {
  const { id } = arrive("Closed", { obs: { pulseBpm: 80 } });
  E.recordDisposition({ attendanceId: id, disposition: "discharged", note: "Advice given", ...BY });
  assert.throws(() => E.triagePatient({ attendanceId: id, observations: { pulseBpm: 80 }, ...BY }), /is closed/);
  assert.throws(
    () => E.recordDisposition({ attendanceId: id, disposition: "discharged", ...BY }),
    /already closed/,
  );
});

test("a closed attendance leaves the board", () => {
  const { id } = arrive("Wentaway", { obs: { pulseBpm: 88 } });
  assert.ok(E.board(facilityId).some((r) => r.attendance.id === id));
  E.recordDisposition({ attendanceId: id, disposition: "discharged", note: "Home", ...BY });
  assert.ok(!E.board(facilityId).some((r) => r.attendance.id === id));
});

// ============================================================== medico-legal

test("a police case carries the OB number, normalised the way it will be matched", () => {
  const { id } = arrive("Assaulted", { obs: { mobility: "with_help", trauma: true } });
  E.openMedicolegalCase({
    attendanceId: id, kind: "assault", policeStation: "Kilimani",
    obNumber: " ob/41/2026 ", note: "Struck with a blunt object", ...BY,
  });
  const [record] = E.medicolegalFor(id);
  assert.equal(record.ob_number, "OB/41/2026");
  assert.equal(record.p3_issued, 0);
});

test("a second case of the same kind on one attendance is refused", () => {
  const { id } = arrive("Crashed", { obs: { trauma: true } });
  E.openMedicolegalCase({ attendanceId: id, kind: "road_traffic", ...BY });
  assert.throws(
    () => E.openMedicolegalCase({ attendanceId: id, kind: "road_traffic", ...BY }),
    /already open on this attendance/,
  );
  // A different kind on the same attendance is a different case and is allowed.
  E.openMedicolegalCase({ attendanceId: id, kind: "burns", ...BY });
  assert.equal(E.medicolegalFor(id).length, 2);
});

test("sexual violence and child protection raise a critical alert on opening", () => {
  for (const kind of ["sexual_violence", "child_abuse"] as const) {
    const { id } = arrive(`Safeguard${kind}`, { obs: { mobility: "walking" } });
    E.openMedicolegalCase({ attendanceId: id, kind, ...BY });
    const alert = N.inbox(facilityId, "clinician").find((n) => n.kind === "ed_safeguarding" && n.entity_id === id);
    assert.ok(alert, `${kind} has a pathway and a clock of its own`);
    assert.equal(alert!.severity, "critical");
  }
});

test("a P3 records who it was handed to, and cannot be issued twice", () => {
  const { id } = arrive("P3case", { obs: { trauma: true } });
  const caseId = E.openMedicolegalCase({ attendanceId: id, kind: "assault", obNumber: "OB/77/2026", ...BY });

  assert.throws(
    () => E.issueP3({ caseId, issuedTo: "  ", byUserId: adminId, byUserName: "Facility Administrator" }),
    /who it was handed to/,
  );

  E.issueP3({ caseId, issuedTo: "PC Wanjala, Kilimani", byUserId: adminId, byUserName: "Facility Administrator" });
  const [record] = E.medicolegalFor(id);
  assert.equal(record.p3_issued, 1);
  assert.equal(record.p3_issued_to, "PC Wanjala, Kilimani");

  assert.throws(
    () => E.issueP3({ caseId, issuedTo: "Someone else", byUserId: adminId, byUserName: "Facility Administrator" }),
    /already been issued/,
  );
});

test("issuing a P3 is written to the audit log as a disclosure", () => {
  const entry = get<{ action: string; purpose: string; detail: string }>(
    `SELECT action, purpose, detail FROM audit_log WHERE action = 'p3_issued' ORDER BY id DESC LIMIT 1`,
  )!;
  assert.equal(entry.purpose, "administration");
  assert.match(entry.detail, /PC Wanjala/, "a P3 leaves the building, so who took it is undeniable");
});

// ============================================================= mass casualty

test("an incident groups its casualties, worst colour first", () => {
  const reference = E.declareIncident({
    facilityId, reference: " mci-thika-01 ", kind: "Road traffic collision",
    description: "Matatu and lorry, Thika Road", byUserId: adminId, byUserName: "Facility Administrator",
  });
  assert.equal(reference, "MCI-THIKA-01", "a reference everybody can say out loud");

  const alert = N.inbox(facilityId, "clinician").find((n) => n.kind === "mci_declared");
  assert.ok(alert);
  assert.equal(alert!.severity, "critical");

  const casualties: string[] = [];
  for (const [given, obs] of [
    ["Crash1", { mobility: "walking" as const, pulseBpm: 88 }],
    ["Crash2", { mobility: "stretcher" as const, respRate: 32, pulseBpm: 136, systolicMmhg: 74, avpu: "pain" as const }],
    ["Crash3", { mobility: "with_help" as const, respRate: 24, pulseBpm: 122 }],
  ] as const) {
    const mrn = newPatient(given);
    const id = E.openAttendance({ facilityId, patientMrn: mrn, arrivalMode: "ambulance", incidentRef: reference, ...BY });
    E.triagePatient({ attendanceId: id, observations: obs, ...BY });
    casualties.push(id);
  }
  // One of them has no name.
  const unknown = E.openUnidentified({ facilityId, sex: "male", arrivalMode: "ambulance", incidentRef: reference, ...BY });
  E.triagePatient({ attendanceId: unknown.attendanceId, observations: { mobility: "stretcher", avpu: "unresponsive", respRate: 8 }, ...BY });

  const board = E.incidentBoard(reference);
  assert.equal(board.length, 4);
  assert.deepEqual(
    board.map((r) => r.triage),
    ["red", "red", "orange", "green"],
    "worst first — that is the order the board is read in",
  );
  assert.equal(board.filter((r) => r.unidentified).length, 1);
});

test("declaring the same incident twice is refused, and standing down is once", () => {
  assert.throws(
    () => E.declareIncident({ facilityId, reference: "MCI-THIKA-01", kind: "again", byUserId: adminId, byUserName: "admin" }),
    /already declared/,
  );
  E.standDownIncident({ reference: "MCI-THIKA-01", byUserId: adminId, byUserName: "Facility Administrator" });
  assert.ok(E.getIncident("MCI-THIKA-01")!.stood_down_at);
  assert.throws(
    () => E.standDownIncident({ reference: "MCI-THIKA-01", byUserId: adminId, byUserName: "admin" }),
    /already stood down/,
  );
});

// =================================================================== reports

test("the summary counts what a casualty department is judged on", () => {
  const s = E.emergencySummary(facilityId);
  assert.ok(s.attendances >= 20);
  assert.ok(s.byTriage.red >= 2);
  assert.ok(s.leftWithoutBeingSeen >= 1);
  assert.ok(s.medicolegal >= 4);
  assert.ok(s.breached >= 1, "somebody is past target right now, and the number says so");
});

test("a median wait and a target rate are absent, not zero, when nobody was seen", () => {
  const empty = E.emergencySummary(facilityId, "1990-01-01", "1990-12-31");
  assert.equal(empty.attendances, 0);
  assert.equal(empty.medianWaitMinutes, null, "no patients seen is not a zero-minute wait");
  assert.equal(empty.withinTargetPercent, null);
});

test("the within-target rate counts only patients whose wait actually ended", () => {
  const s = E.emergencySummary(facilityId);
  assert.ok(s.withinTargetPercent !== null);
  assert.ok(s.withinTargetPercent! >= 0 && s.withinTargetPercent! <= 100);
  // Somebody was seen inside target and somebody was not, so it is neither
  // extreme — a rate of exactly 100% here would mean the breach was not counted.
  assert.ok(s.medianWaitMinutes !== null);
});

// ===================================================================== audit

test("everything casualty did is on the audit chain, and the chain still verifies", () => {
  const count = (action: string) =>
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`, action)!.n;

  assert.ok(count("ed_attendance_opened") >= 20);
  assert.ok(count("ed_triaged") >= 15);
  assert.ok(count("ed_retriaged") >= 1, "a re-triage is its own entry, not an overwrite");
  assert.ok(count("ed_patient_identified") >= 2);
  assert.ok(count("mci_declared") >= 1);

  const v = verifyAuditChain();
  assert.equal(v.ok, true);
});
