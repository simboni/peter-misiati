/**
 * M72 Analytics & Dashboards — indicators with their definitions attached.
 *
 * Every module in this system already has a summary, and each answers "what is
 * happening now". None of them answers "is it getting better", which is the
 * only question a manager actually has. That is what this module is for.
 *
 * Four rules, and the third is the one that makes the difference between a
 * dashboard people use and a dashboard people argue with:
 *
 *  AN INDICATOR CARRIES ITS DEFINITION. Every figure here says what its
 *  numerator and denominator are, in a sentence, on the screen. "Compliance
 *  87%" with no denominator is a number somebody made up as far as anybody
 *  reading it can tell.
 *
 *  A RATE ON A TINY DENOMINATOR IS NOT REPORTED. One caesarean in two
 *  deliveries is not a 50% caesarean rate, it is two deliveries. Below the
 *  floor the count is shown and the percentage is withheld, because a rate
 *  built on four cases will swing forty points next week and somebody will
 *  make a decision on the swing.
 *
 *  A SMALL CELL IS SUPPRESSED. A disaggregation showing one patient in a
 *  village is an identifiable patient, whatever the column header says. This is
 *  a Data Protection Act matter and not a statistical nicety.
 *
 *  EVERY NUMBER LEADS BACK TO ITS ROWS. Each indicator names the screen where
 *  the underlying records are. A figure nobody can drill into is a figure
 *  nobody believes.
 *
 * ⚠️ These are management indicators, not clinical quality measures. A real
 * indicator set — MOH's, SHA's, or a programme's — has case definitions this
 * module does not encode, and the review register says so.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, today } from "./db.ts";
import { number as configNumber } from "./configuration.ts";

export type Direction = "up" | "down" | "flat";
export type Category = "clinical" | "operations" | "money" | "compliance";

/** Below this, a percentage is withheld and the count is shown instead. */
export const MIN_DENOMINATOR_DEFAULT = 20;

/** The floor in force. A facility reporting to a programme may have its own. */
export function minDenominator(): number {
  return configNumber("indicators.min_denominator");
}

/** A disaggregated cell at or below this is suppressed. */
export const SMALL_CELL_DEFAULT = 4;

/** The suppression floor in force. */
export function smallCell(): number {
  return configNumber("indicators.small_cell");
}

export interface IndicatorDefinition {
  key: string;
  name: string;
  category: Category;
  /** The question a manager is actually asking. */
  question: string;
  /** What is counted on top, in a sentence. */
  numerator: string;
  /** What is counted underneath, in a sentence. */
  denominator: string;
  /** Which way is good. */
  better: "higher" | "lower";
  /** Where the underlying rows are. */
  drillTo: string;
  /** Where the definition came from, or that it is this system's own. */
  source: string;
  unit: "percent" | "count" | "kes" | "days" | "hours";
}

/**
 * The indicator set.
 *
 * ⚠️ Chosen because each is answerable from what this system already records
 * and each is something a Level 2 facility can act on in a week. It is not
 * anybody's official indicator set.
 */
