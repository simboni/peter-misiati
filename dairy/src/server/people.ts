/**
 * M8 — People and payroll.
 *
 * The case this module exists to get right is the ordinary one: a herdsman on
 * KES 12,000 a month who owes NO PAYE — his tax falls below the personal relief
 * — but still owes NSSF, SHIF and the Housing Levy. Getting the top band right
 * matters far less, because most farms will never run one.
 *
 * The second thing it exists for is the casual-conversion trap. Under the
 * Employment Act 2007 a casual working continuously for more than one month
 * converts BY OPERATION OF LAW into a term employee with leave, sick pay and
 * notice. Most farms discover this at a tribunal. We warn as it approaches.
 *
 * Minimum wage is shown as a COMPLIANCE REFERENCE and never enforced. Actual
 * dairy wages are frequently below the gazetted rate, and a system that refuses
 * to record reality stops being used.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import {
  actionError,
  RefusedError,
  actionOk,
  assertOwned,
  can,
  guard,
  NotPermittedError,
  type ActionResult,
  type Capability,
  type Session,
} from "@/lib/dal";
import { newId, REF_PREFIX } from "@/lib/ids";
import { dec, kes, money, num } from "@/lib/money";
import {
  addDays,
  daysBetween,
  endOfMonth,
  monthsBetween,
  startOfMonth,
  today,
  type ISODate,
} from "@/lib/domain/dates";
import {
  CASUAL_CONVERSION_DAYS,
  KENYA_RATES_2026,
  REMITTANCE_DUE_DAY,
  checkCasualConversion,
  computePayslip,
  leaveAccruedDays,
  minimumWageCheck,
  type CasualWarning,
  type PayrollRates,
  type PayslipResult,
} from "@/lib/domain/payroll";
import { audit, resolveDb, writeReceipt } from "./money";

/* ------------------------------------------------------------------ */

function requireCap(session: Session, capability: Capability): void {
  if (!can(session.role, capability)) throw new NotPermittedError(capability);
}

/** The roles a Kenyan dairy actually hires. Free text is allowed beyond these. */
export const FARM_ROLES = [
  "FARM_MANAGER",
  "HERDSMAN",
  "STOCKMAN",
  "MILKER",
  "FEEDER",
  "CALF_ATTENDANT",
  "CASUAL",
  "WATCHMAN",
  "DRIVER",
  "FARM_CLERK",
] as const;

export const FARM_ROLE_LABEL: Record<string, string> = {
  FARM_MANAGER: "Farm manager",
  HERDSMAN: "Herdsman",
  STOCKMAN: "Stockman",
  MILKER: "Milker",
  FEEDER: "Feeder / fodder hand",
  CALF_ATTENDANT: "Calf attendant",
  CASUAL: "Casual (kibarua)",
  WATCHMAN: "Watchman",
  DRIVER: "Driver",
  FARM_CLERK: "Farm clerk",
};

export function roleLabel(role: string): string {
  return FARM_ROLE_LABEL[role] ?? role;
}

/* ------------------------------------------------------------------ */
/* Employees                                                           */
/* ------------------------------------------------------------------ */

const EmployeeInput = z.object({
  id: z.string().uuid().optional(),
  fullName: z.string().min(2, "Give the full name."),
  role: z.string().min(2, "What do they do on the farm?"),
  employmentType: z.enum(["PERMANENT", "TERM", "CASUAL"]),
  startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-08-03."),
  endedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  basicWageKes: z.coerce.number().min(0).optional(),
  wagePeriod: z.enum(["MONTHLY", "DAILY"]).default("MONTHLY"),
  housingProvided: z.coerce.boolean().default(true),
  // Onboarding paperwork. None of it blocks a save — R1, R4.
  nationalId: z.string().optional(),
  kraPin: z.string().optional(),
  nssfNo: z.string().optional(),
  shaNo: z.string().optional(),
  phone: z.string().optional(),
  nextOfKin: z.string().optional(),
  appUserId: z.string().uuid().optional(),
});
export type EmployeeInput = z.input<typeof EmployeeInput>;

export interface EmployeeSaved {
  id: string;
  /** Compliance reference only. Never blocks the save. */
  minimumWage: ReturnType<typeof minimumWageCheck>;
  missingPaperwork: string[];
}

export async function createEmployee(
  session: Session,
  input: unknown,
  database?: Db,
): Promise<ActionResult<EmployeeSaved>> {
  return guard(async () => {
    requireCap(session, "ADMIN");
    const parsed = EmployeeInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const db = await resolveDb(database);
    const v = parsed.data;

    if (v.appUserId) {
      const [u] = await db
        .select()
        .from(s.appUser)
        .where(and(eq(s.appUser.id, v.appUserId), eq(s.appUser.farmId, session.farmId)));
      assertOwned(u, session, "user");
    }

    const id = v.id ?? newId();
    await db
      .insert(s.employee)
      .values({
        id,
        farmId: session.farmId,
        appUserId: v.appUserId ?? null,
        fullName: v.fullName,
        nationalId: v.nationalId ?? null,
        kraPin: v.kraPin ?? null,
        nssfNo: v.nssfNo ?? null,
        shaNo: v.shaNo ?? null,
        phone: v.phone ?? null,
        role: v.role,
        employmentType: v.employmentType,
        startedOn: v.startedOn,
        endedOn: v.endedOn ?? null,
        basicWageKes: v.basicWageKes === undefined ? null : dec(v.basicWageKes),
        wagePeriod: v.wagePeriod,
        housingProvided: v.housingProvided,
        nextOfKin: v.nextOfKin ?? null,
      })
      .onConflictDoNothing();

    const monthlyEquivalent =
      v.wagePeriod === "DAILY" ? money((v.basicWageKes ?? 0) * 26) : (v.basicWageKes ?? 0);
    const minimumWage = minimumWageCheck(v.role, monthlyEquivalent);

    const missingPaperwork = [
      v.nationalId ? null : "National ID number",
      v.kraPin ? null : "KRA PIN",
      v.nssfNo ? null : "NSSF number",
      v.shaNo ? null : "SHA / SHIF number",
      v.nextOfKin ? null : "Next of kin",
    ].filter(Boolean) as string[];

    const ref = await writeReceipt(db, session, {
      kind: "EMPLOYEE",
      prefix: REF_PREFIX.PAYROLL,
      summary: `${v.fullName} added as ${roleLabel(v.role)} (${v.employmentType.toLowerCase()}) from ${v.startedOn}.`,
      payload: { employeeId: id },
    });

    return actionOk(
      { id, minimumWage, missingPaperwork },
      `${v.fullName} is on the books.${minimumWage.below ? ` ${minimumWage.message} Saved anyway — this is a reference, not a rule.` : ""}`,
      ref,
    );
  });
}

