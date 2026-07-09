// NOTE: imported ONLY by client components. jspdf ships to the browser as a
// static chunk and never enters the Cloudflare Worker (which has a 3 MiB size
// limit). We deliberately use jspdf here rather than pdf-lib — pdf-lib bundles
// far larger and, even behind a dynamic import, ended up in the Worker bundle
// and blew the size limit.
import { formatMoney, formatQty } from "@/server/money";
import { isPro } from "@/lib/plan";
import type { Invoice, InvoiceLine, Client, OrgProfile } from "@/server/db/schema";

// Only the display fields the PDF needs — never the vendor's encrypted secrets.
export type PdfIssuer = { name: string; profile: Partial<OrgProfile> | null };
type Issuer = PdfIssuer;

type RGB = [number, number, number];

/** Date formatter (client-safe; mirrors the server fmtDate). */
function fmtDate(d?: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// A4 in points (jspdf top-left origin, y grows downward).
const A4 = { w: 595.28, h: 841.89 };
const M = 42; // page margin
const INK: RGB = [23, 26, 51];
const MUTED: RGB = [107, 115, 140];
const LINE: RGB = [227, 230, 240];

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return [Number.isFinite(r) ? r : 14, Number.isFinite(g) ? g : 159, Number.isFinite(b) ? b : 110];
}

