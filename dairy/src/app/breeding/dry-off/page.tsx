import { verifySession } from "@/lib/dal";
import { listHerd } from "@/server/herd";
import { recordDryOff, listDryCowProducts } from "@/server/breeding";
import { BackLink, PageTitle } from "@/components/ui";
import { DryOffForm } from "@/components/breeding/dry-off-form";
import { today } from "@/lib/domain/dates";
import { dryOffCandidates } from "../pickers";

export const dynamic = "force-dynamic";

export default async function DryOffPage({
  searchParams,
}: {
  searchParams: Promise<{ animalId?: string }>;
}) {
  const session = await verifySession();
  const sp = await searchParams;
  const [list, products] = await Promise.all([listHerd(session), listDryCowProducts(session)]);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24">
      <BackLink to="/breeding" label="Breeding" />
      <PageTitle sub="Stop milking, and start the extra feed on the same day.">Dry off</PageTitle>

      <DryOffForm
        action={recordDryOff}
        animals={dryOffCandidates(list.rows)}
        products={products.map((p) => ({
          id: p.id,
          label: p.milkWithdrawalDays != null ? `${p.name} (${p.milkWithdrawalDays}-day withdrawal)` : p.name,
        }))}
        defaultAnimalId={sp.animalId}
        today={today()}
      />
    </main>
  );
}
