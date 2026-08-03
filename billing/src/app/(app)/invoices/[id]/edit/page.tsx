import { notFound } from "next/navigation";
import { requireOrg } from "@/server/org";
import { loadEditorData } from "@/server/editor-data";
import { loadInvoice } from "@/server/queries";
import { InvoiceEditor } from "@/components/invoice-editor";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const doc = await loadInvoice(ctx.db, ctx.organizationId, id);
  if (!doc || doc.invoice.type !== "invoice") notFound();
  const data = await loadEditorData(ctx);

  return (
    <div>
      <PageHeader title={`Edit ${doc.invoice.number}`} />
      <InvoiceEditor type="invoice" {...data} invoice={doc.invoice} lines={doc.lines} />
    </div>
  );
}
