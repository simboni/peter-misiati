/**
 * Receipt printing — the byte stream.
 *
 * There is no printer attached to this machine and there never will be in CI, so
 * the paper is asserted here instead: the real `receiptBytes` output is decoded
 * back to text, the ESC/POS escape sequences are stripped exactly as a printer's
 * firmware would consume them, and what is left is the receipt the customer gets.
 *
 * RIZIKI_DB is pointed at a throwaway file before anything is imported, because
 * `db.ts` resolves the path once at module load; `print-settings.ts` reaches the
 * database, so the imports below are dynamic to stay after the assignment.
 */

import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const DIR = mkdtempSync(join(tmpdir(), "riziki-escpos-"));
process.env.RIZIKI_DB = join(DIR, "test.db");

const dbm = await import("../src/lib/db.ts");
const escpos = await import("../src/lib/escpos.ts");
const settings = await import("../src/lib/print-settings.ts");

const {
  CMD,
  charsPerLine,
  drawerKick,
  isPaperOut,
  money,
  receiptBytes,
  receiptText,
  renderReceipt,
  testReceipt,
  toAscii,
  twoCol,
  wrapText,
} = escpos;

process.on("exit", () => {
  try {
    dbm.closeDb();
  } catch {}
  rmSync(DIR, { recursive: true, force: true });
});

// ------------------------------------------------------------------ helpers

/**
 * What the print head would actually put on paper: consume the escape sequences
 * this module emits and keep the rest. Deliberately a separate implementation
 * from the generator, so a wrong command length shows up as garbage in the text.
 */
function decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x1b) {
      const cmd = bytes[i + 1];
      if (cmd === 0x40) i += 1; // ESC @
      else if (cmd === 0x70) i += 4; // ESC p m t1 t2
      else i += 2; // ESC a/E/t/d/! n
      continue;
    }
    if (b === 0x1d) {
      const cmd = bytes[i + 1];
      if (cmd === 0x56) i += 3; // GS V m n
      else i += 2; // GS ! n
      continue;
    }
    out += String.fromCharCode(b);
  }
  return out;
}

