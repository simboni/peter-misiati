import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { seedFarm, seedEmployee, seedUser, fakeSession, FARM_ID } from "@/test/factory";
import * as s from "@/db/schema";
import { newId } from "@/lib/ids";
import { addDays } from "@/lib/domain/dates";
import {
  approvePayroll,
  casualConversionWatch,
  consecutiveDaysWorked,
  createEmployee,
  getPayrollRun,
  listEmployees,
  markPaid,
  minimumWageReport,
  normaliseMonth,
  recordAttendance,
  recordLeave,
  remittanceSummary,
  runPayroll,
} from "./people";

const OTHER_FARM = "22222222-2222-4222-8222-222222222222";

async function setup() {
  const { db, close } = await createTestDb();
  await seedFarm(db);
  const userId = await seedUser(db, { role: "MANAGER", fullName: "Grace Wanjiru" });
  return { db, close, session: fakeSession({ role: "MANAGER", userId }) };
}

async function markPresent(
  db: TestDb,
  employeeId: string,
  from: string,
  days: number,
  userId: string,
) {
  for (let i = 0; i < days; i++) {
    await db.insert(s.attendance).values({
      id: newId(),
      farmId: FARM_ID,
      employeeId,
      workedOn: addDays(from, i),
      days: "1.00",
      recordedBy: userId,
    });
  }
}

/* ================================================================== */
/* THE CASE THAT MATTERS                                              */
/* ================================================================== */

describe("payroll for the KES 12,000 herdsman", () => {
  it("is exactly right — zero PAYE, and NSSF, SHIF and the levy all still due", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, { fullName: "Kamau Mwangi", role: "HERDSMAN" });

    const run = await runPayroll(session, "2026-08", db);
    if (!run.ok) throw new Error(run.error);
    expect(run.data.payslips).toHaveLength(1);

    const slip = run.data.payslips[0].slip;
    expect(slip.grossKes).toBe(12_000);
    expect(slip.payeKes).toBe(0);
    expect(slip.nssfTier1Kes).toBe(540);
    expect(slip.nssfTier2Kes).toBe(180);
    expect(slip.shifKes).toBe(330);
    expect(slip.housingLevyKes).toBe(180);
    expect(slip.netKes).toBe(10_770);
    await close();
  });

  it("persists every one of those figures on the payslip row", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db);
    const run = await runPayroll(session, "2026-08", db);
    if (!run.ok) throw new Error(run.error);

    const [row] = await db.select().from(s.payslip).where(eq(s.payslip.employeeId, employeeId));
    expect(row.grossKes).toBe("12000.00");
    expect(row.payeKes).toBe("0.00");
    expect(row.nssfTier1Kes).toBe("540.00");
    expect(row.nssfTier2Kes).toBe("180.00");
    expect(row.shifKes).toBe("330.00");
    expect(row.housingLevyKes).toBe("180.00");
    expect(row.netKes).toBe("10770.00");
    // Employer cost is reported, never deducted from his net.
    expect(row.employerNssfKes).toBe("720.00");
    expect(row.employerHousingLevyKes).toBe("180.00");
    await close();
  });

  it("costs the farm more than it pays him, and says so", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    const run = await runPayroll(session, "2026-08", db);
    if (!run.ok) throw new Error(run.error);

    expect(run.data.totalGrossKes).toBe(12_000);
    expect(run.data.totalNetKes).toBe(10_770);
    expect(run.data.totalEmployerCostKes).toBe(900);
    expect(run.data.headline).toContain("employer contributions");
    await close();
  });

  it("pays a housing allowance when the farm does not house him", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, { housingProvided: false });
    const run = await runPayroll(session, "2026-08", db);
    if (!run.ok) throw new Error(run.error);

    const slip = run.data.payslips[0].slip;
    expect(slip.housingAllowKes).toBe(1_800);
    expect(slip.grossKes).toBe(13_800);
    expect(slip.payeKes).toBe(0);
    await close();
  });
});

/* ================================================================== */
/* Idempotency                                                        */
/* ================================================================== */

