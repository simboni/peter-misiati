/**
 * M6 — ADVERSARIAL.
 *
 * The withdrawal engine is the only place in this product where a bug costs a
 * Kenyan farm a whole chilling-plant load. Everything here is an attempt to get
 * a treated cow declared clear, or to get a legitimate record refused.
 *
 * Tests marked `it.fails` are DEFECTS: they assert the intended behaviour and
 * are expected to fail until fixed.
 */
import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { FARM_ID, fakeSession, seedAnimal, seedFarm, seedProduct } from "@/test/factory";
import { newId } from "@/lib/ids";
import { addDays, today } from "@/lib/domain/dates";
import * as s from "@/db/schema";
import {
  animalHealthHistory,
  createProductFor,
  dueRoutines,
  getWithdrawalStatus,
  recordCmtFor,
  recordDryCowTherapyFor,
  recordObservationFor,
  recordRoutineBatchFor,
  recordTreatmentFor,
  recordVaccinationFor,
  stableId,
  withdrawalBoard,
  type DbLike,
} from "./health";
import { withdrawalMap } from "./milk";

const OTHER_FARM = "22222222-2222-4222-8222-222222222222";
const session = fakeSession({ role: "MANAGER" });
const NOW = today();

async function setup() {
  const t = await createTestDb();
  await seedFarm(t.db);
  await t.db.insert(s.appUser).values({
    id: session.userId,
    farmId: FARM_ID,
    fullName: session.fullName,
    role: "MANAGER",
    pinHash: "test$1234",
  });
  return { ...t, db: t.db as unknown as DbLike, raw: t.db };
}

async function seedRivalFarm(db: TestDb) {
  await db.insert(s.farm).values({ id: OTHER_FARM, name: "Nyandarua Rival Dairy" }).onConflictDoNothing();
  const animalId = newId();
  await db.insert(s.animal).values({
    id: animalId,
    farmId: OTHER_FARM,
    tag: "NY-1",
    name: "Wanjiku",
    sex: "F",
    dateOfBirth: "2024-01-01",
    origin: "BORN",
    enteredHerdOn: "2024-01-01",
  });
  const productId = newId();
  await db.insert(s.product).values({
    id: productId,
    farmId: OTHER_FARM,
    name: "Their penicillin",
    productType: "ANTIBIOTIC",
    milkWithdrawalDays: 3,
  });
  return { animalId, productId };
}

/* ================================================================== */
/* 1. TENANCY                                                          */
/* ================================================================== */

