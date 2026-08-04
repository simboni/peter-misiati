import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/test-db";
import { FARM_ID, fakeSession, seedAnimal, seedFarm } from "@/test/factory";
import { newId } from "@/lib/ids";
import { addDays, today } from "@/lib/domain/dates";
import { ABORTION_PROTOCOL } from "@/lib/domain/health";

/**
 * THE LIFECYCLE SEAM — breeding → milk.
 *
 * M3 never stores who is milking. `lactatingHerd` derives it every time from
 * M2's events: a calving puts her on the sheet, a dry-off takes her off, and
 * days in milk are counted from `calving.calvedOn`. That means a bug in M2's
 * writes does not show up as a breeding bug — it shows up as a cow silently
 * missing from the milking sheet, which nobody notices until the month's litres
 * are short.
 *
 * These go through the real Server Actions (`recordCalving`, `recordDryOff`),
 * which take FormData and resolve the database at module scope, so this file
 * uses the same hoisted harness as `src/server/breeding.test.ts`.
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
  // The DAL rolls the idle stamp forward on every verified request. Vitest
  // throws on ACCESS of an export a mock does not define, so leaving these out
  // fails the request rather than the assertion, from inside `guard`.
  touchSession: async () => {},
  destroySession: async () => {},
}));

const { recordCalving, recordDryOff } = await import("../breeding");
const { firstYearSchedule } = await import("../herd");
const { dayProduction, milkSheet, recordMilkBatch } = await import("../milk");

const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_FARM = "99999999-9999-4999-8999-999999999999";

const T0 = today();
const D = (n: number) => addDays(T0, n);

let db: TestDb;
let close: () => Promise<void>;

function session(over: Parameters<typeof fakeSession>[0] = {}) {
  return fakeSession({ userId: USER, role: "MANAGER", fullName: "Grace Wanjiru", ...over });
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

/**
 * An in-calf heifer due in a fortnight: served 269 days ago, confirmed in calf,
 * never calved. She is not on the milking sheet and should not be.
 */
async function seedInCalfHeifer(over: { name?: string; tag?: string; calvesOn?: string } = {}) {
  const calvesOn = over.calvesOn ?? T0;
  const id = await seedAnimal(db, {
    name: over.name ?? "Njeri",
    tag: over.tag ?? "KE-0001",
    dateOfBirth: addDays(calvesOn, -900),
  });
  await db.insert(s.service).values({
    id: newId(),
    farmId: FARM_ID,
    animalId: id,
    servedOn: addDays(calvesOn, -283),
    serviceType: "AI",
    strawCode: "KAG-FR-441",
    sireBreed: "FRIESIAN",
    expectedCalvingOn: calvesOn,
    recordedBy: USER,
  });
  await db.insert(s.pregnancyCheck).values({
    id: newId(),
    farmId: FARM_ID,
    animalId: id,
    checkedOn: addDays(calvesOn, -230),
    method: "PALPATION",
    result: "POSITIVE",
    recordedBy: USER,
  });
  return id;
}

const rowFor = <T extends { animalId: string }>(sheet: { rows: T[] }, animalId: string): T | undefined =>
  sheet.rows.find((r) => r.animalId === animalId);

const liveCalf = (sex: "F" | "M" = "F") => JSON.stringify([{ outcome: "LIVE", calfSex: sex, birthWeightKg: 34 }]);

/* ================================================================== */
/* SEAM 2a — a calving puts her on the sheet, colostrum-locked          */
/* ================================================================== */