describe("payroll runs are idempotent per month", () => {
  it("produces one run and one payslip each, however many times it is run", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, { fullName: "Kamau Mwangi" });
    await seedEmployee(db, { fullName: "Otieno Ochieng", basicWageKes: "15000.00" });

    const first = await runPayroll(session, "2026-08", db);
    const second = await runPayroll(session, "2026-08", db);
    const third = await runPayroll(session, "2026-08-17", db); // same month, different date
    if (!first.ok || !second.ok || !third.ok) throw new Error("run failed");

    expect(second.data.runId).toBe(first.data.runId);
    expect(third.data.runId).toBe(first.data.runId);

    expect(await db.select().from(s.payrollRun)).toHaveLength(1);
    expect(await db.select().from(s.payslip)).toHaveLength(2);
    await close();
  });

  it("keeps separate runs for separate months", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    await runPayroll(session, "2026-07", db);
    await runPayroll(session, "2026-08", db);
    expect(await db.select().from(s.payrollRun)).toHaveLength(2);
    await close();
  });

  it("refreshes a DRAFT when the wage was corrected between runs", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db);
    await runPayroll(session, "2026-08", db);

    await db
      .update(s.employee)
      .set({ basicWageKes: "18000.00" })
      .where(eq(s.employee.id, employeeId));

    const rerun = await runPayroll(session, "2026-08", db);
    if (!rerun.ok) throw new Error(rerun.error);
    expect(rerun.data.payslips[0].slip.grossKes).toBe(18_000);
    expect(await db.select().from(s.payslip)).toHaveLength(1);
    await close();
  });

  it("refuses to re-run an approved payroll — a payslip somebody was paid on is not a draft", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    const run = await runPayroll(session, "2026-08", db);
    if (!run.ok) throw new Error(run.error);
    await approvePayroll(session, run.data.runId, db);

    const rerun = await runPayroll(session, "2026-08", db);
    expect(rerun.ok).toBe(false);
    if (!rerun.ok) expect(rerun.error).toMatch(/already approved/i);
    await close();
  });

  it("accepts the month written as 2026-08 or as any date inside it", () => {
    expect(normaliseMonth("2026-08")).toBe("2026-08-01");
    expect(normaliseMonth("2026-08-17")).toBe("2026-08-01");
    expect(() => normaliseMonth("August")).toThrow();
  });
});

/* ================================================================== */
/* Days worked and daily casuals                                      */
/* ================================================================== */

describe("attendance drives a daily wage", () => {
  it("pays a casual for the days he actually worked", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db, {
      fullName: "Mwangi Kariuki",
      role: "CASUAL",
      employmentType: "CASUAL",
      basicWageKes: "500.00",
      wagePeriod: "DAILY",
      startedOn: "2026-08-01",
    });
    await markPresent(db, employeeId, "2026-08-01", 18, session.userId);

    const run = await runPayroll(session, "2026-08", db);
    if (!run.ok) throw new Error(run.error);
    expect(run.data.payslips[0].daysWorked).toBe(18);
    expect(run.data.payslips[0].slip.basicKes).toBe(9_000);
    // Casuals owe NSSF, SHIF and the Housing Levy exactly as permanent staff do.
    expect(run.data.payslips[0].slip.nssfTotalKes).toBe(540);
    expect(run.data.payslips[0].slip.shifKes).toBe(300); // the minimum bites
    expect(run.data.payslips[0].slip.payeKes).toBe(0);
    await close();
  });

  it("counts only days inside the payroll month", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db, {
      role: "CASUAL",
      employmentType: "CASUAL",
      basicWageKes: "500.00",
      wagePeriod: "DAILY",
      startedOn: "2026-07-01",
    });
    await markPresent(db, employeeId, "2026-07-25", 20, session.userId); // spans into August

    const july = await runPayroll(session, "2026-07", db);
    if (!july.ok) throw new Error(july.error);
    expect(july.data.payslips[0].daysWorked).toBe(7); // 25–31 July
    await close();
  });

  it("leaves out anyone who had already left before the month", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, { fullName: "Gone Already", endedOn: "2026-06-30" });
    await seedEmployee(db, { fullName: "Still Here" });

    const run = await runPayroll(session, "2026-08", db);
    if (!run.ok) throw new Error(run.error);
    expect(run.data.payslips.map((p) => p.fullName)).toEqual(["Still Here"]);
    await close();
  });

  it("records a day once, however many times the outbox flushes it", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db);
    const input = { employeeId, workedOn: "2026-08-03", days: 1 };

    await recordAttendance(session, input, db);
    await recordAttendance(session, input, db);

    expect(await db.select().from(s.attendance)).toHaveLength(1);
    await close();
  });
});

