/**
 * M2 — Breeding & Reproduction.
 *
 * The module that pays for the system. One service date in, a calendar of
 * alerts out — the iCow bargain, which measured +13% milk per cow and +29% milk
 * income in a Kenyan impact evaluation.
 *
 * Two design commitments run through the whole file:
 *
 *  1. **Interpretation, not storage.** A return to heat at ~42 days is not a
 *     row, it is a diagnosis: a heat was missed one cycle earlier, and that is a
 *     detection failure the manager can fix this week.
 *
 *  2. **The watchboard is DERIVED, never a queue.** Herdwatch's documented bug
 *     is repeat-served cows sticking on the board forever. That happens when the
 *     board is a list of un-ticked reminders. Ours recomputes from the latest
 *     event on each animal, so recording the outcome removes the item by
 *     construction rather than by remembering to tick it.
 *
 * `"use server"` is per-action, not file-level — see the note in `herd.ts`.
 */
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { updateTag } from "next/cache";
import { z } from "zod";

import {
  requireCapability,
  assertOwned,
  guard,
  actionOk,
  actionError,
  type ActionResult,
  type Session,
} from "@/lib/dal";
import { newId, REF_PREFIX } from "@/lib/ids";
import { dec } from "@/lib/money";
import { addDays, ageDays, daysBetween, today, type ISODate } from "@/lib/domain/dates";
import {
  breedingCalendar,
  interpretReturn,
  calvingInterval,
  calvingIntervalCostKes,
  servicesPerConception,
  inseminationWindow,
  gestationDays,
  DRY_PERIOD_DAYS,
  VWP_DAYS,
  CYCLE_DAYS,
  REPRO_BENCHMARKS,
  type BreedingCalendar,
  type ReturnInterpretation,
} from "@/lib/domain/breeding";
import { deriveClass, deriveReproStatus, CLASS_LABEL, isServable } from "@/lib/domain/animal";
import { ABORTION_PROTOCOL, dryCowTherapyClearOn, COLOSTRUM_DAYS } from "@/lib/domain/health";
import {
  loadHerdSources,
  factsFor,
  firstYearSchedule,
  formObject,
  writeReceipt,
  isAbortionCalving,
  ROUTINE_ALERT_PREFIX,
  type ScheduleItem,
  type AnimalRow,
} from "./herd";
import { postLinkedExpense } from "./money";
import { DRY_COW_THERAPY, stableId } from "./health";

/* ================================================================== */
/* Alert vocabulary                                                    */
/* ================================================================== */

export const ALERT_KIND = {
  SERVE_AFTER_HEAT: "SERVE_AFTER_HEAT",
  RETURN_TO_HEAT: "RETURN_TO_HEAT",
  PD_DUE: "PD_DUE",
  PD_RECHECK: "PD_RECHECK",
  DRY_OFF_DUE: "DRY_OFF_DUE",
  CALVING_DUE: "CALVING_DUE",
  SERVE_NOW: "SERVE_NOW",
  COLOSTRUM_WINDOW: "COLOSTRUM_WINDOW",
  ABORTION_PROTOCOL: "ABORTION_PROTOCOL",
  MILK_WITHDRAWAL_DRY_COW: "MILK_WITHDRAWAL_DRY_COW",
} as const;

export type AlertKind = (typeof ALERT_KIND)[keyof typeof ALERT_KIND];

/** Every alert this module raises. Used when an outcome clears a whole family. */
const BREEDING_ALERT_KINDS: string[] = [
  ALERT_KIND.SERVE_AFTER_HEAT,
  ALERT_KIND.RETURN_TO_HEAT,
  ALERT_KIND.PD_DUE,
  ALERT_KIND.PD_RECHECK,
  ALERT_KIND.DRY_OFF_DUE,
  ALERT_KIND.CALVING_DUE,
  ALERT_KIND.SERVE_NOW,
];

async function resolveAlerts(
  session: Session,
  animalId: string,
  kinds: string[],
  outcome: string,
): Promise<void> {
  if (kinds.length === 0) return;
  await db
    .update(s.alert)
    .set({ resolvedAt: new Date(), outcome, resolvedBy: session.userId })
    .where(
      and(
        eq(s.alert.farmId, session.farmId),
        eq(s.alert.animalId, animalId),
        inArray(s.alert.kind, kinds),
        isNull(s.alert.resolvedAt),
      ),
    );
}

interface AlertSpec {
  kind: string;
  action: string;
  dueOn: ISODate;
  severity?: "INFO" | "WARN" | "CRITICAL";
  assignedRole?: s.Role;
  dedupeKey: string;
}

async function raiseAlerts(session: Session, animalId: string, specs: AlertSpec[]): Promise<void> {
  if (specs.length === 0) return;
  await db
    .insert(s.alert)
    .values(
      specs.map((a) => ({
        id: newId(),
        farmId: session.farmId,
        kind: a.kind,
        animalId,
        assignedRole: a.assignedRole ?? ("MANAGER" as s.Role),
        action: a.action,
        dueOn: a.dueOn,
        severity: a.severity ?? "INFO",
        dedupeKey: a.dedupeKey,
      })),
    )
    .onConflictDoNothing();
}

/* ================================================================== */
/* Shared input pieces                                                 */
/* ================================================================== */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-08-03.");
const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true" || v === "1" || v === "yes");

function displayName(a: AnimalRow): string {
  return a.name ? a.name : a.tag;
}

/**
 * A `datetime-local` field has no timezone. Reading it as UTC keeps the AM/PM
 * rule anchored to the wall clock the herdsman actually typed, which is the
 * only clock he cares about.
 */
function parseObservedAt(raw: string | undefined): Date {
  if (!raw) return new Date();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return new Date(`${raw}:00Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T08:00:00Z`);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function ownedAnimal(session: Session, animalId: string): Promise<AnimalRow> {
  const animal = await db.query.animal.findFirst({
    where: and(eq(s.animal.id, animalId), eq(s.animal.farmId, session.farmId)),
  });
  return assertOwned(animal, session, "animal");
}

/* ================================================================== */
/* Action — record a heat (the five-second entry)                      */
/* ================================================================== */

const HeatInput = z.object({
  id: z.string().uuid().optional(),
  animalId: z.string().uuid("Choose an animal."),
  observedAt: z.string().optional(),
  sign: z
    .enum(["STANDING", "MOUNTING_OTHERS", "MUCUS", "RESTLESS", "SWOLLEN_VULVA", "YIELD_DROP"])
    .optional(),
});

export interface HeatResult {
  id: string;
  observedAt: string;
  /** The AM/PM rule, applied for the user rather than explained to them. */
  advice: string;
  serveOn: ISODate;
  animalName: string;
  servable: boolean;
  warning: string | null;
}

export async function recordHeat(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<HeatResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("RECORD");

    const parsed = HeatInput.safeParse(formObject(formData));
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const v = parsed.data;

    const animal = await ownedAnimal(session, v.animalId);
    const observedAt = parseObservedAt(v.observedAt);
    const onDate = observedAt.toISOString().slice(0, 10);

    const { events } = await loadHerdSources(session, { animalIds: [v.animalId] });
    const facts = factsFor(animal, events.get(v.animalId)!, onDate);
    const status = deriveReproStatus(facts, onDate);
    const servable = isServable(facts, onDate);

    // R4 — warn, never block. A cow diagnosed pregnant who shows a strong heat
    // is exactly the case a farm needs told, not silently refused.
    let warning: string | null = null;
    if (status === "PREGNANT") {
      warning =
        "She was diagnosed in calf. A real heat now means she has lost it — have her checked before serving.";
    } else if (status === "SERVED") {
      const since = facts.lastServiceOn ? daysBetween(facts.lastServiceOn, onDate) : null;
      warning =
        since != null
          ? `She was served ${since} days ago. ${interpretReturn(facts.lastServiceOn!, onDate).message}`
          : "She has an open service on record.";
    } else if (!servable && facts.lastCalvingOn) {
      const dim = daysBetween(facts.lastCalvingOn, onDate);
      warning = `She calved only ${dim} days ago — she should wait until day ${VWP_DAYS} before being served.`;
    }

    const window = inseminationWindow(observedAt);

    const id = v.id ?? newId();
    await db
      .insert(s.heatObservation)
      .values({
        id,
        farmId: session.farmId,
        animalId: v.animalId,
        observedAt,
        sign: v.sign ?? null,
        recordedBy: session.userId,
      })
      .onConflictDoNothing();

    const who = displayName(animal);
    await raiseAlerts(session, v.animalId, [
      {
        kind: ALERT_KIND.SERVE_AFTER_HEAT,
        action: `${who}: ${window.advice}`,
        dueOn: window.serveOn,
        severity: "WARN",
        assignedRole: "MANAGER",
        dedupeKey: `${v.animalId}:${ALERT_KIND.SERVE_AFTER_HEAT}:${id}`,
      },
    ]);

    const message = `${who} on heat. ${window.advice}`;
    const ref = await writeReceipt(session, {
      id,
      prefix: REF_PREFIX.BREEDING,
      kind: "HEAT",
      summary: message,
      payload: { animalId: v.animalId, serveOn: window.serveOn },
    });

    updateTag(`breeding:${session.farmId}`);

    return actionOk(
      {
        id,
        observedAt: observedAt.toISOString(),
        advice: window.advice,
        serveOn: window.serveOn,
        animalName: who,
        servable,
        warning,
      },
      message,
      ref,
    );
  });
}

