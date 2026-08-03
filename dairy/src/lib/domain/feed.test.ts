import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONCENTRATE_RULE,
  DEFAULT_UNIT_WEIGHT_KG,
  acidosisRisk,
  breakEvenWarning,
  concentrateForYield,
  dailyDmRequirementKg,
  dailyWaterRequirementL,
  daysOfCover,
  marginOverFeedCost,
  requiresExplicitWeight,
  stockBalanceKg,
} from "./feed";
import { toKg, costPerKg, costPerKgDm } from "../money";

/**
 * Feed domain rules. No database — these are the arithmetic the whole cost side
 * of the system rests on, so they are tested against Kenyan numbers rather than
 * round ones.
 */

/* ---------------------------------------------------------------- */
/* Units — where cost accuracy is won or lost                        */
/* ---------------------------------------------------------------- */

describe("toKg with different unit weights", () => {
  it("weighs a 70 kg bag and a 50 kg bag differently", () => {
    expect(toKg(8, 70)).toBe(560);
    expect(toKg(8, 50)).toBe(400);
  });

  it("gives a different answer for the same 10 bales at 12, 15 and 25 kg", () => {
    // The whole reason a bale may not be stored without its weight: a Kenyan
    // Boma Rhodes bale is quoted anywhere in this range.
    expect(toKg(10, 12)).toBe(120);
    expect(toKg(10, DEFAULT_UNIT_WEIGHT_KG.BALE!)).toBe(150);
    expect(toKg(10, 25)).toBe(250);
  });

  it("accepts the numeric strings Drizzle returns", () => {
    expect(toKg("3.500", "70.000")).toBe(245);
  });

  it("carries the error straight into cost per kilo", () => {
    // 10 bales at KES 300 = KES 3,000.
    const assumed15 = costPerKg(3000, toKg(10, 15)); // 20.00/kg
    const actual25 = costPerKg(3000, toKg(10, 25)); // 12.00/kg
    expect(assumed15).toBe(20);
    expect(actual25).toBe(12);
    // A 67% error in the cost of the bulk of the ration.
    expect(assumed15 / actual25).toBeCloseTo(1.667, 2);
  });

  it("converts as-fed cost to cost per kg of dry matter", () => {
    // Dairy meal at KES 47/kg and 88% DM.
    expect(costPerKgDm(47, 88)).toBe(53.41);
  });

  it("names the units we refuse to guess at", () => {
    expect(requiresExplicitWeight("BALE")).toBe(true);
    expect(requiresExplicitWeight("HEADLOAD")).toBe(true);
    expect(requiresExplicitWeight("WHEELBARROW")).toBe(true);
    expect(requiresExplicitWeight("PICKUP_LOAD")).toBe(true);
    expect(requiresExplicitWeight("BAG_70KG")).toBe(false);
    expect(requiresExplicitWeight("KG")).toBe(false);
    expect(requiresExplicitWeight("TONNE")).toBe(false);
  });
});

/* ---------------------------------------------------------------- */
/* Stock                                                             */
/* ---------------------------------------------------------------- */

describe("stockBalanceKg", () => {
  it("is purchases in minus issues out, in kilograms", () => {
    const purchases = [
      { quantity: 10, unitWeightKg: 70 }, // 700 kg dairy meal
      { quantity: 4, unitWeightKg: 70 }, // 280 kg
    ];
    const issues = [
      { quantity: 0.5, unitWeightKg: 70 }, // 35 kg
      { quantity: 1, unitWeightKg: 70 }, // 70 kg
    ];
    expect(stockBalanceKg(purchases, issues)).toBe(875);
  });

  it("mixes units correctly — a tonne bought, headloads issued", () => {
    const balance = stockBalanceKg(
      [{ quantity: 1, unitWeightKg: 1000 }],
      [{ quantity: 12, unitWeightKg: 20 }],
    );
    expect(balance).toBe(760);
  });

  it("is zero on an empty store and can go negative when issues outrun records", () => {
    expect(stockBalanceKg([], [])).toBe(0);
    // Never hidden: a negative balance is the signal that a purchase was missed.
    expect(stockBalanceKg([], [{ quantity: 2, unitWeightKg: 70 }])).toBe(-140);
  });

  it("works on the strings Drizzle hands back", () => {
    expect(stockBalanceKg([{ quantity: "10.000", unitWeightKg: "70.000" }], [])).toBe(700);
  });
});

/* ---------------------------------------------------------------- */
/* Days of cover                                                     */
/* ---------------------------------------------------------------- */

