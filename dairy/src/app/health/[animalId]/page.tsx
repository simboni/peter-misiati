import { notFound } from "next/navigation";
import { verifySession, can } from "@/lib/dal";
import { kes } from "@/lib/money";
import { animalHealthHistory } from "@/server/health";
import { Card, Chip, EmptyState, HardBlock, PageTitle, SoftWarning } from "@/components/ui";

export const dynamic = "force-dynamic";

/** One animal's health record, newest first, with today's status at the top. */
export default async function AnimalHealthPage({
  params,
}: {
  params: Promise<{ animalId: string }>;
}) {
  const session = await verifySession();
  // params is always a Promise in Next 16.
  const { animalId } = await params;

  let history: Awaited<ReturnType<typeof animalHealthHistory>>;
  try {
    history = await animalHealthHistory(session, animalId);
  } catch {
    // "Not found" and "another farm's animal" are deliberately the same answer.
    notFound();
  }

  const showMoney = can(session.role, "VIEW_MONEY");
  const status = history.status;

  return (
    <main className="mx-auto max-w-2xl p-4">
      <PageTitle sub="Everything recorded for her, newest first.">{history.animalName}</PageTitle>

      {status?.milkBlocked ? (
        <div className="mb-4">
          <HardBlock message={status.plainMessage ?? status.message ?? ""} />
        </div>
      ) : status?.unknownPeriod ? (
        <div className="mb-4">
          <SoftWarning message={status.unknownMessage!} />
        </div>
      ) : status?.meatBlocked ? (
        <div className="mb-4">
          <SoftWarning message={status.plainMessage ?? status.message ?? ""} />
        </div>
      ) : null}

      {history.entries.length === 0 ? (
        <EmptyState title="Nothing recorded for her yet" />
      ) : (
        <ol className="space-y-2">
          {history.entries.map((e) => (
            <li key={e.id}>
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{e.title}</p>
                    {e.detail ? <p className="text-sm text-ink-2">{e.detail}</p> : null}
                    {e.milkClearOn ? (
                      <p className="mt-1 text-sm text-ink-2">Milk clear from {e.milkClearOn}.</p>
                    ) : null}
                    {e.meatClearOn ? (
                      <p className="text-sm text-ink-2">Slaughter clear from {e.meatClearOn}.</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm tabular-nums text-ink-3">{e.occurredOn}</p>
                    {showMoney && e.costKes ? (
                      <p className="text-sm font-medium tabular-nums">{kes(e.costKes)}</p>
                    ) : null}
                    {e.cmtScore ? <Chip tone={e.cmtScore === "N" ? "ok" : "warn"}>{e.cmtScore}</Chip> : null}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
