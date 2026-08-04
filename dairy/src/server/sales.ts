import "server-only";

/**
 * M4 — Milk sales and disposal.
 *
 * Three channels that are three different businesses: the co-operative (bulk,
 * lowest price, paid monthly less check-off), institutions (contracted, invoiced,
 * paid in 30–90 days), and households (best price, running tab, worst risk).
 *
 * Two things here are load-bearing:
 *   1. An institutional delivery creates a RECEIVABLE, not revenue. Conflating
 *      the two overstates the farm's cash by a quarter's sales.
 *   2. Milk from a cow under antibiotic withdrawal may not reach a paying
 *      channel. It is the single hard block in the system, and it is enforced
 *      here rather than trusted to the UI.
 */

import { and, asc, desc, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { z } from "zod";
import * as s from "@/db/schema";
import type { CustomerType, DisposalChannel, MilkingSession, PaymentTerms } from "@/db/schema";
import type { Db } from "@/db";
import {
  actionError,
  actionOk,
  assertOwned,
  can,
  guard,
  NotPermittedError,
  requireCapability,
  type ActionResult,
  type Capability,
  type Session,
} from "@/lib/dal";
import { newId, refCode, REF_PREFIX, deterministicUuid } from "@/lib/ids";

/**
 * The read-side capability check.
 *
 * Every mutating action here opens with `requireCapability`. The READS did not,
 * so any signed-in user — including a herdsman on the phone four people share —
 * could pull the whole farm's debtor book. Segregation of duties is the
 * documented remedy for the theft pattern this module is built against; a
 * herdsman who can see which customer is behind on payment has information his
 * job does not need and someone else's leverage.
 */
function requireCap(session: Session, capability: Capability): void {
  if (!can(session.role, capability)) throw new NotPermittedError(capability);
}
import { dec, kes, money, num } from "@/lib/money";
import { addDays, today, type ISODate } from "@/lib/domain/dates";
import {
  blendedPricePerLitre,
  isImputedChannel,
  isLossChannel,
  isRevenueChannel,
  lossRatePct,
  reconcileDay,
  type Reconciliation,
} from "@/lib/domain/milk";
import {
  ageReceivables,
  buildDeliveryRound,
  checkCreditLimit,
  checkSaleLegality,
  customerBalance,
  dueDateFor,
  latePaymentInterestKes,
  reconcileStatement,
  resolvePrice,
  type AgingReport,
  type CreditCheck,
  type CustomerBalance,
  type LedgerRow,
  type PriceRow,
  type SaleLegality,
  type StandingOrderRow,
  type StatementReconciliation,
} from "@/lib/domain/sales";
import {
  dayProduction,
  deterministicRef,
  formatDay,
  resolveDb,
  sessionLabel,
  type DayProduction,
  withdrawalMap,
  isWithheldReason,
  lactatingHerd,
} from "./milk";

/* ---------------------------------------------------------------- */
/* Labels — never a code the user has to decode                      */
/* ---------------------------------------------------------------- */

export const CHANNEL_LABEL: Record<DisposalChannel, string> = {
  COOP: "Co-operative",
  PROCESSOR: "Processor",
  INSTITUTION: "Schools and hotels",
  HOUSEHOLD: "Neighbours",
  SHOP: "Shop",
  MILK_ATM: "Milk ATM",
  HOME_CONSUMPTION: "Our own house",
  CALF_FEEDING: "Calves",
  STAFF_RATION: "Staff milk",
  SPOILAGE: "Spoiled",
  REJECTED: "Rejected at reception",
  WITHHELD_TREATMENT: "Withheld — treated cow",
  WITHHELD_COLOSTRUM: "Withheld — colostrum",
};

export const CHANNEL_ICON: Record<DisposalChannel, string> = {
  COOP: "🏢", PROCESSOR: "🏭", INSTITUTION: "🏫", HOUSEHOLD: "🏠", SHOP: "🏪",
  MILK_ATM: "🚰", HOME_CONSUMPTION: "🏡", CALF_FEEDING: "🍼", STAFF_RATION: "👷",
  SPOILAGE: "🗑️", REJECTED: "⛔", WITHHELD_TREATMENT: "💉", WITHHELD_COLOSTRUM: "🍼",
};

/** The channel a customer's milk goes out through. */
export function channelForCustomerType(t: CustomerType): DisposalChannel {
  return t as DisposalChannel;
}

/* ---------------------------------------------------------------- */
/* Pricing                                                           */
/* ---------------------------------------------------------------- */

async function priceRows(dbo: Db, farmId: string): Promise<PriceRow[]> {
  const rows = await dbo.select().from(s.priceList).where(eq(s.priceList.farmId, farmId));
  return rows.map((r) => ({
    scope: r.scope,
    customerType: r.customerType,
    customerId: r.customerId,
    rateKesPerLitre: r.rateKesPerLitre,
    minLitres: r.minLitres,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
  }));
}

/** Customer override → channel default → nothing. Always dated to the sale. */
export async function resolveRate(
  dbo: Db,
  farmId: string,
  ctx: { customerId: string; customerType: CustomerType; onDate: ISODate; litres?: number },
): Promise<number | null> {
  return resolvePrice(await priceRows(dbo, farmId), ctx);
}

/**
 * What a litre given away was worth.
 *
 * Home use, calf feeding and the staff ration earn nothing, but valuing them at
 * the market rate is the only way an owner sees the true cost of "free" milk —
 * calves alone account for around 22% of on-farm losses.
 */
export async function imputedRate(dbo: Db, farmId: string, onDate: ISODate): Promise<number | null> {
  const rows = await priceRows(dbo, farmId);
  const live = rows.filter(
    (r) => r.effectiveFrom <= onDate && (!r.effectiveTo || r.effectiveTo >= onDate) && r.scope === "CHANNEL",
  );
  if (live.length) {
    // The best price the farm could have got for it.
    return money(Math.max(...live.map((r) => num(r.rateKesPerLitre))));
  }
  // Fall back to what today's own sales actually fetched.
  const sold = await dbo
    .select()
    .from(s.milkDisposal)
    .where(and(eq(s.milkDisposal.farmId, farmId), eq(s.milkDisposal.disposedOn, onDate)));
  const blended = blendedPricePerLitre(
    sold.map((d) => ({ channel: d.channel, litres: num(d.litres), valueKes: num(d.valueKes) })),
  );
  return blended.blendedKes > 0 ? blended.blendedKes : null;
}

/* ---------------------------------------------------------------- */
/* The hard block — withdrawal milk may not be sold                  */
/* ---------------------------------------------------------------- */

export interface WithdrawalGuard {
  /** Litres that may still go to a paying channel today. */
  saleableL: number;
  withheldL: number;
  /** Litres of this request that must be forced to WITHHELD_TREATMENT. */
  forcedL: number;
  blocked: boolean;
  message: string | null;
  animals: DayProduction["withheldAnimals"];
}

/**
 * R4's one exception.
 *
 * The guard only bites on a day when milk IS withheld: with nothing under
 * treatment there is nothing to block, and blocking a sale merely because the
 * milk sheet has not been filled in yet would be exactly the rigid validation
 * this product exists to avoid. When a cow IS under withdrawal, her litres are
 * fenced off and any attempt to sell past the saleable pool is forced into
 * WITHHELD_TREATMENT.
 */
export async function withdrawalGuard(
  dbo: Db,
  session: Session,
  date: ISODate,
  channel: DisposalChannel,
  litres: number,
  excludeDisposalId?: string,
): Promise<WithdrawalGuard> {
  const day = await dayProduction(session, date, dbo);
  const treated = day.withheldAnimals.filter((a) => isWithheldReason(a.reason));

  const base: WithdrawalGuard = {
    saleableL: day.saleableL,
    withheldL: day.withheldL,
    forcedL: 0,
    blocked: false,
    message: null,
    animals: treated,
  };

  if (!isRevenueChannel(channel)) return base;

  // DEFECT FIX: the guard used to read only the day's MILK RECORDS, so if the
  // can went to the co-op before the sheet was typed in — the ordinary order on
  // a farm where the rider leaves at six — a treated cow's milk sold with no
  // block and no warning at all. Ask the HEALTH record directly, so the warning
  // does not depend on the sheet already being filled in.
  const underWithdrawal = await withdrawalMap(dbo, session.farmId, date);
  // Restrict to cows actually in the tank today. A dry cow inside her 30-day
  // dry-cow-therapy window is under withdrawal but is not being milked, and
  // warning about her would be a false alarm — which is exactly how a warning
  // stops being read.
  const milkingToday = new Set((await lactatingHerd(dbo, session.farmId, date)).map((h) => h.id));
  for (const id of [...underWithdrawal.keys()]) {
    if (!milkingToday.has(id)) underWithdrawal.delete(id);
  }
  if (underWithdrawal.size > 0) {
    const names: string[] = [];
    let anyAssumed = false;
    for (const [animalId, w] of underWithdrawal) {
      const known = treated.find((a) => a.animalId === animalId);
      names.push(known?.name ?? (await animalName(dbo, session.farmId, animalId)));
      if (w.assumed) anyAssumed = true;
    }
    if (day.withheldL <= 0) {
      // Nothing recorded yet for these cows, so we cannot compute how many
      // litres to hold back. Warn by name rather than saying nothing — R4 says
      // do not refuse the sale, it does not say stay quiet.
      base.message =
        `${names.join(", ")} ${names.length === 1 ? "is" : "are"} under withdrawal today` +
        (anyAssumed ? " (and the withdrawal period was never recorded, so we are assuming the worst)" : "") +
        `. ${names.length === 1 ? "Her" : "Their"} milk must not go in this can. Record the milking first so the litres can be held back properly.`;
      base.animals = base.animals.length ? base.animals : [];
      return base;
    }
  }

  if (day.withheldL <= 0) return base;

  const existing = await dbo
    .select()
    .from(s.milkDisposal)
    .where(and(eq(s.milkDisposal.farmId, session.farmId), eq(s.milkDisposal.disposedOn, date)));

  const alreadySold = existing
    .filter((d) => isRevenueChannel(d.channel) && d.id !== excludeDisposalId)
    .reduce((a, d) => a + num(d.litres), 0);

  const room = money(Math.max(0, day.saleableL - alreadySold));
  if (litres <= room) return base;

  const forcedL = money(litres - room);
  const names = treated.map((a) => a.name).join(", ");
  // Say plainly when we are holding milk on an assumed window rather than a
  // recorded one — otherwise the farm never learns it has a label to go and
  // read, and the guess quietly becomes permanent.
  const anyAssumed = treated.some((a) => a.reason === "WITHDRAWAL_UNKNOWN");
  const assumedNote = anyAssumed
    ? " For at least one of them the withdrawal period was never recorded, so we are holding the milk on a safe estimate — check the label and enter the real period."
    : "";
  return {
    ...base,
    forcedL,
    blocked: true,
    message:
      `Only ${room} L of today's milk may be sold. ${names} ${treated.length === 1 ? "was" : "were"} treated, ` +
      `so ${forcedL} L is held back and recorded as withheld. Do not put it in the can — a rejected load costs the whole ` +
      `chilling plant, and the co-op passes that bill back to us.${assumedNote}`,
  };
}


/** A cow's name for a message, falling back to her tag. */
async function animalName(dbo: Db, farmId: string, animalId: string): Promise<string> {
  const [a] = await dbo
    .select({ name: s.animal.name, tag: s.animal.tag })
    .from(s.animal)
    .where(and(eq(s.animal.farmId, farmId), eq(s.animal.id, animalId)));
  return a?.name ?? a?.tag ?? "A treated cow";
}

/* ---------------------------------------------------------------- */
/* The allocation screen                                             */
/* ---------------------------------------------------------------- */

export interface AllocationLine {
  channel: DisposalChannel;
  label: string;
  icon: string;
  litres: number;
  valueKes: number;
  rateKesPerLitre: number | null;
  imputed: boolean;
  loss: boolean;
  revenue: boolean;
  count: number;
}

export interface Allocation {
  date: ISODate;
  production: DayProduction;
  lines: AllocationLine[];
  reconciliation: Reconciliation;
  blendedKes: number;
  revenueKes: number;
  imputedValueKes: number;
  lossL: number;
  lossPct: number;
  /** Litres still free to allocate. */
  unallocatedL: number;
  maxSaleableL: number;
  warnings: string[];
}

/**
 * `Σ(session yields) = Σ(disposals)`. The variance is surfaced, never hidden —
 * an unexplained gap between the parlour and the can is the classic milk-theft
 * signal and the farm wants it while it is still fixable.
 */
export async function allocateMilk(session: Session, date: ISODate, dbo?: Db): Promise<Allocation> {
  const database = await resolveDb(dbo);
  const production = await dayProduction(session, date, database);

  const disposals = await database
    .select()
    .from(s.milkDisposal)
    .where(and(eq(s.milkDisposal.farmId, session.farmId), eq(s.milkDisposal.disposedOn, date)));

  const byChannel = new Map<DisposalChannel, AllocationLine>();
  for (const d of disposals) {
    const line =
      byChannel.get(d.channel) ??
      {
        channel: d.channel,
        label: CHANNEL_LABEL[d.channel],
        icon: CHANNEL_ICON[d.channel],
        litres: 0,
        valueKes: 0,
        rateKesPerLitre: null,
        imputed: isImputedChannel(d.channel),
        loss: isLossChannel(d.channel),
        revenue: isRevenueChannel(d.channel),
        count: 0,
      };
    line.litres = money(line.litres + num(d.litres));
    line.valueKes = money(line.valueKes + num(d.valueKes));
    line.count += 1;
    line.rateKesPerLitre = line.litres > 0 ? money(line.valueKes / line.litres) : null;
    byChannel.set(d.channel, line);
  }

  const lines = [...byChannel.values()].sort((a, b) => b.litres - a.litres);
  const reconciliation = reconcileDay(
    production.totalL,
    lines.map((l) => ({ channel: l.channel, litres: l.litres })),
  );
  const blend = blendedPricePerLitre(
    lines.map((l) => ({ channel: l.channel, litres: l.litres, valueKes: l.valueKes })),
  );

  const warnings: string[] = [];
  if (!reconciliation.balanced) warnings.push(reconciliation.message);
  if (production.withheldL > 0) {
    const names = production.withheldAnimals
      .filter((a) => isWithheldReason(a.reason))
      .map((a) => a.name);
    if (names.length) {
      warnings.push(
        `${production.withheldL} L is withheld today — ${names.join(", ")} ${names.length === 1 ? "was" : "were"} treated. Keep it out of the can.`,
      );
    }
  }
  const loss = lines.filter((l) => l.loss).reduce((a, l) => a + l.litres, 0);
  if (lossRatePct(production.totalL, loss) > 6.4) {
    warnings.push(
      `Losses are running at ${lossRatePct(production.totalL, loss)}% of production today. Kenyan farms average 1.3–6.4%.`,
    );
  }

  const allocatedL = lines.reduce((a, l) => a + l.litres, 0);

  return {
    date,
    production,
    lines,
    reconciliation,
    blendedKes: blend.blendedKes,
    revenueKes: blend.revenueKes,
    imputedValueKes: money(lines.filter((l) => l.imputed).reduce((a, l) => a + l.valueKes, 0)),
    lossL: money(loss),
    lossPct: lossRatePct(production.totalL, loss),
    unallocatedL: money(production.totalL - allocatedL),
    maxSaleableL: production.saleableL,
    warnings,
  };
}

/* ---------------------------------------------------------------- */
/* Recording a disposal                                              */
/* ---------------------------------------------------------------- */

const DisposalInput = z.object({
  id: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-08-03."),
  session: z.enum(s.SESSIONS).optional(),
  channel: z.enum(s.DISPOSAL_CHANNELS),
  customerId: z.string().uuid().optional().nullable(),
  litres: z.coerce.number().min(0).max(100000),
  rateKesPerLitre: z.coerce.number().min(0).optional().nullable(),
  settlement: z.enum(["CASH", "MPESA", "CREDIT", "COOP_CHECKOFF", "NONE"]).optional(),
  lossReason: z
    .enum([
      "SPILLAGE", "SPOILAGE", "SOURED", "ADULTERATION", "NON_COLLECTION",
      "FAILED_ALCOHOL", "FAILED_LACTOMETER", "ORGANOLEPTIC", "OTHER",
    ])
    .optional()
    .nullable(),
  deliveryNoteNo: z.string().max(40).optional().nullable(),
  butterfatPct: z.coerce.number().optional().nullable(),
  proteinPct: z.coerce.number().optional().nullable(),
  snfPct: z.coerce.number().optional().nullable(),
  lactometerReading: z.coerce.number().optional().nullable(),
  alcoholTest: z.enum(["PASS", "FAIL"]).optional().nullable(),
  accepted: z.boolean().optional().nullable(),
});

/** Loose on the way in — forms post strings, Zod coerces, the shape is checked. */
export interface DisposalInputShape {
  id?: string;
  date: string;
  session?: MilkingSession;
  channel: DisposalChannel;
  customerId?: string | null;
  litres: number | string;
  rateKesPerLitre?: number | string | null;
  settlement?: "CASH" | "MPESA" | "CREDIT" | "COOP_CHECKOFF" | "NONE";
  lossReason?:
    | "SPILLAGE" | "SPOILAGE" | "SOURED" | "ADULTERATION" | "NON_COLLECTION"
    | "FAILED_ALCOHOL" | "FAILED_LACTOMETER" | "ORGANOLEPTIC" | "OTHER"
    | null;
  deliveryNoteNo?: string | null;
  butterfatPct?: number | string | null;
  proteinPct?: number | string | null;
  snfPct?: number | string | null;
  lactometerReading?: number | string | null;
  alcoholTest?: "PASS" | "FAIL" | null;
  accepted?: boolean | null;
}

export interface DisposalResult {
  id: string;
  channel: DisposalChannel;
  /** What the caller asked for, if we had to override it. */
  requestedChannel: DisposalChannel;
  litres: number;
  rateKesPerLitre: number | null;
  valueKes: number;
  forcedL: number;
  blockMessage: string | null;
  legality: SaleLegality | null;
  duplicate: boolean;
  refCode: string;
}

/**
 * One row per channel. Non-revenue channels still carry a rate so the owner can
 * see what the "free" milk cost; loss channels carry a coded reason, because you
 * cannot fix what you cannot group.
 */
export async function recordDisposal(
  session: Session,
  input: DisposalInputShape,
  dbo?: Db,
): Promise<ActionResult<DisposalResult>> {
  return guard(async () => {
    const parsed = DisposalInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const d = parsed.data;
    const database = await resolveDb(dbo);

    if (isLossChannel(d.channel) && d.channel !== "WITHHELD_TREATMENT" && d.channel !== "WITHHELD_COLOSTRUM") {
      if (!d.lossReason) {
        return actionError("Say what happened to the milk — spilled, soured, rejected.", {
          lossReason: ["Pick a reason."],
        });
      }
    }

    let customer: typeof s.customer.$inferSelect | null = null;
    if (d.customerId) {
      customer =
        (await database.query.customer.findFirst({
          where: and(eq(s.customer.id, d.customerId), eq(s.customer.farmId, session.farmId)),
        })) ?? null;
      assertOwned(customer, session, "customer");
    }

    // THE HARD BLOCK. Computed on the server from the health record.
    const guardResult = await withdrawalGuard(database, session, d.date, d.channel, d.litres, d.id);

    let channel: DisposalChannel = d.channel;
    let litres = d.litres;
    let forcedRowId: string | null = null;
    if (guardResult.blocked) {
      litres = money(d.litres - guardResult.forcedL);
      if (litres <= 0) {
        // The whole request is withdrawal milk. It becomes a withholding, not a sale.
        channel = "WITHHELD_TREATMENT";
        litres = d.litres;
      }
    }

    // Rate. Never prefilled from the customer's last invoice — money is the one
    // thing R5 forbids prefilling — but resolved from the effective price list.
    let rate = d.rateKesPerLitre ?? null;
    if (rate == null) {
      if (customer) {
        rate = await resolveRate(database, session.farmId, {
          customerId: customer.id,
          customerType: customer.customerType,
          onDate: d.date,
          litres,
        });
      } else if (isImputedChannel(channel)) {
        rate = await imputedRate(database, session.farmId, d.date);
      }
    }
    if (isLossChannel(channel) && d.rateKesPerLitre == null) {
      // A loss is valued too — that is the point of measuring it.
      rate = await imputedRate(database, session.farmId, d.date);
    }
    const valueKes = rate == null ? 0 : money(rate * litres);

    // Legality is surfaced, not enforced: the farm decides, with the rule in
    // front of it. Only withdrawal blocks.
    let legality: SaleLegality | null = null;
    if (customer && isRevenueChannel(channel)) {
      const farm = await database.query.farm.findFirst({ where: eq(s.farm.id, session.farmId) });
      const permit = await database
        .select()
        .from(s.complianceDocument)
        .where(
          and(
            eq(s.complianceDocument.farmId, session.farmId),
            eq(s.complianceDocument.docType, "MILK_TRANSPORT_PERMIT"),
            gte(s.complianceDocument.expiresOn, d.date),
          ),
        );
      legality = checkSaleLegality({
        farmAreaClass: farm?.areaClass ?? "RURAL",
        customerAreaClass: customer.areaClass,
        customerType: customer.customerType,
        pasteurised: false,
        fulfilment: customer.fulfilment,
        hasMilkTransportPermit: permit.length > 0,
      });
    }

    const id = d.id ?? newId();
    const existing = await database
      .select({ id: s.milkDisposal.id })
      .from(s.milkDisposal)
      .where(and(eq(s.milkDisposal.farmId, session.farmId), eq(s.milkDisposal.id, id)));

    await database
      .insert(s.milkDisposal)
      .values({
        id,
        farmId: session.farmId,
        disposedOn: d.date,
        session: d.session ?? null,
        channel,
        customerId: customer?.id ?? null,
        litres: dec(litres, 2),
        rateKesPerLitre: rate == null ? null : dec(rate, 2),
        valueKes: dec(valueKes, 2),
        settlement: d.settlement ?? (isRevenueChannel(channel) ? "CREDIT" : "NONE"),
        butterfatPct: d.butterfatPct == null ? null : dec(d.butterfatPct, 2),
        proteinPct: d.proteinPct == null ? null : dec(d.proteinPct, 2),
        snfPct: d.snfPct == null ? null : dec(d.snfPct, 2),
        lactometerReading: d.lactometerReading == null ? null : dec(d.lactometerReading, 4),
        alcoholTest: d.alcoholTest ?? null,
        accepted: d.accepted ?? null,
        lossReason: d.lossReason ?? null,
        deliveryNoteNo: d.deliveryNoteNo ?? null,
        recordedBy: session.userId,
      })
      .onConflictDoNothing();

    // The forced remainder is a SEPARATE row, so the withholding is visible in
    // the day's reconciliation rather than quietly shaving the sale.
    if (guardResult.blocked && guardResult.forcedL > 0 && channel !== "WITHHELD_TREATMENT") {
      forcedRowId = deterministicUuid(`${id}|withheld`);
      await database
        .insert(s.milkDisposal)
        .values({
          id: forcedRowId,
          farmId: session.farmId,
          disposedOn: d.date,
          session: d.session ?? null,
          channel: "WITHHELD_TREATMENT",
          litres: dec(guardResult.forcedL, 2),
          rateKesPerLitre: rate == null ? null : dec(rate, 2),
          valueKes: rate == null ? "0.00" : dec(money(rate * guardResult.forcedL), 2),
          settlement: "NONE",
          recordedBy: session.userId,
        })
        .onConflictDoNothing();
    }

    const ref = deterministicRef(REF_PREFIX.SALE, `${session.farmId}|${id}`);
    await database
      .insert(s.receipt)
      .values({
        id: newId(),
        farmId: session.farmId,
        refCode: ref,
        kind: "SALE",
        summary: `${litres} L to ${customer?.name ?? CHANNEL_LABEL[channel]}${rate ? ` at ${kes(rate, 2)} a litre — ${kes(valueKes)}` : ""}`,
        actorId: session.userId,
        at: new Date(),
        payload: {
          date: d.date,
          channel,
          litres,
          valueKes,
          lines: [
            `${litres} L — ${CHANNEL_LABEL[channel]}${customer ? ` (${customer.name})` : ""}`,
            ...(rate ? [`${kes(rate, 2)} a litre — ${kes(valueKes)}`] : []),
            ...(guardResult.message ? [guardResult.message] : []),
            ...(legality?.blockers ?? []),
            ...(legality?.warnings ?? []),
          ],
        },
      })
      .onConflictDoNothing();

    return actionOk(
      {
        id,
        channel,
        requestedChannel: d.channel,
        litres,
        rateKesPerLitre: rate,
        valueKes,
        forcedL: guardResult.forcedL,
        blockMessage: guardResult.message,
        legality,
        duplicate: existing.length > 0,
        refCode: ref,
      },
      guardResult.blocked
        ? guardResult.message!
        : `${litres} L recorded to ${customer?.name ?? CHANNEL_LABEL[channel]}.`,
      ref,
    );
  });
}

/* ---------------------------------------------------------------- */
/* Customers                                                         */
/* ---------------------------------------------------------------- */

const CustomerInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2, "A name we will recognise on the round."),
  customerType: z.enum(s.CUSTOMER_TYPES),
  institutionKind: z.enum(["SCHOOL", "HOSPITAL", "HOTEL", "RESTAURANT", "COLLEGE", "OTHER"]).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  location: z.string().max(120).optional().nullable(),
  areaClass: z.enum(["RURAL", "URBAN"]).default("RURAL"),
  fulfilment: z.enum(["GATE_COLLECTION", "DELIVERED"]).default("DELIVERED"),
  paymentTerms: z.enum(s.PAYMENT_TERMS).default("CASH"),
  settlementDay: z.coerce.number().int().min(1).max(28).optional().nullable(),
  creditLimitKes: z.coerce.number().min(0).optional().nullable(),
  requiresInvoice: z.boolean().optional(),
  requiresDeliveryNote: z.boolean().optional(),
  kraPin: z.string().max(20).optional().nullable(),
  routeId: z.string().uuid().optional().nullable(),
});

