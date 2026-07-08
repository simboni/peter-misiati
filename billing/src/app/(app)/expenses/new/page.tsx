import { requireOrg, getOrgProfile } from "@/server/org";
import { PageHeader } from "@/components/page-header";
import { ExpenseForm } from "@/components/expense-form";

export const metadata = { title: "Add expense" };

export default async function NewExpensePage() {
  const { db, organizationId } = await requireOrg();
  const profile = await getOrgProfile(db, organizationId);
  return (
    <div>
      <PageHeader title="Add expense" subtitle="Log a business cost." />
      <ExpenseForm currency={profile?.currency ?? "KES"} />
    </div>
  );
}
