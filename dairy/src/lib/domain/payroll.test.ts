import { describe, it, expect } from "vitest";
import {
  KENYA_RATES_2026,
  AGRICULTURAL_MINIMUM_WAGE_2026,
  computePaye,
  computeNssf,
  computeShif,
  computeHousingLevy,
  computePayslip,
  leaveAccruedDays,
  checkCasualConversion,
  minimumWageCheck,
  CASUAL_CONVERSION_DAYS,
  ANNUAL_LEAVE_DAYS_PER_YEAR,
  LEAVE_ACCRUAL_PER_MONTH,
  REMITTANCE_DUE_DAY,
  type PayrollRates,
} from "./payroll";

const R = KENYA_RATES_2026;

/* ------------------------------------------------------------------ */
/* PAYE — every band boundary                                          */
/* ------------------------------------------------------------------ */

describe("computePaye", () => {
  it("is zero on zero and negative taxable pay", () => {
    expect(computePaye(0, R)).toBe(0);
    expect(computePaye(-500, R)).toBe(0);
  });

  it("charges 10% inside the first band", () => {
    expect(computePaye(10_000, R)).toBe(1_000);
    expect(computePaye(1, R)).toBeCloseTo(0.1, 2);
  });

  it("hits exactly 2,400 at the top of the first band (24,000)", () => {
    // The number that makes the herdsman case work: PAYE at the top of band 1
    // is precisely the personal relief.
    expect(computePaye(24_000, R)).toBe(2_400);
  });

  it("steps to 25% one shilling above 24,000", () => {
    expect(computePaye(24_001, R)).toBeCloseTo(2_400.25, 2);
  });

  it("is correct at the top of the 25% band (32,333)", () => {
    // 2,400 + 8,333 × 0.25
    expect(computePaye(32_333, R)).toBeCloseTo(4_483.25, 2);
  });

  it("steps to 30% above 32,333", () => {
    expect(computePaye(32_334, R)).toBeCloseTo(4_483.55, 2);
  });

  it("is correct at the top of the 30% band (500,000)", () => {
    // 4,483.25 + 467,667 × 0.30
    expect(computePaye(500_000, R)).toBeCloseTo(144_783.35, 2);
  });

  it("is correct at the top of the 32.5% band (800,000)", () => {
    // 144,783.35 + 300,000 × 0.325
    expect(computePaye(800_000, R)).toBeCloseTo(242_283.35, 2);
  });

  it("charges 35% on everything above 800,000", () => {
    // 242,283.35 + 200,000 × 0.35
    expect(computePaye(1_000_000, R)).toBeCloseTo(312_283.35, 2);
  });

  it("is monotonic across the whole range", () => {
    let previous = -1;
    for (const pay of [0, 1_000, 24_000, 24_001, 32_333, 32_334, 100_000, 500_000, 800_000, 900_000]) {
      const tax = computePaye(pay, R);
      expect(tax).toBeGreaterThan(previous);
      previous = tax;
    }
  });
});

/* ------------------------------------------------------------------ */
/* NSSF — both tiers and both caps                                     */
/* ------------------------------------------------------------------ */

