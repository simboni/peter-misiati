import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { FARM_ID, fakeSession, seedAnimal, seedFarm, seedProduct } from "@/test/factory";
import { newId } from "@/lib/ids";
import * as s from "@/db/schema";
import {
  animalHealthHistory,
  createProductFor,
  dueRoutines,
  getWithdrawalStatus,
  listProducts,
  plainDate,
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

/**
 * M6 against a real database — above all, the withdrawal engine.
 *
 * This is the only module that blocks. Every test here is really asking one of
 * two questions: does the block engage when it must, and does it lift exactly
 * when it should?
 */

const OTHER_FARM = "22222222-2222-4222-8222-222222222222";
const session = fakeSession({ role: "MANAGER" });

async function setup() {
  const t = await createTestDb();
  await seedFarm(t.db);
  return t;
}

async function seedOtherFarm(db: TestDb) {
  await db.insert(s.farm).values({ id: OTHER_FARM, name: "Nyandarua Rival Dairy" }).onConflictDoNothing();
  const animalId = newId();
  await db.insert(s.animal).values({
    id: animalId,
    farmId: OTHER_FARM,
    tag: "NY-1",
    name: "Wanjiku",
    sex: "F",
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

/** She was milked yesterday, so she counts as in milk today. */
async function seedMilking(db: DbLike, animalId: string, on = "2026-07-31") {
  await db.insert(s.milkRecord).values({
    id: newId(),
    farmId: FARM_ID,
    animalId,
    recordedOn: on,
    session: "MORNING",
    litres: "12.50",
    recordedBy: session.userId,
    recordedAt: new Date(),
  });
}

/* ---------------------------------------------------------------- */
/* The drug master                                                   */
/* ---------------------------------------------------------------- */

describe("the drug master", () => {
  it("stores the label period and the provenance", async () => {
    const t = await setup();
    const r = await createProductFor(
      session,
      {
        name: "Oxytetracycline LA 20%",
        activeIngredient: "Oxytetracycline",
        productType: "ANTIBIOTIC",
        milkWithdrawalDays: 7,
        meatWithdrawalDays: 28,
        labelSource: "PCPB label, 2026",
      },
      t.db as DbLike,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.warnings).toEqual([]);

    const [row] = await t.db.select().from(s.product).where(eq(s.product.id, r.data.id));
    expect(row.milkWithdrawalDays).toBe(7);
    expect(row.labelSource).toBe("PCPB label, 2026");
    await t.close();
  });

  it("stores a missing period as UNKNOWN and says so — never as zero", async () => {
    const t = await setup();
    const r = await createProductFor(
      session,
      { name: "Something from the agrovet", productType: "ANTIBIOTIC" },
      t.db as DbLike,
    );
    if (!r.ok) throw new Error(r.error);
    const [row] = await t.db.select().from(s.product).where(eq(s.product.id, r.data.id));
    expect(row.milkWithdrawalDays).toBeNull();
    expect(row.milkWithdrawalDays).not.toBe(0);
    expect(r.data.warnings.join(" ")).toContain("No milk withdrawal period recorded");
    expect(r.data.warnings.join(" ")).toContain("legal defence");
    await t.close();
  });

  it("lists this farm's products and shared reference ones, not another farm's", async () => {
    const t = await setup();
    await seedProduct(t.db, { name: "Ours" });
    await t.db.insert(s.product).values({
      id: newId(),
      farmId: null,
      name: "Shared reference product",
      productType: "VACCINE",
    });
    await seedOtherFarm(t.db);

    const names = (await listProducts(session, t.db as DbLike)).map((p) => p.name);
    expect(names).toContain("Ours");
    expect(names).toContain("Shared reference product");
    expect(names).not.toContain("Their penicillin");
    await t.close();
  });
});

/* ---------------------------------------------------------------- */
/* Observations                                                      */
/* ---------------------------------------------------------------- */

describe("observations", () => {
  it("takes what the herdsman can see, with no diagnosis, and tells the manager", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Njeri" });
    const r = await recordObservationFor(
      session,
      { animalId, occurredOn: "2026-08-03", signs: "Not eating, swollen left hind quarter" },
      t.db as DbLike,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.message).toBe("Noted for Njeri. The manager will see this.");
    expect(r.refCode).toMatch(/^HL/);

    const [event] = await t.db.select().from(s.healthEvent).where(eq(s.healthEvent.id, r.data.id));
    expect(event.eventType).toBe("OBSERVATION");
    expect(event.diagnosis).toBeNull();

    const alerts = await t.db.select().from(s.alert).where(eq(s.alert.kind, "HEALTH_OBSERVATION"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].assignedRole).toBe("MANAGER");
    expect(alerts[0].action).toContain("Check Njeri");
    await t.close();
  });
});

/* ---------------------------------------------------------------- */
/* TREATMENT — the block engaging                                    */
/* ---------------------------------------------------------------- */

describe("recording a treatment", () => {
  it("sets both clear dates from the product's own label", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Njeri" });
    const productId = await seedProduct(t.db); // 7 days milk, 28 days meat

    const r = await recordTreatmentFor(
      session,
      { animalId, productId, occurredOn: "2026-07-31", dose: "20 ml", route: "IM" },
      t.db as DbLike,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);

    expect(r.data.treatmentEndOn).toBe("2026-07-31");
    expect(r.data.milkClearOn).toBe("2026-08-07");
    expect(r.data.meatClearOn).toBe("2026-08-28");

    // The receipt is the whole point of the feature: one sentence, no jargon.
    expect(r.message).toBe("Do not sell Njeri's milk until Friday 7 August.");
    expect(r.data.receiptLines).toContain("Do not sell Njeri for slaughter until Friday 28 August.");
    expect(r.refCode).toMatch(/^HL/);

    const [row] = await t.db.select().from(s.healthEvent).where(eq(s.healthEvent.id, r.data.id));
    expect(row.milkClearAt).toBeTruthy();
    expect(row.meatClearAt).toBe("2026-08-28");
    await t.close();
  });

  it("withdraws from the LAST dose of a course, not the first", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Njeri" });
    const productId = await seedProduct(t.db, {
      name: "Penicillin-streptomycin",
      milkWithdrawalDays: 3,
      meatWithdrawalDays: 14,
    });

    const r = await recordTreatmentFor(
      session,
      { animalId, productId, occurredOn: "2026-08-01", durationDays: 5 },
      t.db as DbLike,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.data.treatmentEndOn).toBe("2026-08-05");
    expect(r.data.milkClearOn).toBe("2026-08-08");
    await t.close();
  });

  it("gives no clear date and a loud warning when the label period is unknown", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Njeri" });
    const productId = await seedProduct(t.db, {
      name: "Unlabelled agrovet antibiotic",
      milkWithdrawalDays: null,
      meatWithdrawalDays: null,
      labelSource: null,
    });

    const r = await recordTreatmentFor(session, { animalId, productId }, t.db as DbLike);
    if (!r.ok) throw new Error(r.error);
    // Unknown, never zero. The record still saves — refusing it would just mean
    // the treatment goes unrecorded and the milk gets sold anyway.
    expect(r.data.milkClearOn).toBeNull();
    expect(r.data.meatClearOn).toBeNull();
    expect(r.message).toContain("not recorded");
    expect(r.data.warnings.join(" ")).toContain("No milk withdrawal period is recorded");
    expect(r.data.warnings.join(" ")).toContain("label source");
    await t.close();
  });

  it("warns loudly when a not-for-lactating product goes into a milking cow", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Njeri" });
    await seedMilking(t.db as DbLike, animalId);
    const productId = await seedProduct(t.db, {
      name: "Ivermectin injectable",
      productType: "DEWORMER",
      notForLactating: true,
      milkWithdrawalDays: null,
      meatWithdrawalDays: 35,
    });

    const r = await recordTreatmentFor(
      session,
      { animalId, productId, occurredOn: "2026-08-01", route: "SC" },
      t.db as DbLike,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.data.warnings[0]).toBe(
      "Ivermectin injectable is NOT for a cow in milk. Njeri is milking. Check with the vet before you give this.",
    );
    await t.close();
  });

  it("does not raise that warning for a cow who is dry", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Wangui" });
    const productId = await seedProduct(t.db, { notForLactating: true, milkWithdrawalDays: 4 });
    const r = await recordTreatmentFor(session, { animalId, productId, occurredOn: "2026-08-01" }, t.db as DbLike);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.warnings.join(" ")).not.toContain("NOT for a cow in milk");
    await t.close();
  });

  it("raises an alert for the day the milk comes clear", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Njeri" });
    const productId = await seedProduct(t.db);
    const r = await recordTreatmentFor(session, { animalId, productId, occurredOn: "2026-07-31" }, t.db as DbLike);
    if (!r.ok) throw new Error(r.error);

    const alerts = await t.db.select().from(s.alert).where(eq(s.alert.kind, "WITHDRAWAL_CLEAR"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].dueOn).toBe("2026-08-07");
    expect(alerts[0].severity).toBe("CRITICAL");
    expect(alerts[0].action).toBe("Njeri's milk is clear from today.");
    await t.close();
  });
});

