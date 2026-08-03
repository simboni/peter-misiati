import { describe, it, expect } from "vitest";
import {
  deriveClass,
  deriveReproStatus,
  isMilking,
  isServable,
  daysInMilk,
  dryOffDue,
  BULLING_WEIGHT_KG,
  BULLING_AGE_MONTHS,
  CLASS_LABEL,
  CLASS_LABEL_SW,
  type AnimalFacts,
} from "./animal";
import { ANIMAL_CLASSES } from "@/db/schema";

/**
 * Class derivation is the single most important rule in the system: it decides
 * which cow appears on the milking sheet, which heifer appears on the breeding
 * board, and what an animal is worth on the day it is sold. It is derived from
 * events on every read, so this file walks the whole ladder.
 */

const ASOF = "2026-08-03";

/** A blank set of facts. Each test states only what it is actually about. */
function facts(over: Partial<AnimalFacts> = {}): AnimalFacts {
  return {
    sex: "F",
    dateOfBirth: null,
    castrated: false,
    classOverride: null,
    parity: 0,
    lastCalvingOn: null,
    lastServiceOn: null,
    pdPositiveOn: null,
    pdNegativeOn: null,
    driedOffOn: null,
    expectedCalvingOn: null,
    latestWeightKg: null,
    culled: false,
    ...over,
  };
}

