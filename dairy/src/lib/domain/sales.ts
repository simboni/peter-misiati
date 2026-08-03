/**
 * Sales, credit and the customer ledger.
 *
 * Direct sales carry the best price and the worst risk. An institutional
 * delivery creates a RECEIVABLE, not revenue — public-sector payment in Kenya
 * runs 30–90+ days — and if those two are conflated the farm's cash position is
 * overstated by a quarter's sales.
 */
import { agingBucket, addDays, daysBetween, isoWeekday, type AgingBucket, type ISODate } from "./dates";
import { money, num } from "../money";
import type { CustomerType, PaymentTerms } from "@/db/schema";

/* ---------------------------------------------------------------- */
/* Legality — a channel's lawfulness depends on where the farm is    */
/* ---------------------------------------------------------------- */

export interface SaleLegalityInput {
  farmAreaClass: "RURAL" | "URBAN";
  customerAreaClass: "RURAL" | "URBAN";
  customerType: CustomerType;
  pasteurised: boolean;
  fulfilment: "GATE_COLLECTION" | "DELIVERED";
  hasMilkTransportPermit: boolean;
}

export interface SaleLegality {
  allowed: boolean;
  warnings: string[];
  blockers: string[];
}

/**
 * The Dairy Industry Regulations 2021 permit raw milk to be sold direct to
 * neighbouring consumers in RURAL areas only; urban sale requires
 * pasteurisation. That makes location a legal determinant rather than a
 * preference, which is an unusual thing for software to model — so we model it
 * as data and surface it as guidance rather than silently permitting sales.
 *
 * ⚠ Flagged for verification against LN 16 and LN 22 of 2021 before this is
 * presented to any user as legal advice. See docs 08, open questions 15–17.
 */
export function checkSaleLegality(input: SaleLegalityInput): SaleLegality {
  const warnings: string[] = [];
  const blockers: string[] = [];

  if (!input.pasteurised) {
    if (input.customerAreaClass === "URBAN") {
      blockers.push(
        "Raw milk may only be sold direct to neighbouring consumers in rural areas. This customer is in an urban area, where the milk must be pasteurised first.",
      );
    }
    if (input.customerType === "INSTITUTION") {
      warnings.push(
        "Supplying raw milk to a school or hospital is unlikely to be lawful — institutional catering is where pasteurisation is enforced. Confirm with the Kenya Dairy Board before delivering.",
      );
    }
  }

  if (input.fulfilment === "DELIVERED" && !input.hasMilkTransportPermit) {
    warnings.push(
      "Delivering milk in the farm's own vehicle needs a milk carriage permit. Gate collection by the customer does not.",
    );
  }

  return { allowed: blockers.length === 0, warnings, blockers };
}

/* ---------------------------------------------------------------- */
/* Pricing — effective-dated, never a static column                  */
/* ---------------------------------------------------------------- */

export interface PriceRow {
  scope: "CHANNEL" | "CUSTOMER";
  customerType?: CustomerType | null;
  customerId?: string | null;
  rateKesPerLitre: number | string;
  minLitres?: number | string | null;
  effectiveFrom: ISODate;
  effectiveTo?: ISODate | null;
}

/**
 * Resolution order: customer-specific override → channel default → nothing.
 * Prices swing ~40% intra-year (KES 80 → 50–60 in two months on a rain glut),
 * so every lookup is filtered to the date of the sale, not "now".
 */
export function resolvePrice(
  rows: PriceRow[],
  ctx: { customerId: string; customerType: CustomerType; onDate: ISODate; litres?: number },
): number | null {
  const live = rows.filter(
    (r) => r.effectiveFrom <= ctx.onDate && (!r.effectiveTo || r.effectiveTo >= ctx.onDate),
  );
  const meetsVolume = (r: PriceRow) =>
    r.minLitres == null || (ctx.litres ?? 0) >= num(r.minLitres);

  const byCustomer = live
    .filter((r) => r.scope === "CUSTOMER" && r.customerId === ctx.customerId && meetsVolume(r))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  if (byCustomer.length) return num(byCustomer[0].rateKesPerLitre);

  const byChannel = live
    .filter((r) => r.scope === "CHANNEL" && r.customerType === ctx.customerType && meetsVolume(r))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  if (byChannel.length) return num(byChannel[0].rateKesPerLitre);

  return null;
}

/* ---------------------------------------------------------------- */
/* Standing orders → the delivery round                              */
/* ---------------------------------------------------------------- */

export interface StandingOrderRow {
  id: string;
  customerId: string;
  litres: number | string;
  session: string;
  daysOfWeek: number[];
  rateKesPerLitre?: number | string | null;
  activeFrom: ISODate;
  activeTo?: ISODate | null;
  pausedFrom?: ISODate | null;
  pausedTo?: ISODate | null;
}