describe("tenancy: the refusal must not say which farm the id belongs to", () => {
  it("treats a rival's animal exactly like an animal that never existed", async () => {
    const t = await setup();
    const rival = await seedRivalFarm(t.raw);
    const productId = await seedProduct(t.raw);

    const foreign = await recordTreatmentFor(
      session,
      { animalId: rival.animalId, productId },
      t.db,
    ).catch((e: Error) => e);
    const ghost = await recordTreatmentFor(session, { animalId: newId(), productId }, t.db).catch(
      (e: Error) => e,
    );

    expect(foreign).toBeInstanceOf(Error);
    expect(ghost).toBeInstanceOf(Error);
    expect((foreign as Error).message).toBe((ghost as Error).message);
    expect((foreign as Error).message).toBe("That animal was not found.");
    expect(await t.raw.select().from(s.healthEvent)).toHaveLength(0);
    await t.close();
  });

  it("treats a rival's PRODUCT exactly like a product that never existed", async () => {
    const t = await setup();
    const rival = await seedRivalFarm(t.raw);
    const animalId = await seedAnimal(t.raw, { name: "Njeri" });

    const foreign = await recordTreatmentFor(
      session,
      { animalId, productId: rival.productId },
      t.db,
    ).catch((e: Error) => e);
    const ghost = await recordTreatmentFor(session, { animalId, productId: newId() }, t.db).catch(
      (e: Error) => e,
    );

    expect((foreign as Error).message).toBe((ghost as Error).message);
    expect((foreign as Error).message).toBe("That product was not found.");
    await t.close();
  });

  it("a routine batch cannot be pointed at a rival's herd", async () => {
    const t = await setup();
    const rival = await seedRivalFarm(t.raw);
    const mine = await seedAnimal(t.raw, { name: "Njeri" });
    const productId = await seedProduct(t.raw, { productType: "ACARICIDE", milkWithdrawalDays: 0 });

    const foreign = await recordRoutineBatchFor(
      session,
      { animalIds: [rival.animalId], productIds: [productId] },
      t.db,
    ).catch((e: Error) => e);
    const ghost = await recordRoutineBatchFor(
      session,
      { animalIds: [newId()], productIds: [productId] },
      t.db,
    ).catch((e: Error) => e);
    // Mixing one foreign id into a real batch must take the whole batch down.
    const mixed = await recordRoutineBatchFor(
      session,
      { animalIds: [mine, rival.animalId], productIds: [productId] },
      t.db,
    ).catch((e: Error) => e);

    expect((foreign as Error).message).toBe((ghost as Error).message);
    expect((mixed as Error).message).toBe("That animal was not found.");
    expect(await t.raw.select().from(s.healthEvent)).toHaveLength(0);
    await t.close();
  });

  it("never returns a withdrawal status for another farm's animal", async () => {
    const t = await setup();
    const rival = await seedRivalFarm(t.raw);
    const productId = await seedProduct(t.raw, { milkWithdrawalDays: 7 });
    const mine = await seedAnimal(t.raw, { name: "Njeri" });
    await recordTreatmentFor(session, { animalId: mine, productId }, t.db);

    // The rival is genuinely under withdrawal on her own farm.
    await t.raw.insert(s.healthEvent).values({
      id: newId(),
      farmId: OTHER_FARM,
      animalId: rival.animalId,
      eventType: "TREATMENT",
      occurredOn: NOW,
      milkClearAt: new Date(`${addDays(NOW, 5)}T00:00:00.000Z`),
      recordedBy: newId(),
    });

    const map = await getWithdrawalStatus(session, [mine, rival.animalId], NOW, t.db);
    expect(map.has(rival.animalId)).toBe(false);
    expect(map.get(mine)!.milkBlocked).toBe(true);

    const board = await withdrawalBoard(session, NOW, t.db);
    expect(board.map((r) => r.animalId)).not.toContain(rival.animalId);
    await t.close();
  });

  it("refuses a rival's animal history with the same words as a ghost", async () => {
    const t = await setup();
    const rival = await seedRivalFarm(t.raw);
    const foreign = await animalHealthHistory(session, rival.animalId, t.db).catch((e: Error) => e);
    const ghost = await animalHealthHistory(session, newId(), t.db).catch((e: Error) => e);
    expect((foreign as Error).message).toBe((ghost as Error).message);
    expect((foreign as Error).message).toBe("That animal was not found.");
    await t.close();
  });

  it("a session with a genuinely null farmId reaches nothing", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Njeri" });
    const productId = await seedProduct(t.raw);
    // Built by hand: `fakeSession({ farmId: null })` quietly substitutes FARM_ID.
    const nullFarm = { ...session, farmId: null as unknown as string };

    const r = await recordTreatmentFor(nullFarm, { animalId, productId }, t.db).catch(
      (e: Error) => e,
    );
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toBe("That animal was not found.");
    expect(await getWithdrawalStatus(nullFarm, [animalId], NOW, t.db)).toHaveLength(0);
    await t.close();
  });
});

/* ================================================================== */
/* 2. THE WITHDRAWAL RULE                                              */
/* ================================================================== */

