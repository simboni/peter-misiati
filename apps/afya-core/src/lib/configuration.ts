/**
 * M75 Configuration Studio — the numbers a facility owns, and who said so.
 *
 * Every module in this system carries thresholds that were chosen rather than
 * derived: 2 to 8 °C for a vaccine fridge, twenty-one days before a body counts
 * as unclaimed, twenty cases before a percentage is worth printing. Each is
 * marked ⚠️ or 🔴 in the clinical review register, and most of those marks do
 * not mean "this is wrong". They mean "nobody has confirmed this".
 *
 *  THE MOST VALUABLE THING HERE IS A REVIEW, NOT A CHANGE. Recording that a
 *  named pharmacist read 2 to 8 °C and kept it turns a 🔴 into a ✅ without a
 *  line of code changing. That is what most of the register is asking for, and
 *  no other screen in this system can record it.
 *
 *  A CLINICAL THRESHOLD CANNOT BE CHANGED WITHOUT A SOURCE. Not a reason — a
 *  citation. "The pharmacist said so" is a reason; "WHO cold chain guidance,
 *  2023 revision" is a source, and only one of them can be defended eighteen
 *  months later by somebody who was not in the room.
 *
 *  THE HISTORY IS APPEND-ONLY. A threshold that was 40 last year is what a case
 *  from last year was judged against. A register holding only today's number
 *  cannot answer the question anybody will actually ask.
 *
 *  A REVIEW GOES STALE WHEN THE VALUE MOVES. A sign-off vouches for a number,
 *  not for a key, so changing the number retires the review rather than
 *  carrying it forward over something nobody read.
 *
 *  SOME THINGS ARE NOT SETTINGS. Whether a dismissal needs a hearing, whether a
 *  journal must balance, whether a body needs an identity before release —
 *  those are in the code because a facility that can switch them off will, on
 *  the afternoon it is inconvenient. They are listed here as locked, with the
 *  reason, rather than hidden.
 *
 * ⚠️ What is registered below is what is actually wired. A constant that does
 * not appear here is still hard-coded, and `HARD_CODED` names those honestly
 * rather than leaving a screen that implies more is configurable than is.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now } from "./db.ts";

export class ConfigError extends Error {}

export type SettingType = "integer" | "decimal" | "text" | "boolean";
export type Status = "default" | "reviewed" | "changed" | "changed_unreviewed" | "review_stale";

export interface SettingDefinition {
  key: string;
  module: string;
  name: string;
  /** What it means, in the words the person changing it would use. */
  explains: string;
  type: SettingType;
  /** The value in the code, used when nobody has set one. */
  fallback: string;
  unit?: string;
  min?: number;
  max?: number;
  /** True when changing it needs a source rather than a reason. */
  clinical: boolean;
  /** Which review-register rule this is the number behind. */
  rule: string;
  /** Who should be the one to confirm it. */
  reviewer: string;
}

/**
 * Everything a facility may change, and nothing it may not.
 *
 * ⚠️ Deliberately short. A settings screen that lists two hundred keys is one
 * nobody reads, and every entry here is a number somebody in a Kenyan clinic
 * can have an opinion about.
 */
