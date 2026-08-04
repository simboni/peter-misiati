/**
 * M10 — Reports & Insights.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE RULE THIS MODULE EXISTS TO ENFORCE: REPORTS STATE CONCLUSIONS,
 *  NOT TABLES.
 *
 *  Kenyan smallholder dairy farmers have education "not sufficient for
 *  making complex computations and interpretations for key decision
 *  making". So every number that leaves this file is paired with a
 *  sentence saying what to do about it. The acceptance test is: show
 *  the owner one report, ask "what should you do this week?" — they
 *  answer without reading a number twice.
 *
 *  Every `*Report` shape therefore carries a `sentence` (one sentence,
 *  the conclusion) and `actions` (imperative lines). A caller that
 *  renders only the numbers is using this module wrong.
 * ══════════════════════════════════════════════════════════════════════
 *
 * NOTHING HERE RE-DERIVES A NUMBER ANOTHER MODULE ALREADY OWNS. Cost per
 * litre comes from M9, margin over feed from M5, the cull ranking from M7,
 * the breeding calendar from M2, withdrawal from M6. This module composes
 * and concludes; if a figure looks wrong the bug is upstream, not here.
 *
 * NOTE ON `"use server"`. There is no file-level directive: these are
 * queries that take the session the *caller* already verified, and a
 * file-level directive would publish every one of them as a POST endpoint
 * to anyone who can forge a session object.
 */
import { and, desc, eq, gte, lte } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import {
  can,
  NotPermittedError,
  type Capability,
  type Session,
} from "@/lib/dal";
import { kes, money, num } from "@/lib/money";
import {
  addDays,
  daysBetween,
  dateRange,
  endOfMonth,
  today,
  type ISODate,
} from "@/lib/domain/dates";
import { COST_OF_PRODUCTION_KES_PER_LITRE } from "@/lib/domain/feed";
import {
  REPRO_BENCHMARKS,
  ageAtFirstCalvingMonths,
  calvingInterval,
  calvingIntervalCostKes,
  servicesPerConception as spcOf,
  CYCLE_DAYS,
} from "@/lib/domain/breeding";
import { deriveClass, deriveReproStatus } from "@/lib/domain/animal";

/* Composed modules — this list IS the report layer's dependency surface. */
import { costOfProduction, monthToDate, type CostOfProduction } from "./money";
import { channelMix, statementView, listStatements } from "./sales";
import { marginOverFeedCost, feedStore, type MarginBreakdown, type StoreLine } from "./feed";
import { dueRoutines, withdrawalBoard, type DueRoutine, type WithdrawalBoardRow } from "./health";
import { breedingWatchboard } from "./breeding";
import { herdInventoryReconciliation, listHerd, loadHerdSources, factsFor } from "./herd";
import { cullList, EXPECTED_LOSS_MAKER_SHARE_PCT, type CullCandidate } from "./trading";
import { dayProduction, lactationCurve, milkSheet, milkingSessionsForFarm, formatDay } from "./milk";
import { getPayrollRun, remittanceSummary, minimumWageReport, casualConversionWatch, normaliseMonth } from "./people";

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

/** "2026-08", "2026-08-14" or any date inside the month → first of that month. */
export function monthBounds(month: string): { from: ISODate; to: ISODate } {
  const from = normaliseMonth(month);
  return { from, to: endOfMonth(from) };
}

/** Every report answers the same two questions, in the same two fields. */
export interface Conclusion {
  /** ONE sentence. The whole point of the module. */
  sentence: string;
  /** Imperative lines. "Do X." Never "consider reviewing". */
  actions: string[];
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/* ================================================================== */
/* HEADLINE 1 — Money this month                                       */
/* ================================================================== */

export interface RevenueChannelLine {
  channel: s.DisposalChannel;
  label: string;
  litres: number;
  valueKes: number;
  ratePerLitreKes: number | null;
  kind: "REVENUE" | "IMPUTED" | "LOSS";
}

export interface CostLine {
  category: s.ExpenseCategory | "IMPUTED";
  label: string;
  amountKes: number;
  pctOfTotal: number;
}

export interface MoneyThisMonth extends Conclusion {
  month: string;
  from: ISODate;
  to: ISODate;
  litresProduced: number;

  /** Milk revenue split by where the milk went. Losses are shown, never hidden. */
  revenueByChannel: RevenueChannelLine[];
  milkSoldKes: number;
  milkImputedKes: number;
  otherIncomeKes: number;
  totalRevenueKes: number;

  /** Costs by category — cash rows first, then the imputed economic ones. */
  costsByCategory: CostLine[];
  cashCostKes: number;
  fullCostKes: number;

  /** BOTH variants, ALWAYS labelled. A cost per litre with no label is a lie. */
  cashCostPerLitreKes: number;
  cashCostLabel: string;
  fullCostPerLitreKes: number;
  fullCostLabel: string;

  benchmark: { lowKes: number; highKes: number; farmGateKes: number };
  benchmarkVerdict: string;

  marginOverFeed: {
    marginPerLitreKes: number;
    marginKes: number;
    feedCostPerLitreKes: number;
    revenuePerLitreKes: number;
    message: string;
  };

  netKes: number;
  pendingCount: number;
  pendingKes: number;
}

/** The farm-gate price the Kenya Dairy Board benchmark is quoted against. */
export const FARM_GATE_BENCHMARK_KES = 52;

/**
 * Money this month.
 *
 * Composes `costOfProduction` (M9) for both cost variants, `channelMix` (M4)
 * for where the milk went and `marginOverFeedCost` (M5) for the number that
 * actually moves a dairy. It adds nothing arithmetically — what it adds is the
 * sentence.
 */
export async function moneyThisMonth(
  session: Session,
  month: string = today(),
  database?: Db,
): Promise<MoneyThisMonth> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);
  const { from, to } = monthBounds(month);

  const [cop, mix, margin, mtd] = await Promise.all([
    costOfProduction(session, from, to, db),
    channelMix(session, from, to, db),
    marginOverFeedCost(session, from, to, db),
    monthToDate(session, to, db),
  ]);

  const revenueByChannel: RevenueChannelLine[] = mix.lines.map((l) => ({
    channel: l.channel,
    label: l.label,
    litres: l.litres,
    valueKes: l.valueKes,
    ratePerLitreKes: l.rateKesPerLitre,
    kind: l.revenue ? "REVENUE" : l.loss ? "LOSS" : "IMPUTED",
  }));

  const costsByCategory: CostLine[] = [
    ...cop.byCategory.map((c) => ({
      category: c.category as s.ExpenseCategory | "IMPUTED",
      label: c.label,
      amountKes: c.amountKes,
      pctOfTotal: cop.full.totalKes > 0 ? money((c.amountKes / cop.full.totalKes) * 100) : 0,
    })),
    ...cop.imputed.map((i) => ({
      category: "IMPUTED" as const,
      label: `${i.label} (not cash)`,
      amountKes: i.amountKes,
      pctOfTotal: cop.full.totalKes > 0 ? money((i.amountKes / cop.full.totalKes) * 100) : 0,
    })),
  ].sort((a, b) => b.amountKes - a.amountKes);

  const benchmarkVerdict = benchmarkSentence(cop);
  const sentence = moneySentence(cop, margin, mix.blendedKes);

  const actions: string[] = [];
  if (cop.litresProduced <= 0) {
    actions.push("Record this month's milkings — nothing can be worked out until they are in.");
  } else {
    if (cop.full.perLitreKes > COST_OF_PRODUCTION_KES_PER_LITRE.high) {
      const worst = costsByCategory[0];
      actions.push(
        `Cut ${worst ? worst.label.toLowerCase() : "your biggest cost"} — it is ${worst ? Math.round(worst.pctOfTotal) : 0}% of what a litre costs you.`,
      );
    }
    if (margin.marginPerLitre <= 0) {
      actions.push("Stop buying concentrate for the lowest cows until the margin over feed is positive again.");
    }
    if (mix.lossL > 0) {
      actions.push(
        `Find where ${mix.lossL.toFixed(1)} L went — spillage and souring are the cheapest shillings on this farm to get back.`,
      );
    }
    if (mtd.pendingCount > 0) {
      actions.push(
        `Approve the ${mtd.pendingCount} waiting ${plural(mtd.pendingCount, "entry", "entries")} (${kes(mtd.pendingKes)}) — none of it counts until you do.`,
      );
    }
    if (actions.length === 0) {
      actions.push("Nothing needs fixing in the money this month. Keep recording every litre and every shilling.");
    }
  }

  return {
    month: from.slice(0, 7),
    from,
    to,
    litresProduced: cop.litresProduced,
    revenueByChannel,
    milkSoldKes: cop.revenue.milkSoldKes,
    milkImputedKes: cop.revenue.milkImputedKes,
    otherIncomeKes: cop.revenue.otherIncomeKes,
    totalRevenueKes: cop.revenue.totalKes,
    costsByCategory,
    cashCostKes: cop.cash.totalKes,
    fullCostKes: cop.full.totalKes,
    cashCostPerLitreKes: cop.cash.perLitreKes,
    cashCostLabel: cop.cash.label,
    fullCostPerLitreKes: cop.full.perLitreKes,
    fullCostLabel: cop.full.label,
    benchmark: {
      lowKes: cop.benchmark.lowKes,
      highKes: cop.benchmark.highKes,
      farmGateKes: FARM_GATE_BENCHMARK_KES,
    },
    benchmarkVerdict,
    marginOverFeed: {
      marginPerLitreKes: margin.marginPerLitre,
      marginKes: margin.marginKes,
      feedCostPerLitreKes: margin.feedCostPerLitre,
      revenuePerLitreKes: margin.revenuePerLitre,
      message: margin.message,
    },
    netKes: money(cop.revenue.totalKes - cop.full.totalKes),
    pendingCount: mtd.pendingCount,
    pendingKes: mtd.pendingKes,
    sentence,
    actions,
  };
}