export interface CustomerInputShape {
  id?: string;
  name: string;
  customerType: CustomerType;
  institutionKind?: "SCHOOL" | "HOSPITAL" | "HOTEL" | "RESTAURANT" | "COLLEGE" | "OTHER" | null;
  phone?: string | null;
  location?: string | null;
  areaClass?: "RURAL" | "URBAN";
  fulfilment?: "GATE_COLLECTION" | "DELIVERED";
  paymentTerms?: PaymentTerms;
  settlementDay?: number | string | null;
  creditLimitKes?: number | string | null;
  requiresInvoice?: boolean;
  requiresDeliveryNote?: boolean;
  kraPin?: string | null;
  routeId?: string | null;
}

export async function createCustomer(
  session: Session,
  input: CustomerInputShape,
  dbo?: Db,
): Promise<ActionResult<{ id: string; legality: SaleLegality }>> {
  return guard(async () => {
    const parsed = CustomerInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const c = parsed.data;
    const database = await resolveDb(dbo);
    const farm = await database.query.farm.findFirst({ where: eq(s.farm.id, session.farmId) });

    const id = c.id ?? newId();
    await database
      .insert(s.customer)
      .values({
        id,
        farmId: session.farmId,
        name: c.name,
        customerType: c.customerType,
        institutionKind: c.institutionKind ?? null,
        phone: c.phone ?? null,
        location: c.location ?? null,
        areaClass: c.areaClass,
        fulfilment: c.fulfilment,
        paymentTerms: c.paymentTerms,
        settlementDay: c.settlementDay ?? null,
        creditLimitKes: c.creditLimitKes == null ? null : dec(c.creditLimitKes, 2),
        requiresInvoice: c.requiresInvoice ?? c.customerType === "INSTITUTION",
        requiresDeliveryNote: c.requiresDeliveryNote ?? c.customerType === "INSTITUTION",
        kraPin: c.kraPin ?? null,
        routeId: c.routeId ?? null,
        startedOn: today(),
      })
      .onConflictDoNothing();

    const legality = checkSaleLegality({
      farmAreaClass: farm?.areaClass ?? "RURAL",
      customerAreaClass: c.areaClass,
      customerType: c.customerType,
      pasteurised: false,
      fulfilment: c.fulfilment,
      hasMilkTransportPermit: false,
    });

    return actionOk({ id, legality }, `${c.name} added.`);
  });
}

