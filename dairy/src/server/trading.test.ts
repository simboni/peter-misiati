import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { seedFarm, seedAnimal, seedFeedItem, seedUser, fakeSession, FARM_ID } from "@/test/factory";
import * as s from "@/db/schema";
import { newId } from "@/lib/ids";
import {
  animalLifetimeValue,
  cullList,
  DEFAULT_FARM_GATE_KES_PER_LITRE,
  recordPurchase,
  recordSale,
  tradeLog,
} from "./trading";
import { createCounterparty } from "./money";

const OTHER_FARM = "22222222-2222-4222-8222-222222222222";

async function setup() {
  const { db, close } = await createTestDb();
  await seedFarm(db);
  const userId = await seedUser(db, { role: "MANAGER", fullName: "Grace Wanjiru" });
  return { db, close, session: fakeSession({ role: "MANAGER", userId }) };
}

async function seedMilkFor(
  db: TestDb,
  animalId: string,
  userId: string,
  records: Array<[string, number]>,
) {
  for (const [day, litres] of records) {
    await db.insert(s.milkRecord).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      recordedOn: day,
      session: "MORNING",
      litres: litres.toFixed(2),
      recordedBy: userId,
      recordedAt: new Date(),
    });
  }
}

/** A feed item costing exactly KES 50/kg, so attribution maths is checkable. */
async function seedFeedAt50PerKg(db: TestDb, userId: string) {
  const feedItemId = await seedFeedItem(db, { name: "Dairy meal", defaultUnit: "KG", defaultUnitWeightKg: "1" });
  await db.insert(s.feedPurchase).values({
    id: newId(),
    farmId: FARM_ID,
    feedItemId,
    purchasedOn: "2026-01-05",
    quantity: "100.000",
    unit: "BAG_70KG",
    unitWeightKg: "70.000",
    unitPriceKes: "3500.00",
    totalCostKes: "350000.00", // 7,000 kg for 350,000 → KES 50/kg
    recordedBy: userId,
  });
  return feedItemId;
}

/* ================================================================== */
/* Buying in                                                          */
/* ================================================================== */

