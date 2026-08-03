import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import {
  FARM_ID,
  fakeSession,
  seedAnimal,
  seedCustomer,
  seedEmployee,
  seedFarm,
  seedFeedItem,
  seedProduct,
  seedUser,
} from "@/test/factory";
import { newId } from "@/lib/ids";
import * as s from "@/db/schema";
import { approveExpense, costOfProduction, linkedExpenseId, loadCostModel, monthToDate } from "../money";
import { costPerKgByItem, marginOverFeedCost, recordPurchaseFor } from "../feed";
import { recordRoutineBatchFor, recordTreatmentFor, recordVaccinationFor } from "../health";
import {
  animalLifetimeValue,
  feedCostByAnimal,
  recordPurchase as recordAnimalPurchase,
  recordSale,
} from "../trading";
import { runPayroll } from "../people";
import { recordDisposal } from "../sales";

/**
 * THE COST SEAMS.
 *
 * Feed, health and breeding each capture a cost on their own table. Each now
 * posts it into the cash book as well. The whole risk of that is counting the
 * same shilling twice, so every test here is really one question: after the
 * wiring, is the money still exactly once?
 */

const AUG = { from: "2026-08-01", to: "2026-08-31" } as const;

async function setup() {
  const { db, close } = await createTestDb();
  await seedFarm(db);
  const userId = await seedUser(db, { role: "MANAGER", fullName: "Grace Wanjiru" });
  return { db, close, session: fakeSession({ role: "MANAGER", userId }) };
}

async function seedMilk(db: TestDb, session: ReturnType<typeof fakeSession>, animalId?: string) {
  const id = animalId ?? (await seedAnimal(db, { tag: "KE-0001" }));
  for (const day of ["2026-08-10", "2026-08-11"]) {
    await db.insert(s.milkRecord).values({
      id: newId(),
      farmId: FARM_ID,
      animalId: id,
      recordedOn: day,
      session: "MORNING",
      litres: "200.00",
      recordedBy: session.userId,
      recordedAt: new Date(),
    });
  }
  return id;
}

const categoryTotal = (
  cop: Awaited<ReturnType<typeof costOfProduction>>,
  category: s.ExpenseCategory,
) => cop.byCategory.find((c) => c.category === category)?.amountKes ?? 0;

/* ================================================================== */
/* SEAM 1 — feed purchase → expense                                   */
/* ================================================================== */