export async function updateEmployee(
  session: Session,
  employeeId: string,
  patch: Partial<EmployeeInput>,
  database?: Db,
): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    requireCap(session, "ADMIN");
    const db = await resolveDb(database);
    const [row] = await db
      .select()
      .from(s.employee)
      .where(and(eq(s.employee.id, employeeId), eq(s.employee.farmId, session.farmId)));
    assertOwned(row, session, "employee");

    const set: Partial<typeof s.employee.$inferInsert> = {};
    if (patch.fullName !== undefined) set.fullName = patch.fullName;
    if (patch.role !== undefined) set.role = patch.role;
    if (patch.employmentType !== undefined) set.employmentType = patch.employmentType;
    if (patch.endedOn !== undefined) set.endedOn = patch.endedOn;
    if (patch.basicWageKes !== undefined) set.basicWageKes = dec(Number(patch.basicWageKes));
    if (patch.wagePeriod !== undefined) set.wagePeriod = patch.wagePeriod;
    if (patch.housingProvided !== undefined) set.housingProvided = Boolean(patch.housingProvided);
    if (patch.nationalId !== undefined) set.nationalId = patch.nationalId;
    if (patch.kraPin !== undefined) set.kraPin = patch.kraPin;
    if (patch.nssfNo !== undefined) set.nssfNo = patch.nssfNo;
    if (patch.shaNo !== undefined) set.shaNo = patch.shaNo;
    if (patch.phone !== undefined) set.phone = patch.phone;
    if (patch.nextOfKin !== undefined) set.nextOfKin = patch.nextOfKin;

    await db
      .update(s.employee)
      .set(set)
      .where(and(eq(s.employee.id, employeeId), eq(s.employee.farmId, session.farmId)));

    await audit(db, session, "employee", employeeId, row, set);
    return actionOk({ id: employeeId }, "Details updated.");
  });
}

export interface EmployeeRow {
  id: string;
  fullName: string;
  role: string;
  roleLabel: string;
  employmentType: "PERMANENT" | "TERM" | "CASUAL";
  startedOn: ISODate;
  endedOn: ISODate | null;
  basicWageKes: number;
  wagePeriod: "MONTHLY" | "DAILY";
  housingProvided: boolean;
  monthsWorked: number;
  leaveAccruedDays: number;
  leaveTakenDays: number;
  leaveBalanceDays: number;
  consecutiveDays: number;
  casual: CasualWarning;
  minimumWage: ReturnType<typeof minimumWageCheck>;
}

export async function listEmployees(
  session: Session,
  asOf?: ISODate,
  database?: Db,
): Promise<EmployeeRow[]> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);
  const to = asOf ?? today();

  const rows = await db.select().from(s.employee).where(eq(s.employee.farmId, session.farmId));
  const out: EmployeeRow[] = [];

  for (const e of rows) {
    const monthsWorked = Math.max(0, monthsBetween(e.startedOn as ISODate, (e.endedOn as ISODate) ?? to));
    const accrued = leaveAccruedDays(monthsWorked);
    const taken = await leaveTakenDays(db, session.farmId, e.id);
    const consecutiveDays = await consecutiveDaysWorked(session, e.id, to, database);
    const monthly =
      e.wagePeriod === "DAILY" ? money(num(e.basicWageKes) * 26) : num(e.basicWageKes);

    out.push({
      id: e.id,
      fullName: e.fullName,
      role: e.role,
      roleLabel: roleLabel(e.role),
      employmentType: e.employmentType,
      startedOn: e.startedOn as ISODate,
      endedOn: (e.endedOn as ISODate) ?? null,
      basicWageKes: num(e.basicWageKes),
      wagePeriod: (e.wagePeriod ?? "MONTHLY") as "MONTHLY" | "DAILY",
      housingProvided: e.housingProvided,
      monthsWorked: money(monthsWorked),
      leaveAccruedDays: accrued,
      leaveTakenDays: taken,
      leaveBalanceDays: money(accrued - taken),
      consecutiveDays,
      casual:
        e.employmentType === "CASUAL"
          ? checkCasualConversion(consecutiveDays, e.fullName)
          : { warn: false, converted: false, daysWorked: consecutiveDays },
      minimumWage: minimumWageCheck(e.role, monthly),
    });
  }

  return out.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function getEmployee(
  session: Session,
  employeeId: string,
  asOf?: ISODate,
  database?: Db,
): Promise<EmployeeRow & { record: typeof s.employee.$inferSelect }> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);
  const [row] = await db
    .select()
    .from(s.employee)
    .where(and(eq(s.employee.id, employeeId), eq(s.employee.farmId, session.farmId)));
  assertOwned(row, session, "employee");

  const all = await listEmployees(session, asOf, database);
  const summary = all.find((e) => e.id === employeeId)!;
  return { ...summary, record: row };
}

