import { verifySession } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { recordIncomeAction } from "@/server/money";
import { IncomeForm } from "@/components/money/entry-forms";
import { BackLink, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function IncomePage() {
  await verifySession();

  return (
    <main className="mx-auto max-w-xl p-4 pb-24">
      <BackLink to="/money" label="Money" />
      <PageTitle sub="Milk, animals, manure, fodder — every shilling that came in.">
        Money in
      </PageTitle>

      <IncomeForm action={recordIncomeAction} today={today()} />
    </main>
  );
}
