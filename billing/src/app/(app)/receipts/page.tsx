import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { PageHeader, EmptyState } from "@/components/page-header";
import { formatMoney } from "@/server/money";
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

  const total = rows.reduce((a, r) => a + r.amount, 0);

  return (
    <div>
      <PageHeader title="Receipts" subtitle="Every payment you've recorded." />
      {rows.length === 0 ? (
        <EmptyState
          title="No receipts yet"
          body="Receipts appear here automatically when you record a payment against an invoice."
          action={{ href: "/invoices", label: "Go to invoices" }}
        />
      ) : (
        <>
          <div className="card mb-4 inline-flex flex-col p-4">
            <span className="text-xs uppercase tracking-wide text-muted">Total received</span>
            <span className="text-2xl font-bold text-ink">{formatMoney(total, rows[0].currency ?? "KES")}</span>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">Receipt</th>
                  <th className="th">Date</th>
                  <th className="th">Client</th>
                  <th className="th">Invoice</th>
                  <th className="th">Method</th>
                  <th className="th text-right">Amount</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-canvas">
                    <td className="td font-medium">{r.number}</td>
                    <td className="td text-muted">{fmtDate(r.paidAt)}</td>
                    <td className="td">{r.clientName ?? "—"}</td>
                    <td className="td">
                      <Link href={`/invoices/${r.invoiceId}`} className="text-brand-700 hover:underline">
                        {r.invoiceNumber ?? "—"}
                      </Link>
                    </td>
                    <td className="td text-muted">
                      {METHOD_LABELS[r.method] ?? r.method}{" "}
                      <span className="capitalize text-xs">({r.kind})</span>
                    </td>
                    <td className="td text-right tabular-nums">{formatMoney(r.amount, r.currency ?? "KES")}</td>
                    <td className="td text-right">
                      <Link href={`/d/${r.shareToken}`} target="_blank" className="btn-ghost btn-sm">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