export function isOrderActiveOn(o: StandingOrderRow, date: ISODate): boolean {
  if (o.activeFrom > date) return false;
  if (o.activeTo && o.activeTo < date) return false;
  // Schools pause over holidays rather than being deleted, so the volume
  // forecast survives December.
  if (o.pausedFrom && o.pausedTo && date >= o.pausedFrom && date <= o.pausedTo) return false;
  if (o.pausedFrom && !o.pausedTo && date >= o.pausedFrom) return false;
  return o.daysOfWeek.includes(isoWeekday(date));
}

/**
 * Generate the round, prefilled. The rider edits exceptions only — the same
 * two-tap pattern as the milk sheet, and the reason a 13-customer round can
 * finish in under two minutes.
 */
export function buildDeliveryRound(
  orders: StandingOrderRow[],
  date: ISODate,
  session: string,
): Array<{ orderId: string; customerId: string; litres: number; rateKesPerLitre: number | null }> {
  return orders
    .filter((o) => o.session === session && isOrderActiveOn(o, date))
    .map((o) => ({
      orderId: o.id,
      customerId: o.customerId,
      litres: num(o.litres),
      rateKesPerLitre: o.rateKesPerLitre == null ? null : num(o.rateKesPerLitre),
    }));
}

/* ---------------------------------------------------------------- */
/* The ledger                                                        */
/* ---------------------------------------------------------------- */

export interface LedgerRow {
  entryDate: ISODate;
  entryType: "DELIVERY" | "PAYMENT" | "ADJUSTMENT" | "WRITE_OFF" | "OPENING_BALANCE";
  debitKes: number | string;
  creditKes: number | string;
}

export interface CustomerBalance {
  balanceKes: number;
  lastPaidOn: ISODate | null;
  daysSincePayment: number | null;
  totalDeliveredKes: number;
  totalPaidKes: number;
  writtenOffKes: number;
}

export function customerBalance(rows: LedgerRow[], asOf: ISODate): CustomerBalance {
  let debit = 0;
  let credit = 0;
  let delivered = 0;
  let paid = 0;
  let writtenOff = 0;
  let lastPaidOn: ISODate | null = null;

  for (const r of rows) {
    if (r.entryDate > asOf) continue;
    debit += num(r.debitKes);
    credit += num(r.creditKes);
    if (r.entryType === "DELIVERY") delivered += num(r.debitKes);
    if (r.entryType === "PAYMENT") {
      paid += num(r.creditKes);
      if (!lastPaidOn || r.entryDate > lastPaidOn) lastPaidOn = r.entryDate;
    }
    if (r.entryType === "WRITE_OFF") writtenOff += num(r.creditKes);
  }

  return {
    balanceKes: money(debit - credit),
    lastPaidOn,
    daysSincePayment: lastPaidOn ? daysBetween(lastPaidOn, asOf) : null,
    totalDeliveredKes: money(delivered),
    totalPaidKes: money(paid),
    writtenOffKes: money(writtenOff),
  };
}

export interface CreditCheck {
  allowed: boolean;
  overLimit: boolean;
  balanceKes: number;
  limitKes: number | null;
  daysSincePayment: number | null;
  /** Shown to the rider BEFORE the delivery, which is the whole point. */
  message: string | null;
}

/**
 * The cheapest bad-debt control available, and the one thing an exercise book
 * structurally cannot do: warn before the next delivery rather than after the
 * default.
 */
export function checkCreditLimit(
  balance: CustomerBalance,
  limitKes: number | null,
  aboutToAddKes: number,
  customerName = "This customer",
): CreditCheck {
  const projected = money(balance.balanceKes + aboutToAddKes);
  if (limitKes == null || limitKes <= 0) {
    return {
      allowed: true,
      overLimit: false,
      balanceKes: projected,
      limitKes,
      daysSincePayment: balance.daysSincePayment,
      message: null,
    };
  }
  if (projected > limitKes) {
    const stale = balance.daysSincePayment;
    const staleNote = stale != null && stale > 30 ? `, and has not paid for ${stale} days` : "";
    return {
      allowed: true, // a warning, not a refusal — the rider decides
      overLimit: true,
      balanceKes: projected,
      limitKes,
      daysSincePayment: stale,
      message: `${customerName} owes KES ${projected.toLocaleString()} against a limit of KES ${limitKes.toLocaleString()}${staleNote}. Deliver anyway, or skip?`,
    };
  }
  return {
    allowed: true,
    overLimit: false,
    balanceKes: projected,
    limitKes,
    daysSincePayment: balance.daysSincePayment,
    message: null,
  };
}

/* ---------------------------------------------------------------- */
/* Terms, due dates and aging                                        */
/* ---------------------------------------------------------------- */

export function dueDateFor(terms: PaymentTerms, issuedOn: ISODate, settlementDay?: number | null): ISODate {
  switch (terms) {
    case "CASH":
    case "DAILY":
      return issuedOn;
    case "WEEKLY":
      return addDays(issuedOn, 7);
    case "FORTNIGHTLY":
      return addDays(issuedOn, 14);
    case "MONTHLY": {
      const next = addDays(issuedOn, 30);
      if (settlementDay && settlementDay >= 1 && settlementDay <= 28) {
        return `${next.slice(0, 8)}${String(settlementDay).padStart(2, "0")}`;
      }
      return next;
    }
    case "NET_30":
      return addDays(issuedOn, 30);
    case "NET_60":
      return addDays(issuedOn, 60);
    case "NET_90":
      return addDays(issuedOn, 90);
  }
}