/* ---------------------------------------------------------------- */
/* DRY COW THERAPY — the case that catches people out                */
/* ---------------------------------------------------------------- */

describe("dry cow therapy", () => {
  async function seedDryCow(t: Awaited<ReturnType<typeof setup>>) {
    const animalId = await seedAnimal(t.db, { name: "Wangui" });
    const productId = await seedProduct(t.db, {
      name: "Dry cow intramammary tube",
      productType: "INTRAMAMMARY",
      notForLactating: true,
      milkWithdrawalDays: null, // the label gives the 30-day/96-hour rule instead
      meatWithdrawalDays: 28,
    });
    return { animalId, productId };
  }

  it("holds the milk for 30 days after infusion while she is still dry", async () => {
    const t = await setup();
    const { animalId, productId } = await seedDryCow(t);

    const r = await recordDryCowTherapyFor(
      session,
      { animalId, productId, occurredOn: "2026-01-01" },
      t.db as DbLike,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.data.isDryCowTherapy).toBe(true);
    expect(r.data.milkClearOn).toBe("2026-01-31");
    expect(r.data.receiptLines.join(" ")).toContain("30 days after this infusion AND 96 hours after she calves");

    const st = await getWithdrawalStatus(session, [animalId], "2026-01-20", t.db as DbLike);
    expect(st.get(animalId)!.milkBlocked).toBe(true);
    await t.close();
  });

  it("extends to 96 hours after calving when she calves LATE", async () => {
    const t = await setup();
    const { animalId, productId } = await seedDryCow(t);
    await recordDryCowTherapyFor(session, { animalId, productId, occurredOn: "2026-01-01" }, t.db as DbLike);

    // She calves on 10 February — well after the 30-day leg expired.
    await t.db.insert(s.calving).values({
      id: newId(),
      farmId: FARM_ID,
      damId: animalId,
      calvedOn: "2026-02-10",
      recordedBy: session.userId,
    });

    // The 30-day leg alone would have cleared her on 31 January.
    const stale = await getWithdrawalStatus(session, [animalId], "2026-02-01", t.db as DbLike);
    expect(stale.get(animalId)!.milkBlocked).toBe(true);
    expect(stale.get(animalId)!.milkClearOn).toBe("2026-02-14");

    // Still blocked on the 13th, clear on the 14th.
    const before = await getWithdrawalStatus(session, [animalId], "2026-02-13", t.db as DbLike);
    expect(before.get(animalId)!.milkBlocked).toBe(true);
    const after = await getWithdrawalStatus(session, [animalId], "2026-02-14", t.db as DbLike);
    expect(after.get(animalId)!.milkBlocked).toBe(false);
    await t.close();
  });

  it("keeps the 30-day leg when she calves EARLY", async () => {
    const t = await setup();
    const { animalId, productId } = await seedDryCow(t);
    await recordDryCowTherapyFor(session, { animalId, productId, occurredOn: "2026-01-01" }, t.db as DbLike);
    await t.db.insert(s.calving).values({
      id: newId(),
      farmId: FARM_ID,
      damId: animalId,
      calvedOn: "2026-01-05", // 96 hours would clear her on the 9th
      recordedBy: session.userId,
    });

    const onTheNinth = await getWithdrawalStatus(session, [animalId], "2026-01-09", t.db as DbLike);
    expect(onTheNinth.get(animalId)!.milkBlocked).toBe(true);
    expect(onTheNinth.get(animalId)!.milkClearOn).toBe("2026-01-31");

    const onTheThirtyFirst = await getWithdrawalStatus(session, [animalId], "2026-01-31", t.db as DbLike);
    expect(onTheThirtyFirst.get(animalId)!.milkBlocked).toBe(false);
    await t.close();
  });

  it("refuses to treat a product as dry cow therapy unless it is marked so", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db);
    const productId = await seedProduct(t.db, {
      name: "Lactating cow tube",
      productType: "INTRAMAMMARY",
      notForLactating: false,
      milkWithdrawalDays: 3,
    });
    const r = await recordDryCowTherapyFor(session, { animalId, productId }, t.db as DbLike);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain("not marked as a dry cow product");
    await t.close();
  });

  it("treats a lactating-cow intramammary tube as an ordinary 3-day withdrawal", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Njeri" });
    const productId = await seedProduct(t.db, {
      name: "Lactating cow tube",
      productType: "INTRAMAMMARY",
      notForLactating: false,
      milkWithdrawalDays: 3,
      meatWithdrawalDays: 7,
    });
    const r = await recordTreatmentFor(
      session,
      { animalId, productId, occurredOn: "2026-08-01", quartersTreated: ["LH", "RH"] },
      t.db as DbLike,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.data.isDryCowTherapy).toBe(false);
    expect(r.data.milkClearOn).toBe("2026-08-04");
    await t.close();
  });
});

