import { describe, it, expect } from "vitest";
import {
  ABORTION_PROTOCOL,
  COLOSTRUM_DAYS,
  DRY_COW_MIN_DAYS_AFTER_INFUSION,
  DRY_COW_MIN_HOURS_AFTER_CALVING,
  KENYA_ROUTINES,
  checkRoutineEligibility,
  computeWithdrawal,
  dryCowTherapyClearOn,
  isColostrum,
  nextDueOn,
  withdrawalStatus,
  type RoutineRule,
} from "./health";

/**
 * The withdrawal engine's rules, without a database.
 *
 * These are the only rules in the system that block rather than warn, so the
 * edges matter more here than anywhere else — particularly the difference
 * between "no withdrawal period recorded" and "no withdrawal period needed".
 */

const rule = (routine: string): RoutineRule => {
  const r = KENYA_ROUTINES.find((x) => x.routine === routine);
  if (!r) throw new Error(`no rule ${routine}`);
  return r;
};

/* ---------------------------------------------------------------- */
/* computeWithdrawal                                                 */
/* ---------------------------------------------------------------- */

describe("computeWithdrawal", () => {
  it("adds the label period to the last day of treatment", () => {
    // Oxytetracycline LA: 7 days milk, 28 days meat.
    const r = computeWithdrawal({
      treatmentEndOn: "2026-08-03",
      milkWithdrawalDays: 7,
      meatWithdrawalDays: 28,
    });
    expect(r.milkClearOn).toBe("2026-08-10");
    expect(r.meatClearOn).toBe("2026-08-31");
  });

  it("counts from the LAST dose of a course, not the first", () => {
    // A five-day course started 1 August ends on the 5th.
    const r = computeWithdrawal({
      treatmentEndOn: "2026-08-05",
      milkWithdrawalDays: 3,
      meatWithdrawalDays: 14,
    });
    expect(r.milkClearOn).toBe("2026-08-08");
  });

  it("returns UNKNOWN, never zero, when the milk period is missing", () => {
    // The whole point: a null label period must not collapse into "clear today".
    const r = computeWithdrawal({
      treatmentEndOn: "2026-08-03",
      milkWithdrawalDays: null,
      meatWithdrawalDays: 28,
    });
    expect(r.milkClearOn).toBeNull();
    expect(r.milkClearOn).not.toBe("2026-08-03");
    expect(r.meatClearOn).toBe("2026-08-31");
  });

  it("returns UNKNOWN when the period is undefined rather than null", () => {
    const r = computeWithdrawal({
      treatmentEndOn: "2026-08-03",
      milkWithdrawalDays: undefined,
      meatWithdrawalDays: undefined,
    });
    expect(r.milkClearOn).toBeNull();
    expect(r.meatClearOn).toBeNull();
  });

  it("honours a genuine zero-day period — amitraz on the label", () => {
    // Zero is a real answer when the label says so. It just may never be a
    // stand-in for "we did not record it".
    const r = computeWithdrawal({
      treatmentEndOn: "2026-08-03",
      milkWithdrawalDays: 0,
      meatWithdrawalDays: 7,
    });
    expect(r.milkClearOn).toBe("2026-08-03");
    expect(r.meatClearOn).toBe("2026-08-10");
  });

  it("crosses a month and a year end correctly", () => {
    expect(
      computeWithdrawal({ treatmentEndOn: "2026-12-28", milkWithdrawalDays: 7, meatWithdrawalDays: 35 }),
    ).toEqual({ milkClearOn: "2027-01-04", meatClearOn: "2027-02-01" });
  });

  it("crosses a leap day correctly", () => {
    expect(
      computeWithdrawal({ treatmentEndOn: "2028-02-26", milkWithdrawalDays: 4, meatWithdrawalDays: null })
        .milkClearOn,
    ).toBe("2028-03-01");
  });
});

/* ---------------------------------------------------------------- */
/* Dry cow therapy — the case that catches people out                */
/* ---------------------------------------------------------------- */

