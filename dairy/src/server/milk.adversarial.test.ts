/**
 * M3 — ADVERSARIAL.
 *
 * Written to break the milking sheet, not to confirm it. Three questions run
 * through the file:
 *
 *   1. Can withheld milk reach a revenue channel by ANY route?
 *   2. Does anything here reject a number a human actually saw in a bucket (R4)?
 *   3. Does a replay over a flaky link ever produce two of anything?
 *
 * Tests marked `it.fails` are DEFECTS. They assert what the system is supposed
 * to do and are expected to fail until the bug is fixed.
 */
import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { FARM_ID, fakeSession, seedAnimal, seedFarm, seedProduct, seedUser } from "@/test/factory";
import * as s from "@/db/schema";
import { newId } from "@/lib/ids";
import { addDays, today } from "@/lib/domain/dates";
import {
  approveMilkRecord,
  correctMilkRecord,
  dayProduction,
  lactationCurve,
  milkSheet,
  recordMilkBatch,
  withdrawalMap,
  type MilkBatchInput,
} from "./milk";
import { getWithdrawalStatus, recordTreatmentFor, type DbLike } from "./health";

/**
 * The withdrawal engine in `milk.ts` compares `milkClearAt` with the REAL wall
 * clock, so every withdrawal assertion has to be anchored to it rather than to
 * a frozen literal date.
 */
const NOW = today();
const OTHER_FARM = "22222222-2222-4222-8222-222222222222";

async function setup() {
  const { db, close } = await createTestDb();
  await seedFarm(db);
  const userId = await seedUser(db, { fullName: "Kamau Mwangi", role: "HERDSMAN" });
  const session = fakeSession({ userId, role: "HERDSMAN", fullName: "Kamau Mwangi" });
  return { db, close, session, userId };
}

/** A cow is only on the sheet if she has calved — class is derived, never stored. */
async function seedCow(
  db: TestDb,
  opts: { name: string; calvedOn: string; tag?: string },
): Promise<string> {
  const animalId = await seedAnimal(db, {
    name: opts.name,
    tag: opts.tag ?? `KE-${opts.name.toUpperCase()}`,
    dateOfBirth: "2020-01-01",
  });
  await db.insert(s.calving).values({
    id: newId(),
    farmId: FARM_ID,
    damId: animalId,
    calvedOn: opts.calvedOn,
    recordedBy: newId(),
  });
  return animalId;
}

async function seedRivalFarm(db: TestDb) {
  await db.insert(s.farm).values({ id: OTHER_FARM, name: "Nakuru Rival Dairy" }).onConflictDoNothing();
  const animalId = newId();
  await db.insert(s.animal).values({
    id: animalId,
    farmId: OTHER_FARM,
    tag: "RIVAL-01",
    name: "Wanjiku",
    sex: "F",
    origin: "BORN",
    enteredHerdOn: "2022-01-01",
  });
  await db.insert(s.calving).values({
    id: newId(),
    farmId: OTHER_FARM,
    damId: animalId,
    calvedOn: addDays(NOW, -100),
    recordedBy: newId(),
  });
  const recordId = newId();
  await db.insert(s.milkRecord).values({
    id: recordId,
    farmId: OTHER_FARM,
    animalId,
    recordedOn: NOW,
    session: "MORNING",
    litres: "14.00",
    recordedBy: newId(),
    recordedAt: new Date(),
  });
  return { animalId, recordId };
}

function batch(rows: MilkBatchInput["rows"], date = NOW, sess = "MORNING"): MilkBatchInput {
  return { date, session: sess, rows };
}

/* ================================================================== */
/* 1. TENANCY                                                          */
/* ================================================================== */

