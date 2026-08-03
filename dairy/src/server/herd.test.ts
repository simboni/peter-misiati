import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import * as s from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/test-db";
import { seedFarm, seedAnimal, FARM_ID, fakeSession } from "@/test/factory";
import { newId } from "@/lib/ids";

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

/**
 * `@/db` opens a real on-disk PGlite at import time, and `@/lib/session` reads
 * a cookie jar that does not exist outside a request. Both are replaced so the
 * module under test runs against a throwaway in-memory Postgres, with a session
 * we control per test. `@/lib/dal` itself is NOT mocked — the capability check
 * and the ownership assert being exercised is most of the point.
 */
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
  registerAnimal,
  recordWeight,
  recordExit,
  listHerd,
  getAnimal,
  herdInventoryReconciliation,
  firstYearSchedule,
  factsFor,
  loadHerdSources,
} = await import("./herd");

let db: TestDb;
let close: () => Promise<void>;
const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_FARM = "99999999-9999-4999-8999-999999999999";

function session(over: Parameters<typeof fakeSession>[0] = {}) {
  return fakeSession({ userId: USER, role: "MANAGER", ...over });
}

function fd(values: Record<string, string | number | boolean | undefined | null>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null || v === false) continue;
    f.set(k, v === true ? "on" : String(v));
  }
  return f;
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
    role: "MANAGER",
    pinHash: "test$1234",
  });
});

afterEach(async () => {
  await close();
});

/** A second farm, so cross-tenant attempts have something real to reach for. */
async function seedOtherFarm() {
  await db.insert(s.farm).values({ id: OTHER_FARM, name: "Nakuru Rival Dairy" });
  const id = newId();
  await db.insert(s.animal).values({
    id,
    farmId: OTHER_FARM,
    tag: "RIVAL-01",
    name: "Wanjiku",
    sex: "F",
    origin: "BORN",
    enteredHerdOn: "2022-01-01",
  });
  return id;
}

/* ================================================================== */
/* registerAnimal                                                      */
/* ================================================================== */