/* ------------------------------------------------------------------ */
/* Attendance and the casual-conversion trap                           */
/* ------------------------------------------------------------------ */

const AttendanceInput = z.object({
  employeeId: z.string().uuid(),
  workedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-08-03."),
  days: z.coerce.number().min(0).max(2).default(1),
});
export type AttendanceInput = z.input<typeof AttendanceInput>;

export interface AttendanceResult {
  id: string;
  consecutiveDays: number;
  casual: CasualWarning;
}

/**
 * Mark a day worked. Unique on (employee, day), so a double-flush from the
 * offline outbox lands once.
 */
export async function recordAttendance(
  session: Session,
  input: unknown,
  database?: Db,
): Promise<ActionResult<AttendanceResult>> {
  return guard(async () => {
    requireCap(session, "ADMIN");
    const parsed = AttendanceInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const db = await resolveDb(database);
    const v = parsed.data;

    const [employee] = await db
      .select()
      .from(s.employee)
      .where(and(eq(s.employee.id, v.employeeId), eq(s.employee.farmId, session.farmId)));
    assertOwned(employee, session, "employee");

    await db
      .insert(s.attendance)
      .values({
        id: newId(),
        farmId: session.farmId,
        employeeId: v.employeeId,
        workedOn: v.workedOn,
        days: dec(v.days),
        recordedBy: session.userId,
      })
      .onConflictDoNothing();

    const [saved] = await db
      .select()
      .from(s.attendance)
      .where(
        and(eq(s.attendance.employeeId, v.employeeId), eq(s.attendance.workedOn, v.workedOn)),
      );

    const consecutiveDays = await consecutiveDaysWorked(session, v.employeeId, v.workedOn, database);
    const casual =
      employee.employmentType === "CASUAL"
        ? checkCasualConversion(consecutiveDays, employee.fullName)
        : { warn: false, converted: false, daysWorked: consecutiveDays };

    return actionOk(
      { id: saved.id, consecutiveDays, casual },
      casual.message ?? `${employee.fullName} marked present on ${v.workedOn}.`,
    );
  });
}

/**
 * Days of unbroken work ending at `asOf` (or at the last day recorded, if that
 * is earlier). A single missed day breaks the run — which is exactly the point:
 * continuity is what the Employment Act turns on.
 */
export async function consecutiveDaysWorked(
  session: Session,
  employeeId: string,
  asOf?: ISODate,
  database?: Db,
): Promise<number> {
  const db = await resolveDb(database);
  const to = asOf ?? today();

  const rows = await db
    .select({ workedOn: s.attendance.workedOn })
    .from(s.attendance)
    .where(
      and(
        eq(s.attendance.farmId, session.farmId),
        eq(s.attendance.employeeId, employeeId),
        lte(s.attendance.workedOn, to),
      ),
    );
  if (rows.length === 0) return 0;

  const worked = new Set(rows.map((r) => r.workedOn));
  const last = [...worked].sort().at(-1) as ISODate;

  // If the run has already been broken before `asOf`, it is over.
  if (daysBetween(last, to) > 1) return 0;

  let count = 0;
  for (let d: ISODate = last; worked.has(d); d = addDays(d, -1)) count++;
  return count;
}

export interface CasualAlert {
  employeeId: string;
  fullName: string;
  warning: CasualWarning;
}

/** Every casual at or past the warning threshold. */
export async function casualConversionWatch(
  session: Session,
  asOf?: ISODate,
  database?: Db,
): Promise<CasualAlert[]> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);
  const to = asOf ?? today();

  const casuals = await db
    .select()
    .from(s.employee)
    .where(and(eq(s.employee.farmId, session.farmId), eq(s.employee.employmentType, "CASUAL")));

  const out: CasualAlert[] = [];
  for (const e of casuals) {
    const days = await consecutiveDaysWorked(session, e.id, to, database);
    const warning = checkCasualConversion(days, e.fullName);
    if (warning.warn) out.push({ employeeId: e.id, fullName: e.fullName, warning });
  }
  return out.sort((a, b) => b.warning.daysWorked - a.warning.daysWorked);
}

/* ------------------------------------------------------------------ */
/* Leave                                                               */
/* ------------------------------------------------------------------ */

async function leaveTakenDays(db: Db, farmId: string, employeeId: string): Promise<number> {
  const rows = await db
    .select({ days: s.leaveRecord.days, leaveType: s.leaveRecord.leaveType })
    .from(s.leaveRecord)
    .where(and(eq(s.leaveRecord.farmId, farmId), eq(s.leaveRecord.employeeId, employeeId)));
  return money(
    rows.filter((r) => r.leaveType === "ANNUAL").reduce((t, r) => t + num(r.days), 0),
  );
}

const LeaveInput = z.object({
  employeeId: z.string().uuid(),
  leaveType: z.enum(["ANNUAL", "SICK_FULL", "SICK_HALF", "MATERNITY", "PATERNITY", "UNPAID"]),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.coerce.number().min(0).optional(),
});
export type LeaveInput = z.input<typeof LeaveInput>;

