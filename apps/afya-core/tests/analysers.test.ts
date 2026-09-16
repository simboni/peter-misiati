/**
 * M31 Analyser Interface.
 *
 * The tests worth having are about a machine not filing a result against the
 * wrong person: an unmatched barcode, a unit nobody wrote a conversion for, and
 * a quality-control sample that must never reach a patient's record.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-analyser-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const A = await import("../src/lib/analysers.ts");
const O = await import("../src/lib/orders.ts");
const L = await import("../src/lib/laboratory.ts");
const P = await import("../src/lib/patients.ts");
const E = await import("../src/lib/encounters.ts");
const N = await import("../src/lib/notifications.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, all } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId, labTechId } = seedDemo();
registerDevice({ facilityId, code: "ANL1", label: "Analyser bench", byUserId: adminId, byUserName: "admin" });

const DEV = "ANL1";
const TECH = { byUserId: labTechId!, byUserName: "Samuel Mutiso" };

A.seedAnalysers(facilityId);

let nid = 80_000_000;
/** An order with its specimen collected, which is what an analyser reports on. */
function collected(service = "LAB-CBC"): { specimenId: string; orderId: string; mrn: string } {
  const mrn = P.registerPatient({
    facilityId, deviceCode: DEV, givenName: "Bench", familyName: `Case${++nid}`,
    sex: "female", dateOfBirth: "1990-01-01", nationalId: String(nid),
    byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
  const enc = E.openEncounter({
    facilityId, patientMrn: mrn, kind: "outpatient",
    clinicianId: clinicianId!, clinicianName: "Dr. Achieng Wanjiru", deviceCode: DEV,
  });
  const orderId = O.placeOrder({
    encounterId: enc, kind: "lab", serviceCode: service, payerCode: "CASH",
    clinicalQuestion: "Rule out anaemia", deviceCode: DEV,
    ordererId: clinicianId!, ordererName: "Dr. Achieng Wanjiru",
  });
  const specimenId = L.collectSpecimen({
    orderId, kind: "EDTA whole blood",
    collectorId: labTechId!, collectorName: "Samuel Mutiso", deviceCode: DEV,
  });
  return { specimenId, orderId, mrn };
}

// ------------------------------------------------------------------ frames

test("a frame whose checksum does not add up is rejected, not silently dropped", () => {
  // A laboratory losing one result in a hundred and not knowing is worse than
  // one that loses none and would have been told.
  const good = A.frame("H|\\^&|||Demo");
  assert.equal(A.checkFrame(good).ok, true);

  const corrupted = good.slice(0, -4) + "FF\r\n";
  const check = A.checkFrame(corrupted);
  assert.equal(check.ok, false);
  assert.match(check.reason!, /checksum/);
});

test("a bare record with no framing is passed through, because plenty of drivers hand those over", () => {
  const check = A.checkFrame("R|1|^^^GLU|5.5|mmol/L");
  assert.equal(check.ok, true);
  assert.equal(check.text, "R|1|^^^GLU|5.5|mmol/L");
});

test("the frame we build is the frame we would accept", () => {
  const built = A.frame("O|1|SPEC-1||^^^GLU|R");
  const check = A.checkFrame(built);
  assert.equal(check.ok, true);
  assert.equal(check.text, "O|1|SPEC-1||^^^GLU|R");
});

// ----------------------------------------------------------------- parsing

test("ASTM results carry their specimen, their test code and their unit", () => {
  const parsed = A.parseAstm(
    A.simulateAstm({
      specimenId: "SPEC-1",
      readings: [
        { code: "GLU", value: "5.5", unit: "mmol/L" },
        { code: "K", value: "4.1", unit: "mmol/L" },
      ],
      at: "2026-09-16T10:30:00.000Z",
    }),
  );

  assert.equal(parsed.results.length, 2);
  assert.equal(parsed.results[0].specimenRef, "SPEC-1");
  assert.equal(parsed.results[0].theirCode, "GLU");
  assert.equal(parsed.results[0].unit, "mmol/L");
  assert.equal(parsed.results[0].at.slice(0, 16), "2026-09-16T10:30");
});

test("HL7 ORU segments parse to the same shape", () => {
  const parsed = A.parseHl7(
    [
      "MSH|^~\\&|HAEM|LAB|AFYA|CLINIC|20260916103000||ORU^R01|1|P|2.5",
      "PID|1||SPEC-2",
      "OBR|1|order-1|SPEC-2|CBC",
      "OBX|1|NM|HGB^Haemoglobin||11.2|g/dL|||||F|||20260916103000",
      "OBX|2|NM|WBC^White cells||7.4|x10^9/L|||||F|||20260916103000",
    ].join("\r"),
  );

  assert.equal(parsed.results.length, 2);
  assert.equal(parsed.results[0].specimenRef, "SPEC-2");
  assert.equal(parsed.results[0].theirCode, "HGB");
  assert.equal(parsed.results[1].value, "7.4");
});

// ------------------------------------------------------------------ filing

test("a mapped reading on a real specimen is filed, preliminary, and never released", () => {
  // An interface that auto-releases has removed the only person the KMLTTB
  // registers for the purpose.
  const { specimenId, orderId } = collected();
  const out = A.receiveMessage({
    analyserCode: "CHEM1",
    raw: A.simulateAstm({ specimenId, readings: [{ code: "GLU", value: "5.5", unit: "mmol/L" }] }),
    ...TECH,
  });

  assert.equal(out.filed, 1);
  assert.equal(out.held, 0);
  assert.equal(out.status, "accepted");

  const [result] = L.resultsFor(orderId);
  assert.equal(result.analyte, "GLUCOSE");
  assert.equal(result.value_milli, 5500);
  assert.equal(result.status, "preliminary");
  assert.equal(result.released_at, null);
  assert.match(result.entered_by_name, /CHEM1/);
});

test("a reading for a specimen nobody ordered is held, not discarded", () => {
  // It is somebody's blood. The usual cause is a barcode typed wrong at the
  // bench, which a person fixes in ten seconds if they are told.
  const out = A.receiveMessage({
    analyserCode: "CHEM1",
    raw: A.simulateAstm({ specimenId: "TYPO-999", readings: [{ code: "GLU", value: "6.1", unit: "mmol/L" }] }),
    ...TECH,
  });

  assert.equal(out.filed, 0);
  assert.equal(out.held, 1);
  assert.equal(out.status, "held");

  const held = A.heldReadings(facilityId);
  assert.ok(held.some((h) => h.specimen_ref === "TYPO-999" && /check the barcode/.test(h.reason)));
  assert.ok(N.inbox(facilityId).some((n) => n.kind === "analyser_held"));
});

test("a test the machine reports that nobody mapped is held with its own name in the message", () => {
  const { specimenId } = collected();
  A.receiveMessage({
    analyserCode: "CHEM1",
    raw: A.simulateAstm({ specimenId, readings: [{ code: "MYSTERY", value: "1.0", unit: "" }] }),
    ...TECH,
  });

  const held = A.heldReadings(facilityId).find((h) => h.their_code === "MYSTERY")!;
  assert.match(held.reason, /"MYSTERY" that is not mapped/);
});

test("a unit nobody wrote a conversion for is held, never converted by guess", () => {
  // An analyser reporting creatinine in mg/dL into ranges in µmol/L turns 1.1
  // into 1.1, and every threshold downstream is then wrong.
  const { specimenId } = collected();
  A.receiveMessage({
    analyserCode: "CHEM1",
    raw: A.simulateAstm({ specimenId, readings: [{ code: "CREA", value: "1.1", unit: "mg/dL" }] }),
    ...TECH,
  });

  const held = A.heldReadings(facilityId).find((h) => h.analyte === "CREATININE")!;
  assert.match(held.reason, /no conversion has been written down/);
  assert.match(held.reason, /mg\/dL/);
});

test("a conversion written down on purpose is applied", () => {
  A.mapTest({
    analyserCode: "CHEM1", theirCode: "CREA", analyte: "CREATININE",
    theirUnit: "mg/dL", factor: 88.4,
  });
  const { specimenId, orderId } = collected();
  A.receiveMessage({
    analyserCode: "CHEM1",
    raw: A.simulateAstm({ specimenId, readings: [{ code: "CREA", value: "1.1", unit: "mg/dL" }] }),
    ...TECH,
  });

  const result = L.resultsFor(orderId).find((r) => r.analyte === "CREATININE")!;
  assert.equal(result.value_milli, Math.round(1.1 * 88.4 * 1000));
  assert.equal(result.unit, "umol/L");
});

test("a conversion factor is a positive number or nothing at all", () => {
  assert.throws(
    () => A.mapTest({ analyserCode: "CHEM1", theirCode: "X", analyte: "X", factor: 0 }),
    /positive number/,
  );
});

test("a control is never filed against a patient", () => {
  // A QC sample in somebody's record is a fabricated result.
  const out = A.receiveMessage({
    analyserCode: "CHEM1",
    raw: A.simulateAstm({
      specimenId: "QC-LEVEL-2",
      readings: [{ code: "GLU", value: "5.0", unit: "mmol/L" }],
      control: true,
    }),
    ...TECH,
  });

  assert.equal(out.qc, 1);
  assert.equal(out.filed, 0);
  assert.equal(out.held, 0);

  const qc = A.qcFor("CHEM1");
  assert.equal(qc[0].analyte, "GLU");
  assert.equal(qc[0].value_milli, 5000);

  // And nothing landed in anybody's record under that barcode.
  const leaked = all<{ n: number }>(
    `SELECT COUNT(*) AS n FROM lab_results r JOIN specimens s ON s.order_id = r.order_id WHERE s.id = ?`,
    "QC-LEVEL-2",
  );
  assert.equal(leaked[0].n, 0);
  assert.equal(A.heldReadings(facilityId).some((h) => h.specimen_ref === "QC-LEVEL-2"), false);
});

test("a result on a rejected specimen is refused", () => {
  const { specimenId, orderId } = collected();
  L.rejectSpecimen({
    specimenId, reason: "Clotted",
    byUserId: labTechId!, byUserName: "Samuel Mutiso",
  });

  A.receiveMessage({
    analyserCode: "CHEM1",
    raw: A.simulateAstm({ specimenId, readings: [{ code: "GLU", value: "5.5", unit: "mmol/L" }] }),
    ...TECH,
  });

  assert.equal(L.resultsFor(orderId).length, 0);
  assert.ok(A.heldReadings(facilityId).some((h) => /was rejected/.test(h.reason)));
});

test("the raw message is kept exactly as it arrived", () => {
  // Six months later the question is what the machine actually said.
  const { specimenId } = collected();
  const raw = A.simulateAstm({ specimenId, readings: [{ code: "GLU", value: "9.9", unit: "mmol/L" }] });
  const out = A.receiveMessage({ analyserCode: "CHEM1", raw, ...TECH });

  const message = A.messagesFor("CHEM1").find((m) => m.id === out.messageId)!;
  assert.equal(message.raw, raw);
});

test("an empty message is refused rather than recorded as nothing", () => {
  assert.throws(() => A.receiveMessage({ analyserCode: "CHEM1", raw: "   ", ...TECH }), /empty/);
});

// -------------------------------------------------------------- exceptions

test("a held reading is filed against the specimen it actually belonged to", () => {
  const { specimenId, orderId } = collected();
  A.receiveMessage({
    analyserCode: "CHEM1",
    raw: A.simulateAstm({ specimenId: "MISTYPED-1", readings: [{ code: "K", value: "4.4", unit: "mmol/L" }] }),
    ...TECH,
  });
  const held = A.heldReadings(facilityId).find((h) => h.specimen_ref === "MISTYPED-1")!;

  const out = A.resolveHeld({ exceptionId: held.id, specimenId, ...TECH });
  assert.equal(out.filed, true);

  const result = L.resultsFor(orderId).find((r) => r.analyte === "K")!;
  assert.equal(result.value_milli, 4400);
  assert.equal(result.status, "preliminary");
});

test("the exception stays on the record after it is resolved", () => {
  // One bench, one shift, the same mistake is what tells a manager something
  // is wrong with the process rather than the machine.
  const rows = all<{ resolution: string }>(
    `SELECT resolution FROM analyser_exceptions WHERE resolved_at IS NOT NULL`,
  );
  assert.ok(rows.some((r) => /^Filed against /.test(r.resolution)));
});

test("resolving must either say where it goes or why it is being discarded", () => {
  const { specimenId } = collected();
  A.receiveMessage({
    analyserCode: "CHEM1",
    raw: A.simulateAstm({ specimenId: "MISTYPED-2", readings: [{ code: "K", value: "3.9", unit: "mmol/L" }] }),
    ...TECH,
  });
  const held = A.heldReadings(facilityId).find((h) => h.specimen_ref === "MISTYPED-2")!;

  assert.throws(() => A.resolveHeld({ exceptionId: held.id, ...TECH }), /either say which specimen/);
  A.resolveHeld({ exceptionId: held.id, discardReason: "Control run under a patient barcode in error", ...TECH });
  assert.throws(() => A.resolveHeld({ exceptionId: held.id, specimenId, ...TECH }), /already been dealt with/);
});

// ----------------------------------------------------------------- worklist

test("the worklist is what has been collected and not yet resulted, stat first", () => {
  const list = A.worklist(facilityId);
  assert.ok(list.length > 0);
  assert.ok(list.every((entry) => entry.specimenId && entry.serviceCode));

  const astm = A.worklistAstm(facilityId, "CHEM1");
  assert.match(astm, /H\|/);
  assert.match(astm, /L\|1\|N/);
  // Every line it produces is a frame this module would itself accept.
  for (const line of astm.split(/\r\n/).filter(Boolean)) {
    assert.equal(A.checkFrame(line).ok, true);
  }
});

// ------------------------------------------------------------------ reports

test("the summary names the commonest reason readings are held, which is usually the fix", () => {
  const summary = A.analyserSummary(facilityId);
  assert.equal(summary.analysers, 2);
  assert.equal(summary.live, 0);
  assert.ok(summary.messages > 0);
  assert.ok(summary.filed > 0);
  assert.ok(summary.held > 0);
  assert.ok(summary.qcRuns >= 1);
  assert.ok(summary.topReason);
  assert.ok(summary.silent.some((s) => s.code === "HAEM1"), "an analyser that has said nothing is worth knowing about");
});

test("the audit chain still verifies after all of that", () => {
  assert.equal(verifyAuditChain().ok, true);
});