describe("recordPurchase", () => {
  it("creates the animal with origin PURCHASED and the price on the record", async () => {
    const { db, close, session } = await setup();
    const saved = await recordPurchase(
      session,
      {
        tag: "KE-4471",
        name: "Wanjiku",
        sex: "F",
        primaryBreed: "FRIESIAN",
        enteredHerdOn: "2026-08-01",
        dateOfBirth: "2023-02-14",
        priceKes: 185_000,
      },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);

    const [row] = await db.select().from(s.animal).where(eq(s.animal.id, saved.data.animalId));
    expect(row.origin).toBe("PURCHASED");
    expect(row.purchasePriceKes).toBe("185000.00");
    expect(row.enteredHerdOn).toBe("2026-08-01");
    expect(row.dobEstimated).toBe(false);
    await close();
  });

  it("ALLOWS a class override, because a bought-in animal has no history to derive from", async () => {
    const { db, close, session } = await setup();
    const saved = await recordPurchase(
      session,
      {
        tag: "KE-4472",
        enteredHerdOn: "2026-08-01",
        priceKes: 210_000,
        classOverride: "INCALF_HEIFER",
        monthsPregnant: 7,
      },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);

    const [row] = await db.select().from(s.animal).where(eq(s.animal.id, saved.data.animalId));
    expect(row.classOverride).toBe("INCALF_HEIFER");
    expect(saved.data.reminders.join(" ")).toMatch(/derived from those events/i);
    await close();
  });

  it("marks the date of birth ESTIMATED when only an age was given", async () => {
    const { db, close, session } = await setup();
    const saved = await recordPurchase(
      session,
      { tag: "KE-4473", enteredHerdOn: "2026-08-01", priceKes: 90_000, ageMonthsEstimate: 18 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.data.dobEstimated).toBe(true);

    const [row] = await db.select().from(s.animal).where(eq(s.animal.id, saved.data.animalId));
    expect(row.dobEstimated).toBe(true);
    expect(row.dateOfBirth).toBe("2025-01-30"); // 18 × 30.4375 = 548 days back
    expect(saved.data.reminders.join(" ")).toMatch(/estimate/i);
    await close();
  });

  it("marks it estimated when no age at all was given, never silently blank", async () => {
    const { db, close, session } = await setup();
    const saved = await recordPurchase(
      session,
      { tag: "KE-4474", enteredHerdOn: "2026-08-01", priceKes: 40_000 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);
    const [row] = await db.select().from(s.animal).where(eq(s.animal.id, saved.data.animalId));
    expect(row.dateOfBirth).toBeNull();
    expect(row.dobEstimated).toBe(true);
    await close();
  });

  it("gives back the records to ask the seller for (R7)", async () => {
    const { db, close, session } = await setup();
    const saved = await recordPurchase(
      session,
      { tag: "KE-4475", enteredHerdOn: "2026-08-01", priceKes: 150_000 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);
    const text = saved.data.reminders.join(" ");
    expect(text).toMatch(/records/i);
    expect(text).toMatch(/brucellosis|movement permit/i);
    await close();
  });

  it("does NOT post an operating expense — a livestock purchase is capital", async () => {
    const { db, close, session } = await setup();
    await recordPurchase(
      session,
      { tag: "KE-4476", enteredHerdOn: "2026-08-01", priceKes: 200_000 },
      db,
    );
    // KES 200,000 in one month's cost per litre would make that number meaningless.
    expect(await db.select().from(s.expense)).toHaveLength(0);
    await close();
  });

  it("gives every purchase a reference code (R6)", async () => {
    const { db, close, session } = await setup();
    const saved = await recordPurchase(
      session,
      { tag: "KE-4477", enteredHerdOn: "2026-08-01", priceKes: 50_000 },
      db,
    );
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.refCode).toMatch(/^SL[A-Z2-9]{5}$/);
    await close();
  });

  it("lands once when the offline outbox flushes twice", async () => {
    const { db, close, session } = await setup();
    const id = newId();
    const input = { id, tag: "KE-4478", enteredHerdOn: "2026-08-01", priceKes: 50_000 };
    await recordPurchase(session, input, db);
    await recordPurchase(session, input, db);
    expect(await db.select().from(s.animal)).toHaveLength(1);
    await close();
  });
});

/* ================================================================== */
/* Selling — the Kenyan price drivers                                 */
/* ================================================================== */

describe("recordSale captures what actually drove the price", () => {
  async function sell(db: TestDb, session: ReturnType<typeof fakeSession>) {
    const animalId = await seedAnimal(db, { tag: "KE-7001", name: "Njeri" });
    const sale = await recordSale(
      session,
      {
        animalId,
        exitDate: "2026-08-03",
        reason: "SOLD",
        priceKes: 240_000,
        classAtExit: "INCALF_HEIFER",
        monthsPregnant: 7,
        dailyYieldAtSaleL: 18,
        daysInMilkAtSale: 120,
        weightKg: 480,
        counterpartyKind: "FARMER",
        paymentMethod: "MPESA",
        mpesaRef: "SGH4XT9K1A",
      },
      db,
    );
    return { animalId, sale };
  }

  it("stores class, months pregnant, daily yield, days in milk and weight", async () => {
    const { db, close, session } = await setup();
    const { animalId, sale } = await sell(db, session);
    if (!sale.ok) throw new Error(sale.error);

    const [exit] = await db.select().from(s.animalExit).where(eq(s.animalExit.animalId, animalId));
    expect(exit.classAtExit).toBe("INCALF_HEIFER");
    expect(exit.monthsPregnant).toBe("7.0");
    expect(exit.dailyYieldAtSaleL).toBe("18.00");
    expect(exit.daysInMilkAtSale).toBe(120);
    expect(exit.weightKg).toBe("480.00");
    expect(exit.valueKes).toBe("240000.00");
    expect(exit.reason).toBe("SOLD");
    await close();
  });

  it("names the drivers back to the seller, including price per litre of daily yield", async () => {
    const { db, close, session } = await setup();
    const { sale } = await sell(db, session);
    if (!sale.ok) throw new Error(sale.error);

    const drivers = sale.data.priceDrivers.join(" | ");
    expect(drivers).toContain("7 months in calf");
    expect(drivers).toContain("18 L a day");
    expect(drivers).toContain("120 days in milk");
    expect(drivers).toContain("480 kg liveweight");
    // 240,000 ÷ 18 L/day — the way a Kenyan buyer actually reasons about a milker.
    expect(drivers).toMatch(/13,333 per litre of daily yield/);
    await close();
  });

  it("WRITES AN INCOME ROW, pending like every other money entry", async () => {
    const { db, close, session } = await setup();
    const { sale } = await sell(db, session);
    if (!sale.ok) throw new Error(sale.error);
    expect(sale.data.incomeId).not.toBeNull();

    const [income] = await db.select().from(s.income).where(eq(s.income.id, sale.data.incomeId!));
    expect(income.source).toBe("ANIMAL_SALE");
    expect(income.amountKes).toBe("240000.00");
    expect(income.receivedOn).toBe("2026-08-03");
    expect(income.status).toBe("PENDING");
    expect(income.mpesaRef).toBe("SGH4XT9K1A");
    expect(income.description).toContain("Njeri");
    expect(income.description).toContain("Another farmer");
    await close();
  });

  it("writes no income for a death — nothing came in", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { tag: "KE-7002" });
    const sale = await recordSale(
      session,
      { animalId, exitDate: "2026-08-03", reason: "DIED", cause: "East Coast fever", priceKes: 0 },
      db,
    );
    if (!sale.ok) throw new Error(sale.error);
    expect(sale.data.incomeId).toBeNull();
    expect(await db.select().from(s.income)).toHaveLength(0);

    const [exit] = await db.select().from(s.animalExit).where(eq(s.animalExit.animalId, animalId));
    expect(exit.cause).toBe("East Coast fever");
    await close();
  });

  it("derives the daily yield from her recent records when the seller did not type it", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { tag: "KE-7003" });
    await seedMilkFor(db, animalId, session.userId, [
      ["2026-08-01", 12],
      ["2026-08-02", 14],
      ["2026-08-03", 13],
    ]);

    const sale = await recordSale(
      session,
      { animalId, exitDate: "2026-08-03", reason: "SOLD", priceKes: 150_000 },
      db,
    );
    if (!sale.ok) throw new Error(sale.error);
    const [exit] = await db.select().from(s.animalExit).where(eq(s.animalExit.animalId, animalId));
    expect(exit.dailyYieldAtSaleL).toBe("13.00");
    await close();
  });

  it("derives the class from her events when the seller did not type it", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { tag: "KE-7004" });
    await db.insert(s.calving).values({
      id: newId(),
      farmId: FARM_ID,
      damId: animalId,
      calvedOn: "2026-03-01",
      recordedBy: session.userId,
    });

    const sale = await recordSale(
      session,
      { animalId, exitDate: "2026-08-03", reason: "SOLD", priceKes: 120_000 },
      db,
    );
    if (!sale.ok) throw new Error(sale.error);
    const [exit] = await db.select().from(s.animalExit).where(eq(s.animalExit.animalId, animalId));
    expect(exit.classAtExit).toBe("FIRST_CALVER");
    expect(exit.daysInMilkAtSale).toBe(155);
    await close();
  });

  it("refuses a second exit for an animal that already left", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { tag: "KE-7005" });
    await recordSale(session, { animalId, exitDate: "2026-08-03", priceKes: 100_000 }, db);

    const again = await recordSale(session, { animalId, exitDate: "2026-08-10", priceKes: 90_000 }, db);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/already left the herd/i);
    expect(await db.select().from(s.animalExit)).toHaveLength(1);
    await close();
  });

  it("records the buyer when they are a known counterparty", async () => {
    const { db, close, session } = await setup();
    const buyer = await createCounterparty(session, { name: "Kariuki Farm", types: ["OTHER"] }, db);
    if (!buyer.ok) throw new Error(buyer.error);
    const animalId = await seedAnimal(db, { tag: "KE-7006" });

    const sale = await recordSale(
      session,
      { animalId, exitDate: "2026-08-03", priceKes: 100_000, counterpartyId: buyer.data.id },
      db,
    );
    if (!sale.ok) throw new Error(sale.error);
    const [exit] = await db.select().from(s.animalExit).where(eq(s.animalExit.animalId, animalId));
    expect(exit.counterpartyId).toBe(buyer.data.id);
    await close();
  });
});

