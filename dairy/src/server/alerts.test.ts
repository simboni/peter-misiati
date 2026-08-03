/**
 * M11 — Alerts.
 *
 * The rule under test throughout: one person, one animal, one action, one
 * deadline — and a sweep that can be run as often as you like without ever
 * raising the same job twice. Dedupe is not an optimisation here; a duplicated
 * alert is exactly how an alert list becomes wallpaper.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
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
/* Harness                                                             */
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
  generateAlerts,
  resolveAlert,
  alertsForRole,
  openAlerts,
  actionCompletionRate,
  monthCompletionRate,
  dailyDigest,
  yieldDrops,
  statementVariances,
  kindIsVisibleTo,
  MONEY_ALERT_KINDS,
  DAILY_ALERT_CAP,
  SWEEP_KIND,
  ALERT_OUTCOMES,
} = await import("./alerts");

let db: TestDb;
let close: () => Promise<void>;

const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_FARM = "99999999-9999-4999-8999-999999999999";
const OTHER_USER = "88888888-8888-4888-8888-888888888888";

const M1: ISODate = "2026-08-01";
const M5: ISODate = "2026-08-05";
const M10: ISODate = "2026-08-10";
const M15: ISODate = "2026-08-15";

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
  await db.insert(s.farm).values({ id: OTHER_FARM, name: "Somebody Else's Dairy" });
});

afterEach(async () => {
  await close();
});

/* ------------------------------------------------------------------ */
/* Seeds                                                               */
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