/**
 * The Kenya Dairy Board line, said plainly.
 *
 * KDB puts full cost of production at KES 30–37 a litre against a farm-gate
 * price near 52. A farm outside that range is told so, in words, rather than
 * left to compare two numbers itself.
 */
function benchmarkSentence(cop: CostOfProduction): string {
  const { low, high } = COST_OF_PRODUCTION_KES_PER_LITRE;
  if (cop.litresProduced <= 0) {
    return `No milk recorded this month, so there is no cost per litre to compare with the Kenya Dairy Board range of KES ${low}–${high}.`;
  }
  const v = cop.full.perLitreKes;
  if (v > high) {
    return `A litre costs you ${kes(v, 2)}. That is ABOVE the Kenya Dairy Board range of KES ${low}–${high}, against a farm gate near KES ${FARM_GATE_BENCHMARK_KES} — you are keeping ${kes(FARM_GATE_BENCHMARK_KES - v, 2)} a litre where a well-run farm keeps ${kes(FARM_GATE_BENCHMARK_KES - high, 2)} or more.`;
  }
  if (v < low) {
    return `A litre costs you ${kes(v, 2)}, BELOW the Kenya Dairy Board range of KES ${low}–${high}. That is either very good or a sign some costs are not recorded — check every expense for the month is entered and approved.`;
  }
  return `A litre costs you ${kes(v, 2)}, INSIDE the Kenya Dairy Board range of KES ${low}–${high}, against a farm gate near KES ${FARM_GATE_BENCHMARK_KES}.`;
}

/** The one sentence that summarises the month. */
function moneySentence(cop: CostOfProduction, margin: MarginBreakdown, blendedKes: number): string {
  if (cop.litresProduced <= 0) {
    return "No milk was recorded this month, so there is nothing to report yet — record the milkings first.";
  }
  const net = money(cop.revenue.totalKes - cop.full.totalKes);
  const direction = net >= 0 ? "kept" : "lost";
  const price = blendedKes > 0 ? blendedKes : cop.revenue.perLitreKes;
  return (
    `You produced ${Math.round(cop.litresProduced)} L, sold it at about ${kes(price, 2)} a litre, ` +
    `spent ${kes(cop.full.perLitreKes, 2)} a litre to make it, and ${direction} ${kes(Math.abs(net))} — ` +
    `${margin.marginPerLitre > 0 ? `${kes(margin.marginPerLitre, 2)} a litre over feed` : "feed alone is costing more than the milk earns"}.`
  );
}

/* ================================================================== */
/* HEADLINE 2 — The cow league table                                   */
/* ================================================================== */

export interface LeagueRow {
  rank: number;
  animalId: string;
  tag: string;
  name: string | null;
  /** "Njeri (KE-1234)" — never a bare tag. The owner thinks in names. */
  who: string;
  classLabel: string;
  litres: number;
  dailyYieldL: number;
  milkRevenueKes: number;
  feedCostKes: number;
  vetCostKes: number;
  marginKes: number;
  marginPerMonthKes: number;
  losing: boolean;
  action: CullCandidate["action"];
  /** One sentence naming her and what to do about her. */
  recommendation: string;
}

export interface CowLeagueTable extends Conclusion {
  from: ISODate;
  to: ISODate;
  windowDays: number;
  pricePerLitreKes: number;
  herdSize: number;
  rows: LeagueRow[];
  /** Named. Always named. A loss-maker nobody can name is a loss-maker nobody culls. */
  lossMakers: LeagueRow[];
  lossMakerSharePct: number;
  totalLossKes: number;
  /** "Most dairies have 10–15% of their herd losing money." */
  expectedLossMakerSharePct: { low: number; high: number };
  bestCow: LeagueRow | null;
  worstCow: LeagueRow | null;
}

/**
 * "Most dairies have 10–15% of their herd losing money." Owned by M7, which is
 * where the cull decision lives — re-stated here would be two benchmarks.
 */

/**
 * Every cow ranked by margin, best first, loss-makers named, one recommended
 * action each.
 *
 * Composed from `cullList` (M7), which already attributes feed cost per animal
 * on the maintenance/production split and adds health cost. Re-deriving that
 * split here would give two different answers to the same question.
 */
export async function cowLeagueTable(
  session: Session,
  from: ISODate,
  to: ISODate,
  database?: Db,
): Promise<CowLeagueTable> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);
  const windowDays = Math.max(1, daysBetween(from, to) + 1);

  const list = await cullList(session, { asOf: to, windowDays }, db);

  // cullList sorts worst-first because it is a cull screen. A league table
  // reads best-first — the same numbers, the other way up.
  const ranked = [...list.candidates].sort(
    (a, b) => b.marginKes - a.marginKes || a.tag.localeCompare(b.tag),
  );

  const rows: LeagueRow[] = ranked.map((c, i) => ({
    rank: i + 1,
    animalId: c.animalId,
    tag: c.tag,
    name: c.name,
    who: c.name ? `${c.name} (${c.tag})` : c.tag,
    classLabel: c.classLabel,
    litres: c.litres,
    dailyYieldL: c.dailyYieldL,
    milkRevenueKes: c.milkRevenueKes,
    feedCostKes: c.feedCostKes,
    vetCostKes: c.vetCostKes,
    marginKes: c.marginKes,
    marginPerMonthKes: c.marginPerMonthKes,
    losing: c.losing,
    action: c.action,
    recommendation: c.recommendation,
  }));

  const lossMakers = rows.filter((r) => r.losing);
  const bestCow = rows[0] ?? null;
  const worstCow = rows.at(-1) ?? null;

  let sentence: string;
  if (rows.length === 0) {
    sentence = "There are no animals on the farm yet, so there is nothing to rank.";
  } else if (lossMakers.length === 0) {
    sentence = `All ${rows.length} ${plural(rows.length, "animal")} covered feed and vet cost over the last ${windowDays} days${bestCow ? `, ${bestCow.who} best at ${kes(bestCow.marginPerMonthKes)} a month` : ""}.`;
  } else {
    sentence =
      `${lossMakers.length} of your ${rows.length} animals are losing money — ${kes(Math.abs(list.totalLossKes))} over ${windowDays} days. ` +
      `Most dairies sit at ${EXPECTED_LOSS_MAKER_SHARE_PCT.low}–${EXPECTED_LOSS_MAKER_SHARE_PCT.high}%; you are at ${Math.round(list.lossMakerSharePct)}%.`;
  }

  const actions = lossMakers.slice(0, 5).map((r) => r.recommendation);
  if (actions.length === 0 && bestCow) {
    actions.push(`Keep doing what you are doing for ${bestCow.who} — she is your best earner.`);
  }
  if (list.pricePerLitreKes > 0 && rows.length > 0) {
    actions.push(
      `These margins use ${kes(list.pricePerLitreKes, 2)} a litre, what your milk actually fetched over the period.`,
    );
  }

  return {
    from,
    to,
    windowDays,
    pricePerLitreKes: list.pricePerLitreKes,
    herdSize: rows.length,
    rows,
    lossMakers,
    lossMakerSharePct: list.lossMakerSharePct,
    totalLossKes: list.totalLossKes,
    expectedLossMakerSharePct: EXPECTED_LOSS_MAKER_SHARE_PCT,
    bestCow,
    worstCow,
    sentence,
    actions,
  };
}

/* ================================================================== */
/* HEADLINE 3 — What needs doing this week                             */
/* ================================================================== */

export type TaskSource = "BREEDING" | "HEALTH" | "FEED" | "MILK" | "PEOPLE" | "MONEY";

export interface WeekTask {
  source: TaskSource;
  kind: string;
  /** WHO. A role, so it can be read out at the morning briefing. */
  who: s.Role;
  whoLabel: string;
  /** WHICH ANIMAL — or the thing standing in for one (a feed, a person). */
  subject: string;
  animalId: string | null;
  /** WHAT ACTION. Imperative, one line. */
  action: string;
  /** BY WHEN. */
  dueOn: ISODate;
  dueLabel: string;
  daysOverdue: number;
  severity: "INFO" | "WARN" | "CRITICAL";
  detail: string | null;
}

export interface WeekPlan extends Conclusion {
  asOf: ISODate;
  through: ISODate;
  tasks: WeekTask[];
  bySource: Record<TaskSource, number>;
  overdueCount: number;
  criticalCount: number;
}

const ROLE_LABEL: Record<s.Role, string> = {
  OWNER: "You",
  MANAGER: "The manager",
  HERDSMAN: "The herdsman",
  RIDER: "The rider",
  VET: "The vet",
  ACCOUNTANT: "The bookkeeper",
};

const SEVERITY_RANK: Record<"INFO" | "WARN" | "CRITICAL", number> = {
  CRITICAL: 0,
  WARN: 1,
  INFO: 2,
};

/**
 * The consolidated action list across breeding, health, feed and people.
 *
 * One line each: who, which animal, what action, by when. This is the report
 * the acceptance test is written against — an owner shown this screen can say
 * what to do this week without reading a number twice.
 */
