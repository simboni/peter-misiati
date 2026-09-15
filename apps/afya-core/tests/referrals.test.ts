/**
 * M29 Referrals.
 *
 * The rules this module exists to hold: nobody travels towards a hospital that
 * has not said it can take them, a referral upwards has to say what was already
 * tried, and a referral that left and never came back stays on a list rather
 * than quietly disappearing.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-ref-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const R = await import("../src/lib/referrals.ts");
const P = await import("../src/lib/patients.ts");
const N = await import("../src/lib/notifications.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice, getFacility } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "REF1", label: "Referral desk", byUserId: adminId, byUserName: "admin" });
R.seedReferralDirectory();

const DEV = "REF1";
const BY = { byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru", deviceCode: DEV };
const ACT = { byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru" };

let nid = 64_000_000;
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function newPatient(given: string): string {
  return P.registerPatient({
    facilityId, deviceCode: DEV, givenName: given, familyName: "Referred", sex: "male",
    nationalId: String(++nid), byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
}

/** A referral up to Kenyatta, which is the common case. */
function refer(given: string, over: Partial<Parameters<typeof R.raiseReferral>[0]> = {}) {
  return R.raiseReferral({
    facilityId, patientMrn: newPatient(given),
    counterpartCode: "KNH-001", urgency: "urgent",
    reason: "Needs a CT and a neurosurgical opinion",
    treatmentGiven: "IV fluids, analgesia, cervical collar",
    serviceNeeded: "Neurosurgery",
    ...BY, ...over,
  });
}

// ================================================================ the directory

test("the directory is a list, not free text — a typed destination cannot be telephoned", () => {
  const all = R.referralDirectory();
  assert.ok(all.length >= 8);
  assert.equal(all[0].level, 6, "highest level first — that is the order somebody scans them in");
  assert.equal(R.getReferralFacility("knh-001")!.name, "Kenyatta National Hospital", "case does not matter");
});

test("a facility level outside 2 to 6 is refused", () => {
  assert.throws(
    () => R.defineReferralFacility({ kmhflCode: "BAD-01", name: "Nowhere", level: 7 }),
    /runs from 2 .* to 6/,
  );
});

// =================================================================== raising

test("a referral must say why", () => {
  assert.throws(
    () => R.raiseReferral({ facilityId, patientMrn: newPatient("Reasonless"), counterpartCode: "KNH-001", urgency: "routine", reason: "  ", ...BY }),
    /must say why/,
  );
});

test("a referral needs a destination that exists, or a name", () => {
  assert.throws(
    () => R.raiseReferral({ facilityId, patientMrn: newPatient("Nowhere"), counterpartCode: "NOT-A-PLACE", urgency: "routine", reason: "x", ...BY }),
    /not in the referral directory/,
  );
  assert.throws(
    () => R.raiseReferral({ facilityId, patientMrn: newPatient("Undirected"), urgency: "routine", reason: "x", ...BY }),
    /needs a destination/,
  );
  // Somewhere genuinely not in the directory is allowed, by name.
  const id = R.raiseReferral({
    facilityId, patientMrn: newPatient("Private"), externalName: "Nairobi Hospital",
    urgency: "routine", reason: "Patient's own choice of provider", ...BY,
  });
  assert.equal(R.getReferral(id)!.external_name, "Nairobi Hospital");
});

test("a referral upwards must record what was already done here", () => {
  // This facility is level 2. Kenyatta is level 6.
  assert.equal(getFacility(facilityId)!.level, 2);
  assert.throws(
    () => R.raiseReferral({
      facilityId, patientMrn: newPatient("Untreated"), counterpartCode: "KNH-001",
      urgency: "urgent", reason: "Severe headache", ...BY,
    }),
    /what was already done here/,
    "a referral that cannot say what was tried is how a referral hospital ends up seeing everything",
  );
});

test("a referral sideways does not demand it — only one going up a level does", () => {
  // Kayole is level 2, the same as here. Nothing is being escalated, so there
  // is nothing to justify.
  const id = R.raiseReferral({
    facilityId, patientMrn: newPatient("Sideways"), counterpartCode: "KAYOLE-DISP-01",
    urgency: "routine", reason: "They have a working laboratory and we do not", ...BY,
  });
  assert.equal(R.getReferral(id)!.status, "raised");
});