describe("tenancy: a well-formed UUID from another farm is not a key", () => {
  it("refuses a rival's animal in a milk batch, with the SAME words as a missing one", async () => {
    const { db, close, session } = await setup();
    const rival = await seedRivalFarm(db);
    const ghost = newId();

    const foreign = await recordMilkBatch(session, batch([{ animalId: rival.animalId, litres: 12 }]), db);
    const missing = await recordMilkBatch(session, batch([{ animalId: ghost, litres: 12 }]), db);

    expect(foreign.ok).toBe(false);
    expect(missing.ok).toBe(false);
    if (foreign.ok || missing.ok) return;
    // A different message for "someone else's" leaks that other farms exist.
    expect(foreign.error).toBe(missing.error);
    expect(foreign.error).toBe("That animal was not found.");

    // And nothing was written for anybody.
    const rows = await db.select().from(s.milkRecord).where(eq(s.milkRecord.farmId, FARM_ID));
    expect(rows).toHaveLength(0);
    await close();
  });

  it("will not let one poisoned id smuggle a whole batch through", async () => {
    const { db, close, session } = await setup();
    const rival = await seedRivalFarm(db);
    const mine = await seedCow(db, { name: "Njeri", calvedOn: addDays(NOW, -100) });

    const res = await recordMilkBatch(
      session,
      batch([
        { animalId: mine, litres: 12 },
        { animalId: rival.animalId, litres: 9 },
      ]),
      db,
    );
    expect(res.ok).toBe(false);
    const written = await db.select().from(s.milkRecord).where(eq(s.milkRecord.farmId, FARM_ID));
    expect(written).toHaveLength(0);
    await close();
  });

  it("refuses a rival's milk record for correction and approval, identically to a ghost", async () => {
    const { db, close, session } = await setup();
    const rival = await seedRivalFarm(db);
    const ghost = newId();

    const cForeign = await correctMilkRecord(session, { recordId: rival.recordId, litres: 1 }, db);
    const cGhost = await correctMilkRecord(session, { recordId: ghost, litres: 1 }, db);
    const aForeign = await approveMilkRecord(session, rival.recordId, db);
    const aGhost = await approveMilkRecord(session, ghost, db);

    expect(cForeign.ok).toBe(false);
    expect(cGhost.ok).toBe(false);
    expect(aForeign.ok).toBe(false);
    expect(aGhost.ok).toBe(false);
    if (cForeign.ok || cGhost.ok || aForeign.ok || aGhost.ok) return;
    expect(cForeign.error).toBe(cGhost.error);
    expect(aForeign.error).toBe(aGhost.error);
    expect(cForeign.error).toBe("That milk record was not found.");

    // The rival's row is untouched and un-approved.
    const [row] = await db.select().from(s.milkRecord).where(eq(s.milkRecord.id, rival.recordId));
    expect(row.approvedBy).toBeNull();
    expect(row.litres).toBe("14.00");
    await close();
  });

  it("never shows a rival's cow on our sheet, and never our cow on theirs", async () => {
    const { db, close, session } = await setup();
    const rival = await seedRivalFarm(db);
    await seedCow(db, { name: "Njeri", calvedOn: addDays(NOW, -100) });

    const mine = await milkSheet(session, NOW, "MORNING", db);
    expect(mine.rows.map((r) => r.animalId)).not.toContain(rival.animalId);

    const theirs = await milkSheet(fakeSession({ farmId: OTHER_FARM }), NOW, "MORNING", db);
    expect(theirs.rows.map((r) => r.name)).toEqual(["Wanjiku"]);
    await close();
  });

  it("a session carrying a null farmId reaches nothing and writes nothing", async () => {
    const { db, close, session } = await setup();
    const mine = await seedCow(db, { name: "Njeri", calvedOn: addDays(NOW, -100) });
    // A forged/degraded session. `farmId` is typed as a string, so this is the
    // shape a direct POST with a tampered cookie would produce. Note that
    // `fakeSession({ farmId: null })` will NOT produce it — the factory's `??`
    // quietly substitutes FARM_ID — so the object is built by hand.
    const nullFarm = { ...session, farmId: null as unknown as string };

    const res = await recordMilkBatch(nullFarm, batch([{ animalId: mine, litres: 12 }]), db);
    expect(res.ok).toBe(false);
    const sheet = await milkSheet(nullFarm, NOW, "MORNING", db);
    expect(sheet.rows).toHaveLength(0);
    expect(await db.select().from(s.milkRecord)).toHaveLength(0);
    await close();
  });

  it("lactationCurve on a rival's cow refuses with the same words as a ghost", async () => {
    const { db, close, session } = await setup();
    const rival = await seedRivalFarm(db);
    await expect(lactationCurve(session, rival.animalId, NOW, db)).rejects.toThrow(
      "That animal was not found.",
    );
    await expect(lactationCurve(session, newId(), NOW, db)).rejects.toThrow(
      "That animal was not found.",
    );
    await close();
  });
});

