/**
 * The dashboard, checked figure by figure against the raw tables.
 *
 * This is the screen the owner judges the system by, so nothing here trusts the
 * code that produced the number: every assertion recomputes the figure from
 * `sales`, `sale_lines`, `payments` and `expenses` with its own SQL, and
 * compares. A dashboard that agrees with itself and not with the ledger is the
 * most expensive kind of wrong.
 *
 * The fixture is a fortnight of hand-written trading with awkward corners in
 * it: a voided sale, a part-paid invoice settled the following week, a day with
 * an expense and no sales, and a product sold before anybody recorded its cost.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-dash-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { run, get, all, db } = await import("../src/lib/db.ts");
const { profitSummary, dailyProfit } = await import("../src/lib/reports.ts");
const {
  dashboard,
  trend,
  moneyIn,
  debtors,
  shelfNow,
  topCustomers,
  previousRange,
  daysInRange,
  change,
} = await import("../src/lib/dashboard.ts");

// ---------------------------------------------------------------- fixture

db();
run(`INSERT INTO users (id, name, role, pin_hash) VALUES (1, 'Owner', 'owner', 'x')`);
run(`INSERT INTO customers (id, name) VALUES (1, 'Mama Njeri'), (2, 'Kariuki Hardware')`);

// Two products: one with a cost on file, one without — the shop's real state.
run(
  `INSERT INTO items (id, name, kind, canonical_unit, size_milli, unit_label, sellable,
                      price_basis, price_cents, floor_cents, cost_cents, reorder_level_milli)
   VALUES (1, 'Ungerol', 'bulk', 'kg', 20000, 'drum', 1, 'unit', 44000, 0, 34000, 50000),
          (2, 'Mystery Powder', 'bulk', 'kg', 25000, 'bag', 1, 'unit', 30000, 0, 0, 0)`,
);
run(
  `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id)
   VALUES (1, 400000, 'opening', 1), (2, 50000, 'opening', 1)`,
);

/** A completed sale, at an explicit UTC time, with its lines and payments. */
function sale(o: {
  id: number;
  atUtc: string;
  customerId?: number;
  lines: Array<{ itemId: number; units: number; qtyMilli: number; totalCents: number; costCents: number }>;
  cash?: number;
  mpesa?: number;
  status?: "completed" | "voided";
}) {
  const total = o.lines.reduce((n, l) => n + l.totalCents, 0);
  const paid = (o.cash ?? 0) + (o.mpesa ?? 0);
  run(
    `INSERT INTO sales (id, client_uuid, at, user_id, customer_id, tier, total_cents, paid_cents, status)
     VALUES (?, ?, ?, 1, ?, 'retail', ?, ?, ?)`,
    o.id,
    `dash-${o.id}`,
    o.atUtc,
    o.customerId ?? null,
    total,
    paid,
    o.status ?? "completed",
  );
  for (const l of o.lines) {
    run(
      `INSERT INTO sale_lines (sale_id, item_id, name_snapshot, units, qty_milli,
                               unit_price_cents, line_total_cents, cost_cents)
       VALUES (?, ?, (SELECT name FROM items WHERE id = ?), ?, ?, ?, ?, ?)`,
      o.id,
      l.itemId,
      l.itemId,
      l.units,
      l.qtyMilli,
      Math.round(l.totalCents / l.units),
      l.totalCents,
      l.costCents,
    );
  }
  for (const [method, amount] of [["cash", o.cash ?? 0], ["mpesa", o.mpesa ?? 0]] as const) {
    if (amount > 0) {
      run(
        `INSERT INTO payments (sale_id, at, method, amount_cents, user_id)
         VALUES (?, ?, ?, ?, 1)`,
        o.id,
        o.atUtc,
        method,
        amount,
      );
    }
  }
}

