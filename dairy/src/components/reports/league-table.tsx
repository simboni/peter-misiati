/**
 * The cow league table.
 *
 * The loss-makers are named at the top of the screen with their action, before
 * the ranking is shown at all — a table in which the owner has to find the
 * negative numbers themselves is a table that gets closed.
 */
import Link from "next/link";
import { kes } from "@/lib/money";
import { Card, Chip, EmptyState } from "@/components/ui";
import type { CowLeagueTable } from "@/server/reports";
import { ReportHeader, Table } from "./conclusion";

const ACTION_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  KEEP: "ok",
  WATCH: "warn",
  INVESTIGATE: "warn",
  CULL: "danger",
  SELL_AS_BREEDER: "neutral",
};

const ACTION_LABEL: Record<string, string> = {
  KEEP: "Keep",
  WATCH: "Watch",
  INVESTIGATE: "Check her",
  CULL: "Sell her",
  SELL_AS_BREEDER: "Sell as a breeder",
};

export function LeagueTable({ r }: { r: CowLeagueTable }) {
  if (r.herdSize === 0) {
    return (
      <div className="space-y-5">
        <ReportHeader
          title="Cow league table"
          period={`${r.from} to ${r.to}`}
          sentence={r.sentence}
          actions={r.actions}
        />
        <EmptyState title="No animals yet" hint="Register the herd and this table fills itself." />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ReportHeader
        title="Cow league table"
        period={`${r.from} to ${r.to} · ${r.windowDays} days`}
        sentence={r.sentence}
        actions={r.actions}
        tone={r.lossMakers.length > 0 ? "warn" : "brand"}
      />

      {/* The loss-makers, NAMED, before anything else. */}
      {r.lossMakers.length > 0 ? (
        <Card>
          <h2 className="text-lg font-semibold text-danger">
            <span aria-hidden className="mr-2">⛔</span>
            Losing money: {r.lossMakers.map((l) => l.name ?? l.tag).join(", ")}
          </h2>
          <ul className="mt-3 space-y-3">
            {r.lossMakers.map((l) => (
              <li key={l.animalId} className="border-l-2 border-danger pl-3">
                <p className="flex items-center gap-2 font-medium">
                  <Link href={`/herd/${l.animalId}`} className="underline">
                    {l.who}
                  </Link>
                  <Chip tone={ACTION_TONE[l.action] ?? "neutral"}>
                    {ACTION_LABEL[l.action] ?? l.action}
                  </Chip>
                </p>
                <p className="mt-1 text-sm text-ink-2">{l.recommendation}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-ink-3">
            {Math.round(r.lossMakerSharePct)}% of the herd. Most dairies sit at{" "}
            {r.expectedLossMakerSharePct.low}–{r.expectedLossMakerSharePct.high}%.
          </p>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-lg font-semibold">Every cow, best first</h2>
        <p className="mt-1 text-sm text-ink-2">
          Milk valued at {kes(r.pricePerLitreKes, 2)} a litre — what yours actually fetched. Feed and
          vet cost are charged to each cow.
        </p>
        <div className="mt-3">
          <Table
            headers={["#", "Cow", "L/day", "Milk", "Feed", "Vet", "Margin", "Do"]}
            align={["right", "left", "right", "right", "right", "right", "right", "left"]}
            rows={r.rows.map((c) => [
              c.rank,
              <Link key="n" href={`/herd/${c.animalId}`} className="underline">
                {c.name ?? c.tag}
              </Link>,
              c.dailyYieldL.toFixed(1),
              kes(c.milkRevenueKes),
              kes(c.feedCostKes),
              kes(c.vetCostKes),
              <span key="m" className={c.losing ? "font-semibold text-danger" : ""}>
                {kes(c.marginKes)}
              </span>,
              <Chip key="a" tone={ACTION_TONE[c.action] ?? "neutral"}>
                {ACTION_LABEL[c.action] ?? c.action}
              </Chip>,
            ])}
          />
        </div>
      </Card>
    </div>
  );
}
