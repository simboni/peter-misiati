/**
 * M8 — People & payroll. ADVERSARIAL suite.
 *
 * The build agent's own tests prove the happy path. These probe the edges the
 * author assumed away: the statutory floors, the band boundaries, an employee
 * with no wage on file, and the arithmetic that decides what a herdsman is
 * actually handed at the end of the month.
 *
 * Bug demonstrations are `it.fails(...)` — they assert the CORRECT behaviour and
 * are expected to fail until the defect is fixed.
 */
import { describe, it, expect } from "vitest";
import { eq, and } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { seedFarm, seedEmployee, seedUser, fakeSession, FARM_ID } from "@/test/factory";
import * as s from "@/db/schema";
import { newId } from "@/lib/ids";
import { addDays } from "@/lib/domain/dates";
import {
  computeNssf,
  computePaye,
  computePayslip,
  computeShif,
  KENYA_RATES_2026,
  minimumWageCheck,
} from "@/lib/domain/payroll";
import {
  approvePayroll,
  casualConversionWatch,
  consecutiveDaysWorked,
  createEmployee,
  getEmployee,
  getPayrollRun,
  listEmployees,
  markPaid,
  minimumWageReport,
  normaliseMonth,
  recordAttendance,
  recordLeave,
  remittanceSummary,
  runPayroll,
  updateEmployee,
} from "./people";
import { monthToDate } from "./money";

const OTHER_FARM = "22222222-2222-4222-8222-222222222222";
const AUG = "2026-08";

async function setup(role: s.Role = "MANAGER") {
  const { db, close } = await createTestDb();
  await seedFarm(db);
  const userId = await seedUser(db, { role, fullName: "Grace Wanjiru" });
  return { db, close, userId, session: fakeSession({ role, userId }) };
}

async function seedOtherFarm(db: TestDb) {
  await db.insert(s.farm).values({ id: OTHER_FARM, name: "Nyandarua Rival Dairy" }).onConflictDoNothing();
  const employeeId = newId();
  await db.insert(s.employee).values({
    id: employeeId,
    farmId: OTHER_FARM,
    fullName: "Their herdsman",
    role: "HERDSMAN",
    employmentType: "PERMANENT",
    startedOn: "2024-01-01",
    basicWageKes: "20000.00",
    wagePeriod: "MONTHLY",
  });
  const runId = newId();
  await db.insert(s.payrollRun).values({
    id: runId,
    farmId: OTHER_FARM,
    periodMonth: "2026-08-01",
    status: "DRAFT",
  });
  return { employeeId, runId };
}

async function present(db: TestDb, employeeId: string, from: string, days: number, by: string) {
  for (let i = 0; i < days; i++) {
    await db.insert(s.attendance).values({
      id: newId(),
      farmId: FARM_ID,
      employeeId,
      workedOn: addDays(from, i),
      days: "1.00",
      recordedBy: by,
    });
  }
}

async function slipFor(db: TestDb, runId: string, employeeId: string) {
  const [row] = await db
    .select()
    .from(s.payslip)
    .where(and(eq(s.payslip.payrollRunId, runId), eq(s.payslip.employeeId, employeeId)));
  return row;
}

/* ================================================================== */
/* 1. THE HERDSMAN ON KES 12,000 — hand-computed, to the cent          */
/* ================================================================== */

