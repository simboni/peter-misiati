import { describe, it, expect } from "vitest";
import { eq, and } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { FARM_ID, fakeSession, seedAnimal, seedFarm, seedFeedItem } from "@/test/factory";
import { newId } from "@/lib/ids";
import * as s from "@/db/schema";
import {
  costPerKgByItem,
  createFeedItemFor,
  daysOfCoverFor,
  deleteFodderProductionFor,
  feedStore,
  issuePrefill,
  listFodderProduction,
  litresProduced,
  marginOverFeedCost,
  rationAdvice,
  recordFodderProductionFor,
  recordIssueFor,
  recordIssuesFor,
  recordPurchaseFor,
  resolveUnitWeightKg,
  stockBalance,
  updateFodderProductionFor,
  type DbLike,
} from "./feed";

/**
 * M5 against a real database.
 *
 * The numbers are a plausible week on a four-cow Kiambu unit — 20 L a cow a
 * day, dairy meal at KES 47/kg, hay bales weighed rather than assumed — because
 * the headline margin has to be right on real figures, not on tens.
 */

const OTHER_FARM = "22222222-2222-4222-8222-222222222222";
const session = fakeSession({ role: "MANAGER" });

async function setup() {
  const t = await createTestDb();
  await seedFarm(t.db);
  return t;
}

async function seedOtherFarm(db: TestDb) {
  await db.insert(s.farm).values({ id: OTHER_FARM, name: "Nyandarua Rival Dairy" }).onConflictDoNothing();
  const feedItemId = newId();
  await db.insert(s.feedItem).values({
    id: feedItemId,
    farmId: OTHER_FARM,
    name: "Their dairy meal",
    category: "CONCENTRATE",
    defaultUnit: "BAG_70KG",
    defaultUnitWeightKg: "70",
  });
  return { feedItemId };
}

/* ---------------------------------------------------------------- */
/* THE UNIT RULE                                                     */
/* ---------------------------------------------------------------- */

