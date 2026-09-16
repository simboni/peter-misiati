/**
 * M62 Payroll.
 *
 * The most Kenya-specific module in this system, and the one most certain to be
 * wrong if it is written the obvious way.
 *
 *  EVERY STATUTORY RATE IS A ROW WITH A DATE IT TOOK EFFECT. Not a constant, not
 *  a lookup table in code. PAYE bands, NSSF tiers, SHIF and the housing levy all
 *  change by Act of Parliament — usually in July, sometimes in between, and
 *  twice in recent years with a month's notice. A payroll whose rates are
 *  compiled in is a payroll that is wrong the month after every Finance Act and
 *  needs a developer to fix. Here it needs a row.
 *
 *  A PAYSLIP IS COMPUTED FROM THE RATES IN FORCE ON ITS OWN PAY DATE, AND THE
 *  RESULT IS STORED. Reprinting a payslip from two years ago must show what was
 *  actually paid, not what today's rates would produce. Recomputing history
 *  under changed law is how a facility ends up unable to answer a KRA query.
 *
 *  NET PAY IS NEVER NEGATIVE. Deductions that would take somebody below zero are
 *  capped, and the shortfall is reported rather than silently carried. A payroll
 *  that can pay a negative salary will eventually try to.
 *
 *  PREPARED BY ONE PERSON, APPROVED BY ANOTHER. The same control as procurement,
 *  for the same reason: payroll is where a facility's largest recurring payment
 *  leaves, and one person controlling it end to end is how a ghost worker gets
 *  paid for three years.
 *
 *  A PAID RUN IS NEVER EDITED. A correction is a new run. This matters more here
 *  than almost anywhere: a payslip is evidence in an employment dispute.
 *
 * ⚠️ EVERY FIGURE IN `seedStatutoryRates` NEEDS AN ACCOUNTANT'S CONFIRMATION
 * AGAINST THE CURRENT LAW BEFORE ANYBODY IS PAID FROM IT. They are seeded from
 * published rates as understood at the time of writing, which is not the same
 * as being right today. The whole design exists so that correcting them is a
 * data change, and the review register says so in terms.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { formatKes } from "./billing.ts";
import { postJournal, ACCOUNT } from "./accounting.ts";
import { notify } from "./notifications.ts";

export class PayrollError extends Error {}

export type Employment = "permanent" | "contract" | "locum" | "intern" | "casual";
export type RunStatus = "draft" | "approved" | "paid" | "cancelled";
export type PayItemKind = "allowance" | "deduction";
export type RateKind = "paye_band" | "personal_relief" | "nssf" | "shif" | "housing_levy";

export interface Employee {
  id: string;
  facility_id: number;
  user_id: number | null;
  payroll_no: string;
  given_name: string;
  family_name: string;
  national_id: string | null;
  kra_pin: string | null;
  nssf_no: string | null;
  shif_no: string | null;
  job_title: string;
  department: string;
  employment: Employment;
  basic_cents: number;
  bank_name: string;
  bank_account: string;
  started_on: string;
  ended_on: string | null;
  end_reason: string;
  active: number;
}

// ------------------------------------------------------------- the rates

export function setRate(input: {
  kind: RateKind;
  effectiveFrom: string;
  lowerCents?: number;
  upperCents?: number;
  rateBp?: number;
  amountCents?: number;
  minCents?: number;
  maxCents?: number;
  label?: string;
  source: string;
}): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
    throw new PayrollError("a rate must say the date it took effect, as YYYY-MM-DD");
  }
  if (!input.source.trim()) {
    // An auditor will ask where a figure came from, and so will the next person
    // who has to change it.
    throw new PayrollError("a statutory rate must record its source");
  }
  // Idempotent on (kind, date, lower bound). Loading the rates twice must not
  // double everybody's deductions — a silent doubling of PAYE is about the
  // worst thing a payroll can do.
  run(
    `INSERT INTO statutory_rates
       (kind, effective_from, lower_cents, upper_cents, rate_bp, amount_cents, min_cents, max_cents, label, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, effective_from, COALESCE(lower_cents, -1)) DO UPDATE SET
       upper_cents = excluded.upper_cents, rate_bp = excluded.rate_bp,
       amount_cents = excluded.amount_cents, min_cents = excluded.min_cents,
       max_cents = excluded.max_cents, label = excluded.label, source = excluded.source`,
    input.kind,
    input.effectiveFrom,
    input.lowerCents ?? null,
    input.upperCents ?? null,
    input.rateBp ?? null,
    input.amountCents ?? null,
    input.minCents ?? null,
    input.maxCents ?? null,
    input.label?.trim() ?? "",
    input.source.trim(),
    now(),
  );
}

interface Rate {
  kind: RateKind;
  effective_from: string;
  lower_cents: number | null;
  upper_cents: number | null;
  rate_bp: number | null;
  amount_cents: number | null;
  min_cents: number | null;
  max_cents: number | null;
  label: string;
  source: string;
}

/** The rates of one kind in force on a date — the latest set at or before it. */
export function ratesInForce(kind: RateKind, onDate: string): Rate[] {
  const effective = get<{ effective_from: string }>(
    `SELECT MAX(effective_from) AS effective_from FROM statutory_rates
      WHERE kind = ? AND effective_from <= ?`,
    kind,
    onDate,
  )?.effective_from;
  if (!effective) return [];
  return all<Rate>(
    `SELECT * FROM statutory_rates WHERE kind = ? AND effective_from = ? ORDER BY COALESCE(lower_cents, 0)`,
    kind,
    effective,
  );
}

