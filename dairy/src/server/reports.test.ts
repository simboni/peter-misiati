/**
 * M10 — Reports & Insights.
 *
 * These tests are written against the rule the module exists to enforce:
 * reports state CONCLUSIONS, not tables. So every headline assertion checks a
 * sentence and an action, not only a number — a report that computed the right
 * figure and said nothing about it would be a failure of this module even
 * though the arithmetic was correct.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as s from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/test-db";
import {
  seedFarm,
  seedAnimal,
  seedCustomer,
  seedFeedItem,
  seedEmployee,
  seedProduct,
  FARM_ID,
  fakeSession,
} from "@/test/factory";
import { newId } from "@/lib/ids";
import { dec } from "@/lib/money";
import { addDays, type ISODate } from "@/lib/domain/dates";

/* ------------------------------------------------------------------ */
/* Harness — the pattern every server test file here uses               */
/* ------------------------------------------------------------------ */

const H = vi.hoisted(() => ({ db: null as unknown, session: null as unknown }));

vi.mock("@/db", () => ({
  get db() {
    return H.db;
  },
}));
vi.mock("next/cache", () => ({ updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/session", () => ({
  readSessionCookie: async () => H.session,
  hashPin: async (pin: string) => `test$${pin}`,
  verifyPin: async () => true,
}));

const {
  moneyThisMonth,
  cowLeagueTable,
  whatNeedsDoingThisWeek,
  milkProduction,
  breedingPerformance,
  healthReport,
  feedReport,
  herdInventoryMovement,
  coopReconciliation,
  payrollReport,
  dailySheet,
  expiringDocuments,
  reportCsv,
  fullDataExport,
  toCsv,
  toCsvBundle,
  monthBounds,
  isReportName,
} = await import("./reports");

let db: TestDb;
let close: () => Promise<void>;

const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_FARM = "99999999-9999-4999-8999-999999999999";
const OTHER_USER = "88888888-8888-4888-8888-888888888888";

/** August 2026 — the month everything below happens in. */
const MONTH = "2026-08";
const M1: ISODate = "2026-08-01";
const M5: ISODate = "2026-08-05";
const M10: ISODate = "2026-08-10";
const M15: ISODate = "2026-08-15";
const M31: ISODate = "2026-08-31";

function session(over: Parameters<typeof fakeSession>[0] = {}) {
  return fakeSession({ userId: USER, role: "OWNER", ...over });
}

function otherFarmSession() {
  return fakeSession({ userId: OTHER_USER, farmId: OTHER_FARM, role: "OWNER" });
}

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  close = t.close;
  H.db = t.db;
  H.session = session();
  await seedFarm(db);
  await db.insert(s.appUser).values({
    id: USER,
    farmId: FARM_ID,
    fullName: "Grace Wanjiru",
    role: "OWNER",
    pinHash: "test$1234",
  });
  await db.insert(s.farm).values({
    id: OTHER_FARM,
    name: "Somebody Else's Dairy",
    county: "Nyandarua",
  });
});

afterEach(async () => {
  await close();
});

/* ------------------------------------------------------------------ */
/* Seed helpers — plausible Kenyan numbers, never foo/bar              */
/* ------------------------------------------------------------------ */

async function milking(animalId: string, on: ISODate, morning: number, evening: number) {
  for (const [sess, litres] of [["MORNING", morning], ["EVENING", evening]] as const) {
    await db.insert(s.milkRecord).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      recordedOn: on,
      session: sess,
      litres: dec(litres),
      saleable: true,
      recordedBy: USER,
      recordedAt: new Date(`${on}T06:00:00Z`),
    });
  }
}

async function disposal(
  on: ISODate,
  channel: s.DisposalChannel,
  litres: number,
  rate: number,
  customerId?: string,
) {
  await db.insert(s.milkDisposal).values({
    id: newId(),
    farmId: FARM_ID,
    disposedOn: on,
    channel,
    customerId: customerId ?? null,
    litres: dec(litres),
    rateKesPerLitre: dec(rate),
    valueKes: dec(litres * rate),
    recordedBy: USER,
  });
}

async function expense(on: ISODate, category: s.ExpenseCategory, amount: number) {
  await db.insert(s.expense).values({
    id: newId(),
    farmId: FARM_ID,
    incurredOn: on,
    category,
    amountKes: dec(amount),
    status: "APPROVED",
    recordedBy: USER,
    approvedBy: USER,
  });
}

async function feedPurchase(feedItemId: string, on: ISODate, bags: number, pricePerBag: number) {
  await db.insert(s.feedPurchase).values({
    id: newId(),
    farmId: FARM_ID,
    feedItemId,
    purchasedOn: on,
    quantity: dec(bags, 3),
    unit: "BAG_70KG",
    unitWeightKg: dec(70, 3),
    unitPriceKes: dec(pricePerBag),
    totalCostKes: dec(bags * pricePerBag),
    recordedBy: USER,
  });
}

async function feedIssue(
  feedItemId: string,
  on: ISODate,
  kg: number,
  opts: { animalId?: string; group?: s.AnimalGroup } = {},
) {
  await db.insert(s.feedIssue).values({
    id: newId(),
    farmId: FARM_ID,
    feedItemId,
    issuedOn: on,
    animalId: opts.animalId ?? null,
    animalGroup: opts.group ?? (opts.animalId ? null : "LACTATING"),
    quantity: dec(kg, 3),
    unit: "KG",
    unitWeightKg: dec(1, 3),
    recordedBy: USER,
  });
}

/**
 * A small but complete August: two milking cows, milk sold to the co-op and to
 * neighbours, feed bought and issued, and a month of expenses.
 */