describe("withdrawal arithmetic", () => {
  it("is clear ON the clear date and blocked the day before (off-by-one)", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Njeri" });
    const productId = await seedProduct(t.raw, { milkWithdrawalDays: 7 });
    await recordTreatmentFor(session, { animalId, productId, occurredOn: "2026-08-01" }, t.db);
    // 1 Aug + 7 = 8 Aug.
    const before = await getWithdrawalStatus(session, [animalId], "2026-08-07", t.db);
    const on = await getWithdrawalStatus(session, [animalId], "2026-08-08", t.db);
    expect(before.get(animalId)!.milkBlocked).toBe(true);
    expect(on.get(animalId)!.milkBlocked).toBe(false);
    expect(on.get(animalId)!.message).toBeNull();
    await t.close();
  });

  it("a zero-day withdrawal is clear the same day — and is NOT the same as unknown", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Njeri" });
    const zero = await seedProduct(t.raw, { name: "Ivermectin pour-on", milkWithdrawalDays: 0 });
    await recordTreatmentFor(session, { animalId, productId: zero, occurredOn: "2026-08-01" }, t.db);
    const st = await getWithdrawalStatus(session, [animalId], "2026-08-01", t.db);
    expect(st.get(animalId)!.milkBlocked).toBe(false);
    expect(st.get(animalId)!.unknownPeriod).toBe(false);
    await t.close();
  });

  it("keeps an unknown period UNKNOWN — never zero, never clear", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Muthoni" });
    const created = await createProductFor(
      session,
      { name: "Unlabelled penicillin", productType: "ANTIBIOTIC" },
      t.db,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.warnings.join(" ")).toContain("No milk withdrawal period");

    const r = await recordTreatmentFor(
      session,
      { animalId, productId: created.data.id, occurredOn: NOW },
      t.db,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.milkClearOn).toBeNull();
    expect(r.data.warnings.join(" ")).toContain("No milk withdrawal period");

    const st = await getWithdrawalStatus(session, [animalId], NOW, t.db);
    expect(st.get(animalId)!.unknownPeriod).toBe(true);
    expect(st.get(animalId)!.unknownMessage).toContain("Check the label");
    expect(await withdrawalBoard(session, NOW, t.db)).toHaveLength(1);
    await t.close();
  });

  it("an earlier treatment with a LATER clear date beats a newer short one", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Wairimu" });
    const long = await seedProduct(t.raw, { name: "Penstrep LA", milkWithdrawalDays: 30 });
    const short = await seedProduct(t.raw, { name: "Multivitamin", milkWithdrawalDays: 1 });

    await recordTreatmentFor(session, { animalId, productId: long, occurredOn: "2026-08-01" }, t.db);
    await recordTreatmentFor(session, { animalId, productId: short, occurredOn: "2026-08-10" }, t.db);

    const st = await getWithdrawalStatus(session, [animalId], "2026-08-12", t.db);
    expect(st.get(animalId)!.milkClearOn).toBe("2026-08-31");
    expect(st.get(animalId)!.milkBlocked).toBe(true);
    await t.close();
  });

  it("a multi-day course withdraws from the LAST dose, not the first", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Njeri" });
    const productId = await seedProduct(t.raw, { milkWithdrawalDays: 4 });
    const r = await recordTreatmentFor(
      session,
      { animalId, productId, occurredOn: "2026-08-01", durationDays: 5 },
      t.db,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.treatmentEndOn).toBe("2026-08-05");
    expect(r.data.milkClearOn).toBe("2026-08-09");
    await t.close();
  });
});