export const REGISTRY: SettingDefinition[] = [
  {
    key: "cold_chain.min_tenths",
    module: "Equipment & estates",
    name: "Cold chain minimum",
    explains: "The coldest a vaccine fridge may be before its stock is quarantined, in tenths of a degree.",
    type: "integer",
    fallback: "20",
    unit: "tenths of °C",
    min: -400,
    max: 600,
    clinical: true,
    rule: "16.8",
    reviewer: "A pharmacist",
  },
  {
    key: "cold_chain.max_tenths",
    module: "Equipment & estates",
    name: "Cold chain maximum",
    explains: "The warmest a vaccine fridge may be before its stock is quarantined, in tenths of a degree.",
    type: "integer",
    fallback: "80",
    unit: "tenths of °C",
    min: -400,
    max: 600,
    clinical: true,
    rule: "16.8",
    reviewer: "A pharmacist",
  },
  {
    key: "assets.due_horizon_days",
    module: "Equipment & estates",
    name: "Maintenance due horizon",
    explains: "How far ahead a maintenance check is worth seeing on the board.",
    type: "integer",
    fallback: "30",
    unit: "days",
    min: 1,
    max: 365,
    clinical: false,
    rule: "16.3",
    reviewer: "A biomedical engineer",
  },
  {
    key: "mortuary.free_days",
    module: "Mortuary",
    name: "Free storage days",
    explains: "Days a body may be held before storage is charged for.",
    type: "integer",
    fallback: "2",
    unit: "days",
    min: 0,
    max: 30,
    clinical: false,
    rule: "17.14",
    reviewer: "The administrator",
  },
  {
    key: "mortuary.daily_fee_cents",
    module: "Mortuary",
    name: "Daily storage fee",
    explains: "Charged per day after the free period, in cents.",
    type: "integer",
    fallback: "50000",
    unit: "cents",
    min: 0,
    max: 10_000_00,
    clinical: false,
    rule: "17.14",
    reviewer: "The administrator",
  },
  {
    key: "mortuary.unclaimed_days",
    module: "Mortuary",
    name: "Unclaimed after",
    explains: "When a body nobody has come for stops being a waiting family and becomes a problem.",
    type: "integer",
    fallback: "21",
    unit: "days",
    min: 1,
    max: 365,
    clinical: false,
    rule: "17.18",
    reviewer: "The administrator and the county",
  },
  {
    key: "biometrics.min_quality",
    module: "Identity",
    name: "Fingerprint quality floor",
    explains: "Below this the capture is enrolled and warned about, because a poor template means failing verification at every visit.",
    type: "integer",
    fallback: "40",
    unit: "0–100",
    min: 0,
    max: 100,
    clinical: false,
    rule: "18.13",
    reviewer: "Whoever chose the reader",
  },
  {
    key: "biometrics.min_age_years",
    module: "Identity",
    name: "Youngest age for a fingerprint",
    explains: "Below this a fingerprint is not expected to read, and the screen says so before anybody tries.",
    type: "integer",
    fallback: "5",
    unit: "years",
    min: 0,
    max: 18,
    clinical: true,
    rule: "18.14",
    reviewer: "A clinician and whoever chose the reader",
  },
  {
    key: "portal.majority_years",
    module: "Patient portal",
    name: "Age of majority",
    explains: "From this age a patient must agree in person before anybody else may read their record.",
    type: "integer",
    fallback: "18",
    unit: "years",
    min: 12,
    max: 21,
    clinical: true,
    rule: "21.5",
    reviewer: "A clinician, against national guidance",
  },
  {
    key: "portal.adolescent_years",
    module: "Patient portal",
    name: "Adolescent confidentiality from",
    explains: "From this age a patient's results are shown only to them, never to a proxy.",
    type: "integer",
    fallback: "12",
    unit: "years",
    min: 8,
    max: 18,
    clinical: true,
    rule: "21.6",
    reviewer: "A clinician, against national guidance",
  },
  {
    key: "indicators.min_denominator",
    module: "Analytics",
    name: "Smallest denominator for a percentage",
    explains: "Below this the count is shown and the percentage withheld, because a rate on a handful of cases swings wildly.",
    type: "integer",
    fallback: "20",
    unit: "cases",
    min: 1,
    max: 500,
    clinical: false,
    rule: "20.3",
    reviewer: "The facility manager",
  },
  {
    key: "indicators.small_cell",
    module: "Analytics",
    name: "Small cell suppression",
    explains: "A disaggregated row at or below this is suppressed, because it identifies a person.",
    type: "integer",
    fallback: "4",
    unit: "people",
    min: 0,
    max: 50,
    clinical: false,
    rule: "20.4",
    reviewer: "The data protection officer",
  },
  {
    key: "hr.expiry_horizon_days",
    module: "Human resources",
    name: "Licence expiry horizon",
    explains: "How far ahead a lapsing registration is shown, which should be long enough for a renewal to be possible.",
    type: "integer",
    fallback: "90",
    unit: "days",
    min: 7,
    max: 365,
    clinical: false,
    rule: "15.8",
    reviewer: "The HR officer",
  },
];

/**
 * Rules that are in the code on purpose.
 *
 * Listed rather than hidden, because a facility asking "can we turn that off"
 * deserves to be told no and why, on a screen, rather than by nobody.
 */
