/**
 * Quotations — the wholesale front door.
 *
 * A wholesale sale starts with a price argument, not with a till. The customer
 * asks what four drums would cost, the owner puts a number in writing, and
 * days later that number is either accepted or it is not. Nothing about that
 * exchange should touch stock, debt or the day's takings, and nothing here
 * does: a quote is a document, and the only thing it can do to the business is
 * turn into a sale.
 *
 * That turn is the important design decision. There is no invoice table here,
 * because this app already has one — a sale, with `/invoice/[id]` printing it,
 * `payments` settling it and `customers` carrying what is still owed. So an
 * approved quote is handed to the same `recordSale()` that every counter sale
 * goes through. From that instant a wholesale bill and a walk-in bill are the
 * same kind of object, which is why credit, part-payment, voiding, day close
 * and the debtors report all work on it without knowing quotes exist.
 *
 * Two ways in, because the shop has two situations:
 *   - price not settled  → quote → share → approve → invoice
 *   - price already agreed → invoice directly, no quote at all
 *
 * The second is not a shortcut bolted on; it is the same `recordSale()` call
 * the first one ends with.
 */

import { all, get, run, tx, audit } from "./db.ts";
import { recordSale, type RecordSaleResult } from "./sales.ts";
import { businessDate, formatQty } from "./units.ts";

export type QuoteStatus = "draft" | "sent" | "approved" | "declined" | "invoiced";

export interface QuoteLineInput {
  itemId: number;
  /** Whole containers. Ignored for a chemical, where the quantity is the order. */
  units: number;
  /** Per container, or per kg / L for a chemical priced by quantity. */
  unitPriceCents: number;
  /**
   * How much substance, in milli, when the item is priced per unit.
   *
   * A wholesale buyer asking for 400 kg of caustic has to be quotable for
   * 400 kg. Before this, a quote could only offer whole rows off the price
   * list, so the answer to "what would four hundred kilos cost me" was a
   * multiplication done on paper and typed back in as a discount.
   */
  qtyMilli?: number;
}

export interface QuoteRow {
  id: number;
  quote_no: string;
  customer_id: number | null;
  customer_name: string;
  status: QuoteStatus;
  note: string;
  valid_until: string;
  sale_id: number | null;
  created_at: string;
  decided_at: string;
  /** Derived, never stored: a total that disagreed with its lines would be a lie. */
  total_cents: number;
  line_count: number;
}

export interface QuoteLineRow {
  id: number;
  item_id: number;
  item_name: string;
  units: number;
  unit_price_cents: number;
  /** Quantity of substance; zero on a line sold whole. */
  qty_milli: number;
  /** Per kg / L; zero on a line sold whole. */
  rate_cents: number;
  price_basis: "pack" | "unit";
  canonical_unit: "kg" | "L" | "pcs";
  /** What the item is normally worth, so a discount is visible as a discount. */
  wholesale_cents: number;
  retail_cents: number;
}

/**
 * How a quote line says its quantity: "3" of something whole, "400 kg" of a
 * chemical. One helper so the screen, the print sheet and the WhatsApp message
 * cannot drift apart on it.
 */
export function quoteLineQty(l: {
  units: number;
  qty_milli: number;
  rate_cents: number;
  canonical_unit: string;
}): string {
  return l.rate_cents > 0 ? formatQty(l.qty_milli, l.canonical_unit) : String(l.units);
}

/** What one quote line comes to. The one place that arithmetic is written. */
export function quoteLineCents(l: {
  units: number;
  unit_price_cents: number;
  qty_milli: number;
  rate_cents: number;
}): number {
  if (l.rate_cents > 0) return Math.round((l.rate_cents * l.qty_milli) / 1000);
  return l.units * l.unit_price_cents;
}

/**
 * QT-20260821-3 — the day it was raised and how many came before it.
 *
 * Human-readable on purpose: this number is read down a phone line and written
 * on a delivery note, so it has to survive being spoken.
 */