export const INDICATORS: IndicatorDefinition[] = [
  {
    key: "claim_acceptance",
    name: "Claim acceptance",
    category: "money",
    question: "Are we getting paid for what we do?",
    numerator: "claims accepted or paid",
    denominator: "claims that reached a decision",
    better: "higher",
    drillTo: "/claims",
    source: "This system's own definition",
    unit: "percent",
  },
  {
    key: "claim_turnaround",
    name: "Days to submit a claim",
    category: "money",
    question: "Are we submitting inside SHA's window?",
    numerator: "days between the encounter and submission, summed",
    denominator: "claims submitted",
    better: "lower",
    drillTo: "/claims",
    source: "SHA submission window is 7 days",
    unit: "days",
  },
  {
    key: "revenue_collected",
    name: "Collected",
    category: "money",
    question: "What came in?",
    numerator: "payments received",
    denominator: "—",
    better: "higher",
    drillTo: "/payments",
    source: "This system's own definition",
    unit: "kes",
  },
  {
    key: "encounters_closed",
    name: "Consultations finished",
    category: "compliance",
    question: "How many consultations reach a state we can claim for?",
    // Deliberately NOT "encounters carrying a coded diagnosis ÷ closed
    // encounters": closing already requires one, so that reads 100% for ever
    // and measures nothing. What varies is whether the clinician got to the end
    // at all, and an encounter left open is one nobody can bill.
    numerator: "encounters closed",
    denominator: "encounters opened",
    better: "higher",
    drillTo: "/encounters",
    source: "Closing requires a coded primary diagnosis, which SHA requires on a claim",
    unit: "percent",
  },
  {
    key: "lab_turnaround",
    name: "Laboratory turnaround",
    category: "clinical",
    question: "How long does a clinician wait for a result?",
    numerator: "hours between collection and release, summed",
    denominator: "results released",
    better: "lower",
    drillTo: "/laboratory",
    source: "This system's own definition",
    unit: "hours",
  },
  {
    key: "result_acknowledged",
    name: "Results acknowledged",
    category: "clinical",
    question: "Is anybody reading what the laboratory sends back?",
    numerator: "released results a clinician acknowledged",
    denominator: "released results",
    better: "higher",
    drillTo: "/laboratory?view=unread",
    source: "This system's own definition",
    unit: "percent",
  },
  {
    key: "referral_loop",
    name: "Referral loop closed",
    category: "clinical",
    question: "Do we ever find out what happened to the people we send away?",
    numerator: "departed referrals with an outcome recorded",
    denominator: "departed referrals",
    better: "higher",
    drillTo: "/referrals",
    source: "This system's own definition",
    unit: "percent",
  },
  {
    key: "casualty_target",
    name: "Casualty seen within target",
    category: "clinical",
    question: "Are the sickest people being seen in time?",
    numerator: "attendances first seen within their triage target",
    denominator: "attendances that were triaged and seen",
    better: "higher",
    drillTo: "/casualty",
    source: "Targets are the triage scale's, which needs a clinician's sign-off",
    unit: "percent",
  },
  {
    key: "checklist_complete",
    name: "Surgical checklist complete",
    category: "clinical",
    question: "Is the checklist being done, or ticked?",
    numerator: "completed cases with every checklist stage signed",
    denominator: "completed cases",
    better: "higher",
    drillTo: "/theatre",
    source: "WHO Surgical Safety Checklist",
    unit: "percent",
  },
  {
    key: "anc_first_trimester",
    name: "Antenatal booking in the first trimester",
    category: "clinical",
    question: "Are women booking early enough for it to help?",
    numerator: "pregnancies booked at or before 12 weeks",
    denominator: "pregnancies booked",
    better: "higher",
    drillTo: "/maternity",
    source: "WHO recommends the first contact before 12 weeks",
    unit: "percent",
  },
  {
    key: "stock_available",
    name: "Tracer medicines in stock",
    category: "operations",
    question: "Can we dispense what we prescribe?",
    numerator: "formulary items with stock on the shelf",
    denominator: "formulary items with a reorder level set",
    better: "higher",
    drillTo: "/stock",
    source: "This system's own definition",
    unit: "percent",
  },
  {
    key: "dispense_complete",
    name: "Prescriptions dispensed in full",
    category: "operations",
    question: "Are patients leaving with everything they were prescribed?",
    numerator: "prescription lines dispensed in full",
    denominator: "prescription lines dispensed at all",
    better: "higher",
    drillTo: "/pharmacy",
    source: "This system's own definition",
    unit: "percent",
  },
  {
    key: "attendances",
    name: "Attendances",
    category: "operations",
    question: "How busy were we?",
    numerator: "encounters opened",
    denominator: "—",
    better: "higher",
    drillTo: "/encounters",
    source: "This system's own definition",
    unit: "count",
  },
];

export function definitionFor(key: string): IndicatorDefinition | undefined {
  return INDICATORS.find((i) => i.key === key);
}

// ------------------------------------------------------------------ values

