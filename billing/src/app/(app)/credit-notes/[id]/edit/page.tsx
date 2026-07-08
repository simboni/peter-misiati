import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { loadCreditNoteEditorData } from "@/server/editor-data";
import { schema } from "@/server/db";
import { CreditNoteEditor } from "@/components/credit-note-editor";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Edit credit note" };

export default async function EditCreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const { db, organizationId } = ctx;

  const rows = await db
    .select()
    .from(schema.creditNote)
    .where(and(eq(schema.creditNote.id, id), eq(schema.creditNote.organizationId, organizationId)))
    .limit(1);
  if (rows.length === 0) notFound();

  const lines = await db
    .select()
    .from(schema.creditNoteLine)
    .where(eq(schema.creditNoteLine.creditNoteId, id))
    .orderBy(schema.creditNoteLine.sortOrder);

  const data = await loadCreditNoteEditorData(ctx);
  return (
    <div>
      <PageHeader title="Edit credit note" subtitle="Update the credit — the linked invoice balance is recalculated." />
      <CreditNoteEditor {...data} creditNote={rows[0]} lines={lines} />
    </div>
  );
}
