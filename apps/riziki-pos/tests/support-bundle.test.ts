/**
 * The file the shop sends when somebody is helping with the figures.
 *
 * The whole promise is one sentence: the figures go, the names do not. A
 * promise like that is worth nothing as a habit and everything as a test, so
 * this puts real names, real phone numbers and real notes into the books and
 * then reads every byte of the file looking for them.
 *
 * If a column is added to an export and forgotten in its `personal` list, this
 * is what fails — which is the point, because the alternative is finding out
 * when a customer's phone number is already in somebody's inbox.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-support-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, all, run, stockOf, postMovement } = await import("../src/lib/db.ts");
const { createSupplier, recordPurchase } = await import("../src/lib/purchasing.ts");
const { recordSale } = await import("../src/lib/sales.ts");
const { applyPrices } = await import("../src/lib/pricing.ts");
const { supportBundle, bundleName } = await import("../src/lib/support-bundle.ts");
const { csvText, personalColumns, EXPORT_TABLES } = await import("../src/lib/reports.ts");

seed();

/** Things that must never appear, each planted somewhere it would leak from. */
const SECRETS = {
  customer: "Wangeci Mwathi",
  phone: "+254733111222",
  staff: "Maryann Atieno",
  note: "owes for the funeral, do not chase",
  expenseNote: "airtime for Kamau the driver",
  mpesa: "SJK7YT21QQ",
};

run(`INSERT INTO users (name, role, pin_hash) VALUES (?, 'staff', 'x')`, SECRETS.staff);
const staff = get<{ id: number }>(`SELECT id FROM users WHERE name = ?`, SECRETS.staff)!.id;
run(
  `INSERT INTO customers (name, phone, kind) VALUES (?, ?, 'retail')`,
  SECRETS.customer,
  SECRETS.phone,
);
const customer = get<{ id: number }>(`SELECT id FROM customers WHERE name = ?`, SECRETS.customer)!.id;

const ungerol = get<{ id: number; price_cents: number }>(
  `SELECT id, price_cents FROM items WHERE name = 'Ungerol'`,
)!;
run(`UPDATE items SET floor_cents = 100, ceiling_cents = 200000 WHERE id = ?`, ungerol.id);
postMovement({ itemId: ungerol.id, deltaMilli: 500000, reason: "stocktake", userId: staff });

const supplier = createSupplier({ name: "Chemi Traders Ltd" }, staff);
recordPurchase({
  supplierId: supplier,
  ref: "INV-77",
  transportCents: 20000,
  userId: staff,
  lines: [{ itemId: ungerol.id, units: 1, sizeMilli: 250000, costCents: 8000000 }],
});

const total = Math.round((ungerol.price_cents * 20000) / 1000);
recordSale({
  clientUuid: "support-1",
  userId: staff,
  tier: "retail",
  customerId: customer,
  note: SECRETS.note,
  lines: [{ itemId: ungerol.id, units: 1, qtyMilli: 20000, unitPriceCents: ungerol.price_cents }],
  tenders: [{ method: "mpesa", amountCents: total, mpesaCode: SECRETS.mpesa }],
});

run(
  `INSERT INTO expenses (at, category, amount_cents, method, note, user_id)
   VALUES (datetime('now'), 'Airtime', 50000, 'mpesa', ?, ?)`,
  SECRETS.expenseNote,
  staff,
);
applyPrices([{ itemId: ungerol.id, price: 560 }], staff, { source: "admin" });

const bundle = supportBundle(null);

// ------------------------------------------------------------- the promise

test("every secret really is in the books, or the test below proves nothing", () => {
  /*
    The trap this avoids: a test that looks for names in a file, where the
    names were never written to the database in the first place. It would pass
    on the day the redaction broke, which is the only day it matters.
  */
  const everything = EXPORT_TABLES.map((t) => csvText(t)).join("\n");
  for (const [what, secret] of Object.entries(SECRETS)) {
    assert.ok(everything.includes(secret), `the ${what} never reached the books`);
  }
});

