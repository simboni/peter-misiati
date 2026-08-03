/**
 * Feed domain rules.
 *
 * Feed is 55–65% of production cost on a Kenyan intensive unit, and the whole
 * margin is KES 8–20 a litre. Margin over feed cost is therefore the single
 * most useful management number in dairy — and almost no competitor computes it.
 */
import { money, num, toKg } from "../money";
import type { AnimalGroup } from "@/db/schema";

/* ---------------------------------------------------------------- */
/* Units — where cost accuracy is won or lost                        */
/* ---------------------------------------------------------------- */

/**
 * Purchase and issue units. Informal units are here deliberately: fresh Napier
 * really is measured in headloads and wheelbarrows, and pretending otherwise
 * just means the farm stops recording it.
 */
export const FEED_UNITS = [
  "KG", "TONNE", "BAG_70KG", "BAG_50KG", "BAG_25KG", "BALE",
  "LITRE", "BLOCK", "HEADLOAD", "WHEELBARROW", "PICKUP_LOAD",
] as const;
export type FeedUnit = (typeof FEED_UNITS)[number];

/**
 * Default weights. Every one of these is overridable per farm, because a
 * Kenyan hay bale ranges 12–25 kg (and a round bale 300–500), and dairy meal
 * comes in 70 kg *and* 50 kg bags at very different prices per kilo.
 */
export const DEFAULT_UNIT_WEIGHT_KG: Record<FeedUnit, number | null> = {
  KG: 1,
  TONNE: 1000,
  BAG_70KG: 70,
  BAG_50KG: 50,
  BAG_25KG: 25,
  BALE: 15,           // conventional square bale — MUST be confirmed per supplier
  LITRE: 1.4,         // molasses, approximate density
  BLOCK: 2,
  HEADLOAD: 20,
  WHEELBARROW: 50,
  PICKUP_LOAD: 500,
};

export const UNIT_LABEL: Record<FeedUnit, string> = {
  KG: "kg",
  TONNE: "tonnes",
  BAG_70KG: "bags (70 kg)",
  BAG_50KG: "bags (50 kg)",
  BAG_25KG: "bags (25 kg)",
  BALE: "bales",
  LITRE: "litres",
  BLOCK: "blocks",
  HEADLOAD: "headloads",
  WHEELBARROW: "wheelbarrows",
  PICKUP_LOAD: "pickup loads",
};

/** Units whose weight varies enough that we refuse to guess. */
export function requiresExplicitWeight(unit: FeedUnit): boolean {
  return unit === "BALE" || unit === "HEADLOAD" || unit === "WHEELBARROW" || unit === "PICKUP_LOAD";
}

/* ---------------------------------------------------------------- */
/* Feeding rules                                                     */
/* ---------------------------------------------------------------- */

/**
 * Challenge feeding. NAFIS gives 1 kg of dairy meal per extra 1.5 kg of milk
 * above 8 litres; farmers also quote 1 kg per 2 L and 1 kg per 3 L. Sources
 * genuinely disagree, so this ships as a configurable rule with a default
 * rather than a hard-coded constant.
 */
export interface ConcentrateRule {
  /** Litres covered by forage alone before concentrate starts. */
  baselineLitres: number;
  /** Litres of milk supported by 1 kg of concentrate above the baseline. */
  litresPerKgConcentrate: number;
  /** Never more than this in a single feed — rumen acidosis. */
  maxKgPerFeed: number;
}

export const DEFAULT_CONCENTRATE_RULE: ConcentrateRule = {
  baselineLitres: 8,
  litresPerKgConcentrate: 1.5,
  maxKgPerFeed: 4,
};

export interface ConcentrateAdvice {
  kgPerDay: number;
  feedsPerDay: number;
  kgPerFeed: number;
  note: string;
}

export function concentrateForYield(
  dailyYieldL: number,
  rule: ConcentrateRule = DEFAULT_CONCENTRATE_RULE,
): ConcentrateAdvice {
  const above = Math.max(0, dailyYieldL - rule.baselineLitres);
  const kgPerDay = money(above / rule.litresPerKgConcentrate);
  const feedsPerDay = Math.max(2, Math.ceil(kgPerDay / rule.maxKgPerFeed));
  const kgPerFeed = money(kgPerDay / feedsPerDay);

  let note: string;
  if (kgPerDay === 0) {
    note = `Forage alone covers up to ${rule.baselineLitres} litres. No concentrate needed.`;
  } else {
    note = `${kgPerDay} kg a day, split into ${feedsPerDay} feeds of about ${kgPerFeed} kg. Never more than ${rule.maxKgPerFeed} kg in one feed.`;
  }
  return { kgPerDay, feedsPerDay, kgPerFeed, note };
}

/** Steaming up: extra concentrate in the last 60 days before calving. */
export const STEAMING_UP_KG_PER_DAY = { start: 1, peak: 3 };

/** Dry matter intake as a share of bodyweight, by class. */
export const DM_INTAKE_PCT_BODYWEIGHT: Record<AnimalGroup, number> = {
  LACTATING: 3.0,
  DRY: 2.0,
  HEIFERS: 2.5,
  CALVES: 2.5,
  BULLS: 2.25,
  ALL: 2.75,
};

export function dailyDmRequirementKg(bodyweightKg: number, group: AnimalGroup): number {
  return money((bodyweightKg * DM_INTAKE_PCT_BODYWEIGHT[group]) / 100);
}