describe("dry cow therapy — the later-of rule", () => {
  it("extends to calving + 96 hours when she calves long after the infusion", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Nyambura" });
    const tube = await seedProduct(t.raw, {
      name: "Cephalonium dry cow tube",
      productType: "INTRAMAMMARY",
      milkWithdrawalDays: 1,
      notForLactating: true,
    });
    await recordDryCowTherapyFor(session, { animalId, productId: tube, occurredOn: "2026-01-01" }, t.db);

    // Infusion + 30 = 31 Jan. She calves 55 days later, on 25 Feb.
    await t.raw.insert(s.calving).values({
      id: newId(),
      farmId: FARM_ID,
      damId: animalId,
      calvedOn: "2026-02-25",
      recordedBy: session.userId,
    });

    // The 30-day leg has long passed, but 96 hours after calving has not.
    const day31 = await getWithdrawalStatus(session, [animalId], "2026-02-26", t.db);
    expect(day31.get(animalId)!.milkBlocked).toBe(true);
    expect(day31.get(animalId)!.milkClearOn).toBe("2026-03-01");

    const clear = await getWithdrawalStatus(session, [animalId], "2026-03-01", t.db);
    expect(clear.get(animalId)!.milkBlocked).toBe(false);
    await t.close();
  });

  it("does not let a calving BEFORE the infusion shorten anything", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Wangari" });
    const tube = await seedProduct(t.raw, {
      name: "Dry cow tube",
      productType: "INTRAMAMMARY",
      milkWithdrawalDays: 1,
      notForLactating: true,
    });
    // She calved in November; she was dried off and infused in June the year after.
    await t.raw.insert(s.calving).values({
      id: newId(),
      farmId: FARM_ID,
      damId: animalId,
      calvedOn: "2025-11-01",
      recordedBy: session.userId,
    });
    await recordDryCowTherapyFor(session, { animalId, productId: tube, occurredOn: "2026-06-01" }, t.db);

    const st = await getWithdrawalStatus(session, [animalId], "2026-06-20", t.db);
    expect(st.get(animalId)!.milkClearOn).toBe("2026-07-01"); // infusion + 30
    await t.close();
  });

  it("refuses to treat an ordinary antibiotic as dry cow therapy", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Njeri" });
    const ordinary = await seedProduct(t.raw, { milkWithdrawalDays: 7 });
    const r = await recordDryCowTherapyFor(session, { animalId, productId: ordinary }, t.db);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("not for lactating cows");
    await t.close();
  });
});

describe("timezone: a date column and a timestamp column disagreeing", () => {
  it("truncates a non-midnight clear timestamp to its date, losing up to 24 hours", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Njeri" });
    // Nothing in the module writes this, but the column allows it and any future
    // "clear at 6pm" write would silently become "clear at midnight".
    await t.raw.insert(s.healthEvent).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      eventType: "TREATMENT",
      occurredOn: "2026-08-01",
      treatmentEndOn: "2026-08-01",
      milkClearAt: new Date("2026-08-08T18:00:00.000Z"),
      recordedBy: session.userId,
    });
    const st = await getWithdrawalStatus(session, [animalId], "2026-08-08", t.db);
    // The 18:00 is dropped: she reads clear from 00:00 on the 8th.
    expect(st.get(animalId)!.milkBlocked).toBe(false);
    await t.close();
  });

  it("DIVERGENCE: milk.ts judges by the instant, health.ts by the calendar day", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Njeri" });
    // Clear late TODAY. The two engines answer differently for the same cow.
    await t.raw.insert(s.healthEvent).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      eventType: "TREATMENT",
      occurredOn: addDays(NOW, -7),
      treatmentEndOn: addDays(NOW, -7),
      milkClearAt: new Date(`${NOW}T23:59:59.000Z`),
      recordedBy: session.userId,
    });

    const health = await getWithdrawalStatus(session, [animalId], NOW, t.db);
    const milk = await withdrawalMap(t.raw, FARM_ID);

    // health: clear (clearOn === asOf). milk: blocked (timestamp still ahead).
    expect(health.get(animalId)!.milkBlocked).toBe(false);
    expect(milk.has(animalId)).toBe(true);
    await t.close();
  });
});

/* ================================================================== */
/* 3. THE TWO IRREVERSIBLE VACCINE RULES                               */
/* ================================================================== */

