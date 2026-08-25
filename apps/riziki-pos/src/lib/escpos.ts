/**
 * ESC/POS receipt generation — the byte stream, and nothing else.
 *
 * The counter prints to a cheap 58 mm or 80 mm Bluetooth thermal printer, the
 * kind sold in every Nairobi electronics shop. Those printers understand one
 * dialect only: ESC/POS control bytes followed by single-byte characters from
 * whatever code page happens to be loaded. So:
 *
 *  1. **Everything here is pure.** No `navigator`, no `next/*`, no database.
 *     The whole layout can therefore be asserted under plain Node, which is the
 *     only way to be sure a receipt is right when there is no printer in the
 *     room. The hardware half lives in `components/thermal-print.tsx` and does
 *     nothing but hand these bytes to a Bluetooth characteristic.
 *
 *  2. **Everything is folded to 7-bit ASCII.** The app is full of typographic
 *     characters — en dashes, "·", "₂", curly quotes — and a printer loaded with
 *     CP437 renders those as ═, ·, or nothing at all. Folding once, centrally,
 *     is cheaper than remembering at each call site.
 *
 *  3. **The layout is monospace arithmetic.** A thermal head prints a fixed
 *     number of characters per line (32 at 58 mm, 48 at 80 mm), so a money
 *     column lines up if — and only if — we pad it ourselves. Amounts are
 *     right-aligned to the full line width, which is what makes every figure on
 *     the receipt end in the same column.
 */

import { formatAmount } from "./units.ts";

// --------------------------------------------------------------- paper

export type PaperWidth = 58 | 80;

/**
 * Characters per line in the default font A. These are the printer's own
 * numbers, not a preference: 58 mm paper is 384 dots wide and font A is 12 dots,
 * giving 32; 80 mm is 576 dots, giving 48.
 */
export const CHARS_PER_LINE: Record<PaperWidth, number> = { 58: 32, 80: 48 };

export const PAPER_WIDTHS: PaperWidth[] = [58, 80];

export function charsPerLine(paper: PaperWidth = 58): number {
  return CHARS_PER_LINE[paper] ?? CHARS_PER_LINE[58];
}

export function isPaperWidth(value: unknown): value is PaperWidth {
  return value === 58 || value === 80;
}

// ------------------------------------------------------------ commands

const ESC = 0x1b;
const GS = 0x1d;
const DLE = 0x10;
const EOT = 0x04;
const LF = 0x0a;

/**
 * The command vocabulary, kept in one place so the byte values can be read
 * against the ESC/POS manual rather than hunted through the layout code.
 */
export const CMD = {
  /** ESC @ — reset. Clears any bold/size/alignment the last job left behind. */
  init: [ESC, 0x40],
  /** ESC t 0 — select code page 437. Our text is ASCII, but a printer left on
   *  a Chinese code page will still mangle it, so the page is stated. */
  codepageCP437: [ESC, 0x74, 0x00],
  /** ESC t 2 — CP850. Offered for printers whose firmware ignores 437. */
  codepageCP850: [ESC, 0x74, 0x02],
  alignLeft: [ESC, 0x61, 0x00],
  alignCenter: [ESC, 0x61, 0x01],
  alignRight: [ESC, 0x61, 0x02],
  boldOn: [ESC, 0x45, 0x01],
  boldOff: [ESC, 0x45, 0x00],
  /** GS ! 0x01 — double height only. Doubling the *width* too would halve the
   *  characters per line and break the money column, so it never is. */
  tallOn: [GS, 0x21, 0x01],
  tallOff: [GS, 0x21, 0x00],
  /** GS V 66 0 — feed and partial cut, the mode every cheap cutter supports. */
  cut: [GS, 0x56, 0x42, 0x00],
  /** DLE EOT 4 — real-time paper sensor status. Answered on the read
   *  characteristic when the printer has one. */
  paperStatus: [DLE, EOT, 0x04],
} as const;

/** ESC d n — print buffer and feed n lines. */
export function feed(lines: number): number[] {
  return [ESC, 0x64, Math.max(0, Math.min(255, Math.trunc(lines)))];
}

/**
 * ESC p m t1 t2 — kick the cash drawer on pin 2.
 *
 * 50 ms on / 50 ms off drives every till drawer the shop is likely to buy, and
 * keeps both timing bytes below 0x80 so nothing in the transport can mistake
 * them for a stray high byte.
 */
export function drawerKick(): number[] {
  return [ESC, 0x70, 0x00, 0x19, 0x19];
}