describe("the unit rule — never a bag or a bale without its weight", () => {
  it("refuses a BALE purchase with no weight, and says what to do", async () => {
    const t = await setup();
    const hay = await seedFeedItem(t.db, {
      name: "Boma Rhodes hay",
      category: "FODDER",
      defaultUnit: "BALE",
      defaultUnitWeightKg: null,
      dmPct: "89.00",
    });

    const result = await recordPurchaseFor(
      session,
      { feedItemId: hay, purchasedOn: "2026-08-01", quantity: 20, unit: "BALE", unitPriceKes: 300 },
      t.db as DbLike,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("Weigh one bale");
    expect(result.fieldErrors?.unitWeightKg).toBeTruthy();

    // And nothing was written — a rejected purchase leaves no ghost row.
    const rows = await t.db.select().from(s.feedPurchase);
    expect(rows).toHaveLength(0);
    await t.close();
  });

  it("accepts the same BALE purchase once the weight is given", async () => {
    const t = await setup();
    const hay = await seedFeedItem(t.db, {
      name: "Boma Rhodes hay",
      category: "FODDER",
      defaultUnit: "BALE",
      defaultUnitWeightKg: null,
    });

    const result = await recordPurchaseFor(
      session,
      {
        feedItemId: hay,
        purchasedOn: "2026-08-01",
        quantity: 20,
        unit: "BALE",
        unitWeightKg: 20,
        unitPriceKes: 300,
      },
      t.db as DbLike,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.totalKg).toBe(400);
    expect(result.data.totalCostKes).toBe(6000);
    expect(result.data.costPerKgKes).toBe(15);
    expect(result.refCode).toMatch(/^FD/);
    await t.close();
  });

  it("refuses headloads, wheelbarrows and pickup loads with no weight too", async () => {
    const t = await setup();
    const napier = await seedFeedItem(t.db, {
      name: "Napier grass",
      category: "FODDER",
      defaultUnit: "HEADLOAD",
      defaultUnitWeightKg: null,
      homeGrown: true,
    });
    for (const unit of ["HEADLOAD", "WHEELBARROW", "PICKUP_LOAD"] as const) {
      const r = await recordPurchaseFor(
        session,
        { feedItemId: napier, purchasedOn: "2026-08-01", quantity: 4, unit, unitPriceKes: 100 },
        t.db as DbLike,
      );
      expect(r.ok).toBe(false);
    }
    await t.close();
  });

  it("lets a fixed unit stand on its catalogue weight — a 70 kg bag is 70 kg", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    const r = await recordPurchaseFor(
      session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3290 },
      t.db as DbLike,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.totalKg).toBe(700);
    expect(r.data.costPerKgKes).toBe(47);
    await t.close();
  });

  it("accepts a weight already recorded against that feed on this farm", () => {
    // Somebody weighed a bale of this hay once. That counts as explicit; a
    // catalogue-wide 15 kg guess does not.
    const bales = { defaultUnit: "BALE", defaultUnitWeightKg: "22" };
    expect(resolveUnitWeightKg("BALE", null, bales).unitWeightKg).toBe(22);
    expect(resolveUnitWeightKg("BALE", null, null).ok).toBe(false);
    expect(resolveUnitWeightKg("BALE", 0, null).ok).toBe(false);
    expect(resolveUnitWeightKg("BALE", "", null).ok).toBe(false);
    expect(resolveUnitWeightKg("BAG_50KG", null, null).unitWeightKg).toBe(50);
  });

  it("does not let a bale weight leak onto a line measured in kilograms", () => {
    // The bug this guards: 56 kg of dairy meal from a feed catalogued in 70 kg
    // bags must be 56 kg, not 3,920.
    const bags = { defaultUnit: "BAG_70KG", defaultUnitWeightKg: "70" };
    expect(resolveUnitWeightKg("KG", null, bags).unitWeightKg).toBe(1);
    expect(resolveUnitWeightKg("BAG_70KG", null, bags).unitWeightKg).toBe(70);
    expect(resolveUnitWeightKg("TONNE", null, bags).unitWeightKg).toBe(1000);
  });

  it("refuses an issue in bales with no weight as firmly as a purchase", async () => {
    const t = await setup();
    const hay = await seedFeedItem(t.db, {
      name: "Boma Rhodes hay",
      category: "FODDER",
      defaultUnit: "BALE",
      defaultUnitWeightKg: null,
    });
    const r = await recordIssueFor(
      session,
      { feedItemId: hay, issuedOn: "2026-08-03", quantity: 2, unit: "BALE", animalGroup: "LACTATING" },
      t.db as DbLike,
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain("Weigh one bale");
    await t.close();
  });

  it("refuses a feed item created in bales with no weight", async () => {
    const t = await setup();
    const r = await createFeedItemFor(
      session,
      { name: "Lucerne hay", category: "FODDER", defaultUnit: "BALE" },
      t.db as DbLike,
    );
    expect(r.ok).toBe(false);
    await t.close();
  });
});

/* ---------------------------------------------------------------- */
/* Stock and cover                                                   */
/* ---------------------------------------------------------------- */

