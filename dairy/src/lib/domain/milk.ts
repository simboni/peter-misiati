/**
 * Milk domain rules — lactation shape, plausibility, and the daily
 * reconciliation that catches losses running 1.3–6.4% of value.
 */
import { LOSS_CHANNELS, REVENUE_CHANNELS, type DisposalChannel } from "@/db/schema";
import { money, num } from "../money";

/** The ICAR/KLBA standard basis for comparing lactations. */
export const STANDARD_LACTATION_DAYS = 305;

/* ---------------------------------------------------------------- */
/* Lactation                                                         */
/* ---------------------------------------------------------------- */

/** Peak yield lands in weeks 4–8; heifers peak later and flatter. */
export function isPastPeak(daysInMilk: number): boolean {
  return daysInMilk > 60;
}

/**
 * Project a 305-day yield from the peak. The rule of thumb Kenyan extension
 * uses is peak × 200–220; we take the conservative end.
 */
export function project305FromPeak(peakDailyL: number): number {
  return money(peakDailyL * 200);
}

/**
 * Persistency — the share of peak retained per month after peak.
 * 92–95% a month is good; below 88% suggests a nutrition or health problem.
 */
export function persistencyPct(peakDailyL: number, currentDailyL: number, monthsSincePeak: number): number {
  if (peakDailyL <= 0 || monthsSincePeak <= 0) return 100;
  const ratio = currentDailyL / peakDailyL;
  return money(Math.pow(ratio, 1 / monthsSincePeak) * 100);
}

/* ---------------------------------------------------------------- */
/* Plausibility — warn, never block                                  */
/* ---------------------------------------------------------------- */

export interface PlausibilityCheck {
  ok: boolean;
  flagged: boolean;
  reason?: string;
  /** Shown inline at entry. Dismissible — the record saves either way. */
  message?: string;
}

/**
 * Rigid validation does not produce complete data; it produces invented data.
 * One study attributed 80% of all errors to required fields plus free text.
 * So: nothing here blocks a save. Odd values are flagged for the manager.
 */
export function checkYieldPlausibility(
  litres: number,
  context: { recentAverageL?: number | null; animalName?: string; maxPlausibleL?: number },
): PlausibilityCheck {
  const name = context.animalName ?? "This cow";
  const max = context.maxPlausibleL ?? 45; // beyond any Kenyan single-session yield

  if (litres < 0) {
    return { ok: false, flagged: true, reason: "NEGATIVE", message: "Litres cannot be less than zero." };
  }
  if (litres > max) {
    return {
      ok: true,
      flagged: true,
      reason: "ABOVE_MAX",
      message: `${litres} L is higher than any cow here normally gives. Saved — the manager will check it.`,
    };
  }

  const avg = context.recentAverageL;
  if (avg != null && avg > 0) {
    const change = (litres - avg) / avg;
    if (change <= -0.3) {
      return {
        ok: true,
        flagged: true,
        reason: "DROP",
        message: `That is ${Math.round(Math.abs(change) * 100)}% below ${name}'s usual ${avg.toFixed(
          1,
        )} L — is that right?`,
      };
    }
    if (change >= 0.5) {
      return {
        ok: true,
        flagged: true,
        reason: "SPIKE",
        message: `That is well above ${name}'s usual ${avg.toFixed(1)} L. Saved — check the cow is right.`,
      };
    }
  }
  return { ok: true, flagged: false };
}

/**
 * A sustained drop is the earliest cheap signal of mastitis, heat or illness,
 * and surfacing it at the moment of entry is the whole point of the module.
 */
export function detectSustainedDrop(
  recent: number[],
  baseline: number,
  opts: { days?: number; thresholdPct?: number } = {},
): { dropping: boolean; pct: number; days: number } {
  const days = opts.days ?? 3;
  const threshold = opts.thresholdPct ?? 20;
  if (baseline <= 0 || recent.length < days) return { dropping: false, pct: 0, days: 0 };

  const window = recent.slice(-days);
  const allBelow = window.every((v) => ((baseline - v) / baseline) * 100 >= threshold);
  if (!allBelow) return { dropping: false, pct: 0, days: 0 };

  const avg = window.reduce((a, b) => a + b, 0) / window.length;
  return { dropping: true, pct: Math.round(((baseline - avg) / baseline) * 100), days };
}

/* ---------------------------------------------------------------- */
/* Disposal and reconciliation                                       */
/* ---------------------------------------------------------------- */

export function isRevenueChannel(c: DisposalChannel): boolean {
  return (REVENUE_CHANNELS as readonly string[]).includes(c);
}

export function isLossChannel(c: DisposalChannel): boolean {
  return (LOSS_CHANNELS as readonly string[]).includes(c);
}

/** Home use, calves and staff ration earn nothing but are valued at market price. */
export function isImputedChannel(c: DisposalChannel): boolean {
  return c === "HOME_CONSUMPTION" || c === "CALF_FEEDING" || c === "STAFF_RATION";
}

export interface ReconciliationLine {
  channel: DisposalChannel;
  litres: number;
}

export interface Reconciliation {
  producedL: number;
  disposedL: number;
  varianceL: number;
  revenueL: number;
  imputedL: number;
  lossL: number;
  balanced: boolean;
  /** Plain language. Surfaced daily, not buried in a monthly report. */
  message: string;
}

/**
 * Produced must equal disposed. The variance is shown, never hidden — an
 * unexplained gap between the parlour and the can is the classic milk-theft
 * signal, and the farm wants to see it while it is still fixable.
 */
export function reconcileDay(
  producedL: number,
  lines: ReconciliationLine[],
  toleranceL = 0.5,
): Reconciliation {
  let revenueL = 0;
  let imputedL = 0;
  let lossL = 0;

  for (const l of lines) {
    const v = num(l.litres);
    if (isRevenueChannel(l.channel)) revenueL += v;
    else if (isImputedChannel(l.channel)) imputedL += v;
    else lossL += v;
  }

  const disposedL = money(revenueL + imputedL + lossL);
  const varianceL = money(producedL - disposedL);
  const balanced = Math.abs(varianceL) <= toleranceL;

  let message: string;
  if (balanced) {
    message = `Balanced — ${producedL.toFixed(1)} L produced, all accounted for.`;
  } else if (varianceL > 0) {
    message = `${varianceL.toFixed(1)} L unaccounted for. Where did it go?`;
  } else {
    message = `${Math.abs(varianceL).toFixed(1)} L more was sold than recorded as produced. Check the milking entries.`;
  }

  return { producedL, disposedL, varianceL, revenueL, imputedL, lossL, balanced, message };
}

/**
 * Blended price across every channel — the number that tells an owner whether
 * the channel mix is right. Selling everything to the co-op is safe and cheap;
 * selling everything direct is lucrative and carries the debt risk.
 */
export function blendedPricePerLitre(
  lines: Array<{ channel: DisposalChannel; litres: number; valueKes: number }>,
): { blendedKes: number; revenueL: number; revenueKes: number } {
  let revenueL = 0;
  let revenueKes = 0;
  for (const l of lines) {
    if (!isRevenueChannel(l.channel)) continue;
    revenueL += num(l.litres);
    revenueKes += num(l.valueKes);
  }
  return {
    blendedKes: revenueL === 0 ? 0 : money(revenueKes / revenueL),
    revenueL: money(revenueL),
    revenueKes: money(revenueKes),
  };
}

/** Loss rate as a share of production. Kenyan farm-level losses run 1.3–6.4%. */
export function lossRatePct(producedL: number, lossL: number): number {
  return producedL === 0 ? 0 : money((lossL / producedL) * 100);
}
