/**
 * M32 Radiology.
 *
 * The rules that make imaging different from a blood test, and they all come
 * from the same fact: you cannot un-expose somebody. Nothing ionising happens
 * without a justification and, where it applies, the pregnancy question. A
 * pacemaker stops an MRI outright. Dose is summed per patient rather than
 * recorded per study and forgotten.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-rad-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const R = await import("../src/lib/radiology.ts");
const O = await import("../src/lib/orders.ts");
const E = await import("../src/lib/encounters.ts");
const P = await import("../src/lib/patients.ts");
const N = await import("../src/lib/notifications.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId, labTechId } = seedDemo();
registerDevice({ facilityId, code: "RAD1", label: "Radiology", byUserId: adminId, byUserName: "admin" });

const DEV = "RAD1";
const DOC = { byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru" };
const ORDERER = { ordererId: clinicianId!, ordererName: "Dr. Achieng Wanjiru" };
const AT = { facilityId, ...DOC };

let nid = 66_000_000;
const yearsAgo = (n: number) => new Date(Date.now() - n * 365.2425 * 86_400_000).toISOString().slice(0, 10);

function newPatient(given: string, sex: "male" | "female" = "male", dob?: string): string {
  return P.registerPatient({
    facilityId, deviceCode: DEV, givenName: given, familyName: "Imaging", sex,
    dateOfBirth: dob, nationalId: String(++nid), byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
}

function imagingOrder(mrn: string, service = "IMG-CXR"): string {
  // A patient has one open encounter at a time — the system refuses a second,
  // and it is right to. Several films on one attendance belong to one of them.
  const enc =
    E.openEncounterFor(mrn)?.id ??
    E.openEncounter({
      facilityId, patientMrn: mrn, kind: "outpatient",
      clinicianId: clinicianId!, clinicianName: DOC.byUserName, deviceCode: DEV,
    });
  return O.placeOrder({
    encounterId: enc, kind: "imaging", serviceCode: service, payerCode: "CASH",
    clinicalQuestion: "Rule out pneumonia", deviceCode: DEV, ...ORDERER,
  });
}

/** A study open and ready to be justified. */
type Modality = "xray" | "ultrasound" | "ct" | "mri" | "fluoroscopy" | "mammography";

function study(given: string, opts: { sex?: "male" | "female"; dob?: string; modality?: Modality } = {}) {
  const mrn = newPatient(given, opts.sex ?? "male", opts.dob);
  const order = imagingOrder(mrn, opts.modality === "ultrasound" ? "IMG-USS-ABD" : "IMG-CXR");
  const id = R.openStudy({
    orderId: order, modality: opts.modality ?? "xray", bodyPart: "Chest",
    laterality: "not_applicable", ...DOC, deviceCode: DEV,
  });
  return { mrn, order, id };
}

/** A justified study, ready to be performed. */
function justified(given: string, opts: Parameters<typeof study>[1] = {}) {
  const s = study(given, opts);
  R.justifyStudy({
    studyId: s.id, justification: "Fever and focal chest signs, antibiotic decision depends on it",
    pregnancyCheck: R.needsPregnancyCheck(s.mrn, opts.modality ?? "xray") ? "not_pregnant" : undefined,
    ...AT,
  });
  return s;
}

// =============================================================== the modality

test("ultrasound and MRI are not ionising, and everything else here is", () => {
  assert.equal(R.IONISING.ultrasound, false);
  assert.equal(R.IONISING.mri, false);
  assert.equal(R.IONISING.xray, true);
  assert.equal(R.IONISING.ct, true);
  assert.equal(R.IONISING.mammography, true);
});