describe("daysOfCover", () => {
  it("says plenty when there is plenty", () => {
    // 875 kg left, 35 kg/day.
    const r = daysOfCover(875, 245, 7);
    expect(r.dailyBurnKg).toBe(35);
    expect(r.daysOfCover).toBe(25);
    expect(r.message).toBe("25 days of cover.");
  });

  it("says order this week between four and seven days", () => {
    const r = daysOfCover(210, 245, 7); // 35 kg/day → 6 days
    expect(r.daysOfCover).toBe(6);
    expect(r.message).toBe("6 days left — order this week.");
  });

  it("says order today at three days or fewer", () => {
    const r = daysOfCover(105, 245, 7); // 3 days
    expect(r.daysOfCover).toBe(3);
    expect(r.message).toBe("3 days left — order today.");
  });

  it("says day, singular, at one day", () => {
    const r = daysOfCover(35, 245, 7);
    expect(r.daysOfCover).toBe(1);
    expect(r.message).toBe("1 day left — order today.");
  });

  it("says out of stock when the balance will not cover a day", () => {
    expect(daysOfCover(20, 245, 7).message).toBe("Out of stock.");
    expect(daysOfCover(0, 245, 7).message).toBe("Out of stock.");
    expect(daysOfCover(-40, 245, 7).message).toBe("Out of stock.");
  });

  it("does not divide by zero when nothing has been issued", () => {
    const r = daysOfCover(500, 0, 7);
    expect(r.daysOfCover).toBeNull();
    expect(r.dailyBurnKg).toBe(0);
    expect(r.message).toBe("Not being used at the moment.");
  });

  it("does not divide by zero on a zero-day period", () => {
    const r = daysOfCover(500, 100, 0);
    expect(r.daysOfCover).toBeNull();
    expect(r.dailyBurnKg).toBe(0);
  });
});

/* ---------------------------------------------------------------- */
/* Challenge feeding                                                 */
/* ---------------------------------------------------------------- */

describe("concentrateForYield", () => {
  it("gives no concentrate at or below the 8-litre forage baseline", () => {
    for (const yieldL of [0, 4, 8]) {
      const a = concentrateForYield(yieldL);
      expect(a.kgPerDay).toBe(0);
      expect(a.note).toContain("Forage alone covers up to 8 litres");
    }
  });

  it("gives 1 kg per extra 1.5 litres above the baseline", () => {
    // 14 L → 6 L above baseline → 4 kg.
    const a = concentrateForYield(14);
    expect(a.kgPerDay).toBe(4);
  });

  it("splits into at least two feeds even when one would do", () => {
    // 4 kg would fit the 4 kg-per-feed cap in one go, but concentrate is never
    // fed as a single slug.
    const a = concentrateForYield(14);
    expect(a.feedsPerDay).toBe(2);
    expect(a.kgPerFeed).toBe(2);
    expect(a.note).toContain("Never more than 4 kg in one feed");
  });

  it("adds feeds rather than exceeding 4 kg in one — the acidosis guard", () => {
    // 26 L → 18 L above baseline → 12 kg a day.
    const a = concentrateForYield(26);
    expect(a.kgPerDay).toBe(12);
    expect(a.feedsPerDay).toBe(3);
    expect(a.kgPerFeed).toBe(4);
    expect(a.kgPerFeed).toBeLessThanOrEqual(DEFAULT_CONCENTRATE_RULE.maxKgPerFeed);
  });

  it("honours a farm that uses 1 kg per 2 litres instead", () => {
    const a = concentrateForYield(20, { baselineLitres: 8, litresPerKgConcentrate: 2, maxKgPerFeed: 4 });
    expect(a.kgPerDay).toBe(6);
    expect(a.feedsPerDay).toBe(2);
    expect(a.kgPerFeed).toBe(3);
  });

  it("honours a farm that starts concentrate at 10 litres", () => {
    const a = concentrateForYield(16, { baselineLitres: 10, litresPerKgConcentrate: 3, maxKgPerFeed: 4 });
    expect(a.kgPerDay).toBe(2);
  });

  it("never goes negative on a cow below the baseline", () => {
    expect(concentrateForYield(2).kgPerDay).toBe(0);
    expect(concentrateForYield(0).kgPerDay).toBe(0);
  });
});

/* ---------------------------------------------------------------- */
/* Acidosis                                                          */
/* ---------------------------------------------------------------- */

describe("acidosisRisk", () => {
  it("is quiet at the 70:30 Kenyan guideline", () => {
    expect(acidosisRisk(30).risk).toBe(false);
    expect(acidosisRisk(30).message).toBeUndefined();
  });

  it("is quiet right up to 55% of dry matter", () => {
    expect(acidosisRisk(55).risk).toBe(false);
  });

  it("warns above 55% and says what to do about it", () => {
    const r = acidosisRisk(62);
    expect(r.risk).toBe(true);
    expect(r.message).toContain("62%");
    expect(r.message).toContain("add forage");
  });

  it("is quiet on a forage-only ration", () => {
    expect(acidosisRisk(0).risk).toBe(false);
  });
});

/* ---------------------------------------------------------------- */
/* Intake and water                                                  */
/* ---------------------------------------------------------------- */

