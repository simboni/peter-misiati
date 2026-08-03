import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/test-db";
import { FARM_ID, fakeSession, seedAnimal, seedCustomer, seedFarm, seedProduct } from "@/test/factory";
import { newId } from "@/lib/ids";
import { addDays, fromDate, today } from "@/lib/domain/dates";
import { ASSUMED_MEAT_WITHDRAWAL_DAYS, ASSUMED_MILK_WITHDRAWAL_DAYS } from "@/lib/domain/health";

/**
 * THE SAFETY SEAM — health → milk → sales.
 *
 * The withdrawal block is the only hard block in the product (R4's single
 * exception), and it is the one seam where failing OPEN is worse than crashing:
 * 15–19% of Kenyan milk samples test positive for antibiotic residues, and one
 * farmer's residual milk can get a whole chilling-plant load rejected — a bill
 * the co-operative passes straight back to the member.
 *
 * Four modules have to agree for that block to hold:
 *
 *   M6 health   writes `healthEvent.milkClearAt`
 *   M3 milk     reads it (`withdrawalMap`) to lock the sheet and stamp
 *               `milkRecord.saleable = false`
 *   M4 sales    reads the day's unsaleable litres and forces them into
 *               WITHHELD_TREATMENT instead of a paying channel
 *   M7 trading  ought to read `healthEvent.meatClearAt` before a slaughter sale
 *
 * Everything below goes through the real module functions end to end. Nothing
 * here inserts a `healthEvent` by hand — a seam you fake is a seam you have not
 * tested.
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

const { getWithdrawalStatus, recordDryCowTherapyFor, recordTreatmentFor } = await import("../health");
const { dayProduction, milkSheet, recordMilkBatch, withdrawalMap } = await import("../milk");
const { allocateMilk, recordDisposal } = await import("../sales");
const { recordSale } = await import("../trading");
const { recordDryOff } = await import("../breeding");

const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_FARM = "99999999-9999-4999-8999-999999999999";

/**
 * Dates are anchored on the real clock because the milk sheet asks the clock
 * itself whether a withdrawal has expired (see `withdrawalMap`). Anchoring here
 * means these tests still mean the same thing next August.
 */
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

/** A grade Friesian in mid-lactation. She is only on the sheet because she calved. */
async function seedMilkingCow(opts: { name: string; tag: string; calvedOn?: string } ) {
  const id = await seedAnimal(db, { name: opts.name, tag: opts.tag, dateOfBirth: "2020-06-01" });
  await db.insert(s.calving).values({
    id: newId(),
    farmId: FARM_ID,
    damId: id,
    calvedOn: opts.calvedOn ?? D(-90),
    recordedBy: USER,
  });
  return id;
}

