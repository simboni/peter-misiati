/**
 * M11 — Alerts & Notifications.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE RULE: ONE PERSON, ONE ANIMAL, ONE ACTION, ONE DEADLINE.
 *
 *  An alert that says "check the herd" is noise. An alert that says
 *  "the herdsman must dip Njeri today" is a job. Every row this module
 *  writes names exactly one role, one subject, one imperative and one
 *  date — and is dismissed with an OUTCOME, because a dismissal with no
 *  outcome teaches the system nothing.
 *
 *  Alert fatigue is a documented failure mode: "the value is entirely
 *  contingent on someone acting on the alerts." So there is a daily cap,
 *  ranking by severity, and the number this module reports is the ACTION
 *  COMPLETION RATE — never the alert volume. A system proud of sending
 *  400 alerts is a system nobody reads.
 * ══════════════════════════════════════════════════════════════════════
 *
 * IDEMPOTENCY. `alert.dedupeKey` is unique per farm. The sweep writes a
 * key derived from (kind, subject, due date), so running `generateAlerts`
 * twice for the same day is a no-op at the database level — and a second
 * check refuses to raise a kind that is already open against the same
 * subject, which is what stops the sweep from duplicating an alert another
 * module already raised at the moment of entry.
 *
 * NOTE ON `"use server"`. As elsewhere, the directive sits on the mutating
 * entry points only. A file-level directive would publish every query here
 * as a POST endpoint to anyone able to forge a session object.
 */
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import {
  actionError,
  RefusedError,
  actionOk,
  assertOwned,
  can,
  guard,
  NotPermittedError,
  type ActionResult,
  type Capability,
  type Session,
} from "@/lib/dal";
import { newId } from "@/lib/ids";
import { kes, money, num } from "@/lib/money";
import { addDays, daysBetween, startOfMonth, today, type ISODate } from "@/lib/domain/dates";
import { detectSustainedDrop } from "@/lib/domain/milk";
import { BULLING_WEIGHT_KG } from "@/lib/domain/animal";

import { breedingWatchboard } from "./breeding";
import { dueRoutines, withdrawalBoard } from "./health";
import { feedStore } from "./feed";
import { listHerd } from "./herd";
import { casualConversionWatch } from "./people";
import { channelMix, debtorAging, listStatements, statementView } from "./sales";
import { dayProduction, formatDay, milkingSessionsForFarm } from "./milk";
import { monthToDate } from "./money";
import { expiringDocuments } from "./reports";

/* ================================================================== */
/* Plumbing                                                            */
/* ================================================================== */

async function resolveDb(database?: Db): Promise<Db> {
  if (database) return database;
  return (await import("@/db")).db;
}

function requireCap(session: Session, capability: Capability): void {
  if (!can(session.role, capability)) throw new NotPermittedError(capability);
}

/* ================================================================== */
/* Vocabulary                                                          */
/* ================================================================== */

/**
 * Every alert kind the sweep can raise.
 *
 * The breeding, routine and withdrawal kinds deliberately reuse the strings
 * M2, M1 and M6 already write at the moment of entry, so a service, a dose or
 * a treatment CLOSES the sweep's alert automatically — those modules resolve by
 * kind. Inventing parallel names here would leave two rows for one job and
 * neither of them would ever clear.
 */
export const SWEEP_KIND = {
  RETURN_TO_HEAT: "RETURN_TO_HEAT",
  PD_DUE: "PD_DUE",
  DRY_OFF_DUE: "DRY_OFF_DUE",
  CALVING_DUE: "CALVING_DUE",
  SERVE_NOW: "SERVE_NOW",
  HEIFER_READY: "HEIFER_READY",
  WITHDRAWAL_CLEAR: "WITHDRAWAL_CLEAR",
  YIELD_DROP: "YIELD_DROP",
  LOW_FEED_STOCK: "LOW_FEED_STOCK",
  CASUAL_CONVERSION: "CASUAL_CONVERSION",
  COOP_VARIANCE: "COOP_VARIANCE",
  CREDIT_LIMIT: "CREDIT_LIMIT",
  COMPLIANCE_EXPIRY: "COMPLIANCE_EXPIRY",
} as const;
export type SweepKind = (typeof SWEEP_KIND)[keyof typeof SWEEP_KIND];

/** Vaccination and deworming reminders share M1's prefix so M6 can clear them. */
export const ROUTINE_KIND_PREFIX = "ROUTINE_";

/**
 * What a role must be able to do before it may SEE an alert of this kind.
 *
 * A herdsman must not see money alerts. That is not squeamishness: segregation
 * of duties is the documented remedy for the theft pattern on Kenyan farms, and
 * an alert that tells a herdsman which customer is over their credit limit has
 * handed him information his job does not need.
 */
