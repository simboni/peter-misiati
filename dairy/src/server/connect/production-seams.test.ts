import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { FARM_ID, fakeSession, seedAnimal, seedCustomer, seedFarm, seedFeedItem, seedUser } from "@/test/factory";
import { newId } from "@/lib/ids";
import * as s from "@/db/schema";
import { addDays, today } from "@/lib/domain/dates";
import { correctMilkRecord, dayProduction, milkSheet, recordMilkBatch } from "../milk";
import { allocateMilk, recordDisposal } from "../sales";
import { costPerKgByItem, litresProduced, marginOverFeedCost, recordIssuesFor, recordPurchaseFor } from "../feed";
import { approveExpense, costOfProduction } from "../money";
import { recordSale } from "../trading";

/**
 * THE PRODUCTION SEAMS — milk → sales, and feed + milk → margin.
 *
 * Two joins, one question each.
 *
 * M4 allocates against M3's day: `Σ(session yields) = Σ(disposals)`. If those
 * two numbers are computed from different sets of rows — a superseded
 * correction counted twice, an exited cow still on the sheet — the daily
 * reconciliation stops being the milk-theft signal it exists to be, and starts
 * being noise a farm learns to ignore.
 *
 * M5's margin over feed cost is the headline number on the money screen. It
 * joins feed ISSUES (costed from PURCHASES) to milk LITRES and milk VALUE. Get
 * the period boundaries or the approval rules wrong at that join and the one
 * figure an owner actually reads is wrong.
 *
 * Kenyan values throughout: dairy meal at KES 3,300 a 70 kg bag, milk at
 * KES 52 a litre, cows at 12 and 18 litres a day.
 */

const T0 = today();
const D = (n: number) => addDays(T0, n);
const PERIOD = { from: D(-7), to: T0 } as const;
const OTHER_FARM = "22222222-2222-4222-8222-222222222222";

async function setup() {
  const { db, close } = await createTestDb();
  await seedFarm(db);
  const userId = await seedUser(db, { role: "MANAGER", fullName: "Grace Wanjiru" });
  return { db, close, session: fakeSession({ role: "MANAGER", userId }) };
}

/** The co-op is paying KES 52 a litre. That rate also values the milk nobody pays for. */
async function seedPrice(db: TestDb, rate = 52) {
  await db.insert(s.priceList).values({
    id: newId(),
    farmId: FARM_ID,
    scope: "CHANNEL",
    customerType: "COOP",
    rateKesPerLitre: rate.toFixed(2),
    effectiveFrom: D(-365),
    setBy: newId(),
  });
}

/** A cow is on the milking sheet only because M2 recorded her calving. */
async function seedMilkingCow(db: TestDb, opts: { name: string; tag: string; calvedOn?: string }) {
  const id = await seedAnimal(db, { name: opts.name, tag: opts.tag, dateOfBirth: "2020-06-01" });
  await db.insert(s.calving).values({
    id: newId(),
    farmId: FARM_ID,
    damId: id,
    calvedOn: opts.calvedOn ?? D(-120),
    recordedBy: newId(),
  });
  return id;
}

/** Njeri gives 18 L a day, Nyambura 12 — a plausible pair of grade Friesians. */
async function seedTwoCowsMilking(
  db: TestDb,
  session: ReturnType<typeof fakeSession>,
  days: number[] = [-1, 0],
) {
  const njeri = await seedMilkingCow(db, { name: "Njeri", tag: "KE-0001" });
  const nyambura = await seedMilkingCow(db, { name: "Nyambura", tag: "KE-0002" });
  for (const day of days) {
    await recordMilkBatch(
      session,
      {
        date: D(day),
        session: "MORNING",
        rows: [
          { animalId: njeri, litres: 10 },
          { animalId: nyambura, litres: 7 },
        ],
      },
      db,
    );
    await recordMilkBatch(
      session,
      {
        date: D(day),
        session: "EVENING",
        rows: [
          { animalId: njeri, litres: 8 },
          { animalId: nyambura, litres: 5 },
        ],
      },
      db,
    );
  }
  return { njeri, nyambura };
}