describe("the KES 12,000 herdsman: zero PAYE, full NSSF + SHIF + Housing Levy", () => {
  /*
   * Hand computation, KENYA_RATES_2026, housing provided:
   *   gross                12,000.00
   *   NSSF tier I   min(12000,9000) x 6%       =   540.00
   *   NSSF tier II  (min(12000,108000)-9000)x6% =  180.00
   *   SHIF          max(300, 12000 x 2.75%)     =   330.00
   *   Housing levy  12000 x 1.5%                =   180.00
   *   taxable       12000 - 720 - 330 - 180     = 10,770.00
   *   PAYE @10%     10,770 x 10%                = 1,077.00
   *   relief                                    = 2,400.00  -> PAYE = 0
   *   net           12000 - (720+330+180+0)     = 10,770.00
   *   employer NSSF (matched)                   =   720.00
   *   employer levy 12000 x 1.5%                =   180.00
   *   cost to farm  12000 + 900                 = 12,900.00
   */
  it("computes the herdsman payslip exactly, in the domain layer", () => {
    const slip = computePayslip(
      { basicKes: 12_000, housingProvided: true, wagePeriod: "MONTHLY" },
      KENYA_RATES_2026,
    );
    expect(slip.grossKes).toBe(12_000);
    expect(slip.nssfTier1Kes).toBe(540);
    expect(slip.nssfTier2Kes).toBe(180);
    expect(slip.nssfTotalKes).toBe(720);
    expect(slip.shifKes).toBe(330);
    expect(slip.housingLevyKes).toBe(180);
    expect(slip.taxableKes).toBe(10_770);
    expect(slip.payeBeforeReliefKes).toBe(1_077);
    expect(slip.payeKes).toBe(0);
    expect(slip.totalDeductionsKes).toBe(1_230);
    expect(slip.netKes).toBe(10_770);
    expect(slip.employerNssfKes).toBe(720);
    expect(slip.employerShifKes).toBe(0);
    expect(slip.employerHousingLevyKes).toBe(180);
    expect(slip.costToFarmKes).toBe(12_900);
  });

  it("stores those figures as EXACT numeric strings, not approximations", async () => {
    const { db, close, session, userId } = await setup();
    const employeeId = await seedEmployee(db, { basicWageKes: "12000.00", housingProvided: true });
    await present(db, employeeId, "2026-08-01", 26, userId);

    const run = await runPayroll(session, AUG, db);
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const slip = await slipFor(db, run.data.runId, employeeId);
    // Exact strings. A float that lost a cent would show up here and nowhere else.
    expect(slip.basicKes).toBe("12000.00");
    expect(slip.grossKes).toBe("12000.00");
    expect(slip.nssfTier1Kes).toBe("540.00");
    expect(slip.nssfTier2Kes).toBe("180.00");
    expect(slip.shifKes).toBe("330.00");
    expect(slip.housingLevyKes).toBe("180.00");
    expect(slip.taxableKes).toBe("10770.00");
    expect(slip.payeBeforeReliefKes).toBe("1077.00");
    expect(slip.payeKes).toBe("0.00");
    expect(slip.netKes).toBe("10770.00");
    expect(slip.employerNssfKes).toBe("720.00");
    expect(slip.employerHousingLevyKes).toBe("180.00");
    await close();
  });

  it("reports zero PAYE in the remittance summary and says so in words", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, { basicWageKes: "12000.00" });
    const run = await runPayroll(session, AUG, db);
    expect(run.ok).toBe(true);

    const rem = await remittanceSummary(session, AUG, db);
    expect(rem.lines.find((l) => l.head === "PAYE")!.totalKes).toBe(0);
    expect(rem.lines.find((l) => l.head === "NSSF")!.totalKes).toBe(1_440); // 720 + 720 matched
    expect(rem.lines.find((l) => l.head === "SHIF")!.totalKes).toBe(330);
    expect(rem.lines.find((l) => l.head === "HOUSING_LEVY")!.totalKes).toBe(360);
    expect(rem.totalKes).toBe(2_130);
    expect(rem.dueOn).toBe("2026-09-09");
    expect(rem.headline).toContain("No PAYE this month");
    await close();
  });

  it("gets the 15% housing allowance case right when the farm houses nobody", () => {
    const slip = computePayslip(
      { basicKes: 12_000, housingProvided: false, wagePeriod: "MONTHLY" },
      KENYA_RATES_2026,
    );
    expect(slip.housingAllowKes).toBe(1_800);
    expect(slip.grossKes).toBe(13_800);
    expect(slip.nssfTotalKes).toBe(828); // 540 + (13800-9000)*6% = 540 + 288
    expect(slip.shifKes).toBe(379.5);
    expect(slip.housingLevyKes).toBe(207);
    expect(slip.taxableKes).toBe(12_385.5);
    expect(slip.payeKes).toBe(0);
    expect(slip.netKes).toBe(12_385.5);
  });
});

/* ================================================================== */
/* 2. STATUTORY BOUNDARIES                                             */
/* ================================================================== */

