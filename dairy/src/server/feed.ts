import "server-only";

/**
 * M5 — Feed & Inventory.
 *
 * Feed is 55–65% of production cost on a Kenyan intensive unit and the whole
 * margin is KES 8–20 a litre, so this module owns the single most useful number
 * in the system: **margin over feed cost**.
 *
 * Two conventions, both deliberate:
 *
 * 1. Every write has a `*For(session, input, db?)` core and a thin Server Action
 *    wrapper. The core is pure I/O against a database handle, which is what
 *    makes it testable with `createTestDb()`; the wrapper does capability,
 *    FormData parsing and cache invalidation. The `db` argument is LAST and
 *    optional so the live database is the default and tests pass a throwaway.
 *
 * 2. Actions carry an inline `"use server"` rather than a module-level
 *    directive. A module-level directive would turn *every* export here —
 *    including the session-taking query helpers — into a public RPC endpoint.
 *    Pages import this module and pass the action down to a client form as a
 *    prop.
 */

import { and, eq, gte, inArray, lte, isNull, isNotNull, desc } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { updateTag } from "next/cache";
import { z } from "zod";
import * as s from "@/db/schema";
import type { AnimalGroup, FeedCategory } from "@/db/schema";
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
import { costPerKg, costPerKgDm, dec, money, num, toKg } from "@/lib/money";
import { addDays, today, type ISODate } from "@/lib/domain/dates";
import {
  DEFAULT_CONCENTRATE_RULE,
  DEFAULT_UNIT_WEIGHT_KG,
  FEED_UNITS,
  UNIT_LABEL,
  acidosisRisk,
  concentrateForYield,
  dailyDmRequirementKg,
  dailyWaterRequirementL,
  daysOfCover,
  marginOverFeedCost as computeMarginOverFeedCost,
  requiresExplicitWeight,
  stockBalanceKg,
  type ConcentrateAdvice,
  type ConcentrateRule,
  type CoverResult,
  type FeedUnit,
  type MarginOverFeed,
} from "@/lib/domain/feed";

/* ---------------------------------------------------------------- */
/* Plumbing                                                          */
/* ---------------------------------------------------------------- */

/** Anything Drizzle-on-PGlite: the live `db` and `createTestDb()`'s handle. */
export type DbLike = PgliteDatabase<typeof s>;

/**
 * The live database, imported lazily. A static import would open PGlite the
 * moment any test imported this module.
 */
async function resolveDb(override?: DbLike): Promise<DbLike> {
  if (override) return override;
  const mod = await import("@/db");
  return mod.db as unknown as DbLike;
}

/** Trailing window used for burn rate, ration advice and prefill. */
export const BURN_RATE_DAYS = 7;
/** No weight on file and none supplied: the fallback used for DM/water advice. */
export const ASSUMED_COW_WEIGHT_KG = 450;

const FeedUnitEnum = z.enum(FEED_UNITS);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-08-03.");
const Uuid = z.string().uuid();

/* ---------------------------------------------------------------- */
/* THE UNIT RULE — the one legitimate hard block in this module      */
/* ---------------------------------------------------------------- */

export interface ResolvedWeight {
  ok: boolean;
  unitWeightKg: number;
  error?: string;
}

/**
 * Never accept a bag or a bale without knowing what it weighs.
 *
 * A Kenyan hay bale is quoted anywhere from 12 to 25 kg and a round bale runs
 * 300–500. A bale silently defaulting to 15 kg when it is really 25 corrupts
 * cost per kg, cost per litre and therefore the headline margin — permanently,
 * because the record is append-only. So for the units in
 * `requiresExplicitWeight()` a missing weight is refused, with a message that
 * says what to do.
 *
 * Resolution order, and the order matters:
 *   1. the weight typed on this line;
 *   2. the weight recorded against this feed, but ONLY when the line is in the
 *      feed's own unit — "a bale of THIS hay is 22 kg" says nothing about a
 *      kilogram, and letting it leak across units is how 56 kg of dairy meal
 *      becomes 3,920;
 *   3. the unit's own definition, for units that have one;
 *   4. refusal.
 */
export function resolveUnitWeightKg(
  unit: FeedUnit,
  supplied: number | string | null | undefined,
  item?: { defaultUnit: string; defaultUnitWeightKg: number | string | null } | null,
): ResolvedWeight {
  const explicit = supplied === null || supplied === undefined || supplied === "" ? null : num(supplied);
  if (explicit !== null && explicit > 0) return { ok: true, unitWeightKg: money(explicit) };

  const onItem =
    item && item.defaultUnit === unit && item.defaultUnitWeightKg != null
      ? num(item.defaultUnitWeightKg)
      : null;
  // Someone weighed a bale of this particular hay, on this farm. That counts as
  // explicit; a catalogue-wide guess does not.
  if (onItem !== null && onItem > 0) return { ok: true, unitWeightKg: money(onItem) };

  if (requiresExplicitWeight(unit)) {
    const one = UNIT_LABEL[unit].replace(/s$/, "");
    return {
      ok: false,
      unitWeightKg: 0,
      error: `Weigh one ${one} and enter the weight in kilograms. A ${one} is not a fixed size, and guessing it makes every cost figure wrong.`,
    };
  }

  const fallback = DEFAULT_UNIT_WEIGHT_KG[unit];
  if (fallback && fallback > 0) return { ok: true, unitWeightKg: fallback };
  return {
    ok: false,
    unitWeightKg: 0,
    error: "Enter the weight of one unit in kilograms.",
  };
}

/* ---------------------------------------------------------------- */
/* Receipts                                                          */
/* ---------------------------------------------------------------- */

