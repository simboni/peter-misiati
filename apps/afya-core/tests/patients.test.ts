/**
 * M10 Patient Registry & Master Patient Index.
 *
 * The tests that matter most are the ones about *not* merging: a system that
 * merges two people into one record does far more damage than one that leaves a
 * duplicate, because the duplicate is visible and the bad merge is not.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-patients-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const { seedDemo } = await import("../src/lib/seed.ts");
const P = await import("../src/lib/patients.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get, all } = await import("../src/lib/db.ts");

const { facilityId, adminId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "TAB1", label: "Reception", byUserId: adminId, byUserName: "admin" });

const BY = { byUserId: receptionistId, byUserName: "Joseph Otieno" };
const DEV = "TAB1";

// ------------------------------------------------------------ normalisation

test("Kenyan phone numbers normalise to one form, however they are typed", () => {
  for (const raw of ["0712345678", "+254712345678", "254712345678", "712345678", "0712 345 678", "0712-345-678"]) {
    assert.equal(P.normalisePhone(raw), "254712345678", `"${raw}" must normalise`);
  }
  assert.equal(P.normalisePhone("0112345678"), "254112345678", "the newer 01 prefix is a mobile too");
});

test("a number that is not a plausible mobile is stored as nothing, not as a bad key", () => {
  for (const raw of ["", "0712", "abc", "020 1234567", "07123456789"]) {
    assert.equal(P.normalisePhone(raw), null, `"${raw}" must not become a match key`);
  }
});

test("strong identifiers compare without punctuation or case", () => {
  assert.equal(P.normaliseId("  12345678 "), "12345678");
  assert.equal(P.normaliseId("sha-0099/21"), "SHA009921");
  assert.equal(P.normaliseId(""), null);
});

// -------------------------------------------------------------- registration

const ALICE = P.registerPatient({
  facilityId,
  deviceCode: DEV,
  givenName: "Alice",
  familyName: "Wanjiku",
  sex: "female",
  dateOfBirth: "1991-04-17",
  nationalId: "29384756",
  phone: "0712345678",
  county: "Nairobi",
  village: "Kawangware",
  ...BY,
});

test("a registered patient gets a device-prefixed record number", () => {
  assert.match(ALICE, /^TAB1-/, "two offline tablets must not issue the same file number");
  const patient = P.openPatient({ mrn: ALICE, ...BY })!;
  assert.equal(patient.family_name, "Wanjiku");
  assert.equal(patient.phone, "254712345678", "the phone is stored normalised");
  assert.equal(patient.national_id, "29384756");
});

test("a name is required in both halves", () => {
  assert.throws(
    () => P.registerPatient({ facilityId, deviceCode: DEV, givenName: "Solo", familyName: "  ", sex: "male", ...BY }),
    /family name/,
  );
});

test("registering a second record on the same national ID is refused outright", () => {
  assert.throws(
    () =>
      P.registerPatient({
        facilityId,
        deviceCode: DEV,
        givenName: "Alice",
        familyName: "Wanjiku",
        sex: "female",
        nationalId: "29384756",
        ...BY,
      }),
    /already registered/,
    "this is the cheapest place to stop a duplicate",
  );
});

test("intersex is a recordable sex, because Kenyan identity documents recognise it", () => {
  const mrn = P.registerPatient({
    facilityId,
    deviceCode: DEV,
    givenName: "Test",
    familyName: "Intersex",
    sex: "intersex",
    ...BY,
  });
  assert.equal(P.openPatient({ mrn, ...BY })!.sex, "intersex");
});

// ------------------------------------------------------------------ matching

test("a strong identifier is a definite match and stops the search", () => {
  const found = P.findCandidates({ facilityId, nationalId: "29-384-756" });
  assert.equal(found.length, 1);
  assert.equal(found[0].definite, true);
  assert.equal(found[0].score, 100);
  assert.equal(found[0].patient.mrn, ALICE);
});

test("a shared phone and name scores as a likely duplicate", () => {
  const found = P.findCandidates({
    facilityId,
    givenName: "Alice",
    familyName: "Wanjiku",
    phone: "+254712345678",
    sex: "female",
  });
  assert.ok(found.length >= 1);
  assert.equal(found[0].patient.mrn, ALICE);
  assert.ok(found[0].score >= P.LIKELY_MATCH, "it should lead with 'is this the same person?'");
  assert.ok(found[0].reasons.includes("same phone number"), "and say why — the person decides, not the score");
  assert.equal(found[0].definite, false, "a score is never a definite match");
});

test("a shared family name alone is not a candidate", () => {
  P.registerPatient({
    facilityId,
    deviceCode: DEV,
    givenName: "Peter",
    familyName: "Wanjiku",
    sex: "male",
    dateOfBirth: "1975-02-02",
    ...BY,
  });

  const found = P.findCandidates({ facilityId, familyName: "Wanjiku", sex: "female" });
  assert.ok(
    !found.some((c) => c.patient.given_name === "Peter"),
    "in a clinic where half the register shares a surname, name-only hits train staff to ignore the list",
  );
});

test("an estimated year of birth scores lower than a documented date", () => {
  const documented = P.registerPatient({
    facilityId,
    deviceCode: DEV,
    givenName: "Baby",
    familyName: "Kamau",
    sex: "male",
    dateOfBirth: "2019-06-01",
    phone: "0733111222",
    ...BY,
  });
  const estimated = P.registerPatient({
    facilityId,
    deviceCode: DEV,
    givenName: "Baby",
    familyName: "Omondi",
    sex: "male",
    dateOfBirth: "2019-06-01",
    dobEstimated: true,
    phone: "0733111222",
    ...BY,
  });

  const docScore = P.findCandidates({ facilityId, familyName: "Kamau", givenName: "Baby", dateOfBirth: "2019-06-01", phone: "0733111222" })
    .find((c) => c.patient.mrn === documented)!.score;
  const estScore = P.findCandidates({ facilityId, familyName: "Omondi", givenName: "Baby", dateOfBirth: "2019-06-01", phone: "0733111222" })
    .find((c) => c.patient.mrn === estimated)!.score;

  assert.ok(
    docScore > estScore,
    "an estimated date of birth is a guessed year; scoring it like a documented one collapses every child born that year together",
  );
});

test("searching on nothing returns nothing rather than the whole register", () => {
  assert.deepEqual(P.findCandidates({ facilityId }), []);
});

// ------------------------------------------------------------------- reading

test("opening a record is audited, with who and why", () => {
  P.openPatient({ mrn: ALICE, byUserId: receptionistId, byUserName: "Joseph Otieno", purpose: "billing" });
  const row = get<{ action: string; patient_id: string; purpose: string; actor_name: string }>(
    `SELECT action, patient_id, purpose, actor_name FROM audit_log WHERE action = 'patient_read' ORDER BY id DESC LIMIT 1`,
  )!;
  assert.equal(row.patient_id, ALICE);
  assert.equal(row.purpose, "billing", "opening a record is a disclosure, and why matters");
  assert.equal(row.actor_name, "Joseph Otieno");
});

test("the access history answers a subject-access request", () => {
  const history = P.accessHistory(ALICE);
  assert.ok(history.length >= 2, "a patient can be told who looked at their record");
  assert.ok(history.every((h) => h.actor_name && h.purpose));
});

// ------------------------------------------------------------------ updating

test("a correction records both the old and new value", () => {
  P.updatePatient({
    mrn: ALICE,
    changes: { phone: "0799888777", village: "Kileleshwa" },
    deviceCode: DEV,
    ...BY,
  });

  const patient = P.openPatient({ mrn: ALICE, ...BY })!;
  assert.equal(patient.phone, "254799888777");
  assert.equal(patient.village, "Kileleshwa");

  const row = get<{ detail: string }>(
    `SELECT detail FROM audit_log WHERE action = 'patient_amended' ORDER BY id DESC LIMIT 1`,
  )!;
  assert.match(row.detail, /254712345678/, "the previous value is kept, or the change cannot be challenged");
  assert.match(row.detail, /254799888777/);
});

test("a correction queues a sync operation carrying only the changed fields", () => {
  const op = all<{ payload: string; data_class: string }>(
    `SELECT payload, data_class FROM sync_ops WHERE entity = 'patient' AND entity_id = ? ORDER BY id DESC LIMIT 1`,
    ALICE,
  )[0];
  const payload = JSON.parse(op.payload);
  assert.equal(op.data_class, "demographic");
  assert.deepEqual(Object.keys(payload).sort(), ["phone", "village"], "never a whole row — a stale device would revert the rest");
});

test("a field nobody should edit here is refused", () => {
  assert.throws(
    () => P.updatePatient({ mrn: ALICE, changes: { mrn: "HACK" } as never, deviceCode: DEV, ...BY }),
    /not a field/,
  );
});

// ------------------------------------------------------------------- merging

test("two records with different national IDs are refused a merge", () => {
  const other = P.registerPatient({
    facilityId,
    deviceCode: DEV,
    givenName: "Alice",
    familyName: "Wanjiku",
    sex: "female",
    nationalId: "11112222",
    ...BY,
  });

  assert.throws(
    () => P.mergePatients({ keepMrn: ALICE, mergeMrn: other, reason: "look like the same person", deviceCode: DEV, ...BY }),
    /probably two different people/,
    "one record for two patients is the worst outcome this module can produce",
  );
});

test("a merge must record why", () => {
  const dup = P.registerPatient({
    facilityId, deviceCode: DEV, givenName: "Alice", familyName: "Wanjiku", sex: "female", phone: "0712345678", ...BY,
  });
  assert.throws(
    () => P.mergePatients({ keepMrn: ALICE, mergeMrn: dup, reason: "   ", deviceCode: DEV, ...BY }),
    /record why/,
  );
});

test("a merge fills the gaps on the surviving record and keeps the old number resolving", () => {
  const dup = P.registerPatient({
    facilityId,
    deviceCode: DEV,
    givenName: "Alice",
    familyName: "Wanjiku",
    sex: "female",
    // The duplicate holds the SHA number the original was missing — usually the
    // reason the merge is worth doing at all.
    shaNumber: "SHA-4471-2026",
    altPhone: "0722333444",
    ...BY,
  });

  P.mergePatients({ keepMrn: ALICE, mergeMrn: dup, reason: "same person, registered twice at reception", deviceCode: DEV, ...BY });

  const kept = P.openPatient({ mrn: ALICE, ...BY })!;
  assert.equal(kept.sha_number, "SHA44712026", "the gap is filled from the duplicate");
  assert.equal(kept.alt_phone, "254722333444");

  const viaOldNumber = P.openPatient({ mrn: dup, ...BY })!;
  assert.equal(
    viaOldNumber.mrn,
    ALICE,
    "a file number already on a claim, a receipt or a patient's slip must keep working",
  );
});

test("a merged record is never deleted", () => {
  const rows = all<{ mrn: string; merged_into: string | null }>(
    `SELECT mrn, merged_into FROM patients WHERE merged_into IS NOT NULL`,
  );
  assert.ok(rows.length >= 1, "the losing row stays, marked");
});

test("a merge can be undone, restoring the record as it was", () => {
  const history = P.mergeHistory(ALICE);
  const merge = history.find((m) => !m.undone_at)!;
  assert.ok(merge, "the merge is on record");

  P.unmergePatients({ mergeId: merge.id, byUserId: adminId, byUserName: "admin" });

  const kept = P.openPatient({ mrn: ALICE, ...BY })!;
  assert.equal(kept.sha_number, null, "fields the merge filled in are put back");

  const restored = get<{ merged_into: string | null }>(
    `SELECT merged_into FROM patients WHERE mrn = ?`,
    merge.merged_mrn,
  )!;
  assert.equal(restored.merged_into, null, "the record stands on its own again");

  assert.throws(
    () => P.unmergePatients({ mergeId: merge.id, byUserId: adminId, byUserName: "admin" }),
    /already been undone/,
  );
});

test("a record cannot be merged into itself", () => {
  assert.throws(
    () => P.mergePatients({ keepMrn: ALICE, mergeMrn: ALICE, reason: "typo", deviceCode: DEV, ...BY }),
    /into itself/,
  );
});

test("the audit chain survives registration, correction, merge and unmerge", () => {
  const result = verifyAuditChain();
  assert.equal(result.ok, true);
  assert.ok(result.ok && result.checked > 20);
});

// -------------------------------------------------------------- front-desk search

test("a receptionist can find a patient by name — the duplicate rules do not apply here", () => {
  // findCandidates deliberately refuses a name-only match, which is right for
  // duplicate detection and useless for looking somebody up.
  assert.equal(
    P.findCandidates({ facilityId, givenName: "Alice", familyName: "Wanjiku" }).length,
    0,
    "duplicate detection still refuses a name-only match",
  );

  const found = P.searchPatients({ facilityId, query: "Alice Wanjiku" });
  assert.ok(found.length >= 1, "but search finds her, because that is what search is for");
  assert.equal(found[0].given_name, "Alice");
});

test("search matches a partial name, so half-typed works", () => {
  const found = P.searchPatients({ facilityId, query: "ali wan" });
  assert.ok(found.some((p) => p.given_name === "Alice"), "'ali wan' finds Alice Wanjiku");
});

test("search finds by phone in any format, and by identifier", () => {
  const byPhone = P.searchPatients({ facilityId, query: "+254 799 888 777" });
  assert.ok(byPhone.length >= 1, "however the number is typed");

  const byId = P.searchPatients({ facilityId, query: "29384756" });
  assert.ok(byId.some((p) => p.national_id === "29384756"));
});

test("search ignores merged-away records, so an old file number does not confuse reception", () => {
  const all = P.searchPatients({ facilityId, query: "Wanjiku" });
  assert.ok(all.every((p) => p.merged_into === null));
});

test("a one- or two-character query returns nothing rather than the whole register", () => {
  assert.deepEqual(P.searchPatients({ facilityId, query: "A" }), []);
});