/* ================================================================== */
/* THE CASUAL CONVERSION TRAP                                         */
/* ================================================================== */

describe("casual conversion warning", () => {
  it("stays quiet in the first three weeks", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db, {
      fullName: "Mwangi Kariuki",
      employmentType: "CASUAL",
      startedOn: "2026-08-01",
    });
    await markPresent(db, employeeId, "2026-08-01", 20, session.userId);

    expect(await consecutiveDaysWorked(session, employeeId, "2026-08-20", db)).toBe(20);
    expect(await casualConversionWatch(session, "2026-08-20", db)).toHaveLength(0);
    await close();
  });

  it("FIRES at 25 days, five days before the threshold", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db, {
      fullName: "Mwangi Kariuki",
      employmentType: "CASUAL",
      startedOn: "2026-08-01",
    });
    await markPresent(db, employeeId, "2026-08-01", 25, session.userId);

    const alerts = await casualConversionWatch(session, "2026-08-25", db);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].warning.warn).toBe(true);
    expect(alerts[0].warning.converted).toBe(false);
    expect(alerts[0].warning.message).toContain("Mwangi Kariuki");
    await close();
  });

  it("reports him as CONVERTED past 30 days — by operation of law, not our choice", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db, {
      fullName: "Mwangi Kariuki",
      employmentType: "CASUAL",
      startedOn: "2026-08-01",
    });
    await markPresent(db, employeeId, "2026-08-01", 35, session.userId);

    const alerts = await casualConversionWatch(session, "2026-09-04", db);
    expect(alerts[0].warning.converted).toBe(true);
    expect(alerts[0].warning.daysWorked).toBe(35);
    expect(alerts[0].warning.message).toMatch(/no longer a casual/i);
    await close();
  });

  it("resets the run when he takes a day off — continuity is what the Act turns on", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db, {
      fullName: "Mwangi Kariuki",
      employmentType: "CASUAL",
      startedOn: "2026-08-01",
    });
    await markPresent(db, employeeId, "2026-08-01", 20, session.userId);
    // 21 August off, then back for five days.
    await markPresent(db, employeeId, "2026-08-22", 5, session.userId);

    expect(await consecutiveDaysWorked(session, employeeId, "2026-08-26", db)).toBe(5);
    expect(await casualConversionWatch(session, "2026-08-26", db)).toHaveLength(0);
    await close();
  });

  it("warns on the attendance entry itself, not only on a report", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db, {
      fullName: "Mwangi Kariuki",
      employmentType: "CASUAL",
      startedOn: "2026-08-01",
    });
    await markPresent(db, employeeId, "2026-08-01", 27, session.userId);

    const saved = await recordAttendance(
      session,
      { employeeId, workedOn: "2026-08-28", days: 1 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.data.consecutiveDays).toBe(28);
    expect(saved.data.casual.warn).toBe(true);
    expect(saved.message).toMatch(/term employee/i);
    await close();
  });

  it("says nothing about a permanent employee, however long the run", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db, { employmentType: "PERMANENT", startedOn: "2026-08-01" });
    await markPresent(db, employeeId, "2026-08-01", 40, session.userId);
    expect(await casualConversionWatch(session, "2026-09-09", db)).toHaveLength(0);
    await close();
  });

  it("shows the warning on the staff list too", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db, {
      fullName: "Mwangi Kariuki",
      employmentType: "CASUAL",
      startedOn: "2026-08-01",
    });
    await markPresent(db, employeeId, "2026-08-01", 33, session.userId);

    const list = await listEmployees(session, "2026-09-02", db);
    expect(list[0].casual.converted).toBe(true);
    expect(list[0].consecutiveDays).toBe(33);
    await close();
  });
});

