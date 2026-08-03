import { verifySession } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { dueRoutines, withdrawalBoard } from "@/server/health";
import { Card, Chip, EmptyState, HardBlock, PageTitle, SoftWarning, TaskTile } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The health screen leads with the withdrawal board, because it is the only
 * thing on the farm that must be checked before milk leaves the gate. One
 * farmer's residual-antibiotic milk can get a whole chilling-plant load
 * rejected, and the co-operative charges it back to the member.
 */
export default async function HealthPage() {
  const session = await verifySession();
  const asOf = today();
  const [board, due] = await Promise.all([withdrawalBoard(session, asOf), dueRoutines(session, asOf)]);

  const blocked = board.filter((b) => b.milkBlocked);
  const meatOnly = board.filter((b) => !b.milkBlocked && b.meatBlocked);
  const unknown = board.filter((b) => b.unknownPeriod);

  // One line per routine, with the animals grouped under it — sixty separate
  // "spray Njeri" rows is not a list anybody reads.
  const byRoutine = new Map<string, { label: string; count: number; worst: number }>();
  for (const d of due) {
    const cur = byRoutine.get(d.routine) ?? { label: d.label, count: 0, worst: 0 };
    cur.count++;
    cur.worst = Math.max(cur.worst, d.overdueDays);
    byRoutine.set(d.routine, cur);
  }

  return (
    <main className="mx-auto max-w-3xl p-4">
      <PageTitle sub="Who may not be sold, and what the herd is due for.">Health</PageTitle>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">Milk withheld</h2>
        {blocked.length === 0 ? (
          <EmptyState title="No cow is under milk withdrawal today" hint="Every cow's milk may go to the tank." />
        ) : (
          <ul className="space-y-2">
            {blocked.map((b) => (
              <li key={b.animalId}>
                <HardBlock message={b.plainMessage ?? b.message ?? ""} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {unknown.length > 0 ? (
        <section className="mb-6 space-y-2">
          {unknown.map((u) => (
            <SoftWarning key={u.animalId} message={u.unknownMessage!} />
          ))}
        </section>
      ) : null}

      {meatOnly.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">Not for slaughter yet</h2>
          <ul className="space-y-2">
            {meatOnly.map((b) => (
              <li key={b.animalId}>
                <Card className="flex items-center justify-between gap-3">
                  <span className="font-medium">{b.animalName}</span>
                  <Chip tone="warn">Clear {b.meatClearOn}</Chip>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">Due now</h2>
        {byRoutine.size === 0 ? (
          <EmptyState title="Nothing overdue" />
        ) : (
          <ul className="space-y-2">
            {[...byRoutine.entries()].map(([routine, v]) => (
              <li key={routine}>
                <Card className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{v.label}</p>
                    <p className="text-sm text-ink-2">
                      {v.count} animal{v.count === 1 ? "" : "s"}
                      {v.worst > 0 ? ` · up to ${v.worst} days late` : ""}
                    </p>
                  </div>
                  <a href="/health/batch" className="tap">
                    <Chip tone={v.worst > 7 ? "danger" : "warn"}>Do the group</Chip>
                  </a>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <nav className="grid grid-cols-2 gap-3">
        <TaskTile href="/health/treat" icon="💊" label="Treat an animal" detail="Sets the withdrawal" />
        <TaskTile href="/health/batch" icon="🐄" label="Whole group" detail="Dip, spray, deworm" />
        <TaskTile href="/health/vaccinate" icon="💉" label="Vaccinate" detail="Against the Kenyan calendar" />
        <TaskTile href="/health/cmt" icon="🥛" label="CMT test" detail="Find mastitis you cannot see" />
      </nav>
    </main>
  );
}