async function writeReceipt(
  db: DbLike,
  session: Session,
  args: { kind: string; summary: string; payload?: unknown; rowId: string },
): Promise<string> {
  const ref = refCode(REF_PREFIX.FEED);
  const rows = await db
    .insert(s.receipt)
    .values({
      // Derived from the row it describes, so an offline replay of the same
      // save reuses the same receipt instead of minting a second one.
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

/* ---------------------------------------------------------------- */
/* Feed items                                                        */
/* ---------------------------------------------------------------- */

export interface CreateFeedItemInput {
  id?: string;
  name: string;
  category: FeedCategory;
  defaultUnit: FeedUnit;
  defaultUnitWeightKg?: number | string | null;
  dmPct?: number | string | null;
  cpPct?: number | string | null;
  homeGrown?: boolean;
}

export async function createFeedItemFor(
  session: Session,
  input: CreateFeedItemInput,
  dbOverride?: DbLike,
): Promise<ActionResult<{ id: string; unitWeightKg: number }>> {
  const db = await resolveDb(dbOverride);

  const weight = resolveUnitWeightKg(input.defaultUnit, input.defaultUnitWeightKg, null);
  if (!weight.ok) return actionError(weight.error!, { defaultUnitWeightKg: [weight.error!] });

  const id = input.id ?? newId();
  await db
    .insert(s.feedItem)
    .values({
      id,
      farmId: session.farmId,
      name: input.name,
      category: input.category,
      dmPct: input.dmPct == null || input.dmPct === "" ? null : dec(num(input.dmPct)),
      cpPct: input.cpPct == null || input.cpPct === "" ? null : dec(num(input.cpPct)),
      defaultUnit: input.defaultUnit,
      defaultUnitWeightKg: dec(weight.unitWeightKg, 3),
      homeGrown: input.homeGrown ?? false,
    })
    .onConflictDoNothing();

  return actionOk(
    { id, unitWeightKg: weight.unitWeightKg },
    `${input.name} added — 1 ${UNIT_LABEL[input.defaultUnit].replace(/s$/, "")} is ${weight.unitWeightKg} kg.`,
  );
}

const CreateFeedItemForm = z.object({
  id: Uuid.optional(),
  name: z.string().min(1, "Give the feed a name."),
  category: z.enum(s.FEED_CATEGORIES),
  defaultUnit: FeedUnitEnum,
  defaultUnitWeightKg: z.string().optional(),
  dmPct: z.string().optional(),
  cpPct: z.string().optional(),
  homeGrown: z.string().optional(),
});

export async function createFeedItem(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; unitWeightKg: number }>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("ADMIN");
    const parsed = CreateFeedItemForm.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const result = await createFeedItemFor(session, {
      ...parsed.data,
      homeGrown: parsed.data.homeGrown === "on" || parsed.data.homeGrown === "true",
    });
    if (result.ok) updateTag(`feed:${session.farmId}`);
    return result;
  });
}

/* ---------------------------------------------------------------- */
/* Purchases                                                         */
/* ---------------------------------------------------------------- */

export interface RecordPurchaseInput {
  id?: string;
  feedItemId: string;
  purchasedOn: ISODate;
  quantity: number | string;
  unit: FeedUnit;
  /** Required for BALE / HEADLOAD / WHEELBARROW / PICKUP_LOAD. */
  unitWeightKg?: number | string | null;
  unitPriceKes: number | string;
  supplierId?: string | null;
}

export interface PurchaseResult {
  id: string;
  totalKg: number;
  totalCostKes: number;
  costPerKgKes: number;
  balanceKg: number;
  receiptLines: string[];
}

export async function recordPurchaseFor(
  session: Session,
  input: RecordPurchaseInput,
  dbOverride?: DbLike,
): Promise<ActionResult<PurchaseResult>> {
  const db = await resolveDb(dbOverride);

  const [item] = await db
    .select()
    .from(s.feedItem)
    .where(and(eq(s.feedItem.id, input.feedItemId), eq(s.feedItem.farmId, session.farmId)));
  assertOwned(item, session, "feed");

  const weight = resolveUnitWeightKg(input.unit, input.unitWeightKg, item);
  if (!weight.ok) return actionError(weight.error!, { unitWeightKg: [weight.error!] });

  const quantity = num(input.quantity);
  if (quantity <= 0) {
    return actionError("Enter how much was bought.", { quantity: ["Enter how much was bought."] });
  }

  const unitPrice = num(input.unitPriceKes);
  const totalKg = toKg(quantity, weight.unitWeightKg);
  const totalCostKes = money(quantity * unitPrice);
  const perKg = costPerKg(totalCostKes, totalKg);

  const id = input.id ?? newId();
  await db
    .insert(s.feedPurchase)
    .values({
      id,
      farmId: session.farmId,
      feedItemId: item.id,
      supplierId: input.supplierId ?? null,
      purchasedOn: input.purchasedOn,
      quantity: dec(quantity, 3),
      unit: input.unit,
      unitWeightKg: dec(weight.unitWeightKg, 3),
      unitPriceKes: dec(unitPrice),
      totalCostKes: dec(totalCostKes),
      recordedBy: session.userId,
    })
    .onConflictDoNothing();

  const balanceKg = await stockBalance(session, item.id, db);

  const dmPct = num(item.dmPct);
  const receiptLines = [
    `${quantity} ${UNIT_LABEL[input.unit]} of ${item.name} at ${weight.unitWeightKg} kg each = ${totalKg} kg.`,
    `KES ${totalCostKes.toFixed(2)} — KES ${perKg.toFixed(2)} a kilo.`,
    dmPct > 0 ? `KES ${costPerKgDm(perKg, dmPct).toFixed(2)} per kg of dry matter.` : "",
    `Store now holds ${balanceKg} kg.`,
  ].filter(Boolean);

  const ref = await writeReceipt(db, session, {
    rowId: id,
    kind: "FEED_PURCHASE",
    summary: `${quantity} ${UNIT_LABEL[input.unit]} ${item.name}, ${totalKg} kg, KES ${totalCostKes.toFixed(2)}`,
    payload: { feedItemId: item.id, totalKg, perKg },
  });

  return actionOk(
    { id, totalKg, totalCostKes, costPerKgKes: perKg, balanceKg, receiptLines },
    `${item.name}: ${totalKg} kg in at KES ${perKg.toFixed(2)} a kilo.`,
    ref,
  );
}

const PurchaseForm = z.object({
  id: Uuid.optional(),
  feedItemId: Uuid,
  purchasedOn: IsoDate,
  quantity: z.string().min(1),
  unit: FeedUnitEnum,
  unitWeightKg: z.string().optional(),
  unitPriceKes: z.string().min(1),
  supplierId: Uuid.optional(),
});

