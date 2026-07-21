"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { parseAmount, parseQty, parseRate } from "@/server/money";
import type { DepositType, DiscountType } from "@/server/totals";

export type FormState = { error?: string };

type LinePayload = {
  itemId?: string | null;
  title?: string | null;
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  taxRate: string | number;
};

const FREQS = ["weekly", "monthly", "quarterly", "yearly"];

function parseDate(v: FormDataEntryValue | null): Date {
  const s = String(v ?? "").trim();
  const d = s ? new Date(s) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}

export async function saveRecurringAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, organizationId } = await requireOrg();

  const id = String(fd.get("id") ?? "").trim() || null;
  const clientId = String(fd.get("clientId") ?? "").trim();
  if (!clientId) return { error: "Please choose a client." };

  const clientRows = await db
    .select({ id: schema.client.id })
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
      title: String(l.title ?? "").trim() || null,
      description: String(l.description ?? "").trim(),
      quantityMilli: parseQty(l.quantity),
      unitPrice: parseAmount(l.unitPrice),
      taxRateBps: parseRate(l.taxRate),
    }))
    .filter((l) => (l.title || l.description) !== "" && (l.quantityMilli !== 0 || l.unitPrice !== 0));
  if (cleaned.length === 0) return { error: "Add at least one item with a name and a price." };

  const freqRaw = String(fd.get("frequency") ?? "monthly");
  const frequency = FREQS.includes(freqRaw) ? freqRaw : "monthly";
  const interval = Math.max(1, Math.min(52, parseInt(String(fd.get("interval") ?? "1"), 10) || 1));
  const dueDays = Math.max(0, Math.min(365, parseInt(String(fd.get("dueDays") ?? "0"), 10) || 0));
  const startDate = parseDate(fd.get("startDate"));
  const endRaw = String(fd.get("endDate") ?? "").trim();
  const endDate = endRaw ? parseDate(fd.get("endDate")) : null;
  const maxRaw = String(fd.get("maxOccurrences") ?? "").trim();
  const maxOccurrences = maxRaw ? Math.max(1, parseInt(maxRaw, 10) || 0) || null : null;
  const autoSend = String(fd.get("autoSend") ?? "") === "on";
  const title = String(fd.get("title") ?? "").trim() || null;
  const currency = String(fd.get("currency") ?? "KES").trim() || "KES";
  const notes = String(fd.get("notes") ?? "").trim() || null;
  const terms = String(fd.get("terms") ?? "").trim() || null;

  const discountType = (String(fd.get("discountType") ?? "") || null) as DiscountType;
  const discountValue =
    discountType === "percent" ? parseRate(fd.get("discountValue")) : parseAmount(fd.get("discountValue"));
  const depositTypeRaw = String(fd.get("depositType") ?? "none");
  const depositType = (["none", "percent", "fixed"].includes(depositTypeRaw) ? depositTypeRaw : "none") as DepositType;
  const depositValue =
    depositType === "percent" ? parseRate(fd.get("depositValue")) : parseAmount(fd.get("depositValue"));

  const base = {
    clientId,
    title,
    frequency,
    interval,
    startDate,
    endDate,
    maxOccurrences,
    dueDays,
    autoSend,
    currency,
    notes,
    terms,
    discountType: discountType ?? null,
    discountValue,
    depositType,
    depositValue,
  };

  let recurringId = id;

  if (id) {
    const existing = await db
      .select({ id: schema.recurringInvoice.id })
      .from(schema.recurringInvoice)
      .where(and(eq(schema.recurringInvoice.id, id), eq(schema.recurringInvoice.organizationId, organizationId)))
      .limit(1);
    if (existing.length === 0) return { error: "Schedule not found." };
    // Editing keeps the existing nextRunDate/occurrences/status intact.
    await db.update(schema.recurringInvoice).set(base).where(eq(schema.recurringInvoice.id, id));
    await db.delete(schema.recurringInvoiceLine).where(eq(schema.recurringInvoiceLine.recurringInvoiceId, id));
  } else {
    const inserted = await db
      .insert(schema.recurringInvoice)
      .values({ organizationId, nextRunDate: startDate, occurrences: 0, status: "active", ...base })
      .returning({ id: schema.recurringInvoice.id });
    recurringId = inserted[0].id;
  }

  await db.insert(schema.recurringInvoiceLine).values(
    cleaned.map((l, i) => ({
      recurringInvoiceId: recurringId!,
      itemId: l.itemId,
      title: l.title,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unitPrice: l.unitPrice,
      taxRateBps: l.taxRateBps,
      sortOrder: i,
    })),
  );

  revalidatePath("/recurring");
  redirect("/recurring");
}

export async function setRecurringStatusAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const id = String(fd.get("id") ?? "");
  const status = String(fd.get("status") ?? "");
  if (!id || !["active", "paused", "ended"].includes(status)) return;
  await db
    .update(schema.recurringInvoice)
    .set({ status })
    .where(and(eq(schema.recurringInvoice.id, id), eq(schema.recurringInvoice.organizationId, organizationId)));
  revalidatePath("/recurring");
}

export async function deleteRecurringAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const id = String(fd.get("id") ?? "");
  if (!id) return;
  // Confirm the schedule belongs to THIS org before touching its child rows —
  // otherwise a crafted id could delete another org's line items (the parent
  // delete is org-scoped, but the line delete was not).
  const owned = await db
    .select({ id: schema.recurringInvoice.id })
    .from(schema.recurringInvoice)
    .where(and(eq(schema.recurringInvoice.id, id), eq(schema.recurringInvoice.organizationId, organizationId)))
    .limit(1);
  if (!owned[0]) return;
  await db.delete(schema.recurringInvoiceLine).where(eq(schema.recurringInvoiceLine.recurringInvoiceId, id));
  await db
    .delete(schema.recurringInvoice)
    .where(and(eq(schema.recurringInvoice.id, id), eq(schema.recurringInvoice.organizationId, organizationId)));
  revalidatePath("/recurring");
}