/** Approved payments only — a pending payment has not been proven to exist. */
async function ledgerRowsFor(
  dbo: Db,
  farmId: string,
  customerId: string,
): Promise<{ approved: LedgerRow[]; pendingKes: number; all: typeof s.customerLedgerEntry.$inferSelect[] }> {
  const rows = await dbo
    .select()
    .from(s.customerLedgerEntry)
    .where(and(eq(s.customerLedgerEntry.farmId, farmId), eq(s.customerLedgerEntry.customerId, customerId)))
    .orderBy(asc(s.customerLedgerEntry.entryDate));

  const approved: LedgerRow[] = [];
  let pendingKes = 0;
  for (const r of rows) {
    const isUnapprovedPayment = r.entryType === "PAYMENT" && r.approvedBy === null;
    if (isUnapprovedPayment) {
      pendingKes = money(pendingKes + num(r.creditKes));
      continue;
    }
    approved.push({
      entryDate: r.entryDate,
      entryType: r.entryType,
      debitKes: r.debitKes,
      creditKes: r.creditKes,
    });
  }
  return { approved, pendingKes, all: rows };
}

export interface CustomerSummary {
  id: string;
  name: string;
  customerType: CustomerType;
  phone: string | null;
  paymentTerms: PaymentTerms;
  creditLimitKes: number | null;
  balance: CustomerBalance;
  /** Recorded by staff and not yet approved by a manager. */
  pendingPaymentsKes: number;
  overLimit: boolean;
  active: boolean;
  warning: string | null;
}

export async function listCustomers(
  session: Session,
  asOf: ISODate = today(),
  dbo?: Db,
): Promise<CustomerSummary[]> {
  requireCap(session, "VIEW_MONEY");
  const database = await resolveDb(dbo);
  const customers = await database
    .select()
    .from(s.customer)
    .where(eq(s.customer.farmId, session.farmId))
    .orderBy(asc(s.customer.name));

  const out: CustomerSummary[] = [];
  for (const c of customers) {
    const { approved, pendingKes } = await ledgerRowsFor(database, session.farmId, c.id);
    const balance = customerBalance(approved, asOf);
    const limit = c.creditLimitKes == null ? null : num(c.creditLimitKes);
    const check = checkCreditLimit(balance, limit, 0, c.name);
    out.push({
      id: c.id,
      name: c.name,
      customerType: c.customerType,
      phone: c.phone,
      paymentTerms: c.paymentTerms,
      creditLimitKes: limit,
      balance,
      pendingPaymentsKes: pendingKes,
      overLimit: check.overLimit,
      active: c.active,
      warning: check.message,
    });
  }
  return out.sort((a, b) => b.balance.balanceKes - a.balance.balanceKes);
}

export interface CustomerLedgerView {
  customer: typeof s.customer.$inferSelect;
  entries: Array<{
    id: string;
    entryDate: ISODate;
    entryType: string;
    litres: number | null;
    rateKesPerLitre: number | null;
    debitKes: number;
    creditKes: number;
    runningBalanceKes: number;
    note: string | null;
    paymentMethod: string | null;
    mpesaRef: string | null;
    pending: boolean;
  }>;
  balance: CustomerBalance;
  pendingPaymentsKes: number;
  creditCheck: CreditCheck;
  aging: AgingReport;
}

