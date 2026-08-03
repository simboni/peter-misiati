/**
 * Date helpers. Everything in this system is a calendar date string
 * (`YYYY-MM-DD`) rather than a Date object, because a milking on 3 August is
 * the same fact whether the server is in Nairobi or Frankfurt, and timezone
 * drift on a `date` column is a whole class of bug we simply decline to have.
 */

export type ISODate = string; // YYYY-MM-DD

const DAY_MS = 86_400_000;

export function isISODate(v: unknown): v is ISODate {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function toDate(d: ISODate): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function fromDate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function today(now: Date = new Date()): ISODate {
  return fromDate(now);
}

export function addDays(d: ISODate, days: number): ISODate {
  return fromDate(new Date(toDate(d).getTime() + days * DAY_MS));
}

export function addMonths(d: ISODate, months: number): ISODate {
  const dt = toDate(d);
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return fromDate(dt);
}

/** Whole days from `a` to `b`. Negative if `b` is before `a`. */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS);
}

export function monthsBetween(a: ISODate, b: ISODate): number {
  return daysBetween(a, b) / 30.4375;
}

/** Age in whole months. Null-safe for animals with no recorded birth date. */
export function ageMonths(dob: ISODate | null | undefined, asOf: ISODate): number | null {
  if (!dob) return null;
  return monthsBetween(dob, asOf);
}

export function ageDays(dob: ISODate | null | undefined, asOf: ISODate): number | null {
  if (!dob) return null;
  return daysBetween(dob, asOf);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. Standing orders are stored this way. */
export function isoWeekday(d: ISODate): number {
  const wd = toDate(d).getUTCDay(); // 0 = Sunday
  return wd === 0 ? 7 : wd;
}

export function isBefore(a: ISODate, b: ISODate): boolean {
  return a < b; // ISO dates sort lexicographically
}

export function isOnOrAfter(a: ISODate, b: ISODate): boolean {
  return a >= b;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

/** First day of the month containing `d`. Payroll periods key on this. */
export function startOfMonth(d: ISODate): ISODate {
  return `${d.slice(0, 7)}-01`;
}

export function endOfMonth(d: ISODate): ISODate {
  const dt = toDate(startOfMonth(d));
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  return fromDate(new Date(dt.getTime() - DAY_MS));
}

/** Inclusive list of dates. Used to generate delivery rounds and report rows. */
export function dateRange(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Debtor aging bucket. 0–30 / 31–60 / 61–90 / 90+, the convention Kenyan
 * bookkeeping uses and the one an institution's finance office will recognise.
 */
export type AgingBucket = "CURRENT" | "D30" | "D60" | "D90_PLUS";

export function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return "CURRENT";
  if (daysOverdue <= 30) return "D30";
  if (daysOverdue <= 60) return "D60";
  if (daysOverdue <= 90) return "D90_PLUS";
  return "D90_PLUS";
}
