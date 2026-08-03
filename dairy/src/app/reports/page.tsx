import Link from "next/link";
import { verifySession, can } from "@/lib/dal";
import { today, startOfMonth, addDays } from "@/lib/domain/dates";
import { kes } from "@/lib/money";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import {
  moneyThisMonth,
  cowLeagueTable,
  whatNeedsDoingThisWeek,
  type CowLeagueTable,
  type MoneyThisMonth,
} from "@/server/reports";
import { ReportHeader } from "@/components/reports/conclusion";
import { ExportLink, FullExportCard } from "@/components/reports/export-links";

export const dynamic = "force-dynamic";

/**
 * The reports landing screen.
 *
 * The three reports that matter open the page, each reduced to its ONE
 * sentence with a link to the full thing. Everything else is a list below the
 * fold. The acceptance test for this screen is that an owner can be asked
 * "what should you do this week?" and answer from what is above it.
 */
export default async function ReportsPage() {
  const session = await verifySession();
  const asOf = today();
  const from = startOfMonth(asOf);
  const seesMoney = can(session.role, "VIEW_MONEY");

  const week = await whatNeedsDoingThisWeek(session, asOf);
  const money: MoneyThisMonth | null = seesMoney ? await moneyThisMonth(session, asOf) : null;
  const league: CowLeagueTable | null = seesMoney
    ? await cowLeagueTable(session, addDays(asOf, -89), asOf)
    : null;

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <Link href="/" className="mb-3 inline-block text-sm text-ink-2">
        <span aria-hidden>←</span> Home
      </Link>
      <PageTitle sub={`As at ${asOf}`}>How the farm is doing</PageTitle>

      {/* ---- 1. This week. First, because it is the only one that is a job. ---- */}
      <Link href="/reports/this-week" className="block">
        <ReportHeader
          title="What needs doing this week"
          sentence={week.sentence}
          actions={week.actions.slice(0, 3)}
          tone={week.criticalCount > 0 ? "danger" : "brand"}
        />
      </Link>

      {/* ---- 2. Money this month ---- */}
      {money ? (
        <Link href="/reports/money-this-month" className="block">
          <ReportHeader
            title="Money this month"
            period={`${from} to ${asOf}`}
            sentence={money.sentence}
            actions={money.actions.slice(0, 2)}
            tone={money.netKes < 0 ? "danger" : "brand"}
          />
        </Link>
      ) : null}

      {/* ---- 3. The cow league table ---- */}
      {league ? (
        <Link href="/reports/cow-league" className="block">
          <ReportHeader
            title="Cow league table"
            period="Last 90 days"
            sentence={league.sentence}
            actions={league.lossMakers.slice(0, 2).map((l) => l.recommendation)}
            tone={league.lossMakers.length > 0 ? "warn" : "brand"}
          />
        </Link>
      ) : null}

      {/* ---- Printing and paper ---- */}
      <Card className="mb-5">
        <h2 className="text-lg font-semibold">Print</h2>
        <p className="mt-1 text-sm text-ink-2">
          The daily sheet prints the way the notebook is already laid out — cow names down the left,
          each milking across. Keep the paper log beside the phone; M-Pesa does.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/reports/print/daily"
            className="tap inline-flex items-center gap-2 rounded-md bg-brand px-5 py-3 text-base font-semibold text-white"
          >
            <span aria-hidden>🖨</span>
            Today&rsquo;s milk sheet
          </Link>
          <ExportLink name="daily-sheet" label="Today's sheet (CSV)" />
        </div>
      </Card>

      {/* ---- The rest ---- */}
      <Card className="mb-5">
        <h2 className="text-lg font-semibold">The rest</h2>
        <nav className="mt-3 grid gap-2 sm:grid-cols-2">
          <ReportLink href="/reports/milk-production" icon="🥛" label="Milk production" />
          <ReportLink href="/reports/breeding" icon="♥" label="Breeding performance" />
          <ReportLink href="/reports/health" icon="💉" label="Health and withdrawals" />
          <ReportLink href="/reports/feed" icon="🌾" label="Feed and cover" />
          <ReportLink href="/reports/herd-inventory" icon="🐄" label="Herd movement" />
          {seesMoney ? (
            <>
              <ReportLink href="/reports/coop" icon="🧾" label="Co-op reconciliation" />
              <ReportLink href="/reports/payroll" icon="👥" label="Payroll and deductions" />
            </>
          ) : null}
        </nav>
      </Card>

      {seesMoney ? <FullExportCard /> : null}

      {!seesMoney ? (
        <EmptyState
          title="The money reports are not yours to see"
          hint="Ask the owner or the manager for anything about cost, price or pay."
        />
      ) : null}

      {money ? (
        <p className="mt-6 text-center text-xs text-ink-3">
          A litre costs you {kes(money.fullCostPerLitreKes, 2)} against a Kenya Dairy Board benchmark
          of KES {money.benchmark.lowKes}–{money.benchmark.highKes}.
        </p>
      ) : null}
    </main>
  );
}

function ReportLink({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link
      href={href}
      className="tap flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 hover:border-brand"
    >
      <span aria-hidden className="text-xl">{icon}</span>
      <span className="font-medium">{label}</span>
    </Link>
  );
}
