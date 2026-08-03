import { describe, it, expect } from "vitest";
import {
  ageReceivables,
  buildDeliveryRound,
  checkCreditLimit,
  checkSaleLegality,
  customerBalance,
  dueDateFor,
  isOrderActiveOn,
  latePaymentInterestKes,
  reconcileStatement,
  resolvePrice,
  type LedgerRow,
  type PriceRow,
  type StandingOrderRow,
} from "./sales";

/**
 * M4's rules, tested without a database.
 *
 * The through-line: a delivery on credit is a RECEIVABLE, not revenue, and
 * every control here exists to make that visible before the money is gone
 * rather than after.
 */

/* ---------------------------------------------------------------- */

describe("resolvePrice", () => {
  const rows: PriceRow[] = [
    { scope: "CHANNEL", customerType: "COOP", rateKesPerLitre: 52, effectiveFrom: "2026-01-01" },
    { scope: "CHANNEL", customerType: "HOUSEHOLD", rateKesPerLitre: 65, effectiveFrom: "2026-01-01" },
    { scope: "CHANNEL", customerType: "INSTITUTION", rateKesPerLitre: 60, effectiveFrom: "2026-01-01" },
  ];

  it("falls back to the channel default", () => {
    expect(resolvePrice(rows, { customerId: "c1", customerType: "COOP", onDate: "2026-08-03" })).toBe(52);
    expect(resolvePrice(rows, { customerId: "c1", customerType: "HOUSEHOLD", onDate: "2026-08-03" })).toBe(65);
  });

  it("lets a customer override beat the channel", () => {
    const withOverride: PriceRow[] = [
      ...rows,
      { scope: "CUSTOMER", customerId: "school", rateKesPerLitre: 58, effectiveFrom: "2026-06-01" },
    ];
    expect(
      resolvePrice(withOverride, { customerId: "school", customerType: "INSTITUTION", onDate: "2026-08-03" }),
    ).toBe(58);
    // …but only for that customer.
    expect(
      resolvePrice(withOverride, { customerId: "hotel", customerType: "INSTITUTION", onDate: "2026-08-03" }),
    ).toBe(60);
  });

  it("respects effective dating — prices swing ~40% in a season", () => {
    const dated: PriceRow[] = [
      { scope: "CHANNEL", customerType: "COOP", rateKesPerLitre: 80, effectiveFrom: "2026-01-01", effectiveTo: "2026-04-30" },
      { scope: "CHANNEL", customerType: "COOP", rateKesPerLitre: 52, effectiveFrom: "2026-05-01" },
    ];
    expect(resolvePrice(dated, { customerId: "c", customerType: "COOP", onDate: "2026-03-15" })).toBe(80);
    expect(resolvePrice(dated, { customerId: "c", customerType: "COOP", onDate: "2026-08-03" })).toBe(52);
  });

  it("prices the sale on its own date, not today", () => {
    const dated: PriceRow[] = [
      { scope: "CHANNEL", customerType: "COOP", rateKesPerLitre: 80, effectiveFrom: "2026-01-01", effectiveTo: "2026-04-30" },
    ];
    expect(resolvePrice(dated, { customerId: "c", customerType: "COOP", onDate: "2026-05-01" })).toBeNull();
  });

  it("takes the newest of two overlapping rows", () => {
    const overlapping: PriceRow[] = [
      { scope: "CHANNEL", customerType: "HOUSEHOLD", rateKesPerLitre: 60, effectiveFrom: "2026-01-01" },
      { scope: "CHANNEL", customerType: "HOUSEHOLD", rateKesPerLitre: 70, effectiveFrom: "2026-07-01" },
    ];
    expect(resolvePrice(overlapping, { customerId: "c", customerType: "HOUSEHOLD", onDate: "2026-08-03" })).toBe(70);
  });

  it("honours a volume break", () => {
    const breaks: PriceRow[] = [
      { scope: "CHANNEL", customerType: "INSTITUTION", rateKesPerLitre: 60, effectiveFrom: "2026-01-01" },
      { scope: "CHANNEL", customerType: "INSTITUTION", rateKesPerLitre: 55, minLitres: 100, effectiveFrom: "2026-02-01" },
    ];
    expect(resolvePrice(breaks, { customerId: "c", customerType: "INSTITUTION", onDate: "2026-08-03", litres: 30 })).toBe(60);
    expect(resolvePrice(breaks, { customerId: "c", customerType: "INSTITUTION", onDate: "2026-08-03", litres: 150 })).toBe(55);
  });

  it("returns null rather than guessing when nothing matches", () => {
    expect(resolvePrice([], { customerId: "c", customerType: "SHOP", onDate: "2026-08-03" })).toBeNull();
    expect(resolvePrice(rows, { customerId: "c", customerType: "MILK_ATM", onDate: "2026-08-03" })).toBeNull();
  });
});