describe("stock balance and days of cover", () => {
  it("is purchases in minus issues out", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);

    await recordPurchaseFor(
      session,
      { feedItemId: meal, purchasedOn: "2026-07-28", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3290 },
      t.db as DbLike,
    );
    await recordPurchaseFor(
      session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 4, unit: "BAG_70KG", unitPriceKes: 3360 },
      t.db as DbLike,
    );
    expect(await stockBalance(session, meal, t.db as DbLike)).toBe(980);

    await recordIssueFor(
      session,
      { feedItemId: meal, issuedOn: "2026-08-02", quantity: 56, unit: "KG", animalGroup: "LACTATING" },
      t.db as DbLike,
    );
    expect(await stockBalance(session, meal, t.db as DbLike)).toBe(924);
    await t.close();
  });

  it("takes the weighted average price across deliveries at different prices", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    // 700 kg at KES 47/kg and 280 kg at KES 48/kg.
    await recordPurchaseFor(
      session,
      { feedItemId: meal, purchasedOn: "2026-07-28", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3290 },
      t.db as DbLike,
    );
    await recordPurchaseFor(
      session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 4, unit: "BAG_70KG", unitPriceKes: 3360 },
      t.db as DbLike,
    );
    const costs = await costPerKgByItem(session, "2026-08-31", t.db as DbLike);
    // (32900 + 13440) / 980 kg
    expect(costs.get(meal)).toBe(47.29);
    await t.close();
  });

  it("counts only purchases up to the date asked for", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    await recordPurchaseFor(
      session,
      { feedItemId: meal, purchasedOn: "2026-08-20", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3290 },
      t.db as DbLike,
    );
    expect((await costPerKgByItem(session, "2026-08-10", t.db as DbLike)).get(meal)).toBeUndefined();
    expect((await costPerKgByItem(session, "2026-08-20", t.db as DbLike)).get(meal)).toBe(47);
    await t.close();
  });

  it('says "order this week" with six days left, in the words the store screen uses', async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    await recordPurchaseFor(
      session,
      { feedItemId: meal, purchasedOn: "2026-07-27", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3290 },
      t.db as DbLike,
    );
    // 56 kg a day for the last seven days = 392 kg out, 308 kg left.
    for (let i = 0; i < 7; i++) {
      await recordIssueFor(
        session,
        {
          feedItemId: meal,
          issuedOn: `2026-08-0${i + 1}`,
          quantity: 56,
          unit: "KG",
          animalGroup: "LACTATING",
        },
        t.db as DbLike,
      );
    }
    const cover = await daysOfCoverFor(session, meal, "2026-08-07", t.db as DbLike);
    expect(cover.dailyBurnKg).toBe(56);
    expect(cover.daysOfCover).toBe(5);
    expect(cover.message).toBe("5 days left — order this week.");
    await t.close();
  });

  it("gives the store screen a line a manager can act on, worst first", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    const hay = await seedFeedItem(t.db, {
      name: "Boma Rhodes hay",
      category: "FODDER",
      defaultUnit: "BALE",
      defaultUnitWeightKg: "20",
      dmPct: "89.00",
    });

    await recordPurchaseFor(
      session,
      { feedItemId: meal, purchasedOn: "2026-07-27", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3290 },
      t.db as DbLike,
    );
    await recordPurchaseFor(
      session,
      { feedItemId: hay, purchasedOn: "2026-07-27", quantity: 20, unit: "BALE", unitWeightKg: 20, unitPriceKes: 300 },
      t.db as DbLike,
    );
    for (let i = 0; i < 7; i++) {
      const day = `2026-08-0${i + 1}`;
      await recordIssuesFor(
        session,
        {
          issuedOn: day,
          lines: [
            { feedItemId: meal, quantity: 56, unit: "KG", animalGroup: "LACTATING" },
            { feedItemId: hay, quantity: 2, unit: "BALE", unitWeightKg: 20, animalGroup: "LACTATING" },
          ],
        },
        t.db as DbLike,
      );
    }

    const store = await feedStore(session, "2026-08-07", t.db as DbLike);
    expect(store).toHaveLength(2);
    // Hay runs out first (120 kg left at 40 kg a day), so it leads.
    expect(store[0].name).toBe("Boma Rhodes hay");
    expect(store[0].balanceKg).toBe(120);
    expect(store[0].balanceInUnits).toBe(6);
    expect(store[0].cover.daysOfCover).toBe(3);
    expect(store[0].line).toBe("Boma Rhodes hay: 6 bales (120 kg), 3 days left — order today.");

    const mealLine = store[1];
    expect(mealLine.balanceKg).toBe(308);
    expect(mealLine.balanceInUnits).toBe(4.4);
    expect(mealLine.costPerKgKes).toBe(47);
    expect(mealLine.costPerKgDmKes).toBe(53.41);
    await t.close();
  });
});

/* ---------------------------------------------------------------- */
/* MARGIN OVER FEED COST — end to end                                */
/* ---------------------------------------------------------------- */

/**
 * A week on a four-cow unit, in the numbers a Kiambu farm would recognise:
 *
 *   milk        4 cows × 7 days × (10 + 10 L) =   560 L
 *   sold          500 L to the co-op at 48    = KES 24,000
 *   home use       35 L imputed at 48         = KES  1,680
 *   calves         25 L imputed at 48         = KES  1,200
 *                                 milk value  = KES 26,880  → KES 48.00 / L
 *
 *   dairy meal  6 kg a cow a day, 168 kg @ 47 = KES  7,896
 *   hay         2 bales a day,    280 kg @ 15 = KES  4,200
 *                                  feed cost  = KES 12,096  → KES 21.60 / L
 *
 *   margin over feed cost                                     KES 26.40 / L
 */