describe("dryCowTherapyClearOn", () => {
  it("uses 30 days after infusion when she has not calved yet", () => {
    expect(DRY_COW_MIN_DAYS_AFTER_INFUSION).toBe(30);
    expect(dryCowTherapyClearOn("2026-01-01", null)).toBe("2026-01-31");
  });

  it("uses the CALVING date when she calves late — 96 hours after calving", () => {
    expect(DRY_COW_MIN_HOURS_AFTER_CALVING).toBe(96);
    // Infusion + 30 = 31 Jan, but she calved on 10 Feb, so 14 Feb wins.
    expect(dryCowTherapyClearOn("2026-01-01", "2026-02-10")).toBe("2026-02-14");
  });

  it("uses the INFUSION date when she calves early", () => {
    // Calved four days after infusion: 96 h clears on 9 Jan, but the 30-day leg
    // runs to 31 Jan, and the later of the two wins.
    expect(dryCowTherapyClearOn("2026-01-01", "2026-01-05")).toBe("2026-01-31");
  });

  it("takes the later date when the two legs land on the same day", () => {
    // Calving 27 days after infusion puts both legs on 31 January.
    expect(dryCowTherapyClearOn("2026-01-01", "2026-01-27")).toBe("2026-01-31");
  });

  it("is never earlier than either leg on its own, across a spread of calvings", () => {
    const infusedOn = "2026-03-15";
    for (const calvedOn of ["2026-03-16", "2026-04-01", "2026-04-12", "2026-04-20", "2026-05-30"]) {
      const clear = dryCowTherapyClearOn(infusedOn, calvedOn);
      expect(clear >= "2026-04-14").toBe(true); // 30 days after infusion
      expect(clear >= calvedOn).toBe(true); // and never before she calved
    }
  });
});

/* ---------------------------------------------------------------- */
/* withdrawalStatus                                                  */
/* ---------------------------------------------------------------- */

describe("withdrawalStatus", () => {
  it("is clear when there is nothing on file", () => {
    const st = withdrawalStatus([], "2026-08-03", "Njeri");
    expect(st.milkBlocked).toBe(false);
    expect(st.meatBlocked).toBe(false);
    expect(st.message).toBeNull();
  });

  it("blocks milk and says so in plain language", () => {
    const st = withdrawalStatus(
      [{ milkClearOn: "2026-08-10", meatClearOn: null }],
      "2026-08-03",
      "Njeri",
    );
    expect(st.milkBlocked).toBe(true);
    expect(st.milkClearOn).toBe("2026-08-10");
    expect(st.message).toBe("Do not sell Njeri's milk until 2026-08-10.");
  });

  it("takes the LATEST clear date when treatments overlap", () => {
    // Three treatments in a fortnight — a mastitis case plus a routine spray.
    // Whichever runs longest is the one that governs.
    const st = withdrawalStatus(
      [
        { milkClearOn: "2026-08-06", meatClearOn: "2026-08-20" },
        { milkClearOn: "2026-08-12", meatClearOn: "2026-09-04" },
        { milkClearOn: "2026-08-09", meatClearOn: "2026-08-25" },
      ],
      "2026-08-03",
      "Njeri",
    );
    expect(st.milkClearOn).toBe("2026-08-12");
    expect(st.meatClearOn).toBe("2026-09-04");
    expect(st.message).toContain("milk until 2026-08-12");
    expect(st.message).toContain("slaughter until 2026-09-04");
  });

  it("is not fooled by an old treatment listed after a current one", () => {
    const st = withdrawalStatus(
      [
        { milkClearOn: "2026-08-12", meatClearOn: null },
        { milkClearOn: "2026-07-01", meatClearOn: null },
      ],
      "2026-08-03",
      "Njeri",
    );
    expect(st.milkClearOn).toBe("2026-08-12");
  });

  it("clears ON the clear date, not the day after", () => {
    const st = withdrawalStatus(
      [{ milkClearOn: "2026-08-10", meatClearOn: null }],
      "2026-08-10",
      "Njeri",
    );
    expect(st.milkBlocked).toBe(false);
    expect(st.message).toBeNull();
  });

  it("can block meat while the milk is already clear", () => {
    // The normal shape of an oxytetracycline course: 7 days milk, 28 meat.
    const st = withdrawalStatus(
      [{ milkClearOn: "2026-08-10", meatClearOn: "2026-08-31" }],
      "2026-08-15",
      "Njeri",
    );
    expect(st.milkBlocked).toBe(false);
    expect(st.meatBlocked).toBe(true);
    expect(st.message).toBe("Do not sell Njeri for slaughter until 2026-08-31.");
  });

  it("ignores null clear dates mixed in with real ones", () => {
    const st = withdrawalStatus(
      [
        { milkClearOn: null, meatClearOn: null },
        { milkClearOn: "2026-08-09", meatClearOn: null },
        { milkClearOn: null, meatClearOn: "2026-09-01" },
      ],
      "2026-08-03",
      "Njeri",
    );
    expect(st.milkClearOn).toBe("2026-08-09");
    expect(st.meatClearOn).toBe("2026-09-01");
  });

  it("falls back to a neutral name when none is given", () => {
    const st = withdrawalStatus([{ milkClearOn: "2026-08-10", meatClearOn: null }], "2026-08-03");
    expect(st.message).toBe("Do not sell This cow's milk until 2026-08-10.");
  });
});