describe("a feed purchase posts to the cash book", () => {
  async function buyFeed(db: TestDb, session: ReturnType<typeof fakeSession>, id?: string) {
    const feedItemId = await seedFeedItem(db, { name: "Dairy meal (Unga)" });
    return {
      feedItemId,
      result: await recordPurchaseFor(
        session,
        {
          id,
          feedItemId,
          purchasedOn: "2026-08-05",
          quantity: 10,
          unit: "BAG_70KG",
          unitPriceKes: 3_290,
        },
        db,
      ),
    };
  }

  it("creates a PENDING FEEDS expense and stores the link on the purchase", async () => {
    const { db, close, session } = await setup();
    const { result } = await buyFeed(db, session);
    if (!result.ok) throw new Error(result.error);

    const [expense] = await db.select().from(s.expense);
    expect(expense.category).toBe("FEEDS");
    expect(expense.amountKes).toBe("32900.00");
    expect(expense.status).toBe("PENDING");
    expect(expense.incurredOn).toBe("2026-08-05");
    expect(expense.recordedBy).toBe(session.userId);

    const [purchase] = await db.select().from(s.feedPurchase);
    expect(purchase.expenseId).toBe(expense.id);
    expect(result.data.expenseId).toBe(expense.id);
    await close();
  });

  it("keeps the purchase out of cost per litre until a manager approves it", async () => {
    const { db, close, session } = await setup();
    await seedMilk(db, session);
    const { result } = await buyFeed(db, session);
    if (!result.ok) throw new Error(result.error);

    expect(categoryTotal(await costOfProduction(session, AUG.from, AUG.to, db), "FEEDS")).toBe(0);
    await approveExpense(session, result.data.expenseId!, db);
    expect(categoryTotal(await costOfProduction(session, AUG.from, AUG.to, db), "FEEDS")).toBe(32_900);
    await close();
  });

  /**
   * The deliberate asymmetry, and the reason it is deliberate. The cull list
   * has to name a loss-making cow whether or not the feed invoice has been
   * approved — gating it on an approval would silently empty the one screen
   * that pays for the system.
   */
  it("does NOT gate feed COSTING on approval — margin and the cull list read the purchase", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedMilk(db, session);
    const { feedItemId, result } = await buyFeed(db, session);
    if (!result.ok) throw new Error(result.error);

    await db.insert(s.feedIssue).values({
      id: newId(),
      farmId: FARM_ID,
      feedItemId,
      issuedOn: "2026-08-10",
      animalGroup: "LACTATING",
      quantity: "1.000",
      unit: "BAG_70KG",
      unitWeightKg: "70.000",
      recordedBy: session.userId,
    });

    const costModel = await loadCostModel(session, AUG.to, db);
    const beforeApproval = {
      perKg: (await costPerKgByItem(session, AUG.to, db)).get(feedItemId),
      margin: (await marginOverFeedCost(session, AUG.from, AUG.to, db)).feedCostKes,
      perAnimal: (await feedCostByAnimal(db, FARM_ID, AUG.from, AUG.to, costModel)).get(animalId),
    };
    expect(beforeApproval.perKg).toBe(47);
    expect(beforeApproval.margin).toBe(3_290);
    expect(beforeApproval.perAnimal).toBe(3_290);

    await approveExpense(session, result.data.expenseId!, db);

    // Unchanged: approving the expense must not add the feed cost a second time.
    expect((await costPerKgByItem(session, AUG.to, db)).get(feedItemId)).toBe(47);
    expect((await marginOverFeedCost(session, AUG.from, AUG.to, db)).feedCostKes).toBe(3_290);
    expect((await feedCostByAnimal(db, FARM_ID, AUG.from, AUG.to, costModel)).get(animalId)).toBe(3_290);
    await close();
  });

  it("posts once when the offline outbox flushes the same purchase twice", async () => {
    const { db, close, session } = await setup();
    const purchaseId = newId();
    const feedItemId = await seedFeedItem(db);
    for (let i = 0; i < 2; i++) {
      await recordPurchaseFor(
        session,
        { id: purchaseId, feedItemId, purchasedOn: "2026-08-05", quantity: 10, unit: "BAG_70KG", unitPriceKes: 3_290 },
        db,
      );
    }
    expect(await db.select().from(s.feedPurchase)).toHaveLength(1);
    expect(await db.select().from(s.expense)).toHaveLength(1);
    await close();
  });

  it("drops a supplier id that is not this farm's supplier rather than losing the purchase", async () => {
    const { db, close, session } = await setup();
    const feedItemId = await seedFeedItem(db);
    const result = await recordPurchaseFor(
      session,
      {
        feedItemId,
        purchasedOn: "2026-08-05",
        quantity: 1,
        unit: "BAG_70KG",
        unitPriceKes: 3_290,
        // A uuid that is not a counterparty at all. `expense.counterpartyId`
        // is a real foreign key; `feedPurchase.supplierId` is not.
        supplierId: newId(),
      },
      db,
    );
    expect(result.ok).toBe(true);
    const [expense] = await db.select().from(s.expense);
    expect(expense.counterpartyId).toBeNull();
    await close();
  });
});

/* ================================================================== */
/* SEAM 2 — health cost → expense, without double-counting the vet    */
/* ================================================================== */

