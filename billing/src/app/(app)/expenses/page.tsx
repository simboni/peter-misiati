import { eq, desc } from "drizzle-orm";
import { requireOrg, getOrgProfile } from "@/server/org";
import { schema } from "@/server/db";
import { PageHeader, EmptyState } from "@/components/page-header";
import { ExpenseListView } from "@/components/expense-list-view";
import { fmtDate } from "@/server/queries";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage() {
  const { db, organizationId } = await requireOrg();
  const [rows, profile] = await Promise.all([
    db.select().from(schema.expense)
      .where(eq(schema.expense.organizationId, organizationId))
      .orderBy(desc(schema.expense.expenseDate)),
    getOrgProfile(db, organizationId),
  ]);
  const cur = profile?.currency ?? "KES";

  const shaped = rows.map((r) => ({
    id: r.id,
    date: fmtDate(r.expenseDate),
    issueMs: new Date(r.expenseDate).getTime(),
    category: r.category ?? "—",
    payee: r.payee ?? "",
    description: r.description,
    amount: r.amount,
    currency: cur,
  }));

  return (
    <div>
      <PageHeader title="Expenses" subtitle="Track what your business spends — feeds your profit & loss." action={{ href: "/expenses/new", label: "Add expense" }} />
      {shaped.length === 0 ? (
        <EmptyState title="No expenses yet" body="Record your costs — rent, transport, supplies — to see your true profit in Reports." action={{ href: "/expenses/new", label: "Add expense" }} />
      ) : (
        <ExpenseListView rows={shaped} />
      )}
    </div>
  );
}
