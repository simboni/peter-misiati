import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { loadDnEditorData } from "@/server/dn-data";
import { DeliveryNoteEditor } from "@/components/delivery-note-editor";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Edit delivery note" };

export default async function EditDeliveryNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, organizationId } = await requireOrg();
  const rows = await db
    .select()
    .from(schema.deliveryNote)
    .where(and(eq(schema.deliveryNote.id, id), eq(schema.deliveryNote.organizationId, organizationId)))
    .limit(1);
  const note = rows[0];
  if (!note) notFound();

  const [lines, data] = await Promise.all([
    db
      .select()
      .from(schema.deliveryNoteLine)
      .where(eq(schema.deliveryNoteLine.deliveryNoteId, id))
      .orderBy(schema.deliveryNoteLine.sortOrder),
    loadDnEditorData(db, organizationId),
  ]);

  return (
    <div>
      <PageHeader title={`Edit ${note.number}`} />
      <DeliveryNoteEditor
        {...data}
        note={note}
        lines={lines.map((l) => ({
          itemId: l.itemId,
          description: l.description,
          quantityMilli: l.quantityMilli,
          unit: l.unit,
        }))}
      />
    </div>
  );
}
