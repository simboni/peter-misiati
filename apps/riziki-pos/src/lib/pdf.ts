/**
 * A minimal, dependency-free PDF writer.
 *
 * Same reasoning as `escpos.ts`: the only thing this ever needs to do is lay
 * plain text on a page, so a hand-rolled ~250-line generator is a smaller risk
 * than a PDF library, and — unlike a library — it can be unit tested for exact
 * byte structure under plain Node with nothing else in the room.
 *
 * The invoice a customer is handed on paper, the one WhatsApped to their phone,
 * and this PDF are three renderings of one thing: `renderReceipt()`'s laid-out
 * blocks. Nothing here decides what an invoice says — it only draws blocks it
 * is given, which is what makes it impossible for the PDF to quietly disagree
 * with the printed copy about an amount.
 *
 * The whole file is one Type1 font (Courier, in regular and bold) rather than
 * an embedded one. Every PDF viewer ships the 14 standard fonts, so nothing is
 * embedded and nothing can fail to render on the reader's end — and because
 * Courier is fixed-pitch, column alignment is exact character-count arithmetic,
 * the same "pad to the column, then draw" approach `escpos.ts` already uses for
 * a thermal printer's fixed-width paper.
 */

import { renderReceipt, type Receipt, type ReceiptBlock } from "./escpos.ts";

// -------------------------------------------------------------- page geometry

/** A5 — the same paper the shop's printer and the on-screen invoice use. */
const PT_PER_MM = 2.834645669;
const PAGE_W = Math.round(148 * PT_PER_MM);
const PAGE_H = Math.round(210 * PT_PER_MM);
const MARGIN = 28;

const FONT_SIZE = 9;
/** Extra vertical space beyond the raw font size, so lines don't touch. */
const LEADING = 3;
const LINE_HEIGHT = FONT_SIZE + LEADING;
/** "Tall" blocks (the shop name, TOTAL) are twice the height — see below. */
const TALL_LINE_HEIGHT = LINE_HEIGHT * 2;
/** Reserved for "Page N of M" on every page, so the budget never has to guess
 *  ahead of time whether a document will turn out to need more than one. */
const FOOTER_RESERVE = 16;

/**
 * The letterhead band on the first page.
 *
 * How wide the logo is drawn, and the air under it before the first line of
 * text. Only the first page carries it — a customer wants the mark at the top
 * of the document, not repeated over every page of a long statement — which is
 * why pagination has to know that page one has less room than the rest.
 */
const LOGO_W = 132;
const LOGO_GAP = 10;

/**
 * The shop's mark, ready to embed.
 *
 * Passed in rather than read from disk, because this file also runs in the
 * browser: the till builds a receipt PDF itself when it is offline, and a
 * `node:fs` import anywhere in this module's reach puts `node:fs` in the client
 * bundle and fails the build. The server routes read the file (see
 * `printLogo` in `brand.ts`) and hand the bytes over; the offline till passes
 * nothing and gets the same document without a letterhead.
 */
