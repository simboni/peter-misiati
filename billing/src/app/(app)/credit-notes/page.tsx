import { eq, desc } from "drizzle-orm";
import { requireOrg, getOrgProfile } from "@/server/org";
import { schema } from "@/server/db";
import { PageHeader, EmptyState } from "@/components/page-header";
import { CreditNoteListView } from "@/components/credit-note-list-view";
import { fmtDate } from "@/server/queries";

export const metadata = { title: "Credit notes" };

export default async function CreditNotesPage() {
  const { db, organizationId } = await requireOrg();
  const [rows, profile] = await Promise.all([
    db
      .select({
        id: schema.creditNote.id,
        number: schema.creditNote.number,
        issueDate: schema.creditNote.issueDate,
        reason: schema.creditNote.reason,
        total: schema.creditNote.total,
        currency: schema.creditNote.currency,
        refunded: schema.creditNote.refunded,
        applied: schema.creditNote.appliedToInvoice,
        client: schema.client.name,
        invoiceNumber: schema.invoice.number,
      })
      .from(schema.creditNote)
      .leftJoin(schema.client, eq(schema.client.id, schema.creditNote.clientId))
      .leftJoin(schema.invoice, eq(schema.invoice.id, schema.creditNote.invoiceId))
      .where(eq(schema.creditNote.organizationId, organizationId))
      .orderBy(desc(schema.creditNote.createdAt)),
    getOrgProfile(db, organizationId),
  ]);
  const cur = profile?.currency ?? "KES";

  const shaped = rows.map((r) => ({
    id: r.id,
    number: r.number,
    date: fmtDate(r.issueDate),
    client: r.client ?? "—",
    invoiceNumber: r.invoiceNumber ?? "",
    reason: r.reason ?? "",
    total: r.total,
    currency: r.currency || cur,
    refunded: r.refunded,
    applied: r.applied,
  }));

  return (
    <div>
      <PageHeader
        title="Credit notes"
        subtitle="Credit a client for returns, overcharges or corrections — and reverse the VAT."
        action={{ href: "/credit-notes/new", label: "New credit note" }}
      />
      {shaped.length === 0 ? (
        <EmptyState
          title="No credit notes yet"
          body="Issue a credit note when you need to reduce what a client owes — for returned goods, an overcharge or a cancellation."
          action={{ href: "/credit-notes/new", label: "New credit note" }}
        />
      ) : (
        <CreditNoteListView rows={shaped} />
      )}
    </div>
  );
}
