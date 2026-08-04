import "server-only";

/**
 * M3 — Milk production.
 *
 * The bulk entry sheet runs twice a day, every day, forever. Everything here is
 * shaped around that one screen: prefilled from the last known value, locked
 * only where the law requires it (antibiotic withdrawal), and never rejecting a
 * number a human actually saw in a bucket.
 *
 * Layering: the RULES live in `@/lib/domain/milk` and `@/lib/domain/health` and
 * are pure. This module is the I/O around them.
 */

import { and, desc, eq, gt, gte, inArray, isNull, lte } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import * as s from "@/db/schema";
import type { AnimalClass, MilkingSession } from "@/db/schema";
import type { Db } from "@/db";
import {
  actionError,
  actionOk,
  assertOwned,
  guard,
  requireCapability,
  type ActionResult,
  type Session,
} from "@/lib/dal";
import { newId, deterministicUuid } from "@/lib/ids";
import { dec, money, num } from "@/lib/money";
import { addDays, daysBetween, toDate, today, type ISODate } from "@/lib/domain/dates";
import {
  checkYieldPlausibility,
  detectSustainedDrop,
  persistencyPct,
  project305FromPeak,
  STANDARD_LACTATION_DAYS,
} from "@/lib/domain/milk";
import {
  isColostrum,
  COLOSTRUM_DAYS,
  ASSUMED_MILK_WITHDRAWAL_DAYS,
  assumedWithdrawalMessage,
} from "@/lib/domain/health";
import { daysInMilk, deriveClass, isMilking, type AnimalFacts } from "@/lib/domain/animal";

/* ---------------------------------------------------------------- */
/* Plumbing                                                          */
/* ---------------------------------------------------------------- */

/**
 * Tests hand in a throwaway PGlite; production resolves the singleton lazily so
 * importing this module in a unit test never opens a real database.
 */
export async function resolveDb(dbo?: Db): Promise<Db> {
  if (dbo) return dbo;
  const mod = await import("@/db");
  return mod.db;
}

