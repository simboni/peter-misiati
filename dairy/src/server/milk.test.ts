import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { FARM_ID, fakeSession, seedAnimal, seedFarm, seedProduct, seedUser } from "@/test/factory";
import * as s from "@/db/schema";
import { newId } from "@/lib/ids";
import { addDays } from "@/lib/domain/dates";
import {
  approveMilkRecord,
  correctMilkRecord,
  dayProduction,
  flaggedQueue,
  lactationCurve,
  milkSheet,
  receiptByRef,
  recordMilkBatch,
} from "./milk";

/**
 * M3 is the screen that runs twice a day forever. These tests are written
 * against the four things that would make it worthless: a locked cow's milk
 * reaching the can, a rejected entry, a double-flush duplicating a milking, and
 * one farm seeing another's herd.
 */

const TODAY = "2026-08-03"; // a Monday
const OTHER_FARM = "22222222-2222-4222-8222-222222222222";

async function setup() {
  const { db, close } = await createTestDb();
  await seedFarm(db);
  const userId = await seedUser(db, { fullName: "Kamau Mwangi", role: "HERDSMAN" });
  const session = fakeSession({ userId, role: "HERDSMAN", fullName: "Kamau Mwangi" });
  return { db, close, session, userId };
}

/** A cow only appears on the sheet if she has calved — class is derived, never stored. */
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

async function seedRecords(
  db: TestDb,
  animalId: string,
  entries: Array<{ on: string; session?: s.MilkingSession; litres: number }>,
) {
  for (const e of entries) {
    await db.insert(s.milkRecord).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      recordedOn: e.on,
      session: e.session ?? "MORNING",
      litres: e.litres.toFixed(2),
      recordedBy: newId(),
      recordedAt: new Date(),
    });
  }
}

/* ---------------------------------------------------------------- */