describe("a calving puts the cow on the milking sheet", () => {
  it("adds her the day she calves, locked because the first milk is the calf's", async () => {
    const cow = await seedInCalfHeifer({ calvesOn: D(-1) });
    expect(rowFor(await milkSheet(session(), D(-2), "MORNING", db), cow)).toBeUndefined();

    const calved = await recordCalving(null, fd({ damId: cow, calvedOn: D(-1), outcomes: liveCalf() }));
    if (!calved.ok) throw new Error(calved.error);
    expect(calved.data.colostrumUntil).toBe(D(3));

    const row = rowFor(await milkSheet(session(), D(-1), "MORNING", db), cow)!;
    expect(row.daysInMilk).toBe(0);
    expect(row.locked).toBe(true);
    expect(row.lockReason).toBe("COLOSTRUM");
    expect(row.saleable).toBe(false);
    expect(row.lockMessage).toMatch(/it is the calf's, not for sale/);
  });

  it("holds the colostrum lock for days 0 to 4 and releases it on day 5", async () => {
    const cow = await seedInCalfHeifer({ calvesOn: D(-10) });
    const calved = await recordCalving(null, fd({ damId: cow, calvedOn: D(-10), outcomes: liveCalf() }));
    if (!calved.ok) throw new Error(calved.error);

    for (const day of [0, 1, 2, 3, 4]) {
      const row = rowFor(await milkSheet(session(), addDays(D(-10), day), "MORNING", db), cow)!;
      expect([day, row.daysInMilk, row.locked, row.lockReason]).toEqual([day, day, true, "COLOSTRUM"]);
    }

    const day5 = rowFor(await milkSheet(session(), addDays(D(-10), 5), "MORNING", db), cow)!;
    expect(day5.daysInMilk).toBe(5);
    expect(day5.locked).toBe(false);
    expect(day5.lockReason).toBeNull();
    expect(day5.saleable).toBe(true);
  });

  it("stamps the colostrum litres unsaleable so they cannot reach a paying channel", async () => {
    const cow = await seedInCalfHeifer({ calvesOn: D(-2) });
    await recordCalving(null, fd({ damId: cow, calvedOn: D(-2), outcomes: liveCalf() }));

    const batch = await recordMilkBatch(
      session(),
      { date: D(-2), session: "MORNING", rows: [{ animalId: cow, litres: 8 }] },
      db,
    );
    if (!batch.ok) throw new Error(batch.error);
    expect(batch.data.colostrumL).toBe(8);
    expect(batch.data.saleableL).toBe(0);

    const day = await dayProduction(session(), D(-2), db);
    expect(day.colostrumL).toBe(8);
    expect(day.saleableL).toBe(0);
    expect(day.withheldAnimals[0].reason).toBe("COLOSTRUM");
  });
});

/* ================================================================== */
/* SEAM 2b — a dry-off takes her off the sheet                          */
/* ================================================================== */

describe("a dry-off takes the cow off the milking sheet", () => {
  it("removes her from the day she is dried off, and leaves the rest of the herd alone", async () => {
    const njeri = await seedInCalfHeifer({ name: "Njeri", tag: "KE-0001", calvesOn: D(-300) });
    const nyambura = await seedInCalfHeifer({ name: "Nyambura", tag: "KE-0002", calvesOn: D(-300) });
    for (const cow of [njeri, nyambura]) {
      await recordCalving(null, fd({ damId: cow, calvedOn: D(-300), outcomes: liveCalf() }));
    }
    // Both in milk the day before.
    const before = await milkSheet(session(), D(-1), "MORNING", db);
    expect(before.rows.map((r) => r.animalId).sort()).toEqual([njeri, nyambura].sort());

    const dried = await recordDryOff(null, fd({ animalId: njeri, driedOn: T0, method: "ABRUPT" }));
    if (!dried.ok) throw new Error(dried.error);

    const after = await milkSheet(session(), T0, "MORNING", db);
    expect(after.rows.map((r) => r.animalId)).toEqual([nyambura]);
    // And she is still there in yesterday's book — the sheet is dated, not a switch.
    expect(rowFor(await milkSheet(session(), D(-1), "MORNING", db), njeri)).toBeDefined();
  });

  it("puts her back on the sheet at her next calving", async () => {
    const cow = await seedInCalfHeifer({ calvesOn: D(-320) });
    await recordCalving(null, fd({ damId: cow, calvedOn: D(-320), outcomes: liveCalf() }));
    await db.insert(s.service).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: cow,
      servedOn: D(-290),
      serviceType: "AI",
      expectedCalvingOn: D(-7),
      recordedBy: USER,
    });
    await recordDryOff(null, fd({ animalId: cow, driedOn: D(-67) }));
    expect(rowFor(await milkSheet(session(), D(-30), "MORNING", db), cow)).toBeUndefined();

    await recordCalving(null, fd({ damId: cow, calvedOn: D(-7), outcomes: liveCalf("M") }));
    const row = rowFor(await milkSheet(session(), T0, "MORNING", db), cow)!;
    expect(row.daysInMilk).toBe(7);
    expect(row.locked).toBe(false);
  });
});

/* ================================================================== */
/* SEAM 2c — days in milk are dated from the calving                    */
/* ================================================================== */

