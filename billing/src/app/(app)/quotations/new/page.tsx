import { requireOrg } from "@/server/org";
import { loadEditorData } from "@/server/editor-data";
import { InvoiceEditor } from "@/components/invoice-editor";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "New quotation" };

export default async function NewQuotationPage() {
  const ctx = await requireOrg();
  const data = await loadEditorData(ctx);
  return (
    <div>
      <PageHeader title="New quotation" subtitle="Send an estimate before the work begins." />
      <InvoiceEditor type="quotation" {...data} />
    </div>
  );
}
