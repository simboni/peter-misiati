import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrg, getOrgProfile } from "@/server/org";
import { schema } from "@/server/db";
import { PageHeader } from "@/components/page-header";
import { ExpenseForm } from "@/components/expense-form";

export const metadata = { title: "Edit expense" };

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, organizationId } = await requireOrg();
  const [rows, profile] = await Promise.all([
    db.select().from(schema.expense)
      .where(and(eq(schema.expense.id, id), eq(schema.expense.organizationId, organizationId))).limit(1),
    getOrgProfile(db, organizationId),
  ]);
  if (rows.length === 0) notFound();
  return (
    <div>
      <PageHeader title="Edit expense" />
      <ExpenseForm expense={rows[0]} currency={profile?.currency ?? "KES"} />
    </div>
  );
}