export async function whatNeedsDoingThisWeek(
  session: Session,
  asOf: ISODate = today(),
  database?: Db,
): Promise<WeekPlan> {
  const db = await resolveDb(database);
  const through = addDays(asOf, 7);
  const seesMoney = can(session.role, "VIEW_MONEY");

  const [watch, routines, withdrawals, store] = await Promise.all([
    breedingWatchboard(session, asOf),
    dueRoutines(session, asOf, db),
    withdrawalBoard(session, asOf, db),
    feedStore(session, asOf, db),
  ]);

  const tasks: WeekTask[] = [];

  /* Breeding — the module that pays for the system. */
  for (const w of watch.all) {
    tasks.push({
      source: "BREEDING",
      kind: w.kind,
      who: w.kind === "CALVING_DUE" ? "HERDSMAN" : "MANAGER",
      whoLabel: ROLE_LABEL[w.kind === "CALVING_DUE" ? "HERDSMAN" : "MANAGER"],
      subject: w.name ?? w.tag,
      animalId: w.animalId,
      action: w.action,
      dueOn: w.dueOn,
      dueLabel: dueLabelFor(w.dueOn, asOf),
      daysOverdue: w.daysOverdue,
      severity: w.severity,
      detail: w.detail,
    });
  }

  /* Health — routines due, and the milk that must not be sold. */
  for (const r of routines) {
    tasks.push({
      source: "HEALTH",
      kind: `ROUTINE_${r.routine}`,
      who: "HERDSMAN",
      whoLabel: ROLE_LABEL.HERDSMAN,
      subject: r.animalName,
      animalId: r.animalId,
      action: `Give ${r.animalName} her ${r.label.toLowerCase()}.`,
      dueOn: r.dueOn,
      dueLabel: dueLabelFor(r.dueOn, asOf),
      daysOverdue: r.overdueDays,
      severity: r.overdueDays > 14 ? "CRITICAL" : r.overdueDays > 0 ? "WARN" : "INFO",
      detail: r.note ?? null,
    });
  }

  for (const w of withdrawals) {
    if (!w.milkBlocked || !w.milkClearOn) continue;
    tasks.push({
      source: "HEALTH",
      kind: "WITHDRAWAL_CLEAR",
      who: "HERDSMAN",
      whoLabel: ROLE_LABEL.HERDSMAN,
      subject: w.animalName,
      animalId: w.animalId,
      action: `Keep ${w.animalName}'s milk out of the can until ${formatDay(w.milkClearOn)}.`,
      dueOn: w.milkClearOn,
      dueLabel: dueLabelFor(w.milkClearOn, asOf),
      daysOverdue: 0,
      severity: "CRITICAL",
      detail: w.plainMessage,
    });
  }

  /* Feed — what runs out inside the week. */
  for (const line of store) {
    const days = line.cover.daysOfCover;
    if (days === null || days > 7) continue;
    tasks.push({
      source: "FEED",
      kind: "LOW_FEED_STOCK",
      who: "MANAGER",
      whoLabel: ROLE_LABEL.MANAGER,
      subject: line.name,
      animalId: null,
      action: `Buy ${line.name} — ${line.cover.message.toLowerCase()}`,
      dueOn: addDays(asOf, Math.max(0, days - 1)),
      dueLabel: dueLabelFor(addDays(asOf, Math.max(0, days - 1)), asOf),
      daysOverdue: days <= 0 ? 1 : 0,
      severity: days <= 3 ? "CRITICAL" : "WARN",
      detail: line.line,
    });
  }

  /* People and money — the owner's side of the week. A herdsman never sees it. */
  if (seesMoney) {
    const casuals = await casualConversionWatch(session, asOf, db);
    for (const c of casuals) {
      tasks.push({
        source: "PEOPLE",
        kind: "CASUAL_CONVERSION",
        who: "OWNER",
        whoLabel: ROLE_LABEL.OWNER,
        subject: c.fullName,
        animalId: null,
        action: c.warning.converted
          ? `Put ${c.fullName} on a written term contract — in law they already are one.`
          : `Decide about ${c.fullName} before day 30 — a break or a contract.`,
        dueOn: asOf,
        dueLabel: dueLabelFor(asOf, asOf),
        daysOverdue: c.warning.converted ? 1 : 0,
        severity: c.warning.converted ? "CRITICAL" : "WARN",
        detail: c.warning.message ?? null,
      });
    }

    const docs = await expiringDocuments(session, asOf, 30, db);
    for (const d of docs) {
      tasks.push({
        source: "MONEY",
        kind: "COMPLIANCE_EXPIRY",
        who: "OWNER",
        whoLabel: ROLE_LABEL.OWNER,
        subject: d.label,
        animalId: null,
        action: d.action,
        dueOn: d.expiresOn,
        dueLabel: dueLabelFor(d.expiresOn, asOf),
        daysOverdue: Math.max(0, -d.daysLeft),
        severity: d.daysLeft <= 0 ? "CRITICAL" : d.daysLeft <= 14 ? "WARN" : "INFO",
        detail: d.detail,
      });
    }
  }

  tasks.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.daysOverdue - a.daysOverdue ||
      a.dueOn.localeCompare(b.dueOn) ||
      a.subject.localeCompare(b.subject),
  );

  const bySource: Record<TaskSource, number> = {
    BREEDING: 0, HEALTH: 0, FEED: 0, MILK: 0, PEOPLE: 0, MONEY: 0,
  };
  for (const t of tasks) bySource[t.source] += 1;

  const overdueCount = tasks.filter((t) => t.daysOverdue > 0).length;
  const criticalCount = tasks.filter((t) => t.severity === "CRITICAL").length;

  let sentence: string;
  if (tasks.length === 0) {
    sentence = "Nothing is waiting this week. Every cow, every routine and every feed store is where it should be.";
  } else {
    const top = tasks[0];
    sentence =
      `${tasks.length} ${plural(tasks.length, "thing")} to do this week, ${criticalCount} of them urgent. ` +
      `Start with ${top.subject}: ${top.action}`;
  }

  return {
    asOf,
    through,
    tasks,
    bySource,
    overdueCount,
    criticalCount,
    sentence,
    actions: tasks.slice(0, 10).map((t) => `${t.whoLabel}: ${t.action} (${t.dueLabel})`),
  };
}

function dueLabelFor(dueOn: ISODate, asOf: ISODate): string {
  const d = daysBetween(asOf, dueOn);
  if (d < 0) return `${Math.abs(d)} ${plural(Math.abs(d), "day")} late`;
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d <= 7) return formatDay(dueOn);
  return `by ${formatDay(dueOn)}`;
}

/* ================================================================== */
/* Compliance documents — six-month certificates need a sweep, not a   */
/* yearly checklist                                                    */
/* ================================================================== */

export interface ExpiringDocument {
  id: string;
  docType: string;
  label: string;
  referenceNo: string | null;
  holderName: string | null;
  expiresOn: ISODate;
  daysLeft: number;
  action: string;
  detail: string;
}

const DOC_LABEL: Record<string, string> = {
  KDB_PERMIT: "Kenya Dairy Board permit",
  MILK_TRANSPORT_PERMIT: "Milk transport permit",
  COUNTY_BUSINESS_PERMIT: "County business permit",
  FOOD_HANDLER_CERT: "Food handler certificate",
  TAX_COMPLIANCE_CERT: "Tax compliance certificate",
  AGPO_CERT: "AGPO certificate",
  MILK_BAR_LICENCE: "Milk bar licence",
  COOLING_FACILITY_PERMIT: "Cooling facility permit",
};

/**
 * Documents expiring inside `withinDays`.
 *
 * A food handler certificate is valid SIX months. Anything checked once a year
 * is expired for half of it, which is why this is a sweep and not a checklist.
 */
export async function expiringDocuments(
  session: Session,
  asOf: ISODate = today(),
  withinDays = 30,
  database?: Db,
): Promise<ExpiringDocument[]> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);
  const horizon = addDays(asOf, withinDays);

  const rows = await db
    .select({ doc: s.complianceDocument, holder: s.employee.fullName })
    .from(s.complianceDocument)
    .leftJoin(s.employee, eq(s.employee.id, s.complianceDocument.holderEmployeeId))
    .where(
      and(
        eq(s.complianceDocument.farmId, session.farmId),
        lte(s.complianceDocument.expiresOn, horizon),
      ),
    );

  return rows
    .map(({ doc, holder }) => {
      const label = DOC_LABEL[doc.docType] ?? doc.docType;
      const daysLeft = daysBetween(asOf, doc.expiresOn);
      const whose = holder ? `${holder}'s ` : "The farm's ";
      return {
        id: doc.id,
        docType: doc.docType,
        label: holder ? `${label} — ${holder}` : label,
        referenceNo: doc.referenceNo,
        holderName: holder ?? null,
        expiresOn: doc.expiresOn as ISODate,
        daysLeft,
        action:
          daysLeft <= 0
            ? `Renew ${whose.toLowerCase()}${label.toLowerCase()} — it expired ${formatDay(doc.expiresOn as ISODate)}.`
            : `Renew ${whose.toLowerCase()}${label.toLowerCase()} before ${formatDay(doc.expiresOn as ISODate)}.`,
        detail:
          doc.docType === "FOOD_HANDLER_CERT"
            ? "Food handler certificates last six months, not a year."
            : `Expires ${doc.expiresOn}.`,
      };
    })
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
}

/* ================================================================== */
/* Standard set — milk production                                      */
/* ================================================================== */

export interface MilkDayRow {
  date: ISODate;
  dayLabel: string;
  totalL: number;
  saleableL: number;
  withheldL: number;
  bySession: Array<{ session: s.MilkingSession; litres: number }>;
}

export interface MilkCowRow {
  animalId: string;
  tag: string;
  name: string;
  litres: number;
  dailyAverageL: number;
  sharePct: number;
}

export interface MilkProductionReport extends Conclusion {
  from: ISODate;
  to: ISODate;
  days: number;
  totalL: number;
  dailyAverageL: number;
  perDay: MilkDayRow[];
  perMonth: Array<{ month: string; litres: number; dailyAverageL: number }>;
  perCow: MilkCowRow[];
  lactationCurves: Array<Awaited<ReturnType<typeof lactationCurve>>>;
  bestDay: MilkDayRow | null;
  worstDay: MilkDayRow | null;
}

/**
 * Daily, monthly and per-cow production, with lactation curves on request.
 *
 * Composed from `dayProduction` (M3) a day at a time so the session split and
 * the withheld litres are the same numbers the milking screen shows.
 */