/* ---------------------------------------------------------------- */
/* getWithdrawalStatus — the contract other modules read             */
/* ---------------------------------------------------------------- */

describe("getWithdrawalStatus — the milk sheet's contract", () => {
  it("returns an entry for every animal asked about, blocked or not", async () => {
    const t = await setup();
    const treated = await seedAnimal(t.db, { tag: "KE-1", name: "Njeri" });
    const clean = await seedAnimal(t.db, { tag: "KE-2", name: "Wangui" });
    const productId = await seedProduct(t.db);
    await recordTreatmentFor(session, { animalId: treated, productId, occurredOn: "2026-07-31" }, t.db as DbLike);

    const map = await getWithdrawalStatus(session, [treated, clean], "2026-08-03", t.db as DbLike);
    expect(map.size).toBe(2);

    const blocked = map.get(treated)!;
    expect(blocked.milkBlocked).toBe(true);
    expect(blocked.milkClearOn).toBe("2026-08-07");
    expect(blocked.animalName).toBe("Njeri");
    expect(blocked.plainMessage).toBe("Do not sell Njeri's milk until Friday 7 August. Do not sell Njeri for slaughter until Friday 28 August.");

    const ok = map.get(clean)!;
    expect(ok.milkBlocked).toBe(false);
    expect(ok.meatBlocked).toBe(false);
    expect(ok.message).toBeNull();
    expect(ok.plainMessage).toBeNull();
    await t.close();
  });

  it("takes the LATEST clear date when treatments overlap", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Njeri" });
    const short = await seedProduct(t.db, { name: "Flunixin", productType: "NSAID", milkWithdrawalDays: 1, meatWithdrawalDays: 5 });
    const long = await seedProduct(t.db, { name: "Oxytet LA", milkWithdrawalDays: 7, meatWithdrawalDays: 28 });

    await recordTreatmentFor(session, { animalId, productId: long, occurredOn: "2026-08-01" }, t.db as DbLike);
    await recordTreatmentFor(session, { animalId, productId: short, occurredOn: "2026-08-02" }, t.db as DbLike);

    const st = (await getWithdrawalStatus(session, [animalId], "2026-08-03", t.db as DbLike)).get(animalId)!;
    expect(st.milkClearOn).toBe("2026-08-08"); // not the 3rd from the NSAID
    expect(st.meatClearOn).toBe("2026-08-29");
    await t.close();
  });

  it("clears ON the clear date, not the day after", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Njeri" });
    const productId = await seedProduct(t.db);
    await recordTreatmentFor(session, { animalId, productId, occurredOn: "2026-07-31" }, t.db as DbLike);

    const dayBefore = await getWithdrawalStatus(session, [animalId], "2026-08-06", t.db as DbLike);
    expect(dayBefore.get(animalId)!.milkBlocked).toBe(true);
    const onTheDay = await getWithdrawalStatus(session, [animalId], "2026-08-07", t.db as DbLike);
    expect(onTheDay.get(animalId)!.milkBlocked).toBe(false);
    await t.close();
  });

  it("flags an unknown period as UNKNOWN rather than presenting her as clear", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Njeri" });
    const productId = await seedProduct(t.db, {
      name: "Unlabelled antibiotic",
      milkWithdrawalDays: null,
      meatWithdrawalDays: null,
    });
    await recordTreatmentFor(session, { animalId, productId, occurredOn: "2026-08-01" }, t.db as DbLike);

    const st = (await getWithdrawalStatus(session, [animalId], "2026-08-03", t.db as DbLike)).get(animalId)!;
    expect(st.milkBlocked).toBe(false);
    expect(st.unknownPeriod).toBe(true);
    expect(st.unknownMessage).toContain("no withdrawal period on file");
    await t.close();
  });

  it("stops flagging an unknown period once the treatment is long past", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db);
    const productId = await seedProduct(t.db, { milkWithdrawalDays: null, meatWithdrawalDays: null });
    await recordTreatmentFor(session, { animalId, productId, occurredOn: "2026-01-01" }, t.db as DbLike);
    const st = (await getWithdrawalStatus(session, [animalId], "2026-08-03", t.db as DbLike)).get(animalId)!;
    expect(st.unknownPeriod).toBe(false);
    await t.close();
  });

  it("returns an empty map for an empty list, without touching the database", async () => {
    const map = await getWithdrawalStatus(session, [], "2026-08-03");
    expect(map.size).toBe(0);
  });

  it("silently omits another farm's animal rather than leaking its existence", async () => {
    const t = await setup();
    const mine = await seedAnimal(t.db, { tag: "KE-9" });
    const other = await seedOtherFarm(t.db);
    const map = await getWithdrawalStatus(session, [mine, other.animalId], "2026-08-03", t.db as DbLike);
    expect(map.size).toBe(1);
    expect(map.has(mine)).toBe(true);
    expect(map.has(other.animalId)).toBe(false);
    await t.close();
  });
});