/* ================================================================== */
/* Remittances                                                        */
/* ================================================================== */

describe("remittance summary", () => {
  it("totals what is due by the 9th, head by head", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, { fullName: "Kamau Mwangi" }); // 12,000
    await seedEmployee(db, { fullName: "Otieno Ochieng", basicWageKes: "12000.00" });
    await runPayroll(session, "2026-08", db);

    const r = await remittanceSummary(session, "2026-08", db);
    expect(r.dueOn).toBe("2026-09-09");
    expect(r.headcount).toBe(2);

    const line = (head: string) => r.lines.find((l) => l.head === head)!;
    expect(line("PAYE").totalKes).toBe(0);
    // NSSF 720 each, matched by the farm: 1,440 + 1,440.
    expect(line("NSSF").employeeKes).toBe(1_440);
    expect(line("NSSF").employerKes).toBe(1_440);
    expect(line("NSSF").totalKes).toBe(2_880);
    expect(line("SHIF").employeeKes).toBe(660);
    expect(line("HOUSING_LEVY").employeeKes).toBe(360);
    expect(line("HOUSING_LEVY").employerKes).toBe(360);
    expect(r.totalKes).toBe(2_880 + 660 + 720);
    await close();
  });

  it("names the zero-PAYE month rather than showing a bare zero", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    await runPayroll(session, "2026-08", db);

    const r = await remittanceSummary(session, "2026-08", db);
    expect(r.headline).toMatch(/no paye this month/i);
    expect(r.headline).toMatch(/personal relief/i);
    await close();
  });

  it("charges real PAYE for a manager above the relief", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, {
      fullName: "Grace Wanjiru",
      role: "FARM_MANAGER",
      basicWageKes: "150000.00",
    });
    await runPayroll(session, "2026-08", db);

    const r = await remittanceSummary(session, "2026-08", db);
    expect(r.lines.find((l) => l.head === "PAYE")!.totalKes).toBeCloseTo(33_526.85, 2);
    await close();
  });

  it("says plainly when payroll has not been run", async () => {
    const { db, close, session } = await setup();
    const r = await remittanceSummary(session, "2026-08", db);
    expect(r.status).toBe("NOT_RUN");
    expect(r.totalKes).toBe(0);
    expect(r.headline).toMatch(/has not been run/i);
    await close();
  });

  it("names who each head is paid to, so nobody has to remember", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    await runPayroll(session, "2026-08", db);
    const r = await remittanceSummary(session, "2026-08", db);
    expect(r.lines.map((l) => l.payTo)).toEqual([
      "KRA — iTax",
      "NSSF",
      "SHA",
      "KRA — Housing Levy",
    ]);
    await close();
  });
});

/* ================================================================== */
/* Approval and payment                                               */
/* ================================================================== */

