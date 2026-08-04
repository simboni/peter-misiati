import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import * as s from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/test-db";
import { seedFarm, seedAnimal, FARM_ID, fakeSession } from "@/test/factory";
import { newId } from "@/lib/ids";
import { addDays } from "@/lib/domain/dates";

/* ------------------------------------------------------------------ */
/* Harness — see the note in herd.test.ts                              */
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
  // The DAL rolls the idle stamp forward on every verified request. Vitest
  // throws on ACCESS of an export a mock does not define, so leaving these out
  // fails the request rather than the assertion, from inside `guard`.
  touchSession: async () => {},
  destroySession: async () => {},
}));

const {
  recordHeat,
  recordService,
  recordPregnancyCheck,
  recordCalving,
  recordDryOff,
  breedingWatchboard,
  interpretReturnToHeat,
  breedingSummary,
  ALERT_KIND,
} = await import("./breeding");
const { listHerd, getAnimal } = await import("./herd");

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

async function seedOtherFarmAnimal() {
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

/** A cow who calved on 1 Feb 2026 and is well past her waiting period. */
async function seedCow(over: Partial<typeof s.animal.$inferInsert> = {}) {
  const id = await seedAnimal(db, {
    tag: "KE-7001",
    name: "Njeri",
    dateOfBirth: "2021-03-14",
    primaryBreed: "FRIESIAN",
    ...over,
  });
  await db.insert(s.calving).values({
    id: newId(),
    farmId: FARM_ID,
    damId: id,
    calvedOn: "2026-02-01",
    recordedBy: USER,
  });
  return id;
}

/* ================================================================== */
/* recordHeat                                                          */
/* ================================================================== */

describe("recordHeat", () => {
  it("applies the AM/PM rule for the user instead of explaining it", async () => {
    const id = await seedCow();

    const morning = await recordHeat(
      null,
      fd({ animalId: id, observedAt: "2026-08-03T06:30", sign: "STANDING" }),
    );
    expect(morning.ok).toBe(true);
    if (!morning.ok) return;
    expect(morning.data.serveOn).toBe("2026-08-03");
    expect(morning.data.advice).toMatch(/this evening/);
    expect(morning.message).toMatch(/Njeri on heat/);

    const evening = await recordHeat(null, fd({ animalId: id, observedAt: "2026-08-03T17:45" }));
    expect(evening.ok).toBe(true);
    if (!evening.ok) return;
    expect(evening.data.serveOn).toBe("2026-08-04");
    expect(evening.data.advice).toMatch(/tomorrow morning/);
  });

  it("raises one alert, for the right person, on the right day", async () => {
    const id = await seedCow();
    await recordHeat(null, fd({ animalId: id, observedAt: "2026-08-03T06:30" }));

    const alerts = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.farmId, FARM_ID), eq(s.alert.kind, ALERT_KIND.SERVE_AFTER_HEAT)));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].dueOn).toBe("2026-08-03");
    expect(alerts[0].action).toMatch(/inseminate this evening/);
  });

  it("warns but still saves a heat on a cow recorded in calf (R4)", async () => {
    const id = await seedCow();
    await db.insert(s.service).values({
      id: newId(), farmId: FARM_ID, animalId: id, servedOn: "2026-04-01", serviceType: "AI",
      expectedCalvingOn: "2027-01-07", recordedBy: USER,
    });
    await db.insert(s.pregnancyCheck).values({
      id: newId(), farmId: FARM_ID, animalId: id, checkedOn: "2026-06-01",
      method: "PALPATION", result: "POSITIVE", recordedBy: USER,
    });

    const res = await recordHeat(null, fd({ animalId: id, observedAt: "2026-08-03T07:00" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.warning).toMatch(/lost it/);

    const rows = await db.select().from(s.heatObservation).where(eq(s.heatObservation.animalId, id));
    expect(rows).toHaveLength(1);
  });

  it("reads a heat on a served cow as a return, and interprets the gap", async () => {
    const id = await seedCow();
    await db.insert(s.service).values({
      id: newId(), farmId: FARM_ID, animalId: id, servedOn: "2026-06-22", serviceType: "AI",
      expectedReturnOn: "2026-07-13", expectedCalvingOn: "2027-03-30", recordedBy: USER,
    });

    const res = await recordHeat(null, fd({ animalId: id, observedAt: "2026-08-03T07:00" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // 42 days: the verdict that matters most.
    expect(res.data.warning).toMatch(/detection problem, not a fertility one/i);
  });

  it("is idempotent on an offline replay", async () => {
    const id = await seedCow();
    const rowId = newId();
    const values = { id: rowId, animalId: id, observedAt: "2026-08-03T06:30", sign: "MUCUS" };
    await recordHeat(null, fd(values));
    await recordHeat(null, fd(values));
    const rows = await db.select().from(s.heatObservation).where(eq(s.heatObservation.animalId, id));
    expect(rows).toHaveLength(1);
  });

  it("cannot record a heat on another farm's cow", async () => {
    const rival = await seedOtherFarmAnimal();
    const res = await recordHeat(null, fd({ animalId: rival, observedAt: "2026-08-03T06:30" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("That animal was not found.");
    expect(await db.select().from(s.heatObservation)).toHaveLength(0);
  });
});

/* ================================================================== */
/* recordService — the flow that sells the system                      */
/* ================================================================== */

describe("recordService", () => {
  it("returns the whole calendar at the moment of entry (R7)", async () => {
    const id = await seedCow();
    const res = await recordService(
      null,
      fd({
        animalId: id,
        servedOn: "2026-08-03",
        serviceType: "AI",
        strawCode: "KG-4471",
        semenType: "SEXED",
        costKes: 3500,
      }),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const c = res.data.calendar;
    expect(c.expectedReturnOn).toBe("2026-08-24");
    expect(c.pdDueOn).toBe("2026-10-02");
    expect(c.expectedCalvingOn).toBe("2027-05-11"); // Friesian, 281 days
    expect(c.dryOffDueOn).toBe("2027-03-12");
    expect(c.gestationDays).toBe(281);
    expect(res.data.serviceNumber).toBe(1);
    expect(res.data.calendarLines).toHaveLength(4);
    expect(res.data.calendarLines[0]).toMatch(/2026-08-24/);
    expect(res.refCode).toMatch(/^BR[A-Z2-9]{5}$/);
  });

  it("persists the calendar on the service row, so it stays stable", async () => {
    const id = await seedCow();
    const res = await recordService(null, fd({ animalId: id, servedOn: "2026-08-03", serviceType: "AI" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [row] = await db.select().from(s.service).where(eq(s.service.id, res.data.id));
    expect(row.expectedReturnOn).toBe("2026-08-24");
    expect(row.pdDueOn).toBe("2026-10-02");
    expect(row.expectedCalvingOn).toBe("2027-05-11");
    expect(row.serviceNumber).toBe(1);
  });

  it("uses the breed's own gestation length", async () => {
    const sahiwal = await seedCow({ tag: "KE-7002", name: "Sahiwal", primaryBreed: "SAHIWAL" });
    const res = await recordService(null, fd({ animalId: sahiwal, servedOn: "2026-08-03" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.calendar.gestationDays).toBe(288);
    expect(res.data.calendar.expectedCalvingOn).toBe("2027-05-18");
  });

  it("raises the four alerts the calendar promises", async () => {
    const id = await seedCow();
    await recordService(null, fd({ animalId: id, servedOn: "2026-08-03" }));

    const alerts = await db.select().from(s.alert).where(eq(s.alert.animalId, id));
    const kinds = alerts.map((a) => a.kind).sort();
    expect(kinds).toEqual(
      [ALERT_KIND.CALVING_DUE, ALERT_KIND.DRY_OFF_DUE, ALERT_KIND.PD_DUE, ALERT_KIND.RETURN_TO_HEAT].sort(),
    );
    expect(alerts.find((a) => a.kind === ALERT_KIND.PD_DUE)!.dueOn).toBe("2026-10-02");
  });

  it("numbers repeat services and interprets the gap", async () => {
    const id = await seedCow();
    await recordService(null, fd({ animalId: id, servedOn: "2026-05-01" }));
    const repeat = await recordService(null, fd({ animalId: id, servedOn: "2026-05-22" }));

    expect(repeat.ok).toBe(true);
    if (!repeat.ok) return;
    expect(repeat.data.serviceNumber).toBe(2);
    expect(repeat.data.returnInterpretation).not.toBeNull();
    expect(repeat.data.returnInterpretation!.verdict).toBe("NORMAL_RETURN");
    expect(repeat.data.returnInterpretation!.intervalDays).toBe(21);
    expect(repeat.data.returnInterpretation!.previousServedOn).toBe("2026-05-01");
  });

  it("names a missed heat when a repeat service falls a whole cycle late", async () => {
    const id = await seedCow();
    await recordService(null, fd({ animalId: id, servedOn: "2026-05-01" }));
    const repeat = await recordService(null, fd({ animalId: id, servedOn: "2026-06-12" })); // 42 days

    expect(repeat.ok).toBe(true);
    if (!repeat.ok) return;
    expect(repeat.data.returnInterpretation!.verdict).toBe("MISSED_HEAT");
    expect(repeat.data.returnInterpretation!.message).toMatch(/detection problem/i);
  });

  it("resets the service number after a calving", async () => {
    const id = await seedCow();
    await recordService(null, fd({ animalId: id, servedOn: "2025-06-01" }));
    await recordService(null, fd({ animalId: id, servedOn: "2025-06-22" }));
    // seedCow already recorded a calving on 2026-02-01.
    const fresh = await recordService(null, fd({ animalId: id, servedOn: "2026-04-01" }));
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.data.serviceNumber).toBe(1);
    expect(fresh.data.returnInterpretation).toBeNull();
  });

  it("warns about serving inside the voluntary waiting period but saves anyway (R4)", async () => {
    const id = await seedCow();
    const res = await recordService(null, fd({ animalId: id, servedOn: "2026-02-20" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.warnings.join(" ")).toMatch(/19 days from calving/);
    expect(await db.select().from(s.service).where(eq(s.service.animalId, id))).toHaveLength(1);
  });

  it("moves her class to SERVED_HEIFER on the herd list straight away", async () => {
    const heifer = await seedAnimal(db, { tag: "KE-7003", name: "Mtamba", dateOfBirth: "2024-11-01" });
    await recordService(null, fd({ animalId: heifer, servedOn: "2026-08-01" }));
    const list = await listHerd(session(), { asOf: "2026-08-03" });
    expect(list.rows.find((r) => r.id === heifer)!.cls).toBe("SERVED_HEIFER");
  });

  it("is idempotent on an offline replay", async () => {
    const id = await seedCow();
    const rowId = newId();
    const values = { id: rowId, animalId: id, servedOn: "2026-08-03", strawCode: "KG-4471" };
    await recordService(null, fd(values));
    await recordService(null, fd(values));
    expect(await db.select().from(s.service).where(eq(s.service.animalId, id))).toHaveLength(1);
  });

  it("refuses a herdsman — a service is a breeding decision", async () => {
    const id = await seedCow();
    H.session = session({ role: "HERDSMAN" });
    const res = await recordService(null, fd({ animalId: id, servedOn: "2026-08-03" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/does not include this/i);
    expect(await db.select().from(s.service)).toHaveLength(0);
  });

  it("cannot serve another farm's cow, or use another farm's bull", async () => {
    const rival = await seedOtherFarmAnimal();
    const bad = await recordService(null, fd({ animalId: rival, servedOn: "2026-08-03" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe("That animal was not found.");

    const ours = await seedCow();
    const badBull = await recordService(
      null,
      fd({ animalId: ours, servedOn: "2026-08-03", serviceType: "NATURAL", bullId: rival }),
    );
    expect(badBull.ok).toBe(false);
    if (!badBull.ok) expect(badBull.error).toBe("That bull was not found.");
    expect(await db.select().from(s.service)).toHaveLength(0);
  });
});

/* ================================================================== */
/* interpretReturnToHeat                                               */
/* ================================================================== */

describe("interpretReturnToHeat", () => {
  it("surfaces the ~42-day missed heat as something the manager can fix", async () => {
    const id = await seedCow();
    await recordService(null, fd({ animalId: id, servedOn: "2026-06-22" }));

    const verdict = await interpretReturnToHeat(session(), id, "2026-08-03");
    expect(verdict).not.toBeNull();
    expect(verdict!.verdict).toBe("MISSED_HEAT");
    expect(verdict!.intervalDays).toBe(42);
    expect(verdict!.isDetectionFailure).toBe(true);
    expect(verdict!.advice).toMatch(/heat watch twice a day/i);
    expect(verdict!.animalName).toBe("Njeri");
  });

  it("gives no verdict when there is nothing to return from", async () => {
    const id = await seedCow();
    expect(await interpretReturnToHeat(session(), id, "2026-08-03")).toBeNull();
  });

  it("gives practical advice for each verdict, never a code", async () => {
    const id = await seedCow();
    await recordService(null, fd({ animalId: id, servedOn: "2026-07-25" }));
    const early = await interpretReturnToHeat(session(), id, "2026-08-03");
    expect(early!.verdict).toBe("EARLY_LOSS_OR_MISTIMED");
    expect(early!.advice).toMatch(/AM\/PM rule/);
    expect(early!.isDetectionFailure).toBe(false);
  });

  it("refuses to look at another farm's cow", async () => {
    const rival = await seedOtherFarmAnimal();
    await expect(interpretReturnToHeat(session(), rival, "2026-08-03")).rejects.toThrow(
      "That animal was not found.",
    );
  });
});

/* ================================================================== */
/* recordPregnancyCheck                                                */
/* ================================================================== */

describe("recordPregnancyCheck", () => {
  async function servedCow() {
    const id = await seedCow();
    const svc = await recordService(null, fd({ animalId: id, servedOn: "2026-04-05" }));
    if (!svc.ok) throw new Error("setup failed");
    return { id, serviceId: svc.data.id, calendar: svc.data.calendar };
  }

  it("confirms the pregnancy and hands back the dates that follow from it", async () => {
    const { id, calendar } = await servedCow();
    const res = await recordPregnancyCheck(
      null,
      fd({ animalId: id, checkedOn: "2026-06-08", method: "PALPATION", result: "POSITIVE", monthsPregnant: 2 }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.expectedCalvingOn).toBe(calendar.expectedCalvingOn);
    expect(res.data.dryOffDueOn).toBe(calendar.dryOffDueOn);
    expect(res.data.nextAction).toMatch(/in calf/);
  });

  it("attaches itself to the open service without being told which one", async () => {
    const { id, serviceId } = await servedCow();
    const res = await recordPregnancyCheck(
      null,
      fd({ animalId: id, checkedOn: "2026-06-08", result: "POSITIVE" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await db.select().from(s.pregnancyCheck).where(eq(s.pregnancyCheck.id, res.data.id));
    expect(row.serviceId).toBe(serviceId);
  });

  it("closes the return-to-heat and pregnancy-check alerts on a positive, and keeps the calving ones", async () => {
    const { id } = await servedCow();
    await recordPregnancyCheck(null, fd({ animalId: id, checkedOn: "2026-06-08", result: "POSITIVE" }));

    const alerts = await db.select().from(s.alert).where(eq(s.alert.animalId, id));
    const open = alerts.filter((a) => a.resolvedAt === null).map((a) => a.kind);
    expect(open).toContain(ALERT_KIND.DRY_OFF_DUE);
    expect(open).toContain(ALERT_KIND.CALVING_DUE);
    expect(open).not.toContain(ALERT_KIND.PD_DUE);
    expect(open).not.toContain(ALERT_KIND.RETURN_TO_HEAT);
  });

  it("tears down the whole downstream calendar on a negative, and asks for her to be served", async () => {
    const { id } = await servedCow();
    const res = await recordPregnancyCheck(
      null,
      fd({ animalId: id, checkedOn: "2026-06-08", result: "NEGATIVE" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.expectedCalvingOn).toBeNull();
    expect(res.data.nextAction).toMatch(/not in calf/);

    const alerts = await db.select().from(s.alert).where(eq(s.alert.animalId, id));
    const open = alerts.filter((a) => a.resolvedAt === null);
    expect(open.map((a) => a.kind)).toEqual([ALERT_KIND.SERVE_NOW]);

    // And her class drops straight back down the ladder.
    const list = await listHerd(session(), { asOf: "2026-06-09" });
    expect(list.rows.find((r) => r.id === id)!.reproStatus).toBe("OPEN");
  });

  it("books a recheck when the diagnosis is not clear", async () => {
    const { id } = await servedCow();
    const res = await recordPregnancyCheck(
      null,
      fd({ animalId: id, checkedOn: "2026-06-08", result: "INCONCLUSIVE" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.recheckOn).toBe("2026-06-29");

    const alerts = await db.select().from(s.alert).where(eq(s.alert.animalId, id));
    const recheck = alerts.find((a) => a.kind === ALERT_KIND.PD_RECHECK)!;
    expect(recheck.dueOn).toBe("2026-06-29");
  });

  it("refuses a herdsman — diagnosis is clinical work", async () => {
    const { id } = await servedCow();
    H.session = session({ role: "HERDSMAN" });
    const res = await recordPregnancyCheck(null, fd({ animalId: id, result: "POSITIVE" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/does not include this/i);
  });

  it("cannot check another farm's cow", async () => {
    const rival = await seedOtherFarmAnimal();
    const res = await recordPregnancyCheck(null, fd({ animalId: rival, result: "POSITIVE" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("That animal was not found.");
  });

  it("is idempotent on an offline replay", async () => {
    const { id } = await servedCow();
    const rowId = newId();
    const values = { id: rowId, animalId: id, checkedOn: "2026-06-08", result: "POSITIVE" };
    await recordPregnancyCheck(null, fd(values));
    await recordPregnancyCheck(null, fd(values));
    expect(await db.select().from(s.pregnancyCheck).where(eq(s.pregnancyCheck.animalId, id))).toHaveLength(1);
  });
});

/* ================================================================== */
/* recordCalving — four things at once                                 */
/* ================================================================== */

describe("recordCalving", () => {
  async function pregnantCow() {
    const id = await seedAnimal(db, {
      tag: "KE-8001",
      name: "Njeri",
      dateOfBirth: "2021-03-14",
      primaryBreed: "FRIESIAN",
    });
    await db.insert(s.calving).values({
      id: newId(), farmId: FARM_ID, damId: id, calvedOn: "2025-06-01", recordedBy: USER,
    });
    const bull = await seedAnimal(db, { tag: "KE-BULL", name: "Simba", sex: "M", dateOfBirth: "2022-01-01" });
    const svc = await recordService(
      null,
      fd({ animalId: id, servedOn: "2025-11-04", serviceType: "NATURAL", bullId: bull, strawCode: "KG-4471" }),
    );
    if (!svc.ok) throw new Error("setup failed");
    await recordPregnancyCheck(null, fd({ animalId: id, checkedOn: "2026-01-05", result: "POSITIVE" }));
    return { id, bull, serviceId: svc.data.id, calendar: svc.data.calendar };
  }

  it("creates the calf, its schedule, the new lactation and the numbers — in one go", async () => {
    const { id, bull } = await pregnantCow();

    const res = await recordCalving(
      null,
      fd({
        damId: id,
        calvedOn: "2026-08-03",
        calvingEase: 2,
        outcomes: JSON.stringify([
          { outcome: "LIVE", calfSex: "F", birthWeightKg: 34, calfName: "Wambui" },
        ]),
      }),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // 1. The calf exists, with dam and sire linkage.
    expect(res.data.calves).toHaveLength(1);
    const calf = res.data.calves[0];
    const [calfRow] = await db.select().from(s.animal).where(eq(s.animal.id, calf.id));
    expect(calfRow.damId).toBe(id);
    expect(calfRow.sireId).toBe(bull);
    expect(calfRow.sireStrawCode).toBe("KG-4471");
    expect(calfRow.dateOfBirth).toBe("2026-08-03");
    expect(calfRow.origin).toBe("BORN");
    expect(calfRow.primaryBreed).toBe("FRIESIAN");
    expect(calfRow.tag).toBe("KE-8001/2608");

    // 2. Her first-year schedule came with her.
    const calfAlerts = await db.select().from(s.alert).where(eq(s.alert.animalId, calf.id));
    expect(calfAlerts.length).toBe(calf.schedule.length);
    expect(calfAlerts.map((a) => a.kind)).toContain("ROUTINE_S19");
    expect(calfAlerts.map((a) => a.kind)).toContain("ROUTINE_COLOSTRUM");

    // 3. The dam's new lactation started.
    expect(res.data.lactationNumber).toBe(2);
    expect(res.data.colostrumUntil).toBe("2026-08-07");
    expect(res.data.vwpEndsOn).toBe("2026-09-22");
    const list = await listHerd(session(), { asOf: "2026-08-03" });
    const dam = list.rows.find((r) => r.id === id)!;
    expect(dam.parity).toBe(2);
    expect(dam.daysInMilk).toBe(0);
    expect(dam.reproStatus).toBe("FRESH");

    // 4. The numbers, with the shilling cost of the overrun.
    expect(res.data.calvingIntervalDays).toBe(428);
    expect(res.data.excessDays).toBe(48);
    expect(res.data.calvingIntervalCostKes).toBe(48 * 4 * 52);
    expect(res.data.daysOpenDays).toBe(156);
    expect(res.data.servicesPerConception).toBe(1);
    expect(res.data.warnings.join(" ")).toMatch(/cost about KES/);

    // The outcome row points at the calf it produced.
    const outcomes = await db.select().from(s.calvingOutcome).where(eq(s.calvingOutcome.calvingId, res.data.id));
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].animalId).toBe(calf.id);
    expect(outcomes[0].birthWeightKg).toBe("34.00");
  });

  it("handles twins, creating two calves with distinct tags", async () => {
    const { id } = await pregnantCow();
    const res = await recordCalving(
      null,
      fd({
        damId: id,
        calvedOn: "2026-08-03",
        outcomes: JSON.stringify([
          { outcome: "LIVE", calfSex: "F" },
          { outcome: "LIVE", calfSex: "M" },
        ]),
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.calves).toHaveLength(2);
    expect(new Set(res.data.calves.map((c) => c.tag)).size).toBe(2);

    const [row] = await db.select().from(s.calving).where(eq(s.calving.id, res.data.id));
    expect(row.numberBorn).toBe(2);
  });

  it("creates no calf record for a stillbirth, but still starts the lactation", async () => {
    const { id } = await pregnantCow();
    const before = (await db.select().from(s.animal)).length;

    const res = await recordCalving(
      null,
      fd({
        damId: id,
        calvedOn: "2026-08-03",
        outcomes: JSON.stringify([{ outcome: "STILLBIRTH", calfSex: "M" }]),
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.calves).toHaveLength(0);
    expect((await db.select().from(s.animal)).length).toBe(before);
    expect(res.data.lactationNumber).toBe(2);
    expect(res.data.colostrumUntil).toBe("2026-08-07");
  });

  it("opens the brucellosis workflow on an abortion, because it is zoonotic and notifiable", async () => {
    const { id } = await pregnantCow();
    const res = await recordCalving(
      null,
      fd({
        damId: id,
        calvedOn: "2026-05-20",
        outcomes: JSON.stringify([{ outcome: "ABORTION" }]),
      }),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.isAbortion).toBe(true);
    expect(res.data.abortionProtocol).not.toBeNull();
    expect(res.data.abortionProtocol!.length).toBeGreaterThan(4);
    expect(res.data.abortionProtocol!.join(" ")).toMatch(/gloves/i);
    expect(res.data.abortionProtocol!.join(" ")).toMatch(/brucellosis/i);
    expect(res.data.abortionProtocol!.join(" ")).toMatch(/dogs/i);

    // No lactation is started and no parity is gained.
    expect(res.data.lactationNumber).toBe(1);
    expect(res.data.colostrumUntil).toBeNull();
    const list = await listHerd(session(), { asOf: "2026-05-21" });
    expect(list.rows.find((r) => r.id === id)!.parity).toBe(1);

    const alerts = await db.select().from(s.alert).where(eq(s.alert.animalId, id));
    const protocolAlert = alerts.find((a) => a.kind === ALERT_KIND.ABORTION_PROTOCOL)!;
    expect(protocolAlert.severity).toBe("CRITICAL");
    expect(protocolAlert.action).toMatch(/Isolate her/);
  });

  it("takes a client-generated calf id, so an offline replay makes one calf, not two", async () => {
    const { id } = await pregnantCow();
    const calvingId = newId();
    const calfId = newId();
    const values = {
      id: calvingId,
      damId: id,
      calvedOn: "2026-08-03",
      outcomes: JSON.stringify([{ outcome: "LIVE", calfSex: "F", calfId, calfTag: "KE-8001/A" }]),
    };

    const first = await recordCalving(null, fd(values));
    const second = await recordCalving(null, fd(values));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    expect(await db.select().from(s.calving).where(eq(s.calving.id, calvingId))).toHaveLength(1);
    expect(await db.select().from(s.animal).where(eq(s.animal.id, calfId))).toHaveLength(1);
    expect(await db.select().from(s.calvingOutcome).where(eq(s.calvingOutcome.calvingId, calvingId))).toHaveLength(1);
    const alerts = await db.select().from(s.alert).where(eq(s.alert.animalId, calfId));
    expect(alerts.length).toBe(first.ok ? first.data.calves[0].schedule.length : 0);
  });

  it("refuses a second calving on the same day", async () => {
    const { id } = await pregnantCow();
    await recordCalving(null, fd({ damId: id, calvedOn: "2026-08-03", outcomes: JSON.stringify([{ outcome: "LIVE", calfSex: "F" }]) }));
    const again = await recordCalving(null, fd({ damId: id, calvedOn: "2026-08-03", outcomes: JSON.stringify([{ outcome: "LIVE", calfSex: "F" }]) }));
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error).toMatch(/already recorded/);
  });

  it("warns about a hard calving, a retained placenta and milk fever", async () => {
    const { id } = await pregnantCow();
    const res = await recordCalving(
      null,
      fd({
        damId: id,
        calvedOn: "2026-08-03",
        calvingEase: 4,
        retainedPlacenta: true,
        milkFever: true,
        outcomes: JSON.stringify([{ outcome: "LIVE", calfSex: "F" }]),
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const all = res.data.warnings.join(" ");
    expect(all).toMatch(/hard calving/i);
    expect(all).toMatch(/retained placenta/i);
    expect(all).toMatch(/calcium/i);
  });

  it("cannot record a calving on another farm's cow", async () => {
    const rival = await seedOtherFarmAnimal();
    const res = await recordCalving(null, fd({ damId: rival, calvedOn: "2026-08-03" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("That animal was not found.");
    expect(await db.select().from(s.calving)).toHaveLength(0);
  });

  it("puts the calf on the herd list, on her own cow card, and on her dam's", async () => {
    const { id } = await pregnantCow();
    const res = await recordCalving(
      null,
      fd({ damId: id, calvedOn: "2026-08-03", outcomes: JSON.stringify([{ outcome: "LIVE", calfSex: "F", calfName: "Wambui" }]) }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const list = await listHerd(session(), { asOf: "2026-08-03" });
    const calf = list.rows.find((r) => r.id === res.data.calves[0].id)!;
    expect(calf.cls).toBe("CALF");
    expect(calf.name).toBe("Wambui");

    const damCard = await getAnimal(session(), id, { asOf: "2026-08-03" });
    expect(damCard!.offspring.map((o) => o.id)).toContain(res.data.calves[0].id);

    const calfCard = await getAnimal(session(), res.data.calves[0].id, { asOf: "2026-08-03" });
    expect(calfCard!.dam!.id).toBe(id);
    expect(calfCard!.schedule.length).toBeGreaterThan(0);
  });
});

/* ================================================================== */
/* recordDryOff                                                        */
/* ================================================================== */

describe("recordDryOff", () => {
  async function pregnantMilker() {
    const id = await seedAnimal(db, { tag: "KE-9001", name: "Pumzika", dateOfBirth: "2020-01-01", primaryBreed: "FRIESIAN" });
    await db.insert(s.calving).values({
      id: newId(), farmId: FARM_ID, damId: id, calvedOn: "2025-09-01", recordedBy: USER,
    });
    await recordService(null, fd({ animalId: id, servedOn: "2025-12-01" }));
    await recordPregnancyCheck(null, fd({ animalId: id, checkedOn: "2026-02-01", result: "POSITIVE" }));
    return id;
  }

  it("dries her off, counts the days to calving and says what happens next", async () => {
    const id = await pregnantMilker();
    const res = await recordDryOff(null, fd({ animalId: id, driedOn: "2026-07-10", method: "ABRUPT" }));

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.expectedCalvingOn).toBe("2026-09-08"); // Friesian, 281 days
    expect(res.data.dryDays).toBe(60);
    expect(res.data.nextAction).toMatch(/steaming up/);
    expect(res.data.warnings).toHaveLength(0);

    const list = await listHerd(session(), { asOf: "2026-07-11" });
    expect(list.rows.find((r) => r.id === id)!.cls).toBe("DRY_COW");
    expect(list.rows.find((r) => r.id === id)!.daysInMilk).toBeNull();
  });

  it("warns when the dry period is too short to be worth having", async () => {
    const id = await pregnantMilker();
    const res = await recordDryOff(null, fd({ animalId: id, driedOn: "2026-08-20" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.dryDays).toBe(19);
    expect(res.data.warnings.join(" ")).toMatch(/under 40 days costs milk/);
  });

  it("clears the dry-off reminder", async () => {
    const id = await pregnantMilker();
    const before = await db.select().from(s.alert).where(eq(s.alert.animalId, id));
    expect(before.some((a) => a.kind === ALERT_KIND.DRY_OFF_DUE && a.resolvedAt === null)).toBe(true);

    await recordDryOff(null, fd({ animalId: id, driedOn: "2026-07-10" }));

    const after = await db.select().from(s.alert).where(eq(s.alert.animalId, id));
    expect(after.filter((a) => a.kind === ALERT_KIND.DRY_OFF_DUE).every((a) => a.resolvedAt !== null)).toBe(true);
  });

  it("sets the dry cow therapy withdrawal — 30 days after infusion AND 96 hours after calving", async () => {
    const id = await pregnantMilker();
    const productId = newId();
    await db.insert(s.product).values({
      id: productId,
      farmId: FARM_ID,
      name: "Cepravin Dry Cow",
      productType: "INTRAMAMMARY",
      milkWithdrawalDays: 30,
      labelSource: "PCPB label",
      notForLactating: true,
    });

    const res = await recordDryOff(
      null,
      fd({ animalId: id, driedOn: "2026-07-10", dryCowTherapyProductId: productId }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Infusion + 30 = 2026-08-09; calving 2026-09-08 + 4 = 2026-09-12. Later wins.
    expect(res.data.milkClearOn).toBe("2026-09-12");
    expect(res.data.warnings.join(" ")).toMatch(/not saleable until 2026-09-12/);

    const alerts = await db.select().from(s.alert).where(eq(s.alert.animalId, id));
    const block = alerts.find((a) => a.kind === ALERT_KIND.MILK_WITHDRAWAL_DRY_COW)!;
    expect(block.severity).toBe("CRITICAL");
    expect(block.action).toMatch(/Do not sell/);
  });

  it("warns when she is not in calf at all", async () => {
    const id = await seedAnimal(db, { tag: "KE-9002", name: "Wazi" });
    await db.insert(s.calving).values({
      id: newId(), farmId: FARM_ID, damId: id, calvedOn: "2025-09-01", recordedBy: USER,
    });
    const res = await recordDryOff(null, fd({ animalId: id, driedOn: "2026-08-03" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.warnings.join(" ")).toMatch(/not recorded in calf/);
  });

  it("cannot dry off another farm's cow", async () => {
    const rival = await seedOtherFarmAnimal();
    const res = await recordDryOff(null, fd({ animalId: rival, driedOn: "2026-08-03" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("That animal was not found.");
  });
});

/* ================================================================== */
/* breedingWatchboard — every item must CLEAR on its outcome           */
/* ================================================================== */

describe("breedingWatchboard", () => {
  it("puts a served cow on return-to-heat watch around day 21", async () => {
    const id = await seedCow();
    await recordService(null, fd({ animalId: id, servedOn: "2026-07-13" }));

    const early = await breedingWatchboard(session(), "2026-07-20"); // day 7
    expect(early.returnsToHeat).toHaveLength(0);

    const due = await breedingWatchboard(session(), "2026-08-03"); // day 21
    expect(due.returnsToHeat).toHaveLength(1);
    expect(due.returnsToHeat[0].animalId).toBe(id);
    expect(due.returnsToHeat[0].dueOn).toBe("2026-08-03");
    expect(due.returnsToHeat[0].action).toMatch(/Watch Njeri/);
  });

  /**
   * THE HERDWATCH BUG. Their watchboard keeps repeat-served cows on the board
   * forever, because the board is a list of reminders somebody has to tick.
   * Ours is recomputed from the latest service every time, so recording the
   * repeat is the whole of the fix.
   */
  it("CLEARS a repeat-served cow instead of sticking her on the board forever", async () => {
    const id = await seedCow();
    await recordService(null, fd({ animalId: id, servedOn: "2026-07-13" }));

    const before = await breedingWatchboard(session(), "2026-08-03");
    expect(before.returnsToHeat.map((i) => i.animalId)).toContain(id);

    // She returned to heat and was served again on the same day.
    const repeat = await recordService(null, fd({ animalId: id, servedOn: "2026-08-03" }));
    expect(repeat.ok).toBe(true);

    const after = await breedingWatchboard(session(), "2026-08-03");
    expect(after.returnsToHeat).toHaveLength(0);
    expect(after.all.filter((i) => i.animalId === id && i.kind === "RETURN_TO_HEAT")).toHaveLength(0);

    // And the new watch appears exactly one cycle after the NEW service.
    const nextCycle = await breedingWatchboard(session(), "2026-08-24");
    expect(nextCycle.returnsToHeat).toHaveLength(1);
    expect(nextCycle.returnsToHeat[0].dueOn).toBe("2026-08-24");

    // Serving her a third time clears it again — it never accumulates.
    await recordService(null, fd({ animalId: id, servedOn: "2026-08-24" }));
    expect((await breedingWatchboard(session(), "2026-08-24")).returnsToHeat).toHaveLength(0);

    // No stale alert rows are left open either.
    const alerts = await db.select().from(s.alert).where(eq(s.alert.animalId, id));
    const openReturns = alerts.filter((a) => a.kind === ALERT_KIND.RETURN_TO_HEAT && a.resolvedAt === null);
    expect(openReturns).toHaveLength(1);
  });

  it("CLEARS the return-to-heat watch when a pregnancy check is recorded instead", async () => {
    const id = await seedCow();
    await recordService(null, fd({ animalId: id, servedOn: "2026-07-13" }));
    expect((await breedingWatchboard(session(), "2026-08-03")).returnsToHeat).toHaveLength(1);

    await recordPregnancyCheck(null, fd({ animalId: id, checkedOn: "2026-08-03", result: "POSITIVE" }));
    expect((await breedingWatchboard(session(), "2026-08-03")).returnsToHeat).toHaveLength(0);
  });

  it("raises the pregnancy check at day 60 and CLEARS it the moment one is recorded", async () => {
    const id = await seedCow();
    await recordService(null, fd({ animalId: id, servedOn: "2026-06-04" })); // PD due 2026-08-03

    const due = await breedingWatchboard(session(), "2026-08-03");
    expect(due.pregnancyChecks).toHaveLength(1);
    expect(due.pregnancyChecks[0].dueOn).toBe("2026-08-03");
    // The return watch has handed over — it does not sit there alongside.
    expect(due.returnsToHeat).toHaveLength(0);

    await recordPregnancyCheck(null, fd({ animalId: id, checkedOn: "2026-08-03", result: "POSITIVE" }));
    expect((await breedingWatchboard(session(), "2026-08-03")).pregnancyChecks).toHaveLength(0);

    // Still clear two weeks later — it does not come back.
    expect((await breedingWatchboard(session(), "2026-08-17")).pregnancyChecks).toHaveLength(0);
  });

  it("escalates an overdue pregnancy check rather than letting it fade", async () => {
    const id = await seedCow();
    await recordService(null, fd({ animalId: id, servedOn: "2026-06-04" }));
    const late = await breedingWatchboard(session(), "2026-08-25"); // 22 days over
    expect(late.pregnancyChecks[0].severity).toBe("CRITICAL");
    expect(late.pregnancyChecks[0].daysOverdue).toBe(22);
  });

  it("raises the dry-off 60 days out and CLEARS it when she is dried off", async () => {
    const id = await seedAnimal(db, { tag: "KE-9101", name: "Pumzika", primaryBreed: "FRIESIAN", dateOfBirth: "2020-01-01" });
    await db.insert(s.calving).values({ id: newId(), farmId: FARM_ID, damId: id, calvedOn: "2025-09-01", recordedBy: USER });
    await recordService(null, fd({ animalId: id, servedOn: "2025-12-01" })); // EDD 2026-09-08
    await recordPregnancyCheck(null, fd({ animalId: id, checkedOn: "2026-02-01", result: "POSITIVE" }));

    const before = await breedingWatchboard(session(), "2026-07-09");
    expect(before.dryOffs).toHaveLength(0);

    const due = await breedingWatchboard(session(), "2026-07-10");
    expect(due.dryOffs).toHaveLength(1);
    expect(due.dryOffs[0].dueOn).toBe("2026-07-10");

    await recordDryOff(null, fd({ animalId: id, driedOn: "2026-07-10" }));
    expect((await breedingWatchboard(session(), "2026-07-20")).dryOffs).toHaveLength(0);
  });

  it("raises the calving a week out and CLEARS it when she calves", async () => {
    const id = await seedAnimal(db, { tag: "KE-9102", name: "Karibu", primaryBreed: "FRIESIAN", dateOfBirth: "2020-01-01" });
    await db.insert(s.calving).values({ id: newId(), farmId: FARM_ID, damId: id, calvedOn: "2025-09-01", recordedBy: USER });
    await recordService(null, fd({ animalId: id, servedOn: "2025-12-01" })); // EDD 2026-09-08
    await recordPregnancyCheck(null, fd({ animalId: id, checkedOn: "2026-02-01", result: "POSITIVE" }));

    expect((await breedingWatchboard(session(), "2026-08-31")).calvings).toHaveLength(0);
    const due = await breedingWatchboard(session(), "2026-09-01");
    expect(due.calvings).toHaveLength(1);
    expect(due.calvings[0].dueOn).toBe("2026-09-08");
    expect(due.calvings[0].severity).toBe("CRITICAL");

    // Overdue reads differently, so nobody assumes it has been handled.
    const over = await breedingWatchboard(session(), "2026-09-15");
    expect(over.calvings[0].detail).toMatch(/7 days over/);

    await recordCalving(
      null,
      fd({ damId: id, calvedOn: "2026-09-08", outcomes: JSON.stringify([{ outcome: "LIVE", calfSex: "F" }]) }),
    );
    expect((await breedingWatchboard(session(), "2026-09-15")).calvings).toHaveLength(0);
  });

  it("CLEARS the calendar entirely on a negative pregnancy check", async () => {
    const id = await seedCow();
    await recordService(null, fd({ animalId: id, servedOn: "2026-04-05" }));
    await recordPregnancyCheck(null, fd({ animalId: id, checkedOn: "2026-06-08", result: "NEGATIVE" }));

    // Neither the dry-off nor the calving that pregnancy would have implied.
    const board = await breedingWatchboard(session(), "2026-11-10");
    expect(board.dryOffs).toHaveLength(0);
    expect(board.calvings).toHaveLength(0);
    // She is open instead, and past her waiting period, so she needs serving.
    expect(board.serveNow.map((i) => i.animalId)).toContain(id);
  });

  it("lists open cows past the voluntary waiting period, and CLEARS them once served", async () => {
    const id = await seedCow(); // calved 2026-02-01

    const before = await breedingWatchboard(session(), "2026-03-10"); // day 37
    expect(before.serveNow).toHaveLength(0);

    const due = await breedingWatchboard(session(), "2026-08-03"); // day 183
    expect(due.serveNow).toHaveLength(1);
    expect(due.serveNow[0].action).toMatch(/183 days calved and still open/);
    expect(due.serveNow[0].severity).toBe("CRITICAL");

    await recordService(null, fd({ animalId: id, servedOn: "2026-08-03" }));
    expect((await breedingWatchboard(session(), "2026-08-03")).serveNow).toHaveLength(0);
  });

  it("lists a bulling heifer who has never been served", async () => {
    await seedAnimal(db, { tag: "KE-9103", name: "Mtamba", dateOfBirth: "2025-01-01" });
    const board = await breedingWatchboard(session(), "2026-08-03");
    expect(board.serveNow).toHaveLength(1);
    expect(board.serveNow[0].action).toMatch(/ready to serve/);
    expect(board.serveNow[0].detail).toMatch(/280 kg matters more than age/);
  });

  it("leaves out bulls, calves and animals that have left the herd", async () => {
    const gone = await seedCow();
    await db.insert(s.animalExit).values({
      id: newId(), farmId: FARM_ID, animalId: gone, exitDate: "2026-07-01", reason: "SOLD", recordedBy: USER,
    });
    await seedAnimal(db, { tag: "KE-9104", sex: "M", name: "Simba", dateOfBirth: "2022-01-01" });
    await seedAnimal(db, { tag: "KE-9105", name: "Kidogo", dateOfBirth: "2026-06-01" });

    const board = await breedingWatchboard(session(), "2026-08-03");
    expect(board.total).toBe(0);
  });

  it("counts each kind, and sorts the most overdue to the top", async () => {
    const a = await seedAnimal(db, { tag: "KE-9106", name: "Aliyechelewa", dateOfBirth: "2020-01-01" });
    const b = await seedAnimal(db, { tag: "KE-9107", name: "Bibi", dateOfBirth: "2020-01-01" });
    await db.insert(s.calving).values([
      { id: newId(), farmId: FARM_ID, damId: a, calvedOn: "2025-08-01", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, damId: b, calvedOn: "2026-05-01", recordedBy: USER },
    ]);

    const board = await breedingWatchboard(session(), "2026-08-03");
    expect(board.counts.SERVE_NOW).toBe(2);
    expect(board.total).toBe(2);
    expect(board.all[0].animalId).toBe(a); // 367 days open beats 94
    expect(board.all[0].daysOverdue).toBeGreaterThan(board.all[1].daysOverdue);
  });

  it("shows one farm nothing of another's", async () => {
    const id = await seedCow();
    await recordService(null, fd({ animalId: id, servedOn: "2026-07-13" }));
    await seedOtherFarmAnimal();

    const theirs = await breedingWatchboard(session({ farmId: OTHER_FARM }), "2026-08-03");
    expect(theirs.total).toBe(0);

    const ours = await breedingWatchboard(session(), "2026-08-03");
    expect(ours.total).toBeGreaterThan(0);
    expect(ours.all.every((i) => i.animalId === id)).toBe(true);
  });
});

/* ================================================================== */
/* breedingSummary                                                     */
/* ================================================================== */

describe("breedingSummary", () => {
  it("summarises a cow's whole reproductive record", async () => {
    const id = await seedAnimal(db, { tag: "KE-9201", name: "Njeri", dateOfBirth: "2020-01-01", primaryBreed: "AYRSHIRE" });
    await db.insert(s.calving).values([
      { id: newId(), farmId: FARM_ID, damId: id, calvedOn: "2023-06-01", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, damId: id, calvedOn: "2024-08-01", recordedBy: USER },
      { id: newId(), farmId: FARM_ID, damId: id, calvedOn: "2025-11-01", recordedBy: USER },
    ]);
    await recordService(null, fd({ animalId: id, servedOn: "2026-02-01" }));
    await recordService(null, fd({ animalId: id, servedOn: "2026-02-22" }));

    const sum = await breedingSummary(session(), id, "2026-08-03");
    expect(sum).not.toBeNull();
    expect(sum!.gestationDays).toBe(279);
    expect(sum!.calvingIntervals).toEqual([427, 457]);
    expect(sum!.averageCalvingIntervalDays).toBe(442);
    expect(sum!.servicesThisCycle).toBe(2);
    expect(sum!.reproStatus).toBe("SERVED");
    expect(sum!.dryOffDueOn).toBeNull(); // not confirmed pregnant
  });

  it("gives the dry-off date once she is confirmed in calf", async () => {
    const id = await seedCow();
    const svc = await recordService(null, fd({ animalId: id, servedOn: "2026-04-05" }));
    await recordPregnancyCheck(null, fd({ animalId: id, checkedOn: "2026-06-08", result: "POSITIVE" }));
    const sum = await breedingSummary(session(), id, "2026-08-03");
    expect(sum!.reproStatus).toBe("PREGNANT");
    expect(svc.ok && sum!.expectedCalvingOn).toBe(svc.ok ? svc.data.calendar.expectedCalvingOn : null);
    expect(sum!.dryOffDueOn).toBe(addDays(sum!.expectedCalvingOn!, -60));
  });

  it("returns null for another farm's cow", async () => {
    const rival = await seedOtherFarmAnimal();
    expect(await breedingSummary(session(), rival, "2026-08-03")).toBeNull();
  });
});