/* ---------------------------------------------------------------- */
/* The withdrawal board                                              */
/* ---------------------------------------------------------------- */

describe("the withdrawal board", () => {
  it("shows only the animals actually withheld, soonest to clear first", async () => {
    const t = await setup();
    const njeri = await seedAnimal(t.db, { tag: "KE-1", name: "Njeri" });
    const wangui = await seedAnimal(t.db, { tag: "KE-2", name: "Wangui" });
    const clean = await seedAnimal(t.db, { tag: "KE-3", name: "Muthoni" });
    const cleared = await seedAnimal(t.db, { tag: "KE-4", name: "Nyokabi" });

    const oxytet = await seedProduct(t.db, { name: "Oxytet LA", milkWithdrawalDays: 7, meatWithdrawalDays: 28 });
    const penstrep = await seedProduct(t.db, { name: "Pen-strep", milkWithdrawalDays: 3, meatWithdrawalDays: 14 });

    await recordTreatmentFor(session, { animalId: njeri, productId: oxytet, occurredOn: "2026-08-01" }, t.db as DbLike);
    await recordTreatmentFor(session, { animalId: wangui, productId: penstrep, occurredOn: "2026-08-01" }, t.db as DbLike);
    // Treated in June — long clear by August.
    await recordTreatmentFor(session, { animalId: cleared, productId: oxytet, occurredOn: "2026-06-01" }, t.db as DbLike);

    const board = await withdrawalBoard(session, "2026-08-03", t.db as DbLike);
    const names = board.map((b) => b.animalName);
    expect(names).toEqual(["Wangui", "Njeri"]); // Wangui clears on the 4th, Njeri on the 8th
    expect(names).not.toContain("Muthoni");
    expect(names).not.toContain("Nyokabi");

    expect(board[0].daysLeft).toBe(1);
    expect(board[1].daysLeft).toBe(5);
    expect(board[0].plainMessage).toContain("Tuesday 4 August");
    await t.close();
  });

  it("keeps a cow on the board for meat after her milk has cleared", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Njeri" });
    const productId = await seedProduct(t.db); // 7 milk / 28 meat
    await recordTreatmentFor(session, { animalId, productId, occurredOn: "2026-08-01" }, t.db as DbLike);

    const board = await withdrawalBoard(session, "2026-08-20", t.db as DbLike);
    expect(board).toHaveLength(1);
    expect(board[0].milkBlocked).toBe(false);
    expect(board[0].meatBlocked).toBe(true);
    await t.close();
  });

  it("keeps another farm's withheld cows off this farm's board", async () => {
    const t = await setup();
    const other = await seedOtherFarm(t.db);
    await t.db.insert(s.healthEvent).values({
      id: newId(),
      farmId: OTHER_FARM,
      animalId: other.animalId,
      eventType: "TREATMENT",
      occurredOn: "2026-08-01",
      productId: other.productId,
      treatmentEndOn: "2026-08-01",
      milkClearAt: new Date("2026-08-04T00:00:00.000Z"),
      recordedBy: newId(),
    });
    expect(await withdrawalBoard(session, "2026-08-03", t.db as DbLike)).toHaveLength(0);
    await t.close();
  });
});

/* ---------------------------------------------------------------- */
/* ROUTINE BATCH — sixty cows, one action                            */
/* ---------------------------------------------------------------- */

