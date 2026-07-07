import { requireOrg } from "@/server/org";
import { loadEditorData } from "@/server/editor-data";
import { InvoiceEditor } from "@/components/invoice-editor";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage() {
  const ctx = await requireOrg();
  const data = await loadEditorData(ctx);
  return (
    <div>
      <PageHeader title="New invoice" subtitle="Add line items, VAT and a deposit if required." />
      <InvoiceEditor type="invoice" {...data} />
    </div>
  );
}