describe("a treatment posts to the cash book", () => {
  it("creates a PENDING VETERINARY expense and stores the link on the event", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { tag: "KE-0001", name: "Njeri" });
    const productId = await seedProduct(db);

    const treated = await recordTreatmentFor(
      session,
      { animalId, productId, occurredOn: "2026-08-06", costKes: 3_000, costSettledBy: "CASH" },
      db,
    );
    if (!treated.ok) throw new Error(treated.error);

    const [expense] = await db.select().from(s.expense);
    expect(expense.category).toBe("VETERINARY");
    expect(expense.amountKes).toBe("3000.00");
    expect(expense.status).toBe("PENDING");
    expect(expense.paymentMethod).toBe("CASH");
    expect(expense.description).toContain("Njeri");

    const [event] = await db.select().from(s.healthEvent).where(eq(s.healthEvent.id, treated.data.id));
    expect(event.expenseId).toBe(expense.id);
    await close();
  });

  /**
   * THE ONE THE BUILD AGENT FLAGGED. `animalLifetimeValue` reads
   * `healthEvent.costKes`; `costOfProduction` reads the approved expense. Two
   * views of one shilling — and nothing may ever show it as two.
   */
  it("shows the vet cost twice and charges it once", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { tag: "KE-0001" });
    await seedMilk(db, session, animalId);
    const productId = await seedProduct(db);

    const treated = await recordTreatmentFor(
      session,
      { animalId, productId, occurredOn: "2026-08-06", costKes: 3_000, costSettledBy: "CASH" },
      db,
    );
    if (!treated.ok) throw new Error(treated.error);
    const expenseId = linkedExpenseId("health_event", treated.data.id);

    // Per-animal: charged immediately, because the cull list cannot wait for
    // an approval to tell a farmer which cow is losing money.
    const lifetimeBefore = await animalLifetimeValue(session, animalId, "2026-08-31", db);
    expect(lifetimeBefore.vetCostKes).toBe(3_000);
    // Farm-wide: nothing yet, because nobody has approved it (R10).
    expect(categoryTotal(await costOfProduction(session, AUG.from, AUG.to, db), "VETERINARY")).toBe(0);

    await approveExpense(session, expenseId, db);

    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    // 3,000 — not 6,000. The expense IS the health event's cost, not a second one.
    expect(categoryTotal(cop, "VETERINARY")).toBe(3_000);
    expect(cop.cash.totalKes).toBe(3_000);
    const lifetimeAfter = await animalLifetimeValue(session, animalId, "2026-08-31", db);
    expect(lifetimeAfter.vetCostKes).toBe(3_000);
    expect(await db.select().from(s.expense)).toHaveLength(1);
    await close();
  });

  it("stamps a co-op check-off as a check-off, not as cash out of the till", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { tag: "KE-0002" });
    const productId = await seedProduct(db);

    await recordTreatmentFor(
      session,
      { animalId, productId, occurredOn: "2026-08-06", costKes: 1_200, costSettledBy: "COOP_CHECKOFF" },
      db,
    );

    const [expense] = await db.select().from(s.expense);
    expect(expense.paymentMethod).toBe("COOP_CHECKOFF");
    // Still a cost of production — the co-op paid the vet and will take it off
    // the milk cheque. What it is NOT is money the M-Pesa statement should show.
    await approveExpense(session, expense.id, db);
    expect((await monthToDate(session, "2026-08-31", db)).expenseKes).toBe(1_200);
    await close();
  });

  it("posts nothing at all when the treatment was free", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { tag: "KE-0003" });
    const productId = await seedProduct(db);
    const treated = await recordTreatmentFor(session, { animalId, productId, occurredOn: "2026-08-06" }, db);
    if (!treated.ok) throw new Error(treated.error);

    expect(await db.select().from(s.expense)).toHaveLength(0);
    const [event] = await db.select().from(s.healthEvent);
    expect(event.expenseId).toBeNull();
    await close();
  });

  it("posts a vaccination the same way", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { tag: "KE-0004", sex: "F", dateOfBirth: "2026-02-01" });
    const given = await recordVaccinationFor(
      session,
      { animalId, routine: "S19", occurredOn: "2026-08-06", costKes: 450, costSettledBy: "COOP_CHECKOFF" },
      db,
    );
    if (!given.ok) throw new Error(given.error);

    const [expense] = await db.select().from(s.expense);
    expect(expense.category).toBe("VETERINARY");
    expect(expense.amountKes).toBe("450.00");
    expect(expense.paymentMethod).toBe("COOP_CHECKOFF");
    await close();
  });

  /**
   * A dip is one invoice, not sixty. `costKes` is per animal per product on the
   * row — that is what M7 attributes — but the cash book gets the whole batch
   * once.
   */
  it("posts ONE expense for a whole routine batch, however many animals it covers", async () => {
    const { db, close, session } = await setup();
    const productId = await seedProduct(db, { name: "Triatix", productType: "ACARICIDE", milkWithdrawalDays: 0 });
    for (const tag of ["KE-1", "KE-2", "KE-3"]) await seedAnimal(db, { tag });

    const batch = await recordRoutineBatchFor(
      session,
      { occurredOn: "2026-08-07", group: "ALL", productIds: [productId], eventType: "DIPPING", costKes: 50 },
      db,
    );
    if (!batch.ok) throw new Error(batch.error);
    expect(batch.data.animals).toBe(3);

    const expenses = await db.select().from(s.expense);
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amountKes).toBe("150.00");
    expect(expenses[0].category).toBe("VETERINARY");

    const events = await db.select().from(s.healthEvent);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.expenseId === expenses[0].id)).toBe(true);
    await close();
  });

  it("dips the herd once when the same batch is flushed twice", async () => {
    const { db, close, session } = await setup();
    const productId = await seedProduct(db, { name: "Triatix", productType: "ACARICIDE" });
    await seedAnimal(db, { tag: "KE-1" });
    const batchId = newId();
    for (let i = 0; i < 2; i++) {
      await recordRoutineBatchFor(
        session,
        { batchId, occurredOn: "2026-08-07", group: "ALL", productIds: [productId], costKes: 50 },
        db,
      );
    }
    expect(await db.select().from(s.healthEvent)).toHaveLength(1);
    expect(await db.select().from(s.expense)).toHaveLength(1);
    await close();
  });
});

