import { and, eq, desc } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { PageHeader, EmptyState } from "@/components/page-header";
import { InvoiceListView } from "@/components/invoice-list-view";
import { fmtDate } from "@/server/queries";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  const { db, organizationId } = await requireOrg();
  const rows = await db
    .select({
      id: schema.invoice.id,
      number: schema.invoice.number,
      status: schema.invoice.status,
      issueDate: schema.invoice.issueDate,
      dueDate: schema.invoice.dueDate,
      total: schema.invoice.total,
      balanceDue: schema.invoice.balanceDue,
      amountPaid: schema.invoice.amountPaid,
      currency: schema.invoice.currency,
      shareToken: schema.invoice.shareToken,
      clientName: schema.client.name,
    })
    .from(schema.invoice)
    .leftJoin(schema.client, eq(schema.client.id, schema.invoice.clientId))
    .where(and(eq(schema.invoice.organizationId, organizationId), eq(schema.invoice.type, "invoice")))
    .orderBy(desc(schema.invoice.createdAt));

  const shaped = rows.map((r) => ({
    id: r.id,
    number: r.number,
    client: r.clientName ?? "—",
    date: fmtDate(r.issueDate),
    issueMs: r.issueDate ? new Date(r.issueDate).getTime() : 0,
    status: r.status,
    total: r.total,
    balance: r.balanceDue,
    received: r.amountPaid,
    currency: r.currency,
    shareToken: r.shareToken,
  }));

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Bill clients, track deposits and balances."
        action={{ href: "/invoices/new", label: "New invoice" }}
      />
      {shaped.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          body="Create your first invoice — add a deposit if the client pays a downpayment upfront."
          action={{ href: "/invoices/new", label: "New invoice" }}
        />
      ) : (
        <InvoiceListView rows={shaped} />
      )}
    </div>
  );
}
