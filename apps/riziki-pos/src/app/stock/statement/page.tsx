import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, can } from "@/lib/auth";
import { businessDate, formatKes } from "@/lib/units";
import {
  stockStatement,
  statementRange,
  readStatementPeriod,
  STATEMENT_PERIOD_LABEL,
} from "@/lib/stock-statement";
import { describeRange } from "@/lib/reports";
import { PageTitle, SectionLabel, Card, Empty, Alert } from "@/components/ui";
import {
  StatementPeriods,
  StatementFlow,
  StatementTable,
  StatementTakings,
} from "@/components/stock-statement";
import { profitSummary } from "@/lib/reports";
import { PrintButton } from "../../invoice/[id]/print-button";

export const dynamic = "force-dynamic";

/**
 * The stock movement statement, in full.
 *
 * The front page carries the summary and the biggest movers, because that is
 * what is wanted at a glance. This is the same figures for every item the shop
 * holds — the page you print at month end and the one that goes to whoever does
 * the books.
 *
 * Opening is not a stored number. Stock in this system is the sum of its
 * movements and nothing else, which is precisely why it can be asked as at any
 * date at all, including dates nobody thought to ask about at the time.
 */
export default async function StockStatementPage(props: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const sp = await props.searchParams;
  const period = readStatementPeriod(sp);
  const range = statementRange(period, businessDate(), sp.from, sp.to);
  const statement = stockStatement(range);

  // The money is a cost figure like any other, and is the owner's.
  const seesCost = can(user, "cost");
  // The same period's takings, from the sales record, so this page and Reports
  // are the same numbers rather than two calculations of them.
  const takings = seesCost ? profitSummary(range) : null;

  const held = statement.rows.filter((r) => r.closingMilli !== 0).length;

  return (
    <div>
      <PageTitle
        title="Stock movement"
        subtitle={`${STATEMENT_PERIOD_LABEL[period]} · ${describeRange(range)}`}
      />

      <div className="no-print mb-3 flex flex-wrap items-end justify-between gap-2">
        <StatementPeriods action="/stock/statement" current={period} range={range} />
        {/* `PrintButton` is `flex-1` for the invoice's button row; here it is one
            button beside a picker, so the stretch is capped. */}
        <div className="flex w-auto shrink-0">
          <PrintButton label="Print this statement" />
        </div>
      </div>

      {seesCost ? (
        <div className="mb-4">
          <StatementFlow totals={statement.totals} uncosted={statement.uncosted}>
            <StatementTakings
              salesCents={takings!.salesCents}
              cogsCents={takings!.cogsCents}
              profitCents={takings!.grossProfitCents}
            />
          </StatementFlow>
        </div>
      ) : (
        <div className="mb-4">
          <Alert tone="warn">
            What the shelf is worth is the owner’s figure. The quantities below are yours to
            read.
          </Alert>
        </div>
      )}

      <SectionLabel>
        {statement.rows.length} item{statement.rows.length === 1 ? "" : "s"} · {statement.movedCount}{" "}
        moved · {held} holding stock
      </SectionLabel>

      {statement.rows.length ? (
        <StatementTable rows={statement.rows} />
      ) : (
        <Card>
          <Empty>Nothing was held and nothing moved in this period.</Empty>
        </Card>
      )}

      <p className="mt-3 text-[11px] text-muted">
        Every figure here is the ledger added up — nothing is stored, so nothing can drift. Tap any
        name for the entries behind it.{" "}
        <Link href="/stocktake" className="font-bold text-brand-dark">
          Count the stock →
        </Link>
      </p>

      {seesCost && statement.rows.length ? (
        <p className="mt-1 text-[11px] text-muted">
          Closing stock is worth {formatKes(statement.totals.closingValueCents)} at cost.
        </p>
      ) : null}
    </div>
  );
}