async function seedAugust() {
  const njeri = await seedAnimal(db, { tag: "KE-0001", name: "Njeri", dateOfBirth: "2021-03-14" });
  const wanjiku = await seedAnimal(db, { tag: "KE-0002", name: "Wanjiku", dateOfBirth: "2020-06-02" });

  // Both have calved, so they derive as milking cows.
  await db.insert(s.calving).values([
    { id: newId(), farmId: FARM_ID, damId: njeri, calvedOn: "2026-04-10", recordedBy: USER },
    { id: newId(), farmId: FARM_ID, damId: wanjiku, calvedOn: "2026-03-01", recordedBy: USER },
  ]);

  // 15 days of milk: Njeri a good cow, Wanjiku a poor one.
  for (let i = 0; i < 15; i++) {
    const day = addDays(M1, i) as ISODate;
    await milking(njeri, day, 11, 9);
    await milking(wanjiku, day, 3, 2);
  }
  // 15 days × (20 + 5) = 375 L produced.

  const coop = await seedCustomer(db, { name: "Limuru Dairy Co-operative", customerType: "COOP" });
  const shop = await seedCustomer(db, { name: "Mama Njeri's shop", customerType: "SHOP" });

  for (let i = 0; i < 15; i++) {
    const day = addDays(M1, i) as ISODate;
    await disposal(day, "COOP", 18, 48, coop);
    await disposal(day, "SHOP", 5, 70, shop);
    await disposal(day, "HOME_CONSUMPTION", 2, 60);
  }
  // Sold: 15×18 = 270 L @48 = 12,960 ; 15×5 = 75 L @70 = 5,250 → 18,210 KES.
  // Imputed home use: 30 L @60 = 1,800 KES.

  const dairyMeal = await seedFeedItem(db, { name: "Dairy meal (Unga)" });
  await feedPurchase(dairyMeal, "2026-07-28", 10, 3500); // 700 kg at 50 KES/kg
  for (let i = 0; i < 15; i++) {
    await feedIssue(dairyMeal, addDays(M1, i) as ISODate, 20, { animalId: njeri });
    await feedIssue(dairyMeal, addDays(M1, i) as ISODate, 6, { animalId: wanjiku });
  }
  // 390 kg issued × 50 = 19,500 KES of feed.

  await expense(M5, "FEEDS", 35000);
  await expense(M10, "LABOUR", 12000);
  await expense(M15, "VETERINARY", 2500);

  return { njeri, wanjiku, coop, shop, dairyMeal };
}

/* ================================================================== */
/* HEADLINE 1 — Money this month                                       */
/* ================================================================== */

describe("moneyThisMonth", () => {
  it("states the month in one sentence before it states any number", async () => {
    await seedAugust();
    const r = await moneyThisMonth(session(), MONTH, db);

    expect(r.month).toBe("2026-08");
    expect(r.from).toBe("2026-08-01");
    expect(r.to).toBe("2026-08-31");

    // The sentence is the point of the module.
    expect(r.sentence).toMatch(/^You produced 375 L/);
    expect(r.sentence).toContain("a litre to make it");
    expect(r.actions.length).toBeGreaterThan(0);
  });

  it("splits milk revenue by channel, losses and home use included", async () => {
    await seedAugust();
    const r = await moneyThisMonth(session(), MONTH, db);

    const coop = r.revenueByChannel.find((c) => c.channel === "COOP")!;
    const shop = r.revenueByChannel.find((c) => c.channel === "SHOP")!;
    const home = r.revenueByChannel.find((c) => c.channel === "HOME_CONSUMPTION")!;

    expect(coop.litres).toBe(270);
    expect(coop.valueKes).toBe(12960);
    expect(coop.kind).toBe("REVENUE");
    expect(shop.valueKes).toBe(5250);
    expect(home.kind).toBe("IMPUTED");

    expect(r.milkSoldKes).toBe(18210);
    expect(r.milkImputedKes).toBe(1800);
  });

  it("reports cost per litre BOTH ways, each labelled", async () => {
    await seedAugust();
    const r = await moneyThisMonth(session(), MONTH, db);

    // 49,500 KES of approved expenses over 375 L produced.
    expect(r.cashCostKes).toBe(49500);
    expect(r.litresProduced).toBe(375);
    expect(r.cashCostPerLitreKes).toBe(132);
    expect(r.cashCostLabel).toMatch(/cash/i);
    expect(r.fullCostLabel).toMatch(/full economic/i);
    // Neither variant is ever shown without saying which it is.
    expect(r.cashCostLabel).not.toBe(r.fullCostLabel);
  });

  it("says plainly when the farm is outside the Kenya Dairy Board range", async () => {
    await seedAugust();
    const r = await moneyThisMonth(session(), MONTH, db);

    expect(r.benchmark.lowKes).toBe(30);
    expect(r.benchmark.highKes).toBe(37);
    expect(r.benchmark.farmGateKes).toBe(52);
    expect(r.benchmarkVerdict).toContain("ABOVE the Kenya Dairy Board range");
    expect(r.benchmarkVerdict).toContain("KES 30–37");
  });

  it("says so, in the other direction, when cost per litre is inside the range", async () => {
    await seedAugust();
    // Same milk, a realistic cost base: 375 L at about KES 34 a litre.
    await db.delete(s.expense).where(undefined as never).catch(() => {});
    await db.delete(s.expense);
    await expense(M5, "FEEDS", 8000);
    await expense(M10, "LABOUR", 4750);

    const r = await moneyThisMonth(session(), MONTH, db);
    expect(r.cashCostPerLitreKes).toBe(34);
    expect(r.benchmarkVerdict).toContain("INSIDE the Kenya Dairy Board range");
  });

  it("gives margin over feed cost, the number that actually moves a dairy", async () => {
    await seedAugust();
    const r = await moneyThisMonth(session(), MONTH, db);

    // 20,010 KES of milk value over 375 L = 53.36/L; feed 19,500 over 375 = 52.00/L.
    expect(r.marginOverFeed.revenuePerLitreKes).toBe(53.36);
    expect(r.marginOverFeed.feedCostPerLitreKes).toBe(52);
    expect(r.marginOverFeed.marginPerLitreKes).toBe(1.36);
    expect(r.marginOverFeed.message).toContain("a litre after feed");
  });

  it("names the approvals that are NOT in the numbers", async () => {
    await seedAugust();
    await db.insert(s.expense).values({
      id: newId(),
      farmId: FARM_ID,
      incurredOn: M15,
      category: "TRANSPORT",
      amountKes: dec(3000),
      status: "PENDING",
      recordedBy: USER,
    });

    const r = await moneyThisMonth(session(), MONTH, db);
    expect(r.pendingCount).toBe(1);
    expect(r.pendingKes).toBe(3000);
    expect(r.cashCostKes).toBe(49500); // pending never moves a total
    expect(r.actions.join(" ")).toContain("Approve the 1 waiting");
  });

  it("says there is nothing to report rather than dividing by zero", async () => {
    const r = await moneyThisMonth(session(), MONTH, db);
    expect(r.litresProduced).toBe(0);
    expect(r.cashCostPerLitreKes).toBe(0);
    expect(r.sentence).toContain("No milk was recorded");
    expect(r.actions[0]).toContain("Record this month's milkings");
  });

  it("refuses a herdsman — money is not his to see", async () => {
    await seedAugust();
    await expect(moneyThisMonth(session({ role: "HERDSMAN" }), MONTH, db)).rejects.toThrow(
      /permission/i,
    );
  });

  it("shows another farm nothing of ours", async () => {
    await seedAugust();
    const r = await moneyThisMonth(otherFarmSession(), MONTH, db);
    expect(r.litresProduced).toBe(0);
    expect(r.totalRevenueKes).toBe(0);
    expect(r.cashCostKes).toBe(0);
    expect(r.revenueByChannel).toHaveLength(0);
  });
});

