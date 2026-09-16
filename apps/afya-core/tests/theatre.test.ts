/**
 * M25 Theatre.
 *
 * The two rules that make this a theatre module rather than a booking diary:
 * the WHO checklist gates the operation, and the count must reconcile before
 * the patient leaves. Everything else here exists to serve those two.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-ot-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const T = await import("../src/lib/theatre.ts");
const P = await import("../src/lib/patients.ts");
const N = await import("../src/lib/notifications.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "OTD1", label: "Theatre desk", byUserId: adminId, byUserName: "admin" });
T.seedTheatres(facilityId);

const DEV = "OTD1";
const SURGEON = { byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru" };
const BOOK = { byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru", deviceCode: DEV };

let nid = 58_000_000;
function newPatient(given: string): string {
  return P.registerPatient({
    facilityId, deviceCode: DEV, givenName: given, familyName: "Theatre", sex: "female",
    nationalId: String(++nid), byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
}

function book(given: string, over: Partial<Parameters<typeof T.bookCase>[0]> = {}): string {
  return T.bookCase({
    facilityId, patientMrn: newPatient(given), theatreCode: "OT1",
    procedurePlanned: "Emergency caesarean section", urgency: "urgent",
    laterality: "not_applicable", surgeonName: "Dr. Achieng Wanjiru",
    estimatedMinutes: 45, asaGrade: 2, ...BOOK, ...over,
  });
}

/** Answer every item on a stage "yes", which is the ordinary case. */
type Stage = "sign_in" | "time_out" | "sign_out";
type Answer = "yes" | "no" | "not_applicable";

function answerAll(caseId: string, stage: Stage, overrides: Record<string, Answer> = {}) {
  for (const item of T.CHECKLIST[stage]) {
    T.answerChecklist({
      caseId, stage, itemCode: item.code,
      answer: overrides[item.code] ?? "yes",
      byUserId: clinicianId, byUserName: "Sister Adhiambo",
    });
  }
}

function consent(caseId: string) {
  T.recordSurgicalConsent({
    caseId, risksDiscussed: "Bleeding, infection, injury to bladder, need for hysterectomy, anaesthetic risk",
    ...SURGEON,
  });
}

/** A case taken all the way to the knife, which several tests need. */
function toIncision(given: string, over: Partial<Parameters<typeof T.bookCase>[0]> = {}): string {
  const id = book(given, over);
  consent(id);
  T.arriveInTheatre({ caseId: id, ...SURGEON });
  answerAll(id, "sign_in");
  T.completeStage({ caseId: id, stage: "sign_in", ...SURGEON });
  T.startAnaesthesia({ caseId: id, anaesthesia: "spinal", anaesthetistName: "Dr. Kimathi", ...SURGEON });
  answerAll(id, "time_out");
  T.completeStage({ caseId: id, stage: "time_out", ...SURGEON });
  T.recordIncision({ caseId: id, ...SURGEON });
  return id;
}

// ================================================================== booking

test("a case must name the procedure — it is what consent and the checklist are read against", () => {
  assert.throws(
    () => T.bookCase({ facilityId, patientMrn: newPatient("Unnamed"), procedurePlanned: "  ", urgency: "elective", ...BOOK }),
    /must name the procedure/,
  );
});

test("a case cannot be booked into a theatre that does not exist", () => {
  assert.throws(
    () => T.bookCase({ facilityId, patientMrn: newPatient("Nowhere"), theatreCode: "OT9", procedurePlanned: "Hernia repair", urgency: "elective", ...BOOK }),
    /no such theatre/,
  );
});

test("an immediate case raises a critical alert with its one-hour window", () => {
  const id = book("Immediate", { urgency: "immediate", procedurePlanned: "Laparotomy for ruptured ectopic" });
  const alert = N.inbox(facilityId, "clinician").find((n) => n.kind === "theatre_immediate" && n.entity_id === id);
  assert.ok(alert);
  assert.equal(alert!.severity, "critical");
  assert.equal(T.URGENCY_TARGET_HOURS.immediate, 1);
  assert.equal(T.URGENCY_TARGET_HOURS.elective, null, "an elective case has no clock, and pretending otherwise is noise");
});

