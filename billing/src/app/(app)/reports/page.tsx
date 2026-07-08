export const dynamic = "force-dynamic";
import Link from "next/link";
import { and, eq, ne } from "drizzle-orm";
import { requireOrg, getOrgProfile } from "@/server/org";
import { schema } from "@/server/db";
import { PageHeader } from "@/components/page-header";
import { formatMoney } from "@/server/money";

export const metadata = { title: "Reports" };

type Period = "month" | "year" | "all";
const PERIODS: { key: Period; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
];

function startOf(period: Period): number {
  const n = new Date();
  if (period === "month") return new Date(n.getFullYear(), n.getMonth(), 1).getTime();
  if (period === "year") return new Date(n.getFullYear(), 0, 1).getTime();
  return 0;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  const period: Period = sp.period === "month" || sp.period === "all" ? sp.period : "year";
  const from = startOf(period);

  const { db, organizationId } = await requireOrg();
  const [invoices, payments, expenses, profile] = await Promise.all([
    db
      .select({
        total: schema.invoice.total,
        taxTotal: schema.invoice.taxTotal,
        balanceDue: schema.invoice.balanceDue,
        issueDate: schema.invoice.issueDate,
        dueDate: schema.invoice.dueDate,
        client: schema.client.name,
      })
      .from(schema.invoice)
      .leftJoin(schema.client, eq(schema.client.id, schema.invoice.clientId))
      .where(and(eq(schema.invoice.organizationId, organizationId), eq(schema.invoice.type, "invoice"), ne(schema.invoice.status, "void"))),
    db.select({ amount: schema.payment.amount, paidAt: schema.payment.paidAt }).from(schema.payment).where(eq(schema.payment.organizationId, organizationId)),
    db.select({ amount: schema.expense.amount, taxAmount: schema.expense.taxAmount, category: schema.expense.category, date: schema.expense.expenseDate }).from(schema.expense).where(eq(schema.expense.organizationId, organizationId)),
    getOrgProfile(db, organizationId),
  ]);
  const cur = profile?.currency ?? "KES";
  const m = (n: number) => formatMoney(n, cur);

  const inPeriod = (d: Date | null | undefined) => (d ? new Date(d).getTime() >= from : false);

  const inv = invoices.filter((r) => inPeriod(r.issueDate));
  const pay = payments.filter((r) => inPeriod(r.paidAt));
  const exp = expenses.filter((r) => inPeriod(r.date));

  const invoiced = inv.reduce((s, r) => s + r.total, 0);
  const collected = pay.reduce((s, r) => s + r.amount, 0);
  const expenseTotal = exp.reduce((s, r) => s + r.amount, 0);
  const outstanding = invoices.reduce((s, r) => s + r.balanceDue, 0); // outstanding is always "as of now"
  const outputVat = inv.reduce((s, r) => s + r.taxTotal, 0);
  const inputVat = exp.reduce((s, r) => s + r.taxAmount, 0);
  const netProfit = invoiced - expenseTotal;

  // Receivables aging (as of now, all unpaid invoices)
  const now = Date.now();
  const buckets = [
    { label: "Not due yet", lo: -Infinity, hi: 0, amt: 0 },
    { label: "1–30 days", lo: 1, hi: 30, amt: 0 },
    { label: "31–60 days", lo: 31, hi: 60, amt: 0 },
    { label: "61–90 days", lo: 61, hi: 90, amt: 0 },
    { label: "90+ days", lo: 91, hi: Infinity, amt: 0 },
  ];
  for (const r of invoices) {
    if (r.balanceDue <= 0) continue;
    const due = r.dueDate ? new Date(r.dueDate).getTime() : r.issueDate ? new Date(r.issueDate).getTime() : now;
    const days = Math.floor((now - due) / 86_400_000);
    const b = buckets.find((x) => days >= x.lo && days <= x.hi) ?? buckets[0];
    b.amt += r.balanceDue;
  }

  // Top clients by invoiced
  const byClient = new Map<string, number>();
  for (const r of inv) byClient.set(r.client ?? "—", (byClient.get(r.client ?? "—") ?? 0) + r.total);
  const topClients = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Expenses by category
  const byCat = new Map<string, number>();
  for (const r of exp) byCat.set(r.category ?? "Uncategorised", (byCat.get(r.category ?? "Uncategorised") ?? 0) + r.amount);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const catMax = Math.max(1, ...cats.map(([, v]) => v));

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" subtitle="How the business is doing — income, costs, profit and who owes you." />

      {/* Period selector */}
      <div className="inline-flex rounded-lg border border-line bg-white p-1">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={`/reports?period=${p.key}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${period === p.key ? "bg-brand-600 text-white" : "text-muted hover:text-ink"}`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Invoiced" value={m(invoiced)} />
        <Kpi label="Collected" value={m(collected)} tone="brand" />
        <Kpi label="Outstanding (now)" value={m(outstanding)} tone={outstanding > 0 ? "warn" : "default"} />
        <Kpi label="Expenses" value={m(expenseTotal)} />
        <Kpi label="Net profit" value={m(netProfit)} tone={netProfit >= 0 ? "brand" : "warn"} sub="invoiced − expenses" />
        <Kpi label="Net VAT" value={m(outputVat - inputVat)} sub={`out ${m(outputVat)} · in ${m(inputVat)}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Receivables aging */}
        <section className="card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Receivables aging</h2>
          <p className="mb-3 text-xs text-muted">Unpaid balances by how overdue they are (as of today).</p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {buckets.map((b) => (
                <tr key={b.label}>
                  <td className="py-2 text-ink">{b.label}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{b.amt > 0 ? m(b.amt) : "—"}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line font-bold">
                <td className="py-2">Total outstanding</td>
                <td className="py-2 text-right tabular-nums">{m(outstanding)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Expenses by category */}
        <section className="card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Expenses by category</h2>
          <p className="mb-3 text-xs text-muted">Where the money went this period.</p>
          {cats.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No expenses recorded yet.</p>
          ) : (
            <div className="space-y-2.5">
              {cats.map(([name, val]) => (
                <div key={name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink">{name}</span>
                    <span className="font-medium tabular-nums">{m(val)}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-canvas">
                    <div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.max(4, (val / catMax) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Top clients */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Top clients</h2>
        <p className="mb-3 text-xs text-muted">Your biggest customers by amount invoiced this period.</p>
        {topClients.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No invoices in this period.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {topClients.map(([name, val], i) => (
                <tr key={name}>
                  <td className="py-2 text-muted">{i + 1}</td>
                  <td className="py-2 font-medium text-ink">{name}</td>
                  <td className="py-2 text-right tabular-nums">{m(val)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "brand" | "warn" }) {
  const c = tone === "warn" ? "text-red-600" : tone === "brand" ? "text-brand-700" : "text-ink";
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-2 text-xl font-extrabold tabular-nums ${c}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}
