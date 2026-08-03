/**
 * M7 — Animal trading: buying in, selling out, and the cull list.
 *
 * Two things make this module worth building.
 *
 * A Kenyan livestock price is not a number attached to a class — it is driven by
 * **stage of pregnancy** (a 7-month in-calf heifer carries a large premium),
 * **current daily yield in litres** (a milking cow is literally priced per
 * litre), weight for beef, and whether the animal comes with records. If the
 * sale record does not capture those, next year's asking price is a guess.
 *
 * And the **cull list** is the sharp end: "most dairies have 10–15% of their
 * herd losing money". A 6 L/day cow at KES 45/L does not pay for her stall, and
 * that stall is worth more to a 15 L cow. Naming her is the point of the module.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import {
  actionError,
  actionOk,
  assertOwned,
  can,
  guard,
  NotPermittedError,
  type ActionResult,
  type Capability,
  type Session,
} from "@/lib/dal";
import { newId, REF_PREFIX } from "@/lib/ids";
import { dec, kes, litres as litresLabel, money, num } from "@/lib/money";
import { addDays, daysBetween, today, type ISODate } from "@/lib/domain/dates";
import { CLASS_LABEL, deriveClass, type AnimalFacts } from "@/lib/domain/animal";
import { loadCostModel, resolveDb, writeReceipt, type CostModel } from "./money";

/* ------------------------------------------------------------------ */

function requireCap(session: Session, capability: Capability): void {
  if (!can(session.role, capability)) throw new NotPermittedError(capability);
}

/** Who we bought from or sold to. Broker vs farmer vs butchery moves the price. */
export const COUNTERPARTY_KINDS = [
  "FARMER",
  "BROKER",
  "COOP",
  "BUTCHERY",
  "KMC",
  "AUCTION",
  "OTHER",
] as const;
export type TradeCounterpartyKind = (typeof COUNTERPARTY_KINDS)[number];

export const COUNTERPARTY_KIND_LABEL: Record<TradeCounterpartyKind, string> = {
  FARMER: "Another farmer",
  BROKER: "Broker",
  COOP: "Co-operative",
  BUTCHERY: "Butchery",
  KMC: "Kenya Meat Commission",
  AUCTION: "Auction / market",
  OTHER: "Other",
};

/**
 * Fallback farm-gate price when the farm has sold no milk we can average.
 * KDB puts farm gate at KES 42–52; we take the middle rather than the top.
 */
export const DEFAULT_FARM_GATE_KES_PER_LITRE = 47;

/** Below this a cow in a zero-graze unit is usually not paying for her stall. */
export const MARGINAL_YIELD_L_PER_DAY = 6;

/**
 * The share of group feed that is MAINTENANCE — the ration a cow eats simply to
 * stay alive, identical whether she gives 8 litres or 20. Everything above it
 * is production feed and follows the litres. This split is what makes a low
 * yielder look expensive, which is the entire point of the cull list.
 */
export const MAINTENANCE_FEED_SHARE = 0.5;

/** "Most dairies have 10–15% of their herd losing money." */
export const EXPECTED_LOSS_MAKER_SHARE_PCT = { low: 10, high: 15 };

/* ------------------------------------------------------------------ */
/* Buying in                                                           */
/* ------------------------------------------------------------------ */

const PurchaseInput = z.object({
  id: z.string().uuid().optional(),
  tag: z.string().min(1, "Give her a tag."),
  name: z.string().optional(),
  sex: z.enum(["F", "M"]).default("F"),
  primaryBreed: z.string().optional(),
  breedComposition: z.string().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Used when the seller only knows roughly how old she is. */
  ageMonthsEstimate: z.coerce.number().min(0).max(300).optional(),
  /**
   * Bought-in animals have NO event history here, so class cannot be derived.
   * This is the one place an explicit class is legitimate.
   */
  classOverride: z.enum(s.ANIMAL_CLASSES).optional(),
  enteredHerdOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  priceKes: z.coerce.number().min(0),
  counterpartyId: z.string().uuid().optional(),
  counterpartyKind: z.enum(COUNTERPARTY_KINDS).optional(),
  paymentMethod: z.enum(s.PAYMENT_METHODS).optional(),
  mpesaRef: z.string().optional(),
  klbaRegNo: z.string().optional(),
  monthsPregnant: z.coerce.number().min(0).max(10).optional(),
  dailyYieldL: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
});
export type PurchaseInput = z.input<typeof PurchaseInput>;

export interface PurchaseResult {
  animalId: string;
  refCode: string;
  classOverride: s.AnimalClass | null;
  dobEstimated: boolean;
  /** R7 — what to do next, at the moment of entry. */
  reminders: string[];
}

/**
 * Record buying an animal. Creates the animal with `origin = PURCHASED`.
 *
 * Two things are deliberate here. `dobEstimated` is set whenever the date of
 * birth was inferred rather than told to us — a guessed age must never later be
 * mistaken for a known one. And `classOverride` is allowed, because a bought-in
 * animal has no calvings, services or dry-offs in this database for the class to
 * be derived from.
 *
 * We do NOT write an operating expense: a livestock purchase is capital, and
 * putting KES 200,000 into a month's cost per litre would make that figure
 * meaningless. The price lives on `animal.purchasePriceKes` and comes back in
 * `animalLifetimeValue`.
 */
