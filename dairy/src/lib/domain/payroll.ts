/**
 * Kenyan payroll.
 *
 * The common case on a dairy farm is a herdsman on KES 12,000 a month who owes
 * NO PAYE at all — his tax falls below the personal relief — but still owes
 * NSSF, SHIF and the Housing Levy. Getting that case right matters more than
 * getting the top band right, because it is the only case most farms will ever
 * run.
 *
 * ⚠ Several figures here are flagged for verification in
 * docs/dairy/08-open-questions.md — notably the 2026 agricultural minimum wage
 * table (whose monthly and daily columns are mutually inconsistent in every
 * secondary source) and the SHIF employer contribution. Every rate below is
 * overridable via `PayrollRates` so nothing is baked in.
 */
import { money } from "../money";

export interface PayrollRates {
  /** PAYE bands as [upperBoundOfBandMonthly, rate]. Last band is unbounded. */
  payeBands: Array<{ upTo: number | null; rate: number }>;
  personalReliefKes: number;
  nssf: { lowerEarningsLimit: number; upperEarningsLimit: number; rate: number };
  shif: { rate: number; minimumKes: number; employerRate: number };
  housingLevy: { rate: number; employerRate: number };
  /** Housing allowance where the employer does not provide accommodation. */
  housingAllowanceRate: number;
  /**
   * Whether NSSF, SHIF and the Housing Levy are deducted before PAYE is
   * computed. Kenyan treatment has moved on this; keep it switchable.
   */
  deductStatutoryBeforePaye: boolean;
}

/** Rates in force from February 2026, to the best of the sources available. */
export const KENYA_RATES_2026: PayrollRates = {
  payeBands: [
    { upTo: 24_000, rate: 0.10 },
    { upTo: 32_333, rate: 0.25 },
    { upTo: 500_000, rate: 0.30 },
    { upTo: 800_000, rate: 0.325 },
    { upTo: null, rate: 0.35 },
  ],
  personalReliefKes: 2_400,
  nssf: { lowerEarningsLimit: 9_000, upperEarningsLimit: 108_000, rate: 0.06 },
  // ⚠ employerRate is DISPUTED — sources conflict on whether employers owe an
  // extra 1.375% or merely remit the employee's 2.75%. Defaults to 0 so we do
  // not invent a cost; set it once SHA confirms.
  shif: { rate: 0.0275, minimumKes: 300, employerRate: 0 },
  housingLevy: { rate: 0.015, employerRate: 0.015 },
  housingAllowanceRate: 0.15,
  deductStatutoryBeforePaye: true,
};

/**
 * Gazetted agricultural minimum wages, from 1 May 2026.
 * ⚠ SHOWN AS A COMPLIANCE REFERENCE, NEVER ASSUMED AS THE WAGE. Actual dairy
 * wages are frequently below these, and a system that refuses to record reality
 * simply stops being used. The monthly figures in circulating sources do not
 * reconcile with the daily ones — see open question 1.
 */
export const AGRICULTURAL_MINIMUM_WAGE_2026 = {
  UNSKILLED: { monthly: 9_196.93, daily: 385.24 },
  STOCKMAN: { monthly: 10_621.15, daily: 449.81, disputed: true },
  HERDSMAN: { monthly: 10_621.15, daily: 449.81, disputed: true },
  WATCHMAN: { monthly: 10_621.15, daily: 449.81, disputed: true },
  HOUSE_SERVANT: { monthly: 10_498.82, daily: 399.77 },
  SENIOR_FOREMAN: { monthly: 20_740.61, daily: 455.70 },
  FARM_FOREMAN: { monthly: 26_591.20, daily: 701.11 },
  FARM_CLERK: { monthly: 26_591.20, daily: 701.11 },
} as const;

/* ---------------------------------------------------------------- */

export interface PayslipInput {
  basicKes: number;
  housingProvided: boolean;
  daysWorked?: number;
  wagePeriod: "MONTHLY" | "DAILY";
  advancesKes?: number;
  otherDeductionsKes?: number;
  /** Staff milk ration — a real labour cost in kind, valued at market price. */
  milkRationKes?: number;
}

export interface PayslipResult {
  basicKes: number;
  housingAllowKes: number;
  grossKes: number;
  nssfTier1Kes: number;
  nssfTier2Kes: number;
  nssfTotalKes: number;
  shifKes: number;
  housingLevyKes: number;
  taxableKes: number;
  payeBeforeReliefKes: number;
  personalReliefKes: number;
  payeKes: number;
  advancesKes: number;
  otherDeductionsKes: number;
  milkRationKes: number;
  totalDeductionsKes: number;
  netKes: number;
  employerNssfKes: number;
  employerShifKes: number;
  employerHousingLevyKes: number;
  employerTotalKes: number;
  costToFarmKes: number;
}

/** Progressive PAYE across the bands. */
export function computePaye(taxableKes: number, rates: PayrollRates): number {
  let remaining = taxableKes;
  let previousCap = 0;
  let tax = 0;

  for (const band of rates.payeBands) {
    if (remaining <= 0) break;
    const cap = band.upTo ?? Infinity;
    const width = cap - previousCap;
    const inBand = Math.min(remaining, width);
    tax += inBand * band.rate;
    remaining -= inBand;
    previousCap = cap;
  }
  return money(tax);
}

export function computeNssf(grossKes: number, rates: PayrollRates) {
  const { lowerEarningsLimit: lel, upperEarningsLimit: uel, rate } = rates.nssf;
  const tier1 = money(Math.min(grossKes, lel) * rate);
  const tier2 = money(Math.max(0, Math.min(grossKes, uel) - lel) * rate);
  return { tier1, tier2, total: money(tier1 + tier2) };
}