describe("PAYE band boundaries", () => {
  const paye = (n: number) => computePaye(n, KENYA_RATES_2026);

  it("is exact at 24,000 — the top of the 10% band", () => {
    expect(paye(24_000)).toBe(2_400);
    expect(paye(23_999.99)).toBe(2_400); // 2,399.999 -> rounded to the cent
    // One shilling into the 25% band: 2,400 + 0.01 x 25% = 2,400.0025 -> 2,400.00
    expect(paye(24_000.01)).toBe(2_400);
  });

  it("is exact at 32,333 — the top of the 25% band", () => {
    // 2,400 + 8,333 x 25% = 2,400 + 2,083.25
    expect(paye(32_333)).toBe(4_483.25);
  });

  it("is exact at 500,000 — the top of the 30% band", () => {
    // 4,483.25 + 467,667 x 30% = 4,483.25 + 140,300.10
    expect(paye(500_000)).toBe(144_783.35);
  });

  it("is exact at 800,000 — the top of the 32.5% band", () => {
    // 144,783.35 + 300,000 x 32.5% = 144,783.35 + 97,500
    expect(paye(800_000)).toBe(242_283.35);
  });

  it("charges 35% only above 800,000", () => {
    expect(paye(900_000)).toBe(277_283.35); // +100,000 x 35%
  });

  it("never returns a negative tax for a zero or negative taxable amount", () => {
    expect(paye(0)).toBe(0);
    expect(paye(-5_000)).toBe(0);
  });
});

describe("NSSF earnings limits", () => {
  const nssf = (g: number) => computeNssf(g, KENYA_RATES_2026);

  it("is exact AT the lower earnings limit of 9,000 — tier II is zero", () => {
    expect(nssf(9_000)).toEqual({ tier1: 540, tier2: 0, total: 540 });
  });

  it("is exact AT the upper earnings limit of 108,000", () => {
    // tier II = (108,000 - 9,000) x 6% = 5,940
    expect(nssf(108_000)).toEqual({ tier1: 540, tier2: 5_940, total: 6_480 });
  });

  it("caps at the UEL — a KES 1,000,000 gross owes no more than 6,480", () => {
    expect(nssf(1_000_000).total).toBe(6_480);
  });

  it("charges tier I only, on actual pay, below the LEL", () => {
    expect(nssf(5_000)).toEqual({ tier1: 300, tier2: 0, total: 300 });
  });
});

describe("SHIF floor of KES 300", () => {
  const shif = (g: number) => computeShif(g, KENYA_RATES_2026);

  it("uses the floor below the crossover and the rate above it", () => {
    // crossover: 300 / 0.0275 = 10,909.0909...
    expect(shif(10_900)).toBe(300); // 299.75 -> floored
    expect(shif(10_909.09)).toBe(300); // 300.0 exactly at the boundary
    expect(shif(11_000)).toBe(302.5);
  });

  /**
   * DEFECT — LOW (but it is money). `money()` claims to "avoid the classic
   * 0.1 + 0.2 drift", and it does; it does NOT round half-up. A gross of
   * KES 10,910 owes 2.75% = 300.025, which must round to 300.03. It returns
   * 300.02, because 300.025 is stored as 300.0249999... and adding EPSILON at
   * that magnitude changes nothing. Every statutory deduction, every split and
   * every imputed value inherits the bias, always downwards.
   */
  it.fails("rounds a half-cent statutory deduction up, not down", () => {
    expect(shif(10_910)).toBe(300.03); // observed: 300.02
  });

  /**
   * DEFECT — CRITICAL. `computeShif` applies the KES 300 floor to a ZERO gross.
   * A casual who was engaged but worked no days, or a permanent employee whose
   * wage has not been entered yet, is charged SHIF on nothing. The floor exists
   * for people who EARN; it is not a poll tax on an empty payslip.
   */
  it.fails("must not charge the SHIF floor on a zero gross", () => {
    expect(shif(0)).toBe(0);
  });
});

/* ================================================================== */
/* 3. THE ZERO-GROSS PAYSLIP — a negative net wage                     */
/* ================================================================== */