export async function milkProduction(
  session: Session,
  from: ISODate,
  to: ISODate,
  opts: { animalIds?: string[] } = {},
  database?: Db,
): Promise<MilkProductionReport> {
  const db = await resolveDb(database);
  const dates = dateRange(from, to);

  const perDay: MilkDayRow[] = [];
  for (const date of dates) {
    const d = await dayProduction(session, date, db);
    if (d.totalL === 0 && d.bySession.length === 0) continue;
    perDay.push({
      date,
      dayLabel: formatDay(date),
      totalL: d.totalL,
      saleableL: d.saleableL,
      withheldL: money(d.withheldL + d.colostrumL),
      bySession: d.bySession,
    });
  }

  const totalL = money(perDay.reduce((a, d) => a + d.totalL, 0));
  const days = dates.length;
  const dailyAverageL = days > 0 ? money(totalL / days) : 0;

  const monthMap = new Map<string, number>();
  for (const d of perDay) {
    const m = d.date.slice(0, 7);
    monthMap.set(m, money((monthMap.get(m) ?? 0) + d.totalL));
  }
  const perMonth = [...monthMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, litres]) => {
      const start = `${month}-01` as ISODate;
      const n = dateRange(
        start > from ? start : from,
        endOfMonth(start) < to ? endOfMonth(start) : to,
      ).length;
      return { month, litres, dailyAverageL: n > 0 ? money(litres / n) : 0 };
    });

  /* Per cow — one grouped read, because a per-animal loop over a month of
     records is the query that makes a report screen time out. */
  const rows = await db
    .select({
      id: s.milkRecord.id,
      animalId: s.milkRecord.animalId,
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
        lte(s.milkRecord.recordedOn, to),
      ),
    );
  const superseded = new Set(rows.map((r) => r.supersedesId).filter(Boolean) as string[]);
  const cowMap = new Map<string, MilkCowRow>();
  for (const r of rows) {
    if (superseded.has(r.id)) continue;
    const cur =
      cowMap.get(r.animalId) ??
      {
        animalId: r.animalId,
        tag: r.tag,
        name: r.name ?? r.tag,
        litres: 0,
        dailyAverageL: 0,
        sharePct: 0,
      };
    cur.litres = money(cur.litres + num(r.litres));
    cowMap.set(r.animalId, cur);
  }
  const perCow = [...cowMap.values()]
    .map((c) => ({
      ...c,
      dailyAverageL: days > 0 ? money(c.litres / days) : 0,
      sharePct: totalL > 0 ? money((c.litres / totalL) * 100) : 0,
    }))
    .sort((a, b) => b.litres - a.litres);

  const lactationCurves = [];
  for (const id of opts.animalIds ?? []) {
    lactationCurves.push(await lactationCurve(session, id, to, db));
  }

  const sorted = [...perDay].sort((a, b) => b.totalL - a.totalL);
  const bestDay = sorted[0] ?? null;
  const worstDay = sorted.at(-1) ?? null;

  let sentence: string;
  if (totalL === 0) {
    sentence = "No milk was recorded for this period.";
  } else {
    const top = perCow[0];
    sentence =
      `${Math.round(totalL)} L over ${days} ${plural(days, "day")}, averaging ${dailyAverageL.toFixed(1)} L a day from ${perCow.length} ${plural(perCow.length, "cow")}` +
      (top ? `, ${top.name} giving the most at ${top.dailyAverageL.toFixed(1)} L a day.` : ".");
  }

  const actions: string[] = [];
  const withheld = money(perDay.reduce((a, d) => a + d.withheldL, 0));
  if (withheld > 0) {
    actions.push(
      `${withheld.toFixed(1)} L was withheld — check every withdrawal is over before that milk is sold again.`,
    );
  }
  const tail = perCow.filter((c) => c.dailyAverageL > 0 && c.dailyAverageL < 6);
  if (tail.length > 0) {
    actions.push(
      `${tail.length} ${plural(tail.length, "cow")} ${tail.length === 1 ? "is" : "are"} under 6 L a day (${tail.map((c) => c.name).join(", ")}) — check the ration before blaming the cow.`,
    );
  }
  if (bestDay && worstDay && bestDay.totalL > 0 && worstDay.totalL < bestDay.totalL * 0.7) {
    actions.push(
      `Production swings from ${worstDay.totalL.toFixed(1)} L on ${worstDay.dayLabel} to ${bestDay.totalL.toFixed(1)} L on ${bestDay.dayLabel} — a swing that big is usually a missed milking record, not a missed milking.`,
    );
  }
  if (actions.length === 0) actions.push("Production is steady. Keep recording both milkings every day.");

  return {
    from, to, days, totalL, dailyAverageL,
    perDay, perMonth, perCow, lactationCurves,
    bestDay, worstDay,
    sentence, actions,
  };
}

/* ================================================================== */
/* Standard set — breeding performance                                 */
/* ================================================================== */

export interface KpiLine {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  targetValue: number;
  acceptableValue: number;
  /** Whether the farm is on target. Stated, never left to the reader. */
  onTarget: boolean | null;
  verdict: string;
}

export interface BreedingPerformanceReport extends Conclusion {
  from: ISODate;
  to: ISODate;
  kpis: KpiLine[];
  calvingIntervals: Array<{ animalId: string; who: string; days: number }>;
  daysOpen: Array<{ animalId: string; who: string; days: number }>;
  ageAtFirstCalving: Array<{ animalId: string; who: string; months: number }>;
  servicesInPeriod: number;
  conceptionsInPeriod: number;
  heatsObserved: number;
  heatsExpected: number;
  /** What a long calving interval costs, in the only unit that moves a farmer. */
  calvingIntervalCostKes: number;
}

/**
 * Breeding KPIs against `REPRO_BENCHMARKS`, each with a plain verdict.
 *
 * The events come from `loadHerdSources` (M1) — one read for the whole herd —
 * and every rule applied to them is a pure function from `domain/breeding.ts`.
 */
export async function breedingPerformance(
  session: Session,
  from: ISODate,
  to: ISODate,
): Promise<BreedingPerformanceReport> {
  const { animals, events } = await loadHerdSources(session);

  const calvingIntervals: BreedingPerformanceReport["calvingIntervals"] = [];
  const daysOpenRows: BreedingPerformanceReport["daysOpen"] = [];
  const afcRows: BreedingPerformanceReport["ageAtFirstCalving"] = [];

  let servicesInPeriod = 0;
  let conceptionsInPeriod = 0;
  let heatsObserved = 0;
  let eligibleCowDays = 0;

  for (const a of animals) {
    const ev = events.get(a.id);
    if (!ev || a.sex === "M") continue;
    const who = a.name ? `${a.name} (${a.tag})` : a.tag;

    const calvings = ev.calvings
      .filter((c) => c.calvedOn <= to)
      .sort((x, y) => x.calvedOn.localeCompare(y.calvedOn));

    // Calving interval — counted on the LATER calving falling in the period.
    for (let i = 1; i < calvings.length; i++) {
      const later = calvings[i].calvedOn as ISODate;
      if (later < from || later > to) continue;
      calvingIntervals.push({
        animalId: a.id,
        who,
        days: calvingInterval(calvings[i - 1].calvedOn as ISODate, later),
      });
    }

    // Age at first calving.
    const first = calvings[0];
    if (first && a.dateOfBirth && first.calvedOn >= from && first.calvedOn <= to) {
      afcRows.push({
        animalId: a.id,
        who,
        months: money(ageAtFirstCalvingMonths(a.dateOfBirth as ISODate, first.calvedOn as ISODate)),
      });
    }

    // Days open — last calving to the conception that followed it.
    const lastCalving = calvings.at(-1)?.calvedOn as ISODate | undefined;
    if (lastCalving) {
      const conceived = ev.services
        .filter((v) => v.servedOn >= lastCalving && v.servedOn <= to)
        .find((v) =>
          ev.pds.some(
            (p) => p.result === "POSITIVE" && p.checkedOn >= v.servedOn && p.checkedOn <= to,
          ),
        );
      if (conceived && conceived.servedOn >= from && conceived.servedOn <= to) {
        daysOpenRows.push({
          animalId: a.id,
          who,
          days: daysBetween(lastCalving, conceived.servedOn as ISODate),
        });
      }
    }

    servicesInPeriod += ev.services.filter((v) => v.servedOn >= from && v.servedOn <= to).length;
    conceptionsInPeriod += ev.pds.filter(
      (p) => p.result === "POSITIVE" && p.checkedOn >= from && p.checkedOn <= to,
    ).length;
    heatsObserved += ev.heats.filter((h) => {
      const d = h.observedAt.toISOString().slice(0, 10);
      return d >= from && d <= to;
    }).length;

    // Heat detection needs a denominator: the days she was cycling and open.
    const facts = factsFor(a, ev, to);
    const cls = deriveClass(facts, to);
    const status = deriveReproStatus(facts, to);
    const cycling =
      (status === "OPEN" || status === "FRESH") &&
      (cls === "BULLING_HEIFER" || cls === "LACTATING_COW" || cls === "MATURE_COW" || cls === "FIRST_CALVER");
    if (cycling && !ev.exits.some((e) => e.exitDate <= to)) {
      eligibleCowDays += daysBetween(from, to) + 1;
    }
  }

  const avg = (xs: number[]) =>
    xs.length === 0 ? null : money(xs.reduce((a, b) => a + b, 0) / xs.length);

  const avgCI = avg(calvingIntervals.map((r) => r.days));
  const avgDaysOpen = avg(daysOpenRows.map((r) => r.days));
  const avgAfc = avg(afcRows.map((r) => r.months));
  const spc = conceptionsInPeriod > 0 ? money(spcOf(servicesInPeriod, conceptionsInPeriod)) : null;
  const conceptionRate =
    servicesInPeriod > 0 ? money((conceptionsInPeriod / servicesInPeriod) * 100) : null;
  const heatsExpected = Math.round(eligibleCowDays / CYCLE_DAYS);
  const heatDetection = heatsExpected > 0 ? money((heatsObserved / heatsExpected) * 100) : null;

  const B = REPRO_BENCHMARKS;
  const kpis: KpiLine[] = [
    lowerIsBetter("calvingInterval", "Calving interval", avgCI, "days", B.calvingIntervalDays.target, B.calvingIntervalDays.acceptable,
      "Every day past target is a day of feed with no calf and thinning milk."),
    lowerIsBetter("daysOpen", "Days open", avgDaysOpen, "days", B.daysOpenDays.target, B.daysOpenDays.acceptable,
      "Days open is the calving interval you will get next year, seen early."),
    lowerIsBetter("ageAtFirstCalving", "Age at first calving", avgAfc, "months", B.ageAtFirstCalvingMonths.target, B.ageAtFirstCalvingMonths.acceptable,
      `Kenyan farms average ${B.ageAtFirstCalvingMonths.kenyanObserved} months — every month early is a month of milk instead of feed.`),
    lowerIsBetter("servicesPerConception", "Services per conception", spc, "services", B.servicesPerConception.target, B.servicesPerConception.acceptable,
      "Each extra straw is money and three more weeks empty."),
    higherIsBetter("conceptionRate", "Conception rate", conceptionRate, "%", B.conceptionRatePct.target, B.conceptionRatePct.acceptable,
      "Below target usually means timing, not the bull."),
    higherIsBetter("heatDetection", "Heat detection rate", heatDetection, "%", B.heatDetectionRatePct.target, B.heatDetectionRatePct.acceptable,
      "Heat detection below 50% is the single biggest reproductive loss on Kenyan farms — and it is free to fix."),
  ];

  const ciCost = avgCI ? calvingIntervalCostKes(avgCI).costKes : 0;

  const offTarget = kpis.filter((k) => k.onTarget === false);
  let sentence: string;
  if (kpis.every((k) => k.value === null)) {
    sentence = "There are not enough breeding records in this period to work out how the herd is doing.";
  } else if (offTarget.length === 0) {
    sentence = "Every breeding number that could be worked out is on target. Keep serving on the AM/PM rule and keep watching for heat.";
  } else {
    sentence = `${offTarget.length} of ${kpis.filter((k) => k.value !== null).length} breeding numbers are off target — worst is ${offTarget[0].label.toLowerCase()} at ${offTarget[0].value} ${offTarget[0].unit} against a target of ${offTarget[0].targetValue}.`;
  }

  const actions = offTarget.map((k) => k.verdict);
  if (ciCost > 0) {
    actions.push(
      `A calving interval of ${Math.round(avgCI!)} days is costing about ${kes(ciCost)} a cow a year in milk you never see.`,
    );
  }
  if (actions.length === 0) actions.push("Nothing to change in breeding this period.");

  return {
    from, to, kpis,
    calvingIntervals: calvingIntervals.sort((a, b) => b.days - a.days),
    daysOpen: daysOpenRows.sort((a, b) => b.days - a.days),
    ageAtFirstCalving: afcRows.sort((a, b) => b.months - a.months),
    servicesInPeriod,
    conceptionsInPeriod,
    heatsObserved,
    heatsExpected,
    calvingIntervalCostKes: ciCost,
    sentence,
    actions,
  };
}

