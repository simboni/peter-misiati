import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { seedFarm, seedAnimal, seedFeedItem, seedCustomer, seedUser, fakeSession, FARM_ID } from "@/test/factory";
import * as s from "@/db/schema";
import { newId } from "@/lib/ids";
import {
  approvalQueue,
  approveExpense,
  approveIncome,
  costOfProduction,
  createCounterparty,
  importMpesaCsv,
  listCounterparties,
  monthToDate,
  parseMpesaAmount,
  parseMpesaCsv,
  parseMpesaDate,
  recordExpense,
  recordIncome,
  reconcileMpesa,
  updateCounterparty,
  voidExpense,
} from "./money";

const OTHER_FARM = "22222222-2222-4222-8222-222222222222";
const AUG = { from: "2026-08-01", to: "2026-08-31" } as const;

async function setup() {
  const { db, close } = await createTestDb();
  await seedFarm(db);
  // The audit trail has a real foreign key to the user, which is the point —
  // provenance is permanent and cannot point at nobody.
  const userId = await seedUser(db, { role: "MANAGER", fullName: "Grace Wanjiru" });
  return { db, close, session: fakeSession({ role: "MANAGER", userId }) };
}

/** 2,000 litres produced in August, spread over two days. */
async function seedMilk(db: TestDb, totalPerDay = 1_000) {
  const animalId = await seedAnimal(db, { tag: "KE-0001" });
  for (const day of ["2026-08-10", "2026-08-11"]) {
    await db.insert(s.milkRecord).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      recordedOn: day,
      session: "MORNING",
      litres: String(totalPerDay.toFixed(2)),
      recordedBy: newId(),
      recordedAt: new Date(),
    });
  }
  return animalId;
}

/* ================================================================== */
/* The rule this module exists to enforce                             */
/* ================================================================== */