describe("days in milk come from the calving row and nowhere else", () => {
  it("counts from calvedOn, so day 45 on the sheet means she calved 45 days ago", async () => {
    const cow = await seedInCalfHeifer({ calvesOn: D(-45) });
    await recordCalving(null, fd({ damId: cow, calvedOn: D(-45), outcomes: liveCalf() }));

    const row = rowFor(await milkSheet(session(), T0, "MORNING", db), cow)!;
    expect(row.daysInMilk).toBe(45);

    const [calving] = await db.select().from(s.calving).where(eq(s.calving.damId, cow));
    expect(calving.calvedOn).toBe(D(-45));
  });

  it("keeps a cow with no calving row off the sheet entirely, however much she is fed", async () => {
    const heifer = await seedInCalfHeifer({ name: "Wanjiru", tag: "KE-0003", calvesOn: D(14) });
    const sheet = await milkSheet(session(), T0, "MORNING", db);
    expect(sheet.rows).toHaveLength(0);
    expect(rowFor(sheet, heifer)).toBeUndefined();
  });

  /**
   * Milk CAN still be recorded against her — R4 warns rather than blocks, and a
   * heifer who calved in the night before anyone wrote it down must not lose her
   * first day's litres. It is the SHEET that is derived, not the record.
   */
  it("still lets her litres be recorded before anyone has written the calving down", async () => {
    const heifer = await seedInCalfHeifer({ calvesOn: T0 });
    const batch = await recordMilkBatch(
      session(),
      { date: T0, session: "MORNING", rows: [{ animalId: heifer, litres: 9 }] },
      db,
    );
    if (!batch.ok) throw new Error(batch.error);
    expect(batch.data.totalL).toBe(9);
    // But nothing knows it is colostrum, because nothing knows she calved.
    const [record] = await db.select().from(s.milkRecord);
    expect(record.saleable).toBe(true);

    // Once the calving is recorded, the sheet picks her up and locks her.
    await recordCalving(null, fd({ damId: heifer, calvedOn: T0, outcomes: liveCalf() }));
    const row = rowFor(await milkSheet(session(), T0, "MORNING", db), heifer)!;
    expect(row.locked).toBe(true);
    expect(row.lockReason).toBe("COLOSTRUM");
    // The litres already saved keep the flag they were saved with.
    expect((await dayProduction(session(), T0, db)).saleableL).toBe(9);
  });
});

/* ================================================================== */
/* SEAM 2d — a calving creates the calf and her first year of care      */
/* ================================================================== */

