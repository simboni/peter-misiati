/**
 * M74 Telemedicine.
 *
 * A remote consultation is a consultation, so most of the rules are the
 * encounter's own. What is tested here is the part that is different: identity,
 * consent, the things that cannot be assessed down a telephone, and a call that
 * broke being recorded as a call that broke.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-tele-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const V = await import("../src/lib/telemedicine.ts");
const E = await import("../src/lib/encounters.ts");
const P = await import("../src/lib/patients.ts");
const R = await import("../src/lib/prescribing.ts");
const N = await import("../src/lib/notifications.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "TEL1", label: "Consulting room", byUserId: adminId, byUserName: "admin" });

const DEV = "TEL1";
const DOC = { clinicianId: clinicianId!, clinicianName: "Dr. Achieng Wanjiru" };
const BY = { byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru" };

let nid = 60_500_000;
function consultation() {
  nid++;
  const mrn = P.registerPatient({
    facilityId, deviceCode: DEV, givenName: "Tele", familyName: `Case${nid}`,
    sex: "female", dateOfBirth: "1992-02-02", nationalId: String(nid),
    byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
  const enc = E.openEncounter({
    facilityId, patientMrn: mrn, kind: "outpatient", deviceCode: DEV, ...DOC,
  });
  return { mrn, enc };
}

function start(enc: string, extra: Partial<Parameters<typeof V.startSession>[0]> = {}) {
  return V.startSession({
    encounterId: enc,
    channel: "video",
    identityMethod: "portal_code",
    consentBy: "patient",
    platform: "A third-party video service",
    deviceCode: DEV,
    ...DOC,
    ...extra,
  });
}

// --------------------------------------------------------------- the basics

test("a remote session hangs off an ordinary encounter", () => {
  // A parallel record is how one patient ends up with two histories.
  const { enc } = consultation();
  const { sessionId } = start(enc);

  const session = V.getSession(sessionId)!;
  assert.equal(session.encounter_id, enc);
  assert.equal(V.sessionForEncounter(enc)!.id, sessionId);
  assert.equal(session.clinician_licence, "KMPDC-DEMO-4471", "the registration is pinned, as on any encounter");
});

test("one remote session per consultation", () => {
  const { enc } = consultation();
  start(enc);
  assert.throws(() => start(enc), /already has a remote session/);
});

test("a closed consultation takes no remote session", () => {
  const { enc } = consultation();
  E.addDiagnosis({ encounterId: enc, code: "1F40", byUserId: clinicianId!, byUserName: DOC.clinicianName, deviceCode: DEV });
  E.writeNote({
    encounterId: enc, complaint: "Fever", assessment: "Malaria", plan: "AL",
    authorId: clinicianId!, authorName: DOC.clinicianName, deviceCode: DEV,
  });
  E.closeEncounter({ encounterId: enc, byUserId: clinicianId!, byUserName: DOC.clinicianName, deviceCode: DEV });

  assert.throws(() => start(enc), /already closed/);
});

// ------------------------------------------------------- consent & identity

test("consent to a consultation is not consent to a remote one", () => {
  const { enc } = consultation();
  assert.throws(() => start(enc, { consentBy: "  " }), /consent to a remote one/);
});

test("how identity was established is written down, and a fingerprint is not on the list", () => {
  // The patient is not in the building.
  assert.ok(!V.IDENTITY_METHODS.includes("biometric" as never));
  const { enc } = consultation();
  const { sessionId } = start(enc, { identityMethod: "document_on_camera" });
  assert.equal(V.getSession(sessionId)!.identity_method, "document_on_camera");
});

test("identity that could not be established is allowed, and never silent", () => {
  const { enc } = consultation();
  assert.throws(
    () => start(enc, { identityMethod: "not_established" }),
    /say what was tried/,
  );

  const { sessionId } = start(enc, {
    identityMethod: "not_established",
    identityNote: "No code received; caller could not produce a document on a voice call",
  });
  assert.equal(V.getSession(sessionId)!.identity_method, "not_established");
  assert.equal(V.teleSummary(facilityId).identityNotEstablished, 1);
});

// ------------------------------------------------------------- red flags

test("chest pain down a telephone is flagged", () => {
  const { enc } = consultation();
  const { redFlags } = start(enc, { reason: "Crushing chest pain since this morning" });
  assert.equal(redFlags.length, 1);
  assert.match(redFlags[0], /chest pain cannot be assessed remotely/);
  assert.ok(N.inbox(facilityId).some((n) => n.kind === "tele_red_flag"));
});

test("a flagged session cannot be closed quietly", () => {
  // It does not refuse the consultation — a patient two hours from the clinic
  // being talked to is better than one who is not. It refuses the silence.
  const { enc } = consultation();
  const { sessionId } = start(enc, { reason: "Bleeding, and she is pregnant" });

  assert.throws(
    () => V.endSession({ sessionId, outcome: "completed", quality: "good", ...BY }),
    /Say what was done about it/,
  );

  V.endSession({
    sessionId, outcome: "converted_to_visit", quality: "good",
    note: "Told to come in now",
    redFlagAction: "Ambulance arranged; she is on her way to the clinic",
    ...BY,
  });
  assert.equal(V.getSession(sessionId)!.outcome, "converted_to_visit");
  assert.ok(N.inbox(facilityId).some((n) => n.kind === "tele_needs_visit"));
});

test("the red flag list catches the things it names", () => {
  const cases: [string, RegExp][] = [
    ["Worst headache of her life, sudden onset", /sudden severe headache/],
    ["Newborn with fever since last night", /febrile baby under two months/],
    ["He was fitting for two minutes", /convulsions/],
    ["Says she wants to harm herself", /self-harm/],
    ["Snakebite on the ankle", /poisoning/],
  ];
  for (const [reason, expected] of cases) {
    const flags = V.redFlags(reason);
    assert.equal(flags.length > 0, true, `nothing flagged on "${reason}"`);
    assert.ok(flags.some((f) => expected.test(f)), `"${reason}" gave ${flags.join(", ")}`);
  }
});

test("an ordinary complaint is not flagged", () => {
  assert.deepEqual(V.redFlags("Review of blood pressure, feels well"), []);
});

// ------------------------------------------------------------------ ending

test("a call that failed did not complete", () => {
  // The contradiction that matters: it is how a consultation with gaps in it
  // gets recorded as a consultation.
  const { enc } = consultation();
  const { sessionId } = start(enc);
  assert.throws(
    () => V.endSession({ sessionId, outcome: "completed", quality: "failed", ...BY }),
    /did not complete/,
  );

  V.endSession({
    sessionId, outcome: "failed_connection", quality: "failed",
    note: "Line dropped four times; asked her to come in tomorrow", ...BY,
  });
  assert.equal(V.getSession(sessionId)!.outcome, "failed_connection");
});

test("a session that did not complete records what happened", () => {
  const { enc } = consultation();
  const { sessionId } = start(enc);
  assert.throws(
    () => V.endSession({ sessionId, outcome: "patient_absent", quality: "good", ...BY }),
    /records what happened/,
  );
});

test("a session ends once", () => {
  const { enc } = consultation();
  const { sessionId } = start(enc);
  V.endSession({ sessionId, outcome: "completed", quality: "good", ...BY });
  assert.throws(
    () => V.endSession({ sessionId, outcome: "completed", quality: "good", ...BY }),
    /already ended/,
  );
});

// ------------------------------------------------------------- prescribing

test("a controlled drug is not prescribed down a telephone", () => {
  const { enc } = consultation();
  start(enc);

  assert.throws(
    () => R.prescribe({
      encounterId: enc, productCode: "MORPH-10", dose: "10 mg", frequency: "PRN",
      quantity: 10, prescriberId: clinicianId!, prescriberName: DOC.clinicianName, deviceCode: DEV,
    }),
    /not prescribed on a remote consultation/,
  );
});

test("an ordinary medicine is prescribed exactly as in a room", () => {
  const { enc } = consultation();
  start(enc);
  const id = R.prescribe({
    encounterId: enc, productCode: "PARA-500", dose: "1 g", frequency: "TDS",
    quantity: 18, durationDays: 3,
    prescriberId: clinicianId!, prescriberName: DOC.clinicianName, deviceCode: DEV,
  });
  assert.ok(id);
});

test("the rule applies to remote consultations only", () => {
  // Somebody in the room may still be prescribed a controlled drug.
  const { enc } = consultation();
  const id = R.prescribe({
    encounterId: enc, productCode: "MORPH-10", dose: "10 mg", frequency: "PRN",
    quantity: 10, prescriberId: clinicianId!, prescriberName: DOC.clinicianName, deviceCode: DEV,
  });
  assert.ok(id);
  assert.equal(V.prescribingCheck(enc, true).allowed, true);
});

// ----------------------------------------------------------------- reports

test("a session nobody ended is a consultation nobody closed", () => {
  const running = V.runningSessions(facilityId);
  assert.ok(running.length > 0);
  assert.ok(running.every((s) => s.ended_at === null));
  assert.equal(V.teleSummary(facilityId).running, running.length);
});

test("the summary counts what a facility has to look at", () => {
  const summary = V.teleSummary(facilityId);
  assert.ok(summary.sessions > 0);
  assert.ok(summary.completed >= 1);
  assert.equal(summary.failedConnection, 1);
  assert.equal(summary.convertedToVisit, 1);
  assert.ok(summary.redFlagged >= 2);
  assert.ok(summary.completionRatePercent !== null);
  assert.ok(summary.poorLines >= 1);
});

test("the audit chain still verifies after all of that", () => {
  assert.equal(verifyAuditChain().ok, true);
});
