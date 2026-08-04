import { describe, it, expect } from "vitest";
import { eq, and } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { FARM_ID, fakeSession, seedAnimal, seedCustomer, seedFarm, seedProduct, seedUser } from "@/test/factory";
import * as s from "@/db/schema";
import { newId } from "@/lib/ids";
import { addDays } from "@/lib/domain/dates";
import { recordMilkBatch } from "./milk";
import {
  allocateMilk,
  approvePayment,
  channelMix,
  createCustomer,
  createInvoice,
  createStandingOrder,
  customerLedger,
  disposalLitres,
  debtorAging,
  deliveryRound,
  listCustomers,
  listStatements,
  pendingPayments,
  previewDelivery,
  recordDelivery,
  recordDeliveryRound,
  recordDisposal,
  recordPayment,
  recordStatement,
  statementView,
} from "./sales";

/**
 * M4. The two properties that matter most:
 *   - withdrawal milk cannot reach a paying channel, whatever the client sends;
 *   - a delivery on credit is a receivable, visible before the money is gone.
 */

const TODAY = "2026-08-03"; // Monday
const OTHER_FARM = "22222222-2222-4222-8222-222222222222";

async function setup(role: s.Role = "MANAGER") {
  const { db, close } = await createTestDb();
  await seedFarm(db);
  const userId = await seedUser(db, { fullName: "Grace Wanjiru", role });
  const session = fakeSession({ userId, role, fullName: "Grace Wanjiru" });
  return { db, close, session, userId };
}

async function seedPrice(
  db: TestDb,
  customerType: s.CustomerType,
  rate: number,
  from = "2026-01-01",
) {
  await db.insert(s.priceList).values({
    id: newId(),
    farmId: FARM_ID,
    scope: "CHANNEL",
    customerType,
    rateKesPerLitre: rate.toFixed(2),
    effectiveFrom: from,
    setBy: newId(),
  });
}

async function seedCow(db: TestDb, opts: { name: string; calvedOn: string; tag?: string }) {
  const animalId = await seedAnimal(db, {
    name: opts.name,
    tag: opts.tag ?? `KE-${opts.name.toUpperCase()}`,
    dateOfBirth: "2020-01-01",
  });
  await db.insert(s.calving).values({
    id: newId(), farmId: FARM_ID, damId: animalId, calvedOn: opts.calvedOn, recordedBy: newId(),
  });
  return animalId;
}

async function seedTreatment(db: TestDb, animalId: string, clearInDays: number) {
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
}

/* ---------------------------------------------------------------- */