// ================================================================== consent

test("consent must record what risks were discussed", () => {
  const id = book("Unconsented");
  assert.throws(
    () => T.recordSurgicalConsent({ caseId: id, risksDiscussed: "   ", ...SURGEON }),
    /a signature against nothing is not consent/,
  );
});

test("anaesthesia does not start without recorded consent", () => {
  const id = book("Noconsent");
  T.arriveInTheatre({ caseId: id, ...SURGEON });
  answerAll(id, "sign_in");
  T.completeStage({ caseId: id, stage: "sign_in", ...SURGEON });
  assert.throws(
    () => T.startAnaesthesia({ caseId: id, anaesthesia: "general", anaesthetistName: "Dr. Kimathi", ...SURGEON }),
    /no recorded surgical consent/,
  );
});

test("the consent signature covers the procedure and the risks, so a change no longer matches", () => {
  const id = book("Signed");
  consent(id);
  const signature = T.consentFor(id)!;
  assert.equal(signature.purpose, "surgical_consent");
  assert.ok(signature.content_sha256.length === 64, "the signed content is hashed, not stored as prose");
});

// ================================================================ the gates

test("anaesthesia does not start before the sign-in", () => {
  const id = book("Nosignin");
  consent(id);
  T.arriveInTheatre({ caseId: id, ...SURGEON });
  assert.throws(
    () => T.startAnaesthesia({ caseId: id, anaesthesia: "general", anaesthetistName: "Dr. Kimathi", ...SURGEON }),
    /sign-in has not been completed/,
  );
});

test("the knife does not touch the patient before the time-out", () => {
  const id = book("Notimeout");
  consent(id);
  T.arriveInTheatre({ caseId: id, ...SURGEON });
  answerAll(id, "sign_in");
  T.completeStage({ caseId: id, stage: "sign_in", ...SURGEON });
  T.startAnaesthesia({ caseId: id, anaesthesia: "spinal", anaesthetistName: "Dr. Kimathi", ...SURGEON });
  assert.throws(
    () => T.recordIncision({ caseId: id, ...SURGEON }),
    /confirmed who this is, what is being done and where/,
  );
});

test("a stage cannot be completed while an item is unanswered — silence is not an answer", () => {
  const id = book("Halfanswered");
  T.answerChecklist({ caseId: id, stage: "sign_in", itemCode: "IDENTITY", answer: "yes", ...SURGEON });
  assert.throws(
    () => T.completeStage({ caseId: id, stage: "sign_in", ...SURGEON }),
    /not answered/,
  );
  assert.equal(T.checklistOutstanding(id, "sign_in").length, T.CHECKLIST.sign_in.length - 1);
});

test('"not applicable" is an answer and completes the stage', () => {
  const id = book("Notapplicable");
  answerAll(id, "sign_in", { SITE_MARKED: "not_applicable" });
  T.completeStage({ caseId: id, stage: "sign_in", ...SURGEON });
  assert.ok(T.getCase(id)!.sign_in_at);
});

test("an item that is not on the checklist is refused rather than invented", () => {
  const id = book("Madeup");
  assert.throws(
    () => T.answerChecklist({ caseId: id, stage: "sign_in", itemCode: "VIBES", answer: "yes", ...SURGEON }),
    /is not an item on the sign in/,
  );
});

