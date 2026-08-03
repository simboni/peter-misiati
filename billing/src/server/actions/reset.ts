"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";

export type FormState = { error?: string; ok?: boolean; cleared?: number };

/**
 * Danger zone: delete every INVOICE (and everything that hangs off it) for the
 * current workspace, then reset the invoice + receipt numbering back to 0001.
 * Quotations, clients, items and settings are kept. Requires typing the exact
 * confirmation phrase. Deletes in dependency order so it works whether or not
 * D1 enforces foreign keys.
 */
export async function clearInvoicesAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, organizationId } = await requireOrg();

  if (String(fd.get("confirm") ?? "").trim() !== "DELETE INVOICES") {
    return { error: 'Type DELETE INVOICES exactly to confirm.' };
  }

  // The invoices to remove (type = invoice; quotations are left alone).
  const invoices = await db
    .select({ id: schema.invoice.id })
    .from(schema.invoice)
    .where(and(eq(schema.invoice.organizationId, organizationId), eq(schema.invoice.type, "invoice")));
  const ids = invoices.map((r) => r.id);

  if (ids.length > 0) {
    // 1) Unlink documents that merely reference an invoice (kept, just detached).
    await db
      .update(schema.deliveryNote)
      .set({ invoiceId: null })
      .where(and(eq(schema.deliveryNote.organizationId, organizationId), inArray(schema.deliveryNote.invoiceId, ids)));
    await db
      .update(schema.creditNote)
      .set({ invoiceId: null })
      .where(and(eq(schema.creditNote.organizationId, organizationId), inArray(schema.creditNote.invoiceId, ids)));

    // 2) Remove everything that belongs to an invoice.
    await db.delete(schema.paymentIntent).where(inArray(schema.paymentIntent.invoiceId, ids));
    await db.delete(schema.payment).where(inArray(schema.payment.invoiceId, ids));
    await db.delete(schema.invoiceLine).where(inArray(schema.invoiceLine.invoiceId, ids));

    // 3) The invoices themselves.
    await db.delete(schema.invoice).where(inArray(schema.invoice.id, ids));
  }

  // 4) Restart invoice + receipt numbering at 1 so the next invoice is 0001.
  await db
    .update(schema.numberSequence)
    .set({ nextNumber: 1 })
    .where(
      and(
        eq(schema.numberSequence.organizationId, organizationId),
        inArray(schema.numberSequence.docType, ["invoice", "receipt"]),
      ),
    );

  revalidatePath("/invoices");
  revalidatePath("/receipts");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  return { ok: true, cleared: ids.length };
}