export function newQuoteNo(at: Date = new Date()): string {
  const day = businessDate(at);
  const compact = day.replace(/-/g, "");
  const used = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM quotes WHERE quote_no LIKE ?`,
    `QT-${compact}-%`,
  );
  return `QT-${compact}-${(used?.n ?? 0) + 1}`;
}

// The same two line shapes as a sale: a count at a price each, or a quantity at
// a price per kilogram. `rate_cents` is what tells them apart, and the rounding
// lands on the whole line so a quote and the invoice it becomes agree to the
// cent — `quoteLineCents` below is the same arithmetic in TypeScript.
const TOTAL_SQL = `
  COALESCE((SELECT SUM(CASE WHEN l.rate_cents > 0
                            THEN CAST(ROUND(l.rate_cents * l.qty_milli / 1000.0) AS INTEGER)
                            ELSE l.units * l.unit_price_cents END)
              FROM quote_lines l WHERE l.quote_id = q.id), 0) AS total_cents,
  COALESCE((SELECT COUNT(*) FROM quote_lines l WHERE l.quote_id = q.id), 0) AS line_count`;

export function listQuotes(status?: QuoteStatus | "open", limit = 50): QuoteRow[] {
  // "open" is the working set: everything still awaiting a decision or an
  // invoice. It is what the wholesale screen opens on, because a quote nobody
  // has answered is the only kind that needs a person.
  const where =
    status === "open"
      ? `WHERE q.status IN ('draft', 'sent', 'approved')`
      : status
        ? `WHERE q.status = '${status}'`
        : "";
  return all<QuoteRow>(
    `SELECT q.*, ${TOTAL_SQL} FROM quotes q ${where} ORDER BY q.created_at DESC, q.id DESC LIMIT ?`,
    limit,
  );
}

export function getQuote(id: number): QuoteRow | undefined {
  return get<QuoteRow>(`SELECT q.*, ${TOTAL_SQL} FROM quotes q WHERE q.id = ?`, id);
}

export function quoteLines(quoteId: number): QuoteLineRow[] {
  return all<QuoteLineRow>(
    `SELECT l.id, l.item_id, i.name AS item_name, l.units, l.unit_price_cents,
            l.qty_milli, l.rate_cents, i.price_basis, i.canonical_unit,
            i.wholesale_cents, i.retail_cents
       FROM quote_lines l
       JOIN items i ON i.id = l.item_id
      WHERE l.quote_id = ?
      ORDER BY l.sort_order, l.id`,
    quoteId,
  );
}

/**
 * The shape a line actually takes, decided by the item rather than the caller.
 *
 * A form that sent a container count for something sold by the kilogram would
 * otherwise quote a price the sale could never charge. Where no quantity came
 * with the line, the count is read as the quantity — "3" of Ungerol means three
 * kilograms, which is what anybody saying it means.
 */
function normaliseLine(line: QuoteLineInput): {
  units: number;
  unitPriceCents: number;
  qtyMilli: number;
  rateCents: number;
} {
  const item = get<{ price_basis: "pack" | "unit" }>(
    `SELECT price_basis FROM items WHERE id = ?`,
    line.itemId,
  );
  const price = Math.max(0, Math.trunc(line.unitPriceCents));

  if (item?.price_basis !== "unit") {
    return {
      units: Math.max(1, Math.trunc(line.units)),
      unitPriceCents: price,
      qtyMilli: 0,
      rateCents: 0,
    };
  }
  return {
    units: 1,
    unitPriceCents: price,
    qtyMilli: Math.max(1, Math.trunc(line.qtyMilli ?? Math.trunc(line.units) * 1000)),
    rateCents: price,
  };
}

export interface SaveQuoteInput {
  quoteId?: number;
  customerId: number | null;
  customerName: string;
  note: string;
  validUntil: string;
  lines: QuoteLineInput[];
  userId: number;
}

/**
 * Write a quote, new or edited.
 *
 * Lines are replaced wholesale rather than diffed, for the same reason a
 * corrected recipe replaces its ingredient list: a quote is the whole offer,
 * and a partial update is how a line the customer talked you out of survives
 * into the version they accept.
 */
export function saveQuote(input: SaveQuoteInput): { quoteId: number; quoteNo: string } {
  const lines = input.lines.filter((l) => l.itemId > 0 && (l.units > 0 || (l.qtyMilli ?? 0) > 0));
  if (!lines.length) throw new Error("A quote needs at least one line.");
  if (!input.customerName.trim() && input.customerId === null) {
    throw new Error("Say who the quote is for.");
  }

  return tx(() => {
    let quoteId = input.quoteId ?? 0;
    let quoteNo: string;

    if (quoteId) {
      const existing = get<{ status: QuoteStatus; quote_no: string }>(
        `SELECT status, quote_no FROM quotes WHERE id = ?`,
        quoteId,
      );
      if (!existing) throw new Error("That quote no longer exists.");
      // Once it is a sale the numbers are history, and history is not edited
      // here — the sale has its own rules for that.
      if (existing.status === "invoiced") {
        throw new Error("This quote has already become an invoice. Raise a new one.");
      }
      quoteNo = existing.quote_no;
      run(
        `UPDATE quotes SET customer_id = ?, customer_name = ?, note = ?, valid_until = ? WHERE id = ?`,
        input.customerId,
        input.customerName.trim(),
        input.note.trim(),
        input.validUntil.trim(),
        quoteId,
      );
      run(`DELETE FROM quote_lines WHERE quote_id = ?`, quoteId);
    } else {
      quoteNo = newQuoteNo();
      const res = run(
        `INSERT INTO quotes (quote_no, customer_id, customer_name, note, valid_until, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        quoteNo,
        input.customerId,
        input.customerName.trim(),
        input.note.trim(),
        input.validUntil.trim(),
        input.userId,
      );
      quoteId = Number(res.lastInsertRowid);
    }

    let order = 0;
    for (const line of lines) {
      const n = normaliseLine(line);
      run(
        `INSERT INTO quote_lines (quote_id, item_id, units, unit_price_cents, qty_milli, rate_cents, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        quoteId,
        line.itemId,
        n.units,
        n.unitPriceCents,
        n.qtyMilli,
        n.rateCents,
        order++,
      );
    }

    audit(input.userId, input.quoteId ? "quote_edit" : "quote_new", "quote", quoteId,
      `${quoteNo} · ${lines.length} line${lines.length === 1 ? "" : "s"}`);
    return { quoteId, quoteNo };
  });
}

/** Move a quote along: sent, approved, declined. Never to 'invoiced' — only
 *  `invoiceQuote` may do that, because that is the step that writes a sale. */
export function setQuoteStatus(
  quoteId: number,
  status: Exclude<QuoteStatus, "invoiced">,
  userId: number,
): void {
  const q = getQuote(quoteId);
  if (!q) throw new Error("That quote no longer exists.");
  if (q.status === "invoiced") throw new Error("This quote is already an invoice.");
  run(
    `UPDATE quotes SET status = ?, decided_at = ? WHERE id = ?`,
    status,
    status === "draft" || status === "sent" ? "" : new Date().toISOString(),
    quoteId,
  );
  audit(userId, "quote_status", "quote", quoteId, `${q.quote_no} · ${status}`);
}

export interface InvoiceQuoteInput {
  quoteId: number;
  userId: number;
  /** Minted on the device, so a double-tap cannot bill the customer twice. */
  clientUuid: string;
  /** What was handed over now. Nothing here means the whole bill is on credit. */
  tenders?: Array<{ method: "cash" | "mpesa" | "credit"; amountCents: number; ref?: string | null }>;
  /**
   * Prices as finally agreed, if they moved between approval and billing.
   *
   * They do move: a customer approves on Monday, collects on Thursday, and the
   * drum has gone up. Rather than force a new quote for a sale both sides
   * consider settled, the corrected lines are written back onto the quote and
   * then billed — so the quote and the invoice never disagree about what was
   * charged, which is the thing a customer will ring up about.
   */
  lines?: QuoteLineInput[];
  /**
   * The customer to bill, when the quote was raised for a name that was not on
   * the books at the time. Credit has to sit against a record, and the record
   * often only gets written at the moment terms are actually given.
   */
  customerId?: number | null;
}

/**
 * Turn an approved quote into an invoice — which is to say, into a sale.
 *
 * Everything money-shaped that follows (part payment, the debtors list, day
 * close, voiding) is inherited rather than reimplemented, because what comes
 * out the far end of this function is an ordinary sale.
 */
export function invoiceQuote(input: InvoiceQuoteInput): RecordSaleResult & { quoteNo: string } {
  const q = getQuote(input.quoteId);
  if (!q) throw new Error("That quote no longer exists.");
  if (q.status === "invoiced") throw new Error("This quote has already been invoiced.");
  if (q.status === "declined") throw new Error("This quote was declined. Raise a new one.");
  // Approval is the whole point of the document: invoicing an unapproved quote
  // would make the approval step decorative.
  if (q.status !== "approved") throw new Error("The customer has not approved this quote yet.");

  // Written before the sale rather than inside it, because tx() is not
  // re-entrant and recordSale opens its own. If the sale then fails, the quote
  // is left holding the agreed prices and no invoice — which is the harmless
  // way round, and exactly the state the counter would retry from.
  if (input.lines?.length) {
    saveQuote({
      quoteId: input.quoteId,
      customerId: q.customer_id,
      customerName: q.customer_name,
      note: q.note,
      validUntil: q.valid_until,
      lines: input.lines,
      userId: input.userId,
    });
  }

  // Attaching the customer here also mends the quote, so the document and the
  // invoice name the same buyer afterwards.
  const billTo = input.customerId ?? q.customer_id;
  if (input.customerId && input.customerId !== q.customer_id) {
    run(`UPDATE quotes SET customer_id = ? WHERE id = ?`, input.customerId, input.quoteId);
  }

  const lines = quoteLines(input.quoteId);
  if (!lines.length) throw new Error("This quote has no lines.");

  const total = lines.reduce((s, l) => s + quoteLineCents(l), 0);
  const tenders =
    input.tenders && input.tenders.length
      ? input.tenders
      : // No money named means the customer is taking it on account, which is
        // the ordinary wholesale case.
        [{ method: "credit" as const, amountCents: total }];

  const result = recordSale({
    clientUuid: input.clientUuid,
    userId: input.userId,
    tier: "wholesale",
    // A quote is where the price is argued, so by the time it is approved the
    // owner has already agreed to whatever was written — including a figure
    // under the item's floor. Refusing it here would strand an accepted quote
    // that can never be billed. The override is recorded against the owner who
    // invoiced it, so the discount stays traceable in the activity log.
    floorOverrideBy: input.userId,
    customerId: billTo,
    note: `Quote ${q.quote_no}${q.note ? ` · ${q.note}` : ""}`,
    lines: lines.map((l) => ({
      itemId: l.item_id,
      units: l.units,
      unitPriceCents: l.unit_price_cents,
      qtyMilli: l.qty_milli || undefined,
    })),
    tenders: tenders.map((t) => ({
      method: t.method,
      amountCents: t.amountCents,
      mpesaCode: t.ref ?? null,
    })),
  });

  run(
    `UPDATE quotes SET status = 'invoiced', sale_id = ?, decided_at = ? WHERE id = ?`,
    result.saleId,
    new Date().toISOString(),
    input.quoteId,
  );
  audit(input.userId, "quote_invoiced", "quote", input.quoteId, `${q.quote_no} → sale ${result.saleId}`);

  return { ...result, quoteNo: q.quote_no };
}

export interface DirectInvoiceInput {
  customerId: number | null;
  customerName: string;
  note: string;
  lines: QuoteLineInput[];
  tenders?: Array<{ method: "cash" | "mpesa" | "credit"; amountCents: number; ref?: string | null }>;
  userId: number;
  clientUuid: string;
}

/**
 * Bill a wholesale customer with no quote in between.
 *
 * For the case the owner described as prices already being in agreement: a
 * regular buyer on known terms does not need a document proposing what both
 * sides already know. It is the same sale the quote route ends at, minus the
 * proposal — which is why it is thirty lines and not a second subsystem.
 */
export function invoiceDirect(input: DirectInvoiceInput): RecordSaleResult {
  const lines = input.lines.filter((l) => l.itemId > 0 && (l.units > 0 || (l.qtyMilli ?? 0) > 0));
  if (!lines.length) throw new Error("Add a line before invoicing.");

  // An estimate only, to decide what "the whole bill on account" means when no
  // tender was named. `recordSale` recomputes every line from the item itself.
  const total = lines.reduce((s, l) => {
    const n = normaliseLine(l);
    return s + (n.rateCents > 0 ? Math.round((n.rateCents * n.qtyMilli) / 1000) : n.units * n.unitPriceCents);
  }, 0);
  const tenders =
    input.tenders && input.tenders.length
      ? input.tenders
      : [{ method: "credit" as const, amountCents: total }];

  const result = recordSale({
    clientUuid: input.clientUuid,
    userId: input.userId,
    tier: "wholesale",
    customerId: input.customerId,
    note: input.note.trim(),
    // Same reasoning as invoicing a quote: a wholesale price is negotiated, and
    // the person raising the invoice is the person agreeing it.
    floorOverrideBy: input.userId,
    lines: lines.map((l) => {
      const n = normaliseLine(l);
      return {
        itemId: l.itemId,
        units: n.units,
        unitPriceCents: n.unitPriceCents,
        qtyMilli: n.qtyMilli || undefined,
      };
    }),
    tenders: tenders.map((t) => ({
      method: t.method,
      amountCents: t.amountCents,
      mpesaCode: t.ref ?? null,
    })),
  });

  audit(input.userId, "invoice_direct", "sale", result.saleId,
    `${input.customerName || "Wholesale"} · ${lines.length} line${lines.length === 1 ? "" : "s"}`);
  return result;
}
