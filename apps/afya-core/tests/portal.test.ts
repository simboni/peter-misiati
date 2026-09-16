/**
 * M73 Patient Portal.
 *
 * The tests that matter are about what does not reach a phone: a result no
 * clinician has looked at, a panic value at 9pm, an HIV result, and a
 * teenager's record going to their mother.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-portal-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const T = await import("../src/lib/portal.ts");
const P = await import("../src/lib/patients.ts");
const E = await import("../src/lib/encounters.ts");
const O = await import("../src/lib/orders.ts");
const L = await import("../src/lib/laboratory.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, all, today } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId, labTechId } = seedDemo();
registerDevice({ facilityId, code: "POR1", label: "Reception", byUserId: adminId, byUserName: "admin" });

const DEV = "POR1";
const BY = { byUserId: receptionistId!, byUserName: "Joseph Otieno" };
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let nid = 70_000_000;
function aPatient(dateOfBirth = "1990-05-04", phone?: string) {
  nid++;
  return P.registerPatient({
    facilityId, deviceCode: DEV, givenName: "Portal", familyName: `Person${nid}`,
    sex: "female", dateOfBirth, phone: phone ?? `07${String(nid).slice(-8)}`,
    nationalId: String(nid), ...BY,
  });
}

/** A released result, with or without the clinician having looked at it. */
function result(mrn: string, analyte: string, value: number, acknowledged: boolean, service = "LAB-CBC") {
  // One open encounter at a time is the system's own rule, so a patient with
  // several results has them on the one consultation, as they would.
  const enc =
    E.openEncounterFor(mrn)?.id ??
    E.openEncounter({
      facilityId, patientMrn: mrn, kind: "outpatient",
      clinicianId: clinicianId!, clinicianName: "Dr. Achieng Wanjiru", deviceCode: DEV,
    });
  const order = O.placeOrder({
    encounterId: enc, kind: "lab", serviceCode: service, payerCode: "CASH",
    clinicalQuestion: "Routine", deviceCode: DEV,
    ordererId: clinicianId!, ordererName: "Dr. Achieng Wanjiru",
  });
  L.collectSpecimen({
    orderId: order, kind: "EDTA whole blood",
    collectorId: labTechId!, collectorName: "Samuel Mutiso", deviceCode: DEV,
  });
  L.enterResult({
    orderId: order, analyte, value, enteredBy: labTechId!,
    enteredByName: "Samuel Mutiso", deviceCode: DEV,
  });
  L.releaseResults({ orderId: order, releaserId: labTechId!, releaserName: "Samuel Mutiso", deviceCode: DEV });
  if (acknowledged) {
    O.acknowledgeResult({
      orderId: order, byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru",
      action: "Seen and filed",
    });
  }
  return order;
}

// --------------------------------------------------------------- enrolment

test("a patient with no phone cannot be enrolled in a portal reached by phone", () => {
  const mrn = P.registerPatient({
    facilityId, deviceCode: DEV, givenName: "No", familyName: "Phone", sex: "male",
    dateOfBirth: "1980-01-01", nationalId: String(++nid), ...BY,
  });
  assert.throws(() => T.enrol({ patientMrn: mrn, ...BY }), /no phone number on file/);
});

test("enrolling uses the number the clinic already holds", () => {
  const mrn = aPatient("1990-05-04", "0722123456");
  T.enrol({ patientMrn: mrn, ...BY });
  assert.equal(T.accountFor(mrn)!.phone, "254722123456");
  assert.equal(T.accountFor(mrn)!.status, "active");
});

test("revoking kills any code already in flight", () => {
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  T.sendCode({ patientMrn: mrn });

  T.revoke({ patientMrn: mrn, reason: "Patient asked to stop", ...BY });
  assert.equal(T.accountFor(mrn)!.status, "revoked");
  assert.throws(() => T.sendCode({ patientMrn: mrn }), /revoked/);
});

test("revoking records why", () => {
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  assert.throws(() => T.revoke({ patientMrn: mrn, reason: " ", ...BY }), /records why/);
});

// -------------------------------------------------------------------- codes

test("a code is never stored in the clear", () => {
  // A table of live codes opens every record in the clinic if it is copied.
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  const sent = T.sendCode({ patientMrn: mrn });

  const rows = all<{ code_hash: string }>(`SELECT code_hash FROM portal_codes WHERE patient_mrn = ?`, mrn);
  assert.match(rows[0].code_hash, /^[0-9a-f]{64}$/);
  assert.ok(!rows.some((r) => r.code_hash === sent.code));
});