export async function recordPurchase(
  session: Session,
  input: unknown,
  database?: Db,
): Promise<ActionResult<PurchaseResult>> {
  return guard(async () => {
    requireCap(session, "ADMIN");
    const parsed = PurchaseInput.safeParse(input);
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

    let dateOfBirth = v.dateOfBirth ?? null;
    let dobEstimated = false;
    if (!dateOfBirth && v.ageMonthsEstimate !== undefined) {
      dateOfBirth = addDays(v.enteredHerdOn, -Math.round(v.ageMonthsEstimate * 30.4375));
      dobEstimated = true;
    }
    if (!dateOfBirth) dobEstimated = true;

    const id = v.id ?? newId();
    const notes = [
      v.notes,
      v.counterpartyKind ? `Bought from: ${COUNTERPARTY_KIND_LABEL[v.counterpartyKind]}` : null,
      v.monthsPregnant !== undefined ? `${v.monthsPregnant} months pregnant at purchase` : null,
      v.dailyYieldL !== undefined ? `${v.dailyYieldL} L/day at purchase` : null,
      v.paymentMethod ? `Paid by ${v.paymentMethod}${v.mpesaRef ? ` (${v.mpesaRef})` : ""}` : null,
    ]
      .filter(Boolean)
      .join(". ");

    await db
      .insert(s.animal)
      .values({
        id,
        farmId: session.farmId,
        tag: v.tag,
        name: v.name ?? null,
        sex: v.sex,
        primaryBreed: v.primaryBreed ?? null,
        breedComposition: v.breedComposition ?? null,
        dateOfBirth,
        dobEstimated,
        origin: "PURCHASED",
        enteredHerdOn: v.enteredHerdOn,
        purchasePriceKes: dec(v.priceKes),
        klbaRegNo: v.klbaRegNo ?? null,
        classOverride: v.classOverride ?? null,
        notes: notes || null,
      })
      .onConflictDoNothing();

    const label = v.classOverride ? CLASS_LABEL[v.classOverride] : "Animal";
    const ref = await writeReceipt(db, session, {
      kind: "PURCHASE",
      prefix: REF_PREFIX.SALE,
      summary: `${label} ${v.tag}${v.name ? ` (${v.name})` : ""} bought for ${kes(v.priceKes)}.`,
      payload: { animalId: id, priceKes: v.priceKes },
    });

    // R7: something useful comes back at the moment of entry.
    const reminders = [
      "Ask the seller for her records — calving dates, services, milk and treatments. A price is only justified by records, and they are worth asking for before the money moves.",
      "Ask for the movement permit and a brucellosis-free certificate if she has one.",
    ];
    if (dobEstimated) {
      reminders.push(
        "Her date of birth is an estimate. Age at first calving and every age-based alert will be approximate until you confirm it.",
      );
    }
    if (v.classOverride) {
      reminders.push(
        `Recorded as ${CLASS_LABEL[v.classOverride]} because she has no history here yet. Once she calves or is served on this farm, her class is derived from those events instead.`,
      );
    }

    return actionOk(
      { animalId: id, refCode: ref, classOverride: v.classOverride ?? null, dobEstimated, reminders },
      `${v.tag} entered the herd for ${kes(v.priceKes)}.`,
      ref,
    );
  });
}

/* ------------------------------------------------------------------ */
/* Selling out                                                         */
/* ------------------------------------------------------------------ */

const SaleInput = z.object({
  animalId: z.string().uuid(),
  exitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-08-03."),
  reason: z.enum(["SOLD", "CULLED", "SLAUGHTERED", "DIED", "STOLEN", "LOST"]).default("SOLD"),
  cause: z.string().optional(),
  priceKes: z.coerce.number().min(0).default(0),
  // The Kenyan price drivers, all of them.
  classAtExit: z.enum(s.ANIMAL_CLASSES).optional(),
  monthsPregnant: z.coerce.number().min(0).max(10).optional(),
  dailyYieldAtSaleL: z.coerce.number().min(0).optional(),
  daysInMilkAtSale: z.coerce.number().int().min(0).optional(),
  weightKg: z.coerce.number().min(0).optional(),
  counterpartyId: z.string().uuid().optional(),
  counterpartyKind: z.enum(COUNTERPARTY_KINDS).optional(),
  paymentMethod: z.enum(s.PAYMENT_METHODS).optional(),
  mpesaRef: z.string().optional(),
});
export type SaleInput = z.input<typeof SaleInput>;

export interface SaleResult {
  exitId: string;
  incomeId: string | null;
  refCode: string;
  /** R7 — the whole point of showing this now, not next month. */
  lifetime: AnimalLifetimeValue;
  priceDrivers: string[];
}

/**
 * Record a sale (or any other exit). Writes the `animalExit` with every price
 * driver we can capture, and — for a sale that brought money in — an `income`
 * row, which lands PENDING like every other money entry until a manager
 * approves it.
 */