/* ================================================================== */
/* Action — record a service (the flow that sells the system)          */
/* ================================================================== */

const ServiceInput = z.object({
  id: z.string().uuid().optional(),
  animalId: z.string().uuid("Choose an animal."),
  servedOn: isoDate.optional(),
  serviceType: z.enum(["AI", "NATURAL", "ET"]).default("AI"),
  semenType: z.enum(["CONVENTIONAL", "SEXED"]).optional(),
  strawCode: z.string().max(40).optional(),
  strawBatch: z.string().max(40).optional(),
  sireBreed: z.string().max(40).optional(),
  bullId: z.string().uuid().optional(),
  inseminatorId: z.string().uuid().optional(),
  costKes: z.coerce.number().min(0).optional(),
  costSettledBy: z.enum(["CASH", "CREDIT", "COOP_CHECKOFF"]).optional(),
});

export interface ServiceResult {
  id: string;
  animalName: string;
  serviceNumber: number;
  /** R7 — the whole calendar, at the moment of entry. */
  calendar: BreedingCalendar;
  /** Populated when this is a repeat service since the last calving. */
  returnInterpretation: (ReturnInterpretation & { previousServedOn: ISODate }) | null;
  warnings: string[];
  /** Ready-to-render lines, in the order the docs specify. */
  calendarLines: string[];
}

export async function recordService(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<ServiceResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("BREED");

    const parsed = ServiceInput.safeParse(formObject(formData));
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const v = parsed.data;
    const servedOn = v.servedOn ?? today();

    const animal = await ownedAnimal(session, v.animalId);
    if (v.bullId) {
      const bull = await db.query.animal.findFirst({
        where: and(eq(s.animal.id, v.bullId), eq(s.animal.farmId, session.farmId)),
      });
      assertOwned(bull, session, "bull");
    }

    const { events } = await loadHerdSources(session, { animalIds: [v.animalId] });
    const ev = events.get(v.animalId)!;
    const facts = factsFor(animal, ev, servedOn);
    const status = deriveReproStatus(facts, servedOn);

    const warnings: string[] = [];
    if (animal.sex === "M") warnings.push("This animal is recorded as male. Check you picked the right one.");
    if (status === "PREGNANT") {
      warnings.push("She is already recorded in calf — serving now will end that pregnancy if it is real.");
    }
    if (facts.lastCalvingOn) {
      const dim = daysBetween(facts.lastCalvingOn, servedOn);
      if (dim < VWP_DAYS) {
        warnings.push(
          `She is only ${dim} days from calving. Serving before day ${VWP_DAYS} usually does not hold.`,
        );
      }
    }

    // Services since the last calving, so the number resets each lactation.
    const sinceCalving = ev.services.filter(
      (r) => r.servedOn <= servedOn && (!facts.lastCalvingOn || r.servedOn >= facts.lastCalvingOn),
    );
    const previous = sinceCalving.length ? sinceCalving[sinceCalving.length - 1] : null;
    const serviceNumber = sinceCalving.length + 1;

    // The gestation constant follows the DAM's breed — schema.ts is explicit
    // that `animal.primaryBreed` is what drives it.
    const calendar = breedingCalendar(servedOn, animal.primaryBreed);

    let returnInterpretation: (ReturnInterpretation & { previousServedOn: ISODate }) | null = null;
    if (previous) {
      returnInterpretation = {
        ...interpretReturn(previous.servedOn, servedOn),
        previousServedOn: previous.servedOn,
      };
    }

    const id = v.id ?? newId();

    /* ---------------------------------------------------------------- *
     * BREEDING COST → EXPENSE (the money seam).
     *
     * An AI straw and the technician's call-out are money out, so they go
     * into the cash book PENDING, category BREEDING — and `costSettledBy`
     * is honoured: a co-op check-off is stamped `COOP_CHECKOFF`, because
     * the money never left the till, it came off the milk cheque. That
     * stamp is not decoration. M4's co-op statement reconciliation matches
     * the co-op's `AI` deduction to a BREEDING expense of the same amount;
     * before this seam existed there was nothing to match and every real
     * check-off showed up as a deduction with nothing behind it.
     *
     * NOTE — `service` has no `expenseId` column in `schema.ts`, unlike
     * `pregnancyCheck`, `feedPurchase` and `healthEvent`. Rather than edit
     * a schema four agents depend on, the expense id is DERIVED from the
     * service id (`linkedExpenseId("service", id)`), so the link is still
     * recomputable in both directions and a replay still posts once.
     * ---------------------------------------------------------------- */
    const expenseId = await postLinkedExpense(db, session, {
      sourceTable: "service",
      sourceId: id,
      incurredOn: servedOn,
      category: "BREEDING",
      description: `${v.serviceType} for ${displayName(animal)}${v.strawCode ? `, straw ${v.strawCode}` : ""}`,
      amountKes: v.costKes ?? 0,
      costSettledBy: v.costSettledBy ?? null,
    });

    await db
      .insert(s.service)
      .values({
        id,
        farmId: session.farmId,
        animalId: v.animalId,
        servedOn,
        serviceType: v.serviceType,
        semenType: v.semenType ?? null,
        strawCode: v.strawCode ?? null,
        strawBatch: v.strawBatch ?? null,
        sireBreed: v.sireBreed ?? null,
        bullId: v.bullId ?? null,
        inseminatorId: v.inseminatorId ?? null,
        serviceNumber,
        costKes: v.costKes != null ? dec(v.costKes) : null,
        costSettledBy: v.costSettledBy ?? null,
        // Derived at insert so the calendar stays stable even if the constants
        // are later changed for the farm.
        expectedReturnOn: calendar.expectedReturnOn,
        pdDueOn: calendar.pdDueOn,
        expectedCalvingOn: calendar.expectedCalvingOn,
        recordedBy: session.userId,
      })
      .onConflictDoNothing();

    const who = displayName(animal);

    // A new service supersedes everything the previous one was waiting for.
    // This is the anti-Herdwatch step: the old watch items are closed here AND
    // the board recomputes from the latest service anyway.
    await resolveAlerts(session, v.animalId, BREEDING_ALERT_KINDS, `SERVED_${servedOn}`);

    await raiseAlerts(session, v.animalId, [
      {
        kind: ALERT_KIND.RETURN_TO_HEAT,
        action: `${who}: watch for a return to heat around ${calendar.expectedReturnOn}.`,
        dueOn: calendar.expectedReturnOn,
        severity: "WARN",
        assignedRole: "HERDSMAN",
        dedupeKey: `${v.animalId}:${ALERT_KIND.RETURN_TO_HEAT}:${id}`,
      },
      {
        kind: ALERT_KIND.PD_DUE,
        action: `${who}: pregnancy check due ${calendar.pdDueOn}.`,
        dueOn: calendar.pdDueOn,
        severity: "WARN",
        dedupeKey: `${v.animalId}:${ALERT_KIND.PD_DUE}:${id}`,
      },
      {
        kind: ALERT_KIND.DRY_OFF_DUE,
        action: `${who}: dry her off on ${calendar.dryOffDueOn} and start steaming up.`,
        dueOn: calendar.dryOffDueOn,
        severity: "WARN",
        dedupeKey: `${v.animalId}:${ALERT_KIND.DRY_OFF_DUE}:${id}`,
      },
      {
        kind: ALERT_KIND.CALVING_DUE,
        action: `${who}: calving expected ${calendar.expectedCalvingOn}. Get the calving pen ready.`,
        dueOn: calendar.calvingAlertFrom,
        severity: "CRITICAL",
        dedupeKey: `${v.animalId}:${ALERT_KIND.CALVING_DUE}:${id}`,
      },
    ]);

    const calendarLines = [
      `Watch for return to heat: ${calendar.expectedReturnOn} (${CYCLE_DAYS} days)`,
      `Pregnancy check due: ${calendar.pdDueOn} (60 days)`,
      `Expected calving: ${calendar.expectedCalvingOn} (${calendar.gestationDays} days)`,
      `Dry her off: ${calendar.dryOffDueOn} — start steaming up the same day`,
    ];

    const summary =
      `${who} served ${servedOn}, ${v.serviceType}` +
      (v.strawCode ? `, straw ${v.strawCode}` : "") +
      `. Calving expected ${calendar.expectedCalvingOn}.`;

    const ref = await writeReceipt(session, {
      id,
      prefix: REF_PREFIX.BREEDING,
      kind: "SERVICE",
      summary,
      payload: { animalId: v.animalId, serviceId: id, calendar, expenseId },
    });

    updateTag(`breeding:${session.farmId}`);
    updateTag(`herd:${session.farmId}`);

    return actionOk(
      {
        id,
        animalName: who,
        serviceNumber,
        calendar,
        returnInterpretation,
        warnings,
        calendarLines,
      },
      summary,
      ref,
    );
  });
}