export async function recordPurchase(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<PurchaseResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("MANAGE_MONEY");
    const parsed = PurchaseForm.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const result = await recordPurchaseFor(session, parsed.data);
    if (result.ok) updateTag(`feed:${session.farmId}`);
    return result;
  });
}

/* ---------------------------------------------------------------- */
/* Issues                                                            */
/* ---------------------------------------------------------------- */

export interface IssueLineInput {
  id?: string;
  feedItemId: string;
  quantity: number | string;
  unit?: FeedUnit | null;
  unitWeightKg?: number | string | null;
  animalGroup?: AnimalGroup | null;
  animalId?: string | null;
  animalsFed?: number | null;
}

export interface IssueResult {
  id: string;
  feedItemId: string;
  feedName: string;
  issuedKg: number;
  balanceKg: number;
  cover: CoverResult;
  /** "Dairy meal: 8 bags, 6 days left. Order by Friday." */
  line: string;
}

export async function recordIssueFor(
  session: Session,
  input: IssueLineInput & { issuedOn: ISODate },
  dbOverride?: DbLike,
): Promise<ActionResult<IssueResult>> {
  const db = await resolveDb(dbOverride);
  const result = await issueLines(db, session, input.issuedOn, [input]);
  if (!result.ok) return result;
  return actionOk(result.data.lines[0], result.data.message, result.refCode);
}

export interface IssueBatchResult {
  lines: IssueResult[];
  message: string;
}

/**
 * The daily issue. Prefilled from yesterday (R5) so an unchanged day is two
 * taps, and several feeds go in one submit because that is how the feeder
 * actually works — Napier, dairy meal and minerals in one pass.
 */
export async function recordIssuesFor(
  session: Session,
  input: { issuedOn: ISODate; lines: IssueLineInput[] },
  dbOverride?: DbLike,
): Promise<ActionResult<IssueBatchResult>> {
  const db = await resolveDb(dbOverride);
  return issueLines(db, session, input.issuedOn, input.lines);
}

async function issueLines(
  db: DbLike,
  session: Session,
  issuedOn: ISODate,
  lines: IssueLineInput[],
): Promise<ActionResult<IssueBatchResult>> {
  if (lines.length === 0) return actionError("Nothing to record — add at least one feed.");

  const items = await db
    .select()
    .from(s.feedItem)
    .where(
      and(
        eq(s.feedItem.farmId, session.farmId),
        inArray(s.feedItem.id, lines.map((l) => l.feedItemId)),
      ),
    );
  const byId = new Map(items.map((i) => [i.id, i]));

  // Validate every line before writing any of them: a half-saved feeding day is
  // worse than a rejected one.
  type Prepared = { line: IssueLineInput; item: typeof items[number]; unit: FeedUnit; unitWeightKg: number; quantity: number };
  const prepared: Prepared[] = [];
  for (const line of lines) {
    const item = assertOwned(byId.get(line.feedItemId), session, "feed");
    const unit = (line.unit ?? item.defaultUnit) as FeedUnit;
    const weight = resolveUnitWeightKg(unit, line.unitWeightKg, item);
    if (!weight.ok) return actionError(`${item.name}: ${weight.error!}`, { unitWeightKg: [weight.error!] });
    const quantity = num(line.quantity);
    if (quantity < 0) return actionError(`${item.name}: an amount cannot be less than zero.`);
    if (line.animalId) {
      const [animal] = await db
        .select()
        .from(s.animal)
        .where(and(eq(s.animal.id, line.animalId), eq(s.animal.farmId, session.farmId)));
      assertOwned(animal, session, "animal");
    }
    prepared.push({ line, item, unit, unitWeightKg: weight.unitWeightKg, quantity });
  }

  const out: IssueResult[] = [];
  const ids: string[] = [];
  for (const p of prepared) {
    if (p.quantity === 0) continue; // A zero line means "not fed today". Nothing to store.
    const id = p.line.id ?? newId();
    ids.push(id);
    await db
      .insert(s.feedIssue)
      .values({
        id,
        farmId: session.farmId,
        feedItemId: p.item.id,
        issuedOn,
        animalGroup: p.line.animalGroup ?? (p.line.animalId ? null : "ALL"),
        animalId: p.line.animalId ?? null,
        quantity: dec(p.quantity, 3),
        unit: p.unit,
        unitWeightKg: dec(p.unitWeightKg, 3),
        animalsFed: p.line.animalsFed ?? null,
        recordedBy: session.userId,
      })
      .onConflictDoNothing();

    const issuedKg = toKg(p.quantity, p.unitWeightKg);
    const balanceKg = await stockBalance(session, p.item.id, db);
    const cover = await daysOfCoverFor(session, p.item.id, issuedOn, db);
    out.push({
      id,
      feedItemId: p.item.id,
      feedName: p.item.name,
      issuedKg,
      balanceKg,
      cover,
      line: describeStock(p.item.name, balanceKg, p.item.defaultUnit as FeedUnit, p.item.defaultUnitWeightKg, cover),
    });
  }

  if (out.length === 0) return actionError("Nothing to record — every amount was zero.");

  const message = out.map((l) => l.line).join(" ");
  const ref = await writeReceipt(db, session, {
    rowId: ids[0],
    kind: "FEED_ISSUE",
    summary: out.map((l) => `${l.feedName} ${l.issuedKg} kg`).join(", "),
    payload: { issuedOn, lines: out.map((l) => ({ feedItemId: l.feedItemId, kg: l.issuedKg })) },
  });

  return actionOk({ lines: out, message }, message, ref);
}

/** "Dairy meal: 8 bags, 6 days left. Order by Friday." */
export function describeStock(
  name: string,
  balanceKg: number,
  unit: FeedUnit,
  unitWeightKg: number | string | null,
  cover: CoverResult,
): string {
  const w = num(unitWeightKg) || DEFAULT_UNIT_WEIGHT_KG[unit] || 1;
  const inUnits = money(balanceKg / w);
  const qty = unit === "KG" ? `${balanceKg} kg` : `${inUnits} ${UNIT_LABEL[unit]} (${balanceKg} kg)`;
  return `${name}: ${qty}, ${cover.message}`;
}

