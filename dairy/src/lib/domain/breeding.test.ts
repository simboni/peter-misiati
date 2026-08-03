import { describe, it, expect } from "vitest";
import {
  gestationDays,
  breedingCalendar,
  interpretReturn,
  calvingInterval,
  daysOpen,
  ageAtFirstCalvingMonths,
  servicesPerConception,
  calvingIntervalCostKes,
  inseminationWindow,
  GESTATION_DAYS,
  DEFAULT_GESTATION_DAYS,
  CYCLE_DAYS,
  PD_DUE_DAYS,
  DRY_PERIOD_DAYS,
  REPRO_BENCHMARKS,
} from "./breeding";
import { addDays, daysBetween } from "./dates";

/**
 * One service date in, a calendar of alerts out. Everything the breeding module
 * promises a farmer rests on these functions being right to the day.
 */

describe("gestationDays", () => {
  it("uses the breed table where we have one", () => {
    expect(gestationDays("FRIESIAN")).toBe(281);
    expect(gestationDays("HOLSTEIN")).toBe(281);
    expect(gestationDays("HOLSTEIN-FRIESIAN")).toBe(281);
    expect(gestationDays("AYRSHIRE")).toBe(279);
    expect(gestationDays("JERSEY")).toBe(279);
    expect(gestationDays("GUERNSEY")).toBe(283);
  });

  it("runs Bos indicus longer than Bos taurus, which is the whole reason for the table", () => {
    expect(gestationDays("SAHIWAL")).toBe(288);
    expect(gestationDays("ZEBU")).toBe(288);
    expect(gestationDays("BORAN")).toBe(288);
    expect(gestationDays("SAHIWAL")).toBeGreaterThan(gestationDays("FRIESIAN"));
  });

  it("is case- and whitespace-insensitive, because breed is typed by hand", () => {
    expect(gestationDays("friesian")).toBe(281);
    expect(gestationDays("  Ayrshire  ")).toBe(279);
  });

  it("falls back to the 283-day Kenyan default for null, empty and unknown breeds", () => {
    expect(gestationDays(null)).toBe(DEFAULT_GESTATION_DAYS);
    expect(gestationDays(undefined)).toBe(DEFAULT_GESTATION_DAYS);
    expect(gestationDays("")).toBe(DEFAULT_GESTATION_DAYS);
    expect(gestationDays("3/4 Friesian x 1/4 Zebu")).toBe(DEFAULT_GESTATION_DAYS);
    expect(DEFAULT_GESTATION_DAYS).toBe(283);
  });

  it("keeps every table entry inside a biologically sane range", () => {
    for (const [breed, days] of Object.entries(GESTATION_DAYS)) {
      expect(days, breed).toBeGreaterThanOrEqual(270);
      expect(days, breed).toBeLessThanOrEqual(295);
    }
  });
});

describe("breedingCalendar", () => {
  // The worked example from docs/dairy/04-workflows.md §4.3.
  const cal = breedingCalendar("2026-08-03", null);

  it("puts the return-to-heat watch one cycle out", () => {
    expect(cal.expectedReturnOn).toBe("2026-08-24");
    expect(daysBetween(cal.servedOn, cal.expectedReturnOn)).toBe(CYCLE_DAYS);
  });

  it("puts the pregnancy check at 60 days, when rectal palpation becomes reliable", () => {
    expect(cal.pdDueOn).toBe("2026-10-02");
    expect(daysBetween(cal.servedOn, cal.pdDueOn)).toBe(PD_DUE_DAYS);
  });

  it("puts calving 283 days out for an unknown breed", () => {
    expect(cal.expectedCalvingOn).toBe("2027-05-13");
    expect(cal.gestationDays).toBe(283);
  });

  it("puts dry-off and steaming up together, 60 days before calving", () => {
    expect(cal.dryOffDueOn).toBe("2027-03-14");
    expect(cal.steamingUpFrom).toBe(cal.dryOffDueOn);
    expect(daysBetween(cal.dryOffDueOn, cal.expectedCalvingOn)).toBe(DRY_PERIOD_DAYS);
  });

  it("puts the springer window at 21 days and the calving alert at 7", () => {
    expect(daysBetween(cal.springerFrom, cal.expectedCalvingOn)).toBe(21);
    expect(daysBetween(cal.calvingAlertFrom, cal.expectedCalvingOn)).toBe(7);
  });

  it("shortens the whole calendar for a Friesian and lengthens it for a Sahiwal", () => {
    const friesian = breedingCalendar("2026-08-03", "FRIESIAN");
    const sahiwal = breedingCalendar("2026-08-03", "SAHIWAL");
    expect(friesian.expectedCalvingOn).toBe(addDays("2026-08-03", 281));
    expect(sahiwal.expectedCalvingOn).toBe(addDays("2026-08-03", 288));
    // Return and PD do not move — they are cycle facts, not gestation facts.
    expect(friesian.expectedReturnOn).toBe(sahiwal.expectedReturnOn);
    expect(friesian.pdDueOn).toBe(sahiwal.pdDueOn);
    // Dry-off tracks calving, so it does move.
    expect(friesian.dryOffDueOn).not.toBe(sahiwal.dryOffDueOn);
  });

  it("stays in order and crosses a leap year without drift", () => {
    const leap = breedingCalendar("2027-12-20", "FRIESIAN");
    expect(leap.expectedCalvingOn).toBe("2028-09-26");
    expect(leap.servedOn < leap.expectedReturnOn).toBe(true);
    expect(leap.expectedReturnOn < leap.pdDueOn).toBe(true);
    expect(leap.pdDueOn < leap.dryOffDueOn).toBe(true);
    expect(leap.dryOffDueOn < leap.springerFrom).toBe(true);
    expect(leap.springerFrom < leap.calvingAlertFrom).toBe(true);
    expect(leap.calvingAlertFrom < leap.expectedCalvingOn).toBe(true);
  });
});