describe("the allocation screen", () => {
  it("balances when every litre is accounted for", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db, "COOP", 52);
    const njeri = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    const wanjiku = await seedCow(db, { name: "Wanjiku", calvedOn: "2026-03-01", tag: "KE-2" });
    const coop = await seedCustomer(db, { name: "Limuru Dairy Co-operative", customerType: "COOP" });

    await recordMilkBatch(
      session,
      {
        date: TODAY,
        session: "MORNING",
        rows: [{ animalId: njeri, litres: 20 }, { animalId: wanjiku, litres: 10 }],
      },
      db,
    );

    await recordDisposal(session, { date: TODAY, channel: "COOP", customerId: coop, litres: 26 }, db);
    await recordDisposal(session, { date: TODAY, channel: "CALF_FEEDING", litres: 4 }, db);

    const a = await allocateMilk(session, TODAY, db);
    expect(a.production.totalL).toBe(30);
    expect(a.reconciliation.balanced).toBe(true);
    expect(a.reconciliation.varianceL).toBe(0);
    expect(a.unallocatedL).toBe(0);
    expect(a.warnings).toEqual([]);
    await close();
  });

  it("surfaces the variance instead of hiding it", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db, "COOP", 52);
    const njeri = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    const coop = await seedCustomer(db, { customerType: "COOP" });

    await recordMilkBatch(session, { date: TODAY, session: "MORNING", rows: [{ animalId: njeri, litres: 30 }] }, db);
    await recordDisposal(session, { date: TODAY, channel: "COOP", customerId: coop, litres: 22 }, db);

    const a = await allocateMilk(session, TODAY, db);
    expect(a.reconciliation.balanced).toBe(false);
    expect(a.reconciliation.varianceL).toBe(8);
    expect(a.unallocatedL).toBe(8);
    expect(a.warnings[0]).toContain("8.0 L unaccounted for");
    await close();
  });

  it("says so when more was sold than was milked", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db, "COOP", 52);
    const njeri = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    const coop = await seedCustomer(db, { customerType: "COOP" });
    await recordMilkBatch(session, { date: TODAY, session: "MORNING", rows: [{ animalId: njeri, litres: 20 }] }, db);
    await recordDisposal(session, { date: TODAY, channel: "COOP", customerId: coop, litres: 25 }, db);

    const a = await allocateMilk(session, TODAY, db);
    expect(a.reconciliation.varianceL).toBe(-5);
    expect(a.warnings[0]).toContain("more was sold");
    await close();
  });

  it("values the free milk so the owner sees what it costs", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db, "HOUSEHOLD", 65);
    const njeri = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    await recordMilkBatch(session, { date: TODAY, session: "MORNING", rows: [{ animalId: njeri, litres: 20 }] }, db);

    const calves = await recordDisposal(session, { date: TODAY, channel: "CALF_FEEDING", litres: 4 }, db);
    expect(calves.ok).toBe(true);
    if (!calves.ok) return;
    expect(calves.data.rateKesPerLitre).toBe(65);
    expect(calves.data.valueKes).toBe(260);

    const a = await allocateMilk(session, TODAY, db);
    expect(a.imputedValueKes).toBe(260);
    await close();
  });

  it("computes the blended price across the channel mix", async () => {
    const { db, close, session } = await setup();
    const njeri = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    const coop = await seedCustomer(db, { name: "Co-op", customerType: "COOP" });
    const mama = await seedCustomer(db, { name: "Mama Njeri", customerType: "HOUSEHOLD" });
    await recordMilkBatch(session, { date: TODAY, session: "MORNING", rows: [{ animalId: njeri, litres: 30 }] }, db);

    await recordDisposal(session, { date: TODAY, channel: "COOP", customerId: coop, litres: 20, rateKesPerLitre: 52 }, db);
    await recordDisposal(session, { date: TODAY, channel: "HOUSEHOLD", customerId: mama, litres: 10, rateKesPerLitre: 65 }, db);

    const a = await allocateMilk(session, TODAY, db);
    expect(a.revenueKes).toBe(1690);
    expect(a.blendedKes).toBe(56.33);

    const mix = await channelMix(session, TODAY, TODAY, db);
    expect(mix.blendedKes).toBe(56.33);
    expect(mix.message).toContain("Blended price");
    await close();
  });

  it("flags a day when losses run above the Kenyan norm", async () => {
    const { db, close, session } = await setup();
    const njeri = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    await recordMilkBatch(session, { date: TODAY, session: "MORNING", rows: [{ animalId: njeri, litres: 20 }] }, db);
    await recordDisposal(session, { date: TODAY, channel: "SPOILAGE", litres: 3, lossReason: "SOURED" }, db);

    const a = await allocateMilk(session, TODAY, db);
    expect(a.lossPct).toBe(15);
    expect(a.warnings.some((w) => w.includes("Losses are running"))).toBe(true);
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("the hard block — withdrawal milk may not be sold", () => {
  it("forces the excess into WITHHELD_TREATMENT instead of the co-op can", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db, "COOP", 52);
    const njeri = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    const muthoni = await seedCow(db, { name: "Muthoni", calvedOn: "2026-03-01", tag: "KE-2" });
    await seedTreatment(db, muthoni, 4);
    const coop = await seedCustomer(db, { name: "Limuru Dairy", customerType: "COOP" });

    await recordMilkBatch(
      session,
      {
        date: TODAY,
        session: "MORNING",
        rows: [{ animalId: njeri, litres: 20 }, { animalId: muthoni, litres: 10 }],
      },
      db,
    );

    // The whole 30 L is offered to the co-op. Only 20 L is lawfully saleable.
    const res = await recordDisposal(
      session, { date: TODAY, channel: "COOP", customerId: coop, litres: 30 }, db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.litres).toBe(20);
    expect(res.data.forcedL).toBe(10);
    expect(res.data.blockMessage).toContain("Muthoni");
    expect(res.data.blockMessage).toContain("Do not put it in the can");

    const rows = await db.select().from(s.milkDisposal).where(eq(s.milkDisposal.disposedOn, TODAY));
    const coopRow = rows.find((r) => r.channel === "COOP")!;
    const withheldRow = rows.find((r) => r.channel === "WITHHELD_TREATMENT")!;
    expect(coopRow.litres).toBe("20.00");
    expect(withheldRow.litres).toBe("10.00");
    await close();
  });

  it("blocks every revenue channel, not just the co-op", async () => {
    for (const channel of ["PROCESSOR", "INSTITUTION", "HOUSEHOLD", "SHOP", "MILK_ATM"] as const) {
      const { db, close, session } = await setup();
      const muthoni = await seedCow(db, { name: "Muthoni", calvedOn: "2026-03-01" });
      await seedTreatment(db, muthoni, 4);
      await recordMilkBatch(
        session, { date: TODAY, session: "MORNING", rows: [{ animalId: muthoni, litres: 10 }] }, db,
      );

      const res = await recordDisposal(session, { date: TODAY, channel, litres: 10 }, db);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      // Nothing saleable at all today, so the whole row becomes a withholding.
      expect(res.data.channel).toBe("WITHHELD_TREATMENT");
      expect(res.data.requestedChannel).toBe(channel);
      await close();
    }
  });

  it("does not block when nobody is under treatment", async () => {
    const { db, close, session } = await setup();
    const njeri = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    const coop = await seedCustomer(db, { customerType: "COOP" });
    await recordMilkBatch(session, { date: TODAY, session: "MORNING", rows: [{ animalId: njeri, litres: 20 }] }, db);

    // Deliberately more than was recorded: with nothing withheld there is
    // nothing to block, and rigid validation is not this product's answer.
    const res = await recordDisposal(session, { date: TODAY, channel: "COOP", customerId: coop, litres: 25 }, db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.channel).toBe("COOP");
    expect(res.data.litres).toBe(25);
    expect(res.data.forcedL).toBe(0);
    await close();
  });

  it("blocks a delivery on the round too, not only a bulk drop", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db, "HOUSEHOLD", 65);
    const muthoni = await seedCow(db, { name: "Muthoni", calvedOn: "2026-03-01" });
    await seedTreatment(db, muthoni, 4);
    const mama = await seedCustomer(db, { name: "Mama Njeri", customerType: "HOUSEHOLD" });
    await recordMilkBatch(session, { date: TODAY, session: "MORNING", rows: [{ animalId: muthoni, litres: 10 }] }, db);

    const res = await recordDelivery(
      session, { date: TODAY, session: "MORNING", customerId: mama, litres: 2, settlement: "CASH" }, db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.blockMessage).toContain("Do not put it in the can");

    const rows = await db.select().from(s.milkDisposal).where(eq(s.milkDisposal.disposedOn, TODAY));
    expect(rows.every((r) => r.channel !== "HOUSEHOLD")).toBe(true);
    await close();
  });

  it("counts what has already been sold, so the second load cannot slip through", async () => {
    const { db, close, session } = await setup();
    const njeri = await seedCow(db, { name: "Njeri", calvedOn: "2026-04-01" });
    const muthoni = await seedCow(db, { name: "Muthoni", calvedOn: "2026-03-01", tag: "KE-2" });
    await seedTreatment(db, muthoni, 4);
    const coop = await seedCustomer(db, { customerType: "COOP" });
    await recordMilkBatch(
      session,
      { date: TODAY, session: "MORNING", rows: [{ animalId: njeri, litres: 20 }, { animalId: muthoni, litres: 10 }] },
      db,
    );

    const first = await recordDisposal(session, { date: TODAY, channel: "COOP", customerId: coop, litres: 15 }, db);
    expect(first.ok && first.data.forcedL).toBe(0);

    const second = await recordDisposal(session, { date: TODAY, channel: "COOP", customerId: coop, litres: 15 }, db);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.litres).toBe(5);
    expect(second.data.forcedL).toBe(10);
    await close();
  });

  it("lets colostrum milk be recorded as a withholding without a fight", async () => {
    const { db, close, session } = await setup();
    const akinyi = await seedCow(db, { name: "Akinyi", calvedOn: addDays(TODAY, -1) });
    await recordMilkBatch(session, { date: TODAY, session: "MORNING", rows: [{ animalId: akinyi, litres: 5 }] }, db);

    const res = await recordDisposal(session, { date: TODAY, channel: "WITHHELD_COLOSTRUM", litres: 5 }, db);
    expect(res.ok).toBe(true);
    const a = await allocateMilk(session, TODAY, db);
    expect(a.reconciliation.balanced).toBe(true);
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("recordDisposal", () => {
  it("insists a loss carries a coded reason — you cannot group free text", async () => {
    const { db, close, session } = await setup();
    const res = await recordDisposal(session, { date: TODAY, channel: "SPOILAGE", litres: 6 }, db);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("spilled, soured, rejected");
    await close();
  });

  it("accepts the loss once the reason is picked", async () => {
    const { db, close, session } = await setup();
    const res = await recordDisposal(
      session, { date: TODAY, channel: "REJECTED", litres: 6, lossReason: "FAILED_ALCOHOL" }, db,
    );
    expect(res.ok).toBe(true);
    const [row] = await db.select().from(s.milkDisposal).where(eq(s.milkDisposal.channel, "REJECTED"));
    expect(row.lossReason).toBe("FAILED_ALCOHOL");
    await close();
  });

  it("captures quality at reception", async () => {
    const { db, close, session } = await setup();
    const coop = await seedCustomer(db, { customerType: "COOP" });
    await recordDisposal(
      session,
      {
        date: TODAY, channel: "COOP", customerId: coop, litres: 120, rateKesPerLitre: 52,
        butterfatPct: 4.1, lactometerReading: 1.029, alcoholTest: "PASS", accepted: true,
        deliveryNoteNo: "DN-8841",
      },
      db,
    );
    const [row] = await db.select().from(s.milkDisposal).where(eq(s.milkDisposal.channel, "COOP"));
    expect(row.butterfatPct).toBe("4.10");
    expect(row.alcoholTest).toBe("PASS");
    expect(row.accepted).toBe(true);
    expect(row.deliveryNoteNo).toBe("DN-8841");
    expect(row.valueKes).toBe("6240.00");
    await close();
  });

  it("is idempotent on an offline replay", async () => {
    const { db, close, session } = await setup();
    const coop = await seedCustomer(db, { customerType: "COOP" });
    const id = newId();
    const input = { id, date: TODAY, channel: "COOP" as const, customerId: coop, litres: 120, rateKesPerLitre: 52 };

    const first = await recordDisposal(session, input, db);
    const second = await recordDisposal(session, input, db);
    expect(first.ok && second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.duplicate).toBe(true);
    expect(second.refCode).toBe(first.ok ? first.refCode : "");

    const rows = await db.select().from(s.milkDisposal).where(eq(s.milkDisposal.disposedOn, TODAY));
    expect(rows).toHaveLength(1);
    await close();
  });

  it("surfaces the raw-milk rule without refusing the sale", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db, "HOUSEHOLD", 65);
    const townie = await seedCustomer(db, {
      name: "Nairobi Flat", customerType: "HOUSEHOLD", areaClass: "URBAN", fulfilment: "DELIVERED",
    });
    const res = await recordDisposal(
      session, { date: TODAY, channel: "HOUSEHOLD", customerId: townie, litres: 3 }, db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.legality!.allowed).toBe(false);
    expect(res.data.legality!.blockers[0]).toContain("rural areas");
    expect(res.data.legality!.warnings.some((w) => w.includes("milk carriage permit"))).toBe(true);
    // R4: surfaced, not enforced. Only withdrawal blocks.
    expect(res.data.channel).toBe("HOUSEHOLD");
    await close();
  });

  it("stops warning about transport once the permit is on file", async () => {
    const { db, close, session } = await setup();
    const mama = await seedCustomer(db, { name: "Mama Njeri", customerType: "HOUSEHOLD", fulfilment: "DELIVERED" });
    await db.insert(s.complianceDocument).values({
      id: newId(), farmId: FARM_ID, docType: "MILK_TRANSPORT_PERMIT", expiresOn: "2027-01-01",
    });
    const res = await recordDisposal(
      session, { date: TODAY, channel: "HOUSEHOLD", customerId: mama, litres: 3, rateKesPerLitre: 65 }, db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.legality!.warnings).toEqual([]);
    await close();
  });

  it("refuses another farm's customer", async () => {
    const { db, close, session } = await setup();
    const mine = await seedCustomer(db, { customerType: "COOP" });
    const intruder = fakeSession({ farmId: OTHER_FARM });
    const res = await recordDisposal(intruder, { date: TODAY, channel: "COOP", customerId: mine, litres: 5 }, db);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("That customer was not found.");
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("the delivery round", () => {
  async function seedRound(db: TestDb) {
    await seedPrice(db, "HOUSEHOLD", 65);
    await seedPrice(db, "INSTITUTION", 60);

    const mama = await seedCustomer(db, {
      name: "Mama Njeri", customerType: "HOUSEHOLD", paymentTerms: "WEEKLY", creditLimitKes: "5000.00",
    });
    const school = await seedCustomer(db, {
      name: "St Mary's School", customerType: "INSTITUTION", institutionKind: "SCHOOL",
      paymentTerms: "NET_30", requiresDeliveryNote: true,
    });
    const wanjiru = await seedCustomer(db, {
      name: "Wanjiru", customerType: "HOUSEHOLD", paymentTerms: "MONTHLY", creditLimitKes: "1000.00",
    });
    return { mama, school, wanjiru };
  }

  it("generates itself from standing orders, prefilled and weekday-aware", async () => {
    const { db, close, session } = await setup();
    const { mama, school } = await seedRound(db);

    await createStandingOrder(session, {
      customerId: mama, litres: 2, session: "MORNING", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], activeFrom: "2026-01-01",
    }, db);
    await createStandingOrder(session, {
      customerId: school, litres: 30, session: "MORNING", daysOfWeek: [1, 2, 3, 4, 5], activeFrom: "2026-01-01",
    }, db);

    const monday = await deliveryRound(session, TODAY, "MORNING", db);
    expect(monday.stops.map((x) => x.name)).toEqual(["Mama Njeri", "St Mary's School"]);
    expect(monday.totalLitres).toBe(32);
    expect(monday.totalValueKes).toBe(1930); // 2×65 + 30×60
    expect(monday.stops[1].requiresDeliveryNote).toBe(true);

    const sunday = await deliveryRound(session, "2026-08-09", "MORNING", db);
    expect(sunday.stops.map((x) => x.name)).toEqual(["Mama Njeri"]);
    await close();
  });

  it("honours a school holiday pause and still shows why the stop is missing", async () => {
    const { db, close, session } = await setup();
    const { school } = await seedRound(db);
    await createStandingOrder(session, {
      customerId: school, litres: 30, session: "MORNING", daysOfWeek: [1, 2, 3, 4, 5],
      activeFrom: "2026-01-01", pausedFrom: "2026-08-01", pausedTo: "2026-08-31",
    }, db);

    const round = await deliveryRound(session, TODAY, "MORNING", db);
    expect(round.stops).toHaveLength(0);
    expect(round.pausedToday).toHaveLength(1);
    expect(round.pausedToday[0].name).toBe("St Mary's School");
    expect(round.pausedToday[0].note).toContain("Paused until");
    await close();
  });

  it("warns about the customer over their limit BEFORE the rider knocks", async () => {
    const { db, close, session } = await setup();
    const { wanjiru } = await seedRound(db);
    await db.insert(s.customerLedgerEntry).values({
      id: newId(), farmId: FARM_ID, customerId: wanjiru, entryDate: "2026-06-01",
      entryType: "DELIVERY", debitKes: "6200.00", creditKes: "0.00", recordedBy: newId(),
    });
    await createStandingOrder(session, {
      customerId: wanjiru, litres: 2, session: "MORNING", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], activeFrom: "2026-01-01",
    }, db);

    const round = await deliveryRound(session, TODAY, "MORNING", db);
    const stop = round.stops[0];
    expect(stop.creditCheck.overLimit).toBe(true);
    expect(stop.balanceKes).toBe(6200);
    expect(stop.creditCheck.message).toContain("Wanjiru owes KES 6,330");
    expect(stop.creditCheck.message).toContain("Deliver anyway, or skip?");
    expect(round.overLimit).toHaveLength(1);

    // …and it is still allowed. The rider decides, not the software.
    expect(stop.creditCheck.allowed).toBe(true);
    await close();
  });

  it("previews the credit position without writing anything", async () => {
    const { db, close, session } = await setup();
    const { wanjiru } = await seedRound(db);
    await db.insert(s.customerLedgerEntry).values({
      id: newId(), farmId: FARM_ID, customerId: wanjiru, entryDate: "2026-06-01",
      entryType: "DELIVERY", debitKes: "990.00", creditKes: "0.00", recordedBy: newId(),
    });

    const preview = await previewDelivery(session, wanjiru, 2, TODAY, db);
    expect(preview.rateKesPerLitre).toBe(65);
    expect(preview.valueKes).toBe(130);
    expect(preview.creditCheck.overLimit).toBe(true);

    const entries = await db.select().from(s.customerLedgerEntry);
    expect(entries).toHaveLength(1); // nothing written
    await close();
  });

  it("splits the round's takings into cash, M-Pesa and credit", async () => {
    const { db, close, session } = await setup();
    const { mama, school, wanjiru } = await seedRound(db);

    const res = await recordDeliveryRound(
      session,
      {
        date: TODAY,
        session: "MORNING",
        stops: [
          { customerId: mama, litres: 2, settlement: "CASH", date: TODAY },
          { customerId: wanjiru, litres: 2, settlement: "MPESA", mpesaRef: "TFG7K21M", date: TODAY },
          { customerId: school, litres: 30, settlement: "CREDIT", date: TODAY },
        ],
      },
      db,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.stops).toBe(3);
    expect(res.data.litres).toBe(34);
    expect(res.data.cashKes).toBe(130);
    expect(res.data.mpesaKes).toBe(130);
    expect(res.data.creditKes).toBe(1800);
    expect(res.refCode).toMatch(/^RD[A-Z2-9]{5}$/);
    expect(res.data.receiptLines.join(" ")).toContain("On credit KES 1,800");
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("the customer tab", () => {
  it("debits a credit delivery and leaves the money outstanding", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db, "INSTITUTION", 60);
    const school = await seedCustomer(db, {
      name: "St Mary's School", customerType: "INSTITUTION", paymentTerms: "NET_30",
    });

    const res = await recordDelivery(
      session, { date: TODAY, customerId: school, litres: 30, settlement: "CREDIT" }, db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.onCredit).toBe(true);
    expect(res.data.valueKes).toBe(1800);

    const ledger = await customerLedger(session, school, TODAY, db);
    expect(ledger.balance.balanceKes).toBe(1800);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].entryType).toBe("DELIVERY");
    await close();
  });

  it("nets a cash delivery to zero — debit and credit both recorded", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db, "HOUSEHOLD", 65);
    const mama = await seedCustomer(db, { name: "Mama Njeri", customerType: "HOUSEHOLD" });

    await recordDelivery(session, { date: TODAY, customerId: mama, litres: 2, settlement: "CASH" }, db);

    const ledger = await customerLedger(session, mama, TODAY, db);
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.balance.balanceKes).toBe(0);
    expect(ledger.balance.totalPaidKes).toBe(130);
    await close();
  });

  it("keeps the round idempotent — a replayed stop does not double the tab", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db, "INSTITUTION", 60);
    const school = await seedCustomer(db, { customerType: "INSTITUTION" });
    const id = newId();

    await recordDelivery(session, { id, date: TODAY, customerId: school, litres: 30, settlement: "CREDIT" }, db);
    await recordDelivery(session, { id, date: TODAY, customerId: school, litres: 30, settlement: "CREDIT" }, db);

    const ledger = await customerLedger(session, school, TODAY, db);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.balance.balanceKes).toBe(1800);
    await close();
  });

  it("lists customers with balances, worst first", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db, "INSTITUTION", 60);
    await seedPrice(db, "HOUSEHOLD", 65);
    const school = await seedCustomer(db, { name: "St Mary's School", customerType: "INSTITUTION" });
    const mama = await seedCustomer(db, { name: "Mama Njeri", customerType: "HOUSEHOLD" });

    await recordDelivery(session, { date: TODAY, customerId: school, litres: 30, settlement: "CREDIT" }, db);
    await recordDelivery(session, { date: TODAY, customerId: mama, litres: 2, settlement: "CASH" }, db);

    const list = await listCustomers(session, TODAY, db);
    expect(list[0].name).toBe("St Mary's School");
    expect(list[0].balance.balanceKes).toBe(1800);
    expect(list[1].balance.balanceKes).toBe(0);
    await close();
  });

  it("creates a customer and tells the owner the legal position at once", async () => {
    const { db, close, session } = await setup();
    const res = await createCustomer(
      session,
      { name: "Nairobi Cafe", customerType: "SHOP", areaClass: "URBAN", fulfilment: "DELIVERED" },
      db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.legality.allowed).toBe(false);
    expect(res.data.legality.blockers[0]).toContain("pasteurised");
    await close();
  });

  it("shows no other farm's ledger", async () => {
    const { db, close, session } = await setup();
    const mine = await seedCustomer(db, { customerType: "COOP" });
    await expect(
      customerLedger(fakeSession({ farmId: OTHER_FARM }), mine, TODAY, db),
    ).rejects.toThrow("That customer was not found.");
    expect(await listCustomers(fakeSession({ farmId: OTHER_FARM }), TODAY, db)).toEqual([]);
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("payments and approval (R10)", () => {
  it("keeps a rider's payment PENDING until a manager confirms it", async () => {
    const { db, close } = await setup();
    const riderId = await seedUser(db, { fullName: "Otieno", role: "RIDER" });
    const rider = fakeSession({ userId: riderId, role: "RIDER", fullName: "Otieno" });
    const managerId = await seedUser(db, { fullName: "Grace Wanjiru", role: "MANAGER" });
    const manager = fakeSession({ userId: managerId, role: "MANAGER" });

    await seedPrice(db, "HOUSEHOLD", 65);
    const mama = await seedCustomer(db, { name: "Mama Njeri", customerType: "HOUSEHOLD" });
    await recordDelivery(manager, { date: TODAY, customerId: mama, litres: 20, settlement: "CREDIT" }, db);

    const pay = await recordPayment(
      rider, { customerId: mama, date: TODAY, amountKes: 1300, paymentMethod: "CASH" }, db,
    );
    expect(pay.ok).toBe(true);
    if (!pay.ok) return;
    expect(pay.data.pending).toBe(true);
    expect(pay.message).toContain("the manager will confirm");

    // The balance has NOT moved yet — an unconfirmed payment is not money.
    let ledger = await customerLedger(manager, mama, TODAY, db);
    expect(ledger.balance.balanceKes).toBe(1300);
    expect(ledger.pendingPaymentsKes).toBe(1300);
    expect(ledger.entries.find((e) => e.pending)).toBeTruthy();

    const queue = await pendingPayments(manager, db);
    expect(queue).toHaveLength(1);
    expect(queue[0].recordedByName).toBe("Otieno");

    const approved = await approvePayment(manager, pay.data.id, db);
    expect(approved.ok).toBe(true);

    ledger = await customerLedger(manager, mama, TODAY, db);
    expect(ledger.balance.balanceKes).toBe(0);
    expect(ledger.pendingPaymentsKes).toBe(0);
    expect(await pendingPayments(manager, db)).toHaveLength(0);
    await close();
  });

  it("does not make a manager approve their own entry twice", async () => {
    const { db, close, session } = await setup("MANAGER");
    const mama = await seedCustomer(db, { name: "Mama Njeri", customerType: "HOUSEHOLD" });
    const pay = await recordPayment(
      session, { customerId: mama, date: TODAY, amountKes: 500, paymentMethod: "MPESA", mpesaRef: "TFG7K21M" }, db,
    );
    expect(pay.ok).toBe(true);
    if (!pay.ok) return;
    expect(pay.data.pending).toBe(false);
    expect(await pendingPayments(session, db)).toHaveLength(0);
    await close();
  });

  it("holds a rider's doorstep cash pending as well", async () => {
    const { db, close, session: owner } = await setup();
    const riderId = await seedUser(db, { fullName: "Otieno", role: "RIDER" });
    const rider = fakeSession({ userId: riderId, role: "RIDER" });
    await seedPrice(db, "HOUSEHOLD", 65);
    const mama = await seedCustomer(db, { name: "Mama Njeri", customerType: "HOUSEHOLD" });

    const res = await recordDelivery(rider, { date: TODAY, customerId: mama, litres: 2, settlement: "CASH" }, db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.paymentPending).toBe(true);

    // Read as the owner, not the rider. A rider records the delivery and takes
    // the cash; the debtor book is not his to open, and asking for it here is
    // now refused.
    const ledger = await customerLedger(owner, mama, TODAY, db);
    expect(ledger.balance.balanceKes).toBe(130); // still owed until confirmed
    expect(ledger.pendingPaymentsKes).toBe(130);

    await expect(customerLedger(rider, mama, TODAY, db)).rejects.toThrow(
      /does not include this/i,
    );
    await close();
  });

  /**
   * Segregation of duties is the documented remedy for the theft pattern this
   * module is built against, and it is only real if the READS are guarded too.
   * Every mutating action here always opened with a capability check; these
   * eight did not, so anyone with a session — a herdsman on the phone four
   * people share — could pull the whole farm's debtor book.
   */
  it("refuses a herdsman and a rider every money read on this module", async () => {
    const { db, close } = await setup();
    const herdsmanId = await seedUser(db, { fullName: "Kamau", role: "HERDSMAN" });
    const herdsman = fakeSession({ userId: herdsmanId, role: "HERDSMAN" });
    const riderId = await seedUser(db, { fullName: "Otieno", role: "RIDER" });
    const rider = fakeSession({ userId: riderId, role: "RIDER" });
    const mama = await seedCustomer(db, { name: "Mama Njeri", customerType: "HOUSEHOLD" });

    for (const who of [herdsman, rider]) {
      await expect(debtorAging(who, TODAY, db)).rejects.toThrow(/does not include this/i);
      await expect(listCustomers(who, TODAY, db)).rejects.toThrow(/does not include this/i);
      await expect(customerLedger(who, mama, TODAY, db)).rejects.toThrow(/does not include this/i);
      await expect(pendingPayments(who, db)).rejects.toThrow(/does not include this/i);
      await expect(listStatements(who, db)).rejects.toThrow(/does not include this/i);
      await expect(channelMix(who, TODAY, TODAY, db)).rejects.toThrow(/does not include this/i);
    }

    // But the rider can still run his round, and the herdsman can still see
    // where the milk went in litres — otherwise the guard has taken away the
    // work rather than the money.
    await expect(deliveryRound(rider, TODAY, "MORNING", db)).resolves.toBeTruthy();
    await expect(disposalLitres(herdsman, TODAY, TODAY, db)).resolves.toEqual([]);
    await close();
  });

  it("leaves an audit trail when a payment is approved", async () => {
    const { db, close } = await setup();
    const riderId = await seedUser(db, { fullName: "Otieno", role: "RIDER" });
    const rider = fakeSession({ userId: riderId, role: "RIDER" });
    const managerId = await seedUser(db, { fullName: "Grace", role: "MANAGER" });
    const manager = fakeSession({ userId: managerId, role: "MANAGER" });
    const mama = await seedCustomer(db, { name: "Mama Njeri", customerType: "HOUSEHOLD" });

    const pay = await recordPayment(rider, { customerId: mama, date: TODAY, amountKes: 500, paymentMethod: "CASH" }, db);
    if (!pay.ok) return;
    await approvePayment(manager, pay.data.id, db);

    const audit = await db.select().from(s.auditEntry).where(eq(s.auditEntry.rowId, pay.data.id));
    expect(audit[0].action).toBe("APPROVE");
    expect(audit[0].actorId).toBe(managerId);
    await close();
  });

  it("will not approve another farm's payment", async () => {
    const { db, close, session } = await setup();
    const mama = await seedCustomer(db, { name: "Mama Njeri", customerType: "HOUSEHOLD" });
    const pay = await recordPayment(session, { customerId: mama, date: TODAY, amountKes: 500, paymentMethod: "CASH" }, db);
    if (!pay.ok) return;
    const res = await approvePayment(fakeSession({ farmId: OTHER_FARM }), pay.data.id, db);
    expect(res.ok).toBe(false);
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("invoices and debtor aging", () => {
  it("invoices an institution for the period and dates it on their terms", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db, "INSTITUTION", 60);
    const school = await seedCustomer(db, {
      name: "St Mary's School", customerType: "INSTITUTION", paymentTerms: "NET_30", requiresInvoice: true,
    });

    for (const d of ["2026-07-01", "2026-07-02", "2026-07-03"]) {
      await recordDelivery(session, { date: d, customerId: school, litres: 30, settlement: "CREDIT" }, db);
    }

    const res = await createInvoice(
      session,
      { customerId: school, periodStart: "2026-07-01", periodEnd: "2026-07-31", issuedOn: "2026-08-01", etimsRef: "0012345" },
      db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.deliveries).toBe(3);
    expect(res.data.totalLitres).toBe(90);
    expect(res.data.totalKes).toBe(5400);
    expect(res.data.dueOn).toBe("2026-08-31");

    const [invoice] = await db.select().from(s.salesInvoice).where(eq(s.salesInvoice.id, res.data.id));
    expect(invoice.etimsRef).toBe("0012345");
    expect(invoice.status).toBe("ISSUED");
    await close();
  });

  it("says so plainly when there is nothing to invoice", async () => {
    const { db, close, session } = await setup();
    const school = await seedCustomer(db, { name: "St Mary's School", customerType: "INSTITUTION" });
    const res = await createInvoice(
      session, { customerId: school, periodStart: "2026-07-01", periodEnd: "2026-07-31" }, db,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("Nothing was delivered to St Mary's School");
    await close();
  });

  it("ages the debt into current / 30 / 60 / 90+ and names the worst", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db, "INSTITUTION", 60);
    const school = await seedCustomer(db, {
      name: "St Mary's School", customerType: "INSTITUTION", paymentTerms: "NET_30",
    });
    const mama = await seedCustomer(db, {
      name: "Mama Njeri", customerType: "HOUSEHOLD", paymentTerms: "WEEKLY",
    });

    // 41 days past the due date on 30-day terms.
    await db.insert(s.customerLedgerEntry).values({
      id: newId(), farmId: FARM_ID, customerId: school, entryDate: "2026-05-20",
      entryType: "DELIVERY", debitKes: "48000.00", creditKes: "0.00", recordedBy: newId(),
    });
    await db.insert(s.customerLedgerEntry).values({
      id: newId(), farmId: FARM_ID, customerId: mama, entryDate: "2026-08-01",
      entryType: "DELIVERY", debitKes: "910.00", creditKes: "0.00", recordedBy: newId(),
    });

    const aging = await debtorAging(session, TODAY, db);
    expect(aging.total.totalKes).toBe(48910);
    expect(aging.total.D60).toBe(48000);
    expect(aging.total.CURRENT).toBe(910);
    expect(aging.debtors[0].name).toBe("St Mary's School");
    expect(aging.worst.map((w) => w.name)).toEqual(["St Mary's School"]);
    expect(aging.debtors[0].interestKes).toBeGreaterThan(0);
    expect(aging.debtors[0].interestNote).toContain("entitled to");
    await close();
  });

  it("leaves a settled customer out of the aging report", async () => {
    const { db, close, session } = await setup();
    await seedPrice(db, "HOUSEHOLD", 65);
    const mama = await seedCustomer(db, { name: "Mama Njeri", customerType: "HOUSEHOLD" });
    await recordDelivery(session, { date: TODAY, customerId: mama, litres: 2, settlement: "CASH" }, db);

    const aging = await debtorAging(session, TODAY, db);
    expect(aging.debtors).toHaveLength(0);
    expect(aging.total.totalKes).toBe(0);
    await close();
  });

  it("applies payments oldest-first before aging what is left", async () => {
    const { db, close, session } = await setup();
    const school = await seedCustomer(db, {
      name: "St Mary's School", customerType: "INSTITUTION", paymentTerms: "NET_30",
    });
    for (const [date, amount] of [["2026-05-01", "20000.00"], ["2026-07-25", "20000.00"]] as const) {
      await db.insert(s.customerLedgerEntry).values({
        id: newId(), farmId: FARM_ID, customerId: school, entryDate: date,
        entryType: "DELIVERY", debitKes: amount, creditKes: "0.00", recordedBy: newId(),
      });
    }
    await db.insert(s.customerLedgerEntry).values({
      id: newId(), farmId: FARM_ID, customerId: school, entryDate: "2026-08-01",
      entryType: "PAYMENT", debitKes: "0.00", creditKes: "20000.00",
      recordedBy: newId(), approvedBy: newId(),
    });

    const aging = await debtorAging(session, TODAY, db);
    // The May invoice is cleared; only the July one remains, and it is current.
    expect(aging.total.totalKes).toBe(20000);
    expect(aging.total.CURRENT).toBe(20000);
    expect(aging.total.D90_PLUS).toBe(0);
    await close();
  });
});

/* ---------------------------------------------------------------- */

describe("co-op statement reconciliation", () => {
  async function seedMonth(db: TestDb, session: ReturnType<typeof fakeSession>, customerId: string) {
    for (const d of ["2026-07-01", "2026-07-02", "2026-07-03"]) {
      await recordDisposal(
        session,
        { date: d, channel: "COOP", customerId, litres: 120, rateKesPerLitre: 52, accepted: true },
        db,
      );
    }
  }

  it("finds the deduction with nothing behind it", async () => {
    const { db, close, session } = await setup();
    const coop = await seedCustomer(db, { name: "Limuru Dairy Co-operative", customerType: "COOP" });
    await seedMonth(db, session, coop);

    // The farm's own AI expense — this one should match.
    await db.insert(s.expense).values({
      id: newId(), farmId: FARM_ID, incurredOn: "2026-07-10", category: "BREEDING",
      amountKes: "3500.00", status: "APPROVED", recordedBy: newId(),
    });

    const res = await recordStatement(
      session,
      {
        customerId: coop,
        memberNo: "M-4471",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        coopLitres: 360,
        rateKesPerLitre: 52,
        grossPayKes: 18720,
        netPayKes: 13420,
        deductions: [
          { deductionType: "AI", description: "AI services", amountKes: 3500 },
          { deductionType: "TRANSPORT", description: "Transport levy", amountKes: 1800 },
        ],
      },
      db,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = res.data.reconciliation;
    expect(res.data.ourLitres).toBe(360);
    expect(r.litresVariance).toBe(0);
    expect(r.unmatchedDeductionsKes).toBe(1800);
    expect(r.deductionLines.find((l) => l.label === "AI services")!.matched).toBe(true);
    expect(r.deductionLines.find((l) => l.label === "Transport levy")!.matched).toBe(false);
    expect(r.message).toContain("Query this statement");

    const stored = await db.select().from(s.milkStatementDeduction);
    expect(stored).toHaveLength(2);
    expect(stored.filter((d) => d.matchedExpenseId !== null)).toHaveLength(1);
    await close();
  });

  it("catches litres the co-op did not credit us with", async () => {
    const { db, close, session } = await setup();
    const coop = await seedCustomer(db, { name: "Limuru Dairy", customerType: "COOP" });
    await seedMonth(db, session, coop);

    const res = await recordStatement(
      session,
      {
        customerId: coop, periodStart: "2026-07-01", periodEnd: "2026-07-31",
        coopLitres: 300, rateKesPerLitre: 52, grossPayKes: 15600, netPayKes: 15600, deductions: [],
      },
      db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.reconciliation.litresVariance).toBe(60);
    expect(res.data.reconciliation.litresVarianceKes).toBe(3120);
    expect(res.data.reconciliation.message).toContain("short on their record");
    await close();
  });

  it("agrees when the statement is right", async () => {
    const { db, close, session } = await setup();
    const coop = await seedCustomer(db, { name: "Limuru Dairy", customerType: "COOP" });
    await seedMonth(db, session, coop);
    const res = await recordStatement(
      session,
      {
        customerId: coop, periodStart: "2026-07-01", periodEnd: "2026-07-31",
        coopLitres: 360, rateKesPerLitre: 52, grossPayKes: 18720, netPayKes: 18720, deductions: [],
      },
      db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.reconciliation.message).toBe("The statement matches our records.");
    await close();
  });

  it("leaves rejected loads out of our own litres", async () => {
    const { db, close, session } = await setup();
    const coop = await seedCustomer(db, { name: "Limuru Dairy", customerType: "COOP" });
    await seedMonth(db, session, coop);
    await recordDisposal(
      session,
      { date: "2026-07-04", channel: "COOP", customerId: coop, litres: 120, rateKesPerLitre: 52, accepted: false },
      db,
    );

    const res = await recordStatement(
      session,
      {
        customerId: coop, periodStart: "2026-07-01", periodEnd: "2026-07-31",
        coopLitres: 360, rateKesPerLitre: 52, grossPayKes: 18720, netPayKes: 18720, deductions: [],
      },
      db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.ourLitres).toBe(360);
    await close();
  });

  it("can be re-opened later and still says the same thing", async () => {
    const { db, close, session } = await setup();
    const coop = await seedCustomer(db, { name: "Limuru Dairy", customerType: "COOP" });
    await seedMonth(db, session, coop);
    const res = await recordStatement(
      session,
      {
        customerId: coop, periodStart: "2026-07-01", periodEnd: "2026-07-31",
        coopLitres: 350, rateKesPerLitre: 52, grossPayKes: 18200, netPayKes: 16400,
        deductions: [{ deductionType: "TRANSPORT", description: "Transport levy", amountKes: 1800 }],
      },
      db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const view = await statementView(session, res.data.id, db);
    expect(view.customerName).toBe("Limuru Dairy");
    expect(view.ourDeliveries).toBe(3);
    expect(view.reconciliation.unmatchedDeductionsKes).toBe(1800);
    expect(view.reconciliation.litresVariance).toBe(10);
    await close();
  });

  it("will not read another farm's statement", async () => {
    const { db, close, session } = await setup();
    const coop = await seedCustomer(db, { customerType: "COOP" });
    await seedMonth(db, session, coop);
    const res = await recordStatement(
      session,
      {
        customerId: coop, periodStart: "2026-07-01", periodEnd: "2026-07-31",
        coopLitres: 360, rateKesPerLitre: 52, grossPayKes: 18720, netPayKes: 18720, deductions: [],
      },
      db,
    );
    if (!res.ok) return;
    await expect(
      statementView(fakeSession({ farmId: OTHER_FARM }), res.data.id, db),
    ).rejects.toThrow("That statement was not found.");
    await close();
  });
});