describe("dailyDmRequirementKg", () => {
  it("gives 15 kg DM for a 500 kg lactating cow — the Kenyan 3% rule", () => {
    expect(dailyDmRequirementKg(500, "LACTATING")).toBe(15);
  });

  it("drops to 2% for a dry cow", () => {
    expect(dailyDmRequirementKg(500, "DRY")).toBe(10);
  });

  it("uses 2.5% for heifers and calves", () => {
    expect(dailyDmRequirementKg(300, "HEIFERS")).toBe(7.5);
    expect(dailyDmRequirementKg(150, "CALVES")).toBe(3.75);
  });

  it("uses 2.25% for bulls and 2.75% for a mixed group", () => {
    expect(dailyDmRequirementKg(800, "BULLS")).toBe(18);
    expect(dailyDmRequirementKg(400, "ALL")).toBe(11);
  });
});

describe("dailyWaterRequirementL", () => {
  it("puts a 500 kg cow giving 20 litres inside the 60–100 L Kenyan band", () => {
    const l = dailyWaterRequirementL(500, 20);
    expect(l).toBe(130);
    expect(l).toBeGreaterThan(60);
  });

  it("still needs maintenance water when she is dry", () => {
    expect(dailyWaterRequirementL(500, 0)).toBe(40);
  });

  it("adds 4.5 litres of water for every litre of milk", () => {
    const at10 = dailyWaterRequirementL(450, 10);
    const at20 = dailyWaterRequirementL(450, 20);
    expect(at20 - at10).toBe(45);
  });
});

/* ---------------------------------------------------------------- */
/* MARGIN OVER FEED COST — the headline number                       */
/* ---------------------------------------------------------------- */

describe("marginOverFeedCost", () => {
  it("computes the blueprint's example — KES 14.20 a litre", () => {
    // 1,000 litres at KES 48.00 against KES 33,800 of feed.
    const m = marginOverFeedCost(48_000, 33_800, 1000);
    expect(m.revenuePerLitre).toBe(48);
    expect(m.feedCostPerLitre).toBe(33.8);
    expect(m.marginPerLitre).toBe(14.2);
    expect(m.marginKes).toBe(14_200);
    expect(m.message).toBe(
      "KES 14.20 a litre after feed — milk at KES 48.00 less feed at KES 33.80.",
    );
  });

  it("states the loss plainly when feed costs more than the milk earns", () => {
    // 600 L sold at KES 42 against KES 27,000 of feed — a real dry-season month.
    const m = marginOverFeedCost(25_200, 27_000, 600);
    expect(m.marginPerLitre).toBeLessThan(0);
    expect(m.marginKes).toBe(-1800);
    expect(m.message).toContain("costing more in feed than it earns");
    expect(m.message).toContain("KES 45.00");
    expect(m.message).toContain("KES 42.00");
  });

  it("treats exactly break-even as making no margin", () => {
    const m = marginOverFeedCost(30_000, 30_000, 1000);
    expect(m.marginPerLitre).toBe(0);
    expect(m.message).toContain("costing more in feed than it earns");
  });

  it("does not divide by zero when no milk was recorded", () => {
    const m = marginOverFeedCost(0, 12_000, 0);
    expect(m.revenuePerLitre).toBe(0);
    expect(m.feedCostPerLitre).toBe(0);
    expect(m.marginPerLitre).toBe(0);
    expect(m.marginKes).toBe(-12_000);
    expect(m.message).toBe("No milk recorded for this period.");
  });

  it("still reports a margin when there is no feed cost on file", () => {
    const m = marginOverFeedCost(48_000, 0, 1000);
    expect(m.feedCostPerLitre).toBe(0);
    expect(m.marginPerLitre).toBe(48);
  });

  it("accepts numeric strings from the database", () => {
    const m = marginOverFeedCost("48000.00" as unknown as number, "33800.00" as unknown as number, "1000.00" as unknown as number);
    expect(m.marginPerLitre).toBe(14.2);
  });

  it("rounds to cents rather than drifting", () => {
    const m = marginOverFeedCost(1234.56, 789.01, 33);
    expect(m.revenuePerLitre).toBe(37.41);
    expect(m.feedCostPerLitre).toBe(23.91);
    expect(m.marginPerLitre).toBe(13.5);
  });
});

/* ---------------------------------------------------------------- */
/* Break-even                                                        */
/* ---------------------------------------------------------------- */

describe("breakEvenWarning", () => {
  it("says nothing at a healthy farm-gate price", () => {
    expect(breakEvenWarning(52)).toBeNull();
    expect(breakEvenWarning(37)).toBeNull();
  });

  it("warns that the margin is thin inside the cost-of-production range", () => {
    const w = breakEvenWarning(34);
    expect(w).toContain("inside the cost-of-production range");
    expect(w).toContain("KES 30–37");
  });

  it("says the sale loses money below the bottom of the range", () => {
    const w = breakEvenWarning(28);
    expect(w).toContain("This sale loses money");
  });

  it("treats the boundaries as inclusive at the top and exclusive at the bottom", () => {
    expect(breakEvenWarning(30)).toContain("inside the cost-of-production range");
    expect(breakEvenWarning(29.99)).toContain("loses money");
  });
});