describe("PENDING money cannot move a report — APPROVED money can", () => {
  it("keeps a pending expense out of the month-to-date total", async () => {
    const { db, close, session } = await setup();

    const before = await monthToDate(session, "2026-08-31", db);
    expect(before.expenseKes).toBe(0);

    const saved = await recordExpense(
      session,
      { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 12_000, description: "Dairy meal" },
      db,
    );
    expect(saved.ok).toBe(true);

    const after = await monthToDate(session, "2026-08-31", db);
    // PROOF: the row exists, the total has not moved.
    expect(after.expenseKes).toBe(0);
    expect(after.pendingCount).toBe(1);
    expect(after.pendingKes).toBe(12_000);
    await close();
  });

  it("moves the total the moment a manager approves it, and not before", async () => {
    const { db, close, session } = await setup();
    const saved = await recordExpense(
      session,
      { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 12_000 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);

    expect((await monthToDate(session, "2026-08-31", db)).expenseKes).toBe(0);
    const approved = await approveExpense(session, saved.data.id, db);
    expect(approved.ok).toBe(true);

    const after = await monthToDate(session, "2026-08-31", db);
    expect(after.expenseKes).toBe(12_000);
    expect(after.pendingCount).toBe(0);
    await close();
  });

  it("keeps a pending expense out of cost of production too", async () => {
    const { db, close, session } = await setup();
    await seedMilk(db);

    const pending = await recordExpense(
      session,
      { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 60_000 },
      db,
    );
    if (!pending.ok) throw new Error(pending.error);

    const before = await costOfProduction(session, AUG.from, AUG.to, db);
    expect(before.litresProduced).toBe(2_000);
    expect(before.cash.totalKes).toBe(0);
    expect(before.cash.perLitreKes).toBe(0);

    await approveExpense(session, pending.data.id, db);

    const after = await costOfProduction(session, AUG.from, AUG.to, db);
    expect(after.cash.totalKes).toBe(60_000);
    expect(after.cash.perLitreKes).toBe(30);
    await close();
  });

  it("keeps pending income out of the month-to-date total", async () => {
    const { db, close, session } = await setup();
    const saved = await recordIncome(
      session,
      { receivedOn: "2026-08-05", source: "MILK", amountKes: 45_000 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);

    expect((await monthToDate(session, "2026-08-31", db)).incomeKes).toBe(0);
    await approveIncome(session, saved.data.id, db);
    expect((await monthToDate(session, "2026-08-31", db)).incomeKes).toBe(45_000);
    await close();
  });

  it("records everything as PENDING, even when the manager records it himself", async () => {
    const { db, close, session } = await setup();
    const saved = await recordExpense(
      session,
      { incurredOn: "2026-08-05", category: "VETERINARY", amountKes: 3_000 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.data.status).toBe("PENDING");

    const [row] = await db.select().from(s.expense).where(eq(s.expense.id, saved.data.id));
    expect(row.status).toBe("PENDING");
    expect(row.approvedBy).toBeNull();
    await close();
  });

  it("stamps who approved it, so provenance is permanent (R10)", async () => {
    const { db, close, session } = await setup();
    const saved = await recordExpense(
      session,
      { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 1_000 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);
    await approveExpense(session, saved.data.id, db);

    const [row] = await db.select().from(s.expense).where(eq(s.expense.id, saved.data.id));
    expect(row.approvedBy).toBe(session.userId);
    expect(row.recordedBy).toBe(session.userId);

    const audits = await db
      .select()
      .from(s.auditEntry)
      .where(eq(s.auditEntry.rowId, saved.data.id));
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("APPROVE");
    await close();
  });

  it("never lets a voided entry into the books", async () => {
    const { db, close, session } = await setup();
    const saved = await recordExpense(
      session,
      { incurredOn: "2026-08-05", category: "OTHER", amountKes: 5_000 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);

    await voidExpense(session, saved.data.id, db);
    const retry = await approveExpense(session, saved.data.id, db);
    expect(retry.ok).toBe(false);
    expect((await monthToDate(session, "2026-08-31", db)).expenseKes).toBe(0);
    await close();
  });

  it("refuses to approve for anyone without the APPROVE capability", async () => {
    const { db, close, session } = await setup();
    const saved = await recordExpense(
      session,
      { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 1_000 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);

    // An accountant may see and record money. Approving is a separate duty.
    const accountant = fakeSession({ role: "ACCOUNTANT" });
    const attempt = await approveExpense(accountant, saved.data.id, db);
    expect(attempt.ok).toBe(false);
    expect((await monthToDate(session, "2026-08-31", db)).expenseKes).toBe(0);
    await close();
  });

  it("does not let a herdsman record money at all", async () => {
    const { db, close } = await setup();
    const herdsman = fakeSession({ role: "HERDSMAN" });
    const attempt = await recordExpense(
      herdsman,
      { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 1_000 },
      db,
    );
    expect(attempt.ok).toBe(false);
    expect(await db.select().from(s.expense)).toHaveLength(0);
    await close();
  });

  it("lists both sides of the approval queue, oldest first", async () => {
    const { db, close, session } = await setup();
    await recordExpense(session, { incurredOn: "2026-08-09", category: "FEEDS", amountKes: 900 }, db);
    await recordIncome(session, { receivedOn: "2026-08-02", source: "MANURE", amountKes: 4_000 }, db);

    const queue = await approvalQueue(session, db);
    expect(queue).toHaveLength(2);
    expect(queue[0].kind).toBe("INCOME");
    expect(queue[0].onDate).toBe("2026-08-02");
    expect(queue[1].label).toContain("Feeds");
    await close();
  });
});

/* ================================================================== */
/* Cross-farm                                                         */
/* ================================================================== */

describe("cross-farm access", () => {
  it("will not approve another farm's expense", async () => {
    const { db, close, session } = await setup();
    const saved = await recordExpense(
      session,
      { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 1_000 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);

    const intruder = fakeSession({ role: "OWNER", farmId: OTHER_FARM });
    const attempt = await approveExpense(intruder, saved.data.id, db);
    expect(attempt.ok).toBe(false);
    // Identical wording for "missing" and "someone else's" — the existence of
    // another farm's data is not something to leak.
    if (!attempt.ok) expect(attempt.error).toBe("That expense was not found.");

    const [row] = await db.select().from(s.expense).where(eq(s.expense.id, saved.data.id));
    expect(row.status).toBe("PENDING");
    await close();
  });

  it("will not approve another farm's income", async () => {
    const { db, close, session } = await setup();
    const saved = await recordIncome(
      session,
      { receivedOn: "2026-08-05", source: "MILK", amountKes: 1_000 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);

    const intruder = fakeSession({ role: "OWNER", farmId: OTHER_FARM });
    expect((await approveIncome(intruder, saved.data.id, db)).ok).toBe(false);
    await close();
  });

  it("will not attach an expense to another farm's supplier", async () => {
    const { db, close, session } = await setup();
    const supplier = await createCounterparty(session, { name: "Unga Feeds", types: ["FEED_MILLER"] }, db);
    if (!supplier.ok) throw new Error(supplier.error);

    const intruder = fakeSession({ role: "OWNER", farmId: OTHER_FARM });
    const attempt = await recordExpense(
      intruder,
      {
        incurredOn: "2026-08-05",
        category: "FEEDS",
        amountKes: 1_000,
        counterpartyId: supplier.data.id,
      },
      db,
    );
    expect(attempt.ok).toBe(false);
    await close();
  });

  it("shows another farm's totals as empty, never as theirs", async () => {
    const { db, close, session } = await setup();
    const saved = await recordExpense(
      session,
      { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 50_000 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);
    await approveExpense(session, saved.data.id, db);

    const intruder = fakeSession({ role: "OWNER", farmId: OTHER_FARM });
    const theirs = await monthToDate(intruder, "2026-08-31", db);
    expect(theirs.expenseKes).toBe(0);
    await close();
  });
});

/* ================================================================== */
/* Suppliers                                                          */
/* ================================================================== */

describe("suppliers", () => {
  it("creates a typed supplier and lists it with its spend", async () => {
    const { db, close, session } = await setup();
    const created = await createCounterparty(
      session,
      { name: "Limuru Agrovet", types: ["AGROVET", "VET"], phone: "0722000111", paymentTerms: "CASH" },
      db,
    );
    if (!created.ok) throw new Error(created.error);

    const expense = await recordExpense(
      session,
      {
        incurredOn: "2026-08-05",
        category: "VETERINARY",
        amountKes: 4_500,
        counterpartyId: created.data.id,
      },
      db,
    );
    if (!expense.ok) throw new Error(expense.error);
    await approveExpense(session, expense.data.id, db);

    const list = await listCounterparties(session, db);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Limuru Agrovet");
    expect(list[0].types).toEqual(["AGROVET", "VET"]);
    expect(list[0].spendKes).toBe(4_500);
    expect(list[0].lastPurchaseOn).toBe("2026-08-05");
    await close();
  });

  it("lets the co-op be both a milk customer and a supplier", async () => {
    const { db, close, session } = await setup();
    const customerId = await seedCustomer(db);
    const created = await createCounterparty(
      session,
      { name: "Limuru Dairy Co-operative", types: ["COOP", "AGROVET"], customerId },
      db,
    );
    expect(created.ok).toBe(true);

    const [row] = await db.select().from(s.counterparty).where(eq(s.counterparty.farmId, FARM_ID));
    expect(row.customerId).toBe(customerId);
    await close();
  });

  it("rejects a supplier with no type", async () => {
    const { db, close, session } = await setup();
    const created = await createCounterparty(session, { name: "Nameless", types: [] }, db);
    expect(created.ok).toBe(false);
    await close();
  });

  it("updates a supplier and refuses another farm's", async () => {
    const { db, close, session } = await setup();
    const created = await createCounterparty(session, { name: "Hay Guy", types: ["HAY"] }, db);
    if (!created.ok) throw new Error(created.error);

    expect((await updateCounterparty(session, created.data.id, { phone: "0733000222" }, db)).ok).toBe(true);
    const intruder = fakeSession({ role: "OWNER", farmId: OTHER_FARM });
    expect((await updateCounterparty(intruder, created.data.id, { name: "Mine now" }, db)).ok).toBe(false);
    await close();
  });
});

/* ================================================================== */
/* Cost of production — both variants, labelled                       */
/* ================================================================== */

describe("cost of production", () => {
  async function seedCosts(db: TestDb, session: ReturnType<typeof fakeSession>) {
    await seedMilk(db); // 2,000 L

    for (const [category, amount] of [
      ["FEEDS", 40_000],
      ["LABOUR", 12_000],
      ["VETERINARY", 5_000],
      ["MILK_MARKETING", 3_000],
    ] as const) {
      const saved = await recordExpense(
        session,
        { incurredOn: "2026-08-05", category, amountKes: amount },
        db,
      );
      if (!saved.ok) throw new Error(saved.error);
      await approveExpense(session, saved.data.id, db);
    }

    // 1,500 kg of home-grown Napier fed. It never hit an expense row.
    const feedItemId = await seedFeedItem(db, {
      name: "Napier grass",
      category: "FODDER",
      defaultUnit: "BALE",
      defaultUnitWeightKg: "15",
      homeGrown: true,
    });
    await db.insert(s.feedIssue).values({
      id: newId(),
      farmId: FARM_ID,
      feedItemId,
      issuedOn: "2026-08-12",
      animalGroup: "LACTATING",
      quantity: "100.000",
      unit: "BALE",
      unitWeightKg: "15.000",
      recordedBy: session.userId,
    });
  }

  it("reports cash cost per litre out of pocket", async () => {
    const { db, close, session } = await setup();
    await seedCosts(db, session);

    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    expect(cop.litresProduced).toBe(2_000);
    expect(cop.cash.totalKes).toBe(60_000);
    expect(cop.cash.perLitreKes).toBe(30);
    expect(cop.cash.label).toMatch(/out of pocket/i);
    await close();
  });

  it("reports a higher full economic cost including imputed home-grown fodder", async () => {
    const { db, close, session } = await setup();
    await seedCosts(db, session);

    // 1,500 kg × KES 8 default = 12,000 imputed.
    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    expect(cop.full.totalKes).toBe(72_000);
    expect(cop.full.perLitreKes).toBe(36);
    expect(cop.full.label).toMatch(/full economic/i);
    expect(cop.imputed.find((i) => /home-grown/i.test(i.label))?.amountKes).toBe(12_000);
    await close();
  });

  it("labels the two variants differently and never conflates them", async () => {
    const { db, close, session } = await setup();
    await seedCosts(db, session);
    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    expect(cop.full.perLitreKes).toBeGreaterThan(cop.cash.perLitreKes);
    expect(cop.cash.label).not.toBe(cop.full.label);
    await close();
  });

  it("adds family labour, depreciation and land when the farm configures them", async () => {
    const { db, close, session } = await setup();
    await seedCosts(db, session);

    await db.insert(s.referenceValue).values([
      {
        id: newId(),
        farmId: FARM_ID,
        kind: "COST_MODEL",
        key: "FAMILY_LABOUR_KES_PER_MONTH",
        valueNumeric: "15000.0000",
        effectiveFrom: "2026-01-01",
      },
      {
        id: newId(),
        farmId: FARM_ID,
        kind: "COST_MODEL",
        key: "DEPRECIATION_KES_PER_MONTH",
        valueNumeric: "5000.0000",
        effectiveFrom: "2026-01-01",
      },
    ]);

    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    expect(cop.imputed.map((i) => i.label)).toContain("Family labour");
    expect(cop.full.totalKes).toBeGreaterThan(72_000 + 19_000);
    await close();
  });

  it("honours the latest effective-dated cost model row, not the oldest", async () => {
    const { db, close, session } = await setup();
    await seedCosts(db, session);

    await db.insert(s.referenceValue).values([
      {
        id: newId(),
        farmId: FARM_ID,
        kind: "COST_MODEL",
        key: "IMPUTED_FODDER_KES_PER_KG",
        valueNumeric: "4.0000",
        effectiveFrom: "2026-01-01",
      },
      {
        id: newId(),
        farmId: FARM_ID,
        kind: "COST_MODEL",
        key: "IMPUTED_FODDER_KES_PER_KG",
        valueNumeric: "10.0000",
        effectiveFrom: "2026-07-01",
      },
    ]);

    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    // 1,500 kg × 10, not × 4 and not × the 8 default.
    expect(cop.imputed.find((i) => /home-grown/i.test(i.label))?.amountKes).toBe(15_000);
    await close();
  });

  it("breaks the cash cost down by category, biggest first", async () => {
    const { db, close, session } = await setup();
    await seedCosts(db, session);
    const cop = await costOfProduction(session, AUG.from, AUG.to, db);

    expect(cop.byCategory[0].category).toBe("FEEDS");
    expect(cop.byCategory[0].amountKes).toBe(40_000);
    expect(cop.byCategory[0].pctOfCash).toBeCloseTo(66.67, 1);
    expect(cop.byCategory.map((c) => c.amountKes)).toEqual([40_000, 12_000, 5_000, 3_000]);
    await close();
  });

  it("states the feed share, because feed is 55–65% of cost on a real farm", async () => {
    const { db, close, session } = await setup();
    await seedCosts(db, session);
    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    // (40,000 purchased + 12,000 imputed) ÷ 72,000
    expect(cop.feedSharePct).toBeCloseTo(72.22, 1);
    await close();
  });

  it("states a conclusion against the KDB benchmark, not just a number", async () => {
    const { db, close, session } = await setup();
    await seedCosts(db, session);
    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    expect(cop.benchmark).toEqual({ lowKes: 30, highKes: 37 });
    expect(cop.verdict).toContain("benchmark");
    await close();
  });

  it("says so plainly when there is no milk to divide by", async () => {
    const { db, close, session } = await setup();
    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    expect(cop.litresProduced).toBe(0);
    expect(cop.cash.perLitreKes).toBe(0);
    expect(cop.verdict).toMatch(/no milk/i);
    await close();
  });

  it("ignores a superseded milk correction so litres are not double-counted", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { tag: "KE-9" });
    const originalId = newId();
    await db.insert(s.milkRecord).values({
      id: originalId,
      farmId: FARM_ID,
      animalId,
      recordedOn: "2026-08-10",
      session: "MORNING",
      litres: "100.00",
      recordedBy: session.userId,
      recordedAt: new Date(),
    });
    await db.insert(s.milkRecord).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      recordedOn: "2026-08-10",
      session: "MORNING",
      litres: "80.00",
      supersedesId: originalId,
      recordedBy: session.userId,
      recordedAt: new Date(),
    });

    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    expect(cop.litresProduced).toBe(80);
    await close();
  });
});

/* ================================================================== */
/* Month to date — R7                                                 */
/* ================================================================== */

describe("month to date", () => {
  it("comes back with the entry itself, not next month", async () => {
    const { db, close, session } = await setup();
    await seedMilk(db);

    const saved = await recordExpense(
      session,
      { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 12_000 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.data.position.from).toBe("2026-08-01");
    expect(saved.data.position.litresProduced).toBe(2_000);
    await close();
  });

  it("says whether the farm is ahead or behind, in words", async () => {
    const { db, close, session } = await setup();
    const income = await recordIncome(
      session,
      { receivedOn: "2026-08-03", source: "MILK", amountKes: 90_000 },
      db,
    );
    const expense = await recordExpense(
      session,
      { incurredOn: "2026-08-04", category: "FEEDS", amountKes: 60_000 },
      db,
    );
    if (!income.ok || !expense.ok) throw new Error("setup failed");
    await approveIncome(session, income.data.id, db);
    await approveExpense(session, expense.data.id, db);

    const mtd = await monthToDate(session, "2026-08-31", db);
    expect(mtd.netKes).toBe(30_000);
    expect(mtd.headline).toContain("ahead by");
    await close();
  });

  it("names the pending queue rather than silently hiding it", async () => {
    const { db, close, session } = await setup();
    await recordExpense(session, { incurredOn: "2026-08-04", category: "FEEDS", amountKes: 7_500 }, db);

    const mtd = await monthToDate(session, "2026-08-31", db);
    expect(mtd.pendingCount).toBe(1);
    expect(mtd.headline).toMatch(/waiting for approval/i);
    expect(mtd.headline).toMatch(/not counted/i);
    await close();
  });

  it("counts only the current month", async () => {
    const { db, close, session } = await setup();
    const july = await recordExpense(
      session,
      { incurredOn: "2026-07-30", category: "FEEDS", amountKes: 99_000 },
      db,
    );
    if (!july.ok) throw new Error(july.error);
    await approveExpense(session, july.data.id, db);

    expect((await monthToDate(session, "2026-08-31", db)).expenseKes).toBe(0);
    expect((await monthToDate(session, "2026-07-31", db)).expenseKes).toBe(99_000);
    await close();
  });
});

/* ================================================================== */
/* M-Pesa CSV import                                                  */
/* ================================================================== */

const STATEMENT = `Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance
SGH4XT9K1A,2026-08-03 08:14:22,"Pay Bill from LIMURU DAIRY CO-OP",Completed,12500.00,,45300.00
SGH4XT9K2B,2026-08-03 10:02:11,"Customer Transfer to 0722000111 - UNGA FEEDS",Completed,,-3450.00,41850.00
SGH4XT9K3C,2026-08-03 16:41:59,"Merchant Payment to AGROVET",Completed,,-900.00,40950.00
`;

describe("M-Pesa CSV import", () => {
  it("parses receipt, time, details and both money columns", async () => {
    const { lines, skipped } = parseMpesaCsv(STATEMENT);
    expect(skipped).toBe(0);
    expect(lines).toHaveLength(3);
    expect(lines[0].receiptNo).toBe("SGH4XT9K1A");
    expect(lines[0].paidInKes).toBe(12_500);
    expect(lines[0].withdrawnKes).toBe(0);
    expect(lines[0].details).toContain("LIMURU");
    expect(lines[1].withdrawnKes).toBe(3_450); // the sign is direction, not magnitude
    expect(lines[2].balanceKes).toBe(40_950);
  });

  it("imports the statement into rows", async () => {
    const { db, close, session } = await setup();
    const result = await importMpesaCsv(session, STATEMENT, db);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.imported).toBe(3);
    expect(await db.select().from(s.mpesaStatementLine)).toHaveLength(3);
    await close();
  });

  it("IS IDEMPOTENT ON RECEIPT NUMBER — re-importing the same file adds nothing", async () => {
    const { db, close, session } = await setup();
    await importMpesaCsv(session, STATEMENT, db);
    const again = await importMpesaCsv(session, STATEMENT, db);
    if (!again.ok) throw new Error(again.error);

    expect(again.data.imported).toBe(0);
    expect(again.data.duplicates).toBe(3);
    expect(await db.select().from(s.mpesaStatementLine)).toHaveLength(3);
    await close();
  });

  it("imports only the new rows from an overlapping statement", async () => {
    const { db, close, session } = await setup();
    await importMpesaCsv(session, STATEMENT, db);

    const overlapping = `${STATEMENT}SGH4XT9K4D,2026-08-04 07:00:00,"Pay Bill from SCHOOL",Completed,8000.00,,48950.00\n`;
    const result = await importMpesaCsv(session, overlapping, db);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.imported).toBe(1);
    expect(result.data.duplicates).toBe(3);
    expect(await db.select().from(s.mpesaStatementLine)).toHaveLength(4);
    await close();
  });

  it("de-duplicates a receipt repeated inside one file", async () => {
    const { db, close, session } = await setup();
    const doubled = `${STATEMENT}SGH4XT9K1A,2026-08-03 08:14:22,"Pay Bill from LIMURU DAIRY CO-OP",Completed,12500.00,,45300.00\n`;
    const result = await importMpesaCsv(session, doubled, db);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.imported).toBe(3);
    await close();
  });

  it("skips failed and cancelled transactions", async () => {
    const csv = `Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance
SGH1,2026-08-03 08:14:22,Something,Failed,0.00,,100.00
SGH2,2026-08-03 09:14:22,Something else,Completed,500.00,,600.00
`;
    const { lines, skipped } = parseMpesaCsv(csv);
    expect(lines).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it("accepts the dd/mm/yyyy shape the Safaricom portal exports", () => {
    const d = parseMpesaDate("03/08/2026 4:41:59 PM");
    expect(d?.toISOString()).toBe("2026-08-03T16:41:59.000Z");
    expect(parseMpesaDate("2026-08-03 08:14:22")?.toISOString()).toBe("2026-08-03T08:14:22.000Z");
    expect(parseMpesaDate("not a date")).toBeNull();
  });

  it("strips thousands separators and brackets from amounts", () => {
    expect(parseMpesaAmount("12,500.00")).toBe(12_500);
    expect(parseMpesaAmount("-3,450.55")).toBe(3_450.55);
    expect(parseMpesaAmount("(900.00)")).toBe(900);
    expect(parseMpesaAmount("")).toBe(0);
    expect(parseMpesaAmount(undefined)).toBe(0);
  });

  it("tells the farmer what to do when the file has no transactions", async () => {
    const { db, close, session } = await setup();
    const result = await importMpesaCsv(session, "nothing,useful\n", db);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/export the statement/i);
    await close();
  });

  it("will not let a herdsman import a statement", async () => {
    const { db, close } = await setup();
    const herdsman = fakeSession({ role: "HERDSMAN" });
    expect((await importMpesaCsv(herdsman, STATEMENT, db)).ok).toBe(false);
    await close();
  });

  it("keeps each farm's statement lines apart", async () => {
    const { db, close, session } = await setup();
    await importMpesaCsv(session, STATEMENT, db);
    const other = fakeSession({ role: "OWNER", farmId: OTHER_FARM });
    const theirs = await importMpesaCsv(other, STATEMENT, db);
    if (!theirs.ok) throw new Error(theirs.error);
    // Same receipt numbers, different farm — the unique key is scoped per farm.
    expect(theirs.data.imported).toBe(3);
    await close();
  });
});

/* ================================================================== */
/* M-Pesa reconcile                                                   */
/* ================================================================== */

describe("M-Pesa reconcile", () => {
  async function seedReconcile(db: TestDb, session: ReturnType<typeof fakeSession>) {
    await importMpesaCsv(session, STATEMENT, db);

    // Matches SGH4XT9K2B by its confirmation code.
    const feed = await recordExpense(
      session,
      {
        incurredOn: "2026-08-03",
        category: "FEEDS",
        amountKes: 3_450,
        description: "Dairy meal, 2 bags",
        paymentMethod: "MPESA",
        mpesaRef: "SGH4XT9K2B",
      },
      db,
    );
    // Matches SGH4XT9K1A on amount and date only — no code was written down.
    const coop = await recordIncome(
      session,
      {
        receivedOn: "2026-08-03",
        source: "MILK",
        amountKes: 12_500,
        description: "Co-op payment",
        paymentMethod: "MPESA",
      },
      db,
    );
    // Recorded as M-Pesa but never appears on the statement.
    const ghost = await recordExpense(
      session,
      {
        incurredOn: "2026-08-03",
        category: "TRANSPORT",
        amountKes: 7_777,
        description: "Lorry hire",
        paymentMethod: "MPESA",
      },
      db,
    );
    if (!feed.ok || !coop.ok || !ghost.ok) throw new Error("setup failed");
    return { feedId: feed.data.id, coopId: coop.data.id, ghostId: ghost.data.id };
  }

  it("matches on the confirmation code first", async () => {
    const { db, close, session } = await setup();
    const { feedId } = await seedReconcile(db, session);

    const recon = await reconcileMpesa(session, "2026-08-03", db);
    const byRef = recon.matched.find((m) => m.matchedOn === "REFERENCE");
    expect(byRef?.matchedId).toBe(feedId);
    expect(byRef?.receiptNo).toBe("SGH4XT9K2B");
    expect(byRef?.direction).toBe("OUT");
    await close();
  });

  it("falls back to amount and date proximity when no code was written down", async () => {
    const { db, close, session } = await setup();
    const { coopId } = await seedReconcile(db, session);

    const recon = await reconcileMpesa(session, "2026-08-03", db);
    const byAmount = recon.matched.find((m) => m.matchedOn === "AMOUNT_AND_DATE");
    expect(byAmount?.matchedId).toBe(coopId);
    expect(byAmount?.matchedKind).toBe("INCOME");
    expect(byAmount?.amountKes).toBe(12_500);
    await close();
  });

  it("surfaces a statement line with no record — money moved and nobody wrote it down", async () => {
    const { db, close, session } = await setup();
    await seedReconcile(db, session);

    const recon = await reconcileMpesa(session, "2026-08-03", db);
    expect(recon.unmatchedLines).toHaveLength(1);
    expect(recon.unmatchedLines[0].receiptNo).toBe("SGH4XT9K3C");
    expect(recon.unmatchedLines[0].amountKes).toBe(900);
    expect(recon.unmatchedLines[0].advice).toMatch(/nothing was recorded/i);
    await close();
  });

  it("surfaces a record with no statement line — the other direction", async () => {
    const { db, close, session } = await setup();
    const { ghostId } = await seedReconcile(db, session);

    const recon = await reconcileMpesa(session, "2026-08-03", db);
    expect(recon.unmatchedRecords).toHaveLength(1);
    expect(recon.unmatchedRecords[0].id).toBe(ghostId);
    expect(recon.unmatchedRecords[0].amountKes).toBe(7_777);
    expect(recon.unmatchedRecords[0].advice).toMatch(/may not have arrived|no matching statement/i);
    await close();
  });

  it("writes the match back onto the statement line", async () => {
    const { db, close, session } = await setup();
    const { feedId } = await seedReconcile(db, session);
    await reconcileMpesa(session, "2026-08-03", db);

    const [line] = await db
      .select()
      .from(s.mpesaStatementLine)
      .where(
        and(
          eq(s.mpesaStatementLine.farmId, FARM_ID),
          eq(s.mpesaStatementLine.receiptNo, "SGH4XT9K2B"),
        ),
      );
    expect(line.matchedExpenseId).toBe(feedId);
    await close();
  });

  it("reconciles a PENDING entry — approval is about reports, not about cash moving", async () => {
    const { db, close, session } = await setup();
    await seedReconcile(db, session);
    // Nothing was approved in the fixture; the match still happens.
    const recon = await reconcileMpesa(session, "2026-08-03", db);
    expect(recon.matched).toHaveLength(2);
    await close();
  });

  it("summarises the day in a sentence", async () => {
    const { db, close, session } = await setup();
    await seedReconcile(db, session);
    const recon = await reconcileMpesa(session, "2026-08-03", db);
    expect(recon.summary).toContain("2 of 3 matched");
    await close();
  });

  it("says everything matches when it does", async () => {
    const { db, close, session } = await setup();
    await importMpesaCsv(session, STATEMENT, db);
    for (const [amount, ref] of [
      [3_450, "SGH4XT9K2B"],
      [900, "SGH4XT9K3C"],
    ] as const) {
      await recordExpense(
        session,
        { incurredOn: "2026-08-03", category: "FEEDS", amountKes: amount, paymentMethod: "MPESA", mpesaRef: ref },
        db,
      );
    }
    await recordIncome(
      session,
      {
        receivedOn: "2026-08-03",
        source: "MILK",
        amountKes: 12_500,
        paymentMethod: "MPESA",
        mpesaRef: "SGH4XT9K1A",
      },
      db,
    );

    const recon = await reconcileMpesa(session, "2026-08-03", db);
    expect(recon.unmatchedLines).toHaveLength(0);
    expect(recon.unmatchedRecords).toHaveLength(0);
    expect(recon.summary).toMatch(/all 3/i);
    await close();
  });

  it("tells the farmer to import when there is nothing on file", async () => {
    const { db, close, session } = await setup();
    const recon = await reconcileMpesa(session, "2026-08-03", db);
    expect(recon.summary).toMatch(/import the statement/i);
    await close();
  });

  it("never matches across farms", async () => {
    const { db, close, session } = await setup();
    await seedReconcile(db, session);
    const other = fakeSession({ role: "OWNER", farmId: OTHER_FARM });
    const recon = await reconcileMpesa(other, "2026-08-03", db);
    expect(recon.matched).toHaveLength(0);
    expect(recon.unmatchedLines).toHaveLength(0);
    await close();
  });
});

/* ================================================================== */
/* Offline replay                                                     */
/* ================================================================== */

describe("offline replay", () => {
  it("makes a double-flushed expense land once, not twice", async () => {
    const { db, close, session } = await setup();
    const id = newId();
    const input = { id, incurredOn: "2026-08-05", category: "FEEDS" as const, amountKes: 4_600 };

    await recordExpense(session, input, db);
    await recordExpense(session, input, db);

    const rows = await db.select().from(s.expense).where(eq(s.expense.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].amountKes).toBe("4600.00");
    await close();
  });

  it("keeps money as an exact decimal string, never a float", async () => {
    const { db, close, session } = await setup();
    const saved = await recordExpense(
      session,
      { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 3_450.55 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);
    const [row] = await db.select().from(s.expense).where(eq(s.expense.id, saved.data.id));
    expect(row.amountKes).toBe("3450.55");
    await close();
  });

  it("gives every save a speakable reference code (R6)", async () => {
    const { db, close, session } = await setup();
    const saved = await recordExpense(
      session,
      { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 100 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.refCode).toMatch(/^EX[A-Z2-9]{5}$/);

    const [receipt] = await db.select().from(s.receipt).where(eq(s.receipt.refCode, saved.refCode!));
    expect(receipt.summary).toContain("Waiting for approval");
    await close();
  });
});
