/**
 * Health domain rules — including the only hard block in the system.
 *
 * Why withdrawal blocks rather than warns: 15–19% of Kenyan milk samples test
 * positive for antibiotic residues, and one farmer's residual milk can cause a
 * whole chilling-plant load to be rejected — a cost co-operatives pass back to
 * the member, and one that can exceed a month's profit.
 */
import { addDays, type ISODate } from "./dates";

/* ---------------------------------------------------------------- */
/* Withdrawal                                                        */
/* ---------------------------------------------------------------- */

export interface WithdrawalInput {
  /** Last day of treatment. Falls back to the treatment date for single doses. */
  treatmentEndOn: ISODate;
  milkWithdrawalDays: number | null | undefined;
  meatWithdrawalDays: number | null | undefined;
}

export interface WithdrawalResult {
  milkClearOn: ISODate | null;
  meatClearOn: ISODate | null;
}

/**
 * What to assume when the label was never recorded.
 *
 * A missing withdrawal period means "nobody read the label", NOT "there is no
 * withdrawal". Treating the two as the same is how residue reaches the churn:
 * a herdsman injects a bottle whose label is lost, the app says nothing, and
 * the plant load is rejected and billed back to the farm.
 *
 * Seven days covers essentially every common Kenyan milk withdrawal — procaine
 * penicillin 3, long-acting oxytetracycline 4–7, sulphonamides 3–7,
 * fluoroquinolones 6 — so it is safe without being punitive. Blocking for a
 * month "to be sure" would dump saleable milk and teach people to work around
 * the app, which is worse than the risk it avoids.
 *
 * The assumption is always SHOWN, never silent: the farm is told we are
 * guessing and told to check the label.
 */
export const ASSUMED_MILK_WITHDRAWAL_DAYS = 7;
export const ASSUMED_MEAT_WITHDRAWAL_DAYS = 28;

/**
 * Compute clear dates from the PRODUCT's own label period.
 *
 * Deliberately takes the withdrawal days as an argument rather than looking a
 * drug up in a table: no Kenyan national withdrawal table exists, and the
 * legally operative number is the one printed on the PCPB-approved label.
 * A missing period is treated as unknown, not as zero.
 */
export function computeWithdrawal(input: WithdrawalInput): WithdrawalResult {
  const { treatmentEndOn, milkWithdrawalDays, meatWithdrawalDays } = input;
  return {
    milkClearOn:
      milkWithdrawalDays != null ? addDays(treatmentEndOn, milkWithdrawalDays) : null,
    meatClearOn:
      meatWithdrawalDays != null ? addDays(treatmentEndOn, meatWithdrawalDays) : null,
  };
}

/**
 * The clear date to ENFORCE, which is not always the clear date we know.
 *
 * When the label period is missing this falls back to the assumed window and
 * says so. Callers must treat `assumed: true` as a lock with a visible caveat,
 * never as "no withdrawal" — that conflation is the whole failure mode.
 */
export interface EffectiveWithdrawal {
  milkClearOn: ISODate | null;
  meatClearOn: ISODate | null;
  assumed: boolean;
}

export function effectiveWithdrawal(input: WithdrawalInput): EffectiveWithdrawal {
  const known = computeWithdrawal(input);
  const milkUnknown = input.milkWithdrawalDays == null;
  const meatUnknown = input.meatWithdrawalDays == null;

  return {
    milkClearOn:
      known.milkClearOn ??
      addDays(input.treatmentEndOn, ASSUMED_MILK_WITHDRAWAL_DAYS),
    meatClearOn:
      known.meatClearOn ??
      addDays(input.treatmentEndOn, ASSUMED_MEAT_WITHDRAWAL_DAYS),
    assumed: milkUnknown || meatUnknown,
  };
}

/** The sentence shown on a locked row when we are guessing. */
export function assumedWithdrawalMessage(
  animalName: string,
  productName: string,
  clearOn: ISODate,
): string {
  return `We do not know how long ${animalName} must stay out of the tank — no withdrawal period was recorded for ${productName}. Holding her milk until ${clearOn} to be safe. Check the label and enter the real period.`;
}

