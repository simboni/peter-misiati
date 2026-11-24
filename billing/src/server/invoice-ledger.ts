import { and, eq, notInArray, sql } from "drizzle-orm";
import { schema, type DB } from "./db";
import { deriveInvoiceStatus } from "./totals";

/**
 * WHAT COUNTS AS MONEY.
 *
 * A draft has not been sent to anybody, so nobody owes it. A void invoice has
 * been cancelled. Neither belongs in "you're owed", "invoiced", profit,
 * receivables ageing or an overdue count.
 *
 * This existed in three places with two different definitions, which is how a
 * dashboard came to claim KES 124,250 owed when the real figure was 46,500:
 * `totalInvoiced` excluded drafts while `outstanding` beside it did not, and
 * Reports excluded neither. An invoicing tool that miscounts is worthless, so
 * every money figure now reads its definition from here.
 *
 * Reminders already agreed with this (see CHASEABLE_STATUSES in reminders.ts),
 * which is why the chase queue was the only screen telling the truth.
 */
export const NON_MONEY_STATUSES = ["draft", "void"] as const;

/** Drizzle filter for the money-bearing invoices of any query. */
export function moneyInvoicesFilter() {
  return notInArray(schema.invoice.status, [...NON_MONEY_STATUSES]);
}

/** The same rule as a SQL fragment, for use inside aggregate CASE expressions. */
export const MONEY_INVOICE_SQL = sql`${schema.invoice.status} NOT IN ('draft','void')`;

/**
 * Recompute an invoice's amountPaid / creditedAmount / balanceDue / status from
 * its payments and applied credit notes. This is the single source of truth for
 * the invoice ledger — payments and credit notes both call it after a change.
 *
 *   effectiveTotal = total − creditedAmount   (what the client actually owes)
 *   balanceDue     = max(0, effectiveTotal − amountPaid)
 */
export async function recomputeInvoice(db: DB, invoiceId: string): Promise<void> {
  const rows = await db.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId)).limit(1);
  const inv = rows[0];
  if (!inv) return;

  const pays = await db
    .select({ amount: schema.payment.amount })
    .from(schema.payment)
    .where(eq(schema.payment.invoiceId, invoiceId));
  const amountPaid = pays.reduce((a, p) => a + p.amount, 0);

  const credits = await db
    .select({ total: schema.creditNote.total })
    .from(schema.creditNote)
    .where(and(eq(schema.creditNote.invoiceId, invoiceId), eq(schema.creditNote.appliedToInvoice, true)));
  const creditedAmount = credits.reduce((a, c) => a + c.total, 0);

  const effectiveTotal = Math.max(0, inv.total - creditedAmount);
  const balanceDue = Math.max(0, effectiveTotal - amountPaid);

  let status: string;
  if (inv.status === "void") {
    status = "void";
  } else if (inv.type !== "invoice") {
    status = inv.status;
  } else if (balanceDue <= 0 && (amountPaid > 0 || creditedAmount > 0)) {
    // Fully settled by payment and/or credit.
    status = "paid";
  } else {
    status = deriveInvoiceStatus({
      type: "invoice",
      currentStatus: inv.status,
      total: effectiveTotal,
      amountPaid,
      dueDate: inv.dueDate,
    });
  }

  await db
    .update(schema.invoice)
    .set({ amountPaid, creditedAmount, balanceDue, status })
    .where(eq(schema.invoice.id, invoiceId));
}