const KIND_CAPABILITY: Record<string, Capability> = {
  [SWEEP_KIND.CASUAL_CONVERSION]: "VIEW_MONEY",
  [SWEEP_KIND.COOP_VARIANCE]: "VIEW_MONEY",
  [SWEEP_KIND.CREDIT_LIMIT]: "VIEW_MONEY",
  [SWEEP_KIND.COMPLIANCE_EXPIRY]: "VIEW_MONEY",
  LOW_STOCK_VALUE: "VIEW_MONEY",
};

/** Kinds that carry money on their face. Named so the filter is auditable. */
export const MONEY_ALERT_KINDS: string[] = Object.keys(KIND_CAPABILITY);

export function kindIsVisibleTo(role: s.Role, kind: string): boolean {
  const needed = KIND_CAPABILITY[kind];
  return needed ? can(role, needed) : true;
}

/** How many alerts one person may be shown in a day. Above this is noise. */
export const DAILY_ALERT_CAP = 12;

const SEVERITY_RANK: Record<"CRITICAL" | "WARN" | "INFO", number> = {
  CRITICAL: 0,
  WARN: 1,
  INFO: 2,
};

/* ================================================================== */
/* The sweep                                                           */
/* ================================================================== */

export interface AlertCandidate {
  kind: string;
  animalId?: string | null;
  customerId?: string | null;
  employeeId?: string | null;
  assignedRole: s.Role;
  action: string;
  dueOn: ISODate;
  severity: "INFO" | "WARN" | "CRITICAL";
}

export interface GenerateResult {
  asOf: ISODate;
  /** Rows actually written. A second run for the same day writes none. */
  created: number;
  /** Candidates skipped because the same job is already open. */
  skippedExisting: number;
  openTotal: number;
  byKind: Record<string, number>;
  headline: string;
}

/** Deterministic and stable: same job, same day, same key. */
function dedupeKeyFor(c: AlertCandidate): string {
  const subject = c.animalId ?? c.customerId ?? c.employeeId ?? "farm";
  return `sweep:${c.kind}:${subject}:${c.dueOn}`;
}

function subjectOf(c: AlertCandidate): string | null {
  return c.animalId ?? c.customerId ?? c.employeeId ?? null;
}

/**
 * Sweep every module and upsert today's alerts.
 *
 * Safe to run as often as you like — that is what `dedupeKey` is for. Nothing
 * here decides whether a job is done; it asks each module what is outstanding,
 * so recording the service, the dose or the purchase makes the alert disappear
 * on the next sweep without anybody ticking anything off.
 */
