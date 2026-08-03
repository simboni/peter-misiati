import { verifySession } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { rationAdvice } from "@/server/feed";
import { listAnimalsForHealth } from "@/server/health";
import { Card, Chip, PageTitle, SoftWarning } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Ration guidance from what she is actually giving.
 *
 * Challenge feeding — 1 kg of dairy meal per extra 1.5 L above 8 litres — is
 * the NAFIS rule, but farmers also quote 1 kg per 2 L and 1 kg per 3 L, so it
 * is a configurable rule with a default rather than a constant.
 */
export default async function RationPage({
  searchParams,
}: {
  searchParams: Promise<{ animalId?: string }>;
}) {
  const session = await verifySession();
  const { animalId } = await searchParams;
  const asOf = today();

  const animals = await listAnimalsForHealth(session, asOf);
  const advice = await rationAdvice(
    session,
    animalId ? { animalId } : { group: "LACTATING" },
    asOf,
  );

  return (
    <main className="mx-auto max-w-2xl p-4">
      <PageTitle sub="Worked out from the last seven days of milk and feed records.">
        What to feed
      </PageTitle>

      <nav className="mb-5 flex flex-wrap gap-2">
        <a href="/feed/ration" className="tap">
          <Chip tone={animalId ? "neutral" : "brand"}>Milking group</Chip>
        </a>
        {animals
          .filter((a) => a.milking)
          .map((a) => (
            <a key={a.id} href={`/feed/ration?animalId=${a.id}`} className="tap">
              <Chip tone={animalId === a.id ? "brand" : "neutral"}>{a.label}</Chip>
            </a>
          ))}
      </nav>

      <Card className="space-y-4">
        <div>
          <p className="text-sm text-ink-2">
            {advice.scope === "ANIMAL" ? advice.animalName : `${advice.animals} milking cows`}
          </p>
          <p className="text-3xl font-semibold tabular-nums">{advice.dailyYieldL} L a day</p>
        </div>

        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-ink-3">Dairy meal</dt>
            <dd className="text-lg font-medium tabular-nums">{advice.concentrate.kgPerDay} kg</dd>
          </div>
          <div>
            <dt className="text-ink-3">Dry matter</dt>
            <dd className="text-lg font-medium tabular-nums">{advice.dmRequirementKg} kg</dd>
          </div>
          <div>
            <dt className="text-ink-3">Water</dt>
            <dd className="text-lg font-medium tabular-nums">{advice.waterRequirementL} L</dd>
          </div>
        </dl>

        <ul className="space-y-1 text-sm text-ink-2">
          {advice.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </Card>

      {advice.acidosis.risk ? (
        <div className="mt-4">
          <SoftWarning message={advice.acidosis.message!} />
        </div>
      ) : null}
    </main>
  );
}