describe("S19 and ECF-ITM: the refusals that must hold", () => {
  it("refuses S19 to a bull calf and to a heifer who has already had it", async () => {
    const t = await setup();
    const bull = await seedAnimal(t.raw, {
      name: "Kimani",
      tag: "KE-B1",
      sex: "M",
      dateOfBirth: addDays(NOW, -150),
    });
    const heifer = await seedAnimal(t.raw, {
      name: "Wambui",
      tag: "KE-H1",
      dateOfBirth: addDays(NOW, -150),
    });

    const male = await recordVaccinationFor(session, { animalId: bull, routine: "S19" }, t.db);
    expect(male.ok).toBe(false);
    if (!male.ok) expect(male.error).toContain("females only");

    const first = await recordVaccinationFor(session, { animalId: heifer, routine: "S19" }, t.db);
    expect(first.ok).toBe(true);
    const second = await recordVaccinationFor(session, { animalId: heifer, routine: "S19" }, t.db);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain("once in a lifetime");
    await t.close();
  });

  it("holds the 4–8 month window at exactly 120, 240 and 241 days", async () => {
    const t = await setup();
    const mk = async (tag: string, ageDays: number) =>
      seedAnimal(t.raw, { name: tag, tag, dateOfBirth: addDays(NOW, -ageDays) });

    const d119 = await mk("KE-119", 119);
    const d120 = await mk("KE-120", 120);
    const d240 = await mk("KE-240", 240);
    const d241 = await mk("KE-241", 241);

    expect((await recordVaccinationFor(session, { animalId: d119, routine: "S19" }, t.db)).ok).toBe(false);
    expect((await recordVaccinationFor(session, { animalId: d120, routine: "S19" }, t.db)).ok).toBe(true);
    expect((await recordVaccinationFor(session, { animalId: d240, routine: "S19" }, t.db)).ok).toBe(true);
    expect((await recordVaccinationFor(session, { animalId: d241, routine: "S19" }, t.db)).ok).toBe(false);
    await t.close();
  });

  it("warns rather than blocks when her age is not recorded", async () => {
    const t = await setup();
    const boughtIn = await seedAnimal(t.raw, { name: "Unknown age", dateOfBirth: null });
    const r = await recordVaccinationFor(session, { animalId: boughtIn, routine: "S19" }, t.db);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.warnings.join(" ")).toContain("age is not recorded");
    await t.close();
  });

  it.fails(
    "DEFECT: the routine BATCH bypasses once-for-life and the sex restriction entirely",
    async () => {
      const t = await setup();
      const bull = await seedAnimal(t.raw, {
        name: "Kimani",
        tag: "KE-B1",
        sex: "M",
        dateOfBirth: addDays(NOW, -900),
      });
      const heifer = await seedAnimal(t.raw, {
        name: "Wambui",
        tag: "KE-H1",
        dateOfBirth: addDays(NOW, -150),
      });
      const vaccine = await seedProduct(t.raw, {
        name: "Brucella S19",
        productType: "VACCINE",
        milkWithdrawalDays: 0,
      });

      // Same code path a mass-campaign day would use — and it checks nothing.
      const r1 = await recordRoutineBatchFor(
        session,
        {
          animalIds: [bull, heifer],
          productIds: [vaccine],
          eventType: "VACCINATION",
          routine: "S19",
        },
        t.db,
      );
      const r2 = await recordRoutineBatchFor(
        session,
        {
          batchId: newId(),
          animalIds: [heifer],
          productIds: [vaccine],
          eventType: "VACCINATION",
          routine: "S19",
        },
        t.db,
      );

      // A three-year-old bull must never receive S19, and no animal twice.
      const events = await t.raw
        .select()
        .from(s.healthEvent)
        .where(and(eq(s.healthEvent.farmId, FARM_ID), eq(s.healthEvent.diagnosis, "S19")));
      expect(r1.ok && r2.ok).toBe(true);
      expect(events.filter((e) => e.animalId === bull)).toHaveLength(0);
      expect(events.filter((e) => e.animalId === heifer)).toHaveLength(1);
      await t.close();
    },
  );

  it.fails(
    "DEFECT: a free-text diagnosis of 'S19' on a treatment blocks the real S19 dose",
    async () => {
      const t = await setup();
      const heifer = await seedAnimal(t.raw, { name: "Wambui", dateOfBirth: addDays(NOW, -150) });
      const productId = await seedProduct(t.raw, { milkWithdrawalDays: 7 });

      // A vet writing "S19" in the diagnosis box of an ordinary treatment.
      await recordTreatmentFor(
        session,
        { animalId: heifer, productId, diagnosis: "S19", occurredOn: addDays(NOW, -3) },
        t.db,
      );

      // The routine key and free-text diagnosis share one column, so this now
      // counts as a prior dose and she can never be vaccinated.
      const r = await recordVaccinationFor(session, { animalId: heifer, routine: "S19" }, t.db);
      expect(r.ok).toBe(true);
      await t.close();
    },
  );
});