test("the directory carries same-level neighbours, not only bigger hospitals", () => {
  // A directory of only referral hospitals quietly teaches everybody to refer
  // upwards, which is the behaviour the treatment-given rule exists to curb.
  assert.ok(R.referralDirectory().some((f) => f.level === 2));
});

test("an emergency referral out raises a critical alert saying nobody travels until they accept", () => {
  const id = refer("Emergencycase", { urgency: "emergency", reason: "Ruptured ectopic, needs theatre now" });
  const alert = N.inbox(facilityId, "clinician").find((n) => n.kind === "referral_emergency" && n.entity_id === id);
  assert.ok(alert);
  assert.equal(alert!.severity, "critical");
  assert.match(alert!.body, /Nobody travels until they accept/);
});

// ================================================================= the gate

test("a patient does not travel towards a hospital that has not accepted them", () => {
  const id = refer("Notaccepted");
  assert.throws(
    () => R.departReferral({ referralId: id, transport: "Facility ambulance", ...ACT }),
    /has not been accepted yet/,
    "the failure this prevents is a critically ill patient turned away at the gate",
  );
});

test("an acceptance records a name, not just a yes", () => {
  const id = refer("Anonymousyes");
  assert.throws(
    () => R.acceptReferral({ referralId: id, acceptedByName: "   ", ...ACT }),
    /a name, not just a yes/,
  );
  R.acceptReferral({ referralId: id, acceptedByName: "Dr. Owino, casualty registrar", ...ACT });
  assert.equal(R.getReferral(id)!.accepted_by_name, "Dr. Owino, casualty registrar");
});

test("accepted, departed, arrived, completed — the whole loop, with a timeline", () => {
  const id = refer("Fullloop", { raisedAt: daysAgo(3) });
  R.acceptReferral({ referralId: id, acceptedByName: "Dr. Owino", at: daysAgo(3), ...ACT });
  R.departReferral({ referralId: id, transport: "County ambulance KCB 411X", escort: "Nurse Chebet", at: daysAgo(3), ...ACT });
  R.confirmArrival({ referralId: id, at: daysAgo(3), ...ACT });
  R.recordOutcome({
    referralId: id, outcome: "treated_returned",
    note: "Craniotomy not needed. Conservative management, discharged day 2. Continue phenytoin 100mg tds, review here in one week.",
    outcomeByName: "Dr. Mwangi, KNH neurosurgery", ...ACT,
  });

  const r = R.getReferral(id)!;
  assert.equal(r.status, "completed");
  assert.equal(r.outcome, "treated_returned");
  assert.match(r.outcome_note, /Continue phenytoin/, "what this facility is asked to continue");

  const history = R.referralHistory(id).map((e) => e.to_status);
  assert.deepEqual(history, ["raised", "accepted", "departed", "arrived", "completed"]);
});

test("a declined referral says why, and tells the facility the patient is still here", () => {
  const id = refer("Turnedaway", { urgency: "emergency" });
  assert.throws(() => R.declineReferral({ referralId: id, reason: "  ", ...ACT }), /must say why/);

  R.declineReferral({ referralId: id, reason: "No ICU bed until Thursday", ...ACT });
  assert.equal(R.getReferral(id)!.status, "declined");

  const alert = N.inbox(facilityId, "clinician").find((n) => n.kind === "referral_declined" && n.entity_id === id);
  assert.ok(alert);
  assert.equal(alert!.severity, "critical", "an emergency decline is critical — the patient is still here");
  assert.match(alert!.body, /still needs somewhere to go/);
});

test("the state machine refuses a move that makes no sense", () => {
  const id = refer("Outoforder");
  assert.throws(() => R.confirmArrival({ referralId: id, ...ACT }), /cannot become arrived/);
  R.acceptReferral({ referralId: id, acceptedByName: "Dr. Owino", ...ACT });
  assert.throws(
    () => R.acceptReferral({ referralId: id, acceptedByName: "Dr. Owino again", ...ACT }),
    /cannot become accepted/,
  );
});