/* ---------------------------------------------------------------- */

describe("isOrderActiveOn", () => {
  const base: StandingOrderRow = {
    id: "o1",
    customerId: "c1",
    litres: 2,
    session: "MORNING",
    daysOfWeek: [1, 2, 3, 4, 5],
    activeFrom: "2026-01-01",
  };

  it("only fires on the weekdays it was set for", () => {
    expect(isOrderActiveOn(base, "2026-08-03")).toBe(true); // Monday
    expect(isOrderActiveOn(base, "2026-08-07")).toBe(true); // Friday
    expect(isOrderActiveOn(base, "2026-08-08")).toBe(false); // Saturday
    expect(isOrderActiveOn(base, "2026-08-09")).toBe(false); // Sunday
  });

  it("handles a Sunday-only order — ISO weekday 7, not 0", () => {
    expect(isOrderActiveOn({ ...base, daysOfWeek: [7] }, "2026-08-09")).toBe(true);
    expect(isOrderActiveOn({ ...base, daysOfWeek: [7] }, "2026-08-03")).toBe(false);
  });

  it("respects the active range", () => {
    expect(isOrderActiveOn({ ...base, activeFrom: "2026-09-01" }, "2026-08-03")).toBe(false);
    expect(isOrderActiveOn({ ...base, activeTo: "2026-07-31" }, "2026-08-03")).toBe(false);
    expect(isOrderActiveOn({ ...base, activeTo: "2026-08-03" }, "2026-08-03")).toBe(true);
  });

  it("goes quiet inside a pause window — schools over the holidays", () => {
    const school = { ...base, pausedFrom: "2026-08-01", pausedTo: "2026-08-31" };
    expect(isOrderActiveOn(school, "2026-07-31")).toBe(true);
    expect(isOrderActiveOn(school, "2026-08-03")).toBe(false);
    expect(isOrderActiveOn(school, "2026-08-31")).toBe(false);
    expect(isOrderActiveOn(school, "2026-09-01")).toBe(true); // a Tuesday
  });

  it("treats an open-ended pause as indefinite", () => {
    const travelling = { ...base, pausedFrom: "2026-08-01", pausedTo: null };
    expect(isOrderActiveOn(travelling, "2026-07-31")).toBe(true);
    expect(isOrderActiveOn(travelling, "2026-12-01")).toBe(false);
  });
});

describe("buildDeliveryRound", () => {
  const orders: StandingOrderRow[] = [
    { id: "o1", customerId: "mama-njeri", litres: "2.00", session: "MORNING", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], activeFrom: "2026-01-01", rateKesPerLitre: "65.00" },
    { id: "o2", customerId: "st-marys", litres: "30.00", session: "MORNING", daysOfWeek: [1, 2, 3, 4, 5], activeFrom: "2026-01-01", pausedFrom: "2026-08-08", pausedTo: "2026-09-01" },
    { id: "o3", customerId: "bahati-hotel", litres: "10.00", session: "EVENING", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], activeFrom: "2026-01-01" },
  ];

  it("builds only this session's stops, prefilled", () => {
    const round = buildDeliveryRound(orders, "2026-08-03", "MORNING");
    expect(round).toHaveLength(2);
    expect(round[0]).toEqual({ orderId: "o1", customerId: "mama-njeri", litres: 2, rateKesPerLitre: 65 });
    expect(round[1].litres).toBe(30);
  });

  it("drops the school once the holiday pause starts", () => {
    const round = buildDeliveryRound(orders, "2026-08-10", "MORNING");
    expect(round.map((r) => r.customerId)).toEqual(["mama-njeri"]);
  });

  it("keeps the evening round separate", () => {
    expect(buildDeliveryRound(orders, "2026-08-03", "EVENING").map((r) => r.customerId)).toEqual([
      "bahati-hotel",
    ]);
  });

  it("leaves the rate null when the order has none, so the price list decides", () => {
    expect(buildDeliveryRound(orders, "2026-08-03", "MORNING")[1].rateKesPerLitre).toBeNull();
  });

  it("returns an empty round on a Sunday when nobody takes milk", () => {
    const weekdayOnly = orders.filter((o) => o.id === "o2");
    expect(buildDeliveryRound(weekdayOnly, "2026-08-09", "MORNING")).toEqual([]);
  });
});

