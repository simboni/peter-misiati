import { test } from "node:test";
import assert from "node:assert/strict";
import { calcTotals, deriveInvoiceStatus } from "../src/server/totals.ts";
import {
  formatAmount,
  parseAmount,
  allocateProportional,
  parseQty,
  parseRate,
} from "../src/server/money.ts";
import { formatDocNumber } from "../src/server/numbering.ts";

test("formatAmount / parseAmount round-trip", () => {
  assert.equal(formatAmount(123456), "1,234.56");
  assert.equal(formatAmount(0), "0.00");
  assert.equal(formatAmount(5), "0.05");
  assert.equal(formatAmount(-2500), "-25.00");
  assert.equal(parseAmount("1,234.56"), 123456);
  assert.equal(parseAmount("1234.5"), 123450);
  assert.equal(parseAmount("KES 10"), 1000);
  assert.equal(parseAmount(""), 0);
});

test("single line, 16% VAT", () => {
  const t = calcTotals({
    lines: [{ quantityMilli: 1000, unitPrice: 100000, taxRateBps: 1600 }],
  });
  assert.equal(t.subtotal, 100000); // 1000.00
  assert.equal(t.taxTotal, 16000); // 160.00
  assert.equal(t.total, 116000); // 1160.00
  assert.equal(t.discountAmount, 0);
});

test("fractional quantity (2.5 hrs @ 800.00)", () => {
  const t = calcTotals({
    lines: [{ quantityMilli: 2500, unitPrice: 80000, taxRateBps: 1600 }],
  });
  assert.equal(t.subtotal, 200000); // 2.5 * 800 = 2000.00
  assert.equal(t.taxTotal, 32000);
  assert.equal(t.total, 232000);
});

test("50% deposit on a VAT invoice", () => {
  const t = calcTotals({
    lines: [{ quantityMilli: 1000, unitPrice: 100000, taxRateBps: 1600 }],
    depositType: "percent",
    depositValue: 5000, // 50.00%
  });
  assert.equal(t.total, 116000);
  assert.equal(t.depositAmount, 58000); // half of 1160.00
});

test("mixed standard + exempt lines with a 10% discount reconcile exactly", () => {
  const t = calcTotals({
    lines: [
      { quantityMilli: 1000, unitPrice: 100000, taxRateBps: 1600 }, // taxable
      { quantityMilli: 1000, unitPrice: 50000, taxRateBps: 0 }, // exempt
    ],
    discountType: "percent",
    discountValue: 1000, // 10.00%
  });
  assert.equal(t.subtotal, 150000);
  assert.equal(t.discountAmount, 15000);
  // discount split 100000:50000 => 10000 and 5000
  assert.equal(t.lines[0].discountAllocated, 10000);
  assert.equal(t.lines[1].discountAllocated, 5000);
  // VAT only on discounted taxable line: (100000-10000)*16% = 14400
  assert.equal(t.taxTotal, 14400);
  assert.equal(t.total, 150000 - 15000 + 14400);
  // invariant: subtotal - discount + tax == total
  assert.equal(t.total, t.subtotal - t.discountAmount + t.taxTotal);
});

test("allocateProportional sums exactly to total (no drift)", () => {
  const parts = allocateProportional(100, [1, 1, 1]); // 33.33 each
  assert.equal(parts.reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(parts.sort(), [33, 33, 34]);
});

test("deriveInvoiceStatus deposit -> balance flow", () => {
  const total = 116000;
  assert.equal(
    deriveInvoiceStatus({ type: "invoice", currentStatus: "sent", total, amountPaid: 0 }),
    "sent",
  );
  assert.equal(
    deriveInvoiceStatus({ type: "invoice", currentStatus: "sent", total, amountPaid: 58000 }),
    "partial",
  );
  assert.equal(
    deriveInvoiceStatus({ type: "invoice", currentStatus: "partial", total, amountPaid: 116000 }),
    "paid",
  );
});

test("overdue when unpaid past due date", () => {
  const past = new Date("2020-01-01");
  assert.equal(
    deriveInvoiceStatus({
      type: "invoice",
      currentStatus: "sent",
      total: 1000,
      amountPaid: 0,
      dueDate: past,
    }),
    "overdue",
  );
});

test("numbering + qty/rate parsers", () => {
  assert.equal(formatDocNumber("INV-", 7), "INV-0007");
  assert.equal(formatDocNumber("RCP-", 123, 5), "RCP-00123");
  assert.equal(parseQty("2.5"), 2500);
  assert.equal(parseRate("16"), 1600);
});
