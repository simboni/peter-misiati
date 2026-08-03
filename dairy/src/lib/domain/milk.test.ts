import { describe, it, expect } from "vitest";
import {
  blendedPricePerLitre,
  checkYieldPlausibility,
  detectSustainedDrop,
  isImputedChannel,
  isLossChannel,
  isPastPeak,
  isRevenueChannel,
  lossRatePct,
  persistencyPct,
  project305FromPeak,
  reconcileDay,
} from "./milk";

/**
 * The rules M3 exists to enforce, tested without a database.
 *
 * The single most important property here is negative: nothing in this file may
 * ever conclude "reject". Rigid validation produces invented data, and the one
 * lawful hard block (withdrawal) lives in health, not here.
 */

describe("checkYieldPlausibility", () => {
  it("passes a normal yield silently", () => {
    const r = checkYieldPlausibility(12.5, { recentAverageL: 12, animalName: "Njeri" });
    expect(r.ok).toBe(true);
    expect(r.flagged).toBe(false);
    expect(r.message).toBeUndefined();
  });

  it("flags a 30% drop but still saves it", () => {
    const r = checkYieldPlausibility(8, { recentAverageL: 12, animalName: "Nyambura" });
    expect(r.ok).toBe(true);
    expect(r.flagged).toBe(true);
    expect(r.reason).toBe("DROP");
    expect(r.message).toContain("Nyambura");
    expect(r.message).toContain("33%");
  });

  it("does not flag a drop just under the threshold", () => {
    // 12 → 8.5 is 29.2% down. Warning fatigue is a real failure mode.
    const r = checkYieldPlausibility(8.5, { recentAverageL: 12 });
    expect(r.flagged).toBe(false);
  });

  it("flags a spike of 50% or more", () => {
    const r = checkYieldPlausibility(18, { recentAverageL: 12, animalName: "Wanjiku" });
    expect(r.flagged).toBe(true);
    expect(r.reason).toBe("SPIKE");
    expect(r.message).toContain("Wanjiku");
  });

  it("flags anything above the maximum plausible session yield", () => {
    const r = checkYieldPlausibility(120, { recentAverageL: 12, animalName: "Njeri" });
    expect(r.ok).toBe(true);
    expect(r.flagged).toBe(true);
    expect(r.reason).toBe("ABOVE_MAX");
    expect(r.message).toContain("Saved");
  });

  it("honours a farm-specific maximum", () => {
    expect(checkYieldPlausibility(30, { maxPlausibleL: 25 }).reason).toBe("ABOVE_MAX");
    expect(checkYieldPlausibility(30, { maxPlausibleL: 45 }).flagged).toBe(false);
  });

  it("refuses a negative yield — the one impossible number", () => {
    const r = checkYieldPlausibility(-3, { recentAverageL: 12 });
    expect(r.ok).toBe(false);
    expect(r.flagged).toBe(true);
    expect(r.reason).toBe("NEGATIVE");
  });

  it("has no opinion when there is no history to compare against", () => {
    expect(checkYieldPlausibility(2, { recentAverageL: null }).flagged).toBe(false);
    expect(checkYieldPlausibility(2, {}).flagged).toBe(false);
    expect(checkYieldPlausibility(2, { recentAverageL: 0 }).flagged).toBe(false);
  });

  it("accepts zero — a cow can genuinely give nothing", () => {
    const r = checkYieldPlausibility(0, { recentAverageL: 12 });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("DROP");
  });
});

describe("detectSustainedDrop", () => {
  it("finds three consecutive days more than 20% below baseline", () => {
    const r = detectSustainedDrop([9, 8.5, 8], 12);
    expect(r.dropping).toBe(true);
    expect(r.days).toBe(3);
    expect(r.pct).toBe(29);
  });

  it("ignores a single bad day", () => {
    expect(detectSustainedDrop([12, 12, 8], 12).dropping).toBe(false);
  });

  it("ignores a wobble that recovers", () => {
    expect(detectSustainedDrop([8, 12, 8], 12).dropping).toBe(false);
  });

  it("needs enough days before it says anything", () => {
    expect(detectSustainedDrop([8, 8], 12).dropping).toBe(false);
  });

  it("only looks at the most recent window", () => {
    const r = detectSustainedDrop([12, 12, 12, 8, 8, 8], 12);
    expect(r.dropping).toBe(true);
  });

  it("takes a custom window and threshold", () => {
    expect(detectSustainedDrop([11, 11], 12, { days: 2, thresholdPct: 5 }).dropping).toBe(true);
    expect(detectSustainedDrop([11, 11], 12, { days: 2, thresholdPct: 20 }).dropping).toBe(false);
  });

  it("says nothing when there is no baseline", () => {
    expect(detectSustainedDrop([0, 0, 0], 0).dropping).toBe(false);
  });
});