/* ================================================================== */
/* SEAM 3a — the day's totals are what the allocation allocates        */
/* ================================================================== */

describe("the allocation screen works from the milk records, not a second tally", () => {
  it("carries every session's litres into the day the allocation opens on", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db);
    await seedTwoCowsMilking(db, session, [0]);

    const day = await dayProduction(session, T0, db);
    expect(day.totalL).toBe(30);
    expect(day.saleableL).toBe(30);
    expect(day.bySession).toEqual([
      { session: "MORNING", litres: 17 },
      { session: "EVENING", litres: 13 },
    ]);

    const allocation = await allocateMilk(session, T0, db);
    expect(allocation.production.totalL).toBe(30);
    expect(allocation.maxSaleableL).toBe(30);
    expect(allocation.unallocatedL).toBe(30); // nothing disposed yet
    await close();
  });

  it("counts only the day asked for", async () => {
    const { db, close, session } = await setup();
    await seedTwoCowsMilking(db, session, [-1, 0]);
    expect((await dayProduction(session, T0, db)).totalL).toBe(30);
    expect((await dayProduction(session, D(-1), db)).totalL).toBe(30);
    expect((await dayProduction(session, D(-2), db)).totalL).toBe(0);
    await close();
  });
});

/* ================================================================== */
/* SEAM 3d — a correction is a new row and must not double-count       */
/* ================================================================== */

describe("a corrected milk entry replaces the original instead of adding to it", () => {
  async function milkAndCorrect() {
    const { db, close, session } = await setup();
    await seedPrice(db);
    const cow = await seedMilkingCow(db, { name: "Njeri", tag: "KE-0001" });
    const recordId = newId();
    await recordMilkBatch(
      session,
      { date: T0, session: "MORNING", rows: [{ id: recordId, animalId: cow, litres: 10 }] },
      db,
    );
    // The herdsman keyed 10 when the bucket said 14.
    const corrected = await correctMilkRecord(session, { recordId, litres: 14, reason: "Misread the jug" }, db);
    if (!corrected.ok) throw new Error(corrected.error);
    return { db, close, session, cow, recordId };
  }

  it("shows 14 litres for the day, not 24", async () => {
    const { db, close, session } = await milkAndCorrect();
    expect(await db.select().from(s.milkRecord)).toHaveLength(2); // both rows kept (P3)
    expect((await dayProduction(session, T0, db)).totalL).toBe(14);
    expect((await allocateMilk(session, T0, db)).production.totalL).toBe(14);
    await close();
  });

  it("gives the same 14 litres to the period figures the margin is built on", async () => {
    const { db, close, session } = await milkAndCorrect();
    expect(await litresProduced(session, PERIOD.from, PERIOD.to, db)).toBe(14);
    expect((await marginOverFeedCost(session, PERIOD.from, PERIOD.to, db)).litres).toBe(14);
    await close();
  });

  it("reconciles against the corrected figure, so a correction does not invent a variance", async () => {
    const { db, close, session } = await milkAndCorrect();
    const coopId = await seedCustomer(db, { customerType: "COOP" });
    await recordDisposal(session, { date: T0, channel: "COOP", customerId: coopId, litres: 14 }, db);

    const allocation = await allocateMilk(session, T0, db);
    expect(allocation.reconciliation.balanced).toBe(true);
    expect(allocation.reconciliation.varianceL).toBe(0);
    await close();
  });

  it("keeps the correction visible to the manager rather than swallowing it", async () => {
    const { db, close, session, recordId } = await milkAndCorrect();
    const rows = await db.select().from(s.milkRecord);
    const correction = rows.find((r) => r.supersedesId === recordId)!;
    expect(correction.flagged).toBe(true);
    expect(correction.flagReason).toBe("CORRECTION");
    expect(correction.litres).toBe("14.00");
    await close();
  });
});

/* ================================================================== */
/* SEAM 3b — the allocation must reconcile                             */
/* ================================================================== */