export async function generateAlerts(
  session: Session,
  asOf: ISODate = today(),
  database?: Db,
): Promise<GenerateResult> {
  const db = await resolveDb(database);
  const seesMoney = can(session.role, "VIEW_MONEY");
  const candidates: AlertCandidate[] = [];

  /* ---- M2 Breeding: return to heat, PD due, dry-off, calving, serve --- */
  const watch = await breedingWatchboard(session, asOf);
  for (const w of watch.all) {
    candidates.push({
      kind: w.kind,
      animalId: w.animalId,
      assignedRole: w.kind === "CALVING_DUE" ? "HERDSMAN" : "MANAGER",
      action: w.action,
      dueOn: w.dueOn,
      severity: w.severity,
    });
  }

  /* ---- M1/M6 Routines: vaccination and deworming due ------------------ */
  const routines = await dueRoutines(session, asOf, db);
  for (const r of routines) {
    candidates.push({
      kind: `${ROUTINE_KIND_PREFIX}${r.routine}`,
      animalId: r.animalId,
      assignedRole: "HERDSMAN",
      action: `Give ${r.animalName} her ${r.label.toLowerCase()}.`,
      dueOn: r.dueOn,
      severity: r.overdueDays > 14 ? "CRITICAL" : r.overdueDays > 0 ? "WARN" : "INFO",
    });
  }

  /* ---- M6 MILK WITHDRAWAL CLEARING ------------------------------------ */
  // The one hard block in the system, and the one alert that must never be
  // missed in either direction: her milk is out of the can until this date,
  // and it goes back in ON it.
  const board = await withdrawalBoard(session, asOf, db);
  for (const w of board) {
    if (!w.milkBlocked || !w.milkClearOn) continue;
    candidates.push({
      kind: SWEEP_KIND.WITHDRAWAL_CLEAR,
      animalId: w.animalId,
      assignedRole: "HERDSMAN",
      action: `${w.animalName}'s milk goes back in the can on ${formatDay(w.milkClearOn)} — not before.`,
      dueOn: w.milkClearOn,
      severity: "CRITICAL",
    });
  }

  /* ---- M5 Feed: days of cover at or under a week ---------------------- */
  const store = await feedStore(session, asOf, db);
  for (const line of store) {
    const days = line.cover.daysOfCover;
    if (days === null || days > 7) continue;
    candidates.push({
      kind: SWEEP_KIND.LOW_FEED_STOCK,
      assignedRole: "MANAGER",
      action: `Buy ${line.name} — ${line.cover.message.toLowerCase()}`,
      dueOn: addDays(asOf, Math.max(0, days - 1)),
      severity: days <= 3 ? "CRITICAL" : "WARN",
    });
  }

  /* ---- M3 Milk: a cow whose yield is dropping ------------------------- */
  for (const d of await yieldDrops(session, asOf, db)) {
    candidates.push({
      kind: SWEEP_KIND.YIELD_DROP,
      animalId: d.animalId,
      assignedRole: "HERDSMAN",
      action: `Check ${d.name} — she is down ${d.pct}% for ${d.days} days.`,
      dueOn: asOf,
      severity: d.pct >= 40 ? "CRITICAL" : "WARN",
    });
  }

  /* ---- M1 Herd: a heifer that has reached breeding weight ------------- */
  const herd = await listHerd(session, { asOf });
  for (const row of herd.rows) {
    if (row.sex !== "F" || row.parity > 0) continue;
    if (row.cls !== "BULLING_HEIFER") continue;
    if (row.latestWeightKg === null || row.latestWeightKg < BULLING_WEIGHT_KG) continue;
    if (row.lastServiceOn) continue;
    candidates.push({
      kind: SWEEP_KIND.HEIFER_READY,
      animalId: row.id,
      assignedRole: "MANAGER",
      action: `${row.name ?? row.tag} has reached ${row.latestWeightKg} kg — serve her on her next heat.`,
      dueOn: asOf,
      severity: "WARN",
    });
  }

  /* ---- Money-side sweeps. A herdsman's sweep never raises these. ------- */
  if (seesMoney) {
    for (const c of await casualConversionWatch(session, asOf, db)) {
      candidates.push({
        kind: SWEEP_KIND.CASUAL_CONVERSION,
        employeeId: c.employeeId,
        assignedRole: "OWNER",
        action: c.warning.converted
          ? `Put ${c.fullName} on a written term contract — after ${c.warning.daysWorked} unbroken days they are one in law.`
          : `Decide about ${c.fullName} before day 30 — a break, or a contract.`,
        dueOn: asOf,
        severity: c.warning.converted ? "CRITICAL" : "WARN",
      });
    }

    for (const v of await statementVariances(session, asOf, db)) {
      candidates.push({
        kind: SWEEP_KIND.COOP_VARIANCE,
        customerId: v.customerId,
        assignedRole: "OWNER",
        action: v.action,
        dueOn: v.dueOn,
        severity: "WARN",
      });
    }

    const aging = await debtorAging(session, asOf, db);
    for (const d of aging.debtors) {
      if (!d.overLimit) continue;
      candidates.push({
        kind: SWEEP_KIND.CREDIT_LIMIT,
        customerId: d.customerId,
        assignedRole: "OWNER",
        action: `${d.name} owes ${kes(d.balanceKes)}, over their limit. Take cash before the next delivery.`,
        dueOn: asOf,
        severity: "CRITICAL",
      });
    }

    // COMPLIANCE DOCUMENT EXPIRY. A food handler certificate lasts six months,
    // which is exactly why this cannot be an annual checklist item.
    for (const doc of await expiringDocuments(session, asOf, 45, db)) {
      candidates.push({
        kind: SWEEP_KIND.COMPLIANCE_EXPIRY,
        employeeId: null,
        assignedRole: "OWNER",
        action: doc.action,
        dueOn: doc.expiresOn,
        severity: doc.daysLeft <= 0 ? "CRITICAL" : doc.daysLeft <= 14 ? "WARN" : "INFO",
      });
    }
  }

  /* ---- Write. Twice-run is a no-op, by construction. ------------------ */
  const open = await db
    .select({
      kind: s.alert.kind,
      animalId: s.alert.animalId,
      customerId: s.alert.customerId,
      employeeId: s.alert.employeeId,
    })
    .from(s.alert)
    .where(and(eq(s.alert.farmId, session.farmId), isNull(s.alert.resolvedAt)));

  const openIndex = new Set(
    open.map((o) => `${o.kind}:${o.animalId ?? o.customerId ?? o.employeeId ?? "farm"}`),
  );

  let created = 0;
  let skippedExisting = 0;
  const byKind: Record<string, number> = {};

  for (const c of candidates) {
    const identity = `${c.kind}:${subjectOf(c) ?? "farm"}`;
    if (openIndex.has(identity)) {
      skippedExisting += 1;
      continue;
    }
    const inserted = await db
      .insert(s.alert)
      .values({
        id: newId(),
        farmId: session.farmId,
        kind: c.kind,
        animalId: c.animalId ?? null,
        customerId: c.customerId ?? null,
        employeeId: c.employeeId ?? null,
        assignedRole: c.assignedRole,
        action: c.action,
        dueOn: c.dueOn,
        severity: c.severity,
        dedupeKey: dedupeKeyFor(c),
      })
      .onConflictDoNothing()
      .returning({ id: s.alert.id });

    if (inserted.length > 0) {
      created += 1;
      openIndex.add(identity);
      byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    } else {
      skippedExisting += 1;
    }
  }

  const [openAgg] = await db
    .select({ n: sql<string>`count(*)` })
    .from(s.alert)
    .where(and(eq(s.alert.farmId, session.farmId), isNull(s.alert.resolvedAt)));
  const openTotal = Number(openAgg?.n ?? 0);

  return {
    asOf,
    created,
    skippedExisting,
    openTotal,
    byKind,
    headline:
      created === 0
        ? `Nothing new. ${openTotal} ${openTotal === 1 ? "job is" : "jobs are"} still open.`
        : `${created} new ${created === 1 ? "job" : "jobs"}, ${openTotal} open in all.`,
  };
}

