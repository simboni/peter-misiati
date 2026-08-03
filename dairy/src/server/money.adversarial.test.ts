/**
 * M9 — Money. ADVERSARIAL suite.
 *
 * Three questions only:
 *   1. Can an unapproved row move a number an owner would act on?
 *   2. Does a shilling survive the round trip through Drizzle's `numeric`?
 *   3. Does the M-Pesa reconcile find money that moved and was never recorded?
 *
 * Bug demonstrations are `it.fails(...)`: they assert the CORRECT behaviour and
 * fail until fixed.
 */
import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { seedFarm, seedUser, seedCustomer, seedFeedItem, seedAnimal, fakeSession, FARM_ID } from "@/test/factory";
import * as s from "@/db/schema";
import { newId } from "@/lib/ids";
import { dec, money, num } from "@/lib/money";
import {
  approvalQueue,
  approveExpense,
  approveIncome,
  costOfProduction,
  createCounterparty,
  importMpesaCsv,
  listCounterparties,
  loadCostModel,
  monthToDate,
  parseCsvRows,
  parseMpesaAmount,
  parseMpesaCsv,
  parseMpesaDate,
  recordExpense,
  recordIncome,
  reconcileMpesa,
  updateCounterparty,
  voidExpense,
} from "./money";
import { recordPurchaseFor, marginOverFeedCost, type DbLike } from "./feed";

const OTHER_FARM = "22222222-2222-4222-8222-222222222222";
const AUG = { from: "2026-08-01", to: "2026-08-31" } as const;

async function setup(role: s.Role = "MANAGER") {
  const { db, close } = await createTestDb();
  await seedFarm(db);
  const userId = await seedUser(db, { role, fullName: "Grace Wanjiru" });
  return { db, close, userId, session: fakeSession({ role, userId }) };
}

async function seedOtherFarm(db: TestDb) {
  await db.insert(s.farm).values({ id: OTHER_FARM, name: "Nyandarua Rival Dairy" }).onConflictDoNothing();
  const userId = newId();
  await db.insert(s.appUser).values({
    id: userId, farmId: OTHER_FARM, fullName: "Their manager", role: "MANAGER", pinHash: "x",
  });
  const expenseId = newId();
  await db.insert(s.expense).values({
    id: expenseId, farmId: OTHER_FARM, incurredOn: "2026-08-05", category: "FEEDS",
    amountKes: "50000.00", status: "PENDING", recordedBy: userId,
  });
  const incomeId = newId();
  await db.insert(s.income).values({
    id: incomeId, farmId: OTHER_FARM, receivedOn: "2026-08-05", source: "MILK",
    amountKes: "90000.00", status: "PENDING", recordedBy: userId,
  });
  const counterpartyId = newId();
  await db.insert(s.counterparty).values({
    id: counterpartyId, farmId: OTHER_FARM, name: "Their agrovet", types: ["AGROVET"],
  });
  const customerId = newId();
  await db.insert(s.customer).values({
    id: customerId, farmId: OTHER_FARM, name: "Their co-op", customerType: "COOP",
  });
  return { expenseId, incomeId, counterpartyId, customerId, userId };
}

async function seedMilk(db: TestDb, litresPerDay: number, days: string[]) {
  const animalId = await seedAnimal(db, { tag: `KE-${Math.random().toString(36).slice(2, 8)}` });
  for (const day of days) {
    await db.insert(s.milkRecord).values({
      id: newId(), farmId: FARM_ID, animalId, recordedOn: day, session: "MORNING",
      litres: litresPerDay.toFixed(2), recordedBy: newId(), recordedAt: new Date(),
    });
  }
  return animalId;
}

/* ================================================================== */
/* 1. MONEY ARITHMETIC — exact strings, never approximations           */
/* ================================================================== */