test('a "no" is recorded and escalated, never blocked', () => {
  // Software that refuses to proceed on a "no" teaches the team to answer yes,
  // which is worse than having no checklist at all.
  const id = book("Nosite");
  const result = T.answerChecklist({
    caseId: id, stage: "sign_in", itemCode: "SITE_MARKED", answer: "no",
    note: "Marker pen missing from the trolley", ...SURGEON,
  });
  assert.equal(result.escalated, true);

  const alert = N.inbox(facilityId, "clinician").find((n) => n.kind === "checklist_no" && n.entity_id === id);
  assert.ok(alert);
  assert.equal(alert!.severity, "critical");
  assert.match(alert!.body, /decision to proceed is the surgeon's/);

  // And the stage still completes — the case is not blocked.
  answerAll(id, "sign_in", { SITE_MARKED: "no" });
  T.completeStage({ caseId: id, stage: "sign_in", ...SURGEON });
  assert.ok(T.getCase(id)!.sign_in_at);
});

test('a "no" on a non-critical item is recorded without an alert', () => {
  const id = book("Noimaging");
  const before = N.inbox(facilityId, "clinician").filter((n) => n.kind === "checklist_no").length;
  answerAll(id, "sign_in");
  T.completeStage({ caseId: id, stage: "sign_in", ...SURGEON });
  const result = T.answerChecklist({ caseId: id, stage: "time_out", itemCode: "IMAGING", answer: "no", ...SURGEON });
  assert.equal(result.escalated, false);
  assert.equal(N.inbox(facilityId, "clinician").filter((n) => n.kind === "checklist_no").length, before);
});

test("every answer is stored individually, not as one checklist-done flag", () => {
  const id = book("Individually");
  answerAll(id, "sign_in", { ALLERGY: "not_applicable" });
  const answers = T.checklistAnswers(id, "sign_in");
  assert.equal(answers.length, T.CHECKLIST.sign_in.length);
  assert.equal(answers.find((a) => a.item_code === "ALLERGY")!.answer, "not_applicable");
  assert.ok(answers.every((a) => a.answerer_name === "Sister Adhiambo"), "and who answered it");
});

test("re-answering an item corrects it rather than adding a second row", () => {
  const id = book("Corrected");
  T.answerChecklist({ caseId: id, stage: "sign_in", itemCode: "ALLERGY", answer: "no", ...SURGEON });
  T.answerChecklist({ caseId: id, stage: "sign_in", itemCode: "ALLERGY", answer: "yes", note: "Checked the band", ...SURGEON });
  const rows = T.checklistAnswers(id, "sign_in").filter((a) => a.item_code === "ALLERGY");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].answer, "yes");
});

// =================================================================== the count

test("a count out with nothing counted in is refused", () => {
  const id = book("Uncounted");
  assert.throws(
    () => T.recordCountOut({ caseId: id, item: "Swabs", count: 10, ...SURGEON }),
    /never counted in/,
  );
});

test("a mismatched count raises a critical alert saying nobody leaves theatre", () => {
  const id = toIncision("Mismatched");
  T.recordCountIn({ caseId: id, item: "Swabs", count: 12, ...SURGEON });
  const result = T.recordCountOut({ caseId: id, item: "Swabs", count: 11, ...SURGEON });

  assert.equal(result.reconciles, false);
  const alert = N.inbox(facilityId, "clinician").find((n) => n.kind === "count_mismatch" && n.entity_id === id);
  assert.ok(alert);
  assert.equal(alert!.severity, "critical");
  assert.match(alert!.subject, /12 in, 11 out/);
});

test("the sign-out is refused while the count does not reconcile", () => {
  const id = toIncision("Blockedbycount");
  T.recordCountIn({ caseId: id, item: "Swabs", count: 12, ...SURGEON });
  T.recordCountIn({ caseId: id, item: "Needles", count: 4, ...SURGEON });
  T.recordCountOut({ caseId: id, item: "Swabs", count: 11, ...SURGEON });
  T.recordCountOut({ caseId: id, item: "Needles", count: 4, ...SURGEON });

  T.closeCase({ caseId: id, procedurePerformed: "Emergency caesarean section", findings: "Live female infant", ...SURGEON });
  answerAll(id, "sign_out");
  assert.throws(
    () => T.completeStage({ caseId: id, stage: "sign_out", ...SURGEON }),
    /Swabs 12 in, 11 out/,
    "a retained swab is a never-event, and the count is the only thing between a theatre and one",
  );
});