export async function customerLedger(
  session: Session,
  customerId: string,
  asOf: ISODate = today(),
  dbo?: Db,
): Promise<CustomerLedgerView> {
  requireCap(session, "VIEW_MONEY");
  const database = await resolveDb(dbo);
  const customer = await database.query.customer.findFirst({
    where: and(eq(s.customer.id, customerId), eq(s.customer.farmId, session.farmId)),
  });
  assertOwned(customer, session, "customer");

  const { approved, pendingKes, all } = await ledgerRowsFor(database, session.farmId, customerId);
  const balance = customerBalance(approved, asOf);
  const limit = customer!.creditLimitKes == null ? null : num(customer!.creditLimitKes);

  let running = 0;
  const entries = all
    .filter((r) => r.entryDate <= asOf)
    .map((r) => {
      const pending = r.entryType === "PAYMENT" && r.approvedBy === null;
      if (!pending) running = money(running + num(r.debitKes) - num(r.creditKes));
      return {
        id: r.id,
        entryDate: r.entryDate,
        entryType: r.entryType,
        litres: r.litres == null ? null : num(r.litres),
        rateKesPerLitre: r.rateKesPerLitre == null ? null : num(r.rateKesPerLitre),
        debitKes: num(r.debitKes),
        creditKes: num(r.creditKes),
        runningBalanceKes: running,
        note: r.note,
        paymentMethod: r.paymentMethod,
        mpesaRef: r.mpesaRef,
        pending,
      };
    });

  return {
    customer: customer!,
    entries,
    balance,
    pendingPaymentsKes: pendingKes,
    creditCheck: checkCreditLimit(balance, limit, 0, customer!.name),
    aging: agingForEntries(all, customer!, asOf),
  };
}

/**
 * FIFO the payments against the deliveries, then age what is left. This is the
 * bucket structure an institution's finance office will recognise.
 */
function agingForEntries(
  rows: typeof s.customerLedgerEntry.$inferSelect[],
  customer: typeof s.customer.$inferSelect,
  asOf: ISODate,
): AgingReport {
  const debits = rows
    .filter((r) => r.entryDate <= asOf && num(r.debitKes) > 0)
    .map((r) => ({ entryDate: r.entryDate, remaining: num(r.debitKes) }))
    .sort((a, b) => (a.entryDate < b.entryDate ? -1 : 1));

  let credit = rows
    .filter((r) => r.entryDate <= asOf && r.entryType !== "PAYMENT")
    .reduce((a, r) => a + num(r.creditKes), 0);
  credit += rows
    .filter((r) => r.entryDate <= asOf && r.entryType === "PAYMENT" && r.approvedBy !== null)
    .reduce((a, r) => a + num(r.creditKes), 0);

  for (const d of debits) {
    if (credit <= 0) break;
    const applied = Math.min(credit, d.remaining);
    d.remaining = money(d.remaining - applied);
    credit = money(credit - applied);
  }

  return ageReceivables(
    debits
      .filter((d) => d.remaining > 0.005)
      .map((d) => ({
        amountKes: d.remaining,
        dueOn: dueDateFor(customer.paymentTerms, d.entryDate, customer.settlementDay),
      })),
    asOf,
  );
}

/* ---------------------------------------------------------------- */
/* Standing orders and the delivery round                            */
/* ---------------------------------------------------------------- */

const StandingOrderInput = z.object({
  id: z.string().uuid().optional(),
  customerId: z.string().uuid(),
  litres: z.coerce.number().min(0.1),
  session: z.enum(s.SESSIONS),
  daysOfWeek: z.array(z.coerce.number().int().min(1).max(7)).min(1, "Which days?"),
  rateKesPerLitre: z.coerce.number().min(0).optional().nullable(),
  activeFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  activeTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  pausedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  pausedTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export interface StandingOrderInputShape {
  id?: string;
  customerId: string;
  litres: number | string;
  session: MilkingSession;
  daysOfWeek: Array<number | string>;
  rateKesPerLitre?: number | string | null;
  activeFrom: string;
  activeTo?: string | null;
  pausedFrom?: string | null;
  pausedTo?: string | null;
}

export async function createStandingOrder(
  session: Session,
  input: StandingOrderInputShape,
  dbo?: Db,
): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const parsed = StandingOrderInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const o = parsed.data;
    const database = await resolveDb(dbo);
    const customer = await database.query.customer.findFirst({
      where: and(eq(s.customer.id, o.customerId), eq(s.customer.farmId, session.farmId)),
    });
    assertOwned(customer, session, "customer");

    const id = o.id ?? newId();
    await database
      .insert(s.standingOrder)
      .values({
        id,
        farmId: session.farmId,
        customerId: o.customerId,
        litres: dec(o.litres, 2),
        session: o.session,
        daysOfWeek: o.daysOfWeek,
        rateKesPerLitre: o.rateKesPerLitre == null ? null : dec(o.rateKesPerLitre, 2),
        activeFrom: o.activeFrom,
        activeTo: o.activeTo ?? null,
        pausedFrom: o.pausedFrom ?? null,
        pausedTo: o.pausedTo ?? null,
      })
      .onConflictDoNothing();

    return actionOk({ id }, `${customer!.name}: ${o.litres} L every ${sessionLabel(o.session).toLowerCase()}.`);
  });
}

/** Pause, never delete — a school on holiday is still a customer in January. */
export async function pauseStandingOrder(
  session: Session,
  orderId: string,
  from: ISODate,
  to: ISODate | null,
  dbo?: Db,
): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const database = await resolveDb(dbo);
    const order = await database.query.standingOrder.findFirst({
      where: and(eq(s.standingOrder.id, orderId), eq(s.standingOrder.farmId, session.farmId)),
    });
    assertOwned(order, session, "standing order");
    await database
      .update(s.standingOrder)
      .set({ pausedFrom: from, pausedTo: to })
      .where(and(eq(s.standingOrder.id, orderId), eq(s.standingOrder.farmId, session.farmId)));
    return actionOk({ id: orderId }, to ? `Paused until ${formatDay(to)}.` : "Paused until further notice.");
  });
}

export interface RoundStop {
  orderId: string | null;
  customerId: string;
  name: string;
  customerType: CustomerType;
  phone: string | null;
  location: string | null;
  litres: number;
  rateKesPerLitre: number | null;
  valueKes: number;
  requiresDeliveryNote: boolean;
  balanceKes: number;
  daysSincePayment: number | null;
  creditCheck: CreditCheck;
  /** Already delivered on this round today. */
  deliveredL: number | null;
  paused: boolean;
  pausedNote: string | null;
}

export interface DeliveryRound {
  date: ISODate;
  session: MilkingSession;
  stops: RoundStop[];
  totalLitres: number;
  totalValueKes: number;
  overLimit: RoundStop[];
  pausedToday: Array<{ customerId: string; name: string; note: string }>;
}

/**
 * The round, generated from standing orders and prefilled. The rider edits
 * exceptions only — the same two-tap pattern as the milk sheet, and the reason a
 * 13-customer round finishes in under two minutes.
 */
export async function deliveryRound(
  session: Session,
  date: ISODate,
  sessionName: MilkingSession,
  dbo?: Db,
): Promise<DeliveryRound> {
  const database = await resolveDb(dbo);

  const orders = await database
    .select()
    .from(s.standingOrder)
    .where(and(eq(s.standingOrder.farmId, session.farmId), eq(s.standingOrder.session, sessionName)));

  const customers = await database
    .select()
    .from(s.customer)
    .where(eq(s.customer.farmId, session.farmId));
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const rows: StandingOrderRow[] = orders.map((o) => ({
    id: o.id,
    customerId: o.customerId,
    litres: o.litres,
    session: o.session,
    daysOfWeek: o.daysOfWeek,
    rateKesPerLitre: o.rateKesPerLitre,
    activeFrom: o.activeFrom,
    activeTo: o.activeTo,
    pausedFrom: o.pausedFrom,
    pausedTo: o.pausedTo,
  }));

  const built = buildDeliveryRound(rows, date, sessionName);
  const builtIds = new Set(built.map((b) => b.orderId));

  const delivered = await database
    .select()
    .from(s.milkDisposal)
    .where(
      and(
        eq(s.milkDisposal.farmId, session.farmId),
        eq(s.milkDisposal.disposedOn, date),
        eq(s.milkDisposal.session, sessionName),
      ),
    );

  const prices = await priceRows(database, session.farmId);
  const stops: RoundStop[] = [];

  for (const b of built) {
    const c = customerById.get(b.customerId);
    if (!c || !c.active) continue;

    const rate =
      b.rateKesPerLitre ??
      resolvePrice(prices, {
        customerId: c.id,
        customerType: c.customerType,
        onDate: date,
        litres: b.litres,
      });

    const { approved } = await ledgerRowsFor(database, session.farmId, c.id);
    const balance = customerBalance(approved, date);
    const limit = c.creditLimitKes == null ? null : num(c.creditLimitKes);
    const value = rate == null ? 0 : money(rate * b.litres);
    const creditCheck = checkCreditLimit(balance, limit, value, c.name);

    const already = delivered.filter((d) => d.customerId === c.id);

    stops.push({
      orderId: b.orderId,
      customerId: c.id,
      name: c.name,
      customerType: c.customerType,
      phone: c.phone,
      location: c.location,
      litres: b.litres,
      rateKesPerLitre: rate,
      valueKes: value,
      requiresDeliveryNote: c.requiresDeliveryNote,
      balanceKes: balance.balanceKes,
      daysSincePayment: balance.daysSincePayment,
      creditCheck,
      deliveredL: already.length ? money(already.reduce((a, d) => a + num(d.litres), 0)) : null,
      paused: false,
      pausedNote: null,
    });
  }

  // Customers who WOULD be on the round but are paused today. Showing them is
  // the point — a silent absence looks like a forgotten stop.
  const pausedToday: DeliveryRound["pausedToday"] = [];
  for (const o of orders) {
    if (builtIds.has(o.id)) continue;
    const c = customerById.get(o.customerId);
    if (!c) continue;
    if (o.pausedFrom && date >= o.pausedFrom && (!o.pausedTo || date <= o.pausedTo)) {
      pausedToday.push({
        customerId: c.id,
        name: c.name,
        note: o.pausedTo ? `Paused until ${formatDay(o.pausedTo)}` : "Paused",
      });
    }
  }

  stops.sort((a, b) => a.name.localeCompare(b.name));

  return {
    date,
    session: sessionName,
    stops,
    totalLitres: money(stops.reduce((a, x) => a + x.litres, 0)),
    totalValueKes: money(stops.reduce((a, x) => a + x.valueKes, 0)),
    overLimit: stops.filter((x) => x.creditCheck.overLimit),
    pausedToday,
  };
}

/* ---------------------------------------------------------------- */
/* Deliveries                                                        */
/* ---------------------------------------------------------------- */

