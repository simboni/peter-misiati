import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { kes, litres } from "@/lib/money";
import { cullList, tradeLog } from "@/server/trading";
import { BackLink, Card, Chip, EmptyState, Num, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

const ACTION_TONE = {
  CULL: "danger",
  INVESTIGATE: "warn",
  WATCH: "warn",
  SELL_AS_BREEDER: "brand",
  KEEP: "ok",
} as const;

const ACTION_LABEL = {
  CULL: "Sell her",
  INVESTIGATE: "Look into it",
  WATCH: "Watch",
  SELL_AS_BREEDER: "Sell as a breeder",
  KEEP: "Keep",
} as const;

/**
 * Buying, selling, and the cull list.
 *
 * The cull list is the point of this screen: the herd ranked by margin with the
 * loss-makers named and given an action. Most dairies have 10–15% of their herd
 * losing money, and a 6 L/day cow's stall is worth more to a 15 L cow.
 */
export default async function TradingPage() {
  const session = await verifySession();
  const asOf = today();

  const [list, log] = await Promise.all([
    cullList(session, { asOf, windowDays: 90 }),
    tradeLog(session),
  ]);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <BackLink to="/" label="Home" />
      <PageTitle sub="The last 90 days, ranked by what each animal left after feed and vet cost.">
        Buying and selling
      </PageTitle>

      <nav className="mb-5 grid grid-cols-2 gap-3" aria-label="Trading">
        <Link
          href="/trading/sell"
          className="tap flex flex-col items-start rounded-lg border border-line bg-surface p-4 hover:border-brand"
        >
          <span aria-hidden className="text-2xl">
            ↗
          </span>
          <span className="mt-1 font-semibold">Sell an animal</span>
          <span className="text-xs text-ink-3">See what she was worth first</span>
        </Link>
        <Link
          href="/trading/buy"
          className="tap flex flex-col items-start rounded-lg border border-line bg-surface p-4 hover:border-brand"
        >
          <span aria-hidden className="text-2xl">
            ↘
          </span>
          <span className="mt-1 font-semibold">Buy an animal</span>
          <span className="text-xs text-ink-3">Bring one into the herd</span>
        </Link>
      </nav>

      <Card className="mb-4">
        <h2 className="text-lg font-semibold">Who is paying for their stall</h2>
        <p className="mt-1 text-base">{list.headline}</p>
        {list.herdSize > 0 ? (
          <p className="mt-2 text-xs text-ink-3">
            Milk valued at {kes(list.pricePerLitreKes, 2)} a litre. Group feed is split half evenly
            per head and half by litres, because a cow giving 8 litres eats almost the same
            maintenance ration as one giving 20.
          </p>
        ) : null}
      </Card>

      {list.candidates.length === 0 ? (
        <EmptyState title="No animals in the herd yet" hint="Buy one, or add one to the herd register." />
      ) : (
        <ul className="mb-6 space-y-2">
          {list.candidates.map((c) => (
            <li key={c.animalId}>
              <div
                className={`rounded-lg border-l-4 ${
                  c.losing ? "border-danger" : "border-line"
                } border-y border-r border-line bg-surface p-3`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {c.name ? `${c.name} (${c.tag})` : c.tag}
                    <span className="ml-2 text-sm font-normal text-ink-3">{c.classLabel}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Chip tone={ACTION_TONE[c.action]}>{ACTION_LABEL[c.action]}</Chip>
                    <span
                      className={`tabular-nums font-semibold ${c.losing ? "text-danger" : "text-ok"}`}
                    >
                      <Num>
                        {c.marginPerMonthKes >= 0 ? "+" : "−"}
                        {kes(Math.abs(c.marginPerMonthKes))}
                      </Num>
                      <span className="text-xs font-normal text-ink-3"> /month</span>
                    </span>
                  </span>
                </div>

                <p className="mt-2 text-sm text-ink-2">{c.recommendation}</p>

                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
                  <span>
                    <Num>{litres(c.dailyYieldL)}</Num> a day
                  </span>
                  <span>
                    milk <Num>{kes(c.milkRevenueKes)}</Num>
                  </span>
                  <span>
                    feed <Num>{kes(c.feedCostKes)}</Num>
                  </span>
                  {c.vetCostKes > 0 ? (
                    <span>
                      vet <Num>{kes(c.vetCostKes)}</Num>
                    </span>
                  ) : null}
                </dl>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section>
        <h2 className="mb-2 text-lg font-semibold">Bought and sold</h2>
        {log.length === 0 ? (
          <EmptyState title="Nothing traded yet" hint="Purchases and sales both show up here." />
        ) : (
          <ul className="space-y-2">
            {log.map((r) => (
              <li
                key={`${r.kind}-${r.animalId}`}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-line bg-surface p-3"
              >
                <span>
                  <span aria-hidden className="mr-2">
                    {r.kind === "BOUGHT" ? "↘" : "↗"}
                  </span>
                  <span className="font-medium">{r.name ? `${r.name} (${r.tag})` : r.tag}</span>
                  <span className="ml-2 text-sm text-ink-3">
                    {r.classLabel}
                    {r.detail ? ` · ${r.detail}` : ""}
                  </span>
                </span>
                <span className="tabular-nums text-sm font-semibold">
                  {r.kind === "BOUGHT" ? "−" : "+"}
                  {kes(r.valueKes)}
                  <span className="ml-2 font-normal text-ink-3">{r.onDate}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
