import { verifySession } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { EXPENSE_CATEGORIES } from "@/db/schema";
import {
  EXPENSE_CATEGORY_LABEL,
  listCounterparties,
  recordExpenseAction,
} from "@/server/money";
import { ExpenseForm } from "@/components/money/entry-forms";
import { BackLink, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ExpensePage() {
  const session = await verifySession();
  const suppliers = await listCounterparties(session);

  return (
    <main className="mx-auto max-w-xl p-4 pb-24">
      <BackLink to="/money" label="Money" />
      <PageTitle sub="It is saved the moment you tap. A manager approves it before it counts.">
        Money out
      </PageTitle>

      <ExpenseForm
        action={recordExpenseAction}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        categories={EXPENSE_CATEGORIES.map((c) => ({
          value: c,
          label: EXPENSE_CATEGORY_LABEL[c],
        }))}
        today={today()}
      />
    </main>
  );
}