describe("a casual on a daily rate who worked no days", () => {
  it("produces a payslip whose NET IS NEGATIVE (observed behaviour, wrong)", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db, {
      fullName: "Mutua the kibarua",
      employmentType: "CASUAL",
      wagePeriod: "DAILY",
      basicWageKes: "500.00",
      housingProvided: true,
    });
    // No attendance rows at all.
    const run = await runPayroll(session, AUG, db);
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const slip = await slipFor(db, run.data.runId, employeeId);
    // This is what the system currently writes to the database:
    expect(slip.grossKes).toBe("0.00");
    expect(slip.shifKes).toBe("300.00");
    expect(slip.netKes).toBe("-300.00");
    // ...and the run total is negative too, so the payroll headline is nonsense.
    expect(run.data.totalNetKes).toBe(-300);
    await close();
  });

  /** DEFECT — CRITICAL. A worker who earned nothing cannot owe the farm money. */
  it.fails("must pay zero, not minus 300", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db, {
      employmentType: "CASUAL",
      wagePeriod: "DAILY",
      basicWageKes: "500.00",
    });
    const run = await runPayroll(session, AUG, db);
    if (!run.ok) throw new Error(run.error);
    const slip = await slipFor(db, run.data.runId, employeeId);
    expect(Number(slip.netKes)).toBeGreaterThanOrEqual(0);
    await close();
  });

  /**
   * DEFECT — CRITICAL, and this is the likely real-world trigger: `basicWageKes`
   * is nullable and onboarding paperwork is explicitly allowed to be incomplete
   * (R1/R4). Every such employee lands on the payroll owing KES 300, and the
   * remittance summary then tells the farm to send SHA money for them.
   */
  it.fails("an employee with no wage on file must not owe SHIF", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, { fullName: "Newly hired, wage not set", basicWageKes: null });
    const run = await runPayroll(session, AUG, db);
    if (!run.ok) throw new Error(run.error);
    const rem = await remittanceSummary(session, AUG, db);
    expect(rem.lines.find((l) => l.head === "SHIF")!.totalKes).toBe(0);
    await close();
  });
});

/* ================================================================== */
/* 4. DAYS WORKED                                                      */
/* ================================================================== */

describe("days worked", () => {
  it("pays a daily-rate casual for exactly the days recorded (31)", async () => {
    const { db, close, session, userId } = await setup();
    const employeeId = await seedEmployee(db, {
      employmentType: "CASUAL",
      wagePeriod: "DAILY",
      basicWageKes: "500.00",
    });
    await present(db, employeeId, "2026-08-01", 31, userId);

    const run = await runPayroll(session, AUG, db);
    if (!run.ok) throw new Error(run.error);
    const slip = await slipFor(db, run.data.runId, employeeId);
    expect(slip.daysWorked).toBe("31.00");
    expect(slip.basicKes).toBe("15500.00");
    expect(slip.grossKes).toBe("15500.00");
    await close();
  });

  it("refuses a negative attendance day", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db);
    const res = await recordAttendance(session, { employeeId, workedOn: "2026-08-01", days: -1 }, db);
    expect(res.ok).toBe(false);
    await close();
  });

  it("counts attendance from OTHER months out of the run", async () => {
    const { db, close, session, userId } = await setup();
    const employeeId = await seedEmployee(db, { wagePeriod: "DAILY", basicWageKes: "500.00" });
    await present(db, employeeId, "2026-07-20", 20, userId); // spans July into August
    const run = await runPayroll(session, AUG, db);
    if (!run.ok) throw new Error(run.error);
    const slip = await slipFor(db, run.data.runId, employeeId);
    // 2026-07-20 + 20 days runs to 2026-08-08, so 8 days fall in August.
    expect(slip.daysWorked).toBe("8.00");
    await close();
  });

  /**
   * DEFECT — HIGH. `attendance.days` is capped at 2 per row but the MONTH is not
   * capped at all, so 31 double-days pay a casual 62 days in a 31-day month.
   * A fat-fingered "2" on every row silently doubles the wage bill.
   */
  it.fails("must not pay more days than the month contains", async () => {
    const { db, close, session, userId } = await setup();
    const employeeId = await seedEmployee(db, {
      employmentType: "CASUAL",
      wagePeriod: "DAILY",
      basicWageKes: "500.00",
    });
    for (let i = 0; i < 31; i++) {
      await db.insert(s.attendance).values({
        id: newId(),
        farmId: FARM_ID,
        employeeId,
        workedOn: addDays("2026-08-01", i),
        days: "2.00",
        recordedBy: userId,
      });
    }
    const run = await runPayroll(session, AUG, db);
    if (!run.ok) throw new Error(run.error);
    const slip = await slipFor(db, run.data.runId, employeeId);
    expect(Number(slip.daysWorked)).toBeLessThanOrEqual(31);
    await close();
  });

  /**
   * DEFECT — MEDIUM. `consecutiveDaysWorked` counts the PRESENCE of an
   * attendance row, never the `days` value. A run of "0 day" rows — the natural
   * way to record "engaged but idle" — pushes a casual over the 30-day
   * conversion threshold and fires a tribunal-risk warning that is not real.
   */
  it.fails("a run of zero-day attendance rows is not continuous work", async () => {
    const { db, close, session, userId } = await setup();
    const employeeId = await seedEmployee(db, { employmentType: "CASUAL" });
    for (let i = 0; i < 32; i++) {
      await db.insert(s.attendance).values({
        id: newId(),
        farmId: FARM_ID,
        employeeId,
        workedOn: addDays("2026-08-01", i),
        days: "0.00",
        recordedBy: userId,
      });
    }
    expect(await consecutiveDaysWorked(session, employeeId, "2026-09-01", db)).toBe(0);
    await close();
  });
});