/** How far back the sheet looks for a prefill value. */
const LOOKBACK_DAYS = 45;
/** How many past sessions make up "her usual". */
const RECENT_RECORDS = 7;
const DROP_DAYS = 3;
const DROP_THRESHOLD_PCT = 20;
const DROP_BASELINE_DAYS = 14;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu 7 Aug" — the way a date is said out loud in a milking shed. */
export function formatDay(iso: ISODate): string {
  const d = toDate(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * A reference code derived from the rows themselves rather than from randomness.
 *
 * The offline outbox may flush the same batch twice over a flaky link. The rows
 * are already idempotent (client-generated id + `onConflictDoNothing`); deriving
 * the ref the same way means the herdsman sees the SAME code both times instead
 * of two receipts for one milking.
 */
export function deterministicRef(prefix: string, seed: string, length = 5): string {
  const digest = createHash("sha256").update(seed).digest();
  let out = "";
  for (let i = 0; i < length; i++) out += REF_ALPHABET[digest[i] % REF_ALPHABET.length];
  return `${prefix}${out}`;
}

/** Corrections are new rows; a superseded row must never be counted twice. */
function live<T extends { id: string; supersedesId?: string | null }>(rows: T[]): T[] {
  const superseded = new Set(rows.map((r) => r.supersedesId).filter(Boolean) as string[]);
  return rows.filter((r) => !superseded.has(r.id));
}

/* ---------------------------------------------------------------- */
/* Herd facts — who is actually in milk today                        */
/* ---------------------------------------------------------------- */

export interface HerdMember {
  id: string;
  tag: string;
  name: string;
  facts: AnimalFacts;
  cls: AnimalClass;
  dim: number | null;
}

/**
 * Class is a view, never a column (P1), so the lactating herd is derived from
 * calving, service, PD and dry-off events every time it is asked for.
 */
export async function lactatingHerd(
  dbo: Db,
  farmId: string,
  asOf: ISODate,
): Promise<HerdMember[]> {
  const [animals, calvings, services, pds, dryOffs, weights, exits] = await Promise.all([
    dbo.select().from(s.animal).where(and(eq(s.animal.farmId, farmId), eq(s.animal.sex, "F"))),
    dbo.select().from(s.calving).where(eq(s.calving.farmId, farmId)),
    dbo.select().from(s.service).where(eq(s.service.farmId, farmId)),
    dbo.select().from(s.pregnancyCheck).where(eq(s.pregnancyCheck.farmId, farmId)),
    dbo.select().from(s.dryOff).where(eq(s.dryOff.farmId, farmId)),
    dbo.select().from(s.weightObservation).where(eq(s.weightObservation.farmId, farmId)),
    dbo.select().from(s.animalExit).where(eq(s.animalExit.farmId, farmId)),
  ]);

  const gone = new Set(exits.filter((e) => e.exitDate <= asOf).map((e) => e.animalId));

  const out: HerdMember[] = [];
  for (const a of animals) {
    if (gone.has(a.id)) continue;

    const myCalvings = calvings
      .filter((c) => c.damId === a.id && c.calvedOn <= asOf)
      .sort((x, y) => (x.calvedOn < y.calvedOn ? -1 : 1));
    const myServices = services
      .filter((v) => v.animalId === a.id && v.servedOn <= asOf)
      .sort((x, y) => (x.servedOn < y.servedOn ? -1 : 1));
    const myPds = pds.filter((p) => p.animalId === a.id && p.checkedOn <= asOf);
    const myDry = dryOffs
      .filter((d) => d.animalId === a.id && d.driedOn <= asOf)
      .sort((x, y) => (x.driedOn < y.driedOn ? -1 : 1));
    const myWeights = weights
      .filter((w) => w.animalId === a.id && w.observedOn <= asOf)
      .sort((x, y) => (x.observedOn < y.observedOn ? -1 : 1));

    const lastService = myServices.at(-1) ?? null;
    const facts: AnimalFacts = {
      sex: a.sex,
      dateOfBirth: a.dateOfBirth,
      castrated: a.castrated,
      classOverride: a.classOverride,
      parity: myCalvings.length,
      lastCalvingOn: myCalvings.at(-1)?.calvedOn ?? null,
      lastServiceOn: lastService?.servedOn ?? null,
      pdPositiveOn:
        myPds.filter((p) => p.result === "POSITIVE").sort((x, y) => (x.checkedOn < y.checkedOn ? -1 : 1)).at(-1)
          ?.checkedOn ?? null,
      pdNegativeOn:
        myPds.filter((p) => p.result === "NEGATIVE").sort((x, y) => (x.checkedOn < y.checkedOn ? -1 : 1)).at(-1)
          ?.checkedOn ?? null,
      driedOffOn: myDry.at(-1)?.driedOn ?? null,
      expectedCalvingOn: lastService?.expectedCalvingOn ?? null,
      latestWeightKg: myWeights.at(-1)?.weightKg != null ? num(myWeights.at(-1)!.weightKg) : null,
      culled: false,
    };

    const cls = deriveClass(facts, asOf);
    if (!isMilking(cls)) continue;

    out.push({
      id: a.id,
      tag: a.tag,
      name: a.name ?? a.tag,
      facts,
      cls,
      dim: daysInMilk(facts, asOf),
    });
  }

  return out.sort((x, y) => x.name.localeCompare(y.name));
}

export interface WithheldAnimal {
  milkClearAt: Date;
  /** True when the product's label period was never recorded and we are guessing. */
  assumed: boolean;
  productName: string | null;
}

/**
 * Every animal whose milk must be held back, keyed by animal id.
 *
 * Evaluated as at `asOf`, which is the DATE OF THE MILKING and not the wall
 * clock. A batch captured offline while a cow was blocked and flushed after her
 * clear date must still be stored as withheld — with offline as the default
 * path, that is a routine sequence, not an exotic one.
 *
 * A treatment whose product carries NO recorded withdrawal period is included
 * here on an assumed window. "Nobody read the label" and "this drug has no
 * withdrawal" are different facts, and collapsing them is precisely how residue
 * reaches the churn.
 */
export async function withdrawalMap(
  dbo: Db,
  farmId: string,
  asOf: Date | ISODate = new Date(),
): Promise<Map<string, WithheldAnimal>> {
  const at = asOf instanceof Date ? asOf : new Date(`${asOf}T23:59:59.999Z`);

  const rows = await dbo
    .select({
      animalId: s.healthEvent.animalId,
      milkClearAt: s.healthEvent.milkClearAt,
      occurredOn: s.healthEvent.occurredOn,
      treatmentEndOn: s.healthEvent.treatmentEndOn,
      productId: s.healthEvent.productId,
      productName: s.product.name,
      milkWithdrawalDays: s.product.milkWithdrawalDays,
    })
    .from(s.healthEvent)
    .leftJoin(s.product, eq(s.product.id, s.healthEvent.productId))
    .where(and(eq(s.healthEvent.farmId, farmId), gte(s.healthEvent.occurredOn, addDays(
      at.toISOString().slice(0, 10),
      -MAX_WITHDRAWAL_LOOKBACK_DAYS,
    ))));

  const map = new Map<string, WithheldAnimal>();

  for (const r of rows) {
    let clear: Date | null = null;
    let assumed = false;

    if (r.milkClearAt) {
      clear = r.milkClearAt instanceof Date ? r.milkClearAt : new Date(r.milkClearAt);
    } else if (r.productId && r.milkWithdrawalDays == null) {
      // No label period on a product that was actually administered. Hold her
      // on the assumed window and say plainly that we are guessing.
      const end = r.treatmentEndOn ?? r.occurredOn;
      clear = new Date(`${addDays(end, ASSUMED_MILK_WITHDRAWAL_DAYS)}T23:59:59.999Z`);
      assumed = true;
    }

    // A treatment given AFTER the milking cannot condemn it. Without this the
    // window is one-sided and a dose given today writes off a sheet from two
    // months ago, which is wrong in the safe direction but still throws away
    // good milk.
    // Bound on when the drug FIRST went in, not when the course ends. A
    // three-day mastitis course started this morning has treatmentEndOn two
    // days out, and bounding on that skipped the cow entirely — leaving today's
    // milk saleable for the whole course. Multi-day courses are the ordinary
    // shape of a mastitis treatment, so that is the residue case this module
    // exists to stop. Milk is condemned from the first dose.
    if (r.occurredOn > at.toISOString().slice(0, 10)) continue;
    if (!clear || clear <= at) continue;

    const existing = map.get(r.animalId);
    // The LONGEST withdrawal wins — two treatments do not shorten each other.
    if (!existing || clear > existing.milkClearAt) {
      map.set(r.animalId, { milkClearAt: clear, assumed, productName: r.productName ?? null });
    }
  }
  return map;
}

/**
 * How far back to look for treatments that might still be biting. Comfortably
 * longer than any real milk withdrawal, and bounded so a single bad data entry
 * cannot hold a cow out of the tank forever.
 */
const MAX_WITHDRAWAL_LOOKBACK_DAYS = 60;

/* ---------------------------------------------------------------- */
/* The sheet                                                         */
/* ---------------------------------------------------------------- */

/**
 * WITHDRAWAL_UNKNOWN is not a softer WITHDRAWAL — it is a different fact. It
 * means the label was never recorded, so we are holding her milk on an assumed
 * window and the farm needs to go and read the bottle.
 */
export type LockReason = "WITHDRAWAL" | "WITHDRAWAL_UNKNOWN" | "COLOSTRUM";

/**
 * Both withdrawal reasons keep milk out of the can. Only the message differs —
 * one states a clear date, the other admits we are guessing at it.
 */
export function isWithheldReason(r: LockReason | null | undefined): boolean {
  return r === "WITHDRAWAL" || r === "WITHDRAWAL_UNKNOWN";
}

export interface MilkSheetRow {
  animalId: string;
  tag: string;
  name: string;
  daysInMilk: number | null;
  /** Last recorded litres for THIS session. The one-tap default. */
  prefillL: number | null;
  /** Always labelled, so nobody accepts a wrong default blindly (R5). */
  prefillLabel: string | null;
  recentAverageL: number | null;
  /** Already saved for this date and session, if the sheet is being re-opened. */
  recordedL: number | null;
  recordedId: string | null;
  locked: boolean;
  lockReason: LockReason | null;
  lockMessage: string | null;
  saleable: boolean;
  notSaleableReason: LockReason | null;
  milkClearOn: ISODate | null;
  /** "Nyambura down 30% for 3 days — check her." Shown at entry (R7). */
  warning: string | null;
}

export interface MilkSheet {
  date: ISODate;
  session: MilkingSession;
  rows: MilkSheetRow[];
  prefilledTotalL: number;
  recordedTotalL: number;
  lockedCount: number;
  recordedCount: number;
  saleableCount: number;
}

/**
 * One row per lactating animal, prefilled. Withdrawal and colostrum rows come
 * back locked with a reason a herdsman can read aloud.
 */
export async function milkSheet(
  session: Session,
  date: ISODate,
  sessionName: MilkingSession,
  dbo?: Db,
): Promise<MilkSheet> {
  const database = await resolveDb(dbo);
  const herd = await lactatingHerd(database, session.farmId, date);
  const ids = herd.map((h) => h.id);

  if (ids.length === 0) {
    return {
      date,
      session: sessionName,
      rows: [],
      prefilledTotalL: 0,
      recordedTotalL: 0,
      lockedCount: 0,
      recordedCount: 0,
      saleableCount: 0,
    };
  }

  const from = addDays(date, -LOOKBACK_DAYS);
  const [history, withheld] = await Promise.all([
    database
      .select()
      .from(s.milkRecord)
      .where(
        and(
          eq(s.milkRecord.farmId, session.farmId),
          inArray(s.milkRecord.animalId, ids),
          gte(s.milkRecord.recordedOn, from),
          lte(s.milkRecord.recordedOn, date),
        ),
      )
      .orderBy(desc(s.milkRecord.recordedOn)),
    // As at the DATE OF THE SHEET, so re-opening a past day shows the locks
    // that actually applied then.
    withdrawalMap(database, session.farmId, date),
  ]);

  const usable = live(history);

  const rows: MilkSheetRow[] = herd.map((h) => {
    const mine = usable.filter((r) => r.animalId === h.id);
    const sameSession = mine.filter((r) => r.session === sessionName);
    const todays = sameSession.find((r) => r.recordedOn === date) ?? null;
    const past = sameSession.filter((r) => r.recordedOn < date);

    const last = past[0] ?? null;
    const recent = past.slice(0, RECENT_RECORDS).map((r) => num(r.litres));
    const recentAverageL = recent.length ? money(recent.reduce((a, b) => a + b, 0) / recent.length) : null;

    const prefillL = last ? num(last.litres) : null;
    let prefillLabel: string | null = null;
    if (last) {
      const gap = daysBetween(last.recordedOn, date);
      prefillLabel =
        gap <= 1
          ? "same as yesterday"
          : `same as ${formatDay(last.recordedOn)} — ${gap} days ago`;
    }

    // The two reasons a row is not for sale. Withdrawal outranks colostrum:
    // it is the legal one, and it carries the longer date.
    const w = withheld.get(h.id);
    const colostrum = isColostrum(h.dim);

    let locked = false;
    let lockReason: LockReason | null = null;
    let lockMessage: string | null = null;
    let milkClearOn: ISODate | null = null;

    if (w) {
      milkClearOn = w.milkClearAt.toISOString().slice(0, 10);
      locked = true;
      if (w.assumed) {
        lockReason = "WITHDRAWAL_UNKNOWN";
        lockMessage = assumedWithdrawalMessage(
          h.name,
          w.productName ?? "that medicine",
          formatDay(milkClearOn),
        );
      } else {
        lockReason = "WITHDRAWAL";
        lockMessage = `Do not sell ${h.name}'s milk until ${formatDay(milkClearOn)}. She was treated — keep this milk out of the can.`;
      }
    } else if (colostrum) {
      locked = true;
      lockReason = "COLOSTRUM";
      lockMessage = `${h.name} calved ${h.dim} day${h.dim === 1 ? "" : "s"} ago. This is colostrum — it is the calf's, not for sale.`;
    }

    // The sustained drop, computed from whole days so a missed session does not
    // masquerade as a collapse.
    const warning = sustainedDropMessage(h.name, mine, date);

    return {
      animalId: h.id,
      tag: h.tag,
      name: h.name,
      daysInMilk: h.dim,
      prefillL,
      prefillLabel,
      recentAverageL,
      recordedL: todays ? num(todays.litres) : null,
      recordedId: todays?.id ?? null,
      locked,
      lockReason,
      lockMessage,
      saleable: !locked,
      notSaleableReason: lockReason,
      milkClearOn,
      warning,
    };
  });

  return {
    date,
    session: sessionName,
    rows,
    prefilledTotalL: money(rows.reduce((a, r) => a + (r.recordedL ?? r.prefillL ?? 0), 0)),
    recordedTotalL: money(rows.reduce((a, r) => a + (r.recordedL ?? 0), 0)),
    lockedCount: rows.filter((r) => r.locked).length,
    recordedCount: rows.filter((r) => r.recordedL !== null).length,
    saleableCount: rows.filter((r) => r.saleable).length,
  };
}

/** Daily totals across all sessions, oldest first. */
function dailyTotals(
  records: Array<{ recordedOn: string; litres: string }>,
  from: ISODate,
  to: ISODate,
): Array<{ date: ISODate; litres: number }> {
  const byDay = new Map<string, number>();
  for (const r of records) {
    if (r.recordedOn < from || r.recordedOn > to) continue;
    byDay.set(r.recordedOn, money((byDay.get(r.recordedOn) ?? 0) + num(r.litres)));
  }
  return [...byDay.entries()]
    .map(([date, litres]) => ({ date, litres }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function sustainedDropMessage(
  name: string,
  records: Array<{ recordedOn: string; litres: string }>,
  asOf: ISODate,
): string | null {
  const windowStart = addDays(asOf, -(DROP_DAYS - 1));
  const baselineStart = addDays(asOf, -(DROP_DAYS + DROP_BASELINE_DAYS));
  const baselineEnd = addDays(windowStart, -1);

  const recentDays = dailyTotals(records, windowStart, asOf);
  const baselineDays = dailyTotals(records, baselineStart, baselineEnd);
  if (recentDays.length < DROP_DAYS || baselineDays.length === 0) return null;

  const baseline = baselineDays.reduce((a, d) => a + d.litres, 0) / baselineDays.length;
  const drop = detectSustainedDrop(
    recentDays.map((d) => d.litres),
    baseline,
    { days: DROP_DAYS, thresholdPct: DROP_THRESHOLD_PCT },
  );
  if (!drop.dropping) return null;
  return `${name} down ${drop.pct}% for ${drop.days} days — check her.`;
}

/* ---------------------------------------------------------------- */
/* Recording the batch                                               */
/* ---------------------------------------------------------------- */

const BatchRow = z.object({
  /** Generated on the device. Replay of the same id is a no-op. */
  id: z.string().uuid().optional(),
  animalId: z.string().uuid(),
  litres: z.coerce.number().min(0).max(9999),
});

const BatchInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-08-03."),
  session: z.enum(s.SESSIONS),
  rows: z.array(BatchRow).min(1, "Nothing to save yet."),
});

/**
 * Deliberately loose on the way in: a form posts strings, the outbox replays
 * JSON, and Zod coerces. The shape is checked; the types are not the guard.
 */
export interface MilkBatchInput {
  date: string;
  session: string;
  rows: Array<{ id?: string; animalId: string; litres: number | string }>;
}

export interface MilkBatchResult {
  date: ISODate;
  session: MilkingSession;
  savedCount: number;
  /** Rows that were already on the server — an offline replay, not an error. */
  duplicateCount: number;
  totalL: number;
  saleableL: number;
  withheldL: number;
  colostrumL: number;
  flagged: Array<{ animalId: string; name: string; litres: number; reason: string; message: string }>;
  locked: Array<{ animalId: string; name: string; reason: LockReason; message: string }>;
  drops: Array<{ animalId: string; name: string; message: string }>;
  refCode: string;
  receiptLines: string[];
}

/**
 * The whole herd in one save.
 *
 * Nothing in here rejects a number (R4). An implausible yield is stored with
 * `flagged = true` and a reason, and lands in the manager's queue. The only
 * value that never reaches the tank is milk from a cow under withdrawal, and
 * even that is RECORDED — it is just not saleable.
 */
export async function recordMilkBatch(
  session: Session,
  input: MilkBatchInput,
  dbo?: Db,
): Promise<ActionResult<MilkBatchResult>> {
  return guard(async () => {
    const parsed = BatchInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted rows.", parsed.error.flatten().fieldErrors);
    }
    const { date, session: sessionName, rows } = parsed.data;
    const database = await resolveDb(dbo);

    // OWNERSHIP. A well-formed UUID can belong to another farm; this is the
    // tenancy boundary, and it never comes from the client.
    const ids = [...new Set(rows.map((r) => r.animalId))];
    const owned = await database
      .select()
      .from(s.animal)
      .where(and(eq(s.animal.farmId, session.farmId), inArray(s.animal.id, ids)));
    const ownedById = new Map(owned.map((a) => [a.id, a]));
    for (const id of ids) assertOwned(ownedById.get(id), session, "animal");

    const herd = await lactatingHerd(database, session.farmId, date);
    const herdById = new Map(herd.map((h) => [h.id, h]));
    // As at the date being recorded — an offline batch flushed after the clear
    // date must still be stored withheld.
    const withheld = await withdrawalMap(database, session.farmId, date);

    const from = addDays(date, -LOOKBACK_DAYS);
    const history = live(
      await database
        .select()
        .from(s.milkRecord)
        .where(
          and(
            eq(s.milkRecord.farmId, session.farmId),
            inArray(s.milkRecord.animalId, ids),
            gte(s.milkRecord.recordedOn, from),
            lte(s.milkRecord.recordedOn, date),
          ),
        )
        .orderBy(desc(s.milkRecord.recordedOn)),
    );

    const result: MilkBatchResult = {
      date,
      session: sessionName,
      savedCount: 0,
      duplicateCount: 0,
      totalL: 0,
      saleableL: 0,
      withheldL: 0,
      colostrumL: 0,
      flagged: [],
      locked: [],
      drops: [],
      refCode: "",
      receiptLines: [],
    };

    const now = new Date();
    const values: Array<typeof s.milkRecord.$inferInsert> = [];
    const seedParts: string[] = [];

    for (const row of rows) {
      const animal = ownedById.get(row.animalId)!;
      const member = herdById.get(row.animalId) ?? null;
      const name = animal.name ?? animal.tag;
      const litres = row.litres;

      const mine = history.filter((r) => r.animalId === row.animalId && r.session === sessionName);
      const recent = mine.filter((r) => r.recordedOn < date).slice(0, RECENT_RECORDS).map((r) => num(r.litres));
      const recentAverageL = recent.length ? money(recent.reduce((a, b) => a + b, 0) / recent.length) : null;

      // Warn, never block.
      const check = checkYieldPlausibility(litres, {
        recentAverageL,
        animalName: name,
      });

      const w = withheld.get(row.animalId);
      const colostrum = isColostrum(member?.dim ?? null);

      let saleable = true;
      let notSaleableReason: LockReason | null = null;
      if (w) {
        saleable = false;
        const clearOn = w.milkClearAt.toISOString().slice(0, 10);
        notSaleableReason = w.assumed ? "WITHDRAWAL_UNKNOWN" : "WITHDRAWAL";
        result.locked.push({
          animalId: row.animalId,
          name,
          reason: notSaleableReason,
          message: w.assumed
            ? assumedWithdrawalMessage(name, w.productName ?? "that medicine", formatDay(clearOn))
            : `${name}'s milk is withheld until ${formatDay(clearOn)}. Do not put it in the can.`,
        });
      } else if (colostrum) {
        saleable = false;
        notSaleableReason = "COLOSTRUM";
        result.locked.push({
          animalId: row.animalId,
          name,
          reason: "COLOSTRUM",
          message: `${name} is on day ${member?.dim} — colostrum, for the calf only.`,
        });
      }

      // A device that supplies its own id gets idempotency for free. One that
      // does not — an old client, a hand-built request — used to get a fresh
      // random id on every retry, so one morning's milking landed three times
      // and the day read 37.5 L from a cow that gave 12.5. Derive the id from
      // what makes the milking unique in the world instead, and the retry
      // collides on the primary key like every other replay.
      const id = row.id ?? deterministicUuid(`${session.farmId}|${row.animalId}|${date}|${sessionName}`);
      seedParts.push(id);
      values.push({
        id,
        farmId: session.farmId,
        animalId: row.animalId,
        recordedOn: date,
        session: sessionName,
        litres: dec(litres, 2),
        saleable,
        notSaleableReason,
        flagged: check.flagged,
        flagReason: check.flagged ? check.reason : null,
        recordedBy: session.userId,
        recordedAt: now,
      });

      result.totalL = money(result.totalL + litres);
      if (saleable) result.saleableL = money(result.saleableL + litres);
      // WITHDRAWAL_UNKNOWN counts as withheld too. Stamping a row unsaleable
      // and then leaving it out of the withheld total is how the milk gets
      // stamped AND sold: every downstream guard reads this number.
      if (isWithheldReason(notSaleableReason)) result.withheldL = money(result.withheldL + litres);
      if (notSaleableReason === "COLOSTRUM") result.colostrumL = money(result.colostrumL + litres);

      if (check.flagged) {
        result.flagged.push({
          animalId: row.animalId,
          name,
          litres,
          reason: check.reason ?? "UNUSUAL",
          message: check.message ?? `${litres} L is unusual for ${name}. Saved — the manager will check it.`,
        });
      }
    }

    // Which of these rows are already here? A second flush of the same batch is
    // a no-op, not a duplicate milking.
    const existing = await database
      .select({ id: s.milkRecord.id })
      .from(s.milkRecord)
      .where(
        and(
          eq(s.milkRecord.farmId, session.farmId),
          inArray(
            s.milkRecord.id,
            values.map((v) => v.id),
          ),
        ),
      );
    result.duplicateCount = existing.length;
    result.savedCount = values.length - existing.length;

    await database.insert(s.milkRecord).values(values).onConflictDoNothing();

    // R7 — something useful comes back at the moment of entry.
    const after = live(
      await database
        .select()
        .from(s.milkRecord)
        .where(
          and(
            eq(s.milkRecord.farmId, session.farmId),
            inArray(s.milkRecord.animalId, ids),
            gte(s.milkRecord.recordedOn, addDays(date, -(DROP_DAYS + DROP_BASELINE_DAYS))),
            lte(s.milkRecord.recordedOn, date),
          ),
        ),
    );
    for (const id of ids) {
      const animal = ownedById.get(id)!;
      const name = animal.name ?? animal.tag;
      const message = sustainedDropMessage(
        name,
        after.filter((r) => r.animalId === id),
        date,
      );
      if (message) result.drops.push({ animalId: id, name, message });
    }

    // R6 — a persistent receipt with a code the herdsman can quote three hours
    // later, offline. Derived from the row ids so a replay reuses it.
    const ref = deterministicRef("MK", `${session.farmId}|${date}|${sessionName}|${seedParts.sort().join(",")}`);
    const cows = rows.length;
    const summary = `${sessionLabel(sessionName)} milking — ${cows} cow${cows === 1 ? "" : "s"} · ${result.totalL} L · ${formatDay(date)}`;

    result.refCode = ref;
    result.receiptLines = [
      summary,
      `Recorded by ${session.fullName}`,
      ...(result.withheldL > 0 ? [`${result.withheldL} L withheld — treated cows, not for sale.`] : []),
      ...(result.colostrumL > 0 ? [`${result.colostrumL} L colostrum — for the calves.`] : []),
      ...result.drops.map((d) => d.message),
      ...result.flagged.map((f) => f.message),
    ];

    await database
      .insert(s.receipt)
      .values({
        id: newId(),
        farmId: session.farmId,
        refCode: ref,
        kind: "MILK",
        summary,
        actorId: session.userId,
        at: now,
        payload: {
          date,
          session: sessionName,
          totalL: result.totalL,
          saleableL: result.saleableL,
          withheldL: result.withheldL,
          colostrumL: result.colostrumL,
          cows,
          lines: result.receiptLines,
        },
      })
      .onConflictDoNothing();

    const headline =
      result.savedCount === 0 && result.duplicateCount > 0
        ? `Already saved — ${result.totalL} L for ${sessionLabel(sessionName).toLowerCase()}.`
        : `${sessionLabel(sessionName)} milking saved — ${result.totalL} L from ${cows} cow${cows === 1 ? "" : "s"}.`;

    return actionOk(result, headline, ref);
  });
}

export function sessionLabel(session: MilkingSession): string {
  return { MORNING: "Morning", NOON: "Midday", EVENING: "Evening" }[session];
}

/**
 * Two or three milkings a day, per farm and changeable over time — historical
 * records keep whichever session they were recorded under.
 */
export async function milkingSessionsForFarm(
  session: Session,
  dbo?: Db,
): Promise<MilkingSession[]> {
  const database = await resolveDb(dbo);
  const farm = await database.query.farm.findFirst({ where: eq(s.farm.id, session.farmId) });
  return farm?.milkingSessions === 3 ? ["MORNING", "NOON", "EVENING"] : ["MORNING", "EVENING"];
}

/* ---------------------------------------------------------------- */
/* Corrections                                                       */
/* ---------------------------------------------------------------- */

const CorrectionInput = z.object({
  recordId: z.string().uuid(),
  litres: z.coerce.number().min(0).max(9999),
  reason: z.string().max(200).optional(),
});

/**
 * A correction is a NEW row pointing at the old one (P3). The original is never
 * edited, because the manager needs to see that a number changed and by whom.
 */
export interface MilkCorrectionInput {
  recordId: string;
  litres: number | string;
  reason?: string;
}

export async function correctMilkRecord(
  session: Session,
  input: MilkCorrectionInput,
  dbo?: Db,
): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const parsed = CorrectionInput.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const database = await resolveDb(dbo);
    const original = await database.query.milkRecord.findFirst({
      where: and(
        eq(s.milkRecord.id, parsed.data.recordId),
        eq(s.milkRecord.farmId, session.farmId),
      ),
    });
    assertOwned(original, session, "milk record");

    const id = newId();
    await database
      .insert(s.milkRecord)
      .values({
        id,
        farmId: session.farmId,
        animalId: original!.animalId,
        recordedOn: original!.recordedOn,
        session: original!.session,
        litres: dec(parsed.data.litres, 2),
        saleable: original!.saleable,
        notSaleableReason: original!.notSaleableReason,
        flagged: true,
        flagReason: "CORRECTION",
        supersedesId: original!.id,
        recordedBy: session.userId,
        recordedAt: new Date(),
      })
      .onConflictDoNothing();

    return actionOk({ id }, `Corrected to ${parsed.data.litres} L. The first entry is kept.`);
  });
}