/* ---------------------------------------------------------------- */

describe("customerBalance", () => {
  const rows: LedgerRow[] = [
    { entryDate: "2026-07-01", entryType: "OPENING_BALANCE", debitKes: 500, creditKes: 0 },
    { entryDate: "2026-07-05", entryType: "DELIVERY", debitKes: 1300, creditKes: 0 },
    { entryDate: "2026-07-15", entryType: "PAYMENT", debitKes: 0, creditKes: 1000 },
    { entryDate: "2026-07-20", entryType: "DELIVERY", debitKes: 1300, creditKes: 0 },
  ];

  it("runs the tab as debits less credits", () => {
    const b = customerBalance(rows, "2026-08-03");
    expect(b.balanceKes).toBe(2100);
    expect(b.totalDeliveredKes).toBe(2600);
    expect(b.totalPaidKes).toBe(1000);
  });

  it("reports when they last paid and how long ago", () => {
    const b = customerBalance(rows, "2026-08-03");
    expect(b.lastPaidOn).toBe("2026-07-15");
    expect(b.daysSincePayment).toBe(19);
  });

  it("ignores anything after the as-of date", () => {
    expect(customerBalance(rows, "2026-07-10").balanceKes).toBe(1800);
    expect(customerBalance(rows, "2026-07-10").lastPaidOn).toBeNull();
  });

  it("counts a write-off separately from a payment", () => {
    const withWriteOff: LedgerRow[] = [
      ...rows,
      { entryDate: "2026-07-31", entryType: "WRITE_OFF", debitKes: 0, creditKes: 600 },
    ];
    const b = customerBalance(withWriteOff, "2026-08-03");
    expect(b.balanceKes).toBe(1500);
    expect(b.writtenOffKes).toBe(600);
    expect(b.totalPaidKes).toBe(1000);
  });

  it("starts a new customer at zero", () => {
    const b = customerBalance([], "2026-08-03");
    expect(b.balanceKes).toBe(0);
    expect(b.daysSincePayment).toBeNull();
  });
});

describe("checkCreditLimit", () => {
  const balance = customerBalance(
    [{ entryDate: "2026-06-01", entryType: "DELIVERY", debitKes: 5000, creditKes: 0 }],
    "2026-08-03",
  );

  it("warns before the delivery, and never refuses it", () => {
    const c = checkCreditLimit(balance, 6000, 1200, "Wanjiru");
    expect(c.overLimit).toBe(true);
    expect(c.allowed).toBe(true); // a warning, not a refusal — the rider decides
    expect(c.balanceKes).toBe(6200);
    expect(c.message).toContain("Wanjiru");
    expect(c.message).toContain("6,200");
    expect(c.message).toContain("Deliver anyway, or skip?");
  });

  it("stays quiet when the delivery still fits", () => {
    const c = checkCreditLimit(balance, 10000, 1200, "Mama Njeri");
    expect(c.overLimit).toBe(false);
    expect(c.message).toBeNull();
  });

  it("names how long they have gone without paying", () => {
    const stale = customerBalance(
      [
        { entryDate: "2026-06-01", entryType: "DELIVERY", debitKes: 5000, creditKes: 0 },
        { entryDate: "2026-06-01", entryType: "PAYMENT", debitKes: 0, creditKes: 100 },
      ],
      "2026-08-03",
    );
    const c = checkCreditLimit(stale, 4000, 500, "Wanjiru");
    expect(c.message).toContain("has not paid for 63 days");
  });

  it("has no opinion when no limit was set", () => {
    expect(checkCreditLimit(balance, null, 99999, "Anyone").overLimit).toBe(false);
    expect(checkCreditLimit(balance, 0, 99999, "Anyone").message).toBeNull();
  });
});

/* ---------------------------------------------------------------- */