/* ================================================================== */
/* 4. R4 — WARN, NEVER BLOCK                                           */
/* ================================================================== */

describe("R4 in a module allowed exactly one hard block", () => {
  it("saves a not-for-lactating product given to a milking cow, loudly warned", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Njeri" });
    await t.raw.insert(s.milkRecord).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      recordedOn: addDays(NOW, -1),
      session: "MORNING",
      litres: "12.50",
      recordedBy: session.userId,
      recordedAt: new Date(),
    });
    const tube = await seedProduct(t.raw, {
      name: "Dry cow tube",
      productType: "INTRAMAMMARY",
      milkWithdrawalDays: 1,
      notForLactating: true,
    });
    const r = await recordTreatmentFor(session, { animalId, productId: tube }, t.db);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.warnings.join(" ")).toContain("NOT for a cow in milk");
    expect(await t.raw.select().from(s.healthEvent)).toHaveLength(1);
    await t.close();
  });

  it("takes a 10,000-character note, emoji and SQL-shaped text without complaint", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Njeri 🐄" });
    const signs =
      "Ng'ombe hataki kula 🐄'); DROP TABLE health_event;-- " + "swollen right hind quarter, ".repeat(400);
    const r = await recordObservationFor(session, { animalId, signs }, t.db);
    expect(r.ok).toBe(true);
    const rows = await t.raw.select().from(s.healthEvent);
    expect(rows).toHaveLength(1);
    expect(rows[0].signs!.length).toBeGreaterThan(10_000);
    // The alert repeats the whole thing; it is stored, not truncated.
    expect(await t.raw.select().from(s.alert)).toHaveLength(1);
    await t.close();
  });

  it("an observation with no words at all is REFUSED (documented; the only content it has)", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Njeri" });
    const r = await recordObservationFor(session, { animalId, signs: "   \t\n  " }, t.db);
    // Debatable under R4: nothing else in the system rejects a routine capture.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("Say what you can see — even one word.");
    await t.close();
  });

  it.fails("DEFECT: a mistyped cost throws a raw database error and loses the treatment", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Njeri" });
    const productId = await seedProduct(t.raw, { milkWithdrawalDays: 7 });

    // A thumb on the keypad in the cost box. The clinical record must survive:
    // the withdrawal block is the thing that matters, not the shillings.
    const r = await recordTreatmentFor(session, { animalId, productId, costKes: 1e308 }, t.db).catch(
      (e: Error) => e,
    );
    expect(r).not.toBeInstanceOf(Error);
    expect(await t.raw.select().from(s.healthEvent)).toHaveLength(1);
    await t.close();
  });

  it("records a CMT score with advice at the moment of entry, for every score", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Njeri" });
    for (const score of ["N", "T", "1", "2", "3"] as const) {
      const r = await recordCmtFor(session, { id: newId(), animalId, score }, t.db);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.advice.length).toBeGreaterThan(0);
    }
    await t.close();
  });

  it("a treatment on an animal that already left the herd is not refused (documented)", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Njeri" });
    await t.raw.insert(s.animalExit).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      exitDate: addDays(NOW, -30),
      reason: "SOLD",
      recordedBy: session.userId,
    });
    const productId = await seedProduct(t.raw, { milkWithdrawalDays: 7 });
    const r = await recordTreatmentFor(session, { animalId, productId }, t.db);
    // No exit check anywhere in the treatment path. Warn-not-block is right,
    // but there is no warning either — a sold cow can be treated silently.
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.warnings.join(" ")).not.toContain("left the herd");
    await t.close();
  });
});

/* ================================================================== */
/* 5. GROUP RESOLUTION                                                 */
/* ================================================================== */