async function seedOtherFarmAnimal() {
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

const rowFor = <T extends { animalId: string }>(sheet: { rows: T[] }, animalId: string): T =>
  sheet.rows.find((r) => r.animalId === animalId)!;

/* ================================================================== */
/* SEAM 1a — a treated cow is locked, recorded, and cannot be sold     */
/* ================================================================== */

describe("a cow treated with an antibiotic cannot have her milk sold", () => {
  it("locks her row on the milking sheet with the date the herdsman must wait for", async () => {
    const cow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    const productId = await seedProduct(db, {
      name: "Penstrep",
      activeIngredient: "Procaine penicillin + streptomycin",
      milkWithdrawalDays: 7,
      meatWithdrawalDays: 28,
    });

    const treated = await recordTreatmentFor(
      session(),
      { animalId: cow, productId, occurredOn: T0, dose: "20 ml", route: "IM", diagnosis: "Mastitis, left front" },
      db,
    );
    if (!treated.ok) throw new Error(treated.error);
    expect(treated.data.milkClearOn).toBe(D(7));

    const sheet = await milkSheet(session(), T0, "MORNING", db);
    const row = rowFor(sheet, cow);
    expect(row.locked).toBe(true);
    expect(row.lockReason).toBe("WITHDRAWAL");
    expect(row.saleable).toBe(false);
    expect(row.notSaleableReason).toBe("WITHDRAWAL");
    expect(row.milkClearOn).toBe(D(7));
    expect(row.lockMessage).toMatch(/Do not sell Njeri's milk/);
    expect(sheet.lockedCount).toBe(1);
    expect(sheet.saleableCount).toBe(0);
  });

  it("still records her 16 litres — the block is on selling the milk, never on the record", async () => {
    const cow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    const productId = await seedProduct(db, { milkWithdrawalDays: 7 });
    await recordTreatmentFor(session(), { animalId: cow, productId, occurredOn: T0 }, db);

    const batch = await recordMilkBatch(
      session(),
      { date: T0, session: "MORNING", rows: [{ animalId: cow, litres: 16 }] },
      db,
    );
    if (!batch.ok) throw new Error(batch.error);
    expect(batch.data.totalL).toBe(16);
    expect(batch.data.withheldL).toBe(16);
    expect(batch.data.saleableL).toBe(0);
    expect(batch.data.locked[0].reason).toBe("WITHDRAWAL");
    expect(batch.data.receiptLines.join(" ")).toMatch(/16 L withheld/);

    const [record] = await db.select().from(s.milkRecord);
    expect(record.litres).toBe("16.00");
    expect(record.saleable).toBe(false);
    expect(record.notSaleableReason).toBe("WITHDRAWAL");
  });

  for (const channel of ["COOP", "HOUSEHOLD", "INSTITUTION"] as const) {
    it(`turns an attempt to sell her milk to ${channel.toLowerCase()} into a withholding`, async () => {
      const cow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
      const productId = await seedProduct(db, { milkWithdrawalDays: 7 });
      await recordTreatmentFor(session(), { animalId: cow, productId, occurredOn: T0 }, db);
      await recordMilkBatch(session(), { date: T0, session: "MORNING", rows: [{ animalId: cow, litres: 16 }] }, db);

      const customerId = await seedCustomer(db, {
        name: channel === "COOP" ? "Limuru Dairy Co-operative" : channel === "INSTITUTION" ? "Kiambu Girls High School" : "Mama Njoki",
        customerType: channel,
      });

      const sold = await recordDisposal(
        session(),
        { date: T0, channel, customerId, litres: 16, settlement: "CREDIT" },
        db,
      );
      if (!sold.ok) throw new Error(sold.error);

      expect(sold.data.requestedChannel).toBe(channel);
      expect(sold.data.channel).toBe("WITHHELD_TREATMENT");
      expect(sold.data.blockMessage).toMatch(/held back|may be sold/);

      const disposals = await db.select().from(s.milkDisposal);
      expect(disposals).toHaveLength(1);
      expect(disposals[0].channel).toBe("WITHHELD_TREATMENT");
      // And no revenue channel row exists for the day at all.
      expect(disposals.filter((d) => (s.REVENUE_CHANNELS as readonly string[]).includes(d.channel))).toHaveLength(0);
    });
  }

  it("lets the clear cows' milk through and fences off only the treated cow's litres", async () => {
    const njeri = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    const nyambura = await seedMilkingCow({ name: "Nyambura", tag: "KE-0002" });
    const productId = await seedProduct(db, { milkWithdrawalDays: 7 });
    await recordTreatmentFor(session(), { animalId: njeri, productId, occurredOn: T0 }, db);
    await recordMilkBatch(
      session(),
      {
        date: T0,
        session: "MORNING",
        rows: [
          { animalId: njeri, litres: 16 },
          { animalId: nyambura, litres: 14 },
        ],
      },
      db,
    );

    const coopId = await seedCustomer(db, { customerType: "COOP" });
    // The herdsman tips the whole can into the co-op churn: 30 L, of which 16
    // must not go.
    const sold = await recordDisposal(session(), { date: T0, channel: "COOP", customerId: coopId, litres: 30 }, db);
    if (!sold.ok) throw new Error(sold.error);

    expect(sold.data.channel).toBe("COOP");
    expect(sold.data.litres).toBe(14);
    expect(sold.data.forcedL).toBe(16);

    const disposals = await db.select().from(s.milkDisposal);
    expect(disposals).toHaveLength(2);
    const withheld = disposals.find((d) => d.channel === "WITHHELD_TREATMENT")!;
    expect(withheld.litres).toBe("16.00");

    // The day's allocation says so out loud rather than burying it.
    const allocation = await allocateMilk(session(), T0, db);
    expect(allocation.production.withheldL).toBe(16);
    expect(allocation.warnings.join(" ")).toMatch(/Njeri/);
    expect(allocation.reconciliation.balanced).toBe(true);
  });
});

/* ================================================================== */
/* SEAM 1a (continued) — the block depends on the sheet being filled   */
/* ================================================================== */

/**
 * `withdrawalGuard` now asks the HEALTH record — `withdrawalMap` as at the date
 * of the sale — instead of only the day's milk records. That matters because
 * the order a farm actually works in is: milk at five, rider takes the can at
 * six, sheet gets filled in after breakfast, and the old guard was silent for
 * the whole of that window.
 *
 * It still does not REFUSE the sale on an unfilled sheet — R4 says a sale must
 * not be blocked merely because nobody has typed the sheet in yet, and with no
 * litres recorded there is no number to fence off. But silence was never part
 * of R4, and the guard is no longer silent.
 */
describe("selling before the milking sheet has been filled in", () => {
  async function treatedButNotYetMilked() {
    const cow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    const productId = await seedProduct(db, { milkWithdrawalDays: 7 });
    await recordTreatmentFor(session(), { animalId: cow, productId, occurredOn: T0 }, db);
    return cow;
  }

  it("names the treated cow in the warning even though no milk has been recorded yet", async () => {
    const cow = await treatedButNotYetMilked();
    // Health is unambiguous about her, and now the sale screen asks it.
    expect((await getWithdrawalStatus(session(), [cow], T0, db)).get(cow)!.milkBlocked).toBe(true);
    // Nothing has been recorded for the day: the old guard's only source was empty.
    expect((await dayProduction(session(), T0, db)).withheldL).toBe(0);

    const coopId = await seedCustomer(db, { customerType: "COOP" });
    const sold = await recordDisposal(session(), { date: T0, channel: "COOP", customerId: coopId, litres: 16 }, db);
    if (!sold.ok) throw new Error(sold.error);

    const msg = sold.data.blockMessage ?? "";
    expect(msg).toMatch(/Njeri/); // by name, not "a treated cow"
    expect(msg).toMatch(/under withdrawal/i);
    expect(msg).toMatch(/must not go in this can/i);
    // And it tells the herdsman the one action that makes the block bite.
    expect(msg).toMatch(/Record the milking first/i);
    // The period here IS on file, so the guard must not claim we are guessing.
    expect(msg).not.toMatch(/never recorded|assuming the worst/i);
  });

  it("still lets the sale through rather than refusing it — R4's line is 'do not block', not 'stay quiet'", async () => {
    await treatedButNotYetMilked();
    const coopId = await seedCustomer(db, { customerType: "COOP" });
    const sold = await recordDisposal(session(), { date: T0, channel: "COOP", customerId: coopId, litres: 16 }, db);
    if (!sold.ok) throw new Error(sold.error);
    expect(sold.data.channel).toBe("COOP");
    expect(sold.data.requestedChannel).toBe("COOP");
    expect(sold.data.forcedL).toBe(0);
    expect(sold.data.litres).toBe(16);
    // Warned, not refused, and not silently reclassified behind the seller's back.
    expect(sold.data.blockMessage).not.toBeNull();
    // The disposal really is on the books as a co-op delivery.
    const [disposal] = await db.select().from(s.milkDisposal);
    expect(disposal.channel).toBe("COOP");
  });

  it("says nothing at all when no cow on the farm is under withdrawal", async () => {
    // The guard must not have become a permanent nag: a clean herd sells clean.
    await seedMilkingCow({ name: "Nyambura", tag: "KE-0002" });
    const coopId = await seedCustomer(db, { customerType: "COOP" });
    const sold = await recordDisposal(session(), { date: T0, channel: "COOP", customerId: coopId, litres: 16 }, db);
    if (!sold.ok) throw new Error(sold.error);
    expect(sold.data.channel).toBe("COOP");
    expect(sold.data.blockMessage).toBeNull();
    expect(sold.data.forcedL).toBe(0);
  });

  it("warns that the period itself is a guess when the label was never recorded", async () => {
    const cow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    const productId = await seedProduct(db, { name: "Norocillin (label mislaid)", milkWithdrawalDays: null });
    await recordTreatmentFor(session(), { animalId: cow, productId, occurredOn: T0 }, db);

    const coopId = await seedCustomer(db, { customerType: "COOP" });
    const sold = await recordDisposal(session(), { date: T0, channel: "COOP", customerId: coopId, litres: 16 }, db);
    if (!sold.ok) throw new Error(sold.error);
    const msg = sold.data.blockMessage ?? "";
    expect(msg).toMatch(/Njeri/);
    expect(msg).toMatch(/never recorded/i);
    expect(msg).toMatch(/assuming the worst/i);
  });

  it("does block once the sheet is in, so the same sale a few minutes later is caught", async () => {
    const cow = await treatedButNotYetMilked();
    await recordMilkBatch(session(), { date: T0, session: "MORNING", rows: [{ animalId: cow, litres: 16 }] }, db);
    const coopId = await seedCustomer(db, { customerType: "COOP" });
    const sold = await recordDisposal(session(), { date: T0, channel: "COOP", customerId: coopId, litres: 16 }, db);
    if (!sold.ok) throw new Error(sold.error);
    expect(sold.data.channel).toBe("WITHHELD_TREATMENT");
  });
});

/* ================================================================== */
/* SEAM 1b — THE FAIL-OPEN CASE                                        */
/* ================================================================== */

/**
 * A product whose `milkWithdrawalDays` is NULL means "nobody has read the label
 * yet". It does NOT mean zero.
 *
 * `withdrawalMap` now joins `product` and picks these treatments up itself, so
 * a null clear date no longer reads as "no treatment". The cow is held on the
 * assumed seven-day window under a lock reason of its own —
 * WITHDRAWAL_UNKNOWN — which names the product and sends someone to the bottle.
 * WITHDRAWAL_UNKNOWN is not a softer WITHDRAWAL; it is a different fact, and
 * the tests below insist on being able to tell the two apart.
 */
describe("a treatment whose withdrawal period nobody has recorded", () => {
  async function treatWithUnknownPeriod() {
    const cow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    const productId = await seedProduct(db, {
      name: "Norocillin (label mislaid)",
      milkWithdrawalDays: null,
      meatWithdrawalDays: null,
      labelSource: null,
    });
    const treated = await recordTreatmentFor(session(), { animalId: cow, productId, occurredOn: T0 }, db);
    if (!treated.ok) throw new Error(treated.error);
    return { cow, productId, treated };
  }

  it("warns loudly at the moment of treatment and refuses to invent a clear date", async () => {
    const { treated } = await treatWithUnknownPeriod();
    expect(treated.data.milkClearOn).toBeNull();
    expect(treated.data.warnings.join(" ")).toMatch(/No milk withdrawal period is recorded/);
    expect(treated.data.receiptLines.join(" ")).toMatch(/until you have checked the label/);
  });

  it("is known to the health module as an unknown period, not as clear", async () => {
    const { cow } = await treatWithUnknownPeriod();
    const status = (await getWithdrawalStatus(session(), [cow], T0, db)).get(cow)!;
    expect(status.unknownPeriod).toBe(true);
    expect(status.unknownMessage).toMatch(/no withdrawal period on file/);
    expect(status.milkBlocked).toBe(false);
  });

  it("locks her row on the milking sheet on the assumed seven-day window", async () => {
    const { cow } = await treatWithUnknownPeriod();
    const sheet = await milkSheet(session(), T0, "MORNING", db);
    const row = rowFor(sheet, cow);

    expect(row.locked).toBe(true);
    expect(row.saleable).toBe(false);
    // A lock reason of its own — NOT the plain WITHDRAWAL used when the label
    // period is known, because the farm has a data gap it needs to close.
    expect(row.lockReason).toBe("WITHDRAWAL_UNKNOWN");
    expect(row.notSaleableReason).toBe("WITHDRAWAL_UNKNOWN");
    // Treatment end + the assumed window, and no longer: a month-long "to be
    // safe" block would dump good milk and teach people to work around the app.
    expect(ASSUMED_MILK_WITHDRAWAL_DAYS).toBe(7);
    expect(row.milkClearOn).toBe(D(7));
    expect(sheet.lockedCount).toBe(1);
    expect(sheet.saleableCount).toBe(0);
  });

  it("says on the row that we are guessing, names the product, and sends someone to the label", async () => {
    const { cow } = await treatWithUnknownPeriod();
    const row = rowFor(await milkSheet(session(), T0, "MORNING", db), cow);
    const msg = row.lockMessage ?? "";

    expect(msg).toMatch(/Njeri/); // whose milk
    expect(msg).toMatch(/Norocillin \(label mislaid\)/); // which bottle
    expect(msg).toMatch(/do not know/i); // that we are guessing
    expect(msg).toMatch(/Check the label/i); // and the way out of the guess
    // The date it clears, written the way a herdsman reads it.
    expect(msg).toMatch(/10 Aug|Aug|until/i);
    // It must not read like a settled, label-backed withdrawal.
    expect(msg).not.toMatch(/^Do not sell Njeri's milk until/);
  });

  it("saves her milk record unsaleable, stamped WITHDRAWAL_UNKNOWN rather than plain WITHDRAWAL", async () => {
    const { cow } = await treatWithUnknownPeriod();
    const batch = await recordMilkBatch(
      session(),
      { date: T0, session: "MORNING", rows: [{ animalId: cow, litres: 16 }] },
      db,
    );
    if (!batch.ok) throw new Error(batch.error);

    // Recorded, never refused — the block is on selling, not on writing down.
    expect(batch.data.totalL).toBe(16);
    expect(batch.data.saleableL).toBe(0);
    expect(batch.data.locked[0].reason).toBe("WITHDRAWAL_UNKNOWN");
    expect(batch.data.locked[0].message).toMatch(/Norocillin \(label mislaid\)/);

    const [record] = await db.select().from(s.milkRecord);
    expect(record.saleable).toBe(false);
    expect(record.notSaleableReason).toBe("WITHDRAWAL_UNKNOWN");
    expect(record.notSaleableReason).not.toBe("WITHDRAWAL");
    expect(record.litres).toBe("16.00");
  });

  /**
   * DEFECT 2, third face, and the expensive one: it still reaches the co-op
   * churn. The sheet and the record now both hold her, but `dayProduction`
   * counts a WITHDRAWAL_UNKNOWN row into NEITHER `withheldL` nor `colostrumL`
   * (milk.ts, `if (r.notSaleableReason === "WITHDRAWAL")`), so `withdrawalGuard`
   * sees `day.withheldL === 0`, takes the warn-only branch meant for a sheet
   * that has not been filled in, and lets 16 L of residue milk into the can
   * with nothing but a message. STILL OPEN.
   */
  it.fails("DEFECT: unknown-period milk is warned about but still sold to the co-op", async () => {
    const { cow } = await treatWithUnknownPeriod();
    await recordMilkBatch(session(), { date: T0, session: "MORNING", rows: [{ animalId: cow, litres: 16 }] }, db);

    // The root cause, asserted directly: her litres vanish from the day's totals.
    const day = await dayProduction(session(), T0, db);
    expect(day.withheldL).toBe(16);

    const coopId = await seedCustomer(db, { customerType: "COOP" });
    const sold = await recordDisposal(session(), { date: T0, channel: "COOP", customerId: coopId, litres: 16 }, db);
    if (!sold.ok) throw new Error(sold.error);
    expect(sold.data.channel).toBe("WITHHELD_TREATMENT");
  });

  /** What the sale DOES manage today, so the partial fix cannot silently rot. */
  it("at least names her when the can is sold, instead of waving it through in silence", async () => {
    const { cow } = await treatWithUnknownPeriod();
    await recordMilkBatch(session(), { date: T0, session: "MORNING", rows: [{ animalId: cow, litres: 16 }] }, db);
    const coopId = await seedCustomer(db, { customerType: "COOP" });
    const sold = await recordDisposal(session(), { date: T0, channel: "COOP", customerId: coopId, litres: 16 }, db);
    if (!sold.ok) throw new Error(sold.error);
    expect(sold.data.blockMessage ?? "").toMatch(/Njeri/);
    expect(sold.data.blockMessage ?? "").toMatch(/never recorded/i);
  });

  /**
   * The heart of the fix. "We do not know the withdrawal period" and "this
   * product has no withdrawal period" are DIFFERENT facts and the milking sheet
   * must act differently on them: zero sells freely, unknown is held and said
   * out loud. Getting this wrong in either direction is a failure — waving the
   * unknown one through puts residue in the churn, and holding the zero-day one
   * dumps saleable milk for nothing.
   */
  it("tells a genuine zero-day withdrawal apart from an unrecorded one — zero sells, unknown is held", async () => {
    const unknownCow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    const zeroCow = await seedMilkingCow({ name: "Nyambura", tag: "KE-0002" });
    const unknownProduct = await seedProduct(db, { name: "Norocillin (label mislaid)", milkWithdrawalDays: null });
    const zeroProduct = await seedProduct(db, {
      name: "Multivitamin injection",
      productType: "MINERAL",
      milkWithdrawalDays: 0,
      meatWithdrawalDays: 0,
    });
    await recordTreatmentFor(session(), { animalId: unknownCow, productId: unknownProduct, occurredOn: T0 }, db);
    await recordTreatmentFor(session(), { animalId: zeroCow, productId: zeroProduct, occurredOn: T0 }, db);

    const sheet = await milkSheet(session(), T0, "MORNING", db);

    // Unknown: held, with a reason of its own and a date to wait for.
    expect(rowFor(sheet, unknownCow).locked).toBe(true);
    expect(rowFor(sheet, unknownCow).lockReason).toBe("WITHDRAWAL_UNKNOWN");
    expect(rowFor(sheet, unknownCow).saleable).toBe(false);
    expect(rowFor(sheet, unknownCow).milkClearOn).toBe(D(7));
    expect(rowFor(sheet, unknownCow).lockMessage).not.toBeNull();

    // Zero: a multivitamin is not a withdrawal. She sells today, silently.
    expect(rowFor(sheet, zeroCow).locked).toBe(false);
    expect(rowFor(sheet, zeroCow).lockReason).toBeNull();
    expect(rowFor(sheet, zeroCow).lockMessage).toBeNull();
    expect(rowFor(sheet, zeroCow).saleable).toBe(true);
    expect(rowFor(sheet, zeroCow).milkClearOn).toBeNull();

    expect(sheet.lockedCount).toBe(1);

    // The distinction survives all the way down to the stored records.
    await recordMilkBatch(
      session(),
      {
        date: T0,
        session: "MORNING",
        rows: [
          { animalId: unknownCow, litres: 16 },
          { animalId: zeroCow, litres: 14 },
        ],
      },
      db,
    );
    const records = await db.select().from(s.milkRecord);
    const byAnimal = new Map(records.map((r) => [r.animalId, r]));
    expect(byAnimal.get(unknownCow)!.saleable).toBe(false);
    expect(byAnimal.get(unknownCow)!.notSaleableReason).toBe("WITHDRAWAL_UNKNOWN");
    expect(byAnimal.get(zeroCow)!.saleable).toBe(true);
    expect(byAnimal.get(zeroCow)!.notSaleableReason).toBeNull();

    // And the health module still reports the two apart at its own level.
    const statuses = await getWithdrawalStatus(session(), [unknownCow, zeroCow], T0, db);
    expect(statuses.get(unknownCow)!.unknownPeriod).toBe(true);
    expect(statuses.get(zeroCow)!.unknownPeriod).toBe(false);
  });

  /**
   * DEFECT 3 is closed at the type level: `MilkSheetRow.lockReason` and
   * `milkRecord.notSaleableReason` both carry WITHDRAWAL_UNKNOWN, so the screen
   * a herdsman uses twice a day can finally express "we do not know if she is
   * clear" instead of having to choose between "treated" and "fine".
   */
  it("gives the milk sheet a lock reason that means 'we do not know if she is clear'", async () => {
    const { cow } = await treatWithUnknownPeriod();
    const row = rowFor(await milkSheet(session(), T0, "MORNING", db), cow);

    expect(row.lockReason).toBe("WITHDRAWAL_UNKNOWN");
    // Distinct from BOTH existing reasons — it is a third fact, not a relabel.
    expect(row.lockReason).not.toBe("WITHDRAWAL");
    expect(row.lockReason).not.toBe("COLOSTRUM");
    expect(row.lockMessage).not.toBeNull();
    // And it survives the round trip into storage, not just the view model.
    await recordMilkBatch(session(), { date: T0, session: "MORNING", rows: [{ animalId: cow, litres: 16 }] }, db);
    const [record] = await db.select().from(s.milkRecord);
    expect(record.notSaleableReason).toBe(row.lockReason);
  });

  it("stops holding her once the assumed window has run out", async () => {
    // The assumption must expire on its own, or an unlabelled bottle would
    // condemn a cow indefinitely and the farm would stop recording treatments.
    const { cow } = await treatWithUnknownPeriod();
    expect(rowFor(await milkSheet(session(), D(6), "MORNING", db), cow).locked).toBe(true);
    const clear = rowFor(await milkSheet(session(), D(7), "MORNING", db), cow);
    expect(clear.locked).toBe(false);
    expect(clear.saleable).toBe(true);
  });

  it("does not hold her on an unknown period from ninety days ago", async () => {
    // MAX_WITHDRAWAL_LOOKBACK_DAYS = 60. One bad entry must not fence a cow off
    // the tank for the rest of her life.
    const cow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    const productId = await seedProduct(db, { name: "Norocillin (label mislaid)", milkWithdrawalDays: null });
    await recordTreatmentFor(session(), { animalId: cow, productId, occurredOn: D(-90) }, db);

    expect((await withdrawalMap(db, FARM_ID, T0)).has(cow)).toBe(false);
    const row = rowFor(await milkSheet(session(), T0, "MORNING", db), cow);
    expect(row.locked).toBe(false);
    expect(row.saleable).toBe(true);
  });
});

/* ================================================================== */
/* SEAM 1b (second half) — a withdrawal that expires before the flush  */
/* ================================================================== */

/**
 * R3 says saving never requires the network, so the phone queues a milking and
 * flushes it whenever a signal turns up — sometimes days later. Both
 * `milkSheet` and `recordMilkBatch` now pass their own date into
 * `withdrawalMap` instead of letting it default to the wall clock, so the
 * question asked is "was she clear on the day this milk came out of her?" and
 * not "is she clear at the moment the phone found a signal?".
 */
describe("a milking captured during withdrawal but synced after it expired", () => {
  async function treatedTenDaysAgo() {
    const cow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    const productId = await seedProduct(db, { milkWithdrawalDays: 7 });
    const treated = await recordTreatmentFor(session(), { animalId: cow, productId, occurredOn: D(-10) }, db);
    if (!treated.ok) throw new Error(treated.error);
    // Clear three days ago; the milking below happened while she was blocked.
    expect(treated.data.milkClearOn).toBe(D(-3));
    return cow;
  }

  it("was genuinely blocked on the day it was milked, and health still says so", async () => {
    const cow = await treatedTenDaysAgo();
    const status = (await getWithdrawalStatus(session(), [cow], D(-8), db)).get(cow)!;
    expect(status.milkBlocked).toBe(true);
    expect(status.milkClearOn).toBe(D(-3));
  });

  it("stores a late-flushed milking from a withdrawal day as withheld", async () => {
    const cow = await treatedTenDaysAgo();
    const batch = await recordMilkBatch(
      session(),
      { date: D(-8), session: "MORNING", rows: [{ animalId: cow, litres: 16 }] },
      db,
    );
    if (!batch.ok) throw new Error(batch.error);

    expect(batch.data.totalL).toBe(16);
    expect(batch.data.withheldL).toBe(16);
    expect(batch.data.saleableL).toBe(0);
    expect(batch.data.locked[0].reason).toBe("WITHDRAWAL");
    expect(batch.data.locked[0].name).toBe("Njeri");

    const [record] = await db.select().from(s.milkRecord);
    expect(record.recordedOn).toBe(D(-8));
    expect(record.saleable).toBe(false);
    expect(record.notSaleableReason).toBe("WITHDRAWAL");

    // And it is the DATE that decides, not the flush: the same cow's milk from
    // after her clear date flushes saleable in the very same session.
    const later = await recordMilkBatch(
      session(),
      { date: D(-1), session: "MORNING", rows: [{ animalId: cow, litres: 15 }] },
      db,
    );
    if (!later.ok) throw new Error(later.error);
    expect(later.data.saleableL).toBe(15);
    expect(later.data.withheldL).toBe(0);
  });

  it("shows her locked when the sheet for a withdrawal day is re-opened", async () => {
    const cow = await treatedTenDaysAgo();
    const row = rowFor(await milkSheet(session(), D(-8), "MORNING", db), cow);
    expect(row.locked).toBe(true);
    expect(row.lockReason).toBe("WITHDRAWAL");
    expect(row.saleable).toBe(false);
    expect(row.milkClearOn).toBe(D(-3));
    expect(row.lockMessage).toMatch(/Do not sell Njeri's milk/);
  });

  it("puts the boundary on the clear date itself — blocked the day before, clear on the day", async () => {
    // The stored clear timestamp is midnight, so D(-3) is her first clear day.
    // Getting this off by one either condemns a good milking or releases a bad one.
    const cow = await treatedTenDaysAgo();
    expect(rowFor(await milkSheet(session(), D(-4), "MORNING", db), cow).locked).toBe(true);
    expect(rowFor(await milkSheet(session(), D(-3), "MORNING", db), cow).locked).toBe(false);
  });
});

/* ================================================================== */
/* SEAM 1c — dry cow therapy                                           */
/* ================================================================== */

describe("dry cow therapy reaches the milking sheet", () => {
  /** A cephalonium dry cow tube: not for lactating cows, no simple day count. */
  async function seedDryCowTube() {
    return seedProduct(db, {
      name: "Cepravin Dry Cow",
      activeIngredient: "Cephalonium",
      productType: "INTRAMAMMARY",
      milkWithdrawalDays: null,
      meatWithdrawalDays: 28,
      notForLactating: true,
      labelSource: "PCPB label",
    });
  }

  it("blocks her milk for 30 days from infusion even though the product has no day count", async () => {
    const cow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    const productId = await seedDryCowTube();

    const infused = await recordDryCowTherapyFor(session(), { animalId: cow, productId, occurredOn: T0 }, db);
    if (!infused.ok) throw new Error(infused.error);
    expect(infused.data.isDryCowTherapy).toBe(true);
    expect(infused.data.milkClearOn).toBe(D(30));

    // The 30-day rule is visible to M3 because it landed in `milkClearAt`.
    const row = rowFor(await milkSheet(session(), T0, "MORNING", db), cow);
    expect(row.locked).toBe(true);
    expect(row.lockReason).toBe("WITHDRAWAL");
    expect(row.milkClearOn).toBe(D(30));
  });

  it("takes the LATER of 30 days after infusion and 96 hours after calving", async () => {
    const cow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    const productId = await seedDryCowTube();

    // She calves 40 days after the tube goes in, so calving + 96 h is the later leg.
    const infused = await recordDryCowTherapyFor(
      session(),
      { animalId: cow, productId, occurredOn: T0, calvedOn: D(40) },
      db,
    );
    if (!infused.ok) throw new Error(infused.error);
    expect(infused.data.milkClearOn).toBe(D(44));
  });

  /**
   * The seam the dry-off screen has to close: M2 writes the dry-off, and unless
   * it ALSO writes a `healthEvent`, the 30-day rule is invisible to M3, which
   * consults nothing else.
   */
  it("writes a health event whose clear date lands in the column the milking sheet reads", async () => {
    const cow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    const productId = await seedDryCowTube();
    // She is in calf and due in 50 days — the ordinary reason to dry a cow off.
    await db.insert(s.service).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: cow,
      servedOn: D(-233),
      serviceType: "AI",
      expectedCalvingOn: D(50),
      recordedBy: USER,
    });
    await db.insert(s.pregnancyCheck).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: cow,
      checkedOn: D(-190),
      method: "PALPATION",
      result: "POSITIVE",
      recordedBy: USER,
    });

    const dried = await recordDryOff(
      null,
      fd({ animalId: cow, driedOn: T0, method: "ABRUPT", dryCowTherapyProductId: productId }),
    );
    if (!dried.ok) throw new Error(dried.error);
    // 30 days after infusion vs expected calving + 96 h — the later one wins.
    expect(dried.data.milkClearOn).toBe(D(54));

    const events = await db.select().from(s.healthEvent).where(eq(s.healthEvent.animalId, cow));
    expect(events).toHaveLength(1);
    expect(events[0].isDryCowTherapy).toBe(true);
    expect(events[0].productId).toBe(productId);
    expect(events[0].milkClearAt).not.toBeNull();

    // The column M3 actually reads, read the way M3 reads it.
    const map = await withdrawalMap(db, FARM_ID);
    expect(fromDate(map.get(cow)!.milkClearAt)).toBe(D(54));
  });

  it("keeps her blocked as a treated cow, not merely as a fresh cow, when she calves back in", async () => {
    const cow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    const productId = await seedDryCowTube();
    await db.insert(s.service).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: cow,
      servedOn: D(-233),
      serviceType: "AI",
      expectedCalvingOn: D(50),
      recordedBy: USER,
    });
    await recordDryOff(null, fd({ animalId: cow, driedOn: T0, dryCowTherapyProductId: productId }));

    // Dried off: off the sheet entirely.
    const driedSheet = await milkSheet(session(), D(1), "MORNING", db);
    expect(driedSheet.rows.map((r) => r.animalId)).not.toContain(cow);

    // She calves on the expected day and comes back on the sheet — locked for
    // WITHDRAWAL, which outranks the colostrum lock because it is the legal one.
    await db.insert(s.calving).values({
      id: newId(),
      farmId: FARM_ID,
      damId: cow,
      calvedOn: D(50),
      recordedBy: USER,
    });
    const row = rowFor(await milkSheet(session(), D(51), "MORNING", db), cow);
    expect(row.locked).toBe(true);
    expect(row.lockReason).toBe("WITHDRAWAL");
    expect(row.milkClearOn).toBe(D(54));
  });

  /**
   * FINDING (not a fail-open, but two sources of truth). The dry-off stores a
   * clear date computed from the EXPECTED calving; `getWithdrawalStatus`
   * recomputes it from the ACTUAL calving. The milk sheet reads the stored one.
   * When she calves later than forecast the stored date is short — here by two
   * weeks — and only the colostrum lock (calving + 4 days) is left holding the
   * 96-hour leg.
   */
  it("stores the forecast clear date, while the health contract recomputes the real one", async () => {
    const cow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    const productId = await seedDryCowTube();
    await db.insert(s.service).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: cow,
      servedOn: D(-263),
      serviceType: "AI",
      expectedCalvingOn: D(20),
      recordedBy: USER,
    });
    await recordDryOff(null, fd({ animalId: cow, driedOn: T0, dryCowTherapyProductId: productId }));

    // She runs two weeks over.
    await db.insert(s.calving).values({
      id: newId(),
      farmId: FARM_ID,
      damId: cow,
      calvedOn: D(40),
      recordedBy: USER,
    });

    const stored = await withdrawalMap(db, FARM_ID);
    const recomputed = await getWithdrawalStatus(session(), [cow], D(41), db);
    expect(fromDate(stored.get(cow)!.milkClearAt)).toBe(D(30)); // what the sheet uses
    expect(recomputed.get(cow)!.milkClearOn).toBe(D(44)); // calving + 96 h, the truth

    // What actually holds the line for those four days is the colostrum lock.
    const row = rowFor(await milkSheet(session(), D(41), "MORNING", db), cow);
    expect(row.locked).toBe(true);
  });
});