/** Water: 4–5 litres per litre of milk, plus maintenance. Cheapest fix for low yield. */
export function dailyWaterRequirementL(bodyweightKg: number, dailyYieldL: number): number {
  return money(bodyweightKg * 0.08 + dailyYieldL * 4.5);
}

/** Forage : concentrate on a dry-matter basis. 70:30 is the Kenyan guideline. */
export const TARGET_FORAGE_PCT = 70;

export function acidosisRisk(concentratePctOfDm: number): { risk: boolean; message?: string } {
  if (concentratePctOfDm > 55) {
    return {
      risk: true,
      message: `Concentrate is ${Math.round(
        concentratePctOfDm,
      )}% of the ration. Above 55% risks acidosis — add forage.`,
    };
  }
  return { risk: false };
}

/* ---------------------------------------------------------------- */
/* Stock and cover                                                   */
/* ---------------------------------------------------------------- */

export interface StockLine {
  quantity: number | string;
  unitWeightKg: number | string;
}

export function stockBalanceKg(purchases: StockLine[], issues: StockLine[]): number {
  const inKg = purchases.reduce((a, p) => a + toKg(p.quantity, p.unitWeightKg), 0);
  const outKg = issues.reduce((a, i) => a + toKg(i.quantity, i.unitWeightKg), 0);
  return money(inKg - outKg);
}

export interface CoverResult {
  daysOfCover: number | null;
  dailyBurnKg: number;
  message: string;
}

/**
 * Days of cover at the trailing burn rate. "Order by Friday" is more useful to
 * a farm manager than a stock figure, so that is what this returns.
 */
export function daysOfCover(
  balanceKg: number,
  issuedKgOverPeriod: number,
  periodDays: number,
): CoverResult {
  const dailyBurnKg = periodDays > 0 ? money(issuedKgOverPeriod / periodDays) : 0;
  if (dailyBurnKg <= 0) {
    return { daysOfCover: null, dailyBurnKg: 0, message: "Not being used at the moment." };
  }
  const days = Math.floor(balanceKg / dailyBurnKg);
  let message: string;
  if (days <= 0) message = "Out of stock.";
  else if (days <= 3) message = `${days} day${days === 1 ? "" : "s"} left — order today.`;
  else if (days <= 7) message = `${days} days left — order this week.`;
  else message = `${days} days of cover.`;
  return { daysOfCover: days, dailyBurnKg, message };
}

/* ---------------------------------------------------------------- */
/* Margin over feed cost — the headline number                       */
/* ---------------------------------------------------------------- */

export interface MarginOverFeed {
  milkRevenueKes: number;
  feedCostKes: number;
  litres: number;
  revenuePerLitre: number;
  feedCostPerLitre: number;
  marginPerLitre: number;
  marginKes: number;
  /** One sentence. Reports state conclusions, not tables. */
  message: string;
}

export function marginOverFeedCost(
  milkRevenueKes: number,
  feedCostKes: number,
  litresProduced: number,
): MarginOverFeed {
  const revenue = num(milkRevenueKes);
  const feed = num(feedCostKes);
  const l = num(litresProduced);

  const revenuePerLitre = l === 0 ? 0 : money(revenue / l);
  const feedCostPerLitre = l === 0 ? 0 : money(feed / l);
  const marginPerLitre = money(revenuePerLitre - feedCostPerLitre);

  let message: string;
  if (l === 0) {
    message = "No milk recorded for this period.";
  } else if (marginPerLitre <= 0) {
    message = `Every litre is costing more in feed than it earns. Feed is KES ${feedCostPerLitre.toFixed(
      2,
    )} against milk at KES ${revenuePerLitre.toFixed(2)}.`;
  } else {
    message = `KES ${marginPerLitre.toFixed(2)} a litre after feed — milk at KES ${revenuePerLitre.toFixed(
      2,
    )} less feed at KES ${feedCostPerLitre.toFixed(2)}.`;
  }

  return {
    milkRevenueKes: money(revenue),
    feedCostKes: money(feed),
    litres: money(l),
    revenuePerLitre,
    feedCostPerLitre,
    marginPerLitre,
    marginKes: money(revenue - feed),
    message,
  };
}

/**
 * Kenya Dairy Board puts full cost of production at KES 30–37 a litre against a
 * farm-gate price near 52. That gap is the whole business, so it belongs on the
 * pricing screen as a break-even line rather than in a report nobody opens.
 */
export const COST_OF_PRODUCTION_KES_PER_LITRE = { low: 30, high: 37 };

export function breakEvenWarning(pricePerLitre: number): string | null {
  if (pricePerLitre < COST_OF_PRODUCTION_KES_PER_LITRE.low) {
    return `KES ${pricePerLitre} is below what it costs to produce a litre here (KES ${COST_OF_PRODUCTION_KES_PER_LITRE.low}–${COST_OF_PRODUCTION_KES_PER_LITRE.high}). This sale loses money.`;
  }
  if (pricePerLitre < COST_OF_PRODUCTION_KES_PER_LITRE.high) {
    return `KES ${pricePerLitre} is inside the cost-of-production range (KES ${COST_OF_PRODUCTION_KES_PER_LITRE.low}–${COST_OF_PRODUCTION_KES_PER_LITRE.high}). The margin is thin.`;
  }
  return null;
}