/* ================================================================== */
/* Query — interpret a return to heat                                  */
/* ================================================================== */

export interface ReturnVerdictView extends ReturnInterpretation {
  animalId: string;
  animalName: string;
  previousServedOn: ISODate;
  returnedOn: ISODate;
  /** True for the ~42-day case — the one the manager can actually fix. */
  isDetectionFailure: boolean;
  /** What to do about it, not what it is called. */
  advice: string;
}

/**
 * Diagnose a return to heat against the last service on record.
 *
 * `null` when she has never been served since her last calving — there is
 * nothing to return from, and inventing a verdict there would be noise.
 */
export async function interpretReturnToHeat(
  session: Session,
  animalId: string,
  returnedOn: ISODate,
): Promise<ReturnVerdictView | null> {
  const animal = await db.query.animal.findFirst({
    where: and(eq(s.animal.id, animalId), eq(s.animal.farmId, session.farmId)),
  });
  assertOwned(animal, session, "animal");

  const { events } = await loadHerdSources(session, { animalIds: [animalId] });
  const ev = events.get(animalId)!;
  const facts = factsFor(animal!, ev, returnedOn);
  const candidates = ev.services.filter(
    (r) => r.servedOn <= returnedOn && (!facts.lastCalvingOn || r.servedOn >= facts.lastCalvingOn),
  );
  if (candidates.length === 0) return null;
  const previous = candidates[candidates.length - 1];

  const interp = interpretReturn(previous.servedOn, returnedOn);
  const isDetectionFailure = interp.verdict === "MISSED_HEAT";

  const advice =
    interp.verdict === "MISSED_HEAT"
      ? "Put someone on heat watch twice a day for 20 minutes, morning and evening. Missed heats cost more than failed services."
      : interp.verdict === "EARLY_LOSS_OR_MISTIMED"
        ? "Serve on the AM/PM rule: seen in the morning, inseminate that evening."
        : interp.verdict === "IRREGULAR"
          ? "Have her examined — an irregular interval often means a cystic ovary."
          : interp.verdict === "TOO_SOON"
            ? "Check the service date before serving her again."
            : "Serve her again on this heat.";

  return {
    ...interp,
    animalId,
    animalName: displayName(animal!),
    previousServedOn: previous.servedOn,
    returnedOn,
    isDetectionFailure,
    advice,
  };
}

/* ================================================================== */
/* Action — pregnancy diagnosis                                        */
/* ================================================================== */

const PdInput = z.object({
  id: z.string().uuid().optional(),
  animalId: z.string().uuid("Choose an animal."),
  serviceId: z.string().uuid().optional(),
  checkedOn: isoDate.optional(),
  method: z.enum(["PALPATION", "ULTRASOUND", "PROGESTERONE", "PAG", "NON_RETURN"]).default("PALPATION"),
  result: z.enum(["POSITIVE", "NEGATIVE", "INCONCLUSIVE"]),
  monthsPregnant: z.coerce.number().min(0).max(10).optional(),
  performedBy: z.string().uuid().optional(),
  costKes: z.coerce.number().min(0).optional(),
  /**
   * `pregnancyCheck` has no `costSettledBy` column, so this is carried only as
   * far as the expense it posts. Left out, the PD inherits how the service it
   * belongs to was settled — a co-op AI technician who does the 60-day check
   * puts both on the same check-off.
   */
  costSettledBy: z.enum(["CASH", "CREDIT", "COOP_CHECKOFF"]).optional(),
});

export interface PregnancyCheckResult {
  id: string;
  animalName: string;
  result: "POSITIVE" | "NEGATIVE" | "INCONCLUSIVE";
  expectedCalvingOn: ISODate | null;
  dryOffDueOn: ISODate | null;
  recheckOn: ISODate | null;
  nextAction: string;
}