/* ================================================================== */
/* 5. RUNNING PAYROLL TWICE — nobody gets paid twice                   */
/* ================================================================== */

describe("re-running payroll", () => {
  it("does not double-pay a DRAFT month", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db, { basicWageKes: "12000.00" });

    const first = await runPayroll(session, AUG, db);
    const second = await runPayroll(session, AUG, db);
    if (!first.ok || !second.ok) throw new Error("run failed");

    expect(second.data.runId).toBe(first.data.runId);
    expect(second.data.totalNetKes).toBe(first.data.totalNetKes);

    const runs = await db.select().from(s.payrollRun).where(eq(s.payrollRun.farmId, FARM_ID));
    expect(runs).toHaveLength(1);
    const slips = await db.select().from(s.payslip).where(eq(s.payslip.employeeId, employeeId));
    expect(slips).toHaveLength(1);
    await close();
  });

  it("refuses to re-run an APPROVED month", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    const run = await runPayroll(session, AUG, db);
    if (!run.ok) throw new Error(run.error);
    expect((await approvePayroll(session, run.data.runId, db)).ok).toBe(true);

    const again = await runPayroll(session, AUG, db);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("already approved");
    await close();
  });

  it("approving twice is a no-op, not a second approval", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    const run = await runPayroll(session, AUG, db);
    if (!run.ok) throw new Error(run.error);
    await approvePayroll(session, run.data.runId, db);
    const twice = await approvePayroll(session, run.data.runId, db);
    expect(twice.ok).toBe(true);
    if (twice.ok) expect(twice.message).toBe("Already approved.");
    await close();
  });

  it("marking paid twice posts ONE wage-bill expense, not two", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, { basicWageKes: "12000.00" });
    const run = await runPayroll(session, AUG, db);
    if (!run.ok) throw new Error(run.error);
    await approvePayroll(session, run.data.runId, db);

    const paid = await markPaid(session, { runId: run.data.runId, paidOn: "2026-09-05" }, db);
    const again = await markPaid(session, { runId: run.data.runId, paidOn: "2026-09-05" }, db);
    expect(paid.ok && again.ok).toBe(true);
    if (again.ok) expect(again.data.expenseId).toBeNull();

    const expenses = await db.select().from(s.expense).where(eq(s.expense.farmId, FARM_ID));
    expect(expenses).toHaveLength(1);
    // Gross 12,000 + employer NSSF 720 + employer levy 180 = 12,900.00 exactly.
    expect(expenses[0].amountKes).toBe("12900.00");
    // And it lands PENDING — the wage bill does not move the books on its own.
    expect(expenses[0].status).toBe("PENDING");
    await close();
  });

  it("refuses to mark a DRAFT payroll as paid", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    const run = await runPayroll(session, AUG, db);
    if (!run.ok) throw new Error(run.error);
    const res = await markPaid(session, { runId: run.data.runId, paidOn: "2026-09-05" }, db);
    expect(res.ok).toBe(false);
    await close();
  });

  it("the wage bill stays out of month-to-date until approved", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, { basicWageKes: "12000.00" });
    const run = await runPayroll(session, AUG, db);
    if (!run.ok) throw new Error(run.error);
    await approvePayroll(session, run.data.runId, db);
    await markPaid(session, { runId: run.data.runId, paidOn: "2026-09-05" }, db);

    const sept = await monthToDate(session, "2026-09-30", db);
    expect(sept.expenseKes).toBe(0);
    expect(sept.pendingKes).toBe(12_900);
    await close();
  });
});

