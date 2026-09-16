/**
 * M64 Mortuary.
 *
 * Almost nothing else in this system is irreversible. A body released to the
 * wrong family is buried, so the tests that matter here are the ones about
 * refusing: an unconfirmed identity, a police case without an authority, a
 * postmortem that can never be done afterwards.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-mortuary-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const M = await import("../src/lib/mortuary.ts");
const P = await import("../src/lib/patients.ts");
const N = await import("../src/lib/notifications.ts");
const L = await import("../src/lib/accounting.ts");
const E = await import("../src/lib/encounters.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId } = seedDemo();
registerDevice({ facilityId, code: "MOR1", label: "Mortuary", byUserId: adminId, byUserName: "admin" });

const DEV = "MOR1";
const BY = { byUserId: adminId!, byUserName: "Facility Administrator" };
const MAKE = { ...BY, deviceCode: DEV };

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

M.seedMortuary(facilityId);

let no = 0;
/** A body received from outside, provisionally named. */
function bringIn(extra: Partial<Parameters<typeof M.receiveBody>[0]> = {}) {
  no++;
  return M.receiveBody({
    facilityId,
    givenName: "John",
    familyName: `Mwangi ${no}`,
    sex: "male",
    source: "brought_in",
    ...MAKE,
    ...extra,
  });
}

/** Take a body all the way to confirmed, which is what release stands behind. */
function identify(bodyId: string, name = "Mary Mwangi") {
  M.recordViewing({
    bodyId,
    personName: name,
    personId: "12345678",
    relationship: "sister",
    identified: true,
    ...BY,
  });
}

// ----------------------------------------------------------------- receive

test("a body gets a tag, and the tag is what it is known by", () => {
  const { tagNo } = bringIn();
  assert.match(tagNo, /^\d{4}\/\d{4}$/);
  assert.ok(M.bodyByTag(facilityId, tagNo));
});

test("two bodies with the same name are two different tags", () => {
  // The whole reason a tag exists. Two men called John Mwangi on the same
  // night is not a hypothetical.
  const first = M.receiveBody({ facilityId, givenName: "John", familyName: "Mwangi", source: "brought_in", ...MAKE });
  const second = M.receiveBody({ facilityId, givenName: "John", familyName: "Mwangi", source: "brought_in", ...MAKE });
  assert.notEqual(first.tagNo, second.tagNo);
});

test("an unknown body is received, not refused — otherwise it is recorded nowhere at all", () => {
  const { bodyId } = M.receiveBody({ facilityId, source: "brought_in", ...MAKE });
  assert.equal(M.getBody(bodyId)!.identity, "unknown");

  const alerts = N.inbox(facilityId).filter((n) => n.kind === "body_unidentified" && n.entity_id === bodyId);
  assert.equal(alerts.length, 1);
});

test("a medico-legal body must carry the OB number it came in under", () => {
  assert.throws(
    () => M.receiveBody({ facilityId, source: "brought_in", medicoLegal: true, ...MAKE }),
    /OB number/,
  );
});

test("a police case is always for examination, whatever the form said", () => {
  const { bodyId } = M.receiveBody({
    facilityId, source: "brought_in", medicoLegal: true, policeObNo: "OB/14/2026",
    postmortemRequired: false, ...MAKE,
  });
  assert.equal(M.getBody(bodyId)!.postmortem_required, 1);
});

test("a bay holds one body, and a full cold room is refused", () => {
  M.defineUnit({ facilityId, code: "MORT-C", name: "Small chiller", bays: 1 });
  M.receiveBody({ facilityId, givenName: "A", familyName: "One", source: "brought_in", unitCode: "MORT-C", ...MAKE });
  assert.throws(
    () => M.receiveBody({ facilityId, givenName: "B", familyName: "Two", source: "brought_in", unitCode: "MORT-C", ...MAKE }),
    /full/,
  );
  assert.equal(M.occupancy(facilityId).find((u) => u.code === "MORT-C")!.free, 0);
});

