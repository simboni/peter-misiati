/**
 * The shop's date, for a row the database wrote.
 *
 * Everything is stored in UTC and the shop lives at UTC+3, so every report in
 * this system groups by `date(at, '+3 hours')`. Taking the first ten characters
 * of a stored timestamp instead reads so naturally that it was done in three
 * places — and it is wrong for everything recorded between nine at night and
 * midnight in Nairobi.
 *
 * That is not a theoretical window for this shop. It trades until eight and the
 * day's deliveries get typed afterwards, so a delivery booked at half past nine
 * simply landed on yesterday, or fell out of a report that asked for today.
 * These tests fix the rule in place so it cannot drift back.
 */

import test from "node:test";
import assert from "node:assert/strict";

const { businessDateOf, businessDate } = await import("../src/lib/units.ts");

test("an evening delivery belongs to the day the shop was open", () => {
  // 21:30 UTC is half past midnight in Nairobi — the next day.
  assert.equal(businessDateOf("2026-06-15 21:30:00"), "2026-06-16");
  assert.equal(businessDateOf("2026-06-15 20:59:59"), "2026-06-15", "and 23:59 is still today");
});

test("the hours that are not near midnight are left alone", () => {
  assert.equal(businessDateOf("2026-06-15 06:00:00"), "2026-06-15");
  assert.equal(businessDateOf("2026-06-15 13:45:12"), "2026-06-15");
  assert.equal(businessDateOf("2026-01-01 00:00:00"), "2026-01-01", "midnight UTC is 3am here");
});

test("it reads the stored shape and the ISO one the same way", () => {
  assert.equal(
    businessDateOf("2026-06-15 21:30:00"),
    businessDateOf("2026-06-15T21:30:00Z"),
    "SQLite writes a space, an API hands back a T — one rule for both",
  );
});

test("it agrees with the clock for right now", () => {
  assert.equal(businessDateOf(new Date().toISOString()), businessDate());
});

test("the turn of a month and a year go with the shop, not with UTC", () => {
  assert.equal(businessDateOf("2026-06-30 21:30:00"), "2026-07-01");
  assert.equal(businessDateOf("2026-12-31 21:30:00"), "2027-01-01");
});
