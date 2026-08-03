/**
 * M5 — Feed & Inventory. ADVERSARIAL suite.
 *
 * Feed is 55–65% of the cost of a litre and the whole margin is KES 8–20, so a
 * 40% error in feed cost is the difference between a farm believing it makes
 * money and knowing it does not. Everything here attacks the unit arithmetic,
 * the stock balance and the headline margin.
 *
 * Bug demonstrations are `it.fails(...)`: they assert the CORRECT behaviour.
 */
import { describe, it, expect } from "vitest";
import { eq, and } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { FARM_ID, fakeSession, seedAnimal, seedFarm, seedFeedItem, seedUser } from "@/test/factory";
import * as s from "@/db/schema";
import { newId } from "@/lib/ids";
import { costPerKg, costPerKgDm, toKg } from "@/lib/money";
import { daysOfCover, marginOverFeedCost as pureMargin, stockBalanceKg } from "@/lib/domain/feed";
import {
  costPerKgByItem,
  createFeedItemFor,
  daysOfCoverFor,
  feedStore,
  issuePrefill,
  marginOverFeedCost,
  recordFodderProductionFor,
  recordIssueFor,
  recordIssuesFor,
  recordPurchaseFor,
  rationAdvice,
  resolveUnitWeightKg,
  stockBalance,
  updateFodderProductionFor,
  deleteFodderProductionFor,
  type DbLike,
} from "./feed";

const OTHER_FARM = "22222222-2222-4222-8222-222222222222";
const AUG = { from: "2026-08-01", to: "2026-08-31" } as const;

async function setup(role: s.Role = "MANAGER") {
  const t = await createTestDb();
  await seedFarm(t.db);
  const userId = await seedUser(t.db, { role, fullName: "Grace Wanjiru" });
  return { ...t, userId, session: fakeSession({ role, userId }), d: t.db as DbLike };
}

async function seedOtherFarm(db: TestDb) {
  await db.insert(s.farm).values({ id: OTHER_FARM, name: "Nyandarua Rival Dairy" }).onConflictDoNothing();
  const feedItemId = newId();
  await db.insert(s.feedItem).values({
    id: feedItemId, farmId: OTHER_FARM, name: "Their dairy meal", category: "CONCENTRATE",
    defaultUnit: "BAG_70KG", defaultUnitWeightKg: "70",
  });
  const animalId = newId();
  await db.insert(s.animal).values({
    id: animalId, farmId: OTHER_FARM, tag: "TH-001", sex: "F", origin: "BORN", enteredHerdOn: "2024-01-01",
  });
  await db.insert(s.feedPurchase).values({
    id: newId(), farmId: OTHER_FARM, feedItemId, purchasedOn: "2026-08-01",
    quantity: "100", unit: "BAG_70KG", unitWeightKg: "70", unitPriceKes: "3000.00",
    totalCostKes: "300000.00", recordedBy: newId(),
  });
  const fodderId = newId();
  await db.insert(s.fodderProduction).values({
    id: fodderId, farmId: OTHER_FARM, crop: "Napier", quantity: "10", unit: "PICKUP_LOAD", unitWeightKg: "500",
  });
  return { feedItemId, animalId, fodderId };
}

async function seedMilk(db: TestDb, animalId: string, rows: Array<[string, number]>) {
  for (const [day, litres] of rows) {
    await db.insert(s.milkRecord).values({
      id: newId(), farmId: FARM_ID, animalId, recordedOn: day, session: "MORNING",
      litres: litres.toFixed(2), recordedBy: newId(), recordedAt: new Date(),
    });
  }
}

async function disposal(db: TestDb, v: { on: string; channel: s.DisposalChannel; litres: number; rate: number }) {
  await db.insert(s.milkDisposal).values({
    id: newId(), farmId: FARM_ID, disposedOn: v.on, channel: v.channel,
    litres: v.litres.toFixed(2), rateKesPerLitre: v.rate.toFixed(2),
    valueKes: (v.litres * v.rate).toFixed(2), recordedBy: newId(),
  });
}

/* ================================================================== */
/* 1. THE UNIT RULE — where cost accuracy is won or lost               */
/* ================================================================== */

