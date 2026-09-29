/**
 * Why a day came out negative — on a terminal.
 *
 *   npm run why -- 2026-09-22
 *
 * THE SAME ANSWER IS NOW A SCREEN: /day/2026-09-22, reachable by tapping the
 * date on the dashboard's day-by-day list. That is where it belongs, because
 * the person who wants it is holding a phone and this needed an ssh session, a
 * password and a terminal. This remains for the cases a screen cannot serve —
 * a shop that cannot sign in, a database restored from a backup, a support call
 * where somebody wants the whole thing as text to paste.
 *
 * The rules live in `lib/day-why` and both print the same verdict from them.
 * Two implementations of "why was the 22nd negative" would be two answers, and
 * only one of them would be on screen.
 *
 * It only reads. Nothing here writes to the books.
 */

import { explainDay } from "../src/lib/day-why.ts";
import { businessDate, formatQty } from "../src/lib/units.ts";

const DAY = process.argv[2] ?? businessDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(DAY)) {
  console.error(`Give a date as YYYY-MM-DD. Got: ${process.argv[2]}`);
  process.exit(1);
}

const kes = (c: number) =>
  (c / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (c: number) => kes(c).padStart(14);
const say = (s = "") => console.log(s);
const rule = (s: string) => {
  say();
  say(s);
  say("─".repeat(s.length));
};

const d = explainDay(DAY);
const s = d.summary;

rule(
  new Date(`${DAY}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }),
);

if (d.cause === "nothing") {
  say("Nothing was recorded on this day at all — no sales and no expenses.");
  say("Check the date: the shop's day runs on Nairobi time, UTC+3.");
  process.exit(0);
}

const howMany = s.saleCount === 1 ? "1 sale" : `${s.saleCount} sales`;
say(`  Sales${" ".repeat(10)}${money(s.salesCents)}   (${howMany})`);
say(`  Cost of goods ${money(s.cogsCents)}`);
say(`  Gross profit  ${money(s.grossProfitCents)}`);
say(`  Expenses      ${money(s.expensesCents)}`);
say(`  Net profit    ${money(s.netProfitCents)}`);

if (d.cause === "positive") {
  say();
  say("This day is not negative. Nothing to explain.");
  process.exit(0);
}

if (d.cause === "expenses") {
  rule("THE CAUSE: money spent, not money lost");
  say(`The goods themselves sold at a profit of ${kes(s.grossProfitCents)}.`);
  say(`The day is negative because ${kes(s.expensesCents)} went out as expenses.`);
} else if (d.cause === "late-cost") {
  rule("THE CAUSE: a cost price entered after the fact");
  say(
    `${kes(s.estimatedCostCents)} of the ${kes(s.cogsCents)} charged against this day is not\n` +
      `this day's cost at all. It is what those products cost today.`,
  );
  say();
  say("Nothing happened on this day to make it negative. Somebody saved a cost");
  say("price afterwards, and it reached backwards. See the products below.");
} else {
  rule("THE CAUSE: the goods cost more than they were sold for");
  say(`Before a single expense, the day was already ${kes(s.grossProfitCents)}.`);
  say("This is a costing problem, not a spending one. See the products below.");
}

if (d.spend.length) {
  rule("What was spent that day");
  for (const e of d.spend) {
    say(`  ${money(e.amountCents)}  ${e.category} · ${e.method}${e.note ? " · " + e.note : ""}`);
  }
  say();
  say("  Check each one is real, is this day's, and has the decimal point where");
  say("  it belongs. An expense is the one thing on this screen that can be edited.");
}

if (d.losers.length) {
  rule("Sold for less than it cost");
  for (const p of d.losers) {
    const flag = p.uncosted ? "  (no cost known)" : p.estimated ? "  (cost estimated)" : "";
    say(
      `  ${p.name}\n      sold ${kes(p.revenue_cents)} · cost ${kes(p.cost_cents)} · ` +
        `${kes(p.profit_cents)} · ${p.margin_pct.toFixed(0)}% margin${flag}`,
    );
  }
}

if (d.underwater.length) {
  rule("Priced at or under what it costs — today, on the shelf");
  for (const i of d.underwater) {
    say(
      `  ${i.name}: sells ${kes(i.priceCents)}/${i.unit}, costs ${kes(i.costCents)}/${i.unit}` +
        ` — losing ${kes(i.lossCents)} every ${i.unit}`,
    );
  }
  say();
  say("  Each of these loses money on every sale until the price or the cost moves.");
}

if (s.estimatedCostCents > 0 || s.uncostedSalesCents > 0) {
  rule("Cost that this day did not record for itself");
  if (s.estimatedCostCents > 0) {
    say(`  ${kes(s.estimatedCostCents)} of the cost above is TODAY'S cost price,`);
    say(`  not the cost on the day. Change that cost and this day moves.`);
  }
  if (s.uncostedSalesCents > 0) {
    say(`  ${kes(s.uncostedSalesCents)} of sales have no known cost at all —`);
    say(`  counted as pure profit, which they are not.`);
  }

  if (d.borrowed.length) {
    say();
    say("  Which products, and what each is being valued at now:");
    for (const b of d.borrowed) {
      say(
        `    ${b.name}: ${formatQty(b.qtyMilli, b.unit)} sold for ${kes(b.soldCents)},` +
          `\n        valued at ${kes(b.rateCents)}/${b.unit} = ${kes(b.valuedCents)}`,
      );
    }
    say();
    say("  If one of those costs looks like a whole drum's price rather than one");
    say(`  ${d.borrowed[0].unit}, that is the fault. Cost is always per single unit.`);
  }
}

rule("The sales on that day");
for (const x of d.sales) {
  say(
    `  #${String(x.id).padEnd(6)} ${x.at.slice(11, 16)}  sold ${money(x.totalCents)}  ` +
      `cost ${money(x.costCents)}  ${x.status === "completed" ? "" : x.status + " "}· ${x.who ?? "?"}`,
  );
}
say();
say("  Voided sales are shown but are not counted in any figure above.");
say();
say(`  The same thing, on a screen: /day/${DAY}`);