describe("produced equals sold plus given away plus lost", () => {
  it("balances a day where every litre is accounted for", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db);
    await seedTwoCowsMilking(db, session, [0]); // 30 L
    const coopId = await seedCustomer(db, { customerType: "COOP" });

    await recordDisposal(session, { date: T0, channel: "COOP", customerId: coopId, litres: 20 }, db);
    await recordDisposal(session, { date: T0, channel: "HOME_CONSUMPTION", litres: 5 }, db);
    await recordDisposal(session, { date: T0, channel: "CALF_FEEDING", litres: 3 }, db);
    await recordDisposal(session, { date: T0, channel: "SPOILAGE", litres: 2, lossReason: "SOURED" }, db);

    const a = await allocateMilk(session, T0, db);
    expect(a.reconciliation.producedL).toBe(30);
    expect(a.reconciliation.revenueL).toBe(20);
    expect(a.reconciliation.imputedL).toBe(8);
    expect(a.reconciliation.lossL).toBe(2);
    expect(a.reconciliation.revenueL + a.reconciliation.imputedL + a.reconciliation.lossL).toBe(30);
    expect(a.reconciliation.varianceL).toBe(0);
    expect(a.reconciliation.balanced).toBe(true);
    expect(a.unallocatedL).toBe(0);

    // And the money follows the litres: 20 sold, 8 valued but unpaid.
    expect(a.revenueKes).toBe(1_040);
    expect(a.imputedValueKes).toBe(416);
    expect(a.blendedKes).toBe(52);
    await close();
  });

  it("asks where the missing litres went instead of hiding the gap", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db);
    await seedTwoCowsMilking(db, session, [0]); // 30 L
    const coopId = await seedCustomer(db, { customerType: "COOP" });
    await recordDisposal(session, { date: T0, channel: "COOP", customerId: coopId, litres: 20 }, db);

    const a = await allocateMilk(session, T0, db);
    expect(a.reconciliation.balanced).toBe(false);
    expect(a.reconciliation.varianceL).toBe(10);
    expect(a.reconciliation.message).toMatch(/10.0 L unaccounted for/);
    expect(a.warnings.join(" ")).toMatch(/unaccounted for/);
    expect(a.unallocatedL).toBe(10);
    await close();
  });

  it("says so the other way round too — more sold than was ever milked", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db);
    await seedTwoCowsMilking(db, session, [0]); // 30 L
    const coopId = await seedCustomer(db, { customerType: "COOP" });
    await recordDisposal(session, { date: T0, channel: "COOP", customerId: coopId, litres: 35 }, db);

    const a = await allocateMilk(session, T0, db);
    expect(a.reconciliation.varianceL).toBe(-5);
    expect(a.reconciliation.balanced).toBe(false);
    expect(a.reconciliation.message).toMatch(/more was sold than recorded as produced/);
    await close();
  });

  it("flags a day whose losses run above what a Kenyan farm should expect", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db);
    await seedTwoCowsMilking(db, session, [0]); // 30 L
    await recordDisposal(session, { date: T0, channel: "SPOILAGE", litres: 6, lossReason: "SPOILAGE" }, db);

    const a = await allocateMilk(session, T0, db);
    expect(a.lossL).toBe(6);
    expect(a.lossPct).toBe(20);
    expect(a.warnings.join(" ")).toMatch(/Losses are running at 20%/);
    await close();
  });
});

/* ================================================================== */
/* SEAM 3c — an exit takes her off the sheet from that date            */
/* ================================================================== */

