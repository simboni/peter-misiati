import Link from "next/link";
import { and, eq, desc } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { PageHeader, EmptyState } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { formatMoney } from "@/server/money";
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
      clientName: schema.client.name,
    })
    .from(schema.invoice)
    .leftJoin(schema.client, eq(schema.client.id, schema.invoice.clientId))
    .where(and(eq(schema.invoice.organizationId, organizationId), eq(schema.invoice.type, "quotation")))
    .orderBy(desc(schema.invoice.createdAt));

  return (
    <div>
      <PageHeader
        title="Quotations"
        subtitle="Send estimates and convert the winners into invoices."
        action={{ href: "/quotations/new", label: "New quotation" }}
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No quotations yet"
          body="Create a quotation to send an estimate before the work begins."
          action={{ href: "/quotations/new", label: "New quotation" }}
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
                <th className="th text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-canvas">
                  <td className="td font-medium">
                    <Link href={`/quotations/${r.id}`} className="hover:text-brand-700">
                      {r.number}
                    </Link>
                  </td>
                  <td className="td">{r.clientName ?? "—"}</td>
                  <td className="td text-muted">{fmtDate(r.issueDate)}</td>
                  <td className="td">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="td text-right tabular-nums">{formatMoney(r.total, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