describe("milkSheet", () => {
  it("lists the lactating herd, prefilled from the last recorded session", async () => {
    const { db, close, session } = await setup();
    const njeri = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    await seedRecords(db, njeri, [
      { on: addDays(TODAY, -2), litres: 12 },
      { on: addDays(TODAY, -1), litres: 12.5 },
    ]);

    const sheet = await milkSheet(session, TODAY, "MORNING", db);
    expect(sheet.rows).toHaveLength(1);
    const row = sheet.rows[0];
    expect(row.name).toBe("Njeri");
    expect(row.prefillL).toBe(12.5);
    expect(row.prefillLabel).toBe("same as yesterday");
    expect(row.recentAverageL).toBe(12.25);
    expect(row.locked).toBe(false);
    expect(sheet.prefilledTotalL).toBe(12.5);
    await close();
  });

  it("labels a stale prefill with its real age rather than pretending", async () => {
    const { db, close, session } = await setup();
    const id = await seedCow(db, { name: "Wanjiku", calvedOn: "2026-04-01" });
    await seedRecords(db, id, [{ on: addDays(TODAY, -6), litres: 15 }]);

    const sheet = await milkSheet(session, TODAY, "MORNING", db);
    expect(sheet.rows[0].prefillLabel).toContain("6 days ago");
    await close();
  });

  it("keeps each session's prefill separate", async () => {
    const { db, close, session } = await setup();
    const id = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    await seedRecords(db, id, [
      { on: addDays(TODAY, -1), session: "MORNING", litres: 12 },
      { on: addDays(TODAY, -1), session: "EVENING", litres: 8 },
    ]);

    expect((await milkSheet(session, TODAY, "MORNING", db)).rows[0].prefillL).toBe(12);
    expect((await milkSheet(session, TODAY, "EVENING", db)).rows[0].prefillL).toBe(8);
    await close();
  });

  it("leaves dry cows and heifers off the sheet entirely", async () => {
    const { db, close, session } = await setup();
    await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });

    // Dried off after her last calving — she is not milking.
    const dry = await seedCow(db, { name: "Muthoni", calvedOn: "2025-06-01", tag: "KE-DRY" });
    await db.insert(s.dryOff).values({
      id: newId(), farmId: FARM_ID, animalId: dry, driedOn: "2026-06-01", recordedBy: newId(),
    });
    // Never calved.
    await seedAnimal(db, { name: "Kanini", tag: "KE-HEIFER", dateOfBirth: "2025-01-01" });

    const sheet = await milkSheet(session, TODAY, "MORNING", db);
    expect(sheet.rows.map((r) => r.name)).toEqual(["Njeri"]);
    await close();
  });

  it("shows a sustained drop on the sheet, at entry, not next month", async () => {
    const { db, close, session } = await setup();
    const id = await seedCow(db, { name: "Nyambura", calvedOn: "2026-03-01" });
    for (let i = 20; i >= 4; i--) await seedRecords(db, id, [{ on: addDays(TODAY, -i), litres: 12 }]);
    for (let i = 3; i >= 1; i--) await seedRecords(db, id, [{ on: addDays(TODAY, -i), litres: 8 }]);

    const sheet = await milkSheet(session, addDays(TODAY, -1), "MORNING", db);
    expect(sheet.rows[0].warning).toContain("Nyambura down 33% for 3 days");
    await close();
  });

  it("returns an empty sheet rather than failing on a farm with no cows in milk", async () => {
    const { db, close, session } = await setup();
    const sheet = await milkSheet(session, TODAY, "MORNING", db);
    expect(sheet.rows).toEqual([]);
    expect(sheet.prefilledTotalL).toBe(0);
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("the withdrawal lock", () => {
  async function underTreatment(db: TestDb, clearInDays: number) {
    const animalId = await seedCow(db, { name: "Muthoni", calvedOn: "2026-04-01" });
    const productId = await seedProduct(db, { milkWithdrawalDays: 7 });
    await db.insert(s.healthEvent).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      eventType: "TREATMENT",
      occurredOn: TODAY,
      productId,
      milkClearAt: new Date(Date.now() + clearInDays * 86_400_000),
      recordedBy: newId(),
    });
    return animalId;
  }

  it("locks the row on the sheet with a reason a herdsman can read aloud", async () => {
    const { db, close, session } = await setup();
    await underTreatment(db, 4);

    const sheet = await milkSheet(session, TODAY, "MORNING", db);
    const row = sheet.rows[0];
    expect(row.locked).toBe(true);
    expect(row.lockReason).toBe("WITHDRAWAL");
    expect(row.saleable).toBe(false);
    expect(row.lockMessage).toContain("Do not sell Muthoni's milk until");
    expect(row.lockMessage).not.toMatch(/withdrawal_period|rc=/i);
    expect(sheet.lockedCount).toBe(1);
    await close();
  });

  it("still records her litres — the milk exists, it is just not saleable", async () => {
    const { db, close, session } = await setup();
    const animalId = await underTreatment(db, 4);

    const res = await recordMilkBatch(
      session,
      { date: TODAY, session: "MORNING", rows: [{ animalId, litres: 9 }] },
      db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.totalL).toBe(9);
    expect(res.data.saleableL).toBe(0);
    expect(res.data.withheldL).toBe(9);
    expect(res.data.locked[0].reason).toBe("WITHDRAWAL");

    const [saved] = await db.select().from(s.milkRecord).where(eq(s.milkRecord.animalId, animalId));
    expect(saved.saleable).toBe(false);
    expect(saved.notSaleableReason).toBe("WITHDRAWAL");
    await close();
  });

  it("cannot be talked out of it by the client", async () => {
    const { db, close, session } = await setup();
    const animalId = await underTreatment(db, 4);

    // The client has no say — saleability is computed on the server from the
    // health record, not accepted as input.
    const res = await recordMilkBatch(
      session,
      {
        date: TODAY,
        session: "MORNING",
        rows: [{ animalId, litres: 9, saleable: true, notSaleableReason: null } as never],
      },
      db,
    );
    expect(res.ok).toBe(true);
    const [saved] = await db.select().from(s.milkRecord).where(eq(s.milkRecord.animalId, animalId));
    expect(saved.saleable).toBe(false);
    await close();
  });

  it("lifts once the clear date has passed", async () => {
    const { db, close, session } = await setup();
    await underTreatment(db, -1); // cleared yesterday

    const sheet = await milkSheet(session, TODAY, "MORNING", db);
    expect(sheet.rows[0].locked).toBe(false);
    expect(sheet.rows[0].saleable).toBe(true);
    await close();
  });

  it("takes the longest of two overlapping treatments", async () => {
    const { db, close, session } = await setup();
    const animalId = await underTreatment(db, 2);
    const productId = await seedProduct(db, { name: "Penstrep", milkWithdrawalDays: 10 });
    await db.insert(s.healthEvent).values({
      id: newId(), farmId: FARM_ID, animalId, eventType: "TREATMENT", occurredOn: TODAY,
      productId, milkClearAt: new Date(Date.now() + 9 * 86_400_000), recordedBy: newId(),
    });

    const sheet = await milkSheet(session, TODAY, "MORNING", db);
    const clear = sheet.rows[0].milkClearOn!;
    expect(clear >= addDays(TODAY, 8)).toBe(true);
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("colostrum", () => {
  it("auto-locks a cow in her first days after calving without anyone remembering", async () => {
    const { db, close, session } = await setup();
    await seedCow(db, { name: "Akinyi", calvedOn: addDays(TODAY, -2) });

    const sheet = await milkSheet(session, TODAY, "MORNING", db);
    const row = sheet.rows[0];
    expect(row.daysInMilk).toBe(2);
    expect(row.locked).toBe(true);
    expect(row.lockReason).toBe("COLOSTRUM");
    expect(row.lockMessage).toContain("colostrum");
    await close();
  });

  it("marks the record not saleable with the colostrum reason", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedCow(db, { name: "Akinyi", calvedOn: addDays(TODAY, -1) });

    const res = await recordMilkBatch(
      session, { date: TODAY, session: "MORNING", rows: [{ animalId, litres: 6 }] }, db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.colostrumL).toBe(6);
    expect(res.data.saleableL).toBe(0);

    const [saved] = await db.select().from(s.milkRecord).where(eq(s.milkRecord.animalId, animalId));
    expect(saved.notSaleableReason).toBe("COLOSTRUM");
    await close();
  });

  it("releases her on day five", async () => {
    const { db, close, session } = await setup();
    await seedCow(db, { name: "Akinyi", calvedOn: addDays(TODAY, -5) });
    const sheet = await milkSheet(session, TODAY, "MORNING", db);
    expect(sheet.rows[0].daysInMilk).toBe(5);
    expect(sheet.rows[0].locked).toBe(false);
    await close();
  });

  it("lets withdrawal outrank colostrum — the legal reason wins", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedCow(db, { name: "Akinyi", calvedOn: addDays(TODAY, -1) });
    const productId = await seedProduct(db);
    await db.insert(s.healthEvent).values({
      id: newId(), farmId: FARM_ID, animalId, eventType: "TREATMENT", occurredOn: TODAY,
      productId, milkClearAt: new Date(Date.now() + 5 * 86_400_000), recordedBy: newId(),
    });

    const sheet = await milkSheet(session, TODAY, "MORNING", db);
    expect(sheet.rows[0].lockReason).toBe("WITHDRAWAL");
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("warn, never block (R4)", () => {
  it("SAVES an implausible value flagged rather than rejecting it", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    await seedRecords(db, animalId, [
      { on: addDays(TODAY, -1), litres: 12 },
      { on: addDays(TODAY, -2), litres: 12 },
    ]);

    const res = await recordMilkBatch(
      session, { date: TODAY, session: "MORNING", rows: [{ animalId, litres: 120 }] }, db,
    );

    // Not rejected.
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.savedCount).toBe(1);
    expect(res.data.flagged).toHaveLength(1);
    expect(res.data.flagged[0].reason).toBe("ABOVE_MAX");

    // And it is really on disk, with the flag, at the value the human typed.
    const [saved] = await db
      .select()
      .from(s.milkRecord)
      .where(and(eq(s.milkRecord.animalId, animalId), eq(s.milkRecord.recordedOn, TODAY)));
    expect(saved.litres).toBe("120.00");
    expect(saved.flagged).toBe(true);
    expect(saved.flagReason).toBe("ABOVE_MAX");
    expect(saved.approvedBy).toBeNull();
    await close();
  });

  it("flags a sharp drop, saves it, and says so in words", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedCow(db, { name: "Nyambura", calvedOn: "2026-03-01" });
    await seedRecords(db, animalId, [
      { on: addDays(TODAY, -1), litres: 12 },
      { on: addDays(TODAY, -2), litres: 12 },
      { on: addDays(TODAY, -3), litres: 12 },
    ]);

    const res = await recordMilkBatch(
      session, { date: TODAY, session: "MORNING", rows: [{ animalId, litres: 7 }] }, db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.flagged[0].reason).toBe("DROP");
    expect(res.data.flagged[0].message).toContain("Nyambura");
    await close();
  });

  it("returns the sustained-drop warning with the receipt (R7)", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedCow(db, { name: "Nyambura", calvedOn: "2026-03-01" });
    for (let i = 20; i >= 3; i--) await seedRecords(db, animalId, [{ on: addDays(TODAY, -i), litres: 12 }]);
    await seedRecords(db, animalId, [
      { on: addDays(TODAY, -2), litres: 8 },
      { on: addDays(TODAY, -1), litres: 8 },
    ]);

    const res = await recordMilkBatch(
      session, { date: TODAY, session: "MORNING", rows: [{ animalId, litres: 8 }] }, db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.drops).toHaveLength(1);
    expect(res.data.drops[0].message).toMatch(/Nyambura down \d+% for 3 days — check her\./);
    expect(res.data.receiptLines.join(" ")).toContain("check her");
    await close();
  });

  it("refuses only the one impossible number — a negative yield", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });

    const res = await recordMilkBatch(
      session, { date: TODAY, session: "MORNING", rows: [{ animalId, litres: -4 }] }, db,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("Check the highlighted rows");
    await close();
  });

  it("accepts a zero without complaint — some mornings a cow gives nothing", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    const res = await recordMilkBatch(
      session, { date: TODAY, session: "MORNING", rows: [{ animalId, litres: 0 }] }, db,
    );
    expect(res.ok).toBe(true);
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("the whole herd in one save", () => {
  it("saves every row, totals them, and returns one receipt", async () => {
    const { db, close, session } = await setup();
    const njeri = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    const wanjiku = await seedCow(db, { name: "Wanjiku", calvedOn: "2026-03-01", tag: "KE-2" });
    const chepkoech = await seedCow(db, { name: "Chepkoech", calvedOn: "2026-02-01", tag: "KE-3" });

    const res = await recordMilkBatch(
      session,
      {
        date: TODAY,
        session: "MORNING",
        rows: [
          { animalId: njeri, litres: 12.5 },
          { animalId: wanjiku, litres: 15 },
          { animalId: chepkoech, litres: 11 },
        ],
      },
      db,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.savedCount).toBe(3);
    expect(res.data.totalL).toBe(38.5);
    expect(res.data.saleableL).toBe(38.5);
    expect(res.refCode).toMatch(/^MK[A-Z2-9]{5}$/);
    expect(res.message).toContain("38.5 L");

    const rows = await db.select().from(s.milkRecord).where(eq(s.milkRecord.recordedOn, TODAY));
    expect(rows).toHaveLength(3);
    await close();
  });

  it("writes a persistent, re-viewable receipt with the ref code (R6)", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    const res = await recordMilkBatch(
      session, { date: TODAY, session: "MORNING", rows: [{ animalId, litres: 12.5 }] }, db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const stored = await receiptByRef(session, res.refCode!, db);
    expect(stored).not.toBeNull();
    expect(stored!.kind).toBe("MILK");
    expect(stored!.summary).toContain("Morning milking");
    expect(stored!.summary).toContain("12.5 L");
    expect(stored!.lines.join(" ")).toContain("Kamau Mwangi");
    await close();
  });

  it("hides no receipt from another farm", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    const res = await recordMilkBatch(
      session, { date: TODAY, session: "MORNING", rows: [{ animalId, litres: 12.5 }] }, db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const intruder = fakeSession({ farmId: OTHER_FARM });
    expect(await receiptByRef(intruder, res.refCode!, db)).toBeNull();
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("offline replay", () => {
  it("is idempotent — a double flush does not double the milking", async () => {
    const { db, close, session } = await setup();
    const njeri = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    const wanjiku = await seedCow(db, { name: "Wanjiku", calvedOn: "2026-03-01", tag: "KE-2" });

    // The device generated these ids before it had any network.
    const batch = {
      date: TODAY,
      session: "MORNING" as const,
      rows: [
        { id: newId(), animalId: njeri, litres: 12.5 },
        { id: newId(), animalId: wanjiku, litres: 15 },
      ],
    };

    const first = await recordMilkBatch(session, batch, db);
    const second = await recordMilkBatch(session, batch, db);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.data.savedCount).toBe(2);
    expect(second.data.savedCount).toBe(0);
    expect(second.data.duplicateCount).toBe(2);
    expect(second.message).toContain("Already saved");

    const rows = await db.select().from(s.milkRecord).where(eq(s.milkRecord.recordedOn, TODAY));
    expect(rows).toHaveLength(2);

    // And the herdsman sees the SAME reference code, not a second receipt.
    expect(second.refCode).toBe(first.refCode);
    const receipts = await db.select().from(s.receipt).where(eq(s.receipt.farmId, FARM_ID));
    expect(receipts).toHaveLength(1);
    await close();
  });

  it("lets a later, larger batch through — replay safety is not a lock", async () => {
    const { db, close, session } = await setup();
    const njeri = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    const wanjiku = await seedCow(db, { name: "Wanjiku", calvedOn: "2026-03-01", tag: "KE-2" });

    const first = { id: newId(), animalId: njeri, litres: 12.5 };
    await recordMilkBatch(session, { date: TODAY, session: "MORNING", rows: [first] }, db);
    const res = await recordMilkBatch(
      session,
      { date: TODAY, session: "MORNING", rows: [first, { id: newId(), animalId: wanjiku, litres: 15 }] },
      db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.savedCount).toBe(1);
    expect(res.data.duplicateCount).toBe(1);
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("tenancy", () => {
  it("refuses to record against another farm's animal", async () => {
    const { db, close, session } = await setup();
    await db.insert(s.farm).values({ id: OTHER_FARM, name: "Someone Else's Farm" });
    const strangerId = newId();
    await db.insert(s.animal).values({
      id: strangerId, farmId: OTHER_FARM, tag: "X-1", name: "Not Ours", sex: "F",
      origin: "BORN", enteredHerdOn: "2024-01-01",
    });

    const res = await recordMilkBatch(
      session, { date: TODAY, session: "MORNING", rows: [{ animalId: strangerId, litres: 12 }] }, db,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("That animal was not found.");

    const rows = await db.select().from(s.milkRecord).where(eq(s.milkRecord.animalId, strangerId));
    expect(rows).toHaveLength(0);
    await close();
  });

  it("saves nothing at all when one row in the batch is another farm's", async () => {
    const { db, close, session } = await setup();
    const mine = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    await db.insert(s.farm).values({ id: OTHER_FARM, name: "Someone Else's Farm" });
    const strangerId = newId();
    await db.insert(s.animal).values({
      id: strangerId, farmId: OTHER_FARM, tag: "X-1", sex: "F", origin: "BORN", enteredHerdOn: "2024-01-01",
    });

    const res = await recordMilkBatch(
      session,
      {
        date: TODAY,
        session: "MORNING",
        rows: [{ animalId: mine, litres: 12 }, { animalId: strangerId, litres: 9 }],
      },
      db,
    );
    expect(res.ok).toBe(false);
    expect(await db.select().from(s.milkRecord).where(eq(s.milkRecord.recordedOn, TODAY))).toHaveLength(0);
    await close();
  });

  it("never shows another farm's herd on the sheet", async () => {
    const { db, close, session } = await setup();
    await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });

    const intruder = fakeSession({ farmId: OTHER_FARM });
    const sheet = await milkSheet(intruder, TODAY, "MORNING", db);
    expect(sheet.rows).toEqual([]);
    await close();
  });

  it("refuses a lactation curve for another farm's cow", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    const intruder = fakeSession({ farmId: OTHER_FARM });
    await expect(lactationCurve(intruder, animalId, TODAY, db)).rejects.toThrow(
      "That animal was not found.",
    );
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("lactationCurve", () => {
  it("computes days in milk, peak, cumulative, projection and persistency", async () => {
    const { db, close, session } = await setup();
    const calvedOn = "2026-05-01";
    const animalId = await seedCow(db, { name: "Njeri", calvedOn });

    // A plausible shape: climbing to a peak around day 45, then easing off.
    const shape: Array<[string, number]> = [
      [addDays(calvedOn, 10), 14],
      [addDays(calvedOn, 30), 18],
      [addDays(calvedOn, 45), 22],
      [addDays(calvedOn, 60), 20],
      [addDays(calvedOn, 90), 18],
    ];
    for (const [on, litres] of shape) await seedRecords(db, animalId, [{ on, litres }]);

    const curve = await lactationCurve(session, animalId, addDays(calvedOn, 94), db);
    expect(curve.lastCalvingOn).toBe(calvedOn);
    expect(curve.daysInMilk).toBe(94);
    expect(curve.peakDailyL).toBe(22);
    expect(curve.daysToPeak).toBe(45);
    expect(curve.cumulativeL).toBe(92);
    expect(curve.projected305L).toBe(4400);
    expect(curve.persistencyPct).toBeGreaterThan(88);
    expect(curve.days).toHaveLength(5);
    await close();
  });

  it("adds both sessions into one day's yield", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedCow(db, { name: "Njeri", calvedOn: "2026-06-01" });
    await seedRecords(db, animalId, [
      { on: "2026-07-01", session: "MORNING", litres: 12 },
      { on: "2026-07-01", session: "EVENING", litres: 8 },
    ]);
    const curve = await lactationCurve(session, animalId, "2026-07-02", db);
    expect(curve.days).toHaveLength(1);
    expect(curve.peakDailyL).toBe(20);
    await close();
  });

  it("says so plainly when there is no calving to date the lactation from", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { name: "Kanini", tag: "KE-H" });
    const curve = await lactationCurve(session, animalId, TODAY, db);
    expect(curve.lastCalvingOn).toBeNull();
    expect(curve.message).toContain("No calving recorded");
    await close();
  });

  it("calls out poor persistency as a feed or health problem, not a cow problem", async () => {
    const { db, close, session } = await setup();
    const calvedOn = "2026-04-01";
    const animalId = await seedCow(db, { name: "Muthoni", calvedOn });
    await seedRecords(db, animalId, [
      { on: addDays(calvedOn, 40), litres: 20 },
      { on: addDays(calvedOn, 100), litres: 9 },
    ]);
    const curve = await lactationCurve(session, animalId, addDays(calvedOn, 100), db);
    expect(curve.persistencyPct).toBeLessThan(88);
    expect(curve.message).toContain("feed or health");
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("the manager's queue", () => {
  it("collects everything flagged and not yet looked at", async () => {
    const { db, close, session } = await setup();
    const njeri = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    const wanjiku = await seedCow(db, { name: "Wanjiku", calvedOn: "2026-03-01", tag: "KE-2" });
    await seedRecords(db, njeri, [{ on: addDays(TODAY, -1), litres: 12 }]);

    await recordMilkBatch(
      session,
      {
        date: TODAY,
        session: "MORNING",
        rows: [{ animalId: njeri, litres: 90 }, { animalId: wanjiku, litres: 15 }],
      },
      db,
    );

    const queue = await flaggedQueue(session, db);
    expect(queue).toHaveLength(1);
    expect(queue[0].name).toBe("Njeri");
    expect(queue[0].litres).toBe(90);
    expect(queue[0].reasonLabel).toBe("Higher than any cow here gives");
    expect(queue[0].recordedByName).toBe("Kamau Mwangi");
    await close();
  });

  it("clears once the manager approves, and leaves an audit trail (R10)", async () => {
    const { db, close, session } = await setup();
    const managerId = await seedUser(db, { fullName: "Grace Wanjiru", role: "MANAGER" });
    const manager = fakeSession({ userId: managerId, role: "MANAGER", fullName: "Grace Wanjiru" });
    const animalId = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    await recordMilkBatch(
      session, { date: TODAY, session: "MORNING", rows: [{ animalId, litres: 90 }] }, db,
    );

    const [flagged] = await flaggedQueue(manager, db);
    const res = await approveMilkRecord(manager, flagged.id, db);
    expect(res.ok).toBe(true);
    expect(await flaggedQueue(manager, db)).toHaveLength(0);

    const audit = await db.select().from(s.auditEntry).where(eq(s.auditEntry.rowId, flagged.id));
    expect(audit[0].action).toBe("APPROVE");
    expect(audit[0].actorId).toBe(manager.userId);
    await close();
  });

  it("shows no other farm's flagged records", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    await recordMilkBatch(
      session, { date: TODAY, session: "MORNING", rows: [{ animalId, litres: 90 }] }, db,
    );
    expect(await flaggedQueue(fakeSession({ farmId: OTHER_FARM }), db)).toHaveLength(0);
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("corrections", () => {
  it("supersedes rather than edits, and the day stops double-counting", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    await recordMilkBatch(
      session, { date: TODAY, session: "MORNING", rows: [{ animalId, litres: 125 }] }, db,
    );
    const [original] = await db.select().from(s.milkRecord).where(eq(s.milkRecord.recordedOn, TODAY));

    const res = await correctMilkRecord(session, { recordId: original.id, litres: 12.5 }, db);
    expect(res.ok).toBe(true);

    const all = await db.select().from(s.milkRecord).where(eq(s.milkRecord.recordedOn, TODAY));
    expect(all).toHaveLength(2); // the first entry is kept

    const day = await dayProduction(session, TODAY, db);
    expect(day.totalL).toBe(12.5);
    await close();
  });

  it("will not correct another farm's record", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    await recordMilkBatch(
      session, { date: TODAY, session: "MORNING", rows: [{ animalId, litres: 12 }] }, db,
    );
    const [row] = await db.select().from(s.milkRecord).where(eq(s.milkRecord.recordedOn, TODAY));
    const res = await correctMilkRecord(
      fakeSession({ farmId: OTHER_FARM }), { recordId: row.id, litres: 1 }, db,
    );
    expect(res.ok).toBe(false);
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("dayProduction — the seam M4 allocates against", () => {
  it("splits the day into saleable, withheld and colostrum", async () => {
    const { db, close, session } = await setup();
    const njeri = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    const akinyi = await seedCow(db, { name: "Akinyi", calvedOn: addDays(TODAY, -1), tag: "KE-2" });
    const muthoni = await seedCow(db, { name: "Muthoni", calvedOn: "2026-03-01", tag: "KE-3" });
    const productId = await seedProduct(db);
    await db.insert(s.healthEvent).values({
      id: newId(), farmId: FARM_ID, animalId: muthoni, eventType: "TREATMENT", occurredOn: TODAY,
      productId, milkClearAt: new Date(Date.now() + 3 * 86_400_000), recordedBy: newId(),
    });

    await recordMilkBatch(
      session,
      {
        date: TODAY,
        session: "MORNING",
        rows: [
          { animalId: njeri, litres: 12 },
          { animalId: akinyi, litres: 5 },
          { animalId: muthoni, litres: 9 },
        ],
      },
      db,
    );

    const day = await dayProduction(session, TODAY, db);
    expect(day.totalL).toBe(26);
    expect(day.saleableL).toBe(12);
    expect(day.withheldL).toBe(9);
    expect(day.colostrumL).toBe(5);
    expect(day.withheldAnimals.map((a) => a.name).sort()).toEqual(["Akinyi", "Muthoni"]);
    await close();
  });

  it("adds the sessions of one day together", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    await recordMilkBatch(session, { date: TODAY, session: "MORNING", rows: [{ animalId, litres: 12 }] }, db);
    await recordMilkBatch(session, { date: TODAY, session: "EVENING", rows: [{ animalId, litres: 8 }] }, db);

    const day = await dayProduction(session, TODAY, db);
    expect(day.totalL).toBe(20);
    expect(day.bySession).toEqual([
      { session: "MORNING", litres: 12 },
      { session: "EVENING", litres: 8 },
    ]);
    await close();
  });
});