export function allRates(kind?: RateKind): Rate[] {
  const clause = kind ? `WHERE kind = ?` : "";
  const params: string[] = kind ? [kind] : [];
  return all<Rate>(
    `SELECT * FROM statutory_rates ${clause} ORDER BY kind, effective_from DESC, COALESCE(lower_cents, 0)`,
    ...params,
  );
}

// ------------------------------------------------------------- employees

export function addEmployee(input: {
  facilityId: number;
  payrollNo: string;
  givenName: string;
  familyName: string;
  userId?: number | null;
  nationalId?: string;
  kraPin?: string;
  nssfNo?: string;
  shifNo?: string;
  jobTitle?: string;
  department?: string;
  employment?: Employment;
  basicCents: number;
  bankName?: string;
  bankAccount?: string;
  startedOn: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  if (!input.payrollNo.trim()) throw new PayrollError("an employee needs a payroll number");
  if (!Number.isInteger(input.basicCents) || input.basicCents < 0) {
    throw new PayrollError("basic pay must be a whole number of cents");
  }

  const id = mintLocalId(input.deviceCode, 8);

  return tx(() => {
    run(
      `INSERT INTO employees
         (id, facility_id, user_id, payroll_no, given_name, family_name, national_id, kra_pin,
          nssf_no, shif_no, job_title, department, employment, basic_cents, bank_name,
          bank_account, started_on, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      id,
      input.facilityId,
      input.userId ?? null,
      input.payrollNo.trim().toUpperCase(),
      input.givenName.trim(),
      input.familyName.trim(),
      input.nationalId?.trim() || null,
      input.kraPin?.trim().toUpperCase() || null,
      input.nssfNo?.trim() || null,
      input.shifNo?.trim() || null,
      input.jobTitle?.trim() ?? "",
      input.department?.trim() ?? "",
      input.employment ?? "permanent",
      input.basicCents,
      input.bankName?.trim() ?? "",
      input.bankAccount?.trim() ?? "",
      input.startedOn,
      now(),
    );
    audit({
      action: "employee_added",
      entity: "employee",
      entityId: id,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      detail: { payrollNo: input.payrollNo, basicCents: input.basicCents, employment: input.employment ?? "permanent" },
    });
    return id;
  });
}

export function getEmployee(id: string): Employee | undefined {
  return get<Employee>(`SELECT * FROM employees WHERE id = ?`, id);
}

export function listEmployees(facilityId: number, includeLeavers = false): Employee[] {
  return all<Employee>(
    `SELECT * FROM employees WHERE facility_id = ? ${includeLeavers ? "" : "AND active = 1"}
      ORDER BY family_name, given_name`,
    facilityId,
  );
}

export function endEmployment(input: {
  employeeId: string;
  endedOn: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const employee = getEmployee(input.employeeId);
  if (!employee) throw new PayrollError("no such employee");
  if (!employee.active) throw new PayrollError("that employment has already ended");
  if (!input.reason.trim()) throw new PayrollError("ending an employment must record why");

  tx(() => {
    run(
      `UPDATE employees SET active = 0, ended_on = ?, end_reason = ? WHERE id = ?`,
      input.endedOn,
      input.reason.trim(),
      employee.id,
    );
    audit({
      action: "employment_ended",
      entity: "employee",
      entityId: employee.id,
      facilityId: employee.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { payrollNo: employee.payroll_no, endedOn: input.endedOn, reason: input.reason },
    });
  });
}

export function addPayItem(input: {
  employeeId: string;
  code: string;
  name: string;
  kind: PayItemKind;
  amountCents: number;
  taxable?: boolean;
  startsOn: string;
  endsOn?: string;
  note?: string;
  deviceCode: string;
}): string {
  if (!getEmployee(input.employeeId)) throw new PayrollError("no such employee");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PayrollError("a pay item must be a whole number of cents above zero");
  }
  const id = mintLocalId(input.deviceCode, 8);
  run(
    `INSERT INTO pay_items (id, employee_id, code, name, kind, amount_cents, taxable, starts_on, ends_on, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.employeeId,
    input.code.trim().toUpperCase(),
    input.name.trim(),
    input.kind,
    input.amountCents,
    // Explicit rather than assumed: whether an allowance is taxable is the
    // commonest payroll error there is.
    input.taxable === false ? 0 : 1,
    input.startsOn,
    input.endsOn ?? null,
    input.note?.trim() ?? "",
    now(),
  );
  return id;
}

export function payItemsFor(employeeId: string, onDate: string) {
  return all<{
    id: string;
    code: string;
    name: string;
    kind: PayItemKind;
    amount_cents: number;
    taxable: number;
    note: string;
  }>(
    `SELECT * FROM pay_items
      WHERE employee_id = ? AND starts_on <= ? AND (ends_on IS NULL OR ends_on >= ?)
      ORDER BY kind, code`,
    employeeId,
    onDate,
    onDate,
  );
}

// ------------------------------------------------------- the computation

export interface Computation {
  basicCents: number;
  allowancesCents: number;
  grossCents: number;
  nssfCents: number;
  shifCents: number;
  housingLevyCents: number;
  taxableCents: number;
  payeCents: number;
  reliefCents: number;
  otherDeductionsCents: number;
  netCents: number;
  employerNssfCents: number;
  employerHousingCents: number;
  /** Set when deductions would have taken net pay below zero. */
  cappedCents: number;
  workings: string[];
}

/** Basis points of an amount, rounded to the nearer cent. */
function bp(amountCents: number, basisPoints: number): number {
  return Math.round((amountCents * basisPoints) / 10_000);
}

/**
 * Compute one payslip, from the rates in force on the pay date.
 *
 * The order matters and is not arbitrary: NSSF, SHIF and the housing levy are
 * taken off gross before PAYE is worked out, and personal relief comes off the
 * tax rather than off the income. Getting that order wrong changes what a
 * person is paid.
 */
export function computePay(input: {
  employeeId: string;
  payDate: string;
  extraAllowancesCents?: number;
  extraDeductionsCents?: number;
}): Computation {
  const employee = getEmployee(input.employeeId);
  if (!employee) throw new PayrollError("no such employee");

  const items = payItemsFor(employee.id, input.payDate);
  const workings: string[] = [];

  const allowances = items.filter((i) => i.kind === "allowance");
  const deductions = items.filter((i) => i.kind === "deduction");

  const allowancesCents =
    allowances.reduce((sum, a) => sum + a.amount_cents, 0) + (input.extraAllowancesCents ?? 0);
  const taxableAllowances =
    allowances.filter((a) => a.taxable).reduce((sum, a) => sum + a.amount_cents, 0) +
    (input.extraAllowancesCents ?? 0);

  const basicCents = employee.basic_cents;
  const grossCents = basicCents + allowancesCents;
  // Only the taxable part of pay feeds the statutory calculations.
  const taxableGross = basicCents + taxableAllowances;
  workings.push(`Gross ${formatKes(grossCents)} = basic ${formatKes(basicCents)} + allowances ${formatKes(allowancesCents)}`);

  // --- NSSF, tiered on the taxable gross.
  let nssfCents = 0;
  const nssfTiers = ratesInForce("nssf", input.payDate);
  for (const tier of nssfTiers) {
    const lower = tier.lower_cents ?? 0;
    const upper = tier.upper_cents ?? Number.MAX_SAFE_INTEGER;
    const inTier = Math.max(0, Math.min(taxableGross, upper) - lower);
    if (inTier <= 0) continue;
    const amount = bp(inTier, tier.rate_bp ?? 0);
    nssfCents += amount;
    workings.push(`NSSF ${tier.label}: ${formatKes(inTier)} at ${(tier.rate_bp ?? 0) / 100}% = ${formatKes(amount)}`);
  }

  // --- SHIF, a percentage of gross with a floor.
  let shifCents = 0;
  const [shif] = ratesInForce("shif", input.payDate);
  if (shif) {
    shifCents = Math.max(bp(taxableGross, shif.rate_bp ?? 0), shif.min_cents ?? 0);
    if (shif.max_cents) shifCents = Math.min(shifCents, shif.max_cents);
    workings.push(
      `SHIF: ${(shif.rate_bp ?? 0) / 100}% of ${formatKes(taxableGross)} = ${formatKes(shifCents)}${
        shifCents === shif.min_cents ? " (the minimum)" : ""
      }`,
    );
  }

  // --- Housing levy, a percentage of gross, matched by the employer.
  let housingLevyCents = 0;
  const [housing] = ratesInForce("housing_levy", input.payDate);
  if (housing) {
    housingLevyCents = bp(taxableGross, housing.rate_bp ?? 0);
    workings.push(`Housing levy: ${(housing.rate_bp ?? 0) / 100}% of ${formatKes(taxableGross)} = ${formatKes(housingLevyCents)}`);
  }

  // --- Taxable pay, after the three statutory deductions.
  const taxableCents = Math.max(0, taxableGross - nssfCents - shifCents - housingLevyCents);
  workings.push(
    `Taxable pay ${formatKes(taxableCents)} = ${formatKes(taxableGross)} less NSSF, SHIF and housing levy`,
  );

  // --- PAYE on the bands, then personal relief off the tax.
  let grossTax = 0;
  for (const band of ratesInForce("paye_band", input.payDate)) {
    const lower = band.lower_cents ?? 0;
    const upper = band.upper_cents ?? Number.MAX_SAFE_INTEGER;
    const inBand = Math.max(0, Math.min(taxableCents, upper) - lower);
    if (inBand <= 0) continue;
    const tax = bp(inBand, band.rate_bp ?? 0);
    grossTax += tax;
    workings.push(`PAYE ${(band.rate_bp ?? 0) / 100}% on ${formatKes(inBand)} = ${formatKes(tax)}`);
  }
  const [reliefRate] = ratesInForce("personal_relief", input.payDate);
  const reliefCents = reliefRate?.amount_cents ?? 0;
  // Relief reduces the tax, never below zero, and is not refunded.
  const payeCents = Math.max(0, grossTax - reliefCents);
  workings.push(`PAYE ${formatKes(payeCents)} = ${formatKes(grossTax)} less personal relief ${formatKes(reliefCents)}`);

  const requestedOther =
    deductions.reduce((sum, d) => sum + d.amount_cents, 0) + (input.extraDeductionsCents ?? 0);

  // Statutory deductions come first and are not negotiable. A SACCO recovery or
  // a salary advance gets whatever is left — you cannot deduct money that is
  // not there, and pretending you did makes the payslip and the ledger
  // disagree by exactly the amount nobody actually took.
  const statutory = nssfCents + shifCents + housingLevyCents + payeCents;
  const available = Math.max(0, grossCents - statutory);
  const otherDeductionsCents = Math.min(requestedOther, available);
  const cappedCents = requestedOther - otherDeductionsCents;

  if (cappedCents > 0) {
    workings.push(
      `Other deductions reduced from ${formatKes(requestedOther)} to ${formatKes(otherDeductionsCents)} — ${formatKes(cappedCents)} could not be recovered this month and must be rescheduled`,
    );
  }

  // Net is now gross less what was actually taken, always, which is what makes
  // the payroll journal balance.
  const netCents = grossCents - statutory - otherDeductionsCents;

  const employerNssfCents = nssfTiers.reduce((sum, tier) => {
    const lower = tier.lower_cents ?? 0;
    const upper = tier.upper_cents ?? Number.MAX_SAFE_INTEGER;
    const inTier = Math.max(0, Math.min(taxableGross, upper) - lower);
    return sum + (inTier > 0 ? bp(inTier, tier.rate_bp ?? 0) : 0);
  }, 0);
  const employerHousingCents = housingLevyCents;

  return {
    basicCents,
    allowancesCents,
    grossCents,
    nssfCents,
    shifCents,
    housingLevyCents,
    taxableCents,
    payeCents,
    reliefCents,
    otherDeductionsCents,
    netCents,
    employerNssfCents,
    employerHousingCents,
    cappedCents,
    workings,
  };
}

// ----------------------------------------------------------------- the run

export function createRun(input: {
  facilityId: number;
  period: string;
  payDate: string;
  byUserId: number;
  byUserName: string;
  deviceCode: string;
}): { runId: string; payslips: number; cappedEmployees: number } {
  if (!/^\d{4}-\d{2}$/.test(input.period)) throw new PayrollError("a payroll period is YYYY-MM");

  const existing = get<{ id: string; status: RunStatus }>(
    `SELECT id, status FROM payroll_runs WHERE facility_id = ? AND period = ?`,
    input.facilityId,
    input.period,
  );
  if (existing && existing.status !== "cancelled") {
    throw new PayrollError(
      `${input.period} has already been run. A correction is a new run, not an edit to this one.`,
    );
  }

  // Without rates there is no payroll, and producing zero deductions silently
  // would be far worse than refusing. Checked before the staffing, because it
  // is a precondition of the system rather than of the data.
  for (const kind of ["paye_band", "shif", "nssf", "housing_levy"] as RateKind[]) {
    if (ratesInForce(kind, input.payDate).length === 0) {
      throw new PayrollError(
        `no ${kind.replace("_", " ")} rate is in force on ${input.payDate} — load the rates before running a payroll`,
      );
    }
  }

  const employees = listEmployees(input.facilityId).filter(
    (e) => e.started_on <= input.payDate && (!e.ended_on || e.ended_on >= input.payDate),
  );
  if (employees.length === 0) throw new PayrollError("nobody is on the payroll for that date");

  const runId = mintLocalId(input.deviceCode, 8);
  let capped = 0;

  return tx(() => {
    run(
      `INSERT INTO payroll_runs
         (id, facility_id, period, pay_date, status, prepared_by, preparer_name, prepared_at, device_code, created_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
      runId,
      input.facilityId,
      input.period,
      input.payDate,
      input.byUserId,
      input.byUserName,
      now(),
      input.deviceCode,
      now(),
    );

    for (const employee of employees) {
      const pay = computePay({ employeeId: employee.id, payDate: input.payDate });
      if (pay.cappedCents > 0) capped++;

      run(
        `INSERT INTO payslips
           (id, run_id, employee_id, basic_cents, allowances_cents, gross_cents, nssf_cents,
            shif_cents, housing_levy_cents, taxable_cents, paye_cents, relief_cents,
            other_deductions_cents, net_cents, employer_nssf_cents, employer_housing_cents,
            workings, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        mintLocalId(input.deviceCode, 8),
        runId,
        employee.id,
        pay.basicCents,
        pay.allowancesCents,
        pay.grossCents,
        pay.nssfCents,
        pay.shifCents,
        pay.housingLevyCents,
        pay.taxableCents,
        pay.payeCents,
        pay.reliefCents,
        pay.otherDeductionsCents,
        pay.netCents,
        pay.employerNssfCents,
        pay.employerHousingCents,
        // The working, stored rather than recomputed, so a payslip reprinted in
        // two years shows how it was arrived at under the law of the day.
        JSON.stringify(pay.workings),
        now(),
      );
    }

    if (capped > 0) {
      notify({
        facilityId: input.facilityId,
        ownerRole: "admin",
        severity: "warning",
        kind: "payroll_capped",
        subject: `${capped} payslip${capped === 1 ? "" : "s"} in ${input.period} would have been negative`,
        body: "Deductions exceed pay. Capped at zero and shown on the run — the recovery has to be rescheduled, not carried.",
        entity: "payroll_run",
        entityId: runId,
        dedupeKey: `payroll_capped:${runId}`,
      });
    }

    audit({
      action: "payroll_run_created",
      entity: "payroll_run",
      entityId: runId,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      detail: { period: input.period, payDate: input.payDate, employees: employees.length, capped },
    });

    return { runId, payslips: employees.length, cappedEmployees: capped };
  });
}

export function getRun(id: string) {
  return get<{
    id: string;
    facility_id: number;
    period: string;
    pay_date: string;
    status: RunStatus;
    prepared_by: number | null;
    preparer_name: string;
    prepared_at: string;
    approved_by: number | null;
    approver_name: string;
    approved_at: string | null;
    paid_at: string | null;
    payment_ref: string;
    cancel_reason: string;
  }>(`SELECT * FROM payroll_runs WHERE id = ?`, id);
}

export function listRuns(facilityId: number) {
  return all<{
    id: string;
    period: string;
    pay_date: string;
    status: RunStatus;
    preparer_name: string;
    approver_name: string;
    paid_at: string | null;
    employees: number;
    net_cents: number;
  }>(
    `SELECT r.*,
            (SELECT COUNT(*) FROM payslips p WHERE p.run_id = r.id) AS employees,
            (SELECT COALESCE(SUM(p.net_cents), 0) FROM payslips p WHERE p.run_id = r.id) AS net_cents
       FROM payroll_runs r WHERE r.facility_id = ? ORDER BY r.period DESC`,
    facilityId,
  );
}

export interface PayslipRow {
  id: string;
  employee_id: string;
  payroll_no: string;
  name: string;
  job_title: string;
  basic_cents: number;
  allowances_cents: number;
  gross_cents: number;
  nssf_cents: number;
  shif_cents: number;
  housing_levy_cents: number;
  taxable_cents: number;
  paye_cents: number;
  other_deductions_cents: number;
  net_cents: number;
  employer_nssf_cents: number;
  employer_housing_cents: number;
  workings: string;
  bank_name: string;
  bank_account: string;
  kra_pin: string | null;
}

export function payslipsFor(runId: string): PayslipRow[] {
  return all<PayslipRow>(
    `SELECT p.*, e.payroll_no, e.given_name || ' ' || e.family_name AS name,
            e.job_title, e.bank_name, e.bank_account, e.kra_pin
       FROM payslips p JOIN employees e ON e.id = p.employee_id
      WHERE p.run_id = ? ORDER BY e.family_name, e.given_name`,
    runId,
  );
}

export function payslipHistory(employeeId: string, limit = 24) {
  return all<{ period: string; pay_date: string; gross_cents: number; net_cents: number; status: RunStatus }>(
    `SELECT r.period, r.pay_date, p.gross_cents, p.net_cents, r.status
       FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
      WHERE p.employee_id = ? ORDER BY r.period DESC LIMIT ?`,
    employeeId,
    limit,
  );
}

export function approveRun(input: {
  runId: string;
  byUserId: number;
  byUserName: string;
}): void {
  const payroll = getRun(input.runId);
  if (!payroll) throw new PayrollError("no such payroll run");
  if (payroll.status !== "draft") throw new PayrollError(`that run is ${payroll.status}`);
  if (payroll.prepared_by === input.byUserId) {
    throw new PayrollError(
      "the person who prepared a payroll cannot approve it — this is where a facility's largest recurring payment leaves",
    );
  }

  tx(() => {
    run(
      `UPDATE payroll_runs SET status = 'approved', approved_by = ?, approver_name = ?, approved_at = ? WHERE id = ?`,
      input.byUserId,
      input.byUserName,
      now(),
      payroll.id,
    );
    const total = payslipsFor(payroll.id).reduce((sum, p) => sum + p.net_cents, 0);
    audit({
      action: "payroll_approved",
      entity: "payroll_run",
      entityId: payroll.id,
      facilityId: payroll.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { period: payroll.period, preparedBy: payroll.preparer_name, netCents: total },
    });
  });
}

/**
 * Pay the run, and post it.
 *
 * The journal is the whole cost of employment, not just what reaches bank
 * accounts: the statutory deductions are a liability the facility owes to KRA,
 * NSSF and SHIF, and the employer's own contributions are a cost on top.
 * Posting only the net would understate staff costs by roughly a third.
 */
export function payRun(input: {
  runId: string;
  paymentRef: string;
  byUserId: number;
  byUserName: string;
}): void {
  const payroll = getRun(input.runId);
  if (!payroll) throw new PayrollError("no such payroll run");
  if (payroll.status !== "approved") {
    throw new PayrollError(`that run is ${payroll.status} — only an approved payroll is paid`);
  }
  if (!input.paymentRef.trim()) throw new PayrollError("a payroll payment must record its reference");

  const slips = payslipsFor(payroll.id);
  const gross = slips.reduce((sum, p) => sum + p.gross_cents, 0);
  const net = slips.reduce((sum, p) => sum + p.net_cents, 0);
  const paye = slips.reduce((sum, p) => sum + p.paye_cents, 0);
  const statutory = slips.reduce(
    (sum, p) => sum + p.nssf_cents + p.shif_cents + p.housing_levy_cents,
    0,
  );
  const other = slips.reduce((sum, p) => sum + p.other_deductions_cents, 0);
  const employer = slips.reduce((sum, p) => sum + p.employer_nssf_cents + p.employer_housing_cents, 0);

  tx(() => {
    run(
      `UPDATE payroll_runs SET status = 'paid', paid_at = ?, payment_ref = ? WHERE id = ?`,
      now(),
      input.paymentRef.trim(),
      payroll.id,
    );

    postJournal({
      facilityId: payroll.facility_id,
      entryDate: payroll.pay_date,
      narrative: `Payroll ${payroll.period}`,
      sourceKind: "payroll",
      sourceRef: payroll.id,
      lines: [
        // The cost is gross pay plus what the employer contributes on top.
        { accountCode: ACCOUNT.EXPENSE_STAFF, debitCents: gross + employer, memo: `${slips.length} employees` },
        { accountCode: ACCOUNT.BANK, creditCents: net, memo: input.paymentRef.trim() },
        // Deducted, not yet remitted. A liability until it reaches KRA.
        { accountCode: ACCOUNT.TAX_PAYABLE, creditCents: paye + statutory + employer, memo: "PAYE, NSSF, SHIF, housing levy" },
        ...(other > 0
          ? [{ accountCode: ACCOUNT.PAYABLE_STAFF, creditCents: other, memo: "SACCO and other deductions" }]
          : []),
      ],
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });

    audit({
      action: "payroll_paid",
      entity: "payroll_run",
      entityId: payroll.id,
      facilityId: payroll.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: {
        period: payroll.period,
        reference: input.paymentRef,
        grossCents: gross,
        netCents: net,
        payeCents: paye,
        statutoryCents: statutory,
        employerCents: employer,
      },
    });
  });
}

export function cancelRun(input: {
  runId: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const payroll = getRun(input.runId);
  if (!payroll) throw new PayrollError("no such payroll run");
  if (payroll.status === "paid") {
    throw new PayrollError("a paid payroll is never edited or cancelled — a correction is a new run");
  }
  if (!input.reason.trim()) throw new PayrollError("cancelling a payroll run must record why");

  tx(() => {
    run(`UPDATE payroll_runs SET status = 'cancelled', cancel_reason = ? WHERE id = ?`, input.reason.trim(), payroll.id);
    run(`DELETE FROM payslips WHERE run_id = ?`, payroll.id);
    audit({
      action: "payroll_cancelled",
      entity: "payroll_run",
      entityId: payroll.id,
      facilityId: payroll.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { period: payroll.period, reason: input.reason, wasStatus: payroll.status },
    });
  });
}

// ------------------------------------------------------------ the returns

export interface StatutoryReturn {
  period: string;
  payDate: string;
  employees: number;
  grossCents: number;
  payeCents: number;
  nssfEmployeeCents: number;
  nssfEmployerCents: number;
  shifCents: number;
  housingEmployeeCents: number;
  housingEmployerCents: number;
  totalRemittableCents: number;
  lines: {
    payrollNo: string;
    name: string;
    kraPin: string | null;
    grossCents: number;
    payeCents: number;
    nssfCents: number;
    shifCents: number;
    housingCents: number;
  }[];
}

/**
 * What has to be remitted, and for whom.
 *
 * Assembled as data rather than a file, so the same figures can be printed,
 * shown, or sent through the integration hub without three versions drifting.
 */
export function statutoryReturn(runId: string): StatutoryReturn {
  const payroll = getRun(runId);
  if (!payroll) throw new PayrollError("no such payroll run");
  const slips = payslipsFor(runId);

  const sum = (f: (p: PayslipRow) => number) => slips.reduce((total, p) => total + f(p), 0);

  const paye = sum((p) => p.paye_cents);
  const nssfEmployee = sum((p) => p.nssf_cents);
  const nssfEmployer = sum((p) => p.employer_nssf_cents);
  const shif = sum((p) => p.shif_cents);
  const housingEmployee = sum((p) => p.housing_levy_cents);
  const housingEmployer = sum((p) => p.employer_housing_cents);

  return {
    period: payroll.period,
    payDate: payroll.pay_date,
    employees: slips.length,
    grossCents: sum((p) => p.gross_cents),
    payeCents: paye,
    nssfEmployeeCents: nssfEmployee,
    nssfEmployerCents: nssfEmployer,
    shifCents: shif,
    housingEmployeeCents: housingEmployee,
    housingEmployerCents: housingEmployer,
    totalRemittableCents: paye + nssfEmployee + nssfEmployer + shif + housingEmployee + housingEmployer,
    lines: slips.map((p) => ({
      payrollNo: p.payroll_no,
      name: p.name,
      kraPin: p.kra_pin,
      grossCents: p.gross_cents,
      payeCents: p.paye_cents,
      nssfCents: p.nssf_cents,
      shifCents: p.shif_cents,
      housingCents: p.housing_levy_cents,
    })),
  };
}

export interface PayrollSummary {
  employees: number;
  leavers: number;
  /** On the payroll with no KRA PIN — there is no PAYE return without one. */
  missingKraPin: number;
  missingBank: number;
  lastRun: string | null;
  lastRunStatus: RunStatus | null;
  monthlyGrossCents: number;
  monthlyNetCents: number;
  monthlyStatutoryCents: number;
  cappedEmployees: number;
  ratesLoaded: boolean;
  ratesAsOf: string | null;
}

export function payrollSummary(facilityId: number, asOf = today()): PayrollSummary {
  const staff = listEmployees(facilityId);
  const runs = listRuns(facilityId);
  const last = runs.find((r) => r.status !== "cancelled");
  const slips = last ? payslipsFor(last.id) : [];

  const bands = ratesInForce("paye_band", asOf);

  return {
    employees: staff.length,
    leavers: listEmployees(facilityId, true).filter((e) => !e.active).length,
    missingKraPin: staff.filter((e) => !e.kra_pin).length,
    missingBank: staff.filter((e) => !e.bank_account).length,
    lastRun: last?.period ?? null,
    lastRunStatus: last?.status ?? null,
    monthlyGrossCents: slips.reduce((sum, p) => sum + p.gross_cents, 0),
    monthlyNetCents: slips.reduce((sum, p) => sum + p.net_cents, 0),
    monthlyStatutoryCents: slips.reduce(
      (sum, p) => sum + p.paye_cents + p.nssf_cents + p.shif_cents + p.housing_levy_cents,
      0,
    ),
    cappedEmployees: slips.filter((p) => p.net_cents === 0 && p.gross_cents > 0).length,
    ratesLoaded: bands.length > 0,
    ratesAsOf: bands[0]?.effective_from ?? null,
  };
}

/**
 * Kenyan statutory rates, as data.
 *
 * ⚠️ EVERY FIGURE HERE NEEDS AN ACCOUNTANT'S CONFIRMATION AGAINST THE CURRENT
 * LAW BEFORE ANYBODY IS PAID FROM IT. They are seeded from published rates as
 * understood at the time of writing, which is not the same as being right
 * today: PAYE bands, the NSSF tier limits, the SHIF rate and the housing levy
 * have each changed within the last three years, and the NSSF limits are on a
 * published schedule of further increases.
 *
 * The reason they are rows rather than constants is precisely so that being
 * wrong is a data problem rather than a release.
 */
export function seedStatutoryRates(): void {
  const SOURCE = "seeded from published rates — CONFIRM against current law before paying anybody";

  // PAYE, monthly bands. Cents.
  const bands: [number, number | undefined, number][] = [
    [0, 2_400_000, 1_000],
    [2_400_000, 3_233_300, 2_500],
    [3_233_300, 50_000_000, 3_000],
    [50_000_000, 80_000_000, 3_250],
    [80_000_000, undefined, 3_500],
  ];
  for (const [lower, upper, rate] of bands) {
    setRate({
      kind: "paye_band", effectiveFrom: "2023-07-01",
      lowerCents: lower, upperCents: upper, rateBp: rate,
      label: `${rate / 100}%`, source: SOURCE,
    });
  }

  setRate({
    kind: "personal_relief", effectiveFrom: "2023-07-01",
    amountCents: 240_000, label: "Monthly personal relief", source: SOURCE,
  });

  // NSSF, two tiers, employee and employer each at the same rate.
  setRate({
    kind: "nssf", effectiveFrom: "2025-02-01",
    lowerCents: 0, upperCents: 800_000, rateBp: 600,
    label: "Tier I", source: `${SOURCE} — NSSF Act 2013, limits rise on a published schedule`,
  });
  setRate({
    kind: "nssf", effectiveFrom: "2025-02-01",
    lowerCents: 800_000, upperCents: 7_200_000, rateBp: 600,
    label: "Tier II", source: `${SOURCE} — NSSF Act 2013, limits rise on a published schedule`,
  });

  setRate({
    kind: "shif", effectiveFrom: "2024-10-01",
    rateBp: 275, minCents: 30_000,
    label: "2.75% of gross, minimum KES 300",
    source: `${SOURCE} — SHIF replaced NHIF from October 2024`,
  });

  setRate({
    kind: "housing_levy", effectiveFrom: "2024-03-19",
    rateBp: 150,
    label: "1.5% of gross, matched by the employer",
    source: `${SOURCE} — Affordable Housing Act 2024`,
  });
}