/* ================================================================== */
/* HEADLINE 2 — The cow league table                                   */
/* ================================================================== */

describe("cowLeagueTable", () => {
  it("ranks every cow by margin and names the loss-maker", async () => {
    const { njeri, wanjiku } = await seedAugust();
    const r = await cowLeagueTable(session(), M1, M15, db);

    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].animalId).toBe(njeri);
    expect(r.rows[0].rank).toBe(1);
    expect(r.rows[1].animalId).toBe(wanjiku);

    // Njeri: 300 L; Wanjiku: 75 L; both charged their own feed issues.
    expect(r.rows[0].litres).toBe(300);
    expect(r.rows[1].litres).toBe(75);
    expect(r.rows[0].feedCostKes).toBe(15000); // 300 kg × 50
    expect(r.rows[1].feedCostKes).toBe(4500); // 90 kg × 50

    // Wanjiku loses money and is NAMED, with an action.
    expect(r.rows[1].losing).toBe(true);
    expect(r.lossMakers.map((l) => l.animalId)).toEqual([wanjiku]);
    expect(r.rows[1].who).toBe("Wanjiku (KE-0002)");
    expect(r.rows[1].recommendation).toContain("Wanjiku");
    expect(r.rows[1].recommendation.length).toBeGreaterThan(20);
  });

  it("puts the loss-makers in the sentence with the 10–15% benchmark", async () => {
    await seedAugust();
    const r = await cowLeagueTable(session(), M1, M15, db);

    expect(r.sentence).toContain("1 of your 2 animals are losing money");
    expect(r.sentence).toContain("10–15%");
    expect(r.expectedLossMakerSharePct).toEqual({ low: 10, high: 15 });
    expect(r.lossMakerSharePct).toBe(50);
  });

  it("gives every cow a recommended action, not only the bad ones", async () => {
    await seedAugust();
    const r = await cowLeagueTable(session(), M1, M15, db);
    for (const row of r.rows) {
      expect(row.recommendation).toBeTruthy();
      expect(row.action).toMatch(/KEEP|WATCH|CULL|SELL_AS_BREEDER|INVESTIGATE/);
    }
  });

  it("prices the margins at what the milk actually fetched", async () => {
    await seedAugust();
    const r = await cowLeagueTable(session(), M1, M15, db);
    // 345 revenue litres for 18,210 KES.
    expect(r.pricePerLitreKes).toBeCloseTo(52.78, 1);
    expect(r.actions.join(" ")).toContain("what your milk actually fetched");
  });

  it("refuses a herdsman and shows another farm nothing", async () => {
    await seedAugust();
    await expect(cowLeagueTable(session({ role: "HERDSMAN" }), M1, M15, db)).rejects.toThrow(
      /permission/i,
    );
    const other = await cowLeagueTable(otherFarmSession(), M1, M15, db);
    expect(other.rows).toHaveLength(0);
    expect(other.sentence).toContain("no animals");
  });
});

/* ================================================================== */
/* HEADLINE 3 — What needs doing this week                             */
/* ================================================================== */

