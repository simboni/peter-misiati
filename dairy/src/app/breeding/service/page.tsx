import { verifySession } from "@/lib/dal";
import { listHerd } from "@/server/herd";
import { recordService } from "@/server/breeding";
import { BackLink, PageTitle } from "@/components/ui";
import { ServiceForm } from "@/components/breeding/service-form";
import { today } from "@/lib/domain/dates";
import { pickerOptions, bullOptions } from "../pickers";

export const dynamic = "force-dynamic";

export default async function ServicePage({
  searchParams,
}: {
  searchParams: Promise<{ animalId?: string }>;
}) {
  const session = await verifySession();
  const sp = await searchParams;
  const list = await listHerd(session);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24">
      <BackLink to="/breeding" label="Breeding" />
      <PageTitle sub="One date in. The whole calendar comes straight back.">Record a service</PageTitle>

      <ServiceForm
        action={recordService}
        animals={pickerOptions(list.rows)}
        bulls={bullOptions(list.rows)}
        defaultAnimalId={sp.animalId}
        today={today()}
      />
    </main>
  );
}