export interface IndicatorValue {
  key: string;
  numerator: number;
  denominator: number | null;
  /** Null when the denominator is too small for a rate to mean anything. */
  value: number | null;
  /** Why the value is null, in the words to put on the screen. */
  withheld: string | null;
  from: string;
  to: string;
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Inclusive of both ends, as a half-open ISO range the queries can use. */
function bounds(from: string, to: string): [string, string] {
  return [`${from}T00:00:00.000Z`, `${addDays(to, 1)}T00:00:00.000Z`];
}

function rate(key: string, numerator: number, denominator: number, from: string, to: string): IndicatorValue {
  if (denominator === 0) {
    return { key, numerator, denominator, value: null, withheld: "nothing happened in this period", from, to };
  }
  if (denominator < minDenominator()) {
    // One caesarean in two deliveries is not a 50% caesarean rate. A percentage
    // built on four cases swings forty points next week and somebody makes a
    // decision on the swing.
    return {
      key,
      numerator,
      denominator,
      value: null,
      withheld: `${numerator} of ${denominator} — too few for a percentage to mean anything`,
      from,
      to,
    };
  }
  return {
    key,
    numerator,
    denominator,
    value: Math.round((numerator / denominator) * 1000) / 10,
    withheld: null,
    from,
    to,
  };
}

function plain(key: string, value: number, from: string, to: string): IndicatorValue {
  return { key, numerator: value, denominator: null, value, withheld: null, from, to };
}

/**
 * Compute one indicator over a date range.
 *
 * Each is a query rather than a stored number, because a stored number is one
 * somebody has to remember to recompute and nobody ever does.
 */
export function measure(key: string, facilityId: number, from: string, to: string): IndicatorValue {
  const [start, end] = bounds(from, to);
  const one = (sql: string, ...params: (string | number)[]) =>
    get<{ n: number }>(sql, ...params)?.n ?? 0;

  switch (key) {
    case "claim_acceptance": {
      const decided = one(
        `SELECT COUNT(*) AS n FROM claims WHERE status IN ('accepted','paid','rejected','part_paid')
           AND created_at >= ? AND created_at < ?`,
        start,
        end,
      );
      const accepted = one(
        `SELECT COUNT(*) AS n FROM claims WHERE status IN ('accepted','paid','part_paid')
           AND created_at >= ? AND created_at < ?`,
        start,
        end,
      );
      return rate(key, accepted, decided, from, to);
    }

    case "claim_turnaround": {
      const rows = all<{ days: number }>(
        `SELECT (julianday(c.submitted_at) - julianday(e.opened_at)) AS days
           FROM claims c JOIN encounters e ON e.id = c.encounter_id
          WHERE c.submitted_at IS NOT NULL AND c.submitted_at >= ? AND c.submitted_at < ?`,
        start,
        end,
      );
      if (rows.length === 0) return { key, numerator: 0, denominator: 0, value: null, withheld: "nothing submitted", from, to };
      const total = rows.reduce((sum, r) => sum + Math.max(0, r.days), 0);
      return {
        key,
        numerator: Math.round(total * 10) / 10,
        denominator: rows.length,
        value: Math.round((total / rows.length) * 10) / 10,
        withheld: null,
        from,
        to,
      };
    }

    case "revenue_collected":
      return plain(
        key,
        get<{ n: number }>(
          `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments
            WHERE received_at >= ? AND received_at < ? AND voided_at IS NULL AND refund_of IS NULL`,
          start,
          end,
        )?.n ?? 0,
        from,
        to,
      );

    case "encounters_closed": {
      // Counted on the encounter's own start, both sides, so a consultation
      // opened on the last day of a period is not reported as unfinished.
      const opened = one(
        `SELECT COUNT(*) AS n FROM encounters WHERE facility_id = ? AND opened_at >= ? AND opened_at < ?`,
        facilityId,
        start,
        end,
      );
      const closed = one(
        `SELECT COUNT(*) AS n FROM encounters WHERE facility_id = ? AND status = 'closed'
           AND opened_at >= ? AND opened_at < ?`,
        facilityId,
        start,
        end,
      );
      return rate(key, closed, opened, from, to);
    }

    case "lab_turnaround": {
      const rows = all<{ hours: number }>(
        `SELECT (julianday(r.released_at) - julianday(s.collected_at)) * 24 AS hours
           FROM lab_results r JOIN specimens s ON s.order_id = r.order_id
          WHERE r.released_at IS NOT NULL AND r.released_at >= ? AND r.released_at < ?
            AND s.rejected_at IS NULL`,
        start,
        end,
      );
      if (rows.length === 0) return { key, numerator: 0, denominator: 0, value: null, withheld: "nothing released", from, to };
      const total = rows.reduce((sum, r) => sum + Math.max(0, r.hours), 0);
      return {
        key,
        numerator: Math.round(total * 10) / 10,
        denominator: rows.length,
        value: Math.round((total / rows.length) * 10) / 10,
        withheld: null,
        from,
        to,
      };
    }

    case "result_acknowledged": {
      const released = one(
        `SELECT COUNT(*) AS n FROM lab_results WHERE released_at >= ? AND released_at < ? AND released_at IS NOT NULL`,
        start,
        end,
      );
      const seen = one(
        `SELECT COUNT(*) AS n FROM lab_results r
           JOIN orders o ON o.id = r.order_id
          WHERE r.released_at >= ? AND r.released_at < ? AND o.acknowledged_at IS NOT NULL`,
        start,
        end,
      );
      return rate(key, seen, released, from, to);
    }

    case "referral_loop": {
      const departed = one(
        `SELECT COUNT(*) AS n FROM referrals WHERE facility_id = ? AND departed_at IS NOT NULL
           AND departed_at >= ? AND departed_at < ?`,
        facilityId,
        start,
        end,
      );
      const closed = one(
        `SELECT COUNT(*) AS n FROM referrals WHERE facility_id = ? AND departed_at IS NOT NULL
           AND departed_at >= ? AND departed_at < ? AND outcome IS NOT NULL AND outcome <> ''`,
        facilityId,
        start,
        end,
      );
      return rate(key, closed, departed, from, to);
    }

    case "casualty_target": {
      const seen = all<{ triage: string; arrived_at: string; seen_at: string }>(
        `SELECT triage, arrived_at, seen_at FROM emergency_attendances
          WHERE facility_id = ? AND seen_at IS NOT NULL AND arrived_at >= ? AND arrived_at < ?`,
        facilityId,
        start,
        end,
      );
      const targets: Record<string, number> = { red: 0, orange: 10, yellow: 60, green: 240, blue: 0 };
      const within = seen.filter((a) => {
        const target = targets[a.triage];
        if (target === undefined) return false;
        const minutes = (Date.parse(a.seen_at) - Date.parse(a.arrived_at)) / 60_000;
        return minutes <= target + 0.999;
      }).length;
      return rate(key, within, seen.length, from, to);
    }

    case "checklist_complete": {
      const done = one(
        `SELECT COUNT(*) AS n FROM theatre_cases WHERE facility_id = ? AND status = 'completed'
           AND closed_at >= ? AND closed_at < ?`,
        facilityId,
        start,
        end,
      );
      const complete = one(
        `SELECT COUNT(*) AS n FROM theatre_cases c WHERE c.facility_id = ? AND c.status = 'completed'
           AND c.closed_at >= ? AND c.closed_at < ?
           AND (SELECT COUNT(DISTINCT stage) FROM checklist_answers WHERE case_id = c.id) >= 3`,
        facilityId,
        start,
        end,
      );
      return rate(key, complete, done, from, to);
    }

    case "anc_first_trimester": {
      const booked = all<{ lmp: string | null; booked_on: string }>(
        `SELECT lmp, booked_on FROM pregnancies WHERE booked_on >= ? AND booked_on <= ?`,
        from,
        to,
      );
      // Only pregnancies with a last menstrual period can be placed in a
      // trimester at all, so the denominator says so rather than counting the
      // rest as late.
      const withLmp = booked.filter((p) => p.lmp);
      const early = withLmp.filter(
        (p) =>
          (Date.parse(`${p.booked_on}T00:00:00.000Z`) - Date.parse(`${p.lmp}T00:00:00.000Z`)) /
            (7 * 86_400_000) <=
          12,
      ).length;
      return rate(key, early, withLmp.length, from, to);
    }

    case "stock_available": {
      const levels = all<{ store_code: string; product_code: string }>(
        `SELECT store_code, product_code FROM reorder_levels`,
      );
      const available = levels.filter(
        (l) =>
          (get<{ n: number }>(
            `SELECT COALESCE(SUM(quantity), 0) AS n FROM stock_batches
              WHERE store_code = ? AND product_code = ? AND quarantined = 0 AND expires_on > ?`,
            l.store_code,
            l.product_code,
            to,
          )?.n ?? 0) > 0,
      ).length;
      return rate(key, available, levels.length, from, to);
    }

    case "dispense_complete": {
      const lines = all<{ quantity: number; dispensed: number }>(
        `SELECT pr.quantity AS quantity, COALESCE(SUM(d.quantity), 0) AS dispensed
           FROM dispenses d JOIN prescriptions pr ON pr.id = d.prescription_id
          WHERE d.dispensed_at >= ? AND d.dispensed_at < ?
          GROUP BY pr.id`,
        start,
        end,
      );
      const full = lines.filter((l) => l.dispensed >= l.quantity).length;
      return rate(key, full, lines.length, from, to);
    }

    case "attendances":
      return plain(
        key,
        one(
          `SELECT COUNT(*) AS n FROM encounters WHERE facility_id = ? AND opened_at >= ? AND opened_at < ?`,
          facilityId,
          start,
          end,
        ),
        from,
        to,
      );

    default:
      throw new Error(`no indicator called ${key}`);
  }
}

// ------------------------------------------------------------------ periods

export interface Period {
  label: string;
  from: string;
  to: string;
}

/** The last `count` whole months, oldest first, plus the month in progress. */
export function months(count = 6, asOf = today()): Period[] {
  const [year, month] = asOf.slice(0, 7).split("-").map(Number);
  const periods: Period[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const date = new Date(Date.UTC(year, month - 1 - back, 1));
    const code = date.toISOString().slice(0, 7);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    periods.push({ label: code, from: `${code}-01`, to: last.toISOString().slice(0, 10) });
  }
  return periods;
}

/** The last `count` whole days, oldest first. */
export function days(count = 14, asOf = today()): Period[] {
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(asOf, -(count - 1 - index));
    return { label: date.slice(5), from: date, to: date };
  });
}

