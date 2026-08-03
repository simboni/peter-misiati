import { requireCapability } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { kes } from "@/lib/money";
import { listFodderProduction, recordFodderProduction } from "@/server/feed";
import { FodderForm } from "@/components/feed/forms";
import { Card, EmptyState, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Fodder the farm grows itself. Recording what a crop cost to grow is what
 * makes home-grown Napier comparable with a bought bag of dairy meal — and
 * what stops the margin over feed cost quietly flattering itself.
 */
export default async function FodderPage() {
  const session = await requireCapability("RECORD");
  const rows = await listFodderProduction(session);

  return (
    <main className="mx-auto max-w-2xl p-4">
      <PageTitle sub="Napier, Boma Rhodes, lucerne, silage — what you grew, and what it cost to grow.">
        Fodder grown here
      </PageTitle>

      <div className="mb-6">
        <FodderForm action={recordFodderProduction} today={today()} />
      </div>

      <h2 className="mb-2 text-lg font-semibold">Harvests</h2>
      {rows.length === 0 ? (
        <EmptyState title="Nothing recorded yet" hint="Record a harvest above." />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {r.crop}
                    {r.plotName ? ` · ${r.plotName}` : ""}
                  </p>
                  <p className="text-sm text-ink-2 tabular-nums">
                    {r.harvestedOn ?? "not harvested yet"}
                    {r.totalKg ? ` · ${r.totalKg} kg` : ""}
                    {r.yieldTonnesPerAcre ? ` · ${r.yieldTonnesPerAcre} t/acre` : ""}
                  </p>
                </div>
                {r.costPerKgKes != null ? (
                  <span className="text-sm font-medium tabular-nums">{kes(r.costPerKgKes, 2)}/kg</span>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
