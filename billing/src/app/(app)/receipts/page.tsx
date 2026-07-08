import { eq, desc } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { PageHeader, EmptyState } from "@/components/page-header";
import { ReceiptListView } from "@/components/receipt-list-view";
import { fmtDate } from "@/server/queries";

export const metadata = { title: "Receipts" };

const METHOD_LABELS: Record<string, string> = {
  mpesa: "M-Pesa",
  cash: "Cash",
  bank: "Bank transfer",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};

export default async function ReceiptsPage() {
  const { db, organizationId } = await requireOrg();
  const rows = await db
    .select({
      id: schema.payment.id,
      number: schema.payment.number,
      amount: schema.payment.amount,
      method: schema.payment.method,
      kind: schema.payment.kind,
      paidAt: schema.payment.paidAt,
      shareToken: schema.payment.shareToken,
      invoiceId: schema.payment.invoiceId,
      invoiceNumber: schema.invoice.number,
      currency: schema.invoice.currency,
      clientName: schema.client.name,
    })
    .from(schema.payment)
    .leftJoin(schema.invoice, eq(schema.invoice.id, schema.payment.invoiceId))
    .leftJoin(schema.client, eq(schema.client.id, schema.payment.clientId))
    .where(eq(schema.payment.organizationId, organizationId))
    .orderBy(desc(schema.payment.paidAt));

  const shaped = rows.map((r) => ({
    id: r.id,
    number: r.number,
    date: fmtDate(r.paidAt),
    paidMs: new Date(r.paidAt).getTime(),
    client: r.clientName ?? "—",
    invoiceId: r.invoiceId,
    invoiceNumber: r.invoiceNumber ?? "—",
    method: r.method,
    methodLabel: METHOD_LABELS[r.method] ?? r.method,
    kind: r.kind,
    amount: r.amount,
    currency: r.currency ?? "KES",
    shareToken: r.shareToken,
  }));

  return (
    <div>
      <PageHeader title="Receipts" subtitle="Every payment you've recorded." />
      {shaped.length === 0 ? (
        <EmptyState
          title="No receipts yet"
          body="Receipts appear here automatically when you record a payment against an invoice."
          action={{ href: "/invoices", label: "Go to invoices" }}
        />
      ) : (
        <ReceiptListView rows={shaped} />
      )}
    </div>
  );
}
