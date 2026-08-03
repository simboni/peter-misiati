import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { ANIMAL_CLASSES } from "@/db/schema";
import { CLASS_LABEL } from "@/lib/domain/animal";
import { recordPurchaseAction } from "@/server/trading";
import { listCounterparties } from "@/server/money";
import { PurchaseForm } from "@/components/trading/trade-forms";
import { Card, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BuyPage() {
  const session = await verifySession();
  const sellers = await listCounterparties(session);

  return (
    <main className="mx-auto max-w-xl p-4 pb-24">
      <Link href="/trading" className="mb-3 inline-block text-sm text-ink-2">
        <span aria-hidden>←</span> Buying and selling
      </Link>
      <PageTitle sub="Bring a bought-in animal onto the register.">Buy an animal</PageTitle>

      <Card className="mb-4">
        <p className="text-sm">
          <span aria-hidden className="mr-2">
            💡
          </span>
          A price is only justified by records. Before the money moves, ask the seller for her
          calving dates, services, milk records and treatments — and for the movement permit.
        </p>
      </Card>

      <PurchaseForm
        action={recordPurchaseAction}
        classes={ANIMAL_CLASSES.map((c) => ({ value: c, label: CLASS_LABEL[c] }))}
        sellers={sellers.map((s) => ({ id: s.id, name: s.name }))}
        today={today()}
      />
    </main>
  );
}