describe("whatNeedsDoingThisWeek", () => {
  it("gives one line each: who, which animal, what action, by when", async () => {
    const { njeri } = await seedAugust();

    // A service 62 days ago: her pregnancy check is overdue.
    await db.insert(s.service).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: njeri,
      servedOn: addDays(M15, -62) as ISODate,
      serviceType: "AI",
      serviceNumber: 1,
      expectedReturnOn: addDays(M15, -41) as ISODate,
      pdDueOn: addDays(M15, -2) as ISODate,
      expectedCalvingOn: addDays(M15, 221) as ISODate,
      recordedBy: USER,
    });

    const r = await whatNeedsDoingThisWeek(session(), M15, db);
    const pd = r.tasks.find((t) => t.kind === "PD_DUE")!;

    expect(pd).toBeDefined();
    expect(pd.who).toBe("MANAGER");
    expect(pd.whoLabel).toBe("The manager");
    expect(pd.subject).toBe("Njeri");
    expect(pd.animalId).toBe(njeri);
    expect(pd.action).toContain("checked for pregnancy");
    expect(pd.dueOn).toBe(addDays(M15, -2));
    expect(pd.dueLabel).toBe("2 days late");
  });

  it("pulls feed that runs out inside the week into the same list", async () => {
    const { dairyMeal } = await seedAugust();
    // 700 kg bought, 390 kg issued → 310 kg left, burning 26 kg/day = 11 days.
    // Issue hard for a week so the burn rate lifts and cover falls under seven.
    for (let i = 0; i < 7; i++) {
      await feedIssue(dairyMeal, addDays(M15, -i) as ISODate, 45, { group: "LACTATING" });
    }

    const r = await whatNeedsDoingThisWeek(session(), M15, db);
    const feed = r.tasks.find((t) => t.kind === "LOW_FEED_STOCK");
    expect(feed).toBeDefined();
    expect(feed!.source).toBe("FEED");
    expect(feed!.action).toContain("Buy Dairy meal");
    expect(feed!.who).toBe("MANAGER");
  });

  it("puts the withdrawal on the list as a job for the herdsman", async () => {
    const { njeri } = await seedAugust();
    const product = await seedProduct(db, { milkWithdrawalDays: 7 });
    await db.insert(s.healthEvent).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: njeri,
      eventType: "TREATMENT",
      occurredOn: M15,
      productId: product,
      treatmentEndOn: M15,
      milkClearAt: new Date(`${addDays(M15, 7)}T00:00:00Z`),
      recordedBy: USER,
    });

    const r = await whatNeedsDoingThisWeek(session(), M15, db);
    const w = r.tasks.find((t) => t.kind === "WITHDRAWAL_CLEAR")!;
    expect(w).toBeDefined();
    expect(w.severity).toBe("CRITICAL");
    expect(w.who).toBe("HERDSMAN");
    expect(w.action).toContain("Njeri");
    expect(w.action).toContain("out of the can");
    // The urgent job sorts to the front, which is what makes the list readable.
    expect(r.tasks[0].severity).toBe("CRITICAL");
  });

  it("warns before a food handler certificate expires, not after", async () => {
    const employeeId = await seedEmployee(db, { fullName: "Kamau Mwangi" });
    await db.insert(s.complianceDocument).values({
      id: newId(),
      farmId: FARM_ID,
      docType: "FOOD_HANDLER_CERT",
      referenceNo: "FH-99120",
      holderEmployeeId: employeeId,
      issuedOn: "2026-02-20",
      expiresOn: addDays(M15, 12) as ISODate,
    });

    const r = await whatNeedsDoingThisWeek(session(), M15, db);
    const doc = r.tasks.find((t) => t.kind === "COMPLIANCE_EXPIRY")!;
    expect(doc).toBeDefined();
    expect(doc.subject).toContain("Food handler certificate");
    expect(doc.subject).toContain("Kamau Mwangi");
    expect(doc.action).toMatch(/^Renew /);
    expect(doc.detail).toContain("six months");
  });

  it("answers the acceptance question — one sentence, then the list", async () => {
    const { njeri } = await seedAugust();
    await db.insert(s.service).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: njeri,
      servedOn: addDays(M15, -62) as ISODate,
      serviceType: "AI",
      serviceNumber: 1,
      pdDueOn: addDays(M15, -2) as ISODate,
      expectedCalvingOn: addDays(M15, 221) as ISODate,
      recordedBy: USER,
    });

    const r = await whatNeedsDoingThisWeek(session(), M15, db);
    expect(r.sentence).toMatch(/things? to do this week/);
    expect(r.sentence).toContain("Start with");
    expect(r.actions[0]).toMatch(/^(You|The manager|The herdsman|The rider|The vet|The bookkeeper):/);
    expect(r.actions[0]).toMatch(/\((today|tomorrow|by |\d+ days? late|[A-Z][a-z]{2} )/);
  });

  it("keeps money jobs off a herdsman's list", async () => {
    await seedAugust();
    await db.insert(s.complianceDocument).values({
      id: newId(),
      farmId: FARM_ID,
      docType: "KDB_PERMIT",
      expiresOn: addDays(M15, 5) as ISODate,
    });

    const owner = await whatNeedsDoingThisWeek(session(), M15, db);
    const herdsman = await whatNeedsDoingThisWeek(session({ role: "HERDSMAN" }), M15, db);

    expect(owner.tasks.some((t) => t.kind === "COMPLIANCE_EXPIRY")).toBe(true);
    expect(herdsman.tasks.some((t) => t.kind === "COMPLIANCE_EXPIRY")).toBe(false);
    expect(herdsman.bySource.MONEY).toBe(0);
    expect(herdsman.bySource.PEOPLE).toBe(0);
  });

  it("says so plainly when there is nothing to do", async () => {
    const r = await whatNeedsDoingThisWeek(session(), M15, db);
    expect(r.tasks).toHaveLength(0);
    expect(r.sentence).toContain("Nothing is waiting this week");
  });

  it("shows another farm none of our jobs", async () => {
    const { njeri } = await seedAugust();
    await db.insert(s.service).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: njeri,
      servedOn: addDays(M15, -62) as ISODate,
      serviceType: "AI",
      serviceNumber: 1,
      pdDueOn: addDays(M15, -2) as ISODate,
      recordedBy: USER,
    });
    const r = await whatNeedsDoingThisWeek(otherFarmSession(), M15, db);
    expect(r.tasks).toHaveLength(0);
  });
});

/* ================================================================== */
/* The standard set                                                    */
/* ================================================================== */

