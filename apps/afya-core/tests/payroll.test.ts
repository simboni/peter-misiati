/**
 * M62 Payroll.
 *
 * The most Kenya-specific module here, and the one most certain to be wrong if
 * its rates are compiled in. The tests that matter are about the rates being
 * data with dates, the order of the statutory deductions, and a payslip
 * recording what was actually paid rather than what today's law would give.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-pay-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const Y = await import("../src/lib/payroll.ts");
const A = await import("../src/lib/accounting.ts");
const N = await import("../src/lib/notifications.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get, today } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, pharmacistId } = seedDemo();
registerDevice({ facilityId, code: "PAY1", label: "Payroll", byUserId: adminId, byUserName: "admin" });
A.seedChartOfAccounts();
Y.seedStatutoryRates();

const DEV = "PAY1";
// Prepared by one person, approved by another. The module is about that.
const PREPARER = { byUserId: pharmacistId!, byUserName: "Grace Kimani" };
const APPROVER = { byUserId: adminId!, byUserName: "Facility Administrator" };
const PAY_DATE = `${today().slice(0, 7)}-28`;

let payrollNo = 1000;
function hire(given: string, basicCents: number, over: Partial<Parameters<typeof Y.addEmployee>[0]> = {}) {
  return Y.addEmployee({
    facilityId, payrollNo: `EMP-${++payrollNo}`, givenName: given, familyName: "Staff",
    kraPin: `A00${payrollNo}X`, nssfNo: `NSSF${payrollNo}`, shifNo: `SHIF${payrollNo}`,
    jobTitle: "Nurse", department: "Outpatient", basicCents,
    bankName: "Equity", bankAccount: `01234${payrollNo}`,
    startedOn: "2024-01-01", ...PREPARER, deviceCode: DEV, ...over,
  });
}

// ============================================================== the rates

test("EVERY STATUTORY RATE IS A ROW WITH A DATE IT TOOK EFFECT", () => {
  // Not a constant. PAYE bands, NSSF tiers, SHIF and the housing levy all
  // change by Act of Parliament, and a payroll with them compiled in is wrong
  // the month after every Finance Act.
  const bands = Y.ratesInForce("paye_band", PAY_DATE);
  assert.equal(bands.length, 5);
  assert.equal(bands[0].rate_bp, 1_000, "the first band is 10%");
  assert.equal(bands.at(-1)!.rate_bp, 3_500);
  assert.ok(bands.every((b) => b.source.length > 0), "and each says where it came from");
});

test("a rate must record its source and the date it took effect", () => {
  assert.throws(
    () => Y.setRate({ kind: "shif", effectiveFrom: "not a date", rateBp: 275, source: "x" }),
    /the date it took effect/,
  );
  assert.throws(
    () => Y.setRate({ kind: "shif", effectiveFrom: "2026-01-01", rateBp: 275, source: "  " }),
    /must record its source/,
  );
});

test("the rates in force are the latest set at or before the date, not the newest ever", () => {
  Y.setRate({
    kind: "housing_levy", effectiveFrom: "2030-01-01", rateBp: 250,
    label: "a future change", source: "hypothetical",
  });
  assert.equal(Y.ratesInForce("housing_levy", PAY_DATE)[0].rate_bp, 150, "today's payroll uses today's law");
  assert.equal(Y.ratesInForce("housing_levy", "2030-06-01")[0].rate_bp, 250, "and a later one uses the later law");
});

test("a date before any rate existed has no rates, rather than the earliest ones", () => {
  assert.equal(Y.ratesInForce("shif", "2020-01-01").length, 0, "SHIF did not exist in 2020, and saying so is honest");
});

// ========================================================== the computation

test("the statutory deductions come off before PAYE, and relief comes off the tax", () => {
  // A 100,000 shilling salary, which exercises every band boundary that matters.
  const id = hire("Computed", 10_000_000);
  const pay = Y.computePay({ employeeId: id, payDate: PAY_DATE });

  assert.equal(pay.grossCents, 10_000_000);

  // NSSF: 6% of the first 8,000 plus 6% of the next 64,000 — tiered, not flat.
  assert.equal(pay.nssfCents, Math.round(800_000 * 0.06) + Math.round((7_200_000 - 800_000) * 0.06));
  // SHIF: 2.75% of gross.
  assert.equal(pay.shifCents, Math.round(10_000_000 * 0.0275));
  // Housing levy: 1.5% of gross.
  assert.equal(pay.housingLevyCents, Math.round(10_000_000 * 0.015));

  assert.equal(
    pay.taxableCents,
    pay.grossCents - pay.nssfCents - pay.shifCents - pay.housingLevyCents,
    "taxable pay is gross less the three statutory deductions — the order is not arbitrary",
  );

  assert.equal(pay.reliefCents, 240_000, "personal relief is KES 2,400 a month");
  assert.ok(pay.payeCents > 0);
  assert.equal(
    pay.netCents,
    pay.grossCents - pay.nssfCents - pay.shifCents - pay.housingLevyCents - pay.payeCents,
  );
});

test("relief reduces the tax, never below zero, and is not refunded", () => {
  // A salary small enough that the tax is less than the relief.
  const id = hire("Lowpaid", 1_500_000);
  const pay = Y.computePay({ employeeId: id, payDate: PAY_DATE });
  assert.equal(pay.payeCents, 0, "no PAYE");
  assert.ok(pay.netCents > 0, "and no negative tax handed back as pay");
});

test("SHIF has a floor, so the lowest paid still contribute the minimum", () => {
  const id = hire("Minimum", 500_000);
  const pay = Y.computePay({ employeeId: id, payDate: PAY_DATE });
  assert.equal(pay.shifCents, 30_000, "KES 300, which is above 2.75% of this salary");
});

test("an allowance can be taxable or not, and it changes the tax", () => {
  const taxed = hire("Taxedallowance", 5_000_000);
  const untaxed = hire("Untaxedallowance", 5_000_000);
  Y.addPayItem({
    employeeId: taxed, code: "HSE", name: "House allowance", kind: "allowance",
    amountCents: 2_000_000, taxable: true, startsOn: "2024-01-01", deviceCode: DEV,
  });
  Y.addPayItem({
    employeeId: untaxed, code: "REIMB", name: "Reimbursed transport", kind: "allowance",
    amountCents: 2_000_000, taxable: false, startsOn: "2024-01-01", deviceCode: DEV,
  });

  const a = Y.computePay({ employeeId: taxed, payDate: PAY_DATE });
  const b = Y.computePay({ employeeId: untaxed, payDate: PAY_DATE });

  assert.equal(a.grossCents, b.grossCents, "the same money in hand before deductions");
  assert.ok(a.payeCents > b.payeCents, "and a different tax — which is the commonest payroll error there is");
  assert.ok(a.netCents < b.netCents);
});

test("a pay item outside its dates does not apply", () => {
  const id = hire("Expired", 4_000_000);
  Y.addPayItem({
    employeeId: id, code: "ADV", name: "Salary advance recovery", kind: "deduction",
    amountCents: 500_000, startsOn: "2020-01-01", endsOn: "2020-06-30", deviceCode: DEV,
  });
  assert.equal(Y.computePay({ employeeId: id, payDate: PAY_DATE }).otherDeductionsCents, 0);
});

test("NET PAY IS NEVER NEGATIVE — you cannot deduct money that is not there", () => {
  const id = hire("Overdeducted", 3_000_000);
  Y.addPayItem({
    employeeId: id, code: "SACCO", name: "SACCO loan recovery", kind: "deduction",
    amountCents: 5_000_000, startsOn: "2024-01-01", deviceCode: DEV,
  });
  const pay = Y.computePay({ employeeId: id, payDate: PAY_DATE });

  assert.equal(pay.netCents, 0, "a payroll that can pay a negative salary will eventually try to");
  assert.ok(pay.cappedCents > 0, "and the shortfall is reported so it can be rescheduled");
  assert.match(pay.workings.join(" "), /could not be recovered this month/);

  // The statutory deductions were still taken in full; the SACCO got what was
  // left. This is what keeps the payslip and the ledger agreeing.
  assert.equal(
    pay.netCents,
    pay.grossCents - pay.nssfCents - pay.shifCents - pay.housingLevyCents - pay.payeCents - pay.otherDeductionsCents,
  );
  assert.ok(pay.otherDeductionsCents < 5_000_000);
});

test("the working is kept, so a payslip can show how it was arrived at", () => {
  const id = hire("Shown", 6_000_000);
  const pay = Y.computePay({ employeeId: id, payDate: PAY_DATE });
  assert.ok(pay.workings.length >= 6);
  assert.match(pay.workings.join("\n"), /NSSF Tier I/);
  assert.match(pay.workings.join("\n"), /SHIF/);
  assert.match(pay.workings.join("\n"), /Housing levy/);
  assert.match(pay.workings.join("\n"), /personal relief/);
});

test("the employer's own contributions are computed, and are not on the payslip", () => {
  const id = hire("Employercost", 8_000_000);
  const pay = Y.computePay({ employeeId: id, payDate: PAY_DATE });
  assert.equal(pay.employerNssfCents, pay.nssfCents, "NSSF is matched");
  assert.equal(pay.employerHousingCents, pay.housingLevyCents, "and so is the housing levy");
  assert.ok(pay.employerNssfCents + pay.employerHousingCents > 0);
});

// ================================================================= the run

test("a payroll will not run without rates in force", () => {
  const { facilityId: other } = seedDemo();
  assert.throws(
    () => Y.createRun({ facilityId, period: "2019-01", payDate: "2019-01-28", ...PREPARER, deviceCode: DEV }),
    /load the rates before running a payroll/,
    "producing zero deductions silently would be far worse than refusing",
  );
});

test("a run produces one payslip each, and stores the computation", () => {
  const period = today().slice(0, 7);
  const { runId, payslips, cappedEmployees } = Y.createRun({
    facilityId, period, payDate: PAY_DATE, ...PREPARER, deviceCode: DEV,
  });

  assert.ok(payslips >= 8);
  assert.ok(cappedEmployees >= 1, "and says how many would have gone negative");

  const slips = Y.payslipsFor(runId);
  assert.equal(slips.length, payslips);
  assert.ok(JSON.parse(slips[0].workings).length > 0, "the working is stored, not recomputed");

  const alert = N.inbox(facilityId, "admin").find((n) => n.kind === "payroll_capped");
  assert.ok(alert);
});

test("the same period cannot be run twice — a correction is a new run", () => {
  const period = today().slice(0, 7);
  assert.throws(
    () => Y.createRun({ facilityId, period, payDate: PAY_DATE, ...PREPARER, deviceCode: DEV }),
    /A correction is a new run, not an edit to this one/,
  );
});

test("THE PERSON WHO PREPARED A PAYROLL CANNOT APPROVE IT", () => {
  const period = today().slice(0, 7);
  const runId = Y.listRuns(facilityId).find((r) => r.period === period)!.id;
  assert.throws(
    () => Y.approveRun({ runId, ...PREPARER }),
    /where a facility's largest recurring payment leaves/,
  );
  Y.approveRun({ runId, ...APPROVER });
  assert.equal(Y.getRun(runId)!.status, "approved");
});

test("only an approved run is paid, and a payment records its reference", () => {
  const period = today().slice(0, 7);
  const runId = Y.listRuns(facilityId).find((r) => r.period === period)!.id;
  assert.throws(() => Y.payRun({ runId, paymentRef: "  ", ...APPROVER }), /must record its reference/);
  Y.payRun({ runId, paymentRef: "EFT-PAYROLL-0928", ...APPROVER });
  assert.equal(Y.getRun(runId)!.status, "paid");
});

test("A PAID RUN IS NEVER EDITED OR CANCELLED", () => {
  const period = today().slice(0, 7);
  const runId = Y.listRuns(facilityId).find((r) => r.period === period)!.id;
  assert.throws(
    () => Y.cancelRun({ runId, reason: "mistake", ...APPROVER }),
    /a correction is a new run/,
    "a payslip is evidence in an employment dispute",
  );
});

test("paying a run posts the whole cost of employment, not just the bank transfer", () => {
  const period = today().slice(0, 7);
  const runId = Y.listRuns(facilityId).find((r) => r.period === period)!.id;
  const slips = Y.payslipsFor(runId);

  const journal = get<{ id: string; narrative: string }>(
    `SELECT id, narrative FROM journals WHERE source_kind = 'payroll' AND source_ref = ?`,
    runId,
  )!;
  const lines = A.journalLines(journal.id);

  const gross = slips.reduce((s, p) => s + p.gross_cents, 0);
  const employer = slips.reduce((s, p) => s + p.employer_nssf_cents + p.employer_housing_cents, 0);
  const net = slips.reduce((s, p) => s + p.net_cents, 0);

  const staffCost = lines.find((l) => l.account_code === "5100")!;
  assert.equal(
    staffCost.debit_cents, gross + employer,
    "posting only the net would understate staff costs by roughly a third",
  );
  assert.equal(lines.find((l) => l.account_code === "1030")!.credit_cents, net, "the bank moves by the net");
  assert.ok(lines.find((l) => l.account_code === "2300")!.credit_cents > 0, "and the deductions are a liability until remitted");

  const debits = lines.reduce((s, l) => s + l.debit_cents, 0);
  const credits = lines.reduce((s, l) => s + l.credit_cents, 0);
  assert.equal(debits, credits);
});

test("a cancelled run takes its payslips with it", () => {
  const { runId } = Y.createRun({
    facilityId, period: "2027-03", payDate: "2027-03-28", ...PREPARER, deviceCode: DEV,
  });
  assert.ok(Y.payslipsFor(runId).length > 0);
  assert.throws(() => Y.cancelRun({ runId, reason: "  ", ...APPROVER }), /must record why/);
  Y.cancelRun({ runId, reason: "Salary review not finished — rerun after the board meets", ...APPROVER });
  assert.equal(Y.payslipsFor(runId).length, 0);
  // And the period is free again, because the run never happened.
  Y.createRun({ facilityId, period: "2027-03", payDate: "2027-03-28", ...PREPARER, deviceCode: DEV });
});

// ============================================================== employees

test("a leaver stays on the record, off the payroll, and off the next run", () => {
  const id = hire("Leaving", 4_000_000);
  Y.endEmployment({ employeeId: id, endedOn: "2026-08-31", reason: "Resigned, moved to Nakuru", ...APPROVER });

  assert.ok(!Y.listEmployees(facilityId).some((e) => e.id === id), "off the payroll");
  assert.ok(Y.listEmployees(facilityId, true).some((e) => e.id === id), "and still on the record");
  assert.throws(() => Y.endEmployment({ employeeId: id, endedOn: "2026-09-01", reason: "again", ...APPROVER }), /already ended/);

  const { runId } = Y.createRun({
    facilityId, period: "2026-12", payDate: "2026-12-28", ...PREPARER, deviceCode: DEV,
  });
  assert.ok(!Y.payslipsFor(runId).some((p) => p.employee_id === id));
});

test("ending an employment must record why", () => {
  const id = hire("Unexplained", 3_000_000);
  assert.throws(
    () => Y.endEmployment({ employeeId: id, endedOn: "2026-09-01", reason: "  ", ...APPROVER }),
    /must record why/,
  );
});

// ================================================================ returns

test("the statutory return says what is remitted, and for whom", () => {
  const period = today().slice(0, 7);
  const runId = Y.listRuns(facilityId).find((r) => r.period === period)!.id;
  const ret = Y.statutoryReturn(runId);

  assert.equal(ret.period, period);
  assert.ok(ret.employees >= 8);
  assert.ok(ret.payeCents > 0);
  assert.ok(ret.shifCents > 0);
  assert.equal(ret.nssfEmployerCents, ret.nssfEmployeeCents, "NSSF is matched");
  assert.equal(ret.housingEmployerCents, ret.housingEmployeeCents);
  assert.equal(
    ret.totalRemittableCents,
    ret.payeCents + ret.nssfEmployeeCents + ret.nssfEmployerCents + ret.shifCents +
      ret.housingEmployeeCents + ret.housingEmployerCents,
  );
  assert.ok(ret.lines.every((l) => l.payrollNo.length > 0));
});

test("the summary surfaces what would stop a return being filed", () => {
  hire("Nopin", 3_000_000, { kraPin: undefined, bankAccount: undefined });
  const s = Y.payrollSummary(facilityId);
  assert.ok(s.missingKraPin >= 1, "there is no PAYE return without a KRA PIN");
  assert.ok(s.missingBank >= 1);
  assert.equal(s.ratesLoaded, true);
  assert.ok(s.ratesAsOf !== null);
  assert.ok(s.employees >= 8);
  assert.ok(s.leavers >= 1);
});

// ================================================================== audit

test("every payroll step is on the audit chain, and it verifies", () => {
  const count = (action: string) =>
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`, action)!.n;

  assert.ok(count("employee_added") >= 10);
  assert.ok(count("employment_ended") >= 1);
  assert.ok(count("payroll_run_created") >= 3);
  assert.ok(count("payroll_approved") >= 1);
  assert.ok(count("payroll_paid") >= 1);
  assert.ok(count("payroll_cancelled") >= 1);

  const v = verifyAuditChain();
  assert.equal(v.ok, true);
});

test("LOADING THE RATES TWICE DOES NOT DOUBLE EVERYBODY'S DEDUCTIONS", () => {
  // A silent doubling of PAYE is about the worst thing a payroll can do, and
  // seeding twice is the obvious way to cause it.
  const id = hire("Doubleseeded", 5_000_000);
  const before = Y.computePay({ employeeId: id, payDate: PAY_DATE });
  const bandsBefore = Y.ratesInForce("paye_band", PAY_DATE).length;

  Y.seedStatutoryRates();
  Y.seedStatutoryRates();

  assert.equal(Y.ratesInForce("paye_band", PAY_DATE).length, bandsBefore, "still five bands, not fifteen");
  const after = Y.computePay({ employeeId: id, payDate: PAY_DATE });
  assert.equal(after.payeCents, before.payeCents);
  assert.equal(after.nssfCents, before.nssfCents);
  assert.equal(after.shifCents, before.shifCents);
  assert.equal(after.netCents, before.netCents);
});
