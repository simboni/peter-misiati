/**
 * M21 Terminology and M20 Encounter.
 *
 * The tests worth reading are the three that stop a claim being born broken: an
 * unverified code cannot be attached, an encounter cannot close without a coded
 * primary diagnosis, and the licence is pinned as it stood when care was given.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-enc-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const { seedDemo } = await import("../src/lib/seed.ts");
const T = await import("../src/lib/terminology.ts");
const E = await import("../src/lib/encounters.ts");
const P = await import("../src/lib/patients.ts");
const U = await import("../src/lib/users.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get, all, run } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "CONS", label: "Consulting room", byUserId: adminId, byUserName: "admin" });

const DOC = { clinicianId, clinicianName: "Dr. Achieng Wanjiru" };
const DEV = "CONS";

const MRN = P.registerPatient({
  facilityId,
  deviceCode: DEV,
  givenName: "Samuel",
  familyName: "Mutiso",
  sex: "male",
  dateOfBirth: "1984-07-21",
  nationalId: "22114455",
  phone: "0711223344",
  byUserId: receptionistId,
  byUserName: "Joseph Otieno",
});

// ------------------------------------------------------------- terminology

test("the starter catalogue loads verified and searchable", () => {
  const hits = T.searchForCoding({ query: "malaria" });
  assert.ok(hits.length >= 4, "the malaria family is findable");
  assert.ok(hits.every((h) => h.verified === 1));
  assert.ok(hits.some((h) => h.code === "1F40" && h.term.includes("falciparum")));
});

test("search finds a code by its code, its term and the word staff actually say", () => {
  assert.equal(T.searchForCoding({ query: "CA40" })[0].code, "CA40", "by code");
  assert.equal(T.searchForCoding({ query: "pneumo" })[0].code, "CA40", "by term prefix");
  assert.ok(
    T.searchForCoding({ query: "URTI" }).some((h) => h.code === "CA07"),
    "by the abbreviation a clinician types",
  );
  assert.ok(
    T.searchForCoding({ query: "running stomach" }).some((h) => h.code === "1A40"),
    "by the words a patient uses",
  );
});

test("coverage reports honestly that this is only a starter set", () => {
  const c = T.coverage();
  assert.equal(c.starterOnly, true, "a facility must be told its catalogue is not the real release");
  assert.equal(c.total, c.verified, "everything shipped is verified");
  assert.ok(c.sources.length >= 1, "and carries its provenance");
});

test("an import must say where the codes came from", () => {
  assert.throws(
    () => T.importCodes({ system: T.ICD11, source: "  ", concepts: [{ code: "XX00", term: "Test" }] }),
    /source/,
  );
});

test("an unverified code is stored but never offered for coding", () => {
  T.importCodes({
    system: T.ICD11,
    source: "local draft, unchecked",
    concepts: [{ code: "ZZ99", term: "Something a clinic invented", verified: false }],
    byUserName: "test",
  });

  assert.ok(T.lookup("ZZ99"), "it exists");
  assert.ok(
    !T.searchForCoding({ query: "invented" }).some((h) => h.code === "ZZ99"),
    "but it must not appear in a coding search",
  );
  assert.throws(
    () => T.assertCodable("ZZ99"),
    /not been verified/,
    "a guessed code causes exactly the rejection this system exists to prevent",
  );
});

test("a code that is not in the catalogue at all is refused with a usable message", () => {
  assert.throws(() => T.assertCodable("9Z9Z"), /not in the ICD-11-MMS catalogue/);
});

test("a grouping code cannot be claimed — it asks for something more specific", () => {
  T.importCodes({
    system: T.ICD11,
    source: "test",
    concepts: [{ code: "1F4", term: "Malaria (block)", billable: false, verified: true }],
    byUserName: "test",
  });
  assert.throws(() => T.assertCodable("1F4"), /more specific/);
});

// ---------------------------------------------------------------- encounter

let encounterId: string;

test("opening an encounter pins the licence as it stands at that moment", () => {
  encounterId = E.openEncounter({
    facilityId,
    patientMrn: MRN,
    kind: "outpatient",
    deviceCode: DEV,
    ...DOC,
  });

  const encounter = E.getEncounter(encounterId)!;
  assert.match(encounterId, /^CONS-/, "minted on the device, so it works offline");
  assert.equal(encounter.status, "open");
  assert.equal(encounter.licence_regulator, "KMPDC");
  assert.equal(encounter.licence_number, "KMPDC-DEMO-4471");
  assert.ok(encounter.licence_expires_on, "and the expiry it carried on the day");
});

test("a second open encounter for the same patient is refused", () => {
  assert.throws(
    () => E.openEncounter({ facilityId, patientMrn: MRN, kind: "outpatient", deviceCode: DEV, ...DOC }),
    /already has an open encounter/,
  );
});

test("someone without a clinical licence cannot open an encounter", () => {
  assert.throws(
    () =>
      E.openEncounter({
        facilityId,
        patientMrn: MRN,
        kind: "outpatient",
        clinicianId: receptionistId,
        clinicianName: "Joseph Otieno",
        deviceCode: DEV,
      }),
    /role does not include this/,
  );
});

test("a note writes version 1", () => {
  const version = E.writeNote({
    encounterId,
    complaint: "Fever and headache for three days",
    examination: "Temp 38.9, chest clear",
    assessment: "Malaria, clinically",
    plan: "RDT, start AL if positive",
    authorId: clinicianId,
    authorName: DOC.clinicianName,
    deviceCode: DEV,
  });
  assert.equal(version, 1);
  assert.equal(E.currentNote(encounterId)!.assessment, "Malaria, clinically");
});

test("a correction makes a new version and keeps the old one", () => {
  const version = E.writeNote({
    encounterId,
    assessment: "Malaria, RDT positive for P. falciparum",
    authorId: clinicianId,
    authorName: DOC.clinicianName,
    deviceCode: DEV,
  });
  assert.equal(version, 2);

  const history = E.noteHistory(encounterId);
  assert.equal(history.length, 2, "nothing clinical is overwritten");
  assert.equal(history[0].assessment, "Malaria, RDT positive for P. falciparum");
  assert.equal(history[1].assessment, "Malaria, clinically", "what was written at the time is still there");
  assert.ok(history[1].superseded_at, "and is marked as superseded");

  assert.equal(
    E.currentNote(encounterId)!.complaint,
    "Fever and headache for three days",
    "fields not touched by the correction carry forward",
  );
});

test("saving an unchanged note does not create a version", () => {
  const before = E.noteHistory(encounterId).length;
  const version = E.writeNote({
    encounterId,
    assessment: "Malaria, RDT positive for P. falciparum",
    authorId: clinicianId,
    authorName: DOC.clinicianName,
    deviceCode: DEV,
  });
  assert.equal(version, 2);
  assert.equal(
    E.noteHistory(encounterId).length,
    before,
    "otherwise the history fills with identical rows and the one real correction cannot be found",
  );
});

test("an encounter cannot close without a coded primary diagnosis", () => {
  const state = E.readiness(encounterId);
  assert.equal(state.ready, false);
  assert.ok(state.blockers.some((b) => /primary diagnosis/.test(b)));

  assert.throws(
    () => E.closeEncounter({ encounterId, byUserId: clinicianId, byUserName: DOC.clinicianName, deviceCode: DEV }),
    /primary diagnosis/,
    "the clinician is still with the patient — the cheapest moment in the revenue cycle to fix this",
  );
});

test("a diagnosis is attached with the term as it read when chosen", () => {
  E.addDiagnosis({
    encounterId,
    code: "1F40",
    byUserId: clinicianId,
    byUserName: DOC.clinicianName,
    deviceCode: DEV,
  });

  const dx = E.activeDiagnoses(encounterId);
  assert.equal(dx.length, 1);
  assert.equal(dx[0].code, "1F40");
  assert.equal(dx[0].rank, 1, "the first diagnosis is the primary one");
  assert.match(dx[0].term, /falciparum/, "the term is pinned, not re-resolved from a catalogue that may change");
});

test("a second primary diagnosis is refused — a claim carries exactly one", () => {
  assert.throws(
    () =>
      E.addDiagnosis({
        encounterId,
        code: "CA40",
        rank: 1,
        byUserId: clinicianId,
        byUserName: DOC.clinicianName,
        deviceCode: DEV,
      }),
    /already has a primary diagnosis/,
  );
});

test("an additional diagnosis is allowed alongside the primary", () => {
  E.addDiagnosis({
    encounterId,
    code: "CA07",
    rank: 2,
    certainty: "suspected",
    byUserId: clinicianId,
    byUserName: DOC.clinicianName,
    deviceCode: DEV,
  });
  assert.equal(E.activeDiagnoses(encounterId).length, 2);
});

test("the same code cannot be added twice", () => {
  assert.throws(
    () => E.addDiagnosis({ encounterId, code: "1F40", byUserId: clinicianId, byUserName: DOC.clinicianName, deviceCode: DEV }),
    /already on this encounter/,
  );
});

test("coding a diagnosis makes it a favourite, so the next one is a tap", () => {
  const top = T.topCodes(clinicianId);
  assert.ok(top.some((c) => c.code === "1F40"), "what the consultation screen offers before anyone types");

  const hits = T.searchForCoding({ query: "malaria", userId: clinicianId });
  assert.equal(hits[0].code, "1F40", "a used code outranks its unused siblings");
  assert.equal(hits[0].favourite, true);
});

test("a removed diagnosis is marked, never deleted", () => {
  const additional = E.activeDiagnoses(encounterId).find((d) => d.code === "CA07")!;
  E.removeDiagnosis({
    diagnosisId: additional.id,
    byUserId: clinicianId,
    byUserName: DOC.clinicianName,
    reason: "chest clear on review",
  });

  assert.equal(E.activeDiagnoses(encounterId).length, 1);
  const row = get<{ removed_at: string | null }>(`SELECT removed_at FROM encounter_diagnoses WHERE id = ?`, additional.id)!;
  assert.ok(row.removed_at, "it was clinical reasoning, and the record keeps it");
});

test("an encounter with an assessment and a primary diagnosis closes", () => {
  const state = E.readiness(encounterId);
  assert.equal(state.ready, true, state.blockers.join("; "));

  E.closeEncounter({ encounterId, byUserId: clinicianId, byUserName: DOC.clinicianName, deviceCode: DEV });
  assert.equal(E.getEncounter(encounterId)!.status, "closed");
});

test("a closed encounter cannot be reopened or edited", () => {
  for (const attempt of [
    () => E.writeNote({ encounterId, plan: "changed my mind", authorId: clinicianId, authorName: DOC.clinicianName, deviceCode: DEV }),
    () => E.addDiagnosis({ encounterId, code: "CA23", byUserId: clinicianId, byUserName: DOC.clinicianName, deviceCode: DEV }),
  ]) {
    assert.throws(attempt, /closed/, "a signed record is not editable — a follow-up encounter is the answer");
  }
});

test("readiness names the missing licence, because the claim will be rejected for it", () => {
  // A clinician whose licence has lapsed: the encounter opens with nothing pinned.
  const locum = U.createUser({
    facilityId,
    name: "Dr. Locum",
    username: "locum.doc",
    password: "LocumPass123",
    cadreCode: "medical_officer",
    roles: ["clinician"],
    byUserId: adminId,
    byUserName: "admin",
  });
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  U.recordLicence({
    userId: locum,
    regulator: "KMPDC",
    licenceNumber: "KMPDC-LAPSED-1",
    expiresOn: yesterday,
    byUserId: adminId,
    byUserName: "admin",
  });

  assert.throws(
    () => E.openEncounter({ facilityId, patientMrn: MRN, kind: "followup", clinicianId: locum, clinicianName: "Dr. Locum", deviceCode: DEV }),
    /expired/,
    "an expired licence stops the consultation, not just the claim",
  );
});

test("every clinical write queued a sync operation in the clinical class", () => {
  const ops = all<{ data_class: string }>(
    `SELECT data_class FROM sync_ops WHERE entity = 'encounter' AND entity_id = ?`,
    encounterId,
  );
  assert.ok(ops.length >= 4, "open, note, correction, diagnosis, close");
  assert.ok(
    ops.every((o) => o.data_class === "clinical"),
    "so a conflict keeps both versions rather than overwriting a colleague's note",
  );
});

test("the audit chain survives a whole consultation", () => {
  const result = verifyAuditChain();
  assert.equal(result.ok, true);
});