describe("milkProduction", () => {
  it("reports daily, monthly and per cow off the same records", async () => {
    const { njeri, wanjiku } = await seedAugust();
    const r = await milkProduction(session(), M1, M31, {}, db);

    expect(r.totalL).toBe(375);
    expect(r.perDay).toHaveLength(15);
    expect(r.perDay[0].totalL).toBe(25);
    expect(r.perDay[0].bySession).toEqual([
      { session: "MORNING", litres: 14 },
      { session: "EVENING", litres: 11 },
    ]);
    expect(r.perMonth).toEqual([{ month: "2026-08", litres: 375, dailyAverageL: 12.1 }]);

    expect(r.perCow[0].animalId).toBe(njeri);
    expect(r.perCow[0].litres).toBe(300);
    expect(r.perCow[0].sharePct).toBe(80);
    expect(r.perCow[1].animalId).toBe(wanjiku);
  });

  it("states the conclusion and names the cows worth acting on", async () => {
    await seedAugust();
    const r = await milkProduction(session(), M1, M31, {}, db);
    expect(r.sentence).toContain("375 L over 31 days");
    expect(r.sentence).toContain("Njeri giving the most");
    expect(r.actions.join(" ")).toContain("Wanjiku");
    expect(r.actions.join(" ")).toContain("under 6 L a day");
  });

  it("returns a lactation curve when a cow is named, and refuses another farm's", async () => {
    const { njeri } = await seedAugust();
    const r = await milkProduction(session(), M1, M31, { animalIds: [njeri] }, db);
    expect(r.lactationCurves).toHaveLength(1);
    expect(r.lactationCurves[0].animalId).toBe(njeri);
    expect(r.lactationCurves[0].cumulativeL).toBe(300);

    await expect(
      milkProduction(otherFarmSession(), M1, M31, { animalIds: [njeri] }, db),
    ).rejects.toThrow(/not found/i);
  });
});

describe("breedingPerformance", () => {
  it("compares each KPI against REPRO_BENCHMARKS and says whether it is on target", async () => {
    const cow = await seedAnimal(db, { tag: "KE-0100", name: "Muthoni", dateOfBirth: "2022-01-10" });

    // Two calvings 430 days apart — the Kenyan observed average, above target.
    await db.insert(s.calving).values([
      { id: newId(), farmId: FARM_ID, damId: cow, calvedOn: "2025-06-01", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, damId: cow, calvedOn: "2026-08-05", recordedBy: USER },
    ]);

    const r = await breedingPerformance(session(), M1, M31);
    const ci = r.kpis.find((k) => k.key === "calvingInterval")!;

    expect(ci.value).toBe(430);
    expect(ci.targetValue).toBe(380);
    expect(ci.acceptableValue).toBe(400);
    expect(ci.onTarget).toBe(false);
    expect(ci.verdict).toContain("above the 400 you should accept");
    expect(r.sentence).toContain("off target");
    // And it is costed, because shillings are what move a farmer.
    expect(r.calvingIntervalCostKes).toBeGreaterThan(0);
    expect(r.actions.join(" ")).toContain("costing about");
  });

  it("works out conception rate and services per conception over the period", async () => {
    const cow = await seedAnimal(db, { tag: "KE-0101", name: "Wairimu", dateOfBirth: "2022-01-10" });
    await db.insert(s.calving).values({
      id: newId(), farmId: FARM_ID, damId: cow, calvedOn: "2026-05-01", recordedBy: USER,
    });
    await db.insert(s.service).values([
      { id: newId(), farmId: FARM_ID, animalId: cow, servedOn: M1, serviceType: "AI", serviceNumber: 1, recordedBy: USER },
      { id: newId(), farmId: FARM_ID, animalId: cow, servedOn: addDays(M1, 21) as ISODate, serviceType: "AI", serviceNumber: 2, recordedBy: USER },
    ]);
    await db.insert(s.pregnancyCheck).values({
      id: newId(), farmId: FARM_ID, animalId: cow, checkedOn: M31, method: "PALPATION",
      result: "POSITIVE", recordedBy: USER,
    });

    const r = await breedingPerformance(session(), M1, M31);
    expect(r.servicesInPeriod).toBe(2);
    expect(r.conceptionsInPeriod).toBe(1);
    expect(r.kpis.find((k) => k.key === "servicesPerConception")!.value).toBe(2);
    expect(r.kpis.find((k) => k.key === "conceptionRate")!.value).toBe(50);
  });

  it("says there is not enough data rather than inventing a KPI", async () => {
    const r = await breedingPerformance(session(), M1, M31);
    expect(r.kpis.every((k) => k.value === null)).toBe(true);
    expect(r.sentence).toContain("not enough breeding records");
  });

  it("shows another farm nothing", async () => {
    await seedAugust();
    const r = await breedingPerformance(otherFarmSession(), M1, M31);
    expect(r.servicesInPeriod).toBe(0);
    expect(r.calvingIntervals).toHaveLength(0);
  });
});