test("not one name, number or note reaches the file", () => {
  for (const [what, secret] of Object.entries(SECRETS)) {
    assert.ok(
      !bundle.includes(secret),
      `the ${what} ("${secret}") is in the file the shop would have sent`,
    );
  }
});

test("the figures it exists for are all there", () => {
  // Emptying the names must not empty the point of the file.
  assert.ok(bundle.includes("Ungerol"), "what was bought and sold is named");
  assert.ok(bundle.includes("Chemi Traders Ltd"), "a supplier is a business, not a person");
  assert.ok(bundle.includes("INV-77"), "the invoice number, for checking against the note");
  assert.ok(/== landed ==/.test(bundle));
  assert.ok(/== sale_lines ==/.test(bundle));
  assert.ok(/== stock ==/.test(bundle));
  assert.ok(/== movements ==/.test(bundle));
  assert.ok(/== batches ==/.test(bundle));
  assert.ok(/== expenses ==/.test(bundle));
  assert.ok(/== price_changes ==/.test(bundle));
  assert.ok(bundle.includes("DAY BY DAY"), "the day-by-day figures");
  assert.ok(bundle.includes("WHAT THE BOOKS CHECK SAYS"), "and the app's own verdict first");
});

test("the two tables that are all about people are not in it at all", () => {
  // Not redacted — absent. A costing question has never needed either.
  assert.ok(!/== customers ==/.test(bundle));
  assert.ok(!/== sales ==/.test(bundle));
});

test("it says what it removed, so nobody has to guess", () => {
  assert.ok(bundle.includes("no customer names"));
  assert.ok(bundle.includes("no staff names"));
  assert.ok(bundle.includes("emptied"));
});

// ------------------------------------------------- the rule under the promise

test("redacting empties the named columns and leaves the rest", () => {
  const open = csvText("sales");
  const shut = csvText("sales", null, { redact: true });

  assert.ok(open.includes(SECRETS.customer), "the ordinary export still carries it");
  assert.ok(!shut.includes(SECRETS.customer), "the redacted one does not");
  assert.equal(
    open.trimEnd().split("\r\n").length,
    shut.trimEnd().split("\r\n").length,
    "the same rows, with holes in them — not fewer rows",
  );
  assert.equal(open.split("\r\n")[0], shut.split("\r\n")[0], "and the same columns");
});

test("every export declares which of its columns name a person", () => {
  /*
    The list lives beside the header so the two cannot drift. A column added to
    one and forgotten in the other is how a phone number ends up in a file
    somebody sends to a stranger, so this checks each declared column is real.
  */
  for (const table of EXPORT_TABLES) {
    const header = csvText(table).split("\r\n")[0].split(",");
    for (const col of personalColumns(table)) {
      assert.ok(header.includes(col), `${table} says "${col}" is personal, but has no such column`);
    }
  }
});

test("anything that looks like a person is declared", () => {
  /*
    A sweep for the columns that get added later and forgotten.

    Deliberately not "name" on its own: `stock.name` is a product and
    `batches.formula` is a recipe, and a rule that shouts about those is a rule
    somebody switches off. It looks for the words that only ever mean a person
    — who, by, customer, phone — and for free text, which can say anything.
  */
  const SUSPECT = /^(who|by|customer|phone|note|detail|.*_by|.*_reason|mpesa_code)$/;
  for (const table of EXPORT_TABLES) {
    const header = csvText(table).split("\r\n")[0].split(",");
    const declared = new Set(personalColumns(table));
    for (const col of header) {
      if (!SUSPECT.test(col)) continue;
      assert.ok(
        declared.has(col),
        `${table}.${col} looks like it names somebody and is not declared personal`,
      );
    }
  }
});

test("the table that is all about people declares itself so", () => {
  // It is not in the bundle, but it is an export, and the day somebody adds it
  // to one this is what stops the names going with it.
  const declared = personalColumns("customers");
  assert.ok(declared.includes("name"));
  assert.ok(declared.includes("phone"));
});

test("the file is named for what it holds", () => {
  assert.match(bundleName({ from: "2026-09-01", to: "2026-09-30" }), /support-2026-09-01_to_2026-09-30\.txt$/);
});