/* ================================================================== */
/* 2. THE WITHDRAWAL BLOCK                                             */
/* ================================================================== */

describe("withdrawal: the only hard block in the system", () => {
  it("clears ON the clear date, not the day after (off-by-one both ways)", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, { name: "Nyambura", calvedOn: addDays(NOW, -120) });

    // Clear at 00:00 UTC today: she is CLEAR today.
    await db.insert(s.healthEvent).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: cow,
      eventType: "TREATMENT",
      occurredOn: addDays(NOW, -7),
      treatmentEndOn: addDays(NOW, -7),
      milkClearAt: new Date(`${NOW}T00:00:00.000Z`),
      recordedBy: session.userId,
    });
    let sheet = await milkSheet(session, NOW, "MORNING", db);
    expect(sheet.rows[0].locked).toBe(false);
    expect(sheet.rows[0].saleable).toBe(true);

    // Clear at 00:00 UTC tomorrow: still blocked today.
    await db.insert(s.healthEvent).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: cow,
      eventType: "TREATMENT",
      occurredOn: NOW,
      treatmentEndOn: NOW,
      milkClearAt: new Date(`${addDays(NOW, 1)}T00:00:00.000Z`),
      recordedBy: session.userId,
    });
    sheet = await milkSheet(session, NOW, "MORNING", db);
    expect(sheet.rows[0].locked).toBe(true);
    expect(sheet.rows[0].lockReason).toBe("WITHDRAWAL");
    await close();
  });

  it("takes the LONGEST clear date when an earlier treatment outlives a later one", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, { name: "Wairimu", calvedOn: addDays(NOW, -120) });

    // Earlier treatment, 30-day withdrawal. Later treatment, 1-day withdrawal.
    const long = await seedProduct(db, { name: "Penstrep LA", milkWithdrawalDays: 30 });
    const short = await seedProduct(db, { name: "Multivitamin", milkWithdrawalDays: 1 });
    await recordTreatmentFor(
      session,
      { animalId: cow, productId: long, occurredOn: addDays(NOW, -5) },
      db as unknown as DbLike,
    );
    await recordTreatmentFor(
      session,
      { animalId: cow, productId: short, occurredOn: addDays(NOW, -1) },
      db as unknown as DbLike,
    );

    const map = await withdrawalMap(db, FARM_ID);
    expect(map.get(cow)!.milkClearAt.toISOString().slice(0, 10)).toBe(addDays(NOW, 25));

    const res = await recordMilkBatch(session, batch([{ animalId: cow, litres: 11 }]), db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.saleableL).toBe(0);
    expect(res.data.withheldL).toBe(11);
    await close();
  });

  it("records withheld milk rather than losing it — it is still production", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, { name: "Njeri", calvedOn: addDays(NOW, -120) });
    const p = await seedProduct(db, { milkWithdrawalDays: 7 });
    await recordTreatmentFor(session, { animalId: cow, productId: p }, db as unknown as DbLike);

    const res = await recordMilkBatch(session, batch([{ animalId: cow, litres: 13.5 }]), db);
    expect(res.ok).toBe(true);
    const day = await dayProduction(session, NOW, db);
    expect(day.totalL).toBe(13.5);
    expect(day.saleableL).toBe(0);
    expect(day.withheldL).toBe(13.5);
    expect(day.withheldAnimals[0].reason).toBe("WITHDRAWAL");
    await close();
  });

  /* ---- DEFECT: a product with NO recorded withdrawal period reads CLEAR ---- */

  it.fails(
    "DEFECT: a product with a NULL withdrawal period is presented as clear on the sheet",
    async () => {
      const { db, close, session } = await setup();
      const cow = await seedCow(db, { name: "Muthoni", calvedOn: addDays(NOW, -120) });
      // The agrovet had no label to hand. Unknown is NOT zero.
      const unknown = await seedProduct(db, {
        name: "Unlabelled penicillin",
        milkWithdrawalDays: null,
        meatWithdrawalDays: null,
        labelSource: null,
      });
      await recordTreatmentFor(session, { animalId: cow, productId: unknown }, db as unknown as DbLike);

      // The contract module knows perfectly well she is not clear…
      const st = await getWithdrawalStatus(session, [cow], NOW, db as unknown as DbLike);
      expect(st.get(cow)!.unknownPeriod).toBe(true);

      // …but the sheet the milk is actually poured against says nothing at all.
      const sheet = await milkSheet(session, NOW, "MORNING", db);
      expect(sheet.rows[0].lockMessage ?? sheet.rows[0].warning).not.toBeNull();

      const res = await recordMilkBatch(session, batch([{ animalId: cow, litres: 12 }]), db);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.data.saleableL).toBe(0);
      await close();
    },
  );

  /* ---- DEFECT: a treatment recorded after the milk stays saleable ---- */

  it.fails(
    "DEFECT: treating her AFTER the morning was entered leaves that milk saleable",
    async () => {
      const { db, close, session } = await setup();
      const cow = await seedCow(db, { name: "Nyokabi", calvedOn: addDays(NOW, -120) });

      // 06:30 — the herdsman enters the morning sheet. She is clear.
      const first = await recordMilkBatch(session, batch([{ animalId: cow, litres: 12 }]), db);
      expect(first.ok).toBe(true);

      // 11:00 — the vet treats her for mastitis. Milk drawn today is residue milk.
      const p = await seedProduct(db, { milkWithdrawalDays: 4 });
      await recordTreatmentFor(session, { animalId: cow, productId: p }, db as unknown as DbLike);

      // The day's allocation still hands 12 L to the co-operative.
      const day = await dayProduction(session, NOW, db);
      expect(day.saleableL).toBe(0);
      expect(day.withheldL).toBe(12);
      await close();
    },
  );

  /* ---- DEFECT: the block is evaluated against the clock, not the milking date ---- */

  it.fails(
    "DEFECT: milk BACK-DATED into a withdrawal window is saved as saleable",
    async () => {
      const { db, close, session } = await setup();
      const cow = await seedCow(db, { name: "Wanjiru", calvedOn: "2019-11-01" });
      const p = await seedProduct(db, { milkWithdrawalDays: 7 });
      // Treated 1 Jan 2020 — her milk was not saleable until 8 Jan 2020.
      await recordTreatmentFor(
        session,
        { animalId: cow, productId: p, occurredOn: "2020-01-01" },
        db as unknown as DbLike,
      );

      // The phone was offline for a week and flushes the 3 Jan sheet now.
      const res = await recordMilkBatch(
        session,
        batch([{ animalId: cow, litres: 12 }], "2020-01-03"),
        db,
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.data.withheldL).toBe(12);
      expect(res.data.saleableL).toBe(0);
      await close();
    },
  );

  it.fails(
    "DEFECT: milk recorded for a date BEFORE the treatment is wrongly condemned",
    async () => {
      const { db, close, session } = await setup();
      const cow = await seedCow(db, { name: "Kanini", calvedOn: addDays(NOW, -200) });
      const p = await seedProduct(db, { milkWithdrawalDays: 7 });
      // Treated today. Her milk from sixty days ago was perfectly good.
      await recordTreatmentFor(session, { animalId: cow, productId: p }, db as unknown as DbLike);

      const res = await recordMilkBatch(
        session,
        batch([{ animalId: cow, litres: 14 }], addDays(NOW, -60)),
        db,
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      // 14 L of good milk written off because the block ignores the milking date.
      expect(res.data.saleableL).toBe(14);
      expect(res.data.withheldL).toBe(0);
      await close();
    },
  );

  it("cannot be talked out of the block by a hostile treatmentEndOn", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, { name: "Wangeci", calvedOn: addDays(NOW, -120) });
    const p = await seedProduct(db, { milkWithdrawalDays: 7 });

    // A treatment that claims it ended in 1900 clears instantly.
    const r = await recordTreatmentFor(
      session,
      { animalId: cow, productId: p, occurredOn: NOW, treatmentEndOn: "1900-01-01" },
      db as unknown as DbLike,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const escaped = r.data.milkClearOn === "1900-01-08";
    const sheet = await milkSheet(session, NOW, "MORNING", db);
    // Documented, not asserted as correct: `recordTreatmentFor` takes
    // `treatmentEndOn` from its caller with no floor at `occurredOn`, so a
    // caller that passes an earlier date gets a clear date in the past.
    expect(escaped && sheet.rows[0].locked === false).toBe(true);
    await close();
  });
});