const DeliveryInput = z.object({
  id: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  session: z.enum(s.SESSIONS).optional(),
  customerId: z.string().uuid(),
  litres: z.coerce.number().min(0).max(100000),
  rateKesPerLitre: z.coerce.number().min(0).optional().nullable(),
  /** How it was settled AT THE DOOR. CREDIT means it went on the tab. */
  settlement: z.enum(["CASH", "MPESA", "CREDIT", "COOP_CHECKOFF"]).default("CREDIT"),
  mpesaRef: z.string().max(30).optional().nullable(),
  deliveryNoteNo: z.string().max(40).optional().nullable(),
  note: z.string().max(200).optional().nullable(),
});

export interface DeliveryInputShape {
  id?: string;
  date: string;
  session?: MilkingSession;
  customerId: string;
  litres: number | string;
  rateKesPerLitre?: number | string | null;
  settlement?: "CASH" | "MPESA" | "CREDIT" | "COOP_CHECKOFF";
  mpesaRef?: string | null;
  deliveryNoteNo?: string | null;
  note?: string | null;
}

export interface DeliveryResult {
  disposalId: string;
  litres: number;
  rateKesPerLitre: number | null;
  valueKes: number;
  /** The warning the rider saw BEFORE handing over the milk. */
  creditCheck: CreditCheck;
  legality: SaleLegality | null;
  onCredit: boolean;
  paymentPending: boolean;
  blockMessage: string | null;
  refCode: string;
  duplicate: boolean;
}

/** What the rider sees before knocking. No write, no side effect. */
export async function previewDelivery(
  session: Session,
  customerId: string,
  litres: number,
  date: ISODate = today(),
  dbo?: Db,
): Promise<{ creditCheck: CreditCheck; rateKesPerLitre: number | null; valueKes: number }> {
  const database = await resolveDb(dbo);
  const customer = await database.query.customer.findFirst({
    where: and(eq(s.customer.id, customerId), eq(s.customer.farmId, session.farmId)),
  });
  assertOwned(customer, session, "customer");

  const rate = await resolveRate(database, session.farmId, {
    customerId,
    customerType: customer!.customerType,
    onDate: date,
    litres,
  });
  const valueKes = rate == null ? 0 : money(rate * litres);
  const { approved } = await ledgerRowsFor(database, session.farmId, customerId);
  const balance = customerBalance(approved, date);
  const limit = customer!.creditLimitKes == null ? null : num(customer!.creditLimitKes);

  return {
    creditCheck: checkCreditLimit(balance, limit, valueKes, customer!.name),
    rateKesPerLitre: rate,
    valueKes,
  };
}

/**
 * A delivery is a DEBIT on the customer's tab. Money taken at the door adds a
 * matching CREDIT — and, when a rider took it, that credit sits pending until a
 * manager approves it. This is the point on a Kenyan farm where cash most often
 * goes missing, so the segregation is structural rather than advisory.
 */
export async function recordDelivery(
  session: Session,
  input: DeliveryInputShape,
  dbo?: Db,
): Promise<ActionResult<DeliveryResult>> {
  return guard(async () => {
    const parsed = DeliveryInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const d = parsed.data;
    const database = await resolveDb(dbo);

    const customer = await database.query.customer.findFirst({
      where: and(eq(s.customer.id, d.customerId), eq(s.customer.farmId, session.farmId)),
    });
    assertOwned(customer, session, "customer");

    // BEFORE the milk changes hands, not after the default.
    const preview = await previewDelivery(session, d.customerId, d.litres, d.date, database);
    const rate = d.rateKesPerLitre ?? preview.rateKesPerLitre;
    const valueKes = rate == null ? 0 : money(rate * d.litres);

    const disposalId = d.id ?? newId();
    const disposal = await recordDisposal(
      session,
      {
        id: disposalId,
        date: d.date,
        session: d.session,
        channel: channelForCustomerType(customer!.customerType),
        customerId: d.customerId,
        litres: d.litres,
        rateKesPerLitre: rate,
        settlement: d.settlement,
        deliveryNoteNo: d.deliveryNoteNo,
      },
      database,
    );
    if (!disposal.ok) return disposal as ActionResult<never>;

    const soldL = disposal.data.litres;
    const soldValueKes = disposal.data.valueKes;

    // The tab. Debit always; credit only if money actually moved.
    const debitId = deterministicUuid(`${disposalId}|debit`);
    await database
      .insert(s.customerLedgerEntry)
      .values({
        id: debitId,
        farmId: session.farmId,
        customerId: d.customerId,
        entryDate: d.date,
        entryType: "DELIVERY",
        litres: dec(soldL, 2),
        rateKesPerLitre: rate == null ? null : dec(rate, 2),
        debitKes: dec(soldValueKes, 2),
        creditKes: "0.00",
        milkDisposalId: disposalId,
        note: d.note ?? null,
        recordedBy: session.userId,
      })
      .onConflictDoNothing();

    const paidAtDoor = d.settlement === "CASH" || d.settlement === "MPESA";
    const canApprove = can(session.role, "APPROVE");
    if (paidAtDoor && soldValueKes > 0) {
      await database
        .insert(s.customerLedgerEntry)
        .values({
          id: deterministicUuid(`${disposalId}|credit`),
          farmId: session.farmId,
          customerId: d.customerId,
          entryDate: d.date,
          entryType: "PAYMENT",
          debitKes: "0.00",
          creditKes: dec(soldValueKes, 2),
          milkDisposalId: disposalId,
          paymentMethod: d.settlement,
          mpesaRef: d.mpesaRef ?? null,
          note: "Paid at the door",
          recordedBy: session.userId,
          approvedBy: canApprove ? session.userId : null,
        })
        .onConflictDoNothing();
    }

    const message = disposal.data.blockMessage
      ? disposal.data.blockMessage
      : `${soldL} L to ${customer!.name}${rate ? ` — ${kes(soldValueKes)}` : ""}${
          paidAtDoor ? " paid" : " on the tab"
        }.`;

    return actionOk(
      {
        disposalId,
        litres: soldL,
        rateKesPerLitre: rate,
        valueKes: soldValueKes,
        creditCheck: preview.creditCheck,
        legality: disposal.data.legality,
        onCredit: !paidAtDoor,
        paymentPending: paidAtDoor && !canApprove,
        blockMessage: disposal.data.blockMessage,
        refCode: disposal.data.refCode,
        duplicate: disposal.data.duplicate,
      },
      message,
      disposal.data.refCode,
    );
  });
}

export interface RoundResult {
  date: ISODate;
  session: MilkingSession;
  stops: number;
  litres: number;
  cashKes: number;
  mpesaKes: number;
  creditKes: number;
  pendingApprovalKes: number;
  overLimit: Array<{ name: string; message: string }>;
  refCode: string;
  receiptLines: string[];
  failures: Array<{ customerId: string; error: string }>;
}

/** The whole round in one save, with the takings split at the end (R7). */
export async function recordDeliveryRound(
  session: Session,
  input: { date: ISODate; session: MilkingSession; stops: DeliveryInputShape[] },
  dbo?: Db,
): Promise<ActionResult<RoundResult>> {
  return guard(async () => {
    const database = await resolveDb(dbo);
    const result: RoundResult = {
      date: input.date,
      session: input.session,
      stops: 0,
      litres: 0,
      cashKes: 0,
      mpesaKes: 0,
      creditKes: 0,
      pendingApprovalKes: 0,
      overLimit: [],
      refCode: "",
      receiptLines: [],
      failures: [],
    };

    const seeds: string[] = [];
    for (const stop of input.stops) {
      const id = stop.id ?? newId();
      seeds.push(id);
      const res = await recordDelivery(
        session,
        { ...stop, id, date: input.date, session: input.session },
        database,
      );
      if (!res.ok) {
        result.failures.push({ customerId: String(stop.customerId), error: res.error });
        continue;
      }
      result.stops += 1;
      result.litres = money(result.litres + res.data.litres);
      if (stop.settlement === "CASH") result.cashKes = money(result.cashKes + res.data.valueKes);
      else if (stop.settlement === "MPESA") result.mpesaKes = money(result.mpesaKes + res.data.valueKes);
      else result.creditKes = money(result.creditKes + res.data.valueKes);
      if (res.data.paymentPending) {
        result.pendingApprovalKes = money(result.pendingApprovalKes + res.data.valueKes);
      }
      if (res.data.creditCheck.overLimit) {
        result.overLimit.push({
          name: res.data.creditCheck.message?.split(" owes")[0] ?? "A customer",
          message: res.data.creditCheck.message ?? "",
        });
      }
    }

    const ref = deterministicRef(REF_PREFIX.DELIVERY, `${session.farmId}|${input.date}|${input.session}|${seeds.sort().join(",")}`);
    const summary = `${sessionLabel(input.session)} round — ${result.litres} L to ${result.stops} customer${result.stops === 1 ? "" : "s"}`;
    result.refCode = ref;
    result.receiptLines = [
      summary,
      `Collected ${kes(result.cashKes)} cash · ${kes(result.mpesaKes)} M-Pesa`,
      `On credit ${kes(result.creditKes)}`,
      ...(result.pendingApprovalKes > 0
        ? [`${kes(result.pendingApprovalKes)} waiting for the manager to confirm.`]
        : []),
      ...result.overLimit.map((o) => o.message),
    ];

    await database
      .insert(s.receipt)
      .values({
        id: newId(),
        farmId: session.farmId,
        refCode: ref,
        kind: "DELIVERY",
        summary,
        actorId: session.userId,
        at: new Date(),
        payload: { ...result, lines: result.receiptLines },
      })
      .onConflictDoNothing();

    return actionOk(result, summary, ref);
  });
}

/* ---------------------------------------------------------------- */
/* Payments                                                          */
/* ---------------------------------------------------------------- */

const PaymentInput = z.object({
  id: z.string().uuid().optional(),
  customerId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountKes: z.coerce.number().min(0.01, "How much was paid?"),
  paymentMethod: z.enum(s.PAYMENT_METHODS),
  mpesaRef: z.string().max(30).optional().nullable(),
  note: z.string().max(200).optional().nullable(),
});

export interface PaymentResult {
  id: string;
  pending: boolean;
  balanceAfterKes: number;
  refCode: string;
}

/**
 * Herdsmen and riders record; managers approve (R10). A payment recorded by
 * staff does not move the balance until it is confirmed.
 */
export interface PaymentInputShape {
  id?: string;
  customerId: string;
  date: string;
  amountKes: number | string;
  paymentMethod: s.PaymentMethod;
  mpesaRef?: string | null;
  note?: string | null;
}

