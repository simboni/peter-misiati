import { requireOrg } from "@/server/org";
import { loadDnEditorData } from "@/server/dn-data";
import { DeliveryNoteEditor } from "@/components/delivery-note-editor";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "New delivery note" };

export default async function NewDeliveryNotePage() {
  const { db, organizationId } = await requireOrg();
  const data = await loadDnEditorData(db, organizationId);
  return (
    <div>
      <PageHeader title="New delivery note" subtitle="Record goods or services delivered to a client." />
      <DeliveryNoteEditor {...data} />
    </div>
  );
}