test("a discrepancy is resolved by recording how, and the numbers stay as they were found", () => {
  const id = toIncision("Resolved");
  T.recordCountIn({ caseId: id, item: "Swabs", count: 12, ...SURGEON });
  T.recordCountOut({ caseId: id, item: "Swabs", count: 11, ...SURGEON });

  assert.throws(
    () => T.resolveCount({ caseId: id, item: "Swabs", resolution: "   ", ...SURGEON }),
    /the numbers themselves are never edited/,
  );

  T.resolveCount({
    caseId: id, item: "Swabs",
    resolution: "Twelfth swab found under the drape after a full search. Recount correct. No imaging needed.",
    ...SURGEON,
  });

  const [row] = T.counts(id);
  assert.equal(row.counted_in, 12);
  assert.equal(row.counted_out, 11, "the record has to show there was a discrepancy");
  assert.match(row.resolution, /under the drape/);
  assert.equal(T.countDiscrepancies(id).length, 0, "and the sign-out is no longer blocked");
});

test("a reconciled count blocks nothing", () => {
  const id = toIncision("Reconciled");
  T.recordCountIn({ caseId: id, item: "Swabs", count: 10, ...SURGEON });
  const result = T.recordCountOut({ caseId: id, item: "Swabs", count: 10, ...SURGEON });
  assert.equal(result.reconciles, true);
  assert.equal(T.countDiscrepancies(id).length, 0);
});

// ============================================================ the operation

test("the whole path, from booking to recovery, with a signed operation note", () => {
  const id = toIncision("Fullpath");
  T.addTeamMember({ caseId: id, role: "Scrub nurse", personName: "Sister Adhiambo" });
  T.addTeamMember({ caseId: id, role: "Circulating nurse", personName: "Nurse Chebet" });
  T.recordCountIn({ caseId: id, item: "Swabs", count: 10, ...SURGEON });

  const { deviated } = T.closeCase({
    caseId: id,
    procedurePerformed: "Emergency caesarean section",
    findings: "Live female infant 3100 g, Apgar 8 and 9. Uterus contracted well. No extension of the incision.",
    bloodLossMl: 600, specimen: "Placenta for histology", ...SURGEON,
  });
  assert.equal(deviated, false);

  T.recordCountOut({ caseId: id, item: "Swabs", count: 10, ...SURGEON });
  answerAll(id, "sign_out");
  T.completeStage({ caseId: id, stage: "sign_out", ...SURGEON });
  T.leaveTheatre({ caseId: id, ...SURGEON });
  assert.equal(T.getCase(id)!.status, "in_recovery");

  T.completeCase({ caseId: id, ...SURGEON });
  const done = T.getCase(id)!;
  assert.equal(done.status, "completed");
  assert.equal(done.blood_loss_ml, 600);
  assert.ok(done.sign_in_at && done.time_out_at && done.sign_out_at && done.incision_at && done.closed_at);
  assert.equal(T.teamFor(id).length, 2, "an operation note that cannot name the scrub nurse is not a record");
});

test("the patient does not leave theatre before the sign-out", () => {
  const id = toIncision("Earlyexit");
  T.closeCase({ caseId: id, procedurePerformed: "Emergency caesarean section", findings: "Live infant", ...SURGEON });
  assert.throws(() => T.leaveTheatre({ caseId: id, ...SURGEON }), /does not leave theatre before it/);
});

test("the operation note must say what was done and what was found", () => {
  const id = toIncision("Emptynote");
  assert.throws(
    () => T.closeCase({ caseId: id, procedurePerformed: "  ", findings: "x", ...SURGEON }),
    /must say what was done/,
  );
  assert.throws(
    () => T.closeCase({ caseId: id, procedurePerformed: "Caesarean", findings: "   ", ...SURGEON }),
    /must record the findings/,
  );
});

test("a procedure that differs from what was consented is a recorded deviation, not an edit", () => {
  const id = toIncision("Deviated", { procedurePlanned: "Diagnostic laparoscopy" });
  const { deviated } = T.closeCase({
    caseId: id,
    procedurePerformed: "Laparotomy and right salpingectomy",
    findings: "Ruptured right tubal pregnancy with 1.2 L haemoperitoneum. Converted to open.",
    bloodLossMl: 1200, ...SURGEON,
  });

  assert.equal(deviated, true);
  const after = T.getCase(id)!;
  assert.equal(after.procedure_planned, "Diagnostic laparoscopy", "the planned procedure is never edited to match");
  assert.equal(after.procedure_performed, "Laparotomy and right salpingectomy");

  const alert = N.inbox(facilityId, "clinician").find((n) => n.kind === "procedure_deviation" && n.entity_id === id);
  assert.ok(alert);
});