function lowerIsBetter(
  key: string, label: string, value: number | null, unit: string,
  target: number, acceptable: number, why: string,
): KpiLine {
  if (value === null) {
    return { key, label, value, unit, targetValue: target, acceptableValue: acceptable, onTarget: null,
      verdict: `Not enough records yet to work out ${label.toLowerCase()}.` };
  }
  const onTarget = value <= acceptable;
  return {
    key, label, value, unit, targetValue: target, acceptableValue: acceptable, onTarget,
    verdict: onTarget
      ? `${label} is ${value} ${unit} — on target (aim for ${target}). ${why}`
      : `${label} is ${value} ${unit}, above the ${acceptable} you should accept. Aim for ${target}. ${why}`,
  };
}

function higherIsBetter(
  key: string, label: string, value: number | null, unit: string,
  target: number, acceptable: number, why: string,
): KpiLine {
  if (value === null) {
    return { key, label, value, unit, targetValue: target, acceptableValue: acceptable, onTarget: null,
      verdict: `Not enough records yet to work out ${label.toLowerCase()}.` };
  }
  const onTarget = value >= acceptable;
  return {
    key, label, value, unit, targetValue: target, acceptableValue: acceptable, onTarget,
    verdict: onTarget
      ? `${label} is ${value}${unit === "%" ? "%" : ` ${unit}`} — on target (aim for ${target}${unit === "%" ? "%" : ""}). ${why}`
      : `${label} is ${value}${unit === "%" ? "%" : ` ${unit}`}, below the ${acceptable}${unit === "%" ? "%" : ""} you should accept. Aim for ${target}${unit === "%" ? "%" : ""}. ${why}`,
  };
}

/* ================================================================== */
/* Standard set — health                                               */
/* ================================================================== */

export interface TreatmentRow {
  id: string;
  occurredOn: ISODate;
  animalId: string;
  who: string;
  eventType: string;
  title: string;
  productName: string | null;
  costKes: number;
  milkClearOn: ISODate | null;
}

export interface HealthReport extends Conclusion {
  from: ISODate;
  to: ISODate;
  treatments: TreatmentRow[];
  treatmentCostKes: number;
  /** Every litre thrown away because of a withdrawal or colostrum. */
  withdrawalLog: WithdrawalBoardRow[];
  litresDiscarded: number;
  litresDiscardedKes: number;
  /** Routines given vs routines due — compliance, stated as a percentage. */
  vaccinationCompliancePct: number;
  routinesGiven: number;
  routinesOverdue: DueRoutine[];
  /** Disease incidence: how many animals had each diagnosis, per 100 head. */
  diseaseIncidence: Array<{ diagnosis: string; cases: number; animals: number; per100Head: number }>;
  herdSize: number;
}

export async function healthReport(
  session: Session,
  from: ISODate,
  to: ISODate,
  database?: Db,
): Promise<HealthReport> {
  const db = await resolveDb(database);

  const [events, board, overdue, mix, herd] = await Promise.all([
    db
      .select({
        id: s.healthEvent.id,
        occurredOn: s.healthEvent.occurredOn,
        animalId: s.healthEvent.animalId,
        eventType: s.healthEvent.eventType,
        diagnosis: s.healthEvent.diagnosis,
        routine: s.healthEvent.routine,
        costKes: s.healthEvent.costKes,
        milkClearAt: s.healthEvent.milkClearAt,
        productName: s.product.name,
        tag: s.animal.tag,
        name: s.animal.name,
      })
      .from(s.healthEvent)
      .innerJoin(s.animal, eq(s.animal.id, s.healthEvent.animalId))
      .leftJoin(s.product, eq(s.product.id, s.healthEvent.productId))
      .where(
        and(
          eq(s.healthEvent.farmId, session.farmId),
          gte(s.healthEvent.occurredOn, from),
          lte(s.healthEvent.occurredOn, to),
        ),
      )
      .orderBy(desc(s.healthEvent.occurredOn)),
    withdrawalBoard(session, to, db),
    dueRoutines(session, to, db),
    channelMix(session, from, to, db),
    listHerd(session, { asOf: to }),
  ]);

  const treatments: TreatmentRow[] = events.map((e) => ({
    id: e.id,
    occurredOn: e.occurredOn as ISODate,
    animalId: e.animalId,
    who: e.name ? `${e.name} (${e.tag})` : e.tag,
    eventType: e.eventType,
    title: e.routine ?? e.diagnosis ?? e.productName ?? e.eventType,
    productName: e.productName ?? null,
    costKes: num(e.costKes),
    milkClearOn: e.milkClearAt ? (e.milkClearAt.toISOString().slice(0, 10) as ISODate) : null,
  }));

  const treatmentCostKes = money(treatments.reduce((a, t) => a + t.costKes, 0));

  const withheldLines = mix.lines.filter(
    (l) => l.channel === "WITHHELD_TREATMENT" || l.channel === "WITHHELD_COLOSTRUM",
  );
  const litresDiscarded = money(withheldLines.reduce((a, l) => a + l.litres, 0));
  const litresDiscardedKes = money(litresDiscarded * (mix.blendedKes || 0));

  const routinesGiven = events.filter((e) => e.routine).length;
  const vaccinationCompliancePct =
    routinesGiven + overdue.length > 0
      ? money((routinesGiven / (routinesGiven + overdue.length)) * 100)
      : 100;

  const diseaseMap = new Map<string, { cases: number; animals: Set<string> }>();
  for (const e of events) {
    const key = (e.diagnosis ?? "").trim();
    if (!key) continue;
    const cur = diseaseMap.get(key) ?? { cases: 0, animals: new Set<string>() };
    cur.cases += 1;
    cur.animals.add(e.animalId);
    diseaseMap.set(key, cur);
  }
  const herdSize = herd.total;
  const diseaseIncidence = [...diseaseMap.entries()]
    .map(([diagnosis, v]) => ({
      diagnosis,
      cases: v.cases,
      animals: v.animals.size,
      per100Head: herdSize > 0 ? money((v.animals.size / herdSize) * 100) : 0,
    }))
    .sort((a, b) => b.cases - a.cases);

  let sentence: string;
  if (events.length === 0 && overdue.length === 0) {
    sentence = "Nothing was treated and nothing is overdue this period. That is either a healthy herd or an unrecorded one — check the treatment book.";
  } else {
    const worst = diseaseIncidence[0];
    sentence =
      `${treatments.length} health ${plural(treatments.length, "record")} costing ${kes(treatmentCostKes)}` +
      (litresDiscarded > 0 ? `, ${litresDiscarded.toFixed(1)} L thrown away (${kes(litresDiscardedKes)})` : "") +
      (worst ? `, most of it ${worst.diagnosis.toLowerCase()} in ${worst.animals} ${plural(worst.animals, "animal")}` : "") +
      `. ${overdue.length} ${plural(overdue.length, "routine")} ${overdue.length === 1 ? "is" : "are"} overdue.`;
  }

  const actions: string[] = [];
  const blocked = board.filter((b) => b.milkBlocked);
  for (const b of blocked.slice(0, 5)) {
    actions.push(b.plainMessage ?? `Keep ${b.animalName}'s milk out of the can.`);
  }
  for (const r of overdue.slice(0, 5)) {
    actions.push(`Give ${r.animalName} her ${r.label.toLowerCase()} — ${r.overdueDays} ${plural(r.overdueDays, "day")} overdue.`);
  }
  if (diseaseIncidence[0] && diseaseIncidence[0].animals > 1) {
    actions.push(
      `${diseaseIncidence[0].diagnosis} has hit ${diseaseIncidence[0].animals} animals — that is a shed problem, not a cow problem.`,
    );
  }
  if (actions.length === 0) actions.push("Nothing outstanding in health this period.");

  return {
    from, to, treatments, treatmentCostKes,
    withdrawalLog: board, litresDiscarded, litresDiscardedKes,
    vaccinationCompliancePct, routinesGiven, routinesOverdue: overdue,
    diseaseIncidence, herdSize,
    sentence, actions,
  };
}