export async function recordPregnancyCheck(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<PregnancyCheckResult>> {
  "use server";
  return guard(async () => {
    // Pregnancy diagnosis is clinical work.
    const session = await requireCapability("TREAT");

    const parsed = PdInput.safeParse(formObject(formData));
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const v = parsed.data;
    const checkedOn = v.checkedOn ?? today();

    const animal = await ownedAnimal(session, v.animalId);

    const { events } = await loadHerdSources(session, { animalIds: [v.animalId] });
    const ev = events.get(v.animalId)!;
    const facts = factsFor(animal, ev, checkedOn);

    // Attach to the service she is actually being checked on.
    let service = v.serviceId ? ev.services.find((r) => r.id === v.serviceId) ?? null : null;
    if (v.serviceId && !service) {
      return actionError("That service was not found.");
    }
    if (!service) {
      const open = ev.services.filter(
        (r) => r.servedOn <= checkedOn && (!facts.lastCalvingOn || r.servedOn >= facts.lastCalvingOn),
      );
      service = open.length ? open[open.length - 1] : null;
    }

    const who = displayName(animal);
    const edd = service?.expectedCalvingOn ?? null;
    const dryOffDueOn = edd ? addDays(edd, -DRY_PERIOD_DAYS) : null;

    const id = v.id ?? newId();

    // The money seam, same rule as a service: PENDING, BREEDING, check-off
    // honoured. `pregnancyCheck.expenseId` DOES exist, so the link is stored.
    // Where the PD carries no settlement of its own it inherits the service's,
    // because it is usually the same technician on the same check-off.
    const expenseId = await postLinkedExpense(db, session, {
      sourceTable: "pregnancy_check",
      sourceId: id,
      incurredOn: checkedOn,
      category: "BREEDING",
      description: `Pregnancy check (${v.method.toLowerCase()}) for ${who}`,
      amountKes: v.costKes ?? 0,
      costSettledBy: v.costSettledBy ?? service?.costSettledBy ?? null,
    });

    await db
      .insert(s.pregnancyCheck)
      .values({
        id,
        farmId: session.farmId,
        serviceId: service?.id ?? null,
        animalId: v.animalId,
        checkedOn,
        method: v.method,
        result: v.result,
        monthsPregnant: v.monthsPregnant != null ? dec(v.monthsPregnant, 1) : null,
        performedBy: v.performedBy ?? null,
        costKes: v.costKes != null ? dec(v.costKes) : null,
        expenseId,
        recordedBy: session.userId,
      })
      .onConflictDoNothing();

    let recheckOn: ISODate | null = null;
    let nextAction: string;

    if (v.result === "POSITIVE") {
      // The check is done and she is not returning. Dry-off and calving stand.
      await resolveAlerts(
        session,
        v.animalId,
        [ALERT_KIND.PD_DUE, ALERT_KIND.PD_RECHECK, ALERT_KIND.RETURN_TO_HEAT, ALERT_KIND.SERVE_AFTER_HEAT, ALERT_KIND.SERVE_NOW],
        "PD_POSITIVE",
      );
      nextAction = edd
        ? `She is in calf. Dry her off on ${dryOffDueOn}, calving expected ${edd}.`
        : "She is in calf.";
    } else if (v.result === "NEGATIVE") {
      // Everything downstream of a pregnancy that does not exist must go.
      await resolveAlerts(session, v.animalId, BREEDING_ALERT_KINDS, "PD_NEGATIVE");
      nextAction = "She is not in calf. Put her back on heat watch and serve her on the next heat.";
      await raiseAlerts(session, v.animalId, [
        {
          kind: ALERT_KIND.SERVE_NOW,
          action: `${who}: not in calf. Watch for heat and serve her.`,
          dueOn: checkedOn,
          severity: "WARN",
          assignedRole: "HERDSMAN",
          dedupeKey: `${v.animalId}:${ALERT_KIND.SERVE_NOW}:${id}`,
        },
      ]);
    } else {
      await resolveAlerts(session, v.animalId, [ALERT_KIND.PD_DUE], "PD_INCONCLUSIVE");
      recheckOn = addDays(checkedOn, CYCLE_DAYS);
      nextAction = `Not clear yet. Check her again on ${recheckOn}.`;
      await raiseAlerts(session, v.animalId, [
        {
          kind: ALERT_KIND.PD_RECHECK,
          action: `${who}: repeat the pregnancy check on ${recheckOn}.`,
          dueOn: recheckOn,
          severity: "WARN",
          dedupeKey: `${v.animalId}:${ALERT_KIND.PD_RECHECK}:${id}`,
        },
      ]);
    }

    const RESULT_WORD = { POSITIVE: "in calf", NEGATIVE: "not in calf", INCONCLUSIVE: "not clear yet" };
    const summary = `${who} checked ${checkedOn}: ${RESULT_WORD[v.result]}. ${nextAction}`;

    const ref = await writeReceipt(session, {
      id,
      prefix: REF_PREFIX.BREEDING,
      kind: "PREGNANCY_CHECK",
      summary,
      payload: { animalId: v.animalId, result: v.result, expectedCalvingOn: edd },
    });

    updateTag(`breeding:${session.farmId}`);
    updateTag(`herd:${session.farmId}`);

    return actionOk(
      {
        id,
        animalName: who,
        result: v.result,
        expectedCalvingOn: v.result === "POSITIVE" ? edd : null,
        dryOffDueOn: v.result === "POSITIVE" ? dryOffDueOn : null,
        recheckOn,
        nextAction,
      },
      summary,
      ref,
    );
  });
}

/* ================================================================== */
/* Action — calving (four things, atomically)                          */
/* ================================================================== */

const OutcomeInput = z.object({
  outcome: z.enum(["LIVE", "STILLBIRTH", "DIED_UNDER_24H", "ABORTION"]),
  calfSex: z.enum(["F", "M"]).optional(),
  birthWeightKg: z.coerce.number().min(0).max(120).optional(),
  calfTag: z.string().max(40).optional(),
  calfName: z.string().max(60).optional(),
  /** Client-generated, so an offline replay reuses the same calf row. */
  calfId: z.string().uuid().optional(),
});

const CalvingInput = z.object({
  id: z.string().uuid().optional(),
  damId: z.string().uuid("Choose the dam."),
  serviceId: z.string().uuid().optional(),
  calvedOn: isoDate.optional(),
  calvingEase: z.coerce.number().int().min(1).max(5).optional(),
  retainedPlacenta: checkbox,
  milkFever: checkbox,
  assistedBy: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
  /** JSON array. One entry per calf — twins are ordinary, not an edge case. */
  outcomes: z.string().optional(),
});

export interface CalfCreated {
  id: string;
  tag: string;
  name: string | null;
  sex: "F" | "M";
  birthWeightKg: number | null;
  schedule: ScheduleItem[];
}

export interface CalvingResult {
  id: string;
  damName: string;
  calvedOn: ISODate;
  isAbortion: boolean;
  calves: CalfCreated[];
  outcomes: { outcome: string; calfSex: "F" | "M" | null }[];
  lactationNumber: number;
  colostrumUntil: ISODate | null;
  vwpEndsOn: ISODate | null;
  /** The numbers, and what the overrun cost in shillings. */
  calvingIntervalDays: number | null;
  calvingIntervalTargetDays: number;
  excessDays: number;
  calvingIntervalCostKes: number;
  daysOpenDays: number | null;
  servicesPerConception: number | null;
  /** Non-null the moment any outcome is an abortion. Brucellosis is notifiable. */
  abortionProtocol: readonly string[] | null;
  warnings: string[];
}

export async function recordCalving(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<CalvingResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("BREED");

    const parsed = CalvingInput.safeParse(formObject(formData));
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const v = parsed.data;
    const calvedOn = v.calvedOn ?? today();

    let outcomes: z.infer<typeof OutcomeInput>[];
    try {
      const raw = v.outcomes ? JSON.parse(v.outcomes) : [{ outcome: "LIVE" }];
      const arr = z.array(OutcomeInput).min(1).safeParse(raw);
      if (!arr.success) {
        return actionError("Check the calf details.", arr.error.flatten().fieldErrors as Record<string, string[]>);
      }
      outcomes = arr.data;
    } catch {
      return actionError("The calf details could not be read. Enter them again.");
    }

    const dam = await ownedAnimal(session, v.damId);
    const { events } = await loadHerdSources(session, { animalIds: [v.damId] });
    const ev = events.get(v.damId)!;
    const factsBefore = factsFor(dam, ev, addDays(calvedOn, -1));

    if (ev.calvings.some((c) => c.calvedOn === calvedOn && c.id !== v.id)) {
      return actionError(`A calving is already recorded for ${displayName(dam)} on ${calvedOn}.`);
    }

    // The service she is calving from: the last one before this calving.
    let service = v.serviceId ? ev.services.find((r) => r.id === v.serviceId) ?? null : null;
    if (v.serviceId && !service) return actionError("That service was not found.");
    if (!service) {
      const before = ev.services.filter(
        (r) =>
          r.servedOn < calvedOn &&
          (!factsBefore.lastCalvingOn || r.servedOn >= factsBefore.lastCalvingOn),
      );
      service = before.length ? before[before.length - 1] : null;
    }

    const isAbortion = outcomes.every((o) => o.outcome === "ABORTION");
    const anyAbortion = outcomes.some((o) => o.outcome === "ABORTION");
    const who = displayName(dam);
    const warnings: string[] = [];

    const calvingId = v.id ?? newId();

    // Tags for live calves, allocated before the transaction so a clash is a
    // message rather than a rollback. A tag already held by THIS calf is a
    // replay of the same entry, not a clash — the offline outbox flushes twice
    // over a flaky link and that has to be harmless.
    const herd = await db
      .select({ id: s.animal.id, tag: s.animal.tag })
      .from(s.animal)
      .where(eq(s.animal.farmId, session.farmId));
    const ownerOfTag = new Map(herd.map((r) => [r.tag, r.id]));
    const tagOfAnimal = new Map(herd.map((r) => [r.id, r.tag]));

    const plannedCalves: (CalfCreated & { outcomeIndex: number })[] = [];
    for (let i = 0; i < outcomes.length; i++) {
      const o = outcomes[i];
      if (o.outcome !== "LIVE") continue;
      const sex = o.calfSex ?? "F";
      const calfId = o.calfId ?? newId();

      let tag = o.calfTag ?? tagOfAnimal.get(calfId) ?? "";
      if (!tag) {
        let n = 1;
        do {
          tag = `${dam.tag}/${calvedOn.slice(2, 4)}${calvedOn.slice(5, 7)}${n > 1 ? `-${n}` : ""}`;
          n++;
        } while (ownerOfTag.has(tag) && ownerOfTag.get(tag) !== calfId);
      }
      const owner = ownerOfTag.get(tag);
      if (owner && owner !== calfId) {
        return actionError(`Tag ${tag} is already on another animal.`, { calfTag: [`Tag ${tag} is taken.`] });
      }
      ownerOfTag.set(tag, calfId);
      tagOfAnimal.set(calfId, tag);

      plannedCalves.push({
        outcomeIndex: i,
        id: calfId,
        tag,
        name: o.calfName ?? null,
        sex,
        birthWeightKg: o.birthWeightKg ?? null,
        schedule: firstYearSchedule({ sex, birthOn: calvedOn }),
      });
    }

    if (!isAbortion && v.calvingEase != null && v.calvingEase >= 4) {
      warnings.push("A hard calving — watch her for a retained placenta and metritis this week.");
    }
    if (v.retainedPlacenta) {
      warnings.push("Retained placenta: if it is not passed within 12 hours, call the vet.");
    }
    if (v.milkFever) {
      warnings.push("Milk fever: she needs calcium now, and she is at higher risk of it every lactation after this.");
    }

    // --- The four things, in one transaction. ---
    await db.transaction(async (tx) => {
      await tx
        .insert(s.calving)
        .values({
          id: calvingId,
          farmId: session.farmId,
          damId: v.damId,
          serviceId: service?.id ?? null,
          calvedOn,
          calvingEase: v.calvingEase ?? null,
          numberBorn: outcomes.length,
          retainedPlacenta: v.retainedPlacenta,
          milkFever: v.milkFever,
          assistedBy: v.assistedBy ?? null,
          notes: v.notes ?? null,
          recordedBy: session.userId,
        })
        .onConflictDoNothing();

      // 1. The calf animal records, with dam and sire linkage.
      for (const calf of plannedCalves) {
        await tx
          .insert(s.animal)
          .values({
            id: calf.id,
            farmId: session.farmId,
            tag: calf.tag,
            name: calf.name,
            sex: calf.sex,
            primaryBreed: dam.primaryBreed,
            breedComposition: dam.breedComposition,
            dateOfBirth: calvedOn,
            dobEstimated: false,
            damId: v.damId,
            sireId: service?.bullId ?? null,
            sireStrawCode: service?.strawCode ?? null,
            origin: "BORN",
            enteredHerdOn: calvedOn,
          })
          .onConflictDoNothing();
      }

      // 2. The outcome rows, each pointing at the calf it produced. Their ids
      //    are server-side, so a replay is guarded by the parent instead.
      const alreadyRecorded = await tx
        .select({ id: s.calvingOutcome.id })
        .from(s.calvingOutcome)
        .where(eq(s.calvingOutcome.calvingId, calvingId));
      for (let i = 0; alreadyRecorded.length === 0 && i < outcomes.length; i++) {
        const o = outcomes[i];
        const calf = plannedCalves.find((c) => c.outcomeIndex === i) ?? null;
        await tx
          .insert(s.calvingOutcome)
          .values({
            id: newId(),
            farmId: session.farmId,
            calvingId,
            outcome: o.outcome,
            calfSex: o.calfSex ?? calf?.sex ?? null,
            birthWeightKg: o.birthWeightKg != null ? dec(o.birthWeightKg) : null,
            animalId: calf?.id ?? null,
          })
          .onConflictDoNothing();
      }

      // 3. The calves' first-year schedules.
      for (const calf of plannedCalves) {
        if (calf.schedule.length === 0) continue;
        await tx
          .insert(s.alert)
          .values(
            calf.schedule.map((i) => ({
              id: newId(),
              farmId: session.farmId,
              kind: `${ROUTINE_ALERT_PREFIX}${i.routine}`,
              animalId: calf.id,
              assignedRole: i.assignedRole as s.Role,
              action: i.action,
              dueOn: i.dueOn,
              severity: i.severity,
              dedupeKey: `${calf.id}:${ROUTINE_ALERT_PREFIX}${i.routine}`,
            })),
          )
          .onConflictDoNothing();
      }
    });

    // 4. The dam's new lactation starts. Everything she was being watched for
    //    is now settled by the calving itself.
    await resolveAlerts(session, v.damId, BREEDING_ALERT_KINDS, isAbortion ? "ABORTED" : "CALVED");

    const colostrumUntil = isAbortion ? null : addDays(calvedOn, COLOSTRUM_DAYS);
    const vwpEndsOn = isAbortion ? null : addDays(calvedOn, VWP_DAYS);

    const newAlerts: AlertSpec[] = [];
    if (!isAbortion) {
      newAlerts.push(
        {
          kind: ALERT_KIND.COLOSTRUM_WINDOW,
          action: `${who}: her milk is colostrum until ${colostrumUntil}. It goes to the calf, never in the can.`,
          dueOn: calvedOn,
          severity: "CRITICAL",
          assignedRole: "HERDSMAN",
          dedupeKey: `${v.damId}:${ALERT_KIND.COLOSTRUM_WINDOW}:${calvingId}`,
        },
        {
          kind: ALERT_KIND.SERVE_NOW,
          action: `${who}: ready to serve again from ${vwpEndsOn}. Start heat watch a week before.`,
          dueOn: vwpEndsOn!,
          severity: "INFO",
          assignedRole: "HERDSMAN",
          dedupeKey: `${v.damId}:${ALERT_KIND.SERVE_NOW}:${calvingId}`,
        },
      );
    }
    if (anyAbortion) {
      newAlerts.push({
        kind: ALERT_KIND.ABORTION_PROTOCOL,
        action: `${who} aborted on ${calvedOn}. Isolate her, handle the membranes with gloves, and have her tested for brucellosis.`,
        dueOn: calvedOn,
        severity: "CRITICAL",
        assignedRole: "MANAGER",
        dedupeKey: `${v.damId}:${ALERT_KIND.ABORTION_PROTOCOL}:${calvingId}`,
      });
    }
    await raiseAlerts(session, v.damId, newAlerts);

    // --- The numbers that make it worth recording. ---
    const previousCalving = factsBefore.lastCalvingOn;
    const ci = previousCalving && !isAbortion ? calvingInterval(previousCalving, calvedOn) : null;
    const cost =
      ci != null
        ? calvingIntervalCostKes(ci)
        : { excessDays: 0, costKes: 0 };
    const conceivedOn = service?.servedOn ?? null;
    const daysOpenDays =
      previousCalving && conceivedOn ? daysBetween(previousCalving, conceivedOn) : null;
    const servicesInLactation = ev.services.filter(
      (r) => r.servedOn < calvedOn && (!previousCalving || r.servedOn >= previousCalving),
    ).length;
    const spc = servicesInLactation
      ? Math.round(servicesPerConception(servicesInLactation, 1) * 10) / 10
      : null;

    if (ci != null && ci > REPRO_BENCHMARKS.calvingIntervalDays.acceptable) {
      warnings.push(
        `Her calving interval was ${ci} days against a target of ${REPRO_BENCHMARKS.calvingIntervalDays.target}. That gap cost about KES ${cost.costKes.toLocaleString("en-KE")}.`,
      );
    }

    const liveCount = plannedCalves.length;
    const summary = isAbortion
      ? `${who} aborted on ${calvedOn}. Follow the brucellosis steps.`
      : `${who} calved ${calvedOn} — ${liveCount > 0 ? `${liveCount} live calf${liveCount > 1 ? "s" : ""}` : "no live calf"}${
          liveCount > 0 ? ` (${plannedCalves.map((c) => c.tag).join(", ")})` : ""
        }.`;

    const ref = await writeReceipt(session, {
      id: calvingId,
      prefix: REF_PREFIX.BREEDING,
      kind: isAbortion ? "ABORTION" : "CALVING",
      summary,
      payload: { damId: v.damId, calvingId, calves: plannedCalves.map((c) => ({ id: c.id, tag: c.tag })) },
    });

    updateTag(`breeding:${session.farmId}`);
    updateTag(`herd:${session.farmId}`);

    return actionOk(
      {
        id: calvingId,
        damName: who,
        calvedOn,
        isAbortion,
        calves: plannedCalves.map(({ outcomeIndex: _o, ...c }) => c),
        outcomes: outcomes.map((o) => ({ outcome: o.outcome, calfSex: o.calfSex ?? null })),
        lactationNumber: factsBefore.parity + (isAbortion ? 0 : 1),
        colostrumUntil,
        vwpEndsOn,
        calvingIntervalDays: ci,
        calvingIntervalTargetDays: REPRO_BENCHMARKS.calvingIntervalDays.target,
        excessDays: cost.excessDays,
        calvingIntervalCostKes: cost.costKes,
        daysOpenDays,
        servicesPerConception: spc,
        abortionProtocol: anyAbortion ? ABORTION_PROTOCOL : null,
        warnings,
      },
      summary,
      ref,
    );
  });
}