describe("a cow who has left the herd", () => {
  it("drops off the milking sheet from her exit date, and not before it", async () => {
    const { db, close, session } = await setup();
    const { njeri, nyambura } = await seedTwoCowsMilking(db, session, [-3]);

    const sale = await recordSale(
      session,
      {
        animalId: njeri,
        exitDate: D(-1),
        reason: "SOLD",
        priceKes: 95_000,
        counterpartyKind: "FARMER",
        dailyYieldAtSaleL: 18,
      },
      db,
    );
    if (!sale.ok) throw new Error(sale.error);

    const before = await milkSheet(session, D(-2), "MORNING", db);
    expect(before.rows.map((r) => r.animalId).sort()).toEqual([njeri, nyambura].sort());

    for (const day of [D(-1), T0]) {
      const after = await milkSheet(session, day, "MORNING", db);
      expect(after.rows.map((r) => r.animalId)).toEqual([nyambura]);
    }
    await close();
  });

  it("does the same when she died, and leaves her past litres in the books", async () => {
    const { db, close, session } = await setup();
    const { njeri } = await seedTwoCowsMilking(db, session, [-3]);

    const died = await recordSale(
      session,
      { animalId: njeri, exitDate: D(-1), reason: "DIED", cause: "East Coast Fever", priceKes: 0 },
      db,
    );
    if (!died.ok) throw new Error(died.error);
    expect(died.data.incomeId).toBeNull(); // a death is not income

    expect((await milkSheet(session, T0, "MORNING", db)).rows.map((r) => r.animalId)).not.toContain(njeri);
    // History is not rewritten: the 18 L she gave three days ago still count.
    expect((await dayProduction(session, D(-3), db)).totalL).toBe(30);
    expect(await litresProduced(session, PERIOD.from, PERIOD.to, db)).toBe(30);
    await close();
  });

  it("refuses a second exit for the same animal rather than counting her out twice", async () => {
    const { db, close, session } = await setup();
    const { njeri } = await seedTwoCowsMilking(db, session, [-3]);
    await recordSale(session, { animalId: njeri, exitDate: D(-1), reason: "SOLD", priceKes: 95_000 }, db);
    const again = await recordSale(session, { animalId: njeri, exitDate: T0, reason: "SOLD", priceKes: 95_000 }, db);

    expect(again.ok).toBe(false);
    expect(again.ok === false && again.error).toMatch(/already left the herd/);
    expect(await db.select().from(s.animalExit)).toHaveLength(1);
    await close();
  });
});

/* ================================================================== */
/* SEAM 4a — feed cost and milk litres make the margin                 */
/* ================================================================== */

/**
 * 10 bags of dairy meal at KES 3,300 (700 kg, KES 47.14 a kilo), 8 kg fed a day
 * to two cows giving 30 L a day between them, milk at KES 52.
 */
async function seedFeedAndMilk(db: TestDb, session: ReturnType<typeof fakeSession>) {
  await seedPrice(db);
  const feedItemId = await seedFeedItem(db, { name: "Dairy meal (Unga)" });
  const purchase = await recordPurchaseFor(
    session,
    { feedItemId, purchasedOn: D(-7), quantity: 10, unit: "BAG_70KG", unitPriceKes: 3_300 },
    db,
  );
  if (!purchase.ok) throw new Error(purchase.error);

  await seedTwoCowsMilking(db, session, [-1, 0]); // 60 L over two days

  for (const day of [-1, 0]) {
    await recordIssuesFor(
      session,
      { issuedOn: D(day), lines: [{ feedItemId, quantity: 8, unit: "KG", animalGroup: "LACTATING" }] },
      db,
    );
  }

  const coopId = await seedCustomer(db, { customerType: "COOP" });
  for (const day of [-1, 0]) {
    await recordDisposal(session, { date: D(day), channel: "COOP", customerId: coopId, litres: 25 }, db);
    await recordDisposal(session, { date: D(day), channel: "HOME_CONSUMPTION", litres: 5 }, db);
  }
  return { feedItemId, purchase };
}