/* ================================================================== */
/* Standard set — feed                                                 */
/* ================================================================== */

export interface FeedReport extends Conclusion {
  from: ISODate;
  to: ISODate;
  margin: MarginBreakdown;
  store: StoreLine[];
  consumption: Array<{ feedItemId: string; name: string; kg: number; costKes: number; costPerLitreKes: number }>;
  feedCostPerLitreKes: number;
  runningOut: StoreLine[];
}

export async function feedReport(
  session: Session,
  from: ISODate,
  to: ISODate,
  database?: Db,
): Promise<FeedReport> {
  const db = await resolveDb(database);
  const [margin, store] = await Promise.all([
    marginOverFeedCost(session, from, to, db),
    feedStore(session, to, db),
  ]);

  const consumption = margin.perFeed.map((f) => ({
    ...f,
    costPerLitreKes: margin.litres > 0 ? money(f.costKes / margin.litres) : 0,
  }));

  const runningOut = store.filter((l) => l.cover.daysOfCover !== null && l.cover.daysOfCover <= 7);

  const sentence =
    margin.litres > 0
      ? `Feed cost ${kes(margin.feedCostPerLitre, 2)} of every litre you produced, leaving ${kes(margin.marginPerLitre, 2)} a litre over feed — ${kes(margin.marginKes)} for the period.`
      : "No milk was recorded for this period, so feed cost per litre cannot be worked out.";

  const actions: string[] = [];
  for (const l of runningOut) actions.push(`Buy ${l.name} — ${l.cover.message.toLowerCase()}`);
  if (margin.uncostedFeeds.length > 0) {
    actions.push(
      `${margin.uncostedFeeds.join(", ")} ${margin.uncostedFeeds.length === 1 ? "has" : "have"} no purchase price on file, so this margin flatters you. Record what they cost, or what they would cost to buy.`,
    );
  }
  if (margin.marginPerLitre <= 0 && margin.litres > 0) {
    actions.push("Feed is costing more than the milk earns. Cut concentrate to the lowest cows first, not to the whole herd.");
  }
  if (actions.length === 0) actions.push("Feed stocks and feed cost are both where they should be.");

  return {
    from, to, margin, store, consumption,
    feedCostPerLitreKes: margin.feedCostPerLitre,
    runningOut,
    sentence, actions,
  };
}

/* ================================================================== */
/* Standard set — herd inventory movement                              */
/* ================================================================== */

export interface HerdInventoryReport extends Conclusion {
  from: ISODate;
  to: ISODate;
  opening: number;
  births: number;
  purchases: number;
  otherIn: number;
  deaths: number;
  sales: number;
  otherOut: number;
  closing: number;
  computedClosing: number;
  balances: boolean;
  difference: number;
  byExitReason: Record<string, number>;
}

/** Opening + births + purchases − deaths − sales = closing. Composed from M1. */
export async function herdInventoryMovement(
  session: Session,
  from: ISODate,
  to: ISODate,
): Promise<HerdInventoryReport> {
  const r = await herdInventoryReconciliation(session, from, to);

  const actions: string[] = [];
  if (!r.balances) {
    actions.push(
      `The register is ${Math.abs(r.difference)} out. Find the ${r.difference > 0 ? "animal that was never recorded as arriving" : "animal that left without an exit record"} before this goes to the co-op or the bank.`,
    );
  }
  if (r.deaths > 0) {
    actions.push(`${r.deaths} ${plural(r.deaths, "animal")} died. Record the cause on each one — a pattern is worth finding.`);
  }
  if (actions.length === 0) actions.push("The herd register balances. Nothing to reconcile.");

  return { ...r, sentence: r.narrative, actions };
}

/* ================================================================== */
/* Standard set — co-op reconciliation                                 */
/* ================================================================== */

export interface CoopStatementRow {
  statementId: string;
  customerName: string;
  periodStart: ISODate;
  periodEnd: ISODate;
  ourLitres: number;
  theirLitres: number;
  litresVariance: number;
  litresVarianceKes: number;
  unmatchedDeductionsKes: number;
  netPayKes: number;
  message: string;
}

export interface CoopReconciliationReport extends Conclusion {
  statements: CoopStatementRow[];
  totalVarianceKes: number;
  totalUnmatchedDeductionsKes: number;
}

/** Composed from M4 — `listStatements` then `statementView` for each. */
export async function coopReconciliation(
  session: Session,
  opts: { from?: ISODate; to?: ISODate } = {},
  database?: Db,
): Promise<CoopReconciliationReport> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);

  const all = await listStatements(session, db);
  const wanted = all.filter(({ statement }) => {
    if (opts.from && statement.periodEnd < opts.from) return false;
    if (opts.to && statement.periodStart > opts.to) return false;
    return true;
  });

  const statements: CoopStatementRow[] = [];
  for (const { statement } of wanted) {
    const view = await statementView(session, statement.id, db);
    statements.push({
      statementId: statement.id,
      customerName: view.customerName,
      periodStart: statement.periodStart as ISODate,
      periodEnd: statement.periodEnd as ISODate,
      ourLitres: view.ourLitres,
      theirLitres: num(statement.coopLitres),
      litresVariance: view.reconciliation.litresVariance,
      litresVarianceKes: view.reconciliation.litresVarianceKes,
      unmatchedDeductionsKes: view.reconciliation.unmatchedDeductionsKes,
      netPayKes: num(statement.netPayKes),
      message: view.reconciliation.message,
    });
  }

  const totalVarianceKes = money(statements.reduce((a, r) => a + r.litresVarianceKes, 0));
  const totalUnmatchedDeductionsKes = money(
    statements.reduce((a, r) => a + r.unmatchedDeductionsKes, 0),
  );

  let sentence: string;
  if (statements.length === 0) {
    sentence = "No co-op statements have been entered yet. Enter one and this report tells you whether you were paid for every litre.";
  } else {
    sentence =
      `${statements.length} ${plural(statements.length, "statement")} checked. ` +
      (Math.abs(totalVarianceKes) < 1 && totalUnmatchedDeductionsKes < 1
        ? "Every litre and every deduction matches your own records."
        : `${kes(Math.abs(totalVarianceKes))} of milk and ${kes(totalUnmatchedDeductionsKes)} of deductions do not match your own records.`);
  }

  const actions = statements
    .filter((r) => Math.abs(r.litresVariance) > 0 || r.unmatchedDeductionsKes > 0)
    .map((r) => `Ask ${r.customerName} about ${r.periodStart} to ${r.periodEnd}: ${r.message}`);
  if (actions.length === 0) actions.push("Nothing to query with the co-operative.");

  return { statements, totalVarianceKes, totalUnmatchedDeductionsKes, sentence, actions };
}

/* ================================================================== */
/* Standard set — payroll                                              */
/* ================================================================== */

export interface PayrollReport extends Conclusion {
  month: string;
  run: Awaited<ReturnType<typeof getPayrollRun>>;
  remittances: Awaited<ReturnType<typeof remittanceSummary>>;
  belowMinimum: Awaited<ReturnType<typeof minimumWageReport>>;
  totalGrossKes: number;
  totalNetKes: number;
  totalEmployerCostKes: number;
}

export async function payrollReport(
  session: Session,
  month: string,
  database?: Db,
): Promise<PayrollReport> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);
  const periodMonth = normaliseMonth(month);

  const [run, remittances, wages] = await Promise.all([
    getPayrollRun(session, periodMonth, db),
    remittanceSummary(session, periodMonth, db),
    minimumWageReport(session, db),
  ]);

  const below = wages.rows.filter((w) => w.below);

  const sentence = run
    ? `${run.headline} On top of that the farm owes ${kes(remittances.totalKes)} in statutory deductions by ${remittances.dueOn}.`
    : `Payroll for ${periodMonth.slice(0, 7)} has not been run. Nothing is owed to anybody until it is.`;

  const actions: string[] = [];
  if (run && run.status === "DRAFT") actions.push("Approve the payroll run — a draft is not a payslip.");
  if (remittances.totalKes > 0) {
    actions.push(`Pay ${kes(remittances.totalKes)} of PAYE, NSSF, SHIF and housing levy by ${remittances.dueOn}.`);
  }
  for (const w of below) {
    actions.push(`${w.fullName} is below the gazetted minimum for a ${w.role.toLowerCase()} — ${w.message ?? "raise the wage."}`);
  }
  if (actions.length === 0) actions.push("Nothing outstanding on pay this month.");

  return {
    month: periodMonth.slice(0, 7),
    run,
    remittances,
    belowMinimum: wages,
    totalGrossKes: run?.totalGrossKes ?? 0,
    totalNetKes: run?.totalNetKes ?? 0,
    totalEmployerCostKes: run?.totalEmployerCostKes ?? 0,
    sentence,
    actions,
  };
}

/* ================================================================== */
/* The printable daily sheet — the paper notebook, on paper            */
/* ================================================================== */

export interface DailySheetCow {
  animalId: string;
  tag: string;
  name: string;
  daysInMilk: number | null;
  /** One entry per milking session, in the farm's own session order. */
  bySession: Array<{ session: s.MilkingSession; label: string; litres: number | null }>;
  totalL: number;
  locked: boolean;
  lockMessage: string | null;
}

export interface DailySheet {
  date: ISODate;
  dayLabel: string;
  farmName: string;
  sessions: Array<{ session: s.MilkingSession; label: string }>;
  cows: DailySheetCow[];
  totalsBySession: Array<{ session: s.MilkingSession; label: string; litres: number }>;
  totalL: number;
  /** Where the milk went that day, so the paper sheet reconciles to the can. */
  disposals: Array<{ label: string; litres: number }>;
  note: string;
}