describe("dueDateFor", () => {
  const issued = "2026-08-03";

  it("covers every term the module supports", () => {
    expect(dueDateFor("CASH", issued)).toBe("2026-08-03");
    expect(dueDateFor("DAILY", issued)).toBe("2026-08-03");
    expect(dueDateFor("WEEKLY", issued)).toBe("2026-08-10");
    expect(dueDateFor("FORTNIGHTLY", issued)).toBe("2026-08-17");
    expect(dueDateFor("MONTHLY", issued)).toBe("2026-09-02");
    expect(dueDateFor("NET_30", issued)).toBe("2026-09-02");
    expect(dueDateFor("NET_60", issued)).toBe("2026-10-02");
    expect(dueDateFor("NET_90", issued)).toBe("2026-11-01");
  });

  it("lands a monthly customer on their own settlement day", () => {
    expect(dueDateFor("MONTHLY", issued, 5)).toBe("2026-09-05");
    expect(dueDateFor("MONTHLY", issued, 28)).toBe("2026-09-28");
  });

  it("ignores an impossible settlement day rather than producing a bad date", () => {
    expect(dueDateFor("MONTHLY", issued, 31)).toBe("2026-09-02");
    expect(dueDateFor("MONTHLY", issued, 0)).toBe("2026-09-02");
  });
});

describe("ageReceivables", () => {
  const asOf = "2026-08-03";

  it("drops each item into the bucket a finance office will recognise", () => {
    const r = ageReceivables(
      [
        { amountKes: 1000, dueOn: "2026-08-20" }, // not yet due
        { amountKes: 2000, dueOn: "2026-07-20" }, // 14 days
        { amountKes: 3000, dueOn: "2026-06-20" }, // 44 days
        { amountKes: 4000, dueOn: "2026-05-20" }, // 75 days
        { amountKes: 5000, dueOn: "2026-01-20" }, // 195 days
      ],
      asOf,
    );
    expect(r.CURRENT).toBe(1000);
    expect(r.D30).toBe(2000);
    expect(r.D60).toBe(3000);
    expect(r.D90_PLUS).toBe(9000);
    expect(r.totalKes).toBe(15000);
    expect(r.oldestDays).toBe(195);
  });

  it("puts something due today in CURRENT, not overdue", () => {
    expect(ageReceivables([{ amountKes: 100, dueOn: asOf }], asOf).CURRENT).toBe(100);
  });

  it("returns an empty report for a farm owed nothing", () => {
    const r = ageReceivables([], asOf);
    expect(r.totalKes).toBe(0);
    expect(r.oldestDays).toBe(0);
  });
});

describe("latePaymentInterestKes", () => {
  it("computes the interest almost nobody claims", () => {
    // LN 20/2021: simple monthly interest at the CBK base rate.
    const r = latePaymentInterestKes(100000, "2026-06-03", "2026-08-03", 9.5);
    expect(r.daysLate).toBe(61);
    expect(r.monthsLate).toBeCloseTo(2, 1);
    expect(r.interestKes).toBeCloseTo(1586.65, 0);
    expect(r.message).toContain("61 days late");
  });

  it("says nothing when the money is not late", () => {
    const r = latePaymentInterestKes(100000, "2026-09-03", "2026-08-03", 9.5);
    expect(r.daysLate).toBe(0);
    expect(r.interestKes).toBe(0);
    expect(r.message).toBeNull();
  });

  it("scales with the principal", () => {
    const small = latePaymentInterestKes(10000, "2026-06-03", "2026-08-03", 9.5);
    const big = latePaymentInterestKes(100000, "2026-06-03", "2026-08-03", 9.5);
    expect(big.interestKes).toBeCloseTo(small.interestKes * 10, 1);
  });
});

/* ---------------------------------------------------------------- */