const IssueForm = z.object({
  id: Uuid.optional(),
  feedItemId: Uuid,
  issuedOn: IsoDate,
  quantity: z.string().min(1),
  unit: FeedUnitEnum.optional(),
  unitWeightKg: z.string().optional(),
  animalGroup: z.enum(s.ANIMAL_GROUPS).optional(),
  animalId: Uuid.optional(),
  animalsFed: z.coerce.number().int().min(0).optional(),
});

export async function recordIssue(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<IssueResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("RECORD");
    const raw = Object.fromEntries(formData);
    const parsed = IssueForm.safeParse(raw);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const result = await recordIssueFor(session, parsed.data);
    if (result.ok) updateTag(`feed:${session.farmId}`);
    return result;
  });
}

/**
 * The whole day's feeding in one submit: the /feed/issue screen posts every
 * prefilled line at once, so an unchanged day really is two taps (R2).
 */
export async function recordIssues(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<IssueBatchResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("RECORD");
    const issuedOn = String(formData.get("issuedOn") ?? today());
    if (!IsoDate.safeParse(issuedOn).success) return actionError("Use a date like 2026-08-03.");
    const group = formData.get("animalGroup");

    const feedItemIds = formData.getAll("feedItemId").map(String);
    const quantities = formData.getAll("quantity").map(String);
    const units = formData.getAll("unit").map(String);
    const unitWeights = formData.getAll("unitWeightKg").map(String);
    const lineIds = formData.getAll("lineId").map(String);

    const lines: IssueLineInput[] = feedItemIds.map((feedItemId, i) => ({
      id: Uuid.safeParse(lineIds[i]).success ? lineIds[i] : undefined,
      feedItemId,
      quantity: quantities[i] ?? "0",
      unit: FeedUnitEnum.safeParse(units[i]).success ? (units[i] as FeedUnit) : null,
      unitWeightKg: unitWeights[i] ?? null,
      animalGroup: (group ? String(group) : "ALL") as AnimalGroup,
    }));

    const result = await recordIssuesFor(session, { issuedOn, lines });
    if (result.ok) updateTag(`feed:${session.farmId}`);
    return result;
  });
}

/* ---------------------------------------------------------------- */
/* Stock, cover, the store screen                                    */
/* ---------------------------------------------------------------- */

export async function stockBalance(
  session: Session,
  feedItemId: string,
  dbOverride?: DbLike,
): Promise<number> {
  const db = await resolveDb(dbOverride);
  const purchases = await db
    .select({ quantity: s.feedPurchase.quantity, unitWeightKg: s.feedPurchase.unitWeightKg })
    .from(s.feedPurchase)
    .where(and(eq(s.feedPurchase.farmId, session.farmId), eq(s.feedPurchase.feedItemId, feedItemId)));
  const issues = await db
    .select({ quantity: s.feedIssue.quantity, unitWeightKg: s.feedIssue.unitWeightKg })
    .from(s.feedIssue)
    .where(and(eq(s.feedIssue.farmId, session.farmId), eq(s.feedIssue.feedItemId, feedItemId)));
  return stockBalanceKg(purchases, issues);
}

/** Days of cover at the trailing 7-day burn rate. */
export async function daysOfCoverFor(
  session: Session,
  feedItemId: string,
  asOf: ISODate = today(),
  dbOverride?: DbLike,
  windowDays: number = BURN_RATE_DAYS,
): Promise<CoverResult> {
  const db = await resolveDb(dbOverride);
  const from = addDays(asOf, -(windowDays - 1));
  const recent = await db
    .select({ quantity: s.feedIssue.quantity, unitWeightKg: s.feedIssue.unitWeightKg })
    .from(s.feedIssue)
    .where(
      and(
        eq(s.feedIssue.farmId, session.farmId),
        eq(s.feedIssue.feedItemId, feedItemId),
        gte(s.feedIssue.issuedOn, from),
        lte(s.feedIssue.issuedOn, asOf),
      ),
    );
  const issuedKg = recent.reduce((a, r) => a + toKg(r.quantity, r.unitWeightKg), 0);
  const balanceKg = await stockBalance(session, feedItemId, db);
  return daysOfCover(balanceKg, money(issuedKg), windowDays);
}

/** The catalogue, for the pickers on the purchase and issue screens. */
export async function listFeedItems(session: Session, dbOverride?: DbLike) {
  const db = await resolveDb(dbOverride);
  return db
    .select()
    .from(s.feedItem)
    .where(eq(s.feedItem.farmId, session.farmId))
    .orderBy(s.feedItem.category, s.feedItem.name);
}

export interface StoreLine {
  feedItemId: string;
  name: string;
  category: FeedCategory;
  unit: FeedUnit;
  unitWeightKg: number;
  balanceKg: number;
  balanceInUnits: number;
  costPerKgKes: number;
  costPerKgDmKes: number | null;
  cover: CoverResult;
  line: string;
}

/** The /feed screen: what is in the store and how long it lasts. */
export async function feedStore(
  session: Session,
  asOf: ISODate = today(),
  dbOverride?: DbLike,
): Promise<StoreLine[]> {
  const db = await resolveDb(dbOverride);
  const items = await db
    .select()
    .from(s.feedItem)
    .where(eq(s.feedItem.farmId, session.farmId));

  const costs = await costPerKgByItem(session, asOf, db);
  const out: StoreLine[] = [];
  for (const item of items) {
    const unit = item.defaultUnit as FeedUnit;
    const unitWeightKg = num(item.defaultUnitWeightKg) || DEFAULT_UNIT_WEIGHT_KG[unit] || 1;
    const balanceKg = await stockBalance(session, item.id, db);
    const cover = await daysOfCoverFor(session, item.id, asOf, db);
    const perKg = costs.get(item.id) ?? 0;
    const dmPct = num(item.dmPct);
    out.push({
      feedItemId: item.id,
      name: item.name,
      category: item.category,
      unit,
      unitWeightKg,
      balanceKg,
      balanceInUnits: money(balanceKg / unitWeightKg),
      costPerKgKes: perKg,
      costPerKgDmKes: dmPct > 0 && perKg > 0 ? costPerKgDm(perKg, dmPct) : null,
      cover,
      line: describeStock(item.name, balanceKg, unit, unitWeightKg, cover),
    });
  }
  // Whatever is closest to running out goes first — that is the action.
  return out.sort((a, b) => (a.cover.daysOfCover ?? 9e9) - (b.cover.daysOfCover ?? 9e9));
}

