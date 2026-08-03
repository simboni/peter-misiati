"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { chunkRows } from "@/server/d1-limits";
import { allocateNumber } from "@/server/sequence";
import { parseQty } from "@/server/money";

export type FormState = { error?: string };

type LinePayload = {
  itemId?: string | null;
  description: string;
  quantity: string | number;
  unit: string;
};

export async function saveDeliveryNoteAction(_prev: FormState, fd: FormData): Promise<FormState> {
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
      description: String(l.description ?? "").trim(),
      quantityMilli: parseQty(l.quantity),
      unit: String(l.unit ?? "unit").trim() || "unit",
    }))
    .filter((l) => l.description !== "");
  if (cleaned.length === 0) return { error: "Add at least one item to deliver." };

  const dateRaw = String(fd.get("deliveryDate") ?? "").trim();
  const deliveryDate = dateRaw ? new Date(dateRaw) : new Date();
  const invoiceId = String(fd.get("invoiceId") ?? "").trim() || null;
  const receivedBy = String(fd.get("receivedBy") ?? "").trim() || null;
  const notes = String(fd.get("notes") ?? "").trim() || null;
  const status = String(fd.get("status") ?? "draft") === "delivered" ? "delivered" : "draft";

  let noteId = id;

  const lineRows = (docId: string) =>
    cleaned.map((l, i) => ({
      deliveryNoteId: docId,
      itemId: l.itemId,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unit: l.unit,
      sortOrder: i,
    }));

  // Header + line writes commit as one atomic batch (see d1-limits.ts).
  try {
    if (id) {
      const existing = await db
        .select({ id: schema.deliveryNote.id })
        .from(schema.deliveryNote)
        .where(and(eq(schema.deliveryNote.id, id), eq(schema.deliveryNote.organizationId, organizationId)))
        .limit(1);
      if (existing.length === 0) return { error: "Delivery note not found." };
      await db.batch([
        db
          .update(schema.deliveryNote)
          .set({
            clientId,
            deliveryDate: isNaN(deliveryDate.getTime()) ? new Date() : deliveryDate,
            invoiceId,
            receivedBy,
            notes,
            status,
          })
          .where(eq(schema.deliveryNote.id, id)),
        db.delete(schema.deliveryNoteLine).where(eq(schema.deliveryNoteLine.deliveryNoteId, id)),
        ...chunkRows(lineRows(id)).map((c) => db.insert(schema.deliveryNoteLine).values(c)),
      ]);
    } else {
      const number = await allocateNumber(db, organizationId, "delivery_note");
      noteId = crypto.randomUUID();
      await db.batch([
        db.insert(schema.deliveryNote).values({
          id: noteId,
          organizationId,
          clientId,
          number,
          deliveryDate: isNaN(deliveryDate.getTime()) ? new Date() : deliveryDate,
          invoiceId,
          receivedBy,
          notes,
          status,
          shareToken: crypto.randomUUID(),
        }),
        ...chunkRows(lineRows(noteId)).map((c) => db.insert(schema.deliveryNoteLine).values(c)),
      ]);
    }
  } catch (e) {
    console.error("saveDeliveryNoteAction failed", e);
    return { error: "Something went wrong saving the delivery note — nothing was changed. Please try again." };
  }

  revalidatePath("/delivery-notes");
  redirect(`/delivery-notes/${noteId}`);
}

export async function deleteDeliveryNoteAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const id = String(fd.get("id") ?? "");
  if (!id) return;
  // Confirm ownership before deleting child rows (the line delete is not
  // org-scoped on its own, so a foreign id could wipe another org's lines).
  const owned = await db
    .select({ id: schema.deliveryNote.id })
    .from(schema.deliveryNote)
    .where(and(eq(schema.deliveryNote.id, id), eq(schema.deliveryNote.organizationId, organizationId)))
    .limit(1);
  if (!owned[0]) redirect("/delivery-notes");
  await db.delete(schema.deliveryNoteLine).where(eq(schema.deliveryNoteLine.deliveryNoteId, id));
  await db
    .delete(schema.deliveryNote)
    .where(and(eq(schema.deliveryNote.id, id), eq(schema.deliveryNote.organizationId, organizationId)));
  revalidatePath("/delivery-notes");
  redirect("/delivery-notes");
}