/* ---------------------------------------------------------------- */
/* Colostrum                                                         */
/* ---------------------------------------------------------------- */

describe("isColostrum", () => {
  it("covers the first four days after calving", () => {
    expect(COLOSTRUM_DAYS).toBe(4);
    expect(isColostrum(0)).toBe(true);
    expect(isColostrum(1)).toBe(true);
    expect(isColostrum(4)).toBe(true);
  });

  it("stops on the fifth day", () => {
    expect(isColostrum(5)).toBe(false);
    expect(isColostrum(60)).toBe(false);
  });

  it("is false for a cow who is not in a lactation at all", () => {
    expect(isColostrum(null)).toBe(false);
  });

  it("is false for a nonsensical negative days-in-milk", () => {
    expect(isColostrum(-1)).toBe(false);
  });
});

/* ---------------------------------------------------------------- */
/* Routine eligibility — the two hard rules                          */
/* ---------------------------------------------------------------- */

describe("checkRoutineEligibility — S19 brucellosis", () => {
  const s19 = rule("S19");

  it("allows a heifer inside the 4–8 month window", () => {
    const r = checkRoutineEligibility(s19, { sex: "F", ageDays: 180, alreadyGivenCount: 0 });
    expect(r.eligible).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it("refuses a male — S19 is for females only", () => {
    const r = checkRoutineEligibility(s19, { sex: "M", ageDays: 180, alreadyGivenCount: 0 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("Brucellosis S19 is for females only.");
  });

  it("refuses a calf who is too young", () => {
    const r = checkRoutineEligibility(s19, { sex: "F", ageDays: 100, alreadyGivenCount: 0 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain("Too young");
    expect(r.reason).toContain("4 months");
  });

  it("refuses an animal who is past the window — it interferes with testing", () => {
    const r = checkRoutineEligibility(s19, { sex: "F", ageDays: 300, alreadyGivenCount: 0 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain("Too old");
    expect(r.reason).toContain("8 months");
  });

  it("refuses a second dose — once for life, and there is no undoing it", () => {
    const r = checkRoutineEligibility(s19, { sex: "F", ageDays: 180, alreadyGivenCount: 1 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain("once in a lifetime");
  });

  it("checks sex before anything else, so the message is the useful one", () => {
    const r = checkRoutineEligibility(s19, { sex: "M", ageDays: 3000, alreadyGivenCount: 2 });
    expect(r.reason).toContain("females only");
  });

  it("accepts the window boundaries themselves", () => {
    expect(checkRoutineEligibility(s19, { sex: "F", ageDays: 120, alreadyGivenCount: 0 }).eligible).toBe(true);
    expect(checkRoutineEligibility(s19, { sex: "F", ageDays: 240, alreadyGivenCount: 0 }).eligible).toBe(true);
    expect(checkRoutineEligibility(s19, { sex: "F", ageDays: 241, alreadyGivenCount: 0 }).eligible).toBe(false);
  });
});

describe("checkRoutineEligibility — ECF-ITM", () => {
  const ecf = rule("ECF_ITM");

  it("allows a calf of three months or more", () => {
    expect(checkRoutineEligibility(ecf, { sex: "F", ageDays: 95, alreadyGivenCount: 0 }).eligible).toBe(true);
    expect(checkRoutineEligibility(ecf, { sex: "M", ageDays: 400, alreadyGivenCount: 0 }).eligible).toBe(true);
  });

  it("refuses a second dose — once for life, and she is now a carrier", () => {
    const r = checkRoutineEligibility(ecf, { sex: "F", ageDays: 400, alreadyGivenCount: 1 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain("once in a lifetime");
  });

  it("refuses a calf under three months", () => {
    expect(checkRoutineEligibility(ecf, { sex: "F", ageDays: 40, alreadyGivenCount: 0 }).eligible).toBe(false);
  });

  it("has no upper age limit", () => {
    expect(checkRoutineEligibility(ecf, { sex: "F", ageDays: 3000, alreadyGivenCount: 0 }).eligible).toBe(true);
  });
});

describe("checkRoutineEligibility — unknown age", () => {
  it("warns but allows on a bought-in animal with no birth date", () => {
    // Blocking here would just mean a bought-in cow never gets vaccinated.
    const r = checkRoutineEligibility(rule("FMD"), { sex: "F", ageDays: null, alreadyGivenCount: 0 });
    expect(r.eligible).toBe(true);
    expect(r.reason).toContain("age is not recorded");
  });

  it("still refuses on the rules that do not depend on age", () => {
    expect(
      checkRoutineEligibility(rule("S19"), { sex: "M", ageDays: null, alreadyGivenCount: 0 }).eligible,
    ).toBe(false);
    expect(
      checkRoutineEligibility(rule("ECF_ITM"), { sex: "F", ageDays: null, alreadyGivenCount: 1 }).eligible,
    ).toBe(false);
  });
});

describe("checkRoutineEligibility — the rest of the calendar", () => {
  it("allows repeat FMD, LSD and deworming", () => {
    for (const routine of ["FMD", "LSD", "ANTHRAX_BQ", "DEWORM", "DIP"]) {
      const r = checkRoutineEligibility(rule(routine), { sex: "F", ageDays: 400, alreadyGivenCount: 5 });
      expect(r.eligible).toBe(true);
    }
  });

  it("closes the disbudding window at eight weeks", () => {
    expect(checkRoutineEligibility(rule("DISBUD"), { sex: "F", ageDays: 30, alreadyGivenCount: 0 }).eligible).toBe(true);
    expect(checkRoutineEligibility(rule("DISBUD"), { sex: "F", ageDays: 90, alreadyGivenCount: 0 }).eligible).toBe(false);
  });
});

/* ---------------------------------------------------------------- */
/* nextDueOn                                                         */
/* ---------------------------------------------------------------- */

describe("nextDueOn", () => {
  it("puts tick control a week out — weekly in an ECF area", () => {
    expect(nextDueOn(rule("DIP"), "2026-08-03")).toBe("2026-08-10");
  });

  it("puts deworming three months out", () => {
    expect(nextDueOn(rule("DEWORM"), "2026-08-03")).toBe("2026-11-01");
  });

  it("puts FMD six months out", () => {
    expect(nextDueOn(rule("FMD"), "2026-08-03")).toBe("2027-01-30");
  });

  it("never schedules a repeat of a once-for-life vaccine", () => {
    expect(nextDueOn(rule("S19"), "2026-08-03")).toBeNull();
    expect(nextDueOn(rule("ECF_ITM"), "2026-08-03")).toBeNull();
  });

  it("has nothing to schedule when it has never been given", () => {
    expect(nextDueOn(rule("DIP"), null)).toBeNull();
  });
});

/* ---------------------------------------------------------------- */
/* Abortion protocol                                                 */
/* ---------------------------------------------------------------- */

describe("ABORTION_PROTOCOL", () => {
  it("opens a human-health workflow, because brucellosis is zoonotic", () => {
    const text = ABORTION_PROTOCOL.join(" ");
    expect(text).toContain("Isolate");
    expect(text).toContain("brucellosis");
    expect(text).toContain("passes to people");
  });
});
