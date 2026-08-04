import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession, can } from "@/lib/dal";
import { addDays, startOfMonth, today, type ISODate } from "@/lib/domain/dates";
import { kes, litres } from "@/lib/money";
import { BackLink, Card, Chip, EmptyState, PageTitle } from "@/components/ui";
import {
  moneyThisMonth,
  cowLeagueTable,
  whatNeedsDoingThisWeek,
  milkProduction,
  breedingPerformance,
  healthReport,
  feedReport,
  herdInventoryMovement,
  coopReconciliation,
  payrollReport,
  isReportName,
} from "@/server/reports";
import { MoneyReport } from "@/components/reports/money-report";
import { LeagueTable } from "@/components/reports/league-table";
import { WeekPlanView } from "@/components/reports/week-plan";
import { ReportHeader, Table } from "@/components/reports/conclusion";
import { ExportLink } from "@/components/reports/export-links";

export const dynamic = "force-dynamic";

/**
 * One report per page.
 *
 * Every branch below renders the same way round: the conclusion, then the
 * actions, then the figures. Max two levels of navigation (R8) — home, reports,
 * this page, and nothing deeper.
 */
export default async function ReportPage({ params }: { params: Promise<{ name: string }> }) {
  const session = await verifySession();
  const { name } = await params; // Next 16: params is always a Promise.
  if (!isReportName(name) || name === "all" || name === "daily-sheet") notFound();

  const asOf = today();
  const monthFrom = startOfMonth(asOf);
  const seesMoney = can(session.role, "VIEW_MONEY");

  const moneyOnly = ["money-this-month", "cow-league", "coop", "payroll"];
  if (moneyOnly.includes(name) && !seesMoney) {
    return (
      <Shell title="Not for you">
        <EmptyState
          title="This report is not yours to see"
          hint="Ask the owner or the manager for anything about cost, price or pay."
        />
      </Shell>
    );
  }

  switch (name) {
    case "money-this-month": {
      const r = await moneyThisMonth(session, asOf);
      return (
        <Shell title="Money this month" exportName="money-this-month">
          <MoneyReport r={r} />
        </Shell>
      );
    }

    case "cow-league": {
      const r = await cowLeagueTable(session, addDays(asOf, -89), asOf);
      return (
        <Shell title="Cow league table" exportName="cow-league">
          <LeagueTable r={r} />
        </Shell>
      );
    }

    case "this-week": {
      const r = await whatNeedsDoingThisWeek(session, asOf);
      return (
        <Shell title="This week" exportName="this-week">
          <WeekPlanView r={r} />
        </Shell>
      );
    }

    case "milk-production": {
      const r = await milkProduction(session, monthFrom, asOf);
      return (
        <Shell title="Milk production" exportName="milk-production">
          <ReportHeader
            title="Milk production"
            period={`${r.from} to ${r.to}`}
            sentence={r.sentence}
            actions={r.actions}
          />
          <Card className="mb-5">
            <h2 className="text-lg font-semibold">Every cow</h2>
            <div className="mt-3">
              <Table
                headers={["Cow", "Litres", "A day", "Share"]}
                align={["left", "right", "right", "right"]}
                rows={r.perCow.map((c) => [
                  <Link key="n" href={`/herd/${c.animalId}`} className="underline">
                    {c.name}
                  </Link>,
                  c.litres.toFixed(1),
                  c.dailyAverageL.toFixed(1),
                  `${Math.round(c.sharePct)}%`,
                ])}
              />
            </div>
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Day by day</h2>
            <div className="mt-3">
              <Table
                headers={["Day", ...r.perDay[0]?.bySession.map((b) => b.session) ?? [], "Total"]}
                align={["left", "right", "right", "right"]}
                rows={r.perDay.map((d) => [
                  d.dayLabel,
                  ...d.bySession.map((b) => b.litres.toFixed(1)),
                  d.totalL.toFixed(1),
                ])}
              />
            </div>
          </Card>
        </Shell>
      );
    }

    case "breeding": {
      const r = await breedingPerformance(session, addDays(asOf, -364), asOf);
      return (
        <Shell title="Breeding performance" exportName="breeding">
          <ReportHeader
            title="Breeding performance"
            period={`${r.from} to ${r.to}`}
            sentence={r.sentence}
            actions={r.actions}
          />
          <div className="space-y-3">
            {r.kpis.map((k) => (
              <Card key={k.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-semibold">{k.label}</h2>
                  <span className="text-xl font-semibold tabular-nums">
                    {k.value === null ? "—" : `${k.value} ${k.unit === "%" ? "%" : k.unit}`}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Chip tone={k.onTarget === null ? "neutral" : k.onTarget ? "ok" : "danger"}>
                    {k.onTarget === null ? "No data" : k.onTarget ? "On target" : "Off target"}
                  </Chip>
                  <Chip tone="neutral">Target {k.targetValue}</Chip>
                </div>
                <p className="mt-2 text-sm text-ink-2">{k.verdict}</p>
              </Card>
            ))}
          </div>
        </Shell>
      );
    }

    case "health": {
      const r = await healthReport(session, monthFrom, asOf);
      return (
        <Shell title="Health" exportName="health">
          <ReportHeader
            title="Health"
            period={`${r.from} to ${r.to}`}
            sentence={r.sentence}
            actions={r.actions}
            tone={r.withdrawalLog.some((w) => w.milkBlocked) ? "danger" : "brand"}
          />
          {r.withdrawalLog.length > 0 ? (
            <Card className="mb-5">
              <h2 className="text-lg font-semibold">Milk that must not be sold</h2>
              <ul className="mt-3 space-y-2">
                {r.withdrawalLog.map((w) => (
                  <li
                    key={w.animalId}
                    className="rounded-md border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm font-medium"
                  >
                    <span aria-hidden className="mr-2">⛔</span>
                    {w.plainMessage ?? w.unknownMessage}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-ink-2">
                {litres(r.litresDiscarded)} thrown away this period, worth {kes(r.litresDiscardedKes)}.
              </p>
            </Card>
          ) : null}
          <Card className="mb-5">
            <h2 className="text-lg font-semibold">What was treated</h2>
            <div className="mt-3">
              <Table
                headers={["Date", "Animal", "What", "Cost"]}
                align={["left", "left", "left", "right"]}
                rows={r.treatments.map((t) => [
                  t.occurredOn,
                  t.who,
                  t.title,
                  t.costKes > 0 ? kes(t.costKes) : "—",
                ])}
              />
            </div>
          </Card>
          {r.diseaseIncidence.length > 0 ? (
            <Card>
              <h2 className="text-lg font-semibold">What keeps coming back</h2>
              <div className="mt-3">
                <Table
                  headers={["Diagnosis", "Cases", "Animals", "Per 100 head"]}
                  align={["left", "right", "right", "right"]}
                  rows={r.diseaseIncidence.map((d) => [
                    d.diagnosis,
                    d.cases,
                    d.animals,
                    d.per100Head.toFixed(1),
                  ])}
                />
              </div>
            </Card>
          ) : null}
        </Shell>
      );
    }

    case "feed": {
      const r = await feedReport(session, monthFrom, asOf);
      return (
        <Shell title="Feed" exportName="feed">
          <ReportHeader
            title="Feed"
            period={`${r.from} to ${r.to}`}
            sentence={r.sentence}
            actions={r.actions}
            tone={r.runningOut.length > 0 ? "warn" : "brand"}
          />
          <Card className="mb-5">
            <h2 className="text-lg font-semibold">In the store</h2>
            <div className="mt-3">
              <Table
                headers={["Feed", "Balance", "Cover", "What to do"]}
                align={["left", "right", "right", "left"]}
                rows={r.store.map((l) => [
                  l.name,
                  `${l.balanceKg.toFixed(0)} kg`,
                  l.cover.daysOfCover === null ? "—" : `${l.cover.daysOfCover} d`,
                  l.cover.message,
                ])}
              />
            </div>
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">What it cost a litre</h2>
            <div className="mt-3">
              <Table
                headers={["Feed", "Kg used", "Cost", "Per litre"]}
                align={["left", "right", "right", "right"]}
                rows={r.consumption.map((c) => [
                  c.name,
                  c.kg.toFixed(0),
                  kes(c.costKes),
                  kes(c.costPerLitreKes, 2),
                ])}
              />
            </div>
          </Card>
        </Shell>
      );
    }

    case "herd-inventory": {
      const r = await herdInventoryMovement(session, monthFrom, asOf);
      return (
        <Shell title="Herd movement" exportName="herd-inventory">
          <ReportHeader
            title="Herd movement"
            period={`${r.from} to ${r.to}`}
            sentence={r.sentence}
            actions={r.actions}
            tone={r.balances ? "brand" : "danger"}
          />
          <Card>
            <Table
              headers={["Line", "Head"]}
              align={["left", "right"]}
              rows={[
                ["Opening", r.opening],
                ["Born", `+${r.births}`],
                ["Bought", `+${r.purchases}`],
                ["Died", `−${r.deaths}`],
                ["Sold or culled", `−${r.sales}`],
                ["Should be", r.computedClosing],
                ["Register says", r.closing],
              ]}
            />
          </Card>
        </Shell>
      );
    }

    case "coop": {
      const r = await coopReconciliation(session, {
        from: addDays(asOf, -365) as ISODate,
        to: asOf,
      });
      return (
        <Shell title="Co-op reconciliation" exportName="coop">
          <ReportHeader
            title="Co-op reconciliation"
            sentence={r.sentence}
            actions={r.actions}
            tone={Math.abs(r.totalVarianceKes) > 0 ? "warn" : "brand"}
          />
          <Card>
            <Table
              headers={["Buyer", "Period", "Ours", "Theirs", "Out by"]}
              align={["left", "left", "right", "right", "right"]}
              rows={r.statements.map((x) => [
                x.customerName,
                `${x.periodStart} → ${x.periodEnd}`,
                x.ourLitres.toFixed(1),
                x.theirLitres.toFixed(1),
                kes(x.litresVarianceKes),
              ])}
            />
          </Card>
        </Shell>
      );
    }

    case "payroll": {
      const r = await payrollReport(session, asOf);
      return (
        <Shell title="Payroll" exportName="payroll">
          <ReportHeader
            title={`Payroll — ${r.month}`}
            sentence={r.sentence}
            actions={r.actions}
          />
          <Card className="mb-5">
            <h2 className="text-lg font-semibold">Payslips</h2>
            <div className="mt-3">
              <Table
                headers={["Name", "Gross", "Deductions", "Net"]}
                align={["left", "right", "right", "right"]}
                rows={(r.run?.payslips ?? []).map((p) => [
                  p.fullName,
                  kes(p.slip.grossKes),
                  kes(p.slip.totalDeductionsKes),
                  kes(p.slip.netKes),
                ])}
              />
            </div>
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Due by {r.remittances.dueOn}</h2>
            <div className="mt-3">
              <Table
                headers={["Head", "Total", "Pay to"]}
                align={["left", "right", "left"]}
                rows={r.remittances.lines.map((l) => [l.label, kes(l.totalKes), l.payTo])}
              />
            </div>
          </Card>
        </Shell>
      );
    }

    default:
      notFound();
  }
}

function Shell({
  title,
  exportName,
  children,
}: {
  title: string;
  exportName?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <BackLink to="/reports" label="Reports" />
      <PageTitle>{title}</PageTitle>
      {children}
      {exportName ? (
        <div className="mt-6">
          <ExportLink name={exportName} label="Download as a spreadsheet (CSV)" />
        </div>
      ) : null}
    </main>
  );
}