/** Paper-out bits of the DLE EOT 4 status byte (bit 5 or 6 set = no paper). */
export function isPaperOut(status: number): boolean {
  return (status & 0b0110_0000) !== 0;
}

// ---------------------------------------------------------------- text

/**
 * Characters a cheap printer cannot render, and what to print instead.
 * NFKD already handles the decomposable ones ("₂" -> "2", "…" -> "..."), so this
 * table only carries what Unicode does not decompose for us.
 */
const FOLD: Record<string, string> = {
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-", // en dash — used all over the app's labels
  "—": "-",
  "―": "-",
  "−": "-",
  "·": "-", // middle dot, the app's separator
  "•": "*",
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "«": '"',
  "»": '"',
  "×": "x",
  "÷": "/",
  "⁄": "/",
  "±": "+/-",
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "→": "->",
  "←": "<-",
  "°": " deg",
  "™": "(TM)",
  "®": "(R)",
  "©": "(C)",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "\u00a0": " ", // non-breaking space
  "\u2007": " ", // figure space
  "\u2009": " ", // thin space
  "\u202f": " ", // narrow no-break space
  "\u200b": "",  // zero-width space
  "\ufeff": "",  // byte-order mark, pasted in from Word now and then
  "ß": "ss",
  "æ": "ae",
  "Æ": "AE",
  "ø": "o",
  "Ø": "O",
  "þ": "th",
  "ð": "d",
  "đ": "d",
  "ª": "a",
  "º": "o",
};

/**
 * Fold arbitrary text down to printable 7-bit ASCII.
 *
 * NFKD first, so accented letters split into a base letter plus a combining
 * mark we can drop ("Ngũgĩ" -> "Ngugi") and compatibility forms collapse. What
 * survives is either mapped, or replaced with "?" — a visible question mark is
 * a far better receipt than a random box glyph, because the attendant can see
 * something is wrong and retype the name.
 */
export function toAscii(text: string): string {
  let out = "";
  for (const ch of String(text ?? "").normalize("NFKD")) {
    if (ch >= " " && ch <= "~") {
      out += ch;
      continue;
    }
    if (ch === "\n") {
      out += "\n";
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code === 0x09) {
      out += " ";
      continue;
    }
    if (code >= 0x0300 && code <= 0x036f) continue; // combining marks left by NFKD
    const mapped = FOLD[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    if (code < 0x20 || code === 0x7f) continue; // control bytes never reach the head
    out += "?";
  }
  return out;
}

/**
 * Word wrap. A repacked product name ("Ungerol Liquid Detergent 20 kg jerrican")
 * is routinely longer than 32 characters, and a receipt that truncates it mid
 * word is a receipt the customer cannot check.
 */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  const w = Math.max(1, Math.trunc(width));

  for (const paragraph of String(text ?? "").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= w) line += " " + word;
      else {
        out.push(line);
        line = word;
      }
      // Only a single unbreakable word longer than the paper reaches here.
      while (line.length > w) {
        out.push(line.slice(0, w));
        line = line.slice(w);
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * A label on the left and a figure hard against the right margin.
 *
 * When the label is too long to share the line it wraps, and the figure lands
 * on the last wrapped line — so however the name breaks, every amount on the
 * receipt still ends in the same column.
 */
export function twoCol(left: string, right: string, width: number): string[] {
  const w = Math.max(1, Math.trunc(width));
  const r = right ?? "";

  if (r.length >= w) {
    const lines = left ? wrapText(left, w) : [];
    return [...lines, r.slice(-w).padStart(w)];
  }

  const room = w - r.length - 1;
  const parts = left ? wrapText(left, room) : [""];
  const last = parts.pop() ?? "";
  return [...parts, last + r.padStart(w - last.length)];
}

/**
 * Indent wrapped lines. `wrapText` collapses whitespace — that is what makes it
 * wrap sensibly — so the indent is put back afterwards rather than typed into
 * the string, and the width it wrapped at is reduced to match.
 */
export function indent(lines: string[], pad = "  "): string[] {
  return lines.map((l) => pad + l);
}

/** Money on a receipt, from integer cents only. Never a float, never a string. */
export function money(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`receipt money must be integer cents, got ${cents}`);
  }
  return formatAmount(cents);
}

// ------------------------------------------------------------- receipt