test("receiving a patient's body is what marks them deceased", () => {
  // The only place in this system that sets that flag — and until it runs,
  // nothing stops a clinician opening an encounter next week.
  const mrn = P.registerPatient({
    facilityId, givenName: "Peter", familyName: "Kamau", sex: "male", dateOfBirth: "1960-04-02",
    deviceCode: DEV, ...BY,
  });
  M.receiveBody({ facilityId, patientMrn: mrn, source: "ward", diedAt: hoursAgo(3), ...MAKE });

  const patient = P.resolvePatient(mrn)!;
  assert.equal(patient.deceased, 1);
  assert.throws(
    () => E.openEncounter({ facilityId, patientMrn: mrn, clinicianId: clinicianId!, clinicianName: "Dr. Achieng Wanjiru", kind: "outpatient", deviceCode: DEV }),
    /deceased/,
  );
});

// ---------------------------------------------------------- identification

test("an identification records who made it, on what document, and how they knew them", () => {
  const { bodyId } = bringIn();
  assert.throws(
    () => M.recordViewing({ bodyId, personName: "Mary", personId: "", relationship: "sister", identified: true, ...BY }),
    /identity document/,
  );
  assert.throws(
    () => M.recordViewing({ bodyId, personName: "Mary", personId: "123", relationship: "", identified: true, ...BY }),
    /how they knew/,
  );

  identify(bodyId);
  assert.equal(M.getBody(bodyId)!.identity, "confirmed");
  const event = M.eventsFor(bodyId).find((e) => e.kind === "identified")!;
  assert.equal(event.person_id, "12345678");
  assert.equal(event.relationship, "sister");
});

test("a viewing that identified nobody is still recorded", () => {
  const { bodyId } = M.receiveBody({ facilityId, source: "brought_in", ...MAKE });
  M.recordViewing({
    bodyId, personName: "Joseph Otieno", personId: "", relationship: "",
    identified: false, note: "Not his brother", ...BY,
  });
  assert.equal(M.getBody(bodyId)!.identity, "unknown");
  assert.equal(M.eventsFor(bodyId).filter((e) => e.kind === "viewed").length, 1);
});

test("an unknown body can be named at the viewing", () => {
  const { bodyId } = M.receiveBody({ facilityId, source: "brought_in", ...MAKE });
  M.recordViewing({
    bodyId, personName: "Agnes Wairimu", personId: "22334455", relationship: "mother",
    identified: true, givenName: "Daniel", familyName: "Kariuki", ...BY,
  });
  const body = M.getBody(bodyId)!;
  assert.equal(body.identity, "confirmed");
  assert.equal(body.family_name, "Kariuki");
});

// -------------------------------------------------------------- release

test("a body with a provisional identity is not released", () => {
  const { bodyId } = bringIn();
  M.recordNotification({ bodyId, reference: "DN/2026/001", ...BY });

  assert.throws(
    () => M.release({ bodyId, toName: "Mary Mwangi", toIdNumber: "12345678", relationship: "sister", ...BY }),
    /provisional/,
  );
});

test("a body nobody has identified is not released, whoever asks", () => {
  const { bodyId } = M.receiveBody({ facilityId, source: "brought_in", ...MAKE });
  M.recordNotification({ bodyId, reference: "DN/2026/002", ...BY });
  assert.throws(
    () => M.release({ bodyId, toName: "Someone", toIdNumber: "999", relationship: "cousin", ...BY }),
    /nobody has identified/,
  );
});

test("a police case is not released without a written authority", () => {
  const { bodyId } = M.receiveBody({
    facilityId, givenName: "Samuel", familyName: "Ochieng", source: "brought_in",
    medicoLegal: true, policeObNo: "OB/22/2026", investigatingOfficer: "Cpl. Wafula", ...MAKE,
  });
  identify(bodyId, "Beatrice Ochieng");
  M.recordPostmortem({
    bodyId, pathologist: "Dr. N. Njoroge", findings: "Blunt force head injury",
    causeOfDeath: "Head injury", ...BY,
  });
  M.recordNotification({ bodyId, reference: "DN/2026/003", ...BY });

  assert.throws(
    () => M.release({ bodyId, toName: "Beatrice Ochieng", toIdNumber: "12345678", relationship: "wife", ...BY }),
    /release authority is required/,
  );

  // A refused attempt leaves no trace of an authority on a body still in store.
  assert.equal(M.getBody(bodyId)!.release_authority, "");

  const out = M.release({
    bodyId, toName: "Beatrice Ochieng", toIdNumber: "12345678", relationship: "wife",
    authority: "Release order, Cpl. Wafula, Buruburu Police Station", ...BY,
  });
  const after = M.getBody(bodyId)!;
  assert.equal(after.status, "released");
  assert.match(after.release_authority, /Cpl. Wafula/);
  assert.equal(out.days, 0);
});