/* ================================================================== */
/* Action — dry off                                                    */
/* ================================================================== */

const DryOffInput = z.object({
  id: z.string().uuid().optional(),
  animalId: z.string().uuid("Choose an animal."),
  driedOn: isoDate.optional(),
  method: z.enum(["ABRUPT", "GRADUAL"]).default("ABRUPT"),
  dryCowTherapyProductId: z.string().uuid().optional(),
});

export interface DryOffResult {
  id: string;
  animalName: string;
  driedOn: ISODate;
  expectedCalvingOn: ISODate | null;
  dryDays: number | null;
  /** Set when dry cow therapy was infused. This is a hard block later (R4). */
  milkClearOn: ISODate | null;
  warnings: string[];
  nextAction: string;
}

export async function recordDryOff(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<DryOffResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("BREED");

    const parsed = DryOffInput.safeParse(formObject(formData));
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const v = parsed.data;
    const driedOn = v.driedOn ?? today();

    const animal = await ownedAnimal(session, v.animalId);
    const { events } = await loadHerdSources(session, { animalIds: [v.animalId] });
    const ev = events.get(v.animalId)!;
    const facts = factsFor(animal, ev, driedOn);
    const status = deriveReproStatus(facts, driedOn);

    const edd = facts.expectedCalvingOn;
    const dryDays = edd ? daysBetween(driedOn, edd) : null;

    const warnings: string[] = [];
    if (status !== "PREGNANT") {
      warnings.push("She is not recorded in calf. Drying off an open cow ends her lactation for nothing.");
    }
    if (dryDays != null && dryDays < 40) {
      warnings.push(
        `Only ${dryDays} days to calving. A dry period under 40 days costs milk in the next lactation.`,
      );
    }
    if (dryDays != null && dryDays > 90) {
      warnings.push(`${dryDays} days is a long dry period — she will be carrying cost with no milk.`);
    }

    let milkClearOn: ISODate | null = null;
    let dctProduct: typeof s.product.$inferSelect | undefined;
    if (v.dryCowTherapyProductId) {
      dctProduct = await db.query.product.findFirst({
        where: eq(s.product.id, v.dryCowTherapyProductId),
      });
      if (!dctProduct || (dctProduct.farmId != null && dctProduct.farmId !== session.farmId)) {
        return actionError("That product was not found.");
      }
      milkClearOn = dryCowTherapyClearOn(driedOn, edd);
      warnings.push(
        `Dry cow therapy: her milk is not saleable until ${milkClearOn} — 30 days after infusion AND 96 hours after calving, whichever is later.`,
      );
    }

    const id = v.id ?? newId();
    await db
      .insert(s.dryOff)
      .values({
        id,
        farmId: session.farmId,
        animalId: v.animalId,
        driedOn,
        method: v.method,
        dryCowTherapyProductId: v.dryCowTherapyProductId ?? null,
        recordedBy: session.userId,
      })
      .onConflictDoNothing();

    /* ---------------------------------------------------------------- *
     * DRY COW THERAPY → HEALTH EVENT. Closing the loop.
     *
     * Infusing a dry cow tube IS a treatment, and the hard block that keeps
     * her milk out of the can reads `healthEvent.milkClearAt` — nothing else.
     * Until this row existed, drying off with therapy raised a CRITICAL alert
     * and computed a clear date that no query anywhere consulted: the milk
     * sheet showed her clear, and the only thing standing between a 30-day
     * antibiotic residue and the co-op's tank was somebody reading a reminder.
     *
     * `isDryCowTherapy` is set explicitly so `getWithdrawalStatus` extends the
     * date to calving + 96 hours once she actually calves — the stored date
     * here uses the EXPECTED calving, which is a forecast and may be early.
     * The id is derived from the dry-off, so a re-flushed offline entry
     * infuses her once.
     * ---------------------------------------------------------------- */
    if (dctProduct) {
      const meatClearOn =
        dctProduct.meatWithdrawalDays != null
          ? addDays(driedOn, dctProduct.meatWithdrawalDays)
          : null;
      await db
        .insert(s.healthEvent)
        .values({
          id: stableId(id, "dry-cow-therapy"),
          farmId: session.farmId,
          animalId: v.animalId,
          eventType: "TREATMENT",
          occurredOn: driedOn,
          diagnosis: DRY_COW_THERAPY,
          isDryCowTherapy: true,
          productId: dctProduct.id,
          route: "INTRAMAMMARY",
          treatmentEndOn: driedOn,
          milkClearAt: milkClearOn ? new Date(`${milkClearOn}T00:00:00.000Z`) : null,
          meatClearAt: meatClearOn,
          performedByUser: session.userId,
          outcome: "ONGOING",
          recordedBy: session.userId,
        })
        .onConflictDoNothing();
    }

    await resolveAlerts(session, v.animalId, [ALERT_KIND.DRY_OFF_DUE], "DRIED_OFF");

    const who = displayName(animal);
    if (milkClearOn) {
      await raiseAlerts(session, v.animalId, [
        {
          kind: ALERT_KIND.MILK_WITHDRAWAL_DRY_COW,
          action: `Do not sell ${who}'s milk until ${milkClearOn}.`,
          dueOn: milkClearOn,
          severity: "CRITICAL",
          assignedRole: "HERDSMAN",
          dedupeKey: `${v.animalId}:${ALERT_KIND.MILK_WITHDRAWAL_DRY_COW}:${id}`,
        },
      ]);
    }

    const nextAction = edd
      ? `Stop milking her now and start steaming up: 2–3 kg of dairy meal a day. Calving expected ${edd}.`
      : "Stop milking her now and start steaming up: 2–3 kg of dairy meal a day.";
    const summary = `${who} dried off ${driedOn}${edd ? `, ${dryDays} days before calving` : ""}.`;

    const ref = await writeReceipt(session, {
      id,
      prefix: REF_PREFIX.BREEDING,
      kind: "DRY_OFF",
      summary,
      payload: { animalId: v.animalId, driedOn, milkClearOn },
    });

    updateTag(`breeding:${session.farmId}`);
    updateTag(`herd:${session.farmId}`);

    return actionOk(
      {
        id,
        animalName: who,
        driedOn,
        expectedCalvingOn: edd,
        dryDays,
        milkClearOn,
        warnings,
        nextAction,
      },
      summary,
      ref,
    );
  });
}

