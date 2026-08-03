import { requireOrg } from "@/server/org";
import { loadEditorData } from "@/server/editor-data";
import { RecurringEditor } from "@/components/recurring-editor";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "New recurring invoice" };

export default async function NewRecurringPage() {
  const ctx = await requireOrg();
  const data = await loadEditorData(ctx);
  return (
    <div>
      <PageHeader title="New recurring invoice" subtitle="Bill a client automatically on a schedule." />
      <RecurringEditor {...data} />
    </div>
  );
}