test("a required postmortem happens before burial, because it cannot happen after", () => {
  const { bodyId } = M.receiveBody({
    facilityId, givenName: "Grace", familyName: "Atieno", source: "brought_in",
    postmortemRequired: true, ...MAKE,
  });
  identify(bodyId, "Paul Atieno");
  M.recordNotification({ bodyId, reference: "DN/2026/004", ...BY });

  assert.throws(
    () => M.release({ bodyId, toName: "Paul Atieno", toIdNumber: "12345678", relationship: "brother", ...BY }),
    /cannot be done after burial/,
  );

  M.recordPostmortem({
    bodyId, pathologist: "Dr. N. Njoroge", findings: "Pulmonary embolism",
    causeOfDeath: "Pulmonary embolism", causeCode: "BA00", ...BY,
  });
  M.release({ bodyId, toName: "Paul Atieno", toIdNumber: "12345678", relationship: "brother", ...BY });
  assert.equal(M.getBody(bodyId)!.status, "released");
});

test("waiving a postmortem names who authorised it and why", () => {
  const { bodyId } = M.receiveBody({
    facilityId, givenName: "Esther", familyName: "Nduta", source: "ward",
    postmortemRequired: true, ...MAKE,
  });
  assert.throws(() => M.waivePostmortem({ bodyId, authority: "", reason: "expected death", ...BY }), /who authorised/);
  assert.throws(() => M.waivePostmortem({ bodyId, authority: "Dr. Wanjiru", reason: "", ...BY }), /why/);

  M.waivePostmortem({
    bodyId, authority: "Dr. Achieng Wanjiru", reason: "Expected death from a documented illness", ...BY,
  });
  assert.equal(M.getBody(bodyId)!.postmortem_required, 0);
  assert.equal(M.eventsFor(bodyId).filter((e) => e.kind === "postmortem_waived").length, 1);
});