describe("routine batch", () => {
  async function seedHerd(t: Awaited<ReturnType<typeof setup>>, n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(await seedAnimal(t.db, { tag: `KE-${100 + i}`, name: `Cow ${i + 1}`, dateOfBirth: "2023-01-01" }));
    }
    return ids;
  }

  it("sprays the whole herd in ONE call", async () => {
    const t = await setup();
    const herd = await seedHerd(t, 60);
    const amitraz = await seedProduct(t.db, {
      name: "Amitraz 12.5%",
      productType: "ACARICIDE",
      milkWithdrawalDays: 0,
      meatWithdrawalDays: 1,
    });

    const r = await recordRoutineBatchFor(
      session,
      {
        occurredOn: "2026-08-03",
        group: "ALL",
        productIds: [amitraz],
        eventType: "DIPPING",
        routine: "DIP",
        dose: "1:500 spray",
      },
      t.db as DbLike,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.animals).toBe(60);
    expect(r.data.eventsWritten).toBe(60);
    expect(r.data.nowWithheld).toHaveLength(0); // amitraz clears the same day

    const events = await t.db
      .select()
      .from(s.healthEvent)
      .where(and(eq(s.healthEvent.farmId, FARM_ID), eq(s.healthEvent.eventType, "DIPPING")));
    expect(events).toHaveLength(60);
    expect(new Set(events.map((e) => e.animalId)).size).toBe(60);
    expect(events[0].route).toBe("TOPICAL");
    // One receipt for the batch, not sixty.
    const receipts = await t.db.select().from(s.receipt).where(eq(s.receipt.kind, "ROUTINE_BATCH"));
    expect(receipts).toHaveLength(1);
    expect(herd).toHaveLength(60);
    await t.close();
  });

  it("applies MORE THAN ONE product in the same pass", async () => {
    const t = await setup();
    await seedHerd(t, 6);
    const acaricide = await seedProduct(t.db, {
      name: "Amitraz 12.5%",
      productType: "ACARICIDE",
      milkWithdrawalDays: 0,
      meatWithdrawalDays: 1,
    });
    const dewormer = await seedProduct(t.db, {
      name: "Albendazole",
      productType: "DEWORMER",
      milkWithdrawalDays: 4,
      meatWithdrawalDays: 14,
    });

    const r = await recordRoutineBatchFor(
      session,
      { occurredOn: "2026-08-03", group: "ALL", productIds: [acaricide, dewormer], eventType: "DEWORMING" },
      t.db as DbLike,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.data.products).toBe(2);
    expect(r.data.eventsWritten).toBe(12);
    // The dewormer withdraws milk; the acaricide does not.
    expect(r.data.nowWithheld).toHaveLength(6);
    expect(r.data.nowWithheld[0].milkClearOn).toBe("2026-08-07");
    expect(r.data.message).toContain("Amitraz 12.5% and Albendazole");
    expect(r.data.message).toContain("6 animals");
    expect(r.data.message).toContain("6 now under milk withdrawal");

    // And every one of them shows on the board.
    const board = await withdrawalBoard(session, "2026-08-04", t.db as DbLike);
    expect(board.filter((b) => b.milkBlocked)).toHaveLength(6);
    await t.close();
  });

  it("replays a double-flushed batch as a no-op, not a second dosing", async () => {
    const t = await setup();
    await seedHerd(t, 8);
    const dewormer = await seedProduct(t.db, { name: "Albendazole", productType: "DEWORMER", milkWithdrawalDays: 4 });
    const batchId = newId();
    const input = { batchId, occurredOn: "2026-08-03", group: "ALL" as const, productIds: [dewormer] };

    const first = await recordRoutineBatchFor(session, input, t.db as DbLike);
    const second = await recordRoutineBatchFor(session, input, t.db as DbLike);
    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(first.data.eventsWritten).toBe(8);
    expect(second.data.eventsWritten).toBe(0);
    expect(second.refCode).toBe(first.refCode);

    expect(await t.db.select().from(s.healthEvent)).toHaveLength(8);
    expect(await t.db.select().from(s.receipt)).toHaveLength(1);
    await t.close();
  });

  it("hits an explicit list of animals when one is given", async () => {
    const t = await setup();
    const herd = await seedHerd(t, 5);
    const dewormer = await seedProduct(t.db, { productType: "DEWORMER", milkWithdrawalDays: 4 });
    const r = await recordRoutineBatchFor(
      session,
      { occurredOn: "2026-08-03", animalIds: [herd[0], herd[3]], productIds: [dewormer] },
      t.db as DbLike,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.data.animals).toBe(2);
    expect(await t.db.select().from(s.healthEvent)).toHaveLength(2);
    await t.close();
  });

  it("picks out the milking group from who has actually been milked", async () => {
    const t = await setup();
    const herd = await seedHerd(t, 4);
    await seedMilking(t.db as DbLike, herd[0], "2026-08-01");
    await seedMilking(t.db as DbLike, herd[1], "2026-08-02");
    const dewormer = await seedProduct(t.db, { productType: "DEWORMER", milkWithdrawalDays: 4 });

    const r = await recordRoutineBatchFor(
      session,
      { occurredOn: "2026-08-03", group: "LACTATING", productIds: [dewormer] },
      t.db as DbLike,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.data.animals).toBe(2);
    await t.close();
  });

  it("leaves out animals that have already left the herd", async () => {
    const t = await setup();
    const herd = await seedHerd(t, 4);
    await t.db.insert(s.animalExit).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: herd[3],
      exitDate: "2026-07-01",
      reason: "SOLD",
      recordedBy: session.userId,
    });
    const acaricide = await seedProduct(t.db, { productType: "ACARICIDE", milkWithdrawalDays: 0 });
    const r = await recordRoutineBatchFor(
      session,
      { occurredOn: "2026-08-03", group: "ALL", productIds: [acaricide] },
      t.db as DbLike,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.data.animals).toBe(3);
    await t.close();
  });

  it("refuses a batch with no product", async () => {
    const t = await setup();
    await seedHerd(t, 3);
    const r = await recordRoutineBatchFor(session, { group: "ALL", productIds: [] }, t.db as DbLike);
    expect(r.ok).toBe(false);
    await t.close();
  });

  it("refuses a batch that reaches for another farm's animal", async () => {
    const t = await setup();
    const mine = await seedHerd(t, 2);
    const other = await seedOtherFarm(t.db);
    const acaricide = await seedProduct(t.db, { productType: "ACARICIDE", milkWithdrawalDays: 0 });
    await expect(
      recordRoutineBatchFor(
        session,
        { animalIds: [mine[0], other.animalId], productIds: [acaricide] },
        t.db as DbLike,
      ),
    ).rejects.toThrow("That animal was not found.");
    expect(await t.db.select().from(s.healthEvent)).toHaveLength(0);
    await t.close();
  });

  it("refuses a batch that reaches for another farm's product", async () => {
    const t = await setup();
    await seedHerd(t, 2);
    const other = await seedOtherFarm(t.db);
    const r = await recordRoutineBatchFor(
      session,
      { group: "ALL", productIds: [other.productId] },
      t.db as DbLike,
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain("not found");
    await t.close();
  });

  it("derives the same row id from the same batch parts", () => {
    expect(stableId("a", "b", "c")).toBe(stableId("a", "b", "c"));
    expect(stableId("a", "b", "c")).not.toBe(stableId("a", "b", "d"));
    expect(stableId("a", "b", "c")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

/* ---------------------------------------------------------------- */
/* VACCINATION — the two rules that must be hard                     */
/* ---------------------------------------------------------------- */

describe("vaccination — S19 brucellosis", () => {
  it("allows a heifer inside the 4–8 month window and says it never repeats", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Muthoni", sex: "F", dateOfBirth: "2026-02-01" });
    const r = await recordVaccinationFor(
      session,
      { animalId, routine: "S19", occurredOn: "2026-07-01" },
      t.db as DbLike,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.nextDueOn).toBeNull();
    expect(r.message).toContain("Once in a lifetime");
    expect(r.data.warnings.join(" ")).toContain("Heifers aged 4–8 months only");
    await t.close();
  });

  it("REFUSES S19 on a male", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Kamau", sex: "M", dateOfBirth: "2026-02-01" });
    const r = await recordVaccinationFor(
      session,
      { animalId, routine: "S19", occurredOn: "2026-07-01" },
      t.db as DbLike,
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toBe("Kamau: Brucellosis S19 is for females only.");
    expect(await t.db.select().from(s.healthEvent)).toHaveLength(0);
    await t.close();
  });

  it("REFUSES a second S19 — once for life, and there is no undoing it", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Muthoni", sex: "F", dateOfBirth: "2026-02-01" });
    const first = await recordVaccinationFor(
      session,
      { animalId, routine: "S19", occurredOn: "2026-06-15" },
      t.db as DbLike,
    );
    expect(first.ok).toBe(true);

    const second = await recordVaccinationFor(
      session,
      { animalId, routine: "S19", occurredOn: "2026-07-01" },
      t.db as DbLike,
    );
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.error).toContain("once in a lifetime");
    expect(await t.db.select().from(s.healthEvent)).toHaveLength(1);
    await t.close();
  });

  it("REFUSES S19 on an adult — it interferes with later testing", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Njeri", sex: "F", dateOfBirth: "2023-01-01" });
    const r = await recordVaccinationFor(
      session,
      { animalId, routine: "S19", occurredOn: "2026-07-01" },
      t.db as DbLike,
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain("Too old");
    await t.close();
  });

  it("REFUSES S19 on a calf who is too young", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Baby", sex: "F", dateOfBirth: "2026-05-01" });
    const r = await recordVaccinationFor(
      session,
      { animalId, routine: "S19", occurredOn: "2026-07-01" },
      t.db as DbLike,
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain("Too young");
    await t.close();
  });
});

describe("vaccination — ECF-ITM and the rest", () => {
  it("REFUSES a second ECF-ITM — she is already a carrier", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Muthoni", dateOfBirth: "2026-01-01" });
    const first = await recordVaccinationFor(
      session,
      { animalId, routine: "ECF_ITM", occurredOn: "2026-06-01" },
      t.db as DbLike,
    );
    expect(first.ok).toBe(true);
    const second = await recordVaccinationFor(
      session,
      { animalId, routine: "ECF_ITM", occurredOn: "2026-08-01" },
      t.db as DbLike,
    );
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.error).toContain("once in a lifetime");
    await t.close();
  });

  it("warns but ALLOWS when her age is not recorded", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Bought-in cow", dateOfBirth: null, origin: "PURCHASED" });
    const r = await recordVaccinationFor(
      session,
      { animalId, routine: "FMD", occurredOn: "2026-08-01" },
      t.db as DbLike,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.warnings.join(" ")).toContain("age is not recorded");
    expect(r.data.nextDueOn).toBe("2027-01-28");
    await t.close();
  });

  it("still refuses S19 on a male whose age is unknown", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { sex: "M", dateOfBirth: null, origin: "PURCHASED" });
    const r = await recordVaccinationFor(session, { animalId, routine: "S19" }, t.db as DbLike);
    expect(r.ok).toBe(false);
    await t.close();
  });

  it("carries the vaccine product's own withdrawal period, when it has one", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Muthoni", dateOfBirth: "2026-01-01" });
    // ECF-ITM is given with long-acting oxytetracycline, so it withdraws milk.
    const productId = await seedProduct(t.db, {
      name: "Muguga cocktail + oxytet LA",
      productType: "VACCINE",
      milkWithdrawalDays: 7,
      meatWithdrawalDays: 28,
    });
    const r = await recordVaccinationFor(
      session,
      { animalId, routine: "ECF_ITM", occurredOn: "2026-08-01", productId },
      t.db as DbLike,
    );
    if (!r.ok) throw new Error(r.error);
    const st = (await getWithdrawalStatus(session, [animalId], "2026-08-03", t.db as DbLike)).get(animalId)!;
    expect(st.milkBlocked).toBe(true);
    expect(st.milkClearOn).toBe("2026-08-08");
    await t.close();
  });

  it("refuses a routine it does not know", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db);
    const r = await recordVaccinationFor(session, { animalId, routine: "MADE_UP" }, t.db as DbLike);
    expect(r.ok).toBe(false);
    await t.close();
  });
});

