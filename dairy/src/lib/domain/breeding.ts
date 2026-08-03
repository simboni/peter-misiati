/**
 * Breeding domain rules.
 *
 * The module that pays for the system: one service date in, a calendar of
 * alerts out. Kenyan impact evaluation of the closest analogue (iCow) measured
 * +13% milk per cow and +29% milk income from exactly this exchange.
 */
import { addDays, daysBetween, type ISODate } from "./dates";

/* ---------------------------------------------------------------- */
/* Gestation                                                         */
/* ---------------------------------------------------------------- */

/**
 * Mean gestation by breed, in days. Bos indicus runs longer than Bos taurus.
 * Configurable per farm via referenceValue(kind='GESTATION_DAYS'); this is the
 * fallback table.
 */
export const GESTATION_DAYS: Record<string, number> = {
  FRIESIAN: 281,
  HOLSTEIN: 281,
  "HOLSTEIN-FRIESIAN": 281,
  AYRSHIRE: 279,
  JERSEY: 279,
  GUERNSEY: 283,
  SAHIWAL: 288,
  ZEBU: 288,
  BORAN: 288,
};

/** The Kenyan extension default — 283 days, "nine months and nine days". */
export const DEFAULT_GESTATION_DAYS = 283;

export function gestationDays(breed?: string | null): number {
  if (!breed) return DEFAULT_GESTATION_DAYS;
  return GESTATION_DAYS[breed.trim().toUpperCase()] ?? DEFAULT_GESTATION_DAYS;
}

/* ---------------------------------------------------------------- */
/* The calendar generated at the moment a service is recorded        */
/* ---------------------------------------------------------------- */

/** Oestrus cycle length. A return outside 18–24 days means something. */
export const CYCLE_DAYS = 21;
/** Rectal palpation, the Kenyan default, is reliable from about 60 days. */
export const PD_DUE_DAYS = 60;
/** Dry period before calving. Under 40 days costs the next lactation. */
export const DRY_PERIOD_DAYS = 60;
/** Voluntary waiting period after calving before she is served again. */
export const VWP_DAYS = 50;

export interface BreedingCalendar {
  servedOn: ISODate;
  expectedReturnOn: ISODate;
  pdDueOn: ISODate;
  expectedCalvingOn: ISODate;
  dryOffDueOn: ISODate;
  steamingUpFrom: ISODate;
  springerFrom: ISODate;
  calvingAlertFrom: ISODate;
  gestationDays: number;
}

export function breedingCalendar(servedOn: ISODate, breed?: string | null): BreedingCalendar {
  const g = gestationDays(breed);
  const edd = addDays(servedOn, g);
  return {
    servedOn,
    expectedReturnOn: addDays(servedOn, CYCLE_DAYS),
    pdDueOn: addDays(servedOn, PD_DUE_DAYS),
    expectedCalvingOn: edd,
    dryOffDueOn: addDays(edd, -DRY_PERIOD_DAYS),
    steamingUpFrom: addDays(edd, -DRY_PERIOD_DAYS),
    springerFrom: addDays(edd, -21),
    calvingAlertFrom: addDays(edd, -7),
    gestationDays: g,
  };
}

/* ---------------------------------------------------------------- */
/* Interpreting a return to heat                                     */
/* ---------------------------------------------------------------- */

export type ReturnVerdict =
  | "NORMAL_RETURN"
  | "EARLY_LOSS_OR_MISTIMED"
  | "MISSED_HEAT"
  | "IRREGULAR"
  | "TOO_SOON";

export interface ReturnInterpretation {
  verdict: ReturnVerdict;
  intervalDays: number;
  /** Plain language, shown to the manager. No jargon, no codes. */
  message: string;
}

/**
 * A return to heat is diagnosed, not merely recorded.
 *
 * The one that matters most is the ~42-day return: it means a heat was missed
 * one cycle earlier. That is a *detection* failure the manager can fix, not a
 * fertility failure — and heat detection below 50% is the single biggest
 * reproductive loss on Kenyan farms.
 */
