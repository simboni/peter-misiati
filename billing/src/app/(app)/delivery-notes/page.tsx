import { eq, desc } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { PageHeader, EmptyState } from "@/components/page-header";
import { DeliveryNoteListView } from "@/components/delivery-note-list-view";
import { fmtDate } from "@/server/queries";

export const metadata = { title: "Delivery Notes" };

export default async function DeliveryNotesPage() {
  const { db, organizationId } = await requireOrg();
  const rows = await db
    .select({
      id: schema.deliveryNote.id,
      number: schema.deliveryNote.number,
      status: schema.deliveryNote.status,
      deliveryDate: schema.deliveryNote.deliveryDate,
      shareToken: schema.deliveryNote.shareToken,
      clientName: schema.client.name,
    })
    .from(schema.deliveryNote)
    .leftJoin(schema.client, eq(schema.client.id, schema.deliveryNote.clientId))
    .where(eq(schema.deliveryNote.organizationId, organizationId))
    .orderBy(desc(schema.deliveryNote.createdAt));

  const shaped = rows.map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    date: fmtDate(r.deliveryDate),
    dateMs: new Date(r.deliveryDate).getTime(),
    client: r.clientName ?? "—",
    shareToken: r.shareToken,
  }));

  return (
    <div>
      <PageHeader
        title="Delivery Notes"
        subtitle="Confirm what you delivered — standalone or linked to an invoice."
        action={{ href: "/delivery-notes/new", label: "New delivery note" }}
      />
      {shaped.length === 0 ? (
        <EmptyState
          title="No delivery notes yet"
          body="Create a delivery note to record goods or services handed over to a client."
          action={{ href: "/delivery-notes/new", label: "New delivery note" }}
        />
      ) : (
        <DeliveryNoteListView rows={shaped} />
      )}
    </div>
  );
}
