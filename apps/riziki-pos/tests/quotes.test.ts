/**
 * Quotation tests.
 *
 * The thing worth protecting here is the boundary: a quote must be able to do
 * nothing to the business until it becomes a sale, and then must do everything
 * exactly as a sale does. So these tests watch the ledger and the debt as much
 * as they watch the quote.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "riziki-quotes-"));
process.env.RIZIKI_DB = join(TMP, "test.db");

const { all, get, run } = await import("../src/lib/db.ts");
const { seed } = await import("../src/lib/seed.ts");
const { toMilli } = await import("../src/lib/units.ts");
const {
  saveQuote,
  getQuote,
  quoteLines,
  listQuotes,
  setQuoteStatus,
  invoiceQuote,
  invoiceDirect,
  newQuoteNo,
} = await import("../src/lib/quotes.ts");

seed();
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

const OWNER = 1;

function sellableItem() {
  const row = get<{ id: number; size_milli: number; retail_cents: number; floor_cents: number }>(
    `SELECT id, size_milli, retail_cents, floor_cents FROM items WHERE retail_cents > 0 ORDER BY id LIMIT 1`,
  );
  assert.ok(row, "the seed should contain a priced item");
  return row!;
}

function stockUp(itemId: number, units: number, sizeMilli: number) {
  run(
    `INSERT INTO stock_movements (item_id, delta_milli, reason, user_id) VALUES (?, ?, 'opening', ?)`,
    itemId,
    units * sizeMilli,
    OWNER,
  );
}

function customer(name: string) {
  const res = run(
    `INSERT INTO customers (name, phone, kind, credit_limit_cents) VALUES (?, '254700000001', 'wholesale', 100000000)`,
    name,
  );
  return Number(res.lastInsertRowid);
}

const ledgerCount = () => get<{ n: number }>(`SELECT COUNT(*) AS n FROM stock_movements`)!.n;

test("a quote moves no stock and creates no debt", () => {
  const item = sellableItem();
  const before = ledgerCount();

  const { quoteId } = saveQuote({
    customerId: null,
    customerName: "Mama Njeri Hardware",
    note: "Collecting Friday",
    validUntil: "2026-12-31",
    lines: [{ itemId: item.id, units: 4, unitPriceCents: 50_000 }],
    userId: OWNER,
  });

  assert.equal(ledgerCount(), before, "quoting must not touch the stock ledger");
  assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM sales`)!.n, 0, "no sale yet");

  const q = getQuote(quoteId)!;
  assert.equal(q.status, "draft");
  assert.equal(q.total_cents, 4 * 50_000, "the total is derived from the lines");
  assert.equal(q.line_count, 1);
});

test("editing a quote replaces its lines rather than adding to them", () => {
  const item = sellableItem();
  const { quoteId } = saveQuote({
    customerId: null,
    customerName: "Kariuki Stores",
    note: "",
    validUntil: "",
    lines: [{ itemId: item.id, units: 2, unitPriceCents: 10_000 }],
    userId: OWNER,
  });

  saveQuote({
    quoteId,
    customerId: null,
    customerName: "Kariuki Stores",
    note: "haggled",
    validUntil: "",
    lines: [{ itemId: item.id, units: 3, unitPriceCents: 9_000 }],
    userId: OWNER,
  });

  const lines = quoteLines(quoteId);
  assert.equal(lines.length, 1, "the old line must not survive alongside the new one");
  assert.equal(lines[0].units, 3);
  assert.equal(lines[0].unit_price_cents, 9_000);
  assert.equal(getQuote(quoteId)!.quote_no.startsWith("QT-"), true, "the number is kept on edit");
});

test("a quote cannot be invoiced until the customer has approved it", () => {
  const item = sellableItem();
  const { quoteId } = saveQuote({
    customerId: null,
    customerName: "Walk-in wholesale",
    note: "",
    validUntil: "",
    lines: [{ itemId: item.id, units: 1, unitPriceCents: 1_000 }],
    userId: OWNER,
  });

  assert.throws(
    () => invoiceQuote({ quoteId, userId: OWNER, clientUuid: "uuid-not-approved" }),
    /not approved/i,
    "a draft must not become a bill",
  );

  setQuoteStatus(quoteId, "sent", OWNER);
  assert.throws(
    () => invoiceQuote({ quoteId, userId: OWNER, clientUuid: "uuid-still-not" }),
    /not approved/i,
    "sending is not approving",
  );

  setQuoteStatus(quoteId, "declined", OWNER);
  assert.throws(
    () => invoiceQuote({ quoteId, userId: OWNER, clientUuid: "uuid-declined" }),
    /declined/i,
  );
});

test("approving and invoicing writes an ordinary sale, on credit by default", () => {
  const item = sellableItem();
  stockUp(item.id, 10, item.size_milli);
  const buyerId = customer("Wholesale Buyer Ltd");

  const { quoteId } = saveQuote({
    customerId: buyerId,
    customerName: "Wholesale Buyer Ltd",
    note: "4 drums",
    validUntil: "",
    lines: [{ itemId: item.id, units: 4, unitPriceCents: item.retail_cents }],
    userId: OWNER,
  });
  setQuoteStatus(quoteId, "approved", OWNER);

  const before = ledgerCount();
  const res = invoiceQuote({ quoteId, userId: OWNER, clientUuid: "uuid-invoice-1" });

  assert.ok(res.saleId > 0, "an invoice is a sale");
  assert.equal(res.totalCents, 4 * item.retail_cents);
  assert.equal(res.paidCents, 0, "nothing tendered means the whole bill is on account");
  assert.equal(res.outstandingCents, 4 * item.retail_cents);
  assert.ok(ledgerCount() > before, "now — and only now — the stock moves");

  const sale = get<{ tier: string; customer_id: number; note: string }>(
    `SELECT tier, customer_id, note FROM sales WHERE id = ?`, res.saleId)!;
  assert.equal(sale.tier, "wholesale");
  assert.equal(sale.customer_id, buyerId);
  assert.match(sale.note, /^Quote QT-/, "the sale carries its quote number");

  const q = getQuote(quoteId)!;
  assert.equal(q.status, "invoiced");
  assert.equal(q.sale_id, res.saleId);
});

test("an invoiced quote cannot be invoiced or edited again", () => {
  const item = sellableItem();
  stockUp(item.id, 10, item.size_milli);
  const { quoteId } = saveQuote({
    customerId: customer("Twice Ltd"),
    customerName: "Twice Ltd",
    note: "",
    validUntil: "",
    lines: [{ itemId: item.id, units: 1, unitPriceCents: item.retail_cents }],
    userId: OWNER,
  });
  setQuoteStatus(quoteId, "approved", OWNER);
  invoiceQuote({ quoteId, userId: OWNER, clientUuid: "uuid-once" });

  assert.throws(
    () => invoiceQuote({ quoteId, userId: OWNER, clientUuid: "uuid-twice" }),
    /already been invoiced/i,
    "the same goods must not be billed twice",
  );
  assert.throws(
    () => saveQuote({
      quoteId,
      customerId: null,
      customerName: "Twice Ltd",
      note: "sneaky edit",
      validUntil: "",
      lines: [{ itemId: item.id, units: 99, unitPriceCents: 1 }],
      userId: OWNER,
    }),
    /already become an invoice/i,
    "history is not edited here",
  );
});

test("part payment at invoice time leaves the rest owing", () => {
  const item = sellableItem();
  stockUp(item.id, 10, item.size_milli);
  const buyerId = customer("Part Payer");

  const { quoteId } = saveQuote({
    customerId: buyerId,
    customerName: "Part Payer",
    note: "",
    validUntil: "",
    lines: [{ itemId: item.id, units: 2, unitPriceCents: item.retail_cents }],
    userId: OWNER,
  });
  setQuoteStatus(quoteId, "approved", OWNER);

  const res = invoiceQuote({
    quoteId,
    userId: OWNER,
    clientUuid: "uuid-part",
    tenders: [
      { method: "cash", amountCents: 20_000 },
      { method: "credit", amountCents: 2 * item.retail_cents - 20_000 },
    ],
  });

  const total = 2 * item.retail_cents;
  assert.equal(res.totalCents, total);
  assert.equal(res.paidCents, 20_000);
  assert.equal(res.outstandingCents, total - 20_000, "the balance is what the debtors list will show");
});

test("the working list is the quotes still waiting on somebody", () => {
  const open = listQuotes("open");
  assert.ok(open.length > 0);
  assert.ok(
    open.every((q) => ["draft", "sent", "approved"].includes(q.status)),
    "invoiced and declined quotes are finished business",
  );
});

test("quote numbers are readable and do not collide within a day", () => {
  const a = newQuoteNo(new Date("2026-08-21T09:00:00Z"));
  assert.match(a, /^QT-20260821-\d+$/);
  const item = sellableItem();
  saveQuote({
    customerId: null, customerName: "Numbering", note: "", validUntil: "",
    lines: [{ itemId: item.id, units: 1, unitPriceCents: 100 }], userId: OWNER,
  });
  const nos = all<{ quote_no: string }>(`SELECT quote_no FROM quotes`).map((r) => r.quote_no);
  assert.equal(new Set(nos).size, nos.length, "every quote number is unique");
});

test("a quote haggled below the floor still invoices, and says who allowed it", () => {
  const item = sellableItem();
  stockUp(item.id, 10, item.size_milli);
  const buyerId = customer("Hard Bargainer");
  const cheeky = Math.max(1, Math.floor(item.floor_cents / 2));

  const { quoteId } = saveQuote({
    customerId: buyerId,
    customerName: "Hard Bargainer",
    note: "",
    validUntil: "",
    lines: [{ itemId: item.id, units: 1, unitPriceCents: cheeky }],
    userId: OWNER,
  });
  setQuoteStatus(quoteId, "approved", OWNER);

  // Refusing here would strand an approved quote that could never be billed.
  const res = invoiceQuote({ quoteId, userId: OWNER, clientUuid: "uuid-below-floor" });
  assert.equal(res.totalCents, cheeky);

  // recordSale files below-floor lines against 'sale_line', naming the
  // authoriser — which for a quote is whoever pressed Invoice.
  const logged = all<{ action: string; detail: string }>(
    `SELECT action, detail FROM audit_log WHERE entity = 'sale_line' AND entity_id = ?`, res.saleId);
  assert.ok(
    logged.some((r) => r.action === "price_override_below_floor"),
    "a below-floor line must be logged as an override",
  );
  assert.match(logged[0].detail, new RegExp(`authorised by user ${OWNER}`),
    "and must name who allowed it");
});

test("prices can be corrected as the quote becomes an invoice", () => {
  const item = sellableItem();
  stockUp(item.id, 20, item.size_milli);
  const buyerId = customer("Late Collector");

  const { quoteId } = saveQuote({
    customerId: buyerId,
    customerName: "Late Collector",
    note: "",
    validUntil: "",
    lines: [{ itemId: item.id, units: 2, unitPriceCents: item.retail_cents }],
    userId: OWNER,
  });
  setQuoteStatus(quoteId, "approved", OWNER);

  // The drum went up between approval and collection.
  const agreed = item.retail_cents + 5_000;
  const res = invoiceQuote({
    quoteId,
    userId: OWNER,
    clientUuid: "uuid-reprice",
    lines: [{ itemId: item.id, units: 2, unitPriceCents: agreed }],
  });

  assert.equal(res.totalCents, 2 * agreed, "the invoice bills the agreed price");
  assert.equal(
    quoteLines(quoteId)[0].unit_price_cents,
    agreed,
    "and the quote is left saying the same thing, so the two cannot disagree",
  );
});

test("a wholesale customer can be invoiced with no quote at all", () => {
  const item = sellableItem();
  stockUp(item.id, 20, item.size_milli);
  const buyerId = customer("Known Terms Ltd");
  const before = get<{ n: number }>(`SELECT COUNT(*) AS n FROM quotes`)!.n;

  const res = invoiceDirect({
    customerId: buyerId,
    customerName: "Known Terms Ltd",
    note: "Standing order",
    lines: [{ itemId: item.id, units: 3, unitPriceCents: item.retail_cents }],
    userId: OWNER,
    clientUuid: "uuid-direct-1",
  });

  assert.equal(res.totalCents, 3 * item.retail_cents);
  assert.equal(res.outstandingCents, 3 * item.retail_cents, "on account by default");
  assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM quotes`)!.n, before,
    "billing directly must not invent a quote to hang it on");
  assert.equal(
    get<{ tier: string }>(`SELECT tier FROM sales WHERE id = ?`, res.saleId)!.tier,
    "wholesale",
  );
});

test("a direct invoice is replay-safe, like every other sale", () => {
  const item = sellableItem();
  stockUp(item.id, 20, item.size_milli);
  const args = {
    customerId: customer("Double Tap"),
    customerName: "Double Tap",
    note: "",
    lines: [{ itemId: item.id, units: 1, unitPriceCents: item.retail_cents }],
    userId: OWNER,
    clientUuid: "uuid-double-tap",
  };
  const first = invoiceDirect(args);
  const second = invoiceDirect(args);
  assert.equal(second.saleId, first.saleId, "the same device reference bills once");
});
