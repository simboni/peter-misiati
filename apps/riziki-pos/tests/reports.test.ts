/**
 * Reports, day close and export — unit tests.
 *
 * The timezone case is the reason this file exists. A sale rung up at 22:30 in
 * Nairobi is stored as 19:30 UTC; group by the raw UTC date and it still lands
 * on the right day, but a sale at 00:30 EAT is stored as 21:30 UTC the previous
 * day and would be counted on the wrong date. Either way the drawer stops
 * agreeing with the report, and the owner starts accusing staff of theft over an
 * arithmetic bug. So: prove it cannot happen.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Must be set before ANY import that touches the database module.
process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-reports-")), "test.db");

const { run, db } = await import("../src/lib/db.ts");
const {
  dayTotals,
  profitSummary,
  profitPerProduct,
  monthlySales,
  businessLineSplit,
  discountSummary,
  discountsByPerson,
  discountsByItem,
  discountedSales,
  deadStock,
  shrinkageByMonth,
  expenseTotalForMonth,
  csvField,
  csvRow,
  csvText,
  EXPORT_TABLES,
  closeForDate,
  recentCloses,
  expensesForMonth,
  expensesByCategory,
  varianceTone,
  lastMonths,
  monthRange,
  dayRange,
  periodRange,
  describeRange,
  monthEnd,
} = await import("../src/lib/reports.ts");

// ---------------------------------------------------------------- fixture

const OWNER = 1;

/** Insert a completed sale with one line and its tenders, at an explicit UTC time. */
function sale(opts: {
  uuid: string;
  atUtc: string;
  itemId: number | null;
  name: string;
  units: number;
  unitPriceCents: number;
  lineCostCents: number;
  cash?: number;
  mpesa?: number;
  credit?: number;
  /** What the shop was asking, when it differs from what was charged. */
  listPriceCents?: number;
  userId?: number;
}): number {
  const total = opts.units * opts.unitPriceCents;
  const paid = (opts.cash ?? 0) + (opts.mpesa ?? 0);
  const { lastInsertRowid: saleId } = run(
    `INSERT INTO sales (client_uuid, at, user_id, tier, total_cents, paid_cents, status)
     VALUES (?, ?, ?, 'retail', ?, ?, 'completed')`,
    opts.uuid,
    opts.atUtc,
    opts.userId ?? OWNER,
    total,
    paid,
  );
  run(
    `INSERT INTO sale_lines (sale_id, item_id, name_snapshot, units, qty_milli,
                             unit_price_cents, line_total_cents, list_price_cents, cost_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    saleId,
    opts.itemId,
    opts.name,
    opts.units,
    opts.units * 1000,
    opts.unitPriceCents,
    total,
    opts.listPriceCents ?? opts.unitPriceCents,
    opts.lineCostCents,
  );
  for (const [method, amount] of [
    ["cash", opts.cash ?? 0],
    ["mpesa", opts.mpesa ?? 0],
    ["credit", opts.credit ?? 0],
  ] as const) {
    if (amount > 0) {
      run(
        `INSERT INTO payments (sale_id, at, method, amount_cents, user_id)
         VALUES (?, ?, ?, ?, ?)`,
        saleId,
        opts.atUtc,
        method,
        amount,
        OWNER,
      );
    }
  }
  return saleId;
}

before(() => {
  db(); // create the schema in the temp file

  run(`INSERT INTO users (id, name, role, pin_hash) VALUES (1, 'Owner', 'owner', 'x')`);
  run(`INSERT INTO chemicals (id, name, canonical_unit) VALUES (1, 'Ungerol', 'kg')`);

  // A repacked chemical and a finished product — the two business lines.
  run(
    `INSERT INTO items (id, chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, price_cents, floor_cents, cost_cents)
     VALUES (1, 1, 'Ungerol — 20 kg', 'pack', 'kg', 20000, 'pack', 1, 100000, 85000, 76000)`,
  );
  run(
    `INSERT INTO items (id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, price_cents, floor_cents, cost_cents)
     VALUES (2, '1 L bottle', 'packaging', 'pcs', 1000, 'bottle', 1, 12000, 8000, 6000)`,
  );
  // Never sold, still on the shelf — dead stock.
  run(
    `INSERT INTO items (id, name, kind, canonical_unit, size_milli, unit_label,
                        sellable, price_cents, floor_cents, cost_cents)
     VALUES (3, '5 L jerrican', 'packaging', 'pcs', 1000, 'jerrican', 1, 13000, 9000, 8000)`,
  );
  run(
    `INSERT INTO stock_movements (item_id, at, delta_milli, reason, user_id)
     VALUES (3, '2026-01-05 08:00:00', 10000, 'opening', 1)`,
  );
});

// ------------------------------------------------- (a) the timezone question

describe("Africa/Nairobi business dates", () => {
  before(() => {
    // 22:30 EAT on 3 Aug 2026 == 19:30 UTC the same day.
    sale({
      uuid: "tz-evening",
      atUtc: "2026-08-03 19:30:00",
      itemId: 1,
      name: "Ungerol — 20 kg",
      units: 1,
      unitPriceCents: 100000,
      lineCostCents: 76000,
      cash: 100000,
    });
    // 00:30 EAT on 4 Aug 2026 == 21:30 UTC on 3 Aug. The trap in the other
    // direction: grouping by raw UTC would drag this onto the 3rd.
    sale({
      uuid: "tz-after-midnight",
      atUtc: "2026-08-03 21:30:00",
      itemId: 1,
      name: "Ungerol — 20 kg",
      units: 2,
      unitPriceCents: 100000,
      lineCostCents: 152000,
      cash: 200000,
    });
  });

  test("a 22:30 Nairobi sale is counted on that business date", () => {
    const d = dayTotals("2026-08-03");
    assert.equal(d.saleCount, 1, "only the 22:30 sale belongs to the 3rd");
    assert.equal(d.salesCents, 100000);
    assert.equal(d.cashInCents, 100000);
    assert.equal(d.expectedCashCents, 100000);
  });

  test("a 22:30 Nairobi sale is NOT counted on the following business date", () => {
    const next = dayTotals("2026-08-04");
    assert.equal(next.saleCount, 1, "the 4th holds only the 00:30 EAT sale");
    assert.equal(next.salesCents, 200000);
    assert.notEqual(next.salesCents, 300000, "the evening sale must not spill into tomorrow");
  });

  test("the profit summary uses the same shop-time grouping", () => {
    const p = profitSummary(dayRange("2026-08-03"));
    assert.equal(p.salesCents, 100000);
    assert.equal(p.cogsCents, 76000);
    assert.equal(p.grossProfitCents, 24000);
  });

  test("monthly sales roll the evening sale into the Nairobi month", () => {
    const months = monthlySales(6, "2026-08-03");
    const aug = months.find((m) => m.ym === "2026-08");
    assert.ok(aug);
    assert.equal(aug.salesCents, 300000, "both August sales, neither lost to a UTC month edge");
    assert.equal(months.length, 6);
    assert.deepEqual(
      months.map((m) => m.ym),
      ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"],
    );
  });
});

// ------------------------------------------- (b) net profit on a known fixture

describe("net profit = sales − COGS − expenses", () => {
  before(() => {
    // September: two sales and two expenses, all in shop time.
    sale({
      uuid: "sep-1",
      atUtc: "2026-09-10 09:00:00",
      itemId: 1,
      name: "Ungerol — 20 kg",
      units: 3,
      unitPriceCents: 100000, // KES 1,000 each -> KES 3,000
      lineCostCents: 228000, // KES 2,280
      cash: 200000,
      mpesa: 100000,
    });
    sale({
      uuid: "sep-2",
      atUtc: "2026-09-20 14:00:00",
      itemId: 2,
      name: "Laundry Soap 1 L",
      units: 10,
      unitPriceCents: 12000, // KES 120 each -> KES 1,200
      lineCostCents: 60000, // KES 600
      cash: 50000,
      credit: 70000,
    });
    run(
      `INSERT INTO expenses (at, category, amount_cents, method, note, user_id)
       VALUES ('2026-09-11 06:00:00', 'Transport', 45000, 'cash', 'matatu to town', 1)`,
    );
    run(
      `INSERT INTO expenses (at, category, amount_cents, method, note, user_id)
       VALUES ('2026-09-25 12:00:00', 'Airtime', 10000, 'mpesa', '', 1)`,
    );
  });

  test("the September summary reconciles", () => {
    const p = profitSummary(monthRange("2026-09"));
    assert.equal(p.salesCents, 300000 + 120000); // 4,200
    assert.equal(p.cogsCents, 228000 + 60000); // 2,880
    assert.equal(p.grossProfitCents, 420000 - 288000); // 1,320
    assert.equal(p.expensesCents, 45000 + 10000); // 550
    assert.equal(p.netProfitCents, 420000 - 288000 - 55000); // 770
    assert.equal(p.netProfitCents, p.salesCents - p.cogsCents - p.expensesCents);
  });

  test("this month's expense total matches", () => {
    const e = expenseTotalForMonth("2026-09");
    assert.equal(e.totalCents, 55000);
    assert.equal(e.count, 2);
  });

  test("the business-line split separates the chemicals from what they are carried in", () => {
    const split = businessLineSplit(monthRange("2026-09"));
    const chemicals = split.find((s) => s.line === "Chemicals");
    const containers = split.find((s) => s.line === "Containers");
    assert.ok(chemicals && containers);
    assert.equal(chemicals.revenue_cents, 300000);
    assert.equal(chemicals.profit_cents, 72000);
    assert.equal(containers.revenue_cents, 120000);
    assert.equal(containers.profit_cents, 60000);
    assert.equal(Math.round(containers.margin_pct), 50);
  });

  test("day close only counts cash, never M-Pesa or credit", () => {
    const d = dayTotals("2026-09-20");
    assert.equal(d.cashInCents, 50000);
    assert.equal(d.creditCents, 70000);
    assert.equal(d.mpesaCents, 0);
    assert.equal(d.expectedCashCents, 50000, "nothing was paid out in cash that day");

    const withExpense = dayTotals("2026-09-11");
    assert.equal(withExpense.expenseCashCents, 45000);
    assert.equal(withExpense.expectedCashCents, -45000, "cash left the drawer, none came in");
  });
});

// ---------------------------------- (c) snapshotted price survives a re-price

describe("profit per product uses the snapshot, not today's price list", () => {
  test("changing an item's price afterwards does not rewrite history", () => {
    const before = profitPerProduct(monthRange("2026-09"));
    const soapBefore = before.find((r) => r.name === "Laundry Soap 1 L");
    assert.ok(soapBefore);
    assert.equal(soapBefore.revenue_cents, 120000);
    assert.equal(soapBefore.cost_cents, 60000);
    assert.equal(soapBefore.unit_price_cents, 12000);

    // The owner doubles the shelf price and re-costs the item today.
    run(`UPDATE items SET price_cents = 24000, cost_cents = 20000 WHERE id = 2`);

    const after = profitPerProduct(monthRange("2026-09"));
    const soapAfter = after.find((r) => r.name === "Laundry Soap 1 L");
    assert.ok(soapAfter);
    assert.equal(soapAfter.revenue_cents, 120000, "September revenue must not follow the new price");
    assert.equal(soapAfter.cost_cents, 60000, "September cost must not follow the new cost");
    assert.equal(soapAfter.unit_price_cents, 12000, "the snapshotted unit price is what was charged");
    assert.equal(soapAfter.profit_cents, 60000);
    assert.equal(Math.round(soapAfter.margin_pct), 50);

    // And the month's headline profit is unchanged too.
    const p = profitSummary(monthRange("2026-09"));
    assert.equal(p.netProfitCents, 77000);
  });

  test("products are ranked by profit, biggest first", () => {
    const rows = profitPerProduct(monthRange("2026-09"));
    assert.equal(rows[0].name, "Ungerol — 20 kg");
    assert.ok(rows[0].profit_cents >= rows[1].profit_cents);
  });
});

// ------------------------------------------------------------ (d) CSV escaping

describe("discounts given", () => {
  /*
    Haggling, reported.

    Two attendants, one month, one chemical argued down and one sold at the
    asking price — enough to check that the figures separate the two, attribute
    them to the right person, and measure the concession against the price that
    was being asked at the time rather than against whatever the shelf says now.
  */
  before(() => {
    run(`INSERT INTO users (id, name, role, pin_hash) VALUES (2, 'Grace', 'staff', 'x')`);
    run(`INSERT INTO users (id, name, role, pin_hash) VALUES (3, 'Peter', 'staff', 'x')`);

    // Grace: asked 1,000 a pack, agreed 900, twice.
    sale({
      uuid: "disc-grace-1", atUtc: "2026-11-04 09:00:00", itemId: 1, name: "Ungerol — 20 kg",
      units: 2, unitPriceCents: 90000, listPriceCents: 100000, lineCostCents: 152000,
      cash: 180000, userId: 2,
    });
    // Peter: asked 1,000, agreed 950, once.
    sale({
      uuid: "disc-peter-1", atUtc: "2026-11-05 09:00:00", itemId: 1, name: "Ungerol — 20 kg",
      units: 1, unitPriceCents: 95000, listPriceCents: 100000, lineCostCents: 76000,
      cash: 95000, userId: 3,
    });
    // Peter again, at the asking price. Must not appear as a discount.
    sale({
      uuid: "disc-peter-2", atUtc: "2026-11-06 09:00:00", itemId: 2, name: "1 L bottle",
      units: 4, unitPriceCents: 12000, lineCostCents: 24000, cash: 48000, userId: 3,
    });
  });

  test("the month's total is what was asked less what was charged", () => {
    const d = discountSummary(monthRange("2026-11"));
    // Grace 2 × 100 off, Peter 1 × 50 off.
    assert.equal(d.discountCents, 25000);
    // 2 packs + 1 pack at 1,000, plus 4 bottles at 120 = 348,000 asked.
    assert.equal(d.atListCents, 348000);
    assert.equal(Math.round(d.pct * 10) / 10, 7.2);
    assert.equal(d.lines, 2, "two lines were cut; the bottles were not");
  });

  test("a price above the floor is a discount but not an override", () => {
    // 900 and 950 both clear the 850 floor, so nobody needed the owner's PIN.
    assert.equal(discountSummary(monthRange("2026-11")).belowFloorLines, 0);
  });

  test("it is attributed to whoever agreed it", () => {
    const rows = discountsByPerson(monthRange("2026-11"));
    assert.equal(rows.length, 2, "only the two who discounted");
    assert.deepEqual(rows.map((r) => r.user_name), ["Grace", "Peter"], "biggest first");

    const grace = rows[0];
    assert.equal(grace.discount_cents, 20000);
    assert.equal(grace.at_list_cents, 200000);
    assert.equal(grace.lines, 1);
    assert.equal(grace.sales, 1);

    assert.equal(rows[1].discount_cents, 5000);
  });

  test("and to the item that was argued down", () => {
    const rows = discountsByItem(monthRange("2026-11"));
    assert.equal(rows.length, 1, "only Ungerol was haggled over");
    assert.equal(rows[0].name, "Ungerol — 20 kg");
    assert.equal(rows[0].discount_cents, 25000);
    assert.equal(rows[0].lines, 2);
  });

  test("the bills carry their own figure, newest first", () => {
    const bills = discountedSales(monthRange("2026-11"));
    assert.deepEqual(bills.map((b) => b.discount_cents), [5000, 20000]);
    assert.equal(bills[0].user_name, "Peter");
    assert.equal(bills[1].user_name, "Grace");
  });

  test("a month with no haggling reports nothing rather than zero rows of noise", () => {
    const d = discountSummary(monthRange("2026-10"));
    assert.equal(d.discountCents, 0);
    assert.equal(d.lines, 0);
    assert.equal(d.pct, 0, "no divide-by-zero when nothing was sold");
    assert.deepEqual(discountsByPerson(monthRange("2026-10")), []);
  });

  test("a voided sale takes its discount with it", () => {
    const id = sale({
      uuid: "disc-voided", atUtc: "2026-11-07 09:00:00", itemId: 1, name: "Ungerol — 20 kg",
      units: 5, unitPriceCents: 50000, listPriceCents: 100000, lineCostCents: 380000,
      cash: 250000, userId: 2,
    });
    run(`UPDATE sales SET status = 'voided' WHERE id = ?`, id);

    // The 2,500 that sale would have added is not in the month's figure.
    assert.equal(discountSummary(monthRange("2026-11")).discountCents, 25000);
  });
});

describe("CSV escaping", () => {
  test("a field containing a comma is quoted", () => {
    assert.equal(csvField("Njeri, Mama"), '"Njeri, Mama"');
  });

  test("a field containing a double quote is quoted and the quote doubled", () => {
    assert.equal(csvField('He said "cheap"'), '"He said ""cheap"""');
  });

  test("newlines are quoted so a note cannot start a new record", () => {
    assert.equal(csvField("line one\nline two"), '"line one\nline two"');
    assert.equal(csvField("carriage\r\nreturn"), '"carriage\r\nreturn"');
  });

  test("ordinary fields are left alone and empties stay empty", () => {
    assert.equal(csvField("Rent"), "Rent");
    assert.equal(csvField(1250), "1250");
    assert.equal(csvField(null), "");
    assert.equal(csvField(undefined), "");
  });

  test("a row keeps its column count when fields contain separators", () => {
    const row = csvRow(["Njeri, Mama", 'He said "cheap"', 42]);
    assert.equal(row, '"Njeri, Mama","He said ""cheap""",42\r\n');
  });

  test("an exported expense with a comma and a quote round-trips", () => {
    run(
      `INSERT INTO expenses (at, category, amount_cents, method, note, user_id)
       VALUES ('2026-09-26 10:00:00', 'Other', 30000, 'cash', ?, 1)`,
      'jerricans, caps and a "spare" tap',
    );
    const csv = csvText("expenses");
    assert.match(csv, /^id,business_date,at_nairobi,category,amount_kes,method,note,entered_by\r\n/);
    assert.ok(csv.includes('"jerricans, caps and a ""spare"" tap"'));
    // One header + three expenses, no record split by the embedded comma.
    assert.equal(csv.trimEnd().split("\r\n").length, 4);
    // Nairobi date, not UTC.
    assert.ok(csv.includes("2026-09-26,2026-09-26 13:00:00"));
  });

  test("every export table produces a header even when empty", () => {
    for (const table of EXPORT_TABLES) {
      const csv = csvText(table);
      assert.ok(csv.length > 0, `${table} produced nothing`);
      const header = csv.split("\r\n")[0];
      assert.ok(/(^|_)id(,|$)/.test(header.split(",")[0]), `${table} header lacks an id column`);
    }
  });

  test("sale line detail exports with item, price and cost", () => {
    const csv = csvText("sale_lines");
    assert.match(csv, /^id,sale_id,invoice_no,business_date,item,units,qty,unit_price_kes,line_total_kes,cost_kes,sale_status\r\n/);
    assert.ok(csv.includes("Ungerol"), "line names are present");
  });

  test("payments export carries method and amount for reconciliation", () => {
    const csv = csvText("payments");
    assert.ok(csv.split("\r\n")[0].includes("mpesa_code"));
    assert.ok(csv.includes("cash") || csv.includes("mpesa"), "tenders are present");
  });

  test("the price history exports both prices, not the difference", () => {
    run(
      `INSERT INTO price_changes (at, item_id, old_price, new_price, user_id, source, note)
       VALUES ('2026-09-26 10:00:00', 1, 22000, 24000, 1, 'admin', 'supplier put it up')`,
    );
    const csv = csvText("price_changes");
    const header = csv.split("\r\n")[0];
    assert.ok(header.includes("old_price_kes"), "the price in force is exported");
    assert.ok(header.includes("new_price_kes"), "the price it moved to is exported");
    // 220 -> 240 is a 20 shilling rise. All three are present: an accountant
    // asked what a thing cost in March needs the number, not the delta.
    assert.ok(csv.includes(",220.00,240.00,20.00,"), csv);
    assert.ok(csv.includes("supplier put it up"), "the reason survives");
    assert.ok(csv.includes("admin"), "where it was changed survives");
  });

  test("the activity log exports with a name against every action", () => {
    run(
      `INSERT INTO audit_log (at, user_id, action, entity, entity_id, detail)
       VALUES ('2026-09-26 10:00:00', 1, 'price_override_below_floor', 'sale', 7, 'sold at 180')`,
    );
    const csv = csvText("activity");
    assert.match(csv, /^id,business_date,at_nairobi,who,action,about,about_id,detail\r\n/);
    assert.ok(csv.includes("price_override_below_floor"), "the action survives");
    assert.ok(csv.includes("sold at 180"), "the detail survives");
    // Nairobi, not UTC — the same rule the rest of the exports follow.
    assert.ok(csv.includes("2026-09-26,2026-09-26 13:00:00"), csv);
  });

  test("the stock ledger exports with reasons and quantities in real units", () => {
    const csv = csvText("movements");
    assert.ok(csv.includes("opening"), "opening movements are present");
    // delta shown in kg/L, not milli: the 10 kg opening is 10.000, not 10000.
    assert.ok(csv.includes(",10.000,"), "quantities are converted from milli");
  });
});

// -------------------------------------------------------- the close itself

describe("saving a day close", () => {
  /** The exact statement the server action runs, so the upsert is under test. */
  function close(date: string, expected: number, counted: number, note = "") {
    run(
      `INSERT INTO day_closes (business_date, expected_cash_cents, counted_cash_cents,
                               variance_cents, mpesa_cents, credit_cents, note, closed_by)
       VALUES (?, ?, ?, ?, 0, 0, ?, 1)
       ON CONFLICT (business_date) DO UPDATE SET
         expected_cash_cents = excluded.expected_cash_cents,
         counted_cash_cents  = excluded.counted_cash_cents,
         variance_cents      = excluded.variance_cents,
         note                = excluded.note,
         closed_by           = excluded.closed_by,
         closed_at           = datetime('now')`,
      date,
      expected,
      counted,
      counted - expected,
      note,
    );
  }

  test("a close is recorded against the person who counted", () => {
    close("2026-09-20", 50000, 49500, "one 5 shilling coin missing");
    const row = closeForDate("2026-09-20");
    assert.ok(row);
    assert.equal(row.variance_cents, -500);
    assert.equal(row.closed_by_name, "Owner");
  });

  test("re-counting the same day replaces it rather than adding a second row", () => {
    close("2026-09-20", 50000, 50000, "found it");
    const row = closeForDate("2026-09-20");
    assert.ok(row);
    assert.equal(row.variance_cents, 0);
    assert.equal(row.note, "found it");
    assert.equal(recentCloses(7).filter((c) => c.business_date === "2026-09-20").length, 1);
  });

  test("recent closes come back newest first, so a run of shortages is visible", () => {
    close("2026-09-18", 30000, 28000);
    close("2026-09-19", 40000, 37000);
    const rows = recentCloses(7);
    assert.deepEqual(
      rows.slice(0, 3).map((r) => r.business_date),
      ["2026-09-20", "2026-09-19", "2026-09-18"],
    );
    assert.ok(rows.length <= 7);
  });
});

// -------------------------------------------------------------- odds and ends

describe("supporting helpers", () => {
  test("dead stock finds items with stock and no recent sale, valued at cost", () => {
    const rows = deadStock(60);
    const jerrican = rows.find((r) => r.name === "5 L jerrican");
    assert.ok(jerrican, "an item never sold but still in stock is dead stock");
    assert.equal(jerrican.qty_milli, 10000);
    assert.equal(jerrican.value_cents, 80000, "10 jerricans at KES 80 cost");
    assert.equal(jerrican.last_sold_at, null);
  });

  test("shrinkage values what the count missed, at cost, by Nairobi month", () => {
    run(
      `INSERT INTO stock_movements (item_id, at, delta_milli, reason, user_id, note)
       VALUES (1, '2026-09-30 21:30:00', -20000, 'stocktake', 1, 'count short by one pack')`,
    );
    const rows = shrinkageByMonth(6, "2026-09-15");
    const sep = rows.find((r) => r.ym === "2026-09");
    assert.ok(sep);
    // 21:30 UTC on the 30th is 00:30 EAT on 1 October — it belongs to October.
    assert.equal(sep.milli, 0, "a movement after midnight EAT is not September's");

    const oct = shrinkageByMonth(6, "2026-10-15").find((r) => r.ym === "2026-10");
    assert.ok(oct);
    assert.equal(oct.milli, -20000);
    assert.equal(oct.value_cents, -76000, "one 20 kg pack at KES 760 cost");
  });

  test("variance tone escalates with the size of the gap", () => {
    assert.equal(varianceTone(0), "good");
    assert.equal(varianceTone(-200), "good"); // KES 2 — rounding
    assert.equal(varianceTone(-5000), "warn"); // KES 50
    assert.equal(varianceTone(-50000), "bad"); // KES 500
    assert.equal(varianceTone(50000), "bad", "a surplus is as suspicious as a shortage");
  });

  test("the month's expense list is in shop time and grouped by category", () => {
    const rows = expensesForMonth("2026-09");
    assert.ok(rows.length >= 2);
    assert.ok(rows.every((r) => r.business_date.startsWith("2026-09")));
    // Newest first — the entry the owner just made is at the top.
    assert.ok(rows[0].at >= rows[rows.length - 1].at);

    const cats = expensesByCategory("2026-09");
    assert.ok(cats.length >= 2);
    assert.ok(
      cats.every((c, i) => i === 0 || cats[i - 1].total_cents >= c.total_cents),
      "categories are ordered by spend",
    );
  });

  test("month helpers cope with year boundaries and February", () => {
    assert.deepEqual(lastMonths(3, "2026-01-15"), ["2025-11", "2025-12", "2026-01"]);
    assert.equal(monthEnd("2026-02"), "2026-02-28");
    assert.equal(monthEnd("2028-02"), "2028-02-29");
    assert.deepEqual(monthRange("2026-04"), { from: "2026-04-01", to: "2026-04-30" });
  });
});


// ------------------------------------------------------------- the period

/*
  The named periods.

  Worth testing because every figure on the reports screen is read through one
  of them: a week that starts on the wrong day moves money between two reports
  and neither of them is wrong on its face.
*/

test("today is one day, and the week runs from Monday", () => {
  // 2026-08-25 is a Tuesday.
  assert.deepEqual(periodRange("today", "2026-08-25"), { from: "2026-08-25", to: "2026-08-25" });
  assert.deepEqual(periodRange("week", "2026-08-25"), { from: "2026-08-24", to: "2026-08-25" });
});

test("a Sunday belongs to the week that started six days earlier, not to the next one", () => {
  // 2026-08-30 is a Sunday. Counting back to Monday is six days, not zero.
  assert.deepEqual(periodRange("week", "2026-08-30"), { from: "2026-08-24", to: "2026-08-30" });
});

test("this month runs to today; last month is the whole of it", () => {
  assert.deepEqual(periodRange("month", "2026-08-25"), { from: "2026-08-01", to: "2026-08-25" });
  assert.deepEqual(periodRange("last-month", "2026-08-25"), { from: "2026-07-01", to: "2026-07-31" });
  assert.deepEqual(periodRange("year", "2026-08-25"), { from: "2026-01-01", to: "2026-08-25" });
});

test("last month from January is December of the year before", () => {
  assert.deepEqual(periodRange("last-month", "2026-01-14"), { from: "2025-12-01", to: "2025-12-31" });
});

test("two dates typed backwards are read as a range, not as an empty one", () => {
  assert.deepEqual(periodRange("custom", "2026-08-25", "2026-08-20", "2026-08-10"), {
    from: "2026-08-10",
    to: "2026-08-20",
  });
});

test("a period is described the way somebody would say it out loud", () => {
  assert.equal(describeRange({ from: "2026-08-25", to: "2026-08-25" }), "25 Aug 2026");
  assert.equal(describeRange({ from: "2026-08-01", to: "2026-08-25" }), "1 – 25 Aug 2026");
  assert.equal(describeRange({ from: "2026-07-28", to: "2026-08-03" }), "28 Jul – 3 Aug 2026");
  assert.equal(describeRange({ from: "2025-12-30", to: "2026-01-02" }), "30 Dec 2025 – 2 Jan 2026");
});