export interface AgedItem {
  amountKes: number;
  dueOn: ISODate;
}

export type AgingReport = Record<AgingBucket, number> & { totalKes: number; oldestDays: number };

export function ageReceivables(items: AgedItem[], asOf: ISODate): AgingReport {
  const report: AgingReport = {
    CURRENT: 0, D30: 0, D60: 0, D90_PLUS: 0, totalKes: 0, oldestDays: 0,
  };
  for (const i of items) {
    const overdue = daysBetween(i.dueOn, asOf);
    report[agingBucket(overdue)] = money(report[agingBucket(overdue)] + num(i.amountKes));
    report.totalKes = money(report.totalKes + num(i.amountKes));
    if (overdue > report.oldestDays) report.oldestDays = overdue;
  }
  return report;
}

/* ---------------------------------------------------------------- */
/* Late payment interest — a right almost nobody claims              */
/* ---------------------------------------------------------------- */

/**
 * Under the Milk Sales Contract Regulations (LN 20/2021) buyers must pay after
 * the end of the month of supply, and late payment attracts simple monthly
 * interest at the prevailing CBK base rate.
 *
 * It is computable, and most farmers never exercise it because nobody computes
 * it. New KCC once failed to pay KES 300 million in arrears, so this is not
 * theoretical.
 */
export function latePaymentInterestKes(
  principalKes: number,
  dueOn: ISODate,
  asOf: ISODate,
  cbkBaseRatePctPerAnnum: number,
): { daysLate: number; monthsLate: number; interestKes: number; message: string | null } {
  const daysLate = daysBetween(dueOn, asOf);
  if (daysLate <= 0) {
    return { daysLate: 0, monthsLate: 0, interestKes: 0, message: null };
  }
  const monthlyRate = cbkBaseRatePctPerAnnum / 100 / 12;
  const monthsLate = daysLate / 30.4375;
  const interestKes = money(num(principalKes) * monthlyRate * monthsLate);
  return {
    daysLate,
    monthsLate: money(monthsLate),
    interestKes,
    message: `${daysLate} days late. You are entitled to KES ${interestKes.toLocaleString()} in interest at the CBK base rate.`,
  };
}

/* ---------------------------------------------------------------- */
/* Co-op statement reconciliation                                    */
/* ---------------------------------------------------------------- */

export interface ReconLine {
  label: string;
  ourValue: number | null;
  theirValue: number | null;
  matched: boolean;
  varianceKes: number;
  note?: string;
}

export interface StatementReconciliation {
  litresOurs: number;
  litresTheirs: number;
  litresVariance: number;
  litresVarianceKes: number;
  deductionLines: ReconLine[];
  unmatchedDeductionsKes: number;
  /** One sentence answering "why is my cheque smaller than I expected". */
  message: string;
}

export function reconcileStatement(input: {
  litresOurs: number;
  litresTheirs: number;
  ratePerLitre: number;
  deductions: Array<{ type: string; description?: string | null; amountKes: number; matchedExpenseId?: string | null }>;
}): StatementReconciliation {
  const litresVariance = money(input.litresOurs - input.litresTheirs);
  const litresVarianceKes = money(litresVariance * input.ratePerLitre);

  const deductionLines: ReconLine[] = input.deductions.map((d) => ({
    label: d.description || d.type,
    ourValue: d.matchedExpenseId ? d.amountKes : null,
    theirValue: d.amountKes,
    matched: Boolean(d.matchedExpenseId),
    varianceKes: d.matchedExpenseId ? 0 : money(d.amountKes),
    note: d.matchedExpenseId ? undefined : "No matching record on the farm.",
  }));

  const unmatchedDeductionsKes = money(
    deductionLines.filter((l) => !l.matched).reduce((a, l) => a + l.varianceKes, 0),
  );

  const parts: string[] = [];
  if (Math.abs(litresVariance) > 0.5) {
    parts.push(
      `${Math.abs(litresVariance).toFixed(1)} litres ${
        litresVariance > 0 ? "short on their record" : "more than we recorded"
      } (KES ${Math.abs(litresVarianceKes).toLocaleString()})`,
    );
  }
  if (unmatchedDeductionsKes > 0) {
    const n = deductionLines.filter((l) => !l.matched).length;
    parts.push(`${n} deduction${n === 1 ? "" : "s"} worth KES ${unmatchedDeductionsKes.toLocaleString()} with nothing to match them`);
  }

  return {
    litresOurs: money(input.litresOurs),
    litresTheirs: money(input.litresTheirs),
    litresVariance,
    litresVarianceKes,
    deductionLines,
    unmatchedDeductionsKes,
    message: parts.length === 0 ? "The statement matches our records." : `Query this statement: ${parts.join(", and ")}.`,
  };
}