async function seedTradingWeek(db: DbLike, opts: { milk?: boolean } = {}) {
  const meal = await seedFeedItem(db as unknown as TestDb);
  const hay = await seedFeedItem(db as unknown as TestDb, {
    name: "Boma Rhodes hay",
    category: "FODDER",
    defaultUnit: "BALE",
    defaultUnitWeightKg: "20",
    dmPct: "89.00",
  });

  await recordPurchaseFor(
    session,
    { feedItemId: meal, purchasedOn: "2026-07-27", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3290 },
    db,
  );
  await recordPurchaseFor(
    session,
    { feedItemId: hay, purchasedOn: "2026-07-27", quantity: 20, unit: "BALE", unitWeightKg: 20, unitPriceKes: 300 },
    db,
  );

  const animals: string[] = [];
  for (let a = 0; a < 4; a++) {
    animals.push(await seedAnimal(db as unknown as TestDb, { tag: `KE-100${a}`, name: `Cow ${a + 1}` }));
  }

  for (let i = 0; i < 7; i++) {
    const day = `2026-08-0${i + 1}`;
    await recordIssuesFor(
      session,
      {
        issuedOn: day,
        lines: [
          { feedItemId: meal, quantity: 24, unit: "KG", animalGroup: "LACTATING", animalsFed: 4 },
          { feedItemId: hay, quantity: 2, unit: "BALE", unitWeightKg: 20, animalGroup: "LACTATING", animalsFed: 4 },
        ],
      },
      db,
    );

    if (opts.milk !== false) {
      for (const animalId of animals) {
        for (const sess of ["MORNING", "EVENING"] as const) {
          await db.insert(s.milkRecord).values({
            id: newId(),
            farmId: FARM_ID,
            animalId,
            recordedOn: day,
            session: sess,
            litres: "10.00",
            recordedBy: session.userId,
            recordedAt: new Date(),
          });
        }
      }
    }
  }

  if (opts.milk !== false) {
    const disposals: Array<[s.DisposalChannel, number]> = [
      ["COOP", 500],
      ["HOME_CONSUMPTION", 35],
      ["CALF_FEEDING", 25],
    ];
    for (const [channel, litres] of disposals) {
      await db.insert(s.milkDisposal).values({
        id: newId(),
        farmId: FARM_ID,
        disposedOn: "2026-08-07",
        channel,
        litres: litres.toFixed(2),
        rateKesPerLitre: "48.00",
        valueKes: (litres * 48).toFixed(2),
        recordedBy: session.userId,
      });
    }
  }

  return { meal, hay, animals };
}