describe("group batches", () => {
  it.fails(
    "DEFECT: a heifer with no recorded birth date is silently missed by a HEIFERS batch",
    async () => {
      const t = await setup();
      const known = await seedAnimal(t.raw, {
        name: "Wambui",
        tag: "KE-H1",
        dateOfBirth: addDays(NOW, -400),
      });
      // Bought in at a market with no papers — the commonest Kenyan case.
      const unknownAge = await seedAnimal(t.raw, {
        name: "Nyakio",
        tag: "KE-H2",
        dateOfBirth: null,
        origin: "PURCHASED",
      });
      const dip = await seedProduct(t.raw, {
        name: "Amitraz dip",
        productType: "ACARICIDE",
        milkWithdrawalDays: 0,
      });

      const r = await recordRoutineBatchFor(
        session,
        { group: "HEIFERS", productIds: [dip], eventType: "DIPPING" },
        t.db,
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // "so a batch never silently misses an animal" — health.ts:1080.
      const dipped = (await t.raw.select().from(s.healthEvent)).map((e) => e.animalId);
      expect(dipped).toContain(known);
      expect(dipped).toContain(unknownAge);
      await t.close();
    },
  );

  it("refuses a batch with no product rather than writing an empty pass", async () => {
    const t = await setup();
    await seedAnimal(t.raw, { name: "Njeri" });
    const r = await recordRoutineBatchFor(session, { group: "ALL", productIds: [] }, t.db);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Pick at least one product.");
    await t.close();
  });

  it("does not crash on an animal with no birth date when listing what is due", async () => {
    const t = await setup();
    await seedAnimal(t.raw, { name: "Nyakio", dateOfBirth: null });
    const due = await dueRoutines(session, NOW, t.db);
    expect(Array.isArray(due)).toBe(true);
    // Every routine falls due immediately for an animal of unknown age.
    expect(due.length).toBeGreaterThan(0);
    await t.close();
  });
});

/* ================================================================== */
/* 6. IDEMPOTENCY UNDER REPLAY                                         */
/* ================================================================== */

describe("offline replay", () => {
  it("three flushes of one observation leave one event, one alert and one receipt", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Njeri" });
    const id = newId();
    const input = { id, animalId, signs: "Not eating, swollen left hind quarter" };

    const r1 = await recordObservationFor(session, input, t.db);
    const r2 = await recordObservationFor(session, input, t.db);
    const r3 = await recordObservationFor(session, input, t.db);
    expect(r1.ok && r2.ok && r3.ok).toBe(true);
    if (!r1.ok || !r2.ok || !r3.ok) return;
    expect(r1.refCode).toBe(r2.refCode);
    expect(r2.refCode).toBe(r3.refCode);

    expect(await t.raw.select().from(s.healthEvent)).toHaveLength(1);
    expect(await t.raw.select().from(s.alert)).toHaveLength(1);
    expect(await t.raw.select().from(s.receipt)).toHaveLength(1);
    await t.close();
  });

  it("two simultaneous flushes of one observation still leave one of everything", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Njeri" });
    const input = { id: newId(), animalId, signs: "Limping on the near fore" };

    const [a, b] = await Promise.all([
      recordObservationFor(session, input, t.db),
      recordObservationFor(session, input, t.db),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(await t.raw.select().from(s.healthEvent)).toHaveLength(1);
    expect(await t.raw.select().from(s.alert)).toHaveLength(1);
    expect(await t.raw.select().from(s.receipt)).toHaveLength(1);
    await t.close();
  });

  it("does not dip sixty cows twice when the same batch is flushed three times", async () => {
    const t = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      ids.push(await seedAnimal(t.raw, { name: `Cow${i}`, tag: `KE-${i}` }));
    }
    const dip = await seedProduct(t.raw, {
      name: "Amitraz dip",
      productType: "ACARICIDE",
      milkWithdrawalDays: 0,
    });
    const batchId = newId();
    const input = { batchId, animalIds: ids, productIds: [dip], eventType: "DIPPING" as const };

    const r1 = await recordRoutineBatchFor(session, input, t.db);
    const r2 = await recordRoutineBatchFor(session, input, t.db);
    const r3 = await recordRoutineBatchFor(session, input, t.db);
    expect(r1.ok && r2.ok && r3.ok).toBe(true);
    if (!r1.ok || !r2.ok || !r3.ok) return;
    expect(r1.data.eventsWritten).toBe(6);
    expect(r2.data.eventsWritten).toBe(0);
    expect(r1.refCode).toBe(r3.refCode);
    expect(await t.raw.select().from(s.healthEvent)).toHaveLength(6);
    expect(await t.raw.select().from(s.receipt)).toHaveLength(1);
    // The row ids really are derived, not random.
    expect(await t.raw.select().from(s.healthEvent).where(eq(s.healthEvent.id, stableId(batchId, ids[0], dip)))).toHaveLength(1);
    await t.close();
  });

  it("two simultaneous flushes of one batch still dip the herd once", async () => {
    const t = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(await seedAnimal(t.raw, { name: `Cow${i}`, tag: `KE-${i}` }));
    }
    const dip = await seedProduct(t.raw, {
      name: "Amitraz dip",
      productType: "ACARICIDE",
      milkWithdrawalDays: 0,
    });
    const input = { batchId: newId(), animalIds: ids, productIds: [dip] };
    const [a, b] = await Promise.all([
      recordRoutineBatchFor(session, input, t.db),
      recordRoutineBatchFor(session, input, t.db),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(await t.raw.select().from(s.healthEvent)).toHaveLength(4);
    expect(await t.raw.select().from(s.receipt)).toHaveLength(1);
    await t.close();
  });

  it("a treatment with no client id is NOT idempotent — the withdrawal doubles up", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.raw, { name: "Njeri" });
    const productId = await seedProduct(t.raw, { milkWithdrawalDays: 7 });
    await recordTreatmentFor(session, { animalId, productId }, t.db);
    await recordTreatmentFor(session, { animalId, productId }, t.db);
    // Documented: replay safety depends entirely on the caller supplying `id`.
    expect(await t.raw.select().from(s.healthEvent)).toHaveLength(2);
    expect(await t.raw.select().from(s.receipt)).toHaveLength(2);
    await t.close();
  });
});