async function disposal(on: ISODate, channel: s.DisposalChannel, litres: number, rate: number, customerId?: string) {
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

/** A cow served 62 days ago whose pregnancy check is overdue on 15 August. */
async function cowWithOverduePd() {
  const cow = await seedAnimal(db, { tag: "KE-0001", name: "Njeri", dateOfBirth: "2021-03-14" });
  await db.insert(s.calving).values({
    id: newId(), farmId: FARM_ID, damId: cow, calvedOn: "2026-04-10", recordedBy: USER,
  });
  await db.insert(s.service).values({
    id: newId(),
    farmId: FARM_ID,
    animalId: cow,
    servedOn: addDays(M15, -62) as ISODate,
    serviceType: "AI",
    serviceNumber: 1,
    expectedReturnOn: addDays(M15, -41) as ISODate,
    pdDueOn: addDays(M15, -2) as ISODate,
    expectedCalvingOn: addDays(M15, 221) as ISODate,
    recordedBy: USER,
  });
  return cow;
}

/* ================================================================== */
/* generateAlerts — the sweep                                          */
/* ================================================================== */

describe("generateAlerts", () => {
  it("raises one job per outstanding thing, naming role, animal, action and date", async () => {
    const cow = await cowWithOverduePd();
    const r = await generateAlerts(session(), M15, db);

    expect(r.created).toBeGreaterThan(0);
    const rows = await db.select().from(s.alert).where(eq(s.alert.farmId, FARM_ID));
    const pd = rows.find((a) => a.kind === "PD_DUE")!;

    expect(pd).toBeDefined();
    expect(pd.animalId).toBe(cow); // ONE animal
    expect(pd.assignedRole).toBe("MANAGER"); // ONE person
    expect(pd.action).toContain("checked for pregnancy"); // ONE action
    expect(pd.dueOn).toBe(addDays(M15, -2)); // ONE deadline
    expect(pd.resolvedAt).toBeNull();
  });

  it("IS IDEMPOTENT — running it twice does not duplicate a single alert", async () => {
    await cowWithOverduePd();

    const first = await generateAlerts(session(), M15, db);
    const afterFirst = await db.select().from(s.alert).where(eq(s.alert.farmId, FARM_ID));

    const second = await generateAlerts(session(), M15, db);
    const afterSecond = await db.select().from(s.alert).where(eq(s.alert.farmId, FARM_ID));

    expect(first.created).toBeGreaterThan(0);
    expect(second.created).toBe(0);
    expect(second.skippedExisting).toBe(first.created);
    expect(afterSecond).toHaveLength(afterFirst.length);

    // And a third, and a fourth. This is what dedupeKey is for.
    await generateAlerts(session(), M15, db);
    await generateAlerts(session(), M15, db);
    expect(await db.select().from(s.alert).where(eq(s.alert.farmId, FARM_ID))).toHaveLength(
      afterFirst.length,
    );
  });

  it("does not duplicate an alert another module already raised at entry", async () => {
    const cow = await cowWithOverduePd();

    // M2 writes this at the moment the service is recorded.
    await db.insert(s.alert).values({
      id: newId(),
      farmId: FARM_ID,
      kind: "PD_DUE",
      animalId: cow,
      assignedRole: "MANAGER",
      action: `Have Njeri checked for pregnancy.`,
      dueOn: addDays(M15, -2) as ISODate,
      severity: "WARN",
      dedupeKey: `${cow}:PD_DUE:${newId()}`,
    });

    await generateAlerts(session(), M15, db);
    const pds = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, "PD_DUE")));
    expect(pds).toHaveLength(1);
  });

  it("gives every alert a dedupe key that is stable for the same job on the same day", async () => {
    const cow = await cowWithOverduePd();
    await generateAlerts(session(), M15, db);
    const [pd] = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, "PD_DUE")));
    expect(pd.dedupeKey).toBe(`sweep:PD_DUE:${cow}:${addDays(M15, -2)}`);
  });

  it("raises the MILK WITHDRAWAL clearing alert, the one that must never be missed", async () => {
    const cow = await seedAnimal(db, { tag: "KE-0002", name: "Wanjiku" });
    const product = await seedProduct(db, { milkWithdrawalDays: 7 });
    await db.insert(s.healthEvent).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: cow,
      eventType: "TREATMENT",
      occurredOn: M10,
      productId: product,
      treatmentEndOn: M10,
      milkClearAt: new Date(`${addDays(M10, 7)}T00:00:00Z`),
      recordedBy: USER,
    });

    await generateAlerts(session(), M15, db);
    const [w] = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, SWEEP_KIND.WITHDRAWAL_CLEAR)));

    expect(w).toBeDefined();
    expect(w.severity).toBe("CRITICAL");
    expect(w.assignedRole).toBe("HERDSMAN");
    expect(w.action).toContain("Wanjiku");
    expect(w.action).toContain("goes back in the can");
    expect(w.dueOn).toBe(addDays(M10, 7));
  });

  it("raises low feed stock when cover falls to a week or less", async () => {
    const meal = await seedFeedItem(db, { name: "Dairy meal (Unga)" });
    await db.insert(s.feedPurchase).values({
      id: newId(), farmId: FARM_ID, feedItemId: meal, purchasedOn: M1,
      quantity: dec(2, 3), unit: "BAG_70KG", unitWeightKg: dec(70, 3),
      unitPriceKes: dec(3500), totalCostKes: dec(7000), recordedBy: USER,
    });
    for (let i = 0; i < 7; i++) {
      await db.insert(s.feedIssue).values({
        id: newId(), farmId: FARM_ID, feedItemId: meal,
        issuedOn: addDays(M15, -i) as ISODate, animalGroup: "LACTATING",
        quantity: dec(15, 3), unit: "KG", unitWeightKg: dec(1, 3), recordedBy: USER,
      });
    }

    await generateAlerts(session(), M15, db);
    const [low] = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, SWEEP_KIND.LOW_FEED_STOCK)));
    expect(low).toBeDefined();
    expect(low.action).toContain("Buy Dairy meal");
    expect(low.animalId).toBeNull();
    expect(low.assignedRole).toBe("MANAGER");
  });

  it("raises a yield drop when a cow is down for three days running", async () => {
    const cow = await seedAnimal(db, { tag: "KE-0003", name: "Muthoni" });
    await db.insert(s.calving).values({
      id: newId(), farmId: FARM_ID, damId: cow, calvedOn: "2026-05-01", recordedBy: USER,
    });
    // Fourteen days at 20 L, then three at 10 L.
    for (let i = 16; i >= 3; i--) await milking(cow, addDays(M15, -i) as ISODate, 11, 9);
    for (let i = 2; i >= 0; i--) await milking(cow, addDays(M15, -i) as ISODate, 5, 5);

    const drops = await yieldDrops(session(), M15, db);
    expect(drops).toHaveLength(1);
    expect(drops[0].animalId).toBe(cow);
    expect(drops[0].pct).toBe(50);

    await generateAlerts(session(), M15, db);
    const [alert] = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, SWEEP_KIND.YIELD_DROP)));
    expect(alert.action).toContain("Muthoni");
    expect(alert.action).toContain("down 50%");
    expect(alert.severity).toBe("CRITICAL");
  });

  it("raises a heifer that has reached breeding weight", async () => {
    const heifer = await seedAnimal(db, {
      tag: "KE-0004", name: "Nyambura", dateOfBirth: addDays(M15, -450) as ISODate,
    });
    await db.insert(s.weightObservation).values({
      id: newId(), farmId: FARM_ID, animalId: heifer, observedOn: M10,
      weightKg: dec(295), method: "HEART_GIRTH", recordedBy: USER,
    });

    await generateAlerts(session(), M15, db);
    const [alert] = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, SWEEP_KIND.HEIFER_READY)));
    expect(alert).toBeDefined();
    expect(alert.action).toContain("Nyambura");
    expect(alert.action).toContain("295 kg");
    expect(alert.animalId).toBe(heifer);
  });

  it("raises a casual approaching thirty days of continuous work", async () => {
    const employeeId = await seedEmployee(db, {
      fullName: "Peter Kariuki", employmentType: "CASUAL",
      basicWageKes: "500.00", wagePeriod: "DAILY", startedOn: "2026-07-10",
    });
    for (let i = 0; i < 28; i++) {
      await db.insert(s.attendance).values({
        id: newId(), farmId: FARM_ID, employeeId,
        workedOn: addDays(M15, -i) as ISODate, days: dec(1), recordedBy: USER,
      });
    }

    await generateAlerts(session(), M15, db);
    const [alert] = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, SWEEP_KIND.CASUAL_CONVERSION)));
    expect(alert).toBeDefined();
    expect(alert.employeeId).toBe(employeeId);
    expect(alert.assignedRole).toBe("OWNER");
    expect(alert.action).toContain("Peter Kariuki");
  });

  it("raises a co-op statement variance", async () => {
    const coop = await seedCustomer(db, { name: "Limuru Dairy Co-operative", customerType: "COOP" });
    for (let i = 0; i < 10; i++) await disposal(addDays(M1, i) as ISODate, "COOP", 20, 48, coop);

    await db.insert(s.milkStatement).values({
      id: newId(), farmId: FARM_ID, customerId: coop,
      periodStart: M1, periodEnd: M10,
      coopLitres: dec(180), // we recorded 200
      rateKesPerLitre: dec(48), grossPayKes: dec(8640), netPayKes: dec(8000),
      recordedBy: USER,
    });

    const variances = await statementVariances(session(), M15, db);
    expect(variances).toHaveLength(1);
    expect(variances[0].litresVariance).toBe(20);

    await generateAlerts(session(), M15, db);
    const [alert] = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, SWEEP_KIND.COOP_VARIANCE)));
    expect(alert.customerId).toBe(coop);
    expect(alert.action).toContain("Limuru Dairy Co-operative");
  });

  it("raises a customer over their credit limit", async () => {
    const shop = await seedCustomer(db, {
      name: "Mama Njeri's shop", customerType: "SHOP",
      paymentTerms: "WEEKLY", creditLimitKes: "2000.00",
    });
    await db.insert(s.customerLedgerEntry).values({
      id: newId(), farmId: FARM_ID, customerId: shop, entryDate: M5,
      entryType: "DELIVERY", litres: dec(100), rateKesPerLitre: dec(70),
      debitKes: dec(7000), creditKes: dec(0), recordedBy: USER,
    });

    await generateAlerts(session(), M15, db);
    const [alert] = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, SWEEP_KIND.CREDIT_LIMIT)));
    expect(alert).toBeDefined();
    expect(alert.customerId).toBe(shop);
    expect(alert.severity).toBe("CRITICAL");
    expect(alert.action).toContain("over their limit");
  });

  it("raises COMPLIANCE DOCUMENT EXPIRY — six months is too short for a yearly check", async () => {
    const employeeId = await seedEmployee(db, { fullName: "Kamau Mwangi" });
    await db.insert(s.complianceDocument).values({
      id: newId(), farmId: FARM_ID, docType: "FOOD_HANDLER_CERT",
      holderEmployeeId: employeeId, issuedOn: "2026-02-25",
      expiresOn: addDays(M15, 20) as ISODate,
    });

    await generateAlerts(session(), M15, db);
    const [alert] = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, SWEEP_KIND.COMPLIANCE_EXPIRY)));
    expect(alert).toBeDefined();
    expect(alert.assignedRole).toBe("OWNER");
    expect(alert.action).toContain("food handler certificate");
    expect(alert.dueOn).toBe(addDays(M15, 20));
  });

  it("raises vaccination and deworming under M1's routine prefix, so M6 can clear them", async () => {
    await seedAnimal(db, { tag: "KE-0005", name: "Wangari", dateOfBirth: addDays(M15, -400) as ISODate });
    await generateAlerts(session(), M15, db);

    const routines = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, "ROUTINE_DEWORM")));
    expect(routines).toHaveLength(1);
    expect(routines[0].action).toContain("Wangari");
    expect(routines[0].assignedRole).toBe("HERDSMAN");
  });

  it("does not raise money alerts on a herdsman's sweep", async () => {
    await seedEmployee(db, {
      fullName: "Peter Kariuki", employmentType: "CASUAL",
      basicWageKes: "500.00", wagePeriod: "DAILY", startedOn: "2026-07-10",
    });
    await db.insert(s.complianceDocument).values({
      id: newId(), farmId: FARM_ID, docType: "KDB_PERMIT", expiresOn: addDays(M15, 5) as ISODate,
    });

    await generateAlerts(session({ role: "HERDSMAN" }), M15, db);
    const money = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, SWEEP_KIND.COMPLIANCE_EXPIRY)));
    expect(money).toHaveLength(0);
  });

  it("sweeps only its own farm", async () => {
    await cowWithOverduePd();
    const r = await generateAlerts(otherFarmSession(), M15, db);
    expect(r.created).toBe(0);
    const ours = await db.select().from(s.alert).where(eq(s.alert.farmId, OTHER_FARM));
    expect(ours).toHaveLength(0);
  });

  it("DOES NOT NAG — a job cleared today is not raised again tomorrow", async () => {
    await cowWithOverduePd();
    await generateAlerts(session(), M15, db);
    const [pd] = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, "PD_DUE")));

    await resolveAlert(session(), pd.id, "DONE", db);
    await generateAlerts(session(), addDays(M15, 1) as ISODate, db);

    // Same job, same deadline, same dedupe key — so it stays cleared. Raising
    // it again the next morning is precisely how an alert list becomes noise.
    const pds = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, "PD_DUE")));
    expect(pds).toHaveLength(1);
    expect(pds[0].resolvedAt).not.toBeNull();
  });

  it("raises a fresh job when the deadline moves on", async () => {
    const cow = await seedAnimal(db, { tag: "KE-0009", name: "Muthoni" });
    await db.insert(s.calving).values({
      id: newId(), farmId: FARM_ID, damId: cow, calvedOn: "2026-05-01", recordedBy: USER,
    });
    for (let i = 16; i >= 3; i--) await milking(cow, addDays(M15, -i) as ISODate, 11, 9);
    for (let i = 2; i >= 0; i--) await milking(cow, addDays(M15, -i) as ISODate, 5, 5);

    await generateAlerts(session(), M15, db);
    const [first] = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, SWEEP_KIND.YIELD_DROP)));
    await resolveAlert(session(), first.id, "DONE", db);

    // She is still down the next day. That is a NEW day's deadline, so it is a
    // new job — and this time the herdsman has to answer for it again.
    await generateAlerts(session(), addDays(M15, 1) as ISODate, db);
    const drops = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, SWEEP_KIND.YIELD_DROP)));
    expect(drops).toHaveLength(2);

    const open = await db
      .select()
      .from(s.alert)
      .where(
        and(
          eq(s.alert.farmId, FARM_ID),
          eq(s.alert.kind, SWEEP_KIND.YIELD_DROP),
          isNull(s.alert.resolvedAt),
        ),
      );
    expect(open).toHaveLength(1);
    expect(open[0].id).not.toBe(first.id);
    expect(open[0].dueOn).toBe(addDays(M15, 1));
  });
});

