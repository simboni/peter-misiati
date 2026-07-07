"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { allocateNumber } from "@/server/sequence";
import { parseAmount, parseQty, parseRate } from "@/server/money";
import { calcTotals, deriveInvoiceStatus, type DepositType, type DiscountType } from "@/server/totals";

export type FormState = { error?: string };

type LinePayload = {
  itemId?: string | null;
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

export async function saveInvoiceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, organizationId } = await requireOrg();

  const id = String(fd.get("id") ?? "").trim() || null;
  const type = String(fd.get("type") ?? "invoice") === "quotation" ? "quotation" : "invoice";
  const clientId = String(fd.get("clientId") ?? "").trim();
  if (!clientId) return { error: "Please choose a client." };

  // Validate client belongs to this org (tenancy)
  const clientRows = await db
    .select({ id: schema.client.id, currency: schema.client.currency })
    .from(schema.client)
    .where(and(eq(schema.client.id, clientId), eq(schema.client.organizationId, organizationId)))
    .limit(1);
  if (clientRows.length === 0) return { error: "Selected client was not found." };

  let rawLines: LinePayload[];
  try {
    rawLines = JSON.parse(String(fd.get("lines") ?? "[]"));
  } catch {
    return { error: "Could not read the line items." };
  }
  const cleaned = rawLines
    .map((l) => ({
      itemId: l.itemId || null,
      description: String(l.description ?? "").trim(),
      quantityMilli: parseQty(l.quantity),
      unitPrice: parseAmount(l.unitPrice),
      taxRateBps: parseRate(l.taxRate),
    }))
    .filter((l) => l.description !== "" && (l.quantityMilli !== 0 || l.unitPrice !== 0));
  if (cleaned.length === 0) return { error: "Add at least one line item with a description." };

  const discountType = (String(fd.get("discountType") ?? "") || null) as DiscountType;
  const discountValue =
    discountType === "percent" ? parseRate(fd.get("discountValue")) : parseAmount(fd.get("discountValue"));
  const depositTypeRaw = String(fd.get("depositType") ?? "none");
  const depositType = (["none", "percent", "fixed"].includes(depositTypeRaw)
    ? depositTypeRaw
    : "none") as DepositType;
  const depositValue =
    depositType === "percent" ? parseRate(fd.get("depositValue")) : parseAmount(fd.get("depositValue"));

  const t = calcTotals({
    lines: cleaned,
    discountType,
    discountValue,
    depositType,
    depositValue,
  });

  const currency = String(fd.get("currency") ?? "KES").trim() || "KES";
  const issueDate = parseDate(fd.get("issueDate"));
  const dueRaw = String(fd.get("dueDate") ?? "").trim();
  const dueDate = dueRaw ? parseDate(fd.get("dueDate")) : null;
  const notes = String(fd.get("notes") ?? "").trim() || null;
  const terms = String(fd.get("terms") ?? "").trim() || null;

  const base = {
    clientId,
    type,
    issueDate,
    dueDate,
    currency,
    notes,
    terms,
    discountType: discountType ?? null,
    discountValue,
    depositType,
    depositValue,
    depositAmount: t.depositAmount,
    subtotal: t.subtotal,
    discountAmount: t.discountAmount,
    taxTotal: t.taxTotal,
    total: t.total,
  };

  let invoiceId = id;

  if (id) {
    // Update existing (must belong to org)
    const existing = await db
      .select()
      .from(schema.invoice)
      .where(and(eq(schema.invoice.id, id), eq(schema.invoice.organizationId, organizationId)))
      .limit(1);
    if (existing.length === 0) return { error: "Document not found." };
    const inv = existing[0];
    const status = deriveInvoiceStatus({
      type,
      currentStatus: inv.status,
      total: t.total,
      amountPaid: inv.amountPaid,
      dueDate,
    });
    await db
      .update(schema.invoice)
      .set({ ...base, balanceDue: t.total - inv.amountPaid, status })
      .where(eq(schema.invoice.id, id));
    await db.delete(schema.invoiceLine).where(eq(schema.invoiceLine.invoiceId, id));
  } else {
    const number = await allocateNumber(db, organizationId, type);
    const inserted = await db
      .insert(schema.invoice)
      .values({
        organizationId,
        number,
        status: "draft",
        amountPaid: 0,
        balanceDue: t.total,
        shareToken: crypto.randomUUID(),
        ...base,
      })
      .returning({ id: schema.invoice.id });
    invoiceId = inserted[0].id;
  }

  // (Re)insert lines
  await db.insert(schema.invoiceLine).values(
    t.lines.map((l, i) => ({
      invoiceId: invoiceId!,
      itemId: cleaned[i].itemId,
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

  revalidatePath("/invoices");
  revalidatePath("/quotations");
  redirect(`/${type === "quotation" ? "quotations" : "invoices"}/${invoiceId}`);
}

export async function setInvoiceStatusAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const id = String(fd.get("id") ?? "");
  const status = String(fd.get("status") ?? "");
  const allowed = ["draft", "sent", "void", "accepted", "declined"];
  if (!id || !allowed.includes(status)) return;

  const set: Record<string, unknown> = { status };
  if (status === "sent") set.sentAt = new Date();
  await db
    .update(schema.invoice)
    .set(set)
    .where(and(eq(schema.invoice.id, id), eq(schema.invoice.organizationId, organizationId)));
  revalidatePath(`/invoices/${id}`);
  revalidatePath(`/quotations/${id}`);
  revalidatePath("/invoices");
  revalidatePath("/quotations");
}

/** Convert a quotation into a new invoice, copying client, lines, discount & deposit. */
export async function convertQuotationAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const id = String(fd.get("id") ?? "");
  if (!id) return;

  const rows = await db
    .select()
    .from(schema.invoice)
    .where(
      and(
        eq(schema.invoice.id, id),
        eq(schema.invoice.organizationId, organizationId),
        eq(schema.invoice.type, "quotation"),
      ),
    )
    .limit(1);
  if (rows.length === 0) return;
  const q = rows[0];
  const lines = await db
    .select()
    .from(schema.invoiceLine)
    .where(eq(schema.invoiceLine.invoiceId, id))
    .orderBy(schema.invoiceLine.sortOrder);

  const number = await allocateNumber(db, organizationId, "invoice");
  const inserted = await db
    .insert(schema.invoice)
    .values({
      organizationId,
      clientId: q.clientId,
      number,
      type: "invoice",
      status: "draft",
      issueDate: new Date(),
      dueDate: null,
      currency: q.currency,
      notes: q.notes,
      terms: q.terms,
      discountType: q.discountType,
      discountValue: q.discountValue,
      depositType: q.depositType,
      depositValue: q.depositValue,
      depositAmount: q.depositAmount,
      subtotal: q.subtotal,
      discountAmount: q.discountAmount,
      taxTotal: q.taxTotal,
      total: q.total,
      amountPaid: 0,
      balanceDue: q.total,
      shareToken: crypto.randomUUID(),
      convertedFromId: q.id,
    })
    .returning({ id: schema.invoice.id });
  const newId = inserted[0].id;

  if (lines.length > 0) {
    await db.insert(schema.invoiceLine).values(
      lines.map((l) => ({
        invoiceId: newId,
        itemId: l.itemId,
        description: l.description,
        quantityMilli: l.quantityMilli,
        unitPrice: l.unitPrice,
        taxRateBps: l.taxRateBps,
        lineSubtotal: l.lineSubtotal,
        taxAmount: l.taxAmount,
        lineTotal: l.lineTotal,
        sortOrder: l.sortOrder,
      })),
    );
  }

  // mark the quotation accepted
  await db.update(schema.invoice).set({ status: "accepted" }).where(eq(schema.invoice.id, id));
  revalidatePath("/invoices");
  redirect(`/invoices/${newId}`);
}

export async function deleteInvoiceAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const id = String(fd.get("id") ?? "");
  const type = String(fd.get("type") ?? "invoice");
  if (!id) return;
  // Only allow deleting drafts (paid/partial docs are financial records)
  const rows = await db
    .select({ status: schema.invoice.status, amountPaid: schema.invoice.amountPaid })
    .from(schema.invoice)
    .where(and(eq(schema.invoice.id, id), eq(schema.invoice.organizationId, organizationId)))
    .limit(1);
  if (rows.length === 0 || rows[0].amountPaid > 0) {
    redirect(`/${type === "quotation" ? "quotations" : "invoices"}/${id}?error=cannot-delete`);
  }
  await db.delete(schema.invoiceLine).where(eq(schema.invoiceLine.invoiceId, id));
  await db
    .delete(schema.invoice)
    .where(and(eq(schema.invoice.id, id), eq(schema.invoice.organizationId, organizationId)));
  revalidatePath("/invoices");
  revalidatePath("/quotations");
  redirect(type === "quotation" ? "/quotations" : "/invoices");
}
