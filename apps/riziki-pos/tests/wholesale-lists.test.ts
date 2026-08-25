/**
 * The wholesale listing screens.
 *
 * Two things are worth pinning here, and they are the two things that were
 * actually wrong.
 *
 * The first is the status word. `sales.status` is 'completed', and a screen that
 * compares it against 'complete' does not throw — it quietly decides every
 * invoice was voided and every total was zero. A typo with no error message is
 * exactly what a test is for.
 *
 * The second is the reconciliation. There used to be a debts screen keeping its
 * own count of the same money the invoice list held, and the way that goes wrong
 * is not dramatic: the two totals drift, usually over a voided bill or a part
 * payment, and then nobody knows which figure to believe. Now there is one
 * arithmetic behind both views, so these tests assert the views agree.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "riziki-lists-"));
process.env.RIZIKI_DB = join(TMP, "test.db");

const { get, run } = await import("../src/lib/db.ts");
const { seed } = await import("../src/lib/seed.ts");
const { recordSale, voidSale } = await import("../src/lib/sales.ts");
const { debtors } = await import("../src/lib/credit.ts");
const {
  wholesaleInvoices,
  wholesaleInvoiceTotals,
  wholesaleCustomers,
  customerStateCounts,
  PAGE_SIZE,
} = await import("../src/lib/wholesale-lists.ts");

seed();
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

const OWNER = 1;

function sellableItem() {
  const row = get<{ id: number; size_milli: number; retail_cents: number }>(
    `SELECT id, size_milli, retail_cents FROM items WHERE retail_cents > 0 ORDER BY id LIMIT 1`,
  );
  assert.ok(row, "the seed should contain a priced item");
  return row!;
}

const ITEM = sellableItem();

/** Plenty of stock, so nothing here fails for a reason we are not testing. */
run(
  `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id) VALUES (?, ?, 'opening', ?)`,
  ITEM.id,
  10_000 * ITEM.size_milli,
  OWNER,
);

function customer(name: string) {
  const res = run(
    `INSERT INTO customers (name, phone, kind, credit_limit_cents)
     VALUES (?, '254700000001', 'wholesale', 100000000)`,
    name,
  );
  return Number(res.lastInsertRowid);
}

let uuid = 0;
/** A wholesale bill for `total`, of which `paid` was tendered. */
function bill(customerId: number | null, total: number, paid: number) {
  return recordSale({
    clientUuid: `list-${++uuid}`,
    userId: OWNER,
    tier: "wholesale",
    customerId,
    // One kilogram at whatever the bill is meant to come to. These tests are
    // about invoices and debts, not about pricing, so the line is the smallest
    // shape that produces an exact total.
    lines: [{ itemId: ITEM.id, units: 1, qtyMilli: 1000, unitPriceCents: total }],
    tenders: paid > 0 ? [{ method: "cash", amountCents: paid }] : [],
    floorOverrideBy: OWNER,
  });
}

const OWES_HALF = customer("Half Paid Traders");
const OWES_NONE = customer("Settled Stores");
const VOIDED = customer("Cancelled Chemicals");

const half = bill(OWES_HALF, 100_000, 40_000);
bill(OWES_NONE, 50_000, 50_000);
const scrapped = bill(VOIDED, 80_000, 0);
voidSale(scrapped.saleId, OWNER, "keyed twice");

test("a part-paid invoice is owing, not voided", () => {
  const { rows } = wholesaleInvoices({ state: "owing" });
  const row = rows.find((r) => r.id === half.saleId);
  assert.ok(row, "a bill with a balance belongs under Owing");
  assert.equal(row!.status, "completed", "the status word is 'completed', not 'complete'");
  assert.equal(row!.total_cents - row!.paid_cents, 60_000);

  const paid = wholesaleInvoices({ state: "paid" }).rows;
  assert.equal(paid.some((r) => r.id === half.saleId), false, "part paid is not paid");

  const voided = wholesaleInvoices({ state: "voided" }).rows;
  assert.equal(
    voided.some((r) => r.id === half.saleId),
    false,
    "an unpaid bill must never be reported as voided — this was the bug",
  );
  assert.equal(voided.some((r) => r.id === scrapped.saleId), true, "the voided one is voided");
});