/* ---------------------------------------------------------------- */
/* CMT                                                               */
/* ---------------------------------------------------------------- */

describe("CMT screening", () => {
  it("returns what the score means, at the moment of entry", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Njeri" });

    const negative = await recordCmtFor(session, { animalId, occurredOn: "2026-08-03", score: "N" }, t.db as DbLike);
    if (!negative.ok) throw new Error(negative.error);
    expect(negative.data.advice).toContain("nothing to do");

    const strong = await recordCmtFor(
      session,
      { animalId, occurredOn: "2026-08-03", score: "3", quartersTreated: ["LH"] },
      t.db as DbLike,
    );
    if (!strong.ok) throw new Error(strong.error);
    expect(strong.data.advice).toContain("call the vet");
    expect(strong.message).toContain("Njeri");

    const rows = await t.db
      .select()
      .from(s.healthEvent)
      .where(and(eq(s.healthEvent.farmId, FARM_ID), eq(s.healthEvent.eventType, "CMT")));
    expect(rows).toHaveLength(2);
    const positive = rows.find((r) => r.cmtScore === "3")!;
    expect(positive.followUpOn).toBe("2026-08-10");
    expect(rows.find((r) => r.cmtScore === "N")!.followUpOn).toBeNull();
    await t.close();
  });

  it("covers the whole N/T/1/2/3 scale", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db);
    for (const score of ["N", "T", "1", "2", "3"] as const) {
      const r = await recordCmtFor(session, { animalId, occurredOn: "2026-08-03", score }, t.db as DbLike);
      expect(r.ok).toBe(true);
    }
    await t.close();
  });
});