describe("interpretReturn — a return to heat is diagnosed, not merely recorded", () => {
  it("at 2 days, says the service date is probably wrong", () => {
    const r = interpretReturn("2026-08-03", "2026-08-05");
    expect(r.verdict).toBe("TOO_SOON");
    expect(r.intervalDays).toBe(2);
    expect(r.message).toMatch(/service date/i);
  });

  it("at 10 days, says mistimed insemination or early embryonic loss", () => {
    const r = interpretReturn("2026-08-03", "2026-08-13");
    expect(r.verdict).toBe("EARLY_LOSS_OR_MISTIMED");
    expect(r.intervalDays).toBe(10);
    expect(r.message).toMatch(/mistimed|lost/i);
  });

  it("at 21 days, says a normal return — serve her again on this heat", () => {
    const r = interpretReturn("2026-08-03", "2026-08-24");
    expect(r.verdict).toBe("NORMAL_RETURN");
    expect(r.intervalDays).toBe(21);
    expect(r.message).toMatch(/serve her again/i);
  });

  it("at 42 days, calls it a MISSED HEAT and names it a detection problem", () => {
    // The single most valuable verdict in the module: it is a failure the
    // manager can fix this week, not a fertility failure to shrug at.
    const r = interpretReturn("2026-08-03", "2026-09-14");
    expect(r.verdict).toBe("MISSED_HEAT");
    expect(r.intervalDays).toBe(42);
    expect(r.message).toMatch(/2 cycles/);
    expect(r.message).toMatch(/1 heat was missed/);
    expect(r.message).toMatch(/detection problem, not a fertility one/i);
  });

  it("at 63 days, says two heats were missed", () => {
    const r = interpretReturn("2026-08-03", "2026-10-05");
    expect(r.verdict).toBe("MISSED_HEAT");
    expect(r.intervalDays).toBe(63);
    expect(r.message).toMatch(/3 cycles/);
    expect(r.message).toMatch(/2 heats were missed/);
  });

  it("at 35 days, calls it IRREGULAR — it fits no whole number of cycles", () => {
    const r = interpretReturn("2026-08-03", "2026-09-07");
    expect(r.verdict).toBe("IRREGULAR");
    expect(r.intervalDays).toBe(35);
    expect(r.message).toMatch(/cystic ovary/i);
  });

  it("holds the 18–24 day normal window at both edges", () => {
    expect(interpretReturn("2026-08-03", "2026-08-20").verdict).toBe("EARLY_LOSS_OR_MISTIMED"); // 17
    expect(interpretReturn("2026-08-03", "2026-08-21").verdict).toBe("NORMAL_RETURN"); // 18
    expect(interpretReturn("2026-08-03", "2026-08-27").verdict).toBe("NORMAL_RETURN"); // 24
    expect(interpretReturn("2026-08-03", "2026-08-28").verdict).toBe("IRREGULAR"); // 25
  });

  it("tolerates the real spread around a doubled cycle", () => {
    // 38–46 days all read as two cycles; heat is not a metronome.
    for (const d of [38, 40, 42, 44, 46]) {
      const r = interpretReturn("2026-08-03", addDays("2026-08-03", d));
      expect(r.verdict, `${d} days`).toBe("MISSED_HEAT");
    }
  });

  it("always returns a message with no jargon and no codes", () => {
    for (const d of [1, 5, 12, 21, 30, 42, 63, 100]) {
      const r = interpretReturn("2026-08-03", addDays("2026-08-03", d));
      expect(r.message).not.toMatch(/rc=|error|_[A-Z]/);
      expect(r.message.length).toBeGreaterThan(20);
    }
  });
});

