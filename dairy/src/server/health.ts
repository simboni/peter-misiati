import "server-only";

/**
 * M6 — Health & Veterinary, and the withdrawal engine.
 *
 * This is the one module in the system that blocks rather than warns. Everywhere
 * else an implausible value saves, flagged (R4). Here, milk from a treated cow
 * is stopped, because 15–19% of Kenyan milk samples test positive for antibiotic
 * residues and one farmer's residual milk can get a whole chilling-plant load
 * rejected — a cost co-operatives pass straight back to the member.
 *
 * The number that does the blocking comes from the PRODUCT's own label, never
 * from a hard-coded drug table: no Kenyan national withdrawal table exists, and
 * the legally operative figure is the one printed on the PCPB-approved label.
 * `product.labelSource` is the provenance, and the provenance is the defence.
 *
 * Conventions match `src/server/feed.ts`: every write has a
 * `*For(session, input, db?)` core plus a thin Server Action wrapper, and the
 * actions carry an inline `"use server"` so the session-taking query helpers
 * below are not exposed as RPC endpoints.
 */

import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { updateTag } from "next/cache";
import { z } from "zod";
import * as s from "@/db/schema";
import {
  actionError,
  actionOk,
  assertOwned,
  guard,
  requireCapability,
  type ActionResult,
  type Session,
} from "@/lib/dal";
import { REF_PREFIX, newId, refCode } from "@/lib/ids";
import { dec, num } from "@/lib/money";
import { addDays, ageDays, fromDate, today, type ISODate } from "@/lib/domain/dates";
import { deriveClass, isMilking, type AnimalFacts } from "@/lib/domain/animal";
import { breedingCalendar } from "@/lib/domain/breeding";
import {
  KENYA_ROUTINES,
  checkRoutineEligibility,
  computeWithdrawal,
  dryCowTherapyClearOn,
  nextDueOn,
  withdrawalStatus,
  type RoutineRule,
  type WithdrawalStatus,
} from "@/lib/domain/health";

/* ---------------------------------------------------------------- */
/* Plumbing                                                          */
/* ---------------------------------------------------------------- */

export type DbLike = PgliteDatabase<typeof s>;

async function resolveDb(override?: DbLike): Promise<DbLike> {
  if (override) return override;
  const mod = await import("@/db");
  return mod.db as unknown as DbLike;
}

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-08-03.");
const Uuid = z.string().uuid();

/** A treatment older than this is not worth flagging as an unknown period. */
export const UNKNOWN_PERIOD_LOOKBACK_DAYS = 45;
/** How recently she must have been milked to count as "milking today". */
export const MILKING_LOOKBACK_DAYS = 14;

/**
 * M1 writes one alert per scheduled routine, keyed `<animalId>:ROUTINE_<code>`.
 * Recording the event here is what closes it — an alert nobody can clear is an
 * alert everybody learns to ignore.
 *
 * The prefix is duplicated rather than imported from `./herd`, because `herd.ts`
 * opens the production database at module scope and this module must stay
 * importable without one.
 */
const ROUTINE_ALERT_PREFIX = "ROUTINE_";

/** Close M1's schedule reminder for a routine, for every animal it was given to. */
async function resolveRoutineAlerts(
  db: DbLike,
  session: Session,
  animalIds: string[],
  routine: string | null | undefined,
  outcome: string,
): Promise<void> {
  if (!routine || animalIds.length === 0) return;
  await db
    .update(s.alert)
    .set({ resolvedAt: new Date(), outcome, resolvedBy: session.userId })
    .where(
      and(
        eq(s.alert.farmId, session.farmId),
        eq(s.alert.kind, `${ROUTINE_ALERT_PREFIX}${routine}`),
        inArray(s.alert.animalId, [...new Set(animalIds)]),
        isNull(s.alert.resolvedAt),
      ),
    );
}

/**
 * How many doses of this routine an animal has already had.
 *
 * Counted off `healthEvent.routine`, the column that exists for exactly this.
 * It used to be counted off the free-text `diagnosis`, where a typo — or a vet
 * writing "S19 booster" — would hand a heifer a second brucellosis shot that
 * cannot be undone.
 */
async function priorRoutineDoses(
  db: DbLike,
  session: Session,
  animalIds: string[],
  routine: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (animalIds.length === 0) return out;
  const rows = await db
    .select({ animalId: s.healthEvent.animalId })
    .from(s.healthEvent)
    .where(
      and(
        eq(s.healthEvent.farmId, session.farmId),
        eq(s.healthEvent.routine, routine),
        inArray(s.healthEvent.animalId, [...new Set(animalIds)]),
      ),
    );
  for (const r of rows) out.set(r.animalId, (out.get(r.animalId) ?? 0) + 1);
  return out;
}

/**
 * A deterministic UUID from stable parts.
 *
 * Batch dosing writes one row per animal per product, and the phone that
 * queued it offline may flush twice over a flaky link. Deriving each row id
 * from the batch id makes the replay a no-op under `onConflictDoNothing`
 * instead of dipping sixty cows twice.
 */
