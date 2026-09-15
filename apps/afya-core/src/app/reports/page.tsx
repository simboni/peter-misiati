import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import {
  computeReturn, getReturn, listReturns, returnLines, variance, outstandingNotifications,
  type FormCode,
} from "@/lib/reporting.ts";
import { claimsSummary } from "@/lib/claims.ts";
import { formatKes, facilityLeakage } from "@/lib/billing.ts";
import { turnaround } from "@/lib/orders.ts";
import { attendance } from "@/lib/scheduling.ts";
import { today } from "@/lib/db.ts";
import { Shell, Stat, Section, Empty, Banner } from "@/app/_components/shell.tsx";
import { generateAction, submitAction, detectAction, notifyAction } from "./actions.ts";

const FORMS: { code: FormCode; name: string }[] = [
  { code: "MOH705A", name: "MOH 705A — outpatient, under five" },
  { code: "MOH705B", name: "MOH 705B — outpatient, five and over" },
  { code: "MOH717", name: "MOH 717 — workload" },
];

/**
 * Reports.
 *
 * MOH returns generated from the transactions the facility already recorded,
 * rather than re-keyed from a tally sheet — which is the specific weakness this
 * product was built against. The variance panel is deliberate: a submitted
 * return stays what was sent, and the drift since is a finding.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; form?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const params = await searchParams;
  const period = params.period && /^\d{4}-\d{2}$/.test(params.period) ? params.period : today().slice(0, 7);
  const form = (FORMS.find((f) => f.code === params.form)?.code ?? "MOH717") as FormCode;

  const live = computeReturn({ facilityId: user.facilityId, form, period });
  const stored = getReturn(user.facilityId, form, period);
  const drift = stored ? variance({ facilityId: user.facilityId, form, period }) : [];
  const history = listReturns(user.facilityId, 12);
  const notifiable = outstandingNotifications(user.facilityId);

  const claims = claimsSummary();
  const leakage = facilityLeakage(user.facilityId);
  const lab = turnaround("lab");
  const monthStart = `${period}-01`;
  const monthEnd = `${period}-31`;
  const clinic = attendance({ facilityId: user.facilityId, from: monthStart, to: monthEnd });

  return (
    <Shell
      user={user}
      current="/reports"
      title="Reports"
      subtitle="Generated from what the facility recorded. Nothing here is typed twice."
    >
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat
          label="Claim acceptance"
          value={claims.acceptanceRatePercent === null ? "—" : `${claims.acceptanceRatePercent}%`}
          tone={
            claims.acceptanceRatePercent === null
              ? "muted"
              : claims.acceptanceRatePercent >= 90
                ? "good"
                : claims.acceptanceRatePercent >= 80
                  ? "clock"
                  : "block"
          }
          note={`${claims.total} claims`}
          href="/claims"
        />
        <Stat
          label="Revenue leakage"
          value={formatKes(leakage.totalCents)}
          tone={leakage.totalCents > 0 ? "clock" : "good"}
          note={`${leakage.encounters} encounters not invoiced`}
        />
        <Stat
          label="Lab turnaround"
          value={lab.length ? `${lab[0].medianHours}h` : "—"}
          tone="muted"
          note={lab.length ? `slowest: ${lab[0].serviceName}` : "nothing reported"}
        />
        <Stat
          label="No-show rate"
          value={clinic.noShowRatePercent === null ? "—" : `${clinic.noShowRatePercent}%`}
          tone={clinic.noShowRatePercent === null ? "muted" : clinic.noShowRatePercent > 20 ? "block" : "good"}
          note="appointments this month"
        />
      </div>

      <Section title="MOH return">
        <form className="bg-white border border-line rounded px-4 py-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            Form
            <select name="form" defaultValue={form} className="block border border-line rounded px-2 py-1.5 text-sm bg-white">
              {FORMS.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Month
            <input
              name="period"
              type="month"
              defaultValue={period}
              className="block border border-line rounded px-2 py-1.5 text-sm tnum bg-white"
            />
          </label>
          <button type="submit" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
            Show
          </button>
        </form>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm bg-white border border-line rounded">
            <thead>
              <tr className="text-xs text-muted text-left">
                <th className="px-3 py-2 font-medium">Data element</th>
                <th className="px-3 py-2 font-medium text-right">Now</th>
                {stored ? <th className="px-3 py-2 font-medium text-right">As submitted</th> : null}
              </tr>
            </thead>
            <tbody>
              {live.map((line) => {
                const was = stored ? (JSON.parse(stored.values_json)[line.element] as number | undefined) : undefined;
                const moved = was !== undefined && was !== line.value;
                return (
                  <tr key={line.element} className="border-t border-line">
                    <td className="px-3 py-2">{line.label}</td>
                    <td className={`px-3 py-2 text-right tnum font-semibold ${moved ? "text-clock" : ""}`}>
                      {line.value}
                    </td>
                    {stored ? (
                      <td className="px-3 py-2 text-right tnum text-muted">{was ?? "—"}</td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {drift.length > 0 ? (
          <div className="mt-3">
            <Banner tone="clock">
              {drift.length} figure{drift.length === 1 ? " has" : "s have"} moved since this return was
              submitted — late entries, corrections or a merged duplicate. What was sent is still what was
              sent; this is the difference, and it is a finding rather than something to hide.
            </Banner>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <form action={generateAction}>
            <input type="hidden" name="form" value={form} />
            <input type="hidden" name="period" value={period} />
            <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
              {stored ? "Regenerate the draft" : "Generate"}
            </button>
          </form>
          {stored && stored.status !== "submitted" && stored.status !== "accepted" ? (
            <form action={submitAction}>
              <input type="hidden" name="form" value={form} />
              <input type="hidden" name="period" value={period} />
              <button type="submit" className="bg-good text-white font-semibold rounded px-4 py-2 text-sm">
                Submit to KHIS
              </button>
            </form>
          ) : null}
          {stored ? (
            <span className="text-xs text-muted tnum">
              {stored.status === "submitted" || stored.status === "accepted"
                ? `Submitted ${stored.submitted_at?.slice(0, 16).replace("T", " ")} · ${stored.reference}`
                : stored.last_error
                  ? `Not sent: ${stored.last_error}`
                  : `Draft generated ${stored.generated_at.slice(0, 16).replace("T", " ")}`}
            </span>
          ) : null}
        </div>
      </Section>

      <Section
        title="Notifiable diseases"
        note="The Public Health Act clock runs from diagnosis, not from the monthly return."
      >
        <form action={detectAction} className="mb-3">
          <button type="submit" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
            Scan the diagnoses
          </button>
        </form>
        {notifiable.length === 0 ? (
          <Empty>Nothing is waiting to be reported to the county.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {notifiable.map((n) => (
              <li
                key={n.id}
                className={`border rounded px-4 py-3 flex flex-wrap items-end gap-2 ${
                  n.daysWaiting > 2 ? "bg-block-soft border-block/25" : "bg-clock-soft border-clock/25"
                }`}
              >
                <div className="min-w-[14rem]">
                  <div className="text-sm font-semibold">{n.condition_term}</div>
                  <div className="font-mono text-xs text-muted tnum">
                    {n.condition_code} · {n.patient_mrn} · detected {n.detected_at.slice(0, 10)} (
                    {n.daysWaiting} day{n.daysWaiting === 1 ? "" : "s"} ago)
                  </div>
                </div>
                <form action={notifyAction} className="flex items-end gap-2 ml-auto">
                  <input type="hidden" name="eventId" value={n.id} />
                  <input
                    name="reference"
                    required
                    placeholder="County reference"
                    className="w-44 border border-line rounded px-2 py-1.5 text-sm bg-white"
                  />
                  <button type="submit" className="bg-brand text-white font-semibold rounded px-3 py-2 text-sm">
                    Reported
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Returns filed">
        {history.length === 0 ? (
          <Empty>No return has been generated yet.</Empty>
        ) : (
          <table className="w-full text-sm bg-white border border-line rounded">
            <thead>
              <tr className="text-xs text-muted text-left">
                <th className="px-3 py-2 font-medium">Period</th>
                <th className="px-3 py-2 font-medium">Form</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium text-right">Elements</th>
                <th className="px-3 py-2 font-medium text-right">Reference</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2 tnum">{r.period}</td>
                  <td className="px-3 py-2">{r.form}</td>
                  <td
                    className={`px-3 py-2 ${
                      r.status === "submitted" || r.status === "accepted"
                        ? "text-good"
                        : r.status === "rejected"
                          ? "text-block"
                          : "text-muted"
                    }`}
                  >
                    {r.status}
                  </td>
                  <td className="px-3 py-2 text-right tnum">{returnLines(r).length}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs tnum text-muted">
                    {r.reference ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </Shell>
  );
}
