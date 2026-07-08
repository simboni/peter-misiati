import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { loadEditorData } from "@/server/editor-data";
import { schema } from "@/server/db";
import { RecurringEditor } from "@/components/recurring-editor";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Edit recurring invoice" };

export default async function EditRecurringPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const { db, organizationId } = ctx;

  const rows = await db
    .select()
    .from(schema.recurringInvoice)
    .where(and(eq(schema.recurringInvoice.id, id), eq(schema.recurringInvoice.organizationId, organizationId)))
    .limit(1);
  if (rows.length === 0) notFound();

  const lines = await db
    .select()
    .from(schema.recurringInvoiceLine)
    .where(eq(schema.recurringInvoiceLine.recurringInvoiceId, id))
    .orderBy(schema.recurringInvoiceLine.sortOrder);

  const data = await loadEditorData(ctx);
  return (
    <div>
      <PageHeader title="Edit recurring invoice" subtitle="Changes apply to invoices generated from now on." />
      <RecurringEditor {...data} schedule={rows[0]} lines={lines} />
    </div>
  );
}