export function interpretReturn(servedOn: ISODate, returnedOn: ISODate): ReturnInterpretation {
  const d = daysBetween(servedOn, returnedOn);

  if (d < 3) {
    return {
      verdict: "TOO_SOON",
      intervalDays: d,
      message: "This is only a few days after service — check the service date is right.",
    };
  }
  if (d <= 17) {
    return {
      verdict: "EARLY_LOSS_OR_MISTIMED",
      intervalDays: d,
      message:
        "She returned early. That usually means the insemination was mistimed, or the pregnancy was lost very early.",
    };
  }
  if (d <= 24) {
    return {
      verdict: "NORMAL_RETURN",
      intervalDays: d,
      message: "A normal return — she did not hold. Serve her again on this heat.",
    };
  }
  // Multiples of the cycle mean whole heats went unseen.
  const cycles = Math.round(d / CYCLE_DAYS);
  const offCycle = Math.abs(d - cycles * CYCLE_DAYS);
  if (cycles >= 2 && offCycle <= 4) {
    return {
      verdict: "MISSED_HEAT",
      intervalDays: d,
      message: `About ${cycles} cycles have passed, so ${cycles - 1} heat${
        cycles > 2 ? "s were" : " was"
      } missed. This is a heat-detection problem, not a fertility one.`,
    };
  }
  return {
    verdict: "IRREGULAR",
    intervalDays: d,
    message:
      "This interval does not fit the normal cycle. Check the records, or have her examined for a cystic ovary.",
  };
}

/* ---------------------------------------------------------------- */
/* Reproductive KPIs                                                 */
/* ---------------------------------------------------------------- */

/**
 * Benchmarks for a Kenyan commercial dairy. `target` is what a well-run farm
 * achieves; `observed` is what Kenyan studies actually measure, which is the
 * honest comparison to show a farmer.
 */
export const REPRO_BENCHMARKS = {
  ageAtFirstCalvingMonths: { target: 24, acceptable: 27, kenyanObserved: 34.8 },
  calvingIntervalDays: { target: 380, acceptable: 400, kenyanObserved: 430 },
  daysOpenDays: { target: 100, acceptable: 120 },
  daysToFirstServiceDays: { target: 60, acceptable: 90 },
  servicesPerConception: { target: 1.6, acceptable: 2.0 },
  conceptionRatePct: { target: 55, acceptable: 40 },
  heatDetectionRatePct: { target: 70, acceptable: 50 },
} as const;

export function calvingInterval(previousCalving: ISODate, thisCalving: ISODate): number {
  return daysBetween(previousCalving, thisCalving);
}

export function daysOpen(calvedOn: ISODate, conceivedOn: ISODate): number {
  return daysBetween(calvedOn, conceivedOn);
}

export function ageAtFirstCalvingMonths(dob: ISODate, firstCalving: ISODate): number {
  return daysBetween(dob, firstCalving) / 30.4375;
}

export function servicesPerConception(services: number, conceptions: number): number {
  return conceptions === 0 ? 0 : services / conceptions;
}

/**
 * The cost of a long calving interval, stated in the only unit that moves a
 * farmer: shillings. Every day beyond target is a day of tail-lactation or dry
 * days carrying full maintenance cost with no milk.
 */
export function calvingIntervalCostKes(
  actualDays: number,
  opts: { targetDays?: number; litresPerDayLost?: number; pricePerLitre?: number } = {},
): { excessDays: number; costKes: number } {
  const target = opts.targetDays ?? REPRO_BENCHMARKS.calvingIntervalDays.target;
  const litresLost = opts.litresPerDayLost ?? 4; // 3–5 L/day is the usual estimate
  const price = opts.pricePerLitre ?? 52; // KES farm-gate benchmark, Aug 2026
  const excess = Math.max(0, actualDays - target);
  return { excessDays: excess, costKes: Math.round(excess * litresLost * price) };
}

/**
 * The AM/PM rule, applied for the user rather than explained to them.
 * Heat seen in the morning → inseminate that evening, and vice versa.
 */
export function inseminationWindow(observedAt: Date): { advice: string; serveOn: ISODate } {
  const hour = observedAt.getUTCHours();
  const morning = hour < 12;
  const iso = observedAt.toISOString().slice(0, 10);
  return morning
    ? { advice: "Seen this morning — inseminate this evening.", serveOn: iso }
    : { advice: "Seen this evening — inseminate tomorrow morning.", serveOn: addDays(iso, 1) };
}