/* ================================================================== */
/* Resolution                                                          */
/* ================================================================== */

describe("resolveAlert", () => {
  async function anAlert(over: Partial<typeof s.alert.$inferInsert> = {}) {
    const id = newId();
    await db.insert(s.alert).values({
      id,
      farmId: FARM_ID,
      kind: "PD_DUE",
      assignedRole: "MANAGER",
      action: "Have Njeri checked for pregnancy.",
      dueOn: M15,
      severity: "WARN",
      dedupeKey: `test:${id}`,
      ...over,
    });
    return id;
  }

  it("carries the outcome, the person and the time — a dismissal that teaches something", async () => {
    const id = await anAlert();
    const r = await resolveAlert(session(), id, "DONE", db);

    expect(r.outcome).toBe("DONE");
    expect(r.message).toBe("Done. Cleared.");

    const [row] = await db.select().from(s.alert).where(eq(s.alert.id, id));
    expect(row.resolvedAt).not.toBeNull();
    expect(row.outcome).toBe("DONE");
    expect(row.resolvedBy).toBe(USER);
  });

  it("records WRONG as a first-class outcome, because that is the one worth measuring", async () => {
    const id = await anAlert();
    const r = await resolveAlert(session(), id, "WRONG", db);
    expect(r.message).toContain("should not have been raised");
    const [row] = await db.select().from(s.alert).where(eq(s.alert.id, id));
    expect(row.outcome).toBe("WRONG");
  });

  it("treats SNOOZED as a new deadline, not a resolution", async () => {
    const id = await anAlert();
    await resolveAlert(session(), id, "SNOOZED", db);
    const [row] = await db.select().from(s.alert).where(eq(s.alert.id, id));
    expect(row.resolvedAt).toBeNull();
    expect(row.dueOn).toBe(addDays(M15, 1));
  });

  it("refuses an outcome that says nothing", async () => {
    const id = await anAlert();
    await expect(
      resolveAlert(session(), id, "whatever" as never, db),
    ).rejects.toThrow(/Say what happened/);
  });

  it("refuses another farm's alert the same way it refuses one that does not exist", async () => {
    const id = await anAlert();
    await expect(resolveAlert(otherFarmSession(), id, "DONE", db)).rejects.toThrow(/not found/i);
    await expect(resolveAlert(session(), newId(), "DONE", db)).rejects.toThrow(/not found/i);

    const [row] = await db.select().from(s.alert).where(eq(s.alert.id, id));
    expect(row.resolvedAt).toBeNull();
  });

  it("does not re-resolve an alert that is already closed", async () => {
    const id = await anAlert();
    await resolveAlert(session(), id, "DONE", db);
    const [first] = await db.select().from(s.alert).where(eq(s.alert.id, id));

    await resolveAlert(session(), id, "WRONG", db);
    const [second] = await db.select().from(s.alert).where(eq(s.alert.id, id));
    expect(second.outcome).toBe("DONE");
    expect(second.resolvedAt).toEqual(first.resolvedAt);
  });

  it("lists the outcomes a person may choose between", () => {
    expect([...ALERT_OUTCOMES]).toEqual(["DONE", "NOT_NEEDED", "WRONG", "SNOOZED"]);
  });
});