/* ================================================================== */
/* Yield drop — composed from the milk domain rule, not re-invented    */
/* ================================================================== */

export interface YieldDrop {
  animalId: string;
  name: string;
  pct: number;
  days: number;
  baselineL: number;
}

const DROP_BASELINE_DAYS = 14;
const DROP_WINDOW_DAYS = 3;

/**
 * Cows whose daily yield has been down for three days running.
 *
 * The threshold and the window belong to `detectSustainedDrop` in the milk
 * domain — the same rule the entry screen warns with, so the alert and the
 * warning can never disagree.
 */
export async function yieldDrops(
  session: Session,
  asOf: ISODate = today(),
  database?: Db,
): Promise<YieldDrop[]> {
  const db = await resolveDb(database);
  const from = addDays(asOf, -(DROP_BASELINE_DAYS + DROP_WINDOW_DAYS));

  const rows = await db
    .select({
      id: s.milkRecord.id,
      animalId: s.milkRecord.animalId,
      recordedOn: s.milkRecord.recordedOn,
      litres: s.milkRecord.litres,
      supersedesId: s.milkRecord.supersedesId,
      tag: s.animal.tag,
      name: s.animal.name,
    })
    .from(s.milkRecord)
    .innerJoin(s.animal, eq(s.animal.id, s.milkRecord.animalId))
    .where(
      and(
        eq(s.milkRecord.farmId, session.farmId),
        gte(s.milkRecord.recordedOn, from),
        lte(s.milkRecord.recordedOn, asOf),
      ),
    );

  const superseded = new Set(rows.map((r) => r.supersedesId).filter(Boolean) as string[]);
  const byAnimal = new Map<string, { name: string; days: Map<string, number> }>();
  for (const r of rows) {
    if (superseded.has(r.id)) continue;
    const cur = byAnimal.get(r.animalId) ?? { name: r.name ?? r.tag, days: new Map() };
    cur.days.set(r.recordedOn, money((cur.days.get(r.recordedOn) ?? 0) + num(r.litres)));
    byAnimal.set(r.animalId, cur);
  }

  const out: YieldDrop[] = [];
  for (const [animalId, v] of byAnimal) {
    const dates = [...v.days.keys()].sort();
    if (dates.length < DROP_WINDOW_DAYS + 1) continue;

    const recentDates = dates.slice(-DROP_WINDOW_DAYS);
    const baselineDates = dates.slice(0, -DROP_WINDOW_DAYS);
    if (baselineDates.length === 0) continue;

    const baseline = money(
      baselineDates.reduce((a, d) => a + (v.days.get(d) ?? 0), 0) / baselineDates.length,
    );
    const recent = recentDates.map((d) => v.days.get(d) ?? 0);
    const drop = detectSustainedDrop(recent, baseline, { days: DROP_WINDOW_DAYS });
    if (!drop.dropping) continue;

    out.push({ animalId, name: v.name, pct: drop.pct, days: drop.days, baselineL: baseline });
  }

  return out.sort((a, b) => b.pct - a.pct);
}

/* ================================================================== */
/* Co-op statement variance                                            */
/* ================================================================== */

export interface StatementVariance {
  statementId: string;
  customerId: string;
  customerName: string;
  litresVariance: number;
  varianceKes: number;
  dueOn: ISODate;
  action: string;
}

/** Statements where their litres and ours disagree, or a deduction is unmatched. */
export async function statementVariances(
  session: Session,
  asOf: ISODate = today(),
  database?: Db,
): Promise<StatementVariance[]> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);

  const rows = await listStatements(session, db);
  const out: StatementVariance[] = [];

  for (const { statement, customer } of rows) {
    // Only recent statements are actionable — nobody re-opens last year's.
    if (daysBetween(statement.periodEnd as ISODate, asOf) > 90) continue;
    const view = await statementView(session, statement.id, db);
    const r = view.reconciliation;
    if (Math.abs(r.litresVariance) < 1 && r.unmatchedDeductionsKes < 1) continue;
    out.push({
      statementId: statement.id,
      customerId: customer.id,
      customerName: customer.name,
      litresVariance: r.litresVariance,
      varianceKes: money(r.litresVarianceKes + r.unmatchedDeductionsKes),
      dueOn: asOf,
      action: `Query ${customer.name}'s statement for ${statement.periodStart} to ${statement.periodEnd}: ${r.message}`,
    });
  }
  return out;
}