/* ================================================================== */
/* Query — the watchboard                                              */
/* ================================================================== */

export type WatchKind =
  | "RETURN_TO_HEAT"
  | "PD_DUE"
  | "DRY_OFF_DUE"
  | "CALVING_DUE"
  | "SERVE_NOW";

export interface WatchItem {
  kind: WatchKind;
  animalId: string;
  tag: string;
  name: string | null;
  dueOn: ISODate;
  daysOverdue: number;
  severity: "INFO" | "WARN" | "CRITICAL";
  /** One person, one animal, one action, one deadline. */
  action: string;
  detail: string | null;
}

export interface Watchboard {
  asOf: ISODate;
  returnsToHeat: WatchItem[];
  pregnancyChecks: WatchItem[];
  dryOffs: WatchItem[];
  calvings: WatchItem[];
  serveNow: WatchItem[];
  all: WatchItem[];
  counts: Record<WatchKind, number>;
  total: number;
}

/**
 * Today's breeding actions, recomputed from events every time.
 *
 * Nothing here reads a queue of un-ticked reminders. Every item is a *question
 * asked of the latest event on that animal*, so a repeat service, a pregnancy
 * check, a dry-off or a calving removes the corresponding item the moment it is
 * recorded — the Herdwatch failure mode is structurally unavailable.
 */
