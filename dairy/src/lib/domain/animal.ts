/**
 * Animal class derivation.
 *
 * The single most important schema decision in the system: class is DERIVED
 * from events, never typed by hand. Store the service, the pregnancy check, the
 * calving, the dry-off — and compute "in-calf heifer" on read.
 *
 * Parity and reproductive status are ORTHOGONAL to class and must not be folded
 * into it, because the normal case for a working dairy cow is to be lactating
 * and pregnant at the same time.
 */
import type { AnimalClass, ReproStatus } from "@/db/schema";
import { ageMonths, daysBetween, type ISODate } from "./dates";
import { DRY_PERIOD_DAYS } from "./breeding";

/** Weight at which a heifer is ready to serve — about 60% of mature weight. */
export const BULLING_WEIGHT_KG = 280;
/** Or age, whichever comes first. Weight is the better signal. */
export const BULLING_AGE_MONTHS = 14;
export const WEANING_AGE_MONTHS = 3;
export const HEIFER_AGE_MONTHS = 9;
/** Last weeks before calving: udder developing, being steamed up. */
export const SPRINGER_DAYS_BEFORE_CALVING = 56;

export interface AnimalFacts {
  sex: "F" | "M";
  dateOfBirth: ISODate | null;
  castrated: boolean;
  classOverride: AnimalClass | null;
  /** Number of calvings. 0 means she has never calved — she is still a heifer. */
  parity: number;
  lastCalvingOn: ISODate | null;
  lastServiceOn: ISODate | null;
  pdPositiveOn: ISODate | null;
  pdNegativeOn: ISODate | null;
  driedOffOn: ISODate | null;
  expectedCalvingOn: ISODate | null;
  latestWeightKg: number | null;
  culled: boolean;
}

/**
 * Reproductive status. Derived by asking which event happened most recently
 * relative to the last calving — order matters more than any single flag.
 */
export function deriveReproStatus(f: AnimalFacts, asOf: ISODate): ReproStatus {
  if (f.sex === "M") return "OPEN";

  const since = (d: ISODate | null) =>
    d && (!f.lastCalvingOn || d >= f.lastCalvingOn) ? d : null;

  const dried = since(f.driedOffOn);
  const pregnant = since(f.pdPositiveOn);
  const served = since(f.lastServiceOn);
  const negated = since(f.pdNegativeOn);

  if (dried) return "DRY";
  if (pregnant && (!negated || negated < pregnant)) return "PREGNANT";
  if (served && (!negated || negated < served)) return "SERVED";
  if (f.lastCalvingOn && daysBetween(f.lastCalvingOn, asOf) <= 60) return "FRESH";
  return "OPEN";
}

/**
 * The class. Reads top-down: an explicit override for bought-in animals with no
 * history, then males, then females by parity and reproductive state.
 */
export function deriveClass(f: AnimalFacts, asOf: ISODate): AnimalClass {
  if (f.classOverride) return f.classOverride;

  const months = ageMonths(f.dateOfBirth, asOf);

  if (f.sex === "M") {
    if (f.castrated) return "STEER";
    if (months !== null && months < 6) return "BULL_CALF";
    return "BULL";
  }

  if (f.culled) return "CULL_COW";

  const status = deriveReproStatus(f, asOf);
  const daysToCalving =
    f.expectedCalvingOn && status === "PREGNANT"
      ? daysBetween(asOf, f.expectedCalvingOn)
      : null;
  const isSpringing =
    daysToCalving !== null &&
    daysToCalving >= 0 &&
    daysToCalving <= SPRINGER_DAYS_BEFORE_CALVING;

  // Never calved — she is somewhere on the heifer ladder.
  if (f.parity === 0) {
    if (months !== null && months < WEANING_AGE_MONTHS) return "CALF";
    if (status === "PREGNANT") return isSpringing ? "SPRINGER" : "INCALF_HEIFER";
    if (status === "SERVED") return "SERVED_HEIFER";
    if (months !== null && months < HEIFER_AGE_MONTHS) return "WEANER";
    const bigEnough = f.latestWeightKg !== null && f.latestWeightKg >= BULLING_WEIGHT_KG;
    const oldEnough = months !== null && months >= BULLING_AGE_MONTHS;
    if (bigEnough || oldEnough) return "BULLING_HEIFER";
    return "HEIFER";
  }

  // She has calved at least once.
  if (status === "DRY") return isSpringing ? "SPRINGER" : "DRY_COW";
  if (f.parity === 1) return "FIRST_CALVER";
  if (f.parity >= 3) return "MATURE_COW";
  return "LACTATING_COW";
}