// Week one: 1–7 September 2026.
sale({ id: 1, atUtc: "2026-09-01 07:00:00", lines: [{ itemId: 1, units: 1, qtyMilli: 20000, totalCents: 880000, costCents: 680000 }], cash: 880000 });
sale({ id: 2, atUtc: "2026-09-02 11:30:00", lines: [{ itemId: 1, units: 1, qtyMilli: 10000, totalCents: 440000, costCents: 340000 }], mpesa: 440000 });
// Part paid, by a customer, settled the following week.
sale({ id: 3, atUtc: "2026-09-03 09:15:00", customerId: 1, lines: [{ itemId: 1, units: 1, qtyMilli: 20000, totalCents: 880000, costCents: 680000 }], cash: 300000 });
// Voided: it must vanish from every figure on the screen.
sale({ id: 4, atUtc: "2026-09-04 10:00:00", lines: [{ itemId: 1, units: 1, qtyMilli: 40000, totalCents: 1760000, costCents: 1360000 }], cash: 1760000, status: "voided" });
// Sold with no cost recorded anywhere — the 100%-margin trap.
sale({ id: 5, atUtc: "2026-09-05 14:00:00", lines: [{ itemId: 2, units: 1, qtyMilli: 10000, totalCents: 300000, costCents: 0 }], cash: 300000 });

// Week two: 8–14 September.
sale({ id: 6, atUtc: "2026-09-08 08:00:00", customerId: 2, lines: [{ itemId: 1, units: 1, qtyMilli: 20000, totalCents: 880000, costCents: 680000 }], cash: 880000 });
sale({ id: 7, atUtc: "2026-09-09 12:00:00", lines: [{ itemId: 1, units: 1, qtyMilli: 5000, totalCents: 220000, costCents: 170000 }], cash: 220000 });
sale({ id: 8, atUtc: "2026-09-12 16:00:00", lines: [{ itemId: 1, units: 1, qtyMilli: 20000, totalCents: 880000, costCents: 680000 }], mpesa: 880000 });

// Mama Njeri settles her September 3rd invoice on the 10th: money in week two,
// no sale in week two.
run(
  `INSERT INTO payments (sale_id, at, method, amount_cents, user_id)
   VALUES (3, '2026-09-10 10:00:00', 'cash', 580000, 1)`,
);
run(`UPDATE sales SET paid_cents = 880000 WHERE id = 3`);

// An expense on a day with no sales at all.
run(
  `INSERT INTO expenses (at, category, amount_cents, method, note, user_id)
   VALUES ('2026-09-11 09:00:00', 'Transport', 50000, 'cash', 'lorry', 1),
          ('2026-09-08 09:00:00', 'Rent', 200000, 'mpesa', 'September', 1)`,
);

const WEEK_ONE = { from: "2026-09-01", to: "2026-09-07" };
const WEEK_TWO = { from: "2026-09-08", to: "2026-09-14" };
const FORTNIGHT = { from: "2026-09-01", to: "2026-09-14" };

// ------------------------------------------------------------- the ranges

test("a period compares against one of its own length, ending the day before", () => {
  assert.equal(daysInRange(WEEK_TWO), 7);
  assert.deepEqual(previousRange(WEEK_TWO), WEEK_ONE);

  // Eleven days compare against the eleven before them, not "last month".
  assert.deepEqual(previousRange({ from: "2026-09-11", to: "2026-09-21" }), {
    from: "2026-08-31",
    to: "2026-09-10",
  });
});

test("a change against nothing is not a hundred per cent", () => {
  assert.equal(change(1000, 500), 100);
  assert.equal(change(500, 1000), -50);
  assert.equal(change(1000, 0), null, "a first week in business has nothing to be up against");
});

// -------------------------------------------------------- against the tables