/* ================================================================== */
/* SEAM 1d — overlapping treatments                                    */
/* ================================================================== */

describe("two treatments at once", () => {
  it("keeps the LATEST clear date, whichever order the treatments were written in", async () => {
    const long = await seedProduct(db, { name: "Tylosin LA", milkWithdrawalDays: 21, meatWithdrawalDays: 35 });
    const short = await seedProduct(db, { name: "Oxytet 5%", milkWithdrawalDays: 3, meatWithdrawalDays: 14 });

    // Njeri: the long course is written FIRST, the short one second.
    const njeri = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    await recordTreatmentFor(session(), { animalId: njeri, productId: long, occurredOn: T0 }, db);
    await recordTreatmentFor(session(), { animalId: njeri, productId: short, occurredOn: T0 }, db);

    // Nyambura: the same two, the other way round.
    const nyambura = await seedMilkingCow({ name: "Nyambura", tag: "KE-0002" });
    await recordTreatmentFor(session(), { animalId: nyambura, productId: short, occurredOn: T0 }, db);
    await recordTreatmentFor(session(), { animalId: nyambura, productId: long, occurredOn: T0 }, db);

    const sheet = await milkSheet(session(), T0, "MORNING", db);
    expect(rowFor(sheet, njeri).milkClearOn).toBe(D(21));
    expect(rowFor(sheet, nyambura).milkClearOn).toBe(D(21));

    const statuses = await getWithdrawalStatus(session(), [njeri, nyambura], T0, db);
    expect(statuses.get(njeri)!.milkClearOn).toBe(D(21));
    expect(statuses.get(nyambura)!.milkClearOn).toBe(D(21));
    expect(statuses.get(njeri)!.meatClearOn).toBe(D(35));
  });

  it("does not let a short second treatment release her early", async () => {
    const cow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    const long = await seedProduct(db, { name: "Tylosin LA", milkWithdrawalDays: 21 });
    const short = await seedProduct(db, { name: "Oxytet 5%", milkWithdrawalDays: 3 });
    await recordTreatmentFor(session(), { animalId: cow, productId: long, occurredOn: D(-5) }, db);
    await recordTreatmentFor(session(), { animalId: cow, productId: short, occurredOn: T0 }, db);

    const row = rowFor(await milkSheet(session(), T0, "MORNING", db), cow);
    expect(row.milkClearOn).toBe(D(16)); // long course from five days ago, not T0 + 3
    expect(row.locked).toBe(true);
  });
});

