import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { PageHeader, EmptyState } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
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
      clientName: schema.client.name,
    })
    .from(schema.deliveryNote)
    .leftJoin(schema.client, eq(schema.client.id, schema.deliveryNote.clientId))
    .where(eq(schema.deliveryNote.organizationId, organizationId))
    .orderBy(desc(schema.deliveryNote.createdAt));

  return (
    <div>
      <PageHeader
        title="Delivery Notes"
        subtitle="Confirm what you delivered — standalone or linked to an invoice."
        action={{ href: "/delivery-notes/new", label: "New delivery note" }}
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No delivery notes yet"
          body="Create a delivery note to record goods or services handed over to a client."
          action={{ href: "/delivery-notes/new", label: "New delivery note" }}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line">
              <tr>
                <th className="th">Number</th>
                <th className="th">Client</th>
                <th className="th">Date</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-canvas">
                  <td className="td font-medium">
                    <Link href={`/delivery-notes/${r.id}`} className="hover:text-brand-700">
                      {r.number}
                    </Link>
                  </td>
                  <td className="td">{r.clientName ?? "—"}</td>
                  <td className="td text-muted">{fmtDate(r.deliveryDate)}</td>
                  <td className="td">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