export function stableId(...parts: string[]): string {
  const h = createHash("sha256").update(parts.join(":")).digest("hex");
  const v = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${(
    (parseInt(h[16], 16) & 0x3) |
    0x8
  ).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  return v;
}

/** Clear dates are stored as a timestamp for milk and a date for meat. */
function toClearTimestamp(clearOn: ISODate | null): Date | null {
  return clearOn ? new Date(`${clearOn}T00:00:00.000Z`) : null;
}

function fromClearTimestamp(at: Date | null): ISODate | null {
  return at ? fromDate(at instanceof Date ? at : new Date(at)) : null;
}

/** "Thursday 7 August" — a date a herdsman can act on without a calendar. */
export function plainDate(d: ISODate): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${d}T00:00:00.000Z`));
}

async function writeReceipt(
  db: DbLike,
  session: Session,
  args: { rowId: string; kind: string; summary: string; payload?: unknown },
): Promise<string> {
  const ref = refCode(REF_PREFIX.HEALTH);
  const rows = await db
    .insert(s.receipt)
    .values({
      id: args.rowId,
      farmId: session.farmId,
      refCode: ref,
      kind: args.kind,
      summary: args.summary,
      actorId: session.userId,
      at: new Date(),
      payload: args.payload ?? null,
    })
    .onConflictDoNothing()
    .returning({ refCode: s.receipt.refCode });
  if (rows.length > 0) return rows[0].refCode;
  const [existing] = await db
    .select({ refCode: s.receipt.refCode })
    .from(s.receipt)
    .where(and(eq(s.receipt.id, args.rowId), eq(s.receipt.farmId, session.farmId)));
  return existing?.refCode ?? ref;
}

async function requireAnimal(db: DbLike, session: Session, animalId: string) {
  const [animal] = await db
    .select()
    .from(s.animal)
    .where(and(eq(s.animal.id, animalId), eq(s.animal.farmId, session.farmId)));
  return assertOwned(animal, session, "animal");
}

function nameOf(a: { name: string | null; tag: string }): string {
  return a.name ?? a.tag;
}

/* ---------------------------------------------------------------- */
/* HEALTH COST → EXPENSE (the money seam)                            */
/* ---------------------------------------------------------------- */

/**
 * Post the cost of a treatment, vaccination or routine batch into the cash
 * book as a PENDING expense, category VETERINARY.
 *
 * TWO THINGS THIS SEAM HAS TO GET RIGHT, both of which bite quietly:
 *
 * 1. **`costSettledBy` is honoured, not ignored.** A co-operative check-off
 *    never leaves the till — the co-op pays the vet and nets it off the milk
 *    cheque — so the expense is stamped `COOP_CHECKOFF` rather than cash. It
 *    still IS a cost of production and still has to be here: M4's statement
 *    reconciliation matches the co-op's `VET` deduction against exactly this
 *    row, and an expense that was never written is an "unmatched deduction"
 *    the farm cannot explain. Stamping the method also keeps the M-Pesa
 *    reconciler from demanding a statement line for money that never moved.
 *
 * 2. **The vet shilling is reported twice and counted once.**
 *    `animalLifetimeValue` and `cullList` (M7) read `healthEvent.costKes`
 *    directly, because they attribute cost to ONE ANIMAL and must not wait on
 *    an approval; `costOfProduction` (M9) reads the APPROVED expense, because
 *    a farm-wide cost total that moves before a manager has seen it is exactly
 *    what R10 exists to prevent. They are two views of the same fact, never
 *    two facts: no report adds them together, `costOfProduction` never reads
 *    `healthEvent.costKes`, and M7 never reads the expense. The expense id is
 *    derived from the health event, so a replayed offline flush posts once.
 */
async function postHealthExpense(
  db: DbLike,
  session: Session,
  args: {
    sourceId: string;
    occurredOn: ISODate;
    costKes: number | string | null | undefined;
    costSettledBy?: "CASH" | "CREDIT" | "COOP_CHECKOFF" | null;
    description: string;
  },
): Promise<string | null> {
  if (args.costKes == null || args.costKes === "") return null;
  const { postLinkedExpense } = await import("./money");
  return postLinkedExpense(db, session, {
    sourceTable: "health_event",
    sourceId: args.sourceId,
    incurredOn: args.occurredOn,
    category: "VETERINARY",
    description: args.description,
    amountKes: num(args.costKes),
    costSettledBy: args.costSettledBy ?? null,
  });
}

/**
 * Products are farm-scoped OR shared reference rows (`farmId` null), so the
 * ownership check cannot be `assertOwned` — a null farm is legitimate. The
 * refusal is deliberately identical for "missing" and "someone else's".
 */
function productScope(session: Session) {
  return or(eq(s.product.farmId, session.farmId), isNull(s.product.farmId));
}

async function requireProduct(db: DbLike, session: Session, productId: string) {
  const [product] = await db
    .select()
    .from(s.product)
    .where(and(eq(s.product.id, productId), productScope(session)));
  if (!product) throw new Error("That product was not found.");
  return product;
}

/* ---------------------------------------------------------------- */
/* The drug master                                                   */
/* ---------------------------------------------------------------- */

export interface CreateProductInput {
  id?: string;
  name: string;
  activeIngredient?: string | null;
  productType: NonNullable<typeof s.product.$inferSelect["productType"]>;
  /** From the label. Left null when the label is not to hand — never zero. */
  milkWithdrawalDays?: number | null;
  meatWithdrawalDays?: number | null;
  /** The provenance, and the legal defence. "PCPB label, 2026". */
  labelSource?: string | null;
  notForLactating?: boolean;
}

/**
 * Add a product to the drug master.
 *
 * A missing withdrawal period is stored as null and warned about loudly. It is
 * never stored as zero — "no period recorded" and "clear immediately" are
 * different facts and conflating them is exactly how residues reach a bulk tank.
 */
export async function createProductFor(
  session: Session,
  input: CreateProductInput,
  dbOverride?: DbLike,
): Promise<ActionResult<{ id: string; warnings: string[] }>> {
  const db = await resolveDb(dbOverride);
  const id = input.id ?? newId();

  const warnings: string[] = [];
  if (input.milkWithdrawalDays == null) {
    warnings.push(
      `No milk withdrawal period recorded for ${input.name}. Read it off the label before you treat a milking cow — until it is here, the app cannot tell you when her milk is safe.`,
    );
  }
  if (input.meatWithdrawalDays == null) {
    warnings.push(`No meat withdrawal period recorded for ${input.name}.`);
  }
  if (!input.labelSource) {
    warnings.push("Record where the period came from — the label is the legal defence if a load is ever tested.");
  }

  await db
    .insert(s.product)
    .values({
      id,
      farmId: session.farmId,
      name: input.name,
      activeIngredient: input.activeIngredient ?? null,
      productType: input.productType,
      milkWithdrawalDays: input.milkWithdrawalDays ?? null,
      meatWithdrawalDays: input.meatWithdrawalDays ?? null,
      labelSource: input.labelSource ?? null,
      notForLactating: input.notForLactating ?? false,
    })
    .onConflictDoNothing();

  return actionOk({ id, warnings }, `${input.name} added to the medicine store.`);
}

const ProductForm = z.object({
  id: Uuid.optional(),
  name: z.string().min(1, "What is the product called?"),
  activeIngredient: z.string().optional(),
  productType: z.enum([
    "ANTIBIOTIC", "VACCINE", "DEWORMER", "ACARICIDE", "NSAID",
    "INTRAMAMMARY", "MINERAL", "HORMONE", "OTHER",
  ]),
  milkWithdrawalDays: z.string().optional(),
  meatWithdrawalDays: z.string().optional(),
  labelSource: z.string().optional(),
  notForLactating: z.string().optional(),
});

const optionalDays = (v: string | undefined): number | null =>
  v === undefined || v === "" ? null : Math.max(0, Math.round(num(v)));

export async function createProduct(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; warnings: string[] }>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("ADMIN");
    const parsed = ProductForm.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const result = await createProductFor(session, {
      ...parsed.data,
      milkWithdrawalDays: optionalDays(parsed.data.milkWithdrawalDays),
      meatWithdrawalDays: optionalDays(parsed.data.meatWithdrawalDays),
      notForLactating: parsed.data.notForLactating === "on" || parsed.data.notForLactating === "true",
    });
    if (result.ok) updateTag(`health:${session.farmId}`);
    return result;
  });
}

/** The medicine store. Farm-specific products plus any shared reference ones. */
export async function listProducts(session: Session, dbOverride?: DbLike) {
  const db = await resolveDb(dbOverride);
  return db
    .select()
    .from(s.product)
    .where(or(eq(s.product.farmId, session.farmId), isNull(s.product.farmId)))
    .orderBy(asc(s.product.name));
}

/* ---------------------------------------------------------------- */
/* Observations — the herdsman's entry point                         */
/* ---------------------------------------------------------------- */

export interface ObservationInput {
  id?: string;
  animalId: string;
  occurredOn?: ISODate;
  signs: string;
  notes?: string | null;
}

/**
 * "Njeri is not eating." "Swollen quarter." "Limping."
 *
 * No diagnosis required and none invited — the herdsman records what he can
 * see, and the manager decides whether that means a dewormer or a vet. Asking a
 * herdsman to name a disease is how you get invented data.
 */
export async function recordObservationFor(
  session: Session,
  input: ObservationInput,
  dbOverride?: DbLike,
): Promise<ActionResult<{ id: string; animalName: string }>> {
  const db = await resolveDb(dbOverride);
  const animal = await requireAnimal(db, session, input.animalId);
  const occurredOn = input.occurredOn ?? today();

  if (!input.signs.trim()) {
    return actionError("Say what you can see — even one word.", { signs: ["Say what you can see."] });
  }

  const id = input.id ?? newId();
  await db
    .insert(s.healthEvent)
    .values({
      id,
      farmId: session.farmId,
      animalId: animal.id,
      eventType: "OBSERVATION",
      occurredOn,
      signs: input.signs.trim(),
      outcome: "ONGOING",
      recordedBy: session.userId,
    })
    .onConflictDoNothing();

  // The manager sees this on the home screen. One person, one animal, one
  // action, one deadline.
  await db
    .insert(s.alert)
    .values({
      id: stableId(id, "alert"),
      farmId: session.farmId,
      kind: "HEALTH_OBSERVATION",
      animalId: animal.id,
      assignedRole: "MANAGER",
      action: `Check ${nameOf(animal)} — ${input.signs.trim()}`,
      dueOn: occurredOn,
      severity: "WARN",
      dedupeKey: `obs:${id}`,
    })
    .onConflictDoNothing();

  const ref = await writeReceipt(db, session, {
    rowId: id,
    kind: "HEALTH_OBSERVATION",
    summary: `${nameOf(animal)}: ${input.signs.trim()}`,
  });

  return actionOk(
    { id, animalName: nameOf(animal) },
    `Noted for ${nameOf(animal)}. The manager will see this.`,
    ref,
  );
}

const ObservationForm = z.object({
  id: Uuid.optional(),
  animalId: Uuid,
  occurredOn: IsoDate.optional(),
  signs: z.string().min(1, "Say what you can see."),
});

export async function recordObservation(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; animalName: string }>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("RECORD");
    const parsed = ObservationForm.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const result = await recordObservationFor(session, parsed.data);
    if (result.ok) updateTag(`health:${session.farmId}`);
    return result;
  });
}

/* ---------------------------------------------------------------- */
/* TREATMENT — where the block engages                               */
/* ---------------------------------------------------------------- */

export type TreatmentRoute = NonNullable<typeof s.healthEvent.$inferSelect["route"]>;

export interface TreatmentInput {
  id?: string;
  animalId: string;
  productId: string;
  occurredOn?: ISODate;
  /** Multi-day courses withdraw from the LAST dose, not the first. */
  durationDays?: number | null;
  treatmentEndOn?: ISODate | null;
  signs?: string | null;
  diagnosis?: string | null;
  dose?: string | null;
  route?: TreatmentRoute | null;
  quartersTreated?: string[] | null;
  batchNo?: string | null;
  expiry?: ISODate | null;
  costKes?: number | string | null;
  costSettledBy?: "CASH" | "CREDIT" | "COOP_CHECKOFF" | null;
  performedByExt?: string | null;
  followUpOn?: ISODate | null;
  /** Supplied for dry cow therapy when she has already calved. */
  calvedOn?: ISODate | null;
}

export interface TreatmentResult {
  id: string;
  animalId: string;
  animalName: string;
  productName: string;
  treatmentEndOn: ISODate;
  milkClearOn: ISODate | null;
  meatClearOn: ISODate | null;
  isDryCowTherapy: boolean;
  /** Shown as the receipt body. Plain language, no jargon, no codes. */
  receiptLines: string[];
  /** Loud, but never blocking — the block is on selling her milk, not on the record. */
  warnings: string[];
}

/**
 * Record a treatment and engage the block.
 *
 *   milk_clear = treatment_end + product.milk_withdrawal_days
 *   meat_clear = treatment_end + product.meat_withdrawal_days
 *
 * Both come from the product's own label. A product with no recorded period
 * yields no clear date and a loud warning: unknown, never zero.
 */
export async function recordTreatmentFor(
  session: Session,
  input: TreatmentInput,
  dbOverride?: DbLike,
): Promise<ActionResult<TreatmentResult>> {
  const db = await resolveDb(dbOverride);
  const animal = await requireAnimal(db, session, input.animalId);

  const product = await requireProduct(db, session, input.productId);

  const occurredOn = input.occurredOn ?? today();
  const durationDays = input.durationDays ?? null;
  /**
   * A course cannot end before it started.
   *
   * The clear date is measured from this field, so a caller passing an earlier
   * date — by typo or on purpose — would otherwise produce a withdrawal that
   * expired before the injection. Floored rather than rejected: R4 says warn
   * and record, and the safe reading of a nonsense end date is "the course was
   * a single dose today".
   */
  const rawEnd =
    input.treatmentEndOn ??
    (durationDays && durationDays > 1 ? addDays(occurredOn, durationDays - 1) : occurredOn);
  const treatmentEndOn = rawEnd < occurredOn ? occurredOn : rawEnd;

  const route = input.route ?? (product.productType === "INTRAMAMMARY" ? "INTRAMAMMARY" : null);

  // A dry cow tube is an intramammary product that must not go into a milking
  // cow. That combination is what makes it the special case below.
  const isDryCowTherapy = route === "INTRAMAMMARY" && product.notForLactating;

  const withdrawal = computeWithdrawal({
    treatmentEndOn,
    milkWithdrawalDays: product.milkWithdrawalDays,
    meatWithdrawalDays: product.meatWithdrawalDays,
  });

  let milkClearOn = withdrawal.milkClearOn;
  if (isDryCowTherapy) {
    // 30 days after infusion AND 96 hours after calving, whichever is LATER.
    const dryClear = dryCowTherapyClearOn(treatmentEndOn, input.calvedOn ?? null);
    milkClearOn = milkClearOn && milkClearOn > dryClear ? milkClearOn : dryClear;
  }
  const meatClearOn = withdrawal.meatClearOn;

  const milking = await isCurrentlyMilking(session, animal.id, occurredOn, db);
  const warnings: string[] = [];

  if (product.notForLactating && milking) {
    warnings.push(
      `${product.name} is NOT for a cow in milk. ${nameOf(animal)} is milking. Check with the vet before you give this.`,
    );
  }
  if (product.milkWithdrawalDays == null) {
    warnings.push(
      `No milk withdrawal period is recorded for ${product.name}. Read it off the label and add it — until then treat her milk as unsafe to sell.`,
    );
  }
  if (product.meatWithdrawalDays == null) {
    warnings.push(`No meat withdrawal period is recorded for ${product.name}.`);
  }
  if (!product.labelSource) {
    warnings.push(`${product.name} has no label source on file. That record is the defence if a load is tested.`);
  }

  const id = input.id ?? newId();

  // The money seam. See `postHealthExpense` for why this is posted here and
  // why `animalLifetimeValue` still reads `costKes` instead of the expense.
  const expenseId = await postHealthExpense(db, session, {
    sourceId: id,
    occurredOn,
    costKes: input.costKes,
    costSettledBy: input.costSettledBy,
    description: `${product.name} for ${nameOf(animal)}`,
  });

  await db
    .insert(s.healthEvent)
    .values({
      id,
      farmId: session.farmId,
      animalId: animal.id,
      eventType: "TREATMENT",
      occurredOn,
      signs: input.signs ?? null,
      diagnosis: input.diagnosis ?? (isDryCowTherapy ? DRY_COW_THERAPY : null),
      // Stored explicitly rather than re-deduced from route + notForLactating
      // on every read. `listDryCowProducts` offers any INTRAMAMMARY product,
      // so the deduction misses a dry cow tube whose label flag was never set —
      // and the 96-hour-after-calving leg then silently never applies.
      isDryCowTherapy,
      productId: product.id,
      batchNo: input.batchNo ?? null,
      expiry: input.expiry ?? null,
      dose: input.dose ?? null,
      route,
      quartersTreated: input.quartersTreated ?? null,
      durationDays,
      treatmentEndOn,
      milkClearAt: toClearTimestamp(milkClearOn),
      meatClearAt: meatClearOn,
      performedByUser: session.userId,
      performedByExt: input.performedByExt ?? null,
      costKes: input.costKes == null || input.costKes === "" ? null : dec(num(input.costKes)),
      costSettledBy: input.costSettledBy ?? null,
      expenseId,
      outcome: "ONGOING",
      followUpOn: input.followUpOn ?? null,
      recordedBy: session.userId,
    })
    .onConflictDoNothing();

  if (milkClearOn) {
    await db
      .insert(s.alert)
      .values({
        id: stableId(id, "milk-clear"),
        farmId: session.farmId,
        kind: "WITHDRAWAL_CLEAR",
        animalId: animal.id,
        assignedRole: "HERDSMAN",
        action: `${nameOf(animal)}'s milk is clear from today.`,
        dueOn: milkClearOn,
        severity: "CRITICAL",
        dedupeKey: `withdrawal:${id}`,
      })
      .onConflictDoNothing();
  }

  const name = nameOf(animal);
  const receiptLines: string[] = [
    `${product.name}${input.dose ? `, ${input.dose}` : ""} given to ${name} on ${plainDate(occurredOn)}.`,
  ];
  if (durationDays && durationDays > 1) {
    receiptLines.push(`${durationDays}-day course — last dose ${plainDate(treatmentEndOn)}.`);
  }
  // The line that matters. It is the headline of the receipt and the message
  // the action returns, because it is the only thing the herdsman must act on.
  const milkLine = milkClearOn
    ? `Do not sell ${name}'s milk until ${plainDate(milkClearOn)}.`
    : `The withdrawal period for ${product.name} is not recorded. Do not sell ${name}'s milk until you have checked the label.`;
  receiptLines.push(milkLine);
  receiptLines.push(
    meatClearOn
      ? `Do not sell ${name} for slaughter until ${plainDate(meatClearOn)}.`
      : `The meat withdrawal period for ${product.name} is not recorded.`,
  );
  if (isDryCowTherapy) {
    receiptLines.push(
      "Dry cow therapy: her milk is not clear until 30 days after this infusion AND 96 hours after she calves, whichever is later.",
    );
  }

  const ref = await writeReceipt(db, session, {
    rowId: id,
    kind: "TREATMENT",
    summary: milkClearOn
      ? `${name} treated with ${product.name}. Milk clear ${milkClearOn}.`
      : `${name} treated with ${product.name}. Withdrawal period unknown.`,
    payload: { animalId: animal.id, productId: product.id, milkClearOn, meatClearOn },
  });

  return actionOk(
    {
      id,
      animalId: animal.id,
      animalName: name,
      productName: product.name,
      treatmentEndOn,
      milkClearOn,
      meatClearOn,
      isDryCowTherapy,
      receiptLines,
      warnings,
    },
    milkLine,
    ref,
  );
}

