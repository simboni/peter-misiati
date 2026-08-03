import { requireCapability } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { listAnimalsForHealth, listProducts, recordVaccination } from "@/server/health";
import { VaccinateForm } from "@/components/health/forms";
import { PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Two entries on the Kenyan calendar are hard rules rather than reminders: S19
 * brucellosis (females only, 4–8 months, once for life — in an adult it
 * interferes with later testing) and ECF-ITM (once for life, and the animal
 * becomes a carrier). Neither can be undone, so both are refused here.
 */
export default async function VaccinatePage() {
  const session = await requireCapability("TREAT");
  const asOf = today();
  const [animals, products] = await Promise.all([
    listAnimalsForHealth(session, asOf),
    listProducts(session),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-4">
      <PageTitle sub="FMD every six months, S19 once for life, ECF-ITM once for life.">Vaccinate</PageTitle>
      <VaccinateForm
        action={recordVaccination}
        today={asOf}
        animals={animals}
        products={products
          .filter((p) => p.productType === "VACCINE" || p.productType === "OTHER")
          .map((p) => ({
            id: p.id,
            name: p.name,
            productType: p.productType,
            milkWithdrawalDays: p.milkWithdrawalDays,
            meatWithdrawalDays: p.meatWithdrawalDays,
            notForLactating: p.notForLactating,
            labelSource: p.labelSource,
          }))}
      />
    </main>
  );
}