describe("healthReport", () => {
  it("reports treatments, cost, discarded litres and disease incidence", async () => {
    const { njeri } = await seedAugust();
    const product = await seedProduct(db, { name: "Oxytet LA", milkWithdrawalDays: 7 });

    await db.insert(s.healthEvent).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: njeri,
      eventType: "TREATMENT",
      occurredOn: M10,
      diagnosis: "Mastitis",
      productId: product,
      treatmentEndOn: M10,
      costKes: dec(1800),
      milkClearAt: new Date(`${addDays(M10, 7)}T00:00:00Z`),
      recordedBy: USER,
    });
    await disposal(M10, "WITHHELD_TREATMENT", 20, 50);

    // Read the period while she is still under withdrawal (clear 17 Aug).
    const r = await healthReport(session(), M1, M15, db);

    expect(r.treatments).toHaveLength(1);
    expect(r.treatments[0].who).toBe("Njeri (KE-0001)");
    expect(r.treatmentCostKes).toBe(1800);
    expect(r.litresDiscarded).toBe(20);
    expect(r.diseaseIncidence[0]).toMatchObject({ diagnosis: "Mastitis", cases: 1, animals: 1 });
    expect(r.sentence).toContain("thrown away");
    // The withdrawal is the first thing said, because it is the only hard rule.
    expect(r.actions[0]).toContain("Do not sell Njeri's milk");
  });

  it("shows another farm no treatments", async () => {
    const { njeri } = await seedAugust();
    const product = await seedProduct(db);
    await db.insert(s.healthEvent).values({
      id: newId(), farmId: FARM_ID, animalId: njeri, eventType: "TREATMENT",
      occurredOn: M10, productId: product, costKes: dec(1800), recordedBy: USER,
    });
    const r = await healthReport(otherFarmSession(), M1, M31, db);
    expect(r.treatments).toHaveLength(0);
    expect(r.treatmentCostKes).toBe(0);
  });
});

describe("feedReport", () => {
  it("gives cost per litre by feed and names what is running out", async () => {
    const { dairyMeal } = await seedAugust();
    for (let i = 0; i < 7; i++) {
      await feedIssue(dairyMeal, addDays(M15, -i) as ISODate, 45, { group: "LACTATING" });
    }

    const r = await feedReport(session(), M1, M15, db);
    expect(r.consumption[0].name).toBe("Dairy meal (Unga)");
    expect(r.consumption[0].costPerLitreKes).toBeGreaterThan(0);
    expect(r.feedCostPerLitreKes).toBeGreaterThan(0);
    expect(r.runningOut.map((x) => x.name)).toContain("Dairy meal (Unga)");
    expect(r.actions.join(" ")).toContain("Buy Dairy meal");
    expect(r.sentence).toContain("of every litre you produced");
  });

  it("refuses to flatter the farm about feed it cannot cost", async () => {
    await seedAugust();
    const napier = await seedFeedItem(db, {
      name: "Napier grass", category: "FODDER", homeGrown: true,
      defaultUnit: "HEADLOAD", defaultUnitWeightKg: "20",
    });
    await feedIssue(napier, M10, 200, { group: "LACTATING" });

    const r = await feedReport(session(), M1, M15, db);
    expect(r.margin.uncostedFeeds).toContain("Napier grass");
    expect(r.actions.join(" ")).toContain("this margin flatters you");
  });
});

describe("herdInventoryMovement", () => {
  it("balances opening + births + purchases − deaths − sales = closing", async () => {
    await seedAnimal(db, { tag: "KE-0201", enteredHerdOn: "2025-01-01", origin: "BORN" });
    await seedAnimal(db, { tag: "KE-0202", enteredHerdOn: "2025-01-01", origin: "PURCHASED" });
    await seedAnimal(db, { tag: "KE-0203", enteredHerdOn: M5, origin: "BORN" });
    const sold = await seedAnimal(db, { tag: "KE-0204", enteredHerdOn: "2025-01-01", origin: "BORN" });
    await db.insert(s.animalExit).values({
      id: newId(), farmId: FARM_ID, animalId: sold, exitDate: M10, reason: "SOLD",
      valueKes: dec(85000), recordedBy: USER,
    });

    const r = await herdInventoryMovement(session(), M1, M31);
    expect(r.opening).toBe(3);
    expect(r.births).toBe(1);
    expect(r.sales).toBe(1);
    expect(r.closing).toBe(3);
    expect(r.computedClosing).toBe(3);
    expect(r.balances).toBe(true);
    expect(r.sentence).toContain("It balances.");
    expect(r.actions[0]).toContain("balances");
  });
});

describe("coopReconciliation", () => {
  it("names the variance between what the co-op says and what we recorded", async () => {
    const { coop } = await seedAugust();
    const statementId = newId();
    await db.insert(s.milkStatement).values({
      id: statementId,
      farmId: FARM_ID,
      customerId: coop,
      periodStart: M1,
      periodEnd: M31,
      coopLitres: dec(250), // we recorded 270
      rateKesPerLitre: dec(48),
      grossPayKes: dec(12000),
      netPayKes: dec(11000),
      recordedBy: USER,
    });
    await db.insert(s.milkStatementDeduction).values({
      id: newId(),
      farmId: FARM_ID,
      statementId,
      deductionType: "AI",
      description: "AI service, 12 Aug",
      amountKes: dec(1000),
    });

    const r = await coopReconciliation(session(), { from: M1, to: M31 }, db);
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].ourLitres).toBe(270);
    expect(r.statements[0].theirLitres).toBe(250);
    expect(r.statements[0].litresVariance).toBe(20);
    expect(r.statements[0].unmatchedDeductionsKes).toBe(1000);
    expect(r.sentence).toContain("do not match your own records");
    expect(r.actions[0]).toContain("Limuru Dairy Co-operative");
  });

  it("refuses a herdsman and shows another farm no statements", async () => {
    await seedAugust();
    await expect(coopReconciliation(session({ role: "HERDSMAN" }), {}, db)).rejects.toThrow(
      /permission/i,
    );
    const other = await coopReconciliation(otherFarmSession(), {}, db);
    expect(other.statements).toHaveLength(0);
  });
});

