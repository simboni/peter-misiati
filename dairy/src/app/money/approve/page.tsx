import { verifySession } from "@/lib/dal";
import { kes } from "@/lib/money";
import { approvalQueue, approveEntryAction } from "@/server/money";
import { ApproveRow } from "@/components/money/entry-forms";
import { BackLink, Card, EmptyState, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The manager's queue. R10 — herdsmen record, managers approve, owners read.
 * Segregation of duties is not decoration: SME theft in Kenya concentrates
 * exactly where one person controls a whole transaction.
 */
export default async function ApprovePage() {
  const session = await verifySession();
  const queue = await approvalQueue(session);

  const outKes = queue.filter((q) => q.kind === "EXPENSE").reduce((t, q) => t + q.amountKes, 0);
  const inKes = queue.filter((q) => q.kind === "INCOME").reduce((t, q) => t + q.amountKes, 0);

  return (
    <main className="mx-auto max-w-xl p-4 pb-24">
      <BackLink to="/money" label="Money" />
      <PageTitle sub="Nothing here has touched a single report yet. That happens when you approve it.">
        Waiting for you
      </PageTitle>

      {queue.length === 0 ? (
        <EmptyState
          title="Nothing is waiting"
          hint="Every entry recorded so far has been dealt with."
        />
      ) : (
        <>
          <Card className="mb-4">
            <p className="text-sm">
              {queue.length} {queue.length === 1 ? "entry" : "entries"} — {kes(outKes)} out and{" "}
              {kes(inKes)} in. Check each against the receipt or the M-Pesa message before you approve.
            </p>
          </Card>

          <ul className="space-y-3">
            {queue.map((q) => (
              <ApproveRow
                key={q.id}
                action={approveEntryAction}
                kind={q.kind}
                id={q.id}
                label={q.label}
                onDate={q.onDate}
                amountKes={q.amountKes}
              />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
