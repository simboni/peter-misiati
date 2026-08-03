import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { ANIMAL_CLASSES } from "@/db/schema";
import { CLASS_LABEL } from "@/lib/domain/animal";
import { recordSaleAction, sellCandidates } from "@/server/trading";
import { listCounterparties } from "@/server/money";
import { SaleForm } from "@/components/trading/trade-forms";
import { EmptyState, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SellPage() {
  const session = await verifySession();
  const [animals, buyers] = await Promise.all([
    sellCandidates(session),
    listCounterparties(session),
  ]);

  return (
    <main className="mx-auto max-w-xl p-4 pb-24">
      <Link href="/trading" className="mb-3 inline-block text-sm text-ink-2">
        <span aria-hidden>←</span> Buying and selling
      </Link>
      <PageTitle sub="What she is worth over her whole life here comes back the moment you save.">
        Sell an animal
      </PageTitle>

      {animals.length === 0 ? (
        <EmptyState title="Nothing to sell" hint="There are no animals in the herd." />
      ) : (
        <SaleForm
          action={recordSaleAction}
          animals={animals.map((a) => ({
            id: a.id,
            label: a.label,
            classLabel: a.classLabel,
            dailyYieldL: a.dailyYieldL,
            daysInMilk: a.daysInMilk,
            monthsPregnant: a.monthsPregnant,
          }))}
          classes={ANIMAL_CLASSES.map((c) => ({ value: c, label: CLASS_LABEL[c] }))}
          buyers={buyers.map((b) => ({ id: b.id, name: b.name }))}
          today={today()}
        />
      )}
    </main>
  );
}