/**
 * Weighted average cost per kilo, per feed, from every purchase up to `asOf`.
 *
 * Weighted average rather than FIFO on purpose: feed is fungible in a store, a
 * farm cannot tell you which bag came from which delivery, and FIFO would give
 * a precision the underlying records do not have.
 */
export async function costPerKgByItem(
  session: Session,
  asOf: ISODate = today(),
  dbOverride?: DbLike,
): Promise<Map<string, number>> {
  const db = await resolveDb(dbOverride);
  const rows = await db
    .select({
      feedItemId: s.feedPurchase.feedItemId,
      quantity: s.feedPurchase.quantity,
      unitWeightKg: s.feedPurchase.unitWeightKg,
      totalCostKes: s.feedPurchase.totalCostKes,
    })
    .from(s.feedPurchase)
    .where(and(eq(s.feedPurchase.farmId, session.farmId), lte(s.feedPurchase.purchasedOn, asOf)));

  const acc = new Map<string, { kg: number; kes: number }>();
  for (const r of rows) {
    const cur = acc.get(r.feedItemId) ?? { kg: 0, kes: 0 };
    cur.kg += toKg(r.quantity, r.unitWeightKg);
    cur.kes += num(r.totalCostKes);
    acc.set(r.feedItemId, cur);
  }
  const out = new Map<string, number>();
  for (const [id, v] of acc) out.set(id, costPerKg(v.kes, v.kg));
  return out;
}

/* ---------------------------------------------------------------- */
/* MARGIN OVER FEED COST — the headline number                       */
/* ---------------------------------------------------------------- */

export interface MarginBreakdown extends MarginOverFeed {
  from: ISODate;
  to: ISODate;
  /** Litres that left the farm through a paying channel. */
  soldLitres: number;
  soldRevenueKes: number;
  /** Home use, calves and staff ration — valued at market price, never paid. */
  imputedLitres: number;
  imputedValueKes: number;
  /** Spillage, spoilage, rejections, withheld milk. */
  lossLitres: number;
  /** Feeds issued in the period with no purchase history to cost them against. */
  uncostedFeeds: string[];
  perFeed: Array<{ feedItemId: string; name: string; kg: number; costKes: number }>;
}

/**
 * Margin over feed cost for a period.
 *
 * Litres are what the parlour recorded; value is what the milk was worth,
 * counting home consumption, calf feeding and the staff ration at their imputed
 * market price. Valuing only the milk that was sold, against every litre
 * produced, would understate the margin on every farm that drinks its own milk
 * — which is all of them.
 *
 * Feed cost is issues in the period, each costed at the weighted average price
 * per kilo of that feed. Home-grown fodder with no purchase history costs
 * nothing here and is named in `uncostedFeeds` so the number is never quietly
 * flattering.
 */
export async function marginOverFeedCost(
  session: Session,
  from: ISODate,
  to: ISODate,
  dbOverride?: DbLike,
): Promise<MarginBreakdown> {
  const db = await resolveDb(dbOverride);

  /* Feed cost ------------------------------------------------------ */
  const issues = await db
    .select({
      feedItemId: s.feedIssue.feedItemId,
      quantity: s.feedIssue.quantity,
      unitWeightKg: s.feedIssue.unitWeightKg,
    })
    .from(s.feedIssue)
    .where(
      and(
        eq(s.feedIssue.farmId, session.farmId),
        gte(s.feedIssue.issuedOn, from),
        lte(s.feedIssue.issuedOn, to),
      ),
    );

  const costs = await costPerKgByItem(session, to, db);
  const names = new Map(
    (await db.select({ id: s.feedItem.id, name: s.feedItem.name }).from(s.feedItem).where(eq(s.feedItem.farmId, session.farmId)))
      .map((i) => [i.id, i.name] as const),
  );

  const perFeedAcc = new Map<string, { kg: number; kes: number }>();
  for (const i of issues) {
    const kg = toKg(i.quantity, i.unitWeightKg);
    const cur = perFeedAcc.get(i.feedItemId) ?? { kg: 0, kes: 0 };
    cur.kg += kg;
    cur.kes += kg * (costs.get(i.feedItemId) ?? 0);
    perFeedAcc.set(i.feedItemId, cur);
  }

  const perFeed = [...perFeedAcc].map(([feedItemId, v]) => ({
    feedItemId,
    name: names.get(feedItemId) ?? "Unknown feed",
    kg: money(v.kg),
    costKes: money(v.kes),
  }));
  const uncostedFeeds = perFeed.filter((f) => f.kg > 0 && f.costKes === 0).map((f) => f.name);
  const feedCostKes = money(perFeed.reduce((a, f) => a + f.costKes, 0));

  /* Milk ----------------------------------------------------------- */
  const litres = await litresProduced(session, from, to, db);

  const disposals = await db
    .select({
      channel: s.milkDisposal.channel,
      litres: s.milkDisposal.litres,
      valueKes: s.milkDisposal.valueKes,
      rateKesPerLitre: s.milkDisposal.rateKesPerLitre,
    })
    .from(s.milkDisposal)
    .where(
      and(
        eq(s.milkDisposal.farmId, session.farmId),
        gte(s.milkDisposal.disposedOn, from),
        lte(s.milkDisposal.disposedOn, to),
      ),
    );

  const REVENUE = new Set<string>(s.REVENUE_CHANNELS);
  const LOSS = new Set<string>(s.LOSS_CHANNELS);

  let soldLitres = 0;
  let soldRevenueKes = 0;
  let imputedLitres = 0;
  let imputedValueKes = 0;
  let lossLitres = 0;

  for (const d of disposals) {
    const l = num(d.litres);
    const value = d.valueKes != null ? num(d.valueKes) : money(l * num(d.rateKesPerLitre));
    if (REVENUE.has(d.channel)) {
      soldLitres += l;
      soldRevenueKes += value;
    } else if (LOSS.has(d.channel)) {
      lossLitres += l;
    } else {
      imputedLitres += l;
      imputedValueKes += value;
    }
  }

  const base = computeMarginOverFeedCost(money(soldRevenueKes + imputedValueKes), feedCostKes, litres);

  return {
    ...base,
    from,
    to,
    soldLitres: money(soldLitres),
    soldRevenueKes: money(soldRevenueKes),
    imputedLitres: money(imputedLitres),
    imputedValueKes: money(imputedValueKes),
    lossLitres: money(lossLitres),
    uncostedFeeds,
    perFeed: perFeed.sort((a, b) => b.costKes - a.costKes),
  };
}