export const LOCKED: { name: string; why: string; where: string }[] = [
  {
    name: "A body is not released without a confirmed identity",
    why: "There is no undo. A body released to the wrong family is buried.",
    where: "mortuary.ts",
  },
  {
    name: "A dismissal without a recorded hearing is refused",
    why: "It is unfair whatever the employee did, and it is the most expensive mistake a Kenyan employer can make.",
    where: "hr.ts",
  },
  {
    name: "A journal that does not balance is refused",
    why: "A ledger that can hold an unbalanced entry is not a ledger.",
    where: "accounting.ts",
  },
  {
    name: "An MRI screening answer of yes or unknown stops the scan",
    why: "The failure mode is a person pulled into a magnet.",
    where: "radiology.ts",
  },
  {
    name: "A controlled drug is not prescribed on a remote consultation",
    why: "The patient has not been examined and cannot be seen.",
    where: "telemedicine.ts",
  },
  {
    name: "Biometric enrolment without consent is refused",
    why: "Special-category data under the Data Protection Act. There is no lawful override.",
    where: "biometrics.ts",
  },
];

/**
 * Constants that are still hard-coded.
 *
 * Named here so the studio does not imply more is configurable than is. Each
 * carries the review-register rule that asks for it.
 */
export const HARD_CODED: { name: string; where: string; rule: string }[] = [
  { name: "Findings never sent in a patient message", where: "portal.ts WITHHELD_ANALYTES", rule: "21.2" },
  { name: "Complaints that must be seen in person", where: "telemedicine.ts RED_FLAGS", rule: "22.6" },
  { name: "Triage scale, its bands and its time targets", where: "emergency.ts", rule: "8.x" },
  { name: "Laboratory reference ranges", where: "seed.ts seedReferenceRanges", rule: "5.x" },
  { name: "Statutory payroll rates", where: "payroll.ts seedStatutoryRates", rule: "14.x" },
  { name: "Useful lives for depreciation", where: "assets.ts seedAssets", rule: "16.20" },
  { name: "The WHO surgical checklist items", where: "theatre.ts CHECKLIST", rule: "13.x" },
];

export function definitionFor(key: string): SettingDefinition | undefined {
  return REGISTRY.find((s) => s.key === key);
}

// ------------------------------------------------------------------ reading

/** The string in force: what the facility set, or what the code says. */
export function raw(key: string): string {
  const definition = definitionFor(key);
  if (!definition) throw new ConfigError(`${key} is not a registered setting`);
  return get<{ value: string }>(`SELECT value FROM config_values WHERE key = ?`, key)?.value ?? definition.fallback;
}

/**
 * A number in force.
 *
 * Every module that has a configurable threshold reads it through here, so
 * there is exactly one answer to "what is the range" and it is the same one on
 * the screen and in the rule.
 */
export function number(key: string): number {
  const value = Number(raw(key));
  if (!Number.isFinite(value)) throw new ConfigError(`${key} is not a number`);
  return value;
}

export function text(key: string): string {
  return raw(key);
}

export function flag(key: string): boolean {
  return raw(key) === "true";
}

// ------------------------------------------------------------------ writing

function validate(definition: SettingDefinition, value: string): void {
  if (definition.type === "integer" || definition.type === "decimal") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new ConfigError(`${definition.name} is a number`);
    if (definition.type === "integer" && !Number.isInteger(parsed)) {
      throw new ConfigError(`${definition.name} is a whole number`);
    }
    if (definition.min !== undefined && parsed < definition.min) {
      throw new ConfigError(`${definition.name} cannot be below ${definition.min}`);
    }
    if (definition.max !== undefined && parsed > definition.max) {
      throw new ConfigError(`${definition.name} cannot be above ${definition.max}`);
    }
  }
  if (definition.type === "boolean" && value !== "true" && value !== "false") {
    throw new ConfigError(`${definition.name} is true or false`);
  }
  if (definition.type === "text" && !value.trim()) {
    throw new ConfigError(`${definition.name} cannot be empty`);
  }
}

/**
 * Change a setting.
 *
 * A clinical one takes a source rather than a reason — "the pharmacist said so"
 * is a reason, and it cannot be defended eighteen months later by somebody who
 * was not in the room.
 */