/** Marker written into `diagnosis` — see the schema notes in the build report. */
export const DRY_COW_THERAPY = "Dry cow therapy";

const TreatmentForm = z.object({
  id: Uuid.optional(),
  animalId: Uuid,
  productId: Uuid,
  occurredOn: IsoDate.optional(),
  durationDays: z.coerce.number().int().min(1).max(60).optional(),
  signs: z.string().optional(),
  diagnosis: z.string().optional(),
  dose: z.string().optional(),
  route: z.enum(["IM", "IV", "SC", "PO", "INTRAMAMMARY", "TOPICAL", "INTRAUTERINE"]).optional(),
  batchNo: z.string().optional(),
  expiry: IsoDate.optional(),
  costKes: z.string().optional(),
  costSettledBy: z.enum(["CASH", "CREDIT", "COOP_CHECKOFF"]).optional(),
  followUpOn: IsoDate.optional(),
  calvedOn: IsoDate.optional(),
});

export async function recordTreatment(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<TreatmentResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("TREAT");
    const parsed = TreatmentForm.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const quarters = formData.getAll("quartersTreated").map(String).filter(Boolean);
    const result = await recordTreatmentFor(session, {
      ...parsed.data,
      quartersTreated: quarters.length > 0 ? quarters : null,
    });
    if (result.ok) {
      updateTag(`health:${session.farmId}`);
      // The milking sheet reads the withdrawal board per row, so it has to see
      // this on the very next render, not after a stale window.
      updateTag(`withdrawal:${session.farmId}`);
      updateTag(`milk:${session.farmId}`);
    }
    return result;
  });
}

/**
 * Dry cow therapy, recorded explicitly.
 *
 * The clear date is the LATER of 30 days after infusion and 96 hours after
 * calving. At infusion she has not calved yet, so the stored date is the
 * 30-day one and `getWithdrawalStatus` extends it automatically once a calving
 * is recorded. Nothing has to remember to come back and fix it.
 */
