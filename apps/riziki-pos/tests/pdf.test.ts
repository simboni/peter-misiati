/**
 * The hand-rolled PDF writer, tested for exact byte structure.
 *
 * No PDF parser is available under plain Node, so these tests assert the
 * invariants a reader actually depends on: the header and trailer markers, an
 * xref whose entries are exactly 20 bytes and whose count matches the objects
 * written, and offsets that genuinely point at `N 0 obj` for every object.
 * Anything wrong here is the class of bug a viewer reports as "damaged file"
 * with nothing more to go on — so this checks harder than "it didn't throw".
 */

import test from "node:test";
import assert from "node:assert/strict";

const { receiptToPdf, blocksToPdf, pdfCharsPerLine } = await import("../src/lib/pdf.ts");
const escpos = await import("../src/lib/escpos.ts");

const decoder = new TextDecoder("latin1");

function asText(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Parses just enough of the file to check it against its own claims. */
function structuralCheck(bytes: Uint8Array) {
  const text = asText(bytes);

  assert.ok(text.startsWith("%PDF-1.4\n"), "must open with the PDF header");
  assert.ok(text.trimEnd().endsWith("%%EOF"), "must close with %%EOF");

  const startxrefMatch = text.match(/startxref\n(\d+)\n%%EOF/);
  assert.ok(startxrefMatch, "must have a startxref pointing at %%EOF");
  const xrefOffset = Number(startxrefMatch![1]);
  assert.equal(text.slice(xrefOffset, xrefOffset + 4), "xref", "startxref must point exactly at the xref keyword");

  const sizeMatch = text.match(/\/Size (\d+)/);
  assert.ok(sizeMatch, "trailer must declare /Size");
  const size = Number(sizeMatch![1]);

  // Every entry after the header lines is exactly 20 bytes, per spec.
  const xrefBlock = text.slice(xrefOffset);
  const headerEnd = xrefBlock.indexOf("\n0000000000 65535 f");
  assert.ok(headerEnd > 0, "must have the free-list head entry for object 0");
  const entriesStart = xrefOffset + headerEnd + 1;
  for (let i = 0; i < size; i++) {
    const entry = text.slice(entriesStart + i * 20, entriesStart + i * 20 + 20);
    assert.equal(entry.length, 20, `xref entry ${i} must be exactly 20 bytes`);
    assert.match(entry, /^\d{10} \d{5} [nf]\r\n$/, `xref entry ${i} must match the spec's fixed format`);
  }

  // Object 0 aside, every offset must genuinely point at "<id> 0 obj".
  for (let id = 1; id < size; id++) {
    const entry = text.slice(entriesStart + id * 20, entriesStart + id * 20 + 20);
    if (entry[17] === "f") continue; // a free entry has no offset to check
    const offset = Number(entry.slice(0, 10));
    assert.equal(
      text.slice(offset, offset + `${id} 0 obj`.length),
      `${id} 0 obj`,
      `object ${id}'s xref offset must point at its own "obj" keyword`,
    );
  }

  const rootMatch = text.match(/\/Root (\d+) 0 R/);
  assert.ok(rootMatch, "trailer must name a /Root");
  assert.ok(text.includes(`${rootMatch![1]} 0 obj\n<< /Type /Catalog`), "the root object must be the catalog");
}

test("a short receipt produces one structurally valid PDF page", () => {
  const bytes = receiptToPdf(escpos.testReceipt([], ""));
  structuralCheck(bytes);
  assert.equal((asText(bytes).match(/\/Type \/Page\b/g) ?? []).length, 1);
});

test("every amount from the receipt appears in the PDF's content streams", () => {
  const receipt = escpos.testReceipt([], "");
  const bytes = receiptToPdf(receipt);
  const text = asText(bytes);
  // Each drawn line is one Tj string — a whole padded column, not just the
  // figure — so this checks the substring is present in the file at all,
  // which is what actually matters: the figure was not silently dropped.
  for (const amount of ["7,000", "1,250.50", "8,250.50"]) {
    assert.ok(text.includes(amount), `expected ${amount} to appear as drawn text`);
  }
});

test("a long document paginates, and every page is structurally valid", () => {
  const receipt = {
    ...escpos.testReceipt([], ""),
    lines: Array.from({ length: 60 }, (_, i) => ({
      name: `Line ${i + 1}`,
      units: 1,
      unitPriceCents: 10000,
      lineTotalCents: 10000,
    })),
  };
  const bytes = receiptToPdf(receipt);
  structuralCheck(bytes);
  const pageCount = (asText(bytes).match(/\/Type \/Page\b/g) ?? []).length;
  assert.ok(pageCount > 1, "60 lines must not fit on one A5 page");
  assert.ok(asText(bytes).includes(`Page 1 of ${pageCount}`));
  assert.ok(asText(bytes).includes(`Page ${pageCount} of ${pageCount}`));
});

test("a receipt with no lines still produces a valid, non-empty PDF", () => {
  const bytes = receiptToPdf({ ...escpos.testReceipt([], ""), lines: [] });
  structuralCheck(bytes);
  assert.ok(asText(bytes).includes("No items on this sale."));
});

test("parentheses and backslashes in a name do not break the PDF syntax", () => {
  const receipt = {
    ...escpos.testReceipt([], ""),
    lines: [
      { name: 'Odd (name) with a \\ in it', units: 1, unitPriceCents: 100, lineTotalCents: 100 },
    ],
  };
  const bytes = receiptToPdf(receipt);
  structuralCheck(bytes);
  assert.ok(asText(bytes).includes("Odd \\(name\\) with a \\\\ in it"));
});

test("blocksToPdf renders arbitrary ReceiptBlocks (the statement's own layout)", () => {
  const bytes = blocksToPdf([
    { text: "Statement of account", align: "center", bold: true, tall: true },
    { text: "-".repeat(pdfCharsPerLine()) },
    { text: "6 Aug 2026    RZK-INV-1              KES 1,000".padEnd(pdfCharsPerLine()) },
  ]);
  structuralCheck(bytes);
  assert.ok(asText(bytes).includes("Statement of account"));
});
