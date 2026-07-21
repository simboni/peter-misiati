// Client-side, vector A4 PDF builder for every TallyPay document.
//
// IMPORTANT: this replaces an earlier html2canvas approach that rasterised the
// on-screen template and tiled the tall image across pages — which produced
// full-page colour blocks, totals above the line items, and content stranded on
// a near-empty page 2. Here we draw real, selectable text laid out for A4, so
// the output is compact, professional and paginates cleanly.
//
// Imported ONLY by client components: jspdf ships as a browser chunk and never
// enters the 3 MiB Cloudflare Worker bundle.
import { formatMoney, formatQty } from "@/server/money";
import { isPro } from "@/lib/plan";
import { DEFAULT_ACCENT } from "@/lib/doc-style";
import type { Invoice, InvoiceLine, Client, OrgProfile, Payment, DeliveryNote, CreditNote } from "@/server/db/schema";

// Only the display fields a document needs — never the vendor's encrypted secrets.
export type PdfIssuer = { name: string; profile: Partial<OrgProfile> | null };
type Issuer = PdfIssuer;
type RGB = [number, number, number];

type CreditLine = { id: string; title: string | null; description: string; quantityMilli: number; unitPrice: number; taxRateBps: number; lineSubtotal: number };
type DeliveryLine = { id: string; description: string; quantityMilli: number; unit: string };
type StatementEntry = { date: Date; doc: string; description: string; debit: number; credit: number; balance: number };

/** Discriminated payload the Share/Download button hands to buildDocumentPdf. */
export type PdfDocInput =
  | { kind: "invoice" | "quotation"; issuer: Issuer; invoice: Invoice; lines: InvoiceLine[]; client: Client | null }
  | { kind: "receipt"; issuer: Issuer; payment: Payment; invoice: Invoice; client: Client | null; priorPaid: number }
  | { kind: "deliveryNote"; issuer: Issuer; note: DeliveryNote; lines: DeliveryLine[]; client: Client | null; invoiceNumber?: string | null }
  | { kind: "creditNote"; issuer: Issuer; creditNote: CreditNote; lines: CreditLine[]; client: Client | null; invoiceNumber?: string | null }
  | { kind: "statement"; issuer: Issuer; client: Client | null; entries: StatementEntry[]; totalDebit: number; totalCredit: number; closingBalance: number; currency: string; asOf: Date };

const A4 = { w: 595.28, h: 841.89 };
const M = 42; // page margin (pt)
const INK: RGB = [23, 26, 51];
const MUTED: RGB = [107, 115, 140];
const LINE: RGB = [226, 232, 240];
const ZEBRA: RGB = [247, 250, 252];

const METHOD_LABELS: Record<string, string> = {
  mpesa: "M-Pesa", cash: "Cash", bank: "Bank transfer", cheque: "Cheque", card: "Card", other: "Other",
};