/* ================================================================== */
/* 7. ALERTS THAT NEVER GO AWAY                                        */
/* ================================================================== */

describe("the Herdwatch failure: items that stick forever", () => {
  it.fails(
    "DEFECT: a health observation alert has no resolution path and stays open for ever",
    async () => {
      const t = await setup();
      const animalId = await seedAnimal(t.raw, { name: "Njeri" });
      await recordObservationFor(
        session,
        { animalId, signs: "Off her feed", occurredOn: addDays(NOW, -400) },
        t.db,
      );
      // She was treated, recovered, and is fine a year later.
      const productId = await seedProduct(t.raw, { milkWithdrawalDays: 7 });
      await recordTreatmentFor(
        session,
        { animalId, productId, occurredOn: addDays(NOW, -399) },
        t.db,
      );

      const open = (await t.raw.select().from(s.alert)).filter((a) => a.resolvedAt == null);
      expect(open).toHaveLength(0);
      await t.close();
    },
  );

  it.fails(
    "DEFECT: the WITHDRAWAL_CLEAR alert is never resolved once the milk is clear",
    async () => {
      const t = await setup();
      const animalId = await seedAnimal(t.raw, { name: "Njeri" });
      const productId = await seedProduct(t.raw, { milkWithdrawalDays: 7 });
      await recordTreatmentFor(
        session,
        { animalId, productId, occurredOn: addDays(NOW, -365) },
        t.db,
      );
      // A year on, her milk has been clear for 358 days.
      const st = await getWithdrawalStatus(session, [animalId], NOW, t.db);
      expect(st.get(animalId)!.milkBlocked).toBe(false);

      const open = (await t.raw.select().from(s.alert)).filter(
        (a) => a.kind === "WITHDRAWAL_CLEAR" && a.resolvedAt == null,
      );
      expect(open).toHaveLength(0);
      await t.close();
    },
  );
});