/** Is this animal currently producing milk we might record? */
export function isMilking(cls: AnimalClass): boolean {
  return cls === "FIRST_CALVER" || cls === "LACTATING_COW" || cls === "MATURE_COW";
}

/** Is she eligible to be served today? */
export function isServable(f: AnimalFacts, asOf: ISODate): boolean {
  if (f.sex === "M" || f.culled) return false;
  const status = deriveReproStatus(f, asOf);
  if (status === "PREGNANT" || status === "SERVED" || status === "DRY") return false;
  const cls = deriveClass(f, asOf);
  if (cls === "BULLING_HEIFER") return true;
  // Cows must clear the voluntary waiting period after calving.
  if (f.lastCalvingOn && daysBetween(f.lastCalvingOn, asOf) < 40) return false;
  return isMilking(cls) || cls === "DRY_COW";
}

/** Days in milk. Null when she is not in a lactation. */
export function daysInMilk(f: AnimalFacts, asOf: ISODate): number | null {
  if (!f.lastCalvingOn) return null;
  const status = deriveReproStatus(f, asOf);
  if (status === "DRY") return null;
  const d = daysBetween(f.lastCalvingOn, asOf);
  return d >= 0 ? d : null;
}

/** Should she be dried off? Sixty days before calving, or below ~5 L/day. */
export function dryOffDue(
  f: AnimalFacts,
  asOf: ISODate,
  recentDailyYieldL?: number | null,
): { due: boolean; reason?: string } {
  if (deriveReproStatus(f, asOf) === "DRY") return { due: false };
  if (f.expectedCalvingOn) {
    const daysLeft = daysBetween(asOf, f.expectedCalvingOn);
    if (daysLeft <= DRY_PERIOD_DAYS && daysLeft >= 0) {
      return { due: true, reason: `Calving in ${daysLeft} days — she needs her 60-day rest.` };
    }
  }
  if (recentDailyYieldL != null && recentDailyYieldL < 5 && (daysInMilk(f, asOf) ?? 0) > 200) {
    return { due: true, reason: "She is down to under 5 litres a day late in her lactation." };
  }
  return { due: false };
}

/** Human labels. Never `rc=6` — the DairyComp mistake we are deliberately not repeating. */
export const CLASS_LABEL: Record<AnimalClass, string> = {
  CALF: "Calf",
  WEANER: "Weaner",
  HEIFER: "Heifer",
  BULLING_HEIFER: "Bulling heifer",
  SERVED_HEIFER: "Served heifer",
  INCALF_HEIFER: "In-calf heifer",
  SPRINGER: "Springer",
  FIRST_CALVER: "First calver",
  LACTATING_COW: "Milking cow",
  DRY_COW: "Dry cow",
  MATURE_COW: "Milking cow",
  CULL_COW: "Cull cow",
  BULL: "Bull",
  BULL_CALF: "Bull calf",
  STEER: "Steer",
};

export const CLASS_LABEL_SW: Record<AnimalClass, string> = {
  CALF: "Ndama",
  WEANER: "Ndama aliyeachishwa",
  HEIFER: "Mtamba",
  BULLING_HEIFER: "Mtamba tayari kupandwa",
  SERVED_HEIFER: "Mtamba aliyepandwa",
  INCALF_HEIFER: "Mtamba mwenye mimba",
  SPRINGER: "Anayekaribia kuzaa",
  FIRST_CALVER: "Aliyezaa mara ya kwanza",
  LACTATING_COW: "Ng'ombe wa maziwa",
  DRY_COW: "Ng'ombe aliyekauka",
  MATURE_COW: "Ng'ombe wa maziwa",
  CULL_COW: "Ng'ombe wa kuuzwa",
  BULL: "Fahali",
  BULL_CALF: "Ndama dume",
  STEER: "Maksai",
};