/* ================================================================== */
/* Reading alerts                                                      */
/* ================================================================== */

export interface AlertView {
  id: string;
  kind: string;
  animalId: string | null;
  animalName: string | null;
  customerId: string | null;
  employeeId: string | null;
  assignedRole: s.Role | null;
  action: string;
  dueOn: ISODate;
  dueLabel: string;
  daysOverdue: number;
  severity: "INFO" | "WARN" | "CRITICAL";
  resolvedAt: Date | null;
  outcome: string | null;
}

export interface RoleAlerts {
  role: s.Role;
  asOf: ISODate;
  /** At most `DAILY_ALERT_CAP`, worst first. Includes the week ahead. */
  alerts: AlertView[];
  /** Of those, how many are actually due today or already late. */
  dueTodayCount: number;
  /** And how many are a heads-up for later in the week. */
  laterThisWeekCount: number;
  /** How many were held back by the cap. Shown, so nothing is silently hidden. */
  heldBack: number;
  openTotal: number;
  headline: string;
}

/**
 * The alerts one role should be shown today.
 *
 * A herdsman gets no money alerts — not filtered in the component, filtered
 * here, because `return null` in a component is not a security boundary.
 *
 * `role` is a VIEW, not an identity. A manager may legitimately ask "what is
 * on the herdsman's list today", so the parameter exists — but it can only
 * ever NARROW what the session itself is allowed to see. A herdsman passing
 * `"OWNER"` gets a herdsman's list, because the filter below is applied twice:
 * once against the session's real role and once against the requested one.
 */
export async function alertsForRole(
  session: Session,
  role: s.Role,
  asOf: ISODate = today(),
  database?: Db,
): Promise<RoleAlerts> {
  const db = await resolveDb(database);

  const rows = await db
    .select({ alert: s.alert, tag: s.animal.tag, name: s.animal.name })
    .from(s.alert)
    .leftJoin(s.animal, eq(s.animal.id, s.alert.animalId))
    .where(
      and(
        eq(s.alert.farmId, session.farmId),
        isNull(s.alert.resolvedAt),
        lte(s.alert.dueOn, addDays(asOf, 7)),
      ),
    );

  const visible = rows
    // The session's own role is the ceiling; the requested role is a filter.
    .filter(({ alert }) => kindIsVisibleTo(session.role, alert.kind))
    .filter(({ alert }) => kindIsVisibleTo(role, alert.kind))
    // An alert with an explicit assignee belongs to that person alone; an owner
    // still sees everything, because reading the farm is the owner's whole job.
    .filter(({ alert }) => role === "OWNER" || !alert.assignedRole || alert.assignedRole === role)
    .map(({ alert, tag, name }) => toView(alert, name ?? tag ?? null, asOf))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        b.daysOverdue - a.daysOverdue ||
        a.dueOn.localeCompare(b.dueOn),
    );

  const capped = visible.slice(0, DAILY_ALERT_CAP);
  const heldBack = visible.length - capped.length;

  // The query looks a week ahead so nothing arrives as a surprise, but the
  // screen is headed "Today's jobs". Counting the whole week under that heading
  // is how a 7-day withdrawal came to be announced on the day of the injection.
  // "Today" now means today.
  const dueToday = capped.filter((a) => a.dueOn <= asOf);
  const later = capped.length - dueToday.length;

  return {
    role,
    asOf,
    alerts: capped,
    dueTodayCount: dueToday.length,
    laterThisWeekCount: later,
    heldBack,
    openTotal: visible.length,
    headline: buildHeadline(dueToday, later, heldBack),
  };
}

/**
 * One sentence that is true when it is read. A herdsman who is told he has
 * jobs and finds none due stops reading the list, and a list nobody reads is
 * worse than no list — it is a list the farm believes is being worked.
 */
function buildHeadline(dueToday: AlertView[], later: number, heldBack: number): string {
  const behind = heldBack > 0 ? ` ${heldBack} more waiting behind these.` : "";

  if (dueToday.length === 0) {
    if (later === 0) return "Nothing needs you today.";
    return `Nothing to do today. ${later} ${later === 1 ? "job is" : "jobs are"} coming this week.`;
  }

  const n = dueToday.length;
  const ahead = later > 0 ? ` ${later} more ${later === 1 ? "is" : "are"} coming this week.` : "";
  return `${n} ${n === 1 ? "job" : "jobs"} today.${behind} Start with: ${dueToday[0].action}${ahead}`;
}