export interface ReceiptLine {
  /** `sale_lines.name_snapshot` — what the item was called when it was sold. */
  name: string;
  units: number;
  /** `sale_lines.unit_price_cents`. */
  unitPriceCents: number;
  /** `sale_lines.line_total_cents`. */
  lineTotalCents: number;
  /** Pre-formatted quantity, e.g. "40 kg". Optional. */
  qty?: string | null;
  /**
   * `sale_lines.rate_cents` — the price per kg / L on a weighed line, and the
   * unit it is per. Zero or absent on anything sold whole.
   *
   * A weighed line has no honest "how many": it is one scoop, so printing
   * "1 x 25.00" states a quantity of one and hides the two numbers the customer
   * actually checks — how much they got, and what a kilogram costs.
   */
  rateCents?: number | null;
  rateUnit?: string | null;
}

export interface ReceiptTender {
  label: string;
  amountCents: number;
  /** M-Pesa transaction codes, as recorded against the sale. */
  codes?: string | null;
}

export interface Receipt {
  /** Shop name first, then address / phone / KRA PIN. */
  header: string[];
  /** "RECEIPT" when settled, "INVOICE" when money is still owed. */
  title: string;
  invoiceNo: string;
  /** Already formatted in Africa/Nairobi — this module does no time zone work. */
  dateTime: string;
  customer?: string | null;
  servedBy?: string | null;
  lines: ReceiptLine[];
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  tenders: ReceiptTender[];
  note?: string | null;
  footer?: string | null;
  voided?: boolean;
}

export interface ReceiptOptions {
  paper?: PaperWidth;
  /**
   * Characters per line, overriding the width `paper` would otherwise imply.
   * `paper` means a physical thermal roll — 58 mm and 80 mm are the only two
   * that exist — so a medium with no roll (the PDF export, in `./pdf.ts`) sets
   * this instead of inventing a fictional paper size to get a wider column.
   */
  width?: number;
  /** Pop the till drawer once the receipt is printed. */
  openDrawer?: boolean;
  /** Blank lines fed before the cut, so the tear-off clears the print head. */
  feedLines?: number;
  cut?: boolean;
}

/** One printed line, with the emphasis it carries. */
export interface ReceiptBlock {
  text: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  /** Double height. Width is never doubled — see CMD.tallOn. */
  tall?: boolean;
}

/**
 * Lay the receipt out as text. Exported because it is what the tests assert on
 * and what the settings screen previews: the paper, before it is paper.
 */
export function renderReceipt(receipt: Receipt, opts: ReceiptOptions = {}): ReceiptBlock[] {
  const w = opts.width ?? charsPerLine(opts.paper ?? 58);
  const out: ReceiptBlock[] = [];
  const rule = "-".repeat(w);

  const push = (text: string, style: Omit<ReceiptBlock, "text"> = {}) =>
    out.push({ text: toAscii(text), ...style });
  const pushMany = (lines: string[], style: Omit<ReceiptBlock, "text"> = {}) =>
    lines.forEach((l) => push(l, style));

  // ------------------------------------------------------------- header
  const header = (receipt.header ?? []).map((h) => toAscii(h).trim()).filter(Boolean);
  if (header.length) {
    // The shop name is the one thing read from across a counter, so it is the
    // only double-height text at the top.
    pushMany(wrapText(header[0], w), { align: "center", bold: true, tall: true });
    for (const line of header.slice(1)) pushMany(wrapText(line, w), { align: "center" });
  }

  if (receipt.voided) {
    push("*** VOIDED ***", { align: "center", bold: true });
  }

  push(rule);
  pushMany(twoCol(receipt.title || "RECEIPT", receipt.invoiceNo || "", w), { bold: true });
  if (receipt.dateTime) pushMany(wrapText(receipt.dateTime, w));
  if (receipt.customer) pushMany(wrapText(`To: ${receipt.customer}`, w));
  if (receipt.servedBy) pushMany(wrapText(`Served by: ${receipt.servedBy}`, w));
  push(rule);

  // -------------------------------------------------------------- lines
  if (!receipt.lines.length) {
    push("No items on this sale.");
  }
  for (const line of receipt.lines) {
    pushMany(wrapText(line.name, w));
    // The detail line carries the arithmetic the customer checks — how many, at
    // what price — with the extension hard against the right margin.
    const qty = line.qty ? ` (${toAscii(line.qty)})` : "";
    const detail =
      line.rateCents && line.rateCents > 0 && line.qty
        ? `${toAscii(line.qty)} x ${money(line.rateCents)}/${toAscii(line.rateUnit ?? "")}`.trimEnd()
        : `${line.units} x ${money(line.unitPriceCents)}${qty}`;
    pushMany(indent(twoCol(detail, money(line.lineTotalCents), w - 2)));
  }
  push(rule);

  // ------------------------------------------------------------- totals
  pushMany(twoCol("TOTAL", money(receipt.totalCents), w), { bold: true, tall: true });
  pushMany(twoCol("Paid", money(receipt.paidCents), w));
  pushMany(twoCol(receipt.balanceCents > 0 ? "BALANCE DUE" : "Balance", money(receipt.balanceCents), w), {
    bold: receipt.balanceCents > 0,
  });

  // ------------------------------------------------------------ tenders
  if (receipt.tenders.length) {
    push(rule);
    for (const t of receipt.tenders) {
      pushMany(twoCol(toAscii(t.label), money(t.amountCents), w));
      // The M-Pesa code is what reconciles the statement, so it prints even
      // though it costs a line.
      if (t.codes) pushMany(indent(wrapText(t.codes, w - 2)));
    }
  }

  if (receipt.note) {
    push(rule);
    pushMany(wrapText(receipt.note, w));
  }

  const footer = toAscii(receipt.footer ?? "").trim();
  if (footer) {
    push(rule);
    pushMany(wrapText(footer, w), { align: "center" });
  }

  return out;
}