/** Generate a clean A4 invoice/quotation-style PDF from the row data. */
export async function buildInvoicePdf(
  issuer: Issuer,
  invoice: Invoice,
  lines: InvoiceLine[],
  client: Client | null,
): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const p = issuer.profile;
  const pro = isPro(p?.plan);
  const accent: RGB = pro && p?.accentColor ? hexToRgb(p.accentColor) : hexToRgb("#0e9f6e");
  const cur = invoice.currency;
  const isQuote = invoice.type === "quotation";

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const right = A4.w - M;

  // ---- low-level helpers (jspdf is stateful: set font before measuring/drawing) ----
  const setFont = (size: number, style: "normal" | "bold" = "normal", color: RGB = INK) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
  };
  const text = (s: string, x: number, y: number, size: number, style: "normal" | "bold" = "normal", color: RGB = INK) => {
    setFont(size, style, color);
    doc.text(s, x, y, { baseline: "alphabetic" });
  };
  const textRight = (s: string, xRight: number, y: number, size: number, style: "normal" | "bold" = "normal", color: RGB = INK) => {
    setFont(size, style, color);
    doc.text(s, xRight, y, { align: "right", baseline: "alphabetic" });
  };
  const rule = (x1: number, y: number, x2: number, thickness: number, color: RGB) => {
    doc.setDrawColor(color[0], color[1], color[2]);
    doc.setLineWidth(thickness);
    doc.line(x1, y, x2, y);
  };
  const wrap = (s: string, size: number, style: "normal" | "bold", maxWidth: number): string[] => {
    setFont(size, style);
    return doc.splitTextToSize(String(s), maxWidth);
  };

  let y = M + 14; // first baseline
  const topY = y;
  const ensure = (need: number) => {
    if (y + need > A4.h - M - 30) {
      doc.addPage();
      y = M + 14;
    }
  };

  // ---- Header: issuer (left) + document meta (right) ----
  text(p?.legalName || issuer.name, M, y, 17, "bold");
  const issuerLines = [
    p?.addressLine1,
    p?.addressLine2,
    [p?.city, p?.country].filter(Boolean).join(", ") || null,
    p?.phone,
    p?.email,
    p?.kraPin ? `KRA PIN: ${p.kraPin}` : null,
  ].filter(Boolean) as string[];
  let ly = y + 16;
  for (const l of issuerLines) {
    ly += 12;
    text(l, M, ly, 9.5, "normal", MUTED);
  }

  // right column
  const title = (isQuote ? "QUOTATION" : "INVOICE").toUpperCase();
  textRight(title, right, topY, 22, "bold", accent);
  let ry = topY + 36;
  textRight(invoice.number, right, ry, 11, "bold");
  const meta: string[] = [`Issued ${fmtDate(invoice.issueDate)}`];
  if (!isQuote && invoice.dueDate) meta.push(`Due ${fmtDate(invoice.dueDate)}`);
  for (const m of meta) {
    ry += 13;
    textRight(m, right, ry, 9.5, "normal", MUTED);
  }

  // move below whichever column is lower
  y = topY + Math.max(16 + issuerLines.length * 12, 36 + meta.length * 13) + 20;
  rule(M, y, right, 1, LINE);
  y += 22;

  // ---- Bill to ----
  text(isQuote ? "QUOTATION FOR" : "BILLED TO", M, y, 8.5, "bold", MUTED);
  y += 15;
  text(client?.name ?? "—", M, y, 12, "bold");
  const clientLines = [
    client?.addressLine1,
    client?.city,
    client?.email,
    client?.phone,
    client?.kraPin ? `KRA PIN: ${client.kraPin}` : null,
  ].filter(Boolean) as string[];
  for (const l of clientLines) {
    y += 12;
    text(l, M, y, 9.5, "normal", MUTED);
  }
  y += 26;

  // ---- Items table ----
  const cols = { desc: M, qty: 360, rate: 452, amount: right };
  doc.setFillColor(247, 250, 252);
  doc.rect(M, y - 11, right - M, 18, "F");
  text("DESCRIPTION", cols.desc + 6, y, 8.5, "bold", MUTED);
  textRight("QTY", cols.qty, y, 8.5, "bold", MUTED);
  textRight("RATE", cols.rate, y, 8.5, "bold", MUTED);
  textRight("AMOUNT", cols.amount - 6, y, 8.5, "bold", MUTED);
  y += 22;

  for (const l of lines) {
    const name = l.title || l.description || "Item";
    const descLines = l.title && l.description ? wrap(l.description, 8.5, "normal", cols.qty - cols.desc - 60) : [];
    const rowH = 16 + descLines.length * 11;
    ensure(rowH + 8);
    text(name, cols.desc + 6, y, 10, "bold");
    textRight(formatQty(l.quantityMilli), cols.qty, y, 9.5);
    textRight(formatMoney(l.unitPrice, cur), cols.rate, y, 9.5);
    textRight(formatMoney(l.lineSubtotal, cur), cols.amount - 6, y, 9.5);
    for (const dl of descLines) {
      y += 11;
      text(dl, cols.desc + 6, y, 8.5, "normal", MUTED);
    }
    y += 14;
    rule(M, y - 4, right, 0.5, LINE);
  }

  // ---- Totals ----
  y += 14;
  const tlx = 360; // label left
  const totalRow = (label: string, value: string, opts: { bold?: boolean; color?: RGB; size?: number } = {}) => {
    ensure(18);
    const style = opts.bold ? "bold" : "normal";
    const size = opts.size ?? 10;
    text(label, tlx, y, size, style, opts.color ?? MUTED);
    textRight(value, right, y, size, style, opts.color ?? INK);
    y += size + 8;
  };
  totalRow("Subtotal", formatMoney(invoice.subtotal, cur));
  if (invoice.discountAmount > 0) totalRow("Discount", `- ${formatMoney(invoice.discountAmount, cur)}`);
  totalRow("VAT", formatMoney(invoice.taxTotal, cur));
  rule(tlx, y - 6, right, 1, INK);
  y += 2;
  totalRow("Total", formatMoney(invoice.total, cur), { bold: true, size: 13, color: INK });
  if (!isQuote) {
    if (invoice.amountPaid > 0) totalRow("Paid", formatMoney(invoice.amountPaid, cur));
    if (invoice.balanceDue > 0) totalRow("Balance due", formatMoney(invoice.balanceDue, cur), { bold: true, color: accent });
  }
  if (!isQuote && invoice.depositAmount > 0 && invoice.amountPaid < invoice.depositAmount) {
    totalRow("Deposit due now", formatMoney(invoice.depositAmount, cur), { color: accent });
  }

  // ---- Notes / bank / footer ----
  const footerBits = [
    p?.bankDetails ? `Payment details\n${p.bankDetails}` : null,
    invoice.notes || null,
    invoice.terms || null,
    p?.invoiceFooter && !invoice.notes && !invoice.terms ? p.invoiceFooter : null,
  ].filter(Boolean) as string[];
  if (footerBits.length) {
    y += 14;
    rule(M, y - 6, right, 0.5, LINE);
    y += 6;
    for (const b of footerBits) {
      for (const bl of wrap(b, 8.5, "normal", right - M)) {
        ensure(12);
        text(bl, M, y, 8.5, "normal", MUTED);
        y += 12;
      }
      y += 4;
    }
  }

  if (!pro) {
    ensure(12);
    text("Powered by TallyPay — free invoicing for Kenya", M, y, 8, "normal", MUTED);
  }

  return new Uint8Array(doc.output("arraybuffer"));
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