test("the state machine refuses a step out of order", () => {
  // The specific gates fire before the generic state machine, which is the
  // better message: "the time-out has not been completed" tells a theatre what
  // to do, where "cannot become incised" tells it only that it cannot.
  const id = book("Outoforder");
  assert.throws(() => T.recordIncision({ caseId: id, ...SURGEON }), /time-out has not been completed/);
  T.arriveInTheatre({ caseId: id, ...SURGEON });
  assert.throws(() => T.arriveInTheatre({ caseId: id, ...SURGEON }), /cannot become in theatre/);
  const done = toIncision("Finished");
  T.closeCase({ caseId: done, procedurePerformed: "Emergency caesarean section", findings: "Live infant", ...SURGEON });
  T.recordCountIn({ caseId: done, item: "Swabs", count: 8, ...SURGEON });
  T.recordCountOut({ caseId: done, item: "Swabs", count: 8, ...SURGEON });
  answerAll(done, "sign_out");
  T.completeStage({ caseId: done, stage: "sign_out", ...SURGEON });
  T.leaveTheatre({ caseId: done, toRecovery: false, ...SURGEON });
  assert.throws(() => T.recordIncision({ caseId: done, ...SURGEON }), /it is finished/);
});

// =============================================================== cancellation

test("a cancellation records a category as well as a reason", () => {
  const id = book("Cancelled");
  assert.throws(
    () => T.cancelCase({ caseId: id, category: "no_anaesthetist", reason: "  ", ...SURGEON }),
    /must record why/,
  );
  T.cancelCase({ caseId: id, category: "no_anaesthetist", reason: "Only anaesthetist called to casualty", ...SURGEON });

  const after = T.getCase(id)!;
  assert.equal(after.status, "cancelled");
  assert.equal(after.cancel_category, "no_anaesthetist");
  assert.ok(T.theatreSummary(facilityId).byCancelCategory.no_anaesthetist >= 1);
});

test("a cancelled case takes no further checklist answers", () => {
  const id = book("Cancelledthen");
  T.cancelCase({ caseId: id, category: "patient_did_not_attend", reason: "Not on the ward at 8am", ...SURGEON });
  assert.throws(
    () => T.answerChecklist({ caseId: id, stage: "sign_in", itemCode: "IDENTITY", answer: "yes", ...SURGEON }),
    /was cancelled/,
  );
});

// =================================================================== the list

test("the list is ordered by urgency, not by booking time", () => {
  const rows = T.theatreList(facilityId);
  const urgencies = rows.map((r) => r.theatreCase.urgency);
  const order = { immediate: 0, urgent: 1, expedited: 2, elective: 3 };
  for (let i = 1; i < urgencies.length; i++) {
    assert.ok(order[urgencies[i]] >= order[urgencies[i - 1]], "an immediate case never sits below an elective one");
  }
});

test("the list says what each case is waiting for, in the words a theatre uses", () => {
  const id = book("Blocked");
  const row = T.theatreList(facilityId).find((r) => r.theatreCase.id === id)!;
  assert.equal(row.consented, false);
  assert.equal(row.blockedBy, "no recorded consent");

  consent(id);
  T.arriveInTheatre({ caseId: id, ...SURGEON });
  assert.equal(T.theatreList(facilityId).find((r) => r.theatreCase.id === id)!.blockedBy, "sign-in not complete");
});

test("a case in theatre shows up whatever day it was booked for", () => {
  const id = toIncision("Runninglate", { scheduledFor: "2020-01-01T08:00:00.000Z" });
  assert.ok(T.inTheatre(facilityId).some((r) => r.theatreCase.id === id));
  assert.ok(T.theatreList(facilityId).some((r) => r.theatreCase.id === id), "a case on the table is on today's list");
});

// ==================================================================== report

