import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkRows, _limits } from "../src/server/d1-limits";

// An invoice line row as built in saveInvoiceAction — 11 explicit columns.
const invoiceLineRow = (i: number) => ({
  invoiceId: "inv-1",
  itemId: null as string | null,
  title: `Item ${i}`,
  description: "",
  quantityMilli: 1000,
  unitPrice: 15000,
  taxRateBps: 0,
  lineSubtotal: 15000,
  taxAmount: 0,
  lineTotal: 15000,
  sortOrder: i,
});

test("empty input produces no chunks", () => {
  assert.deepEqual(chunkRows([]), []);
});

test("no chunk ever exceeds D1's bound-variable ceiling", () => {
  for (const n of [1, 4, 8, 9, 10, 25, 100, 500]) {
    const rows = Array.from({ length: n }, (_, i) => invoiceLineRow(i));
    const chunks = chunkRows(rows);
    // every row survives, order preserved
    assert.deepEqual(chunks.flat(), rows);
    for (const chunk of chunks) {
      const vars = chunk.length * (Object.keys(chunk[0]).length + _limits.GENERATED_COLUMNS);
      assert.ok(
        vars < _limits.D1_MAX_VARIABLES,
        `chunk of ${chunk.length} rows binds ${vars} variables (n=${n})`,
      );
    }
  }
});

test("the 9-line regression case (D1 rejected 9 × 12 = 108 variables) is split", () => {
  const rows = Array.from({ length: 9 }, (_, i) => invoiceLineRow(i));
  const chunks = chunkRows(rows);
  assert.ok(chunks.length > 1, "9 invoice lines must span multiple INSERTs");
});

test("very wide rows still chunk to at least one row each", () => {
  const wide = Array.from({ length: 3 }, (_, i) => {
    const row: Record<string, number> = {};
    for (let c = 0; c < 120; c++) row[`col${c}`] = i;
    return row;
  });
  const chunks = chunkRows(wide);
  assert.equal(chunks.length, 3);
});