/* ---------------------------------------------------------------- */
/* Lactation curve                                                   */
/* ---------------------------------------------------------------- */

export interface LactationCurve {
  animalId: string;
  name: string;
  tag: string;
  lastCalvingOn: ISODate | null;
  daysInMilk: number | null;
  peakDailyL: number;
  peakOn: ISODate | null;
  daysToPeak: number | null;
  cumulativeL: number;
  averageDailyL: number;
  projected305L: number;
  persistencyPct: number;
  days: Array<{ date: ISODate; litres: number; dim: number | null }>;
  /** Plain language, because a curve on its own tells a herdsman nothing. */
  message: string;
}

export async function lactationCurve(
  session: Session,
  animalId: string,
  asOf: ISODate = today(),
  dbo?: Db,
): Promise<LactationCurve> {
  const database = await resolveDb(dbo);
  const animal = await database.query.animal.findFirst({
    where: and(eq(s.animal.id, animalId), eq(s.animal.farmId, session.farmId)),
  });
  assertOwned(animal, session, "animal");

  const herd = await lactatingHerd(database, session.farmId, asOf);
  const member = herd.find((h) => h.id === animalId) ?? null;

  const calvings = await database
    .select()
    .from(s.calving)
    .where(and(eq(s.calving.farmId, session.farmId), eq(s.calving.damId, animalId)))
    .orderBy(desc(s.calving.calvedOn));
  const lastCalvingOn = calvings[0]?.calvedOn ?? null;

  const records = live(
    await database
      .select()
      .from(s.milkRecord)
      .where(
        and(
          eq(s.milkRecord.farmId, session.farmId),
          eq(s.milkRecord.animalId, animalId),
          lastCalvingOn ? gte(s.milkRecord.recordedOn, lastCalvingOn) : gte(s.milkRecord.recordedOn, "1900-01-01"),
          lte(s.milkRecord.recordedOn, asOf),
        ),
      ),
  );

  const byDay = new Map<string, number>();
  for (const r of records) {
    byDay.set(r.recordedOn, money((byDay.get(r.recordedOn) ?? 0) + num(r.litres)));
  }
  const days = [...byDay.entries()]
    .map(([date, litres]) => ({
      date,
      litres,
      dim: lastCalvingOn ? daysBetween(lastCalvingOn, date) : null,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const cumulativeL = money(days.reduce((a, d) => a + d.litres, 0));
  const peak = days.reduce<{ date: ISODate; litres: number; dim: number | null } | null>(
    (best, d) => (best === null || d.litres > best.litres ? d : best),
    null,
  );
  const dim = member?.dim ?? (lastCalvingOn ? daysBetween(lastCalvingOn, asOf) : null);
  const averageDailyL = days.length ? money(cumulativeL / days.length) : 0;

  const currentDailyL = days.at(-1)?.litres ?? 0;
  const monthsSincePeak = peak?.dim != null && dim != null ? Math.max(0, (dim - peak.dim) / 30.4375) : 0;

  const projected305L = peak ? project305FromPeak(peak.litres) : 0;
  const persistency = peak ? persistencyPct(peak.litres, currentDailyL, monthsSincePeak) : 100;

  let message: string;
  if (!lastCalvingOn) {
    message = `No calving recorded for ${animal!.name ?? animal!.tag}, so her lactation cannot be dated yet.`;
  } else if (!peak) {
    message = `Nothing recorded since she calved on ${formatDay(lastCalvingOn)}.`;
  } else if (persistency < 88 && monthsSincePeak >= 1) {
    message = `She is holding only ${persistency}% of her peak each month. Below 88% usually means feed or health, not the cow.`;
  } else {
    message = `${cumulativeL} L so far this lactation, peaking at ${peak.litres} L on day ${peak.dim}. On this shape she should reach about ${projected305L} L over ${STANDARD_LACTATION_DAYS} days.`;
  }

  return {
    animalId,
    name: animal!.name ?? animal!.tag,
    tag: animal!.tag,
    lastCalvingOn,
    daysInMilk: dim,
    peakDailyL: peak?.litres ?? 0,
    peakOn: peak?.date ?? null,
    daysToPeak: peak?.dim ?? null,
    cumulativeL,
    averageDailyL,
    projected305L,
    persistencyPct: persistency,
    days,
    message,
  };
}

/* ---------------------------------------------------------------- */
/* The manager's review queue                                        */
/* ---------------------------------------------------------------- */

export interface FlaggedRow {
  id: string;
  animalId: string;
  name: string;
  tag: string;
  recordedOn: ISODate;
  session: MilkingSession;
  litres: number;
  flagReason: string | null;
  reasonLabel: string;
  saleable: boolean;
  notSaleableReason: LockReason | null;
  recordedBy: string;
  recordedByName: string | null;
}

const FLAG_LABEL: Record<string, string> = {
  DROP: "Well below her usual",
  SPIKE: "Well above her usual",
  ABOVE_MAX: "Higher than any cow here gives",
  NEGATIVE: "Less than zero",
  CORRECTION: "Corrected after the fact",
};

/** Everything the manager has not yet looked at. Never rejected, only queued. */
export async function flaggedQueue(
  session: Session,
  dbo?: Db,
  limit = 100,
): Promise<FlaggedRow[]> {
  const database = await resolveDb(dbo);
  const rows = await database
    .select({
      record: s.milkRecord,
      animal: s.animal,
      user: s.appUser,
    })
    .from(s.milkRecord)
    .innerJoin(s.animal, eq(s.animal.id, s.milkRecord.animalId))
    .leftJoin(s.appUser, eq(s.appUser.id, s.milkRecord.recordedBy))
    .where(
      and(
        eq(s.milkRecord.farmId, session.farmId),
        eq(s.milkRecord.flagged, true),
        isNull(s.milkRecord.approvedBy),
      ),
    )
    .orderBy(desc(s.milkRecord.recordedOn))
    .limit(limit);

  return rows.map((r) => ({
    id: r.record.id,
    animalId: r.record.animalId,
    name: r.animal.name ?? r.animal.tag,
    tag: r.animal.tag,
    recordedOn: r.record.recordedOn,
    session: r.record.session,
    litres: num(r.record.litres),
    flagReason: r.record.flagReason,
    reasonLabel: FLAG_LABEL[r.record.flagReason ?? ""] ?? "Needs a look",
    saleable: r.record.saleable,
    notSaleableReason: r.record.notSaleableReason,
    recordedBy: r.record.recordedBy,
    recordedByName: r.user?.fullName ?? null,
  }));
}

/** Herdsmen record, managers approve (R10). Approval is what clears the queue. */
export async function approveMilkRecord(
  session: Session,
  recordId: string,
  dbo?: Db,
): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const database = await resolveDb(dbo);
    const row = await database.query.milkRecord.findFirst({
      where: and(eq(s.milkRecord.id, recordId), eq(s.milkRecord.farmId, session.farmId)),
    });
    assertOwned(row, session, "milk record");

    await database
      .update(s.milkRecord)
      .set({ approvedBy: session.userId })
      .where(and(eq(s.milkRecord.id, recordId), eq(s.milkRecord.farmId, session.farmId)));

    await database.insert(s.auditEntry).values({
      id: newId(),
      farmId: session.farmId,
      tableName: "milk_record",
      rowId: recordId,
      action: "APPROVE",
      actorId: session.userId,
      at: new Date(),
      after: { approvedBy: session.userId },
    });

    return actionOk({ id: recordId }, "Checked and accepted.");
  });
}

