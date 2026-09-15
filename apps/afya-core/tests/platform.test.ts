/**
 * M04 Integration Hub, M05 Notifications, M06 Document Store.
 *
 * These three are the platform underneath the clinical and revenue modules:
 * the only way out of the building, the only way something expiring reaches a
 * person, and the only place a file lives. The tests that matter here are the
 * ones about honesty — a simulated answer must be labelled, a failed call must
 * not vanish, a signature must not survive the content being edited.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-plat-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";
import type { Adapter } from "../src/lib/integration.ts";

const { seedDemo } = await import("../src/lib/seed.ts");
const I = await import("../src/lib/integration.ts");
const N = await import("../src/lib/notifications.ts");
const D = await import("../src/lib/documents.ts");
const P = await import("../src/lib/patients.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get, all, run } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "PLAT", label: "Test bench", byUserId: adminId, byUserName: "admin" });
I.seedEndpoints();

const DEV = "PLAT";
const BY = { byUserId: adminId, byUserName: "Facility Administrator" };

// =========================================================== M04 integration

test("the endpoints a Kenyan facility needs are installed, in demo mode", () => {
  const codes = I.listEndpoints().map((e) => e.code).sort();
  assert.deepEqual(codes, ["DHIS2", "ETIMS", "MPESA", "SHA", "SMS"]);
  assert.equal(I.getEndpoint("sha")!.mode, "demo", "case-insensitive lookup, demo by default");
  assert.ok(I.listEndpoints().every((e) => e.mode === "demo"));
});

test("seeding endpoints twice does not duplicate or reset the mode", () => {
  I.setEndpointMode({ code: "SMS", mode: "disabled", ...BY });
  I.seedEndpoints();
  assert.equal(I.getEndpoint("SMS")!.mode, "disabled", "an operator's choice survives a re-seed");
  I.setEndpointMode({ code: "SMS", mode: "demo", ...BY });
});

test("a demo answer is always stamped simulated", () => {
  const r = I.call({
    endpoint: "SHA",
    operation: "verifyMember",
    request: { memberNumber: "SHA-777001" },
  });
  assert.equal(r.ok, true);
  assert.equal(r.simulated, true, "a simulated acknowledgement must never pass for a real one");
});

test("the demo payer refuses a malformed request rather than inventing an answer", () => {
  const r = I.call({ endpoint: "SHA", operation: "verifyMember", request: { memberNumber: "  " } });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.retryable, false, "a malformed request is not worth retrying");
});

test("a pre-authorisation with no clinical justification is declined", () => {
  const r = I.call({
    endpoint: "SHA",
    operation: "requestPreauth",
    request: { serviceCodes: ["CT-HEAD"], clinicalSummary: "scan" },
  });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /clinical summary/i);
});

test("the demo payer is deterministic, so a demonstration replays identically", () => {
  const a = I.call({ endpoint: "SHA", operation: "pollOutcome", request: { claimId: "CLM-REPEAT" } });
  const b = I.call({ endpoint: "SHA", operation: "pollOutcome", request: { claimId: "CLM-REPEAT" } });
  assert.deepEqual(a, b);
});

test("the demo payer rejects a minority of claims, with real reason codes", () => {
  const outcomes = Array.from({ length: 200 }, (_, i) =>
    I.call({ endpoint: "SHA", operation: "pollOutcome", request: { claimId: `CLM-${i}` } }),
  ).map((r) => (r.ok ? (r.data.outcome as string) : "error"));

  const rejected = outcomes.filter((o) => o === "rejected").length;
  assert.ok(rejected > 20 && rejected < 60, `a plausible rejection rate, got ${rejected}/200`);
  assert.ok(outcomes.some((o) => o === "accepted" || o === "paid"));

  const oneRejection = Array.from({ length: 200 }, (_, i) =>
    I.call({ endpoint: "SHA", operation: "pollOutcome", request: { claimId: `CLM-${i}` } }),
  ).find((r) => r.ok && r.data.outcome === "rejected");
  assert.match(String(oneRejection!.ok && oneRejection!.data.code), /^E\d\d$/);
});

test("a disabled endpoint fails loudly and is not marked simulated", () => {
  I.setEndpointMode({ code: "DHIS2", mode: "disabled", ...BY });
  const r = I.call({ endpoint: "DHIS2", operation: "submitDataValues", request: { dataValues: [{ v: 1 }] } });
  assert.equal(r.ok, false);
  assert.equal(r.simulated, false, "a refusal to call is not a simulated call");
  assert.equal(r.ok === false && r.retryable, true, "it can be tried again once enabled");
  I.setEndpointMode({ code: "DHIS2", mode: "demo", ...BY });
});

test("live mode is refused while no live adapter exists", () => {
  assert.throws(
    () => I.setEndpointMode({ code: "SHA", mode: "live", ...BY }),
    /specification is still outstanding/,
  );
  assert.equal(I.getEndpoint("SHA")!.mode, "demo", "and the mode did not change");
});

test("a registered live adapter can be switched on, and is not simulated", () => {
  const live: Adapter = () => ({ ok: true, data: { imported: 1 }, simulated: false });
  I.registerAdapter("DHIS2", live);
  I.setEndpointMode({ code: "DHIS2", mode: "live", ...BY });
  const r = I.call({ endpoint: "DHIS2", operation: "submitDataValues", request: { dataValues: [{ v: 1 }] } });
  assert.equal(r.ok, true);
  assert.equal(r.simulated, false);
  I.setEndpointMode({ code: "DHIS2", mode: "demo", ...BY });
});

test("a retryable failure is retried three times and then dead-lettered, never dropped", () => {
  let attempts = 0;
  I.registerAdapter("SMS", () => {
    attempts++;
    return { ok: false, error: "gateway timeout", retryable: true, simulated: false };
  });
  I.setEndpointMode({ code: "SMS", mode: "live", ...BY });

  const before = I.deadLetters().length;
  const r = I.call({ endpoint: "SMS", operation: "send", request: { to: "254712000111", body: "hi" } });

  assert.equal(r.ok, false);
  assert.equal(attempts, 3);
  const dead = I.deadLetters();
  assert.equal(dead.length, before + 1);
  assert.equal(dead.at(-1)!.endpoint, "SMS");
  assert.equal(dead.at(-1)!.attempts, 3);
  assert.equal(JSON.parse(all<{ request: string }>(`SELECT request FROM integration_dead_letters ORDER BY id DESC LIMIT 1`)[0].request).to, "254712000111", "the request is kept so it can be re-sent");

  I.setEndpointMode({ code: "SMS", mode: "demo", ...BY });
});

test("an adapter that throws is treated as a failure, not a crash", () => {
  I.registerAdapter("SMS", () => {
    throw new Error("socket hang up");
  });
  I.setEndpointMode({ code: "SMS", mode: "live", ...BY });
  const r = I.call({ endpoint: "SMS", operation: "send", request: { to: "254712000112" } });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /socket hang up/);
  I.setEndpointMode({ code: "SMS", mode: "demo", ...BY });
});

test("a dead letter can be resolved by a person and leaves the list", () => {
  const open = I.deadLetters();
  assert.ok(open.length > 0);
  I.resolveDeadLetter(open[0].id, adminId);
  assert.ok(!I.deadLetters().some((d) => d.id === open[0].id));
});

test("credentials are redacted before the call is logged", () => {
  I.call({
    endpoint: "SHA",
    operation: "verifyMember",
    request: { memberNumber: "SHA-777002", apiKey: "live-key-abc", password: "hunter2" },
  });
  const row = get<{ request: string }>(
    `SELECT request FROM integration_log WHERE endpoint = 'SHA' ORDER BY id DESC LIMIT 1`,
  )!;
  assert.doesNotMatch(row.request, /live-key-abc/, "an auditor gets the log; they must not get the key");
  assert.doesNotMatch(row.request, /hunter2/);
  assert.match(row.request, /redacted/);
  assert.match(row.request, /SHA-777002/, "but the part that explains the call is kept");
});

test("every call is logged with the mode it ran in", () => {
  const log = I.integrationLog("SHA", 5);
  assert.ok(log.length > 0);
  assert.ok(log.every((l) => l.mode === "demo"), "so nobody can later claim a demo answer was live");
});

test("health reports the mode, the last call and the outstanding failures", () => {
  const sha = I.health().find((h) => h.code === "SHA")!;
  assert.equal(sha.mode, "demo");
  assert.ok(sha.lastCallAt);
  assert.equal(sha.lastStatus, "ok");
  assert.equal(typeof sha.failures24h, "number");
});

test("calling an endpoint that does not exist is a programming error, not a queue", () => {
  assert.throws(() => I.call({ endpoint: "NHIF", operation: "x", request: {} }), /unknown integration endpoint/);
});

// ========================================================= M05 notifications

test("a notification lands on the desk of the role that can act on it", () => {
  const id = N.notify({
    facilityId,
    ownerRole: "claims_officer",
    severity: "info",
    kind: "test",
    subject: "A claim needs looking at",
    dedupeKey: "test:1",
  });
  assert.ok(id > 0);
  assert.ok(N.inbox(facilityId, "claims_officer").some((n) => n.id === id));
  assert.ok(!N.inbox(facilityId, "pharmacist").some((n) => n.id === id));
});

test("the same condition seen twice updates one notification instead of breeding", () => {
  const a = N.notify({ facilityId, ownerRole: "administrator", severity: "info", kind: "test", subject: "First", dedupeKey: "test:2" });
  const b = N.notify({ facilityId, ownerRole: "administrator", severity: "info", kind: "test", subject: "Second", dedupeKey: "test:2" });
  assert.equal(a, b);
  assert.equal(get<{ subject: string }>(`SELECT subject FROM notifications WHERE id = ?`, a)!.subject, "Second");
});

test("a notification a person has dealt with is not resurrected by the same condition", () => {
  const id = N.notify({ facilityId, ownerRole: "administrator", severity: "warning", kind: "test", subject: "Handled", dedupeKey: "test:3" });
  N.markActed({ id, byUserId: adminId, byUserName: "admin" });
  N.notify({ facilityId, ownerRole: "administrator", severity: "warning", kind: "test", subject: "Handled again", dedupeKey: "test:3" });
  assert.ok(!N.inbox(facilityId).some((n) => n.id === id), "yesterday's work does not come back");
});

test("but a condition that has got worse reopens it", () => {
  const id = N.notify({ facilityId, ownerRole: "administrator", severity: "warning", kind: "test", subject: "Watch", dedupeKey: "test:4" });
  N.markActed({ id, byUserId: adminId, byUserName: "admin" });
  N.notify({ facilityId, ownerRole: "administrator", severity: "critical", kind: "test", subject: "Now urgent", dedupeKey: "test:4" });
  const open = N.inbox(facilityId).find((n) => n.id === id);
  assert.ok(open, "escalation is exactly the case that must not be swallowed");
  assert.equal(open!.severity, "critical");
});

test("the inbox is ordered worst first, then oldest", () => {
  const inbox = N.inbox(facilityId);
  const ranks = inbox.map((n) => (n.severity === "critical" ? 3 : n.severity === "warning" ? 2 : 1));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a));
});

test("actioning a notification is audited", () => {
  const id = N.notify({ facilityId, ownerRole: "administrator", severity: "info", kind: "test", subject: "Audited", dedupeKey: "test:5" });
  N.markActed({ id, byUserId: adminId, byUserName: "Facility Administrator" });
  const entry = get<{ action: string }>(`SELECT action FROM audit_log ORDER BY id DESC LIMIT 1`)!;
  assert.equal(entry.action, "notification_actioned");
});

test("the sweep raises the claim clock on the published schedule", async () => {
  const E = await import("../src/lib/encounters.ts");
  const mrn = P.registerPatient({
    facilityId, deviceCode: DEV, givenName: "Clock", familyName: "Test", sex: "female",
    nationalId: "44550011", byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
  const encounterId = E.openEncounter({
    facilityId, patientMrn: mrn, kind: "outpatient",
    clinicianId, clinicianName: "Dr. Achieng Wanjiru", deviceCode: DEV,
  });

  // A claim whose service date is six days ago: one day of the window left.
  const serviceDate = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  const at = new Date().toISOString();
  run(
    `INSERT INTO claims (id, encounter_id, patient_mrn, payer_code, service_date, total_cents, status, created_at, updated_at)
     VALUES ('CLM-CLOCK', ?, ?, 'SHA', ?, 100000, 'ready', ?, ?)`,
    encounterId, mrn, serviceDate, at, at,
  );

  const result = N.sweep(facilityId);
  assert.ok(result.claimsClosingSoon >= 1);
  const raised = N.inbox(facilityId).find((n) => n.entity === "claim" && n.entity_id === "CLM-CLOCK")!;
  assert.ok(raised, "day six must reach someone");
  assert.equal(raised.severity, "critical");
  assert.equal(raised.owner_role, "administrator", "by day six it is the administrator's problem");
  assert.match(raised.subject, /today/);
});

test("a claim past the window is critical and says the window is gone", () => {
  const serviceDate = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
  run(`UPDATE claims SET service_date = ? WHERE id = 'CLM-CLOCK'`, serviceDate);
  const result = N.sweep(facilityId);
  assert.equal(result.claimsOverdue, 1);
  const n = N.inbox(facilityId).find((x) => x.entity_id === "CLM-CLOCK")!;
  assert.match(n.subject, /past the submission window/);
  assert.equal(n.severity, "critical");
});

test("a submitted claim is off the clock", () => {
  run(`UPDATE claims SET status = 'submitted' WHERE id = 'CLM-CLOCK'`);
  const result = N.sweep(facilityId);
  assert.equal(result.claimsOverdue, 0);
  run(`DELETE FROM claims WHERE id = 'CLM-CLOCK'`);
});

test("the sweep does not multiply notifications when it runs repeatedly", () => {
  N.sweep(facilityId);
  const before = all<{ id: number }>(`SELECT id FROM notifications`).length;
  N.sweep(facilityId);
  N.sweep(facilityId);
  assert.equal(all<{ id: number }>(`SELECT id FROM notifications`).length, before);
});

test("an expiring practitioner licence reaches the administrator before it lapses", () => {
  const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  run(`UPDATE practitioner_licences SET expires_on = ? WHERE user_id = ?`, soon, clinicianId);
  N.sweep(facilityId);
  const n = N.inbox(facilityId).find((x) => x.kind === "licence_expiry" && x.entity_id === String(clinicianId))!;
  assert.ok(n);
  assert.equal(n.severity, "warning");
  assert.match(n.subject, /expires in 10 days/);
});

test("a lapsed licence escalates to critical in place", () => {
  const gone = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  run(`UPDATE practitioner_licences SET expires_on = ? WHERE user_id = ?`, gone, clinicianId);
  N.sweep(facilityId);
  const matching = all<{ id: number }>(
    `SELECT id FROM notifications WHERE kind = 'licence_expiry' AND entity_id = ?`,
    String(clinicianId),
  );
  assert.equal(matching.length, 1, "one row that escalated, not two rows telling the same story");
  const n = N.inbox(facilityId).find((x) => x.kind === "licence_expiry")!;
  assert.equal(n.severity, "critical");
  assert.match(n.body, /prescribing/i);

  // Put it back so the rest of the suite has a licensed clinician.
  const restored = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
  run(`UPDATE practitioner_licences SET expires_on = ? WHERE user_id = ?`, restored, clinicianId);
});

test("outstanding dead letters are somebody's job", () => {
  run(
    `INSERT INTO integration_dead_letters (endpoint, operation, request, last_error, attempts, queued_at)
     VALUES ('SHA', 'submitClaim', '{}', 'timeout', 3, ?)`,
    new Date().toISOString(),
  );
  const result = N.sweep(facilityId);
  assert.ok(result.deadLetters >= 1);
  assert.ok(N.inbox(facilityId, "administrator").some((n) => n.kind === "dead_letters"));
});

// ============================================================= M06 documents

const FILE = Buffer.from("MALARIA RDT: POSITIVE. Hb 11.2 g/dL.\n");

test("a document is stored with its digest and can be read back intact", () => {
  const mrn = P.registerPatient({
    facilityId, deviceCode: DEV, givenName: "Doc", familyName: "Subject", sex: "male",
    nationalId: "44550012", byUserId: receptionistId, byUserName: "Joseph Otieno",
  });

  const id = D.attach({
    facilityId, entity: "encounter", entityId: "ENC-DOC-1", patientMrn: mrn,
    kind: "lab_report", filename: "rdt.txt", contentType: "text/plain", content: FILE,
    deviceCode: DEV, byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru",
  });

  const back = D.read({ documentId: id, byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru" });
  assert.equal(back.intact, true);
  assert.equal(back.content.toString(), FILE.toString());
  assert.equal(back.document.size_bytes, FILE.length);
  assert.equal(back.document.kind, "lab_report");
});

test("a stored file whose bytes were tampered with reads back as not intact", () => {
  const id = D.attach({
    facilityId, entity: "encounter", entityId: "ENC-DOC-TAMPER",
    kind: "lab_report", filename: "x.txt", contentType: "text/plain", content: Buffer.from("original"),
    deviceCode: DEV, byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru",
  });
  run(`UPDATE documents SET content_b64 = ? WHERE id = ?`, Buffer.from("edited").toString("base64"), id);
  const back = D.read({ documentId: id, byUserId: adminId, byUserName: "admin", purpose: "audit" });
  assert.equal(back.intact, false, "the digest is what makes an edited file detectable");
});

test("reading a patient document is recorded as a disclosure", () => {
  const before = get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'document_read'`)!.n;
  const doc = D.attachments("encounter", "ENC-DOC-1")[0];
  D.read({ documentId: doc.id, byUserId: adminId, byUserName: "admin", purpose: "claim" });
  const after = get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'document_read'`)!.n;
  assert.equal(after, before + 1, "who looked at a patient's file is an ODPC question");
});

test("the same file attached twice to the same thing is one document", () => {
  const first = D.attach({
    facilityId, entity: "claim", entityId: "CLM-DEDUPE", kind: "lab_report",
    filename: "rdt.txt", contentType: "text/plain", content: FILE,
    deviceCode: DEV, byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru",
  });
  const second = D.attach({
    facilityId, entity: "claim", entityId: "CLM-DEDUPE", kind: "lab_report",
    filename: "rdt-copy.txt", contentType: "text/plain", content: FILE,
    deviceCode: DEV, byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru",
  });
  assert.equal(first, second);
  assert.equal(D.attachments("claim", "CLM-DEDUPE").length, 1);
});

test("an empty file, an oversized file and a video are all refused", () => {
  const base = {
    facilityId, entity: "encounter", entityId: "ENC-DOC-1", kind: "lab_report",
    filename: "f", contentType: "text/plain", deviceCode: DEV,
    byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru",
  };
  assert.throws(() => D.attach({ ...base, content: Buffer.alloc(0) }), /empty/);
  assert.throws(() => D.attach({ ...base, content: Buffer.alloc(D.MAX_BYTES + 1, 0x41) }), /limit is 8 MB/);
  assert.throws(
    () => D.attach({ ...base, contentType: "video/mp4", content: Buffer.from("x") }),
    /cannot be attached/,
  );
});

test("a removed document is marked, not deleted, and the reason is required", () => {
  const id = D.attach({
    facilityId, entity: "encounter", entityId: "ENC-DOC-RM", kind: "referral",
    filename: "wrong.txt", contentType: "text/plain", content: Buffer.from("wrong patient"),
    deviceCode: DEV, byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
  assert.throws(() => D.removeDocument({ documentId: id, reason: "  ", byUserId: adminId, byUserName: "admin" }), /record why/);

  D.removeDocument({ documentId: id, reason: "Attached to the wrong patient", byUserId: adminId, byUserName: "admin" });
  assert.equal(D.attachments("encounter", "ENC-DOC-RM").length, 0);
  assert.ok(get<{ id: string }>(`SELECT id FROM documents WHERE id = ?`, id), "the row is still there — it was part of the record");
  assert.throws(() => D.removeDocument({ documentId: id, reason: "again", byUserId: adminId, byUserName: "admin" }), /already been removed/);
});

test("a signature carries the licence as it stood at the moment of signing", () => {
  const text = "Discharged, improving. Continue AL to completion.";
  D.sign({
    entity: "encounter", entityId: "ENC-SIG-1", purpose: "discharge_summary",
    content: text, byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru",
  });
  const sig = D.signedFor("encounter", "ENC-SIG-1", "discharge_summary")!;
  assert.equal(sig.signer_name, "Dr. Achieng Wanjiru");
  assert.equal(sig.licence_regulator, "KMPDC");
  assert.ok(sig.licence_number);
});

test("editing what was signed invalidates the signature", () => {
  const text = "Discharged, improving. Continue AL to completion.";
  const ok = D.verifySignature({ entity: "encounter", entityId: "ENC-SIG-1", purpose: "discharge_summary", content: text });
  assert.equal(ok.signed, true);
  assert.equal(ok.stillValid, true);

  const amended = text + " Review in one week.";
  const after = D.verifySignature({ entity: "encounter", entityId: "ENC-SIG-1", purpose: "discharge_summary", content: amended });
  assert.equal(after.signed, true);
  assert.equal(after.stillValid, false, "a signature must not cover text written after it");
});

test("nothing signed is honestly reported as nothing signed", () => {
  const v = D.verifySignature({ entity: "encounter", entityId: "ENC-NEVER", purpose: "discharge_summary", content: "x" });
  assert.equal(v.signed, false);
  assert.equal(v.stillValid, false);
});

test("storage used counts live documents only", () => {
  const used = D.storageUsed(facilityId);
  assert.ok(used.documents > 0);
  assert.ok(used.bytes > 0);
  const removed = get<{ n: number }>(`SELECT COUNT(*) AS n FROM documents WHERE removed_at IS NOT NULL`)!.n;
  assert.ok(removed > 0);
  assert.equal(
    used.documents,
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM documents WHERE removed_at IS NULL`)!.n,
  );
});

// ===================================================================== audit

test("the audit chain is still intact after all of that", () => {
  const v = verifyAuditChain();
  assert.equal(v.ok, true, v.ok ? "" : `broken at entry ${v.ok ? "" : v.failedAtId}`);
});