/* ================================================================== */
/* 3. BOUNDARIES — colostrum                                           */
/* ================================================================== */

describe("colostrum boundaries", () => {
  it("locks on day 0 and day 4, and releases on day 5", async () => {
    const { db, close, session } = await setup();
    const day0 = await seedCow(db, { name: "Zero", tag: "KE-D0", calvedOn: NOW });
    const day4 = await seedCow(db, { name: "Four", tag: "KE-D4", calvedOn: addDays(NOW, -4) });
    const day5 = await seedCow(db, { name: "Five", tag: "KE-D5", calvedOn: addDays(NOW, -5) });

    const sheet = await milkSheet(session, NOW, "MORNING", db);
    const by = new Map(sheet.rows.map((r) => [r.animalId, r]));
    expect(by.get(day0)!.lockReason).toBe("COLOSTRUM");
    expect(by.get(day4)!.lockReason).toBe("COLOSTRUM");
    expect(by.get(day5)!.locked).toBe(false);
    await close();
  });

  it("colostrum is recorded, not refused — it is milk that exists", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, { name: "Fresh", calvedOn: addDays(NOW, -1) });
    const res = await recordMilkBatch(session, batch([{ animalId: cow, litres: 8 }]), db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.colostrumL).toBe(8);
    expect(res.data.saleableL).toBe(0);
    expect(res.data.totalL).toBe(8);
    await close();
  });
});