/* ================================================================== */
/* Lifetime value                                                     */
/* ================================================================== */

describe("animalLifetimeValue", () => {
  /**
   * A cow bought for 100,000 who gave 500 L, cost 5,000 of feed, 2,000 of vet
   * and 2,000 of breeding, then sold for 90,000. Every figure is chosen so the
   * arithmetic is checkable by hand.
   */
  async function seedALife(db: TestDb, session: ReturnType<typeof fakeSession>) {
    const purchase = await recordPurchase(
      session,
      {
        tag: "KE-8001",
        name: "Wanjiru",
        enteredHerdOn: "2026-01-01",
        priceKes: 100_000,
        classOverride: "LACTATING_COW",
        ageMonthsEstimate: 48,
      },
      db,
    );
    if (!purchase.ok) throw new Error(purchase.error);
    const animalId = purchase.data.animalId;

    await seedMilkFor(db, animalId, session.userId, [
      ["2026-02-01", 100],
      ["2026-02-02", 100],
      ["2026-02-03", 100],
      ["2026-02-04", 100],
      ["2026-02-05", 100],
    ]);

    await db.insert(s.calving).values({
      id: newId(),
      farmId: FARM_ID,
      damId: animalId,
      calvedOn: "2026-02-01",
      numberBorn: 1,
      recordedBy: session.userId,
    });
    const [calvingRow] = await db.select().from(s.calving).where(eq(s.calving.damId, animalId));
    await db.insert(s.calvingOutcome).values({
      id: newId(),
      farmId: FARM_ID,
      calvingId: calvingRow.id,
      outcome: "LIVE",
      calfSex: "F",
    });

    await db.insert(s.healthEvent).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      eventType: "TREATMENT",
      occurredOn: "2026-03-01",
      costKes: "2000.00",
      recordedBy: session.userId,
    });
    await db.insert(s.service).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      servedOn: "2026-04-01",
      serviceType: "AI",
      costKes: "1500.00",
      recordedBy: session.userId,
    });
    await db.insert(s.pregnancyCheck).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      checkedOn: "2026-06-01",
      method: "PALPATION",
      result: "POSITIVE",
      costKes: "500.00",
      recordedBy: session.userId,
    });

    const feedItemId = await seedFeedAt50PerKg(db, session.userId);
    await db.insert(s.feedIssue).values({
      id: newId(),
      farmId: FARM_ID,
      feedItemId,
      issuedOn: "2026-03-15",
      animalId, // 100 kg × KES 50 = 5,000, charged to her alone
      quantity: "100.000",
      unit: "KG",
      unitWeightKg: "1.000",
      recordedBy: session.userId,
    });

    return animalId;
  }

  it("adds up every litre, calf, and shilling of cost", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedALife(db, session);

    const life = await animalLifetimeValue(session, animalId, "2026-06-30", db);
    expect(life.totalLitres).toBe(500);
    expect(life.calvesBorn).toBe(1);
    expect(life.liveCalves).toBe(1);
    expect(life.pricePerLitreKes).toBe(DEFAULT_FARM_GATE_KES_PER_LITRE);
    expect(life.milkRevenueKes).toBe(23_500);
    expect(life.feedCostKes).toBe(5_000);
    expect(life.vetCostKes).toBe(2_000);
    expect(life.breedingCostKes).toBe(2_000);
    expect(life.purchasePriceKes).toBe(100_000);
    expect(life.totalCostKes).toBe(109_000);
    await close();
  });

  it("turns a loss into a profit once the sale price is in", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedALife(db, session);

    const before = await animalLifetimeValue(session, animalId, "2026-06-30", db);
    expect(before.saleValueKes).toBe(0);
    expect(before.profitKes).toBe(-85_500);
    expect(before.summary).toMatch(/behind/i);

    const sale = await recordSale(
      session,
      { animalId, exitDate: "2026-06-30", reason: "SOLD", priceKes: 90_000 },
      db,
    );
    if (!sale.ok) throw new Error(sale.error);

    // 23,500 milk + 90,000 sale − 109,000 cost.
    expect(sale.data.lifetime.saleValueKes).toBe(90_000);
    expect(sale.data.lifetime.totalReturnKes).toBe(113_500);
    expect(sale.data.lifetime.profitKes).toBe(4_500);
    expect(sale.data.lifetime.summary).toMatch(/ahead/i);
    await close();
  });

  it("SHOWS THE LIFETIME VALUE AT THE MOMENT OF SALE (R7)", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedALife(db, session);
    const sale = await recordSale(
      session,
      { animalId, exitDate: "2026-06-30", priceKes: 90_000 },
      db,
    );
    if (!sale.ok) throw new Error(sale.error);
    // Not next month, not on another screen — in the confirmation message.
    expect(sale.message).toContain("500 L");
    expect(sale.message).toMatch(/1 calf/);
    expect(sale.message).toMatch(/ahead/i);
    await close();
  });

  it("prices milk off what the farm actually got, not a default, once there are sales", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedALife(db, session);
    await db.insert(s.milkDisposal).values({
      id: newId(),
      farmId: FARM_ID,
      disposedOn: "2026-02-05",
      channel: "COOP",
      litres: "500.00",
      rateKesPerLitre: "52.00",
      valueKes: "26000.00",
      recordedBy: session.userId,
    });

    const life = await animalLifetimeValue(session, animalId, "2026-06-30", db);
    expect(life.pricePerLitreKes).toBe(52);
    expect(life.milkRevenueKes).toBe(26_000);
    await close();
  });

  it("counts a corrected milk record once, not twice", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedALife(db, session);
    const [first] = await db
      .select()
      .from(s.milkRecord)
      .where(eq(s.milkRecord.animalId, animalId));
    await db.insert(s.milkRecord).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      recordedOn: first.recordedOn,
      session: "MORNING",
      litres: "60.00",
      supersedesId: first.id,
      recordedBy: session.userId,
      recordedAt: new Date(),
    });

    const life = await animalLifetimeValue(session, animalId, "2026-06-30", db);
    expect(life.totalLitres).toBe(460); // 400 + the 60 that replaced 100
    await close();
  });

  it("says so in plain words when she never produced anything", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { tag: "KE-8002" });
    const life = await animalLifetimeValue(session, animalId, "2026-06-30", db);
    expect(life.totalLitres).toBe(0);
    expect(life.summary).toMatch(/no recorded milk/i);
    await close();
  });
});

