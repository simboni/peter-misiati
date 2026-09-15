/**
 * M23 Prescribing.
 *
 * The tests that matter are about *grading* warnings. A system that blocks on
 * everything teaches clinicians to override reflexively, and then the warning
 * that would have mattered is overridden too. So: severe allergy blocks, mild
 * allergy informs, and nothing else interrupts.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-rx-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const { seedDemo } = await import("../src/lib/seed.ts");
const Rx = await import("../src/lib/prescribing.ts");
const E = await import("../src/lib/encounters.ts");
const P = await import("../src/lib/patients.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get, all } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "CONS", label: "Consulting room", byUserId: adminId, byUserName: "admin" });

const DEV = "CONS";
const DOC = { prescriberId: clinicianId, prescriberName: "Dr. Achieng Wanjiru" };

const MRN = P.registerPatient({
  facilityId,
  deviceCode: DEV,
  givenName: "Esther",
  familyName: "Nyambura",
  sex: "female",
  dateOfBirth: "1990-02-14",
  nationalId: "27718899",
  byUserId: receptionistId,
  byUserName: "Joseph Otieno",
});

const ENC = E.openEncounter({
  facilityId,
  patientMrn: MRN,
  kind: "outpatient",
  clinicianId,
  clinicianName: DOC.prescriberName,
  deviceCode: DEV,
});

// ------------------------------------------------------------------ catalogue

test("the starter formulary loads and is searchable by brand or generic", () => {
  assert.ok(Rx.findProducts("paracetamol").some((p) => p.code === "PARA-500"), "by generic");
  assert.ok(Rx.findProducts("Artemether").some((p) => p.code === "AL-20-120"), "by name");
  assert.equal(Rx.getProduct("amox-500")!.generic_name, "amoxicillin", "lookup is case-insensitive");
});

test("a product import must record its source and a generic name", () => {
  assert.throws(
    () => Rx.importProducts({ source: "  ", products: [{ code: "X", name: "X", genericName: "x" }] }),
    /source/,
  );
  assert.throws(
    () => Rx.importProducts({ source: "test", products: [{ code: "X", name: "X", genericName: "  " }] }),
    /generic name/,
    "an allergy check matches on the generic, so a product without one is unsafe",
  );
});

// --------------------------------------------------------------- prescribing

test("a licensed clinician can prescribe, and the licence is pinned", () => {
  const id = Rx.prescribe({
    encounterId: ENC,
    productCode: "AL-20-120",
    dose: "4 tablets",
    frequency: "twice daily",
    durationDays: 3,
    quantity: 24,
    instructions: "with food",
    deviceCode: DEV,
    ...DOC,
  });

  const rx = get<{ prescriber_licence: string; product_name: string; generic_name: string; status: string }>(
    `SELECT prescriber_licence, product_name, generic_name, status FROM prescriptions WHERE id = ?`,
    id,
  )!;
  assert.equal(rx.prescriber_licence, "KMPDC-DEMO-4471", "the claim cites the registration as it stood on the day");
  assert.match(rx.product_name, /Artemether/, "the product name is pinned as it read when prescribed");
  assert.equal(rx.generic_name, "artemether lumefantrine");
  assert.equal(rx.status, "active");
});

test("someone without the permission cannot prescribe", () => {
  assert.throws(
    () =>
      Rx.prescribe({
        encounterId: ENC,
        productCode: "PARA-500",
        dose: "1 g",
        frequency: "three times daily",
        quantity: 21,
        deviceCode: DEV,
        prescriberId: receptionistId,
        prescriberName: "Joseph Otieno",
      }),
    /role does not include this/,
  );
});

test("a prescription needs a dose, a frequency and a sane quantity", () => {
  const base = { encounterId: ENC, productCode: "PARA-500", deviceCode: DEV, ...DOC };
  assert.throws(() => Rx.prescribe({ ...base, dose: " ", frequency: "bd", quantity: 10 }), /dose/);
  assert.throws(() => Rx.prescribe({ ...base, dose: "1 g", frequency: " ", quantity: 10 }), /frequency/);
  assert.throws(() => Rx.prescribe({ ...base, dose: "1 g", frequency: "bd", quantity: 0 }), /greater than zero/);
  assert.throws(() => Rx.prescribe({ ...base, dose: "1 g", frequency: "bd", quantity: 2.5 }), /whole number/);
});

test("a product that is not in the catalogue cannot be prescribed", () => {
  assert.throws(
    () => Rx.prescribe({ encounterId: ENC, productCode: "NOT-A-DRUG", dose: "1", frequency: "od", quantity: 1, deviceCode: DEV, ...DOC }),
    /not in the product catalogue/,
  );
});

// ------------------------------------------------------------------ warnings

test("a mild allergy informs but does not block", () => {
  Rx.recordAllergy({
    patientMrn: MRN,
    substance: "ibuprofen",
    reaction: "mild rash",
    severity: "mild",
    byUserId: clinicianId,
    byUserName: DOC.prescriberName,
  });

  const warnings = Rx.checkSafety({ patientMrn: MRN, productCode: "IBU-400" });
  const allergy = warnings.find((w) => w.kind === "allergy")!;
  assert.ok(allergy, "the clinician is told");
  assert.equal(allergy.blocking, false, "but a mild allergy must not interrupt — that is how alert fatigue starts");

  // And it genuinely does not block.
  const id = Rx.prescribe({
    encounterId: ENC,
    productCode: "IBU-400",
    dose: "400 mg",
    frequency: "three times daily",
    quantity: 15,
    deviceCode: DEV,
    ...DOC,
  });
  assert.ok(id);
});

test("a severe allergy blocks, and names the substance and the reaction", () => {
  Rx.recordAllergy({
    patientMrn: MRN,
    substance: "amoxicillin",
    reaction: "angioedema",
    severity: "anaphylaxis",
    byUserId: clinicianId,
    byUserName: DOC.prescriberName,
  });

  const warnings = Rx.checkSafety({ patientMrn: MRN, productCode: "AMOX-500" });
  const allergy = warnings.find((w) => w.kind === "allergy")!;
  assert.equal(allergy.blocking, true);
  assert.match(allergy.message, /anaphylaxis/);
  assert.match(allergy.message, /angioedema/, "the reaction is what tells a clinician how bad it was");

  assert.throws(
    () =>
      Rx.prescribe({
        encounterId: ENC,
        productCode: "AMOX-500",
        dose: "500 mg",
        frequency: "three times daily",
        quantity: 21,
        deviceCode: DEV,
        ...DOC,
      }),
    /record why/,
  );
});

test("the allergy matches across brands, because it is matched on the generic", () => {
  // A different pack of the same generic must still trip the check.
  const warnings = Rx.checkSafety({ patientMrn: MRN, productCode: "AMOX-125S" });
  assert.ok(
    warnings.some((w) => w.kind === "allergy" && w.blocking),
    "a patient allergic to amoxicillin is allergic to it as a suspension too",
  );
});

test("an override is permitted but becomes a permanent part of the record", () => {
  const id = Rx.prescribe({
    encounterId: ENC,
    productCode: "AMOX-500",
    dose: "500 mg",
    frequency: "three times daily",
    quantity: 21,
    overrideReason: "allergy reported by relative, patient denies it; giving under observation",
    deviceCode: DEV,
    ...DOC,
  });

  const rx = get<{ override_reason: string }>(`SELECT override_reason FROM prescriptions WHERE id = ?`, id)!;
  assert.match(rx.override_reason, /under observation/);

  const entry = all<{ detail: string }>(
    `SELECT detail FROM audit_log WHERE action = 'prescription_written' ORDER BY id DESC LIMIT 1`,
  )[0];
  assert.match(
    entry.detail,
    /under observation/,
    "this is the entry a coroner or a claims auditor asks for — not a dismissed dialog",
  );
});

test("an unregistered product is blocked — it cannot be dispensed or claimed", () => {
  Rx.importProducts({
    source: "test",
    products: [{ code: "NOREG-1", name: "Unregistered Syrup", genericName: "mystery", ppbRegistration: null }],
    byUserName: "test",
  });

  const warnings = Rx.checkSafety({ patientMrn: MRN, productCode: "NOREG-1" });
  const w = warnings.find((x) => x.kind === "unregistered")!;
  assert.equal(w.blocking, true);
  assert.match(w.message, /PPB registration/);
});

test("a controlled drug is flagged for the pharmacy, but does not block the prescriber", () => {
  const warnings = Rx.checkSafety({ patientMrn: MRN, productCode: "MORPH-10" });
  const w = warnings.find((x) => x.kind === "controlled")!;
  assert.equal(w.blocking, false, "prescribing morphine is legitimate — it is dispensing that needs the second signature");
  assert.match(w.message, /second signature/);
});

test("a patient with no allergies gets no warnings at all", () => {
  const other = P.registerPatient({
    facilityId, deviceCode: DEV, givenName: "Quiet", familyName: "Case", sex: "male",
    byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
  assert.deepEqual(
    Rx.checkSafety({ patientMrn: other, productCode: "PARA-500" }),
    [],
    "nothing nags when there is nothing to say",
  );
});

// ------------------------------------------------------------------ lifecycle

test("prescriptions are listed against the encounter and the patient", () => {
  assert.ok(Rx.prescriptionsFor(ENC).length >= 3);
  assert.ok(Rx.activePrescriptionsFor(MRN).length >= 3);
});

test("a prescription can be cancelled with a reason", () => {
  const rx = Rx.prescriptionsFor(ENC)[0];
  Rx.cancelPrescription({
    prescriptionId: rx.id,
    reason: "wrong dose, re-prescribed",
    byUserId: clinicianId,
    byUserName: DOC.prescriberName,
  });
  assert.throws(
    () => Rx.cancelPrescription({ prescriptionId: rx.id, reason: "again", byUserId: clinicianId, byUserName: DOC.prescriberName }),
    /already cancelled/,
  );
  assert.throws(
    () => Rx.cancelPrescription({ prescriptionId: rx.id, reason: " ", byUserId: clinicianId, byUserName: DOC.prescriberName }),
    /already cancelled|record why/,
  );
});

test("a closed encounter cannot be prescribed to", () => {
  E.addDiagnosis({ encounterId: ENC, code: "1F40", byUserId: clinicianId, byUserName: DOC.prescriberName, deviceCode: DEV });
  E.writeNote({ encounterId: ENC, assessment: "Malaria", authorId: clinicianId, authorName: DOC.prescriberName, deviceCode: DEV });
  E.closeEncounter({ encounterId: ENC, byUserId: clinicianId, byUserName: DOC.prescriberName, deviceCode: DEV });

  assert.throws(
    () => Rx.prescribe({ encounterId: ENC, productCode: "PARA-500", dose: "1 g", frequency: "tds", quantity: 9, deviceCode: DEV, ...DOC }),
    /closed/,
    "a prescription must be attributable to a consultation",
  );
});

test("every prescription queued a clinical sync operation", () => {
  const ops = all<{ data_class: string }>(`SELECT data_class FROM sync_ops WHERE entity = 'prescription'`);
  assert.ok(ops.length >= 3);
  assert.ok(ops.every((o) => o.data_class === "clinical"));
});

test("the audit chain survives prescribing, overriding and cancelling", () => {
  assert.equal(verifyAuditChain().ok, true);
});

test("an override reason is dropped when nothing was actually overridden", () => {
  // A form that kept the text from a previous blocked attempt, or a retried
  // request, must not put a sentence in the record claiming the prescriber
  // overrode a warning they were never shown.
  const enc2 = E.openEncounter({
    facilityId,
    patientMrn: MRN,
    kind: "followup",
    clinicianId,
    clinicianName: DOC.prescriberName,
    deviceCode: DEV,
  });

  const id = Rx.prescribe({
    encounterId: enc2,
    // Paracetamol: this patient has no allergy to it, so nothing blocks.
    productCode: "PARA-500",
    dose: "1 g",
    frequency: "three times daily",
    quantity: 21,
    overrideReason: "left over from the amoxicillin attempt",
    deviceCode: DEV,
    ...DOC,
  });

  const rx = get<{ override_reason: string | null }>(
    `SELECT override_reason FROM prescriptions WHERE id = ?`,
    id,
  )!;
  assert.equal(rx.override_reason, null, "a stale reason must not become a claim about the prescriber");

  const entry = all<{ detail: string }>(
    `SELECT detail FROM audit_log WHERE action = 'prescription_written' ORDER BY id DESC LIMIT 1`,
  )[0];
  assert.ok(!entry.detail.includes("left over"), "and must not reach the audit log either");
});