/* ================================================================== */
/* Role filtering — a herdsman must not see money                      */
/* ================================================================== */

describe("alertsForRole", () => {
  async function seedMixedAlerts() {
    const cow = await seedAnimal(db, { tag: "KE-0001", name: "Njeri" });
    const customer = await seedCustomer(db, { name: "Mama Njeri's shop", customerType: "SHOP" });
    await db.insert(s.alert).values([
      {
        id: newId(), farmId: FARM_ID, kind: "ROUTINE_DIP", animalId: cow,
        assignedRole: "HERDSMAN", action: "Dip Njeri today.", dueOn: M15,
        severity: "WARN", dedupeKey: "a1",
      },
      {
        id: newId(), farmId: FARM_ID, kind: SWEEP_KIND.WITHDRAWAL_CLEAR, animalId: cow,
        assignedRole: "HERDSMAN", action: "Njeri's milk goes back in the can on Mon 17 Aug — not before.",
        dueOn: M15, severity: "CRITICAL", dedupeKey: "a2",
      },
      {
        id: newId(), farmId: FARM_ID, kind: SWEEP_KIND.CREDIT_LIMIT, customerId: customer,
        assignedRole: "OWNER", action: "Mama Njeri's shop owes KES 7,000, over their limit.",
        dueOn: M15, severity: "CRITICAL", dedupeKey: "a3",
      },
      {
        id: newId(), farmId: FARM_ID, kind: SWEEP_KIND.COOP_VARIANCE,
        assignedRole: "OWNER", action: "Query the co-op's statement.",
        dueOn: M15, severity: "WARN", dedupeKey: "a4",
      },
      {
        id: newId(), farmId: FARM_ID, kind: SWEEP_KIND.COMPLIANCE_EXPIRY,
        assignedRole: "OWNER", action: "Renew the food handler certificate.",
        dueOn: M15, severity: "WARN", dedupeKey: "a5",
      },
    ]);
    return { cow, customer };
  }

  it("A HERDSMAN SEES NO MONEY ALERTS", async () => {
    await seedMixedAlerts();
    const r = await alertsForRole(session({ role: "HERDSMAN" }), "HERDSMAN", M15, db);

    const kinds = r.alerts.map((a) => a.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([SWEEP_KIND.WITHDRAWAL_CLEAR, "ROUTINE_DIP"]),
    );
    for (const money of MONEY_ALERT_KINDS) expect(kinds).not.toContain(money);
    expect(r.alerts).toHaveLength(2);
  });

  it("does not let a herdsman ASK for the owner's view and get money alerts", async () => {
    await seedMixedAlerts();
    // The role parameter is a filter, never an identity. Asking for "OWNER"
    // from a herdsman's session must not widen anything.
    const r = await alertsForRole(session({ role: "HERDSMAN" }), "OWNER", M15, db);
    for (const money of MONEY_ALERT_KINDS) {
      expect(r.alerts.map((a) => a.kind)).not.toContain(money);
    }
  });

  it("does not let a herdsman clear a money alert by guessing its id", async () => {
    await seedMixedAlerts();
    const [credit] = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, SWEEP_KIND.CREDIT_LIMIT)));

    await expect(
      resolveAlert(session({ role: "HERDSMAN" }), credit.id, "DONE", db),
    ).rejects.toThrow(/not found/i);

    const [after] = await db.select().from(s.alert).where(eq(s.alert.id, credit.id));
    expect(after.resolvedAt).toBeNull();
  });

  it("shows the owner everything, money included", async () => {
    await seedMixedAlerts();
    const r = await alertsForRole(session(), "OWNER", M15, db);
    expect(r.alerts).toHaveLength(5);
    expect(r.alerts.map((a) => a.kind)).toContain(SWEEP_KIND.CREDIT_LIMIT);
  });

  it("gives a manager the money alerts but not the herdsman's assignments", async () => {
    await seedMixedAlerts();
    const r = await alertsForRole(session({ role: "MANAGER" }), "MANAGER", M15, db);
    const kinds = r.alerts.map((a) => a.kind);
    expect(kinds).not.toContain("ROUTINE_DIP");
    expect(kindIsVisibleTo("MANAGER", SWEEP_KIND.CREDIT_LIMIT)).toBe(true);
    expect(kindIsVisibleTo("HERDSMAN", SWEEP_KIND.CREDIT_LIMIT)).toBe(false);
  });

  it("puts the urgent job first and says what to start with", async () => {
    await seedMixedAlerts();
    const r = await alertsForRole(session(), "OWNER", M15, db);
    expect(r.alerts[0].severity).toBe("CRITICAL");
    expect(r.headline).toContain("Start with:");
    expect(r.headline).toContain(r.alerts[0].action);
  });

  it("caps the day and says how many are held back rather than hiding them", async () => {
    const cow = await seedAnimal(db, { tag: "KE-0001", name: "Njeri" });
    for (let i = 0; i < DAILY_ALERT_CAP + 5; i++) {
      await db.insert(s.alert).values({
        id: newId(), farmId: FARM_ID, kind: "ROUTINE_DIP", animalId: cow,
        assignedRole: "HERDSMAN", action: `Job number ${i}.`, dueOn: M15,
        severity: "INFO", dedupeKey: `cap-${i}`,
      });
    }

    const r = await alertsForRole(session({ role: "HERDSMAN" }), "HERDSMAN", M15, db);
    expect(r.alerts).toHaveLength(DAILY_ALERT_CAP);
    expect(r.heldBack).toBe(5);
    expect(r.openTotal).toBe(DAILY_ALERT_CAP + 5);
    expect(r.headline).toContain("5 more waiting behind them");
  });

  it("never shows a resolved alert", async () => {
    const { cow } = await seedMixedAlerts();
    const [dip] = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, "ROUTINE_DIP")));
    await resolveAlert(session(), dip.id, "DONE", db);

    const r = await alertsForRole(session({ role: "HERDSMAN" }), "HERDSMAN", M15, db);
    expect(r.alerts.map((a) => a.kind)).not.toContain("ROUTINE_DIP");
    expect(cow).toBeTruthy();
  });

  it("shows another farm none of our alerts", async () => {
    await seedMixedAlerts();
    const r = await alertsForRole(otherFarmSession(), "OWNER", M15, db);
    expect(r.alerts).toHaveLength(0);
    expect(await openAlerts(otherFarmSession(), M15, db)).toHaveLength(0);
  });

  it("says how late a job is in words, not in dates", async () => {
    await db.insert(s.alert).values({
      id: newId(), farmId: FARM_ID, kind: "PD_DUE", assignedRole: "MANAGER",
      action: "Have Njeri checked for pregnancy.", dueOn: addDays(M15, -3) as ISODate,
      severity: "WARN", dedupeKey: "late-1",
    });
    const r = await alertsForRole(session(), "OWNER", M15, db);
    expect(r.alerts[0].dueLabel).toBe("3 days late");
    expect(r.alerts[0].daysOverdue).toBe(3);
  });
});

