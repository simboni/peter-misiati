import Link from "next/link";
import { requirePageCapability } from "@/lib/dal";
import { approveMilkRecordAction, flaggedQueue, formatDay, sessionLabel } from "@/server/milk";
import { ApproveButton } from "@/components/milk/ApproveButton";
import { Card, Chip, EmptyState, PageTitle } from "@/components/ui";
import { litres } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * The review queue. Nothing here was rejected at entry — an odd number was
 * saved as the herdsman typed it, and this is where a manager decides what it
 * means. Warn, never block.
 */
export default async function FlaggedPage() {
  const session = await requirePageCapability("APPROVE");
  const rows = await flaggedQueue(session);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-16">
      <PageTitle sub="Odd numbers were saved as they were entered. Check them here.">
        Milk to check
      </PageTitle>

      <p className="mb-4">
        <Link href="/milk" className="text-sm underline">
          Back to today&apos;s sheet
        </Link>
      </p>

      {rows.length === 0 ? (
        <EmptyState title="Nothing to check" hint="Every entry looked normal for the cow that gave it." />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Card>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={`/milk/${r.animalId}`} className="text-lg font-semibold hover:underline">
                    {r.name}
                  </Link>
                  <span className="text-xl font-semibold tabular-nums">{litres(r.litres)}</span>
                  <Chip tone="warn">{r.reasonLabel}</Chip>
                  {!r.saleable ? (
                    <Chip tone="danger">
                      {r.notSaleableReason === "WITHDRAWAL" ? "Treated — not for sale" : "Colostrum"}
                    </Chip>
                  ) : null}
                  <span className="ml-auto">
                    <ApproveButton recordId={r.id} action={approveMilkRecordAction} />
                  </span>
                </div>
                <p className="mt-2 text-sm text-ink-3">
                  {sessionLabel(r.session)} of {formatDay(r.recordedOn)}
                  {r.recordedByName ? ` · entered by ${r.recordedByName}` : ""}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