export async function breedingWatchboard(
  session: Session,
  asOf: ISODate = today(),
): Promise<Watchboard> {
  const { animals, events } = await loadHerdSources(session);

  const items: WatchItem[] = [];

  for (const animal of animals) {
    const ev = events.get(animal.id)!;
    if (ev.exits.some((e) => e.exitDate <= asOf)) continue;
    if (animal.sex === "M") continue;

    const facts = factsFor(animal, ev, asOf);
    const status = deriveReproStatus(facts, asOf);
    const cls = deriveClass(facts, asOf);
    const who = animal.name ?? animal.tag;
    const base = { animalId: animal.id, tag: animal.tag, name: animal.name };

    const lastCalvingOn = facts.lastCalvingOn;
    const servicesThisCycle = ev.services.filter(
      (r) => r.servedOn <= asOf && (!lastCalvingOn || r.servedOn >= lastCalvingOn),
    );
    // ONLY the latest service is live. This one line is why a repeat-served cow
    // does not stick on the board.
    const service = servicesThisCycle.length ? servicesThisCycle[servicesThisCycle.length - 1] : null;

    if (service) {
      const cal = breedingCalendar(service.servedOn, animal.primaryBreed);
      const expectedReturnOn = service.expectedReturnOn ?? cal.expectedReturnOn;
      const pdDueOn = service.pdDueOn ?? cal.pdDueOn;
      const edd = service.expectedCalvingOn ?? cal.expectedCalvingOn;
      const dryOffDueOn = addDays(edd, -DRY_PERIOD_DAYS);
      const calvingAlertFrom = addDays(edd, -7);

      const pdsAfter = ev.pds.filter((p) => p.checkedOn >= service.servedOn && p.checkedOn <= asOf);
      const lastPd = pdsAfter.length ? pdsAfter[pdsAfter.length - 1] : null;
      const calvedAfter = ev.calvings.some((c) => c.calvedOn > service.servedOn && c.calvedOn <= asOf);
      const driedAfter = ev.dryOffs.some((d) => d.driedOn > service.servedOn && d.driedOn <= asOf);
      const negative = lastPd?.result === "NEGATIVE";
      const positive = lastPd?.result === "POSITIVE";

      // Return-to-heat watch: from three days before the expected return until
      // the pregnancy check falls due. Cleared by a PD, a repeat service (the
      // `service` above is the newest one) or a calving.
      if (!calvedAfter && !lastPd && asOf >= addDays(expectedReturnOn, -3) && asOf < pdDueOn) {
        items.push({
          ...base,
          kind: "RETURN_TO_HEAT",
          dueOn: expectedReturnOn,
          daysOverdue: daysBetween(expectedReturnOn, asOf),
          severity: "WARN",
          action: `Watch ${who} for a return to heat.`,
          detail: `Served ${service.servedOn}. If she comes on heat, serve her again and tell me — I will say what the gap means.`,
        });
      }

      // Pregnancy check due: cleared by any PD after the service, or a calving.
      if (!calvedAfter && !lastPd && asOf >= pdDueOn) {
        items.push({
          ...base,
          kind: "PD_DUE",
          dueOn: pdDueOn,
          daysOverdue: daysBetween(pdDueOn, asOf),
          severity: daysBetween(pdDueOn, asOf) > 14 ? "CRITICAL" : "WARN",
          action: `Have ${who} checked for pregnancy.`,
          detail: `Served ${service.servedOn}, ${daysBetween(service.servedOn, asOf)} days ago.`,
        });
      }

      if (!negative) {
        // Dry off due: cleared by a dry-off after the service, or by calving.
        if (!calvedAfter && !driedAfter && asOf >= dryOffDueOn && lastCalvingOn) {
          items.push({
            ...base,
            kind: "DRY_OFF_DUE",
            dueOn: dryOffDueOn,
            daysOverdue: daysBetween(dryOffDueOn, asOf),
            severity: daysBetween(dryOffDueOn, asOf) > 10 ? "CRITICAL" : "WARN",
            action: `Dry ${who} off and start steaming up.`,
            detail: `Calving expected ${edd}. She needs her ${DRY_PERIOD_DAYS}-day rest.`,
          });
        }

        // Calving imminent: cleared by the calving.
        if (!calvedAfter && asOf >= calvingAlertFrom && asOf <= addDays(edd, 21)) {
          items.push({
            ...base,
            kind: "CALVING_DUE",
            dueOn: edd,
            daysOverdue: daysBetween(edd, asOf),
            severity: "CRITICAL",
            action: `${who} is due to calve.`,
            detail:
              asOf > edd
                ? `She is ${daysBetween(edd, asOf)} days over. Check on her.`
                : `Expected ${edd}. Get the calving pen and clean bedding ready.`,
          });
        }
      }
    }

    // Open past the voluntary waiting period, and bulling heifers never served.
    const openish = status === "OPEN" || status === "FRESH";
    if (openish && !ev.exits.length) {
      if (lastCalvingOn) {
        const dim = daysBetween(lastCalvingOn, asOf);
        if (dim >= VWP_DAYS) {
          items.push({
            ...base,
            kind: "SERVE_NOW",
            dueOn: addDays(lastCalvingOn, VWP_DAYS),
            daysOverdue: dim - VWP_DAYS,
            severity: dim > REPRO_BENCHMARKS.daysToFirstServiceDays.acceptable ? "CRITICAL" : "WARN",
            action: `${who} is ${dim} days calved and still open — watch her for heat and serve her.`,
            detail: `Every day open past ${REPRO_BENCHMARKS.daysOpenDays.target} costs roughly ${calvingIntervalCostKes(REPRO_BENCHMARKS.calvingIntervalDays.target + 1).costKes} shillings.`,
          });
        }
      } else if (cls === "BULLING_HEIFER") {
        const age = ageDays(animal.dateOfBirth, asOf);
        items.push({
          ...base,
          kind: "SERVE_NOW",
          dueOn: asOf,
          daysOverdue: 0,
          severity: "WARN",
          action: `${who} is ready to serve — ${CLASS_LABEL[cls].toLowerCase()}.`,
          detail:
            facts.latestWeightKg != null
              ? `${facts.latestWeightKg} kg${age != null ? `, ${Math.floor(age / 30)} months` : ""}.`
              : age != null
                ? `${Math.floor(age / 30)} months. Weigh her — 280 kg matters more than age.`
                : "Weigh her — 280 kg matters more than age.",
        });
      }
    }
  }

  items.sort(
    (a, b) =>
      b.daysOverdue - a.daysOverdue || a.dueOn.localeCompare(b.dueOn) || a.tag.localeCompare(b.tag),
  );

  const pick = (k: WatchKind) => items.filter((i) => i.kind === k);
  const returnsToHeat = pick("RETURN_TO_HEAT");
  const pregnancyChecks = pick("PD_DUE");
  const dryOffs = pick("DRY_OFF_DUE");
  const calvings = pick("CALVING_DUE");
  const serveNow = pick("SERVE_NOW");

  return {
    asOf,
    returnsToHeat,
    pregnancyChecks,
    dryOffs,
    calvings,
    serveNow,
    all: items,
    counts: {
      RETURN_TO_HEAT: returnsToHeat.length,
      PD_DUE: pregnancyChecks.length,
      DRY_OFF_DUE: dryOffs.length,
      CALVING_DUE: calvings.length,
      SERVE_NOW: serveNow.length,
    },
    total: items.length,
  };
}