export async function recordSale(
  session: Session,
  input: unknown,
  database?: Db,
): Promise<ActionResult<SaleResult>> {
  return guard(async () => {
    requireCap(session, "MANAGE_MONEY");
    const parsed = SaleInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const db = await resolveDb(database);
    const v = parsed.data;

    // Ownership before write. A well-formed UUID can belong to another farm.
    const [animal] = await db
      .select()
      .from(s.animal)
      .where(and(eq(s.animal.id, v.animalId), eq(s.animal.farmId, session.farmId)));
    assertOwned(animal, session, "animal");

    const [alreadyGone] = await db
      .select()
      .from(s.animalExit)
      .where(and(eq(s.animalExit.animalId, v.animalId), eq(s.animalExit.farmId, session.farmId)));
    if (alreadyGone) {
      return actionError(
        `${animal.tag} already left the herd on ${alreadyGone.exitDate}. Correct that record instead of adding a second one.`,
      );
    }

    if (v.counterpartyId) {
      const [cp] = await db
        .select()
        .from(s.counterparty)
        .where(and(eq(s.counterparty.id, v.counterpartyId), eq(s.counterparty.farmId, session.farmId)));
      assertOwned(cp, session, "buyer");
    }

    // Derive what the seller did not type, so the record is complete either way.
    const facts = await animalFacts(db, session.farmId, v.animalId, v.exitDate);
    const classAtExit = v.classAtExit ?? deriveClass(facts, v.exitDate);
    const dailyYieldAtSaleL =
      v.dailyYieldAtSaleL ?? (await recentDailyYieldL(db, session.farmId, v.animalId, v.exitDate));
    const daysInMilkAtSale =
      v.daysInMilkAtSale ??
      (facts.lastCalvingOn ? Math.max(0, daysBetween(facts.lastCalvingOn, v.exitDate)) : null);

    const exitId = newId();
    await db
      .insert(s.animalExit)
      .values({
        id: exitId,
        farmId: session.farmId,
        animalId: v.animalId,
        exitDate: v.exitDate,
        reason: v.reason,
        cause: v.cause ?? null,
        valueKes: dec(v.priceKes),
        counterpartyId: v.counterpartyId ?? null,
        classAtExit,
        weightKg: v.weightKg === undefined ? null : dec(v.weightKg, 2),
        monthsPregnant: v.monthsPregnant === undefined ? null : dec(v.monthsPregnant, 1),
        dailyYieldAtSaleL: dailyYieldAtSaleL === null ? null : dec(dailyYieldAtSaleL, 2),
        daysInMilkAtSale: daysInMilkAtSale ?? null,
        recordedBy: session.userId,
      })
      .onConflictDoNothing();

    // Money in, only when money actually came in.
    const broughtMoney = v.priceKes > 0 && (v.reason === "SOLD" || v.reason === "CULLED" || v.reason === "SLAUGHTERED");
    let incomeId: string | null = null;
    if (broughtMoney) {
      incomeId = newId();
      await db
        .insert(s.income)
        .values({
          id: incomeId,
          farmId: session.farmId,
          receivedOn: v.exitDate,
          source: "ANIMAL_SALE",
          description: `${CLASS_LABEL[classAtExit]} ${animal.tag}${animal.name ? ` (${animal.name})` : ""}${
            v.counterpartyKind ? ` to ${COUNTERPARTY_KIND_LABEL[v.counterpartyKind]}` : ""
          }`,
          counterpartyId: v.counterpartyId ?? null,
          amountKes: dec(v.priceKes),
          paymentMethod: v.paymentMethod ?? null,
          mpesaRef: v.mpesaRef ?? null,
          status: "PENDING",
          recordedBy: session.userId,
        })
        .onConflictDoNothing();
    }

    const lifetime = await animalLifetimeValue(session, v.animalId, v.exitDate, database);

    const priceDrivers: string[] = [];
    if (v.monthsPregnant) priceDrivers.push(`${v.monthsPregnant} months in calf`);
    if (dailyYieldAtSaleL) priceDrivers.push(`${litresLabel(dailyYieldAtSaleL)} a day`);
    if (daysInMilkAtSale !== null && daysInMilkAtSale !== undefined) {
      priceDrivers.push(`${daysInMilkAtSale} days in milk`);
    }
    if (v.weightKg) priceDrivers.push(`${v.weightKg} kg liveweight`);
    if (v.priceKes > 0 && dailyYieldAtSaleL) {
      priceDrivers.push(`${kes(money(v.priceKes / dailyYieldAtSaleL))} per litre of daily yield`);
    }

    const ref = await writeReceipt(db, session, {
      kind: "SALE",
      prefix: REF_PREFIX.SALE,
      summary: `${CLASS_LABEL[classAtExit]} ${animal.tag} left the herd for ${kes(v.priceKes)}${
        priceDrivers.length ? ` — ${priceDrivers.join(", ")}` : ""
      }.`,
      payload: { animalId: v.animalId, exitId, incomeId, priceKes: v.priceKes },
    });

    return actionOk(
      { exitId, incomeId, refCode: ref, lifetime, priceDrivers },
      `${animal.tag} sold for ${kes(v.priceKes)}. ${lifetime.summary}`,
      ref,
    );
  });
}

/* ------------------------------------------------------------------ */
/* Lifetime value — what she was actually worth                        */
/* ------------------------------------------------------------------ */

export interface AnimalLifetimeValue {
  animalId: string;
  tag: string;
  name: string | null;
  fromDate: ISODate | null;
  toDate: ISODate;
  totalLitres: number;
  calvesBorn: number;
  liveCalves: number;
  milkRevenueKes: number;
  pricePerLitreKes: number;
  feedCostKes: number;
  vetCostKes: number;
  breedingCostKes: number;
  purchasePriceKes: number;
  saleValueKes: number;
  totalCostKes: number;
  totalReturnKes: number;
  profitKes: number;
  summary: string;
}

/**
 * Everything this animal earned and everything she cost, over her whole life on
 * this farm. Shown at the moment of sale (R7), because that is the moment the
 * number changes a decision.
 */
