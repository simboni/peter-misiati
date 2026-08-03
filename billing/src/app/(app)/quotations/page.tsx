import { and, eq, desc } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { PageHeader, EmptyState } from "@/components/page-header";
import { QuotationListView } from "@/components/quotation-list-view";
import { fmtDate } from "@/server/queries";

export const metadata = { title: "Quotations" };

export default async function QuotationsPage() {
  const { db, organizationId } = await requireOrg();
  const rows = await db
    .select({
      id: schema.invoice.id,
      number: schema.invoice.number,
      status: schema.invoice.status,
      issueDate: schema.invoice.issueDate,
      total: schema.invoice.total,
      currency: schema.invoice.currency,
      shareToken: schema.invoice.shareToken,
      clientName: schema.client.name,
    })
    .from(schema.invoice)
    .leftJoin(schema.client, eq(schema.client.id, schema.invoice.clientId))
    .where(and(eq(schema.invoice.organizationId, organizationId), eq(schema.invoice.type, "quotation")))
    .orderBy(desc(schema.invoice.createdAt));

  const shaped = rows.map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    date: fmtDate(r.issueDate),
    issueMs: new Date(r.issueDate).getTime(),
    total: r.total,
    currency: r.currency,
    client: r.clientName ?? "—",
    shareToken: r.shareToken,
  }));

  return (
    <div>
      <PageHeader
        title="Quotations"
        subtitle="Send estimates and convert the winners into invoices."
        action={{ href: "/quotations/new", label: "New quotation" }}
      />
      {shaped.length === 0 ? (
        <EmptyState
          title="No quotations yet"
          body="Create a quotation to send an estimate before the work begins."
          action={{ href: "/quotations/new", label: "New quotation" }}
        />
      ) : (
        <QuotationListView rows={shaped} />
      )}
    </div>
  );
}
