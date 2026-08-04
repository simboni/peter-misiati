/**
 * M9 — Money: expenses, income, suppliers, M-Pesa reconciliation.
 *
 * Two rules govern this whole module.
 *
 * 1. **Nothing counts until a manager approves it.** Every expense and every
 *    income row is born `PENDING` and is invisible to every total until
 *    `approveExpense` / `approveIncome` runs. SME theft in Kenya concentrates
 *    exactly where one person controls a whole transaction, and the documented
 *    remedy is dividing the process. So the person who records is not the person
 *    who approves, and an unapproved row cannot move a single report.
 *
 * 2. **An expense is never just a number going into a hole (R7).** Every save
 *    returns the running month-to-date position and cost per litre.
 *
 * On M-Pesa we deliberately do NOT integrate Daraja. Full integration needs
 * business registration, a Paybill or a Till upgraded to bank settlement, B2C
 * approval and an always-reachable public callback. Records plus a CSV
 * reconcile deliver most of the value at a fraction of the cost.
 */
import { createHash } from "node:crypto";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { z } from "zod";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import {
  actionError,
  RefusedError,
  actionOk,
  assertOwned,
  can,
  guard,
  NotPermittedError,
  type ActionResult,
  type Capability,
  type Session,
} from "@/lib/dal";
import { newId, refCode, REF_PREFIX } from "@/lib/ids";
import { dec, kes, money, num } from "@/lib/money";
import {
  addDays,
  daysBetween,
  endOfMonth,
  startOfMonth,
  today,
  type ISODate,
} from "@/lib/domain/dates";
import { COST_OF_PRODUCTION_KES_PER_LITRE } from "@/lib/domain/feed";

/* ------------------------------------------------------------------ */
/* Plumbing                                                            */
/* ------------------------------------------------------------------ */

/**
 * The database is resolved lazily so a test can hand in `createTestDb()` and
 * the production singleton is never constructed inside a test process.
 */
export async function resolveDb(database?: Db): Promise<Db> {
  if (database) return database;
  return (await import("@/db")).db;
}

function requireCap(session: Session, capability: Capability): void {
  if (!can(session.role, capability)) throw new NotPermittedError(capability);
}

/**
 * The loosest database handle every module here agrees on.
 *
 * `feed.ts`, `health.ts` and `breeding.ts` each hold their own alias for the
 * same Drizzle-on-PGlite handle. Typing the shared helpers against the base
 * `PgliteDatabase<typeof s>` lets all of them — and the production `Db`, which
 * extends it — call in without a cast.
 */
export type AnyDb = PgliteDatabase<typeof s>;

/* ------------------------------------------------------------------ */
/* The one place a module posts its own cost into the cash book        */
/* ------------------------------------------------------------------ */

/**
 * A UUID derived from the row the expense belongs to.
 *
 * This is what makes posting an expense from another module safe to replay:
 * the offline outbox can flush the same feed purchase, treatment or AI service
 * twice and `onConflictDoNothing` collapses the second posting instead of
 * charging the farm for it again. It also gives modules whose table has no
 * `expenseId` column a way to FIND the expense they posted.
 */
