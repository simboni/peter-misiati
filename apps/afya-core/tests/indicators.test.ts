/**
 * M72 Analytics & Dashboards.
 *
 * The tests that matter are about numbers this module refuses to print: a
 * percentage on four cases, and a breakdown cell holding one identifiable
 * patient. Everything else is arithmetic.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-indicators-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const I = await import("../src/lib/indicators.ts");
const P = await import("../src/lib/patients.ts");
const E = await import("../src/lib/encounters.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { today } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "IND1", label: "Office", byUserId: adminId, byUserName: "admin" });

const DEV = "IND1";
const BY = { byUserId: receptionistId!, byUserName: "Joseph Otieno" };

let nid = 90_000_000;
function attendance(coded: boolean, village = "Kayole") {
  const mrn = P.registerPatient({
    facilityId, deviceCode: DEV, givenName: "Count", familyName: `Case${++nid}`,
    sex: "female", dateOfBirth: "1990-01-01", nationalId: String(nid), village, ...BY,
  });
  const enc = E.openEncounter({
    facilityId, patientMrn: mrn, kind: "outpatient",
    clinicianId: clinicianId!, clinicianName: "Dr. Achieng Wanjiru", deviceCode: DEV,
  });
  if (coded) {
    E.addDiagnosis({
      encounterId: enc, code: "1F40", byUserId: clinicianId!,
      byUserName: "Dr. Achieng Wanjiru", deviceCode: DEV,
    });
    E.writeNote({
      encounterId: enc, complaint: "Fever", assessment: "Malaria", plan: "AL",
      authorId: clinicianId!, authorName: "Dr. Achieng Wanjiru", deviceCode: DEV,
    });
    E.closeEncounter({
      encounterId: enc, byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru", deviceCode: DEV,
    });
  }
  return { mrn, enc };
}

// ---------------------------------------------------------- definitions

test("every indicator says what its numerator and denominator are", () => {
  // "Compliance 87%" with no denominator is a number somebody made up, as far
  // as anybody reading it can tell.
  for (const definition of I.INDICATORS) {
    assert.ok(definition.question.length > 10, `${definition.key} has no question`);
    assert.ok(definition.numerator.length > 2, `${definition.key} has no numerator`);
    assert.ok(definition.denominator.length > 0, `${definition.key} has no denominator`);
    assert.ok(definition.source.length > 5, `${definition.key} cites no source`);
    assert.ok(definition.drillTo.startsWith("/"), `${definition.key} leads nowhere`);
  }
});

test("every indicator key is unique and measurable", () => {
  const keys = new Set(I.INDICATORS.map((i) => i.key));
  assert.equal(keys.size, I.INDICATORS.length);
  for (const definition of I.INDICATORS) {
    assert.doesNotThrow(() => I.measure(definition.key, facilityId, "2026-01-01", today()));
  }
});

test("an indicator nobody defined is an error, not a zero", () => {
  assert.throws(() => I.measure("made_up", facilityId, "2026-01-01", today()), /no indicator called/);
});

// ------------------------------------------------------------ suppression

test("a rate on a tiny denominator is withheld and the count is shown instead", () => {
  // One caesarean in two deliveries is not a 50% caesarean rate, it is two
  // deliveries. A percentage on four cases swings forty points next week.
  attendance(true);
  attendance(false);

  const value = I.measure("encounters_closed", facilityId, "2026-01-01", today());
  assert.equal(value.value, null);
  assert.match(value.withheld!, /too few for a percentage/);
  assert.ok(value.denominator! < I.MIN_DENOMINATOR);
});

test("past the floor the percentage is reported", () => {
  for (let n = 0; n < I.MIN_DENOMINATOR; n++) attendance(true);

  const value = I.measure("encounters_closed", facilityId, "2026-01-01", today());
  assert.ok(value.denominator! >= I.MIN_DENOMINATOR);
  assert.equal(value.withheld, null);
  assert.ok(value.value !== null && value.value > 90);
});

test("a period where nothing happened says so rather than reading zero percent", () => {
  const value = I.measure("encounters_closed", facilityId, "2020-01-01", "2020-01-31");
  assert.equal(value.value, null);
  assert.match(value.withheld!, /nothing happened/);
});

test("a count is a count — the floor does not apply to it", () => {
  const value = I.measure("attendances", facilityId, "2026-01-01", today());
  assert.equal(value.denominator, null);
  assert.ok(value.value !== null && value.value > 0);
});

// ----------------------------------------------------------- small cells

test("a breakdown cell holding one patient is suppressed", () => {
  // A row showing one patient in a village is an identifiable patient whatever
  // the column header says.
  const { cells, suppressedTotal } = I.breakdown([
    { label: "Kayole", count: 40 },
    { label: "Mwiki", count: 3 },
    { label: "Githurai", count: 1 },
  ]);

  assert.equal(cells[0].count, 40);
  assert.equal(cells[0].suppressed, false);
  assert.equal(cells[1].suppressed, true);
  assert.equal(cells[1].count, 0);
  assert.equal(cells[2].suppressed, true);
  assert.equal(suppressedTotal, 4);
});

test("a zero cell is not a suppressed cell", () => {
  const { cells, suppressedTotal } = I.breakdown([{ label: "Nowhere", count: 0 }]);
  assert.equal(cells[0].suppressed, false);
  assert.equal(suppressedTotal, 0);
});

test("the village breakdown suppresses on real data", () => {
  attendance(true, "Ruai");
  const { cells } = I.attendancesByVillage(facilityId, "2026-01-01", today());
  assert.ok(cells.some((c) => c.label === "Ruai" && c.suppressed));
});

// ------------------------------------------------------------- dashboard

test("the dashboard compares this period against the one before it", () => {
  // A single figure is a fact; two figures are a trend, and only the second
  // one tells anybody what to do.
  const cards = I.dashboard(facilityId);
  assert.equal(cards.length, I.INDICATORS.length);

  for (const card of cards) {
    assert.equal(card.now.from > card.before.to, true, "the periods do not overlap");
  }
});

test("a filtered dashboard shows only that category", () => {
  const money = I.dashboard(facilityId, "money");
  assert.ok(money.length > 0);
  assert.ok(money.every((card) => card.definition.category === "money"));
});

test("change is measured in the direction the indicator says is good", () => {
  // A turnaround that fell is an improvement; an acceptance rate that fell is
  // not, and the card has to know which.
  const cards = I.dashboard(facilityId);
  const lower = cards.find((c) => c.definition.better === "lower")!;
  if (lower.now.value !== null && lower.before.value !== null) {
    const delta = lower.now.value - lower.before.value;
    assert.equal(lower.changed, Math.round(-delta * 10) / 10);
  }
});

test("a withheld value produces no change figure rather than a made-up one", () => {
  const cards = I.dashboard(facilityId, undefined, { from: "2020-01-01", to: "2020-01-31" });
  assert.ok(cards.every((card) => (card.now.value === null ? card.changed === null : true)));
});

// ---------------------------------------------------------------- periods

test("months come back oldest first and end on the real last day", () => {
  const periods = I.months(3, "2026-03-15");
  assert.deepEqual(periods.map((p) => p.label), ["2026-01", "2026-02", "2026-03"]);
  assert.equal(periods[0].to, "2026-01-31");
  assert.equal(periods[1].to, "2026-02-28", "2026 is not a leap year");
  assert.equal(periods[2].from, "2026-03-01");
});

test("a leap February ends on the 29th", () => {
  const periods = I.months(1, "2028-02-10");
  assert.equal(periods[0].to, "2028-02-29");
});

test("days come back oldest first and include today", () => {
  const periods = I.days(3, "2026-09-16");
  assert.deepEqual(periods.map((p) => p.from), ["2026-09-14", "2026-09-15", "2026-09-16"]);
});

test("a series carries its definition with it", () => {
  const series = I.series("attendances", facilityId, I.months(3));
  assert.equal(series.definition.key, "attendances");
  assert.equal(series.points.length, 3);
  assert.ok(series.points.every((point) => point.label.length > 0));
});

// -------------------------------------------------------------- presenting

test("a duration shorter than its own unit says what it means", () => {
  // "0 days" reads as a missing number rather than a fast one.
  const definition = I.definitionFor("claim_turnaround")!;
  assert.equal(
    I.present({ key: "x", numerator: 0, denominator: 3, value: 0, withheld: null, from: "", to: "" }, definition),
    "same day",
  );
  assert.equal(
    I.present({ key: "x", numerator: 0, denominator: 3, value: 1, withheld: null, from: "", to: "" }, definition),
    "1 day",
  );
});

test("a withheld value presents as its reason, never as a dash nobody can read", () => {
  const definition = I.definitionFor("claim_acceptance")!;
  const shown = I.present(
    { key: "x", numerator: 2, denominator: 3, value: null, withheld: "2 of 3 — too few", from: "", to: "" },
    definition,
  );
  assert.equal(shown, "2 of 3 — too few");
});

test("money presents in shillings, from cents", () => {
  const definition = I.definitionFor("revenue_collected")!;
  assert.equal(
    I.present({ key: "x", numerator: 0, denominator: null, value: 176_000, withheld: null, from: "", to: "" }, definition),
    "KES 1,760.00",
  );
});