/* ================================================================== */
/* Query — a cow's breeding history, for the entry screens             */
/* ================================================================== */

export interface BreedingSummary {
  animalId: string;
  tag: string;
  name: string | null;
  cls: string;
  reproStatus: string;
  lastHeatOn: ISODate | null;
  lastServiceOn: ISODate | null;
  servicesThisCycle: number;
  expectedCalvingOn: ISODate | null;
  dryOffDueOn: ISODate | null;
  gestationDays: number;
  calvingIntervals: number[];
  averageCalvingIntervalDays: number | null;
  servicesPerConception: number | null;
}

export async function breedingSummary(
  session: Session,
  animalId: string,
  asOf: ISODate = today(),
): Promise<BreedingSummary | null> {
  const animal = await db.query.animal.findFirst({
    where: and(eq(s.animal.id, animalId), eq(s.animal.farmId, session.farmId)),
  });
  if (!animal) return null;

  const { events } = await loadHerdSources(session, { animalIds: [animalId] });
  const ev = events.get(animalId)!;
  const facts = factsFor(animal, ev, asOf);
  const status = deriveReproStatus(facts, asOf);

  const calvings = ev.calvings.filter((c) => !isAbortionCalving(c) && c.calvedOn <= asOf);
  const intervals: number[] = [];
  for (let i = 1; i < calvings.length; i++) {
    intervals.push(calvingInterval(calvings[i - 1].calvedOn, calvings[i].calvedOn));
  }

  const servicesThisCycle = ev.services.filter(
    (r) => r.servedOn <= asOf && (!facts.lastCalvingOn || r.servedOn >= facts.lastCalvingOn),
  ).length;

  const totalServices = ev.services.filter((r) => r.servedOn <= asOf).length;
  const conceptions = calvings.length;

  const heats = ev.heats.filter((h) => h.observedAt.toISOString().slice(0, 10) <= asOf);
  const edd = status === "PREGNANT" ? facts.expectedCalvingOn : null;

  return {
    animalId,
    tag: animal.tag,
    name: animal.name,
    cls: deriveClass(facts, asOf),
    reproStatus: status,
    lastHeatOn: heats.length ? heats[heats.length - 1].observedAt.toISOString().slice(0, 10) : null,
    lastServiceOn: facts.lastServiceOn,
    servicesThisCycle,
    expectedCalvingOn: edd,
    dryOffDueOn: edd ? addDays(edd, -DRY_PERIOD_DAYS) : null,
    gestationDays: gestationDays(animal.primaryBreed),
    calvingIntervals: intervals,
    averageCalvingIntervalDays: intervals.length
      ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length)
      : null,
    servicesPerConception:
      conceptions > 0 ? Math.round(servicesPerConception(totalServices, conceptions) * 10) / 10 : null,
  };
}

/* ================================================================== */
/* Query — dry cow therapy products, for the dry-off screen            */
/* ================================================================== */

/**
 * Intramammary products a cow can be dried off with.
 *
 * `product.farmId` is nullable because the drug master is partly a shared
 * catalogue, so both the farm's own products and the global ones are offered —
 * and nothing from any OTHER farm ever is.
 */
export async function listDryCowProducts(
  session: Session,
): Promise<{ id: string; name: string; milkWithdrawalDays: number | null }[]> {
  const rows = await db
    .select()
    .from(s.product)
    .where(or(isNull(s.product.farmId), eq(s.product.farmId, session.farmId)));

  return rows
    .filter((p) => p.productType === "INTRAMAMMARY" || p.notForLactating)
    .map((p) => ({ id: p.id, name: p.name, milkWithdrawalDays: p.milkWithdrawalDays }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