export interface Series {
  definition: IndicatorDefinition;
  points: (IndicatorValue & { label: string })[];
}

export function series(key: string, facilityId: number, periods: Period[]): Series {
  const definition = definitionFor(key);
  if (!definition) throw new Error(`no indicator called ${key}`);
  return {
    definition,
    points: periods.map((period) => ({
      ...measure(key, facilityId, period.from, period.to),
      label: period.label,
    })),
  };
}

// ---------------------------------------------------------------- dashboard

export interface Card {
  definition: IndicatorDefinition;
  now: IndicatorValue;
  before: IndicatorValue;
  /** Positive means it moved the way the indicator's `better` says is good. */
  changed: number | null;
  direction: Direction;
}

/**
 * This period against the one before it.
 *
 * The comparison is the whole point. A single figure is a fact; two figures are
 * a trend, and only the second one tells anybody what to do.
 */
export function dashboard(
  facilityId: number,
  category?: Category,
  period?: { from: string; to: string },
  asOf = today(),
): Card[] {
  const to = period?.to ?? asOf;
  const from = period?.from ?? addDays(to, -29);
  const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const beforeTo = addDays(from, -1);
  const beforeFrom = addDays(beforeTo, -(span - 1));

  return INDICATORS.filter((definition) => !category || definition.category === category).map((definition) => {
    const now = measure(definition.key, facilityId, from, to);
    const before = measure(definition.key, facilityId, beforeFrom, beforeTo);

    let changed: number | null = null;
    let direction: Direction = "flat";
    if (now.value !== null && before.value !== null) {
      const delta = Math.round((now.value - before.value) * 10) / 10;
      changed = definition.better === "higher" ? delta : -delta;
      direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    }

    return { definition, now, before, changed, direction };
  });
}