const SESSION_LABEL: Record<s.MilkingSession, string> = {
  MORNING: "AM",
  NOON: "MID",
  EVENING: "PM",
};

/**
 * The daily sheet, laid out the way the farm's notebook already is: cow names
 * down the left, one column per milking across the top.
 *
 * This is deliberate rather than nostalgic. M-Pesa — the most trusted money
 * system in Kenya — requires every agent to keep a paper log alongside the
 * digital record and does not consider that redundant. A digital sheet that
 * cannot be laid next to the paper one is a sheet nobody trusts.
 */
export async function dailySheet(
  session: Session,
  date: ISODate = today(),
  database?: Db,
): Promise<DailySheet> {
  const db = await resolveDb(database);
  const sessionNames = await milkingSessionsForFarm(session, db);

  const sheets = [];
  for (const name of sessionNames) sheets.push(await milkSheet(session, date, name, db));

  const farm = await db.query.farm.findFirst({ where: eq(s.farm.id, session.farmId) });

  const byCow = new Map<string, DailySheetCow>();
  for (let i = 0; i < sheets.length; i++) {
    const name = sessionNames[i];
    for (const row of sheets[i].rows) {
      const cur =
        byCow.get(row.animalId) ??
        {
          animalId: row.animalId,
          tag: row.tag,
          name: row.name,
          daysInMilk: row.daysInMilk,
          bySession: sessionNames.map((sn) => ({
            session: sn,
            label: SESSION_LABEL[sn],
            litres: null as number | null,
          })),
          totalL: 0,
          locked: false,
          lockMessage: null as string | null,
        };
      const slot = cur.bySession.find((b) => b.session === name)!;
      slot.litres = row.recordedL;
      cur.totalL = money(cur.totalL + (row.recordedL ?? 0));
      if (row.locked) {
        cur.locked = true;
        cur.lockMessage = row.lockMessage ?? cur.lockMessage;
      }
      byCow.set(row.animalId, cur);
    }
  }

  // Two independent sources say a cow's milk is held back: the health record
  // (which is what puts the ⛔ on the sheet, and is true before anything is
  // milked) and a milk row already stamped unsaleable. Take the union. Missing
  // a withdrawal costs a farm its co-op contract; naming one cow too many
  // costs it nothing.
  const day = await dayProduction(session, date, db);
  for (const w of day.withheldAnimals) {
    const cow = byCow.get(w.animalId);
    if (cow && !cow.locked) {
      cow.locked = true;
      cow.lockMessage = cow.lockMessage ?? `${cow.name}'s milk was recorded as not for sale.`;
    }
  }

  const cows = [...byCow.values()].sort((a, b) => a.name.localeCompare(b.name));

  const totalsBySession = sessionNames.map((sn) => ({
    session: sn,
    label: SESSION_LABEL[sn],
    litres: money(
      cows.reduce((a, c) => a + (c.bySession.find((b) => b.session === sn)?.litres ?? 0), 0),
    ),
  }));
  const totalL = money(totalsBySession.reduce((a, t) => a + t.litres, 0));

  const mix = await channelMix(session, date, date, db);

  return {
    date,
    dayLabel: formatDay(date),
    farmName: farm?.name ?? "This farm",
    sessions: sessionNames.map((sn) => ({ session: sn, label: SESSION_LABEL[sn] })),
    cows,
    totalsBySession,
    totalL,
    disposals: mix.lines.map((l) => ({ label: l.label, litres: l.litres })),
    note: withdrawalNote(cows),
  };
}

/**
 * The sentence at the foot of the printed sheet, derived from the SAME rows the
 * table above it prints.
 *
 * It used to come from `dayProduction`, which walks the milk records that have
 * already been entered. The herdsman prints this sheet to carry INTO the shed,
 * before anything is entered — so the list was empty, and the paper said
 *
 *     Njeri    ⛔ do not sell
 *     Akinyi   ⛔ do not sell
 *     ...
 *     No cow is under withdrawal today.
 *
 * on one page, while Njeri was seven days into an oxytetracycline withdrawal.
 * The CSV export said it too. Reading the cow rows instead makes the two
 * structurally incapable of disagreeing: if a ⛔ is printed, it is named here.
 */
function withdrawalNote(cows: DailySheetCow[]): string {
  const held = cows.filter((c) => c.locked);
  if (held.length === 0) return "No cow is under withdrawal today. Every cow's milk may go to the can.";
  const names = held.map((c) => c.name);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `DO NOT SELL ${list}. ${held.length === 1 ? "Her" : "Their"} milk is marked ⛔ above — keep it out of the can.`;
}

/* ================================================================== */
/* CSV — the universal fallback that opens on any phone in Kenya       */
/* ================================================================== */

export const REPORT_NAMES = [
  "money-this-month",
  "cow-league",
  "this-week",
  "milk-production",
  "breeding",
  "health",
  "feed",
  "herd-inventory",
  "coop",
  "payroll",
  "daily-sheet",
  "all",
] as const;
export type ReportName = (typeof REPORT_NAMES)[number];

export function isReportName(v: string): v is ReportName {
  return (REPORT_NAMES as readonly string[]).includes(v);
}

export interface CsvTable {
  /** File-safe name, used for the download filename. */
  name: string;
  title: string;
  /** The conclusion travels with the data. A CSV of bare numbers is a table. */
  sentence?: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
}