/* ---------------------------------------------------------------- */
/* What is due                                                       */
/* ---------------------------------------------------------------- */

describe("due routines", () => {
  it("puts weekly tick control back on the list once the week is up", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Njeri", dateOfBirth: "2024-01-01" });
    const acaricide = await seedProduct(t.db, { productType: "ACARICIDE", milkWithdrawalDays: 0 });
    await recordRoutineBatchFor(
      session,
      { occurredOn: "2026-07-25", group: "ALL", productIds: [acaricide], eventType: "DIPPING", routine: "DIP" },
      t.db as DbLike,
    );

    const notYet = await dueRoutines(session, "2026-07-30", t.db as DbLike);
    expect(notYet.find((d) => d.routine === "DIP" && d.animalId === animalId)).toBeUndefined();

    const due = await dueRoutines(session, "2026-08-03", t.db as DbLike);
    const dip = due.find((d) => d.routine === "DIP" && d.animalId === animalId)!;
    expect(dip.lastGivenOn).toBe("2026-07-25");
    expect(dip.dueOn).toBe("2026-08-01");
    expect(dip.overdueDays).toBe(2);
    expect(dip.label).toBe("Tick control (dip or spray)");
    await t.close();
  });

  it("lists a never-vaccinated animal from the day she is old enough", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Muthoni", sex: "F", dateOfBirth: "2026-01-01" });
    const due = await dueRoutines(session, "2026-08-03", t.db as DbLike);
    const fmd = due.find((d) => d.routine === "FMD" && d.animalId === animalId)!;
    expect(fmd.lastGivenOn).toBeNull();
    expect(fmd.dueOn).toBe("2026-05-01"); // 120 days old
    await t.close();
  });

  it("never lists a once-for-life vaccine she has already had", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { sex: "F", dateOfBirth: "2026-01-01" });
    await recordVaccinationFor(session, { animalId, routine: "ECF_ITM", occurredOn: "2026-05-01" }, t.db as DbLike);
    const due = await dueRoutines(session, "2026-08-03", t.db as DbLike);
    expect(due.find((d) => d.routine === "ECF_ITM")).toBeUndefined();
    await t.close();
  });

  it("never lists S19 for a bull", async () => {
    const t = await setup();
    await seedAnimal(t.db, { sex: "M", dateOfBirth: "2026-02-01" });
    const due = await dueRoutines(session, "2026-08-03", t.db as DbLike);
    expect(due.find((d) => d.routine === "S19")).toBeUndefined();
    await t.close();
  });

  it("leaves out animals that have left the herd", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { dateOfBirth: "2024-01-01" });
    await t.db.insert(s.animalExit).values({
      id: newId(),
      farmId: FARM_ID,
      animalId,
      exitDate: "2026-06-01",
      reason: "SOLD",
      recordedBy: session.userId,
    });
    expect(await dueRoutines(session, "2026-08-03", t.db as DbLike)).toHaveLength(0);
    await t.close();
  });
});

