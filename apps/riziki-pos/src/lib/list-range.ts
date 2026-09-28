/**
 * The dates a long list is read over.
 *
 * The reports screen has had this since it was rebuilt: a row of named periods,
 * the range they mean printed beside them, and the choice in the URL. Every
 * other list in the app had nothing — Sales showed every sale there has ever
 * been, twenty at a time, and "what did we sell on the 22nd" meant turning
 * pages until you got there.
 *
 * This is the reports picker's arithmetic with one period added: **all**. A
 * report is always about a period and defaults to this month; a list is a
 * record and defaults to everything, because a shop looking for one sale does
 * not know which month it was in. That one difference is why this is its own
 * module rather than a flag on `periodRange`.
 *
 * Pure, so the rules can be tested without a database or a browser.
 */

import { periodRange, type DateRange, type Period } from "./reports.ts";

export const LIST_PERIODS = ["all", "today", "week", "month", "last-month", "year", "custom"] as const;
export type ListPeriod = (typeof LIST_PERIODS)[number];

export const LIST_PERIOD_LABEL: Record<ListPeriod, string> = {
  all: "All",
  today: "Today",
  week: "This week",
  month: "This month",
  "last-month": "Last month",
  year: "This year",
  custom: "Pick dates",
};

export function isListPeriod(v: string | undefined | null): v is ListPeriod {
  return !!v && (LIST_PERIODS as readonly string[]).includes(v);
}

/**
 * What a named period means for a list, ending today.
 *
 * Null for "all", and null is the whole point: a query that filters on null has
 * to leave the dates out of the SQL altogether rather than reach for some
 * sentinel like 1970, which would quietly drop anything a shop back-dated.
 */
export function listRange(
  period: ListPeriod,
  today: string,
  from?: string,
  to?: string,
): DateRange | null {
  if (period === "all") return null;
  return periodRange(period as Period, today, from, to);
}

/**
 * Read a period off the query string, forgivingly.
 *
 * A pair of dates with no period named is the case that matters: somebody
 * editing the URL, or a link sent with `?from=…&to=…` and nothing else, means
 * "those dates" and not "everything".
 */
export function readListPeriod(params: {
  period?: string;
  from?: string;
  to?: string;
}): ListPeriod {
  if (isListPeriod(params.period)) return params.period;
  if (params.from || params.to) return "custom";
  return "all";
}

/**
 * The same range as SQL bounds on a timestamp column, in shop time.
 *
 * Every date in this system is the Nairobi business date, which is UTC+3, and
 * every report groups by `date(at, '+3 hours')`. A list filtered any other way
 * would disagree with the dashboard about which day a nine-o'clock-at-night
 * sale belongs to — and the shop would be right to believe the dashboard.
 */
export function rangeClause(column: string, range: DateRange | null): {
  sql: string;
  params: string[];
} {
  if (!range) return { sql: "", params: [] };
  return {
    sql: ` AND date(${column}, '+3 hours') BETWEEN ? AND ?`,
    params: [range.from, range.to],
  };
}