export function computeShif(grossKes: number, rates: PayrollRates): number {
  return money(Math.max(rates.shif.minimumKes, grossKes * rates.shif.rate));
}

export function computeHousingLevy(grossKes: number, rates: PayrollRates): number {
  return money(grossKes * rates.housingLevy.rate);
}

export function computePayslip(
  input: PayslipInput,
  rates: PayrollRates = KENYA_RATES_2026,
): PayslipResult {
  const basicKes =
    input.wagePeriod === "DAILY"
      ? money(input.basicKes * (input.daysWorked ?? 0))
      : money(input.basicKes);

  const housingAllowKes = input.housingProvided
    ? 0
    : money(basicKes * rates.housingAllowanceRate);

  const grossKes = money(basicKes + housingAllowKes);

  const nssf = computeNssf(grossKes, rates);
  const shifKes = computeShif(grossKes, rates);
  const housingLevyKes = computeHousingLevy(grossKes, rates);

  const taxableKes = rates.deductStatutoryBeforePaye
    ? money(Math.max(0, grossKes - nssf.total - shifKes - housingLevyKes))
    : grossKes;

  const payeBeforeReliefKes = computePaye(taxableKes, rates);
  // The relief is a floor at zero, not a refund. This is the herdsman's case.
  const payeKes = money(Math.max(0, payeBeforeReliefKes - rates.personalReliefKes));

  const advancesKes = money(input.advancesKes ?? 0);
  const otherDeductionsKes = money(input.otherDeductionsKes ?? 0);
  const milkRationKes = money(input.milkRationKes ?? 0);

  const totalDeductionsKes = money(
    nssf.total + shifKes + housingLevyKes + payeKes + advancesKes + otherDeductionsKes,
  );
  const netKes = money(grossKes - totalDeductionsKes);

  const employerNssfKes = nssf.total; // matched
  const employerShifKes = money(grossKes * rates.shif.employerRate);
  const employerHousingLevyKes = money(grossKes * rates.housingLevy.employerRate);
  const employerTotalKes = money(employerNssfKes + employerShifKes + employerHousingLevyKes);

  return {
    basicKes,
    housingAllowKes,
    grossKes,
    nssfTier1Kes: nssf.tier1,
    nssfTier2Kes: nssf.tier2,
    nssfTotalKes: nssf.total,
    shifKes,
    housingLevyKes,
    taxableKes,
    payeBeforeReliefKes,
    personalReliefKes: rates.personalReliefKes,
    payeKes,
    advancesKes,
    otherDeductionsKes,
    milkRationKes,
    totalDeductionsKes,
    netKes,
    employerNssfKes,
    employerShifKes,
    employerHousingLevyKes,
    employerTotalKes,
    // What the farm actually spends, including the ration in kind
    costToFarmKes: money(grossKes + employerTotalKes + milkRationKes),
  };
}

/* ---------------------------------------------------------------- */
/* Employment Act compliance                                         */
/* ---------------------------------------------------------------- */

/** Annual leave accrues at 21 working days per 12 months worked. */
export const ANNUAL_LEAVE_DAYS_PER_YEAR = 21;
export const LEAVE_ACCRUAL_PER_MONTH = ANNUAL_LEAVE_DAYS_PER_YEAR / 12;

export function leaveAccruedDays(monthsWorked: number): number {
  return money(monthsWorked * LEAVE_ACCRUAL_PER_MONTH);
}

/**
 * The casual-conversion trap. Under the Employment Act 2007 a casual who works
 * continuously for more than one month converts BY OPERATION OF LAW into a term
 * employee with full benefits. Most farms discover this at a tribunal, so the
 * system warns as the threshold approaches.
 */
export const CASUAL_CONVERSION_DAYS = 30;

export interface CasualWarning {
  warn: boolean;
  converted: boolean;
  daysWorked: number;
  message?: string;
}

export function checkCasualConversion(
  consecutiveDaysWorked: number,
  employeeName = "This worker",
): CasualWarning {
  if (consecutiveDaysWorked > CASUAL_CONVERSION_DAYS) {
    return {
      warn: true,
      converted: true,
      daysWorked: consecutiveDaysWorked,
      message: `${employeeName} has worked ${consecutiveDaysWorked} days without a break. In law they are no longer a casual — they are a term employee entitled to leave, sick pay and notice.`,
    };
  }
  if (consecutiveDaysWorked >= CASUAL_CONVERSION_DAYS - 5) {
    return {
      warn: true,
      converted: false,
      daysWorked: consecutiveDaysWorked,
      message: `${employeeName} is on day ${consecutiveDaysWorked} of continuous work. At ${CASUAL_CONVERSION_DAYS} days they become a term employee by law.`,
    };
  }
  return { warn: false, converted: false, daysWorked: consecutiveDaysWorked };
}

/** Statutory remittances are due by the 9th of the following month. */
export const REMITTANCE_DUE_DAY = 9;

export function minimumWageCheck(
  role: string,
  monthlyKes: number,
): { below: boolean; minimumKes?: number; message?: string } {
  const key = role.toUpperCase().replace(/\s+/g, "_") as keyof typeof AGRICULTURAL_MINIMUM_WAGE_2026;
  const ref = AGRICULTURAL_MINIMUM_WAGE_2026[key];
  if (!ref) return { below: false };
  if (monthlyKes < ref.monthly) {
    return {
      below: true,
      minimumKes: ref.monthly,
      message: `The gazetted minimum for this role is KES ${ref.monthly.toLocaleString()} a month. This is below it.`,
    };
  }
  return { below: false, minimumKes: ref.monthly };
}
