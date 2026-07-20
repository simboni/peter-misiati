import { eq } from "drizzle-orm";
import { schema, type DB } from "./db";
import { allocateNumber } from "./sequence";
import { deriveInvoiceStatus } from "./totals";
import { formatMoney } from "./money";
import { notifyPaymentReceived } from "./push";

type IntentRow = typeof schema.paymentIntent.$inferSelect;

/**
 * Promote a successful payment intent into a real payment (receipt) and update
 * the invoice. Idempotent: safe to call from both the webhook and the poller.
 * Returns the receipt share token (for the client) or null.
 */
export async function settleIntent(
  db: DB,
  intent: IntentRow,
  mpesaReference?: string | null,
): Promise<{ receiptToken: string } | null> {
  // Re-read to avoid double settlement under a webhook + poll race.
  const fresh = await db
    .select()
    .from(schema.paymentIntent)
    .where(eq(schema.paymentIntent.id, intent.id))
    .limit(1);
  const row = fresh[0];
  if (!row) return null;
  if (row.status === "success" && row.paymentId) {
    const p = await db
      .select({ token: schema.payment.shareToken })
      .from(schema.payment)
      .where(eq(schema.payment.id, row.paymentId))
      .limit(1);
    return p[0] ? { receiptToken: p[0].token } : null;
  }

  const invRows = await db
    .select()
    .from(schema.invoice)
    .where(eq(schema.invoice.id, row.invoiceId))
    .limit(1);
  const inv = invRows[0];
  if (!inv) return null;

  const amount = Math.min(row.amount, inv.balanceDue);
  if (amount <= 0) {
    // Nothing left to apply (already settled elsewhere) — close the intent.
    await db
      .update(schema.paymentIntent)
      .set({ status: "success", mpesaReference: mpesaReference ?? row.mpesaReference })
      .where(eq(schema.paymentIntent.id, row.id));
    return null;
  }

  const newPaid = inv.amountPaid + amount;
  const kind = inv.amountPaid === 0 ? (newPaid >= inv.total ? "full" : "deposit") : newPaid >= inv.total ? "balance" : "partial";

  const number = await allocateNumber(db, row.organizationId, "receipt");
  const receiptToken = crypto.randomUUID();
  const inserted = await db
    .insert(schema.payment)
    .values({
      organizationId: row.organizationId,
      invoiceId: row.invoiceId,
      clientId: row.clientId,
      number,
      amount,
      method: "mpesa",
      reference: mpesaReference ?? null,
      paidAt: new Date(),
      kind,
      provider: "kopokopo",
      providerRef: row.providerRef,
      shareToken: receiptToken,
    })
    .returning({ id: schema.payment.id });

  const status = deriveInvoiceStatus({
    type: inv.type as "invoice" | "quotation",
    currentStatus: inv.status,
    total: inv.total,
    amountPaid: newPaid,
    dueDate: inv.dueDate,
  });
  await db
    .update(schema.invoice)
    .set({ amountPaid: newPaid, balanceDue: inv.total - newPaid, status })
    .where(eq(schema.invoice.id, inv.id));

  await db
    .update(schema.paymentIntent)
    .set({
      status: "success",
      paymentId: inserted[0].id,
      mpesaReference: mpesaReference ?? row.mpesaReference,
    })
    .where(eq(schema.paymentIntent.id, row.id));

  // Notify the vendor's devices that money landed (no-op unless push is set up).
  await notifyPaymentReceived(db, row.organizationId, {
    amount: formatMoney(amount, inv.currency),
    invoiceNumber: inv.number,
  });

  return { receiptToken };
}