describe("margin over feed cost — the headline number", () => {
  it("computes KES 26.40 a litre from a real week of records", async () => {
    const t = await setup();
    await seedTradingWeek(t.db as DbLike);

    const m = await marginOverFeedCost(session, "2026-08-01", "2026-08-07", t.db as DbLike);

    expect(m.litres).toBe(560);
    expect(m.soldLitres).toBe(500);
    expect(m.soldRevenueKes).toBe(24_000);
    // Home use, calves and the staff ration earn nothing but are worth something.
    // Counting only what was sold, against every litre produced, would
    // understate the margin on every farm that drinks its own milk.
    expect(m.imputedLitres).toBe(60);
    expect(m.imputedValueKes).toBe(2880);
    expect(m.milkRevenueKes).toBe(26_880);

    expect(m.feedCostKes).toBe(12_096);
    expect(m.perFeed).toHaveLength(2);
    expect(m.perFeed[0]).toMatchObject({ name: "Dairy meal (Unga)", kg: 168, costKes: 7896 });
    expect(m.perFeed[1]).toMatchObject({ name: "Boma Rhodes hay", kg: 280, costKes: 4200 });
    expect(m.uncostedFeeds).toEqual([]);

    expect(m.revenuePerLitre).toBe(48);
    expect(m.feedCostPerLitre).toBe(21.6);
    expect(m.marginPerLitre).toBe(26.4);
    expect(m.marginKes).toBe(14_784);
    expect(m.message).toBe(
      "KES 26.40 a litre after feed — milk at KES 48.00 less feed at KES 21.60.",
    );
    await t.close();
  });

  it("states the loss when feed outruns the milk cheque", async () => {
    const t = await setup();
    const { meal } = await seedTradingWeek(t.db as DbLike);

    // A dry-season week: another 15 bags of dairy meal go through the herd.
    await recordPurchaseFor(
      session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 15, unit: "BAG_70KG", unitPriceKes: 3500 },
      t.db as DbLike,
    );
    await recordIssueFor(
      session,
      { feedItemId: meal, issuedOn: "2026-08-06", quantity: 1050, unit: "KG", animalGroup: "LACTATING" },
      t.db as DbLike,
    );

    const m = await marginOverFeedCost(session, "2026-08-01", "2026-08-07", t.db as DbLike);
    expect(m.marginPerLitre).toBeLessThan(0);
    expect(m.marginKes).toBeLessThan(0);
    expect(m.message).toContain("costing more in feed than it earns");
    await t.close();
  });

  it("does not divide by zero when the parlour recorded nothing", async () => {
    const t = await setup();
    await seedTradingWeek(t.db as DbLike, { milk: false });

    const m = await marginOverFeedCost(session, "2026-08-01", "2026-08-07", t.db as DbLike);
    expect(m.litres).toBe(0);
    expect(m.feedCostKes).toBe(12_096);
    expect(m.marginPerLitre).toBe(0);
    expect(m.message).toBe("No milk recorded for this period.");
    await t.close();
  });

  it("names home-grown feed it cannot cost, rather than quietly flattering the number", async () => {
    const t = await setup();
    await seedTradingWeek(t.db as DbLike);
    const napier = await seedFeedItem(t.db, {
      name: "Napier grass",
      category: "FODDER",
      defaultUnit: "HEADLOAD",
      defaultUnitWeightKg: "20",
      dmPct: "20.00",
      homeGrown: true,
    });
    await recordIssueFor(
      session,
      {
        feedItemId: napier,
        issuedOn: "2026-08-03",
        quantity: 10,
        unit: "HEADLOAD",
        unitWeightKg: 20,
        animalGroup: "LACTATING",
      },
      t.db as DbLike,
    );

    const m = await marginOverFeedCost(session, "2026-08-01", "2026-08-07", t.db as DbLike);
    expect(m.uncostedFeeds).toContain("Napier grass");
    // Still counted in kilograms, just not in shillings.
    expect(m.perFeed.find((f) => f.name === "Napier grass")?.kg).toBe(200);
    await t.close();
  });

  it("excludes losses from revenue but keeps the litres in production", async () => {
    const t = await setup();
    await seedTradingWeek(t.db as DbLike);
    await t.db.insert(s.milkDisposal).values({
      id: newId(),
      farmId: FARM_ID,
      disposedOn: "2026-08-05",
      channel: "WITHHELD_TREATMENT",
      litres: "40.00",
      rateKesPerLitre: "48.00",
      valueKes: "1920.00",
      recordedBy: session.userId,
    });
    const m = await marginOverFeedCost(session, "2026-08-01", "2026-08-07", t.db as DbLike);
    expect(m.lossLitres).toBe(40);
    expect(m.milkRevenueKes).toBe(26_880); // unchanged — withheld milk earns nothing
    await t.close();
  });

  it("counts a corrected milk record once, not twice", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db);
    const originalId = newId();
    await t.db.insert(s.milkRecord).values({
      id: originalId,
      farmId: FARM_ID,
      animalId,
      recordedOn: "2026-08-03",
      session: "MORNING",
      litres: "120.00", // a fat-fingered entry
      recordedBy: session.userId,
      recordedAt: new Date(),
    });
    await t.db.insert(s.milkRecord).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      recordedOn: "2026-08-03",
      session: "MORNING",
      litres: "12.00",
      supersedesId: originalId,
      recordedBy: session.userId,
      recordedAt: new Date(),
    });

    expect(await litresProduced(session, "2026-08-01", "2026-08-07", t.db as DbLike)).toBe(12);
    await t.close();
  });
});

/* ---------------------------------------------------------------- */
/* Ration advice                                                     */
/* ---------------------------------------------------------------- */