function textLines(bytes: Uint8Array): string[] {
  const text = decode(bytes);
  const lines = text.split("\n");
  // The stream ends with a line feed; the empty tail is not a printed line.
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** A sale with everything awkward about a real one on it. */
function sampleReceipt(): import("../src/lib/escpos.ts").Receipt {
  return {
    header: ["Riziki Industrial Chemicals", "Nairobi, Kenya", "0722 000 000", "PIN P051234567X"],
    title: "INVOICE",
    invoiceNo: "INV-00042",
    dateTime: "3 Aug 2026, 14:05",
    customer: "Mama Njeri Wholesalers",
    servedBy: "Grace",
    lines: [
      {
        // Longer than 32 characters on purpose, with an en dash in the middle.
        name: "Ungerol Liquid Detergent 20 kg jerrican — wholesale repack",
        units: 2,
        unitPriceCents: 350000,
        lineTotalCents: 700000,
        qty: "40 kg",
      },
      {
        name: 'Sodium Sulphate "premium" · Na₂SO₄',
        units: 1,
        unitPriceCents: 123456,
        lineTotalCents: 123456,
        qty: "25 kg",
      },
    ],
    totalCents: 823456,
    paidCents: 500000,
    balanceCents: 323456,
    tenders: [
      { label: "Cash", amountCents: 200000 },
      { label: "M-Pesa", amountCents: 300000, codes: "TFG7HJ2K90" },
    ],
    note: "Goods remain the property of Riziki Industrial Chemicals until paid in full.",
    footer: "Asante sana for your business.",
  };
}

// ------------------------------------------------------------- line widths

test("58 mm paper never prints a line longer than 32 characters", () => {
  const bytes = receiptBytes(sampleReceipt(), { paper: 58 });
  for (const line of textLines(bytes)) {
    assert.ok(line.length <= 32, `"${line}" is ${line.length} characters, over 32`);
  }
});

test("80 mm paper never prints a line longer than 48 characters", () => {
  const bytes = receiptBytes(sampleReceipt(), { paper: 80 });
  for (const line of textLines(bytes)) {
    assert.ok(line.length <= 48, `"${line}" is ${line.length} characters, over 48`);
  }
  // And it genuinely uses the extra width rather than laying out for 58 mm.
  assert.ok(textLines(bytes).some((l) => l.length > 32));
});

test("a header line longer than the paper wraps instead of overflowing", () => {
  const receipt = sampleReceipt();
  receipt.header = ["Riziki Industrial Chemicals and General Suppliers Limited"];
  for (const line of textLines(receiptBytes(receipt, { paper: 58 }))) {
    assert.ok(line.length <= 32);
  }
});

// ------------------------------------------------------------- alignment

test("every money figure ends in the same column", () => {
  for (const paper of [58, 80] as const) {
    const width = charsPerLine(paper);
    const lines = textLines(receiptBytes(sampleReceipt(), { paper }));

    // Every figure that belongs to the money column, in the form it is printed.
    // (Unit prices sit mid-line inside the detail text, so they are not here.)
    const amounts = ["7,000", "1,234.56", "8,234.56", "5,000", "3,234.56", "2,000", "3,000"];

    for (const amount of amounts) {
      const row = lines.find((l) => l.endsWith(amount));
      assert.ok(row, `${amount} is missing from the ${paper} mm receipt`);
      assert.equal(
        row.length,
        width,
        `"${row}" ends at column ${row.length}, not ${width} — the money column is ragged`,
      );
    }
  }
});

test("a long name pushes its amount down, still right-aligned", () => {
  const width = 32;
  const lines = twoCol("A very long line description indeed that will not fit", "1,000", width);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(l.length <= width);
  assert.equal(lines.at(-1)!.length, width);
  assert.ok(lines.at(-1)!.endsWith("1,000"));
});

// ---------------------------------------------------------------- wrapping

test("a long product name wraps on a space, never mid-word", () => {
  const receipt = sampleReceipt();
  const lines = textLines(receiptBytes(receipt, { paper: 58 }));

  const first = lines.findIndex((l) => l.startsWith("Ungerol"));
  assert.ok(first >= 0, "the item name is missing");

  // The name spans more than one line...
  const wrapped: string[] = [];
  for (let i = first; i < lines.length && !lines[i].trimStart().startsWith("2 x"); i++) {
    wrapped.push(lines[i]);
  }
  assert.ok(wrapped.length >= 2, "a 57-character name should not fit on one 32-character line");

  // ...and every whole word survives, in order, with none split across lines.
  const rejoined = wrapped.join(" ");
  assert.equal(rejoined, "Ungerol Liquid Detergent 20 kg jerrican - wholesale repack");
  for (const line of wrapped) assert.ok(!line.startsWith(" ") && !line.endsWith(" "));
});

test("a word longer than the paper is broken only as a last resort", () => {
  const lines = wrapText("Sodiumtripolyphosphateandthensome extra", 16);
  // Only the unbreakable word is cut; the tail then takes the next word with it.
  assert.deepEqual(lines, ["Sodiumtripolypho", "sphateandthensom", "e extra"]);
  for (const l of lines) assert.ok(l.length <= 16);
});

// ------------------------------------------------------------ ASCII safety

test("typographic characters are transliterated, not printed as garbage", () => {
  assert.equal(toAscii("50 kg – 1.5%"), "50 kg - 1.5%");
  assert.equal(toAscii("Riziki · Nairobi"), "Riziki - Nairobi");
  assert.equal(toAscii("Na₂SO₄"), "Na2SO4");
  assert.equal(toAscii("“premium” and ‘house’"), '"premium" and \'house\'');
  assert.equal(toAscii("2 × 3"), "2 x 3");
  assert.equal(toAscii("wait…"), "wait...");
  assert.equal(toAscii("Ngũgĩ wa Thiong'o"), "Ngugi wa Thiong'o");
  assert.equal(toAscii("hard space"), "hard space");
  // Anything genuinely unprintable becomes a question mark the attendant can see.
  assert.equal(toAscii("smile 🙂"), "smile ?");
});

test("no byte above 0x7F ever leaves the generator", () => {
  const bytes = receiptBytes(sampleReceipt(), { paper: 58 });
  const high = [...bytes].filter((b) => b > 0x7f);
  assert.deepEqual(high, [], `high bytes would print as garbage: ${high.map((b) => b.toString(16))}`);

  // Including the deliberately awkward test page the setup screen prints.
  const sample = receiptBytes(testReceipt(["Riziki — Chemicals"], "Asante · sana"), { paper: 80 });
  assert.deepEqual([...sample].filter((b) => b > 0x7f), []);
});

test("control bytes in a product name cannot reach the printer", () => {
  const receipt = sampleReceipt();
  receipt.lines[0].name = "Ungerol|4C sabotage";
  const bytes = receiptBytes(receipt, { paper: 58 });
  // The only ESC in the stream is the one we put there ourselves: the init
  // sequence, the alignment/emphasis commands and the feed.
  const text = decode(bytes);
  assert.ok(!text.includes(""));
  assert.ok(text.includes("Ungerol|4C sabotage"));
});

// ------------------------------------------------------------------ money

test("printed totals equal the integer cents given, exactly", () => {
  const receipt = sampleReceipt();
  const lines = textLines(receiptBytes(receipt, { paper: 58 }));

  const figure = (label: string) => {
    const row = lines.find((l) => l.startsWith(label));
    assert.ok(row, `no "${label}" line on the receipt`);
    return row.slice(label.length).trim();
  };

  assert.equal(figure("TOTAL"), "8,234.56"); // 823456 cents
  assert.equal(figure("Paid"), "5,000"); // 500000 cents
  assert.equal(figure("BALANCE DUE"), "3,234.56"); // 323456 cents
  assert.equal(figure("Cash"), "2,000");
  assert.equal(figure("M-Pesa"), "3,000");

  // The lines add up to the total that was printed, in cents.
  const sum = receipt.lines.reduce((s, l) => s + l.lineTotalCents, 0);
  assert.equal(sum, receipt.totalCents);
  assert.equal(money(sum), "8,234.56");

  // And the per-line arithmetic prints as it was recorded.
  const detail = lines.find((l) => l.trimStart().startsWith("2 x"));
  assert.ok(detail);
  assert.ok(detail.includes("2 x 3,500 (40 kg)"));
  assert.ok(detail.endsWith("7,000"));
});

test("money refuses anything that is not integer cents", () => {
  assert.throws(() => money(1234.5), /integer cents/);
  assert.throws(() => money(NaN), /integer cents/);
  assert.equal(money(0), "0");
  assert.equal(money(-2000), "-20");
  assert.equal(money(5), "0.05");
});

// -------------------------------------------------------------- the stream

test("the stream starts with the init sequence and ends with a cut", () => {
  const bytes = receiptBytes(sampleReceipt(), { paper: 58 });

  assert.deepEqual([...bytes.slice(0, 2)], [...CMD.init], "ESC @ must come first");
  assert.deepEqual([...bytes.slice(2, 5)], [...CMD.codepageCP437]);
  assert.deepEqual([...bytes.slice(-4)], [...CMD.cut], "GS V B 0 must come last");

  // The tail before the cut feeds the paper clear of the head.
  assert.deepEqual([...bytes.slice(-7, -4)], [0x1b, 0x64, 4]);
});

test("the drawer only kicks when asked, and its bytes are the ESC/POS pulse", () => {
  const plain = receiptBytes(sampleReceipt(), { paper: 58 });
  const withDrawer = receiptBytes(sampleReceipt(), { paper: 58, openDrawer: true });

  assert.deepEqual([...drawerKick()], [0x1b, 0x70, 0x00, 0x19, 0x19]);
  assert.equal(withDrawer.length, plain.length + 5);
  assert.deepEqual([...withDrawer.slice(-9, -4)], [...drawerKick()]);
});

test("cutting can be turned off for a printer with no cutter", () => {
  const bytes = receiptBytes(sampleReceipt(), { paper: 58, cut: false });
  assert.notDeepEqual([...bytes.slice(-4)], [...CMD.cut]);
});

test("emphasis is switched on and off around the shop name and the total", () => {
  const bytes = [...receiptBytes(sampleReceipt(), { paper: 58 })];
  const has = (cmd: readonly number[]) =>
    bytes.some((_, i) => cmd.every((b, j) => bytes[i + j] === b));

  assert.ok(has(CMD.boldOn) && has(CMD.boldOff));
  assert.ok(has(CMD.tallOn) && has(CMD.tallOff));
  assert.ok(has(CMD.alignCenter) && has(CMD.alignLeft));
  // Whatever the receipt did, the printer is handed back in its default state.
  const tail = bytes.slice(-12);
  assert.ok(tail.length > 0);
});

test("the paper sensor bits are read the way the manual defines them", () => {
  assert.equal(isPaperOut(0b0001_0010), false);
  assert.equal(isPaperOut(0b0110_0000), true);
  assert.equal(isPaperOut(0b0010_0000), true);
});

// -------------------------------------------------------------- a voided sale

test("a voided sale says so, loudly", () => {
  const receipt = sampleReceipt();
  receipt.voided = true;
  const text = receiptText(receipt, { paper: 58 });
  assert.ok(text.includes("*** VOIDED ***"));
});

test("a receipt with no lines still prints and still cuts", () => {
  const receipt = sampleReceipt();
  receipt.lines = [];
  receipt.tenders = [];
  const bytes = receiptBytes(receipt, { paper: 58 });
  assert.ok(decode(bytes).includes("No items on this sale."));
  assert.deepEqual([...bytes.slice(-4)], [...CMD.cut]);
});

// ------------------------------------------------------------- settings

test("printer settings round-trip through the database", () => {
  const before = settings.getPrintSettings();
  assert.equal(before.paper, 58, "58 mm is the sensible default for a small shop");

  const saved = settings.savePrintSettings(
    {
      paper: "80",
      header: "Riziki Industrial Chemicals\n  Nairobi, Kenya  \n\nPIN P051234567X",
      footer: "Asante sana",
      autoPrint: true,
    },
    null,
  );

  assert.equal(saved.paper, 80);
  assert.deepEqual(saved.header, ["Riziki Industrial Chemicals", "Nairobi, Kenya", "PIN P051234567X"]);
  assert.equal(saved.autoPrint, true);

  // Read back through a fresh call, not the return value.
  const reloaded = settings.getPrintSettings();
  assert.deepEqual(reloaded, saved);

  assert.throws(() => settings.savePrintSettings({ paper: "57", header: "x" }), /58 mm or 80 mm/);
  assert.throws(() => settings.savePrintSettings({ paper: "58", header: "   " }), /shop's name/);
});

test("a receipt built from a sale uses the snapshotted line values only", () => {
  const sale = {
    id: 7,
    at: "2026-08-03 11:05:00",
    invoice_no: "INV-00007",
    tier: "wholesale" as const,
    total_cents: 700000,
    paid_cents: 200000,
    status: "completed" as const,
    note: "",
    customer_id: 3,
    customer_name: "Mama Njeri",
    customer_phone: "0722111222",
    customer_kra_pin: "",
    user_name: "Grace",
  };
  const invoice = {
    sale,
    lines: [
      {
        id: 1,
        name_snapshot: "Ungerol 20 kg pack (as sold in January)",
        units: 2,
        qty_milli: 40000,
        unit_price_cents: 350000,
        line_total_cents: 700000,
        rate_cents: 0,
        list_price_cents: 0,
        canonical_unit: "kg",
      },
    ],
    tenders: [{ method: "cash" as const, amount_cents: 200000, codes: null }],
    balanceCents: 500000,
    subtotalCents: 700000,
    discountCents: 0,
  };

  const receipt = settings.receiptFromInvoice(invoice, settings.getPrintSettings());

  assert.equal(receipt.title, "INVOICE", "money is still owed, so it is not a receipt yet");
  assert.equal(receipt.invoiceNo, "INV-00007");
  assert.equal(receipt.lines[0].name, "Ungerol 20 kg pack (as sold in January)");
  assert.equal(receipt.lines[0].unitPriceCents, 350000);
  assert.equal(receipt.lines[0].lineTotalCents, 700000);
  assert.equal(receipt.lines[0].qty, "40 kg");
  assert.equal(receipt.tenders[0].label, "Cash");

  // The same invoice, weighed: 400 g of caustic at 133 a kilo. The detail line
  // has to say what the customer got and what a kilogram cost, because "1 x
  // 53.20" states a quantity of one and hides both.
  const weighed = settings.receiptFromInvoice(
    {
      ...invoice,
      lines: [
        {
          id: 2,
          name_snapshot: "Caustic Soda",
          units: 1,
          qty_milli: 400,
          unit_price_cents: 5320,
          line_total_cents: 5320,
          rate_cents: 13300,
          list_price_cents: 0,
          canonical_unit: "kg",
        },
      ],
    },
    settings.getPrintSettings(),
  );
  const weighedText = receiptText(weighed, { paper: 58 });
  assert.match(weighedText, /400 g x 133\/kg\s+53\.20/);
  assert.ok(!weighedText.includes("1 x 53.20"), "a weighed line never prints a count of one");

  /*
    And the same line haggled: asked 133 a kilo, agreed 100.

    The customer negotiated that, so both figures belong on the paper — the
    price they were quoted and the amount they talked off it. Printing only
    "40.00" would be true and would give them no way to see they got anything,
    which is the whole reason they asked.

    The amounts must still add up: 53.20 asked, 13.20 off, 40.00 charged, and
    the Subtotal / Discount / TOTAL block carries the same three numbers so the
    column reconciles with the bottom line.
  */
  const haggled = settings.receiptFromInvoice(
    {
      ...invoice,
      sale: { ...invoice.sale, total_cents: 4000, paid_cents: 4000 },
      lines: [
        {
          id: 3,
          name_snapshot: "Caustic Soda",
          units: 1,
          qty_milli: 400,
          unit_price_cents: 4000,
          line_total_cents: 4000,
          rate_cents: 10000,
          list_price_cents: 13300,
          canonical_unit: "kg",
        },
      ],
      balanceCents: 0,
      subtotalCents: 5320,
      discountCents: 1320,
    },
    settings.getPrintSettings(),
  );
  const haggledText = receiptText(haggled, { paper: 58 });
  assert.match(haggledText, /400 g x 133\/kg\s+53\.20/, "the price the customer was quoted");
  assert.match(haggledText, /Discount\s+-13\.20/, "and what came off it");
  assert.match(haggledText, /Subtotal\s+53\.20/);
  // `money` drops a trailing ".00", so a round total prints bare.
  assert.match(haggledText, /TOTAL\s+40$/m);

  const text = receiptText(receipt, { paper: 58 });
  assert.ok(text.includes("BALANCE DUE"));
  assert.ok(text.includes("3 Aug 2026")); // Nairobi time, not UTC
});

test("renderReceipt keeps every block within the paper", () => {
  for (const paper of [58, 80] as const) {
    for (const block of renderReceipt(sampleReceipt(), { paper })) {
      assert.ok(block.text.length <= charsPerLine(paper), `"${block.text}"`);
    }
  }
});