export async function recordPayment(
  session: Session,
  input: PaymentInputShape,
  dbo?: Db,
): Promise<ActionResult<PaymentResult>> {
  return guard(async () => {
    const parsed = PaymentInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const p = parsed.data;
    const database = await resolveDb(dbo);

    const customer = await database.query.customer.findFirst({
      where: and(eq(s.customer.id, p.customerId), eq(s.customer.farmId, session.farmId)),
    });
    assertOwned(customer, session, "customer");

    const canApprove = can(session.role, "APPROVE");
    const id = p.id ?? newId();
    await database
      .insert(s.customerLedgerEntry)
      .values({
        id,
        farmId: session.farmId,
        customerId: p.customerId,
        entryDate: p.date,
        entryType: "PAYMENT",
        debitKes: "0.00",
        creditKes: dec(p.amountKes, 2),
        paymentMethod: p.paymentMethod,
        mpesaRef: p.mpesaRef ?? null,
        note: p.note ?? null,
        recordedBy: session.userId,
        approvedBy: canApprove ? session.userId : null,
      })
      .onConflictDoNothing();

    const { approved } = await ledgerRowsFor(database, session.farmId, p.customerId);
    const balance = customerBalance(approved, p.date);

    const ref = deterministicRef(REF_PREFIX.PAYMENT, `${session.farmId}|${id}`);
    const summary = `${customer!.name} paid ${kes(p.amountKes)} by ${p.paymentMethod === "MPESA" ? "M-Pesa" : p.paymentMethod.toLowerCase()}`;
    await database
      .insert(s.receipt)
      .values({
        id: newId(),
        farmId: session.farmId,
        refCode: ref,
        kind: "PAYMENT",
        summary,
        actorId: session.userId,
        at: new Date(),
        payload: {
          lines: [
            summary,
            canApprove
              ? `Balance now ${kes(balance.balanceKes)}.`
              : "Waiting for the manager to confirm before it comes off the balance.",
          ],
        },
      })
      .onConflictDoNothing();

    return actionOk(
      { id, pending: !canApprove, balanceAfterKes: balance.balanceKes, refCode: ref },
      canApprove
        ? `${summary}. Balance now ${kes(balance.balanceKes)}.`
        : `${summary}. Recorded — the manager will confirm it.`,
      ref,
    );
  });
}

export async function approvePayment(
  session: Session,
  entryId: string,
  dbo?: Db,
): Promise<ActionResult<{ id: string; balanceKes: number }>> {
  return guard(async () => {
    const database = await resolveDb(dbo);
    const entry = await database.query.customerLedgerEntry.findFirst({
      where: and(
        eq(s.customerLedgerEntry.id, entryId),
        eq(s.customerLedgerEntry.farmId, session.farmId),
      ),
    });
    assertOwned(entry, session, "payment");
    if (entry!.entryType !== "PAYMENT") {
      return actionError("Only a payment needs approving.");
    }
    if (entry!.approvedBy) {
      const { approved } = await ledgerRowsFor(database, session.farmId, entry!.customerId);
      return actionOk(
        { id: entryId, balanceKes: customerBalance(approved, entry!.entryDate).balanceKes },
        "Already confirmed.",
      );
    }

    await database
      .update(s.customerLedgerEntry)
      .set({ approvedBy: session.userId })
      .where(
        and(eq(s.customerLedgerEntry.id, entryId), eq(s.customerLedgerEntry.farmId, session.farmId)),
      );

    await database.insert(s.auditEntry).values({
      id: newId(),
      farmId: session.farmId,
      tableName: "customer_ledger_entry",
      rowId: entryId,
      action: "APPROVE",
      actorId: session.userId,
      at: new Date(),
      after: { approvedBy: session.userId },
    });

    const { approved } = await ledgerRowsFor(database, session.farmId, entry!.customerId);
    const balance = customerBalance(approved, today());
    return actionOk(
      { id: entryId, balanceKes: balance.balanceKes },
      `Confirmed. Balance now ${kes(balance.balanceKes)}.`,
    );
  });
}

export interface PendingPayment {
  id: string;
  customerId: string;
  customerName: string;
  entryDate: ISODate;
  amountKes: number;
  paymentMethod: string | null;
  mpesaRef: string | null;
  recordedByName: string | null;
}

export async function pendingPayments(session: Session, dbo?: Db): Promise<PendingPayment[]> {
  requireCap(session, "VIEW_MONEY");
  const database = await resolveDb(dbo);
  const rows = await database
    .select({ entry: s.customerLedgerEntry, customer: s.customer, user: s.appUser })
    .from(s.customerLedgerEntry)
    .innerJoin(s.customer, eq(s.customer.id, s.customerLedgerEntry.customerId))
    .leftJoin(s.appUser, eq(s.appUser.id, s.customerLedgerEntry.recordedBy))
    .where(
      and(
        eq(s.customerLedgerEntry.farmId, session.farmId),
        eq(s.customerLedgerEntry.entryType, "PAYMENT"),
        isNull(s.customerLedgerEntry.approvedBy),
      ),
    )
    .orderBy(desc(s.customerLedgerEntry.entryDate));

  return rows.map((r) => ({
    id: r.entry.id,
    customerId: r.customer.id,
    customerName: r.customer.name,
    entryDate: r.entry.entryDate,
    amountKes: num(r.entry.creditKes),
    paymentMethod: r.entry.paymentMethod,
    mpesaRef: r.entry.mpesaRef,
    recordedByName: r.user?.fullName ?? null,
  }));
}

/* ---------------------------------------------------------------- */
/* Invoices and aging                                                */
/* ---------------------------------------------------------------- */

const InvoiceInput = z.object({
  id: z.string().uuid().optional(),
  customerId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  invoiceNo: z.string().max(40).optional(),
  taxKes: z.coerce.number().min(0).optional(),
  lpoId: z.string().uuid().optional().nullable(),
  etimsRef: z.string().max(40).optional().nullable(),
});

export interface InvoiceResult {
  id: string;
  invoiceNo: string;
  totalLitres: number;
  totalKes: number;
  dueOn: ISODate;
  deliveries: number;
  refCode: string;
}

/** An institutional delivery is a receivable. The invoice is what makes it one. */
export interface InvoiceInputShape {
  id?: string;
  customerId: string;
  periodStart: string;
  periodEnd: string;
  issuedOn?: string;
  invoiceNo?: string;
  taxKes?: number | string;
  lpoId?: string | null;
  etimsRef?: string | null;
}

export async function createInvoice(
  session: Session,
  input: InvoiceInputShape,
  dbo?: Db,
): Promise<ActionResult<InvoiceResult>> {
  return guard(async () => {
    const parsed = InvoiceInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const i = parsed.data;
    const database = await resolveDb(dbo);

    const customer = await database.query.customer.findFirst({
      where: and(eq(s.customer.id, i.customerId), eq(s.customer.farmId, session.farmId)),
    });
    assertOwned(customer, session, "customer");

    const deliveries = await database
      .select()
      .from(s.milkDisposal)
      .where(
        and(
          eq(s.milkDisposal.farmId, session.farmId),
          eq(s.milkDisposal.customerId, i.customerId),
          gte(s.milkDisposal.disposedOn, i.periodStart),
          lte(s.milkDisposal.disposedOn, i.periodEnd),
        ),
      );

    if (deliveries.length === 0) {
      return actionError(`Nothing was delivered to ${customer!.name} in that period.`);
    }

    const totalLitres = money(deliveries.reduce((a, d) => a + num(d.litres), 0));
    const subtotal = money(deliveries.reduce((a, d) => a + num(d.valueKes), 0));
    const tax = money(i.taxKes ?? 0);
    const total = money(subtotal + tax);
    const issuedOn = i.issuedOn ?? today();
    const dueOn = dueDateFor(customer!.paymentTerms, issuedOn, customer!.settlementDay);
    const invoiceNo = i.invoiceNo ?? `INV-${issuedOn.replace(/-/g, "")}-${customer!.name.slice(0, 3).toUpperCase()}`;

    const id = i.id ?? newId();
    await database
      .insert(s.salesInvoice)
      .values({
        id,
        farmId: session.farmId,
        customerId: i.customerId,
        invoiceNo,
        issuedOn,
        periodStart: i.periodStart,
        periodEnd: i.periodEnd,
        totalLitres: dec(totalLitres, 2),
        subtotalKes: dec(subtotal, 2),
        taxKes: dec(tax, 2),
        totalKes: dec(total, 2),
        dueOn,
        status: "ISSUED",
        lpoId: i.lpoId ?? null,
        etimsRef: i.etimsRef ?? null,
      })
      .onConflictDoNothing();

    const ref = deterministicRef("IN", `${session.farmId}|${id}`);
    const summary = `Invoice ${invoiceNo} — ${customer!.name}, ${totalLitres} L, ${kes(total)}, due ${formatDay(dueOn)}`;
    await database
      .insert(s.receipt)
      .values({
        id: newId(),
        farmId: session.farmId,
        refCode: ref,
        kind: "INVOICE",
        summary,
        actorId: session.userId,
        at: new Date(),
        payload: {
          lines: [
            summary,
            `${deliveries.length} deliveries between ${formatDay(i.periodStart)} and ${formatDay(i.periodEnd)}`,
            `Terms: ${customer!.paymentTerms.replace("_", " ").toLowerCase()}`,
          ],
        },
      })
      .onConflictDoNothing();

    return actionOk(
      { id, invoiceNo, totalLitres, totalKes: total, dueOn, deliveries: deliveries.length, refCode: ref },
      summary,
      ref,
    );
  });
}

export interface DebtorRow {
  customerId: string;
  name: string;
  customerType: CustomerType;
  balanceKes: number;
  daysSincePayment: number | null;
  oldestDays: number;
  aging: AgingReport;
  overLimit: boolean;
  /** Money the farm is entitled to and almost never claims. */
  interestKes: number;
  interestNote: string | null;
}

export interface AgingView {
  asOf: ISODate;
  total: AgingReport;
  debtors: DebtorRow[];
  worst: DebtorRow[];
  cbkBaseRatePct: number;
}