/**
 * Dry cow therapy is the special case that catches people out: the milk is not
 * clear until BOTH 30 days have passed since infusion AND 96 hours have passed
 * since calving — whichever falls later.
 */
export const DRY_COW_MIN_DAYS_AFTER_INFUSION = 30;
export const DRY_COW_MIN_HOURS_AFTER_CALVING = 96;

export function dryCowTherapyClearOn(
  infusedOn: ISODate,
  calvedOn: ISODate | null,
): ISODate {
  const afterInfusion = addDays(infusedOn, DRY_COW_MIN_DAYS_AFTER_INFUSION);
  if (!calvedOn) return afterInfusion;
  const afterCalving = addDays(calvedOn, Math.ceil(DRY_COW_MIN_HOURS_AFTER_CALVING / 24));
  return afterInfusion >= afterCalving ? afterInfusion : afterCalving;
}

export interface WithdrawalStatus {
  milkBlocked: boolean;
  meatBlocked: boolean;
  milkClearOn: ISODate | null;
  meatClearOn: ISODate | null;
  /** Plain language for the milking sheet. No jargon. */
  message: string | null;
}

/** Given every recorded clear date for an animal, is she blocked today? */
export function withdrawalStatus(
  clears: Array<{ milkClearOn: ISODate | null; meatClearOn: ISODate | null }>,
  asOf: ISODate,
  animalName = "This cow",
): WithdrawalStatus {
  let milkClearOn: ISODate | null = null;
  let meatClearOn: ISODate | null = null;

  for (const c of clears) {
    if (c.milkClearOn && c.milkClearOn > asOf && (!milkClearOn || c.milkClearOn > milkClearOn)) {
      milkClearOn = c.milkClearOn;
    }
    if (c.meatClearOn && c.meatClearOn > asOf && (!meatClearOn || c.meatClearOn > meatClearOn)) {
      meatClearOn = c.meatClearOn;
    }
  }

  const milkBlocked = milkClearOn !== null;
  const meatBlocked = meatClearOn !== null;

  let message: string | null = null;
  if (milkBlocked && meatBlocked) {
    message = `Do not sell ${animalName}'s milk until ${milkClearOn}. Do not sell her for slaughter until ${meatClearOn}.`;
  } else if (milkBlocked) {
    message = `Do not sell ${animalName}'s milk until ${milkClearOn}.`;
  } else if (meatBlocked) {
    message = `Do not sell ${animalName} for slaughter until ${meatClearOn}.`;
  }

  return { milkBlocked, meatBlocked, milkClearOn, meatClearOn, message };
}

/* ---------------------------------------------------------------- */
/* Colostrum                                                         */
/* ---------------------------------------------------------------- */

/** First 4–5 days after calving. Not saleable, must not enter the bulk tank. */
export const COLOSTRUM_DAYS = 4;

export function isColostrum(daysInMilk: number | null): boolean {
  return daysInMilk !== null && daysInMilk >= 0 && daysInMilk <= COLOSTRUM_DAYS;
}

/* ---------------------------------------------------------------- */
/* Routine schedules                                                 */
/* ---------------------------------------------------------------- */

export interface RoutineRule {
  routine: string;
  label: string;
  firstDoseMinAgeDays?: number;
  firstDoseMaxAgeDays?: number;
  boosterIntervalDays?: number;
  sexRestriction?: "F" | "M";
  onceInLifetime?: boolean;
  note?: string;
}

/**
 * The Kenyan calendar. Two entries need hard validation rather than a reminder:
 * S19 brucellosis (females only, 4–8 months, once for life — it interferes with
 * later testing) and ECF-ITM (once for life, and vaccinated animals become
 * carriers).
 */
