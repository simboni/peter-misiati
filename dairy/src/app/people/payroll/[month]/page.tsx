import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { kes } from "@/lib/money";
import {
  approvePayrollAction,
  getPayrollRun,
  markPaidAction,
  remittanceSummary,
  roleLabel,
} from "@/server/people";
import { PayrollActions } from "@/components/people/people-forms";
import { BackLink, Card, Chip, Num, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS_TONE = { DRAFT: "warn", APPROVED: "brand", PAID: "ok" } as const;

export default async function PayrollMonthPage({
  params,
}: {
  // Next 16: params is always a promise.
  params: Promise<{ month: string }>;
}) {
  const { month } = await params;
  const session = await verifySession();

  let run;
  try {
    run = await getPayrollRun(session, month);
  } catch {
    notFound();
  }
  if (!run) notFound();

  const due = await remittanceSummary(session, month);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <BackLink to="/people/payroll" label="Payroll" />
      <PageTitle sub={run.headline}>Payroll {run.periodMonth.slice(0, 7)}</PageTitle>

      <div className="mb-4 flex items-center gap-2">
        <Chip tone={STATUS_TONE[run.status]}>
          {run.status === "DRAFT" ? "Draft" : run.status === "APPROVED" ? "Approved" : "Paid"}
        </Chip>
        {run.status === "DRAFT" ? (
          <span className="text-sm text-ink-3">Nothing is owed to anyone until this is approved.</span>
        ) : null}
      </div>

      <div className="mb-5 no-print">
        <PayrollActions
          approveAction={approvePayrollAction}
          payAction={markPaidAction}
          runId={run.runId}
          status={run.status}
          today={today()}
        />
      </div>

      <div className="mb-5 overflow-x-auto">
        <table className="w-full min-w-[42rem] border-collapse text-sm print-sheet">
          <caption className="sr-only">Payslips for {run.periodMonth.slice(0, 7)}</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
              <th className="py-2 pr-2">Who</th>
              <th className="py-2 pr-2 text-right">Days</th>
              <th className="py-2 pr-2 text-right">Gross</th>
              <th className="py-2 pr-2 text-right">NSSF</th>
              <th className="py-2 pr-2 text-right">SHIF</th>
              <th className="py-2 pr-2 text-right">Levy</th>
              <th className="py-2 pr-2 text-right">PAYE</th>
              <th className="py-2 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {run.payslips.map((p) => (
              <tr key={p.payslipId} className="border-b border-line">
                <td className="py-2 pr-2">
                  {p.fullName}
                  <span className="ml-2 text-xs text-ink-3">{roleLabel(p.role)}</span>
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{p.daysWorked || "—"}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{kes(p.slip.grossKes)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{kes(p.slip.nssfTotalKes)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{kes(p.slip.shifKes)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{kes(p.slip.housingLevyKes)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {p.slip.payeKes === 0 ? (
                    <span className="text-ink-3">none</span>
                  ) : (
                    kes(p.slip.payeKes)
                  )}
                </td>
                <td className="py-2 text-right font-semibold tabular-nums">{kes(p.slip.netKes)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="py-2 pr-2">Total</td>
              <td />
              <td className="py-2 pr-2 text-right tabular-nums">{kes(run.totalGrossKes)}</td>
              <td colSpan={4} />
              <td className="py-2 text-right tabular-nums">{kes(run.totalNetKes)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {run.payslips.some((p) => p.slip.payeKes === 0) ? (
        <Card className="mb-4">
          <p className="text-sm">
            <span aria-hidden className="mr-2">
              ℹ
            </span>
            A wage below roughly KES 24,000 a month owes no PAYE at all — the tax is smaller than the
            KES 2,400 personal relief. NSSF, SHIF and the Housing Levy are still due on every
            shilling, including for casuals.
          </p>
        </Card>
      ) : null}

      <Card className="mb-4">
        <h2 className="text-lg font-semibold">What the farm pays on top</h2>
        <p className="mt-1 text-sm text-ink-2">
          <Num>{kes(run.totalEmployerCostKes)}</Num> of employer contributions, on top of{" "}
          {kes(run.totalGrossKes)} of gross wages. The real wage bill is{" "}
          {kes(run.totalGrossKes + run.totalEmployerCostKes)}.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Due by {due.dueOn}</h2>
        <ul className="mt-3 space-y-2">
          {due.lines.map((l) => (
            <li key={l.head} className="flex items-baseline justify-between gap-2 text-sm">
              <span>
                {l.label}
                <span className="ml-2 text-xs text-ink-3">{l.payTo}</span>
              </span>
              <span className="tabular-nums">{kes(l.totalKes)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-3 text-sm font-semibold">
          Total <Num>{kes(due.totalKes)}</Num>
        </p>
      </Card>
    </main>
  );
}