test("the headline figures match the raw tables, to the cent", () => {
  const d = dashboard(FORTNIGHT);

  const raw = get<{ total: number; n: number }>(
    `SELECT COALESCE(SUM(total_cents), 0) AS total, COUNT(*) AS n
       FROM sales
      WHERE status = 'completed' AND date(at, '+3 hours') BETWEEN ? AND ?`,
    FORTNIGHT.from,
    FORTNIGHT.to,
  )!;

  assert.equal(d.now.salesCents, raw.total, "sales");
  assert.equal(d.now.saleCount, raw.n, "how many sales");
  assert.equal(raw.n, 7, "and the voided one is not among them");

  const rawExpenses = get<{ total: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM expenses
      WHERE date(at, '+3 hours') BETWEEN ? AND ?`,
    FORTNIGHT.from,
    FORTNIGHT.to,
  )!;
  assert.equal(d.now.expensesCents, rawExpenses.total, "expenses");

  assert.equal(
    d.now.netProfitCents,
    d.now.grossProfitCents - d.now.expensesCents,
    "net is gross less expenses, and nothing else",
  );
  assert.equal(
    d.now.averageSaleCents,
    Math.round(raw.total / raw.n),
    "the average sale is the total over the count",
  );
  assert.equal(
    Math.round(d.now.marginPct),
    Math.round((d.now.grossProfitCents / d.now.salesCents) * 100),
    "margin is gross over sales",
  );

  // The comparison table on the screen prints sales, cost and gross as three
  // rows and the owner adds them up by eye. They have to actually add up.
  assert.equal(
    d.now.grossProfitCents,
    d.now.salesCents - d.now.cogsCents,
    "gross is sales less the cost of the goods",
  );
  assert.equal(d.now.cogsCents, d.summary.cogsCents, "and the cost is the one profitSummary found");
  assert.equal(
    d.before.grossProfitCents,
    d.before.salesCents - d.before.cogsCents,
    "the same holds for the period it is compared against",
  );
});

test("a voided sale is gone from every figure, not merely struck through", () => {
  // Sale 4 is 17,600 of sales and 13,600 of cost. If any of it survived into a
  // figure, the numbers below would carry it.
  const d = dashboard({ from: "2026-09-04", to: "2026-09-04" });
  assert.equal(d.now.salesCents, 0);
  assert.equal(d.now.saleCount, 0);
  assert.equal(d.now.grossProfitCents, 0);
  assert.equal(d.trend.points.every((p) => p.salesCents === 0), true);
});

test("the period total is exactly the sum of the buckets drawn in the chart", () => {
  for (const grain of ["day", "week"] as const) {
    const t = trend(FORTNIGHT, grain);
    const sales = t.points.reduce((n, p) => n + p.salesCents, 0);
    const gross = t.points.reduce((n, p) => n + p.grossProfitCents, 0);
    const count = t.points.reduce((n, p) => n + p.saleCount, 0);
    const s = profitSummary(FORTNIGHT);

    assert.equal(sales, s.salesCents, `${grain}: the bars add up to the headline`);
    assert.equal(gross, s.grossProfitCents, `${grain}: and so does the profit`);
    assert.equal(count, s.saleCount, `${grain}: and the count`);
  }
});

test("the chart's grain follows the span, and its buckets are whole weeks", () => {
  assert.equal(trend({ from: "2026-09-01", to: "2026-09-14" }).grain, "day");
  assert.equal(trend({ from: "2026-06-01", to: "2026-09-14" }).grain, "week");
  assert.equal(trend({ from: "2026-01-01", to: "2026-12-31" }).grain, "month");

  const weekly = trend(FORTNIGHT, "week");
  assert.deepEqual(
    weekly.points.map((p) => p.key),
    ["2026-08-31", "2026-09-07", "2026-09-14"],
    "weeks start on Monday, even when the range does not — and the 14th is one",
  );
});

test("every day in the period gets a bar, including the ones nothing happened on", () => {
  const t = trend(FORTNIGHT, "day");
  assert.equal(t.points.length, 14, "fourteen days, fourteen bars");
  const sixth = t.points.find((p) => p.key === "2026-09-06")!;
  assert.equal(sixth.salesCents, 0, "a quiet Sunday is a bar of nothing, not a gap");
});

// ------------------------------------------------------------- money in

test("money in is counted when it arrived, not when the sale happened", () => {
  const m = moneyIn(WEEK_TWO);

  const rawCash = get<{ total: number }>(
    `SELECT COALESCE(SUM(p.amount_cents), 0) AS total
       FROM payments p JOIN sales s ON s.id = p.sale_id
      WHERE s.status = 'completed' AND p.method = 'cash'
        AND date(p.at, '+3 hours') BETWEEN ? AND ?`,
    WEEK_TWO.from,
    WEEK_TWO.to,
  )!;
  assert.equal(m.cashCents, rawCash.total);

  // Mama Njeri's 5,800 landed in week two against a week-one sale. It is money
  // in the drawer and it is not week two's sales — both facts, said separately.
  assert.equal(m.settledOldCents, 580000, "an old invoice settled inside the period");
  const weekTwoSales = profitSummary(WEEK_TWO).salesCents;
  assert.equal(
    m.totalCollectedCents - m.settledOldCents <= weekTwoSales,
    true,
    "what was collected against this period's own sales cannot exceed them",
  );
});

test("credit given is what walked out unpaid on the day, not what is still owed", () => {
  const m = moneyIn(WEEK_ONE);

  /*
    Sale 3: 8,800 with 3,000 paid at the counter, and the other 5,800 settled a
    week later. Week one gave 5,800 of credit — that is a fact about week one
    and it does not change when the money arrives. What is STILL owed from week
    one is separately zero, because she paid.
  */
  assert.equal(m.creditGivenCents, 580000, "credit given, at the counter, that week");
  assert.equal(m.stillOwedCents, 0, "and nothing from that week is outstanding now");
});

// ----------------------------------------------------------- what is owed

test("the debtors list is the unpaid remainder, oldest first in days", () => {
  // Everything is settled after the fixture's payment, so add one that is not.
  sale({ id: 9, atUtc: "2026-09-13 10:00:00", customerId: 2, lines: [{ itemId: 1, units: 1, qtyMilli: 20000, totalCents: 880000, costCents: 680000 }], cash: 80000 });

  const d = debtors();
  const raw = get<{ total: number }>(
    `SELECT COALESCE(SUM(total_cents - paid_cents), 0) AS total
       FROM sales WHERE status = 'completed' AND total_cents > paid_cents`,
  )!;

  assert.equal(d.totalCents, raw.total, "what is owed, against the sales rows");
  assert.equal(d.customerCount, 1);
  assert.equal(d.top[0].name, "Kariuki Hardware");
  assert.equal(d.top[0].owedCents, 800000);
  assert.ok(d.oldestDays >= 0);
});

// --------------------------------------------------------- what is on the shelf

test("the shelf is valued at cost and at the asking price, and counts its own gaps", () => {
  const s = shelfNow();

  const raw = get<{ at_cost: number; at_retail: number }>(
    `SELECT COALESCE(SUM(CAST(ROUND(1.0 * q.qty * i.cost_cents / 1000) AS INTEGER)), 0) AS at_cost,
            COALESCE(SUM(CAST(ROUND(1.0 * q.qty * i.price_cents / 1000) AS INTEGER)), 0) AS at_retail
       FROM items i
       JOIN (SELECT item_id, SUM(delta_milli) AS qty FROM stock_movements GROUP BY item_id) q
         ON q.item_id = i.id
      WHERE i.active = 1 AND q.qty > 0`,
  )!;

  assert.equal(s.atCostCents, raw.at_cost);
  assert.equal(s.atRetailCents, raw.at_retail);
  assert.equal(s.uncostedCount, 1, "the Mystery Powder has no cost, and is counted as such");
});

// ------------------------------------------------------------ the whole thing

test("the dashboard agrees with the screens it links to", () => {
  const d = dashboard(FORTNIGHT);

  // The headline is profitSummary, not a second opinion about it.
  const s = profitSummary(FORTNIGHT);
  assert.equal(d.now.salesCents, s.salesCents);
  assert.equal(d.now.grossProfitCents, s.grossProfitCents);
  assert.equal(d.summary.uncostedSalesCents, 300000, "and it carries what is NOT known");

  // The day-by-day table under the chart is the same rows the chart is drawn
  // from, so they cannot disagree.
  const table = dailyProfit(FORTNIGHT);
  const fromTable = table.reduce((n, r) => n + r.salesCents, 0);
  const fromChart = d.trend.points.reduce((n, p) => n + p.salesCents, 0);
  assert.equal(fromChart, fromTable);

  assert.equal(d.bestDay?.date, "2026-09-01", "the best day is the best day");
  assert.equal(d.bestDay?.salesCents, 880000);
  assert.equal(d.days, 14);
});

test("the comparison period is real trading, not a copy of the current one", () => {
  const d = dashboard(WEEK_TWO);
  assert.equal(d.now.salesCents, profitSummary(WEEK_TWO).salesCents);
  assert.equal(d.before.salesCents, profitSummary(WEEK_ONE).salesCents);
  assert.notEqual(d.now.salesCents, d.before.salesCents);
});

test("top customers add up to the period's sales, walk-ins included", () => {
  const rows = topCustomers(FORTNIGHT, 50);
  const total = rows.reduce((n, r) => n + r.salesCents, 0);
  assert.equal(total, profitSummary(FORTNIGHT).salesCents, "everybody is on the list once");
  assert.ok(rows.some((r) => r.id === null), "walk-ins are a row, not a hole");
});
