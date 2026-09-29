/**
 * One file to send when somebody is helping with the figures.
 *
 * WHY IT EXISTS. Working out why a day came out wrong took four separate
 * exports and a conversation about which of them carried customer names. The
 * shop should not have to make that judgement in a hurry, and the person
 * helping should not have to be trusted with names they have no use for.
 *
 * So: one download, holding only what a costing question needs, with every
 * column that names a person already empty. Not "be careful what you send" —
 * emptied at the source, from a list kept beside the column headers so the two
 * cannot drift apart.
 *
 * WHAT IS IN IT. Deliveries at their landed rates, sale lines with what each
 * was charged and costed at, stock movements, mixing batches, the shelf as it
 * stands, the day-by-day figures, and what the books check currently says. That
 * is everything needed to answer "why is this margin what it is" and nothing
 * else.
 *
 * WHAT IS NOT. No customer names or phone numbers, no staff names, no free-text
 * notes — a note is free text and free text can say anything. No PINs, no
 * payment references, no credentials. The `customers` and `sales` tables are
 * not in it at all: a costing question has never needed either.
 *
 * WHY A PLAIN TEXT FILE. A zip would be tidier and a zip is a format this app
 * has no business writing by hand — the same reason the spreadsheet export is
 * CSV and not .xlsx. One file opens in anything, survives being pasted into a
 * message, and cannot quietly hold a thirteenth table nobody looked at.
 */

import { csvText, dailyProfit, describeRange, type DateRange, type ExportTable } from "./reports.ts";
import { checkBooks } from "./health.ts";
import { businessDate } from "./units.ts";

/** What goes in, and why each one is there. */
const TABLES: Array<{ table: ExportTable; why: string }> = [
  { table: "landed", why: "every delivery at what it landed at per kilo, litre or piece" },
  { table: "sale_lines", why: "every line sold, with what it was charged and what it was costed at" },
  { table: "stock", why: "the shelf as it stands, valued at cost" },
  { table: "movements", why: "everything that moved on or off the shelf" },
  { table: "batches", why: "what was mixed, and what each batch cost to make" },
  { table: "price_changes", why: "every change to an asking price" },
  { table: "expenses", why: "what was paid out, by category" },
];

const kes = (c: number) => (c / 100).toFixed(2);

export function bundleName(range: DateRange | null): string {
  const span = range ? `${range.from}_to_${range.to}` : `to-${businessDate()}`;
  return `riziki-support-${span}.txt`;
}

export function supportBundle(range: DateRange | null): string {
  const out: string[] = [];
  const line = (s = "") => out.push(s);
  const rule = (s: string) => {
    line();
    line(s);
    line("=".repeat(s.length));
  };

  line("RIZIKI INDUSTRIAL CHEMICALS — figures for an assessment");
  line(`Made ${businessDate()} · covering ${range ? describeRange(range) : "everything on record"}`);
  line();
  line("This file holds what a costing question needs and nothing else.");
  line("Every column naming a person has been emptied before writing:");
  line("  no customer names or phone numbers, no staff names, no free-text notes,");
  line("  no PINs, no payment references, no passwords.");
  line("The customers and sales tables are not in this file at all.");
  line();
  line("It is a plain text file holding several spreadsheets, one after another.");
  line("Each begins with a line like  == landed ==  and can be copied into Excel.");

  /*
    The app's own verdict first.

    Whoever opens this should start with what the shop already knows rather than
    working it out again from the rows — and if the checks and the rows disagree,
    that disagreement is itself the most interesting thing in the file.
  */
  const health = checkBooks();
  rule("WHAT THE BOOKS CHECK SAYS");
  line(
    `${health.checked.items} products and ${health.checked.deliveries} delivery lines compared: ` +
      `${health.counts.high} worth fixing, ${health.counts.medium} worth knowing.`,
  );
  if (!health.findings.length) line("Nothing stood out.");
  for (const f of health.findings) {
    line();
    line(`[${f.severity}] ${f.kind}`);
    line(`  ${f.title}`);
    line(`  ${f.detail}`);
  }

  rule("DAY BY DAY");
  line("date,sales_kes,cost_of_goods_kes,gross_profit_kes,expenses_kes,net_profit_kes,sales_count");
  for (const d of dailyProfit(range ?? { from: "0000-01-01", to: "9999-12-31" })) {
    line(
      [
        d.date,
        kes(d.salesCents),
        kes(d.cogsCents),
        kes(d.grossProfitCents),
        kes(d.expensesCents),
        kes(d.netProfitCents),
        d.saleCount,
      ].join(","),
    );
  }

  for (const { table, why } of TABLES) {
    rule(`== ${table} ==`);
    line(`(${why})`);
    line();
    line(csvText(table, range, { redact: true }).trimEnd());
  }

  line();
  line("— end —");
  return out.join("\n") + "\n";
}