describe("computeNssf", () => {
  it("charges 6% of pay below the lower earnings limit, all in tier 1", () => {
    const n = computeNssf(5_000, R);
    expect(n.tier1).toBe(300);
    expect(n.tier2).toBe(0);
    expect(n.total).toBe(300);
  });

  it("caps tier 1 at KES 540 — 6% of the 9,000 LEL", () => {
    expect(computeNssf(9_000, R).tier1).toBe(540);
    expect(computeNssf(12_000, R).tier1).toBe(540);
    expect(computeNssf(2_000_000, R).tier1).toBe(540);
  });

  it("charges tier 2 on the slice between LEL and UEL", () => {
    // 12,000 - 9,000 = 3,000 at 6%
    expect(computeNssf(12_000, R).tier2).toBe(180);
    expect(computeNssf(12_000, R).total).toBe(720);
  });

  it("caps tier 2 at KES 5,940 — 6% of the 99,000 band up to the 108,000 UEL", () => {
    expect(computeNssf(108_000, R).tier2).toBe(5_940);
    expect(computeNssf(500_000, R).tier2).toBe(5_940);
  });

  it("caps the combined deduction at KES 6,480", () => {
    expect(computeNssf(108_000, R).total).toBe(6_480);
    expect(computeNssf(1_000_000, R).total).toBe(6_480);
  });

  it("is zero on zero pay", () => {
    expect(computeNssf(0, R).total).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* SHIF and the Housing Levy                                           */
/* ------------------------------------------------------------------ */

describe("computeShif", () => {
  it("applies the KES 300 minimum below the crossover", () => {
    expect(computeShif(0, R)).toBe(300);
    expect(computeShif(5_000, R)).toBe(300);
    // 2.75% of 10,909 is just under 300
    expect(computeShif(10_000, R)).toBe(300);
  });

  it("crosses over to 2.75% of gross at about KES 10,909", () => {
    expect(computeShif(10_909, R)).toBe(300);
    expect(computeShif(11_000, R)).toBeCloseTo(302.5, 2);
  });

  it("has no upper cap", () => {
    expect(computeShif(500_000, R)).toBe(13_750);
  });
});

describe("computeHousingLevy", () => {
  it("is a flat 1.5% of gross with no floor and no cap", () => {
    expect(computeHousingLevy(0, R)).toBe(0);
    expect(computeHousingLevy(12_000, R)).toBe(180);
    expect(computeHousingLevy(1_000_000, R)).toBe(15_000);
  });
});

/* ------------------------------------------------------------------ */
/* THE CASE THAT MATTERS: the herdsman on KES 12,000                   */
/* ------------------------------------------------------------------ */

describe("the KES 12,000 herdsman — zero PAYE, everything else due", () => {
  const slip = computePayslip({
    basicKes: 12_000,
    housingProvided: true,
    wagePeriod: "MONTHLY",
  });

  it("pays no PAYE at all", () => {
    expect(slip.payeKes).toBe(0);
  });

  it("still owes NSSF of KES 720 — 540 tier 1 plus 180 tier 2", () => {
    expect(slip.nssfTier1Kes).toBe(540);
    expect(slip.nssfTier2Kes).toBe(180);
    expect(slip.nssfTotalKes).toBe(720);
  });

  it("still owes SHIF of KES 330 — 2.75% of gross, above the 300 minimum", () => {
    expect(slip.shifKes).toBe(330);
  });

  it("still owes the Housing Levy of KES 180", () => {
    expect(slip.housingLevyKes).toBe(180);
  });

  it("has no housing allowance, because the farm houses him", () => {
    expect(slip.housingAllowKes).toBe(0);
    expect(slip.grossKes).toBe(12_000);
  });

  it("computes taxable pay of 10,770 after statutory deductions", () => {
    expect(slip.taxableKes).toBe(10_770);
  });

  it("computes PAYE before relief of 1,077, wiped out by the 2,400 relief", () => {
    expect(slip.payeBeforeReliefKes).toBe(1_077);
    expect(slip.personalReliefKes).toBe(2_400);
    // The relief is a floor at zero, never a refund.
    expect(slip.payeKes).toBe(0);
  });

  it("nets KES 10,770 in his hand", () => {
    expect(slip.totalDeductionsKes).toBe(1_230);
    expect(slip.netKes).toBe(10_770);
  });

  it("costs the farm KES 12,900 once the employer share is counted", () => {
    expect(slip.employerNssfKes).toBe(720);
    expect(slip.employerHousingLevyKes).toBe(180);
    // Employer SHIF defaults to zero — the rate is disputed, so we do not invent it.
    expect(slip.employerShifKes).toBe(0);
    expect(slip.employerTotalKes).toBe(900);
    expect(slip.costToFarmKes).toBe(12_900);
  });

  it("adds the milk ration to the farm's cost without touching his net", () => {
    const withRation = computePayslip({
      basicKes: 12_000,
      housingProvided: true,
      wagePeriod: "MONTHLY",
      milkRationKes: 2_000,
    });
    expect(withRation.netKes).toBe(10_770);
    expect(withRation.costToFarmKes).toBe(14_900);
  });

  it("recovers an advance from net without changing tax or statutory dues", () => {
    const withAdvance = computePayslip({
      basicKes: 12_000,
      housingProvided: true,
      wagePeriod: "MONTHLY",
      advancesKes: 3_000,
    });
    expect(withAdvance.payeKes).toBe(0);
    expect(withAdvance.nssfTotalKes).toBe(720);
    expect(withAdvance.netKes).toBe(7_770);
  });
});

/* ------------------------------------------------------------------ */
/* Housing allowance, daily casuals, high earners                      */
/* ------------------------------------------------------------------ */

describe("housing allowance when accommodation is not provided", () => {
  it("adds 15% of basic to gross", () => {
    const slip = computePayslip({
      basicKes: 12_000,
      housingProvided: false,
      wagePeriod: "MONTHLY",
    });
    expect(slip.housingAllowKes).toBe(1_800);
    expect(slip.grossKes).toBe(13_800);
  });

  it("raises every statutory deduction, because they all key off gross", () => {
    const housed = computePayslip({ basicKes: 12_000, housingProvided: true, wagePeriod: "MONTHLY" });
    const unhoused = computePayslip({ basicKes: 12_000, housingProvided: false, wagePeriod: "MONTHLY" });
    expect(unhoused.nssfTier2Kes).toBeGreaterThan(housed.nssfTier2Kes);
    expect(unhoused.shifKes).toBeGreaterThan(housed.shifKes);
    expect(unhoused.housingLevyKes).toBeGreaterThan(housed.housingLevyKes);
    // Still no PAYE — this is a low-wage worker either way.
    expect(unhoused.payeKes).toBe(0);
  });

  it("leaves him better off in the hand despite the bigger deductions", () => {
    const housed = computePayslip({ basicKes: 12_000, housingProvided: true, wagePeriod: "MONTHLY" });
    const unhoused = computePayslip({ basicKes: 12_000, housingProvided: false, wagePeriod: "MONTHLY" });
    expect(unhoused.netKes).toBeGreaterThan(housed.netKes);
  });
});

describe("a daily-wage casual (kibarua)", () => {
  it("multiplies the daily rate by days worked", () => {
    const slip = computePayslip({
      basicKes: 500,
      daysWorked: 26,
      housingProvided: true,
      wagePeriod: "DAILY",
    });
    expect(slip.basicKes).toBe(13_000);
    expect(slip.grossKes).toBe(13_000);
  });

  it("owes NSSF, SHIF and the Housing Levy exactly as a permanent worker does", () => {
    const slip = computePayslip({
      basicKes: 500,
      daysWorked: 26,
      housingProvided: true,
      wagePeriod: "DAILY",
    });
    expect(slip.nssfTotalKes).toBe(780); // 540 + 4,000 × 6%
    expect(slip.shifKes).toBeCloseTo(357.5, 2);
    expect(slip.housingLevyKes).toBe(195);
    expect(slip.payeKes).toBe(0);
  });

  it("earns nothing for a month with no days worked", () => {
    const slip = computePayslip({
      basicKes: 500,
      daysWorked: 0,
      housingProvided: true,
      wagePeriod: "DAILY",
    });
    expect(slip.grossKes).toBe(0);
    // SHIF keeps its floor even on a zero gross — that floor is not pro-rated.
    expect(slip.shifKes).toBe(300);
    expect(slip.netKes).toBe(-300);
  });

  it("adds the 15% housing allowance for a casual sleeping off the farm", () => {
    const slip = computePayslip({
      basicKes: 500,
      daysWorked: 26,
      housingProvided: false,
      wagePeriod: "DAILY",
    });
    expect(slip.basicKes).toBe(13_000);
    expect(slip.housingAllowKes).toBe(1_950);
    expect(slip.grossKes).toBe(14_950);
  });
});

describe("a high earner — the farm manager on KES 150,000", () => {
  const slip = computePayslip({
    basicKes: 150_000,
    housingProvided: true,
    wagePeriod: "MONTHLY",
  });

  it("hits both NSSF caps", () => {
    expect(slip.nssfTier1Kes).toBe(540);
    expect(slip.nssfTier2Kes).toBe(5_940);
    expect(slip.nssfTotalKes).toBe(6_480);
  });

  it("pays uncapped SHIF and Housing Levy", () => {
    expect(slip.shifKes).toBe(4_125);
    expect(slip.housingLevyKes).toBe(2_250);
  });

  it("pays real PAYE across three bands", () => {
    expect(slip.taxableKes).toBe(137_145);
    expect(slip.payeBeforeReliefKes).toBeCloseTo(35_926.85, 2);
    expect(slip.payeKes).toBeCloseTo(33_526.85, 2);
  });

  it("nets what is left after every deduction", () => {
    expect(slip.netKes).toBeCloseTo(
      150_000 - 6_480 - 4_125 - 2_250 - 33_526.85,
      2,
    );
  });
});

describe("PayrollRates is fully overridable — nothing is baked in", () => {
  it("honours a different personal relief", () => {
    const generous: PayrollRates = { ...R, personalReliefKes: 0 };
    const slip = computePayslip({ basicKes: 12_000, housingProvided: true, wagePeriod: "MONTHLY" }, generous);
    // With no relief the herdsman would owe tax. This is why the relief matters.
    expect(slip.payeKes).toBe(1_077);
  });

  it("honours a non-zero employer SHIF rate once SHA confirms one", () => {
    const withEmployerShif: PayrollRates = { ...R, shif: { ...R.shif, employerRate: 0.01375 } };
    const slip = computePayslip({ basicKes: 12_000, housingProvided: true, wagePeriod: "MONTHLY" }, withEmployerShif);
    expect(slip.employerShifKes).toBe(165);
    expect(slip.costToFarmKes).toBe(13_065);
  });

  it("honours taxing gross directly when statutory deductions are not allowable", () => {
    const grossBasis: PayrollRates = { ...R, deductStatutoryBeforePaye: false };
    const slip = computePayslip({ basicKes: 12_000, housingProvided: true, wagePeriod: "MONTHLY" }, grossBasis);
    expect(slip.taxableKes).toBe(12_000);
    expect(slip.payeBeforeReliefKes).toBe(1_200);
    expect(slip.payeKes).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Employment Act — leave accrual                                      */
/* ------------------------------------------------------------------ */

describe("leaveAccruedDays", () => {
  it("accrues 1.75 days a month", () => {
    expect(LEAVE_ACCRUAL_PER_MONTH).toBe(1.75);
    expect(leaveAccruedDays(1)).toBe(1.75);
    expect(leaveAccruedDays(6)).toBe(10.5);
  });

  it("reaches the statutory 21 days after twelve months", () => {
    expect(ANNUAL_LEAVE_DAYS_PER_YEAR).toBe(21);
    expect(leaveAccruedDays(12)).toBe(21);
  });

  it("keeps accruing beyond a year", () => {
    expect(leaveAccruedDays(24)).toBe(42);
  });

  it("is zero on the first day", () => {
    expect(leaveAccruedDays(0)).toBe(0);
  });

  it("rounds part-months to the cent, not to a whole day", () => {
    expect(leaveAccruedDays(2.5)).toBe(4.38);
  });
});

/* ------------------------------------------------------------------ */
/* Employment Act — the casual conversion trap                         */
/* ------------------------------------------------------------------ */

describe("checkCasualConversion", () => {
  it("stays quiet early in an engagement", () => {
    const r = checkCasualConversion(10, "Otieno");
    expect(r.warn).toBe(false);
    expect(r.converted).toBe(false);
    expect(r.message).toBeUndefined();
  });

  it("warns at 25 days, five days before the threshold", () => {
    const r = checkCasualConversion(25, "Otieno");
    expect(r.warn).toBe(true);
    expect(r.converted).toBe(false);
    expect(r.daysWorked).toBe(25);
    expect(r.message).toContain("day 25");
    expect(r.message).toContain("term employee");
  });

  it("still warns without converting at exactly 30 days", () => {
    // Conversion is "more than one month", so day 30 is the last day as a casual.
    expect(CASUAL_CONVERSION_DAYS).toBe(30);
    const r = checkCasualConversion(30, "Otieno");
    expect(r.warn).toBe(true);
    expect(r.converted).toBe(false);
  });

  it("converts at 31 days — by operation of law, not by our choice", () => {
    const r = checkCasualConversion(31, "Otieno");
    expect(r.converted).toBe(true);
  });

  it("reports a long-running casual at 45 days as already converted", () => {
    const r = checkCasualConversion(45, "Otieno");
    expect(r.warn).toBe(true);
    expect(r.converted).toBe(true);
    expect(r.daysWorked).toBe(45);
    expect(r.message).toContain("no longer a casual");
    expect(r.message).toContain("Otieno");
  });

  it("falls back to a neutral name when we do not have one", () => {
    expect(checkCasualConversion(45).message).toContain("This worker");
  });

  it("writes the warning in words a farm manager can act on", () => {
    const r = checkCasualConversion(45, "Otieno");
    // No codes, no jargon — the message names the entitlements that just attached.
    expect(r.message).toMatch(/leave/i);
    expect(r.message).toMatch(/notice/i);
  });
});

/* ------------------------------------------------------------------ */
/* Minimum wage — a reference, never a rule                            */
/* ------------------------------------------------------------------ */

describe("minimumWageCheck", () => {
  it("flags a herdsman on 8,000 as below the gazetted minimum", () => {
    const r = minimumWageCheck("HERDSMAN", 8_000);
    expect(r.below).toBe(true);
    expect(r.minimumKes).toBe(AGRICULTURAL_MINIMUM_WAGE_2026.HERDSMAN.monthly);
    expect(r.message).toContain("below it");
  });

  it("clears a herdsman on 12,000", () => {
    const r = minimumWageCheck("HERDSMAN", 12_000);
    expect(r.below).toBe(false);
    expect(r.minimumKes).toBe(10_621.15);
  });

  it("matches roles written with spaces and mixed case", () => {
    expect(minimumWageCheck("farm foreman", 20_000).below).toBe(true);
    expect(minimumWageCheck("Farm Clerk", 30_000).below).toBe(false);
  });

  it("says nothing about a role with no gazetted rate", () => {
    const r = minimumWageCheck("TRACTOR_DRIVER", 5_000);
    expect(r.below).toBe(false);
    expect(r.minimumKes).toBeUndefined();
  });

  it("REPORTS rather than blocks — it returns a message, it does not throw", () => {
    // A system that refuses to record a real KES 8,000 wage stops being used.
    expect(() => minimumWageCheck("UNSKILLED", 1)).not.toThrow();
    expect(minimumWageCheck("UNSKILLED", 1).below).toBe(true);
  });

  it("carries the disputed flag on the stockman/herdsman/watchman row", () => {
    // The gazette's monthly and daily columns do not reconcile; we keep the
    // doubt visible rather than silently picking one.
    expect(AGRICULTURAL_MINIMUM_WAGE_2026.HERDSMAN.disputed).toBe(true);
    expect(AGRICULTURAL_MINIMUM_WAGE_2026.STOCKMAN.disputed).toBe(true);
    expect(AGRICULTURAL_MINIMUM_WAGE_2026.WATCHMAN.disputed).toBe(true);
  });
});

describe("remittance deadline", () => {
  it("is the 9th of the following month for every statutory head", () => {
    expect(REMITTANCE_DUE_DAY).toBe(9);
  });
});