/** Date of birth that makes the animal exactly `months` old on ASOF. */
function dobForMonths(months: number): string {
  const days = Math.round(months * 30.4375);
  const d = new Date(Date.UTC(2026, 7, 3) - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

describe("deriveClass — the female ladder", () => {
  it("calls a newborn a CALF", () => {
    expect(deriveClass(facts({ dateOfBirth: dobForMonths(0.5) }), ASOF)).toBe("CALF");
  });

  it("calls her a WEANER from three months", () => {
    expect(deriveClass(facts({ dateOfBirth: dobForMonths(2.9) }), ASOF)).toBe("CALF");
    expect(deriveClass(facts({ dateOfBirth: dobForMonths(3.1) }), ASOF)).toBe("WEANER");
    expect(deriveClass(facts({ dateOfBirth: dobForMonths(8) }), ASOF)).toBe("WEANER");
  });

  it("calls her a HEIFER from nine months, before she is big enough to serve", () => {
    expect(deriveClass(facts({ dateOfBirth: dobForMonths(9.5) }), ASOF)).toBe("HEIFER");
    expect(deriveClass(facts({ dateOfBirth: dobForMonths(13) }), ASOF)).toBe("HEIFER");
  });

  it("promotes her to BULLING_HEIFER on WEIGHT before age — weight is the better signal", () => {
    // Ten months old: far short of the age threshold, but at target weight.
    const early = facts({ dateOfBirth: dobForMonths(10), latestWeightKg: BULLING_WEIGHT_KG });
    expect(deriveClass(early, ASOF)).toBe("BULLING_HEIFER");

    const justUnder = facts({ dateOfBirth: dobForMonths(10), latestWeightKg: BULLING_WEIGHT_KG - 1 });
    expect(deriveClass(justUnder, ASOF)).toBe("HEIFER");
  });

  it("promotes her to BULLING_HEIFER on AGE when no weight was ever recorded", () => {
    expect(deriveClass(facts({ dateOfBirth: dobForMonths(BULLING_AGE_MONTHS + 0.5) }), ASOF)).toBe(
      "BULLING_HEIFER",
    );
    expect(deriveClass(facts({ dateOfBirth: dobForMonths(BULLING_AGE_MONTHS - 0.5) }), ASOF)).toBe(
      "HEIFER",
    );
  });

  it("calls her a SERVED_HEIFER once she has been served", () => {
    const f = facts({ dateOfBirth: dobForMonths(15), lastServiceOn: "2026-07-20" });
    expect(deriveReproStatus(f, ASOF)).toBe("SERVED");
    expect(deriveClass(f, ASOF)).toBe("SERVED_HEIFER");
  });

  it("drops her back to BULLING_HEIFER on a negative pregnancy check", () => {
    const f = facts({
      dateOfBirth: dobForMonths(15),
      lastServiceOn: "2026-05-20",
      pdNegativeOn: "2026-07-20",
    });
    expect(deriveReproStatus(f, ASOF)).toBe("OPEN");
    expect(deriveClass(f, ASOF)).toBe("BULLING_HEIFER");
  });

  it("calls her an INCALF_HEIFER on a positive check, long before calving", () => {
    const f = facts({
      dateOfBirth: dobForMonths(17),
      lastServiceOn: "2026-05-20",
      pdPositiveOn: "2026-07-20",
      expectedCalvingOn: "2027-02-27",
    });
    expect(deriveReproStatus(f, ASOF)).toBe("PREGNANT");
    expect(deriveClass(f, ASOF)).toBe("INCALF_HEIFER");
  });

  it("calls her a SPRINGER inside the close-up window", () => {
    // 21 days is the boundary — inclusive, and it matches breedingCalendar's
    // springerFrom. Anything wider swallows the dry period whole.
    const springing = facts({
      dateOfBirth: dobForMonths(22),
      lastServiceOn: "2025-12-01",
      pdPositiveOn: "2026-02-01",
      expectedCalvingOn: "2026-08-24", // 21 days after ASOF
    });
    expect(deriveClass(springing, ASOF)).toBe("SPRINGER");

    const notYet = { ...springing, expectedCalvingOn: "2026-08-25" };
    expect(deriveClass(notYet, ASOF)).toBe("INCALF_HEIFER");
  });

  it("calls her a FIRST_CALVER after her first calving", () => {
    const f = facts({ dateOfBirth: dobForMonths(26), parity: 1, lastCalvingOn: "2026-06-20" });
    expect(deriveClass(f, ASOF)).toBe("FIRST_CALVER");
    expect(isMilking(deriveClass(f, ASOF))).toBe(true);
  });

  it("calls her a LACTATING_COW at parity two and a MATURE_COW from parity three", () => {
    const p2 = facts({ parity: 2, lastCalvingOn: "2026-03-01" });
    expect(deriveClass(p2, ASOF)).toBe("LACTATING_COW");

    const p3 = facts({ parity: 3, lastCalvingOn: "2026-03-01" });
    expect(deriveClass(p3, ASOF)).toBe("MATURE_COW");

    const p6 = facts({ parity: 6, lastCalvingOn: "2026-03-01" });
    expect(deriveClass(p6, ASOF)).toBe("MATURE_COW");
  });

  it("calls her a DRY_COW once dried off", () => {
    const dry = facts({
      parity: 3,
      lastCalvingOn: "2025-08-01",
      lastServiceOn: "2025-11-01",
      pdPositiveOn: "2026-01-05",
      driedOffOn: "2026-06-20",
      expectedCalvingOn: "2026-10-15", // 73 days out
    });
    expect(deriveReproStatus(dry, ASOF)).toBe("DRY");
    expect(deriveClass(dry, ASOF)).toBe("DRY_COW");
  });

  it("calls a dried-off cow SPRINGER once she is inside the close-up window", () => {
    /**
     * A springing cow is normally DRY, not PREGNANT — she was dried off sixty
     * days before calving, which is exactly when she starts springing. An
     * earlier version computed `daysToCalving` only for PREGNANT, which made
     * the DRY branch's SPRINGER arm unreachable for cows.
     */
    const springing = facts({
      parity: 3,
      lastCalvingOn: "2025-08-01",
      lastServiceOn: "2025-11-01",
      pdPositiveOn: "2026-01-05",
      driedOffOn: "2026-06-20",
      expectedCalvingOn: "2026-08-17", // 14 days out — inside the close-up window
    });
    expect(deriveReproStatus(springing, ASOF)).toBe("DRY");
    expect(deriveClass(springing, ASOF)).toBe("SPRINGER");
  });

  it("keeps a dry cow still months from calving as a DRY_COW", () => {
    const dry = facts({
      parity: 3,
      lastCalvingOn: "2025-08-01",
      pdPositiveOn: "2026-01-05",
      driedOffOn: "2026-06-20",
      expectedCalvingOn: "2026-10-15", // 73 days out — well outside close-up
    });
    expect(deriveClass(dry, ASOF)).toBe("DRY_COW");
  });

  it("calls her a CULL_COW once culled, whatever else is true", () => {
    const f = facts({ parity: 5, lastCalvingOn: "2026-03-01", culled: true });
    expect(deriveClass(f, ASOF)).toBe("CULL_COW");
  });
});

describe("deriveClass — the normal case: lactating AND pregnant at once", () => {
  /**
   * Parity and reproductive state are orthogonal. A working dairy cow spends
   * most of her life milking while carrying the next calf, and folding that
   * into one enum is the mistake this schema was designed to avoid.
   */
  const f = facts({
    parity: 3,
    lastCalvingOn: "2026-01-10",
    lastServiceOn: "2026-04-05",
    pdPositiveOn: "2026-06-08",
    expectedCalvingOn: "2027-01-13",
  });

  it("keeps her class as a milking cow", () => {
    expect(deriveClass(f, ASOF)).toBe("MATURE_COW");
    expect(isMilking(deriveClass(f, ASOF))).toBe(true);
  });

  it("reports her reproductive status as PREGNANT at the same time", () => {
    expect(deriveReproStatus(f, ASOF)).toBe("PREGNANT");
  });

  it("still counts her days in milk", () => {
    expect(daysInMilk(f, ASOF)).toBe(205);
  });
});

describe("deriveClass — males", () => {
  it("calls him a BULL_CALF under six months and a BULL after", () => {
    expect(deriveClass(facts({ sex: "M", dateOfBirth: dobForMonths(2) }), ASOF)).toBe("BULL_CALF");
    expect(deriveClass(facts({ sex: "M", dateOfBirth: dobForMonths(5.9) }), ASOF)).toBe("BULL_CALF");
    expect(deriveClass(facts({ sex: "M", dateOfBirth: dobForMonths(6.1) }), ASOF)).toBe("BULL");
  });

  it("calls a male with no recorded birth date a BULL, not a calf", () => {
    expect(deriveClass(facts({ sex: "M", dateOfBirth: null }), ASOF)).toBe("BULL");
  });

  it("calls him a STEER once castrated, at any age", () => {
    expect(deriveClass(facts({ sex: "M", dateOfBirth: dobForMonths(2), castrated: true }), ASOF)).toBe(
      "STEER",
    );
    expect(deriveClass(facts({ sex: "M", dateOfBirth: dobForMonths(30), castrated: true }), ASOF)).toBe(
      "STEER",
    );
  });

  it("reports males as OPEN — reproductive status is a cow question", () => {
    expect(deriveReproStatus(facts({ sex: "M", lastServiceOn: "2026-01-01" }), ASOF)).toBe("OPEN");
  });
});

describe("deriveClass — the override", () => {
  it("wins over everything, because a bought-in animal has no history to derive from", () => {
    const boughtIn = facts({
      classOverride: "MATURE_COW",
      dateOfBirth: dobForMonths(1),
      sex: "F",
      parity: 0,
    });
    expect(deriveClass(boughtIn, ASOF)).toBe("MATURE_COW");
  });

  it("wins even over culled and over sex", () => {
    expect(deriveClass(facts({ classOverride: "BULL", sex: "F", culled: true }), ASOF)).toBe("BULL");
  });
});

describe("deriveClass — a missing date of birth", () => {
  /**
   * Bought-in animals routinely arrive with no papers. Age-based rungs must
   * simply not fire, rather than treating null as zero and calling a cow a calf.
   */
  it("never calls an animal of unknown age a calf or a weaner", () => {
    expect(deriveClass(facts({ dateOfBirth: null }), ASOF)).toBe("HEIFER");
  });

  it("still promotes her on weight alone", () => {
    expect(deriveClass(facts({ dateOfBirth: null, latestWeightKg: 300 }), ASOF)).toBe(
      "BULLING_HEIFER",
    );
  });

  it("still follows the events once she is served", () => {
    expect(deriveClass(facts({ dateOfBirth: null, lastServiceOn: "2026-07-01" }), ASOF)).toBe(
      "SERVED_HEIFER",
    );
    expect(
      deriveClass(facts({ dateOfBirth: null, parity: 2, lastCalvingOn: "2026-02-01" }), ASOF),
    ).toBe("LACTATING_COW");
  });
});

describe("deriveReproStatus", () => {
  it("reads the most recent event, not any single flag", () => {
    // Served, diagnosed negative, then served again: SERVED wins.
    const f = facts({
      lastServiceOn: "2026-07-25",
      pdNegativeOn: "2026-07-01",
      parity: 2,
      lastCalvingOn: "2026-01-01",
    });
    expect(deriveReproStatus(f, ASOF)).toBe("SERVED");
  });

  it("ignores events from before the last calving", () => {
    // Last lactation's service and dry-off must not follow her into this one.
    const f = facts({
      parity: 2,
      lastCalvingOn: "2026-06-20",
      lastServiceOn: "2025-09-01",
      pdPositiveOn: "2025-11-01",
      driedOffOn: "2026-04-01",
    });
    expect(deriveReproStatus(f, ASOF)).toBe("FRESH");
  });

  it("calls her FRESH for sixty days after calving, then OPEN", () => {
    expect(deriveReproStatus(facts({ parity: 1, lastCalvingOn: "2026-06-10" }), ASOF)).toBe("FRESH");
    expect(deriveReproStatus(facts({ parity: 1, lastCalvingOn: "2026-05-01" }), ASOF)).toBe("OPEN");
  });

  it("puts DRY above everything else", () => {
    const f = facts({
      parity: 3,
      lastCalvingOn: "2025-09-01",
      lastServiceOn: "2025-12-01",
      pdPositiveOn: "2026-02-01",
      driedOffOn: "2026-07-01",
    });
    expect(deriveReproStatus(f, ASOF)).toBe("DRY");
  });
});

describe("isServable", () => {
  it("says yes to a bulling heifer and no to a calf", () => {
    expect(isServable(facts({ dateOfBirth: dobForMonths(16) }), ASOF)).toBe(true);
    expect(isServable(facts({ dateOfBirth: dobForMonths(2) }), ASOF)).toBe(false);
  });

  it("says no inside the voluntary waiting period and yes after it", () => {
    expect(isServable(facts({ parity: 2, lastCalvingOn: "2026-07-10" }), ASOF)).toBe(false);
    expect(isServable(facts({ parity: 2, lastCalvingOn: "2026-05-10" }), ASOF)).toBe(true);
  });

  it("says no to a pregnant, a served or a male animal", () => {
    expect(
      isServable(facts({ parity: 2, lastCalvingOn: "2026-01-01", pdPositiveOn: "2026-06-01" }), ASOF),
    ).toBe(false);
    expect(
      isServable(facts({ parity: 2, lastCalvingOn: "2026-01-01", lastServiceOn: "2026-07-01" }), ASOF),
    ).toBe(false);
    expect(isServable(facts({ sex: "M", dateOfBirth: dobForMonths(30) }), ASOF)).toBe(false);
  });
});

describe("daysInMilk and dryOffDue", () => {
  it("is null when she has never calved, and null once she is dry", () => {
    expect(daysInMilk(facts(), ASOF)).toBeNull();
    expect(
      daysInMilk(facts({ parity: 2, lastCalvingOn: "2025-09-01", driedOffOn: "2026-07-01" }), ASOF),
    ).toBeNull();
  });

  it("counts from the last calving", () => {
    expect(daysInMilk(facts({ parity: 1, lastCalvingOn: "2026-07-04" }), ASOF)).toBe(30);
  });

  it("calls the dry-off sixty days before calving", () => {
    const f = facts({
      parity: 2,
      lastCalvingOn: "2025-11-01",
      pdPositiveOn: "2026-04-01",
      lastServiceOn: "2026-02-01",
      expectedCalvingOn: "2026-10-01",
    });
    expect(dryOffDue(f, ASOF).due).toBe(true);
    expect(dryOffDue(f, ASOF).reason).toContain("60-day rest");
  });

  it("calls the dry-off on a tail-end yield collapse", () => {
    const f = facts({ parity: 2, lastCalvingOn: "2025-11-01" });
    expect(dryOffDue(f, ASOF, 4).due).toBe(true);
    expect(dryOffDue(f, ASOF, 9).due).toBe(false);
  });

  it("never asks to dry off a cow who is already dry", () => {
    const f = facts({
      parity: 2,
      lastCalvingOn: "2025-11-01",
      driedOffOn: "2026-07-01",
      expectedCalvingOn: "2026-09-01",
    });
    expect(dryOffDue(f, ASOF).due).toBe(false);
  });
});

describe("labels", () => {
  it("has a plain-language English and Swahili label for every class — never a code", () => {
    for (const cls of ANIMAL_CLASSES) {
      expect(CLASS_LABEL[cls]).toBeTruthy();
      expect(CLASS_LABEL_SW[cls]).toBeTruthy();
      expect(CLASS_LABEL[cls]).not.toMatch(/_/);
    }
  });
});
