/**
 * Money this month, on screen.
 *
 * The two cost-per-litre figures are shown SIDE BY SIDE and each carries its
 * own label. Showing one alone is how a farm concludes it is profitable when
 * it is only ignoring its own fodder, its own labour and its own shed.
 */
import { kes, litres } from "@/lib/money";
import { Card, Chip } from "@/components/ui";
import type { MoneyThisMonth } from "@/server/reports";
import { Figure, ReportHeader, Table } from "./conclusion";

export function MoneyReport({ r }: { r: MoneyThisMonth }) {
  const outsideBenchmark =
    r.litresProduced > 0 &&
    (r.fullCostPerLitreKes > r.benchmark.highKes || r.fullCostPerLitreKes < r.benchmark.lowKes);

  return (
    <div className="space-y-5">
      <ReportHeader
        title="Money this month"
        period={`${r.from} to ${r.to}`}
        sentence={r.sentence}
        actions={r.actions}
        tone={r.netKes < 0 ? "danger" : "brand"}
      />

      <Card>
        <h2 className="text-lg font-semibold">What a litre costs you</h2>
        <p className="mt-1 text-sm text-ink-2">{r.benchmarkVerdict}</p>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <Figure
            label="Cash — what left your pocket"
            value={kes(r.cashCostPerLitreKes, 2)}
            note={`${kes(r.cashCostKes)} over ${litres(r.litresProduced)}`}
          />
          <Figure
            label="Full — including your own fodder, labour and shed"
            value={kes(r.fullCostPerLitreKes, 2)}
            note={`${kes(r.fullCostKes)} over ${litres(r.litresProduced)}`}
            tone={outsideBenchmark ? "warn" : "ok"}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <Chip tone="neutral">
            Kenya Dairy Board KES {r.benchmark.lowKes}–{r.benchmark.highKes}
          </Chip>
          <Chip tone="neutral">Farm gate about KES {r.benchmark.farmGateKes}</Chip>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Margin over feed</h2>
        <p className="mt-1 text-sm text-ink-2">{r.marginOverFeed.message}</p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Figure label="Milk" value={kes(r.marginOverFeed.revenuePerLitreKes, 2)} note="a litre" />
          <Figure label="Feed" value={kes(r.marginOverFeed.feedCostPerLitreKes, 2)} note="a litre" />
          <Figure
            label="Left"
            value={kes(r.marginOverFeed.marginPerLitreKes, 2)}
            note="a litre"
            tone={r.marginOverFeed.marginPerLitreKes > 0 ? "ok" : "danger"}
          />
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Where the milk went</h2>
        <div className="mt-3">
          <Table
            headers={["Channel", "", "Litres", "KES", "Per litre"]}
            align={["left", "left", "right", "right", "right"]}
            rows={r.revenueByChannel.map((c) => [
              c.label,
              c.kind === "REVENUE" ? (
                <Chip key="k" tone="ok">Sold</Chip>
              ) : c.kind === "IMPUTED" ? (
                <Chip key="k" tone="neutral">Not sold</Chip>
              ) : (
                <Chip key="k" tone="danger">Lost</Chip>
              ),
              c.litres.toFixed(1),
              c.kind === "LOSS" ? "—" : kes(c.valueKes),
              c.ratePerLitreKes != null ? kes(c.ratePerLitreKes, 2) : "—",
            ])}
          />
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">What it cost</h2>
        <div className="mt-3">
          <Table
            headers={["Cost", "KES", "Share"]}
            align={["left", "right", "right"]}
            rows={r.costsByCategory.map((c) => [
              c.label,
              kes(c.amountKes),
              `${Math.round(c.pctOfTotal)}%`,
            ])}
          />
        </div>
        {r.pendingCount > 0 ? (
          <p className="mt-3 rounded-md border-l-4 border-brass bg-brass-soft px-3 py-2 text-sm">
            <span aria-hidden className="mr-2">⚠</span>
            {r.pendingCount} {r.pendingCount === 1 ? "entry is" : "entries are"} waiting for approval
            ({kes(r.pendingKes)}) and {r.pendingCount === 1 ? "is" : "are"} not counted above.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