export async function animalLifetimeValue(
  session: Session,
  animalId: string,
  asOf?: ISODate,
  database?: Db,
): Promise<AnimalLifetimeValue> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);
  const to = asOf ?? today();

  const [animal] = await db
    .select()
    .from(s.animal)
    .where(and(eq(s.animal.id, animalId), eq(s.animal.farmId, session.farmId)));
  assertOwned(animal, session, "animal");

  const from = (animal.enteredHerdOn ?? animal.dateOfBirth ?? to) as ISODate;

  const milkRows = await db
    .select({ id: s.milkRecord.id, litres: s.milkRecord.litres, supersedesId: s.milkRecord.supersedesId })
    .from(s.milkRecord)
    .where(and(eq(s.milkRecord.farmId, session.farmId), eq(s.milkRecord.animalId, animalId)));
  const superseded = new Set(milkRows.map((r) => r.supersedesId).filter(Boolean) as string[]);
  const totalLitres = money(
    milkRows.filter((r) => !superseded.has(r.id)).reduce((t, r) => t + num(r.litres), 0),
  );

  const calvings = await db
    .select({ id: s.calving.id, numberBorn: s.calving.numberBorn })
    .from(s.calving)
    .where(and(eq(s.calving.farmId, session.farmId), eq(s.calving.damId, animalId)));
  const calvesBorn = calvings.reduce((t, c) => t + (c.numberBorn ?? 1), 0);

  const outcomes = calvings.length
    ? await db
        .select({ outcome: s.calvingOutcome.outcome })
        .from(s.calvingOutcome)
        .where(
          and(
            eq(s.calvingOutcome.farmId, session.farmId),
            inArray(s.calvingOutcome.calvingId, calvings.map((c) => c.id)),
          ),
        )
    : [];
  const liveCalves = outcomes.filter((o) => o.outcome === "LIVE").length;

  const health = await db
    .select({ costKes: s.healthEvent.costKes })
    .from(s.healthEvent)
    .where(and(eq(s.healthEvent.farmId, session.farmId), eq(s.healthEvent.animalId, animalId)));
  const vetCostKes = money(health.reduce((t, h) => t + num(h.costKes), 0));

  const services = await db
    .select({ costKes: s.service.costKes })
    .from(s.service)
    .where(and(eq(s.service.farmId, session.farmId), eq(s.service.animalId, animalId)));
  const pds = await db
    .select({ costKes: s.pregnancyCheck.costKes })
    .from(s.pregnancyCheck)
    .where(and(eq(s.pregnancyCheck.farmId, session.farmId), eq(s.pregnancyCheck.animalId, animalId)));
  const breedingCostKes = money(
    services.reduce((t, r) => t + num(r.costKes), 0) + pds.reduce((t, r) => t + num(r.costKes), 0),
  );

  const costModel = await loadCostModel(session, to, database);
  const feedMap = await feedCostByAnimal(db, session.farmId, from, to, costModel);
  const feedCostKes = money(feedMap.get(animalId) ?? 0);

  const pricePerLitreKes = await realisedPricePerLitre(db, session.farmId, from, to);
  const milkRevenueKes = money(totalLitres * pricePerLitreKes);

  const [exit] = await db
    .select()
    .from(s.animalExit)
    .where(and(eq(s.animalExit.farmId, session.farmId), eq(s.animalExit.animalId, animalId)));
  const saleValueKes = money(num(exit?.valueKes));
  const purchasePriceKes = money(num(animal.purchasePriceKes));

  const totalCostKes = money(feedCostKes + vetCostKes + breedingCostKes + purchasePriceKes);
  const totalReturnKes = money(milkRevenueKes + saleValueKes);
  const profitKes = money(totalReturnKes - totalCostKes);

  const bits: string[] = [];
  bits.push(
    totalLitres > 0
      ? `She gave ${litresLabel(totalLitres)} worth about ${kes(milkRevenueKes)}`
      : "She has produced no recorded milk here",
  );
  if (calvesBorn > 0) bits.push(`and ${calvesBorn} ${calvesBorn === 1 ? "calf" : "calves"}`);
  bits.push(
    `against ${kes(totalCostKes)} of feed, vet, breeding${purchasePriceKes > 0 ? " and purchase" : ""} cost`,
  );
  const verdict =
    profitKes >= 0
      ? `She is ${kes(profitKes)} ahead over her life here.`
      : `She is ${kes(Math.abs(profitKes))} behind over her life here.`;

  return {
    animalId,
    tag: animal.tag,
    name: animal.name,
    fromDate: from,
    toDate: to,
    totalLitres,
    calvesBorn,
    liveCalves,
    milkRevenueKes,
    pricePerLitreKes,
    feedCostKes,
    vetCostKes,
    breedingCostKes,
    purchasePriceKes,
    saleValueKes,
    totalCostKes,
    totalReturnKes,
    profitKes,
    summary: `${bits.join(" ")}. ${verdict}`,
  };
}

/* ------------------------------------------------------------------ */
/* The cull list                                                       */
/* ------------------------------------------------------------------ */

export type CullAction = "KEEP" | "WATCH" | "CULL" | "SELL_AS_BREEDER" | "INVESTIGATE";

export interface CullCandidate {
  animalId: string;
  tag: string;
  name: string | null;
  animalClass: s.AnimalClass;
  classLabel: string;
  litres: number;
  dailyYieldL: number;
  milkRevenueKes: number;
  feedCostKes: number;
  vetCostKes: number;
  marginKes: number;
  marginPerMonthKes: number;
  losing: boolean;
  action: CullAction;
  /** One sentence naming the animal and what to do. Never a table row alone. */
  recommendation: string;
}

export interface CullList {
  from: ISODate;
  to: ISODate;
  windowDays: number;
  pricePerLitreKes: number;
  herdSize: number;
  lossMakers: number;
  lossMakerSharePct: number;
  totalLossKes: number;
  candidates: CullCandidate[];
  headline: string;
}

/**
 * The herd ranked by margin, worst first, with the loss-makers named and given a
 * recommended action.
 */
