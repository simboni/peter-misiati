import { verifySession } from "@/lib/dal";
import { listHerd } from "@/server/herd";
import { recordPregnancyCheck } from "@/server/breeding";
import { PageTitle } from "@/components/ui";
import { PregnancyCheckForm } from "@/components/breeding/pd-form";
import { today } from "@/lib/domain/dates";
import { pickerOptions } from "../pickers";

export const dynamic = "force-dynamic";

export default async function PregnancyCheckPage({
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
      <PageTitle sub="The answer changes her diary, not just her file.">Pregnancy check</PageTitle>

      <PregnancyCheckForm
        action={recordPregnancyCheck}
        animals={pickerOptions(list.rows)}
        defaultAnimalId={sp.animalId}
        today={today()}
      />
    </main>
  );
}