export async function recordDryCowTherapyFor(
  session: Session,
  input: Omit<TreatmentInput, "route">,
  dbOverride?: DbLike,
): Promise<ActionResult<TreatmentResult>> {
  const db = await resolveDb(dbOverride);
  const product = await requireProduct(db, session, input.productId);
  if (!product.notForLactating) {
    return actionError(
      `${product.name} is not marked as a dry cow product. Dry cow tubes must be marked "not for lactating cows" so the 30-day rule applies.`,
    );
  }
  return recordTreatmentFor(session, { ...input, route: "INTRAMAMMARY" }, db);
}

/* ---------------------------------------------------------------- */
/* THE WITHDRAWAL BOARD — the contract other modules read            */
/* ---------------------------------------------------------------- */

/**
 * A superset of the domain `WithdrawalStatus`, so anything typed against
 * `WithdrawalStatus` accepts one of these unchanged.
 */
export interface AnimalWithdrawal extends WithdrawalStatus {
  animalId: string;
  animalName: string;
  /**
   * She was treated recently with a product that has NO recorded label period.
   * That is not the same as being clear, and the milk sheet should say so.
   */
  unknownPeriod: boolean;
  unknownMessage: string | null;
  /**
   * The same thing as `message`, with the dates written the way a person says
   * them — "until Friday 7 August" rather than "until 2026-08-07". Use this on
   * screen; `message` keeps the ISO form for logs and payloads.
   */
  plainMessage: string | null;
}

/**
 * ═══════════════════════════════════════════════════════════════════
 *  THE CONTRACT other modules build against.
 *
 *    getWithdrawalStatus(session, animalIds, asOf?, db?)
 *      → Promise<Map<animalId, AnimalWithdrawal>>
 *
 *  • One call per sheet, not one per row: pass every animal on the
 *    milking sheet and look each one up in the returned Map.
 *  • The Map has an entry for EVERY id passed in. An animal with no
 *    treatments comes back with `milkBlocked: false` and a null
 *    message, so callers never have to handle a missing key.
 *  • `milkBlocked === true` means the milk may not go to COOP,
 *    PROCESSOR, INSTITUTION, HOUSEHOLD, SHOP or MILK_ATM. Record it
 *    and disposition it to WITHHELD_TREATMENT.
 *  • `unknownPeriod === true` means a recent treatment used a product
 *    with no label period on file. Not blocked, but do not present it
 *    as clear.
 *  • `asOf` defaults to today. Clear ON the clear date: a cow whose
 *    milkClearOn equals `asOf` is NOT blocked.
 *  • Ids belonging to another farm are silently absent from the Map;
 *    this never throws on a foreign id.
 * ═══════════════════════════════════════════════════════════════════
 */
export async function getWithdrawalStatus(
  session: Session,
  animalIds: string[],
  asOf: ISODate = today(),
  dbOverride?: DbLike,
): Promise<Map<string, AnimalWithdrawal>> {
  const out = new Map<string, AnimalWithdrawal>();
  if (animalIds.length === 0) return out;

  const db = await resolveDb(dbOverride);
  const ids = [...new Set(animalIds)];

  const animals = await db
    .select({ id: s.animal.id, name: s.animal.name, tag: s.animal.tag })
    .from(s.animal)
    .where(and(eq(s.animal.farmId, session.farmId), inArray(s.animal.id, ids)));
  if (animals.length === 0) return out;

  const events = await db
    .select({
      id: s.healthEvent.id,
      animalId: s.healthEvent.animalId,
      occurredOn: s.healthEvent.occurredOn,
      treatmentEndOn: s.healthEvent.treatmentEndOn,
      route: s.healthEvent.route,
      isDryCowTherapy: s.healthEvent.isDryCowTherapy,
      milkClearAt: s.healthEvent.milkClearAt,
      meatClearAt: s.healthEvent.meatClearAt,
      productId: s.healthEvent.productId,
      notForLactating: s.product.notForLactating,
      milkWithdrawalDays: s.product.milkWithdrawalDays,
      productName: s.product.name,
    })
    .from(s.healthEvent)
    .leftJoin(s.product, eq(s.product.id, s.healthEvent.productId))
    .where(
      and(
        eq(s.healthEvent.farmId, session.farmId),
        inArray(s.healthEvent.animalId, animals.map((a) => a.id)),
      ),
    );

  // Dry cow therapy is resolved against any calving recorded since the
  // infusion, so the 96-hour leg applies without anyone re-entering anything.
  const calvings = await db
    .select({ damId: s.calving.damId, calvedOn: s.calving.calvedOn })
    .from(s.calving)
    .where(
      and(eq(s.calving.farmId, session.farmId), inArray(s.calving.damId, animals.map((a) => a.id))),
    )
    .orderBy(asc(s.calving.calvedOn));

  const byAnimal = new Map<string, typeof events>();
  for (const e of events) {
    const list = byAnimal.get(e.animalId) ?? [];
    list.push(e);
    byAnimal.set(e.animalId, list);
  }

  const unknownCutoff = addDays(asOf, -UNKNOWN_PERIOD_LOOKBACK_DAYS);

  for (const animal of animals) {
    const name = nameOf(animal);
    const list = byAnimal.get(animal.id) ?? [];

    const clears: Array<{ milkClearOn: ISODate | null; meatClearOn: ISODate | null }> = [];
    let unknownPeriod = false;
    let unknownProduct: string | null = null;

    for (const e of list) {
      let milkClearOn = fromClearTimestamp(e.milkClearAt);
      const meatClearOn = e.meatClearAt ?? null;
      const end = e.treatmentEndOn ?? e.occurredOn;

      // The explicit flag first, the old deduction second, so a dry-off written
      // by M2 extends to calving + 96 h even when the tube's label flag is
      // missing — and rows written before the column existed still work.
      if (e.isDryCowTherapy || (e.route === "INTRAMAMMARY" && e.notForLactating)) {
        const calvedAfter = calvings
          .filter((c) => c.damId === animal.id && c.calvedOn >= end)
          .map((c) => c.calvedOn)[0] ?? null;
        const dryClear = dryCowTherapyClearOn(end, calvedAfter);
        milkClearOn = milkClearOn && milkClearOn > dryClear ? milkClearOn : dryClear;
      }

      if (e.productId && e.milkWithdrawalDays == null && end >= unknownCutoff) {
        unknownPeriod = true;
        unknownProduct = e.productName ?? null;
      }

      if (milkClearOn || meatClearOn) clears.push({ milkClearOn, meatClearOn });
    }

    const status = withdrawalStatus(clears, asOf, name);

    const parts: string[] = [];
    if (status.milkClearOn) parts.push(`Do not sell ${name}'s milk until ${plainDate(status.milkClearOn)}.`);
    if (status.meatClearOn) {
      parts.push(`Do not sell ${name} for slaughter until ${plainDate(status.meatClearOn)}.`);
    }

    out.set(animal.id, {
      ...status,
      animalId: animal.id,
      animalName: name,
      plainMessage: parts.length > 0 ? parts.join(" ") : null,
      unknownPeriod: unknownPeriod && !status.milkBlocked,
      unknownMessage:
        unknownPeriod && !status.milkBlocked
          ? `${name} was treated with ${unknownProduct ?? "a product"} that has no withdrawal period on file. Check the label before you sell her milk.`
          : null,
    });
  }

  return out;
}

export interface WithdrawalBoardRow extends AnimalWithdrawal {
  daysLeft: number | null;
}

/** Who is currently withheld. The /health landing screen. */
export async function withdrawalBoard(
  session: Session,
  asOf: ISODate = today(),
  dbOverride?: DbLike,
): Promise<WithdrawalBoardRow[]> {
  const db = await resolveDb(dbOverride);

  // Only animals with a clear date on file can possibly be blocked, so start
  // there rather than walking the whole herd.
  const candidates = await db
    .selectDistinct({ animalId: s.healthEvent.animalId })
    .from(s.healthEvent)
    .where(
      and(
        eq(s.healthEvent.farmId, session.farmId),
        or(isNotNull(s.healthEvent.milkClearAt), isNotNull(s.healthEvent.meatClearAt), isNotNull(s.healthEvent.productId)),
      ),
    );

  const statuses = await getWithdrawalStatus(session, candidates.map((c) => c.animalId), asOf, db);
  const rows: WithdrawalBoardRow[] = [];
  for (const st of statuses.values()) {
    if (!st.milkBlocked && !st.meatBlocked && !st.unknownPeriod) continue;
    const clear = st.milkClearOn ?? st.meatClearOn;
    rows.push({
      ...st,
      daysLeft: clear ? Math.max(0, Math.round((Date.parse(clear) - Date.parse(asOf)) / 86_400_000)) : null,
    });
  }
  return rows.sort((a, b) => (a.daysLeft ?? 9e9) - (b.daysLeft ?? 9e9));
}