/* ================================================================== */
/* SEAM 1e — the meat block                                            */
/* ================================================================== */

describe("an animal under meat withdrawal", () => {
  async function treatedForMeat() {
    const cow = await seedMilkingCow({ name: "Wanjiku", tag: "KE-0009" });
    const productId = await seedProduct(db, {
      name: "Penstrep",
      milkWithdrawalDays: 7,
      meatWithdrawalDays: 28,
    });
    await recordTreatmentFor(session(), { animalId: cow, productId, occurredOn: T0 }, db);
    return cow;
  }

  it("is known to the health module as blocked for slaughter", async () => {
    const cow = await treatedForMeat();
    const status = (await getWithdrawalStatus(session(), [cow], T0, db)).get(cow)!;
    expect(status.meatBlocked).toBe(true);
    expect(status.meatClearOn).toBe(D(28));
    expect(status.message).toMatch(/Do not sell her for slaughter until/);
    expect(status.plainMessage).toMatch(/Do not sell Wanjiku for slaughter until/);
  });

  it("refuses to sell her for slaughter three days after an antibiotic, and says why", async () => {
    const cow = await treatedForMeat();
    const sale = await recordSale(
      session(),
      {
        animalId: cow,
        exitDate: D(3),
        reason: "SLAUGHTERED",
        priceKes: 62_000,
        counterpartyKind: "BUTCHERY",
        weightKg: 420,
      },
      db,
    );

    expect(sale.ok).toBe(false);
    if (sale.ok) return;
    expect(sale.error).toMatch(/Wanjiku/); // which animal
    expect(sale.error).toMatch(new RegExp(D(28))); // the date she IS clear
    expect(sale.error).toMatch(/not clear for slaughter/i);
    expect(sale.error).toMatch(/residue/i); // and why it matters
  });

  it("writes nothing at all when it refuses — no exit, no income, no receipt", async () => {
    const cow = await treatedForMeat();
    const sale = await recordSale(
      session(),
      { animalId: cow, exitDate: D(3), reason: "SLAUGHTERED", priceKes: 62_000, counterpartyKind: "BUTCHERY" },
      db,
    );
    expect(sale.ok).toBe(false);
    expect(await db.select().from(s.animalExit)).toHaveLength(0);
    expect(await db.select().from(s.income)).toHaveLength(0);
    // No sale receipt either — the refusal is total, not a half-written exit.
    // (The treatment that caused the refusal wrote its own HEALTH receipt.)
    expect(await db.select().from(s.receipt).where(eq(s.receipt.kind, "SALE"))).toHaveLength(0);
  });

  for (const counterpartyKind of ["BUTCHERY", "KMC"] as const) {
    it(`refuses a sale to ${counterpartyKind} even when the reason is only SOLD`, async () => {
      // The route to the abattoir is what matters, not the word on the form.
      const cow = await treatedForMeat();
      const sale = await recordSale(
        session(),
        { animalId: cow, exitDate: D(3), reason: "SOLD", priceKes: 62_000, counterpartyKind },
        db,
      );
      expect(sale.ok).toBe(false);
      expect(await db.select().from(s.animalExit)).toHaveLength(0);
    });
  }

  it("lets the slaughter sale through once the meat withdrawal has run out", async () => {
    // The block must expire, or it becomes a reason to stop recording treatments.
    const cow = await treatedForMeat();
    const sale = await recordSale(
      session(),
      { animalId: cow, exitDate: D(28), reason: "SLAUGHTERED", priceKes: 62_000, counterpartyKind: "BUTCHERY" },
      db,
    );
    if (!sale.ok) throw new Error(sale.error);
    expect(await db.select().from(s.animalExit)).toHaveLength(1);
  });

  it("holds her for the assumed meat window when no meat period was recorded either", async () => {
    const cow = await seedMilkingCow({ name: "Wanjiku", tag: "KE-0009" });
    const productId = await seedProduct(db, {
      name: "Norocillin (label mislaid)",
      milkWithdrawalDays: null,
      meatWithdrawalDays: null,
      labelSource: null,
    });
    await recordTreatmentFor(session(), { animalId: cow, productId, occurredOn: T0 }, db);

    expect(ASSUMED_MEAT_WITHDRAWAL_DAYS).toBe(28);
    const sale = await recordSale(
      session(),
      { animalId: cow, exitDate: D(3), reason: "SLAUGHTERED", priceKes: 62_000, counterpartyKind: "BUTCHERY" },
      db,
    );
    expect(sale.ok).toBe(false);
    if (sale.ok) return;
    expect(sale.error).toMatch(/no meat withdrawal period was recorded/i);
    expect(sale.error).toMatch(/Norocillin \(label mislaid\)/);
    expect(sale.error).toMatch(new RegExp(D(28)));
    expect(sale.error).toMatch(/Check the label/i);
  });

  it("does not refuse a lawful farmer-to-farmer sale of a treated cow", async () => {
    // Selling her on alive is legal. Only the slaughter routes are refused —
    // blocking every sale would be the rigid validation R4 exists to prevent.
    const cow = await treatedForMeat();
    const sale = await recordSale(
      session(),
      { animalId: cow, exitDate: D(3), reason: "SOLD", priceKes: 90_000, counterpartyKind: "FARMER" },
      db,
    );
    if (!sale.ok) throw new Error(sale.error);
    expect(await db.select().from(s.animalExit)).toHaveLength(1);
  });

  /**
   * STILL OPEN. `recordSale` builds the warning for the lawful farmer-to-farmer
   * case — "tell the buyer, she must not be slaughtered before that date" — and
   * then throws it away: `void warnings;` at the end of the happy path, and
   * `SaleResult` has no field to carry it. So the buyer is never told, and the
   * next farm slaughters her inside the withdrawal in perfect ignorance.
   */
  it.fails("DEFECT: the meat-withdrawal warning on a farmer sale is computed and discarded", async () => {
    const cow = await treatedForMeat();
    const sale = await recordSale(
      session(),
      { animalId: cow, exitDate: D(3), reason: "SOLD", priceKes: 90_000, counterpartyKind: "FARMER" },
      db,
    );
    if (!sale.ok) throw new Error(sale.error);
    expect(JSON.stringify(sale)).toMatch(/must not be slaughtered before/i);
  });
});

