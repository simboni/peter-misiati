/**
 * The dates a long list is read over, and the search inside a dropdown.
 *
 * Both are the kind of thing that looks obviously right and is quietly wrong at
 * one edge: a list filtered in UTC disagrees with the dashboard about which day
 * a nine-o'clock sale belongs to, and a picker that matches on the visible
 * label alone cannot find Ungerol by the name the shop actually says.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  LIST_PERIODS,
  isListPeriod,
  listRange,
  rangeClause,
  readListPeriod,
} from "../src/lib/list-range.ts";
import { matchOptions, pickerRows, type PickerOption } from "../src/lib/picker-match.ts";

const TODAY = "2026-09-28"; // a Monday

// ------------------------------------------------------------- the periods

test("all time is the default for a list, unlike a report", () => {
  // A report answers "how did this month go" and defaults to this month. A list
  // is a record: somebody hunting one sale rarely knows which month it was in.
  assert.equal(readListPeriod({}), "all");
  assert.equal(listRange("all", TODAY), null);
});

test("all time is null rather than a very old date", () => {
  // A sentinel like 1970 would quietly drop anything back-dated before it, and
  // the query has to leave the dates out of the SQL altogether.
  assert.equal(rangeClause("s.at", null).sql, "");
  assert.deepEqual(rangeClause("s.at", null).params, []);
});

test("today is one day, both ends", () => {
  assert.deepEqual(listRange("today", TODAY), { from: TODAY, to: TODAY });
});

test("this week runs from Monday, not the last seven days", () => {
  // The shop closes its books by the calendar week, so "this week" on a Monday
  // is one day and not eight.
  assert.deepEqual(listRange("week", TODAY), { from: "2026-09-28", to: TODAY });
  assert.deepEqual(listRange("week", "2026-09-30"), { from: "2026-09-28", to: "2026-09-30" });
});

test("a Sunday belongs to the week that has just been worked", () => {
  // Sunday is day 0 in JavaScript and the naive arithmetic sends it forward to
  // the week that has not happened yet.
  assert.deepEqual(listRange("week", "2026-10-04"), { from: "2026-09-28", to: "2026-10-04" });
});

test("this month and last month", () => {
  assert.deepEqual(listRange("month", TODAY), { from: "2026-09-01", to: TODAY });
  assert.deepEqual(listRange("last-month", TODAY), { from: "2026-08-01", to: "2026-08-31" });
});

test("dates typed backwards are a typo, not an empty list", () => {
  assert.deepEqual(listRange("custom", TODAY, "2026-09-20", "2026-09-10"), {
    from: "2026-09-10",
    to: "2026-09-20",
  });
});

test("a link carrying dates and no period means those dates", () => {
  // Somebody editing the URL, or a link sent as ?from=…&to=… alone.
  assert.equal(readListPeriod({ from: "2026-09-01" }), "custom");
  assert.equal(readListPeriod({ to: "2026-09-01" }), "custom");
  assert.equal(readListPeriod({ period: "week" }), "week");
  assert.equal(readListPeriod({ period: "nonsense" }), "all");
});

test("every period the bar offers is one the range function knows", () => {
  for (const p of LIST_PERIODS) {
    assert.ok(isListPeriod(p));
    if (p !== "all") assert.ok(listRange(p, TODAY), `${p} has a range`);
  }
});

test("the dates are compared in shop time, not UTC", () => {
  // Nairobi is UTC+3. A sale at 21:30 local is 18:30 UTC and belongs to that
  // day; one at 00:30 local is 21:30 UTC the day before and must not fall into
  // yesterday's list while the dashboard puts it in today's.
  const { sql, params } = rangeClause("s.at", { from: "2026-09-22", to: "2026-09-22" });
  assert.match(sql, /date\(s\.at, '\+3 hours'\) BETWEEN \? AND \?/);
  assert.deepEqual(params, ["2026-09-22", "2026-09-22"]);
});

// ------------------------------------------------- the search in a dropdown

const CATALOGUE: PickerOption[] = [
  { value: 1, label: "Ungerol", hint: "bulk · per kg", search: "sles sodium lauryl" },
  { value: 2, label: "Ungerol — 20 kg jerrican", hint: "pack" },
  { value: 3, label: "Sodium Sulphate", hint: "bulk · per kg", search: "na2so4" },
  { value: 4, label: "Caustic Soda Flakes", hint: "bulk · per kg" },
];

test("a name the shop says finds a product the catalogue spells differently", () => {
  // "sles" is what the counter calls it; the catalogue says Ungerol. A picker
  // that matched only the visible label would find nothing.
  assert.deepEqual(matchOptions(CATALOGUE, "sles").map((o) => o.value), [1]);
  assert.deepEqual(matchOptions(CATALOGUE, "na2so4").map((o) => o.value), [3]);
});

test("every typed word has to appear, in any order", () => {
  assert.deepEqual(matchOptions(CATALOGUE, "ungerol 20").map((o) => o.value), [2]);
  assert.deepEqual(matchOptions(CATALOGUE, "20 ungerol").map((o) => o.value), [2]);
  assert.deepEqual(matchOptions(CATALOGUE, "caustic flakes").map((o) => o.value), [4]);
});

test("matching ignores case, and the hint counts", () => {
  assert.equal(matchOptions(CATALOGUE, "UNGEROL").length, 2);
  assert.deepEqual(matchOptions(CATALOGUE, "jerrican").map((o) => o.value), [2]);
  assert.equal(matchOptions(CATALOGUE, "bulk").length, 3, "the kind is searchable too");
});

test("an empty box shows the list rather than nothing", () => {
  assert.equal(matchOptions(CATALOGUE, "").length, CATALOGUE.length);
  assert.equal(matchOptions(CATALOGUE, "   ").length, CATALOGUE.length);
});

test("nothing matching is nothing, not everything", () => {
  assert.deepEqual(matchOptions(CATALOGUE, "bicycle"), []);
});

test("a long catalogue is cut, so the panel cannot become the scroll it replaced", () => {
  const many: PickerOption[] = Array.from({ length: 200 }, (_, i) => ({
    value: i,
    label: `Item ${i}`,
  }));
  assert.equal(matchOptions(many, "").length, 60);
  assert.equal(matchOptions(many, "item").length, 60);
  assert.equal(matchOptions(many, "", 10).length, 10);
});

// ------------------------------------------- the row that is never filtered

/**
 * The bug this exists to prevent, written down.
 *
 * "Add a new customer" was an option like any other, so the search filtered it.
 * Type the name of somebody who is not on file — which is the one moment that
 * row is wanted — and the list said "nothing matches" and offered no way to put
 * them on file. The counter could no longer add a customer from the till.
 */
