import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { FARM_ID, fakeSession, seedAnimal, seedCustomer, seedFarm, seedUser } from "@/test/factory";
import { newId } from "@/lib/ids";
import * as s from "@/db/schema";
import { costOfProduction, monthToDate, recordExpense, recordIncome, approveIncome, approveExpense } from "../money";
import { recordDelivery, recordDisposal } from "../sales";

/**
 * THE REVENUE SEAM.
 *
 * Milk revenue is DERIVED from `milkDisposal`. It is never an `income` row.
 * These tests hold that line from both ends: the money reports must SEE the
 * milk, and the milk modules must not POST it a second time.
 *
 * Two build agents left `monthToDate.incomeKes` at zero for milk because they
 * could not see each other's code and neither wanted to be the one who
 * double-counted. The answer is here, once, with the reason attached.
 */

const AUG = { from: "2026-08-01", to: "2026-08-31" } as const;

async function setup() {
  const { db, close } = await createTestDb();
  await seedFarm(db);
  const userId = await seedUser(db, { role: "MANAGER", fullName: "Grace Wanjiru" });
  return { db, close, session: fakeSession({ role: "MANAGER", userId }) };
}

/** The co-op pays 50 a litre. That rate also values the milk we never sell. */
async function seedPrice(db: TestDb, rate = 50) {
  await db.insert(s.priceList).values({
    id: newId(),
    farmId: FARM_ID,
    scope: "CHANNEL",
    customerType: "COOP",
    rateKesPerLitre: rate.toFixed(2),
    effectiveFrom: "2026-01-01",
    setBy: newId(),
  });
}

/** 400 L produced across two August days. */
async function seedMilk(db: TestDb, session: ReturnType<typeof fakeSession>) {
  const animalId = await seedAnimal(db, { tag: "KE-0001" });
  for (const day of ["2026-08-10", "2026-08-11"]) {
    await db.insert(s.milkRecord).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      recordedOn: day,
      session: "MORNING",
      litres: "200.00",
      recordedBy: session.userId,
      recordedAt: new Date(),
    });
  }
  return animalId;
}

/**
 * A realistic August day: 100 L to the co-op, 10 L to the house, 5 L to the
 * calves, 5 L to the herdsman, 2 L soured in the can.
 */
async function seedDisposals(db: TestDb, session: ReturnType<typeof fakeSession>) {
  const coopId = await seedCustomer(db, { name: "Limuru Dairy Co-operative", customerType: "COOP" });
  await recordDisposal(
    session,
    { date: "2026-08-10", channel: "COOP", customerId: coopId, litres: 100, accepted: true },
    db,
  );
  await recordDisposal(session, { date: "2026-08-10", channel: "HOME_CONSUMPTION", litres: 10 }, db);
  await recordDisposal(session, { date: "2026-08-10", channel: "CALF_FEEDING", litres: 5 }, db);
  await recordDisposal(session, { date: "2026-08-10", channel: "STAFF_RATION", litres: 5 }, db);
  await recordDisposal(
    session,
    { date: "2026-08-10", channel: "SPOILAGE", litres: 2, lossReason: "SOURED" },
    db,
  );
  return coopId;
}

/* ================================================================== */
/* Milk revenue reaches the reports                                   */
/* ================================================================== */

