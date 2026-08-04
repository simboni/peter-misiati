import { requirePageCapability } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { issuePrefill, recordIssues } from "@/server/feed";
import { IssueForm } from "@/components/feed/forms";
import { BackLink, EmptyState, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The daily issue. Prefilled from yesterday and labelled as such (R5), so an
 * unchanged day is two taps (R2).
 */
export default async function IssuePage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const session = await requirePageCapability("RECORD");
  // params and searchParams are always async in Next 16.
  const { group = "LACTATING" } = await searchParams;
  const asOf = today();
  const rows = await issuePrefill(session, asOf);

  return (
    <main className="mx-auto max-w-2xl p-4">
      <BackLink to="/feed" />
      <PageTitle sub="Change what is different today and save. Anything left at zero is not recorded.">
        Feed issued today
      </PageTitle>
      {rows.length === 0 ? (
        <EmptyState title="No feeds set up yet" hint="Record a purchase first and the list fills itself in." />
      ) : (
        <IssueForm
          action={recordIssues}
          today={asOf}
          group={group}
          rows={rows.map((r) => ({
            feedItemId: r.feedItemId,
            name: r.name,
            unit: r.unit,
            unitWeightKg: r.unitWeightKg,
            quantity: r.quantity,
            prefilledFrom: r.prefilledFrom,
          }))}
        />
      )}
    </main>
  );
}