/* ---------------------------------------------------------------- */
/* History                                                           */
/* ---------------------------------------------------------------- */

describe("health history", () => {
  it("reads back in plain language with the current status attached", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Njeri", dateOfBirth: "2024-01-01" });
    const productId = await seedProduct(t.db, { name: "Oxytet LA" });

    await recordObservationFor(session, { animalId, occurredOn: "2026-07-30", signs: "Off her feed" }, t.db as DbLike);
    await recordTreatmentFor(session, { animalId, productId, occurredOn: "2026-07-31" }, t.db as DbLike);
    await recordCmtFor(session, { animalId, occurredOn: "2026-08-01", score: "2" }, t.db as DbLike);

    const h = await animalHealthHistory(session, animalId, t.db as DbLike);
    expect(h.animalName).toBe("Njeri");
    expect(h.entries).toHaveLength(3);
    expect(h.entries[0].occurredOn).toBe("2026-08-01");
    expect(h.entries.map((e) => e.title)).toContain("Oxytet LA");
    expect(h.entries.map((e) => e.title)).toContain("Observation");
    expect(h.entries.map((e) => e.title)).toContain("CMT 2");
    expect(h.status).not.toBeNull();
    await t.close();
  });

  it("refuses to show another farm's animal", async () => {
    const t = await setup();
    const other = await seedOtherFarm(t.db);
    await expect(animalHealthHistory(session, other.animalId, t.db as DbLike)).rejects.toThrow(
      "That animal was not found.",
    );
    await t.close();
  });
});

/* ---------------------------------------------------------------- */
/* Tenancy and offline replay                                        */
/* ---------------------------------------------------------------- */

describe("the tenancy boundary", () => {
  it("refuses to treat another farm's animal", async () => {
    const t = await setup();
    const other = await seedOtherFarm(t.db);
    const productId = await seedProduct(t.db);
    await expect(
      recordTreatmentFor(session, { animalId: other.animalId, productId }, t.db as DbLike),
    ).rejects.toThrow("That animal was not found.");
    expect(await t.db.select().from(s.healthEvent)).toHaveLength(0);
    await t.close();
  });

  it("refuses to treat with another farm's product", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db);
    const other = await seedOtherFarm(t.db);
    await expect(
      recordTreatmentFor(session, { animalId, productId: other.productId }, t.db as DbLike),
    ).rejects.toThrow("That product was not found.");
    await t.close();
  });

  it("refuses to vaccinate another farm's animal", async () => {
    const t = await setup();
    const other = await seedOtherFarm(t.db);
    await expect(
      recordVaccinationFor(session, { animalId: other.animalId, routine: "FMD" }, t.db as DbLike),
    ).rejects.toThrow("That animal was not found.");
    await t.close();
  });

  it("refuses to record an observation on another farm's animal", async () => {
    const t = await setup();
    const other = await seedOtherFarm(t.db);
    await expect(
      recordObservationFor(session, { animalId: other.animalId, signs: "limping" }, t.db as DbLike),
    ).rejects.toThrow("That animal was not found.");
    await t.close();
  });
});

describe("offline replay", () => {
  it("lands a double-flushed treatment once, with one receipt and one alert", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { name: "Njeri" });
    const productId = await seedProduct(t.db);
    const id = newId();
    const input = { id, animalId, productId, occurredOn: "2026-07-31", dose: "20 ml" };

    const first = await recordTreatmentFor(session, input, t.db as DbLike);
    const second = await recordTreatmentFor(session, input, t.db as DbLike);
    if (!first.ok || !second.ok) throw new Error("unreachable");

    expect(second.refCode).toBe(first.refCode);
    expect(second.data.milkClearOn).toBe(first.data.milkClearOn);
    expect(await t.db.select().from(s.healthEvent)).toHaveLength(1);
    expect(await t.db.select().from(s.receipt)).toHaveLength(1);
    expect(await t.db.select().from(s.alert)).toHaveLength(1);

    // And she is blocked exactly once, not twice.
    const st = (await getWithdrawalStatus(session, [animalId], "2026-08-03", t.db as DbLike)).get(animalId)!;
    expect(st.milkClearOn).toBe("2026-08-07");
    await t.close();
  });

  it("lands a double-flushed observation once", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db);
    const id = newId();
    const input = { id, animalId, occurredOn: "2026-08-03", signs: "Limping on the near hind" };
    await recordObservationFor(session, input, t.db as DbLike);
    await recordObservationFor(session, input, t.db as DbLike);
    expect(await t.db.select().from(s.healthEvent)).toHaveLength(1);
    expect(await t.db.select().from(s.alert)).toHaveLength(1);
    await t.close();
  });

  it("lands a double-flushed vaccination once", async () => {
    const t = await setup();
    const animalId = await seedAnimal(t.db, { sex: "F", dateOfBirth: "2026-02-01" });
    const id = newId();
    const input = { id, animalId, routine: "S19", occurredOn: "2026-07-01" };
    const first = await recordVaccinationFor(session, input, t.db as DbLike);
    expect(first.ok).toBe(true);
    // The replay is refused by the once-for-life rule rather than duplicated —
    // either way exactly one dose is on file.
    await recordVaccinationFor(session, input, t.db as DbLike);
    expect(await t.db.select().from(s.healthEvent)).toHaveLength(1);
    await t.close();
  });
});

/* ---------------------------------------------------------------- */

describe("plainDate", () => {
  it("writes a date the way somebody says it out loud", () => {
    expect(plainDate("2026-08-07")).toBe("Friday 7 August");
    expect(plainDate("2026-12-25")).toBe("Friday 25 December");
  });
});