function toView(
  alert: typeof s.alert.$inferSelect,
  animalName: string | null,
  asOf: ISODate,
): AlertView {
  const daysOverdue = daysBetween(alert.dueOn as ISODate, asOf);
  return {
    id: alert.id,
    kind: alert.kind,
    animalId: alert.animalId,
    animalName,
    customerId: alert.customerId,
    employeeId: alert.employeeId,
    assignedRole: alert.assignedRole,
    action: alert.action,
    dueOn: alert.dueOn as ISODate,
    dueLabel:
      daysOverdue > 0
        ? `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} late`
        : daysOverdue === 0
          ? "today"
          : `by ${formatDay(alert.dueOn as ISODate)}`,
    daysOverdue: Math.max(0, daysOverdue),
    severity: alert.severity,
    resolvedAt: alert.resolvedAt,
    outcome: alert.outcome,
  };
}

/* ================================================================== */
/* Resolving — a dismissal carries an outcome                          */
/* ================================================================== */

/**
 * Why an alert went away.
 *
 * DONE and NOT_NEEDED are both fine answers; WRONG is the valuable one,
 * because a system that is told it was wrong can be measured. Dismissal with
 * no outcome is what turns an alert list into wallpaper.
 */
export const ALERT_OUTCOMES = ["DONE", "NOT_NEEDED", "WRONG", "SNOOZED"] as const;
export type AlertOutcome = (typeof ALERT_OUTCOMES)[number];

export const OUTCOME_LABEL: Record<AlertOutcome, string> = {
  DONE: "Done",
  NOT_NEEDED: "Not needed",
  WRONG: "This was wrong",
  SNOOZED: "Not yet — remind me",
};

export interface ResolveResult {
  id: string;
  kind: string;
  outcome: AlertOutcome;
  message: string;
}

export async function resolveAlert(
  session: Session,
  alertId: string,
  outcome: AlertOutcome,
  database?: Db,
): Promise<ResolveResult> {
  const db = await resolveDb(database);

  const existing = await db.query.alert.findFirst({
    where: and(eq(s.alert.id, alertId), eq(s.alert.farmId, session.farmId)),
  });
  assertOwned(existing, session, "alert");

  // A Server Action is reachable by direct POST, so a herdsman who cannot SEE
  // a money alert must not be able to clear one by guessing its id either.
  // Deliberately the same message as "not found": which of the two it was is
  // not information this caller is entitled to.
  if (!kindIsVisibleTo(session.role, existing!.kind)) {
    throw new RefusedError("That alert was not found.");
  }

  if (!(ALERT_OUTCOMES as readonly string[]).includes(outcome)) {
    throw new RefusedError("Say what happened: done, not needed, wrong, or not yet.");
  }

  // SNOOZED is not a resolution — it moves the deadline to tomorrow and leaves
  // the job open. Anything else closes it with the reason attached.
  if (outcome === "SNOOZED") {
    await db
      .update(s.alert)
      .set({ dueOn: addDays(existing!.dueOn as ISODate, 1) })
      .where(and(eq(s.alert.id, alertId), eq(s.alert.farmId, session.farmId)));
    return {
      id: alertId,
      kind: existing!.kind,
      outcome,
      message: "Put off until tomorrow. It will come back.",
    };
  }

  await db
    .update(s.alert)
    .set({ resolvedAt: new Date(), outcome, resolvedBy: session.userId })
    .where(
      and(
        eq(s.alert.id, alertId),
        eq(s.alert.farmId, session.farmId),
        isNull(s.alert.resolvedAt),
      ),
    );

  return {
    id: alertId,
    kind: existing!.kind,
    outcome,
    message:
      outcome === "WRONG"
        ? "Noted — this one should not have been raised. That is counted."
        : outcome === "NOT_NEEDED"
          ? "Cleared. It will not be raised again for this."
          : "Done. Cleared.",
  };
}

/** The Server Action. Reachable by direct POST, so it re-derives the session. */
export async function resolveAlertAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<ResolveResult>> {
  "use server";
  return guard(async () => {
    const { verifySession } = await import("@/lib/dal");
    const session = await verifySession();

    const alertId = String(formData.get("alertId") ?? "");
    const outcome = String(formData.get("outcome") ?? "") as AlertOutcome;
    if (!alertId) return actionError("Which job are you clearing?");
    if (!(ALERT_OUTCOMES as readonly string[]).includes(outcome)) {
      return actionError("Say what happened: done, not needed, wrong, or not yet.");
    }

    const result = await resolveAlert(session, alertId, outcome);
    const { updateTag } = await import("next/cache");
    updateTag(`alerts:${session.farmId}`);
    return actionOk(result, result.message);
  });
}

/**
 * "Check the farm now", as a plain form action.
 *
 * No `useActionState` and therefore no client component: this button has
 * nothing to report back beyond the page re-rendering with whatever the sweep
 * found, and a screen a herdsman opens at 5am should not wait on a JS bundle.
 */
export async function refreshAlertsAction(formData: FormData): Promise<void> {
  "use server";
  const { verifySession } = await import("@/lib/dal");
  const session = await verifySession();
  const asOf = String(formData.get("asOf") ?? "") || today();
  await generateAlerts(session, asOf as ISODate);
  const { updateTag, revalidatePath } = await import("next/cache");
  updateTag(`alerts:${session.farmId}`);
  revalidatePath("/alerts");
}