test("a finished referral is finished", () => {
  const id = refer("Done");
  R.acceptReferral({ referralId: id, acceptedByName: "Dr. Owino", ...ACT });
  R.departReferral({ referralId: id, ...ACT });
  R.recordOutcome({ referralId: id, outcome: "admitted_there", note: "Admitted to ward 7B", ...ACT });
  assert.throws(() => R.cancelReferral({ referralId: id, reason: "changed mind", ...ACT }), /it is finished/);
});

test("a counter-referral must say what happened and what to continue", () => {
  const id = refer("Emptyletter");
  R.acceptReferral({ referralId: id, acceptedByName: "Dr. Owino", ...ACT });
  R.departReferral({ referralId: id, ...ACT });
  assert.throws(
    () => R.recordOutcome({ referralId: id, outcome: "treated_returned", note: "   ", ...ACT }),
    /what this facility should continue/,
  );
});

test("cancelling records why, and what it was cancelled from", () => {
  const id = refer("Cancelled");
  R.cancelReferral({ referralId: id, reason: "Patient declined transfer and went home", ...ACT });
  const r = R.getReferral(id)!;
  assert.equal(r.status, "cancelled");
  assert.equal(r.cancel_reason, "Patient declined transfer and went home");
  assert.equal(R.referralHistory(id).at(-1)!.from_status, "raised");
});

// ================================================================ worklists

test("a referral nobody has answered inside its target is flagged", () => {
  // Emergency: thirty minutes.
  const late = refer("Unanswered", { urgency: "emergency", raisedAt: minutesAgo(90) });
  const fresh = refer("Justraised", { urgency: "emergency", raisedAt: minutesAgo(5) });

  const work = R.referralWorklist(facilityId);
  const lateRow = work.find((r) => r.referral.id === late)!;
  const freshRow = work.find((r) => r.referral.id === fresh)!;

  assert.equal(lateRow.unanswered, true);
  assert.equal(freshRow.unanswered, false);
  assert.equal(work[0].referral.id, late, "unanswered sorts to the top");
});

test("a routine referral gets two days before it counts as unanswered", () => {
  const id = refer("Patient", { urgency: "routine", raisedAt: minutesAgo(600) });
  const row = R.referralWorklist(facilityId).find((r) => r.referral.id === id)!;
  assert.equal(row.unanswered, false, "ten hours is not late for a routine referral");
  assert.equal(R.ACCEPTANCE_TARGET_MINUTES.routine, 2880);
});

test("a referral that left and never came back stays on the list, oldest first", () => {
  const old = refer("Longgone", { raisedAt: daysAgo(21) });
  R.acceptReferral({ referralId: old, acceptedByName: "Dr. Owino", at: daysAgo(21), ...ACT });
  R.departReferral({ referralId: old, at: daysAgo(21), ...ACT });

  const recent = refer("Justleft", { raisedAt: daysAgo(1) });
  R.acceptReferral({ referralId: recent, acceptedByName: "Dr. Owino", at: daysAgo(1), ...ACT });
  R.departReferral({ referralId: recent, at: daysAgo(1), ...ACT });

  const waiting = R.awaitingOutcome(facilityId);
  assert.equal(waiting[0].referral.id, old, "the oldest is the one nobody will chase unless a screen says so");
  assert.equal(waiting.find((r) => r.referral.id === old)!.loopBroken, true);
  assert.equal(waiting.find((r) => r.referral.id === recent)!.loopBroken, false, "one day is not a broken loop");
  assert.equal(R.OUTCOME_CHASE_DAYS, 7);
});

test("completing a referral takes it off the awaiting list", () => {
  const id = refer("Closedloop", { raisedAt: daysAgo(10) });
  R.acceptReferral({ referralId: id, acceptedByName: "Dr. Owino", at: daysAgo(10), ...ACT });
  R.departReferral({ referralId: id, at: daysAgo(10), ...ACT });
  assert.ok(R.awaitingOutcome(facilityId).some((r) => r.referral.id === id));

  R.recordOutcome({ referralId: id, outcome: "treated_returned", note: "Seen, treated, back on our books", ...ACT });
  assert.ok(!R.awaitingOutcome(facilityId).some((r) => r.referral.id === id));
});