/* ================================================================== */
/* SEAM 5 — tenancy across the safety seam                             */
/* ================================================================== */

describe("another farm's ids are refused exactly like ids that do not exist", () => {
  it("refuses to treat another farm's cow, in the same words as an unknown id", async () => {
    const foreign = await seedOtherFarmAnimal();
    const productId = await seedProduct(db);
    const missing = newId();

    await expect(
      recordTreatmentFor(session(), { animalId: foreign, productId, occurredOn: T0 }, db),
    ).rejects.toThrow("That animal was not found.");
    await expect(
      recordTreatmentFor(session(), { animalId: missing, productId, occurredOn: T0 }, db),
    ).rejects.toThrow("That animal was not found.");
  });

  it("refuses another farm's product in the same words as an unknown product", async () => {
    const cow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    await db.insert(s.farm).values({ id: OTHER_FARM, name: "Nakuru Rival Dairy" }).onConflictDoNothing();
    const foreignProduct = newId();
    await db.insert(s.product).values({
      id: foreignProduct,
      farmId: OTHER_FARM,
      name: "Their penstrep",
      productType: "ANTIBIOTIC",
      milkWithdrawalDays: 7,
    });

    await expect(
      recordTreatmentFor(session(), { animalId: cow, productId: foreignProduct, occurredOn: T0 }, db),
    ).rejects.toThrow("That product was not found.");
    await expect(
      recordTreatmentFor(session(), { animalId: cow, productId: newId(), occurredOn: T0 }, db),
    ).rejects.toThrow("That product was not found.");
  });

  it("returns the same message from the milk batch for a foreign cow and a missing one", async () => {
    const foreign = await seedOtherFarmAnimal();
    const foreignResult = await recordMilkBatch(
      session(),
      { date: T0, session: "MORNING", rows: [{ animalId: foreign, litres: 12 }] },
      db,
    );
    const missingResult = await recordMilkBatch(
      session(),
      { date: T0, session: "MORNING", rows: [{ animalId: newId(), litres: 12 }] },
      db,
    );
    expect(foreignResult.ok).toBe(false);
    expect(missingResult.ok).toBe(false);
    expect(foreignResult).toEqual(missingResult);
    expect(await db.select().from(s.milkRecord)).toHaveLength(0);
  });

  it("never reports another farm's cow as clear — she is simply absent from the board", async () => {
    const foreign = await seedOtherFarmAnimal();
    const statuses = await getWithdrawalStatus(session(), [foreign, newId()], T0, db);
    expect(statuses.size).toBe(0);
  });

  it("refuses a disposal against another farm's customer like an unknown customer", async () => {
    await db.insert(s.farm).values({ id: OTHER_FARM, name: "Nakuru Rival Dairy" }).onConflictDoNothing();
    const foreignCustomer = newId();
    await db.insert(s.customer).values({
      id: foreignCustomer,
      farmId: OTHER_FARM,
      name: "Their co-op",
      customerType: "COOP",
    });

    const foreignResult = await recordDisposal(
      session(),
      { date: T0, channel: "COOP", customerId: foreignCustomer, litres: 20 },
      db,
    );
    const missingResult = await recordDisposal(
      session(),
      { date: T0, channel: "COOP", customerId: newId(), litres: 20 },
      db,
    );
    expect(foreignResult).toEqual({ ok: false, error: "That customer was not found." });
    expect(missingResult).toEqual({ ok: false, error: "That customer was not found." });
    expect(await db.select().from(s.milkDisposal)).toHaveLength(0);
  });

  it("refuses to sell another farm's animal for slaughter like one that does not exist", async () => {
    const foreign = await seedOtherFarmAnimal();
    const foreignResult = await recordSale(session(), { animalId: foreign, exitDate: T0, reason: "SOLD", priceKes: 50_000 }, db);
    const missingResult = await recordSale(session(), { animalId: newId(), exitDate: T0, reason: "SOLD", priceKes: 50_000 }, db);
    expect(foreignResult).toEqual({ ok: false, error: "That animal was not found." });
    expect(missingResult).toEqual({ ok: false, error: "That animal was not found." });
    expect(await db.select().from(s.animalExit)).toHaveLength(0);
  });

  it("shows an intruding farm an empty milking sheet, not ours", async () => {
    const cow = await seedMilkingCow({ name: "Njeri", tag: "KE-0001" });
    await recordMilkBatch(session(), { date: T0, session: "MORNING", rows: [{ animalId: cow, litres: 16 }] }, db);

    const intruder = fakeSession({ role: "OWNER", farmId: OTHER_FARM });
    const sheet = await milkSheet(intruder, T0, "MORNING", db);
    expect(sheet.rows).toHaveLength(0);
    expect(sheet.recordedTotalL).toBe(0);
  });
});