const kinds = (rows: ReturnType<typeof pickerRows>) => rows.map((r) => r.kind);

test("the action row survives a search that matches nothing", () => {
  const rows = pickerRows(CATALOGUE, "kamau", { allowNone: true, hasAction: true });
  assert.deepEqual(kinds(rows), ["none", "action"], "no matches, and still a way to act");
});

test("the action row is last, after whatever the search left", () => {
  const rows = pickerRows(CATALOGUE, "ungerol", { allowNone: true, hasAction: true });
  assert.deepEqual(kinds(rows), ["none", "option", "option", "action"]);
});

test("the action row is there on an empty box too", () => {
  const rows = pickerRows(CATALOGUE, "", { hasAction: true });
  assert.equal(kinds(rows).filter((k) => k === "action").length, 1);
  assert.equal(kinds(rows)[kinds(rows).length - 1], "action");
});

test("a picker with no action has none, and a filter with no action has none", () => {
  assert.equal(kinds(pickerRows(CATALOGUE, "", { allowNone: true })).includes("action"), false);
  assert.deepEqual(kinds(pickerRows(CATALOGUE, "kamau", {})), [], "nothing at all to show");
});

test("the walk-in row is not filtered away either", () => {
  // Same class of mistake: "nobody" is a choice, not a match.
  assert.equal(kinds(pickerRows(CATALOGUE, "kamau", { allowNone: true }))[0], "none");
});
