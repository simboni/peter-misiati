import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, can } from "@/lib/auth";
import { businessDate, formatKes } from "@/lib/units";
import {
  stockStatement,
  statementRange,
  readStatementPeriod,
  sortRows,
  isStatementSort,
  isSortDirection,
  STATEMENT_PERIOD_LABEL,
  type StatementSort,
  type SortDirection,
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
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const sp = await props.searchParams;
  const period = readStatementPeriod(sp);
  const range = statementRange(period, businessDate(), sp.from, sp.to);
  const statement = stockStatement(range);

  /*
    The order, in the URL like everything else on this screen.

    Alphabetical by default, because a statement is read down a list of names
    until it is read for a reason — and then the reason is almost always "which
    one moved the most", which is one press on a column heading away.
  */
  const sort: StatementSort = isStatementSort(sp.sort) ? sp.sort : "name";
  const dir: SortDirection = isSortDirection(sp.dir) ? sp.dir : sort === "name" ? "asc" : "desc";
  const rows = sortRows(statement.rows, sort, dir);

  const hrefFor = (col: StatementSort, next: SortDirection) => {
    const q = new URLSearchParams({ period });
    if (period === "custom") {
      q.set("from", range.from);
      q.set("to", range.to);
    }
    q.set("sort", col);
    q.set("dir", next);
    return `/stock/statement?${q.toString()}`;
  };

  // The money is a cost figure like any other, and is the owner's.
  const seesCost = can(user, "cost");
  // The same period's takings, from the sales record, so this page and Reports
  // are the same numbers rather than two calculations of them.
  const takings = seesCost ? profitSummary(range) : null;

  const held = statement.rows.filter((r) => r.closingMilli !== 0).length;

  return (
    <div>
      {/*
        THE PRINTED COPY WAS LOSING ITS LAST TWO COLUMNS.

        The table scrolls sideways on screen, which is right — eight columns do
        not fit a phone. On paper there is nothing to scroll, so the overflow
        box simply cut Adjusted and Closing off the edge of the sheet: the shop
        printed a stock statement with no closing stock on it, which is the one
        figure it is for.

        Landscape, smaller type, and the overflow released. The rule against
        breaking a row across pages is here too — half a row at a page turn is
        a figure read twice or not at all.
      */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .stmt-table { overflow: visible !important; box-shadow: none !important; }
          .stmt-table table { font-size: 9.5px; width: 100%; }
          .stmt-table th, .stmt-table td { padding: 3px 5px !important; }
          .stmt-table tr { break-inside: avoid; page-break-inside: avoid; }
          .stmt-table thead { display: table-header-group; }
        }
      `}</style>

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
        <>
          <StatementTable
            rows={rows}
            className="stmt-table"
            sort={sort}
            dir={dir}
            hrefFor={hrefFor}
          />
          {sort !== "name" ? (
            <p className="no-print mt-2 text-[11px] text-muted">
              Sorted by what each one is worth at cost, biggest first — kilos, litres and pieces
              cannot be ranked against each other, but what they are worth can.{" "}
              <Link href={hrefFor("name", "asc")} className="font-bold text-brand-dark">
                Back to A–Z
              </Link>
            </p>
          ) : null}
        </>
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