/* ================================================================== */
/* SEAM 6 — a sale is income; an animal PURCHASE is capital           */
/* ================================================================== */

describe("animal trading touches the books exactly once", () => {
  it("writes one income row for a sale and no second one anywhere", async () => {
    const { db, close, session } = await setup();
    const animalId = await seedAnimal(db, { tag: "KE-0007", name: "Wanjiku" });

    const sale = await recordSale(
      session,
      { animalId, exitDate: "2026-08-14", reason: "SOLD", priceKes: 95_000, counterpartyKind: "FARMER" },
      db,
    );
    if (!sale.ok) throw new Error(sale.error);

    const incomes = await db.select().from(s.income);
    expect(incomes).toHaveLength(1);
    expect(incomes[0].id).toBe(sale.data.incomeId);
    expect(incomes[0].source).toBe("ANIMAL_SALE");
    expect(incomes[0].status).toBe("PENDING");
    // And no expense — selling an animal costs nothing.
    expect(await db.select().from(s.expense)).toHaveLength(0);
    await close();
  });

  /**
   * A KES 200,000 in-calf heifer is CAPITAL. Posting it as an operating
   * expense would put it in that month's cost per litre and make the single
   * most-used number in the system meaningless for a year.
   */
  it("writes NO expense when an animal is bought in", async () => {
    const { db, close, session } = await setup();
    await seedMilk(db, session);

    const bought = await recordAnimalPurchase(
      session,
      {
        tag: "KE-0100",
        name: "Mumbi",
        enteredHerdOn: "2026-08-02",
        priceKes: 200_000,
        classOverride: "INCALF_HEIFER",
      },
      db,
    );
    expect(bought.ok).toBe(true);

    expect(await db.select().from(s.expense)).toHaveLength(0);
    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    expect(cop.cash.totalKes).toBe(0);
    expect(categoryTotal(cop, "LIVESTOCK")).toBe(0);

    // It is on the animal, where `animalLifetimeValue` reads it.
    const [animal] = await db.select().from(s.animal).where(eq(s.animal.tag, "KE-0100"));
    expect(animal.purchasePriceKes).toBe("200000.00");
    await close();
  });

  it("counts an approved animal sale as non-milk income, alongside derived milk revenue", async () => {
    const { db, close, session } = await setup();
    await seedMilk(db, session);
    await db.insert(s.priceList).values({
      id: newId(),
      farmId: FARM_ID,
      scope: "CHANNEL",
      customerType: "COOP",
      rateKesPerLitre: "50.00",
      effectiveFrom: "2026-01-01",
      setBy: newId(),
    });
    const coopId = await seedCustomer(db, { customerType: "COOP" });
    await recordDisposal(
      session,
      { date: "2026-08-10", channel: "COOP", customerId: coopId, litres: 300 },
      db,
    );

    const animalId = await seedAnimal(db, { tag: "KE-0008" });
    const sale = await recordSale(
      session,
      { animalId, exitDate: "2026-08-14", reason: "CULLED", priceKes: 40_000 },
      db,
    );
    if (!sale.ok) throw new Error(sale.error);
    await db
      .update(s.income)
      .set({ status: "APPROVED", approvedBy: session.userId })
      .where(eq(s.income.id, sale.data.incomeId!));

    const mtd = await monthToDate(session, "2026-08-31", db);
    expect(mtd.milkSoldKes).toBe(15_000);
    expect(mtd.otherIncomeKes).toBe(40_000);
    expect(mtd.incomeKes).toBe(55_000);
    await close();
  });
});