// ----------------------------------------------------------- disaggregation

export interface Cell {
  label: string;
  count: number;
  /** True when the real count was small enough to identify somebody. */
  suppressed: boolean;
}

/**
 * Break a count down, with small cells suppressed.
 *
 * A row showing one patient in a village is an identifiable patient whatever
 * the column header says, and that is a Data Protection Act matter rather than
 * a statistical nicety.
 *
 * TWO PASSES, NOT ONE. Hiding the only small row and then publishing the total
 * hides nothing: anybody can subtract. So where a single row has been withheld,
 * a second — the smallest of what is left — goes with it. That is the whole of
 * secondary suppression, it is not optional, and a table that skips it is a
 * table that thinks it is protecting somebody and is not.
 */
export function breakdown(
  rows: { label: string; count: number }[],
  floor = smallCell(),
): { cells: Cell[]; suppressedTotal: number } {
  const cells: Cell[] = rows.map((row) => ({
    label: row.label,
    count: row.count,
    suppressed: row.count > 0 && row.count <= floor,
  }));

  // A zero row hides nothing and is not a candidate for either pass: withholding
  // it would say "somebody was here" where nobody was.
  const suppressible = () => cells.filter((cell) => !cell.suppressed && cell.count > 0);

  while (cells.filter((cell) => cell.suppressed).length === 1 && suppressible().length > 0) {
    // The smallest of what is left, because suppressing the largest throws away
    // the most information for the same protection.
    const next = suppressible().reduce((min, cell) => (cell.count < min.count ? cell : min));
    next.suppressed = true;
  }

  let suppressedTotal = 0;
  for (const cell of cells) {
    if (cell.suppressed) {
      suppressedTotal += cell.count;
      cell.count = 0;
    }
  }

  return { cells, suppressedTotal };
}

