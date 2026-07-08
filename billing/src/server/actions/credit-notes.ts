"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { allocateNumber } from "@/server/sequence";
import { parseAmount, parseQty, parseRate } from "@/server/money";
import { calcTotals } from "@/server/totals";
import { recomputeInvoice } from "@/server/invoice-ledger";

export type FormState = { error?: string };

type LinePayload = {
  title?: string | null;
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  taxRate: string | number;
};

function parseDate(v: FormDataEntryValue | null): Date {
  const s = String(v ?? "").trim();
  const d = s ? new Date(s) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}

export async function saveCreditNoteAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, organizationId } = await requireOrg();

  const id = String(fd.get("id") ?? "").trim() || null;
  const clientId = String(fd.get("clientId") ?? "").trim();
  if (!clientId) return { error: "Please choose a client." };

  const clientRows = await db
    .select({ id: schema.client.id, currency: schema.client.currency })
    .from(schema.client)
    .where(and(eq(schema.client.id, clientId), eq(schema.client.organizationId, organizationId)))
    .limit(1);
  if (clientRows.length === 0) return { error: "Selected client was not found." };

  // Optional invoice link — must belong to the same org and client.
  const invoiceId = String(fd.get("invoiceId") ?? "").trim() || null;
  if (invoiceId) {
    const inv = await db
      .select({ id: schema.invoice.id, clientId: schema.invoice.clientId })
      .from(schema.invoice)
      .where(and(eq(schema.invoice.id, invoiceId), eq(schema.invoice.organizationId, organizationId), eq(schema.invoice.type, "invoice")))
      .limit(1);
    if (inv.length === 0) return { error: "Linked invoice was not found." };
    if (inv[0].clientId !== clientId) return { error: "The linked invoice belongs to a different client." };
  }

  let rawLines: LinePayload[];
  try {
    rawLines = JSON.parse(String(fd.get("lines") ?? "[]"));
  } catch {
    return { error: "Could not read the line items." };
  }
  const cleaned = rawLines
    .map((l) => ({
      title: String(l.title ?? "").trim() || null,
      description: String(l.description ?? "").trim(),
      quantityMilli: parseQty(l.quantity),
      unitPrice: parseAmount(l.unitPrice),
      taxRateBps: parseRate(l.taxRate),
    }))
    .filter((l) => (l.title || l.description) !== "" && (l.quantityMilli !== 0 || l.unitPrice !== 0));
  if (cleaned.length === 0) return { error: "Add at least one item with a name and an amount." };

  const t = calcTotals({
    lines: cleaned.map((l) => ({ quantityMilli: l.quantityMilli, unitPrice: l.unitPrice, taxRateBps: l.taxRateBps })),
  });

  const currency = String(fd.get("currency") ?? clientRows[0].currency ?? "KES").trim() || "KES";
  const issueDate = parseDate(fd.get("issueDate"));
  const reason = String(fd.get("reason") ?? "").trim() || null;
  const notes = String(fd.get("notes") ?? "").trim() || null;
  const appliedToInvoice = invoiceId != null && String(fd.get("appliedToInvoice") ?? "") === "on";
  const refunded = String(fd.get("refunded") ?? "") === "on";
  const refundMethodRaw = String(fd.get("refundMethod") ?? "cash");
  const refundMethod = refunded
    ? (["cash", "mpesa", "bank", "cheque", "card", "other"].includes(refundMethodRaw) ? refundMethodRaw : "cash")
    : null;
  const refundReference = refunded ? String(fd.get("refundReference") ?? "").trim() || null : null;

  const base = {
    clientId,
    invoiceId,
    issueDate,
    currency,
    reason,
    notes,
    subtotal: t.subtotal,
    taxTotal: t.taxTotal,
    total: t.total,
    appliedToInvoice,
    refunded,
    refundMethod,
    refundReference,
  };

  let creditNoteId = id;
  let previousInvoiceId: string | null = null;

  if (id) {
    const existing = await db
      .select()
      .from(schema.creditNote)
      .where(and(eq(schema.creditNote.id, id), eq(schema.creditNote.organizationId, organizationId)))
      .limit(1);
    if (existing.length === 0) return { error: "Credit note not found." };
    previousInvoiceId = existing[0].invoiceId;
    await db.update(schema.creditNote).set(base).where(eq(schema.creditNote.id, id));
    await db.delete(schema.creditNoteLine).where(eq(schema.creditNoteLine.creditNoteId, id));
  } else {
    const number = await allocateNumber(db, organizationId, "credit_note");
    const inserted = await db
      .insert(schema.creditNote)
      .values({ organizationId, number, shareToken: crypto.randomUUID(), ...base })
      .returning({ id: schema.creditNote.id });
    creditNoteId = inserted[0].id;
  }

  await db.insert(schema.creditNoteLine).values(
    t.lines.map((l, i) => ({
      creditNoteId: creditNoteId!,
      title: cleaned[i].title,
      description: cleaned[i].description,
      quantityMilli: l.quantityMilli,
      unitPrice: l.unitPrice,
      taxRateBps: l.taxRateBps,
      lineSubtotal: l.lineSubtotal,
      taxAmount: l.taxAmount,
      lineTotal: l.lineTotal,
      sortOrder: i,
    })),
  );

  // Refresh the ledger of any invoice this credit affects (old + new link).
  const affected = new Set<string>();
  if (previousInvoiceId) affected.add(previousInvoiceId);
  if (invoiceId) affected.add(invoiceId);
  for (const invId of affected) await recomputeInvoice(db, invId);

  revalidatePath("/credit-notes");
  revalidatePath("/invoices");
  redirect(`/credit-notes/${creditNoteId}`);
}

export async function deleteCreditNoteAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const id = String(fd.get("id") ?? "");
  if (!id) return;
  const rows = await db
    .select({ invoiceId: schema.creditNote.invoiceId })
    .from(schema.creditNote)
    .where(and(eq(schema.creditNote.id, id), eq(schema.creditNote.organizationId, organizationId)))
    .limit(1);
  if (rows.length === 0) return;
  const invoiceId = rows[0].invoiceId;
  await db.delete(schema.creditNoteLine).where(eq(schema.creditNoteLine.creditNoteId, id));
  await db.delete(schema.creditNote).where(and(eq(schema.creditNote.id, id), eq(schema.creditNote.organizationId, organizationId)));
  if (invoiceId) await recomputeInvoice(db, invoiceId);
  revalidatePath("/credit-notes");
  revalidatePath("/invoices");
  redirect("/credit-notes");
}
