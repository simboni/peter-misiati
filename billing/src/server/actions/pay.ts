"use server";

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { appBaseUrl } from "@/server/config";
import { kopokopoConfigForOrg } from "@/server/payments-config";
import { initiateStkPush, normalizePhone } from "@/server/kopokopo";

export type PayState = { error?: string; intentId?: string; ok?: boolean };

/**
 * Public: a client on the shared invoice link starts an M-Pesa STK push for a
 * full or partial amount. Scoped by the invoice share token (no login).
 */
export async function startInvoicePaymentAction(_prev: PayState, fd: FormData): Promise<PayState> {
  const token = String(fd.get("token") ?? "");
  const phoneRaw = String(fd.get("phone") ?? "");
  const amountKesRaw = String(fd.get("amount") ?? "");
  if (!token) return { error: "Missing invoice." };

  const db = await getDb();
  const rows = await db.select().from(schema.invoice).where(eq(schema.invoice.shareToken, token)).limit(1);
  const inv = rows[0];
  if (!inv || inv.type !== "invoice") return { error: "Invoice not found." };
  if (inv.status === "void") return { error: "This invoice has been voided." };
  if (inv.balanceDue <= 0) return { error: "This invoice is already fully paid." };

  const cfg = await kopokopoConfigForOrg(db, inv.organizationId);
  if (!cfg) return { error: "M-Pesa payment isn't available for this invoice yet." };

  const phone = normalizePhone(phoneRaw);
  if (!phone) return { error: "Enter a valid Safaricom number, e.g. 0712 345 678." };

  const maxKes = Math.floor(inv.balanceDue / 100);
  const amountKes = Math.floor(Number(String(amountKesRaw).replace(/[^0-9.]/g, "")) || 0);
  if (amountKes <= 0) return { error: "Enter an amount to pay." };
  if (amountKes > maxKes) return { error: `Amount can't exceed the balance of KES ${maxKes.toLocaleString()}.` };

  const clientRows = await db.select().from(schema.client).where(eq(schema.client.id, inv.clientId)).limit(1);
  const client = clientRows[0];

  // Record the attempt before calling out, so the callback can find it.
  const intentId = crypto.randomUUID();
  await db.insert(schema.paymentIntent).values({
    id: intentId,
    organizationId: inv.organizationId,
    invoiceId: inv.id,
    clientId: inv.clientId,
    amount: amountKes * 100,
    phone,
    provider: "kopokopo",
    status: "pending",
  });

  const base = await appBaseUrl();
  const first = (client?.name || "Customer").split(" ")[0];
  const result = await initiateStkPush(cfg, {
    amountKes,
    phone,
    callbackUrl: `${base}/api/mpesa/kopokopo`,
    firstName: first,
    email: client?.email ?? null,
    metadata: { intentId, invoiceId: inv.id, reference: inv.number },
  });

  if (!result.ok) {
    await db
      .update(schema.paymentIntent)
      .set({ status: "failed", errorMessage: result.error })
      .where(eq(schema.paymentIntent.id, intentId));
    return { error: result.error };
  }

  await db
    .update(schema.paymentIntent)
    .set({ providerRef: result.location })
    .where(eq(schema.paymentIntent.id, intentId));

  return { ok: true, intentId };
}