export interface PdfLogo {
  /** JPEG bytes, embedded untouched — see the DCTDecode note in `assemblePdf`. */
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * Courier's advance width is exactly 0.6 em for every glyph, in every weight,
 * in the standard 14 fonts — the one metric this file can rely on without a
 * font metrics table. `Tz` (horizontal scaling) is what makes a "tall" line
 * stay on the same character grid: doubling the font size for height would
 * also double the *width* of a Courier glyph, so the horizontal scale is
 * halved to bring the advance back to the base line's, exactly as the thermal
 * printer's "double height, not double width" mode already does.
 */
const CHAR_ADVANCE_FACTOR = 0.6;
const CHAR_W = FONT_SIZE * CHAR_ADVANCE_FACTOR;

/** How wide a line may be before it no longer fits inside the margins. */
export function pdfCharsPerLine(): number {
  return Math.floor((PAGE_W - 2 * MARGIN) / CHAR_W);
}

// ------------------------------------------------------------- byte plumbing

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** `(` `)` `\` are the only characters a PDF literal string must escape — every
 *  byte reaching here has already been folded to printable ASCII upstream. */
function pdfString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// ------------------------------------------------------------ content stream

/** One line of laid-out text, ready to become PDF drawing operators. */
interface Placed {
  block: ReceiptBlock;
  height: number;
}

function place(blocks: ReceiptBlock[]): Placed[] {
  return blocks.map((block) => ({ block, height: block.tall ? TALL_LINE_HEIGHT : LINE_HEIGHT }));
}

/**
 * Split laid-out lines into pages, each within the printable height.
 *
 * `firstInset` is the letterhead's band. It has to be taken off the first
 * page's budget and no other, or a long statement overruns its last line onto
 * a page of its own — which is how a document ends with a lone "Page 2 of 2"
 * and nothing above it.
 */
function paginate(lines: Placed[], firstInset = 0): Placed[][] {
  const usable = PAGE_H - 2 * MARGIN - FOOTER_RESERVE;
  const pages: Placed[][] = [];
  let page: Placed[] = [];
  let used = 0;
  let room = usable - firstInset;

  for (const line of lines) {
    if (used + line.height > room && page.length) {
      pages.push(page);
      page = [];
      used = 0;
      room = usable;
    }
    page.push(line);
    used += line.height;
  }
  if (page.length || !pages.length) pages.push(page);
  return pages;
}

/** x for a line's left edge, given how it should sit within the text column. */
function xFor(align: ReceiptBlock["align"], textLength: number, width: number): number {
  const room = Math.max(0, width - textLength);
  if (align === "center") return MARGIN + (room / 2) * CHAR_W;
  if (align === "right") return MARGIN + room * CHAR_W;
  return MARGIN;
}

function pageContent(
  lines: Placed[],
  pageNo: number,
  pageCount: number,
  width: number,
  /** Height of the letterhead band on this page; zero on every page but the first. */
  logoBand = 0,
  /** What the image is drawn at, once `logoBand` has said there is one. */
  logoHeight = 0,
): string {
  const ops: string[] = [];

  // The image goes down before the text block opens: `Do` is a page operator
  // and is illegal between BT and ET. `cm` scales the unit square the image is
  // painted into, so the width and height here are the drawn size in points,
  // not pixels — and `q`/`Q` keep that scaling off everything drawn after it.
  if (logoBand > 0) {
    const y0 = PAGE_H - MARGIN - logoHeight;
    ops.push(
      "q",
      `${LOGO_W} 0 0 ${logoHeight.toFixed(2)} ${MARGIN} ${y0.toFixed(2)} cm`,
      "/Im1 Do",
      "Q",
    );
  }

  ops.push("BT");
  let y = PAGE_H - MARGIN - logoBand - FONT_SIZE;
  let font: "F1" | "F2" | null = null;
  let scale: 100 | 50 | null = null;
  let size: number | null = null;

  for (const { block, height } of lines) {
    const wantFont = block.bold ? "F2" : "F1";
    const wantSize = block.tall ? FONT_SIZE * 2 : FONT_SIZE;
    // Halving the horizontal scale exactly compensates the doubled font size,
    // so a tall line's characters still advance at the base line's spacing.
    const wantScale = block.tall ? 50 : 100;

    if (wantFont !== font || wantSize !== size) {
      ops.push(`/${wantFont} ${wantSize} Tf`);
      font = wantFont;
      size = wantSize;
    }
    if (wantScale !== scale) {
      ops.push(`${wantScale} Tz`);
      scale = wantScale;
    }

    const text = block.text ?? "";
    const x = xFor(block.align, text.length, width);

    /*
      A tall line's extra height belongs above its baseline, not below it.

      Text is drawn upward from the baseline, so a line set at twice the size
      reaches about eleven points higher than an ordinary one — and the line
      before it only ever reserved twelve points of gap. Drawn at the plain
      baseline, TOTAL's capitals struck clean through the line above, which on
      this invoice is the discount: "Discount  -4,130" came out looking crossed
      off the bill.

      So the baseline drops by whatever height this block claimed beyond a
      normal one before anything is drawn. The block still advances by its full
      height, so pagination counts exactly what it counted before.
    */
    const baseline = y - (height - LINE_HEIGHT);
    ops.push(`1 0 0 1 ${x.toFixed(2)} ${baseline.toFixed(2)} Tm`);
    ops.push(`(${pdfString(text)}) Tj`);

    y -= height;
  }
  ops.push("ET");

  if (pageCount > 1) {
    const label = `Page ${pageNo} of ${pageCount}`;
    const x = xFor("right", label.length, width);
    ops.push(
      "BT",
      `/F1 ${FONT_SIZE - 1} Tf`,
      "100 Tz",
      `1 0 0 1 ${x.toFixed(2)} ${(MARGIN - FONT_SIZE + 2).toFixed(2)} Tm`,
      `(${pdfString(label)}) Tj`,
      "ET",
    );
  }

  return ops.join("\n") + "\n";
}

// ----------------------------------------------------------- file assembly

/**
 * Wrap already-laid-out page content streams into a complete, valid PDF:
 * catalog, page tree, two standard fonts, and a byte-exact cross-reference
 * table. This half of the file knows nothing about invoices — it only knows
 * how to be a PDF.
 */
function assemblePdf(pageContents: string[], logo?: { bytes: Uint8Array; width: number; height: number } | null): Uint8Array {
  const pageCount = pageContents.length;
  const fontRegularId = 3 + pageCount * 2;
  const fontBoldId = fontRegularId + 1;
  const imageId = logo ? fontBoldId + 1 : 0;
  const objectCount = logo ? imageId : fontBoldId; // ids 1..objectCount, all used

  const chunks: Uint8Array[] = [];
  const offsets: number[] = new Array(objectCount + 1).fill(0);
  let pos = 0;

  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    pos += bytes.length;
  };
  const pushObj = (id: number, text: string) => {
    offsets[id] = pos;
    push(ascii(text));
  };

  push(ascii("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));

  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i * 2} 0 R`).join(" ");
  pushObj(1, `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  pushObj(2, `2 0 obj\n<< /Type /Pages /Kids [ ${kids} ] /Count ${pageCount} >>\nendobj\n`);

  pageContents.forEach((content, i) => {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    pushObj(
      pageId,
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >>` +
        // Declared on every page even though only the first draws it. A reader
        // is entitled to refuse a page whose content stream names a resource
        // its dictionary does not, and one shared declaration is cheaper than
        // two page dictionaries that have to be kept in step.
        (logo ? ` /XObject << /Im1 ${imageId} 0 R >>` : "") +
        ` >> ` +
        `/Contents ${contentId} 0 R >>\nendobj\n`,
    );
    const body = ascii(content);
    pushObj(
      contentId,
      `${contentId} 0 obj\n<< /Length ${body.length} >>\nstream\n`,
    );
    push(body);
    push(ascii(`\nendstream\nendobj\n`));
  });

  pushObj(fontRegularId, `${fontRegularId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n`);
  pushObj(fontBoldId, `${fontBoldId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>\nendobj\n`);

  // The logo, as its own bytes. `DCTDecode` means "this stream is a JPEG" —
  // the reader's decoder does the work, so nothing here has to understand the
  // image beyond how wide and tall it is.
  if (logo) {
    pushObj(
      imageId,
      `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.bytes.length} >>\nstream\n`,
    );
    push(logo.bytes);
    push(ascii(`\nendstream\nendobj\n`));
  }

  // -------------------------------------------------------------- xref
  //
  // Every entry must be exactly 20 bytes — a 10-digit offset, a space, a
  // 5-digit generation, a space, the n/f flag, then a 2-byte end-of-line —
  // or a reader is within its rights to declare the whole file corrupt.
  const xrefStart = pos;
  let section = `xref\n0 ${objectCount + 1}\n0000000000 65535 f\r\n`;
  for (let id = 1; id <= objectCount; id++) {
    const entry = `${String(offsets[id]).padStart(10, "0")} 00000 n\r\n`;
    if (entry.length !== 20) throw new Error(`xref entry for object ${id} is not 20 bytes`);
    section += entry;
  }
  push(ascii(section));

  push(ascii(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`));

  return concat(chunks);
}

// --------------------------------------------------------------- public API

/**
 * A receipt or invoice as a PDF, laid out with the same `renderReceipt()` used
 * for the till printer — so the two documents can never disagree.
 */
export function receiptToPdf(receipt: Receipt, logo?: PdfLogo | null): Uint8Array {
  const width = pdfCharsPerLine();
  const blocks = renderReceipt(receipt, { width });
  return withLetterhead(place(blocks), width, logo);
}

/** A plain page of `ReceiptBlock`s — used for the customer statement, which
 *  has no thermal-printer form and so never goes through `renderReceipt`. */
export function blocksToPdf(blocks: ReceiptBlock[], logo?: PdfLogo | null): Uint8Array {
  return withLetterhead(place(blocks), pdfCharsPerLine(), logo);
}

/**
 * Paginate and assemble, with the shop's mark at the top of the first page.
 *
 * Both entry points do the same three things in the same order, and the logo
 * has to be taken into account at every one of them — the band comes off the
 * first page's budget, the first page's text starts below it, and the image
 * object has to reach the file. Doing that twice is how the invoice ends up
 * with a letterhead and the statement quietly does not.
 *
 * No logo means no band, no image object, and a PDF byte-for-byte like the one
 * this wrote before there was a logo at all — which is what the till falls back
 * to when it makes a receipt offline, with no server to read the file for it.
 */
function withLetterhead(lines: Placed[], width: number, logo?: PdfLogo | null): Uint8Array {
  const drawnHeight = logo ? (LOGO_W * logo.height) / logo.width : 0;
  const band = logo ? drawnHeight + LOGO_GAP : 0;

  const pages = paginate(lines, band);
  const contents = pages.map((page, i) =>
    pageContent(page, i + 1, pages.length, width, i === 0 ? band : 0, drawnHeight),
  );
  return assemblePdf(contents, logo);
}