describe("a calving creates the calf record and its first-year schedule", () => {
  it("registers the calf with her dam, her breed and her birth date", async () => {
    const cow = await seedInCalfHeifer({ name: "Njeri", tag: "KE-0001", calvesOn: D(-1) });
    const calved = await recordCalving(null, fd({ damId: cow, calvedOn: D(-1), outcomes: liveCalf("F") }));
    if (!calved.ok) throw new Error(calved.error);
    expect(calved.data.calves).toHaveLength(1);

    const calfId = calved.data.calves[0].id;
    const [calf] = await db.select().from(s.animal).where(eq(s.animal.id, calfId));
    expect(calf.damId).toBe(cow);
    expect(calf.dateOfBirth).toBe(D(-1));
    expect(calf.origin).toBe("BORN");
    expect(calf.sireStrawCode).toBe("KAG-FR-441");
    expect(calf.primaryBreed).toBe("FRIESIAN");
    expect(calf.tag).toContain("KE-0001/");

    // And the outcome row ties the calving to the animal it produced.
    const [outcome] = await db.select().from(s.calvingOutcome).where(eq(s.calvingOutcome.calvingId, calved.data.id));
    expect(outcome.outcome).toBe("LIVE");
    expect(outcome.animalId).toBe(calfId);
  });

  it("writes her whole first year of routines as alerts, colostrum first", async () => {
    const cow = await seedInCalfHeifer({ calvesOn: D(-1) });
    const calved = await recordCalving(null, fd({ damId: cow, calvedOn: D(-1), outcomes: liveCalf("F") }));
    if (!calved.ok) throw new Error(calved.error);
    const calfId = calved.data.calves[0].id;

    const expected = firstYearSchedule({ sex: "F", birthOn: D(-1) });
    expect(calved.data.calves[0].schedule.map((i) => i.routine)).toEqual(expected.map((i) => i.routine));

    const alerts = await db.select().from(s.alert).where(eq(s.alert.animalId, calfId));
    expect(alerts).toHaveLength(expected.length);
    expect(alerts.map((a) => a.kind)).toContain("ROUTINE_COLOSTRUM");
    // S19 is females only, once for life, and it is on her list from birth.
    expect(alerts.map((a) => a.kind)).toContain("ROUTINE_S19");

    const colostrum = alerts.find((a) => a.kind === "ROUTINE_COLOSTRUM")!;
    expect(colostrum.dueOn).toBe(D(-1));
    expect(colostrum.severity).toBe("CRITICAL");
  });

  it("leaves S19 off a bull calf's list", async () => {
    const cow = await seedInCalfHeifer({ calvesOn: D(-1) });
    const calved = await recordCalving(null, fd({ damId: cow, calvedOn: D(-1), outcomes: liveCalf("M") }));
    if (!calved.ok) throw new Error(calved.error);
    const alerts = await db.select().from(s.alert).where(eq(s.alert.animalId, calved.data.calves[0].id));
    expect(alerts.map((a) => a.kind)).not.toContain("ROUTINE_S19");
  });

  it("registers twins as two animals with two schedules, not one", async () => {
    const cow = await seedInCalfHeifer({ calvesOn: D(-1) });
    const calved = await recordCalving(
      null,
      fd({
        damId: cow,
        calvedOn: D(-1),
        outcomes: JSON.stringify([
          { outcome: "LIVE", calfSex: "F" },
          { outcome: "LIVE", calfSex: "M" },
        ]),
      }),
    );
    if (!calved.ok) throw new Error(calved.error);
    expect(calved.data.calves).toHaveLength(2);
    const tags = calved.data.calves.map((c) => c.tag);
    expect(new Set(tags).size).toBe(2);
    const calves = await db.select().from(s.animal).where(eq(s.animal.damId, cow));
    expect(calves).toHaveLength(2);
  });

  it("creates no calf record for a stillbirth, but still starts her lactation", async () => {
    const cow = await seedInCalfHeifer({ calvesOn: D(-1) });
    const calved = await recordCalving(
      null,
      fd({ damId: cow, calvedOn: D(-1), outcomes: JSON.stringify([{ outcome: "STILLBIRTH", calfSex: "F" }]) }),
    );
    if (!calved.ok) throw new Error(calved.error);
    expect(calved.data.calves).toHaveLength(0);
    expect(await db.select().from(s.animal).where(eq(s.animal.damId, cow))).toHaveLength(0);
    // She calved, so she is milking — a stillbirth does not stop the udder.
    expect(rowFor(await milkSheet(session(), D(-1), "MORNING", db), cow)).toBeDefined();
  });
});

/* ================================================================== */
/* SEAM 2e — an abortion opens the brucellosis workflow                 */
/* ================================================================== */

describe("an abortion is a human-health event, not a filing", () => {
  it("returns the brucellosis protocol at the moment of entry", async () => {
    const cow = await seedInCalfHeifer({ name: "Njeri", tag: "KE-0001", calvesOn: D(60) });
    const aborted = await recordCalving(
      null,
      fd({ damId: cow, calvedOn: T0, outcomes: JSON.stringify([{ outcome: "ABORTION" }]) }),
    );
    if (!aborted.ok) throw new Error(aborted.error);

    expect(aborted.data.isAbortion).toBe(true);
    expect(aborted.data.abortionProtocol).toEqual(ABORTION_PROTOCOL);
    expect(aborted.data.abortionProtocol!.join(" ")).toMatch(/brucellosis passes to people/);
    expect(aborted.message).toMatch(/Follow the brucellosis steps/);
    // No colostrum window and no calf.
    expect(aborted.data.colostrumUntil).toBeNull();
    expect(aborted.data.calves).toHaveLength(0);
  });

  it("raises a critical alert for the manager, not a note in a log", async () => {
    const cow = await seedInCalfHeifer({ calvesOn: D(60) });
    await recordCalving(null, fd({ damId: cow, calvedOn: T0, outcomes: JSON.stringify([{ outcome: "ABORTION" }]) }));

    const alerts = await db
      .select()
      .from(s.alert)
      .where(and(eq(s.alert.animalId, cow), eq(s.alert.kind, "ABORTION_PROTOCOL")));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("CRITICAL");
    expect(alerts[0].assignedRole).toBe("MANAGER");
    expect(alerts[0].action).toMatch(/Isolate her/);
  });

  /**
   * FINDING. The `calving` row is written whatever the outcome, and M3 counts
   * calving rows for parity and dates days-in-milk from them. So an abortion
   * puts her on the milking sheet as a fresh cow — colostrum-locked for four
   * days, which is the safe direction, but "she calved 0 days ago" is not what
   * happened, and days-in-milk after an abortion at, say, five months is a
   * number nobody should act on.
   */
  it("puts her on the milking sheet as though she had calved", async () => {
    const cow = await seedInCalfHeifer({ name: "Njeri", tag: "KE-0001", calvesOn: D(60) });
    await recordCalving(null, fd({ damId: cow, calvedOn: T0, outcomes: JSON.stringify([{ outcome: "ABORTION" }]) }));

    const row = rowFor(await milkSheet(session(), T0, "MORNING", db), cow)!;
    expect(row.daysInMilk).toBe(0);
    expect(row.locked).toBe(true);
    expect(row.lockReason).toBe("COLOSTRUM");
    expect(row.lockMessage).toMatch(/calved 0 days ago/);
  });
});

