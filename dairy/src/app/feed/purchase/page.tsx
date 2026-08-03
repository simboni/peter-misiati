import { requireCapability } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { num } from "@/lib/money";
import { listFeedItems, recordPurchase } from "@/server/feed";
import { PurchaseForm } from "@/components/feed/forms";
import { EmptyState, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PurchasePage() {
  const session = await requireCapability("MANAGE_MONEY");
  const feeds = await listFeedItems(session);

  return (
    <main className="mx-auto max-w-2xl p-4">
      <PageTitle sub="Cost accuracy is won or lost here. Never a bag or a bale without its weight.">
        Record a feed purchase
      </PageTitle>
      {feeds.length === 0 ? (
        <EmptyState title="No feeds set up yet" hint="Add a feed to the catalogue first." />
      ) : (
        <PurchaseForm
          action={recordPurchase}
          today={today()}
          feeds={feeds.map((f) => ({
            id: f.id,
            name: f.name,
            defaultUnit: f.defaultUnit,
            defaultUnitWeightKg: f.defaultUnitWeightKg == null ? null : num(f.defaultUnitWeightKg),
          }))}
        />
      )}
    </main>
  );
}