describe("payroll with nothing in it", () => {
  it("runs a month with no employees without crashing", async () => {
    const { db, close, session } = await setup();
    const run = await runPayroll(session, AUG, db);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.data.payslips).toHaveLength(0);
    expect(run.data.totalGrossKes).toBe(0);
    expect(run.data.totalNetKes).toBe(0);
    expect(run.data.headline).toContain("0 people");
    await close();
  });

  it("reports a not-yet-run month as NOT_RUN rather than KES 0 due", async () => {
    const { db, close, session } = await setup();
    const rem = await remittanceSummary(session, AUG, db);
    expect(rem.status).toBe("NOT_RUN");
    expect(rem.headline).toContain("has not been run yet");
    await close();
  });

  it("rejects a malformed month string with a readable message", async () => {
    const { db, close, session } = await setup();
    const res = await runPayroll(session, "August", db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Give the month as 2026-08.");
    expect(() => normaliseMonth("2026-8")).toThrow();
    await close();
  });
});

/* ================================================================== */
/* 6. THE APPROVAL BOUNDARY IN PAYROLL                                 */
/* ================================================================== */

describe("who may do what", () => {
  it("an ACCOUNTANT may not run payroll", async () => {
    const { db, close, session } = await setup("ACCOUNTANT");
    await seedEmployee(db);
    const res = await runPayroll(session, AUG, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/does not include this/i);
    await close();
  });

  it("a HERDSMAN may not run, approve or read payroll", async () => {
    const { db, close, session } = await setup("HERDSMAN");
    await seedEmployee(db);
    expect((await runPayroll(session, AUG, db)).ok).toBe(false);
    expect((await approvePayroll(session, newId(), db)).ok).toBe(false);
    await expect(listEmployees(session, undefined, db)).rejects.toThrow(/does not include this/i);
    await expect(remittanceSummary(session, AUG, db)).rejects.toThrow(/does not include this/i);
    await close();
  });

  it("an ACCOUNTANT may not approve a payroll run", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    const run = await runPayroll(session, AUG, db);
    if (!run.ok) throw new Error(run.error);

    const accountant = fakeSession({ role: "ACCOUNTANT", userId: await seedUser(db, { role: "ACCOUNTANT" }) });
    const res = await approvePayroll(accountant, run.data.runId, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/does not include this/i);
    await close();
  });

  /**
   * DEFECT — MEDIUM. The module docstring promises "the person who records is
   * not the person who approves", but one MANAGER can run, approve and mark paid
   * the same payroll with no second pair of eyes anywhere in the chain. On a
   * Kenyan farm this is precisely the concentration the segregation exists to
   * break.
   */
  it.fails("the manager who ran payroll must not be able to approve it alone", async () => {
    const { db, close, session, userId } = await setup();
    await seedEmployee(db);
    const run = await runPayroll(session, AUG, db);
    if (!run.ok) throw new Error(run.error);
    const approved = await approvePayroll(session, run.data.runId, db);
    expect(approved.ok).toBe(false); // same userId ran it — should be refused
    void userId;
    await close();
  });

  /**
   * DEFECT — MEDIUM. `remittanceSummary` sums the payslips of a DRAFT run. A
   * draft that nobody approved already tells the farm what to send KRA and SHA
   * by the 9th. Everywhere else in this system a draft moves no total.
   */
  it.fails("a DRAFT payroll must not produce a statutory liability", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, { basicWageKes: "12000.00" });
    const run = await runPayroll(session, AUG, db);
    if (!run.ok) throw new Error(run.error);
    const rem = await remittanceSummary(session, AUG, db);
    expect(rem.status).toBe("DRAFT");
    expect(rem.totalKes).toBe(0);
    await close();
  });
});

/* ================================================================== */
/* 7. TENANCY — every exported function, cross-farm                    */
/* ================================================================== */