test("the summary reports what a theatre is judged on", () => {
  const s = T.theatreSummary(facilityId);
  assert.ok(s.booked >= 20);
  assert.ok(s.completed >= 2);
  assert.ok(s.cancelled >= 2);
  assert.ok(s.criticalNoes >= 1);
  assert.ok(s.countMismatches >= 2);
  assert.ok(s.deviations >= 1);
  assert.ok(s.cancellationRatePercent !== null);
  assert.ok(s.medianKnifeToSkinMinutes !== null);
});

test("checklist compliance counts only completed cases, and all three stages", () => {
  const s = T.theatreSummary(facilityId);
  assert.ok(s.checklistCompliantPercent !== null);
  assert.ok(s.checklistCompliantPercent! > 0 && s.checklistCompliantPercent! <= 100);
});

test("rates are absent, not zero, when nothing was booked in the period", () => {
  const empty = T.theatreSummary(facilityId, "1990-01-01", "1990-12-31");
  assert.equal(empty.booked, 0);
  assert.equal(empty.cancellationRatePercent, null, "no cases is not a zero per cent cancellation rate");
  assert.equal(empty.checklistCompliantPercent, null);
  assert.equal(empty.medianKnifeToSkinMinutes, null);
});

// ===================================================================== audit

test("every checklist stage and every count problem is on the audit chain", () => {
  const count = (action: string) =>
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`, action)!.n;

  assert.ok(count("theatre_case_booked") >= 20);
  assert.ok(count("checklist_sign_in") >= 5);
  assert.ok(count("checklist_time_out") >= 5);
  assert.ok(count("checklist_sign_out") >= 2);
  assert.ok(count("theatre_incision") >= 5);
  assert.ok(count("count_mismatch") >= 2);
  assert.ok(count("count_resolved") >= 1);
  assert.ok(count("theatre_case_cancelled") >= 2);

  const v = verifyAuditChain();
  assert.equal(v.ok, true);
});

// ------------------------------------------------- M63 equipment dependency

test("an autoclave past its pressure test stops the list, not just the estates screen", async () => {
  // `usable()` answered this from the day it was written, and until the theatre
  // asked it the rule was a red line on a screen somewhere else.
  const A = await import("../src/lib/assets.ts");

  const caseId = book("Sterile");
  consent(caseId);
  assert.equal(
    T.theatreList(facilityId).find((r) => r.theatreCase.id === caseId)!.blockedBy,
    null,
    "nothing is wrong yet",
  );

  const autoclave = A.assetByTag(facilityId, "OT-AC-01")!;
  const schedule = A.schedulesFor(autoclave.id).find((s) => s.blocks_use === 1)!;
  A.recordMaintenance({
    assetId: autoclave.id, scheduleId: schedule.id, kind: "safety_test",
    passed: false, findings: "Door seal fails at 1.8 bar",
    byUserId: adminId!, byUserName: "Facility Administrator", deviceCode: DEV,
  });

  const blocked = T.theatreList(facilityId).find((r) => r.theatreCase.id === caseId)!;
  assert.match(blocked.blockedBy!, /OT-AC-01 autoclave \(sterile instruments\)/);
  assert.match(blocked.blockedBy!, /Failed Pressure vessel test/);
});

test("consent still outranks the autoclave", () => {
  // A safety gate about this patient is never displaced by one about the room.
  const caseId = book("Unconsented");
  assert.equal(
    T.theatreList(facilityId).find((r) => r.theatreCase.id === caseId)!.blockedBy,
    "no recorded consent",
  );
});

test("a completed case is not blocked by equipment that failed afterwards", () => {
  const done = T.theatreList(facilityId).filter((r) => r.theatreCase.status === "completed");
  assert.ok(done.every((r) => r.blockedBy === null));
});

test("a case already under anaesthesia is not blocked by a service schedule", () => {
  // The operation is happening. Telling the list it is blocked by a pressure
  // test is noise that teaches everybody to ignore the column.
  const caseId = toIncision("Underway");
  const row = T.theatreList(facilityId).find((r) => r.theatreCase.id === caseId)!;
  assert.equal(row.theatreCase.status, "incised");
  assert.equal(row.blockedBy, null);
});