/** Current / 30 / 60 / 90+, worst offenders named. */
export async function debtorAging(
  session: Session,
  asOf: ISODate = today(),
  dbo?: Db,
): Promise<AgingView> {
  requireCap(session, "VIEW_MONEY");
  const database = await resolveDb(dbo);
  const customers = await database.select().from(s.customer).where(eq(s.customer.farmId, session.farmId));

  const cbkRow = await database
    .select()
    .from(s.referenceValue)
    .where(and(eq(s.referenceValue.kind, "RATE"), eq(s.referenceValue.key, "CBK_BASE")))
    .orderBy(desc(s.referenceValue.effectiveFrom))
    .limit(1);
  const cbkBaseRatePct = cbkRow[0]?.valueNumeric ? num(cbkRow[0].valueNumeric) : 9.5;

  const total: AgingReport = { CURRENT: 0, D30: 0, D60: 0, D90_PLUS: 0, totalKes: 0, oldestDays: 0 };
  const debtors: DebtorRow[] = [];

  for (const c of customers) {
    const { approved, all } = await ledgerRowsFor(database, session.farmId, c.id);
    const balance = customerBalance(approved, asOf);
    if (balance.balanceKes <= 0.005) continue;

    const aging = agingForEntries(all, c, asOf);
    const limit = c.creditLimitKes == null ? null : num(c.creditLimitKes);
    const overdueKes = money(aging.D30 + aging.D60 + aging.D90_PLUS);
    const interest =
      overdueKes > 0 && aging.oldestDays > 0
        ? latePaymentInterestKes(overdueKes, addDays(asOf, -aging.oldestDays), asOf, cbkBaseRatePct)
        : null;

    for (const k of ["CURRENT", "D30", "D60", "D90_PLUS"] as const) {
      total[k] = money(total[k] + aging[k]);
    }
    total.totalKes = money(total.totalKes + aging.totalKes);
    total.oldestDays = Math.max(total.oldestDays, aging.oldestDays);

    debtors.push({
      customerId: c.id,
      name: c.name,
      customerType: c.customerType,
      balanceKes: balance.balanceKes,
      daysSincePayment: balance.daysSincePayment,
      oldestDays: aging.oldestDays,
      aging,
      overLimit: checkCreditLimit(balance, limit, 0, c.name).overLimit,
      interestKes: interest?.interestKes ?? 0,
      interestNote: interest?.message ?? null,
    });
  }

  debtors.sort((a, b) => b.balanceKes - a.balanceKes);
  return {
    asOf,
    total,
    debtors,
    worst: debtors.filter((d) => d.aging.D60 > 0 || d.aging.D90_PLUS > 0).slice(0, 5),
    cbkBaseRatePct,
  };
}

/* ---------------------------------------------------------------- */
/* Co-op statement reconciliation                                    */
/* ---------------------------------------------------------------- */

const DEDUCTION_TO_EXPENSE: Record<string, s.ExpenseCategory | null> = {
  AI: "BREEDING",
  FEEDS: "FEEDS",
  VET: "VETERINARY",
  TRANSPORT: "TRANSPORT",
  ADVANCE: null,
  SACCO_LOAN: "LOAN",
  SHARES: null,
  MEMBERSHIP: "LICENCES",
  OTHER: null,
};

const StatementInput = z.object({
  id: z.string().uuid().optional(),
  customerId: z.string().uuid(),
  memberNo: z.string().max(40).optional().nullable(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coopLitres: z.coerce.number().min(0),
  rateKesPerLitre: z.coerce.number().min(0),
  qualityBonusKes: z.coerce.number().optional(),
  cessKes: z.coerce.number().optional(),
  grossPayKes: z.coerce.number(),
  netPayKes: z.coerce.number(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  deductions: z
    .array(
      z.object({
        deductionType: z.enum([
          "AI", "FEEDS", "VET", "ADVANCE", "SACCO_LOAN", "SHARES", "TRANSPORT", "MEMBERSHIP", "OTHER",
        ]),
        description: z.string().max(200).optional().nullable(),
        amountKes: z.coerce.number().min(0),
        balanceRemainingKes: z.coerce.number().optional().nullable(),
      }),
    )
    .default([]),
});

export interface StatementResult {
  id: string;
  reconciliation: StatementReconciliation;
  ourLitres: number;
  refCode: string;
}

/**
 * "Why is my cheque smaller than I expected" is the number one dairy co-op
 * grievance in Kenya. This is the answer, line by line: their litres against
 * ours, and every check-off deduction matched to a farm record or flagged as
 * having nothing behind it.
 */
export interface StatementDeductionInput {
  deductionType:
    | "AI" | "FEEDS" | "VET" | "ADVANCE" | "SACCO_LOAN" | "SHARES"
    | "TRANSPORT" | "MEMBERSHIP" | "OTHER";
  description?: string | null;
  amountKes: number | string;
  balanceRemainingKes?: number | string | null;
}

export interface StatementInputShape {
  id?: string;
  customerId: string;
  memberNo?: string | null;
  periodStart: string;
  periodEnd: string;
  coopLitres: number | string;
  rateKesPerLitre: number | string;
  qualityBonusKes?: number | string;
  cessKes?: number | string;
  grossPayKes: number | string;
  netPayKes: number | string;
  paidOn?: string | null;
  deductions?: StatementDeductionInput[];
}

export async function recordStatement(
  session: Session,
  input: StatementInputShape,
  dbo?: Db,
): Promise<ActionResult<StatementResult>> {
  return guard(async () => {
    const parsed = StatementInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const st = parsed.data;
    const database = await resolveDb(dbo);

    const customer = await database.query.customer.findFirst({
      where: and(eq(s.customer.id, st.customerId), eq(s.customer.farmId, session.farmId)),
    });
    assertOwned(customer, session, "customer");

    const ours = await database
      .select()
      .from(s.milkDisposal)
      .where(
        and(
          eq(s.milkDisposal.farmId, session.farmId),
          eq(s.milkDisposal.customerId, st.customerId),
          gte(s.milkDisposal.disposedOn, st.periodStart),
          lte(s.milkDisposal.disposedOn, st.periodEnd),
        ),
      );
    const ourLitres = money(
      ours.filter((d) => d.accepted !== false).reduce((a, d) => a + num(d.litres), 0),
    );

    // Match each deduction against something the farm actually recorded.
    const expenses = await database
      .select()
      .from(s.expense)
      .where(
        and(
          eq(s.expense.farmId, session.farmId),
          gte(s.expense.incurredOn, addDays(st.periodStart, -60)),
          lte(s.expense.incurredOn, addDays(st.periodEnd, 15)),
          ne(s.expense.status, "VOID"),
        ),
      );
    const used = new Set<string>();

    const id = st.id ?? newId();
    await database
      .insert(s.milkStatement)
      .values({
        id,
        farmId: session.farmId,
        customerId: st.customerId,
        memberNo: st.memberNo ?? null,
        periodStart: st.periodStart,
        periodEnd: st.periodEnd,
        coopLitres: dec(st.coopLitres, 2),
        rateKesPerLitre: dec(st.rateKesPerLitre, 2),
        qualityBonusKes: dec(st.qualityBonusKes ?? 0, 2),
        grossPayKes: dec(st.grossPayKes, 2),
        cessKes: dec(st.cessKes ?? 0, 2),
        netPayKes: dec(st.netPayKes, 2),
        paidOn: st.paidOn ?? null,
        recordedBy: session.userId,
      })
      .onConflictDoNothing();

    const deductionsForRecon: Array<{
      type: string;
      description?: string | null;
      amountKes: number;
      matchedExpenseId?: string | null;
    }> = [];

    for (const d of st.deductions) {
      const wantCategory = DEDUCTION_TO_EXPENSE[d.deductionType];
      const match =
        wantCategory == null
          ? undefined
          : expenses.find(
              (e) =>
                !used.has(e.id) &&
                e.category === wantCategory &&
                Math.abs(num(e.amountKes) - d.amountKes) < 0.01,
            );
      if (match) used.add(match.id);

      await database
        .insert(s.milkStatementDeduction)
        .values({
          id: deterministicUuid(`${id}|${d.deductionType}|${d.amountKes}|${d.description ?? ""}`),
          farmId: session.farmId,
          statementId: id,
          deductionType: d.deductionType,
          description: d.description ?? null,
          amountKes: dec(d.amountKes, 2),
          balanceRemainingKes: d.balanceRemainingKes == null ? null : dec(d.balanceRemainingKes, 2),
          matchedExpenseId: match?.id ?? null,
        })
        .onConflictDoNothing();

      deductionsForRecon.push({
        type: d.deductionType,
        description: d.description,
        amountKes: d.amountKes,
        matchedExpenseId: match?.id ?? null,
      });
    }

    const reconciliation = reconcileStatement({
      litresOurs: ourLitres,
      litresTheirs: st.coopLitres,
      ratePerLitre: st.rateKesPerLitre,
      deductions: deductionsForRecon,
    });

    const ref = deterministicRef("ST", `${session.farmId}|${id}`);
    await database
      .insert(s.receipt)
      .values({
        id: newId(),
        farmId: session.farmId,
        refCode: ref,
        kind: "STATEMENT",
        summary: `${customer!.name} statement ${st.periodStart} to ${st.periodEnd} — ${kes(st.netPayKes)} net`,
        actorId: session.userId,
        at: new Date(),
        payload: { lines: [reconciliation.message], statementId: id },
      })
      .onConflictDoNothing();

    return actionOk({ id, reconciliation, ourLitres, refCode: ref }, reconciliation.message, ref);
  });
}

export interface StatementView {
  statement: typeof s.milkStatement.$inferSelect;
  customerName: string;
  reconciliation: StatementReconciliation;
  ourLitres: number;
  ourDeliveries: number;
}

export async function statementView(
  session: Session,
  statementId: string,
  dbo?: Db,
): Promise<StatementView> {
  requireCap(session, "VIEW_MONEY");
  const database = await resolveDb(dbo);
  const statement = await database.query.milkStatement.findFirst({
    where: and(eq(s.milkStatement.id, statementId), eq(s.milkStatement.farmId, session.farmId)),
  });
  assertOwned(statement, session, "statement");

  const customer = await database.query.customer.findFirst({
    where: and(eq(s.customer.id, statement!.customerId), eq(s.customer.farmId, session.farmId)),
  });

  const deductions = await database
    .select()
    .from(s.milkStatementDeduction)
    .where(eq(s.milkStatementDeduction.statementId, statementId));

  const ours = await database
    .select()
    .from(s.milkDisposal)
    .where(
      and(
        eq(s.milkDisposal.farmId, session.farmId),
        eq(s.milkDisposal.customerId, statement!.customerId),
        gte(s.milkDisposal.disposedOn, statement!.periodStart),
        lte(s.milkDisposal.disposedOn, statement!.periodEnd),
      ),
    );
  const ourLitres = money(
    ours.filter((d) => d.accepted !== false).reduce((a, d) => a + num(d.litres), 0),
  );

  return {
    statement: statement!,
    customerName: customer?.name ?? "The co-operative",
    ourLitres,
    ourDeliveries: ours.length,
    reconciliation: reconcileStatement({
      litresOurs: ourLitres,
      litresTheirs: num(statement!.coopLitres),
      ratePerLitre: num(statement!.rateKesPerLitre),
      deductions: deductions.map((d) => ({
        type: d.deductionType,
        description: d.description,
        amountKes: num(d.amountKes),
        matchedExpenseId: d.matchedExpenseId,
      })),
    }),
  };
}

/** Who sends us a statement: co-operatives and processors. */
export async function coopCustomers(session: Session, dbo?: Db) {
  const database = await resolveDb(dbo);
  const rows = await database
    .select()
    .from(s.customer)
    .where(eq(s.customer.farmId, session.farmId))
    .orderBy(asc(s.customer.name));
  return rows.filter((c) => c.customerType === "COOP" || c.customerType === "PROCESSOR");
}

export async function farmMemberNo(session: Session, dbo?: Db): Promise<string | null> {
  const database = await resolveDb(dbo);
  const farm = await database.query.farm.findFirst({ where: eq(s.farm.id, session.farmId) });
  return farm?.memberNo ?? null;
}

export async function listStatements(session: Session, dbo?: Db) {
  requireCap(session, "VIEW_MONEY");
  const database = await resolveDb(dbo);
  return database
    .select({ statement: s.milkStatement, customer: s.customer })
    .from(s.milkStatement)
    .innerJoin(s.customer, eq(s.customer.id, s.milkStatement.customerId))
    .where(eq(s.milkStatement.farmId, session.farmId))
    .orderBy(desc(s.milkStatement.periodStart));
}

/* ---------------------------------------------------------------- */
/* Channel mix                                                       */
/* ---------------------------------------------------------------- */

export interface ChannelMix {
  from: ISODate;
  to: ISODate;
  blendedKes: number;
  revenueL: number;
  revenueKes: number;
  lines: AllocationLine[];
  lossL: number;
  lossPct: number;
  imputedValueKes: number;
  /** The trade-off, stated. Neither number means much alone. */
  message: string;
}

/**
 * Litres out, by channel, with no money attached.
 *
 * The printed daily sheet reconciles what was milked against where it went —
 * that is a herdsman's job and he needs it. `channelMix` answers the same
 * question but carries blended price and revenue with it, so gating that one
 * behind VIEW_MONEY would have taken the paper sheet away from the person who
 * carries it. This is the half of it that is his.
 */
export async function disposalLitres(
  session: Session,
  from: ISODate,
  to: ISODate,
  dbo?: Db,
): Promise<Array<{ channel: DisposalChannel; label: string; litres: number }>> {
  const database = await resolveDb(dbo);
  const rows = await database
    .select({ channel: s.milkDisposal.channel, litres: s.milkDisposal.litres })
    .from(s.milkDisposal)
    .where(
      and(
        eq(s.milkDisposal.farmId, session.farmId),
        gte(s.milkDisposal.disposedOn, from),
        lte(s.milkDisposal.disposedOn, to),
      ),
    );

  const byChannel = new Map<DisposalChannel, number>();
  for (const r of rows) {
    byChannel.set(r.channel, money((byChannel.get(r.channel) ?? 0) + num(r.litres)));
  }
  return [...byChannel.entries()]
    .map(([channel, litres]) => ({ channel, label: CHANNEL_LABEL[channel], litres }))
    .sort((a, b) => b.litres - a.litres);
}

export async function channelMix(
  session: Session,
  from: ISODate,
  to: ISODate,
  dbo?: Db,
): Promise<ChannelMix> {
  // Blended price and revenue. The litres-only view a herdsman legitimately
  // needs for the daily sheet is `disposalLitres` below.
  requireCap(session, "VIEW_MONEY");
  const database = await resolveDb(dbo);
  const disposals = await database
    .select()
    .from(s.milkDisposal)
    .where(
      and(
        eq(s.milkDisposal.farmId, session.farmId),
        gte(s.milkDisposal.disposedOn, from),
        lte(s.milkDisposal.disposedOn, to),
      ),
    );

  const byChannel = new Map<DisposalChannel, AllocationLine>();
  for (const d of disposals) {
    const line =
      byChannel.get(d.channel) ??
      {
        channel: d.channel,
        label: CHANNEL_LABEL[d.channel],
        icon: CHANNEL_ICON[d.channel],
        litres: 0,
        valueKes: 0,
        rateKesPerLitre: null,
        imputed: isImputedChannel(d.channel),
        loss: isLossChannel(d.channel),
        revenue: isRevenueChannel(d.channel),
        count: 0,
      };
    line.litres = money(line.litres + num(d.litres));
    line.valueKes = money(line.valueKes + num(d.valueKes));
    line.count += 1;
    line.rateKesPerLitre = line.litres > 0 ? money(line.valueKes / line.litres) : null;
    byChannel.set(d.channel, line);
  }

  const lines = [...byChannel.values()].sort((a, b) => b.litres - a.litres);
  const blend = blendedPricePerLitre(
    lines.map((l) => ({ channel: l.channel, litres: l.litres, valueKes: l.valueKes })),
  );
  const producedL = money(lines.reduce((a, l) => a + l.litres, 0));
  const lossL = money(lines.filter((l) => l.loss).reduce((a, l) => a + l.litres, 0));

  const coop = lines.find((l) => l.channel === "COOP");
  const direct = lines.filter((l) => l.revenue && l.channel !== "COOP" && l.channel !== "PROCESSOR");
  const directL = money(direct.reduce((a, l) => a + l.litres, 0));

  let message: string;
  if (blend.revenueL === 0) {
    message = "Nothing sold in this period.";
  } else {
    const directPct = Math.round((directL / blend.revenueL) * 100);
    message = `Blended price ${kes(blend.blendedKes, 2)} a litre. ${directPct}% went direct at the better price${
      coop ? `, the rest to the co-op at ${kes(coop.rateKesPerLitre ?? 0, 2)}` : ""
    } — the co-op pays reliably, direct sales earn more and carry the debt.`;
  }

  return {
    from,
    to,
    blendedKes: blend.blendedKes,
    revenueL: blend.revenueL,
    revenueKes: blend.revenueKes,
    lines,
    lossL,
    lossPct: lossRatePct(producedL, lossL),
    imputedValueKes: money(lines.filter((l) => l.imputed).reduce((a, l) => a + l.valueKes, 0)),
    message,
  };
}

/* ---------------------------------------------------------------- */
/* Server Actions — the untrusted entry points                       */
/* ---------------------------------------------------------------- */

async function bump(farmId: string) {
  const { updateTag } = await import("next/cache");
  updateTag(`sales:${farmId}`);
}

export async function recordDisposalAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<DisposalResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("RECORD");
    const raw = Object.fromEntries(formData) as Record<string, string>;
    const res = await recordDisposal(session, {
      date: raw.date,
      session: (raw.session || undefined) as MilkingSession | undefined,
      channel: raw.channel as DisposalChannel,
      customerId: raw.customerId || undefined,
      litres: raw.litres,
      rateKesPerLitre: raw.rateKesPerLitre || undefined,
      lossReason: (raw.lossReason || undefined) as never,
      deliveryNoteNo: raw.deliveryNoteNo || undefined,
    });
    if (res.ok) await bump(session.farmId);
    return res;
  });
}