/** Has she been milked recently enough to count as in milk today? */
export async function isCurrentlyMilking(
  session: Session,
  animalId: string,
  asOf: ISODate = today(),
  dbOverride?: DbLike,
): Promise<boolean> {
  const db = await resolveDb(dbOverride);
  const rows = await db
    .select({ id: s.milkRecord.id })
    .from(s.milkRecord)
    .where(
      and(
        eq(s.milkRecord.farmId, session.farmId),
        eq(s.milkRecord.animalId, animalId),
        gte(s.milkRecord.recordedOn, addDays(asOf, -MILKING_LOOKBACK_DAYS)),
        lte(s.milkRecord.recordedOn, asOf),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface HealthAnimalOption {
  id: string;
  label: string;
  /** Drives the not-for-lactating warning and the milk-sheet lock. */
  milking: boolean;
}

/** The herd still on the farm, for the pickers on the health screens. */
export async function listAnimalsForHealth(
  session: Session,
  asOf: ISODate = today(),
  dbOverride?: DbLike,
): Promise<HealthAnimalOption[]> {
  const db = await resolveDb(dbOverride);
  const present = await resolveHerd(db, session, undefined, "ALL", asOf);
  const milkingIds = new Set(
    (
      await db
        .selectDistinct({ animalId: s.milkRecord.animalId })
        .from(s.milkRecord)
        .where(
          and(
            eq(s.milkRecord.farmId, session.farmId),
            gte(s.milkRecord.recordedOn, addDays(asOf, -MILKING_LOOKBACK_DAYS)),
            lte(s.milkRecord.recordedOn, asOf),
          ),
        )
    ).map((r) => r.animalId),
  );
  return present
    .map((a) => ({
      id: a.id,
      label: a.name ? `${a.name} (${a.tag})` : a.tag,
      milking: milkingIds.has(a.id),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/* ---------------------------------------------------------------- */
/* ROUTINE BATCH — sixty cows, one action                            */
/* ---------------------------------------------------------------- */

export type RoutineEventType = "DEWORMING" | "DIPPING" | "VACCINATION" | "TREATMENT" | "HOOF_TRIM";

export interface RoutineBatchInput {
  /**
   * One id for the whole batch. Row ids are derived from it, so flushing the
   * same offline batch twice dips the herd once.
   */
  batchId?: string;
  occurredOn?: ISODate;
  /** Explicit animals, or a group, or both. */
  animalIds?: string[];
  group?: "LACTATING" | "DRY" | "HEIFERS" | "CALVES" | "BULLS" | "ALL";
  /** Several products in one pass — spray and dewormer on the same day. */
  productIds: string[];
  eventType?: RoutineEventType;
  /** Routine code from KENYA_ROUTINES, e.g. "DIP" or "DEWORM". */
  routine?: string | null;
  dose?: string | null;
  route?: TreatmentRoute | null;
  costKes?: number | string | null;
  costSettledBy?: "CASH" | "CREDIT" | "COOP_CHECKOFF" | null;
}

export interface RoutineBatchResult {
  batchId: string;
  animals: number;
  products: number;
  eventsWritten: number;
  /** Animals whose milk is now blocked by this batch. */
  nowWithheld: Array<{ animalId: string; animalName: string; milkClearOn: ISODate }>;
  warnings: string[];
  message: string;
}

/**
 * Dip, spray or deworm a whole group in ONE action, with more than one product
 * at a time.
 *
 * Herdwatch's most-cited complaint is that batch dosing is slow and you cannot
 * apply multiple drugs to one animal at once. Weekly tick spraying across
 * sixty animals has to be one action, not sixty, or it simply stops being
 * recorded.
 */
export async function recordRoutineBatchFor(
  session: Session,
  input: RoutineBatchInput,
  dbOverride?: DbLike,
): Promise<ActionResult<RoutineBatchResult>> {
  const db = await resolveDb(dbOverride);
  const occurredOn = input.occurredOn ?? today();
  const batchId = input.batchId ?? newId();

  if (!input.productIds || input.productIds.length === 0) {
    return actionError("Pick at least one product.");
  }

  let animals = await resolveHerd(db, session, input.animalIds, input.group, occurredOn);
  if (animals.length === 0) {
    return actionError("No animals matched. Pick the animals or a group with animals in it.");
  }

  /* ONCE IN A LIFETIME, enforced on the batch path too.
   *
   * Disbudding is the one that gets here — it is done to a pen of calves at
   * once, not animal by animal on the vaccination screen, so the refusal that
   * guards S19 and ECF-ITM never saw it. Skipping the animals who have already
   * had it is the enforcement: refusing the whole batch would mean the other
   * nineteen calves never get recorded, which is how a paper register wins.
   */
  const batchRule = input.routine ? routineRule(input.routine) : undefined;
  const skipped: string[] = [];
  if (batchRule?.onceInLifetime && input.routine) {
    const prior = await priorRoutineDoses(db, session, animals.map((a) => a.id), input.routine);
    const eligible = animals.filter((a) => (prior.get(a.id) ?? 0) === 0);
    for (const a of animals) if ((prior.get(a.id) ?? 0) > 0) skipped.push(nameOf(a));
    if (eligible.length === 0) {
      return actionError(
        `${batchRule.label} is given once in a lifetime and every animal you picked has had it.`,
      );
    }
    animals = eligible;
  }

  const products = await db
    .select()
    .from(s.product)
    .where(and(productScope(session), inArray(s.product.id, input.productIds)));
  if (products.length !== new Set(input.productIds).size) {
    return actionError("One of those products was not found.");
  }

  const warnings: string[] = [];
  for (const p of products) {
    if (p.milkWithdrawalDays == null) {
      warnings.push(
        `${p.name} has no milk withdrawal period on file. Add it from the label — this batch cannot tell you when the milk is safe.`,
      );
    }
  }
  if (skipped.length > 0 && batchRule) {
    warnings.push(
      `${skipped.join(", ")} ${skipped.length === 1 ? "has" : "have"} already had ${batchRule.label} — it is given once in a lifetime, so ${skipped.length === 1 ? "she was" : "they were"} left out.`,
    );
  }

  const eventType: RoutineEventType = input.eventType ?? "DIPPING";
  const nowWithheld: RoutineBatchResult["nowWithheld"] = [];
  let eventsWritten = 0;

  /* The money seam for a batch.
   *
   * `costKes` on a batch is the cost PER ANIMAL PER PRODUCT — that is how it
   * is stored on each row, and how M7 attributes it to each cow. The cash book
   * wants the invoice, so ONE expense carries the whole batch and every row of
   * the batch points at it. Sixty rows, one expense, one shilling total: the
   * id comes from the batch, so a re-flushed batch does not buy the dip twice.
   */
  const batchCostKes = num(input.costKes) * animals.length * products.length;
  const batchExpenseId = await postHealthExpense(db, session, {
    sourceId: `batch:${batchId}`,
    occurredOn,
    costKes: input.costKes == null || input.costKes === "" ? null : batchCostKes,
    costSettledBy: input.costSettledBy,
    description: `${products.map((p) => p.name).join(" and ")} — ${animals.length} animal${animals.length === 1 ? "" : "s"}`,
  });

  for (const animal of animals) {
    for (const product of products) {
      const withdrawal = computeWithdrawal({
        treatmentEndOn: occurredOn,
        milkWithdrawalDays: product.milkWithdrawalDays,
        meatWithdrawalDays: product.meatWithdrawalDays,
      });
      const id = stableId(batchId, animal.id, product.id);
      const inserted = await db
        .insert(s.healthEvent)
        .values({
          id,
          farmId: session.farmId,
          animalId: animal.id,
          eventType,
          occurredOn,
          // The routine code belongs in `routine`, which is what it is for.
          // It used to be written into free-text `diagnosis`, where the
          // once-for-life count and the due-list both had to guess.
          routine: input.routine ?? null,
          productId: product.id,
          dose: input.dose ?? null,
          route: input.route ?? (eventType === "DIPPING" ? "TOPICAL" : null),
          treatmentEndOn: occurredOn,
          milkClearAt: toClearTimestamp(withdrawal.milkClearOn),
          meatClearAt: withdrawal.meatClearOn,
          performedByUser: session.userId,
          costKes: input.costKes == null || input.costKes === "" ? null : dec(num(input.costKes)),
          costSettledBy: input.costSettledBy ?? null,
          expenseId: batchExpenseId,
          outcome: "RECOVERED",
          recordedBy: session.userId,
        })
        .onConflictDoNothing()
        .returning({ id: s.healthEvent.id });
      if (inserted.length > 0) eventsWritten++;

      if (withdrawal.milkClearOn && withdrawal.milkClearOn > occurredOn) {
        nowWithheld.push({
          animalId: animal.id,
          animalName: nameOf(animal),
          milkClearOn: withdrawal.milkClearOn,
        });
      }
    }
  }

  // M1 put a `ROUTINE_<code>` reminder on each of these animals at
  // registration. Doing the thing is what closes it.
  await resolveRoutineAlerts(db, session, animals.map((a) => a.id), input.routine, "DONE");

  const productNames = products.map((p) => p.name).join(" and ");
  const message = `${productNames} given to ${animals.length} animal${animals.length === 1 ? "" : "s"} on ${plainDate(
    occurredOn,
  )}.${nowWithheld.length > 0 ? ` ${nowWithheld.length} now under milk withdrawal.` : ""}`;

  const ref = await writeReceipt(db, session, {
    rowId: stableId(batchId, "receipt"),
    kind: "ROUTINE_BATCH",
    summary: message,
    payload: { batchId, animals: animals.length, products: products.length, occurredOn },
  });

  return actionOk(
    {
      batchId,
      animals: animals.length,
      products: products.length,
      eventsWritten,
      nowWithheld,
      warnings,
      message,
    },
    message,
    ref,
  );
}

/**
 * M1's class derivation, recomputed here from the same events.
 *
 * `herd.ts` owns this rule, but it opens the production database at module
 * scope, so importing it would make this module un-importable without one.
 * The facts are therefore assembled to `factsFor`'s exact recipe — abortions
 * excluded from parity, the expected calving date taken from the service a
 * positive diagnosis pointed at — and handed to the same pure `deriveClass`.
 * Same input, same function, same answer.
 */
async function derivedClasses(
  db: DbLike,
  session: Session,
  animals: Array<{ id: string; sex: "F" | "M"; dateOfBirth: ISODate | null }>,
  asOf: ISODate,
): Promise<Map<string, s.AnimalClass>> {
  const farmId = session.farmId;
  const [rows, calvings, outcomes, services, pds, dryOffs, weights, exits] = await Promise.all([
    db.select().from(s.animal).where(eq(s.animal.farmId, farmId)),
    db.select().from(s.calving).where(eq(s.calving.farmId, farmId)),
    db.select().from(s.calvingOutcome).where(eq(s.calvingOutcome.farmId, farmId)),
    db.select().from(s.service).where(eq(s.service.farmId, farmId)),
    db.select().from(s.pregnancyCheck).where(eq(s.pregnancyCheck.farmId, farmId)),
    db.select().from(s.dryOff).where(eq(s.dryOff.farmId, farmId)),
    db.select().from(s.weightObservation).where(eq(s.weightObservation.farmId, farmId)),
    db.select().from(s.animalExit).where(eq(s.animalExit.farmId, farmId)),
  ]);

  const aborted = new Set<string>();
  const outcomesByCalving = new Map<string, string[]>();
  for (const o of outcomes) {
    const list = outcomesByCalving.get(o.calvingId) ?? [];
    list.push(o.outcome);
    outcomesByCalving.set(o.calvingId, list);
  }
  for (const [calvingId, list] of outcomesByCalving) {
    if (list.length > 0 && list.every((x) => x === "ABORTION")) aborted.add(calvingId);
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, s.AnimalClass>();

  for (const a of animals) {
    const row = byId.get(a.id);
    if (!row) continue;
    out.set(a.id, deriveClass(animalFacts(row, asOf, { calvings, aborted, services, pds, dryOffs, weights, exits }), asOf));
  }
  return out;
}

/** The fact bundle `deriveClass` needs, built to M1's `factsFor` recipe. */
function animalFacts(
  animal: typeof s.animal.$inferSelect,
  asOf: ISODate,
  src: {
    calvings: (typeof s.calving.$inferSelect)[];
    aborted: Set<string>;
    services: (typeof s.service.$inferSelect)[];
    pds: (typeof s.pregnancyCheck.$inferSelect)[];
    dryOffs: (typeof s.dryOff.$inferSelect)[];
    weights: (typeof s.weightObservation.$inferSelect)[];
    exits: (typeof s.animalExit.$inferSelect)[];
  },
): AnimalFacts {
  const calvings = src.calvings
    .filter((c) => c.damId === animal.id && c.calvedOn <= asOf && !src.aborted.has(c.id))
    .sort((x, y) => x.calvedOn.localeCompare(y.calvedOn));
  const services = src.services
    .filter((r) => r.animalId === animal.id && r.servedOn <= asOf)
    .sort((x, y) => x.servedOn.localeCompare(y.servedOn));
  const pds = src.pds
    .filter((r) => r.animalId === animal.id && r.checkedOn <= asOf)
    .sort((x, y) => x.checkedOn.localeCompare(y.checkedOn));
  const dryOffs = src.dryOffs
    .filter((r) => r.animalId === animal.id && r.driedOn <= asOf)
    .sort((x, y) => x.driedOn.localeCompare(y.driedOn));
  const weights = src.weights
    .filter((r) => r.animalId === animal.id && r.observedOn <= asOf && r.weightKg != null)
    .sort((x, y) => x.observedOn.localeCompare(y.observedOn));
  const exit = src.exits.find((r) => r.animalId === animal.id && r.exitDate <= asOf) ?? null;

  const lastService = services.at(-1) ?? null;
  const positives = pds.filter((p) => p.result === "POSITIVE");
  const negatives = pds.filter((p) => p.result === "NEGATIVE");
  const lastPositive = positives.at(-1) ?? null;

  let edd: ISODate | null = lastService?.expectedCalvingOn ?? null;
  if (lastPositive?.serviceId) {
    const tied = services.find((r) => r.id === lastPositive.serviceId);
    if (tied?.expectedCalvingOn) edd = tied.expectedCalvingOn;
  }
  if (!edd && lastService) {
    edd = breedingCalendar(lastService.servedOn, animal.primaryBreed).expectedCalvingOn;
  }

  return {
    sex: animal.sex,
    dateOfBirth: animal.dateOfBirth,
    castrated: animal.castrated,
    classOverride: animal.classOverride,
    parity: calvings.length,
    lastCalvingOn: calvings.at(-1)?.calvedOn ?? null,
    lastServiceOn: lastService?.servedOn ?? null,
    pdPositiveOn: lastPositive?.checkedOn ?? null,
    pdNegativeOn: negatives.at(-1)?.checkedOn ?? null,
    driedOffOn: dryOffs.at(-1)?.driedOn ?? null,
    expectedCalvingOn: edd,
    latestWeightKg: weights.at(-1)?.weightKg != null ? num(weights.at(-1)!.weightKg) : null,
    culled: exit?.reason === "CULLED",
  };
}

/**
 * Who is in this group?
 *
 * Sex and age for the young stock. For LACTATING and DRY the answer now comes
 * from M1's derivation FIRST — a cow M1 calls DRY_COW is dry here too, even
 * though her last milk record is only a day old, because a dry-off does not
 * erase the fortnight of milkings before it. Recent milk records are kept as a
 * second signal for animals M1 cannot classify (a bought-in cow with no
 * calving on file reads as a heifer), so a batch still never silently misses
 * an animal that is plainly in milk.
 */
async function resolveHerd(
  db: DbLike,
  session: Session,
  animalIds: string[] | undefined,
  group: RoutineBatchInput["group"],
  asOf: ISODate,
) {
  const all = await db
    .select({
      id: s.animal.id,
      name: s.animal.name,
      tag: s.animal.tag,
      sex: s.animal.sex,
      dateOfBirth: s.animal.dateOfBirth,
    })
    .from(s.animal)
    .where(eq(s.animal.farmId, session.farmId));

  const exited = new Set(
    (
      await db
        .select({ animalId: s.animalExit.animalId })
        .from(s.animalExit)
        .where(and(eq(s.animalExit.farmId, session.farmId), lte(s.animalExit.exitDate, asOf)))
    ).map((e) => e.animalId),
  );
  const present = all.filter((a) => !exited.has(a.id));

  if (animalIds && animalIds.length > 0) {
    const wanted = new Set(animalIds);
    const picked = present.filter((a) => wanted.has(a.id));
    // A foreign id simply is not in this farm's list — the tenancy boundary
    // holds without telling the caller whether the id exists elsewhere.
    if (picked.length !== wanted.size) {
      throw new Error("That animal was not found.");
    }
    return picked;
  }

  if (!group || group === "ALL") return present;

  const milkingIds = new Set(
    (
      await db
        .selectDistinct({ animalId: s.milkRecord.animalId })
        .from(s.milkRecord)
        .where(
          and(
            eq(s.milkRecord.farmId, session.farmId),
            gte(s.milkRecord.recordedOn, addDays(asOf, -MILKING_LOOKBACK_DAYS)),
            lte(s.milkRecord.recordedOn, asOf),
          ),
        )
    ).map((r) => r.animalId),
  );

  const classes =
    group === "LACTATING" || group === "DRY"
      ? await derivedClasses(db, session, present, asOf)
      : new Map<string, s.AnimalClass>();

  return present.filter((a) => {
    const days = ageDays(a.dateOfBirth, asOf);
    const cls = classes.get(a.id);
    // M1's word is final where it has one. DRY_COW and SPRINGER are the two it
    // reaches only on the evidence of a dry-off or a due calving, and both mean
    // "not in milk" no matter what last week's milk sheet says.
    const m1Dry = cls === "DRY_COW" || cls === "SPRINGER";
    const m1Milking = cls != null && isMilking(cls);
    switch (group) {
      case "CALVES":
        return days !== null && days < 90;
      case "HEIFERS":
        return a.sex === "F" && days !== null && days >= 90 && days < 730 && !milkingIds.has(a.id);
      case "BULLS":
        return a.sex === "M";
      case "LACTATING":
        return a.sex === "F" && !m1Dry && (m1Milking || milkingIds.has(a.id));
      case "DRY":
        return (
          a.sex === "F" &&
          (m1Dry || (!m1Milking && !milkingIds.has(a.id) && (days === null || days >= 730)))
        );
      default:
        return true;
    }
  });
}

const BatchForm = z.object({
  batchId: Uuid.optional(),
  occurredOn: IsoDate.optional(),
  group: z.enum(["LACTATING", "DRY", "HEIFERS", "CALVES", "BULLS", "ALL"]).optional(),
  eventType: z.enum(["DEWORMING", "DIPPING", "VACCINATION", "TREATMENT", "HOOF_TRIM"]).optional(),
  routine: z.string().optional(),
  dose: z.string().optional(),
  costKes: z.string().optional(),
  costSettledBy: z.enum(["CASH", "CREDIT", "COOP_CHECKOFF"]).optional(),
});

export async function recordRoutineBatch(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<RoutineBatchResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("RECORD");
    const parsed = BatchForm.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const productIds = formData.getAll("productIds").map(String).filter(Boolean);
    const animalIds = formData.getAll("animalIds").map(String).filter(Boolean);
    const result = await recordRoutineBatchFor(session, {
      ...parsed.data,
      productIds,
      animalIds: animalIds.length > 0 ? animalIds : undefined,
    });
    if (result.ok) {
      updateTag(`health:${session.farmId}`);
      updateTag(`withdrawal:${session.farmId}`);
    }
    return result;
  });
}

/* ---------------------------------------------------------------- */
/* Vaccination — the two rules that must be hard                     */
/* ---------------------------------------------------------------- */

export interface VaccinationInput {
  id?: string;
  animalId: string;
  /** A key from KENYA_ROUTINES: S19, ECF_ITM, FMD, LSD, ANTHRAX_BQ, DEWORM, DIP… */
  routine: string;
  occurredOn?: ISODate;
  productId?: string | null;
  batchNo?: string | null;
  expiry?: ISODate | null;
  dose?: string | null;
  costKes?: number | string | null;
  costSettledBy?: "CASH" | "CREDIT" | "COOP_CHECKOFF" | null;
  performedByExt?: string | null;
}

export interface VaccinationResult {
  id: string;
  animalName: string;
  routine: string;
  label: string;
  nextDueOn: ISODate | null;
  warnings: string[];
  message: string;
}

export function routineRule(routine: string): RoutineRule | undefined {
  return KENYA_ROUTINES.find((r) => r.routine === routine);
}

/**
 * Record a vaccination, refusing the two that must be refused.
 *
 * S19 brucellosis is females only, 4–8 months, once for life — given to an
 * adult it interferes with later testing, and there is no undoing it. ECF-ITM
 * is once for life and leaves the animal a carrier. Neither is a reminder; both
 * are refusals. Everything else in the calendar warns and saves.
 */
export async function recordVaccinationFor(
  session: Session,
  input: VaccinationInput,
  dbOverride?: DbLike,
): Promise<ActionResult<VaccinationResult>> {
  const db = await resolveDb(dbOverride);
  const animal = await requireAnimal(db, session, input.animalId);
  const occurredOn = input.occurredOn ?? today();

  const rule = routineRule(input.routine);
  if (!rule) return actionError(`"${input.routine}" is not a routine this app knows.`);

  // Prior doses come off `healthEvent.routine` — the dedicated column — not
  // off free-text `diagnosis`. A vet who types "S19 booster" must not be able
  // to hand a heifer a second brucellosis shot, and that is a one-way door.
  const given = await priorRoutineDoses(db, session, [animal.id], rule.routine);

  const eligibility = checkRoutineEligibility(rule, {
    sex: animal.sex,
    ageDays: ageDays(animal.dateOfBirth, occurredOn),
    alreadyGivenCount: given.get(animal.id) ?? 0,
  });

  if (!eligibility.eligible) {
    // The only refusals in this module besides the withdrawal block. Both are
    // irreversible if allowed through, which is why they are not warnings.
    return actionError(`${nameOf(animal)}: ${eligibility.reason}`);
  }

  const warnings: string[] = [];
  if (eligibility.reason) warnings.push(`${nameOf(animal)}: ${eligibility.reason}`);
  if (rule.note) warnings.push(rule.note);

  let product: typeof s.product.$inferSelect | undefined;
  if (input.productId) product = await requireProduct(db, session, input.productId);

  const withdrawal = computeWithdrawal({
    treatmentEndOn: occurredOn,
    milkWithdrawalDays: product?.milkWithdrawalDays ?? null,
    meatWithdrawalDays: product?.meatWithdrawalDays ?? null,
  });

  const id = input.id ?? newId();

  // The money seam, same rule as a treatment: PENDING, VETERINARY, and a
  // check-off is stamped as such rather than posted as cash out.
  const expenseId = await postHealthExpense(db, session, {
    sourceId: id,
    occurredOn,
    costKes: input.costKes,
    costSettledBy: input.costSettledBy,
    description: `${rule.label} for ${nameOf(animal)}`,
  });

  await db
    .insert(s.healthEvent)
    .values({
      id,
      farmId: session.farmId,
      animalId: animal.id,
      eventType: "VACCINATION",
      occurredOn,
      // The routine CODE goes in the dedicated column; `diagnosis` keeps the
      // human label, so the cow card reads "Brucellosis S19" and nothing
      // load-bearing has to parse free text.
      routine: rule.routine,
      diagnosis: rule.label,
      productId: product?.id ?? null,
      batchNo: input.batchNo ?? null,
      expiry: input.expiry ?? null,
      dose: input.dose ?? null,
      treatmentEndOn: occurredOn,
      milkClearAt: toClearTimestamp(withdrawal.milkClearOn),
      meatClearAt: withdrawal.meatClearOn,
      performedByUser: session.userId,
      performedByExt: input.performedByExt ?? null,
      costKes: input.costKes == null || input.costKes === "" ? null : dec(num(input.costKes)),
      costSettledBy: input.costSettledBy ?? null,
      expenseId,
      outcome: "RECOVERED",
      recordedBy: session.userId,
    })
    .onConflictDoNothing();

  // M1 set a `ROUTINE_<code>` reminder for her at registration; this is the
  // event it was waiting for.
  await resolveRoutineAlerts(db, session, [animal.id], rule.routine, "DONE");

  const due = nextDueOn(rule, occurredOn);
  const message = due
    ? `${rule.label} given to ${nameOf(animal)}. Next one due ${plainDate(due)}.`
    : `${rule.label} given to ${nameOf(animal)}. Once in a lifetime — she never needs it again.`;

  const ref = await writeReceipt(db, session, {
    rowId: id,
    kind: "VACCINATION",
    summary: message,
    payload: { routine: rule.routine, animalId: animal.id, nextDueOn: due },
  });

  return actionOk(
    { id, animalName: nameOf(animal), routine: rule.routine, label: rule.label, nextDueOn: due, warnings, message },
    message,
    ref,
  );
}

const VaccinationForm = z.object({
  id: Uuid.optional(),
  animalId: Uuid,
  routine: z.string().min(1),
  occurredOn: IsoDate.optional(),
  productId: Uuid.optional(),
  batchNo: z.string().optional(),
  expiry: IsoDate.optional(),
  dose: z.string().optional(),
  costKes: z.string().optional(),
});

export async function recordVaccination(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<VaccinationResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("TREAT");
    const parsed = VaccinationForm.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const result = await recordVaccinationFor(session, parsed.data);
    if (result.ok) {
      updateTag(`health:${session.farmId}`);
      updateTag(`withdrawal:${session.farmId}`);
    }
    return result;
  });
}

/* ---------------------------------------------------------------- */
/* CMT — mastitis screening                                          */
/* ---------------------------------------------------------------- */

export type CmtScore = "N" | "T" | "1" | "2" | "3";

export interface CmtInput {
  id?: string;
  animalId: string;
  occurredOn?: ISODate;
  score: CmtScore;
  quartersTreated?: string[] | null;
  notes?: string | null;
}

const CMT_MEANING: Record<CmtScore, string> = {
  N: "Negative — nothing to do.",
  T: "Trace. Watch her; repeat in a week.",
  "1": "Weak positive — subclinical mastitis starting. Repeat in a week and check the milking routine.",
  "2": "Clear positive — subclinical mastitis. Milk her last, and talk to the vet.",
  "3": "Strong positive. Milk her last, keep her milk out of the tank and call the vet.",
};

/**
 * Mastitis is the most expensive disease on a Kenyan dairy — one study found
 * 80% of cows affected, 73% of it subclinical and therefore invisible without
 * a paddle. So the score comes back with what to do about it, at the moment of
 * entry, not in a monthly report.
 */
export async function recordCmtFor(
  session: Session,
  input: CmtInput,
  dbOverride?: DbLike,
): Promise<ActionResult<{ id: string; animalName: string; score: CmtScore; advice: string }>> {
  const db = await resolveDb(dbOverride);
  const animal = await requireAnimal(db, session, input.animalId);
  const occurredOn = input.occurredOn ?? today();

  const id = input.id ?? newId();
  await db
    .insert(s.healthEvent)
    .values({
      id,
      farmId: session.farmId,
      animalId: animal.id,
      eventType: "CMT",
      occurredOn,
      cmtScore: input.score,
      quartersTreated: input.quartersTreated ?? null,
      signs: input.notes ?? null,
      followUpOn: input.score === "N" ? null : addDays(occurredOn, 7),
      recordedBy: session.userId,
    })
    .onConflictDoNothing();

  const advice = CMT_MEANING[input.score];
  const ref = await writeReceipt(db, session, {
    rowId: id,
    kind: "CMT",
    summary: `${nameOf(animal)} CMT ${input.score} — ${advice}`,
  });

  return actionOk(
    { id, animalName: nameOf(animal), score: input.score, advice },
    `${nameOf(animal)}: ${advice}`,
    ref,
  );
}

const CmtForm = z.object({
  id: Uuid.optional(),
  animalId: Uuid,
  occurredOn: IsoDate.optional(),
  score: z.enum(["N", "T", "1", "2", "3"]),
  notes: z.string().optional(),
});

export async function recordCmt(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; animalName: string; score: CmtScore; advice: string }>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("RECORD");
    const parsed = CmtForm.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const quarters = formData.getAll("quartersTreated").map(String).filter(Boolean);
    const result = await recordCmtFor(session, {
      ...parsed.data,
      quartersTreated: quarters.length > 0 ? quarters : null,
    });
    if (result.ok) updateTag(`health:${session.farmId}`);
    return result;
  });
}

/* ---------------------------------------------------------------- */
/* What is due                                                       */
/* ---------------------------------------------------------------- */

export interface DueRoutine {
  animalId: string;
  animalName: string;
  routine: string;
  label: string;
  lastGivenOn: ISODate | null;
  dueOn: ISODate;
  overdueDays: number;
  note?: string;
}

/**
 * What the herd is due for, today. Weekly tick control dominates this list in
 * an ECF area, which is exactly the point — it is the routine most often let
 * slip and the disease that kills most improved stock.
 */
export async function dueRoutines(
  session: Session,
  asOf: ISODate = today(),
  dbOverride?: DbLike,
): Promise<DueRoutine[]> {
  const db = await resolveDb(dbOverride);

  const exited = new Set(
    (
      await db
        .select({ animalId: s.animalExit.animalId })
        .from(s.animalExit)
        .where(and(eq(s.animalExit.farmId, session.farmId), lte(s.animalExit.exitDate, asOf)))
    ).map((e) => e.animalId),
  );

  const animals = (
    await db
      .select({
        id: s.animal.id,
        name: s.animal.name,
        tag: s.animal.tag,
        sex: s.animal.sex,
        dateOfBirth: s.animal.dateOfBirth,
        // Needed to clamp first-dose due dates for bought-in adults.
        enteredHerdOn: s.animal.enteredHerdOn,
      })
      .from(s.animal)
      .where(eq(s.animal.farmId, session.farmId))
  ).filter((a) => !exited.has(a.id));

  const events = await db
    .select({
      animalId: s.healthEvent.animalId,
      // The routine column, not the free-text diagnosis. "Mastitis, left fore"
      // is a diagnosis; it is not a dose of anything and must not read as one.
      routine: s.healthEvent.routine,
      occurredOn: s.healthEvent.occurredOn,
    })
    .from(s.healthEvent)
    .where(and(eq(s.healthEvent.farmId, session.farmId), isNotNull(s.healthEvent.routine)))
    .orderBy(desc(s.healthEvent.occurredOn));

  const lastGiven = new Map<string, ISODate>();
  const givenCount = new Map<string, number>();
  for (const e of events) {
    if (!e.routine) continue;
    const key = `${e.animalId}:${e.routine}`;
    if (!lastGiven.has(key)) lastGiven.set(key, e.occurredOn);
    givenCount.set(key, (givenCount.get(key) ?? 0) + 1);
  }

  const out: DueRoutine[] = [];
  for (const animal of animals) {
    const days = ageDays(animal.dateOfBirth, asOf);
    for (const rule of KENYA_ROUTINES) {
      const key = `${animal.id}:${rule.routine}`;
      const last = lastGiven.get(key) ?? null;
      const count = givenCount.get(key) ?? 0;

      const eligibility = checkRoutineEligibility(rule, {
        sex: animal.sex,
        ageDays: days,
        alreadyGivenCount: count,
      });
      if (!eligibility.eligible) continue;

      /**
       * Never given: due as soon as she is old enough for the first dose — but
       * clamped to the day she joined this herd.
       *
       * Without the clamp, a five-year-old cow bought in last month reads as
       * "tick control, 2,267 days overdue", because she has no history HERE.
       * Technically true and completely useless: it floods the week's job list
       * with about nine items per animal and prints numbers no farmer can act
       * on. We are not responsible for doses her previous owner did or did not
       * give; we are responsible from the day she arrived.
       */
      const firstDoseDue =
        rule.firstDoseMinAgeDays != null && animal.dateOfBirth
          ? addDays(animal.dateOfBirth, rule.firstDoseMinAgeDays)
          : asOf;
      const dueOn = last
        ? nextDueOn(rule, last)
        : animal.enteredHerdOn && firstDoseDue < animal.enteredHerdOn
          ? animal.enteredHerdOn
          : firstDoseDue;
      if (!dueOn || dueOn > asOf) continue;

      out.push({
        animalId: animal.id,
        animalName: nameOf(animal),
        routine: rule.routine,
        label: rule.label,
        lastGivenOn: last,
        dueOn,
        overdueDays: Math.max(0, Math.round((Date.parse(asOf) - Date.parse(dueOn)) / 86_400_000)),
        note: rule.note,
      });
    }
  }
  return out.sort((a, b) => b.overdueDays - a.overdueDays);
}

/* ---------------------------------------------------------------- */
/* History                                                           */
/* ---------------------------------------------------------------- */

export interface HistoryEntry {
  id: string;
  occurredOn: ISODate;
  eventType: string;
  title: string;
  detail: string | null;
  productName: string | null;
  milkClearOn: ISODate | null;
  meatClearOn: ISODate | null;
  cmtScore: string | null;
  costKes: number | null;
}

export async function animalHealthHistory(
  session: Session,
  animalId: string,
  dbOverride?: DbLike,
): Promise<{ animalName: string; entries: HistoryEntry[]; status: AnimalWithdrawal | null }> {
  const db = await resolveDb(dbOverride);
  const animal = await requireAnimal(db, session, animalId);

  const rows = await db
    .select({
      id: s.healthEvent.id,
      occurredOn: s.healthEvent.occurredOn,
      eventType: s.healthEvent.eventType,
      signs: s.healthEvent.signs,
      diagnosis: s.healthEvent.diagnosis,
      routine: s.healthEvent.routine,
      dose: s.healthEvent.dose,
      cmtScore: s.healthEvent.cmtScore,
      costKes: s.healthEvent.costKes,
      milkClearAt: s.healthEvent.milkClearAt,
      meatClearAt: s.healthEvent.meatClearAt,
      productName: s.product.name,
    })
    .from(s.healthEvent)
    .leftJoin(s.product, eq(s.product.id, s.healthEvent.productId))
    .where(and(eq(s.healthEvent.farmId, session.farmId), eq(s.healthEvent.animalId, animal.id)))
    .orderBy(desc(s.healthEvent.occurredOn));

  const statuses = await getWithdrawalStatus(session, [animal.id], today(), db);

  const entries: HistoryEntry[] = rows.map((r) => {
    const rule = r.routine ? routineRule(r.routine) : undefined;
    const title = rule
      ? rule.label
      : r.eventType === "OBSERVATION"
        ? "Observation"
        : r.eventType === "CMT"
          ? `CMT ${r.cmtScore ?? ""}`.trim()
          : (r.productName ?? r.eventType);
    return {
      id: r.id,
      occurredOn: r.occurredOn,
      eventType: r.eventType,
      title,
      detail: r.signs ?? (rule ? null : r.diagnosis) ?? r.dose ?? null,
      productName: r.productName ?? null,
      milkClearOn: fromClearTimestamp(r.milkClearAt),
      meatClearOn: r.meatClearAt ?? null,
      cmtScore: r.cmtScore ?? null,
      costKes: r.costKes == null ? null : num(r.costKes),
    };
  });

  return { animalName: nameOf(animal), entries, status: statuses.get(animal.id) ?? null };
}