/* ================================================================== */
/* THE CULL LIST                                                      */
/* ================================================================== */

describe("cull list", () => {
  /**
   * Three animals over a 90-day window at the KES 47 default farm gate:
   *   A — 1,350 L (15 L/day), the good cow
   *   B —   180 L (2 L/day), the passenger
   *   C — dry, producing nothing by design
   * One group feed issue of KES 90,000 to the LACTATING group.
   */
  async function seedHerd(db: TestDb, session: ReturnType<typeof fakeSession>) {
    const a = await seedAnimal(db, { tag: "KE-A", name: "Njeri" });
    const b = await seedAnimal(db, { tag: "KE-B", name: "Wambui" });
    const c = await seedAnimal(db, { tag: "KE-C", name: "Muthoni" });

    for (const id of [a, b]) {
      await db.insert(s.calving).values({
        id: newId(),
        farmId: FARM_ID,
        damId: id,
        calvedOn: "2026-01-15",
        recordedBy: session.userId,
      });
    }
    await db.insert(s.calving).values({
      id: newId(),
      farmId: FARM_ID,
      damId: c,
      calvedOn: "2025-06-01",
      recordedBy: session.userId,
    });
    await db.insert(s.dryOff).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: c,
      driedOn: "2026-05-01",
      method: "GRADUAL",
      recordedBy: session.userId,
    });

    await seedMilkFor(
      db,
      a,
      session.userId,
      Array.from({ length: 9 }, (_, i) => [`2026-05-0${i + 1}`, 150] as [string, number]),
    );
    await seedMilkFor(db, b, session.userId, [
      ["2026-05-01", 90],
      ["2026-05-02", 90],
    ]);

    const feedItemId = await seedFeedAt50PerKg(db, session.userId);
    await db.insert(s.feedIssue).values({
      id: newId(),
      farmId: FARM_ID,
      feedItemId,
      issuedOn: "2026-05-15",
      animalGroup: "LACTATING",
      quantity: "1800.000", // 1,800 kg × KES 50 = KES 90,000
      unit: "KG",
      unitWeightKg: "1.000",
      recordedBy: session.userId,
    });

    return { a, b, c };
  }

  it("RANKS THE HERD WORST FIRST and names the loss-maker", async () => {
    const { db, close, session } = await setup();
    const { a, b, c } = await seedHerd(db, session);

    const list = await cullList(session, { asOf: "2026-06-30", windowDays: 90 }, db);
    expect(list.candidates.map((x) => x.animalId)).toEqual([b, c, a]);
    expect(list.candidates[0].tag).toBe("KE-B");
    expect(list.candidates[0].losing).toBe(true);
    await close();
  });

  it("splits group feed into a per-head maintenance share and a per-litre share", async () => {
    const { db, close, session } = await setup();
    await seedHerd(db, session);
    const list = await cullList(session, { asOf: "2026-06-30", windowDays: 90 }, db);

    const good = list.candidates.find((x) => x.tag === "KE-A")!;
    const poor = list.candidates.find((x) => x.tag === "KE-B")!;

    // Half of 90,000 split evenly between the two milkers, the rest by litres.
    expect(good.feedCostKes).toBeCloseTo(62_205.88, 2);
    expect(poor.feedCostKes).toBeCloseTo(27_794.12, 2);
    // Without that split every cow would look equally profitable and this
    // screen would find nothing. The 2 L/day cow carries the same maintenance.
    expect(poor.litres).toBe(180);
    expect(good.litres).toBe(1_350);
    await close();
  });

  it("computes the margin each cow leaves after feed and vet cost", async () => {
    const { db, close, session } = await setup();
    await seedHerd(db, session);
    const list = await cullList(session, { asOf: "2026-06-30", windowDays: 90 }, db);

    const good = list.candidates.find((x) => x.tag === "KE-A")!;
    const poor = list.candidates.find((x) => x.tag === "KE-B")!;
    expect(good.milkRevenueKes).toBe(63_450); // 1,350 × 47
    expect(good.marginKes).toBeCloseTo(1_244.12, 2);
    expect(poor.milkRevenueKes).toBe(8_460); // 180 × 47
    expect(poor.marginKes).toBeCloseTo(-19_334.12, 2);
    expect(poor.marginPerMonthKes).toBeLessThan(-6_000);
    await close();
  });

  it("recommends culling the 2 L/day cow, in words, naming her stall", async () => {
    const { db, close, session } = await setup();
    await seedHerd(db, session);
    const list = await cullList(session, { asOf: "2026-06-30", windowDays: 90 }, db);

    const poor = list.candidates[0];
    expect(poor.action).toBe("CULL");
    expect(poor.recommendation).toContain("Wambui");
    expect(poor.recommendation).toMatch(/2 L a day/);
    expect(poor.recommendation).toMatch(/stall is worth more/i);
    await close();
  });

  it("does not blame the dry cow for earning nothing", async () => {
    const { db, close, session } = await setup();
    await seedHerd(db, session);
    const list = await cullList(session, { asOf: "2026-06-30", windowDays: 90 }, db);

    const dry = list.candidates.find((x) => x.tag === "KE-C")!;
    expect(dry.animalClass).toBe("DRY_COW");
    expect(dry.action).toBe("KEEP");
    expect(dry.recommendation).toMatch(/by design/i);
    expect(dry.losing).toBe(false);
    await close();
  });

  it("does not blame young stock for costing money", async () => {
    const { db, close, session } = await setup();
    await seedHerd(db, session);
    await seedAnimal(db, { tag: "KE-D", name: "Nyokabi", dateOfBirth: "2026-01-01" });

    const list = await cullList(session, { asOf: "2026-06-30", windowDays: 90 }, db);
    const calf = list.candidates.find((x) => x.tag === "KE-D")!;
    expect(calf.action).toBe("KEEP");
    expect(calf.recommendation).toMatch(/meant to cost money now/i);
    await close();
  });

  it("states the share of the herd losing money against the 10–15% norm", async () => {
    const { db, close, session } = await setup();
    await seedHerd(db, session);
    const list = await cullList(session, { asOf: "2026-06-30", windowDays: 90 }, db);

    expect(list.herdSize).toBe(3);
    expect(list.lossMakers).toBe(1);
    expect(list.lossMakerSharePct).toBeCloseTo(33.33, 1);
    expect(list.headline).toContain("Wambui");
    expect(list.headline).toMatch(/10–15%/);
    await close();
  });

  it("says so when nobody is losing money", async () => {
    const { db, close, session } = await setup();
    const id = await seedAnimal(db, { tag: "KE-E" });
    await db.insert(s.calving).values({
      id: newId(),
      farmId: FARM_ID,
      damId: id,
      calvedOn: "2026-04-01",
      recordedBy: session.userId,
    });
    await seedMilkFor(db, id, session.userId, [["2026-05-01", 300]]);

    const list = await cullList(session, { asOf: "2026-06-30", windowDays: 90 }, db);
    expect(list.lossMakers).toBe(0);
    expect(list.headline).toMatch(/covered its feed and vet cost/i);
    await close();
  });

  it("leaves out an animal that has already gone", async () => {
    const { db, close, session } = await setup();
    const { b } = await seedHerd(db, session);
    await recordSale(session, { animalId: b, exitDate: "2026-06-01", priceKes: 40_000 }, db);

    const list = await cullList(session, { asOf: "2026-06-30", windowDays: 90 }, db);
    expect(list.candidates.map((x) => x.tag)).not.toContain("KE-B");
    expect(list.herdSize).toBe(2);
    await close();
  });

  it("says there is nothing to rank on an empty herd", async () => {
    const { db, close, session } = await setup();
    const list = await cullList(session, { asOf: "2026-06-30" }, db);
    expect(list.herdSize).toBe(0);
    expect(list.headline).toMatch(/no animals/i);
    await close();
  });
});