/* ================================================================== */
/* Action completion rate — never alert volume                         */
/* ================================================================== */

describe("actionCompletionRate", () => {
  async function seedOutcomes(outcomes: Array<string | null>) {
    for (const [i, outcome] of outcomes.entries()) {
      await db.insert(s.alert).values({
        id: newId(), farmId: FARM_ID, kind: "ROUTINE_DIP",
        assignedRole: "HERDSMAN", action: `Job ${i}.`, dueOn: M10,
        severity: "INFO", dedupeKey: `rate-${i}`,
        resolvedAt: outcome ? new Date() : null,
        outcome,
        resolvedBy: outcome ? USER : null,
      });
    }
  }

  it("reports the share of jobs DONE, not the number of alerts sent", async () => {
    await seedOutcomes(["DONE", "DONE", "DONE", "DONE", "NOT_NEEDED", null]);
    const r = await actionCompletionRate(session(), M1, M15, db);

    expect(r.raised).toBe(6);
    expect(r.done).toBe(4);
    expect(r.notNeeded).toBe(1);
    expect(r.stillOpen).toBe(1);
    expect(r.completionRatePct).toBeCloseTo(66.67, 1);
    expect(r.headline).toContain("67% of the jobs raised were done");
    // The volume never appears as the headline number.
    expect(r.headline).not.toMatch(/^6 alerts/);
  });

  it("calls out the alerts, not the people, when the false alarm rate climbs", async () => {
    await seedOutcomes(["WRONG", "WRONG", "WRONG", "DONE"]);
    const r = await actionCompletionRate(session(), M1, M15, db);
    expect(r.wrong).toBe(3);
    expect(r.falseAlarmRatePct).toBe(75);
    expect(r.headline).toContain("The alerts are the problem, not the people");
  });

  it("praises a farm that acts on its list", async () => {
    await seedOutcomes(["DONE", "DONE", "DONE", "DONE", "DONE"]);
    const r = await actionCompletionRate(session(), M1, M15, db);
    expect(r.completionRatePct).toBe(100);
    expect(r.headline).toContain("worth using");
  });

  it("breaks the rate down by kind, so a bad alert can be found and killed", async () => {
    await seedOutcomes(["DONE", "WRONG"]);
    await db.insert(s.alert).values({
      id: newId(), farmId: FARM_ID, kind: SWEEP_KIND.YIELD_DROP,
      assignedRole: "HERDSMAN", action: "Check Njeri.", dueOn: M10,
      severity: "WARN", dedupeKey: "kind-1", resolvedAt: new Date(), outcome: "WRONG",
      resolvedBy: USER,
    });

    const r = await actionCompletionRate(session(), M1, M15, db);
    const yieldKind = r.byKind.find((k) => k.kind === SWEEP_KIND.YIELD_DROP)!;
    expect(yieldKind.wrong).toBe(1);
    expect(yieldKind.completionRatePct).toBe(0);
  });

  it("refuses a herdsman and counts nothing for another farm", async () => {
    await seedOutcomes(["DONE"]);
    await expect(
      actionCompletionRate(session({ role: "HERDSMAN" }), M1, M15, db),
    ).rejects.toThrow(/permission/i);
    expect((await actionCompletionRate(otherFarmSession(), M1, M15, db)).raised).toBe(0);
    expect((await monthCompletionRate(session(), M15, db)).raised).toBe(1);
  });
});