/* ---------------------------------------------------------------- */
/* Day summary — what M4 allocates against                           */
/* ---------------------------------------------------------------- */

export interface DayProduction {
  date: ISODate;
  totalL: number;
  saleableL: number;
  withheldL: number;
  colostrumL: number;
  bySession: Array<{ session: MilkingSession; litres: number }>;
  /** Named cows whose milk must not reach a revenue channel today. */
  withheldAnimals: Array<{ animalId: string; name: string; litres: number; reason: LockReason }>;
}

export async function dayProduction(
  session: Session,
  date: ISODate,
  dbo?: Db,
): Promise<DayProduction> {
  const database = await resolveDb(dbo);
  const rows = live(
    await database
      .select({ record: s.milkRecord, animal: s.animal })
      .from(s.milkRecord)
      .innerJoin(s.animal, eq(s.animal.id, s.milkRecord.animalId))
      .where(and(eq(s.milkRecord.farmId, session.farmId), eq(s.milkRecord.recordedOn, date)))
      .then((r) => r.map((x) => ({ ...x.record, animalName: x.animal.name ?? x.animal.tag }))),
  );

  const bySessionMap = new Map<MilkingSession, number>();
  let totalL = 0;
  let saleableL = 0;
  let withheldL = 0;
  let colostrumL = 0;
  const withheldAnimals: DayProduction["withheldAnimals"] = [];

  for (const r of rows) {
    const l = num(r.litres);
    totalL = money(totalL + l);
    bySessionMap.set(r.session, money((bySessionMap.get(r.session) ?? 0) + l));
    if (r.saleable) {
      saleableL = money(saleableL + l);
    } else {
      if (isWithheldReason(r.notSaleableReason)) withheldL = money(withheldL + l);
      if (r.notSaleableReason === "COLOSTRUM") colostrumL = money(colostrumL + l);
      withheldAnimals.push({
        animalId: r.animalId,
        name: r.animalName,
        litres: l,
        reason: (r.notSaleableReason ?? "WITHDRAWAL") as LockReason,
      });
    }
  }

  return {
    date,
    totalL,
    saleableL,
    withheldL,
    colostrumL,
    bySession: s.SESSIONS.filter((x) => bySessionMap.has(x)).map((x) => ({
      session: x,
      litres: bySessionMap.get(x)!,
    })),
    withheldAnimals,
  };
}