export interface LeaveResult {
  id: string;
  accruedDays: number;
  takenDays: number;
  balanceDays: number;
  overdrawn: boolean;
}

export async function recordLeave(
  session: Session,
  input: unknown,
  database?: Db,
): Promise<ActionResult<LeaveResult>> {
  return guard(async () => {
    requireCap(session, "ADMIN");
    const parsed = LeaveInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const db = await resolveDb(database);
    const v = parsed.data;

    const [employee] = await db
      .select()
      .from(s.employee)
      .where(and(eq(s.employee.id, v.employeeId), eq(s.employee.farmId, session.farmId)));
    assertOwned(employee, session, "employee");

    const days = v.days ?? daysBetween(v.fromDate, v.toDate) + 1;
    const id = newId();
    await db
      .insert(s.leaveRecord)
      .values({
        id,
        farmId: session.farmId,
        employeeId: v.employeeId,
        leaveType: v.leaveType,
        fromDate: v.fromDate,
        toDate: v.toDate,
        days: dec(days),
      })
      .onConflictDoNothing();

    const monthsWorked = Math.max(0, monthsBetween(employee.startedOn as ISODate, v.toDate));
    const accruedDays = leaveAccruedDays(monthsWorked);
    const takenDays = await leaveTakenDays(db, session.farmId, v.employeeId);
    const balanceDays = money(accruedDays - takenDays);

    // R4 — warn, never block. An overdrawn balance is a conversation, not an error.
    return actionOk(
      { id, accruedDays, takenDays, balanceDays, overdrawn: balanceDays < 0 },
      balanceDays < 0
        ? `${days} days recorded. ${employee.fullName} has now taken ${money(Math.abs(balanceDays))} days more annual leave than accrued.`
        : `${days} days recorded. ${employee.fullName} has ${balanceDays} days of annual leave left.`,
    );
  });
}

/* ------------------------------------------------------------------ */
/* Payroll                                                             */
/* ------------------------------------------------------------------ */

export interface PayslipRow {
  payslipId: string;
  employeeId: string;
  fullName: string;
  role: string;
  daysWorked: number;
  slip: PayslipResult;
}

export interface PayrollRunResult {
  runId: string;
  periodMonth: ISODate;
  status: "DRAFT" | "APPROVED" | "PAID";
  payslips: PayslipRow[];
  totalGrossKes: number;
  totalNetKes: number;
  totalEmployerCostKes: number;
  headline: string;
}