function fmtDate(d?: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function hexToRgb(hex: string): RGB {
  const h = (hex || "").replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return [Number.isFinite(r) ? r : 14, Number.isFinite(g) ? g : 159, Number.isFinite(b) ? b : 110];
}
/** Lighten a colour toward white by `f` (0..1) — for soft tinted panels. */
const tint = (c: RGB, f: number): RGB => [
  Math.round(c[0] + (255 - c[0]) * f),
  Math.round(c[1] + (255 - c[1]) * f),
  Math.round(c[2] + (255 - c[2]) * f),
];

type JsPdf = import("jspdf").jsPDF;

/** A thin A4 painter over jsPDF: a top-down y cursor plus text/rule/table helpers. */
class Painter {
  doc: JsPdf;
  right = A4.w - M;
  y = M + 16;
  name: string;
  p: Partial<OrgProfile> | null;
  pro: boolean;
  accent: RGB;

  constructor(doc: JsPdf, issuer: Issuer) {
    this.doc = doc;
    this.name = issuer.name;
    this.p = issuer.profile;
    this.pro = isPro(this.p?.plan ?? undefined);
    this.accent = this.pro && this.p?.accentColor ? hexToRgb(this.p.accentColor) : hexToRgb(DEFAULT_ACCENT);
  }

  private font(size: number, style: "normal" | "bold", color: RGB) {
    this.doc.setFont("helvetica", style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(color[0], color[1], color[2]);
  }
  text(s: string, x: number, y: number, size: number, style: "normal" | "bold" = "normal", color: RGB = INK) {
    this.font(size, style, color);
    this.doc.text(String(s), x, y, { baseline: "alphabetic" });
  }
  textR(s: string, xr: number, y: number, size: number, style: "normal" | "bold" = "normal", color: RGB = INK) {
    this.font(size, style, color);
    this.doc.text(String(s), xr, y, { align: "right", baseline: "alphabetic" });
  }
  rule(x1: number, y: number, x2: number, t = 0.5, color: RGB = LINE) {
    this.doc.setDrawColor(color[0], color[1], color[2]);
    this.doc.setLineWidth(t);
    this.doc.line(x1, y, x2, y);
  }
  fill(x: number, y: number, w: number, h: number, color: RGB, r = 0) {
    this.doc.setFillColor(color[0], color[1], color[2]);
    if (r) this.doc.roundedRect(x, y, w, h, r, r, "F");
    else this.doc.rect(x, y, w, h, "F");
  }
  strokeRound(x: number, y: number, w: number, h: number, color: RGB, r = 6, t = 0.8) {
    this.doc.setDrawColor(color[0], color[1], color[2]);
    this.doc.setLineWidth(t);
    this.doc.roundedRect(x, y, w, h, r, r, "S");
  }
  wrap(s: string, size: number, maxW: number, style: "normal" | "bold" = "normal"): string[] {
    this.font(size, style, INK);
    return this.doc.splitTextToSize(String(s ?? ""), maxW) as string[];
  }
  ensure(need: number, redraw?: () => void) {
    if (this.y + need > A4.h - M - 24) {
      this.doc.addPage();
      this.y = M + 16;
      redraw?.();
    }
  }

  /** Header band: issuer (left) + document title/number/meta (right). */
  header(title: string, number: string, meta: string[]) {
    const top = this.y;

    // Vendor logo (Pro only, matching the on-screen document) sits above the
    // business name. Best-effort: an unreadable/unsupported image is skipped so
    // the PDF still renders with the name, never breaking the download.
    let logoH = 0;
    const logo = this.pro ? this.p?.logoUrl : null;
    if (logo && /^data:image\//i.test(logo)) {
      try {
        const props = this.doc.getImageProperties(logo);
        const maxH = 40, maxW = 160;
        let h = maxH;
        let w = (props.width / props.height) * h;
        if (w > maxW) { w = maxW; h = (props.height / props.width) * w; }
        this.doc.addImage(logo, props.fileType || "PNG", M, top - 8, w, h);
        logoH = h + 12;
      } catch {
        /* unsupported/corrupt logo — fall back to the name only */
      }
    }

    const nameY = top + logoH;
    this.text(this.p?.legalName || this.name, M, nameY, 17, "bold");
    const issuerLines = [
      this.p?.addressLine1,
      this.p?.addressLine2,
      [this.p?.city, this.p?.country].filter(Boolean).join(", ") || null,
      this.p?.phone,
      this.p?.email,
      this.p?.kraPin ? `KRA PIN: ${this.p.kraPin}` : null,
    ].filter(Boolean) as string[];
    let ly = nameY + 16;
    for (const l of issuerLines) { ly += 12; this.text(l, M, ly, 9.5, "normal", MUTED); }

    this.textR(title.toUpperCase(), this.right, top, 22, "bold", this.accent);
    let ry = top + 34;
    this.textR(number, this.right, ry, 11, "bold");
    for (const m of meta) { ry += 13; this.textR(m, this.right, ry, 9.5, "normal", MUTED); }

    this.y = Math.max(nameY + 16 + issuerLines.length * 12, top + 34 + meta.length * 13) + 22;
    this.rule(M, this.y, this.right, 1, LINE);
    this.y += 22;
  }

  /** A labelled party block (Billed to / Received from / …). */
  party(label: string, client: Client | null) {
    this.text(label.toUpperCase(), M, this.y, 8.5, "bold", MUTED);
    this.y += 15;
    this.text(client?.name ?? "—", M, this.y, 12, "bold");
    const lines = [
      client?.addressLine1, client?.city, client?.email, client?.phone,
      client?.kraPin ? `KRA PIN: ${client.kraPin}` : null,
    ].filter(Boolean) as string[];
    for (const l of lines) { this.y += 12; this.text(l, M, this.y, 9.5, "normal", MUTED); }
    this.y += 24;
  }

  /** Accent-tinted highlight panel (e.g. "Amount received"). */
  panel(lines: { label: string; value: string; big?: boolean }[]) {
    const padY = 12;
    const h = padY * 2 + lines.reduce((a, l) => a + (l.big ? 26 : 14), 0);
    this.ensure(h + 8);
    this.fill(M, this.y, this.right - M, h, tint(this.accent, 0.9), 6);
    this.strokeRound(M, this.y, this.right - M, h, tint(this.accent, 0.55));
    let yy = this.y + padY + 4;
    for (const l of lines) {
      if (l.big) {
        this.text(l.label, M + 16, yy, 9, "normal", this.accent);
        this.textR(l.value, this.right - 16, yy + 2, 20, "bold", this.accent);
        yy += 26;
      } else {
        this.text(l.label, M + 16, yy, 9.5, "normal", this.accent);
        yy += 14;
      }
    }
    this.y += h + 20;
  }

  poweredFooter() {
    if (this.pro) return;
    this.ensure(16);
    this.y = Math.min(this.y + 6, A4.h - M);
    this.text("Powered by TallyPay — free invoicing for Kenya", M, this.y, 8, "normal", MUTED);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.doc.output("arraybuffer"));
  }
}

async function newPainter(issuer: Issuer): Promise<Painter> {
  const { jsPDF } = await import("jspdf");
  return new Painter(new jsPDF({ unit: "pt", format: "a4" }), issuer);
}

// ------------------------------------------------------------------ invoice / quotation
export async function buildInvoicePdf(issuer: Issuer, invoice: Invoice, lines: InvoiceLine[], client: Client | null): Promise<Uint8Array> {
  const P = await newPainter(issuer);
  const cur = invoice.currency;
  const isQuote = invoice.type === "quotation";
  const meta = [`Issued ${fmtDate(invoice.issueDate)}`];
  if (!isQuote && invoice.dueDate) meta.push(`Due ${fmtDate(invoice.dueDate)}`);
  P.header(isQuote ? "Quotation" : "Invoice", invoice.number, meta);
  P.party(isQuote ? "Quotation for" : "Billed to", client);

  const cols = { desc: M, qty: 356, rate: 452, amount: P.right };
  const head = () => {
    P.fill(M, P.y - 11, P.right - M, 18, ZEBRA);
    P.text("DESCRIPTION", cols.desc + 6, P.y, 8.5, "bold", MUTED);
    P.textR("QTY", cols.qty, P.y, 8.5, "bold", MUTED);
    P.textR("RATE", cols.rate, P.y, 8.5, "bold", MUTED);
    P.textR("AMOUNT", cols.amount - 6, P.y, 8.5, "bold", MUTED);
    P.y += 22;
  };
  head();
  for (const l of lines) {
    const name = l.title || l.description || "Item";
    const descLines = l.title && l.description ? P.wrap(l.description, 8.5, cols.qty - cols.desc - 60) : [];
    P.ensure(16 + descLines.length * 11 + 6, head);
    P.text(name, cols.desc + 6, P.y, 10, "bold");
    P.textR(formatQty(l.quantityMilli), cols.qty, P.y, 9.5);
    P.textR(formatMoney(l.unitPrice, cur), cols.rate, P.y, 9.5);
    P.textR(formatMoney(l.lineSubtotal, cur), cols.amount - 6, P.y, 9.5);
    for (const d of descLines) { P.y += 11; P.text(d, cols.desc + 6, P.y, 8.5, "normal", MUTED); }
    P.y += 12;
    P.rule(M, P.y, P.right, 0.5);
    P.y += 15;
  }

  P.y += 12;
  const row = (label: string, value: string, o: { bold?: boolean; color?: RGB; size?: number } = {}) => {
    P.ensure(18);
    const size = o.size ?? 10, style = o.bold ? "bold" : "normal";
    P.text(label, 356, P.y, size, style, o.color ?? MUTED);
    P.textR(value, P.right, P.y, size, style, o.color ?? INK);
    P.y += size + 8;
  };
  row("Subtotal", formatMoney(invoice.subtotal, cur));
  if (invoice.discountAmount > 0) row("Discount", `- ${formatMoney(invoice.discountAmount, cur)}`);
  row("VAT", formatMoney(invoice.taxTotal, cur));
  P.y += 4;
  P.rule(356, P.y, P.right, 1, INK);
  P.y += 16;
  row("Total", formatMoney(invoice.total, cur), { bold: true, size: 13, color: INK });
  if (!isQuote) {
    if (invoice.amountPaid > 0) row("Paid", formatMoney(invoice.amountPaid, cur));
    if (invoice.balanceDue > 0) row("Balance due", formatMoney(invoice.balanceDue, cur), { bold: true, color: P.accent });
  }
  if (!isQuote && invoice.depositAmount > 0 && invoice.amountPaid < invoice.depositAmount) {
    row("Deposit due now", formatMoney(invoice.depositAmount, cur), { color: P.accent });
  }

  const bits = [
    P.p?.bankDetails ? `Payment details\n${P.p.bankDetails}` : null,
    invoice.notes || null,
    invoice.terms || null,
    P.p?.invoiceFooter && !invoice.notes && !invoice.terms ? P.p.invoiceFooter : null,
  ].filter(Boolean) as string[];
  if (bits.length) {
    P.y += 14;
    P.rule(M, P.y - 6, P.right, 0.5);
    P.y += 6;
    for (const b of bits) { for (const bl of P.wrap(b, 8.5, P.right - M)) { P.ensure(12); P.text(bl, M, P.y, 8.5, "normal", MUTED); P.y += 12; } P.y += 4; }
  }
  P.poweredFooter();
  return P.bytes();
}

// ------------------------------------------------------------------ receipt
async function buildReceiptPdf(i: Extract<PdfDocInput, { kind: "receipt" }>): Promise<Uint8Array> {
  const P = await newPainter(i.issuer);
  const cur = i.invoice.currency;
  const balanceAfter = Math.max(i.invoice.total - (i.priorPaid + i.payment.amount), 0);
  const meta = [`Date: ${fmtDate(i.payment.paidAt)}`, `Method: ${METHOD_LABELS[i.payment.method] ?? i.payment.method}`];
  if (i.payment.reference) meta.push(`Ref: ${i.payment.reference}`);
  P.header("Receipt", i.payment.number, meta);
  P.party("Received from", i.client);
  P.panel([
    { label: "Amount received", value: formatMoney(i.payment.amount, cur), big: true },
    { label: `${i.payment.kind} payment for invoice ${i.invoice.number}`, value: "" },
  ]);

  const line = (label: string, value: string, bold = false) => {
    P.ensure(20);
    P.text(label, M + 2, P.y, 10, bold ? "bold" : "normal", bold ? INK : MUTED);
    P.textR(value, P.right - 2, P.y, 10, bold ? "bold" : "normal", INK);
    P.y += 10;
    P.rule(M, P.y, P.right, 0.5);
    P.y += 12;
  };
  line("Invoice total", formatMoney(i.invoice.total, cur));
  line("Previously paid", formatMoney(i.priorPaid, cur));
  line("This payment", formatMoney(i.payment.amount, cur));
  line("Balance remaining", formatMoney(balanceAfter, cur), true);
  if (i.payment.note) { P.y += 6; for (const bl of P.wrap(i.payment.note, 9.5, P.right - M)) { P.ensure(12); P.text(bl, M, P.y, 9.5, "normal", MUTED); P.y += 12; } }
  P.y += 16;
  P.text("This is a computer-generated receipt.", M, P.y, 8.5, "normal", MUTED);
  P.y += 14;
  P.poweredFooter();
  return P.bytes();
}

// ------------------------------------------------------------------ delivery note
async function buildDeliveryNotePdf(i: Extract<PdfDocInput, { kind: "deliveryNote" }>): Promise<Uint8Array> {
  const P = await newPainter(i.issuer);
  const meta = [`Date: ${fmtDate(i.note.deliveryDate)}`];
  if (i.invoiceNumber) meta.push(`Invoice: ${i.invoiceNumber}`);
  meta.push(`Status: ${i.note.status}`);
  P.header("Delivery Note", i.note.number, meta);
  P.party("Deliver to", i.client);

  const cols = { desc: M, qty: 380, unit: 470 };
  const head = () => {
    P.fill(M, P.y - 11, P.right - M, 18, ZEBRA);
    P.text("DESCRIPTION", cols.desc + 6, P.y, 8.5, "bold", MUTED);
    P.textR("QUANTITY", cols.qty, P.y, 8.5, "bold", MUTED);
    P.text("UNIT", cols.unit, P.y, 8.5, "bold", MUTED);
    P.y += 22;
  };
  head();
  for (const l of i.lines) {
    const descLines = P.wrap(l.description, 10, cols.qty - cols.desc - 20);
    P.ensure(descLines.length * 12 + 8, head);
    descLines.forEach((d, idx) => {
      P.text(d, cols.desc + 6, P.y, 10, "normal", INK);
      if (idx === 0) { P.textR(formatQty(l.quantityMilli), cols.qty, P.y, 9.5); P.text(l.unit, cols.unit, P.y, 9.5, "normal", MUTED); }
      P.y += 12;
    });
    P.y += 8;
    P.rule(M, P.y, P.right, 0.5);
    P.y += 8;
  }
  if (i.note.notes) { P.y += 10; for (const bl of P.wrap(i.note.notes, 9.5, P.right - M)) { P.ensure(12); P.text(bl, M, P.y, 9.5, "normal", MUTED); P.y += 12; } }

  // Signature lines
  P.ensure(80);
  P.y += 40;
  const colW = (P.right - M - 24) / 2;
  [["Delivered by", M], ["Received by" + (i.note.receivedBy ? `: ${i.note.receivedBy}` : ""), M + colW + 24]].forEach(([label, x]) => {
    const xn = x as number;
    P.rule(xn, P.y, xn + colW, 0.8, INK);
    P.text(String(label), xn, P.y + 13, 9.5, "bold", INK);
    P.text("Name & signature", xn, P.y + 26, 8, "normal", MUTED);
    P.text("Date: ______________", xn, P.y + 42, 8.5, "normal", MUTED);
  });
  P.y += 50;
  P.poweredFooter();
  return P.bytes();
}

// ------------------------------------------------------------------ credit note
async function buildCreditNotePdf(i: Extract<PdfDocInput, { kind: "creditNote" }>): Promise<Uint8Array> {
  const P = await newPainter(i.issuer);
  const cn = i.creditNote;
  const cur = cn.currency;
  const meta = [`Date: ${fmtDate(cn.issueDate)}`];
  if (i.invoiceNumber) meta.push(`Against: ${i.invoiceNumber}`);
  P.header("Credit Note", cn.number, meta);
  P.party("Credit to", i.client);
  if (cn.reason) { P.text("Reason", M, P.y, 8.5, "bold", MUTED); P.y += 13; for (const bl of P.wrap(cn.reason, 9.5, P.right - M)) { P.text(bl, M, P.y, 9.5, "normal", INK); P.y += 12; } P.y += 12; }

  const cols = { desc: M, qty: 330, rate: 420, vat: 470, amount: P.right };
  const head = () => {
    P.fill(M, P.y - 11, P.right - M, 18, ZEBRA);
    P.text("DESCRIPTION", cols.desc + 6, P.y, 8.5, "bold", MUTED);
    P.textR("QTY", cols.qty, P.y, 8.5, "bold", MUTED);
    P.textR("RATE", cols.rate, P.y, 8.5, "bold", MUTED);
    P.textR("VAT", cols.vat, P.y, 8.5, "bold", MUTED);
    P.textR("AMOUNT", cols.amount - 6, P.y, 8.5, "bold", MUTED);
    P.y += 22;
  };
  head();
  for (const l of i.lines) {
    const name = l.title || l.description || "Item";
    const descLines = l.title && l.description ? P.wrap(l.description, 8.5, cols.qty - cols.desc - 40) : [];
    P.ensure(16 + descLines.length * 11 + 6, head);
    P.text(name, cols.desc + 6, P.y, 10, "bold");
    P.textR(formatQty(l.quantityMilli), cols.qty, P.y, 9.5);
    P.textR(formatMoney(l.unitPrice, cur), cols.rate, P.y, 9.5);
    P.textR(`${(l.taxRateBps / 100).toFixed(0)}%`, cols.vat, P.y, 9.5);
    P.textR(formatMoney(l.lineSubtotal, cur), cols.amount - 6, P.y, 9.5);
    for (const d of descLines) { P.y += 11; P.text(d, cols.desc + 6, P.y, 8.5, "normal", MUTED); }
    P.y += 12;
    P.rule(M, P.y, P.right, 0.5);
    P.y += 15;
  }
  P.y += 12;
  const row = (label: string, value: string, o: { bold?: boolean; color?: RGB; size?: number } = {}) => {
    P.ensure(18);
    const size = o.size ?? 10, style = o.bold ? "bold" : "normal";
    P.text(label, 356, P.y, size, style, o.color ?? MUTED);
    P.textR(value, P.right, P.y, size, style, o.color ?? INK);
    P.y += size + 8;
  };
  row("Subtotal", formatMoney(cn.subtotal, cur));
  row("VAT", formatMoney(cn.taxTotal, cur));
  P.y += 4;
  P.rule(356, P.y, P.right, 1, INK);
  P.y += 16;
  row("Total credit", `- ${formatMoney(cn.total, cur)}`, { bold: true, size: 13, color: P.accent });
  const notes: string[] = [];
  if (cn.refunded) notes.push(`Refund of ${formatMoney(cn.total, cur)} paid by ${METHOD_LABELS[cn.refundMethod ?? "other"] ?? cn.refundMethod}${cn.refundReference ? ` (ref ${cn.refundReference})` : ""}.`);
  if (cn.appliedToInvoice && i.invoiceNumber) notes.push(`Applied to invoice ${i.invoiceNumber} — reduces the balance owed.`);
  if (cn.notes) notes.push(cn.notes);
  if (notes.length) { P.y += 10; for (const n of notes) { for (const bl of P.wrap(n, 9.5, P.right - M)) { P.ensure(12); P.text(bl, M, P.y, 9.5, "normal", MUTED); P.y += 12; } P.y += 4; } }
  P.y += 8;
  P.text("This is a computer-generated credit note.", M, P.y, 8.5, "normal", MUTED);
  P.y += 14;
  P.poweredFooter();
  return P.bytes();
}

// ------------------------------------------------------------------ statement
async function buildStatementPdf(i: Extract<PdfDocInput, { kind: "statement" }>): Promise<Uint8Array> {
  const P = await newPainter(i.issuer);
  const cur = i.currency;
  P.header("Statement", i.client?.name ?? "", [`As of ${fmtDate(i.asOf)}`]);
  P.party("Statement for", i.client);
  P.panel([{ label: "Balance due", value: formatMoney(Math.max(i.closingBalance, 0), cur), big: true }]);

  const cols = { date: M, doc: 110, details: 190, charge: 400, paid: 478, bal: P.right };
  const head = () => {
    P.fill(M, P.y - 11, P.right - M, 18, ZEBRA);
    P.text("DATE", cols.date + 4, P.y, 8, "bold", MUTED);
    P.text("DOCUMENT", cols.doc, P.y, 8, "bold", MUTED);
    P.text("DETAILS", cols.details, P.y, 8, "bold", MUTED);
    P.textR("CHARGE", cols.charge, P.y, 8, "bold", MUTED);
    P.textR("PAID", cols.paid, P.y, 8, "bold", MUTED);
    P.textR("BALANCE", cols.bal - 4, P.y, 8, "bold", MUTED);
    P.y += 20;
  };
  head();
  if (i.entries.length === 0) { P.text("No activity yet.", M + 4, P.y, 9.5, "normal", MUTED); P.y += 16; }
  for (const e of i.entries) {
    P.ensure(16, head);
    P.text(fmtDate(e.date), cols.date + 4, P.y, 9, "normal", MUTED);
    P.text(e.doc, cols.doc, P.y, 9, "normal", INK);
    const det = P.wrap(e.description || "", 8.5, cols.charge - cols.details - 8);
    P.text(det[0] ?? "", cols.details, P.y, 8.5, "normal", MUTED);
    P.textR(e.debit ? formatMoney(e.debit, cur) : "—", cols.charge, P.y, 9);
    P.textR(e.credit ? formatMoney(e.credit, cur) : "—", cols.paid, P.y, 9);
    P.textR(formatMoney(e.balance, cur), cols.bal - 4, P.y, 9, "bold");
    P.y += 13;
    P.rule(M, P.y - 3, P.right, 0.4);
  }
  P.y += 8;
  P.rule(M, P.y - 6, P.right, 1, INK);
  P.text("Totals", cols.date + 4, P.y, 9.5, "bold", INK);
  P.textR(formatMoney(i.totalDebit, cur), cols.charge, P.y, 9.5, "bold");
  P.textR(formatMoney(i.totalCredit, cur), cols.paid, P.y, 9.5, "bold");
  P.textR(formatMoney(Math.max(i.closingBalance, 0), cur), cols.bal - 4, P.y, 9.5, "bold", P.accent);
  P.y += 16;
  P.poweredFooter();
  return P.bytes();
}

// ------------------------------------------------------------------ dispatcher
/** Build a clean vector A4 PDF for any TallyPay document. */
export async function buildDocumentPdf(input: PdfDocInput): Promise<Uint8Array> {
  switch (input.kind) {
    case "invoice":
    case "quotation":
      return buildInvoicePdf(input.issuer, input.invoice, input.lines, input.client);
    case "receipt":
      return buildReceiptPdf(input);
    case "deliveryNote":
      return buildDeliveryNotePdf(input);
    case "creditNote":
      return buildCreditNotePdf(input);
    case "statement":
      return buildStatementPdf(input);
  }
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