describe("approve and pay", () => {
  it("moves a run DRAFT → APPROVED → PAID and no other way", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    const run = await runPayroll(session, "2026-08", db);
    if (!run.ok) throw new Error(run.error);

    // Cannot pay before approving.
    const early = await markPaid(session, { runId: run.data.runId, paidOn: "2026-09-01" }, db);
    expect(early.ok).toBe(false);

    expect((await approvePayroll(session, run.data.runId, db)).ok).toBe(true);
    expect((await markPaid(session, { runId: run.data.runId, paidOn: "2026-09-01" }, db)).ok).toBe(true);

    const after = await getPayrollRun(session, "2026-08", db);
    expect(after?.status).toBe("PAID");
    await close();
  });

  it("needs the APPROVE capability, which an accountant does not have", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    const run = await runPayroll(session, "2026-08", db);
    if (!run.ok) throw new Error(run.error);

    const accountant = fakeSession({ role: "ACCOUNTANT" });
    expect((await approvePayroll(accountant, run.data.runId, db)).ok).toBe(false);
    await close();
  });

  it("posts the wage bill to the cash book as PENDING, like every other cost", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    const run = await runPayroll(session, "2026-08", db);
    if (!run.ok) throw new Error(run.error);
    await approvePayroll(session, run.data.runId, db);
    const paid = await markPaid(
      session,
      { runId: run.data.runId, paidOn: "2026-09-01", paymentMethod: "MPESA" },
      db,
    );
    if (!paid.ok) throw new Error(paid.error);

    const [expense] = await db.select().from(s.expense).where(eq(s.expense.id, paid.data.expenseId!));
    expect(expense.category).toBe("LABOUR");
    expect(expense.status).toBe("PENDING");
    // Gross 12,000 plus the farm's own 900 of contributions.
    expect(expense.amountKes).toBe("12900.00");
    await close();
  });

  it("stamps the payment details onto every payslip", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, { fullName: "A" });
    await seedEmployee(db, { fullName: "B" });
    const run = await runPayroll(session, "2026-08", db);
    if (!run.ok) throw new Error(run.error);
    await approvePayroll(session, run.data.runId, db);
    await markPaid(
      session,
      { runId: run.data.runId, paidOn: "2026-09-01", paymentMethod: "MPESA", mpesaRef: "SGH9XT1" },
      db,
    );

    const slips = await db.select().from(s.payslip);
    expect(slips.every((p) => p.paidOn === "2026-09-01" && p.mpesaRef === "SGH9XT1")).toBe(true);
    await close();
  });

  it("reads the run back with the same figures it was written with", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    await runPayroll(session, "2026-08", db);

    const read = await getPayrollRun(session, "2026-08", db);
    expect(read?.payslips[0].slip.netKes).toBe(10_770);
    expect(read?.payslips[0].slip.nssfTotalKes).toBe(720);
    expect(read?.payslips[0].slip.costToFarmKes).toBe(12_900);
    expect(read?.totalNetKes).toBe(10_770);
    await close();
  });
});

/* ================================================================== */
/* Cross-farm                                                         */
/* ================================================================== */

describe("cross-farm access", () => {
  it("will not approve another farm's payroll", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    const run = await runPayroll(session, "2026-08", db);
    if (!run.ok) throw new Error(run.error);

    const intruder = fakeSession({ role: "OWNER", farmId: OTHER_FARM });
    const attempt = await approvePayroll(intruder, run.data.runId, db);
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.error).toBe("That payroll run was not found.");
    await close();
  });

  it("will not mark another farm's payroll paid", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    const run = await runPayroll(session, "2026-08", db);
    if (!run.ok) throw new Error(run.error);
    await approvePayroll(session, run.data.runId, db);

    const intruder = fakeSession({ role: "OWNER", farmId: OTHER_FARM });
    expect(
      (await markPaid(intruder, { runId: run.data.runId, paidOn: "2026-09-01" }, db)).ok,
    ).toBe(false);
    await close();
  });

  it("will not record attendance against another farm's employee", async () => {
    const { db, close } = await setup();
    const employeeId = await seedEmployee(db);
    const intruder = fakeSession({ role: "OWNER", farmId: OTHER_FARM });
    const attempt = await recordAttendance(
      intruder,
      { employeeId, workedOn: "2026-08-03", days: 1 },
      db,
    );
    expect(attempt.ok).toBe(false);
    expect(await db.select().from(s.attendance)).toHaveLength(0);
    await close();
  });

  it("runs another farm's payroll over an empty staff list, never over ours", async () => {
    const { db, close } = await setup();
    await seedEmployee(db);
    const intruder = fakeSession({ role: "OWNER", farmId: OTHER_FARM });
    const run = await runPayroll(intruder, "2026-08", db);
    if (!run.ok) throw new Error(run.error);
    expect(run.data.payslips).toHaveLength(0);
    await close();
  });
});

/* ================================================================== */
/* Onboarding, leave, minimum wage                                    */
/* ================================================================== */