test("the pregnancy question is asked of a woman of childbearing age, for ionising studies only", () => {
  const woman = newPatient("Childbearing", "female", yearsAgo(28));
  const man = newPatient("Man", "male", yearsAgo(28));
  const child = newPatient("Child", "female", yearsAgo(6));
  const older = newPatient("Older", "female", yearsAgo(70));

  assert.equal(R.needsPregnancyCheck(woman, "xray"), true);
  assert.equal(R.needsPregnancyCheck(woman, "ct"), true);
  assert.equal(R.needsPregnancyCheck(woman, "ultrasound"), false, "no dose, no question");
  assert.equal(R.needsPregnancyCheck(man, "xray"), false);
  assert.equal(R.needsPregnancyCheck(child, "xray"), false);
  assert.equal(R.needsPregnancyCheck(older, "xray"), false);
});

test("a female patient with no date of birth is asked, because unknown is not a reason to skip it", () => {
  const unknown = newPatient("Undated", "female");
  assert.equal(R.needsPregnancyCheck(unknown, "xray"), true);
});

// ================================================================= the study

test("a study can only be opened on an imaging order", () => {
  const mrn = newPatient("Wrongkind");
  const enc = E.openEncounter({
    facilityId, patientMrn: mrn, kind: "outpatient",
    clinicianId: clinicianId!, clinicianName: DOC.byUserName, deviceCode: DEV,
  });
  const lab = O.placeOrder({
    encounterId: enc, kind: "lab", serviceCode: "LAB-CBC", payerCode: "CASH", deviceCode: DEV, ...ORDERER,
  });
  assert.throws(
    () => R.openStudy({ orderId: lab, modality: "xray", bodyPart: "Chest", ...DOC, deviceCode: DEV }),
    /not an imaging request/,
  );
});

test("a study gets an accession, and two studies never share one", () => {
  const a = study("Accessioned");
  const b = study("Accessionedtoo");
  const first = R.getStudy(a.id)!;
  const second = R.getStudy(b.id)!;
  assert.match(first.accession, /^XRA-/);
  assert.notEqual(first.accession, second.accession, "two studies on one accession is how a film lands on the wrong report");
  assert.equal(R.studyByAccession(first.accession)!.id, a.id);
});

test("a second study cannot be opened on the same order", () => {
  const s = study("Doubled");
  assert.throws(
    () => R.openStudy({ orderId: s.order, modality: "xray", bodyPart: "Chest", ...DOC, deviceCode: DEV }),
    /already open on that order/,
  );
});

test("a repeat must say why the first study was not adequate", () => {
  const first = justified("Repeated");
  R.performStudy({ studyId: first.id, radiographerName: "Mr. Barasa", ...AT });

  const mrn = first.mrn;
  const order = imagingOrder(mrn);
  assert.throws(
    () => R.openStudy({ orderId: order, modality: "xray", bodyPart: "Chest", repeatOf: first.id, ...DOC, deviceCode: DEV }),
    /why the first study was not adequate/,
    "a repeat is a second dose, and a department needs to know which projection keeps repeating",
  );

  const repeat = R.openStudy({
    orderId: order, modality: "xray", bodyPart: "Chest",
    repeatOf: first.id, repeatReason: "Patient moved, scapulae obscuring the fields",
    ...DOC, deviceCode: DEV,
  });
  assert.equal(R.getStudy(repeat)!.repeat_of, first.id);
});

// =========================================================== justification

test("an exposure must be justified before it happens", () => {
  const s = study("Unjustified");
  assert.throws(
    () => R.justifyStudy({ studyId: s.id, justification: "   ", ...AT }),
    /a justification written after the film is a different thing/,
  );
  assert.throws(
    () => R.performStudy({ studyId: s.id, radiographerName: "Mr. Barasa", ...AT }),
    /nothing is exposed before somebody has put their name to why/,
  );
});

test("a woman of childbearing age cannot be exposed without the question being answered", () => {
  const s = study("Unasked", { sex: "female", dob: yearsAgo(30) });
  assert.throws(
    () => R.justifyStudy({ studyId: s.id, justification: "Cough and fever", ...AT }),
    /pregnancy question answered/,
  );
});

