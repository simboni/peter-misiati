import { requireCapability } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { listAnimalsForHealth, recordCmt } from "@/server/health";
import { CmtForm } from "@/components/health/forms";
import { PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Mastitis runs at 80% in Kenyan herds and 73 points of that is subclinical —
 * invisible without a paddle. Monthly CMT on every milking cow is the cheapest
 * screening there is.
 */
export default async function CmtPage() {
  const session = await requireCapability("RECORD");
  const asOf = today();
  const animals = await listAnimalsForHealth(session, asOf);
  const milking = animals.filter((a) => a.milking);

  return (
    <main className="mx-auto max-w-2xl p-4">
      <PageTitle sub="Monthly on every milking cow, at dry-off, and on any yield drop.">
        CMT mastitis test
      </PageTitle>
      <CmtForm action={recordCmt} today={asOf} animals={milking.length > 0 ? milking : animals} />
    </main>
  );
}