/**
 * Litres produced in a period, ignoring rows that a later correction replaced.
 * Corrections are new rows (P3), so the superseded original must not be counted
 * twice — that would inflate litres and flatter the margin.
 */
export async function litresProduced(
  session: Session,
  from: ISODate,
  to: ISODate,
  dbOverride?: DbLike,
  animalId?: string,
): Promise<number> {
  const db = await resolveDb(dbOverride);
  const superseded = await db
    .select({ id: s.milkRecord.supersedesId })
    .from(s.milkRecord)
    .where(and(eq(s.milkRecord.farmId, session.farmId), isNotNull(s.milkRecord.supersedesId)));
  const replaced = new Set(superseded.map((r) => r.id).filter(Boolean) as string[]);

  const rows = await db
    .select({ id: s.milkRecord.id, litres: s.milkRecord.litres })
    .from(s.milkRecord)
    .where(
      and(
        eq(s.milkRecord.farmId, session.farmId),
        gte(s.milkRecord.recordedOn, from),
        lte(s.milkRecord.recordedOn, to),
        animalId ? eq(s.milkRecord.animalId, animalId) : undefined,
      ),
    );
  return money(rows.filter((r) => !replaced.has(r.id)).reduce((a, r) => a + num(r.litres), 0));
}

/* ---------------------------------------------------------------- */
/* Ration advice                                                     */
/* ---------------------------------------------------------------- */

export interface RationAdvice {
  scope: "ANIMAL" | "GROUP";
  animalId?: string;
  animalName?: string;
  group?: AnimalGroup;
  /** Head counted for a group figure. */
  animals: number;
  dailyYieldL: number;
  bodyweightKg: number;
  bodyweightAssumed: boolean;
  concentrate: ConcentrateAdvice;
  dmRequirementKg: number;
  waterRequirementL: number;
  concentratePctOfDm: number | null;
  acidosis: { risk: boolean; message?: string };
  /** Everything worth saying, in order, in plain language. */
  notes: string[];
}

/**
 * What to feed her, from what she is actually giving.
 *
 * Challenge feeding — 1 kg of dairy meal per extra 1.5 L above 8 litres — is a
 * configurable rule with a default, because Kenyan farmers also quote 1 kg per
 * 2 L and 1 kg per 3 L and the sources genuinely disagree.
 */
export async function rationAdvice(
  session: Session,
  target: { animalId?: string; group?: AnimalGroup },
  asOf: ISODate = today(),
  dbOverride?: DbLike,
  rule: ConcentrateRule = DEFAULT_CONCENTRATE_RULE,
): Promise<RationAdvice> {
  const db = await resolveDb(dbOverride);
  const from = addDays(asOf, -(BURN_RATE_DAYS - 1));

  let animalId: string | undefined;
  let animalName: string | undefined;
  let group: AnimalGroup | undefined;
  let animals = 1;
  let dailyYieldL = 0;
  let bodyweightKg = ASSUMED_COW_WEIGHT_KG;
  let bodyweightAssumed = true;

  if (target.animalId) {
    const [animal] = await db
      .select()
      .from(s.animal)
      .where(and(eq(s.animal.id, target.animalId), eq(s.animal.farmId, session.farmId)));
    assertOwned(animal, session, "animal");
    animalId = animal.id;
    animalName = animal.name ?? animal.tag;

    const litres = await litresProduced(session, from, asOf, db, animal.id);
    dailyYieldL = money(litres / BURN_RATE_DAYS);

    const [weight] = await db
      .select({ weightKg: s.weightObservation.weightKg })
      .from(s.weightObservation)
      .where(and(eq(s.weightObservation.farmId, session.farmId), eq(s.weightObservation.animalId, animal.id)))
      .orderBy(desc(s.weightObservation.observedOn))
      .limit(1);
    if (weight?.weightKg != null && num(weight.weightKg) > 0) {
      bodyweightKg = num(weight.weightKg);
      bodyweightAssumed = false;
    }
  } else {
    group = target.group ?? "LACTATING";
    // Head count and yield come from what was actually milked in the window.
    // Class derivation lives in M1; this stays inside the feed module's own
    // evidence so the two never disagree about who is milking today.
    const rows = await db
      .select({ animalId: s.milkRecord.animalId, litres: s.milkRecord.litres })
      .from(s.milkRecord)
      .where(
        and(
          eq(s.milkRecord.farmId, session.farmId),
          gte(s.milkRecord.recordedOn, from),
          lte(s.milkRecord.recordedOn, asOf),
        ),
      );
    const ids = new Set(rows.map((r) => r.animalId));
    animals = Math.max(1, ids.size);
    const totalL = rows.reduce((a, r) => a + num(r.litres), 0);
    dailyYieldL = money(totalL / BURN_RATE_DAYS / animals);
  }

  const groupForDm: AnimalGroup = group ?? "LACTATING";
  const concentrate = concentrateForYield(dailyYieldL, rule);
  const dmRequirementKg = dailyDmRequirementKg(bodyweightKg, groupForDm);
  const waterRequirementL = dailyWaterRequirementL(bodyweightKg, dailyYieldL);

  /* What the ration actually looks like, from the issue records. */
  const issued = await db
    .select({
      category: s.feedItem.category,
      dmPct: s.feedItem.dmPct,
      quantity: s.feedIssue.quantity,
      unitWeightKg: s.feedIssue.unitWeightKg,
    })
    .from(s.feedIssue)
    .innerJoin(s.feedItem, eq(s.feedItem.id, s.feedIssue.feedItemId))
    .where(
      and(
        eq(s.feedIssue.farmId, session.farmId),
        gte(s.feedIssue.issuedOn, from),
        lte(s.feedIssue.issuedOn, asOf),
        animalId ? eq(s.feedIssue.animalId, animalId) : undefined,
      ),
    );

  let dmTotal = 0;
  let dmConcentrate = 0;
  for (const r of issued) {
    const kg = toKg(r.quantity, r.unitWeightKg);
    const dm = kg * (num(r.dmPct) > 0 ? num(r.dmPct) / 100 : 1);
    dmTotal += dm;
    if (r.category === "CONCENTRATE") dmConcentrate += dm;
  }
  const concentratePctOfDm = dmTotal > 0 ? money((dmConcentrate / dmTotal) * 100) : null;
  const acidosis = acidosisRisk(concentratePctOfDm ?? 0);

  const who = animalName ?? `the ${(group ?? "LACTATING").toLowerCase()} group`;
  const notes: string[] = [];
  notes.push(
    dailyYieldL > 0
      ? `${who} is giving about ${dailyYieldL} litres a day.`
      : `No milk recorded for ${who} in the last ${BURN_RATE_DAYS} days.`,
  );
  notes.push(concentrate.note);
  notes.push(
    `She needs about ${dmRequirementKg} kg of dry matter and ${waterRequirementL} litres of water a day${
      bodyweightAssumed ? ` (assuming ${bodyweightKg} kg — weigh her to get this right)` : ""
    }.`,
  );
  if (acidosis.message) notes.push(acidosis.message);
  else if (concentratePctOfDm !== null) {
    notes.push(`Concentrate is ${Math.round(concentratePctOfDm)}% of the ration. The Kenyan guideline is 30%.`);
  }

  return {
    scope: animalId ? "ANIMAL" : "GROUP",
    animalId,
    animalName,
    group,
    animals,
    dailyYieldL,
    bodyweightKg,
    bodyweightAssumed,
    concentrate,
    dmRequirementKg,
    waterRequirementL,
    concentratePctOfDm,
    acidosis,
    notes,
  };
}