test('"not applicable" is an answer, but it has to say why', () => {
  const s = study("Notapplicable", { sex: "female", dob: yearsAgo(30) });
  assert.throws(
    () => R.justifyStudy({ studyId: s.id, justification: "Cough", pregnancyCheck: "not_applicable", ...AT }),
    /has to say why/,
  );
  R.justifyStudy({
    studyId: s.id, justification: "Cough", pregnancyCheck: "not_applicable",
    pregnancyNote: "Hysterectomy in 2019, recorded in the notes", ...AT,
  });
  assert.equal(R.getStudy(s.id)!.status, "justified");
});

test("a possible pregnancy escalates the study — it does not block it", () => {
  // Blocking teaches people to answer "not pregnant" to get past the screen,
  // which is how the question stops being asked at all.
  const s = study("Possiblypregnant", { sex: "female", dob: yearsAgo(26) });
  const { escalated } = R.justifyStudy({
    studyId: s.id,
    justification: "Road traffic collision, shocked, chest film needed before theatre",
    pregnancyCheck: "possible", pregnancyNote: "Last period uncertain", ...AT,
  });

  assert.equal(escalated, true);
  const alert = N.inbox(facilityId, "clinician").find((n) => n.kind === "imaging_pregnancy" && n.entity_id === s.id);
  assert.ok(alert);
  assert.equal(alert!.severity, "critical");
  assert.match(alert!.body, /still the right film/);

  // And the film is taken.
  R.performStudy({ studyId: s.id, radiographerName: "Mr. Barasa", ...AT });
  assert.equal(R.getStudy(s.id)!.status, "performed");
});

test("an ultrasound needs no pregnancy check at all", () => {
  const s = study("Scanned", { sex: "female", dob: yearsAgo(30), modality: "ultrasound" });
  R.justifyStudy({ studyId: s.id, justification: "Right upper quadrant pain, query gallstones", ...AT });
  R.performStudy({ studyId: s.id, radiographerName: "Mr. Barasa", ...AT });
  assert.equal(R.getStudy(s.id)!.status, "performed");
  assert.equal(R.getStudy(s.id)!.dose_usv, null, "no dose, because there is none");
});

// ============================================================= MRI screening

test("an MRI will not run until every screening question is answered", () => {
  const mrn = newPatient("Scanning");
  const order = imagingOrder(mrn);
  const id = R.openStudy({ orderId: order, modality: "mri", bodyPart: "Lumbar spine", ...DOC, deviceCode: DEV });
  R.justifyStudy({ studyId: id, justification: "Progressive leg weakness, query cord compression", ...AT });

  assert.throws(
    () => R.performStudy({ studyId: id, radiographerName: "Mr. Barasa", ...AT }),
    /safety screening is not complete/,
  );

  for (const item of R.MRI_SCREENING) {
    R.answerSafetyCheck({ studyId: id, itemCode: item.code, answer: "no", ...DOC });
  }
  R.performStudy({ studyId: id, radiographerName: "Mr. Barasa", ...AT });
  assert.equal(R.getStudy(id)!.status, "performed");
});

test("a pacemaker blocks the scan outright — this is the one place the module refuses", () => {
  const mrn = newPatient("Paced");
  const order = imagingOrder(mrn);
  const id = R.openStudy({ orderId: order, modality: "mri", bodyPart: "Brain", ...DOC, deviceCode: DEV });
  R.justifyStudy({ studyId: id, justification: "Query posterior circulation stroke", ...AT });

  for (const item of R.MRI_SCREENING) {
    R.answerSafetyCheck({
      studyId: id, itemCode: item.code,
      answer: item.code === "PACEMAKER" ? "yes" : "no", ...DOC,
    });
  }

  assert.throws(
    () => R.performStudy({ studyId: id, radiographerName: "Mr. Barasa", ...AT }),
    /Pacemaker, implanted defibrillator or neurostimulator/,
    "a pacemaker in a magnet is not a risk to be weighed at the console",
  );
  assert.equal(R.safetyState(id).blocking.length, 1);
});