test("a missing death notification escalates rather than blocking, and is never silent", () => {
  // The one requirement here that is administrative rather than irreversible.
  // A family kept from burying their dead over a reference number is a family
  // the facility has failed.
  const { bodyId } = bringIn();
  identify(bodyId);

  assert.throws(
    () => M.release({ bodyId, toName: "Mary Mwangi", toIdNumber: "12345678", relationship: "sister", ...BY }),
    /written reason/,
  );

  M.release({
    bodyId, toName: "Mary Mwangi", toIdNumber: "12345678", relationship: "sister",
    override: "Registrar's office closed for the holiday; chief's letter produced instead", ...BY,
  });

  const body = M.getBody(bodyId)!;
  assert.equal(body.status, "released");
  assert.match(body.release_override, /chief's letter/);
  assert.ok(
    N.inbox(facilityId).some((n) => n.kind === "release_without_notification" && n.entity_id === bodyId),
  );
});

test("a release records who took the body, on what document, and how they were related", () => {
  const { bodyId } = bringIn();
  identify(bodyId);
  M.recordNotification({ bodyId, reference: "DN/2026/005", ...BY });

  const base = { bodyId, toName: "Mary Mwangi", toIdNumber: "12345678", relationship: "sister", ...BY };
  assert.throws(() => M.release({ ...base, toName: " " }), /who took the body/);
  assert.throws(() => M.release({ ...base, toIdNumber: " " }), /identity document/);
  assert.throws(() => M.release({ ...base, relationship: " " }), /relationship/);

  M.release(base);
  const event = M.eventsFor(bodyId).find((e) => e.kind === "released")!;
  assert.equal(event.person_id, "12345678");
});

test("a body is released once", () => {
  const { bodyId } = bringIn();
  identify(bodyId);
  M.recordNotification({ bodyId, reference: "DN/2026/006", ...BY });
  M.release({ bodyId, toName: "Mary Mwangi", toIdNumber: "12345678", relationship: "sister", ...BY });

  assert.throws(
    () => M.release({ bodyId, toName: "Someone else", toIdNumber: "999", relationship: "cousin", ...BY }),
    /already released/,
  );
});

// -------------------------------------------------------------------- fees

test("storage is free for the first days and charged by the day after", () => {
  const { bodyId } = bringIn({ receivedAt: daysAgo(5) });
  const body = M.getBody(bodyId)!;
  const fee = M.storageFee(body);

  assert.equal(fee.days, 5);
  assert.equal(fee.chargeableDays, 5 - M.freeDays());
  assert.equal(fee.feeCents, (5 - M.freeDays()) * M.dailyFeeCents());
});

test("a stay inside the free period costs nothing", () => {
  const { bodyId } = bringIn({ receivedAt: daysAgo(1) });
  assert.equal(M.storageFee(M.getBody(bodyId)!).feeCents, 0);
});

test("the fee taken reaches the ledger, and a waiver says why", () => {
  const { bodyId } = bringIn({ receivedAt: daysAgo(6) });
  identify(bodyId);
  M.recordNotification({ bodyId, reference: "DN/2026/007", ...BY });

  assert.throws(
    () => M.release({
      bodyId, toName: "Mary Mwangi", toIdNumber: "12345678", relationship: "sister",
      waivedCents: 100_00, ...BY,
    }),
    /records why/,
  );

  const owed = M.storageFee(M.getBody(bodyId)!).feeCents;
  M.release({
    bodyId, toName: "Mary Mwangi", toIdNumber: "12345678", relationship: "sister",
    waivedCents: 100_00, waiverReason: "Family destitute; approved by the administrator", ...BY,
  });

  const body = M.getBody(bodyId)!;
  assert.equal(body.fee_cents, owed);
  assert.equal(body.waived_cents, 100_00);
  assert.equal(body.paid_cents, owed - 100_00);

  const journal = L.journalsIn(facilityId).find((j) => j.source_kind === "mortuary_fee" && j.source_ref === bodyId);
  assert.ok(journal, "money taken is money in the ledger");
  const lines = L.journalLines(journal!.id);
  assert.equal(lines.reduce((s, l) => s + l.debit_cents, 0), owed - 100_00);
  assert.equal(lines.reduce((s, l) => s + l.debit_cents - l.credit_cents, 0), 0);
});

test("more cannot be waived than is owed", () => {
  const { bodyId } = bringIn({ receivedAt: daysAgo(3) });
  identify(bodyId);
  M.recordNotification({ bodyId, reference: "DN/2026/008", ...BY });
  assert.throws(
    () => M.release({
      bodyId, toName: "Mary Mwangi", toIdNumber: "12345678", relationship: "sister",
      waivedCents: 999_999_00, waiverReason: "everything", ...BY,
    }),
    /more cannot be waived/,
  );
});

// ---------------------------------------------------------------- reports

test("bodies nobody has come for are listed longest first", () => {
  bringIn({ receivedAt: daysAgo(40) });
  bringIn({ receivedAt: daysAgo(25) });

  const rows = M.unclaimed(facilityId);
  assert.ok(rows.length >= 2);
  assert.ok(rows[0].days >= rows[1].days);
  assert.ok(rows[0].days >= M.unclaimedDays());
});

test("the register says what is holding each body up", () => {
  const rows = M.register(facilityId);
  assert.ok(rows.length > 0);
  assert.ok(rows.some((r) => r.check.blockers.length > 0), "something in store is not releasable");
  assert.ok(rows.every((r) => r.body.status === "in_store"));
});

test("the summary counts what somebody has to act on", () => {
  const summary = M.mortuarySummary(facilityId);
  assert.ok(summary.inStore > 0);
  assert.ok(summary.unidentified >= 1);
  assert.ok(summary.medicoLegal >= 0);
  assert.ok(summary.releasedWithoutNotification >= 1);
  assert.ok(summary.bays >= 7);
  assert.ok(summary.accruedFeeCents > 0);
});

test("the audit chain still verifies after all of that", () => {
  assert.equal(verifyAuditChain().ok, true);
});