describe("payrollReport", () => {
  it("says what was paid, what is owed to the state, and by when", async () => {
    const employeeId = await seedEmployee(db, { fullName: "Kamau Mwangi", basicWageKes: "18000.00" });
    const runId = newId();
    await db.insert(s.payrollRun).values({
      id: runId, farmId: FARM_ID, periodMonth: M1, status: "DRAFT",
      totalGrossKes: dec(20700), totalNetKes: dec(18500),
    });
    await db.insert(s.payslip).values({
      id: newId(), farmId: FARM_ID, payrollRunId: runId, employeeId,
      daysWorked: dec(26), basicKes: dec(18000), housingAllowKes: dec(2700),
      grossKes: dec(20700), nssfTier1Kes: dec(480), shifKes: dec(569.25),
      housingLevyKes: dec(310.5), payeKes: dec(840), netKes: dec(18500),
      employerNssfKes: dec(480), employerShifKes: dec(0), employerHousingLevyKes: dec(310.5),
    });

    const r = await payrollReport(session(), MONTH, db);
    expect(r.month).toBe("2026-08");
    expect(r.run?.payslips).toHaveLength(1);
    expect(r.totalGrossKes).toBe(20700);
    expect(r.remittances.totalKes).toBeGreaterThan(0);
    expect(r.sentence).toContain("statutory deductions by");
    expect(r.actions.join(" ")).toContain("Approve the payroll run");
  });

  it("refuses a herdsman", async () => {
    await expect(payrollReport(session({ role: "HERDSMAN" }), MONTH, db)).rejects.toThrow(
      /permission/i,
    );
  });
});

/* ================================================================== */
/* Compliance expiry                                                   */
/* ================================================================== */

describe("expiringDocuments", () => {
  it("catches a six-month food handler certificate before it lapses", async () => {
    const employeeId = await seedEmployee(db, { fullName: "Kamau Mwangi" });
    await db.insert(s.complianceDocument).values([
      {
        id: newId(), farmId: FARM_ID, docType: "FOOD_HANDLER_CERT",
        holderEmployeeId: employeeId, issuedOn: "2026-02-20",
        expiresOn: addDays(M15, 10) as ISODate,
      },
      {
        id: newId(), farmId: FARM_ID, docType: "KDB_PERMIT",
        expiresOn: addDays(M15, 200) as ISODate,
      },
    ]);

    const r = await expiringDocuments(session(), M15, 30, db);
    expect(r).toHaveLength(1);
    expect(r[0].docType).toBe("FOOD_HANDLER_CERT");
    expect(r[0].daysLeft).toBe(10);
    expect(r[0].detail).toContain("six months");
    expect(r[0].action).toContain("Renew");
  });

  it("says an expired document is expired, not merely due", async () => {
    await db.insert(s.complianceDocument).values({
      id: newId(), farmId: FARM_ID, docType: "MILK_TRANSPORT_PERMIT",
      expiresOn: addDays(M15, -5) as ISODate,
    });
    const r = await expiringDocuments(session(), M15, 30, db);
    expect(r[0].daysLeft).toBe(-5);
    expect(r[0].action).toContain("it expired");
  });

  it("shows another farm no documents", async () => {
    await db.insert(s.complianceDocument).values({
      id: newId(), farmId: FARM_ID, docType: "KDB_PERMIT", expiresOn: addDays(M15, 5) as ISODate,
    });
    expect(await expiringDocuments(otherFarmSession(), M15, 30, db)).toHaveLength(0);
  });
});

/* ================================================================== */
/* The printable daily sheet                                           */
/* ================================================================== */

describe("dailySheet", () => {
  it("lays the cows down the left and the milkings across, like the notebook", async () => {
    const { njeri, wanjiku } = await seedAugust();
    const r = await dailySheet(session(), M5, db);

    expect(r.dayLabel).toBe("Wed 5 Aug");
    expect(r.farmName).toBe("Kiambu Test Dairy");
    expect(r.sessions.map((x) => x.label)).toEqual(["AM", "PM"]);

    const njeriRow = r.cows.find((c) => c.animalId === njeri)!;
    expect(njeriRow.name).toBe("Njeri");
    expect(njeriRow.bySession).toEqual([
      { session: "MORNING", label: "AM", litres: 11 },
      { session: "EVENING", label: "PM", litres: 9 },
    ]);
    expect(njeriRow.totalL).toBe(20);
    expect(r.cows.find((c) => c.animalId === wanjiku)!.totalL).toBe(5);

    expect(r.totalsBySession).toEqual([
      { session: "MORNING", label: "AM", litres: 14 },
      { session: "EVENING", label: "PM", litres: 11 },
    ]);
    expect(r.totalL).toBe(25);
    expect(r.note).toContain("No cow is under withdrawal");
  });

  it("names on the paper sheet the cows whose milk must not be sold", async () => {
    const { njeri } = await seedAugust();
    await db
      .update(s.milkRecord)
      .set({ saleable: false, notSaleableReason: "WITHDRAWAL" })
      .where(undefined as never)
      .catch(() => {});
    await db.execute(
      `update milk_record set saleable = false, not_saleable_reason = 'WITHDRAWAL' where animal_id = '${njeri}' and recorded_on = '${M5}'`,
    );

    const r = await dailySheet(session(), M5, db);
    expect(r.note).toContain("DO NOT SELL");
    expect(r.note).toContain("Njeri");
  });

  /**
   * The sheet is printed to be carried INTO the shed, before a single litre has
   * been entered. It used to draw its ⛔ markers from the health record and its
   * footer sentence from the milk records, so on that walk to the shed it said
   * "Njeri ⛔ do not sell" and "No cow is under withdrawal today" on one page.
   */
  it("never prints ⛔ against a cow and 'no cow is under withdrawal' on the same sheet", async () => {
    const { njeri } = await seedAugust();
    const oxytet = await seedProduct(db, { name: "Oxytetracycline LA 20%", milkWithdrawalDays: 7 });
    // Treated today, nothing milked yet today — the moment the sheet is printed.
    const tomorrow = addDays(M15, 1) as ISODate;
    await db.insert(s.healthEvent).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: njeri,
      productId: oxytet,
      eventType: "TREATMENT",
      occurredOn: tomorrow,
      treatmentEndOn: tomorrow,
      // What recordTreatment stamps from the product's label period.
      milkClearAt: new Date(`${addDays(tomorrow, 7)}T23:59:59.999Z`),
      recordedBy: USER,
    });

    const r = await dailySheet(session(), tomorrow, db);
    const flagged = r.cows.filter((c) => c.locked).map((c) => c.name);

    expect(flagged).toContain("Njeri");
    expect(r.note).not.toMatch(/No cow is under withdrawal/i);
    // Every cow the table marks must be named in the sentence below it.
    for (const name of flagged) expect(r.note).toContain(name);
  });

  it("marks the withheld cow in the CSV too, not only on the web page", async () => {
    const { njeri } = await seedAugust();
    const oxytet = await seedProduct(db, { name: "Oxytetracycline LA 20%", milkWithdrawalDays: 7 });
    const tomorrow = addDays(M15, 1) as ISODate;
    await db.insert(s.healthEvent).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: njeri,
      productId: oxytet,
      eventType: "TREATMENT",
      occurredOn: tomorrow,
      treatmentEndOn: tomorrow,
      // What recordTreatment stamps from the product's label period.
      milkClearAt: new Date(`${addDays(tomorrow, 7)}T23:59:59.999Z`),
      recordedBy: USER,
    });

    const [table] = await reportCsv(session(), "daily-sheet", { asOf: tomorrow }, db);
    expect(table.headers).toContain("Sell?");
    const njeriRow = table.rows.find((r) => r[0] === "Njeri")!;
    expect(njeriRow.at(-1)).toBe("DO NOT SELL");
    expect(table.sentence).toContain("Njeri");
  });
});