test('an "unknown" on a blocking question blocks too', () => {
  const mrn = newPatient("Unsure");
  const order = imagingOrder(mrn);
  const id = R.openStudy({ orderId: order, modality: "mri", bodyPart: "Orbits", ...DOC, deviceCode: DEV });
  R.justifyStudy({ studyId: id, justification: "Query orbital lesion", ...AT });
  for (const item of R.MRI_SCREENING) {
    R.answerSafetyCheck({
      studyId: id, itemCode: item.code,
      answer: item.code === "METAL_EYE" ? "unknown" : "no", ...DOC,
    });
  }
  assert.throws(() => R.performStudy({ studyId: id, radiographerName: "Mr. Barasa", ...AT }), /Metal fragment in the eye/);
});

test("a non-blocking yes does not stop the scan", () => {
  const mrn = newPatient("Claustrophobic");
  const order = imagingOrder(mrn);
  const id = R.openStudy({ orderId: order, modality: "mri", bodyPart: "Knee", ...DOC, deviceCode: DEV });
  R.justifyStudy({ studyId: id, justification: "Locking knee, query meniscal tear", ...AT });
  for (const item of R.MRI_SCREENING) {
    R.answerSafetyCheck({
      studyId: id, itemCode: item.code,
      answer: item.code === "CLAUSTROPHOBIA" ? "yes" : "no",
      note: item.code === "CLAUSTROPHOBIA" ? "Will need sedation" : undefined,
      ...DOC,
    });
  }
  R.performStudy({ studyId: id, radiographerName: "Mr. Barasa", ...AT });
  assert.equal(R.getStudy(id)!.status, "performed");
});

test("a question not on the screening is refused rather than invented", () => {
  const s = study("Madeup");
  assert.throws(
    () => R.answerSafetyCheck({ studyId: s.id, itemCode: "VIBES", answer: "no", ...DOC }),
    /not on the safety screening/,
  );
});

// ================================================================ the dose

test("a study with no reported dose falls back to a typical figure, and says it is an estimate", () => {
  const s = justified("Estimated");
  R.performStudy({ studyId: s.id, radiographerName: "Mr. Barasa", ...AT });
  assert.equal(R.getStudy(s.id)!.dose_usv, R.TYPICAL_DOSE_USV.xray);

  const dose = R.cumulativeDose(s.mrn);
  assert.equal(dose.studies[0].estimated, true, "the difference between a number and a guess");
  assert.equal(dose.estimatedUsv, R.TYPICAL_DOSE_USV.xray);
  assert.equal(dose.measuredUsv, 0);
});

test("a reported dose wins over the typical figure and counts as measured", () => {
  const s = justified("Measured");
  R.performStudy({ studyId: s.id, radiographerName: "Mr. Barasa", doseUgyM2: 118, doseUsv: 84, ...AT });
  const dose = R.cumulativeDose(s.mrn);
  assert.equal(dose.totalUsv, 84);
  assert.equal(dose.measuredUsv, 84);
  assert.equal(dose.estimatedUsv, 0);
});

test("dose is cumulative per patient, which is the question nobody can answer", () => {
  const first = justified("Cumulative");
  R.performStudy({ studyId: first.id, radiographerName: "Mr. Barasa", doseUsv: 90, ...AT });

  // Two more films on the same patient.
  for (const dose of [110, 140]) {
    const order = imagingOrder(first.mrn);
    const id = R.openStudy({ orderId: order, modality: "xray", bodyPart: "Abdomen", ...DOC, deviceCode: DEV });
    R.justifyStudy({ studyId: id, justification: "Serial films for obstruction", ...AT });
    R.performStudy({ studyId: id, radiographerName: "Mr. Barasa", doseUsv: dose, ...AT });
  }

  const total = R.cumulativeDose(first.mrn);
  assert.equal(total.studies.length, 3);
  assert.equal(total.totalUsv, 340);
});

test("an ultrasound contributes nothing to a cumulative dose", () => {
  const s = justified("Sonographed", { sex: "female", dob: yearsAgo(30), modality: "ultrasound" });
  R.performStudy({ studyId: s.id, radiographerName: "Mr. Barasa", ...AT });
  assert.equal(R.cumulativeDose(s.mrn).studies.length, 0);
});