test("a code goes to the number on the record and nowhere else", () => {
  const mrn = aPatient("1990-05-04", "0733999888");
  T.enrol({ patientMrn: mrn, ...BY });
  assert.equal(T.sendCode({ patientMrn: mrn }).sentTo, "254733999888");
});

test("the right code works once", () => {
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  const sent = T.sendCode({ patientMrn: mrn });

  assert.equal(T.checkCode({ patientMrn: mrn, code: sent.code! }).ok, true);
  assert.equal(T.accountFor(mrn)!.last_seen_at !== null, true);

  const again = T.checkCode({ patientMrn: mrn, code: sent.code! });
  assert.equal(again.ok, false);
  assert.match(again.why!, /already been used/);
});

test("three wrong tries kill the code", () => {
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  T.sendCode({ patientMrn: mrn });

  for (let n = 0; n < T.MAX_ATTEMPTS; n++) {
    assert.equal(T.checkCode({ patientMrn: mrn, code: "000000" }).ok, false);
  }
  const dead = T.checkCode({ patientMrn: mrn, code: "000000" });
  assert.match(dead.why!, /too many wrong tries/);
});

test("asking for a second code retires the first", () => {
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  const first = T.sendCode({ patientMrn: mrn });
  const second = T.sendCode({ patientMrn: mrn });

  assert.equal(T.checkCode({ patientMrn: mrn, code: first.code! }).ok, false);
  assert.equal(T.checkCode({ patientMrn: mrn, code: second.code! }).ok, true);
});

test("the code is only handed back while the gateway is simulated", () => {
  // A live gateway never returns it. This is the one affordance that makes a
  // demonstration possible without a phone.
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  const sent = T.sendCode({ patientMrn: mrn });
  assert.equal(sent.simulated, true);
  assert.match(sent.code!, /^\d{6}$/);
});

// ------------------------------------------------------------ what is shown

test("a result no clinician has looked at does not reach a phone", () => {
  // A panic potassium arriving at 9pm with nobody to ask is not transparency.
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  result(mrn, "HB", 12.4, false);

  const view = T.viewFor({ patientMrn: mrn });
  assert.equal(view.results.length, 0);
  assert.equal(view.withheld.length, 0, "not withheld — simply not there yet");
});

test("once the clinician has acknowledged it, it shows", () => {
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  result(mrn, "HB", 12.4, true);

  const view = T.viewFor({ patientMrn: mrn });
  assert.equal(view.results.length, 1);
  assert.equal(view.results[0].analyte, "HB");
});

test("a panic value is listed but not printed", () => {
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  result(mrn, "K", 2.1, true);

  const view = T.viewFor({ patientMrn: mrn });
  assert.equal(view.results.length, 0);
  assert.equal(view.withheld.length, 1);
  assert.match(view.withheld[0].why, /contacting you/);
});

test("an HIV result is never in a message, to anybody", () => {
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  result(mrn, "HIV", 0, true);

  const own = T.viewFor({ patientMrn: mrn });
  assert.equal(own.results.length, 0);
  assert.match(own.withheld[0].why, /go through this one with you/);

  const proxy = T.viewFor({ patientMrn: mrn, byProxy: { name: "A Relative", relationship: "mother" } });
  assert.equal(proxy.results.length, 0);
  assert.match(proxy.withheld[0].why, /only discussed with the patient/);
});

test("the patient is always told that something exists", () => {
  // Hiding that a result exists would be its own harm.
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  result(mrn, "HIV", 0, true);
  assert.equal(T.viewFor({ patientMrn: mrn }).withheld.length, 1);
});

// ------------------------------------------------------------------ proxies

test("a proxy for an adult needs that adult to have agreed", () => {
  const mrn = aPatient("1985-03-01");
  assert.throws(
    () => T.grantProxy({
      patientMrn: mrn, proxyName: "A Son", proxyPhone: "0711000111",
      relationship: "son", untilDate: inDays(90), ...BY,
    }),
    /speaks for themselves/,
  );

  const id = T.grantProxy({
    patientMrn: mrn, proxyName: "A Son", proxyPhone: "0711000111",
    relationship: "son", untilDate: inDays(90), patientConsented: true, ...BY,
  });
  assert.ok(id > 0);
});

test("a proxy for a small child needs no such thing", () => {
  const mrn = aPatient(inDays(-3 * 365));
  const id = T.grantProxy({
    patientMrn: mrn, proxyName: "Her Mother", proxyPhone: "0711000222",
    relationship: "mother", untilDate: inDays(365), ...BY,
  });
  assert.equal(T.proxiesFor(mrn).length, 1);
  assert.ok(id > 0);
});