describe("margin over feed cost joins the feed store to the milking parlour", () => {
  it("costs the feed that was actually fed and values every litre that was produced", async () => {
    const { db, close, session } = await setup();
    const { feedItemId } = await seedFeedAndMilk(db, session);

    expect((await costPerKgByItem(session, PERIOD.to, db)).get(feedItemId)).toBe(47.14);

    const m = await marginOverFeedCost(session, PERIOD.from, PERIOD.to, db);
    expect(m.litres).toBe(60);
    expect(m.soldLitres).toBe(50);
    expect(m.soldRevenueKes).toBe(2_600);
    expect(m.imputedLitres).toBe(10);
    expect(m.imputedValueKes).toBe(520);
    expect(m.feedCostKes).toBe(754.24); // 16 kg at KES 47.14
    expect(m.milkRevenueKes).toBe(3_120);
    expect(m.revenuePerLitre).toBe(52);
    expect(m.feedCostPerLitre).toBe(12.57);
    expect(m.marginPerLitre).toBe(39.43);
    expect(m.marginKes).toBe(2_365.76);
    expect(m.message).toMatch(/KES 39.43 a litre after feed/);
    await close();
  });

  it("counts the milk the farm drank as well as the milk it sold, or a self-sufficient farm looks poor", async () => {
    const { db, close, session } = await setup();
    await seedFeedAndMilk(db, session);
    const m = await marginOverFeedCost(session, PERIOD.from, PERIOD.to, db);
    // Revenue is 2,600 in cash; the margin is built on 3,120 including the house milk.
    expect(m.milkRevenueKes).toBe(m.soldRevenueKes + m.imputedValueKes);
    await close();
  });

  it("stops at the period boundary on both sides", async () => {
    const { db, close, session } = await setup();
    await seedFeedAndMilk(db, session);

    const empty = await marginOverFeedCost(session, D(-30), D(-20), db);
    expect(empty.litres).toBe(0);
    expect(empty.feedCostKes).toBe(0);
    expect(empty.message).toBe("No milk recorded for this period.");

    // A single day sees half the milk and half the feed.
    const oneDay = await marginOverFeedCost(session, T0, T0, db);
    expect(oneDay.litres).toBe(30);
    expect(oneDay.feedCostKes).toBe(377.12);
    await close();
  });

  it("names home-grown fodder it cannot cost instead of quietly flattering the margin", async () => {
    const { db, close, session } = await setup();
    await seedFeedAndMilk(db, session);
    const napierId = await seedFeedItem(db, {
      name: "Napier grass",
      category: "FODDER",
      defaultUnit: "HEADLOAD",
      defaultUnitWeightKg: "20",
      homeGrown: true,
    });
    await recordIssuesFor(
      session,
      { issuedOn: T0, lines: [{ feedItemId: napierId, quantity: 3, unit: "HEADLOAD", animalGroup: "LACTATING" }] },
      db,
    );

    const m = await marginOverFeedCost(session, PERIOD.from, PERIOD.to, db);
    expect(m.uncostedFeeds).toEqual(["Napier grass"]);
    expect(m.feedCostKes).toBe(754.24); // unchanged — 60 kg of Napier costed at nothing
    await close();
  });

  it("charges only the feed that left the store, not the whole delivery", async () => {
    const { db, close, session } = await setup();
    await seedFeedAndMilk(db, session);
    const m = await marginOverFeedCost(session, PERIOD.from, PERIOD.to, db);
    // KES 33,000 was bought; KES 754.24 was fed. Buying a lorry-load of meal in
    // one month must not wipe out that month's margin.
    expect(m.feedCostKes).toBe(754.24);
    expect(await db.select().from(s.feedPurchase)).toHaveLength(1);
    await close();
  });
});

/* ================================================================== */
/* SEAM 4b — approval and the margin                                   */
/* ================================================================== */

/**
 * THE ASYMMETRY, stated plainly because it is deliberate and surprising.
 *
 * `marginOverFeedCost` reads `feedPurchase.totalCostKes` through
 * `costPerKgByItem`; `costOfProduction` reads the APPROVED `expense`. So the
 * feed screen's margin moves the moment the purchase is entered, while the
 * money screen's cost per litre waits for a manager (R10). Two views of one
 * shilling — counted once in each place, never added together.
 *
 * It is documented in `src/server/feed.ts` as intentional: gating feed COSTING
 * on approval would empty the cull list, which is the screen that pays for the
 * system. The cost of the decision is that an unapproved — or mistyped — feed
 * invoice moves the headline margin per litre before anyone has checked it.
 */