// ================================================================= reports

test("a study cannot be reported before it has been performed", () => {
  const s = justified("Unperformed");
  assert.throws(
    () => R.reportStudy({ studyId: s.id, kind: "provisional", findings: "x", impression: "y", ...AT }),
    /nothing to report/,
  );
});

test("a report must give an impression, not only findings", () => {
  const s = justified("Impressionless");
  R.performStudy({ studyId: s.id, radiographerName: "Mr. Barasa", ...AT });
  assert.throws(
    () => R.reportStudy({ studyId: s.id, kind: "final", findings: "Patchy opacity right base", impression: "  ", ...AT }),
    /leave the decision to the reader/,
  );
});

test("a critical finding raises an alert and appears on the uncommunicated list", () => {
  const s = justified("Pneumothorax");
  R.performStudy({ studyId: s.id, radiographerName: "Mr. Barasa", ...AT });
  const reportId = R.reportStudy({
    studyId: s.id, kind: "provisional",
    findings: "Large right-sided pneumothorax with mediastinal shift",
    impression: "Tension pneumothorax", critical: true, ...AT,
  });

  const alert = N.inbox(facilityId, "clinician").find((n) => n.kind === "imaging_critical" && n.entity_id === s.id);
  assert.ok(alert);
  assert.equal(alert!.severity, "critical");
  assert.match(alert!.body, /Filing it is not communicating it/);
  assert.ok(R.uncommunicatedCritical().some((r) => r.study.id === s.id));

  assert.throws(
    () => R.recordCommunication({ reportId, communicatedTo: "   ", ...DOC }),
    /told to a person, not to a system/,
  );
  R.recordCommunication({ reportId, communicatedTo: "Dr. Achieng Wanjiru, by telephone", ...DOC });
  assert.ok(!R.uncommunicatedCritical().some((r) => r.study.id === s.id));
});

test("a final report that disagrees with the provisional is kept as a discrepancy", () => {
  const s = justified("Disagreed");
  R.performStudy({ studyId: s.id, radiographerName: "Mr. Barasa", ...AT });
  R.reportStudy({
    studyId: s.id, kind: "provisional",
    findings: "Clear lung fields", impression: "Normal chest", ...AT,
  });

  assert.throws(
    () => R.reportStudy({
      studyId: s.id, kind: "final", findings: "Left lower lobe consolidation",
      impression: "Pneumonia", discrepancy: true, ...AT,
    }),
    /what the difference is, and what follows from it/,
  );

  R.reportStudy({
    studyId: s.id, kind: "final",
    findings: "Left lower lobe consolidation behind the cardiac shadow",
    impression: "Pneumonia", discrepancy: true,
    discrepancyNote: "Reported normal overnight. Patient was discharged without antibiotics — recall today.",
    ...AT,
  });

  const reports = R.reportsFor(s.id);
  assert.equal(reports.length, 2);
  assert.equal(reports[0].impression, "Normal chest", "the provisional read is what the ward acted on, and it stands");
  assert.equal(reports[1].discrepancy, 1);
  assert.ok(N.inbox(facilityId, "clinician").some((n) => n.kind === "imaging_discrepancy" && n.entity_id === s.id));
});

test("a second report of the same kind is refused — a correction is an addendum", () => {
  const s = justified("Twicereported");
  R.performStudy({ studyId: s.id, radiographerName: "Mr. Barasa", ...AT });
  R.reportStudy({ studyId: s.id, kind: "final", findings: "Normal", impression: "Normal chest", ...AT });
  assert.throws(
    () => R.reportStudy({ studyId: s.id, kind: "final", findings: "Normal", impression: "Normal", ...AT }),
    /a correction is an addendum/,
  );
  R.reportStudy({
    studyId: s.id, kind: "addendum", findings: "On review, a small nodule at the right apex",
    impression: "Nodule, recommend CT", ...AT,
  });
  assert.equal(R.reportsFor(s.id).length, 2);
});