describe("onboarding", () => {
  it("saves the statutory paperwork and names what is still missing", async () => {
    const { db, close, session } = await setup();
    const saved = await createEmployee(
      session,
      {
        fullName: "Otieno Ochieng",
        role: "HERDSMAN",
        employmentType: "PERMANENT",
        startedOn: "2026-08-01",
        basicWageKes: 12_000,
        wagePeriod: "MONTHLY",
        housingProvided: true,
        nationalId: "28374651",
        kraPin: "A001234567X",
        nextOfKin: "Akinyi Ochieng, 0722000333",
      },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);

    const [row] = await db.select().from(s.employee).where(eq(s.employee.id, saved.data.id));
    expect(row.nationalId).toBe("28374651");
    expect(row.kraPin).toBe("A001234567X");
    expect(row.nextOfKin).toContain("Akinyi");
    // Missing paperwork is reported, never a blocker (R4).
    expect(saved.data.missingPaperwork).toEqual(["NSSF number", "SHA / SHIF number"]);
    await close();
  });

  it("SAVES a wage below the gazetted minimum, and says so", async () => {
    const { db, close, session } = await setup();
    const saved = await createEmployee(
      session,
      {
        fullName: "Mwangi Kariuki",
        role: "HERDSMAN",
        employmentType: "PERMANENT",
        startedOn: "2026-08-01",
        basicWageKes: 8_000,
        wagePeriod: "MONTHLY",
      },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);
    // A system that refuses to record reality stops being used.
    expect(saved.data.minimumWage.below).toBe(true);
    expect(saved.message).toMatch(/reference, not a rule/i);
    expect(await db.select().from(s.employee)).toHaveLength(1);
    await close();
  });

  it("reports where the whole farm stands against the gazette", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, { fullName: "Below", role: "HERDSMAN", basicWageKes: "8000.00" });
    await seedEmployee(db, { fullName: "Above", role: "HERDSMAN", basicWageKes: "14000.00" });

    const report = await minimumWageReport(session, db);
    expect(report.belowCount).toBe(1);
    expect(report.rows.find((r) => r.fullName === "Below")!.minimumKes).toBe(10_621.15);
    expect(report.note).toMatch(/disputed/i);
    await close();
  });

  it("converts a daily rate to a monthly equivalent before comparing", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, {
      fullName: "Kibarua",
      role: "HERDSMAN",
      basicWageKes: "500.00",
      wagePeriod: "DAILY",
    });
    const report = await minimumWageReport(session, db);
    expect(report.rows[0].monthlyEquivalentKes).toBe(13_000);
    expect(report.rows[0].below).toBe(false);
    await close();
  });
});

describe("leave", () => {
  it("accrues 1.75 days a month and nets off what was taken", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db, { startedOn: "2025-09-01" });

    const saved = await recordLeave(
      session,
      { employeeId, leaveType: "ANNUAL", fromDate: "2026-08-10", toDate: "2026-08-14" },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.data.takenDays).toBe(5);
    // Roughly 11.4 months to 14 Aug 2026 → about 20 days accrued.
    expect(saved.data.accruedDays).toBeGreaterThan(19);
    expect(saved.data.accruedDays).toBeLessThan(21);
    expect(saved.data.balanceDays).toBeCloseTo(saved.data.accruedDays - 5, 2);
    expect(saved.data.overdrawn).toBe(false);
    await close();
  });

  it("WARNS on an overdrawn balance rather than refusing the record (R4)", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db, { startedOn: "2026-07-01" });

    const saved = await recordLeave(
      session,
      { employeeId, leaveType: "ANNUAL", fromDate: "2026-08-01", toDate: "2026-08-20" },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.data.overdrawn).toBe(true);
    expect(saved.message).toMatch(/more annual leave than accrued/i);
    expect(await db.select().from(s.leaveRecord)).toHaveLength(1);
    await close();
  });

  it("counts only annual leave against the balance, not sick or maternity", async () => {
    const { db, close, session } = await setup();
    const employeeId = await seedEmployee(db, { startedOn: "2025-08-01" });
    await recordLeave(
      session,
      { employeeId, leaveType: "SICK_FULL", fromDate: "2026-08-01", toDate: "2026-08-07" },
      db,
    );
    const list = await listEmployees(session, "2026-08-31", db);
    expect(list[0].leaveTakenDays).toBe(0);
    await close();
  });
});