describe("resolveUnitWeightKg boundaries", () => {
  it("refuses zero, negative and empty weights for units that must be weighed", () => {
    for (const supplied of [null, undefined, "", 0, "0", -5]) {
      const r = resolveUnitWeightKg("BALE", supplied as never, null);
      expect(r.ok).toBe(false);
      expect(r.unitWeightKg).toBe(0);
      expect(r.error).toContain("Weigh one bale");
    }
  });

  it("falls back to the unit definition — never to zero — for defined units", () => {
    expect(resolveUnitWeightKg("KG", 0, null)).toEqual({ ok: true, unitWeightKg: 1 });
    expect(resolveUnitWeightKg("BAG_70KG", "", null)).toEqual({ ok: true, unitWeightKg: 70 });
    expect(resolveUnitWeightKg("TONNE", null, null)).toEqual({ ok: true, unitWeightKg: 1000 });
  });

  it("does NOT leak a bale weight onto a kilogram — 56 kg never becomes 3,920", () => {
    const item = { defaultUnit: "BAG_70KG", defaultUnitWeightKg: "70" };
    expect(resolveUnitWeightKg("KG", null, item)).toEqual({ ok: true, unitWeightKg: 1 });
    const bale = { defaultUnit: "BALE", defaultUnitWeightKg: "22" };
    expect(resolveUnitWeightKg("KG", null, bale)).toEqual({ ok: true, unitWeightKg: 1 });
    expect(resolveUnitWeightKg("BALE", null, bale)).toEqual({ ok: true, unitWeightKg: 22 });
  });

  it("issues a 70 kg bag in KG at the right weight, end to end", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db); // BAG_70KG @ 70
    await recordPurchaseFor(
      t.session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3_500 },
      t.d,
    );
    const issued = await recordIssueFor(
      t.session, { feedItemId: meal, issuedOn: "2026-08-02", quantity: 56, unit: "KG" }, t.d,
    );
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.data.issuedKg).toBe(56); // not 3,920
    expect(issued.data.balanceKg).toBe(644);
    await t.close();
  });
});

describe("a bale bought at one weight and issued at another", () => {
  /*
   * 100 bales of Boma Rhodes, WEIGHED at 25 kg each, KES 350 a bale.
   * The catalogue still says a bale of this hay is 15 kg.
   * The feeder issues all 100 bales without re-typing a weight.
   */
  async function scenario() {
    const t = await setup();
    const hay = await seedFeedItem(t.db, {
      name: "Boma Rhodes hay", category: "FODDER", defaultUnit: "BALE",
      defaultUnitWeightKg: "15", dmPct: "88.00",
    });
    await recordPurchaseFor(
      t.session,
      {
        feedItemId: hay, purchasedOn: "2026-08-01", quantity: 100, unit: "BALE",
        unitWeightKg: 25, unitPriceKes: 350,
      },
      t.d,
    );
    const issued = await recordIssueFor(
      t.session, { feedItemId: hay, issuedOn: "2026-08-02", quantity: 100, unit: "BALE" }, t.d,
    );
    return { ...t, hay, issued };
  }

  it("leaves 1,000 kg of hay in the store that does not exist (observed)", async () => {
    const t = await scenario();
    expect(t.issued.ok).toBe(true);
    if (!t.issued.ok) return;
    // Purchase 100 x 25 kg = 2,500 kg in. Issue 100 x 15 kg = 1,500 kg out.
    expect(t.issued.data.issuedKg).toBe(1_500);
    expect(t.issued.data.balanceKg).toBe(1_000);
    await t.close();
  });

  /**
   * DEFECT — HIGH. `resolveUnitWeightKg` prefers the feed item's CATALOGUE
   * weight over the weight actually recorded on that feed's own purchases. The
   * module's stated purpose is that "a bale silently defaulting to 15 kg when it
   * is really 25 corrupts cost per kg, cost per litre and therefore the headline
   * margin — permanently, because the record is append-only" — and that is
   * exactly what happens as soon as the purchase and the catalogue disagree. The
   * store shows phantom stock and the feed cost is understated 40%.
   */
  it.fails("issuing every bale that was bought empties the store", async () => {
    const t = await scenario();
    expect(await stockBalance(t.session, t.hay, t.d)).toBe(0);
    await t.close();
  });

  it.fails("charges the margin the full KES 35,000 that was actually fed", async () => {
    const t = await scenario();
    const margin = await marginOverFeedCost(t.session, AUG.from, AUG.to, t.d);
    expect(margin.feedCostKes).toBe(35_000); // observed 21,000
    await t.close();
  });
});