describe("ration advice", () => {
  it("challenge-feeds a 20-litre cow at 8 kg a day, split into two feeds", async () => {
    const t = await setup();
    const { animals } = await seedTradingWeek(t.db as DbLike);
    await t.db.insert(s.weightObservation).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: animals[0],
      observedOn: "2026-08-01",
      weightKg: "500.00",
      method: "HEART_GIRTH",
      recordedBy: session.userId,
    });

    const advice = await rationAdvice(session, { animalId: animals[0] }, "2026-08-07", t.db as DbLike);
    expect(advice.scope).toBe("ANIMAL");
    expect(advice.dailyYieldL).toBe(20);
    expect(advice.bodyweightAssumed).toBe(false);
    expect(advice.bodyweightKg).toBe(500);
    // (20 − 8) / 1.5 = 8 kg, capped at 4 kg a feed.
    expect(advice.concentrate.kgPerDay).toBe(8);
    expect(advice.concentrate.feedsPerDay).toBe(2);
    expect(advice.concentrate.kgPerFeed).toBe(4);
    expect(advice.dmRequirementKg).toBe(15);
    expect(advice.waterRequirementL).toBe(130);
    await t.close();
  });

  it("falls back to an assumed weight and says so", async () => {
    const t = await setup();
    const { animals } = await seedTradingWeek(t.db as DbLike);
    const advice = await rationAdvice(session, { animalId: animals[1] }, "2026-08-07", t.db as DbLike);
    expect(advice.bodyweightAssumed).toBe(true);
    expect(advice.notes.join(" ")).toContain("weigh her to get this right");
    await t.close();
  });

  it("averages the milking group and reads the concentrate share off the issues", async () => {
    const t = await setup();
    await seedTradingWeek(t.db as DbLike);
    const advice = await rationAdvice(session, { group: "LACTATING" }, "2026-08-07", t.db as DbLike);
    expect(advice.scope).toBe("GROUP");
    expect(advice.animals).toBe(4);
    expect(advice.dailyYieldL).toBe(20);
    // 168 kg of meal at 88% DM = 147.84 kg; 280 kg of hay at 89% = 249.2 kg.
    expect(advice.concentratePctOfDm).toBe(37.24);
    expect(advice.acidosis.risk).toBe(false);
    expect(advice.notes.join(" ")).toContain("The Kenyan guideline is 30%");
    await t.close();
  });

  it("warns about acidosis when the ration actually tips over 55% concentrate", async () => {
    const t = await setup();
    const { meal } = await seedTradingWeek(t.db as DbLike);
    // Somebody has been pushing meal at the cows all week.
    await recordPurchaseFor(
      session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3290 },
      t.db as DbLike,
    );
    await recordIssueFor(
      session,
      { feedItemId: meal, issuedOn: "2026-08-05", quantity: 300, unit: "KG", animalGroup: "LACTATING" },
      t.db as DbLike,
    );
    const advice = await rationAdvice(session, { group: "LACTATING" }, "2026-08-07", t.db as DbLike);
    expect(advice.concentratePctOfDm).toBeGreaterThan(55);
    expect(advice.acidosis.risk).toBe(true);
    expect(advice.notes.join(" ")).toContain("add forage");
    await t.close();
  });

  it("says forage alone is enough for a cow under eight litres", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { tag: "KE-2001", name: "Nyambura" });
    for (let i = 0; i < 7; i++) {
      await t.db.insert(s.milkRecord).values({
        id: newId(),
        farmId: FARM_ID,
        animalId,
        recordedOn: `2026-08-0${i + 1}`,
        session: "MORNING",
        litres: "6.00",
        recordedBy: session.userId,
        recordedAt: new Date(),
      });
    }
    const advice = await rationAdvice(session, { animalId }, "2026-08-07", t.db as DbLike);
    expect(advice.dailyYieldL).toBe(6);
    expect(advice.concentrate.kgPerDay).toBe(0);
    expect(advice.concentrate.note).toContain("No concentrate needed");
    await t.close();
  });

  it("honours a farm that feeds 1 kg per 2 litres", async () => {
    const t = await setup();
    const { animals } = await seedTradingWeek(t.db as DbLike);
    const advice = await rationAdvice(session, { animalId: animals[0] }, "2026-08-07", t.db as DbLike, {
      baselineLitres: 8,
      litresPerKgConcentrate: 2,
      maxKgPerFeed: 4,
    });
    expect(advice.concentrate.kgPerDay).toBe(6);
    await t.close();
  });
});

/* ---------------------------------------------------------------- */
/* Prefill (R5)                                                      */
/* ---------------------------------------------------------------- */

