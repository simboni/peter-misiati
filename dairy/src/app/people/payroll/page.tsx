import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { startOfMonth, today } from "@/lib/domain/dates";
import { kes } from "@/lib/money";
import { listPayrollRuns, remittanceSummary, runPayrollAction } from "@/server/people";
import { RunPayrollForm } from "@/components/people/people-forms";
import { BackLink, Card, Chip, EmptyState, Num, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS_TONE = { DRAFT: "warn", APPROVED: "brand", PAID: "ok" } as const;

export default async function PayrollPage() {
  const session = await verifySession();
  const thisMonth = startOfMonth(today()).slice(0, 7);

  const [runs, due] = await Promise.all([
    listPayrollRuns(session),
    remittanceSummary(session, thisMonth),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24">
      <BackLink to="/people" label="People" />
      <PageTitle sub="PAYE, NSSF, SHIF and the Housing Levy — all due by the 9th of the following month.">
        Payroll
      </PageTitle>

      <Card className="mb-4">
        <h2 className="mb-2 text-lg font-semibold">Run a month</h2>
        <RunPayrollForm action={runPayrollAction} month={thisMonth} />
      </Card>

      <Card className="mb-4">
        <h2 className="text-lg font-semibold">Due to the state for {thisMonth}</h2>
        <p className="mt-1 text-sm text-ink-2">{due.headline}</p>
        <ul className="mt-3 space-y-2">
          {due.lines.map((l) => (
            <li key={l.head} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span>
                {l.label}
                <span className="ml-2 text-xs text-ink-3">{l.payTo}</span>
              </span>
              <span className="tabular-nums">
                <Num>{kes(l.totalKes)}</Num>
                {l.employerKes > 0 ? (
                  <span className="ml-2 text-xs text-ink-3">
                    ({kes(l.employeeKes)} from them, {kes(l.employerKes)} from you)
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-3 text-sm font-semibold">
          Total <Num>{kes(due.totalKes)}</Num> by {due.dueOn}
        </p>
      </Card>

      <h2 className="mb-2 text-lg font-semibold">Past runs</h2>
      {runs.length === 0 ? (
        <EmptyState title="No payroll has been run yet" hint="Pick a month above and work it out." />
      ) : (
        <ul className="space-y-2">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/people/payroll/${r.periodMonth.slice(0, 7)}`} className="tap block">
                <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-line bg-surface p-3 hover:border-brand">
                  <span className="font-medium">{r.periodMonth.slice(0, 7)}</span>
                  <span className="flex items-center gap-3">
                    <Chip tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? "neutral"}>
                      {r.status === "DRAFT" ? "Draft" : r.status === "APPROVED" ? "Approved" : "Paid"}
                    </Chip>
                    <span className="tabular-nums font-semibold">
                      <Num>{kes(r.totalNetKes)}</Num>
                    </span>
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