/* ---------------------------------------------------------------- */
/* Receipts — persistent and re-viewable (R6)                        */
/* ---------------------------------------------------------------- */

export interface StoredReceipt {
  refCode: string;
  kind: string;
  summary: string;
  at: Date;
  actorName: string | null;
  lines: string[];
}

export async function receiptByRef(
  session: Session,
  ref: string,
  dbo?: Db,
): Promise<StoredReceipt | null> {
  const database = await resolveDb(dbo);
  const rows = await database
    .select({ receipt: s.receipt, user: s.appUser })
    .from(s.receipt)
    .leftJoin(s.appUser, eq(s.appUser.id, s.receipt.actorId))
    .where(and(eq(s.receipt.farmId, session.farmId), eq(s.receipt.refCode, ref)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    refCode: row.receipt.refCode,
    kind: row.receipt.kind,
    summary: row.receipt.summary,
    at: row.receipt.at,
    actorName: row.user?.fullName ?? null,
    lines: displayLines(row.receipt.payload, row.receipt.summary),
  };
}

/**
 * A receipt's `payload` is written by twelve different modules and read by one
 * page, so this is the boundary where it has to be made safe.
 *
 * The feed module stored `lines: [{feedItemId, kg}]` — machine data under a
 * name the viewer reads as sentences — and rendering it threw "Objects are not
 * valid as a React child". A code this app printed on screen itself returned a
 * 500 when the herdsman typed it back in. Anything that is not a string is not
 * a line, no matter what it is called.
 */
function displayLines(payload: unknown, summary: string): string[] {
  const raw = (payload as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(raw)) return [summary];
  const lines = raw.filter((l): l is string => typeof l === "string" && l.trim().length > 0);
  return lines.length > 0 ? lines : [summary];
}

export async function recentReceipts(
  session: Session,
  kind: string | null = null,
  dbo?: Db,
  limit = 20,
): Promise<StoredReceipt[]> {
  const database = await resolveDb(dbo);
  const rows = await database
    .select({ receipt: s.receipt, user: s.appUser })
    .from(s.receipt)
    .leftJoin(s.appUser, eq(s.appUser.id, s.receipt.actorId))
    .where(
      kind
        ? and(eq(s.receipt.farmId, session.farmId), eq(s.receipt.kind, kind))
        : eq(s.receipt.farmId, session.farmId),
    )
    .orderBy(desc(s.receipt.at))
    .limit(limit);

  return rows.map((row) => ({
    refCode: row.receipt.refCode,
    kind: row.receipt.kind,
    summary: row.receipt.summary,
    at: row.receipt.at,
    actorName: row.user?.fullName ?? null,
    lines: displayLines(row.receipt.payload, row.receipt.summary),
  }));
}

/* ---------------------------------------------------------------- */
/* Server Actions — the untrusted entry points                       */
/* ---------------------------------------------------------------- */

/**
 * Everything above takes an already-verified session because it is called from
 * Server Components. THESE are the functions reachable by direct POST, so each
 * one starts with a capability check and derives the session itself.
 */
export async function saveMilkSheetAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<MilkBatchResult>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("RECORD");

    const date = String(formData.get("date") ?? "");
    const sessionName = String(formData.get("session") ?? "");
    const payload = String(formData.get("rows") ?? "[]");

    let rows: unknown;
    try {
      rows = JSON.parse(payload);
    } catch {
      return actionError("The sheet could not be read. Try again.");
    }

    const res = await recordMilkBatch(session, { date, session: sessionName, rows } as MilkBatchInput);
    if (res.ok) {
      const { updateTag } = await import("next/cache");
      updateTag(`milk:${session.farmId}`);
      updateTag(`sales:${session.farmId}`);
    }
    return res;
  });
}

export async function approveMilkRecordAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("APPROVE");
    const id = String(formData.get("recordId") ?? "");
    const res = await approveMilkRecord(session, id);
    if (res.ok) {
      const { updateTag } = await import("next/cache");
      updateTag(`milk:${session.farmId}`);
    }
    return res;
  });
}

export async function correctMilkRecordAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  "use server";
  return guard(async () => {
    const session = await requireCapability("RECORD");
    const res = await correctMilkRecord(session, {
      recordId: String(formData.get("recordId") ?? ""),
      litres: String(formData.get("litres") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (res.ok) {
      const { updateTag } = await import("next/cache");
      updateTag(`milk:${session.farmId}`);
    }
    return res;
  });
}

export const MILK_SESSIONS = s.SESSIONS;

