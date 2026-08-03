import Link from "next/link";
import { requireCapability } from "@/lib/dal";
import { addDays, endOfMonth, startOfMonth, today } from "@/lib/domain/dates";
import { kes, num } from "@/lib/money";
import { formatDay } from "@/server/milk";
import {
  coopCustomers,
  farmMemberNo,
  listStatements,
  recordStatementAction,
  statementView,
} from "@/server/sales";
import { StatementForm } from "@/components/sales/StatementForm";
import { Card, Chip, EmptyState, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The month-end reconciliation. The differentiating feature of the module: the
 * co-op's statement against the farm's own delivery records, line by line.
 */
export default async function StatementPage() {
  const session = await requireCapability("VIEW_MONEY");
  const lastMonth = startOfMonth(addDays(startOfMonth(today()), -1));

  const [customers, memberNo, statements] = await Promise.all([
    coopCustomers(session),
    farmMemberNo(session),
    listStatements(session),
  ]);

  const views = await Promise.all(
    statements.slice(0, 6).map((row) => statementView(session, row.statement.id)),
  );

  return (
    <main className="mx-auto max-w-3xl p-4 pb-16">
      <PageTitle sub="Their numbers against ours, line by line.">Co-op statement</PageTitle>

      <nav className="mb-4 flex flex-wrap gap-3 text-sm">
        <Link className="underline" href="/sales">Today&apos;s milk</Link>
        <Link className="underline" href="/sales/customers">Customers</Link>
        <Link className="underline" href="/sales/aging">Who owes us</Link>
      </nav>

      {customers.length === 0 ? (
        <EmptyState
          title="No co-operative or processor on file"
          hint="Add the co-op as a customer first — the statement is checked against what we delivered to them."
        />
      ) : (
        <StatementForm
          customers={customers.map((c) => ({ id: c.id, name: c.name }))}
          memberNo={memberNo}
          defaultPeriod={{ start: lastMonth, end: endOfMonth(lastMonth) }}
          action={recordStatementAction}
        />
      )}

      {views.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-lg font-semibold">Statements already checked</h2>
          <ul className="space-y-3">
            {views.map((v) => {
              const queried =
                v.reconciliation.unmatchedDeductionsKes > 0 ||
                Math.abs(v.reconciliation.litresVariance) > 0.5;
              return (
                <li key={v.statement.id}>
                  <Card className={queried ? "border-brass" : ""}>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-semibold">{v.customerName}</span>
                      <span className="text-sm text-ink-2">
                        {formatDay(v.statement.periodStart)} – {formatDay(v.statement.periodEnd)}
                      </span>
                      <span className="ml-auto text-lg font-semibold tabular-nums">
                        {kes(num(v.statement.netPayKes))}
                      </span>
                      {queried ? <Chip tone="warn">query this</Chip> : <Chip tone="ok">agrees</Chip>}
                    </div>
                    <p className="mt-2 text-sm">{v.reconciliation.message}</p>
                    {v.reconciliation.deductionLines.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-sm text-ink-2">
                        {v.reconciliation.deductionLines.map((l) => (
                          <li key={`${l.label}-${l.theirValue}`}>
                            <span aria-hidden className="mr-2">{l.matched ? "✓" : "?"}</span>
                            {l.label} — {kes(l.theirValue ?? 0)}
                            {l.note ? ` · ${l.note}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="mt-2 text-xs text-ink-3">
                      They say {num(v.statement.coopLitres)} L · we recorded {v.ourLitres} L across{" "}
                      {v.ourDeliveries} deliveries.
                    </p>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