/** Regenerating the sweep, for a caller that wants the result back. */
export async function generateAlertsAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<GenerateResult>> {
  "use server";
  return guard(async () => {
    const { verifySession } = await import("@/lib/dal");
    const session = await verifySession();
    const asOf = String(formData.get("asOf") ?? "") || today();
    const result = await generateAlerts(session, asOf as ISODate);
    const { updateTag } = await import("next/cache");
    updateTag(`alerts:${session.farmId}`);
    return actionOk(result, result.headline);
  });
}

/* ================================================================== */
/* The number we actually report: ACTION COMPLETION RATE               */
/* ================================================================== */

export interface CompletionRate {
  from: ISODate;
  to: ISODate;
  raised: number;
  resolved: number;
  done: number;
  notNeeded: number;
  wrong: number;
  stillOpen: number;
  /** done ÷ raised. The only alert metric worth putting on a screen. */
  completionRatePct: number;
  /** wrong ÷ resolved. If this climbs, the alerts are the problem. */
  falseAlarmRatePct: number;
  byKind: Array<{ kind: string; raised: number; done: number; wrong: number; completionRatePct: number }>;
  headline: string;
}

/**
 * Action completion rate — never alert volume.
 *
 * "The value is entirely contingent on someone acting on the alerts." A rising
 * count of alerts sent is a vanity number; a falling share of alerts acted on
 * is the early warning that the farm has stopped reading them.
 */
export async function actionCompletionRate(
  session: Session,
  from: ISODate,
  to: ISODate,
  database?: Db,
): Promise<CompletionRate> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);

  const rows = await db
    .select()
    .from(s.alert)
    .where(
      and(
        eq(s.alert.farmId, session.farmId),
        gte(s.alert.dueOn, from),
        lte(s.alert.dueOn, to),
      ),
    );

  const raised = rows.length;
  const resolved = rows.filter((r) => r.resolvedAt !== null).length;
  const done = rows.filter((r) => r.outcome === "DONE").length;
  const notNeeded = rows.filter((r) => r.outcome === "NOT_NEEDED").length;
  const wrong = rows.filter((r) => r.outcome === "WRONG").length;
  const stillOpen = raised - resolved;

  const kindMap = new Map<string, { raised: number; done: number; wrong: number }>();
  for (const r of rows) {
    const cur = kindMap.get(r.kind) ?? { raised: 0, done: 0, wrong: 0 };
    cur.raised += 1;
    if (r.outcome === "DONE") cur.done += 1;
    if (r.outcome === "WRONG") cur.wrong += 1;
    kindMap.set(r.kind, cur);
  }

  const completionRatePct = raised > 0 ? money((done / raised) * 100) : 0;
  const falseAlarmRatePct = resolved > 0 ? money((wrong / resolved) * 100) : 0;

  let headline: string;
  if (raised === 0) {
    headline = "No alerts were raised in this period.";
  } else if (completionRatePct >= 80) {
    headline = `${Math.round(completionRatePct)}% of the jobs raised were done. That is what makes the rest of the system worth using.`;
  } else if (falseAlarmRatePct >= 20) {
    headline = `Only ${Math.round(completionRatePct)}% of jobs were done, and ${Math.round(falseAlarmRatePct)}% of the ones cleared were marked wrong. The alerts are the problem, not the people.`;
  } else {
    headline = `${Math.round(completionRatePct)}% of the jobs raised were done, and ${stillOpen} ${stillOpen === 1 ? "is" : "are"} still open. Under 80% and the list stops being read.`;
  }

  return {
    from, to, raised, resolved, done, notNeeded, wrong, stillOpen,
    completionRatePct, falseAlarmRatePct,
    byKind: [...kindMap.entries()]
      .map(([kind, v]) => ({
        kind,
        raised: v.raised,
        done: v.done,
        wrong: v.wrong,
        completionRatePct: v.raised > 0 ? money((v.done / v.raised) * 100) : 0,
      }))
      .sort((a, b) => b.raised - a.raised),
    headline,
  };
}

/* ================================================================== */
/* The daily digest — the Sky Dairy pattern                            */
/* ================================================================== */

export interface DailyDigest {
  date: ISODate;
  /** The whole thing, one SMS. This is the field that gets sent. */
  sms: string;
  totalL: number;
  bySession: Array<{ label: string; litres: number }>;
  deliveredL: number;
  valueKes: number;
  monthToDateKes: number;
  /** At most three, and only if they are urgent. An SMS is not a report. */
  urgent: string[];
  charactersUsed: number;
  /** SMS at KES 0.40–0.80 a message; two segments doubles the cost. */
  segments: number;
}

const SMS_SEGMENT_CHARS = 160;

