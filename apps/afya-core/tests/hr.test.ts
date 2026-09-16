/**
 * M60 Human Resources.
 *
 * The rule that makes this a clinical module rather than a personnel
 * spreadsheet: if this person is away, who covers them — matched on the
 * regulator's registration rather than the job title, because a title is what a
 * facility calls somebody and a registration is what the law lets them do.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-hr-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const H = await import("../src/lib/hr.ts");
const Y = await import("../src/lib/payroll.ts");
const U = await import("../src/lib/users.ts");
const N = await import("../src/lib/notifications.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get, today } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, pharmacistId, labTechId } = seedDemo();
registerDevice({ facilityId, code: "HRD1", label: "HR", byUserId: adminId, byUserName: "admin" });
H.seedLeaveTypes();

const DEV = "HRD1";
const HR = { byUserId: pharmacistId!, byUserName: "Grace Kimani" };
const BOSS = { byUserId: adminId!, byUserName: "Facility Administrator" };

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
/** The next Monday, so a leave window is always five clean working days. */
function nextMonday(offsetWeeks = 1): string {
  const d = new Date(Date.now() + offsetWeeks * 7 * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);

let no = 500;

/**
 * An employee with a user and one registration of their own.
 *
 * Each test that cares about cover uses a distinct regulator, so two tests
 * cannot accidentally supply cover for each other's employee.
 */
function hireLicensed(given: string, regulator: string, expiresOn: string, jobTitle = "Nurse") {
  const userId = U.createUser({
    facilityId, username: `hr${++no}`, name: `${given} Person`, password: "ChangeMe123",
    roles: ["clinician"], ...BOSS,
  });
  U.recordLicence({ userId, regulator, licenceNumber: `${regulator}-${no}`, expiresOn, ...BOSS });
  return { employeeId: hire(given, userId, jobTitle), userId };
}

function hire(given: string, userId?: number | null, jobTitle = "Nurse") {
  return Y.addEmployee({
    facilityId, payrollNo: `HR-${++no}`, givenName: given, familyName: "Person",
    userId: userId ?? null, jobTitle, basicCents: 5_000_000, startedOn: "2024-01-01",
    kraPin: `A00${no}X`, ...HR, deviceCode: DEV,
  });
}

// =============================================================== contracts

test("a fixed-term contract with no end date is refused — a tribunal reads it as permanent", () => {
  const id = hire("Fixedterm");
  assert.throws(
    () => H.issueContract({ employeeId: id, kind: "fixed_term", startsOn: "2024-01-01", ...HR, deviceCode: DEV }),
    /must say when it ends/,
  );
});

test("a contract cannot end before it starts", () => {
  const id = hire("Backwards");
  assert.throws(
    () => H.issueContract({ employeeId: id, kind: "locum", startsOn: "2026-06-01", endsOn: "2026-05-01", ...HR, deviceCode: DEV }),
    /cannot end before it starts/,
  );
});

test("a renewal supersedes rather than replaces — the old terms are what applied while they applied", () => {
  const id = hire("Renewed");
  const first = H.issueContract({
    employeeId: id, kind: "probation", startsOn: "2024-01-01", endsOn: "2024-06-30",
    terms: "Three months' probation", ...HR, deviceCode: DEV,
  });
  const second = H.issueContract({
    employeeId: id, kind: "permanent", startsOn: "2024-07-01", ...HR, deviceCode: DEV,
  });

  assert.equal(H.currentContract(id)!.id, second);
  const history = H.contractHistory(id);
  assert.equal(history.length, 2);
  assert.equal(history.find((c) => c.id === first)!.superseded_by, second, "and an employment dispute is fought over exactly that");
});

// =============================================================== the leave

test("the statutory entitlements are data, and each says where it came from", () => {
  const annual = H.getLeaveType("ANNUAL")!;
  assert.equal(annual.annual_days, 21, "21 working days after twelve months");
  assert.match(annual.source, /Employment Act 2007/);
  assert.equal(H.getLeaveType("MATERNITY")!.per_event_days, 90);
  assert.equal(H.getLeaveType("PATERNITY")!.per_event_days, 14);
  assert.equal(H.getLeaveType("UNPAID")!.paid, 0);
  assert.ok(H.leaveTypes().every((t) => t.source.length > 0));
});

test("leave is counted in working days, not calendar days", () => {
  const monday = nextMonday();
  assert.equal(H.workingDays(monday, addDays(monday, 4)), 5, "Monday to Friday");
  assert.equal(H.workingDays(monday, addDays(monday, 6)), 5, "and the weekend is not leave");
  assert.equal(H.workingDays(monday, addDays(monday, 13)), 10);
  assert.throws(() => H.workingDays("2026-06-10", "2026-06-01"), /cannot end before it starts/);
});

test("a leave balance is the sum of rows, and can always be explained", () => {
  const id = hire("Balanced");
  const before = H.leaveBalance(id).find((b) => b.code === "ANNUAL")!;
  assert.equal(before.entitledDays, 21);
  assert.equal(before.remainingDays, 21);

  H.adjustLeave({
    employeeId: id, leaveCode: "ANNUAL", year: Number(today().slice(0, 4)),
    days: 4, reason: "Four days carried over from last year", ...BOSS,
  });
  const after = H.leaveBalance(id).find((b) => b.code === "ANNUAL")!;
  assert.equal(after.adjustmentDays, 4);
  assert.equal(after.remainingDays, 25);
});

test("an adjustment must record why, and is never zero", () => {
  const id = hire("Adjusted");
  const year = Number(today().slice(0, 4));
  assert.throws(() => H.adjustLeave({ employeeId: id, leaveCode: "ANNUAL", year, days: 3, reason: "  ", ...BOSS }), /must record why/);
  assert.throws(() => H.adjustLeave({ employeeId: id, leaveCode: "ANNUAL", year, days: 0, reason: "x", ...BOSS }), /never zero/);
});

test("leave that overlaps leave already on the register is refused", () => {
  const id = hire("Overlapping");
  const monday = nextMonday();
  H.requestLeave({ employeeId: id, leaveCode: "ANNUAL", startsOn: monday, endsOn: addDays(monday, 4), ...HR, deviceCode: DEV });
  assert.throws(
    () => H.requestLeave({ employeeId: id, leaveCode: "SICK", startsOn: addDays(monday, 2), endsOn: addDays(monday, 6), ...HR, deviceCode: DEV }),
    /overlaps leave already on the register/,
  );
});

test("a weekend is not leave", () => {
  const id = hire("Weekender");
  const monday = nextMonday(3);
  assert.throws(
    () => H.requestLeave({ employeeId: id, leaveCode: "ANNUAL", startsOn: addDays(monday, 5), endsOn: addDays(monday, 6), ...HR, deviceCode: DEV }),
    /no working days/,
  );
});

test("somebody else approves leave — not the person who asked for it", () => {
  const id = hire("Selfapprover");
  const monday = nextMonday(4);
  const { id: request } = H.requestLeave({
    employeeId: id, leaveCode: "ANNUAL", startsOn: monday, endsOn: addDays(monday, 4), ...HR, deviceCode: DEV,
  });
  assert.throws(() => H.decideLeave({ requestId: request, approve: true, ...HR }), /not the person who asked for it/);
  H.decideLeave({ requestId: request, approve: true, ...BOSS });
  assert.equal(H.getLeaveRequest(request)!.status, "approved");
});

test("declining leave must say why", () => {
  const id = hire("Declined");
  const monday = nextMonday(5);
  const { id: request } = H.requestLeave({
    employeeId: id, leaveCode: "ANNUAL", startsOn: monday, endsOn: addDays(monday, 4), ...HR, deviceCode: DEV,
  });
  assert.throws(() => H.decideLeave({ requestId: request, approve: false, ...BOSS }), /must say why/);
  H.decideLeave({ requestId: request, approve: false, note: "Two others already away that week", ...BOSS });
  assert.equal(H.getLeaveRequest(request)!.status, "declined");
});

test("leave beyond the balance is refused, and says what is left", () => {
  const id = hire("Greedy");
  const monday = nextMonday(6);
  // Twenty-five working days against an entitlement of twenty-one.
  const { id: request } = H.requestLeave({
    employeeId: id, leaveCode: "ANNUAL", startsOn: monday, endsOn: addDays(monday, 34), ...HR, deviceCode: DEV,
  });
  assert.throws(
    () => H.decideLeave({ requestId: request, approve: true, ...BOSS }),
    /has 21 days of Annual leave left and this is 25/,
  );
});

test("approved leave comes off the balance before it is even taken", () => {
  const id = hire("Booked");
  const monday = nextMonday(7);
  const { id: request } = H.requestLeave({
    employeeId: id, leaveCode: "ANNUAL", startsOn: monday, endsOn: addDays(monday, 4), ...HR, deviceCode: DEV,
  });
  H.decideLeave({ requestId: request, approve: true, ...BOSS });

  const balance = H.leaveBalance(id).find((b) => b.code === "ANNUAL")!;
  assert.equal(balance.bookedDays, 5);
  assert.equal(balance.takenDays, 0);
  assert.equal(balance.remainingDays, 16);

  H.markTaken({ requestId: request, ...BOSS });
  const after = H.leaveBalance(id).find((b) => b.code === "ANNUAL")!;
  assert.equal(after.takenDays, 5);
  assert.equal(after.remainingDays, 16, "and the balance does not move again when it is actually taken");
});

// ================================================================== cover

test("COVER IS MATCHED ON THE REGISTRATION, NOT THE JOB TITLE", () => {
  // Two people a facility calls Laboratory Technologist; only one holds the
  // KMLTTB registration. That is exactly the case this has to get right.
  const { employeeId: registered } = hireLicensed("Registered", "KMLTTB", inDays(400), "Laboratory Technologist");
  const unregistered = hire("Unregistered", null, "Laboratory Technologist");

  const monday = nextMonday(8);
  const cover = H.coverFor(registered, monday, addDays(monday, 4));

  assert.ok(cover.regulators.length > 0, "this person holds a registration");
  assert.ok(
    !cover.candidates.some((c) => c.employeeId === unregistered),
    "and somebody with the same title but no registration is not cover",
  );
  assert.deepEqual(cover.uncovered, cover.regulators, "so the registration is uncovered");
});

test("somebody with no registration needs no licensed cover, and that is not a failure", () => {
  const cleaner = hire("Cleaner", null, "Cleaner");
  const monday = nextMonday(9);
  const cover = H.coverFor(cleaner, monday, addDays(monday, 4));
  assert.deepEqual(cover.regulators, []);
  assert.deepEqual(cover.uncovered, []);
});

test("a second holder of the same registration is cover — unless they are away too", () => {
  const { employeeId: first } = hireLicensed("Firstdoctor", "KMPDC", inDays(400), "Medical Officer");
  const { employeeId: second } = hireLicensed("Seconddoctor", "KMPDC", inDays(400), "Medical Officer");

  const monday = nextMonday(10);
  const covered = H.coverFor(first, monday, addDays(monday, 4));
  assert.ok(covered.candidates.some((c) => c.employeeId === second));
  assert.ok(!covered.uncovered.includes("KMPDC"), "somebody else holds it");

  // Now put the cover on leave over the same dates.
  const { id: coverLeave } = H.requestLeave({
    employeeId: second, leaveCode: "ANNUAL", startsOn: monday, endsOn: addDays(monday, 4), ...HR, deviceCode: DEV,
  });
  H.decideLeave({ requestId: coverLeave, approve: true, uncoveredAck: "Dr. Cover away, locum booked", ...BOSS });

  const now = H.coverFor(first, monday, addDays(monday, 4));
  assert.ok(now.candidates.find((c) => c.employeeId === second)!.alsoAway);
  assert.ok(now.uncovered.includes("KMPDC"), "two people away is nobody covering");
});

test("LEAVE IS NOT BLOCKED FOR WANT OF COVER — IT IS ACKNOWLEDGED", () => {
  // Software that refuses leave teaches a facility to keep its leave register
  // in a notebook, where nobody can see the gap at all.
  const { employeeId: lone } = hireLicensed("Lonetech", "COC", inDays(400), "Clinical Officer");
  const monday = nextMonday(11);
  const { id: request, uncovered } = H.requestLeave({
    employeeId: lone, leaveCode: "ANNUAL", startsOn: monday, endsOn: addDays(monday, 4), ...HR, deviceCode: DEV,
  });
  assert.ok(uncovered.length > 0, "the request already knows nobody covers it");

  assert.throws(
    () => H.decideLeave({ requestId: request, approve: true, ...BOSS }),
    /Approving anyway must record how the work will be covered/,
  );

  H.decideLeave({
    requestId: request, approve: true,
    uncoveredAck: "Samples to Mbagathi for the week, agreed with their lab manager",
    ...BOSS,
  });
  assert.equal(H.getLeaveRequest(request)!.status, "approved");

  const alert = N.inbox(facilityId, "admin").find(
    (n) => n.kind === "leave_uncovered" && n.entity_id === lone,
  );
  assert.ok(alert, "and the facility is told, because a closed laboratory is not an HR matter");
  assert.match(alert!.body, /Mbagathi/);
});

// =============================================================== expiries

test("a lapsed licence is not a reminder — the access module is already refusing that work", () => {
  const { employeeId: employee } = hireLicensed("Lapsednurse", "NCK", inDays(-30), "Nurse");

  const list = H.expiries(facilityId);
  const row = list.find((e) => e.employeeId === employee && e.what.includes("NCK"))!;
  assert.ok(row);
  assert.equal(row.lapsed, true);
  assert.ok(row.daysLeft < 0);
});

test("a renewed licence is not expiring", () => {
  const { employeeId: employee, userId } = hireLicensed("Renewednurse", "NCK", inDays(-10), "Nurse");
  U.recordLicence({ userId, regulator: "NCK", licenceNumber: `NCK-RENEWED-${no}`, expiresOn: inDays(500), ...BOSS });

  assert.ok(
    !H.expiries(facilityId).some((e) => e.employeeId === employee),
    "only the latest licence per regulator counts — a renewed one is not expiring",
  );
});

test("a contract ending soon shows up beside the licences", () => {
  const id = hire("Endingsoon");
  H.issueContract({
    employeeId: id, kind: "fixed_term", startsOn: "2025-01-01", endsOn: inDays(20), ...HR, deviceCode: DEV,
  });
  const row = H.expiries(facilityId).find((e) => e.employeeId === id)!;
  assert.match(row.what, /fixed term contract/);
  assert.equal(row.daysLeft, 20);
  assert.equal(row.lapsed, false);
});

test("the horizon is ninety days, and it is a judgement", () => {
  assert.equal(H.EXPIRY_HORIZON_DAYS, 90);
  const id = hire("Farout");
  H.issueContract({ employeeId: id, kind: "locum", startsOn: "2025-01-01", endsOn: inDays(200), ...HR, deviceCode: DEV });
  assert.ok(!H.expiries(facilityId).some((e) => e.employeeId === id));
  assert.ok(H.expiries(facilityId, 365).some((e) => e.employeeId === id));
});

// ================================================================== cases

test("an employee cannot be heard before being notified — that is not due process", () => {
  const id = hire("Disciplined");
  const caseId = H.openCase({
    employeeId: id, kind: "disciplinary", summary: "Repeated late arrival", ...HR, deviceCode: DEV,
  });
  assert.throws(
    () => H.recordHearing({ caseId, notifiedOn: "2026-09-10", heardOn: "2026-09-08", ...BOSS }),
    /not due process/,
  );
  H.recordHearing({
    caseId, notifiedOn: "2026-09-08", heardOn: "2026-09-12",
    accompaniedBy: "Union representative", ...BOSS,
  });
  assert.equal(H.getCase(caseId)!.accompanied_by, "Union representative");
});

test("A DISMISSAL WITHOUT A RECORDED HEARING IS REFUSED", () => {
  // The single most expensive mistake a Kenyan employer can make at the
  // tribunal, and the one this module is best placed to prevent.
  const id = hire("Summarily");
  const caseId = H.openCase({
    employeeId: id, kind: "disciplinary", summary: "Theft of stock", ...HR, deviceCode: DEV,
  });
  assert.throws(
    () => H.closeCase({ caseId, outcome: "dismissed", note: "Caught on camera", ...BOSS }),
    /unfair whatever the employee did/,
  );

  H.recordHearing({ caseId, notifiedOn: "2026-09-01", heardOn: "2026-09-05", ...BOSS });
  H.closeCase({
    caseId, outcome: "dismissed",
    note: "Admitted at the hearing. Summary dismissal, final dues to be computed.", ...BOSS,
  });
  assert.equal(H.getCase(caseId)!.outcome, "dismissed");
});

test("an outcome must record its reasons, and a case closes once", () => {
  const id = hire("Warned");
  const caseId = H.openCase({ employeeId: id, kind: "performance", summary: "Missed drug charts", ...HR, deviceCode: DEV });
  assert.throws(() => H.closeCase({ caseId, outcome: "counselled", note: "  ", ...BOSS }), /must record its reasons/);
  H.closeCase({ caseId, outcome: "counselled", note: "Counselled, review in a month", ...BOSS });
  assert.throws(() => H.closeCase({ caseId, outcome: "no_action", note: "x", ...BOSS }), /already closed/);
});

test("a grievance is a case too, and closes without a hearing", () => {
  const id = hire("Aggrieved");
  const caseId = H.openCase({ employeeId: id, kind: "grievance", summary: "Roster unfairly allocated", ...HR, deviceCode: DEV });
  H.closeCase({ caseId, outcome: "upheld", note: "Roster revised from October", ...BOSS });
  assert.equal(H.getCase(caseId)!.outcome, "upheld");
});

// ================================================================ summary

test("the summary surfaces what a facility would otherwise find out too late", () => {
  const s = H.hrSummary(facilityId);
  assert.ok(s.staff >= 15);
  assert.ok(s.lapsedLicences >= 1, "somebody's registration has already lapsed");
  assert.ok(s.contractsEnding >= 1);
  assert.ok(s.noContract >= 1, "and somebody is working without one");
  assert.ok(s.uncoveredLeave >= 1);
  assert.ok(s.openCases >= 0);
  assert.ok(s.leaveWaiting >= 0);
});

test("the leave register shows requests first, then by date", () => {
  const register = H.leaveRegister(facilityId, "2020-01-01", inDays(400));
  assert.ok(register.length > 0);
  const firstApproved = register.findIndex((r) => r.status !== "requested");
  if (firstApproved > 0) {
    assert.ok(register.slice(0, firstApproved).every((r) => r.status === "requested"));
  }
});

// ================================================================== audit

test("every HR decision is on the audit chain, and it verifies", () => {
  const count = (action: string) =>
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`, action)!.n;

  assert.ok(count("contract_issued") >= 4);
  assert.ok(count("leave_requested") >= 6);
  assert.ok(count("leave_approved") >= 3);
  assert.ok(count("leave_declined") >= 1);
  assert.ok(count("leave_adjusted") >= 1);
  assert.ok(count("hr_case_opened") >= 4);
  assert.ok(count("hr_hearing_recorded") >= 2);
  assert.ok(count("hr_case_closed") >= 3);

  const v = verifyAuditChain();
  assert.equal(v.ok, true);
});
