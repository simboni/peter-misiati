import { verifySession } from "@/lib/dal";
import { listHerd } from "@/server/herd";
import { recordHeat } from "@/server/breeding";
import { BackLink, PageTitle } from "@/components/ui";
import { HeatForm } from "@/components/breeding/heat-form";
import { pickerOptions } from "../pickers";

export const dynamic = "force-dynamic";

export default async function HeatPage({
  searchParams,
}: {
  searchParams: Promise<{ animalId?: string }>;
}) {
  const session = await verifySession();
  const sp = await searchParams;
  const list = await listHerd(session);

  // `datetime-local` wants YYYY-MM-DDTHH:mm with no zone.
  const nowLocal = new Date().toISOString().slice(0, 16);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24">
      <BackLink to="/breeding" label="Breeding" />
      <PageTitle sub="Pick the cow and save. It tells you when to serve her.">On heat</PageTitle>

      <HeatForm
        action={recordHeat}
        animals={pickerOptions(list.rows)}
        defaultAnimalId={sp.animalId}
        nowLocal={nowLocal}
      />
    </main>
  );
}