describe("division by zero and the arithmetic floor", () => {
  it("never divides by a zero weight — cost per kg of nothing is zero, not Infinity", () => {
    expect(costPerKg(35_000, 0)).toBe(0);
    expect(Number.isFinite(costPerKg(35_000, 0))).toBe(true);
    expect(costPerKgDm(14, 0)).toBe(0);
    expect(toKg(10, 0)).toBe(0);
    expect(stockBalanceKg([], [])).toBe(0);
  });

  it("reports 'not being used' rather than infinite cover when nothing is issued", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    await recordPurchaseFor(
      t.session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3_500 },
      t.d,
    );
    const cover = await daysOfCoverFor(t.session, meal, "2026-08-10", t.d);
    expect(cover.daysOfCover).toBeNull();
    expect(cover.dailyBurnKg).toBe(0);
    expect(cover.message).toBe("Not being used at the moment.");
    await t.close();
  });

  it("handles a zero balance and a zero burn together", () => {
    expect(daysOfCover(0, 0, 7).daysOfCover).toBeNull();
    expect(daysOfCover(0, 70, 7)).toMatchObject({ daysOfCover: 0, message: "Out of stock." });
    expect(daysOfCover(100, 70, 0).daysOfCover).toBeNull(); // zero-day window
  });
});

/* ================================================================== */
/* 2. NEGATIVE STOCK                                                   */
/* ================================================================== */

describe("issuing more than was ever bought", () => {
  it("goes negative silently and says nothing about it (observed)", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    await recordPurchaseFor(
      t.session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 1, unit: "BAG_70KG", unitPriceKes: 3_500 },
      t.d,
    );
    const issued = await recordIssueFor(
      t.session, { feedItemId: meal, issuedOn: "2026-08-02", quantity: 10, unit: "BAG_70KG" }, t.d,
    );
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.data.balanceKg).toBe(-630);
    // Nothing in the line or the message flags an impossible store.
    expect(issued.data.line).toContain("-630 kg");
    expect(issued.data.line).not.toMatch(/negative|impossible|more than/i);
    await t.close();
  });

  /**
   * DEFECT — MEDIUM. A negative stock balance is physically impossible: either a
   * purchase was never recorded or the issue is wrong. R4 says warn, never
   * block — so it must WARN. Today it is silent, and the store screen shows
   * "-630 kg" as if that were a fact. The same negative kg then flows into
   * `daysOfCover` and the margin.
   */
  it.fails("warns when the store goes below zero", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    const issued = await recordIssueFor(
      t.session, { feedItemId: meal, issuedOn: "2026-08-02", quantity: 10, unit: "BAG_70KG" }, t.d,
    );
    if (!issued.ok) throw new Error(issued.error);
    expect(issued.data.line).toMatch(/more than the store holds|never recorded|check/i);
    await t.close();
  });

  it("refuses a negative issue outright", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    const res = await recordIssueFor(
      t.session, { feedItemId: meal, issuedOn: "2026-08-02", quantity: -5, unit: "KG" }, t.d,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("cannot be less than zero");
    await t.close();
  });

  it("drops a zero line as 'not fed today' and refuses an all-zero submit", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    const hay = await seedFeedItem(t.db, { name: "Hay", defaultUnit: "KG", defaultUnitWeightKg: "1" });
    const res = await recordIssuesFor(
      t.session,
      { issuedOn: "2026-08-02", lines: [
        { feedItemId: meal, quantity: 0, unit: "BAG_70KG" },
        { feedItemId: hay, quantity: 20, unit: "KG" },
      ] },
      t.d,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.lines).toHaveLength(1);
    expect(await db_rows(t.db)).toBe(1);

    const allZero = await recordIssuesFor(
      t.session, { issuedOn: "2026-08-03", lines: [{ feedItemId: meal, quantity: 0 }] }, t.d,
    );
    expect(allZero.ok).toBe(false);
    if (!allZero.ok) expect(allZero.error).toContain("every amount was zero");
    await t.close();
  });

  async function db_rows(db: TestDb) {
    return (await db.select().from(s.feedIssue).where(eq(s.feedIssue.farmId, FARM_ID))).length;
  }
});