/** Accept "2026-08", "2026-08-01" or any date inside the month. */
export function normaliseMonth(month: string): ISODate {
  const v = month.trim();
  if (/^\d{4}-\d{2}$/.test(v)) return `${v}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return startOfMonth(v);
  throw new RefusedError("Give the month as 2026-08.");
}

/**
 * Run payroll for a month.
 *
 * Idempotent per month: `payroll_run` is unique on (farm, period) and `payslip`
 * on (run, employee), so running it twice produces one run and one payslip each.
 * Re-running a DRAFT refreshes it; re-running an APPROVED or PAID run refuses,
 * because a payslip somebody has been paid against is not a draft any more.
 */
export async function runPayroll(
  session: Session,
  month: string,
  database?: Db,
  rates: PayrollRates = KENYA_RATES_2026,
): Promise<ActionResult<PayrollRunResult>> {
  return guard(async () => {
    requireCap(session, "MANAGE_MONEY");
    const db = await resolveDb(database);
    const periodMonth = normaliseMonth(month);
    const periodEnd = endOfMonth(periodMonth);

    const [existing] = await db
      .select()
      .from(s.payrollRun)
      .where(
        and(eq(s.payrollRun.farmId, session.farmId), eq(s.payrollRun.periodMonth, periodMonth)),
      );

    if (existing && existing.status !== "DRAFT") {
      return actionError(
        `Payroll for ${periodMonth.slice(0, 7)} is already ${existing.status.toLowerCase()}. It cannot be run again.`,
      );
    }

    const runId = existing?.id ?? newId();
    if (!existing) {
      await db
        .insert(s.payrollRun)
        .values({
          id: runId,
          farmId: session.farmId,
          periodMonth,
          status: "DRAFT",
          totalGrossKes: dec(0),
          totalNetKes: dec(0),
        })
        .onConflictDoNothing();
    }

    // Anyone employed for any part of the month.
    const employees = (
      await db.select().from(s.employee).where(eq(s.employee.farmId, session.farmId))
    ).filter(
      (e) =>
        (e.startedOn as ISODate) <= periodEnd &&
        (!e.endedOn || (e.endedOn as ISODate) >= periodMonth),
    );

    const attendance = employees.length
      ? await db
          .select()
          .from(s.attendance)
          .where(
            and(
              eq(s.attendance.farmId, session.farmId),
              inArray(s.attendance.employeeId, employees.map((e) => e.id)),
              gte(s.attendance.workedOn, periodMonth),
              lte(s.attendance.workedOn, periodEnd),
            ),
          )
      : [];
    const daysByEmployee = new Map<string, number>();
    for (const a of attendance) {
      daysByEmployee.set(a.employeeId, money((daysByEmployee.get(a.employeeId) ?? 0) + num(a.days)));
    }

    /* ---------------------------------------------------------------- *
     * STAFF MILK RATION → PAYSLIP (the money seam).
     *
     * Almost every Kenyan dairy sends its herdsman home with milk. It is
     * pay, and it costs the farm exactly what a sold litre would have
     * fetched — which is why `recordDisposal` already values a
     * `STAFF_RATION` disposal at the imputed market rate and stores it on
     * `milkDisposal.valueKes`. That row is the single source of truth.
     *
     * So the ration is READ from the month's disposals, never re-entered
     * here, and it is never posted as an expense either: milk given to
     * staff was produced by this farm, not bought, and the cost of
     * producing it is already in feed, labour and everything else. Adding
     * a LABOUR expense for it would charge the farm twice for one litre.
     *
     * It is a cost IN KIND: `computePayslip` puts it in `costToFarmKes`
     * and deliberately keeps it out of `totalDeductionsKes`, so nobody's
     * net pay drops because they took milk.
     *
     * Split evenly across everyone on the run — `milkDisposal` has no
     * employee column, and an even share is the honest reading of "the
     * staff took 60 litres this month".
     * ---------------------------------------------------------------- */
    const rationRows = await db
      .select({
        litres: s.milkDisposal.litres,
        valueKes: s.milkDisposal.valueKes,
        rateKesPerLitre: s.milkDisposal.rateKesPerLitre,
      })
      .from(s.milkDisposal)
      .where(
        and(
          eq(s.milkDisposal.farmId, session.farmId),
          eq(s.milkDisposal.channel, "STAFF_RATION"),
          gte(s.milkDisposal.disposedOn, periodMonth),
          lte(s.milkDisposal.disposedOn, periodEnd),
        ),
      );
    const rationTotalKes = money(
      rationRows.reduce(
        (t, r) =>
          t + (r.valueKes != null ? num(r.valueKes) : num(r.litres) * num(r.rateKesPerLitre)),
        0,
      ),
    );
    const rationPerHeadKes =
      employees.length > 0 ? money(rationTotalKes / employees.length) : 0;
    let rationAllocatedKes = 0;

    const payslips: PayslipRow[] = [];
    let totalGrossKes = 0;
    let totalNetKes = 0;
    let totalEmployerCostKes = 0;

    for (const [index, e] of employees.entries()) {
      const wagePeriod = (e.wagePeriod ?? "MONTHLY") as "MONTHLY" | "DAILY";
      const daysWorked = daysByEmployee.get(e.id) ?? 0;
      // The last slip takes the rounding remainder, so the payslips add back
      // up to exactly what the disposals recorded — to the cent.
      const milkRationKes =
        index === employees.length - 1
          ? money(rationTotalKes - rationAllocatedKes)
          : rationPerHeadKes;
      rationAllocatedKes = money(rationAllocatedKes + milkRationKes);
      const slip = computePayslip(
        {
          basicKes: num(e.basicWageKes),
          housingProvided: e.housingProvided,
          daysWorked,
          wagePeriod,
          milkRationKes,
        },
        rates,
      );

      const [already] = await db
        .select()
        .from(s.payslip)
        .where(and(eq(s.payslip.payrollRunId, runId), eq(s.payslip.employeeId, e.id)));

      const payslipId = already?.id ?? newId();
      const values = {
        id: payslipId,
        farmId: session.farmId,
        payrollRunId: runId,
        employeeId: e.id,
        daysWorked: dec(daysWorked),
        basicKes: dec(slip.basicKes),
        housingAllowKes: dec(slip.housingAllowKes),
        grossKes: dec(slip.grossKes),
        nssfTier1Kes: dec(slip.nssfTier1Kes),
        nssfTier2Kes: dec(slip.nssfTier2Kes),
        shifKes: dec(slip.shifKes),
        housingLevyKes: dec(slip.housingLevyKes),
        taxableKes: dec(slip.taxableKes),
        payeBeforeReliefKes: dec(slip.payeBeforeReliefKes),
        personalReliefKes: dec(slip.personalReliefKes),
        payeKes: dec(slip.payeKes),
        advancesKes: dec(slip.advancesKes),
        otherDeductionsKes: dec(slip.otherDeductionsKes),
        milkRationKes: dec(slip.milkRationKes),
        netKes: dec(slip.netKes),
        employerNssfKes: dec(slip.employerNssfKes),
        employerShifKes: dec(slip.employerShifKes),
        employerHousingLevyKes: dec(slip.employerHousingLevyKes),
      };

      if (already) {
        await db.update(s.payslip).set(values).where(eq(s.payslip.id, payslipId));
      } else {
        await db.insert(s.payslip).values(values).onConflictDoNothing();
      }

      totalGrossKes = money(totalGrossKes + slip.grossKes);
      totalNetKes = money(totalNetKes + slip.netKes);
      totalEmployerCostKes = money(totalEmployerCostKes + slip.employerTotalKes);

      payslips.push({
        payslipId,
        employeeId: e.id,
        fullName: e.fullName,
        role: e.role,
        daysWorked,
        slip,
      });
    }

    await db
      .update(s.payrollRun)
      .set({ totalGrossKes: dec(totalGrossKes), totalNetKes: dec(totalNetKes) })
      .where(and(eq(s.payrollRun.id, runId), eq(s.payrollRun.farmId, session.farmId)));

    payslips.sort((a, b) => a.fullName.localeCompare(b.fullName));

    const headline = `${payslips.length} ${payslips.length === 1 ? "person" : "people"} for ${periodMonth.slice(0, 7)}: ${kes(totalGrossKes)} gross, ${kes(totalNetKes)} to pay out, ${kes(totalEmployerCostKes)} of employer contributions on top.`;

    return actionOk(
      {
        runId,
        periodMonth,
        status: "DRAFT" as const,
        payslips,
        totalGrossKes,
        totalNetKes,
        totalEmployerCostKes,
        headline,
      },
      headline,
    );
  });
}

export async function approvePayroll(
  session: Session,
  runId: string,
  database?: Db,
): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    requireCap(session, "APPROVE");
    const db = await resolveDb(database);
    const [run] = await db
      .select()
      .from(s.payrollRun)
      .where(and(eq(s.payrollRun.id, runId), eq(s.payrollRun.farmId, session.farmId)));
    assertOwned(run, session, "payroll run");

    if (run.status === "PAID") return actionError("That payroll has already been paid.");
    if (run.status === "APPROVED") return actionOk({ id: runId }, "Already approved.");

    await db
      .update(s.payrollRun)
      .set({ status: "APPROVED", approvedBy: session.userId })
      .where(and(eq(s.payrollRun.id, runId), eq(s.payrollRun.farmId, session.farmId)));

    await audit(db, session, "payroll_run", runId, { status: run.status }, { status: "APPROVED" });
    return actionOk(
      { id: runId },
      `Payroll for ${String(run.periodMonth).slice(0, 7)} approved. ${kes(num(run.totalNetKes))} is now due to staff.`,
    );
  });
}

const MarkPaidInput = z.object({
  runId: z.string().uuid(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: z.enum(s.PAYMENT_METHODS).default("MPESA"),
  /** One reference for a batch send, or nothing for cash in hand. */
  mpesaRef: z.string().optional(),
  /** Post the wage bill to the cash book as a PENDING expense. */
  postExpense: z.coerce.boolean().default(true),
});

export async function markPaid(
  session: Session,
  input: unknown,
  database?: Db,
): Promise<ActionResult<{ id: string; expenseId: string | null }>> {
  return guard(async () => {
    requireCap(session, "APPROVE");
    const parsed = MarkPaidInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const db = await resolveDb(database);
    const v = parsed.data;

    const [run] = await db
      .select()
      .from(s.payrollRun)
      .where(and(eq(s.payrollRun.id, v.runId), eq(s.payrollRun.farmId, session.farmId)));
    assertOwned(run, session, "payroll run");

    if (run.status === "DRAFT") {
      return actionError("Approve the payroll before marking it paid.");
    }
    if (run.status === "PAID") return actionOk({ id: v.runId, expenseId: null }, "Already paid.");

    await db
      .update(s.payrollRun)
      .set({ status: "PAID" })
      .where(and(eq(s.payrollRun.id, v.runId), eq(s.payrollRun.farmId, session.farmId)));

    await db
      .update(s.payslip)
      .set({ paidOn: v.paidOn, paymentMethod: v.paymentMethod, mpesaRef: v.mpesaRef ?? null })
      .where(
        and(eq(s.payslip.payrollRunId, v.runId), eq(s.payslip.farmId, session.farmId)),
      );

    // The wage bill is a real cost. It enters the cash book like any other —
    // PENDING, until somebody approves it.
    let expenseId: string | null = null;
    if (v.postExpense) {
      const slips = await db
        .select()
        .from(s.payslip)
        .where(and(eq(s.payslip.payrollRunId, v.runId), eq(s.payslip.farmId, session.farmId)));
      const cost = money(
        slips.reduce(
          (t, p) =>
            t +
            num(p.grossKes) +
            num(p.employerNssfKes) +
            num(p.employerShifKes) +
            num(p.employerHousingLevyKes),
          0,
        ),
      );
      expenseId = newId();
      await db
        .insert(s.expense)
        .values({
          id: expenseId,
          farmId: session.farmId,
          incurredOn: v.paidOn,
          category: "LABOUR",
          description: `Wages and statutory contributions for ${String(run.periodMonth).slice(0, 7)}`,
          amountKes: dec(cost),
          paymentMethod: v.paymentMethod,
          mpesaRef: v.mpesaRef ?? null,
          status: "PENDING",
          recordedBy: session.userId,
        })
        .onConflictDoNothing();
    }

    const ref = await writeReceipt(db, session, {
      kind: "PAYROLL",
      prefix: REF_PREFIX.PAYROLL,
      summary: `Payroll for ${String(run.periodMonth).slice(0, 7)} paid on ${v.paidOn} — ${kes(num(run.totalNetKes))} net.`,
      payload: { runId: v.runId, expenseId },
    });

    return actionOk(
      { id: v.runId, expenseId },
      `Payroll marked paid. Statutory deductions are due by the ${REMITTANCE_DUE_DAY}th of next month.`,
      ref,
    );
  });
}

export async function getPayrollRun(
  session: Session,
  month: string,
  database?: Db,
): Promise<PayrollRunResult | null> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);
  const periodMonth = normaliseMonth(month);

  const [run] = await db
    .select()
    .from(s.payrollRun)
    .where(and(eq(s.payrollRun.farmId, session.farmId), eq(s.payrollRun.periodMonth, periodMonth)));
  if (!run) return null;

  const slips = await db
    .select()
    .from(s.payslip)
    .where(and(eq(s.payslip.farmId, session.farmId), eq(s.payslip.payrollRunId, run.id)));

  const employees = await db
    .select()
    .from(s.employee)
    .where(eq(s.employee.farmId, session.farmId));
  const byId = new Map(employees.map((e) => [e.id, e]));

  const payslips: PayslipRow[] = slips.map((p) => {
    const e = byId.get(p.employeeId);
    const nssfTotal = money(num(p.nssfTier1Kes) + num(p.nssfTier2Kes));
    const employerTotal = money(
      num(p.employerNssfKes) + num(p.employerShifKes) + num(p.employerHousingLevyKes),
    );
    return {
      payslipId: p.id,
      employeeId: p.employeeId,
      fullName: e?.fullName ?? "—",
      role: e?.role ?? "—",
      daysWorked: num(p.daysWorked),
      slip: {
        basicKes: num(p.basicKes),
        housingAllowKes: num(p.housingAllowKes),
        grossKes: num(p.grossKes),
        nssfTier1Kes: num(p.nssfTier1Kes),
        nssfTier2Kes: num(p.nssfTier2Kes),
        nssfTotalKes: nssfTotal,
        shifKes: num(p.shifKes),
        housingLevyKes: num(p.housingLevyKes),
        taxableKes: num(p.taxableKes),
        payeBeforeReliefKes: num(p.payeBeforeReliefKes),
        personalReliefKes: num(p.personalReliefKes),
        payeKes: num(p.payeKes),
        advancesKes: num(p.advancesKes),
        otherDeductionsKes: num(p.otherDeductionsKes),
        milkRationKes: num(p.milkRationKes),
        totalDeductionsKes: money(
          nssfTotal + num(p.shifKes) + num(p.housingLevyKes) + num(p.payeKes) +
            num(p.advancesKes) + num(p.otherDeductionsKes),
        ),
        netKes: num(p.netKes),
        employerNssfKes: num(p.employerNssfKes),
        employerShifKes: num(p.employerShifKes),
        employerHousingLevyKes: num(p.employerHousingLevyKes),
        employerTotalKes: employerTotal,
        costToFarmKes: money(num(p.grossKes) + employerTotal + num(p.milkRationKes)),
      },
    };
  });

  payslips.sort((a, b) => a.fullName.localeCompare(b.fullName));
  const totalEmployerCostKes = money(
    payslips.reduce((t, p) => t + p.slip.employerTotalKes, 0),
  );

  return {
    runId: run.id,
    periodMonth: run.periodMonth as ISODate,
    status: run.status,
    payslips,
    totalGrossKes: num(run.totalGrossKes),
    totalNetKes: num(run.totalNetKes),
    totalEmployerCostKes,
    headline: `${payslips.length} ${payslips.length === 1 ? "person" : "people"} for ${periodMonth.slice(0, 7)}: ${kes(num(run.totalGrossKes))} gross, ${kes(num(run.totalNetKes))} to pay out.`,
  };
}

export async function listPayrollRuns(
  session: Session,
  database?: Db,
): Promise<Array<{ id: string; periodMonth: ISODate; status: string; totalNetKes: number }>> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);
  const runs = await db
    .select()
    .from(s.payrollRun)
    .where(eq(s.payrollRun.farmId, session.farmId));
  return runs
    .map((r) => ({
      id: r.id,
      periodMonth: r.periodMonth as ISODate,
      status: r.status,
      totalNetKes: num(r.totalNetKes),
    }))
    .sort((a, b) => (a.periodMonth < b.periodMonth ? 1 : -1));
}

/* ------------------------------------------------------------------ */
/* Statutory remittances — what is due by the 9th                      */
/* ------------------------------------------------------------------ */

export interface RemittanceLine {
  head: "PAYE" | "NSSF" | "SHIF" | "HOUSING_LEVY";
  label: string;
  employeeKes: number;
  employerKes: number;
  totalKes: number;
  payTo: string;
}

export interface RemittanceSummary {
  periodMonth: ISODate;
  dueOn: ISODate;
  lines: RemittanceLine[];
  totalKes: number;
  headcount: number;
  status: "DRAFT" | "APPROVED" | "PAID" | "NOT_RUN";
  headline: string;
}

/**
 * What the farm owes the state for a month, and when. Everything is due by the
 * 9th of the following month — one date, four payments.
 */
export async function remittanceSummary(
  session: Session,
  month: string,
  database?: Db,
): Promise<RemittanceSummary> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);
  const periodMonth = normaliseMonth(month);
  const dueOn = `${addDays(endOfMonth(periodMonth), 1).slice(0, 7)}-${String(REMITTANCE_DUE_DAY).padStart(2, "0")}` as ISODate;

  const [run] = await db
    .select()
    .from(s.payrollRun)
    .where(and(eq(s.payrollRun.farmId, session.farmId), eq(s.payrollRun.periodMonth, periodMonth)));

  const slips = run
    ? await db
        .select()
        .from(s.payslip)
        .where(and(eq(s.payslip.farmId, session.farmId), eq(s.payslip.payrollRunId, run.id)))
    : [];

  const sum = (f: (p: (typeof slips)[number]) => number) => money(slips.reduce((t, p) => t + f(p), 0));

  const payeKes = sum((p) => num(p.payeKes));
  const nssfEmployee = sum((p) => num(p.nssfTier1Kes) + num(p.nssfTier2Kes));
  const nssfEmployer = sum((p) => num(p.employerNssfKes));
  const shifEmployee = sum((p) => num(p.shifKes));
  const shifEmployer = sum((p) => num(p.employerShifKes));
  const levyEmployee = sum((p) => num(p.housingLevyKes));
  const levyEmployer = sum((p) => num(p.employerHousingLevyKes));

  const lines: RemittanceLine[] = [
    {
      head: "PAYE",
      label: "PAYE (after personal relief)",
      employeeKes: payeKes,
      employerKes: 0,
      totalKes: payeKes,
      payTo: "KRA — iTax",
    },
    {
      head: "NSSF",
      label: "NSSF Tier I and II (matched by the farm)",
      employeeKes: nssfEmployee,
      employerKes: nssfEmployer,
      totalKes: money(nssfEmployee + nssfEmployer),
      payTo: "NSSF",
    },
    {
      head: "SHIF",
      label: "SHIF / SHA",
      employeeKes: shifEmployee,
      employerKes: shifEmployer,
      totalKes: money(shifEmployee + shifEmployer),
      payTo: "SHA",
    },
    {
      head: "HOUSING_LEVY",
      label: "Affordable Housing Levy (matched by the farm)",
      employeeKes: levyEmployee,
      employerKes: levyEmployer,
      totalKes: money(levyEmployee + levyEmployer),
      payTo: "KRA — Housing Levy",
    },
  ];

  const totalKes = money(lines.reduce((t, l) => t + l.totalKes, 0));
  const status = (run?.status ?? "NOT_RUN") as RemittanceSummary["status"];

  const headline = run
    ? `${kes(totalKes)} is due by ${dueOn} for ${slips.length} ${slips.length === 1 ? "person" : "people"}${payeKes === 0 ? ". No PAYE this month — nobody earned above the personal relief." : "."}`
    : `Payroll for ${periodMonth.slice(0, 7)} has not been run yet, so nothing is calculated. Deductions are due by ${dueOn}.`;

  return {
    periodMonth,
    dueOn,
    lines,
    totalKes,
    headcount: slips.length,
    status,
    headline,
  };
}

/* ------------------------------------------------------------------ */
/* Minimum wage — a reference, never a rule                            */
/* ------------------------------------------------------------------ */

export interface MinimumWaceCheckRow {
  employeeId: string;
  fullName: string;
  role: string;
  monthlyEquivalentKes: number;
  below: boolean;
  minimumKes?: number;
  message?: string;
}

/**
 * Where the farm stands against the gazetted agricultural minimum.
 *
 * This REPORTS. It never blocks a save, never refuses a wage and never rewrites
 * one. Actual dairy wages are frequently below the gazetted rate, and a system
 * that will not record what is really paid simply stops being used — at which
 * point it protects nobody.
 */
export async function minimumWageReport(
  session: Session,
  database?: Db,
): Promise<{ rows: MinimumWaceCheckRow[]; belowCount: number; note: string }> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);
  const employees = await db
    .select()
    .from(s.employee)
    .where(eq(s.employee.farmId, session.farmId));

  const rows = employees.map((e) => {
    const monthlyEquivalentKes =
      e.wagePeriod === "DAILY" ? money(num(e.basicWageKes) * 26) : num(e.basicWageKes);
    const check = minimumWageCheck(e.role, monthlyEquivalentKes);
    return {
      employeeId: e.id,
      fullName: e.fullName,
      role: e.role,
      monthlyEquivalentKes,
      below: check.below,
      minimumKes: check.minimumKes,
      message: check.message,
    };
  });

  const belowCount = rows.filter((r) => r.below).length;
  return {
    rows,
    belowCount,
    note:
      "Gazetted agricultural minimum wages, 1 May 2026. Shown so you know where you stand. The stockman/herdsman/watchman figure is disputed between sources — verify against the Gazette before relying on it.",
  };
}

/* ------------------------------------------------------------------ */
/* Form entry points                                                   */
/* ------------------------------------------------------------------ */

function formValues(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out;
}

export async function createEmployeeAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<EmployeeSaved>> {
  "use server";
  const { verifySession } = await import("@/lib/dal");
  const { updateTag } = await import("next/cache");
  const session = await verifySession();
  const raw = formValues(formData);
  const result = await createEmployee(session, {
    ...raw,
    housingProvided: formData.get("housingProvided") === "on" || formData.get("housingProvided") === "true",
  });
  if (result.ok) updateTag(`people:${session.farmId}`);
  return result;
}

export async function recordAttendanceAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<AttendanceResult>> {
  "use server";
  const { verifySession } = await import("@/lib/dal");
  const { updateTag } = await import("next/cache");
  const session = await verifySession();
  const result = await recordAttendance(session, formValues(formData));
  if (result.ok) updateTag(`people:${session.farmId}`);
  return result;
}

export async function recordLeaveAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<LeaveResult>> {
  "use server";
  const { verifySession } = await import("@/lib/dal");
  const { updateTag } = await import("next/cache");
  const session = await verifySession();
  const result = await recordLeave(session, formValues(formData));
  if (result.ok) updateTag(`people:${session.farmId}`);
  return result;
}

export async function runPayrollAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<PayrollRunResult>> {
  "use server";
  const { verifySession } = await import("@/lib/dal");
  const { updateTag } = await import("next/cache");
  const session = await verifySession();
  const result = await runPayroll(session, String(formData.get("month") ?? ""));
  if (result.ok) updateTag(`people:${session.farmId}`);
  return result;
}

export async function approvePayrollAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  "use server";
  const { verifySession } = await import("@/lib/dal");
  const { updateTag } = await import("next/cache");
  const session = await verifySession();
  const result = await approvePayroll(session, String(formData.get("runId") ?? ""));
  if (result.ok) updateTag(`people:${session.farmId}`);
  return result;
}

export async function markPaidAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; expenseId: string | null }>> {
  "use server";
  const { verifySession } = await import("@/lib/dal");
  const { updateTag } = await import("next/cache");
  const session = await verifySession();
  const result = await markPaid(session, formValues(formData));
  if (result.ok) {
    updateTag(`people:${session.farmId}`);
    updateTag(`money:${session.farmId}`);
  }
  return result;
}