export async function cullList(
  session: Session,
  opts: { asOf?: ISODate; windowDays?: number } = {},
  database?: Db,
): Promise<CullList> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);

  const to = opts.asOf ?? today();
  const windowDays = opts.windowDays ?? 90;
  const from = addDays(to, -(windowDays - 1));

  const animals = await db.select().from(s.animal).where(eq(s.animal.farmId, session.farmId));
  const exits = await db
    .select({ animalId: s.animalExit.animalId, exitDate: s.animalExit.exitDate })
    .from(s.animalExit)
    .where(eq(s.animalExit.farmId, session.farmId));
  const goneBy = new Map(exits.map((e) => [e.animalId, e.exitDate as ISODate]));
  const live = animals.filter((a) => {
    const gone = goneBy.get(a.id);
    return !gone || gone > to;
  });

  const pricePerLitreKes = await realisedPricePerLitre(db, session.farmId, from, to);
  const costModel = await loadCostModel(session, to, database);
  const feedMap = await feedCostByAnimal(db, session.farmId, from, to, costModel);
  const litresMap = await litresByAnimal(db, session.farmId, from, to);

  const healthRows = await db
    .select({ animalId: s.healthEvent.animalId, costKes: s.healthEvent.costKes })
    .from(s.healthEvent)
    .where(
      and(
        eq(s.healthEvent.farmId, session.farmId),
        gte(s.healthEvent.occurredOn, from),
        lte(s.healthEvent.occurredOn, to),
      ),
    );
  const vetMap = new Map<string, number>();
  for (const h of healthRows) {
    vetMap.set(h.animalId, money((vetMap.get(h.animalId) ?? 0) + num(h.costKes)));
  }

  const months = windowDays / 30.4375;
  const candidates: CullCandidate[] = [];

  for (const a of live) {
    const facts = await animalFacts(db, session.farmId, a.id, to);
    const animalClass = deriveClass(facts, to);
    const litres = money(litresMap.get(a.id) ?? 0);
    const dailyYieldL = money(litres / windowDays);
    const milkRevenueKes = money(litres * pricePerLitreKes);
    const feedCostKes = money(feedMap.get(a.id) ?? 0);
    const vetCostKes = money(vetMap.get(a.id) ?? 0);
    const marginKes = money(milkRevenueKes - feedCostKes - vetCostKes);
    const marginPerMonthKes = money(marginKes / months);

    const { action, recommendation } = recommendFor({
      tag: a.tag,
      name: a.name,
      animalClass,
      dailyYieldL,
      marginPerMonthKes,
      facts,
      asOf: to,
    });

    candidates.push({
      animalId: a.id,
      tag: a.tag,
      name: a.name,
      animalClass,
      classLabel: CLASS_LABEL[animalClass],
      litres,
      dailyYieldL,
      milkRevenueKes,
      feedCostKes,
      vetCostKes,
      marginKes,
      marginPerMonthKes,
      losing: marginKes < 0,
      action,
      recommendation,
    });
  }

  // Worst margin first — this screen exists to name the bottom of the herd.
  candidates.sort((x, y) => x.marginKes - y.marginKes || x.tag.localeCompare(y.tag));

  const lossMakers = candidates.filter((c) => c.losing);
  const herdSize = candidates.length;
  const lossMakerSharePct = herdSize > 0 ? money((lossMakers.length / herdSize) * 100) : 0;
  const totalLossKes = money(lossMakers.reduce((t, c) => t + c.marginKes, 0));

  let headline: string;
  if (herdSize === 0) {
    headline = "No animals in the herd yet.";
  } else if (lossMakers.length === 0) {
    headline = `Every one of your ${herdSize} animals covered its feed and vet cost over the last ${windowDays} days.`;
  } else {
    const worst = lossMakers[0];
    headline =
      `${lossMakers.length} of ${herdSize} animals (${lossMakerSharePct}%) are losing money — together ${kes(Math.abs(totalLossKes))} over ${windowDays} days. ` +
      `Most dairies sit at ${EXPECTED_LOSS_MAKER_SHARE_PCT.low}–${EXPECTED_LOSS_MAKER_SHARE_PCT.high}%. ` +
      `Start with ${worst.tag}${worst.name ? ` (${worst.name})` : ""}: ${worst.recommendation}`;
  }

  return {
    from,
    to,
    windowDays,
    pricePerLitreKes,
    herdSize,
    lossMakers: lossMakers.length,
    lossMakerSharePct,
    totalLossKes,
    candidates,
    headline,
  };
}

function recommendFor(a: {
  tag: string;
  name: string | null;
  animalClass: s.AnimalClass;
  dailyYieldL: number;
  marginPerMonthKes: number;
  facts: AnimalFacts;
  asOf: ISODate;
}): { action: CullAction; recommendation: string } {
  const who = a.name ? `${a.name} (${a.tag})` : a.tag;
  const growing =
    a.animalClass === "CALF" ||
    a.animalClass === "WEANER" ||
    a.animalClass === "HEIFER" ||
    a.animalClass === "BULLING_HEIFER" ||
    a.animalClass === "SERVED_HEIFER" ||
    a.animalClass === "INCALF_HEIFER" ||
    a.animalClass === "SPRINGER" ||
    a.animalClass === "BULL_CALF";

  if (growing) {
    return {
      action: "KEEP",
      recommendation: `${who} is ${CLASS_LABEL[a.animalClass].toLowerCase()} — she is meant to cost money now. Judge her once she calves.`,
    };
  }

  if (a.animalClass === "DRY_COW") {
    return {
      action: "KEEP",
      recommendation: `${who} is dry, so she earns nothing this month by design. Keep her feed to a dry-cow ration and watch her calving date.`,
    };
  }

  const emptyAndOpen =
    a.facts.parity > 0 &&
    a.facts.lastCalvingOn !== null &&
    daysBetween(a.facts.lastCalvingOn, a.asOf) > 400 &&
    a.facts.pdPositiveOn === null;

  if (emptyAndOpen && a.marginPerMonthKes <= 0) {
    return {
      action: "CULL",
      recommendation: `${who} is more than 400 days since calving and not back in calf, and she is losing ${kes(Math.abs(a.marginPerMonthKes))} a month. Sell her.`,
    };
  }

  if (a.marginPerMonthKes < 0 && a.dailyYieldL > 0 && a.dailyYieldL < MARGINAL_YIELD_L_PER_DAY) {
    return {
      action: "CULL",
      recommendation: `${who} gives ${litresLabel(a.dailyYieldL)} a day and loses ${kes(Math.abs(a.marginPerMonthKes))} a month. Her stall is worth more to a 15 L cow.`,
    };
  }

  if (a.marginPerMonthKes < 0) {
    return {
      action: "INVESTIGATE",
      recommendation: `${who} loses ${kes(Math.abs(a.marginPerMonthKes))} a month at ${litresLabel(a.dailyYieldL)} a day. Check her ration and her udder before deciding to sell.`,
    };
  }

  if (a.dailyYieldL > 0 && a.dailyYieldL < MARGINAL_YIELD_L_PER_DAY) {
    return {
      action: "WATCH",
      recommendation: `${who} is only on ${litresLabel(a.dailyYieldL)} a day. She is just covering her costs — watch her next month.`,
    };
  }

  return {
    action: "KEEP",
    recommendation: `${who} earns ${kes(a.marginPerMonthKes)} a month over feed and vet cost. Keep her.`,
  };
}