describe("milk revenue is derived from milkDisposal", () => {
  it("puts the co-op's litres into the month-to-date position", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db);
    await seedMilk(db, session);
    await seedDisposals(db, session);

    const mtd = await monthToDate(session, "2026-08-31", db);
    // 100 L × 50 sold; 20 L × 50 given away and valued.
    expect(mtd.milkSoldKes).toBe(5_000);
    expect(mtd.milkImputedKes).toBe(1_000);
    expect(mtd.otherIncomeKes).toBe(0);
    expect(mtd.incomeKes).toBe(6_000);
    await close();
  });

  it("counts the milk the farm drinks itself, or a self-sufficient farm looks poor", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db);
    await seedMilk(db, session);
    // Nothing sold at all — everything goes to the house, the calves and staff.
    await recordDisposal(session, { date: "2026-08-10", channel: "HOME_CONSUMPTION", litres: 20 }, db);
    await recordDisposal(session, { date: "2026-08-10", channel: "CALF_FEEDING", litres: 10 }, db);

    const mtd = await monthToDate(session, "2026-08-31", db);
    expect(mtd.milkSoldKes).toBe(0);
    expect(mtd.milkImputedKes).toBe(1_500);
    expect(mtd.incomeKes).toBe(1_500);
    // And it says so, rather than letting an owner read it as cash.
    expect(mtd.headline).toMatch(/milk you did not sell/i);
    await close();
  });

  it("never counts spilled or withheld milk as revenue", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db);
    await seedMilk(db, session);
    await recordDisposal(
      session,
      { date: "2026-08-10", channel: "SPOILAGE", litres: 40, lossReason: "SPOILAGE" },
      db,
    );
    await recordDisposal(session, { date: "2026-08-10", channel: "WITHHELD_TREATMENT", litres: 10 }, db);

    const mtd = await monthToDate(session, "2026-08-31", db);
    expect(mtd.incomeKes).toBe(0);
    await close();
  });

  it("reports revenue and margin per litre in cost of production", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db);
    await seedMilk(db, session);
    await seedDisposals(db, session);

    const feed = await recordExpense(
      session,
      { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 4_000 },
      db,
    );
    if (!feed.ok) throw new Error(feed.error);
    await approveExpense(session, feed.data.id, db);

    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    expect(cop.litresProduced).toBe(400);
    expect(cop.revenue.milkSoldKes).toBe(5_000);
    expect(cop.revenue.milkImputedKes).toBe(1_000);
    expect(cop.revenue.totalKes).toBe(6_000);
    expect(cop.revenue.perLitreKes).toBe(15);
    expect(cop.full.totalKes).toBe(4_000);
    expect(cop.marginKes).toBe(2_000);
    expect(cop.marginPerLitreKes).toBe(5);
    await close();
  });

  it("adds NON-milk income on top — manure and animal sales still come from `income`", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db);
    await seedMilk(db, session);
    await seedDisposals(db, session);

    const manure = await recordIncome(
      session,
      { receivedOn: "2026-08-12", source: "MANURE", amountKes: 3_000 },
      db,
    );
    if (!manure.ok) throw new Error(manure.error);

    // PENDING income moves nothing, exactly like an expense (R10).
    expect((await monthToDate(session, "2026-08-31", db)).otherIncomeKes).toBe(0);
    expect((await monthToDate(session, "2026-08-31", db)).incomeKes).toBe(6_000);

    await approveIncome(session, manure.data.id, db);
    const after = await monthToDate(session, "2026-08-31", db);
    expect(after.otherIncomeKes).toBe(3_000);
    expect(after.incomeKes).toBe(9_000);
    expect(after.milkSoldKes).toBe(5_000);
    await close();
  });

  it("counts only the period asked for", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db);
    await seedMilk(db, session);
    const coopId = await seedCustomer(db, { customerType: "COOP" });
    await recordDisposal(
      session,
      { date: "2026-07-31", channel: "COOP", customerId: coopId, litres: 100 },
      db,
    );

    expect((await monthToDate(session, "2026-08-31", db)).milkSoldKes).toBe(0);
    expect((await monthToDate(session, "2026-07-31", db)).milkSoldKes).toBe(5_000);
    await close();
  });

  it("keeps one farm's milk money out of another's books", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db);
    await seedMilk(db, session);
    await seedDisposals(db, session);

    const intruder = fakeSession({ role: "OWNER", farmId: "22222222-2222-4222-8222-222222222222" });
    const theirs = await monthToDate(intruder, "2026-08-31", db);
    expect(theirs.incomeKes).toBe(0);
    expect(theirs.milkSoldKes).toBe(0);
    await close();
  });
});

/* ================================================================== */
/* …and is posted exactly once                                        */
/* ================================================================== */

describe("milk is never posted as income as well", () => {
  it("writes no income row for a disposal", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db);
    await seedMilk(db, session);
    await seedDisposals(db, session);

    // PROOF that there is one source of truth: the disposals are all there,
    // and nothing landed in `income`.
    expect(await db.select().from(s.milkDisposal)).toHaveLength(5);
    expect(await db.select().from(s.income)).toHaveLength(0);
    await close();
  });

  it("writes no income row for a delivery on the round either", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db);
    await seedMilk(db, session);
    const school = await seedCustomer(db, {
      name: "Kiambu Girls High School",
      customerType: "INSTITUTION",
      paymentTerms: "NET_30",
    });
    await db.insert(s.priceList).values({
      id: newId(),
      farmId: FARM_ID,
      scope: "CHANNEL",
      customerType: "INSTITUTION",
      rateKesPerLitre: "60.00",
      effectiveFrom: "2026-01-01",
      setBy: newId(),
    });

    const delivered = await recordDelivery(
      session,
      { date: "2026-08-10", customerId: school, litres: 50, settlement: "CREDIT" },
      db,
    );
    expect(delivered.ok).toBe(true);

    // A delivery on credit is a RECEIVABLE on the customer ledger and a
    // disposal. It is not an income row, and it is not two of anything.
    expect(await db.select().from(s.income)).toHaveLength(0);
    expect(
      await db.select().from(s.customerLedgerEntry).where(eq(s.customerLedgerEntry.customerId, school)),
    ).toHaveLength(1);

    const mtd = await monthToDate(session, "2026-08-31", db);
    expect(mtd.milkSoldKes).toBe(3_000);
    expect(mtd.incomeKes).toBe(3_000);
    await close();
  });

  it("counts a hand-typed milk income row once, not twice, per shilling", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db);
    await seedMilk(db, session);
    await seedDisposals(db, session);

    // `income.source = "MILK"` is a legacy shape that no code path writes any
    // more. Typed in by hand it is still money in — but it is money the
    // DISPOSALS do not know about, so it is added, never substituted. The
    // guard against double counting is that no module posts it, and this
    // suite is what says so.
    const typed = await recordIncome(
      session,
      { receivedOn: "2026-08-20", source: "MILK", amountKes: 800, description: "Milk sold at the gate, no delivery note" },
      db,
    );
    if (!typed.ok) throw new Error(typed.error);
    await approveIncome(session, typed.data.id, db);

    const mtd = await monthToDate(session, "2026-08-31", db);
    expect(mtd.milkSoldKes).toBe(5_000);
    expect(mtd.otherIncomeKes).toBe(800);
    expect(mtd.incomeKes).toBe(5_800 + 1_000);
    await close();
  });
});
