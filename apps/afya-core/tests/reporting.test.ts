/**
 * M70 Reporting & MOH Returns and M71 the KHIS/DHIS2 push.
 *
 * Staff re-keying the monthly returns by hand — from a tally sheet, from a
 * register, from memory — is the weakness this answers, and it is the same in
 * every system we looked at. So the test that matters is that the figures come
 * out of the transactions the facility already recorded, and that a return once
 * sent stays what was sent.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-moh-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const { seedDemo } = await import("../src/lib/seed.ts");
const R = await import("../src/lib/reporting.ts");
const P = await import("../src/lib/patients.ts");
const E = await import("../src/lib/encounters.ts");
const N = await import("../src/lib/notifications.ts");
const I = await import("../src/lib/integration.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get, all, run } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "MOH1", label: "Records office", byUserId: adminId, byUserName: "admin" });

const DEV = "MOH1";
const DOC = { byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru" };
const BY = { byUserId: adminId, byUserName: "Facility Administrator", deviceCode: DEV };

/** A month safely in the past, so nothing else in the suite writes into it. */
const PERIOD = "2026-03";
const IN_PERIOD = "2026-03-14T10:00:00.000Z";

let nid = 80_000_000;

/**
 * A closed outpatient encounter with a coded diagnosis, dated into the period.
 *
 * Dates are moved afterwards rather than mocked: the module reads `opened_at`,
 * and a test that stubs the clock would not prove the query filters on it.
 */