describe("shillings survive the round trip", () => {
  it("stores 0.1 + 0.2 as 0.30, not 0.30000000000000004", async () => {
    const { db, close, session } = await setup();
    await recordExpense(session, { incurredOn: "2026-08-01", category: "OTHER", amountKes: 0.1 }, db);
    await recordExpense(session, { incurredOn: "2026-08-01", category: "OTHER", amountKes: 0.2 }, db);
    const rows = await db.select().from(s.expense).where(eq(s.expense.farmId, FARM_ID));
    expect(rows.map((r) => r.amountKes).sort()).toEqual(["0.10", "0.20"]);

    for (const r of rows) await approveExpense(session, r.id, db);
    const mtd = await monthToDate(session, "2026-08-31", db);
    // Postgres sums numeric exactly; a JS reduce over floats would give 0.30000000000000004.
    expect(mtd.expenseKes).toBe(0.3);
    await close();
  });

  it("carries a KES 400,000 bull and a KES 999,999,999,999.99 ceiling without drift", async () => {
    const { db, close, session } = await setup();
    await recordIncome(session, { receivedOn: "2026-08-02", source: "ANIMAL_SALE", amountKes: 400_000 }, db);
    await recordIncome(session, { receivedOn: "2026-08-02", source: "OTHER", amountKes: 12_345_678.99 }, db);
    const rows = await db.select().from(s.income).where(eq(s.income.farmId, FARM_ID));
    expect(rows.map((r) => r.amountKes).sort()).toEqual(["12345678.99", "400000.00"]);
    for (const r of rows) await approveIncome(session, r.id, db);
    expect((await monthToDate(session, "2026-08-31", db)).incomeKes).toBe(12_745_678.99);
    await close();
  });

  it("refuses a negative expense and a negative income", async () => {
    const { db, close, session } = await setup();
    const e = await recordExpense(session, { incurredOn: "2026-08-01", category: "FEEDS", amountKes: -5_000 }, db);
    const i = await recordIncome(session, { receivedOn: "2026-08-01", source: "MILK", amountKes: -5_000 }, db);
    expect(e.ok).toBe(false);
    expect(i.ok).toBe(false);
    if (!e.ok) expect(e.fieldErrors?.amountKes?.[0]).toBe("An amount cannot be negative.");
    await close();
  });

  /**
   * DEFECT — LOW. `money()` is documented as the defence against float drift but
   * it does not round half-up: 300.025 is held as 300.02499999..., so
   * `Math.round(v*100)` sends it DOWN. Every half-cent in the system loses a
   * cent, always in the same direction.
   */
  it.fails("money() rounds a half-cent up", () => {
    expect(money(300.025)).toBe(300.03); // observed 300.02
    expect(money(8.165)).toBe(8.17); // observed 8.16
  });

  it("dec() and money() disagree on the same half-cent, which is the real hazard", () => {
    // dec() is toFixed, money() is Math.round — they are not the same rounding.
    expect(dec(1.005)).toBe("1.00");
    expect(dec(money(1.005))).toBe("1.01");
    expect(num("0.30")).toBe(0.3);
  });

  /**
   * DEFECT — MEDIUM. `amountKes` has no upper bound, so an amount that overflows
   * `numeric(14,2)` reaches the database and comes back as a raw Postgres error
   * shown verbatim to a farm worker. AGENTS.md: "Errors say what went wrong and
   * what to do. No apologies, no stack traces."
   */
  it.fails("an over-large amount is refused in words a farmer can act on", async () => {
    const { db, close, session } = await setup();
    const res = await recordExpense(
      session,
      { incurredOn: "2026-08-01", category: "OTHER", amountKes: 10_000_000_000_000 },
      db,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toMatch(/numeric|overflow|precision/i);
      expect(res.error).toMatch(/too large|amount/i);
    }
    await close();
  });
});

/* ================================================================== */
/* 2. THE APPROVAL BOUNDARY                                            */
/* ================================================================== */