export function linkedExpenseId(sourceTable: string, sourceId: string): string {
  const h = createHash("sha256").update(`expense:${sourceTable}:${sourceId}`).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    `${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join("-");
}

/** How a cost was settled, translated into how the cash book records it. */
export function settlementToPaymentMethod(
  settledBy: "CASH" | "CREDIT" | "COOP_CHECKOFF" | null | undefined,
): s.PaymentMethod | null {
  if (!settledBy) return null;
  return settledBy;
}

export interface LinkedExpenseInput {
  /** The table the cost was captured on — `feed_purchase`, `health_event`, … */
  sourceTable: string;
  /** The row id. Together with `sourceTable` it derives the expense id. */
  sourceId: string;
  incurredOn: ISODate;
  category: s.ExpenseCategory;
  description: string;
  amountKes: number;
  counterpartyId?: string | null;
  /**
   * CASH / CREDIT / COOP_CHECKOFF, taken from the module's own
   * `costSettledBy`. A co-operative check-off never leaves the till — it is
   * netted off the milk cheque — so it is recorded as `COOP_CHECKOFF` rather
   * than as cash out. It is STILL a cost of production, and it still has to
   * appear here, because the co-op statement reconciliation in M4 matches its
   * check-off deductions against exactly these rows.
   */
  costSettledBy?: "CASH" | "CREDIT" | "COOP_CHECKOFF" | null;
}

/**
 * Post a cost that another module captured into the cash book.
 *
 * PENDING like every other expense — a herdsman recording a treatment cost has
 * recorded it, not approved it (R10). No capability check: this is an internal
 * helper reached only through an action that has already checked one.
 *
 * Returns the expense id, or null when there was no money to post.
 */
export async function postLinkedExpense(
  db: AnyDb,
  session: Session,
  input: LinkedExpenseInput,
): Promise<string | null> {
  const amount = money(input.amountKes);
  if (!(amount > 0)) return null;

  // `expense.counterpartyId` is a real foreign key, but the columns that feed
  // it are not — `feedPurchase.supplierId` is a bare uuid. An id that is not
  // this farm's supplier is dropped rather than allowed to fail the insert:
  // losing the supplier link is a blemish, losing the purchase is a bug.
  let counterpartyId: string | null = null;
  if (input.counterpartyId) {
    const [cp] = await db
      .select({ id: s.counterparty.id })
      .from(s.counterparty)
      .where(
        and(
          eq(s.counterparty.id, input.counterpartyId),
          eq(s.counterparty.farmId, session.farmId),
        ),
      );
    counterpartyId = cp?.id ?? null;
  }

  const id = linkedExpenseId(input.sourceTable, input.sourceId);
  await db
    .insert(s.expense)
    .values({
      id,
      farmId: session.farmId,
      incurredOn: input.incurredOn,
      category: input.category,
      description: input.description,
      counterpartyId,
      amountKes: dec(amount),
      paymentMethod: settlementToPaymentMethod(input.costSettledBy),
      status: "PENDING",
      recordedBy: session.userId,
    })
    .onConflictDoNothing();

  return id;
}

/* ------------------------------------------------------------------ */
/* Suppliers (counterparties)                                          */
/* ------------------------------------------------------------------ */

/**
 * Typed suppliers. The co-op appears here as a supplier (check-off inputs) AND
 * in `customer` as a buyer of milk, linked by `customerId` — which is exactly
 * how Kenyan dairy works.
 */
export const COUNTERPARTY_TYPES = s.COUNTERPARTY_TYPES;
export type CounterpartyType = s.CounterpartyType;

export const COUNTERPARTY_TYPE_LABEL: Record<CounterpartyType, string> = {
  AGROVET: "Agrovet",
  FEED_MILLER: "Feed miller",
  HAY: "Hay / fodder supplier",
  AI_PROVIDER: "AI provider",
  VET: "Vet practice",
  TRANSPORTER: "Transporter",
  TRANSPORT_HIRE: "Transport hire",
  PARAVET: "Animal health assistant",
  BROKER: "Broker",
  SACCO: "SACCO",
  COOP: "Co-operative",
  PROCESSOR: "Processor",
  LABOUR: "Labour contractor",
  OTHER: "Other",
};

const CounterpartyInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2, "Give the supplier a name."),
  types: z.array(z.enum(COUNTERPARTY_TYPES)).min(1, "Pick at least one kind of supplier."),
  providerKind: z
    .enum(["FARM_STAFF", "AI_TECH", "PARAVET", "VET", "COOP_VET", "COUNTY"])
    .optional(),
  kvbRegNo: z.string().optional(),
  phone: z.string().optional(),
  paymentTerms: z.string().optional(),
  customerId: z.string().uuid().optional(),
  creditBalanceKes: z.coerce.number().optional(),
});
export type CounterpartyInput = z.input<typeof CounterpartyInput>;

export async function createCounterparty(
  session: Session,
  input: unknown,
  database?: Db,
): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    requireCap(session, "ADMIN");
    const parsed = CounterpartyInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const db = await resolveDb(database);
    const v = parsed.data;

    // A co-op that already exists as a milk customer must belong to this farm.
    if (v.customerId) {
      const [cust] = await db
        .select()
        .from(s.customer)
        .where(and(eq(s.customer.id, v.customerId), eq(s.customer.farmId, session.farmId)));
      assertOwned(cust, session, "customer");
    }

    const id = v.id ?? newId();
    await db
      .insert(s.counterparty)
      .values({
        id,
        farmId: session.farmId,
        name: v.name,
        customerId: v.customerId ?? null,
        types: v.types,
        providerKind: v.providerKind ?? null,
        kvbRegNo: v.kvbRegNo ?? null,
        phone: v.phone ?? null,
        paymentTerms: v.paymentTerms ?? null,
        creditBalanceKes: dec(v.creditBalanceKes ?? 0),
      })
      .onConflictDoNothing();

    return actionOk({ id }, `${v.name} saved as a supplier.`);
  });
}

export async function updateCounterparty(
  session: Session,
  id: string,
  patch: Partial<CounterpartyInput>,
  database?: Db,
): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    requireCap(session, "ADMIN");
    const db = await resolveDb(database);
    const [row] = await db
      .select()
      .from(s.counterparty)
      .where(and(eq(s.counterparty.id, id), eq(s.counterparty.farmId, session.farmId)));
    assertOwned(row, session, "supplier");

    await db
      .update(s.counterparty)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.types !== undefined ? { types: patch.types as s.CounterpartyType[] } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.paymentTerms !== undefined ? { paymentTerms: patch.paymentTerms } : {}),
        ...(patch.kvbRegNo !== undefined ? { kvbRegNo: patch.kvbRegNo } : {}),
        ...(patch.creditBalanceKes !== undefined
          ? { creditBalanceKes: dec(patch.creditBalanceKes) }
          : {}),
      })
      .where(and(eq(s.counterparty.id, id), eq(s.counterparty.farmId, session.farmId)));

    return actionOk({ id }, "Supplier updated.");
  });
}

export interface SupplierRow {
  id: string;
  name: string;
  types: string[];
  phone: string | null;
  paymentTerms: string | null;
  creditBalanceKes: number;
  spendKes: number;
  lastPurchaseOn: ISODate | null;
}

/** Suppliers with their approved purchase history — who we actually pay. */
export async function listCounterparties(
  session: Session,
  database?: Db,
): Promise<SupplierRow[]> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);

  const rows = await db
    .select()
    .from(s.counterparty)
    .where(eq(s.counterparty.farmId, session.farmId));

  const spend = await db
    .select({
      counterpartyId: s.expense.counterpartyId,
      total: sql<string>`coalesce(sum(${s.expense.amountKes}), 0)`,
      last: sql<string | null>`max(${s.expense.incurredOn})`,
    })
    .from(s.expense)
    .where(and(eq(s.expense.farmId, session.farmId), eq(s.expense.status, "APPROVED")))
    .groupBy(s.expense.counterpartyId);

  const byId = new Map(spend.map((r) => [r.counterpartyId ?? "", r]));

  return rows
    .map((r) => {
      const agg = byId.get(r.id);
      return {
        id: r.id,
        name: r.name,
        types: (r.types ?? []) as string[],
        phone: r.phone,
        paymentTerms: r.paymentTerms,
        creditBalanceKes: num(r.creditBalanceKes),
        spendKes: num(agg?.total),
        lastPurchaseOn: (agg?.last as ISODate | null) ?? null,
      };
    })
    .sort((a, b) => b.spendKes - a.spendKes || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* Expenses and income                                                 */
/* ------------------------------------------------------------------ */

const ExpenseInput = z.object({
  id: z.string().uuid().optional(),
  incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-08-03."),
  category: z.enum(s.EXPENSE_CATEGORIES),
  description: z.string().optional(),
  counterpartyId: z.string().uuid().optional(),
  amountKes: z.coerce.number().min(0, "An amount cannot be negative."),
  paymentMethod: z.enum(s.PAYMENT_METHODS).optional(),
  mpesaRef: z.string().optional(),
  voucherNo: z.string().optional(),
  attachmentUrl: z.string().optional(),
});
export type ExpenseInput = z.input<typeof ExpenseInput>;

export interface EntryReceipt {
  id: string;
  refCode: string;
  status: "PENDING";
  /** R7 — the running position comes back with the entry, not next month. */
  position: MonthToDate;
}

/**
 * Record money out. ALWAYS lands `PENDING`, whoever recorded it — including the
 * manager. Approval is a separate, audited act.
 */
export async function recordExpense(
  session: Session,
  input: unknown,
  database?: Db,
): Promise<ActionResult<EntryReceipt>> {
  return guard(async () => {
    requireCap(session, "VIEW_MONEY");
    const parsed = ExpenseInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const db = await resolveDb(database);
    const v = parsed.data;

    if (v.counterpartyId) {
      const [cp] = await db
        .select()
        .from(s.counterparty)
        .where(and(eq(s.counterparty.id, v.counterpartyId), eq(s.counterparty.farmId, session.farmId)));
      assertOwned(cp, session, "supplier");
    }

    const id = v.id ?? newId();
    await db
      .insert(s.expense)
      .values({
        id,
        farmId: session.farmId,
        incurredOn: v.incurredOn,
        category: v.category,
        description: v.description ?? null,
        counterpartyId: v.counterpartyId ?? null,
        amountKes: dec(v.amountKes),
        paymentMethod: v.paymentMethod ?? null,
        mpesaRef: v.mpesaRef ?? null,
        voucherNo: v.voucherNo ?? null,
        attachmentUrl: v.attachmentUrl ?? null,
        status: "PENDING",
        recordedBy: session.userId,
      })
      .onConflictDoNothing();

    const ref = await writeReceipt(db, session, {
      kind: "EXPENSE",
      prefix: REF_PREFIX.EXPENSE,
      summary: `${kes(v.amountKes)} — ${categoryLabel(v.category)}${v.description ? `, ${v.description}` : ""}. Waiting for approval.`,
      payload: { expenseId: id },
    });

    // The position for the month the entry belongs to, so a back-dated entry
    // shows the month it actually moved rather than a truncated window.
    const position = await monthToDate(session, endOfMonth(v.incurredOn), database);
    return actionOk(
      { id, refCode: ref, status: "PENDING" as const, position },
      `${kes(v.amountKes)} recorded. It does not touch the books until a manager approves it.`,
      ref,
    );
  });
}

const IncomeInput = z.object({
  id: z.string().uuid().optional(),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-08-03."),
  source: z.enum(["MILK", "ANIMAL_SALE", "MANURE", "FODDER", "OTHER"]),
  description: z.string().optional(),
  counterpartyId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  amountKes: z.coerce.number().min(0, "An amount cannot be negative."),
  paymentMethod: z.enum(s.PAYMENT_METHODS).optional(),
  mpesaRef: z.string().optional(),
});
export type IncomeInput = z.input<typeof IncomeInput>;

export async function recordIncome(
  session: Session,
  input: unknown,
  database?: Db,
): Promise<ActionResult<EntryReceipt>> {
  return guard(async () => {
    requireCap(session, "VIEW_MONEY");
    const parsed = IncomeInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const db = await resolveDb(database);
    const v = parsed.data;

    if (v.customerId) {
      const [cust] = await db
        .select()
        .from(s.customer)
        .where(and(eq(s.customer.id, v.customerId), eq(s.customer.farmId, session.farmId)));
      assertOwned(cust, session, "customer");
    }

    const id = v.id ?? newId();
    await db
      .insert(s.income)
      .values({
        id,
        farmId: session.farmId,
        receivedOn: v.receivedOn,
        source: v.source,
        description: v.description ?? null,
        counterpartyId: v.counterpartyId ?? null,
        customerId: v.customerId ?? null,
        amountKes: dec(v.amountKes),
        paymentMethod: v.paymentMethod ?? null,
        mpesaRef: v.mpesaRef ?? null,
        status: "PENDING",
        recordedBy: session.userId,
      })
      .onConflictDoNothing();

    const ref = await writeReceipt(db, session, {
      kind: "INCOME",
      prefix: REF_PREFIX.PAYMENT,
      summary: `${kes(v.amountKes)} in — ${incomeSourceLabel(v.source)}. Waiting for approval.`,
      payload: { incomeId: id },
    });

    const position = await monthToDate(session, endOfMonth(v.receivedOn), database);
    return actionOk(
      { id, refCode: ref, status: "PENDING" as const, position },
      `${kes(v.amountKes)} recorded. It does not touch the books until a manager approves it.`,
      ref,
    );
  });
}

/** The manager's act. Only from here does a row move a report total. */
export async function approveExpense(
  session: Session,
  expenseId: string,
  database?: Db,
): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    requireCap(session, "APPROVE");
    const db = await resolveDb(database);
    const [row] = await db
      .select()
      .from(s.expense)
      .where(and(eq(s.expense.id, expenseId), eq(s.expense.farmId, session.farmId)));
    assertOwned(row, session, "expense");

    if (row.status === "APPROVED") return actionOk({ id: expenseId }, "Already approved.");
    if (row.status === "VOID") return actionError("That entry was cancelled. It cannot be approved.");

    await db
      .update(s.expense)
      .set({ status: "APPROVED", approvedBy: session.userId })
      .where(and(eq(s.expense.id, expenseId), eq(s.expense.farmId, session.farmId)));

    await audit(db, session, "expense", expenseId, { status: row.status }, { status: "APPROVED" });
    return actionOk({ id: expenseId }, `${kes(row.amountKes)} approved. It is now in the books.`);
  });
}

export async function approveIncome(
  session: Session,
  incomeId: string,
  database?: Db,
): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    requireCap(session, "APPROVE");
    const db = await resolveDb(database);
    const [row] = await db
      .select()
      .from(s.income)
      .where(and(eq(s.income.id, incomeId), eq(s.income.farmId, session.farmId)));
    assertOwned(row, session, "income entry");

    if (row.status === "APPROVED") return actionOk({ id: incomeId }, "Already approved.");
    if (row.status === "VOID") return actionError("That entry was cancelled. It cannot be approved.");

    await db
      .update(s.income)
      .set({ status: "APPROVED", approvedBy: session.userId })
      .where(and(eq(s.income.id, incomeId), eq(s.income.farmId, session.farmId)));

    await audit(db, session, "income", incomeId, { status: row.status }, { status: "APPROVED" });
    return actionOk({ id: incomeId }, `${kes(row.amountKes)} approved. It is now in the books.`);
  });
}

export async function voidExpense(
  session: Session,
  expenseId: string,
  database?: Db,
): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    requireCap(session, "APPROVE");
    const db = await resolveDb(database);
    const [row] = await db
      .select()
      .from(s.expense)
      .where(and(eq(s.expense.id, expenseId), eq(s.expense.farmId, session.farmId)));
    assertOwned(row, session, "expense");

    await db
      .update(s.expense)
      .set({ status: "VOID", approvedBy: session.userId })
      .where(and(eq(s.expense.id, expenseId), eq(s.expense.farmId, session.farmId)));

    await audit(db, session, "expense", expenseId, { status: row.status }, { status: "VOID" });
    return actionOk({ id: expenseId }, "Entry cancelled. It never entered the books.");
  });
}

export interface PendingEntry {
  kind: "EXPENSE" | "INCOME";
  id: string;
  onDate: ISODate;
  label: string;
  amountKes: number;
  recordedBy: string;
  mpesaRef: string | null;
}

/** The manager's approval queue — /money/approve. */
export async function approvalQueue(session: Session, database?: Db): Promise<PendingEntry[]> {
  requireCap(session, "APPROVE");
  const db = await resolveDb(database);

  const expenses = await db
    .select()
    .from(s.expense)
    .where(and(eq(s.expense.farmId, session.farmId), eq(s.expense.status, "PENDING")));

  const incomes = await db
    .select()
    .from(s.income)
    .where(and(eq(s.income.farmId, session.farmId), eq(s.income.status, "PENDING")));

  const out: PendingEntry[] = [
    ...expenses.map((e) => ({
      kind: "EXPENSE" as const,
      id: e.id,
      onDate: e.incurredOn as ISODate,
      label: `${categoryLabel(e.category)}${e.description ? ` — ${e.description}` : ""}`,
      amountKes: num(e.amountKes),
      recordedBy: e.recordedBy,
      mpesaRef: e.mpesaRef,
    })),
    ...incomes.map((i) => ({
      kind: "INCOME" as const,
      id: i.id,
      onDate: i.receivedOn as ISODate,
      label: `${incomeSourceLabel(i.source)}${i.description ? ` — ${i.description}` : ""}`,
      amountKes: num(i.amountKes),
      recordedBy: i.recordedBy,
      mpesaRef: i.mpesaRef,
    })),
  ];
  return out.sort((a, b) => (a.onDate < b.onDate ? -1 : a.onDate > b.onDate ? 1 : 0));
}

/* ------------------------------------------------------------------ */
/* Cost of production                                                  */
/* ------------------------------------------------------------------ */

/**
 * The imputed side of the full economic cost. Defaults are conservative and
 * every one is overridable per farm through `referenceValue` (kind
 * `COST_MODEL`), effective-dated like every other reference value.
 */
export interface CostModel {
  /** Market value of a kilogram of home-grown fodder that was fed, as fed. */
  imputedFodderKesPerKg: number;
  /** Unpaid family labour, per month. Real work, no payslip. */
  familyLabourKesPerMonth: number;
  /** Cowshed, milking equipment, chaff cutter, cooling — per month. */
  depreciationKesPerMonth: number;
  /** Herd depreciation / replacement provision, per month. */
  herdDepreciationKesPerMonth: number;
  /** Imputed land rent, per month. */
  landRentKesPerMonth: number;
}

export const DEFAULT_COST_MODEL: CostModel = {
  imputedFodderKesPerKg: 8,
  familyLabourKesPerMonth: 0,
  depreciationKesPerMonth: 0,
  herdDepreciationKesPerMonth: 0,
  landRentKesPerMonth: 0,
};

const COST_MODEL_KEYS: Record<keyof CostModel, string> = {
  imputedFodderKesPerKg: "IMPUTED_FODDER_KES_PER_KG",
  familyLabourKesPerMonth: "FAMILY_LABOUR_KES_PER_MONTH",
  depreciationKesPerMonth: "DEPRECIATION_KES_PER_MONTH",
  herdDepreciationKesPerMonth: "HERD_DEPRECIATION_KES_PER_MONTH",
  landRentKesPerMonth: "LAND_RENT_KES_PER_MONTH",
};

export async function loadCostModel(
  session: Session,
  asOf: ISODate,
  database?: Db,
  overrides: Partial<CostModel> = {},
): Promise<CostModel> {
  const db = await resolveDb(database);
  const rows = await db
    .select()
    .from(s.referenceValue)
    .where(
      and(
        eq(s.referenceValue.farmId, session.farmId),
        eq(s.referenceValue.kind, "COST_MODEL"),
        lte(s.referenceValue.effectiveFrom, asOf),
      ),
    );

  // Latest effective row wins per key — reference data is never updated in place.
  const latest = new Map<string, { from: string; value: number }>();
  for (const r of rows) {
    const prev = latest.get(r.key);
    if (!prev || r.effectiveFrom > prev.from) {
      latest.set(r.key, { from: r.effectiveFrom, value: num(r.valueNumeric) });
    }
  }

  const model = { ...DEFAULT_COST_MODEL };
  for (const field of Object.keys(COST_MODEL_KEYS) as Array<keyof CostModel>) {
    const hit = latest.get(COST_MODEL_KEYS[field]);
    if (hit) model[field] = hit.value;
  }
  return { ...model, ...overrides };
}

export interface CostVariant {
  label: string;
  totalKes: number;
  perLitreKes: number;
}

export interface CostOfProduction {
  from: ISODate;
  to: ISODate;
  days: number;
  litresProduced: number;
  /** Out of pocket. What farmers actually think about. */
  cash: CostVariant;
  /** The true figure — imputed fodder, family labour, depreciation, land. */
  full: CostVariant;
  byCategory: Array<{ category: s.ExpenseCategory; label: string; amountKes: number; pctOfCash: number }>;
  imputed: Array<{ label: string; amountKes: number }>;
  feedSharePct: number;
  benchmark: { lowKes: number; highKes: number };
  verdict: string;
  /**
   * The other side of the sum. Milk comes from `milkDisposal` (see
   * `milkRevenueBetween`), everything else from approved `income` rows.
   */
  revenue: {
    milkSoldKes: number;
    milkImputedKes: number;
    otherIncomeKes: number;
    totalKes: number;
    perLitreKes: number;
  };
  /** Full economic margin: revenue less the full cost. */
  marginKes: number;
  marginPerLitreKes: number;
}

/**
 * Cost per litre, both variants, always labelled.
 *
 * Divided by litres PRODUCED, not litres sold — milk fed to calves, drunk at
 * home or lost to spillage cost exactly as much to make.
 */
export async function costOfProduction(
  session: Session,
  from: ISODate,
  to: ISODate,
  database?: Db,
  overrides: Partial<CostModel> = {},
): Promise<CostOfProduction> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);

  // Only APPROVED rows. A pending expense cannot move this number.
  const expenses = await db
    .select()
    .from(s.expense)
    .where(
      and(
        eq(s.expense.farmId, session.farmId),
        eq(s.expense.status, "APPROVED"),
        gte(s.expense.incurredOn, from),
        lte(s.expense.incurredOn, to),
      ),
    );

  const litresProduced = await litresProducedBetween(db, session.farmId, from, to);

  // THE REVENUE SEAM. Milk is derived from `milkDisposal`; `income` carries
  // everything else. Never both for the same litre — see `milkRevenueBetween`.
  const milk = await milkRevenueBetween(db, session.farmId, from, to);
  const [otherIncomeAgg] = await db
    .select({ total: sql<string>`coalesce(sum(${s.income.amountKes}), 0)` })
    .from(s.income)
    .where(
      and(
        eq(s.income.farmId, session.farmId),
        eq(s.income.status, "APPROVED"),
        gte(s.income.receivedOn, from),
        lte(s.income.receivedOn, to),
      ),
    );
  const otherIncomeKes = num(otherIncomeAgg?.total);

  const byCategoryMap = new Map<s.ExpenseCategory, number>();
  let cashTotal = 0;
  for (const e of expenses) {
    const amount = num(e.amountKes);
    cashTotal = money(cashTotal + amount);
    byCategoryMap.set(e.category, money((byCategoryMap.get(e.category) ?? 0) + amount));
  }

  const days = daysBetween(from, to) + 1;
  const months = days / 30.4375;
  const model = await loadCostModel(session, to, database, overrides);

  // Home-grown fodder was never bought, so it never hit an expense row — but it
  // occupied land and labour, and it is the single biggest imputed cost.
  const homeGrownKg = await homeGrownFeedKgBetween(db, session.farmId, from, to);
  const imputedFodderKes = money(homeGrownKg * model.imputedFodderKesPerKg);
  const familyLabourKes = money(model.familyLabourKesPerMonth * months);
  const depreciationKes = money(model.depreciationKesPerMonth * months);
  const herdDepreciationKes = money(model.herdDepreciationKesPerMonth * months);
  const landRentKes = money(model.landRentKesPerMonth * months);

  const imputed = [
    { label: "Home-grown fodder fed", amountKes: imputedFodderKes },
    { label: "Family labour", amountKes: familyLabourKes },
    { label: "Depreciation — shed and equipment", amountKes: depreciationKes },
    { label: "Herd replacement provision", amountKes: herdDepreciationKes },
    { label: "Land", amountKes: landRentKes },
  ].filter((r) => r.amountKes > 0);

  const imputedTotal = money(imputed.reduce((t, r) => t + r.amountKes, 0));
  const fullTotal = money(cashTotal + imputedTotal);

  const perLitre = (total: number) => (litresProduced > 0 ? money(total / litresProduced) : 0);

  const feedKes = byCategoryMap.get("FEEDS") ?? 0;
  const feedSharePct =
    fullTotal > 0 ? money(((feedKes + imputedFodderKes) / fullTotal) * 100) : 0;

  const byCategory = [...byCategoryMap.entries()]
    .map(([category, amountKes]) => ({
      category,
      label: categoryLabel(category),
      amountKes,
      pctOfCash: cashTotal > 0 ? money((amountKes / cashTotal) * 100) : 0,
    }))
    .sort((a, b) => b.amountKes - a.amountKes);

  const revenueTotal = money(milk.totalKes + otherIncomeKes);

  return {
    from,
    to,
    days,
    litresProduced,
    cash: { label: "Cash cost per litre (out of pocket)", totalKes: cashTotal, perLitreKes: perLitre(cashTotal) },
    full: {
      label: "Full economic cost per litre (including own fodder, family labour, depreciation)",
      totalKes: fullTotal,
      perLitreKes: perLitre(fullTotal),
    },
    byCategory,
    imputed,
    feedSharePct,
    benchmark: {
      lowKes: COST_OF_PRODUCTION_KES_PER_LITRE.low,
      highKes: COST_OF_PRODUCTION_KES_PER_LITRE.high,
    },
    verdict: costVerdict(litresProduced, perLitre(fullTotal)),
    revenue: {
      milkSoldKes: milk.soldKes,
      milkImputedKes: milk.imputedKes,
      otherIncomeKes,
      totalKes: revenueTotal,
      perLitreKes: perLitre(revenueTotal),
    },
    marginKes: money(revenueTotal - fullTotal),
    marginPerLitreKes: money(perLitre(revenueTotal) - perLitre(fullTotal)),
  };
}

function costVerdict(litresProduced: number, fullPerLitre: number): string {
  if (litresProduced <= 0) {
    return "No milk was recorded for this period, so there is no cost per litre to report yet.";
  }
  const { low, high } = COST_OF_PRODUCTION_KES_PER_LITRE;
  if (fullPerLitre > high) {
    return `Every litre costs you ${kes(fullPerLitre, 2)} to produce. The Kenya Dairy Board benchmark is KES ${low}–${high}. Feed and yield per cow are where this is won.`;
  }
  if (fullPerLitre < low) {
    return `Every litre costs you ${kes(fullPerLitre, 2)} — below the KES ${low}–${high} benchmark. Check that every cost for the period has been recorded and approved before trusting it.`;
  }
  return `Every litre costs you ${kes(fullPerLitre, 2)} to produce, inside the KES ${low}–${high} benchmark.`;
}

/* ------------------------------------------------------------------ */
/* Month to date — the number that comes back with every entry (R7)    */
/* ------------------------------------------------------------------ */

export interface MonthToDate {
  from: ISODate;
  to: ISODate;
  /** milkSoldKes + milkImputedKes + otherIncomeKes. */
  incomeKes: number;
  /** Milk sold through a paying channel — from `milkDisposal`, not `income`. */
  milkSoldKes: number;
  /** Home use, calves and staff ration, valued but never paid. */
  milkImputedKes: number;
  /** Approved `income` rows: animal sales, manure, fodder, other. */
  otherIncomeKes: number;
  expenseKes: number;
  netKes: number;
  litresProduced: number;
  cashCostPerLitreKes: number;
  pendingCount: number;
  pendingKes: number;
  headline: string;
}

export async function monthToDate(
  session: Session,
  asOf?: ISODate,
  database?: Db,
): Promise<MonthToDate> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);
  const to = asOf ?? today();
  const from = startOfMonth(to);

  const [incomeAgg] = await db
    .select({ total: sql<string>`coalesce(sum(${s.income.amountKes}), 0)` })
    .from(s.income)
    .where(
      and(
        eq(s.income.farmId, session.farmId),
        eq(s.income.status, "APPROVED"),
        gte(s.income.receivedOn, from),
        lte(s.income.receivedOn, to),
      ),
    );

  const [expenseAgg] = await db
    .select({ total: sql<string>`coalesce(sum(${s.expense.amountKes}), 0)` })
    .from(s.expense)
    .where(
      and(
        eq(s.expense.farmId, session.farmId),
        eq(s.expense.status, "APPROVED"),
        gte(s.expense.incurredOn, from),
        lte(s.expense.incurredOn, to),
      ),
    );

  const [pendingExp] = await db
    .select({
      n: sql<string>`count(*)`,
      total: sql<string>`coalesce(sum(${s.expense.amountKes}), 0)`,
    })
    .from(s.expense)
    .where(
      and(
        eq(s.expense.farmId, session.farmId),
        eq(s.expense.status, "PENDING"),
        gte(s.expense.incurredOn, from),
        lte(s.expense.incurredOn, to),
      ),
    );

  const [pendingInc] = await db
    .select({
      n: sql<string>`count(*)`,
      total: sql<string>`coalesce(sum(${s.income.amountKes}), 0)`,
    })
    .from(s.income)
    .where(
      and(
        eq(s.income.farmId, session.farmId),
        eq(s.income.status, "PENDING"),
        gte(s.income.receivedOn, from),
        lte(s.income.receivedOn, to),
      ),
    );

  // THE REVENUE SEAM. `income` no longer carries milk — the build agents left
  // this at zero and it is why the month looked like a loss on every farm that
  // sells through the co-op. Milk revenue is DERIVED from `milkDisposal`;
  // `income` supplies animal sales, manure and fodder. Adding milk income rows
  // as well would double-count every shilling. See `milkRevenueBetween`.
  const milk = await milkRevenueBetween(db, session.farmId, from, to);
  const otherIncomeKes = num(incomeAgg?.total);
  const incomeKes = money(otherIncomeKes + milk.totalKes);
  const expenseKes = num(expenseAgg?.total);
  const netKes = money(incomeKes - expenseKes);
  const litresProduced = await litresProducedBetween(db, session.farmId, from, to);
  const cashCostPerLitreKes = litresProduced > 0 ? money(expenseKes / litresProduced) : 0;
  const pendingCount = Number(pendingExp?.n ?? 0) + Number(pendingInc?.n ?? 0);
  const pendingKes = money(num(pendingExp?.total) + num(pendingInc?.total));

  const parts: string[] = [];
  parts.push(
    `${kes(incomeKes)} in, ${kes(expenseKes)} out this month — ${netKes >= 0 ? "ahead by" : "behind by"} ${kes(Math.abs(netKes))}.`,
  );
  if (litresProduced > 0) {
    parts.push(`${Math.round(litresProduced)} L produced, ${kes(cashCostPerLitreKes, 2)} of cash cost per litre.`);
  }
  if (milk.imputedKes > 0) {
    parts.push(
      `${kes(milk.imputedKes)} of that is milk you did not sell — ${Math.round(milk.imputedLitres)} L to the house, the calves and the staff, counted at what it would have fetched.`,
    );
  }
  if (pendingCount > 0) {
    parts.push(
      `${pendingCount} ${pendingCount === 1 ? "entry is" : "entries are"} waiting for approval (${kes(pendingKes)}) and ${pendingCount === 1 ? "is" : "are"} not counted above.`,
    );
  }

  return {
    from,
    to,
    incomeKes,
    milkSoldKes: milk.soldKes,
    milkImputedKes: milk.imputedKes,
    otherIncomeKes,
    expenseKes,
    netKes,
    litresProduced,
    cashCostPerLitreKes,
    pendingCount,
    pendingKes,
    headline: parts.join(" "),
  };
}

/* ------------------------------------------------------------------ */
/* M-Pesa: CSV import and reconcile                                    */
/* ------------------------------------------------------------------ */

export interface ParsedMpesaLine {
  receiptNo: string;
  completedAt: Date;
  details: string | null;
  paidInKes: number;
  withdrawnKes: number;
  balanceKes: number | null;
}

/** Minimal RFC4180 splitter — M-Pesa exports quote the Details column. */
export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const c = csvText[i];
    if (inQuotes) {
      if (c === '"') {
        if (csvText[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && csvText[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "-3,450.00", "(3,450.00)", "" → a positive magnitude. */
export function parseMpesaAmount(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[",\s]/g, "").replace(/[()]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.abs(money(n)) : 0;
}

/** M-Pesa exports have used at least three date shapes. Accept all of them. */
export function parseMpesaDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const v = raw.trim().replace(/"/g, "");
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    return new Date(
      Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0),
    );
  }
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));

  // dd/mm/yyyy — the shape the Safaricom portal exports.
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (m) {
    let hour = m[4] ? +m[4] : 0;
    const meridiem = m[7]?.toUpperCase();
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], hour, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0));
  }
  const fallback = new Date(v);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** Pure parse — no database, so it is testable and reusable on the client. */
export function parseMpesaCsv(csvText: string): { lines: ParsedMpesaLine[]; skipped: number } {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) return { lines: [], skipped: 0 };

  // The statement has a preamble above the real header on some exports, so we
  // look for the row that actually contains a receipt column.
  let headerIndex = rows.findIndex((r) => r.some((c) => normaliseHeader(c) === "receiptno"));
  if (headerIndex < 0) headerIndex = 0;

  const header = rows[headerIndex].map(normaliseHeader);
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };

  const iReceipt = col("receiptno", "receipt", "transactionid", "reference");
  const iTime = col("completiontime", "completedat", "date", "time", "transactiondate");
  const iDetails = col("details", "description", "narrative");
  const iPaidIn = col("paidin", "paid_in", "credit", "in");
  const iWithdrawn = col("withdrawn", "debit", "out");
  const iBalance = col("balance");
  const iStatus = col("transactionstatus", "status");

  const lines: ParsedMpesaLine[] = [];
  let skipped = 0;

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const cells = rows[r];
    const receiptNo = (cells[iReceipt] ?? "").trim().replace(/"/g, "");
    const completedAt = parseMpesaDate(cells[iTime]);
    if (!receiptNo || !completedAt) {
      skipped++;
      continue;
    }
    if (iStatus >= 0 && /failed|cancel/i.test(cells[iStatus] ?? "")) {
      skipped++;
      continue;
    }
    lines.push({
      receiptNo,
      completedAt,
      details: (cells[iDetails] ?? "").trim() || null,
      paidInKes: parseMpesaAmount(cells[iPaidIn]),
      withdrawnKes: parseMpesaAmount(cells[iWithdrawn]),
      balanceKes: iBalance >= 0 && (cells[iBalance] ?? "").trim() !== "" ? parseMpesaAmount(cells[iBalance]) : null,
    });
  }
  return { lines, skipped };
}

export interface MpesaImportResult {
  parsed: number;
  imported: number;
  duplicates: number;
  malformed: number;
}

/**
 * Import an M-Pesa statement export. Idempotent on receipt number: re-importing
 * the same statement — or an overlapping one — adds nothing.
 */
export async function importMpesaCsv(
  session: Session,
  csvText: string,
  database?: Db,
): Promise<ActionResult<MpesaImportResult>> {
  return guard(async () => {
    requireCap(session, "MANAGE_MONEY");
    const db = await resolveDb(database);
    const { lines, skipped } = parseMpesaCsv(csvText);

    if (lines.length === 0) {
      return actionError(
        "No transactions were found in that file. Export the statement from M-Pesa as CSV and try again.",
      );
    }

    const receipts = lines.map((l) => l.receiptNo);
    const existing = await db
      .select({ receiptNo: s.mpesaStatementLine.receiptNo })
      .from(s.mpesaStatementLine)
      .where(
        and(
          eq(s.mpesaStatementLine.farmId, session.farmId),
          inArray(s.mpesaStatementLine.receiptNo, receipts),
        ),
      );
    const already = new Set(existing.map((r) => r.receiptNo));

    // De-duplicate inside the file too — one statement can list a receipt twice.
    const seen = new Set<string>();
    const fresh = lines.filter((l) => {
      if (already.has(l.receiptNo) || seen.has(l.receiptNo)) return false;
      seen.add(l.receiptNo);
      return true;
    });

    if (fresh.length > 0) {
      await db
        .insert(s.mpesaStatementLine)
        .values(
          fresh.map((l) => ({
            id: newId(),
            farmId: session.farmId,
            receiptNo: l.receiptNo,
            completedAt: l.completedAt,
            details: l.details,
            paidInKes: dec(l.paidInKes),
            withdrawnKes: dec(l.withdrawnKes),
            balanceKes: l.balanceKes === null ? null : dec(l.balanceKes),
          })),
        )
        .onConflictDoNothing();
    }

    const duplicates = lines.length - fresh.length;
    return actionOk(
      { parsed: lines.length, imported: fresh.length, duplicates, malformed: skipped },
      `${fresh.length} new ${fresh.length === 1 ? "transaction" : "transactions"} imported${duplicates > 0 ? `, ${duplicates} already on file` : ""}.`,
    );
  });
}

export interface MpesaMatch {
  receiptNo: string;
  completedAt: Date;
  details: string | null;
  amountKes: number;
  direction: "IN" | "OUT";
  matchedKind: "EXPENSE" | "INCOME";
  matchedId: string;
  matchedOn: "REFERENCE" | "AMOUNT_AND_DATE";
  recordLabel: string;
}

export interface MpesaUnmatchedLine {
  receiptNo: string;
  completedAt: Date;
  details: string | null;
  amountKes: number;
  direction: "IN" | "OUT";
  advice: string;
}

export interface MpesaUnmatchedRecord {
  kind: "EXPENSE" | "INCOME";
  id: string;
  onDate: ISODate;
  label: string;
  amountKes: number;
  advice: string;
}

export interface MpesaReconciliation {
  date: ISODate;
  matched: MpesaMatch[];
  unmatchedLines: MpesaUnmatchedLine[];
  unmatchedRecords: MpesaUnmatchedRecord[];
  summary: string;
}

/** How far either side of the statement date we will look for a record. */
export const RECONCILE_WINDOW_DAYS = 2;

/**
 * Match a day's statement lines against what the farm recorded — and surface
 * what did not match IN BOTH DIRECTIONS. A line with no record is money that
 * moved and nobody wrote down; a record with no line is a payment that may
 * never have gone out. Both are findings.
 */
export async function reconcileMpesa(
  session: Session,
  date: ISODate,
  database?: Db,
): Promise<MpesaReconciliation> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);
  const windowFrom = addDays(date, -RECONCILE_WINDOW_DAYS);
  const windowTo = addDays(date, RECONCILE_WINDOW_DAYS);

  const lines = await db
    .select()
    .from(s.mpesaStatementLine)
    .where(
      and(
        eq(s.mpesaStatementLine.farmId, session.farmId),
        gte(s.mpesaStatementLine.completedAt, dayStart),
        lte(s.mpesaStatementLine.completedAt, dayEnd),
      ),
    );

  const expenses = (
    await db
      .select()
      .from(s.expense)
      .where(
        and(
          eq(s.expense.farmId, session.farmId),
          gte(s.expense.incurredOn, windowFrom),
          lte(s.expense.incurredOn, windowTo),
        ),
      )
  ).filter((e) => e.status !== "VOID");

  const incomes = (
    await db
      .select()
      .from(s.income)
      .where(
        and(
          eq(s.income.farmId, session.farmId),
          gte(s.income.receivedOn, windowFrom),
          lte(s.income.receivedOn, windowTo),
        ),
      )
  ).filter((i) => i.status !== "VOID");

  const usedExpense = new Set<string>();
  const usedIncome = new Set<string>();
  const matched: MpesaMatch[] = [];
  const unmatchedLines: MpesaUnmatchedLine[] = [];

  const sameRef = (a: string | null, b: string) =>
    !!a && a.trim().toUpperCase() === b.trim().toUpperCase();

  for (const line of lines) {
    const paidIn = num(line.paidInKes);
    const withdrawn = num(line.withdrawnKes);
    const direction: "IN" | "OUT" = paidIn > 0 ? "IN" : "OUT";
    const amountKes = direction === "IN" ? paidIn : withdrawn;

    if (direction === "OUT") {
      // The confirmation code is the strongest signal we have.
      let hit = expenses.find((e) => !usedExpense.has(e.id) && sameRef(e.mpesaRef, line.receiptNo));
      let how: MpesaMatch["matchedOn"] = "REFERENCE";
      if (!hit) {
        const candidates = expenses
          .filter((e) => !usedExpense.has(e.id) && money(num(e.amountKes)) === money(amountKes))
          .sort(
            (a, b) =>
              Math.abs(daysBetween(date, a.incurredOn as ISODate)) -
              Math.abs(daysBetween(date, b.incurredOn as ISODate)),
          );
        hit = candidates[0];
        how = "AMOUNT_AND_DATE";
      }
      if (hit) {
        usedExpense.add(hit.id);
        matched.push({
          receiptNo: line.receiptNo,
          completedAt: line.completedAt,
          details: line.details,
          amountKes,
          direction,
          matchedKind: "EXPENSE",
          matchedId: hit.id,
          matchedOn: how,
          recordLabel: `${categoryLabel(hit.category)}${hit.description ? ` — ${hit.description}` : ""}`,
        });
        await db
          .update(s.mpesaStatementLine)
          .set({ matchedExpenseId: hit.id })
          .where(
            and(
              eq(s.mpesaStatementLine.farmId, session.farmId),
              eq(s.mpesaStatementLine.id, line.id),
            ),
          );
        continue;
      }
      unmatchedLines.push({
        receiptNo: line.receiptNo,
        completedAt: line.completedAt,
        details: line.details,
        amountKes,
        direction,
        advice: `${kes(amountKes)} left the till and nothing was recorded for it. Add the expense, or find out who spent it.`,
      });
      continue;
    }

    let hit = incomes.find((i) => !usedIncome.has(i.id) && sameRef(i.mpesaRef, line.receiptNo));
    let how: MpesaMatch["matchedOn"] = "REFERENCE";
    if (!hit) {
      const candidates = incomes
        .filter((i) => !usedIncome.has(i.id) && money(num(i.amountKes)) === money(amountKes))
        .sort(
          (a, b) =>
            Math.abs(daysBetween(date, a.receivedOn as ISODate)) -
            Math.abs(daysBetween(date, b.receivedOn as ISODate)),
        );
      hit = candidates[0];
      how = "AMOUNT_AND_DATE";
    }
    if (hit) {
      usedIncome.add(hit.id);
      matched.push({
        receiptNo: line.receiptNo,
        completedAt: line.completedAt,
        details: line.details,
        amountKes,
        direction,
        matchedKind: "INCOME",
        matchedId: hit.id,
        matchedOn: how,
        recordLabel: `${incomeSourceLabel(hit.source)}${hit.description ? ` — ${hit.description}` : ""}`,
      });
      await db
        .update(s.mpesaStatementLine)
        .set({ matchedIncomeId: hit.id })
        .where(
          and(eq(s.mpesaStatementLine.farmId, session.farmId), eq(s.mpesaStatementLine.id, line.id)),
        );
      continue;
    }
    unmatchedLines.push({
      receiptNo: line.receiptNo,
      completedAt: line.completedAt,
      details: line.details,
      amountKes,
      direction,
      advice: `${kes(amountKes)} came in and nothing was recorded for it. Record the sale or payment it belongs to.`,
    });
  }

  // The other direction: what we wrote down that the statement does not show.
  const unmatchedRecords: MpesaUnmatchedRecord[] = [
    ...expenses
      .filter((e) => !usedExpense.has(e.id) && e.paymentMethod === "MPESA" && e.incurredOn === date)
      .map((e) => ({
        kind: "EXPENSE" as const,
        id: e.id,
        onDate: e.incurredOn as ISODate,
        label: `${categoryLabel(e.category)}${e.description ? ` — ${e.description}` : ""}`,
        amountKes: num(e.amountKes),
        advice: "Recorded as paid by M-Pesa but no matching statement line. Check the confirmation code.",
      })),
    ...incomes
      .filter((i) => !usedIncome.has(i.id) && i.paymentMethod === "MPESA" && i.receivedOn === date)
      .map((i) => ({
        kind: "INCOME" as const,
        id: i.id,
        onDate: i.receivedOn as ISODate,
        label: `${incomeSourceLabel(i.source)}${i.description ? ` — ${i.description}` : ""}`,
        amountKes: num(i.amountKes),
        advice: "Recorded as received by M-Pesa but no matching statement line. The money may not have arrived.",
      })),
  ];

  const summary =
    unmatchedLines.length === 0 && unmatchedRecords.length === 0
      ? lines.length === 0
        ? `No M-Pesa transactions on file for ${date}. Import the statement to reconcile.`
        : `All ${lines.length} M-Pesa ${lines.length === 1 ? "transaction" : "transactions"} for ${date} match what was recorded.`
      : `${matched.length} of ${lines.length} matched. ${unmatchedLines.length} ${unmatchedLines.length === 1 ? "transaction has" : "transactions have"} no record, and ${unmatchedRecords.length} ${unmatchedRecords.length === 1 ? "record has" : "records have"} no transaction.`;

  return { date, matched, unmatchedLines, unmatchedRecords, summary };
}

/* ------------------------------------------------------------------ */
/* Shared internals — also used by trading.ts and people.ts            */
/* ------------------------------------------------------------------ */

export const EXPENSE_CATEGORY_LABEL: Record<s.ExpenseCategory, string> = {
  FEEDS: "Feeds and fodder",
  LABOUR: "Labour",
  VETERINARY: "Veterinary and health",
  BREEDING: "Breeding",
  MILK_MARKETING: "Milk marketing",
  UTILITIES: "Utilities",
  MACHINERY: "Machinery",
  COOLING: "Cooling",
  RENT: "Rent",
  LOAN: "Loan repayment",
  INSURANCE: "Insurance",
  BEDDING: "Bedding and housing",
  LICENCES: "Licences and compliance",
  MANURE: "Manure handling",
  TRANSPORT: "Transport",
  LIVESTOCK: "Livestock purchases",
  OTHER: "Other",
};

export function categoryLabel(c: s.ExpenseCategory | string): string {
  return EXPENSE_CATEGORY_LABEL[c as s.ExpenseCategory] ?? String(c);
}

export const INCOME_SOURCE_LABEL: Record<string, string> = {
  MILK: "Milk",
  ANIMAL_SALE: "Animal sale",
  MANURE: "Manure",
  FODDER: "Fodder",
  OTHER: "Other",
};

export function incomeSourceLabel(src: string): string {
  return INCOME_SOURCE_LABEL[src] ?? src;
}

/* ------------------------------------------------------------------ */
/* MILK REVENUE — derived, never posted                                */
/* ------------------------------------------------------------------ */

export interface MilkRevenue {
  /** Litres that left through a paying channel, and what they fetched. */
  soldLitres: number;
  soldKes: number;
  /** Home use, calves and the staff ration, valued at the imputed rate. */
  imputedLitres: number;
  imputedKes: number;
  /** Spillage, spoilage, rejections, withheld milk. Valued, but never revenue. */
  lostLitres: number;
  /** soldKes + imputedKes — the figure every revenue report uses. */
  totalKes: number;
}

/**
 * ══════════════════════════════════════════════════════════════════════
 *  MILK REVENUE IS DERIVED FROM `milkDisposal`. IT IS NEVER AN `income`
 *  ROW. DO NOT "FIX" THIS BY POSTING INCOME AS WELL.
 *
 *  `milkDisposal` already carries `valueKes` and is the anchor of the
 *  daily produced-vs-disposed reconciliation — every litre milked is
 *  accounted for there exactly once, whether it was sold, drunk, fed to
 *  a calf or spilled. Posting an `income` row for the same litres would
 *  create a second source of truth and double-count every shilling of
 *  milk money on every report that reads both.
 *
 *  So: `income` is for NON-MILK revenue only — animal sales (written by
 *  `recordSale` in M7), manure, fodder, other. No code path in this
 *  system writes `income.source = "MILK"`; if you ever find one, that is
 *  the bug, not this function.
 *
 *  Imputed channels are included on purpose. Home consumption, calf
 *  feeding and the staff ration bring in no cash, but they cost exactly
 *  as much to produce as a litre that was sold. Counting only the sold
 *  litres against every litre produced understates the return of every
 *  farm that drinks its own milk — which is all of them.
 *
 *  Loss channels are excluded from revenue and reported separately: a
 *  spilled litre is not income, and pretending otherwise hides the very
 *  number the loss coding exists to surface.
 * ══════════════════════════════════════════════════════════════════════
 */
export async function milkRevenueBetween(
  db: AnyDb,
  farmId: string,
  from: ISODate,
  to: ISODate,
): Promise<MilkRevenue> {
  const rows = await db
    .select({
      channel: s.milkDisposal.channel,
      litres: s.milkDisposal.litres,
      valueKes: s.milkDisposal.valueKes,
      rateKesPerLitre: s.milkDisposal.rateKesPerLitre,
    })
    .from(s.milkDisposal)
    .where(
      and(
        eq(s.milkDisposal.farmId, farmId),
        gte(s.milkDisposal.disposedOn, from),
        lte(s.milkDisposal.disposedOn, to),
      ),
    );

  const revenue = new Set<string>(s.REVENUE_CHANNELS);
  const loss = new Set<string>(s.LOSS_CHANNELS);

  let soldLitres = 0;
  let soldKes = 0;
  let imputedLitres = 0;
  let imputedKes = 0;
  let lostLitres = 0;

  for (const r of rows) {
    const litres = num(r.litres);
    // valueKes is written at disposal time; the rate is the fallback for rows
    // imported or corrected without it.
    const value = r.valueKes != null ? num(r.valueKes) : litres * num(r.rateKesPerLitre);
    if (revenue.has(r.channel)) {
      soldLitres += litres;
      soldKes += value;
    } else if (loss.has(r.channel)) {
      lostLitres += litres;
    } else {
      imputedLitres += litres;
      imputedKes += value;
    }
  }

  return {
    soldLitres: money(soldLitres),
    soldKes: money(soldKes),
    imputedLitres: money(imputedLitres),
    imputedKes: money(imputedKes),
    lostLitres: money(lostLitres),
    totalKes: money(soldKes + imputedKes),
  };
}

/** Litres PRODUCED, superseded corrections removed. */
export async function litresProducedBetween(
  db: Db,
  farmId: string,
  from: ISODate,
  to: ISODate,
): Promise<number> {
  const rows = await db
    .select({
      id: s.milkRecord.id,
      litres: s.milkRecord.litres,
      supersedesId: s.milkRecord.supersedesId,
    })
    .from(s.milkRecord)
    .where(
      and(
        eq(s.milkRecord.farmId, farmId),
        gte(s.milkRecord.recordedOn, from),
        lte(s.milkRecord.recordedOn, to),
      ),
    );

  const superseded = new Set(rows.map((r) => r.supersedesId).filter(Boolean) as string[]);
  return money(
    rows.filter((r) => !superseded.has(r.id)).reduce((t, r) => t + num(r.litres), 0),
  );
}

async function homeGrownFeedKgBetween(
  db: Db,
  farmId: string,
  from: ISODate,
  to: ISODate,
): Promise<number> {
  const rows = await db
    .select({
      quantity: s.feedIssue.quantity,
      unitWeightKg: s.feedIssue.unitWeightKg,
      homeGrown: s.feedItem.homeGrown,
    })
    .from(s.feedIssue)
    .innerJoin(s.feedItem, eq(s.feedItem.id, s.feedIssue.feedItemId))
    .where(
      and(
        eq(s.feedIssue.farmId, farmId),
        gte(s.feedIssue.issuedOn, from),
        lte(s.feedIssue.issuedOn, to),
        eq(s.feedItem.homeGrown, true),
      ),
    );

  return money(rows.reduce((t, r) => t + num(r.quantity) * num(r.unitWeightKg), 0));
}

/** Every save produces a persistent, re-viewable receipt (R6). */
export async function writeReceipt(
  db: Db,
  session: Session,
  opts: { kind: string; prefix: string; summary: string; payload?: unknown },
): Promise<string> {
  // Re-roll on the (vanishingly unlikely) collision rather than lose the write.
  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = refCode(opts.prefix);
    const inserted = await db
      .insert(s.receipt)
      .values({
        id: newId(),
        farmId: session.farmId,
        refCode: ref,
        kind: opts.kind,
        summary: opts.summary,
        actorId: session.userId,
        at: new Date(),
        payload: (opts.payload ?? null) as never,
      })
      .onConflictDoNothing()
      .returning({ id: s.receipt.id });
    if (inserted.length > 0) return ref;
  }
  throw new RefusedError("Could not create a reference code. Try again.");
}

export async function audit(
  db: Db,
  session: Session,
  tableName: string,
  rowId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await db
    .insert(s.auditEntry)
    .values({
      id: newId(),
      farmId: session.farmId,
      tableName,
      rowId,
      action: "APPROVE",
      actorId: session.userId,
      at: new Date(),
      before: (before ?? null) as never,
      after: (after ?? null) as never,
    })
    .onConflictDoNothing();
}

/* ------------------------------------------------------------------ */
/* Form entry points — untrusted, so the session comes from the cookie */
/* ------------------------------------------------------------------ */

function formValues(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out;
}

export async function recordExpenseAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<EntryReceipt>> {
  "use server";
  const { verifySession } = await import("@/lib/dal");
  const { updateTag } = await import("next/cache");
  const session = await verifySession();
  const result = await recordExpense(session, formValues(formData));
  if (result.ok) updateTag(`money:${session.farmId}`);
  return result;
}

export async function recordIncomeAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<EntryReceipt>> {
  "use server";
  const { verifySession } = await import("@/lib/dal");
  const { updateTag } = await import("next/cache");
  const session = await verifySession();
  const result = await recordIncome(session, formValues(formData));
  if (result.ok) updateTag(`money:${session.farmId}`);
  return result;
}

export async function createCounterpartyAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  "use server";
  const { verifySession } = await import("@/lib/dal");
  const { updateTag } = await import("next/cache");
  const session = await verifySession();
  const raw = formValues(formData);
  const types = formData.getAll("types").filter((t) => typeof t === "string");
  const result = await createCounterparty(session, { ...raw, types });
  if (result.ok) updateTag(`money:${session.farmId}`);
  return result;
}

export async function approveEntryAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  "use server";
  const { verifySession } = await import("@/lib/dal");
  const { updateTag } = await import("next/cache");
  const session = await verifySession();
  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const decision = String(formData.get("decision") ?? "APPROVE");

  const result =
    decision === "VOID"
      ? await voidExpense(session, id)
      : kind === "INCOME"
        ? await approveIncome(session, id)
        : await approveExpense(session, id);
  if (result.ok) updateTag(`money:${session.farmId}`);
  return result;
}

export async function importMpesaCsvAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<MpesaImportResult>> {
  "use server";
  const { verifySession } = await import("@/lib/dal");
  const { updateTag } = await import("next/cache");
  const session = await verifySession();

  const file = formData.get("statement");
  let csvText = String(formData.get("csvText") ?? "");
  if (file && typeof file === "object" && "text" in file) {
    csvText = await (file as File).text();
  }
  if (!csvText.trim()) {
    return actionError("Choose the M-Pesa statement file, or paste the rows in.");
  }
  const result = await importMpesaCsv(session, csvText);
  if (result.ok) updateTag(`money:${session.farmId}`);
  return result;
}