/* ================================================================== */
/* CSV and the full data export                                        */
/* ================================================================== */

describe("CSV export", () => {
  it("writes the conclusion into the file, not only the numbers", async () => {
    await seedAugust();
    const [table] = await reportCsv(session(), "money-this-month", { month: MONTH }, db);
    const csv = toCsv(table);

    expect(csv.split("\r\n")[0]).toContain("Money — 2026-08");
    expect(csv).toContain("You produced 375 L");
    expect(csv).toContain("Line,Detail,Litres,KES,Per litre KES");
  });

  it("contains what the cow league table claims — every cow, its margin, its action", async () => {
    await seedAugust();
    const [table] = await reportCsv(session(), "cow-league", { from: M1, to: M15 }, db);
    const csv = toCsv(table);

    expect(table.headers).toContain("Margin KES");
    expect(table.headers).toContain("What to do");
    expect(table.rows).toHaveLength(2);
    expect(csv).toContain("KE-0001");
    expect(csv).toContain("Njeri");
    expect(csv).toContain("Wanjiku");
    // The loss-maker is flagged in the file itself.
    const wanjikuRow = table.rows.find((r) => r[2] === "Wanjiku")!;
    expect(wanjikuRow[11]).toBe("YES");
    expect(String(wanjikuRow[13])).toContain("Wanjiku");
  });

  it("quotes commas and quotes so the file opens correctly on a phone", async () => {
    const csv = toCsv({
      name: "t",
      title: "Test",
      headers: ["A", "B"],
      rows: [[`Sell her, she is empty`, `She said "no"`]],
    });
    expect(csv).toContain('"Sell her, she is empty"');
    expect(csv).toContain('"She said ""no"""');
  });

  it("exports the daily sheet with a total row", async () => {
    await seedAugust();
    const [table] = await reportCsv(session(), "daily-sheet", { asOf: M5 }, db);
    expect(table.headers).toEqual(["Cow", "Tag", "AM litres", "PM litres", "Total", "Sell?"]);
    expect(table.rows.at(-1)).toEqual(["TOTAL", "", 14, 11, 25, ""]);
  });

  it("names every report it will export", () => {
    expect(isReportName("cow-league")).toBe(true);
    expect(isReportName("not-a-report")).toBe(false);
    expect(monthBounds("2026-08")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(monthBounds("2026-08-14")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("exports milk production as two tables in one bundle", async () => {
    await seedAugust();
    const tables = await reportCsv(session(), "milk-production", { from: M1, to: M31 }, db);
    expect(tables).toHaveLength(2);
    const bundle = toCsvBundle(tables);
    expect(bundle).toContain("Milk production, daily");
    expect(bundle).toContain("Milk production, per cow");
  });
});

describe("full data export — you can leave whenever you want", () => {
  it("dumps every table this farm owns, with the rows in it", async () => {
    await seedAugust();
    const tables = await fullDataExport(session(), db);

    const animals = tables.find((t) => t.name === "animals")!;
    expect(animals.rows).toHaveLength(2);
    expect(animals.headers).toContain("tag");
    expect(animals.rows.some((r) => r.includes("Njeri"))).toBe(true);

    const milk = tables.find((t) => t.name === "milk-records")!;
    expect(milk.rows).toHaveLength(60); // 15 days × 2 cows × 2 sessions

    const disposals = tables.find((t) => t.name === "milk-disposals")!;
    expect(disposals.rows).toHaveLength(45);

    // The promise is on the front of the file.
    expect(tables[0].sentence).toContain("you can take it anywhere");
  });

  it("exports another farm's dump as empty — the whole point of a tenant boundary", async () => {
    await seedAugust();
    const tables = await fullDataExport(otherFarmSession(), db);
    for (const t of tables) expect(t.rows).toHaveLength(0);
  });

  it("refuses a herdsman the whole-farm dump", async () => {
    await expect(fullDataExport(session({ role: "HERDSMAN" }), db)).rejects.toThrow(/permission/i);
  });

  it("flattens dates, arrays and json so the CSV is readable", async () => {
    await seedAugust();
    const tables = await fullDataExport(session(), db);
    const milk = tables.find((t) => t.name === "milk-records")!;
    const recordedAtIdx = milk.headers.indexOf("recordedAt");
    expect(String(milk.rows[0][recordedAtIdx])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