export function apply(input: {
  key: string;
  value: string;
  reason: string;
  /** Required for anything clinical. */
  source?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const definition = definitionFor(input.key);
  if (!definition) throw new ConfigError(`${input.key} is not a registered setting`);
  if (!input.reason.trim()) throw new ConfigError("changing a setting records why");
  if (definition.clinical && !input.source?.trim()) {
    throw new ConfigError(
      `${definition.name} is a clinical threshold. Record the source it comes from, not just the reason — a threshold nobody can cite is a threshold nobody can defend.`,
    );
  }

  const value = input.value.trim();
  validate(definition, value);

  const before = raw(input.key);
  if (before === value) throw new ConfigError(`${definition.name} is already ${value}`);

  const at = now();
  tx(() => {
    run(
      `INSERT INTO config_values (key, value, source, reason, set_at, set_by, setter_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value, source = excluded.source, reason = excluded.reason,
         set_at = excluded.set_at, set_by = excluded.set_by, setter_name = excluded.setter_name`,
      definition.key,
      value,
      input.source?.trim() ?? "",
      input.reason.trim(),
      at,
      input.byUserId,
      input.byUserName,
      at,
    );

    // A sign-off vouches for a number, not for a key. Moving the number retires
    // the review rather than carrying it over something nobody read.
    run(`DELETE FROM config_reviews WHERE key = ? AND reviewed_value <> ?`, definition.key, value);

    record(definition.key, "changed", before, value, input.source ?? "", input.reason, input.byUserId, input.byUserName, at);

    audit({
      action: "setting_changed",
      entity: "setting",
      entityId: definition.key,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: {
        name: definition.name,
        from: before,
        to: value,
        clinical: definition.clinical,
        source: input.source ?? null,
        reason: input.reason,
      },
    });
  });
}

/** Put it back to what the code says, which is also a change and is recorded as one. */
export function reset(input: {
  key: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const definition = definitionFor(input.key);
  if (!definition) throw new ConfigError(`${input.key} is not a registered setting`);
  if (!input.reason.trim()) throw new ConfigError("resetting a setting records why");

  const before = raw(input.key);
  if (before === definition.fallback) throw new ConfigError(`${definition.name} is already the default`);

  const at = now();
  tx(() => {
    run(`DELETE FROM config_values WHERE key = ?`, definition.key);
    run(`DELETE FROM config_reviews WHERE key = ? AND reviewed_value <> ?`, definition.key, definition.fallback);
    record(definition.key, "reset", before, definition.fallback, "", input.reason, input.byUserId, input.byUserName, at);
    audit({
      action: "setting_reset",
      entity: "setting",
      entityId: definition.key,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { name: definition.name, from: before, to: definition.fallback, reason: input.reason },
    });
  });
}

/**
 * Record that somebody read this and kept it.
 *
 * The most valuable thing in this module. Most of what the clinical review
 * register is asking for is not a different number — it is a named person
 * saying the seeded one is right, and nowhere else in this system can record
 * that.
 */
export function markReviewed(input: {
  key: string;
  reviewerName: string;
  reviewerRole?: string;
  source?: string;
  note?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const definition = definitionFor(input.key);
  if (!definition) throw new ConfigError(`${input.key} is not a registered setting`);
  if (!input.reviewerName.trim()) throw new ConfigError("a review records who did it — by name, not by role alone");
  if (definition.clinical && !input.source?.trim()) {
    throw new ConfigError(
      `${definition.name} is a clinical threshold. A review of one records what it was checked against.`,
    );
  }

  const value = raw(definition.key);
  const at = now();

  tx(() => {
    run(
      `INSERT INTO config_reviews
         (key, reviewed_value, reviewer_name, reviewer_role, source, note, reviewed_at, reviewed_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         reviewed_value = excluded.reviewed_value, reviewer_name = excluded.reviewer_name,
         reviewer_role = excluded.reviewer_role, source = excluded.source, note = excluded.note,
         reviewed_at = excluded.reviewed_at, reviewed_by = excluded.reviewed_by`,
      definition.key,
      value,
      input.reviewerName.trim(),
      input.reviewerRole?.trim() ?? "",
      input.source?.trim() ?? "",
      input.note?.trim() ?? "",
      at,
      input.byUserId,
      at,
    );
    record(definition.key, "reviewed", value, value, input.source ?? "", input.note ?? "", input.byUserId, input.reviewerName, at);
    audit({
      action: "setting_reviewed",
      entity: "setting",
      entityId: definition.key,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: {
        name: definition.name,
        value,
        reviewer: input.reviewerName,
        role: input.reviewerRole ?? null,
        source: input.source ?? null,
        rule: definition.rule,
      },
    });
  });
}

function record(
  key: string,
  kind: "changed" | "reviewed" | "reset",
  oldValue: string,
  newValue: string,
  source: string,
  reason: string,
  actorId: number | null,
  actorName: string,
  at: string,
): void {
  run(
    `INSERT INTO config_history
       (key, kind, old_value, new_value, source, reason, actor_name, actor_id, happened_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    key,
    kind,
    oldValue,
    newValue,
    source,
    reason,
    actorName,
    actorId,
    at,
    now(),
  );
}

export function historyFor(key: string, limit = 30) {
  return all<{
    id: number;
    kind: string;
    old_value: string;
    new_value: string;
    source: string;
    reason: string;
    actor_name: string;
    happened_at: string;
  }>(`SELECT * FROM config_history WHERE key = ? ORDER BY happened_at DESC, id DESC LIMIT ?`, key, limit);
}

// ------------------------------------------------------------------ status

export interface SettingState {
  definition: SettingDefinition;
  value: string;
  isDefault: boolean;
  status: Status;
  setBy?: { name: string; at: string; reason: string; source: string };
  reviewedBy?: { name: string; role: string; at: string; source: string; note: string };
}

export function stateOf(key: string): SettingState {
  const definition = definitionFor(key);
  if (!definition) throw new ConfigError(`${key} is not a registered setting`);

  const set = get<{ value: string; source: string; reason: string; set_at: string; setter_name: string }>(
    `SELECT * FROM config_values WHERE key = ?`,
    key,
  );
  const review = get<{
    reviewed_value: string;
    reviewer_name: string;
    reviewer_role: string;
    source: string;
    note: string;
    reviewed_at: string;
  }>(`SELECT * FROM config_reviews WHERE key = ?`, key);

  const value = set?.value ?? definition.fallback;
  const isDefault = value === definition.fallback;

  const status: Status =
    review && review.reviewed_value !== value
      ? "review_stale"
      : review
        ? "reviewed"
        : isDefault
          ? "default"
          : "changed_unreviewed";

  return {
    definition,
    value,
    isDefault,
    status,
    setBy: set
      ? { name: set.setter_name, at: set.set_at, reason: set.reason, source: set.source }
      : undefined,
    reviewedBy: review
      ? {
          name: review.reviewer_name,
          role: review.reviewer_role,
          at: review.reviewed_at,
          source: review.source,
          note: review.note,
        }
      : undefined,
  };
}

export function allSettings(): SettingState[] {
  return REGISTRY.map((definition) => stateOf(definition.key));
}

/** The settings nobody has signed off, clinical ones first. This is the worklist. */
export function outstanding(): SettingState[] {
  return allSettings()
    .filter((state) => state.status === "default" || state.status === "changed_unreviewed" || state.status === "review_stale")
    .sort(
      (a, b) =>
        Number(b.definition.clinical) - Number(a.definition.clinical) ||
        a.definition.key.localeCompare(b.definition.key),
    );
}

export interface ConfigSummary {
  settings: number;
  reviewed: number;
  changed: number;
  stale: number;
  clinicalUnreviewed: number;
  locked: number;
  hardCoded: number;
}

export function configSummary(): ConfigSummary {
  const states = allSettings();
  return {
    settings: states.length,
    reviewed: states.filter((s) => s.status === "reviewed").length,
    changed: states.filter((s) => !s.isDefault).length,
    stale: states.filter((s) => s.status === "review_stale").length,
    clinicalUnreviewed: states.filter((s) => s.definition.clinical && s.status !== "reviewed").length,
    locked: LOCKED.length,
    hardCoded: HARD_CODED.length,
  };
}