describe("issue prefill", () => {
  it("offers yesterday's amounts, labelled as yesterday's", async () => {
    const t = await setup();
    await seedTradingWeek(t.db as DbLike);

    const prefill = await issuePrefill(session, "2026-08-08", t.db as DbLike);
    const meal = prefill.find((p) => p.name === "Dairy meal (Unga)")!;
    expect(meal.quantity).toBe(24);
    expect(meal.unit).toBe("KG");
    expect(meal.animalGroup).toBe("LACTATING");
    expect(meal.animalsFed).toBe(4);
    // Labelled, never presented as a fact about today (R5).
    expect(meal.prefilledFrom).toBe("2026-08-07");

    const hay = prefill.find((p) => p.name === "Boma Rhodes hay")!;
    expect(hay.quantity).toBe(2);
    expect(hay.unitWeightKg).toBe(20);
    await t.close();
  });

  it("offers nothing rather than a guess when the feed has never been issued", async () => {
    const t = await setup();
    await seedFeedItem(t.db, { name: "Cotton seed cake", defaultUnit: "BAG_50KG", defaultUnitWeightKg: "50" });
    const prefill = await issuePrefill(session, "2026-08-08", t.db as DbLike);
    expect(prefill[0].quantity).toBe(0);
    expect(prefill[0].prefilledFrom).toBeNull();
    await t.close();
  });
});

/* ---------------------------------------------------------------- */
/* Fodder production                                                 */
/* ---------------------------------------------------------------- */

describe("fodder production", () => {
  it("records a harvest and works out what the home-grown feed cost", async () => {
    const t = await setup();
    const r = await recordFodderProductionFor(
      session,
      {
        plotName: "Lower plot",
        crop: "Napier (Bana)",
        areaAcres: 1.5,
        plantedOn: "2026-02-01",
        harvestedOn: "2026-08-01",
        quantity: 60,
        unit: "HEADLOAD",
        unitWeightKg: 20,
        inputCostKes: 9000,
      },
      t.db as DbLike,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.totalKg).toBe(1200);
    expect(r.data.costPerKgKes).toBe(7.5);

    const rows = await listFodderProduction(session, t.db as DbLike);
    expect(rows).toHaveLength(1);
    expect(rows[0].yieldTonnesPerAcre).toBe(0.8);
    await t.close();
  });

  it("refuses a harvest measured in pickup loads with no weight", async () => {
    const t = await setup();
    const r = await recordFodderProductionFor(
      session,
      { crop: "Maize silage", quantity: 3, unit: "PICKUP_LOAD", inputCostKes: 30_000 },
      t.db as DbLike,
    );
    expect(r.ok).toBe(false);
    await t.close();
  });

  it("updates and deletes, scoped to the farm", async () => {
    const t = await setup();
    const created = await recordFodderProductionFor(
      session,
      { crop: "Boma Rhodes", areaAcres: 2, quantity: 100, unit: "BALE", unitWeightKg: 18, inputCostKes: 12_000 },
      t.db as DbLike,
    );
    if (!created.ok) throw new Error(created.error);

    const updated = await updateFodderProductionFor(
      session,
      created.data.id,
      { quantity: 120, harvestedOn: "2026-08-05" },
      t.db as DbLike,
    );
    expect(updated.ok).toBe(true);
    let rows = await listFodderProduction(session, t.db as DbLike);
    expect(rows[0].quantity).toBe(120);
    expect(rows[0].totalKg).toBe(2160);

    const removed = await deleteFodderProductionFor(session, created.data.id, t.db as DbLike);
    expect(removed.ok).toBe(true);
    rows = await listFodderProduction(session, t.db as DbLike);
    expect(rows).toHaveLength(0);
    await t.close();
  });
});

/* ---------------------------------------------------------------- */
/* Tenancy and offline replay                                        */
/* ---------------------------------------------------------------- */

