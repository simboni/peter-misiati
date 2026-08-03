import { verifySession, can } from "@/lib/dal";
import { addDays, today } from "@/lib/domain/dates";
import { kes } from "@/lib/money";
import { feedStore, marginOverFeedCost } from "@/server/feed";
import { Card, Chip, EmptyState, Num, PageTitle, TaskTile } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The feed store.
 *
 * Margin over feed cost leads the page because it is the single most useful
 * management number in dairy and almost no competitor computes it. Below it,
 * whatever is closest to running out — "order by Friday" is more actionable
 * than a stock figure.
 */
export default async function FeedPage() {
  const session = await verifySession();
  const asOf = today();
  const store = await feedStore(session, asOf);
  const showMoney = can(session.role, "VIEW_MONEY");
  const margin = showMoney ? await marginOverFeedCost(session, addDays(asOf, -29), asOf) : null;

  return (
    <main className="mx-auto max-w-3xl p-4">
      <PageTitle sub="What is in the store, how long it lasts, and what the milk is worth after feed.">
        Feed
      </PageTitle>

      {margin ? (
        <Card className="mb-5 border-brand">
          <p className="text-sm font-medium text-ink-2">Margin over feed cost — last 30 days</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums">
            {margin.litres === 0 ? "—" : `${kes(margin.marginPerLitre, 2)} a litre`}
          </p>
          <p className="mt-2 text-sm text-ink-2">{margin.message}</p>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-ink-3">Milk</dt>
              <dd className="font-medium">
                <Num>{margin.litres}</Num> L
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Milk value</dt>
              <dd className="font-medium">{kes(margin.milkRevenueKes)}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Feed cost</dt>
              <dd className="font-medium">{kes(margin.feedCostKes)}</dd>
            </div>
          </dl>
          {margin.uncostedFeeds.length > 0 ? (
            <p className="mt-3 text-xs text-ink-3">
              {margin.uncostedFeeds.join(", ")} had no purchase price on file, so {margin.uncostedFeeds.length === 1 ? "it is" : "they are"} counted at
              nothing. Record what the crop cost to grow and this number gets truer.
            </p>
          ) : null}
        </Card>
      ) : null}

      <section className="mb-5">
        <h2 className="mb-2 text-lg font-semibold">In the store</h2>
        {store.length === 0 ? (
          <EmptyState title="No feeds set up yet" hint="Record a purchase and the store fills itself in." />
        ) : (
          <ul className="space-y-2">
            {store.map((line) => {
              const days = line.cover.daysOfCover;
              const tone = days === null ? "neutral" : days <= 3 ? "danger" : days <= 7 ? "warn" : "ok";
              return (
                <li key={line.feedItemId}>
                  <Card className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{line.name}</p>
                      <p className="text-sm text-ink-2 tabular-nums">
                        {line.balanceInUnits} {line.unit === "KG" ? "kg" : `× ${line.unitWeightKg} kg`} ={" "}
                        {line.balanceKg} kg
                      </p>
                      {showMoney && line.costPerKgKes > 0 ? (
                        <p className="text-xs text-ink-3 tabular-nums">
                          {kes(line.costPerKgKes, 2)}/kg
                          {line.costPerKgDmKes ? ` · ${kes(line.costPerKgDmKes, 2)}/kg DM` : ""}
                        </p>
                      ) : null}
                    </div>
                    <Chip tone={tone}>{line.cover.message}</Chip>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <nav className="grid grid-cols-2 gap-3">
        <TaskTile href="/feed/issue" icon="🌾" label="Feed today" detail="Filled in from yesterday" />
        <TaskTile href="/feed/purchase" icon="🛒" label="Record a purchase" detail="Never without the weight" />
        <TaskTile href="/feed/ration" icon="⚖️" label="What to feed" detail="From what she is giving" />
        <TaskTile href="/feed/fodder" icon="🌱" label="Fodder grown" detail="Plots and harvests" />
      </nav>
    </main>
  );
}