describe("reconcileDay", () => {
  const lines = [
    { channel: "COOP" as const, litres: 120 },
    { channel: "INSTITUTION" as const, litres: 40 },
    { channel: "HOUSEHOLD" as const, litres: 22 },
    { channel: "CALF_FEEDING" as const, litres: 4 },
    { channel: "HOME_CONSUMPTION" as const, litres: 1 },
  ];

  it("balances when every litre is accounted for", () => {
    const r = reconcileDay(187, lines);
    expect(r.disposedL).toBe(187);
    expect(r.varianceL).toBe(0);
    expect(r.balanced).toBe(true);
    expect(r.revenueL).toBe(182);
    expect(r.imputedL).toBe(5);
    expect(r.lossL).toBe(0);
    expect(r.message).toContain("Balanced");
  });

  it("names the gap when milk goes missing", () => {
    const r = reconcileDay(200, lines);
    expect(r.varianceL).toBe(13);
    expect(r.balanced).toBe(false);
    expect(r.message).toContain("unaccounted for");
  });

  it("names the opposite problem when more was sold than milked", () => {
    const r = reconcileDay(180, lines);
    expect(r.varianceL).toBe(-7);
    expect(r.balanced).toBe(false);
    expect(r.message).toContain("more was sold");
  });

  it("tolerates a splash either way", () => {
    expect(reconcileDay(187.4, lines).balanced).toBe(true);
    expect(reconcileDay(186.6, lines).balanced).toBe(true);
    expect(reconcileDay(187.6, lines).balanced).toBe(false);
  });

  it("counts withheld and spoiled milk as loss, not revenue", () => {
    const r = reconcileDay(30, [
      { channel: "COOP", litres: 20 },
      { channel: "WITHHELD_TREATMENT", litres: 6 },
      { channel: "SPOILAGE", litres: 4 },
    ]);
    expect(r.revenueL).toBe(20);
    expect(r.lossL).toBe(10);
    expect(r.balanced).toBe(true);
  });
});

describe("channel classification", () => {
  it("splits revenue, imputed and loss", () => {
    expect(isRevenueChannel("COOP")).toBe(true);
    expect(isRevenueChannel("MILK_ATM")).toBe(true);
    expect(isRevenueChannel("CALF_FEEDING")).toBe(false);
    expect(isImputedChannel("STAFF_RATION")).toBe(true);
    expect(isImputedChannel("HOME_CONSUMPTION")).toBe(true);
    expect(isLossChannel("WITHHELD_TREATMENT")).toBe(true);
    expect(isLossChannel("WITHHELD_COLOSTRUM")).toBe(true);
    expect(isLossChannel("HOUSEHOLD")).toBe(false);
  });
});

describe("blendedPricePerLitre", () => {
  it("blends only the channels that bring money in", () => {
    const r = blendedPricePerLitre([
      { channel: "COOP", litres: 120, valueKes: 6240 }, // 52
      { channel: "INSTITUTION", litres: 40, valueKes: 2400 }, // 60
      { channel: "HOUSEHOLD", litres: 22, valueKes: 1430 }, // 65
      { channel: "CALF_FEEDING", litres: 4, valueKes: 288 }, // excluded
      { channel: "SPOILAGE", litres: 3, valueKes: 0 }, // excluded
    ]);
    expect(r.revenueL).toBe(182);
    expect(r.revenueKes).toBe(10070);
    expect(r.blendedKes).toBe(55.33);
  });

  it("returns zero rather than dividing by nothing", () => {
    expect(blendedPricePerLitre([]).blendedKes).toBe(0);
    expect(blendedPricePerLitre([{ channel: "CALF_FEEDING", litres: 4, valueKes: 288 }]).blendedKes).toBe(0);
  });

  it("shows the co-op-only mix as the lowest blend", () => {
    const coopOnly = blendedPricePerLitre([{ channel: "COOP", litres: 182, valueKes: 9464 }]);
    const mixed = blendedPricePerLitre([
      { channel: "COOP", litres: 120, valueKes: 6240 },
      { channel: "HOUSEHOLD", litres: 62, valueKes: 4030 },
    ]);
    expect(mixed.blendedKes).toBeGreaterThan(coopOnly.blendedKes);
  });
});

describe("lossRatePct", () => {
  it("expresses loss as a share of production", () => {
    expect(lossRatePct(200, 10)).toBe(5);
    expect(lossRatePct(187, 6)).toBe(3.21);
  });

  it("does not divide by zero on a day with no milk", () => {
    expect(lossRatePct(0, 0)).toBe(0);
  });
});

describe("lactation shape", () => {
  it("knows when a cow is past peak", () => {
    expect(isPastPeak(45)).toBe(false);
    expect(isPastPeak(61)).toBe(true);
  });

  it("projects a 305-day yield conservatively from peak", () => {
    expect(project305FromPeak(20)).toBe(4000);
  });

  it("reports persistency as the share of peak held per month", () => {
    // 20 L peak, 18 L a month later — she is holding 90%.
    expect(persistencyPct(20, 18, 1)).toBe(90);
  });

  it("compounds across several months since peak", () => {
    // 0.9^3 = 0.729 of peak after three months is still 90% a month.
    expect(persistencyPct(20, 14.58, 3)).toBeCloseTo(90, 1);
  });

  it("flags the shape a manager should act on", () => {
    const good = persistencyPct(20, 19, 1);
    const bad = persistencyPct(20, 15, 1);
    expect(good).toBeGreaterThanOrEqual(92);
    expect(bad).toBeLessThan(88);
  });

  it("returns 100 rather than dividing by nothing", () => {
    expect(persistencyPct(0, 10, 2)).toBe(100);
    expect(persistencyPct(20, 18, 0)).toBe(100);
  });
});