/* ================================================================== */
/* SEAM 4 — the staff milk ration reaches the payslip                 */
/* ================================================================== */

describe("the staff milk ration is pay in kind", () => {
  async function seedRation(db: TestDb, session: ReturnType<typeof fakeSession>, litres: number) {
    await db.insert(s.priceList).values({
      id: newId(),
      farmId: FARM_ID,
      scope: "CHANNEL",
      customerType: "COOP",
      rateKesPerLitre: "50.00",
      effectiveFrom: "2026-01-01",
      setBy: newId(),
    });
    await recordDisposal(session, { date: "2026-08-10", channel: "STAFF_RATION", litres }, db);
  }

  it("values August's STAFF_RATION disposals onto August's payslips", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, { fullName: "Kamau Mwangi" });
    await seedRation(db, session, 30); // 30 L × KES 50 imputed = 1,500

    const run = await runPayroll(session, "2026-08", db);
    if (!run.ok) throw new Error(run.error);
    expect(run.data.payslips).toHaveLength(1);
    expect(run.data.payslips[0].slip.milkRationKes).toBe(1_500);

    const [slip] = await db.select().from(s.payslip);
    expect(slip.milkRationKes).toBe("1500.00");
    await close();
  });

  it("splits it across the staff and adds back to exactly what was disposed", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, { fullName: "Kamau Mwangi" });
    await seedEmployee(db, { fullName: "Peter Otieno" });
    await seedEmployee(db, { fullName: "Mary Achieng" });
    await seedRation(db, session, 20); // 20 × 50 = 1,000 over three people

    const run = await runPayroll(session, "2026-08", db);
    if (!run.ok) throw new Error(run.error);
    const total = run.data.payslips.reduce((t, p) => t + p.slip.milkRationKes, 0);
    expect(Math.round(total * 100) / 100).toBe(1_000);
    await close();
  });

  it("never takes it off anybody's net pay — it is a cost in kind, not a deduction", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db, { fullName: "Kamau Mwangi" });
    await seedRation(db, session, 30);

    const run = await runPayroll(session, "2026-08", db);
    if (!run.ok) throw new Error(run.error);
    const slip = run.data.payslips[0].slip;
    expect(slip.netKes).toBe(10_770); // identical to a month with no ration
    expect(slip.totalDeductionsKes).not.toContain(slip.milkRationKes);
    // It shows up where it belongs: what the farm actually spends on this person.
    expect(slip.costToFarmKes).toBe(12_900 + 1_500);
    await close();
  });

  it("posts no expense for it — the farm produced that milk, it did not buy it", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    await seedRation(db, session, 30);
    await runPayroll(session, "2026-08", db);
    expect(await db.select().from(s.expense)).toHaveLength(0);
    await close();
  });

  it("ignores a ration disposed in another month", async () => {
    const { db, close, session } = await setup();
    await seedEmployee(db);
    await seedRation(db, session, 30);

    const july = await runPayroll(session, "2026-07", db);
    if (!july.ok) throw new Error(july.error);
    expect(july.data.payslips[0].slip.milkRationKes).toBe(0);
    await close();
  });
});