/* ---------------------------------------------------------------- */
/* Prefill (R5) — a normal day is two taps                           */
/* ---------------------------------------------------------------- */

export interface PrefillLine {
  feedItemId: string;
  name: string;
  category: FeedCategory;
  unit: FeedUnit;
  unitWeightKg: number;
  quantity: number;
  animalGroup: AnimalGroup | null;
  animalsFed: number | null;
  /** Always labelled as a prefill — never presented as this morning's fact. */
  prefilledFrom: ISODate | null;
}

/**
 * Yesterday's issue, offered as today's starting point and labelled as such
 * (R5). Quantities are prefilled because they are a measured routine; money and
 * drug doses never are.
 */
export async function issuePrefill(
  session: Session,
  asOf: ISODate = today(),
  dbOverride?: DbLike,
): Promise<PrefillLine[]> {
  const db = await resolveDb(dbOverride);
  const items = await db.select().from(s.feedItem).where(eq(s.feedItem.farmId, session.farmId));

  const out: PrefillLine[] = [];
  for (const item of items) {
    const [last] = await db
      .select()
      .from(s.feedIssue)
      .where(
        and(
          eq(s.feedIssue.farmId, session.farmId),
          eq(s.feedIssue.feedItemId, item.id),
          lte(s.feedIssue.issuedOn, addDays(asOf, -1)),
          isNull(s.feedIssue.animalId),
        ),
      )
      .orderBy(desc(s.feedIssue.issuedOn))
      .limit(1);

    const unit = (last?.unit ?? item.defaultUnit) as FeedUnit;
    out.push({
      feedItemId: item.id,
      name: item.name,
      category: item.category,
      unit,
      unitWeightKg: num(last?.unitWeightKg ?? item.defaultUnitWeightKg) || DEFAULT_UNIT_WEIGHT_KG[unit] || 1,
      quantity: last ? num(last.quantity) : 0,
      animalGroup: (last?.animalGroup as AnimalGroup | null) ?? null,
      animalsFed: last?.animalsFed ?? null,
      prefilledFrom: last?.issuedOn ?? null,
    });
  }
  return out;
}

/* ---------------------------------------------------------------- */
/* Fodder production                                                 */
/* ---------------------------------------------------------------- */

export interface FodderInput {
  id?: string;
  plotName?: string | null;
  crop: string;
  areaAcres?: number | string | null;
  plantedOn?: ISODate | null;
  harvestedOn?: ISODate | null;
  quantity?: number | string | null;
  unit?: FeedUnit | null;
  unitWeightKg?: number | string | null;
  inputCostKes?: number | string | null;
}

export interface FodderRow {
  id: string;
  plotName: string | null;
  crop: string;
  areaAcres: number | null;
  plantedOn: ISODate | null;
  harvestedOn: ISODate | null;
  quantity: number | null;
  unit: FeedUnit | null;
  unitWeightKg: number | null;
  totalKg: number | null;
  inputCostKes: number | null;
  costPerKgKes: number | null;
  yieldTonnesPerAcre: number | null;
}

export async function recordFodderProductionFor(
  session: Session,
  input: FodderInput,
  dbOverride?: DbLike,
): Promise<ActionResult<{ id: string; totalKg: number | null; costPerKgKes: number | null }>> {
  const db = await resolveDb(dbOverride);

  let unitWeightKg: number | null = null;
  if (input.unit && input.quantity != null && input.quantity !== "") {
    // Home-grown fodder is measured in headloads and pickup loads more often
    // than anything else, so the weight rule bites hardest here.
    const weight = resolveUnitWeightKg(input.unit, input.unitWeightKg, null);
    if (!weight.ok) return actionError(weight.error!, { unitWeightKg: [weight.error!] });
    unitWeightKg = weight.unitWeightKg;
  }

  const id = input.id ?? newId();
  await db
    .insert(s.fodderProduction)
    .values({
      id,
      farmId: session.farmId,
      plotName: input.plotName ?? null,
      crop: input.crop,
      areaAcres: input.areaAcres == null || input.areaAcres === "" ? null : dec(num(input.areaAcres), 3),
      plantedOn: input.plantedOn ?? null,
      harvestedOn: input.harvestedOn ?? null,
      quantity: input.quantity == null || input.quantity === "" ? null : dec(num(input.quantity), 3),
      unit: input.unit ?? null,
      unitWeightKg: unitWeightKg == null ? null : dec(unitWeightKg, 3),
      inputCostKes: input.inputCostKes == null || input.inputCostKes === "" ? null : dec(num(input.inputCostKes)),
    })
    .onConflictDoNothing();

  const totalKg = unitWeightKg != null && input.quantity != null ? toKg(input.quantity, unitWeightKg) : null;
  const cost = input.inputCostKes == null || input.inputCostKes === "" ? null : num(input.inputCostKes);
  const perKg = totalKg && cost != null ? costPerKg(cost, totalKg) : null;

  const ref = await writeReceipt(db, session, {
    rowId: id,
    kind: "FODDER",
    summary: `${input.crop}${input.plotName ? ` on ${input.plotName}` : ""}${totalKg ? `, ${totalKg} kg` : ""}`,
    payload: { totalKg, perKg },
  });

  return actionOk(
    { id, totalKg, costPerKgKes: perKg },
    perKg != null
      ? `${input.crop} recorded — ${totalKg} kg grown at KES ${perKg.toFixed(2)} a kilo.`
      : `${input.crop} recorded.`,
    ref,
  );
}