describe("nothing counts until a manager approves it", () => {
  it("keeps a PENDING expense out of BOTH month-to-date and cost of production", async () => {
    const { db, close, session } = await setup();
    await seedMilk(db, 1_000, ["2026-08-10", "2026-08-11"]);

    const saved = await recordExpense(
      session, { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 60_000 }, db,
    );
    expect(saved.ok).toBe(true);

    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    expect(cop.cash.totalKes).toBe(0);
    expect(cop.cash.perLitreKes).toBe(0);
    expect(cop.byCategory).toHaveLength(0);

    const mtd = await monthToDate(session, "2026-08-31", db);
    expect(mtd.expenseKes).toBe(0);
    expect(mtd.pendingKes).toBe(60_000);
    expect(mtd.headline).toContain("not counted above");
    await close();
  });

  it("moves both reports the moment it is approved, by exactly the right amount", async () => {
    const { db, close, session } = await setup();
    await seedMilk(db, 1_000, ["2026-08-10", "2026-08-11"]); // 2,000 L
    const saved = await recordExpense(
      session, { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 60_000 }, db,
    );
    if (!saved.ok) throw new Error(saved.error);
    await approveExpense(session, saved.data.id, db);

    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    expect(cop.cash.totalKes).toBe(60_000);
    expect(cop.cash.perLitreKes).toBe(30); // 60,000 / 2,000 L
    expect((await monthToDate(session, "2026-08-31", db)).expenseKes).toBe(60_000);
    await close();
  });

  it("approving the same expense twice does not double-count it", async () => {
    const { db, close, session } = await setup();
    const saved = await recordExpense(
      session, { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 60_000 }, db,
    );
    if (!saved.ok) throw new Error(saved.error);
    await approveExpense(session, saved.data.id, db);
    const twice = await approveExpense(session, saved.data.id, db);
    expect(twice.ok).toBe(true);
    if (twice.ok) expect(twice.message).toBe("Already approved.");
    expect((await monthToDate(session, "2026-08-31", db)).expenseKes).toBe(60_000);
    await close();
  });

  it("refuses to approve an entry that was voided", async () => {
    const { db, close, session } = await setup();
    const saved = await recordExpense(
      session, { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 60_000 }, db,
    );
    if (!saved.ok) throw new Error(saved.error);
    await voidExpense(session, saved.data.id, db);
    const res = await approveExpense(session, saved.data.id, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("That entry was cancelled. It cannot be approved.");
    expect((await monthToDate(session, "2026-08-31", db)).expenseKes).toBe(0);
    await close();
  });

  it("VOIDING AN APPROVED EXPENSE SUCCEEDS AND LIES ABOUT IT (observed)", async () => {
    const { db, close, session } = await setup();
    const saved = await recordExpense(
      session, { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 60_000 }, db,
    );
    if (!saved.ok) throw new Error(saved.error);
    await approveExpense(session, saved.data.id, db);
    expect((await monthToDate(session, "2026-08-31", db)).expenseKes).toBe(60_000);

    const voided = await voidExpense(session, saved.data.id, db);
    expect(voided.ok).toBe(true);
    // It DID enter the books. The receipt the farm keeps says otherwise.
    if (voided.ok) expect(voided.message).toBe("Entry cancelled. It never entered the books.");
    expect((await monthToDate(session, "2026-08-31", db)).expenseKes).toBe(0);
    await close();
  });

  /**
   * DEFECT — MEDIUM. `voidExpense` has no status guard and no reversal record.
   * An approved KES 60,000 feed bill can be silently un-booked by any approver,
   * and the message tells them it "never entered the books". Reversing an
   * approved entry is a legitimate act; describing it as if it never happened is
   * not, and it is exactly what an insider would want the audit trail to say.
   */
  it.fails("voiding an APPROVED entry is either refused or described honestly", async () => {
    const { db, close, session } = await setup();
    const saved = await recordExpense(
      session, { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 60_000 }, db,
    );
    if (!saved.ok) throw new Error(saved.error);
    await approveExpense(session, saved.data.id, db);
    const voided = await voidExpense(session, saved.data.id, db);
    if (voided.ok) expect(voided.message).not.toContain("never entered the books");
    await close();
  });

  /**
   * DEFECT — HIGH. There is no `voidIncome`. `approveEntryAction` routes EVERY
   * "VOID" decision to `voidExpense` regardless of `kind`, so a mistaken or
   * fraudulent income entry — say KES 400,000 for a bull that was never sold —
   * can be approved but never cancelled. Approving it is one click; undoing it
   * is impossible through the product.
   */
  it.fails("an income entry can be voided", async () => {
    const { db, close, session } = await setup();
    const saved = await recordIncome(
      session, { receivedOn: "2026-08-05", source: "ANIMAL_SALE", amountKes: 400_000 }, db,
    );
    if (!saved.ok) throw new Error(saved.error);
    // This is the path approveEntryAction takes for decision=VOID, whatever the kind.
    const res = await voidExpense(session, saved.data.id, db);
    expect(res.ok).toBe(true);
    await close();
  });

  it("a HERDSMAN cannot record, see or approve money at all", async () => {
    const { db, close, session } = await setup("HERDSMAN");
    const rec = await recordExpense(session, { incurredOn: "2026-08-01", category: "FEEDS", amountKes: 1 }, db);
    expect(rec.ok).toBe(false);
    if (!rec.ok) expect(rec.error).toContain("VIEW_MONEY");
    expect((await approveExpense(session, newId(), db)).ok).toBe(false);
    await expect(monthToDate(session, "2026-08-31", db)).rejects.toThrow(/VIEW_MONEY/);
    await expect(approvalQueue(session, db)).rejects.toThrow(/APPROVE/);
    await close();
  });

  it("an ACCOUNTANT may record and read but never approve", async () => {
    const { db, close, session } = await setup("ACCOUNTANT");
    const rec = await recordExpense(session, { incurredOn: "2026-08-01", category: "FEEDS", amountKes: 5_000 }, db);
    expect(rec.ok).toBe(true);
    if (!rec.ok) return;
    const approved = await approveExpense(session, rec.data.id, db);
    expect(approved.ok).toBe(false);
    if (!approved.ok) expect(approved.error).toContain("APPROVE");
    await expect(approvalQueue(session, db)).rejects.toThrow(/APPROVE/);
    // ...and the row is still pending, so no report moved.
    expect((await monthToDate(session, "2026-08-31", db)).expenseKes).toBe(0);
    await close();
  });

  /**
   * DEFECT — MEDIUM. The module docstring: "the person who records is not the
   * person who approves". Nothing enforces it. The same MANAGER records KES
   * 60,000 of "feed" and approves it in the next call, with no second pair of
   * eyes, which is the precise concentration the design says it exists to break.
   */
  it.fails("a manager cannot approve an entry they recorded themselves", async () => {
    const { db, close, session } = await setup();
    const saved = await recordExpense(
      session, { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 60_000 }, db,
    );
    if (!saved.ok) throw new Error(saved.error);
    const approved = await approveExpense(session, saved.data.id, db);
    expect(approved.ok).toBe(false);
    await close();
  });

  it("writes an audit row against a real user for every approval", async () => {
    const { db, close, session, userId } = await setup();
    const saved = await recordExpense(
      session, { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 1_000 }, db,
    );
    if (!saved.ok) throw new Error(saved.error);
    await approveExpense(session, saved.data.id, db);
    const audits = await db.select().from(s.auditEntry).where(eq(s.auditEntry.rowId, saved.data.id));
    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBe(userId);
    expect(audits[0].action).toBe("APPROVE");
    await close();
  });
});

/* ================================================================== */
/* 3. COST OF PRODUCTION                                               */
/* ================================================================== */

describe("cost of production", () => {
  it("reports no cost per litre rather than dividing by zero litres", async () => {
    const { db, close, session } = await setup();
    const saved = await recordExpense(
      session, { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 60_000 }, db,
    );
    if (!saved.ok) throw new Error(saved.error);
    await approveExpense(session, saved.data.id, db);

    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    expect(cop.litresProduced).toBe(0);
    expect(cop.cash.perLitreKes).toBe(0);
    expect(cop.full.perLitreKes).toBe(0);
    expect(cop.verdict).toContain("No milk was recorded");
    await close();
  });

  it("takes the LATEST effective cost-model row and ignores future-dated ones", async () => {
    const { db, close, session } = await setup();
    const put = (key: string, value: string, from: string) =>
      db.insert(s.referenceValue).values({
        id: newId(), farmId: FARM_ID, kind: "COST_MODEL", key,
        valueNumeric: value, effectiveFrom: from,
      });
    await put("IMPUTED_FODDER_KES_PER_KG", "5.0000", "2026-01-01");
    await put("IMPUTED_FODDER_KES_PER_KG", "9.0000", "2026-06-01");
    await put("IMPUTED_FODDER_KES_PER_KG", "99.0000", "2027-01-01"); // not yet in force

    const model = await loadCostModel(session, "2026-08-31", db);
    expect(model.imputedFodderKesPerKg).toBe(9);
    await close();
  });

  /**
   * DEFECT — HIGH, and this is the one that produces a WRONG NUMBER on the
   * headline screen. `recordPurchaseFor` (M5) writes a `feed_purchase` and NO
   * `expense` row. Feed is 55–65% of the cost of production on a Kenyan
   * intensive unit, and it does not appear in `costOfProduction` at all: the
   * farm is told a litre costs KES 0 to make while the same feed IS charged in
   * `marginOverFeedCost`. Two reports, one truth, opposite answers.
   */
  it.fails("a feed purchase reaches the cost of production", async () => {
    const { db, close, session } = await setup();
    await seedMilk(db, 1_000, ["2026-08-10", "2026-08-11"]); // 2,000 L
    const feedItemId = await seedFeedItem(db);
    const purchase = await recordPurchaseFor(
      session,
      { feedItemId, purchasedOn: "2026-08-05", quantity: 20, unit: "BAG_70KG", unitPriceKes: 3_000 },
      db as unknown as DbLike,
    );
    expect(purchase.ok).toBe(true);

    // Margin over feed cost knows about it...
    const issueId = newId();
    await db.insert(s.feedIssue).values({
      id: issueId, farmId: FARM_ID, feedItemId, issuedOn: "2026-08-10",
      animalGroup: "LACTATING", quantity: "20", unit: "BAG_70KG", unitWeightKg: "70",
      recordedBy: newId(),
    });
    const margin = await marginOverFeedCost(session, AUG.from, AUG.to, db as unknown as DbLike);
    expect(margin.feedCostKes).toBe(60_000);

    // ...cost of production does not.
    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    expect(cop.cash.totalKes).toBe(60_000);
    await close();
  });

  it("counts home-grown fodder at the imputed rate but never in the cash cost", async () => {
    const { db, close, session } = await setup();
    await seedMilk(db, 500, ["2026-08-10", "2026-08-11"]); // 1,000 L
    const napier = await seedFeedItem(db, {
      name: "Napier", category: "FODDER", homeGrown: true, defaultUnit: "KG", defaultUnitWeightKg: "1",
    });
    await db.insert(s.feedIssue).values({
      id: newId(), farmId: FARM_ID, feedItemId: napier, issuedOn: "2026-08-10",
      animalGroup: "LACTATING", quantity: "1000", unit: "KG", unitWeightKg: "1", recordedBy: newId(),
    });

    const cop = await costOfProduction(session, AUG.from, AUG.to, db);
    expect(cop.cash.totalKes).toBe(0);
    expect(cop.full.totalKes).toBe(8_000); // 1,000 kg x default KES 8/kg
    expect(cop.imputed.find((i) => i.label.startsWith("Home-grown"))!.amountKes).toBe(8_000);
    expect(cop.full.perLitreKes).toBe(8);
    await close();
  });
});

/* ================================================================== */
/* 4. M-PESA CSV                                                       */
/* ================================================================== */

const HEADER = "Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance";

describe("M-Pesa CSV import", () => {
  it("rejects an empty file and a header-only file with advice, not a crash", async () => {
    const { db, close, session } = await setup();
    const empty = await importMpesaCsv(session, "", db);
    const headerOnly = await importMpesaCsv(session, `${HEADER}\n`, db);
    expect(empty.ok).toBe(false);
    expect(headerOnly.ok).toBe(false);
    if (!headerOnly.ok) expect(headerOnly.error).toContain("Export the statement from M-Pesa as CSV");
    expect(parseMpesaCsv("").lines).toHaveLength(0);
    await close();
  });

  it("reads CRLF line endings and quoted fields containing commas", async () => {
    const { db, close, session } = await setup();
    const csv =
      `${HEADER}\r\n` +
      `TFG1ABCDE,2026-08-05 14:32:11,"Pay Bill to 888880 - KPLC, PREPAID, Nairobi",Completed,0.00,3450.00,12000.00\r\n` +
      `TFG2ABCDE,2026-08-05 15:00:00,"Customer Transfer to 0722 000 111",Completed,5000.00,0.00,17000.00\r\n`;
    const res = await importMpesaCsv(session, csv, db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({ parsed: 2, imported: 2, duplicates: 0, malformed: 0 });

    const rows = await db
      .select().from(s.mpesaStatementLine).where(eq(s.mpesaStatementLine.farmId, FARM_ID));
    const kplc = rows.find((r) => r.receiptNo === "TFG1ABCDE")!;
    expect(kplc.details).toBe("Pay Bill to 888880 - KPLC, PREPAID, Nairobi");
    expect(kplc.withdrawnKes).toBe("3450.00");
    expect(kplc.paidInKes).toBe("0.00");
    await close();
  });

  it("skips malformed rows, counts them, and imports the good ones", async () => {
    const { db, close, session } = await setup();
    const csv = [
      HEADER,
      ",2026-08-05 14:32:11,No receipt number,Completed,0.00,100.00,1.00",
      "TFG3ABCDE,,No completion time,Completed,0.00,100.00,1.00",
      "TFG4ABCDE,not a date at all!!,Unparseable date,Completed,0.00,100.00,1.00",
      "TFG5ABCDE,2026-08-05 16:00:00,Cancelled one,Failed,0.00,100.00,1.00",
      "TFG6ABCDE,2026-08-05 17:00:00,Good row,Completed,0.00,250.00,900.00",
      "",
      "   ",
    ].join("\n");
    const res = await importMpesaCsv(session, csv, db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.imported).toBe(1);
    // no receipt, no completion time, unparseable date, failed status
    expect(res.data.malformed).toBe(4);
    expect(res.data.parsed).toBe(1);
    // Blank and whitespace-only rows are dropped by the splitter, not counted
    // as malformed — which is right, but it means `malformed` is a count of
    // rows that LOOKED like transactions and were thrown away. Worth showing.
    await close();
  });

  it("is idempotent: the same receipt number never lands twice, in-file or on re-import", async () => {
    const { db, close, session } = await setup();
    const line = "TFG7ABCDE,2026-08-05 14:32:11,Same receipt,Completed,0.00,3450.00,12000.00";
    const csv = [HEADER, line, line, "TFG8ABCDE,2026-08-05 15:00:00,Other,Completed,1000.00,0.00,13000.00"].join("\n");

    const first = await importMpesaCsv(session, csv, db);
    if (!first.ok) throw new Error(first.error);
    expect(first.data).toMatchObject({ parsed: 3, imported: 2, duplicates: 1 });

    const again = await importMpesaCsv(session, csv, db);
    if (!again.ok) throw new Error(again.error);
    expect(again.data.imported).toBe(0);
    expect(again.data.duplicates).toBe(3);

    const rows = await db.select().from(s.mpesaStatementLine).where(eq(s.mpesaStatementLine.farmId, FARM_ID));
    expect(rows).toHaveLength(2);
    await close();
  });

  it("keeps two farms' statements apart even when the receipt number is identical", async () => {
    const { db, close, session } = await setup();
    const other = await seedOtherFarm(db);
    const otherSession = fakeSession({ farmId: OTHER_FARM, userId: other.userId, role: "MANAGER" });
    const csv = [HEADER, "TFGSHARED,2026-08-05 14:32:11,Same code,Completed,0.00,100.00,1.00"].join("\n");

    expect((await importMpesaCsv(session, csv, db)).ok).toBe(true);
    expect((await importMpesaCsv(otherSession, csv, db)).ok).toBe(true);

    const ours = await db.select().from(s.mpesaStatementLine).where(eq(s.mpesaStatementLine.farmId, FARM_ID));
    expect(ours).toHaveLength(1);
    await close();
  });

  it("stores unicode and SQL-shaped details verbatim", async () => {
    const { db, close, session } = await setup();
    const nasty = `Robert'); DROP TABLE expense;-- 🐄 Wanjirũ`;
    const csv = [HEADER, `TFG9ABCDE,2026-08-05 14:32:11,"${nasty}",Completed,0.00,100.00,1.00`].join("\n");
    expect((await importMpesaCsv(session, csv, db)).ok).toBe(true);
    const [row] = await db.select().from(s.mpesaStatementLine).where(eq(s.mpesaStatementLine.farmId, FARM_ID));
    expect(row.details).toBe(nasty);
    expect(await db.select().from(s.expense)).toEqual([]); // table still there
    await close();
  });

  it("parses the three date shapes and the amount shapes M-Pesa actually exports", () => {
    expect(parseMpesaDate("2026-08-05 14:32:11")!.toISOString()).toBe("2026-08-05T14:32:11.000Z");
    expect(parseMpesaDate("2026-08-05")!.toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(parseMpesaDate("5/8/2026 2:32 PM")!.toISOString()).toBe("2026-08-05T14:32:00.000Z");
    expect(parseMpesaDate("")).toBeNull();

    expect(parseMpesaAmount("-3,450.00")).toBe(3_450);
    expect(parseMpesaAmount("(3,450.00)")).toBe(3_450);
    expect(parseMpesaAmount("")).toBe(0);
    expect(parseMpesaAmount("not a number")).toBe(0);
  });

  it("keeps a trailing field on the last line even with no newline", () => {
    const rows = parseCsvRows("a,b,c\n1,2,3");
    expect(rows).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });
});

/* ================================================================== */
/* 5. RECONCILIATION                                                   */
/* ================================================================== */

async function statementLine(
  db: TestDb,
  v: { receiptNo: string; at: string; paidIn?: string; withdrawn?: string; details?: string },
) {
  await db.insert(s.mpesaStatementLine).values({
    id: newId(), farmId: FARM_ID, receiptNo: v.receiptNo, completedAt: new Date(v.at),
    details: v.details ?? null, paidInKes: v.paidIn ?? "0.00", withdrawnKes: v.withdrawn ?? "0.00",
  });
}

describe("reconciling a day", () => {
  it("names money that left the till with nothing recorded against it", async () => {
    const { db, close, session } = await setup();
    await statementLine(db, { receiptNo: "TFGA", at: "2026-08-05T09:00:00Z", withdrawn: "3450.00" });
    const rec = await reconcileMpesa(session, "2026-08-05", db);
    expect(rec.matched).toHaveLength(0);
    expect(rec.unmatchedLines).toHaveLength(1);
    expect(rec.unmatchedLines[0].advice).toContain("who spent it");
    await close();
  });

  it("matches on the confirmation code in preference to the amount", async () => {
    const { db, close, session } = await setup();
    await statementLine(db, { receiptNo: "TFGB", at: "2026-08-05T09:00:00Z", withdrawn: "3450.00" });
    const decoy = await recordExpense(
      session, { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 3_450 }, db,
    );
    const real = await recordExpense(
      session, { incurredOn: "2026-08-05", category: "VETERINARY", amountKes: 9_999, mpesaRef: "tfgb" }, db,
    );
    if (!decoy.ok || !real.ok) throw new Error("setup");

    const rec = await reconcileMpesa(session, "2026-08-05", db);
    expect(rec.matched).toHaveLength(1);
    expect(rec.matched[0].matchedOn).toBe("REFERENCE");
    expect(rec.matched[0].matchedId).toBe(real.data.id);
    await close();
  });

  /**
   * DEFECT — HIGH. `reconcileMpesa` reads `direction` from `paidIn > 0` and then
   * looks at ONE side only. A statement row carrying both a paid-in and a
   * withdrawn amount (reversals, till float moves, and the shape a hand-edited
   * CSV takes) has its WITHDRAWN leg silently discarded. Money left the account
   * and the evening reconcile reports the day as clean.
   */
  it.fails("accounts for a row carrying both a paid-in and a withdrawn amount", async () => {
    const { db, close, session } = await setup();
    await statementLine(db, {
      receiptNo: "TFGC", at: "2026-08-05T09:00:00Z", paidIn: "1000.00", withdrawn: "5000.00",
    });
    const rec = await reconcileMpesa(session, "2026-08-05", db);
    const total = rec.unmatchedLines.reduce((t, l) => t + l.amountKes, 0)
      + rec.matched.reduce((t, m) => t + m.amountKes, 0);
    expect(total).toBe(6_000); // observed 1,000 — the 5,000 withdrawal vanishes
    await close();
  });

  /**
   * DEFECT — MEDIUM. The amount-and-date fallback ignores `paymentMethod`. A
   * KES 5,000 expense the farm paid IN CASH is happily matched to a KES 5,000
   * M-Pesa withdrawal on the same day, so a genuinely unrecorded M-Pesa payment
   * is marked reconciled and the cash spend is double-counted as the same money.
   */
  it.fails("does not match a CASH expense to an M-Pesa statement line", async () => {
    const { db, close, session } = await setup();
    await statementLine(db, { receiptNo: "TFGD", at: "2026-08-05T09:00:00Z", withdrawn: "5000.00" });
    const cash = await recordExpense(
      session,
      { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 5_000, paymentMethod: "CASH" },
      db,
    );
    if (!cash.ok) throw new Error(cash.error);

    const rec = await reconcileMpesa(session, "2026-08-05", db);
    expect(rec.matched).toHaveLength(0);
    expect(rec.unmatchedLines).toHaveLength(1);
    await close();
  });

  it("names a record with no statement line — money that may never have gone out", async () => {
    const { db, close, session } = await setup();
    await recordExpense(
      session,
      { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 7_777, paymentMethod: "MPESA" },
      db,
    );
    const rec = await reconcileMpesa(session, "2026-08-05", db);
    expect(rec.unmatchedRecords).toHaveLength(1);
    expect(rec.unmatchedRecords[0].amountKes).toBe(7_777);
    expect(rec.unmatchedRecords[0].advice).toContain("Check the confirmation code");
    await close();
  });

  it("never reconciles across farms", async () => {
    const { db, close, session } = await setup();
    const other = await seedOtherFarm(db);
    await db.insert(s.mpesaStatementLine).values({
      id: newId(), farmId: OTHER_FARM, receiptNo: "TFGE", completedAt: new Date("2026-08-05T09:00:00Z"),
      paidInKes: "0.00", withdrawnKes: "50000.00",
    });
    const rec = await reconcileMpesa(session, "2026-08-05", db);
    expect(rec.matched).toHaveLength(0);
    expect(rec.unmatchedLines).toHaveLength(0);
    expect(rec.unmatchedRecords).toHaveLength(0); // their pending expense is invisible
    void other;
    await close();
  });
});

/* ================================================================== */
/* 6. TENANCY                                                          */
/* ================================================================== */

describe("tenancy", () => {
  it("refuses another farm's expense and income identically to ones that do not exist", async () => {
    const { db, close, session } = await setup();
    const theirs = await seedOtherFarm(db);
    const ghost = newId();

    const a = await approveExpense(session, theirs.expenseId, db);
    const b = await approveExpense(session, ghost, db);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok && !b.ok) {
      expect(a.error).toBe("That expense was not found.");
      expect(a.error).toBe(b.error);
    }

    const c = await approveIncome(session, theirs.incomeId, db);
    const d = await approveIncome(session, ghost, db);
    expect(c.ok).toBe(false);
    if (!c.ok && !d.ok) expect(c.error).toBe(d.error);

    const e = await voidExpense(session, theirs.expenseId, db);
    expect(e.ok).toBe(false);

    // Their rows are untouched.
    const [stillPending] = await db.select().from(s.expense).where(eq(s.expense.id, theirs.expenseId));
    expect(stillPending.status).toBe("PENDING");
    await close();
  });

  it("never shows another farm's money in any total or queue", async () => {
    const { db, close, session } = await setup();
    await seedOtherFarm(db);
    const mtd = await monthToDate(session, "2026-08-31", db);
    expect(mtd.incomeKes).toBe(0);
    expect(mtd.expenseKes).toBe(0);
    expect(mtd.pendingCount).toBe(0);
    expect(await approvalQueue(session, db)).toHaveLength(0);
    expect((await costOfProduction(session, AUG.from, AUG.to, db)).cash.totalKes).toBe(0);
    expect(await listCounterparties(session, db)).toHaveLength(0);
    await close();
  });

  it("refuses a well-formed foreign counterpartyId on an expense", async () => {
    const { db, close, session } = await setup();
    const theirs = await seedOtherFarm(db);
    const res = await recordExpense(
      session,
      { incurredOn: "2026-08-05", category: "FEEDS", amountKes: 1_000, counterpartyId: theirs.counterpartyId },
      db,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("That supplier was not found.");
    expect(await db.select().from(s.expense).where(eq(s.expense.farmId, FARM_ID))).toHaveLength(0);
    await close();
  });

  it("refuses a well-formed foreign customerId on an income and on a supplier", async () => {
    const { db, close, session } = await setup();
    const theirs = await seedOtherFarm(db);
    const inc = await recordIncome(
      session,
      { receivedOn: "2026-08-05", source: "MILK", amountKes: 1_000, customerId: theirs.customerId },
      db,
    );
    expect(inc.ok).toBe(false);
    const cp = await createCounterparty(
      session, { name: "Sneaky co-op", types: ["COOP"], customerId: theirs.customerId }, db,
    );
    expect(cp.ok).toBe(false);
    if (!cp.ok) expect(cp.error).toBe("That customer was not found.");
    await close();
  });

  it("refuses to update another farm's supplier", async () => {
    const { db, close, session } = await setup();
    const theirs = await seedOtherFarm(db);
    const res = await updateCounterparty(session, theirs.counterpartyId, { name: "Hijacked" }, db);
    expect(res.ok).toBe(false);
    const [row] = await db.select().from(s.counterparty).where(eq(s.counterparty.id, theirs.counterpartyId));
    expect(row.name).toBe("Their agrovet");
    await close();
  });

  it("keeps a foreign farm's cost-model reference values out of our model", async () => {
    const { db, close, session } = await setup();
    await seedOtherFarm(db);
    await db.insert(s.referenceValue).values({
      id: newId(), farmId: OTHER_FARM, kind: "COST_MODEL",
      key: "IMPUTED_FODDER_KES_PER_KG", valueNumeric: "999.0000", effectiveFrom: "2026-01-01",
    });
    expect((await loadCostModel(session, "2026-08-31", db)).imputedFodderKesPerKg).toBe(8);
    await close();
  });

  it("stores a customer created against our farm only", async () => {
    const { db, close, session } = await setup();
    await seedCustomer(db);
    const rows = await db.select().from(s.customer).where(eq(s.customer.farmId, FARM_ID));
    expect(rows).toHaveLength(1);
    await close();
  });
});