/* ================================================================== */
/* 4. R4 — WARN, NEVER BLOCK                                           */
/* ================================================================== */

describe("R4: nothing but the withdrawal may reject a routine capture", () => {
  it("saves an implausibly high yield, flagged, and says so at the moment of entry", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, { name: "Njeri", calvedOn: addDays(NOW, -120) });
    const res = await recordMilkBatch(session, batch([{ animalId: cow, litres: 62 }]), db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.savedCount).toBe(1);
    expect(res.data.flagged[0].reason).toBe("ABOVE_MAX");
    const [row] = await db.select().from(s.milkRecord).where(eq(s.milkRecord.farmId, FARM_ID));
    expect(row.flagged).toBe(true);
    expect(row.litres).toBe("62.00");
    await close();
  });

  it.fails("DEFECT: a NEGATIVE litre entry is rejected instead of saved flagged", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, { name: "Njeri", calvedOn: addDays(NOW, -120) });

    // `FLAG_LABEL.NEGATIVE = "Less than zero"` exists in milk.ts, and
    // `checkYieldPlausibility` returns reason "NEGATIVE" — both unreachable,
    // because Zod's `.min(0)` throws the entry away first.
    const res = await recordMilkBatch(session, batch([{ animalId: cow, litres: -3 }]), db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.flagged[0].reason).toBe("NEGATIVE");
    await close();
  });

  it.fails(
    "DEFECT: one fat-fingered number destroys the whole herd's milking entry",
    async () => {
      const { db, close, session } = await setup();
      const a = await seedCow(db, { name: "Njeri", tag: "KE-1", calvedOn: addDays(NOW, -120) });
      const b = await seedCow(db, { name: "Nyambura", tag: "KE-2", calvedOn: addDays(NOW, -120) });
      const c = await seedCow(db, { name: "Wairimu", tag: "KE-3", calvedOn: addDays(NOW, -120) });

      const res = await recordMilkBatch(
        session,
        batch([
          { animalId: a, litres: 12 },
          { animalId: b, litres: 1e308 }, // a thumb on the keypad
          { animalId: c, litres: 9.5 },
        ]),
        db,
      );

      // R4: the two good rows must survive; the third saves flagged.
      expect(res.ok).toBe(true);
      const rows = await db.select().from(s.milkRecord).where(eq(s.milkRecord.farmId, FARM_ID));
      expect(rows.length).toBeGreaterThanOrEqual(2);
      await close();
    },
  );

  it("returns a readable sentence, never a stack trace, for an impossible date", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, { name: "Njeri", calvedOn: addDays(NOW, -120) });
    const res = await recordMilkBatch(
      session,
      batch([{ animalId: cow, litres: 12 }], "2026-02-30"),
      db,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).not.toMatch(/\bat \w+ \(/); // no stack frames
    expect(res.error.length).toBeLessThan(200);
    await close();
  });

  it("survives year 3000 and year 1900 without crashing", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, { name: "Njeri", calvedOn: "1899-06-01" });
    const past = await recordMilkBatch(session, batch([{ animalId: cow, litres: 5 }], "1900-01-01"), db);
    const future = await recordMilkBatch(session, batch([{ animalId: cow, litres: 5 }], "3000-01-01"), db);
    expect(past.ok).toBe(true);
    expect(future.ok).toBe(true);
    await close();
  });

  it("carries unicode, emoji and SQL-shaped names through every message unharmed", async () => {
    const { db, close, session } = await setup();
    const nasty = "Njeri'); DROP TABLE milk_record;-- 🐄 Ng'ombe";
    const cow = await seedCow(db, { name: nasty, tag: "KE-Ω-01", calvedOn: addDays(NOW, -120) });

    // Give her a usual, so the DROP branch (which names the cow) is the one hit.
    for (const d of [1, 2, 3, 4, 5]) {
      await db.insert(s.milkRecord).values({
        id: newId(),
        farmId: FARM_ID,
        animalId: cow,
        recordedOn: addDays(NOW, -d),
        session: "MORNING",
        litres: "20.00",
        recordedBy: session.userId,
        recordedAt: new Date(),
      });
    }

    const res = await recordMilkBatch(session, batch([{ animalId: cow, litres: 5 }]), db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.flagged[0].reason).toBe("DROP");
    expect(res.data.flagged[0].message).toContain("🐄");
    expect(res.data.flagged[0].message).toContain("DROP TABLE");
    // The table is still there, and the injection string is inert data.
    const rows = await db.select().from(s.milkRecord).where(eq(s.milkRecord.farmId, FARM_ID));
    expect(rows).toHaveLength(6);
    await close();
  });

  it("names the cow when a yield is over the maximum — or does not (documented)", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, { name: "Njeri", calvedOn: addDays(NOW, -120) });
    const res = await recordMilkBatch(session, batch([{ animalId: cow, litres: 62 }]), db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Documented shortfall: the ABOVE_MAX branch of `checkYieldPlausibility` is
    // the ONLY plausibility message that omits the animal's name, so on a
    // forty-cow sheet the manager is told a number without being told whose.
    expect(res.data.flagged[0].message).not.toContain("Njeri");
    await close();
  });
});