/* ================================================================== */
/* Trade log                                                          */
/* ================================================================== */

describe("trade log", () => {
  it("shows purchases and exits together, newest first", async () => {
    const { db, close, session } = await setup();
    await recordPurchase(
      session,
      { tag: "KE-9001", enteredHerdOn: "2026-03-01", priceKes: 180_000, classOverride: "INCALF_HEIFER" },
      db,
    );
    const soldId = await seedAnimal(db, { tag: "KE-9002" });
    await recordSale(
      session,
      {
        animalId: soldId,
        exitDate: "2026-08-03",
        priceKes: 95_000,
        classAtExit: "CULL_COW",
        weightKg: 420,
      },
      db,
    );

    const log = await tradeLog(session, db);
    expect(log).toHaveLength(2);
    expect(log[0].kind).toBe("LEFT");
    expect(log[0].onDate).toBe("2026-08-03");
    expect(log[0].detail).toContain("420 kg");
    expect(log[1].kind).toBe("BOUGHT");
    expect(log[1].valueKes).toBe(180_000);
    await close();
  });

  it("flags a bought-in animal whose age we only guessed", async () => {
    const { db, close, session } = await setup();
    await recordPurchase(session, { tag: "KE-9003", enteredHerdOn: "2026-03-01", priceKes: 80_000 }, db);
    const log = await tradeLog(session, db);
    expect(log[0].detail).toMatch(/age estimated/i);
    await close();
  });
});

