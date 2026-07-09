import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatMoney, formatQty, formatRate } from "./money";
import { fmtDate } from "./queries";
import { isPro } from "@/lib/plan";
import type { Invoice, InvoiceLine, Client, OrgProfile } from "./db/schema";

type Issuer = { name: string; profile: OrgProfile | null };

const A4 = { w: 595.28, h: 841.89 };
const M = 42; // page margin
const INK = rgb(0.09, 0.1, 0.2);
const MUTED = rgb(0.42, 0.45, 0.55);
const LINE = rgb(0.89, 0.9, 0.94);

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  return rgb(Number.isFinite(r) ? r : 0.02, Number.isFinite(g) ? g : 0.6, Number.isFinite(b) ? b : 0.4);
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const raw of String(text).split("\n")) {
    const words = raw.split(/\s+/);
    let cur = "";
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) > maxWidth && cur) {
        out.push(cur);
        cur = w;
      } else {
        cur = trial;
      }
    }
    out.push(cur);
  }
  return out;
}

/** Generate a clean A4 invoice/quotation/receipt-style PDF from the row data. */
export async function buildInvoicePdf(
  issuer: Issuer,
  invoice: Invoice,
  lines: InvoiceLine[],
  client: Client | null,
): Promise<Uint8Array> {
  const p = issuer.profile;
  const pro = isPro(p?.plan);
  const accent = pro && p?.accentColor ? hexToRgb(p.accentColor) : hexToRgb("#0e9f6e");
  const cur = invoice.currency;
  const isQuote = invoice.type === "quotation";

  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const right = A4.w - M;

  const text = (s: string, x: number, size: number, font = reg, color = INK) =>
    page.drawText(s, { x, y, size, font, color });
  const textRight = (s: string, x: number, size: number, font = reg, color = INK) =>
    page.drawText(s, { x: x - font.widthOfTextAtSize(s, size), y, size, font, color });
  const ensure = (need: number) => {
    if (y - need < M + 40) {
      page = doc.addPage([A4.w, A4.h]);
      y = A4.h - M;
    }
  };

  // ---- Header: issuer (left) + document meta (right) ----
  const topY = y;
  text(p?.legalName || issuer.name, M, 17, bold);
  y -= 16;
  const issuerLines = [
    p?.addressLine1,
    p?.addressLine2,
    [p?.city, p?.country].filter(Boolean).join(", ") || null,
    p?.phone,
    p?.email,
    p?.kraPin ? `KRA PIN: ${p.kraPin}` : null,
  ].filter(Boolean) as string[];
  for (const l of issuerLines) {
    y -= 12;
    text(l, M, 9.5, reg, MUTED);
  }

  // right column
  y = topY;
  const title = (isQuote ? "QUOTATION" : "INVOICE").toUpperCase();
  page.drawText(title, { x: right - bold.widthOfTextAtSize(title, 22), y: y - 4, size: 22, font: bold, color: accent });
  y -= 22;
  y -= 14;
  textRight(invoice.number, right, 11, bold);
  const meta: string[] = [`Issued ${fmtDate(invoice.issueDate)}`];
  if (!isQuote && invoice.dueDate) meta.push(`Due ${fmtDate(invoice.dueDate)}`);
  for (const m of meta) {
    y -= 13;
    textRight(m, right, 9.5, reg, MUTED);
  }

  // move below whichever column is lower
  y = topY - Math.max(16 + issuerLines.length * 12, 22 + 14 + meta.length * 13) - 18;
  page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 1, color: LINE });
  y -= 22;

  // ---- Bill to ----
  text(isQuote ? "QUOTATION FOR" : "BILLED TO", M, 8.5, bold, MUTED);
  y -= 15;
  text(client?.name ?? "—", M, 12, bold);
  const clientLines = [client?.addressLine1, client?.city, client?.email, client?.phone, client?.kraPin ? `KRA PIN: ${client.kraPin}` : null].filter(Boolean) as string[];
  for (const l of clientLines) {
    y -= 12;
    text(l, M, 9.5, reg, MUTED);
  }
  y -= 24;

  // ---- Items table ----
  const cols = { desc: M, qty: 360, rate: 452, amount: right };
  page.drawRectangle({ x: M, y: y - 4, width: right - M, height: 20, color: rgb(0.97, 0.98, 0.99) });
  text("DESCRIPTION", cols.desc + 6, 8.5, bold, MUTED);
  textRight("QTY", cols.qty, 8.5, bold, MUTED);
  textRight("RATE", cols.rate, 8.5, bold, MUTED);
  textRight("AMOUNT", cols.amount - 6, 8.5, bold, MUTED);
  y -= 22;

  for (const l of lines) {
    const name = l.title || l.description || "Item";
    const descLines = l.title && l.description ? wrap(l.description, reg, 8.5, cols.qty - cols.desc - 60) : [];
    const rowH = 16 + descLines.length * 11;
    ensure(rowH + 8);
    // amounts on the name row
    text(name, cols.desc + 6, 10, bold);
    textRight(formatQty(l.quantityMilli), cols.qty, 9.5);
    textRight(formatMoney(l.unitPrice, cur), cols.rate, 9.5);
    textRight(formatMoney(l.lineSubtotal, cur), cols.amount - 6, 9.5);
    for (const dl of descLines) {
      y -= 11;
      text(dl, cols.desc + 6, 8.5, reg, MUTED);
    }
    y -= 14;
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: right, y: y + 4 }, thickness: 0.5, color: LINE });
  }

  // ---- Totals ----
  y -= 12;
  const tlx = 360; // label left
  const row = (label: string, value: string, opts: { bold?: boolean; color?: typeof INK; size?: number } = {}) => {
    ensure(18);
    const f = opts.bold ? bold : reg;
    const size = opts.size ?? 10;
    page.drawText(label, { x: tlx, y, size, font: f, color: opts.color ?? MUTED });
    page.drawText(value, { x: right - f.widthOfTextAtSize(value, size), y, size, font: f, color: opts.color ?? INK });
    y -= size + 8;
  };
  row("Subtotal", formatMoney(invoice.subtotal, cur));
  if (invoice.discountAmount > 0) row("Discount", `- ${formatMoney(invoice.discountAmount, cur)}`);
  row("VAT", formatMoney(invoice.taxTotal, cur));
  page.drawLine({ start: { x: tlx, y: y + 6 }, end: { x: right, y: y + 6 }, thickness: 1, color: INK });
  y -= 4;
  row("Total", formatMoney(invoice.total, cur), { bold: true, size: 13, color: INK });
  if (!isQuote) {
    if (invoice.amountPaid > 0) row("Paid", formatMoney(invoice.amountPaid, cur));
    if (invoice.balanceDue > 0) row("Balance due", formatMoney(invoice.balanceDue, cur), { bold: true, color: accent });
  }
  if (!isQuote && invoice.depositAmount > 0 && invoice.amountPaid < invoice.depositAmount) {
    row("Deposit due now", formatMoney(invoice.depositAmount, cur), { color: accent });
  }

  // ---- Notes / bank / footer ----
  const footerBits = [
    p?.bankDetails ? `Payment details\n${p.bankDetails}` : null,
    invoice.notes || null,
    invoice.terms || null,
    p?.invoiceFooter && !invoice.notes && !invoice.terms ? p.invoiceFooter : null,
  ].filter(Boolean) as string[];
  if (footerBits.length) {
    y -= 14;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: right, y: y + 6 }, thickness: 0.5, color: LINE });
    y -= 6;
    for (const b of footerBits) {
      for (const bl of wrap(b, reg, 8.5, right - M)) {
        ensure(12);
        text(bl, M, 8.5, reg, MUTED);
        y -= 12;
      }
      y -= 4;
    }
  }

  if (!pro) {
    text("Powered by TallyPay — free invoicing for Kenya", M, 8, reg, MUTED);
  }

  return doc.save();
}

/** Base64-encode PDF bytes for an email attachment (chunked; Worker-safe). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