/** Attendances by the village people gave at registration, suppressed. */
export function attendancesByVillage(facilityId: number, from: string, to: string) {
  const [start, end] = bounds(from, to);
  const rows = all<{ label: string; count: number }>(
    `SELECT COALESCE(NULLIF(p.village, ''), 'not recorded') AS label, COUNT(*) AS count
       FROM encounters e JOIN patients p ON p.mrn = e.patient_mrn
      WHERE e.facility_id = ? AND e.opened_at >= ? AND e.opened_at < ?
      GROUP BY label ORDER BY count DESC`,
    facilityId,
    start,
    end,
  );
  return breakdown(rows);
}

/**
 * How much it moved, in the indicator's own unit.
 *
 * A percentage moves in points, money moves in shillings, and a count moves in
 * things — printing a change in cents beside a figure in shillings is how a
 * dashboard loses an argument it should have won.
 */
export function presentChange(card: Card): string | null {
  if (card.changed === null || card.now.value === null || card.before.value === null) return null;
  const moved = Math.abs(Math.round((card.now.value - card.before.value) * 10) / 10);
  if (moved === 0) return "no change on the period before";

  const size =
    card.definition.unit === "percent" ? `${moved} points`
    : card.definition.unit === "kes" ? `KES ${(moved / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : card.definition.unit === "days" ? `${moved} day${moved === 1 ? "" : "s"}`
    : card.definition.unit === "hours" ? `${moved} hour${moved === 1 ? "" : "s"}`
    : String(moved);

  return `${size} ${card.direction === "up" ? "higher" : "lower"} than the period before`;
}

/** The formatted value, with its unit, or what to say instead. */
export function present(value: IndicatorValue, definition: IndicatorDefinition): string {
  if (value.value === null) return value.withheld ?? "—";
  switch (definition.unit) {
    case "percent":
      return `${value.value}%`;
    case "kes":
      return `KES ${(value.value / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    // "0 days" reads as a missing number rather than a fast one, so a duration
    // shorter than its own unit says what it means.
    case "days":
      return value.value === 0 ? "same day" : `${value.value} day${value.value === 1 ? "" : "s"}`;
    case "hours":
      return value.value === 0 ? "under an hour" : `${value.value} hour${value.value === 1 ? "" : "s"}`;
    default:
      return String(value.value);
  }
}