/**
 * The owner's one-SMS summary.
 *
 * Modelled on Sky Dairy's daily message, which is the highest-trust feature in
 * Kenyan co-operative dairy: what came in, what went out, what it was worth,
 * and the running total. Nothing else. The trust comes from it being the same
 * four facts every single day.
 *
 *   "Mon 3 Aug: 187 L (AM 104, PM 83). Delivered 170 L. Value KES 8,840.
 *    Month to date KES 231,400."
 */
export async function dailyDigest(
  session: Session,
  date: ISODate = today(),
  database?: Db,
): Promise<DailyDigest> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);

  const [day, mix, mtd, sessionNames] = await Promise.all([
    dayProduction(session, date, db),
    channelMix(session, date, date, db),
    monthToDate(session, date, db),
    milkingSessionsForFarm(session, db),
  ]);

  const label: Record<s.MilkingSession, string> = { MORNING: "AM", NOON: "MID", EVENING: "PM" };
  const bySession = sessionNames.map((sn) => ({
    label: label[sn],
    litres: day.bySession.find((b) => b.session === sn)?.litres ?? 0,
  }));

  const deliveredL = money(
    mix.lines.filter((l) => l.revenue).reduce((a, l) => a + l.litres, 0),
  );
  const valueKes = mix.revenueKes;

  const sessionPart = bySession.length
    ? ` (${bySession.map((b) => `${b.label} ${trim(b.litres)}`).join(", ")})`
    : "";

  const urgent: string[] = [];
  const board = await withdrawalBoard(session, date, db);
  for (const w of board) {
    if (w.milkBlocked && w.milkClearOn) {
      urgent.push(`Do not sell ${w.animalName}'s milk until ${formatDay(w.milkClearOn)}.`);
    }
  }
  if (urgent.length === 0) {
    const alerts = await alertsForRole(session, session.role, date, db);
    for (const a of alerts.alerts) {
      if (a.severity !== "CRITICAL") continue;
      urgent.push(a.action);
      if (urgent.length >= 2) break;
    }
  }

  const sms =
    `${formatDay(date)}: ${trim(day.totalL)} L${sessionPart}. ` +
    `Delivered ${trim(deliveredL)} L. Value ${kes(valueKes)}. ` +
    `Month to date ${kes(mtd.incomeKes)}.` +
    (urgent.length > 0 ? ` ${urgent.slice(0, 2).join(" ")}` : "");

  return {
    date,
    sms,
    totalL: day.totalL,
    bySession,
    deliveredL,
    valueKes,
    monthToDateKes: mtd.incomeKes,
    urgent: urgent.slice(0, 3),
    charactersUsed: sms.length,
    segments: Math.max(1, Math.ceil(sms.length / SMS_SEGMENT_CHARS)),
  };
}

/** Litres in an SMS: no trailing ".0", every character costs money. */
function trim(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/* ================================================================== */
/* Small queries the /alerts screen needs                              */
/* ================================================================== */

/** Everything open, for the manager's board. Not capped — this is the full list. */
export async function openAlerts(
  session: Session,
  asOf: ISODate = today(),
  database?: Db,
): Promise<AlertView[]> {
  const db = await resolveDb(database);
  const rows = await db
    .select({ alert: s.alert, tag: s.animal.tag, name: s.animal.name })
    .from(s.alert)
    .leftJoin(s.animal, eq(s.animal.id, s.alert.animalId))
    .where(and(eq(s.alert.farmId, session.farmId), isNull(s.alert.resolvedAt)));

  return rows
    .filter(({ alert }) => kindIsVisibleTo(session.role, alert.kind))
    .map(({ alert, tag, name }) => toView(alert, name ?? tag ?? null, asOf))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        b.daysOverdue - a.daysOverdue ||
        a.dueOn.localeCompare(b.dueOn),
    );
}

/** This month's completion rate, for the header of the alerts screen. */
export async function monthCompletionRate(
  session: Session,
  asOf: ISODate = today(),
  database?: Db,
): Promise<CompletionRate> {
  return actionCompletionRate(session, startOfMonth(asOf), asOf, database);
}

/** Resolve every open alert of a kind for an animal — used when a job is done elsewhere. */
export async function resolveAlertsFor(
  session: Session,
  opts: { kinds: string[]; animalIds: string[]; outcome: AlertOutcome },
  database?: Db,
): Promise<number> {
  if (opts.kinds.length === 0 || opts.animalIds.length === 0) return 0;
  const db = await resolveDb(database);
  const updated = await db
    .update(s.alert)
    .set({ resolvedAt: new Date(), outcome: opts.outcome, resolvedBy: session.userId })
    .where(
      and(
        eq(s.alert.farmId, session.farmId),
        inArray(s.alert.kind, opts.kinds),
        inArray(s.alert.animalId, opts.animalIds),
        isNull(s.alert.resolvedAt),
      ),
    )
    .returning({ id: s.alert.id });
  return updated.length;
}