describe("a feed purchase that no manager has approved yet", () => {
  it("already moves the margin over feed cost, because the cull list cannot wait", async () => {
    const { db, close, session } = await setup();
    const { purchase } = await seedFeedAndMilk(db, session);

    const [expense] = await db.select().from(s.expense);
    expect(expense.status).toBe("PENDING");
    expect(expense.category).toBe("FEEDS");
    expect(expense.amountKes).toBe("33000.00");

    const before = await marginOverFeedCost(session, PERIOD.from, PERIOD.to, db);
    expect(before.feedCostKes).toBe(754.24);

    await approveExpense(session, purchase.data.expenseId!, db);

    const after = await marginOverFeedCost(session, PERIOD.from, PERIOD.to, db);
    expect(after.feedCostKes).toBe(754.24);
    expect(after.marginKes).toBe(before.marginKes);
    await close();
  });

  it("moves the farm-wide cost of production only once it IS approved", async () => {
    const { db, close, session } = await setup();
    const { purchase } = await seedFeedAndMilk(db, session);

    const feedsBefore = await costOfProduction(session, PERIOD.from, PERIOD.to, db);
    expect(feedsBefore.byCategory.find((c) => c.category === "FEEDS")?.amountKes ?? 0).toBe(0);
    expect(feedsBefore.cash.totalKes).toBe(0);

    await approveExpense(session, purchase.data.expenseId!, db);

    const feedsAfter = await costOfProduction(session, PERIOD.from, PERIOD.to, db);
    expect(feedsAfter.byCategory.find((c) => c.category === "FEEDS")?.amountKes).toBe(33_000);
    expect(feedsAfter.litresProduced).toBe(60);
    await close();
  });

  it("never lets the same shilling appear in both totals at once", async () => {
    const { db, close, session } = await setup();
    const { purchase } = await seedFeedAndMilk(db, session);
    await approveExpense(session, purchase.data.expenseId!, db);

    // One expense row for one purchase, however many reports read it.
    expect(await db.select().from(s.expense)).toHaveLength(1);
    const cop = await costOfProduction(session, PERIOD.from, PERIOD.to, db);
    const margin = await marginOverFeedCost(session, PERIOD.from, PERIOD.to, db);
    expect(cop.cash.totalKes).toBe(33_000); // the invoice
    expect(margin.feedCostKes).toBe(754.24); // what was eaten
    await close();
  });
});

/* ================================================================== */
/* SEAM 5 — tenancy across the production seams                        */
/* ================================================================== */