test("a final report moves the order on so the ordering clinician sees it", () => {
  const s = justified("Resulted");
  R.performStudy({ studyId: s.id, radiographerName: "Mr. Barasa", ...AT });
  R.reportStudy({ studyId: s.id, kind: "final", findings: "Normal", impression: "Normal chest", ...AT });
  assert.equal(O.getOrder(s.order)!.status, "resulted");
  assert.equal(R.getStudy(s.id)!.status, "verified");
});

// ================================================================ worklists

test("the worklist puts blocked studies first, then by priority", () => {
  const work = R.imagingWorklist();
  const firstUnblocked = work.findIndex((r) => !r.blockedBy);
  if (firstUnblocked > 0) {
    assert.ok(work.slice(0, firstUnblocked).every((r) => r.blockedBy), "everything blocked sorts above everything else");
  }
  assert.ok(work.some((r) => r.blockedBy), "and something is blocked, so the test is not vacuous");
});

test("the worklist says what is standing between a study and the scanner", () => {
  const s = study("Waiting", { sex: "female", dob: yearsAgo(30) });
  const row = R.imagingWorklist().find((r) => r.study.id === s.id)!;
  assert.equal(row.blockedBy, "not justified");
  assert.equal(row.clinicalQuestion, "Rule out pneumonia", "the question the clinician actually asked");
});

test("a performed study cannot be cancelled, and cancelling records why", () => {
  const s = justified("Cancelled");
  assert.throws(() => R.cancelStudy({ studyId: s.id, reason: "  ", ...DOC }), /must record why/);
  R.cancelStudy({ studyId: s.id, reason: "Patient went home before the film", ...DOC });
  assert.equal(R.getStudy(s.id)!.status, "cancelled");

  const done = justified("Performed");
  R.performStudy({ studyId: done.id, radiographerName: "Mr. Barasa", ...AT });
  assert.throws(() => R.cancelStudy({ studyId: done.id, reason: "changed mind", ...DOC }), /has been performed/);
});

test("a study is performed once", () => {
  const s = justified("Twice");
  R.performStudy({ studyId: s.id, radiographerName: "Mr. Barasa", ...AT });
  assert.throws(
    () => R.performStudy({ studyId: s.id, radiographerName: "Mr. Barasa", ...AT }),
    /already been performed/,
  );
});

// =================================================================== report

test("the summary counts what a radiology department is judged on", () => {
  const s = R.radiologySummary();
  assert.ok(s.studies >= 20);
  assert.ok(s.performed >= 10);
  assert.ok(s.repeats >= 1);
  assert.ok(s.repeatRatePercent !== null);
  assert.ok(s.criticalFindings >= 1);
  assert.ok(s.discrepancies >= 1);
  assert.ok(s.pregnancyEscalations >= 1);
  assert.ok(s.byModality.mri >= 3);
  assert.ok(s.totalDoseMsv > 0);
  assert.ok(s.estimatedSharePercent !== null && s.estimatedSharePercent > 0,
    "and it says how much of that total is a guess");
});

test("rates are absent, not zero, when nothing happened in the period", () => {
  const empty = R.radiologySummary("1990-01-01", "1990-12-31");
  assert.equal(empty.studies, 0);
  assert.equal(empty.repeatRatePercent, null);
  assert.equal(empty.estimatedSharePercent, null);
  assert.equal(empty.totalDoseMsv, 0);
});

// ==================================================================== audit

test("every exposure and every justification is on the audit chain", () => {
  const count = (action: string) =>
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`, action)!.n;

  assert.ok(count("imaging_study_opened") >= 20);
  assert.ok(count("imaging_justified") >= 15);
  assert.ok(count("imaging_performed") >= 10);
  assert.ok(count("imaging_reported") >= 5);
  assert.ok(count("imaging_critical_communicated") >= 1);
  assert.ok(count("imaging_cancelled") >= 1);

  const v = verifyAuditChain();
  assert.equal(v.ok, true);
});