function encounterWith(code: string, dob: string, at = IN_PERIOD, kind: "outpatient" | "emergency" = "outpatient"): string {
  const mrn = P.registerPatient({
    facilityId, deviceCode: DEV, givenName: "Case", familyName: "Report", sex: "female",
    dateOfBirth: dob, nationalId: String(++nid), byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
  const enc = E.openEncounter({
    facilityId, patientMrn: mrn, kind, clinicianId, clinicianName: DOC.byUserName, deviceCode: DEV,
  });
  E.addDiagnosis({ encounterId: enc, code, ...DOC, deviceCode: DEV });
  E.writeNote({
    encounterId: enc, complaint: "Unwell", assessment: "Seen and treated", plan: "Treat",
    authorId: clinicianId, authorName: DOC.byUserName, deviceCode: DEV,
  });
  E.closeEncounter({ encounterId: enc, byUserId: clinicianId, byUserName: DOC.byUserName, deviceCode: DEV });
  run(`UPDATE encounters SET opened_at = ?, closed_at = ? WHERE id = ?`, at, at, enc);
  return enc;
}

// ============================================================== the returns

test("a reporting period is a month, and anything else is refused", () => {
  for (const bad of ["2026", "2026-13", "March", "2026-3"]) {
    assert.throws(() => R.computeReturn({ facilityId, form: "MOH705A", period: bad }), /a month/);
  }
});

test("705A and 705B split by age on the day of the visit, not age today", () => {
  // Born four years before the encounter: a 705A patient in that month.
  encounterWith("1F40", "2022-06-01");
  // Born six years before: 705B.
  encounterWith("1F40", "2020-01-01");
  // And the case that catches a lazy implementation: turned five AFTER the
  // encounter, so still 705A then even though they are older than five now.
  encounterWith("1F40", "2021-06-01");

  const underFive = R.computeReturn({ facilityId, form: "MOH705A", period: PERIOD });
  const overFive = R.computeReturn({ facilityId, form: "MOH705B", period: PERIOD });

  assert.equal(underFive.find((l) => l.element === "MALARIA_CONFIRMED")!.value, 2);
  assert.equal(overFive.find((l) => l.element === "MALARIA_CONFIRMED")!.value, 1);
});

test("a condition is counted whichever code in its family the clinician used", () => {
  encounterWith("1F4Z", "1990-01-01"); // Malaria, unspecified.
  encounterWith("1F41", "1990-01-01"); // Malaria due to P. vivax.

  const lines = R.computeReturn({ facilityId, form: "MOH705B", period: PERIOD });
  assert.equal(
    lines.find((l) => l.element === "MALARIA_CONFIRMED")!.value,
    3,
    "coding malaria three different ways is still malaria three times",
  );
});

test("the figures come out of the transactions, not out of a tally sheet", () => {
  encounterWith("CA40", "1990-01-01");
  encounterWith("GC08", "1990-01-01");
  encounterWith("CA23", "1990-01-01");

  const lines = R.computeReturn({ facilityId, form: "MOH705B", period: PERIOD });
  assert.equal(lines.find((l) => l.element === "PNEUMONIA")!.value, 1);
  assert.equal(lines.find((l) => l.element === "UTI")!.value, 1);
  assert.equal(lines.find((l) => l.element === "ASTHMA")!.value, 1);

  const total = lines.find((l) => l.element === "TOTAL_DIAGNOSES")!.value;
  const broken = lines.filter((l) => !["TOTAL_DIAGNOSES", "OTHER_DIAGNOSES", "UNCLASSIFIED_WARNING"].includes(l.element));
  const other = lines.find((l) => l.element === "OTHER_DIAGNOSES")!.value;
  assert.equal(broken.reduce((s, l) => s + l.value, 0) + other, total, "the parts add up to the whole");
});

test("a month reports only its own encounters", () => {
  encounterWith("1F40", "1990-01-01", "2026-04-02T09:00:00.000Z");
  const march = R.computeReturn({ facilityId, form: "MOH705B", period: PERIOD });
  const april = R.computeReturn({ facilityId, form: "MOH705B", period: "2026-04" });
  assert.equal(april.find((l) => l.element === "MALARIA_CONFIRMED")!.value, 1);
  assert.ok(march.find((l) => l.element === "MALARIA_CONFIRMED")!.value >= 3);
});

test("MOH 717 counts what the facility did", () => {
  encounterWith("CA07", "1990-01-01", IN_PERIOD, "emergency");

  const lines = R.computeReturn({ facilityId, form: "MOH717", period: PERIOD });
  const value = (e: string) => lines.find((l) => l.element === e)!.value;

  assert.ok(value("OUTPATIENT_ATTENDANCES") > 0);
  assert.equal(value("EMERGENCY_ATTENDANCES"), 1);
  assert.equal(value("ADMISSIONS"), 0, "nothing was admitted this month");
  assert.equal(value("DEATHS"), 0);
  assert.ok(lines.every((l) => Number.isInteger(l.value)));
});

// ========================================================== freezing and drift

test("generating a return freezes its figures", () => {
  const { id, lines } = R.generateReturn({ facilityId, form: "MOH705B", period: PERIOD, ...BY });
  assert.ok(id);
  const stored = R.getReturn(facilityId, "MOH705B", PERIOD)!;
  assert.equal(stored.status, "draft");

  const values = JSON.parse(stored.values_json);
  assert.equal(values.MALARIA_CONFIRMED, lines.find((l) => l.element === "MALARIA_CONFIRMED")!.value);
});

test("a submitted return is not silently replaced by a later run", () => {
  R.submitToDhis2({ facilityId, form: "MOH705B", period: PERIOD, byUserId: adminId, byUserName: "admin" });
  assert.throws(
    () => R.generateReturn({ facilityId, form: "MOH705B", period: PERIOD, ...BY }),
    /already submitted.*Compare it/s,
  );
});

test("a late entry shows up as variance, which is a finding rather than a fix", () => {
  const before = R.variance({ facilityId, form: "MOH705B", period: PERIOD });
  assert.deepEqual(before, [], "nothing has changed yet");

  // A clinic writes up a paper consultation a fortnight late. It happens.
  encounterWith("CA40", "1990-01-01");

  const after = R.variance({ facilityId, form: "MOH705B", period: PERIOD });
  const pneumonia = after.find((v) => v.element === "PNEUMONIA")!;
  assert.equal(pneumonia.difference, 1);
  assert.equal(pneumonia.now, pneumonia.submitted + 1);
  assert.ok(after.some((v) => v.element === "TOTAL_DIAGNOSES"));

  const stored = JSON.parse(R.getReturn(facilityId, "MOH705B", PERIOD)!.values_json);
  assert.equal(stored.PNEUMONIA, pneumonia.submitted, "what was sent is still what was sent");
});

// ======================================================= M71 the push to KHIS

test("submitting goes through the hub and records that it was simulated", () => {
  R.generateReturn({ facilityId, form: "MOH717", period: PERIOD, ...BY });
  const result = R.submitToDhis2({ facilityId, form: "MOH717", period: PERIOD, byUserId: adminId, byUserName: "admin" });

  assert.equal(result.submitted, true);
  assert.equal(result.simulated, true);
  assert.ok(result.reference);

  const stored = R.getReturn(facilityId, "MOH717", PERIOD)!;
  assert.equal(stored.status, "submitted");
  assert.ok(stored.submitted_at);

  const logged = all<{ endpoint: string; operation: string; mode: string }>(
    `SELECT endpoint, operation, mode FROM integration_log WHERE endpoint = 'DHIS2' ORDER BY id DESC LIMIT 1`,
  )[0];
  assert.equal(logged.operation, "submitDataValues");
  assert.equal(logged.mode, "demo");

  const entry = get<{ detail: string }>(
    `SELECT detail FROM audit_log WHERE action = 'moh_return_submitted' ORDER BY id DESC LIMIT 1`,
  )!;
  assert.equal(JSON.parse(entry.detail).simulated, true, "nobody can later mistake a demonstration for a filing");
});

test("submitting the same return twice is refused", () => {
  assert.throws(
    () => R.submitToDhis2({ facilityId, form: "MOH717", period: PERIOD, byUserId: adminId, byUserName: "admin" }),
    /already been submitted/,
  );
});

test("a return cannot be submitted before it is generated", () => {
  assert.throws(
    () => R.submitToDhis2({ facilityId, form: "MOH705A", period: "2026-05", byUserId: adminId, byUserName: "admin" }),
    /generate the return before submitting/,
  );
});

test("a failed submission keeps the return and tells the administrator", () => {
  I.setEndpointMode({ code: "DHIS2", mode: "disabled", byUserId: adminId, byUserName: "admin" });
  R.generateReturn({ facilityId, form: "MOH705A", period: PERIOD, ...BY });

  const result = R.submitToDhis2({ facilityId, form: "MOH705A", period: PERIOD, byUserId: adminId, byUserName: "admin" });
  assert.equal(result.submitted, false);
  assert.equal(result.simulated, false);

  const stored = R.getReturn(facilityId, "MOH705A", PERIOD)!;
  assert.equal(stored.status, "draft", "it is still there to send again");
  assert.ok(stored.last_error);

  assert.ok(N.inbox(facilityId, "administrator").some((n) => n.kind === "moh_return_failed"));
  I.setEndpointMode({ code: "DHIS2", mode: "demo", byUserId: adminId, byUserName: "admin" });
});

// ====================================================== notifiable diseases

test("notifiable conditions are found from the diagnoses as they were made", () => {
  const raised = R.detectNotifiable(facilityId);
  assert.ok(raised > 0, "malaria is notifiable, and the clinic has seen plenty");

  const again = R.detectNotifiable(facilityId);
  assert.equal(again, 0, "the same diagnosis is one event, not one per run");

  const outstanding = R.outstandingNotifications(facilityId);
  assert.ok(outstanding.length > 0);
  assert.ok(outstanding.every((o) => o.condition_term && o.daysWaiting >= 0));
  assert.ok(N.inbox(facilityId, "administrator").some((n) => n.kind === "notifiable_disease"));
});

test("reporting one requires the county's reference — it is the proof it was made", () => {
  const event = R.outstandingNotifications(facilityId)[0];
  assert.throws(
    () => R.markNotified({ eventId: event.id, reference: "  ", byUserId: adminId, byUserName: "admin" }),
    /the county's reference/,
  );

  R.markNotified({ eventId: event.id, reference: "NRB/PH/2026/0412", byUserId: adminId, byUserName: "admin" });
  assert.ok(!R.outstandingNotifications(facilityId).some((o) => o.id === event.id));

  const entry = get<{ detail: string }>(
    `SELECT detail FROM audit_log WHERE action = 'notifiable_reported' ORDER BY id DESC LIMIT 1`,
  )!;
  assert.match(JSON.parse(entry.detail).reference, /NRB\/PH/);
});

test("the returns list is what a records officer opens", () => {
  const returns = R.listReturns(facilityId);
  assert.ok(returns.length >= 3);
  assert.ok(returns.some((r) => r.form === "MOH717" && r.status === "submitted"));

  const lines = R.returnLines(returns.find((r) => r.form === "MOH717")!);
  assert.ok(lines.some((l) => l.label === "Bed days"), "labelled, not just element codes");
});

test("the audit chain survives reporting", () => {
  const v = verifyAuditChain();
  assert.equal(v.ok, true, v.ok ? "" : `broken at entry ${v.failedAtId}`);
});