/* ================================================================== */
/* 3. MONEY ARITHMETIC                                                 */
/* ================================================================== */

describe("purchase arithmetic", () => {
  it("stores quantity, weight, unit price and total as exact strings", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    const res = await recordPurchaseFor(
      t.session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 7, unit: "BAG_70KG", unitPriceKes: 3_566.67 },
      t.d,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await t.db.select().from(s.feedPurchase).where(eq(s.feedPurchase.farmId, FARM_ID));
    expect(row.quantity).toBe("7.000");
    expect(row.unitWeightKg).toBe("70.000");
    expect(row.unitPriceKes).toBe("3566.67");
    expect(row.totalCostKes).toBe("24966.69"); // 7 x 3,566.67 exactly
    expect(res.data.totalKg).toBe(490);
    expect(res.data.costPerKgKes).toBe(50.95); // 24,966.69 / 490
    await t.close();
  });

  it("keeps 0.1 x 0.2 out of the store as 0.02, not 0.020000000000000004", async () => {
    const t = await setup();
    const item = await seedFeedItem(t.db, { name: "Molasses", defaultUnit: "LITRE", defaultUnitWeightKg: "1.4" });
    const res = await recordPurchaseFor(
      t.session,
      { feedItemId: item, purchasedOn: "2026-08-01", quantity: 0.1, unit: "LITRE", unitPriceKes: 0.2 },
      t.d,
    );
    if (!res.ok) throw new Error(res.error);
    const [row] = await t.db.select().from(s.feedPurchase).where(eq(s.feedPurchase.farmId, FARM_ID));
    expect(row.totalCostKes).toBe("0.02");
    await t.close();
  });

  it("weights the average cost per kg across purchases at different prices", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    await recordPurchaseFor(
      t.session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3_500 },
      t.d,
    ); // 700 kg for 35,000 -> 50/kg
    await recordPurchaseFor(
      t.session,
      { feedItemId: meal, purchasedOn: "2026-08-15", quantity: 10, unit: "BAG_70KG", unitPriceKes: 4_200 },
      t.d,
    ); // 700 kg for 42,000 -> 60/kg
    const costs = await costPerKgByItem(t.session, "2026-08-31", t.d);
    expect(costs.get(meal)).toBe(55); // 77,000 / 1,400
    // A purchase after `asOf` must not retro-price earlier feed.
    expect((await costPerKgByItem(t.session, "2026-08-10", t.d)).get(meal)).toBe(50);
    await t.close();
  });

  /**
   * DEFECT — MEDIUM. `unitPriceKes` has no lower bound. A mistyped minus sign
   * writes a NEGATIVE feed purchase, which silently drags the weighted average
   * cost per kg — and therefore margin over feed cost and every cull-list
   * verdict that depends on it — in the wrong direction.
   */
  it.fails("refuses a negative unit price", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    const res = await recordPurchaseFor(
      t.session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 10, unit: "BAG_70KG", unitPriceKes: -3_500 },
      t.d,
    );
    expect(res.ok).toBe(false);
    await t.close();
  });

  it("shows what a negative price actually does to the average (observed)", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    await recordPurchaseFor(
      t.session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3_500 },
      t.d,
    );
    await recordPurchaseFor(
      t.session,
      { feedItemId: meal, purchasedOn: "2026-08-02", quantity: 10, unit: "BAG_70KG", unitPriceKes: -3_500 },
      t.d,
    );
    expect((await costPerKgByItem(t.session, "2026-08-31", t.d)).get(meal)).toBe(0);
    await t.close();
  });
});

/* ================================================================== */
/* 4. MARGIN OVER FEED COST — the headline number                      */
/* ================================================================== */