describe("reproductive KPIs", () => {
  it("measures a calving interval in whole days", () => {
    expect(calvingInterval("2025-08-03", "2026-08-03")).toBe(365);
  });

  it("measures days open from calving to the conceiving service", () => {
    expect(daysOpen("2026-01-10", "2026-04-20")).toBe(100);
  });

  it("measures age at first calving in months", () => {
    expect(ageAtFirstCalvingMonths("2024-01-01", "2026-01-01")).toBeCloseTo(24, 1);
  });

  it("computes services per conception, and refuses to divide by zero", () => {
    expect(servicesPerConception(8, 5)).toBeCloseTo(1.6, 5);
    expect(servicesPerConception(3, 0)).toBe(0);
  });

  it("states the honest Kenyan benchmarks next to the targets", () => {
    expect(REPRO_BENCHMARKS.calvingIntervalDays.target).toBe(380);
    expect(REPRO_BENCHMARKS.calvingIntervalDays.kenyanObserved).toBeGreaterThan(
      REPRO_BENCHMARKS.calvingIntervalDays.acceptable,
    );
    expect(REPRO_BENCHMARKS.ageAtFirstCalvingMonths.kenyanObserved).toBeGreaterThan(
      REPRO_BENCHMARKS.ageAtFirstCalvingMonths.target,
    );
  });
});

describe("calvingIntervalCostKes — the overrun in the only unit that moves a farmer", () => {
  it("costs nothing at or under target", () => {
    expect(calvingIntervalCostKes(380)).toEqual({ excessDays: 0, costKes: 0 });
    expect(calvingIntervalCostKes(340)).toEqual({ excessDays: 0, costKes: 0 });
  });

  it("prices each excess day at 4 litres times KES 52", () => {
    // The Kenyan observed average, 430 days: 50 days over target.
    expect(calvingIntervalCostKes(430)).toEqual({ excessDays: 50, costKes: 50 * 4 * 52 });
    expect(calvingIntervalCostKes(430).costKes).toBe(10_400);
  });

  it("takes the farm's own litres and price when they are known", () => {
    expect(calvingIntervalCostKes(430, { litresPerDayLost: 5, pricePerLitre: 60 })).toEqual({
      excessDays: 50,
      costKes: 15_000,
    });
  });

  it("takes a different target when a farm sets one", () => {
    expect(calvingIntervalCostKes(400, { targetDays: 365 }).excessDays).toBe(35);
  });

  it("returns whole shillings — nobody quotes cents for a calving interval", () => {
    const { costKes } = calvingIntervalCostKes(401, { litresPerDayLost: 3.7, pricePerLitre: 51.5 });
    expect(Number.isInteger(costKes)).toBe(true);
  });
});

describe("inseminationWindow — the AM/PM rule, applied rather than explained", () => {
  it("sends a morning heat to the same evening", () => {
    const w = inseminationWindow(new Date("2026-08-03T07:30:00Z"));
    expect(w.serveOn).toBe("2026-08-03");
    expect(w.advice).toMatch(/this evening/);
  });

  it("sends an afternoon or evening heat to the next morning", () => {
    const w = inseminationWindow(new Date("2026-08-03T18:00:00Z"));
    expect(w.serveOn).toBe("2026-08-04");
    expect(w.advice).toMatch(/tomorrow morning/);
  });

  it("treats noon as the evening half of the day", () => {
    expect(inseminationWindow(new Date("2026-08-03T11:59:00Z")).serveOn).toBe("2026-08-03");
    expect(inseminationWindow(new Date("2026-08-03T12:00:00Z")).serveOn).toBe("2026-08-04");
  });

  it("rolls an evening heat over a month end", () => {
    expect(inseminationWindow(new Date("2026-08-31T19:00:00Z")).serveOn).toBe("2026-09-01");
  });

  it("never says the words AM or PM to the user", () => {
    for (const h of [0, 6, 11, 12, 17, 23]) {
      const w = inseminationWindow(new Date(`2026-08-03T${String(h).padStart(2, "0")}:00:00Z`));
      expect(w.advice).not.toMatch(/\bAM\b|\bPM\b/);
    }
  });
});
