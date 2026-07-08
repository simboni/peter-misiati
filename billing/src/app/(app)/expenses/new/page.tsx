import { requireOrg } from "@/server/org";
import { PageHeader } from "@/components/page-header";
import { ExpenseForm } from "@/components/expense-form";

export const metadata = { title: "Add expense" };

export default async function NewExpensePage() {
  await requireOrg();
  return (
    <div>
      <PageHeader title="Add expense" subtitle="Log a business cost." />
      <ExpenseForm />
    </div>
  );
}
