/**
 * Printer settings, and turning a sale into something printable.
 *
 * The thermal printer belongs to the shop, not to the phone: paper width, the
 * header the owner wants at the top, the footer, and whether a receipt should
 * print itself the moment a sale is taken. Keeping those in the database rather
 * than in the browser means a replacement phone — or a second one on the
 * counter — is already configured the first time it opens the app.
 *
 * `schema.sql` belongs to another module, so the small key/value table is
 * created here idempotently, the same way `credit.ts` adds its column.
 *
 * Nothing here imports from `next/*`, so it runs under plain Node in tests.
 */

import { all, get, run, audit, db } from "./db.ts";
import { BUSINESS, type Invoice } from "./credit.ts";
import { lineDiscountCents } from "./sales.ts";
import { formatDateTime, formatQty } from "./units.ts";
import { isPaperWidth, type PaperWidth, type Receipt, type ReceiptLine } from "./escpos.ts";

// ------------------------------------------------------------- migration

let migrated = false;

/**
 * A generic `settings` table rather than `printer_settings`: the shop will want
 * one or two more knobs (an eTIMS endpoint, a till float) and a key/value row is
 * cheaper than a migration each time.
 */
export function ensureSettingsSchema(): void {
  if (migrated) return;
  db(); // schema.sql must have run first

  run(
    `CREATE TABLE IF NOT EXISTS settings (
       key        TEXT PRIMARY KEY,
       value      TEXT NOT NULL,
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  );
  migrated = true;
}

// ------------------------------------------------------------- key/value

export function getSetting(key: string): string | undefined {
  ensureSettingsSchema();
  return get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, key)?.value;
}

export function setSetting(key: string, value: string): void {
  ensureSettingsSchema();
  run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value,
  );
}

export function allSettings(): Record<string, string> {
  ensureSettingsSchema();
  const rows = all<{ key: string; value: string }>(`SELECT key, value FROM settings`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// -------------------------------------------------------------- printing

const KEY = {
  paper: "printer.paper",
  header: "printer.header",
  footer: "printer.footer",
  auto: "printer.auto",
} as const;

export interface PrintSettings {
  paper: PaperWidth;
  /** Shop name first, then whatever the owner wants under it. */
  header: string[];
  footer: string;
  /** Print without being asked once a sale is recorded, if a printer is paired. */
  autoPrint: boolean;
}

export interface PrintSettingsInput {
  paper?: number | string;
  /** One line per line of paper; typed into a textarea. */
  header?: string;
  footer?: string;
  autoPrint?: boolean;
}

/** At most six header lines — more than that and the receipt is mostly letterhead. */
export const MAX_HEADER_LINES = 6;

/**
 * What the shop gets before anyone visits the setup screen: the same identity
 * the A5 invoice prints, so the two documents never disagree.
 */
export function defaultPrintSettings(): PrintSettings {
  return {
    paper: 58,
    header: [BUSINESS.name, BUSINESS.address, BUSINESS.phone, BUSINESS.kraPin ? `PIN ${BUSINESS.kraPin}` : ""]
      .map((l) => l.trim())
      .filter(Boolean),
    footer: "Asante sana for your business.",
    autoPrint: false,
  };
}

function headerLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_HEADER_LINES);
}

export function getPrintSettings(): PrintSettings {
  ensureSettingsSchema();
  const fallback = defaultPrintSettings();

  const paperRaw = Number(getSetting(KEY.paper));
  const headerRaw = getSetting(KEY.header);
  const footerRaw = getSetting(KEY.footer);

  return {
    paper: isPaperWidth(paperRaw) ? paperRaw : fallback.paper,
    header: headerRaw === undefined ? fallback.header : headerLines(headerRaw),
    footer: footerRaw === undefined ? fallback.footer : footerRaw.trim(),
    autoPrint: getSetting(KEY.auto) === "1",
  };
}

export function savePrintSettings(input: PrintSettingsInput, userId?: number | null): PrintSettings {
  ensureSettingsSchema();

  const paper = Number(input.paper);
  if (!isPaperWidth(paper)) {
    throw new Error("Choose either 58 mm or 80 mm paper — those are the two sizes the printer takes.");
  }

  const header = headerLines(String(input.header ?? ""));
  if (!header.length) {
    throw new Error("The first header line is the shop's name — a receipt needs it.");
  }

  setSetting(KEY.paper, String(paper));
  setSetting(KEY.header, header.join("\n"));
  setSetting(KEY.footer, String(input.footer ?? "").trim());
  setSetting(KEY.auto, input.autoPrint ? "1" : "0");

  audit(userId ?? null, "printer_settings_save", "settings", null, `${paper} mm, ${header.length} header line(s)`);

  return getPrintSettings();
}

// --------------------------------------------------------------- receipt

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  mpesa: "M-Pesa",
  credit: "On credit",
};

/**
 * A sale as a printable receipt.
 *
 * Every figure comes from the snapshot columns `getInvoice` already read off
 * `sale_lines` — `name_snapshot`, `unit_price_cents`, `line_total_cents`. The
 * thermal copy and the A5 copy of the same sale must show the same money years
 * later, which a fresh join to `items` would quietly break the first time a
 * price moves.
 */
export function receiptFromInvoice(invoice: Invoice, settings: PrintSettings): Receipt {
  const { sale, lines, tenders, balanceCents, subtotalCents, discountCents } = invoice;

  const items: ReceiptLine[] = lines.map((l) => ({
    name: l.name_snapshot,
    units: l.units,
    unitPriceCents: l.unit_price_cents,
    lineTotalCents: l.line_total_cents,
    qty: l.canonical_unit ? formatQty(l.qty_milli, l.canonical_unit) : null,
    rateCents: l.rate_cents ?? 0,
    rateUnit: l.canonical_unit ?? null,
    listPriceCents: l.list_price_cents ?? 0,
    discountCents: lineDiscountCents(l),
  }));

  return {
    header: settings.header,
    // The word at the top is the one the customer needs: a receipt is proof of
    // payment, an invoice is a demand for it.
    title: balanceCents > 0 ? "INVOICE" : "RECEIPT",
    invoiceNo: sale.invoice_no ?? `#${sale.id}`,
    dateTime: formatDateTime(sale.at),
    customer: sale.customer_name,
    servedBy: sale.user_name,
    lines: items,
    subtotalCents,
    discountCents,
    totalCents: sale.total_cents,
    paidCents: sale.paid_cents,
    balanceCents,
    tenders: tenders.map((t) => ({
      label: METHOD_LABEL[t.method] ?? t.method,
      amountCents: t.amount_cents,
      codes: t.codes,
    })),
    note:
      balanceCents > 0
        ? `Goods remain the property of ${BUSINESS.name} until paid in full.`
        : sale.note || null,
    footer: settings.footer,
    voided: sale.status === "voided",
  };
}