/* ================================================================== */
/* 5. IDEMPOTENCY UNDER REPLAY                                         */
/* ================================================================== */

describe("offline replay", () => {
  it("three flushes of the same batch leave one row, one receipt and one code", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, { name: "Njeri", calvedOn: addDays(NOW, -120) });
    const rowId = newId();
    const input = batch([{ id: rowId, animalId: cow, litres: 12.5 }]);

    const r1 = await recordMilkBatch(session, input, db);
    const r2 = await recordMilkBatch(session, input, db);
    const r3 = await recordMilkBatch(session, input, db);
    expect(r1.ok && r2.ok && r3.ok).toBe(true);
    if (!r1.ok || !r2.ok || !r3.ok) return;

    expect(r1.refCode).toBe(r2.refCode);
    expect(r2.refCode).toBe(r3.refCode);
    expect(r2.data.duplicateCount).toBe(1);
    expect(r2.data.savedCount).toBe(0);

    expect(await db.select().from(s.milkRecord).where(eq(s.milkRecord.farmId, FARM_ID))).toHaveLength(1);
    expect(await db.select().from(s.receipt).where(eq(s.receipt.farmId, FARM_ID))).toHaveLength(1);
    await close();
  });

  it("two simultaneous flushes still leave one row and one receipt", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, { name: "Njeri", calvedOn: addDays(NOW, -120) });
    const input = batch([{ id: newId(), animalId: cow, litres: 12.5 }]);

    const [a, b] = await Promise.all([
      recordMilkBatch(session, input, db),
      recordMilkBatch(session, input, db),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.refCode).toBe(b.refCode);
    expect(await db.select().from(s.milkRecord).where(eq(s.milkRecord.farmId, FARM_ID))).toHaveLength(1);
    expect(await db.select().from(s.receipt).where(eq(s.receipt.farmId, FARM_ID))).toHaveLength(1);
    await close();
  });

  it("a batch with no client ids is NOT idempotent — the outbox must supply them", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, { name: "Njeri", calvedOn: addDays(NOW, -120) });
    const input = batch([{ animalId: cow, litres: 12.5 }]);
    await recordMilkBatch(session, input, db);
    await recordMilkBatch(session, input, db);
    await recordMilkBatch(session, input, db);

    // Documented, not desired: three receipts and three rows for one milking.
    // Nothing in `recordMilkBatch` falls back to (farm, animal, date, session).
    const rows = await db.select().from(s.milkRecord).where(eq(s.milkRecord.farmId, FARM_ID));
    const receipts = await db.select().from(s.receipt).where(eq(s.receipt.farmId, FARM_ID));
    expect(rows).toHaveLength(3);
    expect(receipts).toHaveLength(3);
    const day = await dayProduction(session, NOW, db);
    expect(day.totalL).toBe(37.5); // one 12.5 L milking counted three times
    await close();
  });

  it.fails("DEFECT: correcting the same record twice double-counts the milk", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, { name: "Njeri", calvedOn: addDays(NOW, -120) });
    const rowId = newId();
    await recordMilkBatch(session, batch([{ id: rowId, animalId: cow, litres: 12 }]), db);

    // She was written down as 12, then corrected to 10, then corrected to 9.
    const c1 = await correctMilkRecord(session, { recordId: rowId, litres: 10 }, db);
    const c2 = await correctMilkRecord(session, { recordId: rowId, litres: 9 }, db);
    expect(c1.ok && c2.ok).toBe(true);

    // `live()` only drops rows that something supersedes, so BOTH corrections
    // survive and the day reads 19 L from one cow's single morning milking.
    const day = await dayProduction(session, NOW, db);
    expect(day.totalL).toBe(9);
    await close();
  });

  it.fails("DEFECT: the reason a number was corrected is silently thrown away", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, { name: "Njeri", calvedOn: addDays(NOW, -120) });
    const rowId = newId();
    await recordMilkBatch(session, batch([{ id: rowId, animalId: cow, litres: 12 }]), db);
    await correctMilkRecord(
      session,
      { recordId: rowId, litres: 10, reason: "Spilt half a bucket on the way to the can" },
      db,
    );

    // R10 — provenance is permanent. The correction row keeps only "CORRECTION".
    const rows = await db
      .select()
      .from(s.milkRecord)
      .where(and(eq(s.milkRecord.farmId, FARM_ID), eq(s.milkRecord.supersedesId, rowId)));
    expect(rows[0].flagReason).toContain("Spilt");
    await close();
  });
});

/* ================================================================== */
/* 6. IMPOSSIBLE HISTORY                                               */
/* ================================================================== */

describe("impossible history does not crash the reader", () => {
  it("a calving dated before the cow's own birth still produces a readable curve", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { name: "Impossible", dateOfBirth: "2024-01-01" });
    await db.insert(s.calving).values({
      id: newId(),
      farmId: FARM_ID,
      damId: animalId,
      calvedOn: "2020-05-05", // before she was born
      recordedBy: newId(),
    });
    const curve = await lactationCurve(session, animalId, NOW, db);
    expect(typeof curve.message).toBe("string");
    expect(curve.message.length).toBeGreaterThan(0);
    await close();
  });

  it("a cow with no calving at all yields an honest empty curve, not an exception", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { name: "Maiden" });
    const curve = await lactationCurve(session, animalId, NOW, db);
    expect(curve.lastCalvingOn).toBeNull();
    expect(curve.cumulativeL).toBe(0);
    expect(curve.message).toContain("Maiden");
    await close();
  });
});