describe("margin over feed cost", () => {
  it("says 'no milk' rather than dividing by zero litres", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    await recordPurchaseFor(
      t.session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3_500 },
      t.d,
    );
    await recordIssueFor(
      t.session, { feedItemId: meal, issuedOn: "2026-08-02", quantity: 10, unit: "BAG_70KG" }, t.d,
    );
    const m = await marginOverFeedCost(t.session, AUG.from, AUG.to, t.d);
    expect(m.litres).toBe(0);
    expect(m.feedCostKes).toBe(35_000);
    expect(m.revenuePerLitre).toBe(0);
    expect(m.feedCostPerLitre).toBe(0);
    expect(m.marginPerLitre).toBe(0);
    expect(m.marginKes).toBe(-35_000); // the loss is still stated
    expect(m.message).toBe("No milk recorded for this period.");
    await t.close();
  });

  it("states plainly when a litre costs more in feed than it earns", async () => {
    const t = await setup();
    const animal = await seedAnimal(t.db, { tag: "KE-0001" });
    await seedMilk(t.db, animal, [["2026-08-10", 100]]);
    await disposal(t.db, { on: "2026-08-10", channel: "COOP", litres: 100, rate: 40 });

    const meal = await seedFeedItem(t.db);
    await recordPurchaseFor(
      t.session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 2, unit: "BAG_70KG", unitPriceKes: 3_500 },
      t.d,
    );
    await recordIssueFor(
      t.session, { feedItemId: meal, issuedOn: "2026-08-10", quantity: 2, unit: "BAG_70KG" }, t.d,
    );

    const m = await marginOverFeedCost(t.session, AUG.from, AUG.to, t.d);
    expect(m.litres).toBe(100);
    expect(m.soldRevenueKes).toBe(4_000);
    expect(m.feedCostKes).toBe(7_000);
    expect(m.revenuePerLitre).toBe(40);
    expect(m.feedCostPerLitre).toBe(70);
    expect(m.marginPerLitre).toBe(-30);
    expect(m.message).toContain("costing more in feed than it earns");
    await t.close();
  });

  it("names feeds it could not cost instead of quietly flattering the margin", async () => {
    const t = await setup();
    const animal = await seedAnimal(t.db, { tag: "KE-0001" });
    await seedMilk(t.db, animal, [["2026-08-10", 100]]);
    const napier = await seedFeedItem(t.db, {
      name: "Napier grass", category: "FODDER", homeGrown: true, defaultUnit: "KG", defaultUnitWeightKg: "1",
    });
    await recordIssueFor(
      t.session, { feedItemId: napier, issuedOn: "2026-08-10", quantity: 400, unit: "KG" }, t.d,
    );
    const m = await marginOverFeedCost(t.session, AUG.from, AUG.to, t.d);
    expect(m.feedCostKes).toBe(0);
    expect(m.uncostedFeeds).toEqual(["Napier grass"]);
    await t.close();
  });

  it("counts withheld and spilled milk as loss, not as revenue", async () => {
    const t = await setup();
    const animal = await seedAnimal(t.db, { tag: "KE-0001" });
    await seedMilk(t.db, animal, [["2026-08-10", 100]]);
    await disposal(t.db, { on: "2026-08-10", channel: "HOUSEHOLD", litres: 60, rate: 70 });
    await disposal(t.db, { on: "2026-08-10", channel: "CALF_FEEDING", litres: 20, rate: 70 });
    await disposal(t.db, { on: "2026-08-10", channel: "SPOILAGE", litres: 20, rate: 70 });

    const m = await marginOverFeedCost(t.session, AUG.from, AUG.to, t.d);
    expect(m.soldLitres).toBe(60);
    expect(m.soldRevenueKes).toBe(4_200);
    expect(m.imputedLitres).toBe(20);
    expect(m.imputedValueKes).toBe(1_400);
    expect(m.lossLitres).toBe(20);
    // The 20 L that spoiled contributes nothing to revenue but every litre
    // produced still carries its share of the feed bill.
    expect(m.milkRevenueKes).toBe(5_600);
    expect(m.litres).toBe(100);
    await t.close();
  });

  it("is a pure function of its three inputs, with the same rounding", () => {
    expect(pureMargin(0, 0, 0)).toMatchObject({ marginPerLitre: 0, message: "No milk recorded for this period." });
    expect(pureMargin(100, 33.33, 3).marginPerLitre).toBe(22.22); // 33.33 - 11.11
  });
});