describe("the tenancy boundary", () => {
  it("refuses a purchase against another farm's feed", async () => {
    const t = await setup();
    const other = await seedOtherFarm(t.db);
    await expect(
      recordPurchaseFor(
        session,
        {
          feedItemId: other.feedItemId,
          purchasedOn: "2026-08-01",
          quantity: 10,
          unit: "BAG_70KG",
          unitPriceKes: 3290,
        },
        t.db as DbLike,
      ),
    ).rejects.toThrow("That feed was not found.");

    const rows = await t.db.select().from(s.feedPurchase).where(eq(s.feedPurchase.farmId, OTHER_FARM));
    expect(rows).toHaveLength(0);
    await t.close();
  });

  it("refuses an issue against another farm's feed", async () => {
    const t = await setup();
    const other = await seedOtherFarm(t.db);
    await expect(
      recordIssueFor(
        session,
        { feedItemId: other.feedItemId, issuedOn: "2026-08-03", quantity: 10, unit: "KG" },
        t.db as DbLike,
      ),
    ).rejects.toThrow("That feed was not found.");
    await t.close();
  });

  it("refuses an issue tagged to another farm's animal", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    const foreignAnimal = newId();
    await t.db.insert(s.farm).values({ id: OTHER_FARM, name: "Nyandarua Rival Dairy" }).onConflictDoNothing();
    await t.db.insert(s.animal).values({
      id: foreignAnimal,
      farmId: OTHER_FARM,
      tag: "NY-1",
      sex: "F",
      origin: "BORN",
      enteredHerdOn: "2024-01-01",
    });
    await expect(
      recordIssueFor(
        session,
        { feedItemId: meal, issuedOn: "2026-08-03", quantity: 10, unit: "KG", animalId: foreignAnimal },
        t.db as DbLike,
      ),
    ).rejects.toThrow("That animal was not found.");
    await t.close();
  });

  it("keeps another farm's stock out of this farm's balance", async () => {
    const t = await setup();
    const other = await seedOtherFarm(t.db);
    await t.db.insert(s.feedPurchase).values({
      id: newId(),
      farmId: OTHER_FARM,
      feedItemId: other.feedItemId,
      purchasedOn: "2026-08-01",
      quantity: "50.000",
      unit: "BAG_70KG",
      unitWeightKg: "70.000",
      unitPriceKes: "3290.00",
      totalCostKes: "164500.00",
      recordedBy: newId(),
    });
    expect(await stockBalance(session, other.feedItemId, t.db as DbLike)).toBe(0);
    expect(await feedStore(session, "2026-08-07", t.db as DbLike)).toHaveLength(0);
    await t.close();
  });

  it("keeps another farm's milk and feed out of the margin", async () => {
    const t = await setup();
    await seedTradingWeek(t.db as DbLike);
    await seedOtherFarm(t.db);
    await t.db.insert(s.milkDisposal).values({
      id: newId(),
      farmId: OTHER_FARM,
      disposedOn: "2026-08-03",
      channel: "COOP",
      litres: "5000.00",
      rateKesPerLitre: "48.00",
      valueKes: "240000.00",
      recordedBy: newId(),
    });
    const m = await marginOverFeedCost(session, "2026-08-01", "2026-08-07", t.db as DbLike);
    expect(m.milkRevenueKes).toBe(26_880);
    await t.close();
  });
});

describe("offline replay", () => {
  it("lands a double-flushed purchase once, with one receipt", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    const id = newId();
    const input = {
      id,
      feedItemId: meal,
      purchasedOn: "2026-08-01",
      quantity: 10,
      unit: "BAG_70KG" as const,
      unitPriceKes: 3290,
    };

    const first = await recordPurchaseFor(session, input, t.db as DbLike);
    const second = await recordPurchaseFor(session, input, t.db as DbLike);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("unreachable");
    // Same reference code both times: the herdsman sees the same receipt, not a
    // second one implying a second delivery.
    expect(second.refCode).toBe(first.refCode);

    const rows = await t.db.select().from(s.feedPurchase).where(eq(s.feedPurchase.id, id));
    expect(rows).toHaveLength(1);
    expect(await stockBalance(session, meal, t.db as DbLike)).toBe(700);

    const receipts = await t.db
      .select()
      .from(s.receipt)
      .where(and(eq(s.receipt.farmId, FARM_ID), eq(s.receipt.kind, "FEED_PURCHASE")));
    expect(receipts).toHaveLength(1);
    await t.close();
  });

  it("lands a double-flushed issue once", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    await recordPurchaseFor(
      session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3290 },
      t.db as DbLike,
    );
    const id = newId();
    const input = { id, feedItemId: meal, issuedOn: "2026-08-03", quantity: 56, unit: "KG" as const };
    await recordIssueFor(session, input, t.db as DbLike);
    await recordIssueFor(session, input, t.db as DbLike);

    expect(await t.db.select().from(s.feedIssue)).toHaveLength(1);
    expect(await stockBalance(session, meal, t.db as DbLike)).toBe(644);
    await t.close();
  });
});