export async function listFodderProduction(
  session: Session,
  dbOverride?: DbLike,
): Promise<FodderRow[]> {
  const db = await resolveDb(dbOverride);
  const rows = await db
    .select()
    .from(s.fodderProduction)
    .where(eq(s.fodderProduction.farmId, session.farmId))
    .orderBy(desc(s.fodderProduction.harvestedOn));

  return rows.map((r) => {
    const quantity = r.quantity == null ? null : num(r.quantity);
    const unitWeightKg = r.unitWeightKg == null ? null : num(r.unitWeightKg);
    const totalKg = quantity != null && unitWeightKg != null ? toKg(quantity, unitWeightKg) : null;
    const inputCostKes = r.inputCostKes == null ? null : num(r.inputCostKes);
    const areaAcres = r.areaAcres == null ? null : num(r.areaAcres);
    return {
      id: r.id,
      plotName: r.plotName,
      crop: r.crop,
      areaAcres,
      plantedOn: r.plantedOn,
      harvestedOn: r.harvestedOn,
      quantity,
      unit: (r.unit as FeedUnit | null) ?? null,
      unitWeightKg,
      totalKg,
      inputCostKes,
      costPerKgKes: totalKg && inputCostKes != null ? costPerKg(inputCostKes, totalKg) : null,
      yieldTonnesPerAcre: totalKg && areaAcres ? money(totalKg / 1000 / areaAcres) : null,
    };
  });
}

export async function updateFodderProductionFor(
  session: Session,
  id: string,
  patch: Partial<FodderInput>,
  dbOverride?: DbLike,
): Promise<ActionResult<{ id: string }>> {
  const db = await resolveDb(dbOverride);
  const [row] = await db
    .select()
    .from(s.fodderProduction)
    .where(and(eq(s.fodderProduction.id, id), eq(s.fodderProduction.farmId, session.farmId)));
  assertOwned(row, session, "fodder record");

  const unit = (patch.unit ?? row.unit) as FeedUnit | null;
  let unitWeightKg = row.unitWeightKg;
  if (unit && (patch.unitWeightKg != null || patch.unit)) {
    const weight = resolveUnitWeightKg(unit, patch.unitWeightKg ?? row.unitWeightKg, null);
    if (!weight.ok) return actionError(weight.error!, { unitWeightKg: [weight.error!] });
    unitWeightKg = dec(weight.unitWeightKg, 3);
  }

  await db
    .update(s.fodderProduction)
    .set({
      plotName: patch.plotName ?? row.plotName,
      crop: patch.crop ?? row.crop,
      areaAcres: patch.areaAcres == null ? row.areaAcres : dec(num(patch.areaAcres), 3),
      plantedOn: patch.plantedOn ?? row.plantedOn,
      harvestedOn: patch.harvestedOn ?? row.harvestedOn,
      quantity: patch.quantity == null ? row.quantity : dec(num(patch.quantity), 3),
      unit: unit ?? null,
      unitWeightKg,
      inputCostKes: patch.inputCostKes == null ? row.inputCostKes : dec(num(patch.inputCostKes)),
    })
    .where(and(eq(s.fodderProduction.id, id), eq(s.fodderProduction.farmId, session.farmId)));

  return actionOk({ id }, "Fodder record updated.");
}

export async function deleteFodderProductionFor(
  session: Session,
  id: string,
  dbOverride?: DbLike,
): Promise<ActionResult<{ id: string }>> {
  const db = await resolveDb(dbOverride);
  const [row] = await db
    .select()
    .from(s.fodderProduction)
    .where(and(eq(s.fodderProduction.id, id), eq(s.fodderProduction.farmId, session.farmId)));
  assertOwned(row, session, "fodder record");
  await db
    .delete(s.fodderProduction)
    .where(and(eq(s.fodderProduction.id, id), eq(s.fodderProduction.farmId, session.farmId)));
  return actionOk({ id }, "Fodder record removed.");
}

const FodderForm = z.object({
  id: Uuid.optional(),
  plotName: z.string().optional(),
  crop: z.string().min(1, "Which crop?"),
  areaAcres: z.string().optional(),
  plantedOn: IsoDate.optional(),
  harvestedOn: IsoDate.optional(),
  quantity: z.string().optional(),
  unit: FeedUnitEnum.optional(),
  unitWeightKg: z.string().optional(),
  inputCostKes: z.string().optional(),
});

export async function recordFodderProduction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; totalKg: number | null; costPerKgKes: number | null }>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("RECORD");
    const parsed = FodderForm.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const result = await recordFodderProductionFor(session, parsed.data);
    if (result.ok) updateTag(`feed:${session.farmId}`);
    return result;
  });
}

export async function deleteFodderProduction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("ADMIN");
    const id = String(formData.get("id") ?? "");
    if (!Uuid.safeParse(id).success) return actionError("That fodder record was not found.");
    const result = await deleteFodderProductionFor(session, id);
    if (result.ok) updateTag(`feed:${session.farmId}`);
    return result;
  });
}