export async function recordDeliveryAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<DeliveryResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("DELIVER");
    const raw = Object.fromEntries(formData) as Record<string, string>;
    const res = await recordDelivery(session, {
      date: raw.date,
      session: (raw.session || undefined) as MilkingSession | undefined,
      customerId: raw.customerId,
      litres: raw.litres,
      settlement: (raw.settlement || "CREDIT") as "CASH" | "MPESA" | "CREDIT",
      mpesaRef: raw.mpesaRef || undefined,
      deliveryNoteNo: raw.deliveryNoteNo || undefined,
    });
    if (res.ok) await bump(session.farmId);
    return res;
  });
}

export async function recordRoundAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<RoundResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("DELIVER");
    let stops: DeliveryInputShape[];
    try {
      stops = JSON.parse(String(formData.get("stops") ?? "[]"));
    } catch {
      return actionError("The round could not be read. Try again.");
    }
    const res = await recordDeliveryRound(session, {
      date: String(formData.get("date") ?? ""),
      session: String(formData.get("session") ?? "MORNING") as MilkingSession,
      stops,
    });
    if (res.ok) await bump(session.farmId);
    return res;
  });
}

export async function recordPaymentAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<PaymentResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("DELIVER");
    const raw = Object.fromEntries(formData) as Record<string, string>;
    const res = await recordPayment(session, {
      customerId: raw.customerId,
      date: raw.date,
      amountKes: raw.amountKes,
      paymentMethod: (raw.paymentMethod || "CASH") as s.PaymentMethod,
      mpesaRef: raw.mpesaRef || undefined,
      note: raw.note || undefined,
    });
    if (res.ok) await bump(session.farmId);
    return res;
  });
}

export async function approvePaymentAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; balanceKes: number }>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("APPROVE");
    const res = await approvePayment(session, String(formData.get("entryId") ?? ""));
    if (res.ok) await bump(session.farmId);
    return res;
  });
}

export async function createCustomerAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; legality: SaleLegality }>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("ADMIN");
    const raw = Object.fromEntries(formData) as Record<string, string>;
    const res = await createCustomer(session, {
      name: raw.name,
      customerType: raw.customerType as CustomerType,
      phone: raw.phone || undefined,
      location: raw.location || undefined,
      areaClass: (raw.areaClass || "RURAL") as "RURAL" | "URBAN",
      fulfilment: (raw.fulfilment || "DELIVERED") as "GATE_COLLECTION" | "DELIVERED",
      paymentTerms: (raw.paymentTerms || "CASH") as PaymentTerms,
      creditLimitKes: raw.creditLimitKes || undefined,
    });
    if (res.ok) await bump(session.farmId);
    return res;
  });
}

export async function createInvoiceAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<InvoiceResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("MANAGE_MONEY");
    const raw = Object.fromEntries(formData) as Record<string, string>;
    const res = await createInvoice(session, {
      customerId: raw.customerId,
      periodStart: raw.periodStart,
      periodEnd: raw.periodEnd,
      etimsRef: raw.etimsRef || undefined,
    });
    if (res.ok) await bump(session.farmId);
    return res;
  });
}

export async function recordStatementAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<StatementResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("MANAGE_MONEY");
    const raw = Object.fromEntries(formData) as Record<string, string>;
    let deductions: Array<{ deductionType: string; amountKes: number; description?: string }> = [];
    try {
      deductions = JSON.parse(raw.deductions || "[]");
    } catch {
      return actionError("The deduction lines could not be read.");
    }
    const res = await recordStatement(session, {
      customerId: raw.customerId,
      memberNo: raw.memberNo || undefined,
      periodStart: raw.periodStart,
      periodEnd: raw.periodEnd,
      coopLitres: raw.coopLitres,
      rateKesPerLitre: raw.rateKesPerLitre,
      qualityBonusKes: raw.qualityBonusKes || undefined,
      cessKes: raw.cessKes || undefined,
      grossPayKes: raw.grossPayKes,
      netPayKes: raw.netPayKes,
      deductions: deductions as never,
    });
    if (res.ok) await bump(session.farmId);
    return res;
  });
}

