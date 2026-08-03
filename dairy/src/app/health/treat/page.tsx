import { requireCapability } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { listAnimalsForHealth, listProducts, recordTreatment } from "@/server/health";
import { TreatForm } from "@/components/health/forms";
import { EmptyState, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TreatPage() {
  const session = await requireCapability("TREAT");
  const asOf = today();
  const [animals, products] = await Promise.all([
    listAnimalsForHealth(session, asOf),
    listProducts(session),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-4">
      <PageTitle sub="The withdrawal period comes from this product's own label — never from a generic drug table.">
        Treat an animal
      </PageTitle>
      {products.length === 0 ? (
        <EmptyState
          title="No products in the medicine store yet"
          hint="Add the drug and its label withdrawal period first."
        />
      ) : (
        <TreatForm
          action={recordTreatment}
          today={asOf}
          animals={animals}
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