/* ------------------------------------------------------------------ */
/* The sell picker                                                     */
/* ------------------------------------------------------------------ */

export interface SellCandidate {
  id: string;
  tag: string;
  name: string | null;
  label: string;
  animalClass: s.AnimalClass;
  classLabel: string;
  dailyYieldL: number | null;
  daysInMilk: number | null;
  monthsPregnant: number | null;
}

/**
 * Everyone still in the herd, with the price drivers we already know, so the
 * sale form arrives prefilled and LABELLED as prefilled (R5). None of it is
 * money — money is never prefilled.
 */
export async function sellCandidates(
  session: Session,
  asOf?: ISODate,
  database?: Db,
): Promise<SellCandidate[]> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);
  const to = asOf ?? today();

  const animals = await db.select().from(s.animal).where(eq(s.animal.farmId, session.farmId));
  const exits = await db
    .select({ animalId: s.animalExit.animalId })
    .from(s.animalExit)
    .where(eq(s.animalExit.farmId, session.farmId));
  const gone = new Set(exits.map((e) => e.animalId));

  const out: SellCandidate[] = [];
  for (const a of animals) {
    if (gone.has(a.id)) continue;
    const facts = await animalFacts(db, session.farmId, a.id, to);
    const animalClass = deriveClass(facts, to);
    const dailyYieldL = await recentDailyYieldL(db, session.farmId, a.id, to);

    // Months carried, from the most recent positive pregnancy diagnosis.
    const [pd] = await db
      .select()
      .from(s.pregnancyCheck)
      .where(
        and(
          eq(s.pregnancyCheck.farmId, session.farmId),
          eq(s.pregnancyCheck.animalId, a.id),
          eq(s.pregnancyCheck.result, "POSITIVE"),
        ),
      );
    let monthsPregnant: number | null = null;
    if (facts.pdPositiveOn) {
      const atCheck = pd?.monthsPregnant ? num(pd.monthsPregnant) : 2;
      monthsPregnant = money(
        Math.min(10, atCheck + daysBetween(facts.pdPositiveOn, to) / 30.4375),
      );
    }

    out.push({
      id: a.id,
      tag: a.tag,
      name: a.name,
      label: a.name ? `${a.name} (${a.tag})` : a.tag,
      animalClass,
      classLabel: CLASS_LABEL[animalClass],
      dailyYieldL,
      daysInMilk:
        facts.lastCalvingOn && dailyYieldL !== null
          ? Math.max(0, daysBetween(facts.lastCalvingOn, to))
          : null,
      monthsPregnant,
    });
  }

  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/* ------------------------------------------------------------------ */
/* Trade log                                                           */
/* ------------------------------------------------------------------ */

export interface TradeRow {
  kind: "BOUGHT" | "LEFT";
  animalId: string;
  tag: string;
  name: string | null;
  onDate: ISODate;
  classLabel: string;
  valueKes: number;
  detail: string;
}

/** The buy/sell log behind /trading. */
export async function tradeLog(session: Session, database?: Db): Promise<TradeRow[]> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);

  const animals = await db.select().from(s.animal).where(eq(s.animal.farmId, session.farmId));
  const byId = new Map(animals.map((a) => [a.id, a]));

  const exits = await db
    .select()
    .from(s.animalExit)
    .where(eq(s.animalExit.farmId, session.farmId));

  const rows: TradeRow[] = [];

  for (const a of animals) {
    if (a.origin !== "PURCHASED") continue;
    rows.push({
      kind: "BOUGHT",
      animalId: a.id,
      tag: a.tag,
      name: a.name,
      onDate: a.enteredHerdOn as ISODate,
      classLabel: a.classOverride ? CLASS_LABEL[a.classOverride] : "Bought in",
      valueKes: num(a.purchasePriceKes),
      detail: a.dobEstimated ? "Age estimated — no records from the seller" : "",
    });
  }

  for (const e of exits) {
    const a = byId.get(e.animalId);
    const drivers = [
      e.monthsPregnant ? `${num(e.monthsPregnant)} months in calf` : null,
      e.dailyYieldAtSaleL ? `${litresLabel(num(e.dailyYieldAtSaleL))} a day` : null,
      e.weightKg ? `${num(e.weightKg)} kg` : null,
    ].filter(Boolean);
    rows.push({
      kind: "LEFT",
      animalId: e.animalId,
      tag: a?.tag ?? "—",
      name: a?.name ?? null,
      onDate: e.exitDate as ISODate,
      classLabel: e.classAtExit ? CLASS_LABEL[e.classAtExit] : "—",
      valueKes: num(e.valueKes),
      detail: [reasonLabel(e.reason), ...drivers].join(", "),
    });
  }

  return rows.sort((x, y) => (x.onDate < y.onDate ? 1 : x.onDate > y.onDate ? -1 : 0));
}