/** The receipt as plain text — the settings screen's preview, and test fixtures. */
export function receiptText(receipt: Receipt, opts: ReceiptOptions = {}): string {
  return renderReceipt(receipt, opts)
    .map((b) => b.text)
    .join("\n");
}

/**
 * The receipt as ESC/POS bytes: reset, code page, then each block with only the
 * style changes it actually needs, and finally a feed and a cut.
 */
export function receiptBytes(receipt: Receipt, opts: ReceiptOptions = {}): Uint8Array {
  const bytes: number[] = [];
  const put = (cmd: readonly number[]) => bytes.push(...cmd);
  const text = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      // toAscii has already run; this is the belt-and-braces guarantee that no
      // byte above 0x7F ever reaches a printer whose code page we cannot know.
      bytes.push(code > 0x7f ? 0x3f : code);
    }
  };

  put(CMD.init);
  put(CMD.codepageCP437);

  let align: ReceiptBlock["align"] = "left";
  let bold = false;
  let tall = false;

  for (const block of renderReceipt(receipt, opts)) {
    const wantAlign = block.align ?? "left";
    if (wantAlign !== align) {
      put(wantAlign === "center" ? CMD.alignCenter : wantAlign === "right" ? CMD.alignRight : CMD.alignLeft);
      align = wantAlign;
    }
    if (!!block.bold !== bold) {
      bold = !!block.bold;
      put(bold ? CMD.boldOn : CMD.boldOff);
    }
    if (!!block.tall !== tall) {
      tall = !!block.tall;
      put(tall ? CMD.tallOn : CMD.tallOff);
    }
    text(block.text);
    bytes.push(LF);
  }

  // Leave the printer as we found it: the next job may be someone else's.
  if (bold) put(CMD.boldOff);
  if (tall) put(CMD.tallOff);
  if (align !== "left") put(CMD.alignLeft);

  put(feed(opts.feedLines ?? 4));
  if (opts.openDrawer) put(drawerKick());
  if (opts.cut !== false) put(CMD.cut);

  return Uint8Array.from(bytes);
}

// ------------------------------------------------------------ test page

/**
 * The receipt the setup screen prints to prove the whole path works.
 *
 * It deliberately contains a name too long for 58 mm paper and the exact
 * typographic characters the app uses elsewhere — an en dash, a middle dot, a
 * subscript two, curly quotes — so that one test print shows whether wrapping
 * and character folding are behaving on this particular printer.
 */
export function testReceipt(header: string[], footer: string): Receipt {
  return {
    header: header.length ? header : ["Riziki Industrial Chemicals"],
    title: "TEST PRINT",
    invoiceNo: "TEST-0001",
    dateTime: "Test print — not a sale",
    customer: "Walk-in customer",
    servedBy: "Counter",
    lines: [
      {
        name: "Ungerol Liquid Detergent 20 kg jerrican — repack",
        units: 2,
        unitPriceCents: 350000,
        lineTotalCents: 700000,
        qty: "40 kg",
      },
      {
        name: 'Sodium Sulphate "premium" · Na₂SO₄',
        units: 1,
        unitPriceCents: 125050,
        lineTotalCents: 125050,
        qty: "25 kg",
      },
    ],
    totalCents: 825050,
    paidCents: 825050,
    balanceCents: 0,
    tenders: [
      { label: "Cash", amountCents: 500000 },
      { label: "M-Pesa", amountCents: 325050, codes: "TEST0CODE1" },
    ],
    note: "If every amount above ends in the same column, this printer is set up correctly.",
    footer: footer || "Asante sana",
  };
}
