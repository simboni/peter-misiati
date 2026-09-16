/**
 * M12 Biometric Verification.
 *
 * The tests that matter are the ones about not refusing: a failed match must
 * not deny care, an infant must not be held over a scanner, and a patient who
 * says no must be treated exactly the same as one who says yes.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-bio-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const B = await import("../src/lib/biometrics.ts");
const P = await import("../src/lib/patients.ts");
const F = await import("../src/lib/frontdesk.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, all } = await import("../src/lib/db.ts");

const { facilityId, adminId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "BIO1", label: "Reception", byUserId: adminId, byUserName: "admin" });

const DEV = "BIO1";
const BY = { byUserId: receptionistId!, byUserName: "Joseph Otieno" };
const BOSS = { byUserId: adminId!, byUserName: "Facility Administrator" };

B.seedBiometrics(facilityId);

let no = 0;
function aPatient(dateOfBirth = "1988-06-14") {
  no++;
  return P.registerPatient({
    facilityId, givenName: "Test", familyName: `Person${no}`, sex: "female",
    dateOfBirth, deviceCode: DEV, ...BY,
  });
}

function consenting(dateOfBirth?: string) {
  const mrn = aPatient(dateOfBirth);
  F.recordConsent({ patientMrn: mrn, purpose: "biometric", granted: true, ...BY });
  return mrn;
}

function enrolThumb(mrn: string, readerCode = "FP1") {
  return B.enrol({
    patientMrn: mrn, finger: "right_thumb",
    capture: B.simulateCapture(mrn, "right_thumb"),
    readerCode, deviceCode: DEV, ...BY,
  });
}

// ------------------------------------------------------------------ consent

test("enrolment without consent is refused, and there is no override", () => {
  // Biometric data is a special category under the Act. Consent to be treated
  // is not consent to be fingerprinted.
  const mrn = aPatient();
  assert.throws(() => enrolThumb(mrn), /has not consented/);
});

test("consent to treatment is not consent to be fingerprinted", () => {
  const mrn = aPatient();
  F.recordConsent({ patientMrn: mrn, purpose: "treatment", granted: true, ...BY });
  assert.throws(() => enrolThumb(mrn), /has not consented/);
});

test("a patient who says no is recorded and nothing else changes", () => {
  const mrn = aPatient();
  B.recordException({ patientMrn: mrn, reason: "refused", ...BY });

  const eligible = B.eligibility(mrn);
  assert.equal(eligible.attempt, false);
  assert.equal(eligible.exception!.reason, "refused");
  assert.match(eligible.reasons[0], /their right/);
});

// --------------------------------------------------------------- enrolment

test("an enrolment stores a digest and never the template", () => {
  const mrn = consenting();
  const capture = B.simulateCapture(mrn, "right_thumb");
  B.enrol({ patientMrn: mrn, finger: "right_thumb", capture, readerCode: "FP1", deviceCode: DEV, ...BY });

  const [enrolment] = B.enrolmentsFor(mrn);
  assert.match(enrolment.template_ref, /^[0-9a-f]{64}$/);
  assert.notEqual(enrolment.template_ref, capture.template);
  assert.ok(!enrolment.template_ref.includes(mrn));
});

test("the template reference never reaches the audit log", () => {
  // The log is the artefact most likely to be exported and emailed.
  const mrn = consenting();
  const { enrolmentId } = enrolThumb(mrn);
  const ref = B.enrolmentsFor(mrn)[0].template_ref;

  const entries = all<{ detail: string }>(`SELECT detail FROM audit_log WHERE entity_id = ?`, mrn);
  assert.ok(entries.length > 0);
  assert.ok(entries.every((e) => !(e.detail ?? "").includes(ref)));
  assert.ok(enrolmentId);
});

test("a re-capture supersedes rather than duplicating", () => {
  const mrn = consenting();
  enrolThumb(mrn);
  enrolThumb(mrn);

  assert.equal(B.enrolmentsFor(mrn).length, 1, "one active template per finger");
  assert.equal(B.enrolmentsFor(mrn, true).length, 2, "the old one is still on the record");
});

test("a poor capture is enrolled and says so, because a bad template beats none", () => {
  const mrn = consenting();
  const out = B.enrol({
    patientMrn: mrn, finger: "left_index",
    capture: { template: "weak-capture", quality: 12 },
    readerCode: "FP1", deviceCode: DEV, ...BY,
  });
  assert.equal(out.poorQuality, true);
  assert.equal(B.enrolmentsFor(mrn).length, 1);
});

test("enrolling clears an exception, because both cannot be true", () => {
  const mrn = consenting();
  B.recordException({ patientMrn: mrn, reason: "no_reader", ...BY });
  enrolThumb(mrn);
  assert.equal(B.activeException(mrn), undefined);
});

test("withdrawing an enrolment erases the reference, not just a flag", () => {
  // A withdrawal that leaves the template in place is not a withdrawal.
  const mrn = consenting();
  const { enrolmentId } = enrolThumb(mrn);
  B.withdrawEnrolment({ enrolmentId, reason: "Patient withdrew consent", ...BY });

  const [enrolment] = B.enrolmentsFor(mrn, true);
  assert.equal(enrolment.status, "withdrawn");
  assert.equal(enrolment.template_ref, "");
  assert.equal(B.enrolmentsFor(mrn).length, 0);
});

// -------------------------------------------------------------- eligibility

test("an infant is not held over a scanner", () => {
  const mrn = consenting(new Date(Date.now() - 2 * 365 * 86_400_000).toISOString().slice(0, 10));
  const eligible = B.eligibility(mrn);
  assert.equal(eligible.attempt, false);
  assert.match(eligible.reasons[0], /ridge detail is too fine/);
});

test("eligibility is advisory — it stops nothing", () => {
  const mrn = consenting(new Date(Date.now() - 2 * 365 * 86_400_000).toISOString().slice(0, 10));
  assert.equal(B.eligibility(mrn).attempt, false);
  // And the enrolment still goes through, because a clerk holding a reader may
  // know something this rule does not.
  assert.ok(enrolThumb(mrn).enrolmentId);
});

test("'other' must say what it is", () => {
  const mrn = aPatient();
  assert.throws(() => B.recordException({ patientMrn: mrn, reason: "other", ...BY }), /says nothing/);
});

// ------------------------------------------------------------ verification

test("a match is recorded, and on a demo reader it says so", () => {
  const mrn = consenting();
  enrolThumb(mrn);

  const result = B.verify({
    patientMrn: mrn, capture: B.simulateCapture(mrn, "right_thumb"),
    readerCode: "FP1", purpose: "claim", ...BY,
  });

  assert.equal(result.matched, true);
  assert.equal(result.demo, true);
  assert.match(result.next, /demo mode/);
  assert.equal(B.citableFor(result.verificationId).citable, false);
});

test("a non-match returns a result and a route, and never throws", () => {
  // A worn thumb, a wet finger, a bad enrolment and a cheap reader all produce
  // the same non-match, and none of them is a reason to send a sick person home.
  const mrn = consenting();
  enrolThumb(mrn);

  const result = B.verify({
    patientMrn: mrn, capture: B.simulateCapture(mrn, "right_thumb", false),
    readerCode: "FP1", purpose: "service", ...BY,
  });

  assert.equal(result.matched, false);
  assert.match(result.next, /verify from documents/);
  assert.equal(B.citableFor(result.verificationId).citable, false);
});

test("verifying a patient with nothing enrolled says exactly that", () => {
  const mrn = aPatient();
  const result = B.verify({
    patientMrn: mrn, capture: { template: "anything" }, readerCode: "FP1", purpose: "service", ...BY,
  });
  assert.equal(result.matched, false);
  assert.match(result.next, /nothing is enrolled/);
});

test("the failed attempt stays on the record when identity is settled from documents", () => {
  // Attached to the failure rather than replacing it — which is how a bad
  // enrolment is ever discovered.
  const mrn = consenting();
  enrolThumb(mrn);
  const result = B.verify({
    patientMrn: mrn, capture: B.simulateCapture(mrn, "right_thumb", false),
    readerCode: "FP1", purpose: "claim", ...BY,
  });
  B.recordFallback({ verificationId: result.verificationId, fallback: "National ID 29104477 seen", ...BY });

  const [row] = B.verificationsFor(mrn);
  assert.equal(row.matched, 0);
  assert.match(row.fallback, /29104477/);
});

test("a demonstration is never evidence, however well it matched", () => {
  const mrn = consenting();
  enrolThumb(mrn);
  const result = B.verify({
    patientMrn: mrn, capture: B.simulateCapture(mrn, "right_thumb"),
    readerCode: "FP1", purpose: "claim", ...BY,
  });
  const citable = B.citableFor(result.verificationId);
  assert.equal(citable.citable, false);
  assert.match(citable.why, /demonstration is not evidence/);
});

// ------------------------------------------------------------------ readers

test("a reader cannot go live without saying what its templates are", () => {
  assert.throws(
    () => B.goLive({ code: "FP1", templateFormat: "", algorithm: "", ...BOSS }),
    /template format and matching algorithm/,
  );
});

test("a live reader produces evidence; the same match on a demo reader does not", () => {
  B.registerReader({
    facilityId, code: "FP2", label: "Claims desk reader",
    templateFormat: "ISO/IEC 19794-2", algorithm: "vendor-x-1.4", mode: "demo", ...BOSS,
  });
  B.goLive({ code: "FP2", templateFormat: "ISO/IEC 19794-2", algorithm: "vendor-x-1.4", ...BOSS });
  assert.equal(B.getReader("FP2")!.mode, "live");

  const mrn = consenting();
  B.enrol({
    patientMrn: mrn, finger: "right_thumb", capture: B.simulateCapture(mrn, "right_thumb"),
    readerCode: "FP2", deviceCode: DEV, ...BY,
  });
  const result = B.verify({
    patientMrn: mrn, capture: B.simulateCapture(mrn, "right_thumb"),
    readerCode: "FP2", purpose: "claim", ...BY,
  });

  assert.equal(result.matched, true);
  assert.equal(result.demo, false);
  assert.equal(B.citableFor(result.verificationId).citable, true);
});

test("a threshold is a whole number from 0 to 100", () => {
  assert.throws(
    () => B.registerReader({ facilityId, code: "FP9", label: "Bad", threshold: 140, ...BOSS }),
    /0 to 100/,
  );
});

// ----------------------------------------------------------------- reports

test("the summary counts what a facility has to act on", () => {
  const summary = B.biometricSummary(facilityId);
  assert.ok(summary.readers >= 2);
  assert.equal(summary.liveReaders, 1);
  assert.ok(summary.enrolled > 0);
  assert.ok(summary.refusals >= 1);
  assert.ok(summary.poorQualityEnrolments >= 1);
  assert.ok(summary.demoAttempts >= 1);
  assert.ok(summary.matchRatePercent !== null);
});

test("somebody failing twice is a bad enrolment, not a bad person", () => {
  const mrn = consenting();
  enrolThumb(mrn);
  for (let i = 0; i < 2; i++) {
    B.verify({
      patientMrn: mrn, capture: B.simulateCapture(mrn, "right_thumb", false),
      readerCode: "FP1", purpose: "service", ...BY,
    });
  }
  const summary = B.biometricSummary(facilityId);
  assert.ok(summary.repeatFailures.some((r) => r.patientMrn === mrn && r.failures >= 2));
});

test("the audit chain still verifies after all of that", () => {
  assert.equal(verifyAuditChain().ok, true);
});