function reasonLabel(reason: string): string {
  return (
    {
      SOLD: "Sold",
      DIED: "Died",
      SLAUGHTERED: "Slaughtered",
      CULLED: "Culled",
      STOLEN: "Stolen",
      LOST: "Lost",
    }[reason] ?? reason
  );
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

/** Assemble the event facts `deriveClass` needs. Class is never a column. */
export async function animalFacts(
  db: Db,
  farmId: string,
  animalId: string,
  asOf: ISODate,
): Promise<AnimalFacts> {
  const [animal] = await db
    .select()
    .from(s.animal)
    .where(and(eq(s.animal.id, animalId), eq(s.animal.farmId, farmId)));

  const calvings = await db
    .select({ calvedOn: s.calving.calvedOn })
    .from(s.calving)
    .where(
      and(eq(s.calving.farmId, farmId), eq(s.calving.damId, animalId), lte(s.calving.calvedOn, asOf)),
    );
  const services = await db
    .select({ servedOn: s.service.servedOn, expectedCalvingOn: s.service.expectedCalvingOn })
    .from(s.service)
    .where(
      and(eq(s.service.farmId, farmId), eq(s.service.animalId, animalId), lte(s.service.servedOn, asOf)),
    );
  const pds = await db
    .select({ checkedOn: s.pregnancyCheck.checkedOn, result: s.pregnancyCheck.result })
    .from(s.pregnancyCheck)
    .where(
      and(
        eq(s.pregnancyCheck.farmId, farmId),
        eq(s.pregnancyCheck.animalId, animalId),
        lte(s.pregnancyCheck.checkedOn, asOf),
      ),
    );
  const dries = await db
    .select({ driedOn: s.dryOff.driedOn })
    .from(s.dryOff)
    .where(
      and(eq(s.dryOff.farmId, farmId), eq(s.dryOff.animalId, animalId), lte(s.dryOff.driedOn, asOf)),
    );
  const weights = await db
    .select({ observedOn: s.weightObservation.observedOn, weightKg: s.weightObservation.weightKg })
    .from(s.weightObservation)
    .where(
      and(
        eq(s.weightObservation.farmId, farmId),
        eq(s.weightObservation.animalId, animalId),
        lte(s.weightObservation.observedOn, asOf),
      ),
    );
  const [exit] = await db
    .select({ reason: s.animalExit.reason })
    .from(s.animalExit)
    .where(and(eq(s.animalExit.farmId, farmId), eq(s.animalExit.animalId, animalId)));

  const maxOf = (xs: (string | null)[]) =>
    xs.filter(Boolean).sort().at(-1) as ISODate | undefined;

  const lastService = services
    .slice()
    .sort((a, b) => (a.servedOn < b.servedOn ? -1 : 1))
    .at(-1);
  const latestWeight = weights
    .slice()
    .sort((a, b) => (a.observedOn < b.observedOn ? -1 : 1))
    .at(-1);

  return {
    sex: (animal?.sex ?? "F") as "F" | "M",
    dateOfBirth: (animal?.dateOfBirth ?? null) as ISODate | null,
    castrated: animal?.castrated ?? false,
    classOverride: animal?.classOverride ?? null,
    parity: calvings.length,
    lastCalvingOn: maxOf(calvings.map((c) => c.calvedOn)) ?? null,
    lastServiceOn: (lastService?.servedOn as ISODate | undefined) ?? null,
    pdPositiveOn: maxOf(pds.filter((p) => p.result === "POSITIVE").map((p) => p.checkedOn)) ?? null,
    pdNegativeOn: maxOf(pds.filter((p) => p.result === "NEGATIVE").map((p) => p.checkedOn)) ?? null,
    driedOffOn: maxOf(dries.map((d) => d.driedOn)) ?? null,
    expectedCalvingOn: (lastService?.expectedCalvingOn as ISODate | null) ?? null,
    latestWeightKg: latestWeight ? num(latestWeight.weightKg) : null,
    culled: exit?.reason === "CULLED",
  };
}

/** Her recent daily yield — the number a Kenyan buyer actually prices on. */
async function recentDailyYieldL(
  db: Db,
  farmId: string,
  animalId: string,
  asOf: ISODate,
  windowDays = 7,
): Promise<number | null> {
  const from = addDays(asOf, -(windowDays - 1));
  const rows = await db
    .select({ litres: s.milkRecord.litres, recordedOn: s.milkRecord.recordedOn })
    .from(s.milkRecord)
    .where(
      and(
        eq(s.milkRecord.farmId, farmId),
        eq(s.milkRecord.animalId, animalId),
        gte(s.milkRecord.recordedOn, from),
        lte(s.milkRecord.recordedOn, asOf),
      ),
    );
  if (rows.length === 0) return null;
  const days = new Set(rows.map((r) => r.recordedOn)).size;
  return money(rows.reduce((t, r) => t + num(r.litres), 0) / Math.max(1, days));
}

async function litresByAnimal(
  db: Db,
  farmId: string,
  from: ISODate,
  to: ISODate,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      id: s.milkRecord.id,
      animalId: s.milkRecord.animalId,
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
  const map = new Map<string, number>();
  for (const r of rows) {
    if (superseded.has(r.id)) continue;
    map.set(r.animalId, money((map.get(r.animalId) ?? 0) + num(r.litres)));
  }
  return map;
}

/**
 * What a litre actually fetched, blended across every revenue channel. Falls
 * back to the KDB mid-point when the farm has sold nothing we can average —
 * labelled everywhere it is used, because it is an assumption, not a fact.
 */
export async function realisedPricePerLitre(
  db: Db,
  farmId: string,
  from: ISODate,
  to: ISODate,
): Promise<number> {
  const rows = await db
    .select({
      channel: s.milkDisposal.channel,
      litres: s.milkDisposal.litres,
      valueKes: s.milkDisposal.valueKes,
      rate: s.milkDisposal.rateKesPerLitre,
    })
    .from(s.milkDisposal)
    .where(
      and(
        eq(s.milkDisposal.farmId, farmId),
        gte(s.milkDisposal.disposedOn, from),
        lte(s.milkDisposal.disposedOn, to),
      ),
    );

  let litres = 0;
  let value = 0;
  for (const r of rows) {
    if (!(s.REVENUE_CHANNELS as readonly string[]).includes(r.channel)) continue;
    const l = num(r.litres);
    const v = num(r.valueKes) || l * num(r.rate);
    if (l <= 0 || v <= 0) continue;
    litres += l;
    value += v;
  }
  if (litres <= 0) return DEFAULT_FARM_GATE_KES_PER_LITRE;
  return money(value / litres);
}

/**
 * Feed cost attributed per animal.
 *
 * Farms will not sustain per-cow feed capture, so most issues are recorded
 * against a group. The attribution rule, stated plainly so nobody has to guess:
 *
 *   1. An issue naming an animal is charged to that animal in full.
 *   2. A LACTATING or ALL group issue is split in two. Half is MAINTENANCE and
 *      is charged evenly per head; the rest is charged per litre produced.
 *      This is the mathematical heart of Kenyan dairy profitability — a cow
 *      giving 8 L/day carries the same maintenance cost as one giving 20, so
 *      attributing group feed purely per litre would make every cow look
 *      equally profitable and the cull list would find nothing.
 *   3. Any other group issue is split evenly across the animals that produced
 *      no milk (the dry cows, heifers and calves that group feed goes to),
 *      falling back to an even split across the live herd.
 *
 * Home-grown feed never hit an expense row, so it is valued at the farm's
 * imputed rate from the cost model.
 */
export async function feedCostByAnimal(
  db: Db,
  farmId: string,
  from: ISODate,
  to: ISODate,
  costModel: CostModel,
): Promise<Map<string, number>> {
  const items = await db.select().from(s.feedItem).where(eq(s.feedItem.farmId, farmId));

  const purchases = await db
    .select({
      feedItemId: s.feedPurchase.feedItemId,
      quantity: s.feedPurchase.quantity,
      unitWeightKg: s.feedPurchase.unitWeightKg,
      totalCostKes: s.feedPurchase.totalCostKes,
    })
    .from(s.feedPurchase)
    .where(eq(s.feedPurchase.farmId, farmId));

  const kgByItem = new Map<string, number>();
  const kesByItem = new Map<string, number>();
  for (const p of purchases) {
    const kg = num(p.quantity) * num(p.unitWeightKg);
    kgByItem.set(p.feedItemId, (kgByItem.get(p.feedItemId) ?? 0) + kg);
    kesByItem.set(p.feedItemId, (kesByItem.get(p.feedItemId) ?? 0) + num(p.totalCostKes));
  }

  const costPerKg = new Map<string, number>();
  for (const item of items) {
    const kg = kgByItem.get(item.id) ?? 0;
    if (kg > 0) {
      costPerKg.set(item.id, money((kesByItem.get(item.id) ?? 0) / kg));
    } else if (item.homeGrown) {
      costPerKg.set(item.id, costModel.imputedFodderKesPerKg);
    } else {
      costPerKg.set(item.id, 0);
    }
  }

  const issues = await db
    .select()
    .from(s.feedIssue)
    .where(
      and(
        eq(s.feedIssue.farmId, farmId),
        gte(s.feedIssue.issuedOn, from),
        lte(s.feedIssue.issuedOn, to),
      ),
    );

  const animals = await db
    .select({ id: s.animal.id })
    .from(s.animal)
    .where(eq(s.animal.farmId, farmId));
  const exits = await db
    .select({ animalId: s.animalExit.animalId, exitDate: s.animalExit.exitDate })
    .from(s.animalExit)
    .where(eq(s.animalExit.farmId, farmId));
  const goneBy = new Map(exits.map((e) => [e.animalId, e.exitDate as ISODate]));
  const liveIds = animals.map((a) => a.id).filter((id) => {
    const gone = goneBy.get(id);
    return !gone || gone >= from;
  });

  const litresMap = await litresByAnimal(db, farmId, from, to);
  const totalLitres = [...litresMap.values()].reduce((t, l) => t + l, 0);
  const milkers = liveIds.filter((id) => (litresMap.get(id) ?? 0) > 0);
  const nonMilkers = liveIds.filter((id) => (litresMap.get(id) ?? 0) === 0);

  const out = new Map<string, number>();
  const add = (id: string, kesAmount: number) =>
    out.set(id, money((out.get(id) ?? 0) + kesAmount));

  for (const issue of issues) {
    const kg = num(issue.quantity) * num(issue.unitWeightKg);
    const cost = money(kg * (costPerKg.get(issue.feedItemId) ?? 0));
    if (cost <= 0) continue;

    if (issue.animalId) {
      add(issue.animalId, cost);
      continue;
    }

    const group = issue.animalGroup;
    const milkWeighted = group === "LACTATING" || group === "ALL" || group === null;

    if (milkWeighted && totalLitres > 0 && milkers.length > 0) {
      const maintenance = money(cost * MAINTENANCE_FEED_SHARE);
      const production = money(cost - maintenance);
      const perHead = money(maintenance / milkers.length);
      for (const id of milkers) {
        add(id, money(perHead + production * ((litresMap.get(id) ?? 0) / totalLitres)));
      }
      continue;
    }

    const pool = !milkWeighted && nonMilkers.length > 0 ? nonMilkers : liveIds;
    if (pool.length === 0) continue;
    const share = money(cost / pool.length);
    for (const id of pool) add(id, share);
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Form entry points                                                   */
/* ------------------------------------------------------------------ */

function formValues(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out;
}

export async function recordPurchaseAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<PurchaseResult>> {
  "use server";
  const { verifySession } = await import("@/lib/dal");
  const { updateTag } = await import("next/cache");
  const session = await verifySession();
  const result = await recordPurchase(session, formValues(formData));
  if (result.ok) {
    updateTag(`herd:${session.farmId}`);
    updateTag(`trading:${session.farmId}`);
  }
  return result;
}

export async function recordSaleAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<SaleResult>> {
  "use server";
  const { verifySession } = await import("@/lib/dal");
  const { updateTag } = await import("next/cache");
  const session = await verifySession();
  const result = await recordSale(session, formValues(formData));
  if (result.ok) {
    updateTag(`herd:${session.farmId}`);
    updateTag(`trading:${session.farmId}`);
    updateTag(`money:${session.farmId}`);
  }
  return result;
}
