import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { recordIncomeAction } from "@/server/money";
import { IncomeForm } from "@/components/money/entry-forms";
import { PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function IncomePage() {
  await verifySession();

  return (
    <main className="mx-auto max-w-xl p-4 pb-24">
      <Link href="/money" className="mb-3 inline-block text-sm text-ink-2">
        <span aria-hidden>←</span> Money
      </Link>
      <PageTitle sub="Milk, animals, manure, fodder — every shilling that came in.">
        Money in
      </PageTitle>

      <IncomeForm action={recordIncomeAction} today={today()} />
    </main>
  );
}