/* ================================================================== */
/* 5. THE APPROVAL BOUNDARY DOES NOT EXIST HERE                        */
/* ================================================================== */

describe("feed purchases and the approval boundary", () => {
  /**
   * DEFECT — HIGH. Every other money row in this system is born PENDING and
   * moves no report until a manager approves it. `feed_purchase` has no status
   * column and `recordPurchaseFor` writes no `expense` row, so a single entry by
   * one person immediately and permanently changes the weighted average cost per
   * kg, margin over feed cost, the cull list and every animal's lifetime value —
   * with no approval, no audit row, and no way to void it. Feed is the largest
   * single cost on the farm and it is the one cost nobody has to approve.
   */
  it.fails("a feed purchase does not move the margin until it is approved", async () => {
    const t = await setup();
    const animal = await seedAnimal(t.db, { tag: "KE-0001" });
    await seedMilk(t.db, animal, [["2026-08-10", 100]]);
    const meal = await seedFeedItem(t.db);
    await recordPurchaseFor(
      t.session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3_500 },
      t.d,
    );
    await recordIssueFor(
      t.session, { feedItemId: meal, issuedOn: "2026-08-10", quantity: 10, unit: "BAG_70KG" }, t.d,
    );
    const m = await marginOverFeedCost(t.session, AUG.from, AUG.to, t.d);
    expect(m.feedCostKes).toBe(0); // observed 35,000 — unapproved and already counted
    await t.close();
  });

  it("writes no audit row and no expense row for a KES 35,000 purchase (observed)", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    await recordPurchaseFor(
      t.session,
      { feedItemId: meal, purchasedOn: "2026-08-01", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3_500 },
      t.d,
    );
    expect(await t.db.select().from(s.expense).where(eq(s.expense.farmId, FARM_ID))).toHaveLength(0);
    expect(await t.db.select().from(s.auditEntry).where(eq(s.auditEntry.farmId, FARM_ID))).toHaveLength(0);
    await t.close();
  });
});

/* ================================================================== */
/* 6. OFFLINE REPLAY                                                   */
/* ================================================================== */

describe("an offline flush that arrives twice", () => {
  it("does not double-count a replayed purchase or a replayed issue", async () => {
    const t = await setup();
    const meal = await seedFeedItem(t.db);
    const purchaseId = newId();
    const issueId = newId();
    const purchase = {
      id: purchaseId, feedItemId: meal, purchasedOn: "2026-08-01",
      quantity: 10, unit: "BAG_70KG" as const, unitPriceKes: 3_500,
    };
    await recordPurchaseFor(t.session, purchase, t.d);
    await recordPurchaseFor(t.session, purchase, t.d);
    expect(await stockBalance(t.session, meal, t.d)).toBe(700);

    const issue = { id: issueId, feedItemId: meal, issuedOn: "2026-08-02", quantity: 2, unit: "BAG_70KG" as const };
    const first = await recordIssueFor(t.session, issue, t.d);
    const second = await recordIssueFor(t.session, issue, t.d);
    expect(first.ok && second.ok).toBe(true);
    expect(await stockBalance(t.session, meal, t.d)).toBe(560);
    if (first.ok && second.ok) expect(second.refCode).toBe(first.refCode); // same receipt, not two
    await t.close();
  });
});

/* ================================================================== */
/* 7. TENANCY                                                          */
/* ================================================================== */