describe("another farm's ids are refused exactly like ids that do not exist", () => {
  it("shows an intruding farm no production, no allocation and no margin", async () => {
    const { db, close, session } = await setup();
    await seedFeedAndMilk(db, session);
    const intruder = fakeSession({ role: "OWNER", farmId: OTHER_FARM });

    expect((await dayProduction(intruder, T0, db)).totalL).toBe(0);
    const a = await allocateMilk(intruder, T0, db);
    expect(a.production.totalL).toBe(0);
    expect(a.lines).toHaveLength(0);
    const m = await marginOverFeedCost(intruder, PERIOD.from, PERIOD.to, db);
    expect(m.litres).toBe(0);
    expect(m.feedCostKes).toBe(0);
    expect(await litresProduced(intruder, PERIOD.from, PERIOD.to, db)).toBe(0);
    await close();
  });

  it("refuses to correct another farm's milk record like one that does not exist", async () => {
    const { db, close, session } = await setup();
    const cow = await seedMilkingCow(db, { name: "Njeri", tag: "KE-0001" });
    const recordId = newId();
    await recordMilkBatch(
      session,
      { date: T0, session: "MORNING", rows: [{ id: recordId, animalId: cow, litres: 10 }] },
      db,
    );

    const intruder = fakeSession({ role: "MANAGER", farmId: OTHER_FARM });
    const foreignResult = await correctMilkRecord(intruder, { recordId, litres: 99 }, db);
    const missingResult = await correctMilkRecord(intruder, { recordId: newId(), litres: 99 }, db);
    expect(foreignResult).toEqual({ ok: false, error: "That milk record was not found." });
    expect(foreignResult).toEqual(missingResult);
    expect(await db.select().from(s.milkRecord)).toHaveLength(1);
    await close();
  });

  it("refuses to buy or issue against another farm's feed like a feed that does not exist", async () => {
    const { db, close, session } = await setup();
    const feedItemId = await seedFeedItem(db);
    const intruder = fakeSession({ role: "MANAGER", farmId: OTHER_FARM });

    await expect(
      recordPurchaseFor(
        intruder,
        { feedItemId, purchasedOn: T0, quantity: 1, unit: "BAG_70KG", unitPriceKes: 3_300 },
        db,
      ),
    ).rejects.toThrow("That feed was not found.");
    await expect(
      recordPurchaseFor(
        intruder,
        { feedItemId: newId(), purchasedOn: T0, quantity: 1, unit: "BAG_70KG", unitPriceKes: 3_300 },
        db,
      ),
    ).rejects.toThrow("That feed was not found.");
    await expect(
      recordIssuesFor(intruder, { issuedOn: T0, lines: [{ feedItemId, quantity: 8, unit: "KG" }] }, db),
    ).rejects.toThrow("That feed was not found.");

    expect(await db.select().from(s.feedPurchase)).toHaveLength(0);
    expect(await db.select().from(s.feedIssue)).toHaveLength(0);
    await close();
  });

  it("will not feed another farm's animal from our store", async () => {
    const { db, close, session } = await setup();
    const feedItemId = await seedFeedItem(db);
    await db.insert(s.farm).values({ id: OTHER_FARM, name: "Nakuru Rival Dairy" });
    const foreignAnimal = newId();
    await db.insert(s.animal).values({
      id: foreignAnimal,
      farmId: OTHER_FARM,
      tag: "RIVAL-01",
      sex: "F",
      origin: "BORN",
      enteredHerdOn: "2022-01-01",
    });

    await expect(
      recordIssuesFor(
        session,
        { issuedOn: T0, lines: [{ feedItemId, quantity: 8, unit: "KG", animalId: foreignAnimal }] },
        db,
      ),
    ).rejects.toThrow("That animal was not found.");
    expect(await db.select().from(s.feedIssue)).toHaveLength(0);
    await close();
  });

  it("keeps one farm's exit from touching another farm's milking sheet", async () => {
    const { db, close, session } = await setup();
    const { njeri, nyambura } = await seedTwoCowsMilking(db, session, [0]);
    const intruder = fakeSession({ role: "MANAGER", farmId: OTHER_FARM });

    const stolen = await recordSale(intruder, { animalId: njeri, exitDate: T0, reason: "SOLD", priceKes: 1 }, db);
    expect(stolen).toEqual({ ok: false, error: "That animal was not found." });

    const sheet = await milkSheet(session, T0, "MORNING", db);
    expect(sheet.rows.map((r) => r.animalId).sort()).toEqual([njeri, nyambura].sort());
    await close();
  });

  it("does not let another farm's disposal be sold out of our can", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db);
    await seedTwoCowsMilking(db, session, [0]);
    const ourCoop = await seedCustomer(db, { customerType: "COOP" });

    const intruder = fakeSession({ role: "MANAGER", farmId: OTHER_FARM });
    const theirs = await recordDisposal(
      intruder,
      { date: T0, channel: "COOP", customerId: ourCoop, litres: 30 },
      db,
    );
    expect(theirs).toEqual({ ok: false, error: "That customer was not found." });

    const a = await allocateMilk(session, T0, db);
    expect(a.unallocatedL).toBe(30);
    expect(await db.select().from(s.milkDisposal).where(eq(s.milkDisposal.farmId, FARM_ID))).toHaveLength(0);
    await close();
  });
});
