import { and, eq, desc, sql, count, notInArray } from "drizzle-orm";
import { schema, type DB } from "./db";

/**
 * All the numbers the dashboard shows — computed with SQL aggregates so the
 * cost is a handful of rows regardless of how many invoices/payments the org
 * has. (The previous version loaded every invoice, payment and expense into
 * the Worker and summed them in JS, which grew linearly with account history.)
 */
export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;

export async function loadDashboard(db: DB, organizationId: string, now: Date = new Date()) {
  const nowMs = now.getTime();
  const monthStartMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const isInvoice = and(
    eq(schema.invoice.organizationId, organizationId),
    eq(schema.invoice.type, "invoice"),
  );

  const [invAgg, payAgg, expAgg, recent, topClients] = await Promise.all([
    // One pass over the org's invoices → all invoice-derived figures.
    db
      .select({
        totalInvoiced: sql<number>`COALESCE(SUM(CASE WHEN ${schema.invoice.status} NOT IN ('draft','void') THEN ${schema.invoice.total} ELSE 0 END), 0)`,
        outstanding: sql<number>`COALESCE(SUM(CASE WHEN ${schema.invoice.status} <> 'void' THEN ${schema.invoice.balanceDue} ELSE 0 END), 0)`,
        overdue: sql<number>`COALESCE(SUM(CASE WHEN ${schema.invoice.status} <> 'void' AND ${schema.invoice.balanceDue} > 0 AND ${schema.invoice.dueDate} IS NOT NULL AND ${schema.invoice.dueDate} < ${nowMs} THEN ${schema.invoice.balanceDue} ELSE 0 END), 0)`,
        overdueCount: sql<number>`SUM(CASE WHEN ${schema.invoice.status} <> 'void' AND ${schema.invoice.balanceDue} > 0 AND ${schema.invoice.dueDate} IS NOT NULL AND ${schema.invoice.dueDate} < ${nowMs} THEN 1 ELSE 0 END)`,
        openCount: sql<number>`SUM(CASE WHEN ${schema.invoice.status} <> 'void' AND ${schema.invoice.balanceDue} > 0 THEN 1 ELSE 0 END)`,
        allCount: count(),
      })
      .from(schema.invoice)
      .where(isInvoice),
    // One pass over payments → all-time collected + this month.
    db
      .select({
        allTime: sql<number>`COALESCE(SUM(${schema.payment.amount}), 0)`,
        thisMonth: sql<number>`COALESCE(SUM(CASE WHEN ${schema.payment.paidAt} >= ${monthStartMs} THEN ${schema.payment.amount} ELSE 0 END), 0)`,
        cnt: count(),
      })
      .from(schema.payment)
      .where(eq(schema.payment.organizationId, organizationId)),
    // Expenses this month.
    db
      .select({
        thisMonth: sql<number>`COALESCE(SUM(CASE WHEN ${schema.expense.expenseDate} >= ${monthStartMs} THEN ${schema.expense.amount} ELSE 0 END), 0)`,
      })
      .from(schema.expense)
      .where(eq(schema.expense.organizationId, organizationId)),
    // Six most-recent invoices for the list card.
    db
      .select({
        id: schema.invoice.id,
        number: schema.invoice.number,
        status: schema.invoice.status,
        total: schema.invoice.total,
        issueDate: schema.invoice.issueDate,
        clientName: schema.client.name,
      })
      .from(schema.invoice)
      .leftJoin(schema.client, eq(schema.client.id, schema.invoice.clientId))
      .where(isInvoice)
      .orderBy(desc(schema.invoice.createdAt))
      .limit(6),
    // Top five clients by issued value — grouped in SQL, not in JS.
    db
      .select({
        id: schema.invoice.clientId,
        name: schema.client.name,
        total: sql<number>`SUM(${schema.invoice.total})`,
      })
      .from(schema.invoice)
      .leftJoin(schema.client, eq(schema.client.id, schema.invoice.clientId))
      .where(and(isInvoice, notInArray(schema.invoice.status, ["draft", "void"])))
      .groupBy(schema.invoice.clientId, schema.client.name)
      .orderBy(desc(sql`SUM(${schema.invoice.total})`))
      .limit(5),
  ]);

  const inv = invAgg[0];
  const pay = payAgg[0];
  const monthRevenue = Number(pay?.thisMonth ?? 0);
  const monthExpenses = Number(expAgg[0]?.thisMonth ?? 0);

  return {
    totalInvoiced: Number(inv?.totalInvoiced ?? 0),
    totalPaid: Number(pay?.allTime ?? 0),
    outstanding: Number(inv?.outstanding ?? 0),
    overdue: Number(inv?.overdue ?? 0),
    overdueCount: Number(inv?.overdueCount ?? 0),
    openCount: Number(inv?.openCount ?? 0),
    monthRevenue,
    monthExpenses,
    monthNet: monthRevenue - monthExpenses,
    recent,
    topClients: topClients.map((c) => ({ id: c.id, name: c.name ?? "—", total: Number(c.total) })),
    noData: Number(inv?.allCount ?? 0) === 0 && Number(pay?.cnt ?? 0) === 0,
  };
}
