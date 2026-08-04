import { requirePageCapability } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { newId } from "@/lib/ids";
import { listAnimalsForHealth, listProducts, recordRoutineBatch } from "@/server/health";
import { BatchForm } from "@/components/health/forms";
import { EmptyState, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Weekly tick spraying across sixty animals is ONE action, not sixty — and
 * more than one product may go on in the same pass. Batch dosing being slow is
 * the most-cited complaint about the competition, and a routine that is slow to
 * record simply stops being recorded.
 */
export default async function BatchPage() {
  const session = await requirePageCapability("RECORD");
  const asOf = today();
  const [animals, products] = await Promise.all([
    listAnimalsForHealth(session, asOf),
    listProducts(session),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-4">
      <PageTitle sub="Dip, spray or deworm a whole group in one go. Tick more than one product to give them together.">
        The whole group at once
      </PageTitle>
      {products.length === 0 ? (
        <EmptyState title="No products in the medicine store yet" hint="Add the acaricide or dewormer first." />
      ) : (
        <BatchForm
          action={recordRoutineBatch}
          today={asOf}
          herdSize={animals.length}
          // Generated per page load, so a double-flushed offline batch collapses
          // into one dosing instead of two.
          batchId={newId()}
          products={products.map((p) => ({
            id: p.id,
            name: p.name,
            productType: p.productType,
            milkWithdrawalDays: p.milkWithdrawalDays,
            meatWithdrawalDays: p.meatWithdrawalDays,
            notForLactating: p.notForLactating,
            labelSource: p.labelSource,
          }))}
        />
      )}
    </main>
  );
}