/** RFC 4180. Quote anything with a comma, quote, newline or leading space. */
function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const str = String(v);
  if (/[",\r\n]/.test(str) || str !== str.trim()) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(table: CsvTable): string {
  const lines: string[] = [];
  lines.push(csvCell(table.title));
  if (table.sentence) lines.push(csvCell(table.sentence));
  lines.push("");
  lines.push(table.headers.map(csvCell).join(","));
  for (const row of table.rows) lines.push(row.map(csvCell).join(","));
  return lines.join("\r\n");
}

/** Several tables in one file, each with its own heading block. */
export function toCsvBundle(tables: CsvTable[]): string {
  return tables.map(toCsv).join("\r\n\r\n");
}

export interface ReportCsvOptions {
  from?: ISODate;
  to?: ISODate;
  month?: string;
  asOf?: ISODate;
}

/**
 * Any report, as CSV.
 *
 * CSV opens on any phone in Kenya, needs no app and works from cached data.
 * It is not the poor relation of a PDF here — it is the format that survives.
 */
export async function reportCsv(
  session: Session,
  name: ReportName,
  opts: ReportCsvOptions = {},
  database?: Db,
): Promise<CsvTable[]> {
  const db = await resolveDb(database);
  const asOf = opts.asOf ?? opts.to ?? today();
  const month = opts.month ?? asOf;
  const { from: mFrom, to: mTo } = monthBounds(month);
  const from = opts.from ?? mFrom;
  const to = opts.to ?? (mTo < asOf ? mTo : asOf);

  switch (name) {
    case "money-this-month": {
      const r = await moneyThisMonth(session, month, db);
      return [
        {
          name: `money-${r.month}`,
          title: `Money — ${r.month}`,
          sentence: r.sentence,
          headers: ["Line", "Detail", "Litres", "KES", "Per litre KES"],
          rows: [
            ...r.revenueByChannel.map((c) => [
              c.kind === "REVENUE" ? "Milk sold" : c.kind === "IMPUTED" ? "Milk not sold" : "Milk lost",
              c.label, c.litres, c.valueKes, c.ratePerLitreKes,
            ]),
            ["Other income", "Animal sales, manure, fodder", null, r.otherIncomeKes, null],
            ["TOTAL REVENUE", "", r.litresProduced, r.totalRevenueKes, null],
            ...r.costsByCategory.map((c) => ["Cost", c.label, null, c.amountKes, null]),
            [r.cashCostLabel, "", r.litresProduced, r.cashCostKes, r.cashCostPerLitreKes],
            [r.fullCostLabel, "", r.litresProduced, r.fullCostKes, r.fullCostPerLitreKes],
            ["Margin over feed", r.marginOverFeed.message, null, r.marginOverFeed.marginKes, r.marginOverFeed.marginPerLitreKes],
            ["NET", r.benchmarkVerdict, null, r.netKes, null],
          ],
        },
      ];
    }
    case "cow-league": {
      const r = await cowLeagueTable(session, from, to, db);
      return [
        {
          name: `cow-league-${from}-to-${to}`,
          title: `Cow league table — ${from} to ${to}`,
          sentence: r.sentence,
          headers: [
            "Rank", "Tag", "Name", "Class", "Litres", "Litres/day",
            "Milk KES", "Feed KES", "Vet KES", "Margin KES", "Margin/month KES",
            "Losing money", "Action", "What to do",
          ],
          rows: r.rows.map((c) => [
            c.rank, c.tag, c.name, c.classLabel, c.litres, c.dailyYieldL,
            c.milkRevenueKes, c.feedCostKes, c.vetCostKes, c.marginKes, c.marginPerMonthKes,
            c.losing ? "YES" : "no", c.action, c.recommendation,
          ]),
        },
      ];
    }
    case "this-week": {
      const r = await whatNeedsDoingThisWeek(session, asOf, db);
      return [
        {
          name: `this-week-${asOf}`,
          title: `What needs doing — week of ${asOf}`,
          sentence: r.sentence,
          headers: ["Who", "Subject", "Action", "By when", "Days late", "Urgency", "From", "Detail"],
          rows: r.tasks.map((t) => [
            t.whoLabel, t.subject, t.action, t.dueOn, t.daysOverdue, t.severity, t.source, t.detail,
          ]),
        },
      ];
    }
    case "milk-production": {
      const r = await milkProduction(session, from, to, {}, db);
      return [
        {
          name: `milk-daily-${from}-to-${to}`,
          title: `Milk production, daily — ${from} to ${to}`,
          sentence: r.sentence,
          headers: ["Date", "Day", "Total L", "Saleable L", "Withheld L"],
          rows: r.perDay.map((d) => [d.date, d.dayLabel, d.totalL, d.saleableL, d.withheldL]),
        },
        {
          name: `milk-per-cow-${from}-to-${to}`,
          title: `Milk production, per cow — ${from} to ${to}`,
          headers: ["Tag", "Name", "Litres", "Litres/day", "Share %"],
          rows: r.perCow.map((c) => [c.tag, c.name, c.litres, c.dailyAverageL, c.sharePct]),
        },
      ];
    }
    case "breeding": {
      const r = await breedingPerformance(session, from, to);
      return [
        {
          name: `breeding-${from}-to-${to}`,
          title: `Breeding performance — ${from} to ${to}`,
          sentence: r.sentence,
          headers: ["Measure", "Value", "Unit", "Target", "Acceptable", "On target", "What it means"],
          rows: r.kpis.map((k) => [
            k.label, k.value, k.unit, k.targetValue, k.acceptableValue,
            k.onTarget === null ? "no data" : k.onTarget ? "YES" : "no", k.verdict,
          ]),
        },
      ];
    }
    case "health": {
      const r = await healthReport(session, from, to, db);
      return [
        {
          name: `health-${from}-to-${to}`,
          title: `Health — ${from} to ${to}`,
          sentence: r.sentence,
          headers: ["Date", "Animal", "Type", "What", "Product", "Cost KES", "Milk clear on"],
          rows: r.treatments.map((t) => [
            t.occurredOn, t.who, t.eventType, t.title, t.productName, t.costKes, t.milkClearOn,
          ]),
        },
        {
          name: `health-withdrawal-${to}`,
          title: `Withdrawal log — as at ${to}`,
          headers: ["Animal", "Milk blocked", "Milk clear on", "Meat clear on", "Days left", "Message"],
          rows: r.withdrawalLog.map((w) => [
            w.animalName, w.milkBlocked ? "YES" : "no", w.milkClearOn, w.meatClearOn, w.daysLeft, w.plainMessage,
          ]),
        },
      ];
    }
    case "feed": {
      const r = await feedReport(session, from, to, db);
      return [
        {
          name: `feed-${from}-to-${to}`,
          title: `Feed — ${from} to ${to}`,
          sentence: r.sentence,
          headers: ["Feed", "Kg used", "Cost KES", "Cost per litre KES"],
          rows: r.consumption.map((c) => [c.name, c.kg, c.costKes, c.costPerLitreKes]),
        },
        {
          name: `feed-store-${to}`,
          title: `Feed store — as at ${to}`,
          headers: ["Feed", "Category", "Balance kg", "Cost per kg KES", "Days of cover", "What to do"],
          rows: r.store.map((l) => [
            l.name, l.category, l.balanceKg, l.costPerKgKes, l.cover.daysOfCover, l.cover.message,
          ]),
        },
      ];
    }
    case "herd-inventory": {
      const r = await herdInventoryMovement(session, from, to);
      return [
        {
          name: `herd-inventory-${from}-to-${to}`,
          title: `Herd inventory movement — ${from} to ${to}`,
          sentence: r.sentence,
          headers: ["Line", "Head"],
          rows: [
            ["Opening", r.opening],
            ["Born", r.births],
            ["Bought", r.purchases],
            ["In another way", r.otherIn],
            ["Died", -r.deaths],
            ["Sold or culled", -r.sales],
            ["Left another way", -r.otherOut],
            ["Should be", r.computedClosing],
            ["Register says", r.closing],
            ["Difference", r.difference],
          ],
        },
      ];
    }
    case "coop": {
      const r = await coopReconciliation(session, { from, to }, db);
      return [
        {
          name: `coop-${from}-to-${to}`,
          title: `Co-op reconciliation — ${from} to ${to}`,
          sentence: r.sentence,
          headers: [
            "Buyer", "Period start", "Period end", "Our litres", "Their litres",
            "Litres out", "KES out", "Unmatched deductions KES", "Net paid KES", "What it means",
          ],
          rows: r.statements.map((x) => [
            x.customerName, x.periodStart, x.periodEnd, x.ourLitres, x.theirLitres,
            x.litresVariance, x.litresVarianceKes, x.unmatchedDeductionsKes, x.netPayKes, x.message,
          ]),
        },
      ];
    }
    case "payroll": {
      const r = await payrollReport(session, month, db);
      return [
        {
          name: `payroll-${r.month}`,
          title: `Payroll — ${r.month}`,
          sentence: r.sentence,
          headers: ["Name", "Role", "Days", "Gross KES", "PAYE KES", "NSSF KES", "SHIF KES", "Housing levy KES", "Net KES"],
          rows: (r.run?.payslips ?? []).map((p) => [
            p.fullName, p.role, p.daysWorked, p.slip.grossKes, p.slip.payeKes,
            p.slip.nssfTotalKes, p.slip.shifKes, p.slip.housingLevyKes, p.slip.netKes,
          ]),
        },
        {
          name: `remittances-${r.month}`,
          title: `Statutory remittances — ${r.month}, due ${r.remittances.dueOn}`,
          sentence: r.remittances.headline,
          headers: ["Head", "Employee KES", "Farm KES", "Total KES", "Pay to"],
          rows: r.remittances.lines.map((l) => [l.label, l.employeeKes, l.employerKes, l.totalKes, l.payTo]),
        },
      ];
    }
    case "daily-sheet": {
      const r = await dailySheet(session, asOf, db);
      return [
        {
          name: `daily-sheet-${r.date}`,
          title: `Daily milk sheet — ${r.dayLabel}, ${r.farmName}`,
          sentence: r.note,
          // "Sell?" is not decoration. Without it a cow under withdrawal is
          // invisible in the CSV — the ⛔ lives only on the web page, and the
          // spreadsheet a manager actually forwards says nothing at all.
          headers: ["Cow", "Tag", ...r.sessions.map((x) => `${x.label} litres`), "Total", "Sell?"],
          rows: [
            ...r.cows.map((c) => [
              c.name, c.tag, ...c.bySession.map((b) => b.litres), c.totalL,
              c.locked ? "DO NOT SELL" : "Yes",
            ]),
            ["TOTAL", "", ...r.totalsBySession.map((t) => t.litres), r.totalL, ""],
          ],
        },
      ];
    }
    case "all":
      return fullDataExport(session, db);
  }
}

/* ================================================================== */
/* FULL DATA EXPORT — "you can leave whenever you want"                */
/* ================================================================== */

/**
 * Every row this farm owns, as CSV.
 *
 * This is a headline feature, not a compliance box. Vendor lock-in is the
 * second-biggest documented failure in this market — Farmbrite users complain
 * they cannot get their data out — and "you can leave whenever you want" is a
 * differentiator a competitor cannot copy without cannibalising itself.
 *
 * So it exports the RAW tables, not a prettified summary: what comes out is
 * what could be loaded into anything else tomorrow.
 */
export async function fullDataExport(session: Session, database?: Db): Promise<CsvTable[]> {
  requireCap(session, "VIEW_MONEY");
  const db = await resolveDb(database);

  /**
   * Every exportable table carries `farmId` — that is what makes scoping the
   * whole dump to one tenant a single `where` rather than thirty judgements.
   * Drizzle's per-table select types differ, so the list is deliberately loose
   * and the SCOPE is the thing held tight.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tables: Array<{ name: string; title: string; table: any }> = [
    { name: "animals", title: "Animals", table: s.animal },
    { name: "animal-exits", title: "Animals that left", table: s.animalExit },
    { name: "weights", title: "Weights and body condition", table: s.weightObservation },
    { name: "heats", title: "Heat observations", table: s.heatObservation },
    { name: "services", title: "Services", table: s.service },
    { name: "pregnancy-checks", title: "Pregnancy checks", table: s.pregnancyCheck },
    { name: "calvings", title: "Calvings", table: s.calving },
    { name: "dry-offs", title: "Dry-offs", table: s.dryOff },
    { name: "milk-records", title: "Milk records", table: s.milkRecord },
    { name: "milk-disposals", title: "Where the milk went", table: s.milkDisposal },
    { name: "milk-statements", title: "Co-op statements", table: s.milkStatement },
    { name: "customers", title: "Customers", table: s.customer },
    { name: "standing-orders", title: "Standing orders", table: s.standingOrder },
    { name: "customer-ledger", title: "Customer ledger", table: s.customerLedgerEntry },
    { name: "invoices", title: "Invoices", table: s.salesInvoice },
    { name: "feed-items", title: "Feeds", table: s.feedItem },
    { name: "feed-purchases", title: "Feed purchases", table: s.feedPurchase },
    { name: "feed-issues", title: "Feed issued", table: s.feedIssue },
    { name: "fodder", title: "Fodder grown", table: s.fodderProduction },
    { name: "health-events", title: "Health events", table: s.healthEvent },
    { name: "employees", title: "Staff", table: s.employee },
    { name: "attendance", title: "Attendance", table: s.attendance },
    { name: "payslips", title: "Payslips", table: s.payslip },
    { name: "expenses", title: "Expenses", table: s.expense },
    { name: "income", title: "Income", table: s.income },
    { name: "counterparties", title: "Suppliers and service providers", table: s.counterparty },
    { name: "compliance-documents", title: "Licences and certificates", table: s.complianceDocument },
    { name: "receipts", title: "Receipts", table: s.receipt },
    { name: "alerts", title: "Alerts", table: s.alert },
  ];

  const out: CsvTable[] = [];
  for (const t of tables) {
    const rows = (await db.select().from(t.table).where(eq(t.table.farmId, session.farmId))) as Array<
      Record<string, unknown>
    >;
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    out.push({
      name: t.name,
      title: t.title,
      sentence:
        out.length === 0
          ? "This is your farm's own data. It is yours, it always was, and you can take it anywhere."
          : undefined,
      headers,
      rows: rows.map((r) => headers.map((h) => flatten(r[h]))),
    });
  }
  return out;
}

function flatten(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.join("|");
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}