test("a teenager's results are not their parent's to read", () => {
  // A girl who cannot get tested without her mother reading the result does
  // not get tested.
  const mrn = aPatient(inDays(-15 * 365));
  T.enrol({ patientMrn: mrn, ...BY });
  result(mrn, "HB", 11.8, true);

  assert.equal(T.viewFor({ patientMrn: mrn }).results.length, 1, "she sees her own");

  const proxy = T.viewFor({ patientMrn: mrn, byProxy: { name: "Her Mother", relationship: "mother" } });
  assert.equal(proxy.results.length, 0);
  assert.match(proxy.withheld[0].why, /only shown to the patient themselves/);
});

test("a proxy grant is time-limited and revocable", () => {
  const mrn = aPatient(inDays(-4 * 365));
  assert.throws(
    () => T.grantProxy({
      patientMrn: mrn, proxyName: "X", proxyPhone: "0711000333",
      relationship: "father", untilDate: today(), ...BY,
    }),
    /already expired/,
  );

  const id = T.grantProxy({
    patientMrn: mrn, proxyName: "His Father", proxyPhone: "0711000333",
    relationship: "father", untilDate: inDays(30), ...BY,
  });
  T.revokeProxy({ proxyId: id, reason: "Parents separated; father no longer has custody", ...BY });
  assert.equal(T.proxiesFor(mrn).length, 0);
});

test("a proxy needs a phone a code can be sent to", () => {
  const mrn = aPatient(inDays(-4 * 365));
  assert.throws(
    () => T.grantProxy({
      patientMrn: mrn, proxyName: "X", proxyPhone: "not a phone",
      relationship: "aunt", untilDate: inDays(30), ...BY,
    }),
    /phone number/,
  );
});

// ----------------------------------------------------------------- messages

test("the message fits two SMS segments", () => {
  // A message that runs to five segments costs five times as much and gets
  // read as often as one.
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  for (const analyte of ["HB", "WBC", "PLT", "NA", "K"]) result(mrn, analyte, 5, true);

  const body = T.asMessage(T.viewFor({ patientMrn: mrn, record: false }));
  assert.ok(body.length <= 320, `${body.length} characters`);
  assert.match(body, /^Hello /);
});

test("a patient with nothing new is told that, not sent an empty message", () => {
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  assert.match(T.asMessage(T.viewFor({ patientMrn: mrn, record: false })), /Nothing new/);
});

test("Kiswahili is a whole message, not a translated fragment", () => {
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, language: "sw", ...BY });
  result(mrn, "HB", 12.1, true);

  const body = T.asMessage(T.viewFor({ patientMrn: mrn, record: false }), "sw");
  assert.match(body, /^Habari /);
  assert.match(body, /Majibu/);
});

test("the message body never reaches the audit log", () => {
  // It carries clinical content, and the log is read by people with no
  // business seeing it.
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  result(mrn, "HB", 9.9, true);
  const sent = T.sendSummary({ patientMrn: mrn, ...BY });

  const entries = all<{ detail: string }>(
    `SELECT detail FROM audit_log WHERE entity_id = ? AND action = 'portal_summary_sent'`,
    mrn,
  );
  assert.equal(entries.length, 1);
  assert.ok(!entries[0].detail.includes("9.9"));
  assert.ok(sent.body.length > 0);
});

// ------------------------------------------------------------------ reports

test("a patient can be shown what was looked at on their record", () => {
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  T.viewFor({ patientMrn: mrn });
  T.viewFor({ patientMrn: mrn, byProxy: { name: "A Relative", relationship: "sister" } });

  const history = T.viewHistory(mrn);
  assert.equal(history.length, 2);
  assert.equal(history[0].by_proxy, 1);
  assert.equal(history[0].proxy_name, "A Relative");
});

test("a read by a patient is logged with its own purpose, not as treatment", () => {
  const mrn = aPatient();
  T.enrol({ patientMrn: mrn, ...BY });
  T.viewFor({ patientMrn: mrn });

  const entries = all<{ purpose: string }>(
    `SELECT purpose FROM audit_log WHERE entity_id = ? AND action = 'portal_viewed'`,
    mrn,
  );
  assert.ok(entries.every((e) => e.purpose === "patient_access"));
});

test("the summary says the gateway is not live, because nothing is actually sent", () => {
  const summary = T.portalSummary(facilityId);
  assert.equal(summary.gatewayLive, false);
  assert.ok(summary.enrolled > 0);
  assert.ok(summary.revoked >= 1);
  assert.ok(summary.proxies >= 1);
  assert.ok(summary.viewsThisMonth > 0);
  assert.ok(summary.withheldThisMonth > 0);
});

test("the audit chain still verifies after all of that", () => {
  assert.equal(verifyAuditChain().ok, true);
});