/* ================================================================== */
/* Cross-farm                                                         */
/* ================================================================== */

describe("cross-farm access", () => {
  it("will not sell another farm's animal", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { tag: "KE-X1" });

    const intruder = fakeSession({ role: "OWNER", farmId: OTHER_FARM });
    const attempt = await recordSale(
      intruder,
      { animalId, exitDate: "2026-08-03", priceKes: 200_000 },
      db,
    );
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.error).toBe("That animal was not found.");
    expect(await db.select().from(s.animalExit)).toHaveLength(0);
    expect(await db.select().from(s.income)).toHaveLength(0);
    await close();
  });

  it("will not read another farm's lifetime value", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { tag: "KE-X2" });
    const intruder = fakeSession({ role: "OWNER", farmId: OTHER_FARM });

    await expect(animalLifetimeValue(intruder, animalId, "2026-08-03", db)).rejects.toThrow(
      "That animal was not found.",
    );
    await close();
  });

  it("shows another farm an empty cull list, never ours", async () => {
    const { db, close, session } = await setup();
    await seedAnimal(db, { tag: "KE-X3" });
    const intruder = fakeSession({ role: "OWNER", farmId: OTHER_FARM });
    const list = await cullList(intruder, { asOf: "2026-08-03" }, db);
    expect(list.herdSize).toBe(0);
    await close();
  });

  it("will not sell our animal to another farm's counterparty", async () => {
    const { db, close, session } = await setup();
    // A well-formed UUID that belongs to somebody else. Zod checks shape, never
    // ownership — this is the tenancy boundary, and it is checked before write.
    const stranger = fakeSession({ role: "OWNER", farmId: OTHER_FARM });
    const theirBuyer = await createCounterparty(stranger, { name: "Their Broker", types: ["OTHER"] }, db);
    if (!theirBuyer.ok) throw new Error(theirBuyer.error);

    const animalId = await seedAnimal(db, { tag: "KE-X4" });
    const attempt = await recordSale(
      session,
      {
        animalId,
        exitDate: "2026-08-03",
        priceKes: 100_000,
        counterpartyId: theirBuyer.data.id,
      },
      db,
    );
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.error).toBe("That buyer was not found.");
    expect(await db.select().from(s.animalExit)).toHaveLength(0);
    await close();
  });

  it("refuses a herdsman, who never sees money at all", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { tag: "KE-X5" });
    const herdsman = fakeSession({ role: "HERDSMAN" });
    expect(
      (await recordSale(herdsman, { animalId, exitDate: "2026-08-03", priceKes: 100_000 }, db)).ok,
    ).toBe(false);
    await expect(cullList(herdsman, {}, db)).rejects.toThrow(/permission/i);
    await close();
  });
});