test("referrals in are kept separately from referrals out", () => {
  const id = R.raiseReferral({
    facilityId, patientMrn: newPatient("Arriving"), direction: "in",
    counterpartCode: "MATHARE-HC-01", urgency: "urgent",
    reason: "Sent here for admission — no bed at the health centre", ...BY,
  });
  assert.ok(R.referralWorklist(facilityId, "in").some((r) => r.referral.id === id));
  assert.ok(!R.referralWorklist(facilityId, "out").some((r) => r.referral.id === id));
  assert.ok(R.referralSummary(facilityId).in >= 1, "a facility that only records what it sends cannot show what it receives");
});

// ================================================================== the letter

test("the letter carries both ends, the patient, and what was already done", () => {
  const id = refer("Lettered");
  R.acceptReferral({ referralId: id, acceptedByName: "Dr. Owino, casualty registrar", ...ACT });
  const letter = R.referralLetter(id);

  assert.equal(letter.reference, id);
  assert.equal(letter.from.kmhflCode, getFacility(facilityId)!.kmhfl_code);
  assert.equal(letter.from.level, 2);
  assert.equal(letter.to.name, "Kenyatta National Hospital");
  assert.equal(letter.to.level, 6);
  assert.ok(letter.to.phone, "a destination you cannot telephone is not a destination");
  assert.match(letter.patient.name, /Lettered/);
  assert.match(letter.treatmentGiven, /cervical collar/);
  assert.equal(letter.acceptedBy, "Dr. Owino, casualty registrar");
});

test("a letter to somewhere outside the directory still assembles", () => {
  const id = R.raiseReferral({
    facilityId, patientMrn: newPatient("Outside"), externalName: "Aga Khan University Hospital",
    urgency: "routine", reason: "Patient's insurer directs them there", ...BY,
  });
  const letter = R.referralLetter(id);
  assert.equal(letter.to.name, "Aga Khan University Hospital");
  assert.equal(letter.to.kmhflCode, null);
  assert.equal(letter.to.level, null);
});

// ==================================================================== report

test("the summary reports the number nobody currently has: did the loop close", () => {
  const s = R.referralSummary(facilityId);
  assert.ok(s.out >= 15);
  assert.ok(s.in >= 1);
  assert.ok(s.declined >= 1);
  assert.ok(s.loopBroken >= 1);
  assert.ok(s.completed >= 3);
  assert.ok(s.loopClosedPercent !== null && s.loopClosedPercent > 0 && s.loopClosedPercent < 100,
    "neither extreme — some came back and some did not, which is what a real facility looks like");
  assert.ok(s.byOutcome.treated_returned >= 2);
});

test("the loop-closed rate counts only referrals that actually left", () => {
  // A referral still waiting for acceptance is a different problem, and
  // counting it as an unclosed loop would blame the wrong thing.
  const before = R.referralSummary(facilityId).loopClosedPercent!;
  refer("Neverleft", { urgency: "routine" });
  assert.equal(R.referralSummary(facilityId).loopClosedPercent, before);
});

test("rates are absent, not zero, when nothing happened in the period", () => {
  const empty = R.referralSummary(facilityId, "1990-01-01", "1990-12-31");
  assert.equal(empty.out, 0);
  assert.equal(empty.loopClosedPercent, null);
  assert.equal(empty.medianAcceptanceMinutes, null);
});

// ===================================================================== audit

test("every referral state change is on the audit chain, and the chain verifies", () => {
  const count = (action: string) =>
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`, action)!.n;

  assert.ok(count("referral_raised") >= 15);
  assert.ok(count("referral_accepted") >= 5);
  assert.ok(count("referral_declined") >= 1);
  assert.ok(count("referral_departed") >= 4);
  assert.ok(count("referral_completed") >= 3);
  assert.ok(count("referral_cancelled") >= 1);

  const v = verifyAuditChain();
  assert.equal(v.ok, true);
});
