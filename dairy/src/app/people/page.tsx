import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { today, startOfMonth } from "@/lib/domain/dates";
import { kes } from "@/lib/money";
import { casualConversionWatch, listEmployees, minimumWageReport } from "@/server/people";
import { Card, Chip, EmptyState, Num, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const session = await verifySession();
  const asOf = today();

  const [staff, casuals, wages] = await Promise.all([
    listEmployees(session, asOf),
    casualConversionWatch(session, asOf),
    minimumWageReport(session),
  ]);

  const active = staff.filter((e) => !e.endedOn || e.endedOn >= asOf);
  const monthlyBill = active.reduce(
    (t, e) => t + (e.wagePeriod === "DAILY" ? e.basicWageKes * 26 : e.basicWageKes),
    0,
  );

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <Link href="/" className="mb-3 inline-block text-sm text-ink-2">
        <span aria-hidden>←</span> Home
      </Link>
      <PageTitle
        sub={`${active.length} on the farm · roughly ${kes(monthlyBill)} of basic wages a month`}
      >
        People
      </PageTitle>

      {/* The compliance feature that saves a tribunal. It goes first. */}
      {casuals.length > 0 ? (
        <section className="mb-4 space-y-2">
          {casuals.map((c) => (
            <div
              key={c.employeeId}
              className={`rounded-md border-l-4 px-3 py-3 text-sm ${
                c.warning.converted
                  ? "border-danger bg-danger-soft font-medium"
                  : "border-brass bg-brass-soft"
              }`}
              role="alert"
            >
              <span aria-hidden className="mr-2">
                ⚠
              </span>
              {c.warning.message}
            </div>
          ))}
        </section>
      ) : null}

      <nav className="mb-5 grid grid-cols-2 gap-3" aria-label="People">
        <Link
          href="/people/payroll"
          className="tap flex flex-col items-start rounded-lg border border-line bg-surface p-4 hover:border-brand"
        >
          <span aria-hidden className="text-2xl">
            💵
          </span>
          <span className="mt-1 font-semibold">Payroll</span>
          <span className="text-xs text-ink-3">Wages, deductions, what is due by the 9th</span>
        </Link>
        <Link
          href="/people/new"
          className="tap flex flex-col items-start rounded-lg border border-line bg-surface p-4 hover:border-brand"
        >
          <span aria-hidden className="text-2xl">
            ＋
          </span>
          <span className="mt-1 font-semibold">Add someone</span>
          <span className="text-xs text-ink-3">Onboarding and paperwork</span>
        </Link>
      </nav>

      {active.length === 0 ? (
        <EmptyState title="Nobody on the staff list yet" hint="Add the herdsman first." />
      ) : (
        <ul className="space-y-2">
          {active.map((e) => (
            <li key={e.id}>
              <Link href={`/people/${e.id}`} className="tap block">
                <Card className="hover:border-brand">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">
                      {e.fullName}
                      <span className="ml-2 text-sm font-normal text-ink-3">{e.roleLabel}</span>
                    </span>
                    <span className="tabular-nums text-sm font-semibold">
                      <Num>{kes(e.basicWageKes)}</Num>
                      <span className="font-normal text-ink-3">
                        {e.wagePeriod === "DAILY" ? " a day" : " a month"}
                      </span>
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Chip tone={e.employmentType === "CASUAL" ? "warn" : "neutral"}>
                      {e.employmentType === "CASUAL"
                        ? "Casual"
                        : e.employmentType === "TERM"
                          ? "Fixed term"
                          : "Permanent"}
                    </Chip>
                    {e.casual.converted ? <Chip tone="danger">Now a term employee by law</Chip> : null}
                    {e.minimumWage.below ? <Chip tone="warn">Below the gazetted minimum</Chip> : null}
                    {!e.housingProvided ? <Chip>Housing allowance due</Chip> : null}
                    <span className="ml-auto text-xs text-ink-3">
                      {e.leaveBalanceDays.toFixed(1)} days leave left
                    </span>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {wages.belowCount > 0 ? (
        <Card className="mt-5">
          <h2 className="text-base font-semibold">Where you stand on the minimum wage</h2>
          <p className="mt-1 text-sm text-ink-2">
            {wages.belowCount} of {wages.rows.length}{" "}
            {wages.belowCount === 1 ? "wage is" : "wages are"} below the gazetted agricultural
            minimum. This is shown so you know, not to stop you recording what you actually pay.
          </p>
          <p className="mt-2 text-xs text-ink-3">{wages.note}</p>
        </Card>
      ) : null}

      <p className="mt-6 text-xs text-ink-3">
        Payroll month starts {startOfMonth(asOf)}.
      </p>
    </main>
  );
}