describe("tenancy", () => {
  it("refuses another farm's feed identically to feed that does not exist", async () => {
    const t = await setup();
    const theirs = await seedOtherFarm(t.db);
    const ghost = newId();

    const a = await recordPurchaseFor(
      t.session,
      { feedItemId: theirs.feedItemId, purchasedOn: "2026-08-01", quantity: 1, unit: "BAG_70KG", unitPriceKes: 1 },
      t.d,
    );
    const b = await recordPurchaseFor(
      t.session,
      { feedItemId: ghost, purchasedOn: "2026-08-01", quantity: 1, unit: "BAG_70KG", unitPriceKes: 1 },
      t.d,
    );
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok && !b.ok) {
      expect(a.error).toBe("That feed was not found.");
      expect(a.error).toBe(b.error);
    }

    const c = await recordIssueFor(
      t.session, { feedItemId: theirs.feedItemId, issuedOn: "2026-08-02", quantity: 1, unit: "BAG_70KG" }, t.d,
    );
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).toContain("That feed was not found.");
    await t.close();
  });

  it("refuses another farm's animal on an issue line and on ration advice", async () => {
    const t = await setup();
    const theirs = await seedOtherFarm(t.db);
    const meal = await seedFeedItem(t.db);

    const res = await recordIssueFor(
      t.session,
      { feedItemId: meal, issuedOn: "2026-08-02", quantity: 1, unit: "BAG_70KG", animalId: theirs.animalId },
      t.d,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("That animal was not found.");
    // ...and nothing was written, because every line is validated before any write.
    expect(await t.db.select().from(s.feedIssue).where(eq(s.feedIssue.farmId, FARM_ID))).toHaveLength(0);

    await expect(rationAdvice(t.session, { animalId: theirs.animalId }, "2026-08-02", t.d))
      .rejects.toThrow("That animal was not found.");
    await expect(rationAdvice(t.session, { animalId: newId() }, "2026-08-02", t.d))
      .rejects.toThrow("That animal was not found.");
    await t.close();
  });

  it("never counts another farm's feed in stock, cost, store, prefill or margin", async () => {
    const t = await setup();
    const theirs = await seedOtherFarm(t.db);

    expect(await stockBalance(t.session, theirs.feedItemId, t.d)).toBe(0);
    expect((await costPerKgByItem(t.session, "2026-08-31", t.d)).size).toBe(0);
    expect(await feedStore(t.session, "2026-08-31", t.d)).toHaveLength(0);
    expect(await issuePrefill(t.session, "2026-08-31", t.d)).toHaveLength(0);
    expect((await marginOverFeedCost(t.session, AUG.from, AUG.to, t.d)).feedCostKes).toBe(0);
    await t.close();
  });

  it("refuses to update or delete another farm's fodder record", async () => {
    const t = await setup();
    const theirs = await seedOtherFarm(t.db);
    const u = await updateFodderProductionFor(t.session, theirs.fodderId, { crop: "Hijacked" }, t.d);
    const del = await deleteFodderProductionFor(t.session, theirs.fodderId, t.d);
    expect(u.ok).toBe(false);
    expect(del.ok).toBe(false);
    if (!u.ok) expect(u.error).toBe("That fodder record was not found.");
    const [row] = await t.db.select().from(s.fodderProduction).where(eq(s.fodderProduction.id, theirs.fodderId));
    expect(row.crop).toBe("Napier");
    await t.close();
  });
});

/* ================================================================== */
/* 8. HOSTILE TEXT                                                     */
/* ================================================================== */

describe("hostile text", () => {
  it("stores unicode and SQL-shaped feed and crop names verbatim", async () => {
    const t = await setup();
    const nasty = `Robert'); DROP TABLE feed_item;--`;
    const unicode = "Ngano 🌾 Wanjirũ — 70kg «bag»";

    const a = await createFeedItemFor(
      t.session, { name: nasty, category: "CONCENTRATE", defaultUnit: "BAG_70KG" }, t.d,
    );
    const b = await createFeedItemFor(
      t.session, { name: unicode, category: "FODDER", defaultUnit: "KG" }, t.d,
    );
    expect(a.ok && b.ok).toBe(true);

    const fodder = await recordFodderProductionFor(
      t.session, { crop: nasty, plotName: unicode, quantity: 3, unit: "PICKUP_LOAD", unitWeightKg: 500 }, t.d,
    );
    expect(fodder.ok).toBe(true);

    const items = await t.db.select().from(s.feedItem).where(eq(s.feedItem.farmId, FARM_ID));
    expect(items.map((i) => i.name).sort()).toEqual([nasty, unicode].sort());
    const store = await feedStore(t.session, "2026-08-31", t.d);
    expect(store).toHaveLength(2); // the table is still there
    await t.close();
  });

  it("refuses a fodder harvest measured in unweighed pickup loads", async () => {
    const t = await setup();
    const res = await recordFodderProductionFor(
      t.session, { crop: "Napier", quantity: 3, unit: "PICKUP_LOAD" }, t.d,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Weigh one pickup load");
    await t.close();
  });
});
