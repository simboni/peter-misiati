/**
 * M27 Programme Registers.
 *
 * The two tests that carry the module: the cohort a patient belongs to is
 * stamped at enrolment and never moves, and somebody who has not come back is
 * found. Everything else in HIV, TB and NCD reporting is built on those.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-prog-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const { seedDemo } = await import("../src/lib/seed.ts");
const G = await import("../src/lib/programmes.ts");
const P = await import("../src/lib/patients.ts");
const N = await import("../src/lib/notifications.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get, all, run } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "CCC1", label: "Comprehensive care", byUserId: adminId, byUserName: "admin" });
G.seedProgrammes();

const DEV = "CCC1";
const BY = { byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru", deviceCode: DEV };

let nid = 96_000_000;
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function newPatient(given: string): string {
  return P.registerPatient({
    facilityId, deviceCode: DEV, givenName: given, familyName: "Programme", sex: "female",
    nationalId: String(++nid), byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
}

// ================================================================= enrolment

test("the three registers a Kenyan facility runs are installed", () => {
  const codes = G.listProgrammes().map((p) => p.code).sort();
  assert.deepEqual(codes, ["HIV", "NCD", "TB"]);
  assert.equal(G.getProgramme("TB")!.cohort_months, 6, "TB treatment is a fixed six-month course");
  assert.equal(G.getProgramme("HIV")!.cohort_months, 12);
});

test("an enrolment needs the number the programme knows them by", () => {
  const mrn = newPatient("Numberless");
  assert.throws(
    () => G.enrol({ programmeCode: "HIV", patientMrn: mrn, programmeNumber: "  ", ...BY }),
    /every return and every transfer letter uses/,
  );
});

test("enrolling stamps the cohort, and the cohort is the month they started", () => {
  const mrn = newPatient("Cohorted");
  const id = G.enrol({
    programmeCode: "HIV", patientMrn: mrn, programmeNumber: "CCC-00001",
    enrolledOn: "2026-04-17", ...BY,
  });

  const e = G.getEnrolment(id)!;
  assert.equal(e.cohort, "2026-04");
  assert.equal(e.status, "active");
  assert.equal(e.programme_number, "CCC-00001");
});

test("a programme number cannot be given to two people", () => {
  const other = newPatient("Duplicate");
  assert.throws(
    () => G.enrol({ programmeCode: "HIV", patientMrn: other, programmeNumber: "CCC-00001", ...BY }),
    /already on the register, against/,
  );
});

test("a patient cannot be enrolled twice in the same programme", () => {
  const mrn = newPatient("Twice");
  G.enrol({ programmeCode: "TB", patientMrn: mrn, programmeNumber: "TB-0001", ...BY });
  assert.throws(
    () => G.enrol({ programmeCode: "TB", patientMrn: mrn, programmeNumber: "TB-0002", ...BY }),
    /already on the .* register as TB-0001/,
    "two register entries for one person is how a cohort report stops adding up",
  );
});

test("but the same patient can be on two different registers", () => {
  const mrn = newPatient("Both");
  G.enrol({ programmeCode: "HIV", patientMrn: mrn, programmeNumber: "CCC-00009", ...BY });
  G.enrol({ programmeCode: "TB", patientMrn: mrn, programmeNumber: "TB-0009", ...BY });
  assert.equal(G.enrolmentsFor(mrn).length, 2, "co-infection is the common case, not the exception");
});

test("a future enrolment date is refused", () => {
  const mrn = newPatient("Future");
  assert.throws(
    () => G.enrol({ programmeCode: "NCD", patientMrn: mrn, programmeNumber: "NCD-1", enrolledOn: inDays(3), ...BY }),
    /in the future/,
  );
});

test("an enrolment is audited as treatment — it is among the most sensitive facts a record holds", () => {
  const entry = get<{ action: string; purpose: string; patient_id: string }>(
    `SELECT action, purpose, patient_id FROM audit_log WHERE action = 'programme_enrolled' ORDER BY id DESC LIMIT 1`,
  )!;
  assert.equal(entry.purpose, "treatment");
  assert.ok(entry.patient_id);
});

// ===================================================================== visits

test("a visit records when the patient is expected back", () => {
  const mrn = newPatient("Visiting");
  const id = G.enrol({ programmeCode: "HIV", patientMrn: mrn, programmeNumber: "CCC-00010", enrolledOn: inDays(-90), ...BY });

  G.recordVisit({
    enrolmentId: id,
    visitDate: inDays(-30),
    nextDue: inDays(60),
    findings: { viralLoad: "Undetectable", weightKg: 61 },
    note: "Stable on first-line. Adherence good.",
    ...BY,
  });

  const visits = G.visitsFor(id);
  assert.equal(visits.length, 1);
  assert.equal(visits[0].next_due, inDays(60));
  assert.equal(JSON.parse(visits[0].findings).viralLoad, "Undetectable");
});

test("an appointment before the visit, or a visit before the enrolment, is refused", () => {
  const mrn = newPatient("Backwards");
  const id = G.enrol({ programmeCode: "NCD", patientMrn: mrn, programmeNumber: "NCD-0002", enrolledOn: inDays(-10), ...BY });

  assert.throws(
    () => G.recordVisit({ enrolmentId: id, visitDate: inDays(-2), nextDue: inDays(-5), ...BY }),
    /must be after this visit/,
  );
  assert.throws(
    () => G.recordVisit({ enrolmentId: id, visitDate: inDays(-40), ...BY }),
    /cannot be before the enrolment/,
  );
});

// ================================================== who has not come back

test("somebody past their appointment is late; past the threshold they are lost", () => {
  const late = newPatient("Late");
  const lateId = G.enrol({ programmeCode: "HIV", patientMrn: late, programmeNumber: "CCC-00020", enrolledOn: inDays(-120), ...BY });
  G.recordVisit({ enrolmentId: lateId, visitDate: inDays(-40), nextDue: inDays(-10), ...BY });

  const lost = newPatient("Lost");
  const lostId = G.enrol({ programmeCode: "HIV", patientMrn: lost, programmeNumber: "CCC-00021", enrolledOn: inDays(-200), ...BY });
  G.recordVisit({ enrolmentId: lostId, visitDate: inDays(-90), nextDue: inDays(-45), ...BY });

  const overdue = G.defaulters("HIV");
  const isLate = overdue.find((d) => d.enrolment.id === lateId)!;
  const isLost = overdue.find((d) => d.enrolment.id === lostId)!;

  assert.equal(isLate.daysOverdue, 10);
  assert.equal(isLate.lost, false, "ten days on HIV care is late, not lost");
  assert.equal(isLost.daysOverdue, 45);
  assert.equal(isLost.lost, true, "past the 28-day HIV threshold");
  assert.deepEqual(
    overdue.map((d) => d.daysOverdue),
    [...overdue.map((d) => d.daysOverdue)].sort((a, b) => b - a),
    "longest gone first",
  );
});

test("the threshold differs by programme, because the consequence differs", () => {
  assert.equal(G.LOST_AFTER_DAYS.TB, 14);
  assert.equal(G.LOST_AFTER_DAYS.HIV, 28);
  assert.equal(G.LOST_AFTER_DAYS.NCD, 60);

  const mrn = newPatient("Tuberculous");
  const id = G.enrol({ programmeCode: "TB", patientMrn: mrn, programmeNumber: "TB-0020", enrolledOn: inDays(-60), ...BY });
  G.recordVisit({ enrolmentId: id, visitDate: inDays(-40), nextDue: inDays(-20), ...BY });

  const found = G.defaulters("TB").find((d) => d.enrolment.id === id)!;
  assert.equal(found.lost, true, "twenty days off TB treatment is already lost");
});

test("somebody who came back after missing an appointment is not a defaulter", () => {
  const mrn = newPatient("Returned");
  const id = G.enrol({ programmeCode: "HIV", patientMrn: mrn, programmeNumber: "CCC-00030", enrolledOn: inDays(-150), ...BY });
  G.recordVisit({ enrolmentId: id, visitDate: inDays(-100), nextDue: inDays(-60), ...BY });
  // Missed it, but turned up late and was seen.
  G.recordVisit({ enrolmentId: id, visitDate: inDays(-50), nextDue: inDays(30), ...BY });

  assert.ok(!G.defaulters("HIV").some((d) => d.enrolment.id === id));
});

test("the sweep puts the lost on a clinician's desk and the merely late on reception's", () => {
  const result = G.sweepDefaulters(facilityId);
  assert.ok(result.lost > 0);
  assert.ok(result.late > 0);

  const lost = N.inbox(facilityId, "clinician").find((n) => n.kind === "programme_lost")!;
  assert.equal(lost.severity, "critical");
  assert.match(lost.subject, /lost to follow-up/);

  const late = N.inbox(facilityId, "receptionist").find((n) => n.kind === "programme_late")!;
  assert.match(late.body, /telephone call now/);
});

// =================================================================== outcomes

test("an outcome must say why — a cohort report with an unexplained exit is a hole in it", () => {
  const mrn = newPatient("Leaving");
  const id = G.enrol({ programmeCode: "NCD", patientMrn: mrn, programmeNumber: "NCD-0050", ...BY });

  assert.throws(
    () => G.recordOutcome({ enrolmentId: id, status: "transferred_out", note: "  ", byUserId: adminId, byUserName: "admin" }),
    /must record why/,
  );

  G.recordOutcome({
    enrolmentId: id, status: "transferred_out",
    note: "Moved to Kisumu. Transfer letter issued to Lumumba Sub-County Hospital.",
    byUserId: adminId, byUserName: "admin",
  });
  assert.equal(G.getEnrolment(id)!.status, "transferred_out");
});

test("a visit cannot be recorded on an enrolment that has ended", () => {
  const ended = all<{ id: string }>(`SELECT id FROM enrolments WHERE status = 'transferred_out' LIMIT 1`)[0];
  assert.throws(() => G.recordVisit({ enrolmentId: ended.id, ...BY }), /Re-open it before recording a visit/);
});

test("somebody who comes back can be re-opened, and it says so on the record", () => {
  const ended = all<{ id: string }>(`SELECT id FROM enrolments WHERE status = 'transferred_out' LIMIT 1`)[0];
  assert.throws(() => G.reopen({ enrolmentId: ended.id, reason: " ", byUserId: adminId, byUserName: "admin" }), /record why/);

  G.reopen({ enrolmentId: ended.id, reason: "Came back from Kisumu", byUserId: adminId, byUserName: "admin" });
  const e = G.getEnrolment(ended.id)!;
  assert.equal(e.status, "active");
  assert.equal(e.outcome_on, null);
  assert.match(e.outcome_note!, /re-opened: Came back from Kisumu/);
});

test("a death is not re-opened — that is a records correction, not a return", () => {
  const mrn = newPatient("Deceased");
  const id = G.enrol({ programmeCode: "HIV", patientMrn: mrn, programmeNumber: "CCC-00099", ...BY });
  G.recordOutcome({ enrolmentId: id, status: "died", note: "Died at home", byUserId: adminId, byUserName: "admin" });
  assert.throws(() => G.reopen({ enrolmentId: id, reason: "mistake", byUserId: adminId, byUserName: "admin" }), /records correction/);
});

// ============================================================ cohort reporting

test("the cohort report answers where everyone who started in a month has got to", () => {
  // A cohort with a known shape, so the arithmetic is checkable.
  for (let i = 0; i < 10; i++) {
    const mrn = newPatient(`Cohort${i}`);
    const id = G.enrol({
      programmeCode: "NCD", patientMrn: mrn, programmeNumber: `NCD-C${i}`,
      enrolledOn: "2026-02-10", ...BY,
    });
    if (i < 6) continue; // six stay active
    const outcome = (["transferred_out", "lost", "died", "stopped"] as const)[i - 6];
    G.recordOutcome({ enrolmentId: id, status: outcome, note: "Test cohort", byUserId: adminId, byUserName: "admin" });
  }

  const feb = G.cohortReport("NCD").find((c) => c.cohort === "2026-02")!;
  assert.equal(feb.started, 10);
  assert.equal(feb.active, 6);
  assert.equal(feb.transferredOut, 1);
  assert.equal(feb.lost, 1);
  assert.equal(feb.died, 1);
  assert.equal(feb.stopped, 1);

  // Transferred out counts as retained — they are in care, elsewhere. Getting
  // this wrong understates every facility that refers.
  assert.equal(feb.retentionPercent, 70);
});

test("the register lists everyone with when they were last seen and when they are due", () => {
  const rows = G.register("HIV");
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.patient_name && r.programme_number));
  assert.ok(rows.some((r) => r.last_seen && r.next_due));
  assert.ok(G.register("HIV", "active").every((r) => r.status === "active"));
});

test("the audit chain survives the programme registers", () => {
  const v = verifyAuditChain();
  assert.equal(v.ok, true, v.ok ? "" : `broken at entry ${v.failedAtId}`);
});
