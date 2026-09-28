/**
 * Why a day came out negative.
 *
 *   node --experimental-strip-types scripts/why-negative.ts 2026-09-22
 *   npm run why -- 2026-09-22
 *
 * Reads the shop's own database and names the cause, because the dashboard can
 * only show that a day lost money — it cannot show which of the three quite
 * different things went wrong, and they want three quite different answers.
 *
 *   1. AN EXPENSE. Rent, a delivery, a drum of something paid for in cash. The
 *      goods still sold at a profit; the day is negative because the shop spent
 *      more than it took. Nothing is broken and nothing needs correcting.
 *
 *   2. SELLING UNDER COST. The cost of the goods exceeded what they were sold
 *      for. Either a price is too low, or a cost is too high — and a cost that
 *      is too high is nearly always a typing slip.
 *
 *   3. A COST FILLED IN AFTERWARDS. A sale made before anyone entered what the
 *      goods cost carries no cost of its own, so the reports value it at what
 *      that product costs TODAY. Fix the cost wrongly — a whole drum's price
 *      typed into a box that means "per kilo" — and every past day that sold
 *      from it goes negative at once, without anybody touching those days.
 *
 * It only reads. Nothing here writes to the books.
 */

import { all, get } from "../src/lib/db.ts";
import { dailyProfit, profitSummary, profitPerProduct } from "../src/lib/reports.ts";
import { businessDate, formatQty } from "../src/lib/units.ts";

const DAY = process.argv[2] ?? businessDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(DAY)) {
  console.error(`Give a date as YYYY-MM-DD. Got: ${process.argv[2]}`);
  process.exit(1);
}

const kes = (c: number) =>
  (c / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (c: number) => kes(c).padStart(14);
const rule = (s = "") => console.log(s ? `\n${s}\n${"─".repeat(s.length)}` : "");

// --------------------------------------------------------------- the day

const range = { from: DAY, to: DAY };
const summary = profitSummary(range);
const row = dailyProfit(range)[0];

const shown = new Date(`${DAY}T12:00:00Z`).toLocaleDateString("en-GB", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
});
rule(shown);
if (!row && summary.salesCents === 0 && summary.expensesCents === 0) {
  console.log("Nothing was recorded on this day at all — no sales and no expenses.");
  console.log("Check the date: the shop's day runs on Nairobi time, UTC+3.");
  process.exit(0);
}

const howMany = summary.saleCount === 1 ? "1 sale" : `${summary.saleCount} sales`;
console.log(`  Sales${" ".repeat(10)}${money(summary.salesCents)}   (${howMany})`);
console.log(`  Cost of goods ${money(summary.cogsCents)}`);
console.log(`  Gross profit  ${money(summary.grossProfitCents)}`);
console.log(`  Expenses      ${money(summary.expensesCents)}`);
console.log(`  Net profit    ${money(summary.netProfitCents)}`);

if (summary.netProfitCents >= 0) {
  console.log("\nThis day is not negative. Nothing to explain.");
  process.exit(0);
}

// ------------------------------------------------- 1 · was it the expenses

if (summary.grossProfitCents >= 0) {
  rule("THE CAUSE: money spent, not money lost");
  console.log("The goods themselves sold at a profit of " + kes(summary.grossProfitCents) + ".");
  console.log("The day is negative because " + kes(summary.expensesCents) + " went out as expenses.");
} else if (summary.estimatedCostCents * 2 >= summary.cogsCents) {
  // Most of the cost is not this day's at all — it is what those products cost
  // TODAY, borrowed because nothing was recorded when they were sold. A day that
  // reads like this went negative the moment somebody saved a cost price, and
  // the day itself is innocent.
  rule("THE CAUSE: a cost price entered after the fact");
  console.log(
    kes(summary.estimatedCostCents) + " of the " + kes(summary.cogsCents) +
    " charged against this day is not\nthis day's cost at all. It is what those products cost today.",
  );
  console.log("\nNothing happened on this day to make it negative. Somebody saved a cost");
  console.log("price afterwards, and it reached backwards. See the products below.");
} else {
  rule("THE CAUSE: the goods cost more than they were sold for");
  console.log("Before a single expense, the day was already " + kes(summary.grossProfitCents) + ".");
  console.log("This is a costing problem, not a spending one. See the products below.");
}

// Either way, show what was spent — a figure entered on the wrong day, or with a
// stray zero, shows up here and nowhere else.
const spent = all<{ at: string; category: string; amount_cents: number; method: string; note: string }>(
  `SELECT at, category, amount_cents, method, note
     FROM expenses
    WHERE date(at, '+3 hours') = ?
    ORDER BY amount_cents DESC`,
  DAY,
);
if (spent.length) {
  rule("What was spent that day");
  for (const e of spent) {
    console.log(`  ${money(e.amount_cents)}  ${e.category} · ${e.method}${e.note ? " · " + e.note : ""}`);
  }
  console.log("\n  Check each one is real, is this day's, and has the decimal point where");
  console.log("  it belongs. An expense is the one thing on this screen that can be edited.");
}

