"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { allocateNumber } from "@/server/sequence";
import { parseAmount } from "@/server/money";
import { recomputeInvoice } from "@/server/invoice-ledger";

export type FormState = { error?: string };

export async function recordPaymentAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, organizationId } = await requireOrg();
  const invoiceId = String(fd.get("invoiceId") ?? "");
  if (!invoiceId) return { error: "Missing invoice." };

  const rows = await db
    .select()
    .from(schema.invoice)
    .where(and(eq(schema.invoice.id, invoiceId), eq(schema.invoice.organizationId, organizationId)))
    .limit(1);
  const inv = rows[0];
  if (!inv || inv.type !== "invoice") return { error: "Invoice not found." };
  if (inv.status === "void") return { error: "This invoice is void." };

  const amount = parseAmount(fd.get("amount"));
  if (amount <= 0) return { error: "Enter an amount greater than zero." };
  if (amount > inv.balanceDue) {
    return { error: `Amount exceeds the outstanding balance of ${(inv.balanceDue / 100).toFixed(2)}.` };
  }

  const methodRaw = String(fd.get("method") ?? "cash");
  const method = ["cash", "mpesa", "bank", "cheque", "card", "other"].includes(methodRaw)
    ? methodRaw
    : "cash";
  const reference = String(fd.get("reference") ?? "").trim() || null;

  // An M-Pesa payment without its transaction code cannot be reconciled
  // against a statement later, and a receipt that omits it is worth little to
  // the client. Every other method keeps the reference optional.
  if (method === "mpesa" && !reference) {
    return { error: "Enter the M-Pesa transaction code (e.g. SHJ4X2YZ01) so this payment can be traced." };
  }
  const note = String(fd.get("note") ?? "").trim() || null;
  const paidRaw = String(fd.get("paidAt") ?? "").trim();
  const paidAt = paidRaw ? new Date(paidRaw) : new Date();

  // Derive the kind of payment for the accountant's records
  const newPaid = inv.amountPaid + amount;
  let kind: string;
  if (inv.amountPaid === 0) {
    kind = newPaid >= inv.total ? "full" : "deposit";
  } else {
    kind = newPaid >= inv.total ? "balance" : "partial";
  }

  const number = await allocateNumber(db, organizationId, "receipt");
  const shareToken = crypto.randomUUID();
  await db.insert(schema.payment).values({
    organizationId,
    invoiceId,
    clientId: inv.clientId,
    number,
    amount,
    method,
    reference,
    paidAt: isNaN(paidAt.getTime()) ? new Date() : paidAt,
    kind,
    note,
    shareToken,
  });

  await recomputeInvoice(db, invoiceId);
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  revalidatePath("/receipts");
  // Land back on the INVOICE, not on the receipt's public share page.
  //
  // That page is the client-facing view: no sidebar, no header, not a single
  // link. Redirecting a signed-in vendor there stranded them — the only way
  // back into TallyPay was the browser's back button. Recording a payment is
  // a routine act done many times a day, and each one was a dead end.
  //
  // The invoice already lists its receipts, so nothing is lost; the banner
  // below carries the receipt's token so it can be viewed or sent in one tap.
  redirect(`/invoices/${invoiceId}?paid=${shareToken}`);
}

export async function deletePaymentAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const id = String(fd.get("id") ?? "");
  if (!id) return;
  const rows = await db
    .select()
    .from(schema.payment)
    .where(and(eq(schema.payment.id, id), eq(schema.payment.organizationId, organizationId)))
    .limit(1);
  if (rows.length === 0) return;
  const invoiceId = rows[0].invoiceId;
  await db.delete(schema.payment).where(eq(schema.payment.id, id));
  await recomputeInvoice(db, invoiceId);
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/receipts");
  redirect(`/invoices/${invoiceId}`);
}
