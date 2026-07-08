import { and, eq } from "drizzle-orm";
import { schema, type DB } from "./db";
import { deriveInvoiceStatus } from "./totals";

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