describe("reconcileStatement", () => {
  it("says the statement matches when it does", () => {
    const r = reconcileStatement({
      litresOurs: 3600,
      litresTheirs: 3600,
      ratePerLitre: 52,
      deductions: [{ type: "AI", amountKes: 3500, matchedExpenseId: "e1" }],
    });
    expect(r.litresVariance).toBe(0);
    expect(r.unmatchedDeductionsKes).toBe(0);
    expect(r.message).toBe("The statement matches our records.");
  });

  it("finds an unmatched deduction — the finding the whole feature exists for", () => {
    const r = reconcileStatement({
      litresOurs: 3600,
      litresTheirs: 3600,
      ratePerLitre: 52,
      deductions: [
        { type: "AI", amountKes: 3500, matchedExpenseId: "e1" },
        { type: "TRANSPORT", description: "Transport levy", amountKes: 1800, matchedExpenseId: null },
      ],
    });
    expect(r.unmatchedDeductionsKes).toBe(1800);
    expect(r.deductionLines).toHaveLength(2);

    const unmatched = r.deductionLines.find((l) => !l.matched)!;
    expect(unmatched.label).toBe("Transport levy");
    expect(unmatched.ourValue).toBeNull();
    expect(unmatched.theirValue).toBe(1800);
    expect(unmatched.note).toBe("No matching record on the farm.");
    expect(r.message).toContain("Query this statement");
    expect(r.message).toContain("1,800");
  });

  it("prices a litres shortfall in shillings, not just litres", () => {
    const r = reconcileStatement({
      litresOurs: 3600,
      litresTheirs: 3540,
      ratePerLitre: 52,
      deductions: [],
    });
    expect(r.litresVariance).toBe(60);
    expect(r.litresVarianceKes).toBe(3120);
    expect(r.message).toContain("60.0 litres short on their record");
    expect(r.message).toContain("3,120");
  });

  it("reports the opposite direction just as plainly", () => {
    const r = reconcileStatement({ litresOurs: 3500, litresTheirs: 3600, ratePerLitre: 52, deductions: [] });
    expect(r.message).toContain("more than we recorded");
  });

  it("ignores a rounding-sized litres difference", () => {
    const r = reconcileStatement({ litresOurs: 3600.4, litresTheirs: 3600, ratePerLitre: 52, deductions: [] });
    expect(r.message).toBe("The statement matches our records.");
  });

  it("raises both findings at once", () => {
    const r = reconcileStatement({
      litresOurs: 3600,
      litresTheirs: 3540,
      ratePerLitre: 52,
      deductions: [{ type: "OTHER", amountKes: 900, matchedExpenseId: null }],
    });
    expect(r.message).toContain("litres short");
    expect(r.message).toContain("and");
    expect(r.message).toContain("nothing to match them");
  });
});

/* ---------------------------------------------------------------- */

describe("checkSaleLegality", () => {
  const rural = {
    farmAreaClass: "RURAL" as const,
    customerAreaClass: "RURAL" as const,
    customerType: "HOUSEHOLD" as const,
    pasteurised: false,
    fulfilment: "GATE_COLLECTION" as const,
    hasMilkTransportPermit: false,
  };

  it("allows raw milk to a neighbour collecting at the gate", () => {
    const r = checkSaleLegality(rural);
    expect(r.allowed).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("blocks raw milk sold direct into an urban area", () => {
    const r = checkSaleLegality({ ...rural, customerAreaClass: "URBAN" });
    expect(r.allowed).toBe(false);
    expect(r.blockers[0]).toContain("rural areas");
    expect(r.blockers[0]).toContain("pasteurised");
  });

  it("lets pasteurised milk into town", () => {
    const r = checkSaleLegality({ ...rural, customerAreaClass: "URBAN", pasteurised: true });
    expect(r.allowed).toBe(true);
  });

  it("warns about raw milk to a school or hospital", () => {
    const r = checkSaleLegality({ ...rural, customerType: "INSTITUTION" });
    expect(r.allowed).toBe(true);
    expect(r.warnings[0]).toContain("school or hospital");
    expect(r.warnings[0]).toContain("Kenya Dairy Board");
  });

  it("warns that our own vehicle needs a milk carriage permit", () => {
    const r = checkSaleLegality({ ...rural, fulfilment: "DELIVERED" });
    expect(r.warnings.some((w) => w.includes("milk carriage permit"))).toBe(true);
  });

  it("stops warning once the permit is held", () => {
    const r = checkSaleLegality({ ...rural, fulfilment: "DELIVERED", hasMilkTransportPermit: true });
    expect(r.warnings).toEqual([]);
  });

  it("stacks the urban blocker and the transport warning together", () => {
    const r = checkSaleLegality({
      ...rural,
      customerAreaClass: "URBAN",
      customerType: "INSTITUTION",
      fulfilment: "DELIVERED",
    });
    expect(r.allowed).toBe(false);
    expect(r.blockers).toHaveLength(1);
    expect(r.warnings).toHaveLength(2);
  });
});
