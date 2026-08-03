import { verifySession } from "@/lib/dal";
import { breedingWatchboard } from "@/server/breeding";
import { PageTitle, Card, EmptyState, TaskTile } from "@/components/ui";
import { today } from "@/lib/domain/dates";

export const dynamic = "force-dynamic";

/**
 * The watchboard — today's breeding actions.
 *
 * Every item is recomputed from the latest event on each animal, so recording
 * the outcome makes the item disappear. There is no "mark as done": ticking a
 * reminder that the records already answer is exactly how Herdwatch ended up
 * with repeat-served cows stuck on the board forever.
 */
export default async function BreedingPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const session = await verifySession();
  const sp = await searchParams;
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(sp.asOf ?? "") ? sp.asOf! : today();

  const board = await breedingWatchboard(session, asOf);

  const groups = [
    { key: "SERVE_NOW", icon: "♥", title: "Ready to serve", items: board.serveNow },
    { key: "RETURN_TO_HEAT", icon: "⏱", title: "Watch for a return to heat", items: board.returnsToHeat },
    { key: "PD_DUE", icon: "🩺", title: "Pregnancy checks due", items: board.pregnancyChecks },
    { key: "DRY_OFF_DUE", icon: "🌾", title: "Dry off and steam up", items: board.dryOffs },
    { key: "CALVING_DUE", icon: "🐄", title: "Calving now", items: board.calvings },
  ].filter((g) => g.items.length > 0);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <PageTitle
        sub={
          board.total === 0
            ? `Nothing needs doing on ${asOf}.`
            : `${board.total} ${board.total === 1 ? "thing" : "things"} need doing on ${asOf}.`
        }
      >
        Breeding
      </PageTitle>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TaskTile href="/breeding/heat" icon="♥" label="On heat" detail="5 seconds" />
        <TaskTile href="/breeding/service" icon="💉" label="Served" detail="Get the calendar" />
        <TaskTile href="/breeding/pregnancy-check" icon="🩺" label="Checked" detail="In calf?" />
        <TaskTile href="/breeding/calving" icon="🐄" label="Calved" detail="Calf + numbers" />
      </div>

      {board.total === 0 ? (
        <EmptyState
          title="The board is clear."
          hint="Every cow is where she should be. Come back tomorrow."
        />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-2 text-lg font-semibold">
                <span aria-hidden className="mr-2">
                  {g.icon}
                </span>
                {g.title}
                <span className="ml-2 text-sm font-normal text-ink-3">{g.items.length}</span>
              </h2>
              <ul className="space-y-2">
                {g.items.map((i) => (
                  <li key={`${i.kind}-${i.animalId}`}>
                    <Card className={i.severity === "CRITICAL" ? "border-danger" : undefined}>
                      <div className="flex items-start gap-3">
                        <span aria-hidden className="text-lg leading-6">
                          {i.severity === "CRITICAL" ? "🔴" : i.severity === "WARN" ? "🟠" : "🟢"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{i.action}</p>
                          {i.detail ? <p className="mt-1 text-sm text-ink-2">{i.detail}</p> : null}
                          <p className="mt-1 text-xs tabular-nums text-ink-3">
                            Due {i.dueOn}
                            {i.daysOverdue > 0 ? ` · ${i.daysOverdue} days late` : ""}
                          </p>
                        </div>
                        <a
                          href={hrefFor(i.kind, i.animalId)}
                          className="tap shrink-0 self-center rounded-md border border-line px-3 py-2 text-sm font-semibold"
                        >
                          Record
                        </a>
                      </div>
                      <p className="mt-2 text-right">
                        <a href={`/herd/${i.animalId}`} className="text-xs underline text-ink-3">
                          {i.name ?? i.tag}&apos;s card
                        </a>
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="mt-8 text-center text-xs text-ink-3">
        Nothing here is ticked off by hand. Record what happened and the item goes.
      </p>
      <p className="mt-2 text-center text-sm">
        <a href="/herd" className="underline">
          The herd
        </a>
      </p>
    </main>
  );
}

function hrefFor(kind: string, animalId: string): string {
  const q = `?animalId=${animalId}`;
  switch (kind) {
    case "SERVE_NOW":
      return `/breeding/heat${q}`;
    case "RETURN_TO_HEAT":
      return `/breeding/service${q}`;
    case "PD_DUE":
      return `/breeding/pregnancy-check${q}`;
    case "DRY_OFF_DUE":
      return `/breeding/dry-off${q}`;
    case "CALVING_DUE":
      return `/breeding/calving${q}`;
    default:
      return `/herd/${animalId}`;
  }
}
