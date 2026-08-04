import Link from "next/link";
import { verifySession, can } from "@/lib/dal";
import { today, startOfMonth } from "@/lib/domain/dates";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import {
  alertsForRole,
  dailyDigest,
  monthCompletionRate,
  resolveAlertAction,
  refreshAlertsAction,
} from "@/server/alerts";
import { AlertList } from "@/components/alerts/alert-list";
import { DigestCard } from "@/components/alerts/digest-card";
import { CompletionRateCard } from "@/components/alerts/completion-rate";

export const dynamic = "force-dynamic";

/**
 * The alerts screen.
 *
 * One person's jobs for today, capped, worst first, each dismissed with an
 * outcome. The header reports the ACTION COMPLETION RATE — never the number of
 * alerts sent, which is a vanity metric and a warning sign when it rises.
 */
export default async function AlertsPage() {
  const session = await verifySession();
  const asOf = today();
  const seesMoney = can(session.role, "VIEW_MONEY");

  const mine = await alertsForRole(session, session.role, asOf);
  const digest = seesMoney ? await dailyDigest(session, asOf) : null;
  const rate = seesMoney ? await monthCompletionRate(session, asOf) : null;

  const due = mine.alerts.filter((a) => a.dueOn <= asOf);
  const ahead = mine.alerts.filter((a) => a.dueOn > asOf);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <Link href="/" className="mb-3 inline-block text-sm text-ink-2">
        <span aria-hidden>←</span> Home
      </Link>
      <PageTitle sub={mine.headline}>Today&rsquo;s jobs</PageTitle>

      {digest ? (
        <div className="mb-5">
          <DigestCard d={digest} />
        </div>
      ) : null}

      {mine.alerts.length === 0 ? (
        <EmptyState
          title="Nothing needs you today"
          hint="Every job on the farm is either done or not due yet."
        />
      ) : (
        <>
          {/*
            Two lists, not one. The query looks a week ahead so nothing lands as
            a surprise, but under a heading that says "Today's jobs" a job due
            next Tuesday reads as a job for this morning — which is how a 7-day
            milk withdrawal came to be announced as clear on the day of the
            injection. What is due now sits above the line; what is coming sits
            below it, and says so.
          */}
          {due.length > 0 ? (
            <AlertList
              alerts={due.map(toRow)}
              action={resolveAlertAction}
              heldBack={mine.heldBack}
            />
          ) : (
            <EmptyState
              title="Nothing to do today"
              hint="The jobs below are coming later this week."
            />
          )}

          {ahead.length > 0 ? (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-semibold text-ink-2">
                Coming this week — nothing to do yet
              </h2>
              <AlertList alerts={ahead.map(toRow)} action={resolveAlertAction} heldBack={0} />
            </section>
          ) : null}
        </>
      )}

      {rate ? (
        <div className="mt-6">
          <CompletionRateCard r={rate} />
          <p className="mt-2 text-center text-xs text-ink-3">
            Since {startOfMonth(asOf)}. We count jobs done, never alerts sent — a list nobody acts on
            is worth less than no list at all.
          </p>
        </div>
      ) : null}

      {can(session.role, "ADMIN") ? (
        <Card className="mt-6">
          <h2 className="text-lg font-semibold">Check again</h2>
          <p className="mt-1 text-sm text-ink-2">
            Re-reads every module and raises anything new. Safe to press as often as you like — it
            never raises the same job twice.
          </p>
          <form action={refreshAlertsAction} className="mt-3">
            <input type="hidden" name="asOf" value={asOf} />
            <button
              type="submit"
              className="rounded-md border border-line bg-surface px-5 py-3 text-base font-semibold"
            >
              <span aria-hidden className="mr-2">🔄</span>
              Check the farm now
            </button>
          </form>
        </Card>
      ) : null}
    </main>
  );
}

/** The shape `AlertList` renders. The view carries more than a row needs. */
function toRow(a: Awaited<ReturnType<typeof alertsForRole>>["alerts"][number]) {
  return {
    id: a.id,
    kind: a.kind,
    animalId: a.animalId,
    animalName: a.animalName,
    action: a.action,
    dueLabel: a.dueLabel,
    daysOverdue: a.daysOverdue,
    severity: a.severity,
  };
}