/* ================================================================== */
/* The daily digest — the Sky Dairy pattern                            */
/* ================================================================== */

describe("dailyDigest", () => {
  it("writes the one SMS: day, litres, sessions, delivered, value, month to date", async () => {
    const njeri = await seedAnimal(db, { tag: "KE-0001", name: "Njeri" });
    const wanjiku = await seedAnimal(db, { tag: "KE-0002", name: "Wanjiku" });
    const coop = await seedCustomer(db, { name: "Limuru Dairy", customerType: "COOP" });

    // Two cows, 104 L in the morning and 83 L in the evening.
    await milking(njeri, M10, 60, 50);
    await milking(wanjiku, M10, 44, 33);
    await disposal(M10, "COOP", 170, 52, coop);

    const r = await dailyDigest(session(), M10, db);

    expect(r.totalL).toBe(187);
    expect(r.bySession).toEqual([
      { label: "AM", litres: 104 },
      { label: "PM", litres: 83 },
    ]);
    expect(r.deliveredL).toBe(170);
    expect(r.valueKes).toBe(8840);
    expect(r.sms).toBe(
      "Mon 10 Aug: 187 L (AM 104, PM 83). Delivered 170 L. Value KES 8,840. Month to date KES 8,840.",
    );
  });

  it("adds the running month-to-date total, which is what the pattern is trusted for", async () => {
    const cow = await seedAnimal(db, { tag: "KE-0001", name: "Njeri" });
    const coop = await seedCustomer(db, { name: "Limuru Dairy", customerType: "COOP" });
    for (let i = 0; i < 10; i++) {
      await milking(cow, addDays(M1, i) as ISODate, 12, 8);
      await disposal(addDays(M1, i) as ISODate, "COOP", 18, 50, coop);
    }

    const r = await dailyDigest(session(), M10, db);
    expect(r.valueKes).toBe(900);
    expect(r.monthToDateKes).toBe(9000);
    expect(r.sms).toContain("Month to date KES 9,000");
  });

  it("puts a withdrawal in the SMS, because that is what a day's message is for", async () => {
    const cow = await seedAnimal(db, { tag: "KE-0001", name: "Njeri" });
    const product = await seedProduct(db, { milkWithdrawalDays: 7 });
    await milking(cow, M10, 12, 8);
    await db.insert(s.healthEvent).values({
      id: newId(), farmId: FARM_ID, animalId: cow, eventType: "TREATMENT",
      occurredOn: M10, productId: product, treatmentEndOn: M10,
      milkClearAt: new Date(`${addDays(M10, 7)}T00:00:00Z`), recordedBy: USER,
    });

    const r = await dailyDigest(session(), M10, db);
    expect(r.urgent[0]).toContain("Do not sell Njeri's milk");
    expect(r.sms).toContain("Do not sell Njeri's milk until Mon 17 Aug");
  });

  it("counts the SMS segments, because every one costs KES 0.40–0.80", async () => {
    const cow = await seedAnimal(db, { tag: "KE-0001", name: "Njeri" });
    await milking(cow, M10, 12, 8);
    const r = await dailyDigest(session(), M10, db);
    expect(r.charactersUsed).toBe(r.sms.length);
    expect(r.segments).toBe(Math.max(1, Math.ceil(r.sms.length / 160)));
    expect(r.segments).toBe(1);
  });

  it("says nothing was milked rather than nothing at all", async () => {
    const r = await dailyDigest(session(), M10, db);
    expect(r.totalL).toBe(0);
    expect(r.sms).toContain("Mon 10 Aug: 0 L");
    expect(r.sms).toContain("Month to date KES 0");
  });

  it("refuses a herdsman — the digest is money", async () => {
    await expect(dailyDigest(session({ role: "HERDSMAN" }), M10, db)).rejects.toThrow(
      /permission/i,
    );
  });

  it("sends another farm none of our milk", async () => {
    const cow = await seedAnimal(db, { tag: "KE-0001", name: "Njeri" });
    await milking(cow, M10, 12, 8);
    const r = await dailyDigest(otherFarmSession(), M10, db);
    expect(r.totalL).toBe(0);
    expect(r.valueKes).toBe(0);
  });
});