describe("registerAnimal", () => {
  it("registers a heifer calf and hands back her whole first year at the moment of entry (R7)", async () => {
    const res = await registerAnimal(
      null,
      fd({
        tag: "KE-1201",
        name: "Wambui",
        sex: "F",
        primaryBreed: "FRIESIAN",
        dateOfBirth: "2026-07-20",
        origin: "BORN",
        enteredHerdOn: "2026-07-20",
      }),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.refCode).toMatch(/^AN[A-Z2-9]{5}$/);
    expect(res.data.cls).toBe("CALF");
    expect(res.data.classLabel).toBe("Calf");

    const routines = res.data.schedule.map((i) => i.routine);
    expect(routines).toContain("COLOSTRUM");
    expect(routines).toContain("DISBUD");
    expect(routines).toContain("S19");
    expect(routines).toContain("ECF_ITM");
    expect(routines).toContain("DEWORM");
    expect(routines).toContain("WEANING");

    // Colostrum first, and it is the only CRITICAL one.
    expect(res.data.schedule[0].routine).toBe("COLOSTRUM");
    expect(res.data.schedule[0].severity).toBe("CRITICAL");

    // The two windows that close: disbudding 2–8 weeks, S19 4–8 months.
    const disbud = res.data.schedule.find((i) => i.routine === "DISBUD")!;
    expect(disbud.dueOn).toBe("2026-08-03"); // dob + 14 days
    expect(disbud.windowClosesOn).toBe("2026-09-14"); // dob + 56 days
    expect(disbud.onceInLifetime).toBe(true);

    const s19 = res.data.schedule.find((i) => i.routine === "S19")!;
    expect(s19.dueOn).toBe("2026-11-17"); // dob + 120 days
    expect(s19.windowClosesOn).toBe("2027-03-17"); // dob + 240 days
    expect(s19.onceInLifetime).toBe(true);
  });

  it("persists the schedule as alerts a person can be given", async () => {
    const res = await registerAnimal(
      null,
      fd({ tag: "KE-1202", sex: "F", dateOfBirth: "2026-07-20", origin: "BORN" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const alerts = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.animalId, res.data.id)));

    expect(alerts.length).toBe(res.data.schedule.length);
    for (const a of alerts) {
      expect(a.action.length).toBeGreaterThan(10);
      expect(a.dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.assignedRole).toBeTruthy();
      expect(a.resolvedAt).toBeNull();
    }
  });

  it("leaves S19 off a bull calf, because it is a females-only, once-for-life vaccine", async () => {
    const male = await registerAnimal(
      null,
      fd({ tag: "KE-1203", sex: "M", dateOfBirth: "2026-07-20", origin: "BORN" }),
    );
    expect(male.ok).toBe(true);
    if (!male.ok) return;

    const routines = male.data.schedule.map((i) => i.routine);
    expect(routines).not.toContain("S19");
    expect(routines).toContain("ECF_ITM");
    expect(routines).toContain("DISBUD");
    expect(male.data.cls).toBe("BULL_CALF");
  });

  it("generates no schedule for a bought-in adult, and says why", async () => {
    const res = await registerAnimal(
      null,
      fd({
        tag: "KE-1204",
        name: "Nyakio",
        sex: "F",
        dateOfBirth: "2021-05-02",
        origin: "PURCHASED",
        enteredHerdOn: "2026-08-01",
        purchasePriceKes: 145000,
        classOverride: "MATURE_COW",
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.schedule).toHaveLength(0);
    // The override wins for an animal whose history we do not have.
    expect(res.data.cls).toBe("MATURE_COW");
  });

  it("asks for a date of birth rather than guessing one", async () => {
    const res = await registerAnimal(null, fd({ tag: "KE-1205", sex: "F", origin: "PURCHASED" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.schedule).toHaveLength(0);
    expect(res.message).toMatch(/date of birth/i);
  });

  it("is idempotent when the offline outbox flushes the same entry twice", async () => {
    const id = newId();
    const values = { id, tag: "KE-1206", sex: "F", dateOfBirth: "2026-07-01", origin: "BORN" };

    const first = await registerAnimal(null, fd(values));
    const second = await registerAnimal(null, fd(values));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const animals = await db.select().from(s.animal).where(eq(s.animal.id, id));
    expect(animals).toHaveLength(1);

    const alerts = await db.select().from(s.alert).where(eq(s.alert.animalId, id));
    expect(alerts.length).toBe(firstYearSchedule({ sex: "F", birthOn: "2026-07-01" }).length);
  });

  it("refuses a tag that is already on another animal, and names the animal", async () => {
    await seedAnimal(db, { tag: "KE-1207", name: "Njeri" });
    const res = await registerAnimal(null, fd({ tag: "KE-1207", sex: "F", origin: "BORN" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.fieldErrors?.tag?.[0]).toContain("Njeri");
  });

  it("refuses a dam that belongs to another farm", async () => {
    const rivalCow = await seedOtherFarm();
    const res = await registerAnimal(
      null,
      fd({ tag: "KE-1208", sex: "F", origin: "BORN", damId: rivalCow, dateOfBirth: "2026-07-01" }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("That dam was not found.");

    const leaked = await db.select().from(s.animal).where(eq(s.animal.tag, "KE-1208"));
    expect(leaked).toHaveLength(0);
  });

  it("refuses a herdsman — the register is an ADMIN act", async () => {
    H.session = session({ role: "HERDSMAN" });
    const res = await registerAnimal(null, fd({ tag: "KE-1209", sex: "F", origin: "BORN" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/permission/i);
  });

  it("says which fields need attention instead of failing silently", async () => {
    const res = await registerAnimal(null, fd({ sex: "F", origin: "BORN" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.fieldErrors?.tag).toBeTruthy();
    expect(res.error).not.toMatch(/error|stack|undefined/i);
  });
});

/* ================================================================== */
/* recordWeight                                                        */
/* ================================================================== */

describe("recordWeight", () => {
  it("records a weight and hands back the growth rate since last time (R7)", async () => {
    const id = await seedAnimal(db, { tag: "KE-2001", name: "Mumbi", dateOfBirth: "2025-08-03" });
    await recordWeight(null, fd({ animalId: id, observedOn: "2026-06-04", weightKg: 200 }));

    const res = await recordWeight(
      null,
      fd({ animalId: id, observedOn: "2026-08-03", weightKg: 240, method: "HEART_GIRTH" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.sinceDays).toBe(60);
    expect(res.data.gainGramsPerDay).toBe(667);
    expect(res.message).toMatch(/gained 667 g a day/);
  });

  it("says plainly when she is losing weight", async () => {
    const id = await seedAnimal(db, { tag: "KE-2002" });
    await recordWeight(null, fd({ animalId: id, observedOn: "2026-07-04", weightKg: 420 }));
    const res = await recordWeight(null, fd({ animalId: id, observedOn: "2026-08-03", weightKg: 400 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.gainGramsPerDay).toBeLessThan(0);
    expect(res.message).toMatch(/LOST/);
  });

  it("keeps body condition on the five-point scale in quarter steps", async () => {
    const id = await seedAnimal(db, { tag: "KE-2003" });
    const res = await recordWeight(null, fd({ animalId: id, observedOn: "2026-08-03", bcs: 3.3 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.bcs).toBe(3.25);
    expect(res.data.warnings[0]).toMatch(/quarter steps/);

    const [row] = await db.select().from(s.weightObservation).where(eq(s.weightObservation.id, res.data.id));
    expect(row.bcs).toBe("3.25");
  });

  it("refuses a body condition score off the scale, and says what the scale is", async () => {
    const id = await seedAnimal(db, { tag: "KE-2004" });
    const res = await recordWeight(null, fd({ animalId: id, weightKg: 400, bcs: 9 }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.fieldErrors?.bcs?.[0]).toMatch(/1 to 5/);
  });

  it("warns about an implausible weight but SAVES it anyway (R4)", async () => {
    const id = await seedAnimal(db, { tag: "KE-2005", dateOfBirth: "2026-06-01" });
    const res = await recordWeight(null, fd({ animalId: id, observedOn: "2026-08-03", weightKg: 950 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.warnings.length).toBeGreaterThan(0);

    const rows = await db.select().from(s.weightObservation).where(eq(s.weightObservation.animalId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].weightKg).toBe("950.00");
  });

  it("wants at least one of a weight or a score", async () => {
    const id = await seedAnimal(db, { tag: "KE-2006" });
    const res = await recordWeight(null, fd({ animalId: id, observedOn: "2026-08-03" }));
    expect(res.ok).toBe(false);
  });

  it("cannot touch another farm's animal", async () => {
    const rival = await seedOtherFarm();
    const res = await recordWeight(null, fd({ animalId: rival, weightKg: 400 }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("That animal was not found.");

    const rows = await db.select().from(s.weightObservation);
    expect(rows).toHaveLength(0);
  });

  it("is idempotent on an offline replay", async () => {
    const id = await seedAnimal(db, { tag: "KE-2007" });
    const rowId = newId();
    const values = { id: rowId, animalId: id, observedOn: "2026-08-03", weightKg: 415 };
    await recordWeight(null, fd(values));
    await recordWeight(null, fd(values));
    const rows = await db.select().from(s.weightObservation).where(eq(s.weightObservation.animalId, id));
    expect(rows).toHaveLength(1);
  });
});

/* ================================================================== */
/* recordExit                                                          */
/* ================================================================== */

describe("recordExit", () => {
  it("derives what she was on the day she left, and how far into her lactation", async () => {
    const id = await seedAnimal(db, { tag: "KE-3001", name: "Njeri", dateOfBirth: "2021-03-14" });
    await db.insert(s.calving).values([
      { id: newId(), farmId: FARM_ID, damId: id, calvedOn: "2024-02-01", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, damId: id, calvedOn: "2025-03-01", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, damId: id, calvedOn: "2026-04-01", recordedBy: USER },
    ]);

    const res = await recordExit(
      null,
      fd({
        animalId: id,
        exitDate: "2026-08-03",
        reason: "SOLD",
        valueKes: 165000,
        dailyYieldAtSaleL: 16,
        weightKg: 480,
      }),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.classAtExit).toBe("MATURE_COW");
    expect(res.data.daysInMilkAtSale).toBe(124);
    expect(res.message).toMatch(/Njeri sold on 2026-08-03/);
    expect(res.message).toMatch(/165,000/);

    const [row] = await db.select().from(s.animalExit).where(eq(s.animalExit.animalId, id));
    expect(row.classAtExit).toBe("MATURE_COW");
    expect(row.daysInMilkAtSale).toBe(124);
    expect(row.dailyYieldAtSaleL).toBe("16.00");
  });

  it("asks for the price drivers a Kenyan buyer actually pays for", async () => {
    const id = await seedAnimal(db, { tag: "KE-3002", name: "Wanjiru" });
    await db.insert(s.calving).values({
      id: newId(),
      farmId: FARM_ID,
      damId: id,
      calvedOn: "2026-03-01",
      recordedBy: USER,
    });
    await db.insert(s.service).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: id,
      servedOn: "2026-05-01",
      serviceType: "AI",
      expectedCalvingOn: "2027-02-06",
      recordedBy: USER,
    });
    await db.insert(s.pregnancyCheck).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: id,
      checkedOn: "2026-07-01",
      method: "PALPATION",
      result: "POSITIVE",
      recordedBy: USER,
    });

    const res = await recordExit(null, fd({ animalId: id, exitDate: "2026-08-03", reason: "SOLD" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.warnings.join(" ")).toMatch(/in calf/);
    expect(res.data.warnings.join(" ")).toMatch(/giving a day/);
  });

  it("clears everything outstanding on her — she is gone", async () => {
    const reg = await registerAnimal(
      null,
      fd({ tag: "KE-3003", sex: "F", dateOfBirth: "2026-07-01", origin: "BORN" }),
    );
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;

    const before = await db.select().from(s.alert).where(eq(s.alert.animalId, reg.data.id));
    expect(before.length).toBeGreaterThan(0);

    await recordExit(null, fd({ animalId: reg.data.id, exitDate: "2026-08-03", reason: "DIED", cause: "Pneumonia" }));

    const after = await db.select().from(s.alert).where(eq(s.alert.animalId, reg.data.id));
    expect(after.every((a) => a.resolvedAt !== null)).toBe(true);
  });

  it("refuses to let an animal leave the herd twice", async () => {
    const id = await seedAnimal(db, { tag: "KE-3004", name: "Wambui" });
    await recordExit(null, fd({ animalId: id, exitDate: "2026-06-01", reason: "SOLD", valueKes: 90000 }));
    const again = await recordExit(null, fd({ animalId: id, exitDate: "2026-08-03", reason: "SOLD" }));
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error).toMatch(/already left the herd on 2026-06-01/);
  });

  it("cannot touch another farm's animal", async () => {
    const rival = await seedOtherFarm();
    const res = await recordExit(null, fd({ animalId: rival, reason: "SOLD" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("That animal was not found.");
  });
});

/* ================================================================== */
/* listHerd — the most important query in the module                   */
/* ================================================================== */

describe("listHerd", () => {
  const ASOF = "2026-08-03";

  /** A herd covering the whole ladder, built only from events. */
  async function seedLadder() {
    const ids = {
      calf: newId(),
      weaner: newId(),
      heifer: newId(),
      bullingByWeight: newId(),
      bullingByAge: newId(),
      served: newId(),
      incalf: newId(),
      springer: newId(),
      firstCalver: newId(),
      lactatingPregnant: newId(),
      mature: newId(),
      dry: newId(),
      bullCalf: newId(),
      steer: newId(),
      sold: newId(),
    };

    const base = { farmId: FARM_ID, origin: "BORN" as const, primaryBreed: "FRIESIAN" };
    await db.insert(s.animal).values([
      { ...base, id: ids.calf, tag: "C-01", name: "Kidogo", sex: "F", dateOfBirth: "2026-06-20", enteredHerdOn: "2026-06-20" },
      { ...base, id: ids.weaner, tag: "W-01", name: "Sita", sex: "F", dateOfBirth: "2026-02-01", enteredHerdOn: "2026-02-01" },
      { ...base, id: ids.heifer, tag: "H-01", name: "Kumi", sex: "F", dateOfBirth: "2025-08-01", enteredHerdOn: "2025-08-01" },
      { ...base, id: ids.bullingByWeight, tag: "B-01", name: "Nzito", sex: "F", dateOfBirth: "2025-08-01", enteredHerdOn: "2025-08-01" },
      { ...base, id: ids.bullingByAge, tag: "B-02", name: "Mzee", sex: "F", dateOfBirth: "2025-01-01", enteredHerdOn: "2025-01-01" },
      { ...base, id: ids.served, tag: "S-01", name: "Chaguo", sex: "F", dateOfBirth: "2024-12-01", enteredHerdOn: "2024-12-01" },
      { ...base, id: ids.incalf, tag: "I-01", name: "Mimba", sex: "F", dateOfBirth: "2024-09-01", enteredHerdOn: "2024-09-01" },
      { ...base, id: ids.springer, tag: "P-01", name: "Karibu", sex: "F", dateOfBirth: "2024-06-01", enteredHerdOn: "2024-06-01" },
      { ...base, id: ids.firstCalver, tag: "F-01", name: "Kwanza", sex: "F", dateOfBirth: "2023-08-01", enteredHerdOn: "2023-08-01" },
      { ...base, id: ids.lactatingPregnant, tag: "L-01", name: "Pili", sex: "F", dateOfBirth: "2022-05-01", enteredHerdOn: "2022-05-01" },
      { ...base, id: ids.mature, tag: "M-01", name: "Njeri", sex: "F", dateOfBirth: "2020-05-01", enteredHerdOn: "2020-05-01" },
      { ...base, id: ids.dry, tag: "D-01", name: "Pumzika", sex: "F", dateOfBirth: "2020-01-01", enteredHerdOn: "2020-01-01" },
      { ...base, id: ids.bullCalf, tag: "BC-01", name: "Dume", sex: "M", dateOfBirth: "2026-05-01", enteredHerdOn: "2026-05-01" },
      { ...base, id: ids.steer, tag: "ST-01", name: "Maksai", sex: "M", dateOfBirth: "2025-01-01", enteredHerdOn: "2025-01-01", castrated: true },
      { ...base, id: ids.sold, tag: "X-01", name: "Aliyeuzwa", sex: "F", dateOfBirth: "2021-01-01", enteredHerdOn: "2021-01-01" },
    ]);

    // Weight is the better bulling signal, so one heifer gets there on weight
    // months before the age rung would have fired.
    await db.insert(s.weightObservation).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: ids.bullingByWeight,
      observedOn: "2026-07-30",
      weightKg: "292.00",
      method: "HEART_GIRTH",
      recordedBy: USER,
    });

    await db.insert(s.service).values([
      { id: newId(), farmId: FARM_ID, animalId: ids.served, servedOn: "2026-07-20", serviceType: "AI", expectedCalvingOn: "2027-04-27", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, animalId: ids.incalf, servedOn: "2026-05-01", serviceType: "AI", expectedCalvingOn: "2027-02-06", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, animalId: ids.springer, servedOn: "2025-12-15", serviceType: "AI", expectedCalvingOn: "2026-09-22", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, animalId: ids.lactatingPregnant, servedOn: "2026-04-05", serviceType: "AI", expectedCalvingOn: "2027-01-11", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, animalId: ids.dry, servedOn: "2025-12-01", serviceType: "AI", expectedCalvingOn: "2026-09-08", recordedBy: USER },
    ]);

    await db.insert(s.pregnancyCheck).values([
      { id: newId(), farmId: FARM_ID, animalId: ids.incalf, checkedOn: "2026-07-05", method: "PALPATION", result: "POSITIVE", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, animalId: ids.springer, checkedOn: "2026-02-20", method: "PALPATION", result: "POSITIVE", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, animalId: ids.lactatingPregnant, checkedOn: "2026-06-10", method: "PALPATION", result: "POSITIVE", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, animalId: ids.dry, checkedOn: "2026-02-05", method: "PALPATION", result: "POSITIVE", recordedBy: USER },
    ]);

    await db.insert(s.calving).values([
      { id: newId(), farmId: FARM_ID, damId: ids.firstCalver, calvedOn: "2026-05-20", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, damId: ids.lactatingPregnant, calvedOn: "2024-11-01", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, damId: ids.lactatingPregnant, calvedOn: "2026-01-10", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, damId: ids.mature, calvedOn: "2023-02-01", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, damId: ids.mature, calvedOn: "2024-04-01", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, damId: ids.mature, calvedOn: "2025-06-01", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, damId: ids.dry, calvedOn: "2025-08-01", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, damId: ids.dry, calvedOn: "2023-06-01", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, damId: ids.dry, calvedOn: "2024-07-01", recordedBy: USER },
    ]);

    await db.insert(s.dryOff).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: ids.dry,
      driedOn: "2026-07-10",
      method: "ABRUPT",
      recordedBy: USER,
    });

    await db.insert(s.animalExit).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: ids.sold,
      exitDate: "2026-07-01",
      reason: "SOLD",
      valueKes: "150000.00",
      recordedBy: USER,
    });

    return ids;
  }

  it("derives the whole ladder from events, with no class column anywhere", async () => {
    const ids = await seedLadder();
    const list = await listHerd(session(), { asOf: ASOF });
    const by = new Map(list.rows.map((r) => [r.id, r]));

    expect(by.get(ids.calf)!.cls).toBe("CALF");
    expect(by.get(ids.weaner)!.cls).toBe("WEANER");
    expect(by.get(ids.heifer)!.cls).toBe("HEIFER");
    expect(by.get(ids.bullingByWeight)!.cls).toBe("BULLING_HEIFER");
    expect(by.get(ids.bullingByAge)!.cls).toBe("BULLING_HEIFER");
    expect(by.get(ids.served)!.cls).toBe("SERVED_HEIFER");
    expect(by.get(ids.incalf)!.cls).toBe("INCALF_HEIFER");
    expect(by.get(ids.springer)!.cls).toBe("SPRINGER");
    expect(by.get(ids.firstCalver)!.cls).toBe("FIRST_CALVER");
    expect(by.get(ids.lactatingPregnant)!.cls).toBe("LACTATING_COW");
    expect(by.get(ids.mature)!.cls).toBe("MATURE_COW");
    expect(by.get(ids.dry)!.cls).toBe("DRY_COW");
    expect(by.get(ids.bullCalf)!.cls).toBe("BULL_CALF");
    expect(by.get(ids.steer)!.cls).toBe("STEER");
  });

  it("reports reproductive status alongside class, not folded into it", async () => {
    const ids = await seedLadder();
    const list = await listHerd(session(), { asOf: ASOF });
    const by = new Map(list.rows.map((r) => [r.id, r]));

    // The normal case for a working dairy cow: milking and pregnant at once.
    const pili = by.get(ids.lactatingPregnant)!;
    expect(pili.cls).toBe("LACTATING_COW");
    expect(pili.reproStatus).toBe("PREGNANT");
    expect(pili.milking).toBe(true);
    expect(pili.expectedCalvingOn).toBe("2027-01-11");

    expect(by.get(ids.served)!.reproStatus).toBe("SERVED");
    expect(by.get(ids.dry)!.reproStatus).toBe("DRY");
    // 75 days calved and unserved: past the fresh window, so she is OPEN and
    // belongs on the breeding board. FRESH must not linger.
    expect(by.get(ids.firstCalver)!.reproStatus).toBe("OPEN");
    expect(by.get(ids.firstCalver)!.daysInMilk).toBe(75);
    expect(by.get(ids.mature)!.reproStatus).toBe("OPEN");
    expect(by.get(ids.heifer)!.reproStatus).toBe("OPEN");

    // A cow inside her first sixty days is FRESH.
    const fresh = await listHerd(session(), { asOf: "2026-06-20" });
    expect(fresh.rows.find((r) => r.id === ids.firstCalver)!.reproStatus).toBe("FRESH");
  });

  it("counts days in milk from the last calving, and stops counting once she is dry", async () => {
    const ids = await seedLadder();
    const list = await listHerd(session(), { asOf: ASOF });
    const by = new Map(list.rows.map((r) => [r.id, r]));

    expect(by.get(ids.firstCalver)!.daysInMilk).toBe(75); // 2026-05-20 → 2026-08-03
    expect(by.get(ids.lactatingPregnant)!.daysInMilk).toBe(205);
    expect(by.get(ids.dry)!.daysInMilk).toBeNull();
    expect(by.get(ids.heifer)!.daysInMilk).toBeNull();
  });

  it("counts parity from calvings, ignoring abortions", async () => {
    const ids = await seedLadder();

    // Give the mature cow an abortion between her calvings; parity must not move.
    const abortionId = newId();
    await db.insert(s.calving).values({
      id: abortionId,
      farmId: FARM_ID,
      damId: ids.mature,
      calvedOn: "2026-02-01",
      recordedBy: USER,
    });
    await db.insert(s.calvingOutcome).values({
      id: newId(),
      farmId: FARM_ID,
      calvingId: abortionId,
      outcome: "ABORTION",
    });

    const list = await listHerd(session(), { asOf: ASOF });
    const njeri = list.rows.find((r) => r.id === ids.mature)!;
    expect(njeri.parity).toBe(3);
    expect(njeri.lastCalvingOn).toBe("2025-06-01");
  });

  it("carries the latest weight and body condition through to the list", async () => {
    const ids = await seedLadder();
    await db.insert(s.weightObservation).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: ids.mature,
      observedOn: "2026-07-15",
      weightKg: "512.50",
      bcs: "2.75",
      recordedBy: USER,
    });
    const list = await listHerd(session(), { asOf: ASOF });
    const njeri = list.rows.find((r) => r.id === ids.mature)!;
    expect(njeri.latestWeightKg).toBe(512.5);
    expect(njeri.latestBcs).toBe(2.75);
    expect(njeri.latestWeightOn).toBe("2026-07-15");
  });

  it("leaves animals that have left the herd out, unless asked for", async () => {
    const ids = await seedLadder();
    const list = await listHerd(session(), { asOf: ASOF });
    expect(list.rows.some((r) => r.id === ids.sold)).toBe(false);
    expect(list.total).toBe(14);

    const withExits = await listHerd(session(), { asOf: ASOF, includeExited: true });
    const gone = withExits.rows.find((r) => r.id === ids.sold)!;
    expect(gone.exited).toBe(true);
    expect(gone.exitReason).toBe("SOLD");
  });

  it("filters on the DERIVED class, and counts the whole herd regardless of the filter", async () => {
    await seedLadder();
    const list = await listHerd(session(), { asOf: ASOF, cls: "BULLING_HEIFER" });
    expect(list.rows).toHaveLength(2);
    expect(list.rows.every((r) => r.cls === "BULLING_HEIFER")).toBe(true);
    // The counts describe the herd, so the filter chips can show numbers.
    expect(list.countsByClass.MATURE_COW).toBe(1);
    expect(list.countsByClass.CALF).toBe(1);
    expect(list.total).toBe(14);
  });

  it("searches by name or by tag, case-insensitively", async () => {
    await seedLadder();
    expect((await listHerd(session(), { asOf: ASOF, search: "njeri" })).rows).toHaveLength(1);
    expect((await listHerd(session(), { asOf: ASOF, search: "NJERI" })).rows).toHaveLength(1);
    expect((await listHerd(session(), { asOf: ASOF, search: "M-01" })).rows).toHaveLength(1);
    expect((await listHerd(session(), { asOf: ASOF, search: "b-0" })).rows).toHaveLength(2);
    expect((await listHerd(session(), { asOf: ASOF, search: "hakuna" })).rows).toHaveLength(0);
  });

  it("answers as of a past date, using only what was known then", async () => {
    const ids = await seedLadder();

    // Before her pregnancy check, the in-calf heifer was only a served heifer.
    const before = await listHerd(session(), { asOf: "2026-06-01" });
    expect(before.rows.find((r) => r.id === ids.incalf)!.cls).toBe("SERVED_HEIFER");

    // And before the dry-off, the dry cow was still milking.
    const stillMilking = await listHerd(session(), { asOf: "2026-07-01" });
    expect(stillMilking.rows.find((r) => r.id === ids.dry)!.cls).toBe("MATURE_COW");

    // The sold cow was still in the herd in June.
    expect(before.rows.some((r) => r.id === ids.sold)).toBe(true);
  });

  it("counts the milking herd, which is what the milk sheet is built from", async () => {
    await seedLadder();
    const list = await listHerd(session(), { asOf: ASOF });
    expect(list.milkingCount).toBe(3); // first calver, lactating+pregnant, mature
  });

  it("shows another farm nothing at all", async () => {
    await seedLadder();
    await seedOtherFarm();

    const ours = await listHerd(session(), { asOf: ASOF });
    expect(ours.rows.some((r) => r.tag === "RIVAL-01")).toBe(false);

    const theirs = await listHerd(session({ farmId: OTHER_FARM }), { asOf: ASOF });
    expect(theirs.rows).toHaveLength(1);
    expect(theirs.rows[0].tag).toBe("RIVAL-01");
  });
});

/* ================================================================== */
/* getAnimal — the digital cow card                                    */
/* ================================================================== */

describe("getAnimal", () => {
  it("assembles the cow card: class, history, lactations, offspring and weights", async () => {
    const dam = await seedAnimal(db, { tag: "KE-4001", name: "Njeri", dateOfBirth: "2021-03-14" });

    const c1 = newId();
    const c2 = newId();
    await db.insert(s.calving).values([
      { id: c1, farmId: FARM_ID, damId: dam, calvedOn: "2024-06-01", calvingEase: 1, recordedBy: USER },
      { id: c2, farmId: FARM_ID, damId: dam, calvedOn: "2025-09-01", calvingEase: 2, recordedBy: USER },
    ]);
    await db.insert(s.service).values([
      { id: newId(), farmId: FARM_ID, animalId: dam, servedOn: "2024-09-10", serviceType: "AI", strawCode: "KG-4471", expectedCalvingOn: "2025-06-18", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, animalId: dam, servedOn: "2024-11-22", serviceType: "AI", strawCode: "KG-4472", expectedCalvingOn: "2025-08-30", recordedBy: USER },
    ]);
    await db.insert(s.dryOff).values({
      id: newId(), farmId: FARM_ID, animalId: dam, driedOn: "2025-07-01", method: "ABRUPT", recordedBy: USER,
    });
    await db.insert(s.weightObservation).values({
      id: newId(), farmId: FARM_ID, animalId: dam, observedOn: "2026-07-01", weightKg: "498.00", bcs: "3.00", recordedBy: USER,
    });
    await db.insert(s.animal).values({
      id: newId(), farmId: FARM_ID, tag: "KE-4001/2406", name: "Binti", sex: "F",
      dateOfBirth: "2024-06-01", damId: dam, origin: "BORN", enteredHerdOn: "2024-06-01",
    });
    await db.insert(s.milkRecord).values([
      { id: newId(), farmId: FARM_ID, animalId: dam, recordedOn: "2025-09-10", session: "MORNING", litres: "10.00", recordedBy: USER, recordedAt: new Date() },
      { id: newId(), farmId: FARM_ID, animalId: dam, recordedOn: "2025-09-10", session: "EVENING", litres: "8.50", recordedBy: USER, recordedAt: new Date() },
      { id: newId(), farmId: FARM_ID, animalId: dam, recordedOn: "2025-09-11", session: "MORNING", litres: "11.00", recordedBy: USER, recordedAt: new Date() },
    ]);

    const card = await getAnimal(session(), dam, { asOf: "2026-08-03" });
    expect(card).not.toBeNull();
    if (!card) return;

    expect(card.animal.name).toBe("Njeri");
    expect(card.cls).toBe("LACTATING_COW");
    expect(card.classLabel).toBe("Milking cow");
    expect(card.facts.parity).toBe(2);
    expect(card.services).toHaveLength(2);
    // The gap between the two services is the raw material for the verdict.
    expect(card.services[1].returnInterpretationDays).toBe(73);
    expect(card.offspring).toHaveLength(1);
    expect(card.offspring[0].name).toBe("Binti");
    expect(card.weights).toHaveLength(1);

    expect(card.lactations).toHaveLength(2);
    const [l1, l2] = card.lactations;
    expect(l1.number).toBe(1);
    expect(l1.calvedOn).toBe("2024-06-01");
    expect(l1.endedOn).toBe("2025-07-01"); // dried off
    expect(l1.lengthDays).toBe(395);
    expect(l1.daysOpen).toBe(174); // calving 2024-06-01 → conceiving service 2024-11-22
    expect(l1.servicesToConceive).toBe(2);

    expect(l2.number).toBe(2);
    expect(l2.ongoing).toBe(true);
    expect(l2.calvingIntervalDays).toBe(457);
    expect(l2.totalLitres).toBe(29.5);
    expect(l2.peakDailyLitres).toBe(18.5);
    expect(l2.recordedDays).toBe(2);
  });

  it("shows a calf her remaining first-year schedule", async () => {
    const reg = await registerAnimal(
      null,
      fd({ tag: "KE-4002", sex: "F", dateOfBirth: "2026-07-20", origin: "BORN" }),
    );
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;

    const card = await getAnimal(session(), reg.data.id, { asOf: "2026-08-03" });
    expect(card!.schedule.length).toBeGreaterThan(0);
    expect(card!.openAlerts.length).toBe(card!.schedule.length);
  });

  it("returns null for another farm's animal — identical to one that does not exist", async () => {
    const rival = await seedOtherFarm();
    expect(await getAnimal(session(), rival)).toBeNull();
    expect(await getAnimal(session(), newId())).toBeNull();
  });
});

/* ================================================================== */
/* herdInventoryReconciliation                                         */
/* ================================================================== */

describe("herdInventoryReconciliation", () => {
  it("balances opening + births + purchases − deaths − sales to closing", async () => {
    // Four animals present before the year starts.
    for (let i = 1; i <= 4; i++) {
      await seedAnimal(db, { tag: `OP-0${i}`, enteredHerdOn: "2025-06-01", origin: "BORN" });
    }
    // Two born and one bought inside the year.
    const bornA = await seedAnimal(db, { tag: "NB-01", enteredHerdOn: "2026-02-14", origin: "BORN" });
    await seedAnimal(db, { tag: "NB-02", enteredHerdOn: "2026-05-02", origin: "BORN" });
    const bought = await seedAnimal(db, { tag: "PU-01", enteredHerdOn: "2026-03-20", origin: "PURCHASED" });
    // One gift, so the "other" bucket is exercised rather than silently lost.
    await seedAnimal(db, { tag: "GF-01", enteredHerdOn: "2026-04-01", origin: "GIFT" });

    await db.insert(s.animalExit).values([
      { id: newId(), farmId: FARM_ID, animalId: bornA, exitDate: "2026-04-01", reason: "DIED", cause: "Scours", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, animalId: bought, exitDate: "2026-06-15", reason: "SOLD", valueKes: "120000.00", recordedBy: USER },
    ]);

    const r = await herdInventoryReconciliation(session(), "2026-01-01", "2026-12-31");

    expect(r.opening).toBe(4);
    expect(r.births).toBe(2);
    expect(r.purchases).toBe(1);
    expect(r.otherIn).toBe(1);
    expect(r.deaths).toBe(1);
    expect(r.sales).toBe(1);
    expect(r.closing).toBe(6);
    expect(r.computedClosing).toBe(6);
    expect(r.balances).toBe(true);
    expect(r.difference).toBe(0);
    expect(r.byExitReason).toEqual({ DIED: 1, SOLD: 1 });
    expect(r.narrative).toMatch(/It balances\./);
  });

  it("counts a cull as a sale and leaves theft in its own bucket", async () => {
    const a = await seedAnimal(db, { tag: "CU-01", enteredHerdOn: "2024-01-01" });
    const b = await seedAnimal(db, { tag: "TH-01", enteredHerdOn: "2024-01-01" });
    await db.insert(s.animalExit).values([
      { id: newId(), farmId: FARM_ID, animalId: a, exitDate: "2026-03-01", reason: "CULLED", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, animalId: b, exitDate: "2026-03-02", reason: "STOLEN", recordedBy: USER },
    ]);

    const r = await herdInventoryReconciliation(session(), "2026-01-01", "2026-12-31");
    expect(r.sales).toBe(1);
    expect(r.otherOut).toBe(1);
    expect(r.opening).toBe(2);
    expect(r.closing).toBe(0);
    expect(r.balances).toBe(true);
  });

  it("keeps an animal in the opening count on the day she leaves", async () => {
    const a = await seedAnimal(db, { tag: "ED-01", enteredHerdOn: "2024-01-01" });
    await db.insert(s.animalExit).values({
      id: newId(), farmId: FARM_ID, animalId: a, exitDate: "2026-01-01", reason: "SOLD", recordedBy: USER,
    });
    const r = await herdInventoryReconciliation(session(), "2026-01-01", "2026-01-31");
    expect(r.opening).toBe(1);
    expect(r.sales).toBe(1);
    expect(r.closing).toBe(0);
    expect(r.balances).toBe(true);
  });

  it("counts only this farm", async () => {
    await seedAnimal(db, { tag: "OURS-01", enteredHerdOn: "2024-01-01" });
    await seedOtherFarm();
    const r = await herdInventoryReconciliation(session(), "2026-01-01", "2026-12-31");
    expect(r.opening).toBe(1);
    expect(r.closing).toBe(1);
  });
});

/* ================================================================== */
/* factsFor — the assembly everything else rests on                    */
/* ================================================================== */

describe("factsFor", () => {
  it("ignores events after the as-of date entirely", async () => {
    const id = await seedAnimal(db, { tag: "KE-5001", dateOfBirth: "2023-01-01" });
    await db.insert(s.calving).values({ id: newId(), farmId: FARM_ID, damId: id, calvedOn: "2026-06-01", recordedBy: USER });
    await db.insert(s.service).values({ id: newId(), farmId: FARM_ID, animalId: id, servedOn: "2026-07-25", serviceType: "AI", expectedCalvingOn: "2027-05-03", recordedBy: USER });

    const { animals, events } = await loadHerdSources(session(), { animalIds: [id] });
    const animal = animals[0];

    const after = factsFor(animal, events.get(id)!, "2026-08-03");
    expect(after.parity).toBe(1);
    expect(after.lastServiceOn).toBe("2026-07-25");

    const before = factsFor(animal, events.get(id)!, "2026-05-01");
    expect(before.parity).toBe(0);
    expect(before.lastServiceOn).toBeNull();
  });

  it("takes the expected calving date from the service the positive check pointed at", async () => {
    const id = await seedAnimal(db, { tag: "KE-5002", dateOfBirth: "2023-01-01" });
    const firstService = newId();
    const secondService = newId();
    await db.insert(s.service).values([
      { id: firstService, farmId: FARM_ID, animalId: id, servedOn: "2026-03-01", serviceType: "AI", expectedCalvingOn: "2026-12-07", recordedBy: USER },
      { id: secondService, farmId: FARM_ID, animalId: id, servedOn: "2026-04-05", serviceType: "AI", expectedCalvingOn: "2027-01-11", recordedBy: USER },
    ]);
    await db.insert(s.pregnancyCheck).values({
      id: newId(), farmId: FARM_ID, animalId: id, serviceId: secondService,
      checkedOn: "2026-06-10", method: "PALPATION", result: "POSITIVE", recordedBy: USER,
    });

    const { animals, events } = await loadHerdSources(session(), { animalIds: [id] });
    const f = factsFor(animals[0], events.get(id)!, "2026-08-03");
    expect(f.expectedCalvingOn).toBe("2027-01-11");
  });

  it("falls back to the breed calendar when a service was stored without one", async () => {
    const id = await seedAnimal(db, { tag: "KE-5003", primaryBreed: "SAHIWAL", dateOfBirth: "2023-01-01" });
    await db.insert(s.service).values({
      id: newId(), farmId: FARM_ID, animalId: id, servedOn: "2026-05-01", serviceType: "NATURAL", recordedBy: USER,
    });
    const { animals, events } = await loadHerdSources(session(), { animalIds: [id] });
    const f = factsFor(animals[0], events.get(id)!, "2026-08-03");
    expect(f.expectedCalvingOn).toBe("2027-02-13"); // 288-day Sahiwal gestation
  });
});