export const KENYA_ROUTINES: RoutineRule[] = [
  {
    routine: "FMD",
    label: "Foot and mouth disease",
    firstDoseMinAgeDays: 120,
    boosterIntervalDays: 180,
    note: "Every six months. Often folded into government mass campaigns.",
  },
  {
    routine: "LSD",
    label: "Lumpy skin disease",
    firstDoseMinAgeDays: 180,
    boosterIntervalDays: 365,
  },
  {
    routine: "ANTHRAX_BQ",
    label: "Anthrax and blackquarter (Blanthrax)",
    firstDoseMinAgeDays: 180,
    boosterIntervalDays: 365,
  },
  {
    routine: "S19",
    label: "Brucellosis S19",
    firstDoseMinAgeDays: 120,
    firstDoseMaxAgeDays: 240,
    sexRestriction: "F",
    onceInLifetime: true,
    note: "Heifers aged 4–8 months only, once for life. Never in adults — it interferes with testing.",
  },
  {
    routine: "ECF_ITM",
    label: "East Coast Fever (Muguga cocktail)",
    firstDoseMinAgeDays: 90,
    onceInLifetime: true,
    note: "Once for life. Vaccinated animals become carriers. Needs a liquid-nitrogen cold chain.",
  },
  {
    routine: "DEWORM",
    label: "Deworming",
    firstDoseMinAgeDays: 30,
    boosterIntervalDays: 90,
    note: "Every three months; calves more often. Rotate drug classes. Deworm a week before vaccinating.",
  },
  {
    routine: "DIP",
    label: "Tick control (dip or spray)",
    firstDoseMinAgeDays: 14,
    boosterIntervalDays: 7,
    note: "Weekly in East Coast Fever areas. Rotate acaricide actives to manage resistance.",
  },
  {
    routine: "HOOF_TRIM",
    label: "Hoof trimming",
    firstDoseMinAgeDays: 365,
    boosterIntervalDays: 182,
  },
  {
    routine: "DISBUD",
    label: "Disbudding",
    firstDoseMinAgeDays: 14,
    firstDoseMaxAgeDays: 56,
    onceInLifetime: true,
    note: "Best between two and eight weeks of age.",
  },
];

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Can this routine be given to this animal today? Returns a refusal a herdsman
 * can act on, not an error code.
 */
export function checkRoutineEligibility(
  rule: RoutineRule,
  animal: { sex: "F" | "M"; ageDays: number | null; alreadyGivenCount: number },
): EligibilityResult {
  if (rule.sexRestriction && animal.sex !== rule.sexRestriction) {
    const who = rule.sexRestriction === "F" ? "females" : "males";
    return { eligible: false, reason: `${rule.label} is for ${who} only.` };
  }
  if (rule.onceInLifetime && animal.alreadyGivenCount > 0) {
    return { eligible: false, reason: `${rule.label} is given once in a lifetime and she has had it.` };
  }
  if (animal.ageDays === null) {
    // Unknown age on a bought-in animal: warn rather than block.
    return { eligible: true, reason: "Her age is not recorded — check she is the right age first." };
  }
  if (rule.firstDoseMinAgeDays != null && animal.ageDays < rule.firstDoseMinAgeDays) {
    return {
      eligible: false,
      reason: `Too young for ${rule.label} — she must be at least ${Math.round(
        rule.firstDoseMinAgeDays / 30,
      )} months.`,
    };
  }
  if (rule.firstDoseMaxAgeDays != null && animal.ageDays > rule.firstDoseMaxAgeDays) {
    return {
      eligible: false,
      reason: `Too old for ${rule.label} — the window closes at ${Math.round(
        rule.firstDoseMaxAgeDays / 30,
      )} months.`,
    };
  }
  return { eligible: true };
}

/** When is this routine next due? */
export function nextDueOn(rule: RoutineRule, lastGivenOn: ISODate | null): ISODate | null {
  if (!lastGivenOn) return null;
  if (rule.onceInLifetime) return null;
  if (!rule.boosterIntervalDays) return null;
  return addDays(lastGivenOn, rule.boosterIntervalDays);
}

/**
 * An abortion is not merely filed. Brucellosis is endemic in Kenya, zoonotic
 * and notifiable, so recording one opens a human-health workflow.
 */
export const ABORTION_PROTOCOL = [
  "Isolate the dam from the rest of the herd.",
  "Do not handle the foetus or membranes without gloves.",
  "Do not let dogs eat the membranes.",
  "Burn or bury the foetus and membranes deeply.",
  "Have the dam tested for brucellosis.",
  "Anyone who handled her should wash thoroughly — brucellosis passes to people.",
] as const;