describe("tenancy", () => {
  it("refuses another farm's employee identically to one that does not exist", async () => {
    const { db, close, session } = await setup();
    const theirs = await seedOtherFarm(db);
    const ghost = newId();

    const a = await getEmployee(session, theirs.employeeId, undefined, db).catch((e: Error) => e.message);
    const b = await getEmployee(session, ghost, undefined, db).catch((e: Error) => e.message);
    expect(a).toBe("That employee was not found.");
    expect(b).toBe(a); // identical — no existence leak

    const c = await recordAttendance(session, { employeeId: theirs.employeeId, workedOn: "2026-08-01" }, db);
    const d = await recordAttendance(session, { employeeId: ghost, workedOn: "2026-08-01" }, db);
    expect(c.ok).toBe(false);
    expect(d.ok).toBe(false);
    if (!c.ok && !d.ok) expect(c.error).toBe(d.error);

    const e1 = await recordLeave(
      session,
      { employeeId: theirs.employeeId, leaveType: "ANNUAL", fromDate: "2026-08-01", toDate: "2026-08-05" },
      db,
    );
    expect(e1.ok).toBe(false);

    const f = await updateEmployee(session, theirs.employeeId, { fullName: "Hijacked" }, db);
    expect(f.ok).toBe(false);
    const [still] = await db.select().from(s.employee).where(eq(s.employee.id, theirs.employeeId));
    expect(still.fullName).toBe("Their herdsman");
    await close();
  });

  it("refuses another farm's payroll run", async () => {
    const { db, close, session } = await setup();
    const theirs = await seedOtherFarm(db);
    const res = await approvePayroll(session, theirs.runId, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("That payroll run was not found.");
    const paid = await markPaid(session, { runId: theirs.runId, paidOn: "2026-09-05" }, db);
    expect(paid.ok).toBe(false);
    await close();
  });

  it("never pays another farm's staff and never reads their run", async () => {
    const { db, close, session } = await setup();
    await seedOtherFarm(db);
    await seedEmployee(db, { fullName: "Our herdsman", basicWageKes: "12000.00" });

    const run = await runPayroll(session, AUG, db);
    if (!run.ok) throw new Error(run.error);
    expect(run.data.payslips).toHaveLength(1);
    expect(run.data.payslips[0].fullName).toBe("Our herdsman");

    // Our run is a different row from theirs, for the same period.
    const view = await getPayrollRun(session, AUG, db);
    expect(view!.runId).toBe(run.data.runId);
    expect(view!.payslips).toHaveLength(1);

    expect((await listEmployees(session, undefined, db)).map((e) => e.fullName)).toEqual(["Our herdsman"]);
    expect((await minimumWageReport(session, db)).rows).toHaveLength(1);
    expect(await casualConversionWatch(session, "2026-08-31", db)).toHaveLength(0);
    await close();
  });

  it("does not let a well-formed foreign appUserId onto our employee record", async () => {
    const { db, close, session } = await setup();
    await db.insert(s.farm).values({ id: OTHER_FARM, name: "Rival" }).onConflictDoNothing();
    const foreignUser = newId();
    await db.insert(s.appUser).values({
      id: foreignUser,
      farmId: OTHER_FARM,
      fullName: "Their manager",
      role: "MANAGER",
      pinHash: "x",
    });
    const res = await createEmployee(
      session,
      {
        fullName: "Trojan",
        role: "HERDSMAN",
        employmentType: "PERMANENT",
        startedOn: "2026-08-01",
        appUserId: foreignUser,
      },
      db,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("That user was not found.");
    await close();
  });
});

/* ================================================================== */
/* 8. TEXT FIELDS — unicode and injection-shaped input                 */
/* ================================================================== */

describe("hostile text", () => {
  it("stores unicode and SQL-shaped names verbatim and leaves the table standing", async () => {
    const { db, close, session } = await setup();
    const nasty = "Robert'); DROP TABLE employee;--";
    const unicode = "Wanjirũ Njeri 🐄 Müller  ";

    const a = await createEmployee(
      session,
      { fullName: nasty, role: "HERDSMAN", employmentType: "CASUAL", startedOn: "2026-08-01" },
      db,
    );
    const b = await createEmployee(
      session,
      { fullName: unicode, role: "MILKER", employmentType: "PERMANENT", startedOn: "2026-08-01" },
      db,
    );
    expect(a.ok && b.ok).toBe(true);

    const rows = await db.select().from(s.employee).where(eq(s.employee.farmId, FARM_ID));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.fullName).sort()).toEqual([nasty, unicode].sort());
    await close();
  });

  it("does not blow up on a role that collides with an Object prototype key", () => {
    expect(minimumWageCheck("constructor", 5_000)).toEqual({ below: false });
    expect(minimumWageCheck("toString", 5_000)).toEqual({ below: false });
    expect(minimumWageCheck("__proto__", 5_000)).toEqual({ below: false });
  });

  it("treats an unknown role as 'no gazetted minimum' rather than compliant", () => {
    // "Farm manager" is NOT in the gazetted table (it lists FARM_FOREMAN /
    // FARM_CLERK), so a manager on KES 3,000 is silently reported as fine.
    expect(minimumWageCheck("FARM_MANAGER", 3_000).below).toBe(false);
    expect(minimumWageCheck("HERDSMAN", 3_000).below).toBe(true);
  });
});
