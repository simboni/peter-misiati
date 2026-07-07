import Link from "next/link";
import { and, eq, desc } from "drizzle-orm";
import { requireOrg, getOrg, getOrgProfile } from "@/server/org";
import { schema } from "@/server/db";
import { formatMoney } from "@/server/money";
import { fmtDate } from "@/server/queries";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/page-header";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { db, organizationId } = await requireOrg();
  const [org, profile] = await Promise.all([
    getOrg(db, organizationId),
    getOrgProfile(db, organizationId),
  ]);
  const cur = profile?.currency ?? "KES";

  const invoices = await db
    .select({
      id: schema.invoice.id,
      number: schema.invoice.number,
      status: schema.invoice.status,
      total: schema.invoice.total,
      balanceDue: schema.invoice.balanceDue,
      dueDate: schema.invoice.dueDate,
      issueDate: schema.invoice.issueDate,
      createdAt: schema.invoice.createdAt,
      clientId: schema.invoice.clientId,
      clientName: schema.client.name,
    })
    .from(schema.invoice)
    .leftJoin(schema.client, eq(schema.client.id, schema.invoice.clientId))
    .where(and(eq(schema.invoice.organizationId, organizationId), eq(schema.invoice.type, "invoice")))
    .orderBy(desc(schema.invoice.createdAt));

  const payments = await db
    .select({ amount: schema.payment.amount, paidAt: schema.payment.paidAt })
    .from(schema.payment)
    .where(eq(schema.payment.organizationId, organizationId));

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const issued = invoices.filter((i) => i.status !== "draft" && i.status !== "void");
  const totalInvoiced = issued.reduce((a, i) => a + i.total, 0);
  const totalPaid = payments.reduce((a, p) => a + p.amount, 0);
  const outstanding = invoices
    .filter((i) => i.status !== "void")
    .reduce((a, i) => a + i.balanceDue, 0);
  const overdueList = invoices.filter(
    (i) => i.status !== "void" && i.balanceDue > 0 && i.dueDate && new Date(i.dueDate) < now,
  );
  const overdue = overdueList.reduce((a, i) => a + i.balanceDue, 0);
  const monthRevenue = payments
    .filter((p) => new Date(p.paidAt) >= monthStart)
    .reduce((a, p) => a + p.amount, 0);

  // Top clients by invoiced value
  const byClient = new Map<string, { name: string; total: number }>();
  for (const i of issued) {
    const k = i.clientId;
    const prev = byClient.get(k) ?? { name: i.clientName ?? "—", total: 0 };
    prev.total += i.total;
    byClient.set(k, prev);
  }
  const topClients = [...byClient.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const recent = invoices.slice(0, 6);

  const cards = [
    { label: "Invoiced", value: totalInvoiced, hint: `${issued.length} issued` },
    { label: "Received", value: totalPaid, hint: "all time" },
    { label: "Outstanding", value: outstanding, hint: "unpaid balances" },
    { label: "Overdue", value: overdue, hint: `${overdueList.length} invoice(s)`, danger: overdue > 0 },
  ];

  const noData = invoices.length === 0 && payments.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Welcome, {org?.name}</h1>
        <p className="mt-1 text-sm text-muted">Here’s where your money stands.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{c.label}</p>
            <p className={`mt-2 text-2xl font-bold ${c.danger ? "text-red-600" : "text-ink"}`}>
              {formatMoney(c.value, cur)}
            </p>
            <p className="mt-1 text-xs text-muted">{c.hint}</p>
          </div>
        ))}
      </div>

      <div className="card flex items-center justify-between p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Revenue this month</p>
          <p className="mt-1 text-xl font-bold text-brand-700">{formatMoney(monthRevenue, cur)}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/invoices/new" className="btn-primary btn-sm">
            New invoice
          </Link>
          <Link href="/quotations/new" className="btn-ghost btn-sm">
            New quotation
          </Link>
        </div>
      </div>

      {noData ? (
        <EmptyState
          title="Let’s get you started"
          body="Add a client, then create your first invoice. Record the deposit and balance as they come in — receipts are generated automatically."
          action={{ href: "/clients/new", label: "Add your first client" }}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="card overflow-hidden">
            <div className="border-b border-line px-5 py-3">
              <h2 className="font-semibold text-ink">Recent invoices</h2>
            </div>
            {recent.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">No invoices yet.</p>
            ) : (
              <table className="w-full">
                <tbody className="divide-y divide-line">
                  {recent.map((r) => (
                    <tr key={r.id} className="hover:bg-canvas">
                      <td className="td">
                        <Link href={`/invoices/${r.id}`} className="font-medium hover:text-brand-700">
                          {r.number}
                        </Link>
                        <span className="ml-2 text-muted">{r.clientName}</span>
                      </td>
                      <td className="td text-muted">{fmtDate(r.issueDate)}</td>
                      <td className="td">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="td text-right tabular-nums">{formatMoney(r.total, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card p-5">
            <h2 className="mb-3 font-semibold text-ink">Top clients</h2>
            {topClients.length === 0 ? (
              <p className="text-sm text-muted">No data yet.</p>
            ) : (
              <ul className="space-y-3">
                {topClients.map((c) => (
                  <li key={c.id} className="flex items-center justify-between text-sm">
                    <Link href={`/clients/${c.id}`} className="text-ink hover:text-brand-700">
                      {c.name}
                    </Link>
                    <span className="tabular-nums font-medium text-ink">{formatMoney(c.total, cur)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