/* ================================================================== */
/* SEAM 5 — tenancy across the lifecycle seam                          */
/* ================================================================== */

describe("another farm's ids are refused exactly like ids that do not exist", () => {
  async function seedOtherFarmCow() {
    await db.insert(s.farm).values({ id: OTHER_FARM, name: "Nakuru Rival Dairy" }).onConflictDoNothing();
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

  it("will not record a calving for another farm's cow, or for a cow that does not exist", async () => {
    const foreign = await seedOtherFarmCow();
    const foreignResult = await recordCalving(null, fd({ damId: foreign, calvedOn: T0, outcomes: liveCalf() }));
    const missingResult = await recordCalving(null, fd({ damId: newId(), calvedOn: T0, outcomes: liveCalf() }));

    expect(foreignResult).toEqual({ ok: false, error: "That animal was not found." });
    expect(foreignResult).toEqual(missingResult);
    expect(await db.select().from(s.calving)).toHaveLength(0);
    expect(await db.select().from(s.animal).where(eq(s.animal.farmId, FARM_ID))).toHaveLength(0);
  });

  it("will not dry off another farm's cow, or one that does not exist", async () => {
    const foreign = await seedOtherFarmCow();
    const foreignResult = await recordDryOff(null, fd({ animalId: foreign, driedOn: T0 }));
    const missingResult = await recordDryOff(null, fd({ animalId: newId(), driedOn: T0 }));

    expect(foreignResult).toEqual({ ok: false, error: "That animal was not found." });
    expect(foreignResult).toEqual(missingResult);
    expect(await db.select().from(s.dryOff)).toHaveLength(0);
  });

  it("will not infuse another farm's dry cow tube, or one that does not exist", async () => {
    const cow = await seedInCalfHeifer({ calvesOn: D(60) });
    await db.insert(s.farm).values({ id: OTHER_FARM, name: "Nakuru Rival Dairy" }).onConflictDoNothing();
    const foreignProduct = newId();
    await db.insert(s.product).values({
      id: foreignProduct,
      farmId: OTHER_FARM,
      name: "Their dry cow tube",
      productType: "INTRAMAMMARY",
      notForLactating: true,
    });

    const foreignResult = await recordDryOff(
      null,
      fd({ animalId: cow, driedOn: T0, dryCowTherapyProductId: foreignProduct }),
    );
    const missingResult = await recordDryOff(
      null,
      fd({ animalId: cow, driedOn: T0, dryCowTherapyProductId: newId() }),
    );
    expect(foreignResult).toEqual({ ok: false, error: "That product was not found." });
    expect(foreignResult).toEqual(missingResult);
    expect(await db.select().from(s.healthEvent)).toHaveLength(0);
  });

  it("does not let another farm's calving put a cow on our milking sheet", async () => {
    const foreign = await seedOtherFarmCow();
    await db.insert(s.calving).values({
      id: newId(),
      farmId: OTHER_FARM,
      damId: foreign,
      calvedOn: D(-30),
      recordedBy: USER,
    });
    const sheet = await milkSheet(session(), T0, "MORNING", db);
    expect(sheet.rows).toHaveLength(0);
  });
});