test("the totals count the whole book and read a real number", () => {
  const t = wholesaleInvoiceTotals();
  assert.equal(t.count, 2, "voided bills are not part of the book");
  assert.equal(t.billed, 150_000);
  assert.equal(t.owed, 60_000, "only the shortfall, and only from live bills");
  assert.equal(t.owingCount, 1);
  assert.ok(t.billed > 0, "the stats used to read zero because of the status typo");
});

test("what the invoice list says is owed is what the customer list says is owed", () => {
  const perInvoice = wholesaleInvoiceTotals().owed;
  const perCustomer = wholesaleCustomers({ state: "owing" }).rows.reduce(
    (s, c) => s + c.balance_cents,
    0,
  );
  const perDebtor = debtors().reduce((s, d) => s + d.balance_cents, 0);

  assert.equal(perCustomer, perInvoice, "the two halves of the same money must agree");
  assert.equal(
    perDebtor,
    perInvoice,
    "and both must agree with the ageing book the overview reads",
  );
});

test("a voided bill leaves nobody owing", () => {
  const owing = wholesaleCustomers({ state: "owing" }).rows.map((c) => c.id);
  assert.equal(owing.includes(VOIDED), false, "cancelling a bill cancels the debt");
  assert.equal(owing.includes(OWES_NONE), false, "a settled customer is not a debtor");
  assert.deepEqual(owing, [OWES_HALF]);

  const row = wholesaleCustomers({ q: "Half Paid" }).rows[0];
  assert.equal(row.balance_cents, 60_000);
  assert.equal(row.open_sales, 1, "one bill still short of its total");
  assert.ok(row.oldest_at, "and a date to age it from");
});

test("search finds a customer by name and an invoice by its number", () => {
  assert.equal(wholesaleCustomers({ q: "Settled" }).total, 1);
  assert.equal(wholesaleCustomers({ q: "254700000001" }).total >= 3, true, "phone matches too");
  assert.equal(wholesaleCustomers({ q: "no such person" }).total, 0);

  assert.equal(
    wholesaleInvoices({ q: String(half.saleId) }).rows[0]?.id,
    half.saleId,
    "typing the bare id finds the bill",
  );
  assert.equal(wholesaleInvoices({ q: "Half Paid Traders" }).total, 1, "or the customer's name");
});

test("the counts on the filter chips match the lists they open", () => {
  const counts = customerStateCounts();
  assert.equal(counts.owing, wholesaleCustomers({ state: "owing" }).total);
  assert.equal(counts.clear, wholesaleCustomers({ state: "clear" }).total);
  assert.equal(counts.wholesale, wholesaleCustomers({ state: "wholesale" }).total);
  assert.equal(counts.all, counts.owing + counts.clear);
});

test("paging asks the database for one page and knows how many there are", () => {
  const spare = customer("Bulk Order Depot");
  for (let i = 0; i < PAGE_SIZE + 3; i++) bill(spare, 1_000, 1_000);

  const first = wholesaleInvoices({ page: 1 });
  assert.equal(first.rows.length, PAGE_SIZE, "a full page, not the whole table");
  assert.ok(first.pages >= 2);
  assert.equal(first.total, wholesaleInvoices({ page: 2 }).total, "the count is stable");

  const second = wholesaleInvoices({ page: 2 });
  assert.equal(second.page, 2);
  const overlap = second.rows.filter((r) => first.rows.some((f) => f.id === r.id));
  assert.deepEqual(overlap, [], "pages must not repeat rows");

  // Somebody will edit the number in the address bar, or land on page 9 of a
  // list that shrank. Clamping beats an empty screen with no explanation.
  const beyond = wholesaleInvoices({ page: 9_999 });
  assert.equal(beyond.page, beyond.pages);
  assert.ok(beyond.rows.length > 0);
});