// --------------------------------------- 2 · what was sold under its cost

const losers = profitPerProduct(range, 100).filter((p) => p.profit_cents < 0);
if (losers.length) {
  rule("Sold for less than it cost");
  for (const p of losers) {
    const flag = p.uncosted ? "  (no cost known)" : p.estimated ? "  (cost estimated)" : "";
    console.log(
      `  ${p.name}\n      sold ${kes(p.revenue_cents)} · cost ${kes(p.cost_cents)} · ` +
        `${kes(p.profit_cents)} · ${p.margin_pct.toFixed(0)}% margin${flag}`,
    );
  }
}

// A standing trap, whatever this day did: a product whose cost on file is at or
// above its asking price loses money on every sale, quietly, for ever.
const underwater = all<{ name: string; price_cents: number; cost_cents: number; canonical_unit: string }>(
  `SELECT name, price_cents, cost_cents, canonical_unit
     FROM items
    WHERE active = 1 AND sellable = 1 AND price_cents > 0 AND cost_cents >= price_cents
    ORDER BY (cost_cents - price_cents) DESC`,
);
if (underwater.length) {
  rule("Priced at or under what it costs — today, on the shelf");
  for (const i of underwater) {
    console.log(
      `  ${i.name}: sells ${kes(i.price_cents)}/${i.canonical_unit}, ` +
        `costs ${kes(i.cost_cents)}/${i.canonical_unit} — losing ` +
        `${kes(i.cost_cents - i.price_cents)} every ${i.canonical_unit}`,
    );
  }
  console.log("\n  Each of these loses money on every sale until the price or the cost moves.");
}

// --------------------------------- 3 · costs borrowed from today's prices

if (summary.estimatedCostCents > 0 || summary.uncostedSalesCents > 0) {
  rule("Cost that this day did not record for itself");
  if (summary.estimatedCostCents > 0) {
    console.log(
      `  ${kes(summary.estimatedCostCents)} of the cost above is TODAY'S cost price,` +
        `\n  not the cost on the day. Change that cost and this day moves.`,
    );
  }
  if (summary.uncostedSalesCents > 0) {
    console.log(
      `  ${kes(summary.uncostedSalesCents)} of sales have no known cost at all —` +
        `\n  counted as pure profit, which they are not.`,
    );
  }

  const borrowed = all<{
    name: string; qty_milli: number; unit: string; cost_cents: number; sold_cents: number;
  }>(
    `SELECT i.name AS name,
            SUM(sl.qty_milli) AS qty_milli,
            i.canonical_unit AS unit,
            i.cost_cents AS cost_cents,
            SUM(sl.line_total_cents) AS sold_cents
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
       JOIN items i ON i.id = sl.item_id
      WHERE s.status = 'completed'
        AND date(s.at, '+3 hours') = ?
        AND sl.cost_cents = 0
      GROUP BY i.id
      ORDER BY i.cost_cents * SUM(sl.qty_milli) DESC`,
    DAY,
  );
  if (borrowed.length) {
    console.log("\n  Which products, and what each is being valued at now:");
    for (const b of borrowed) {
      const valued = Math.round((b.cost_cents * b.qty_milli) / 1000);
      console.log(
        `    ${b.name}: ${formatQty(b.qty_milli, b.unit)} sold for ${kes(b.sold_cents)},` +
          `\n        valued at ${kes(b.cost_cents)}/${b.unit} = ${kes(valued)}`,
      );
    }
    console.log("\n  If one of those costs looks like a whole drum's price rather than one");
    console.log(`  ${borrowed[0].unit}, that is the fault. Cost is always per single unit.`);
  }
}

// ------------------------------------------------------------- the sales

rule("The sales on that day");
const sales = all<{ id: number; at: string; total_cents: number; status: string; who: string }>(
  `SELECT s.id, s.at, s.total_cents, s.status, COALESCE(u.name, '?') AS who
     FROM sales s LEFT JOIN users u ON u.id = s.user_id
    WHERE date(s.at, '+3 hours') = ?
    ORDER BY s.at`,
  DAY,
);
for (const s of sales) {
  const line = get<{ cost: number }>(
    `SELECT COALESCE(SUM(cost_cents), 0) AS cost FROM sale_lines WHERE sale_id = ?`, s.id);
  console.log(
    `  #${String(s.id).padEnd(6)} ${s.at.slice(11, 16)}  sold ${money(s.total_cents)}  ` +
      `cost ${money(line?.cost ?? 0)}  ${s.status === "completed" ? "" : s.status + " "}· ${s.who}`,
  );
}
console.log("\n  Voided sales are shown but are not counted in any figure above.");
