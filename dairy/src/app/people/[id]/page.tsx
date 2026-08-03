import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { kes } from "@/lib/money";
import { getEmployee, recordAttendanceAction, roleLabel } from "@/server/people";
import { AttendanceForm } from "@/components/people/people-forms";
import { Card, Chip, Num, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function EmployeePage({
  params,
}: {
  // Next 16: params is always a promise.
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await verifySession();

  let employee;
  try {
    employee = await getEmployee(session, id, today());
  } catch {
    notFound();
  }

  const e = employee;
  const r = e.record;

  const paperwork: Array<[string, string | null]> = [
    ["National ID", r.nationalId],
    ["KRA PIN", r.kraPin],
    ["NSSF number", r.nssfNo],
    ["SHA / SHIF number", r.shaNo],
    ["Phone", r.phone],
    ["Next of kin", r.nextOfKin],
  ];
  const missing = paperwork.filter(([, v]) => !v).map(([k]) => k);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24">
      <Link href="/people" className="mb-3 inline-block text-sm text-ink-2">
        <span aria-hidden>←</span> People
      </Link>
      <PageTitle sub={`${roleLabel(r.role)} · started ${r.startedOn}`}>{r.fullName}</PageTitle>

      <div className="mb-4 flex flex-wrap gap-2">
        <Chip tone={r.employmentType === "CASUAL" ? "warn" : "neutral"}>
          {r.employmentType === "CASUAL"
            ? "Casual"
            : r.employmentType === "TERM"
              ? "Fixed term"
              : "Permanent"}
        </Chip>
        <Chip>{r.housingProvided ? "Housed by the farm" : "15% housing allowance due"}</Chip>
        <Chip>
          <Num>{kes(e.basicWageKes)}</Num>
          {r.wagePeriod === "DAILY" ? " a day" : " a month"}
        </Chip>
      </div>

      {e.casual.warn ? (
        <div
          className={`mb-4 rounded-md border-l-4 px-3 py-3 text-sm ${
            e.casual.converted ? "border-danger bg-danger-soft font-medium" : "border-brass bg-brass-soft"
          }`}
          role="alert"
        >
          <span aria-hidden className="mr-2">
            ⚠
          </span>
          {e.casual.message}
        </div>
      ) : null}

      {e.minimumWage.below ? (
        <div className="mb-4 rounded-md border-l-4 border-brass bg-brass-soft px-3 py-3 text-sm">
          <span aria-hidden className="mr-2">
            ⚠
          </span>
          {e.minimumWage.message} This is a compliance reference — the wage is recorded as it is.
        </div>
      ) : null}

      <Card className="mb-4">
        <h2 className="mb-3 text-lg font-semibold">Attendance</h2>
        <p className="mb-3 text-sm text-ink-2">
          {e.consecutiveDays > 0
            ? `${e.consecutiveDays} ${e.consecutiveDays === 1 ? "day" : "days"} worked in a row.`
            : "No unbroken run of days recorded."}
        </p>
        <AttendanceForm
          action={recordAttendanceAction}
          employeeId={r.id}
          employeeName={r.fullName}
          today={today()}
        />
      </Card>

      <Card className="mb-4">
        <h2 className="mb-3 text-lg font-semibold">Leave</h2>
        <dl className="grid grid-cols-3 gap-3 text-center">
          <div>
            <dt className="text-xs text-ink-3">Accrued</dt>
            <dd className="text-lg font-semibold tabular-nums">{e.leaveAccruedDays.toFixed(1)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Taken</dt>
            <dd className="text-lg font-semibold tabular-nums">{e.leaveTakenDays.toFixed(1)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Left</dt>
            <dd className="text-lg font-semibold tabular-nums">{e.leaveBalanceDays.toFixed(1)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-ink-3">
          21 working days a year, accruing at 1.75 days a month. {e.monthsWorked.toFixed(1)} months
          worked so far.
        </p>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Paperwork</h2>
        <dl className="space-y-2 text-sm">
          {paperwork.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-2">{label}</dt>
              <dd className={value ? "font-medium" : "text-ink-3"}>{value ?? "not on file"}</dd>
            </div>
          ))}
        </dl>
        {missing.length > 0 ? (
          <p className="mt-3 text-xs text-ink-3">
            Still to collect: {missing.join(", ")}. None of it blocks payroll.
          </p>
        ) : null}
      </Card>
    </main>
  );
}
