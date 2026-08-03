import { verifySession } from "@/lib/dal";
import { listHerd } from "@/server/herd";
import { recordCalving } from "@/server/breeding";
import { PageTitle } from "@/components/ui";
import { CalvingForm } from "@/components/breeding/calving-form";
import { today } from "@/lib/domain/dates";
import { calvingCandidates } from "../pickers";

export const dynamic = "force-dynamic";

export default async function CalvingPage({
  searchParams,
}: {
  searchParams: Promise<{ animalId?: string }>;
}) {
  const session = await verifySession();
  const sp = await searchParams;
  const list = await listHerd(session);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24">
      <a href="/breeding" className="mb-3 inline-block text-sm text-ink-2">
        <span aria-hidden>←</span> Breeding
      </a>
      <PageTitle sub="The calf is registered, her lactation starts and the numbers are worked out — all from this.">
        Record a calving
      </PageTitle>

      <CalvingForm
        action={recordCalving}
        animals={calvingCandidates(list.rows)}
        defaultAnimalId={sp.animalId}
        today={today()}
      />
    </main>
  );
}
