import { requireOrg } from "@/server/org";
import { loadCreditNoteEditorData } from "@/server/editor-data";
import { CreditNoteEditor } from "@/components/credit-note-editor";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "New credit note" };

export default async function NewCreditNotePage() {
  const ctx = await requireOrg();
  const data = await loadCreditNoteEditorData(ctx);
  return (
    <div>
      <PageHeader title="New credit note" subtitle="Credit a client and, optionally, reduce an invoice balance." />
      <CreditNoteEditor {...data} />
    </div>
  );
}
