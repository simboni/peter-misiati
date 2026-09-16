import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  payrollSummary, listRuns, getRun, payslipsFor, statutoryReturn,
  listEmployees, getEmployee, payItemsFor, payslipHistory, computePay,
  allRates, ratesInForce,
} from "@/lib/payroll.ts";
import { formatKes } from "@/lib/billing.ts";
import { today } from "@/lib/db.ts";
import { Shell, Stat, Section, Empty, Views } from "@/app/_components/shell.tsx";
import {
  hireAction, endEmploymentAction, payItemAction, runAction,
  approveAction, payAction, cancelAction,
} from "./actions.ts";

/**
 * Payroll.
 *
 * The rates view is not an afterthought. It is the module's claim: every
 * statutory figure is a row with a date it took effect and a note of where it
 * came from, so correcting one after a Finance Act is a data change rather than
 * a release.
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";
const LABEL = "block text-xs text-muted mb-1";

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; r?: string; e?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "user.manage")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "runs";
  const acting = can(user.userId, "user.manage");

  const summary = payrollSummary(user.facilityId);
  const runs = listRuns(user.facilityId);
  const staff = listEmployees(user.facilityId, true);
  const rates = allRates();

  const openRun = params.r ? getRun(params.r) : undefined;
  const slips = openRun ? payslipsFor(openRun.id) : [];
  const statutory = openRun ? statutoryReturn(openRun.id) : undefined;

  const openEmployee = params.e ? getEmployee(params.e) : undefined;
  const openItems = openEmployee ? payItemsFor(openEmployee.id, today()) : [];
  const openHistory = openEmployee ? payslipHistory(openEmployee.id) : [];
  const preview = openEmployee?.active
    ? computePay({ employeeId: openEmployee.id, payDate: `${today().slice(0, 7)}-28` })
    : undefined;

  const nextPeriod = today().slice(0, 7);
  const href = (v: string) => (v === "runs" ? "/payroll" : `/payroll?view=${v}`);

  return (
    <Shell
      user={user}
      current={href(view)}
      error={params.error}
      title={
        view === "staff" ? "Staff" : view === "rates" ? "Statutory rates" : "Payroll runs"
      }
      subtitle={
        view === "rates"
          ? "Every rate is a row with the date it took effect and where it came from. A payroll with its rates compiled in is wrong the month after every Finance Act."
          : view === "runs"
            ? "Prepared by one person, approved by another. A paid run is never edited — a correction is a new run."
            : undefined
      }
    >
      <Views
        current={view}
        views={[
          { key: "runs", label: "Runs", href: "/payroll" },
          { key: "staff", label: "Staff", href: "/payroll?view=staff" },
          { key: "rates", label: "Statutory rates", href: "/payroll?view=rates" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="On the payroll" value={summary.employees} note={`${summary.leavers} left`} />
        <Stat
          label="Monthly gross"
          value={formatKes(summary.monthlyGrossCents)}
          tone="ink"
          note={`${formatKes(summary.monthlyNetCents)} net, ${formatKes(summary.monthlyStatutoryCents)} statutory`}
        />
        <Stat
          label="Cannot be filed for"
          value={summary.missingKraPin}
          tone={summary.missingKraPin > 0 ? "block" : "good"}
          note={summary.missingKraPin > 0 ? "no KRA PIN — no PAYE return" : "every employee has a KRA PIN"}
        />
        <Stat
          label="Last run"
          value={summary.lastRun ?? "—"}
          tone={
            summary.lastRunStatus === "paid" ? "good"
            : summary.lastRunStatus === "draft" ? "clock" : "ink"
          }
          note={summary.lastRunStatus ? `${summary.lastRunStatus}${summary.cappedEmployees > 0 ? ` · ${summary.cappedEmployees} capped` : ""}` : "no run yet"}
        />
      </div>

      {/* ==================================================== runs */}
      {view === "runs" ? (
        <>
          <Section title="Runs">
            {runs.length === 0 ? (
              <Empty>No payroll has been run.</Empty>
            ) : (
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Period</th>
                    <th className="px-3 py-2 font-medium">Pay date</th>
                    <th className="px-3 py-2 font-medium text-right">Staff</th>
                    <th className="px-3 py-2 font-medium text-right">Net</th>
                    <th className="px-3 py-2 font-medium">Prepared</th>
                    <th className="px-3 py-2 font-medium">Approved</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className={`border-t border-line ${r.status === "cancelled" ? "opacity-60" : ""} ${r.id === openRun?.id ? "bg-brand-soft" : ""}`}>
                      <td className="px-3 py-2 font-mono text-xs font-semibold">{r.period}</td>
                      <td className="px-3 py-2 tnum text-muted">{r.pay_date}</td>
                      <td className="px-3 py-2 text-right tnum">{r.employees}</td>
                      <td className="px-3 py-2 text-right tnum">{formatKes(r.net_cents)}</td>
                      <td className="px-3 py-2 text-xs text-muted">{r.preparer_name}</td>
                      <td className="px-3 py-2 text-xs text-muted">{r.approver_name || "—"}</td>
                      <td className={`px-3 py-2 text-xs font-semibold capitalize ${
                        r.status === "paid" ? "text-good" : r.status === "draft" ? "text-clock" : "text-muted"
                      }`}>{r.status}</td>
                      <td className="px-3 py-2 text-right">
                        <a href={`/payroll?r=${r.id}`} className="text-brand underline underline-offset-2 text-xs">Open</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {openRun && statutory ? (
            <Section
              title={`${openRun.period} — ${openRun.status}`}
              note={`Pay date ${openRun.pay_date} · prepared by ${openRun.preparer_name}${
                openRun.approver_name ? ` · approved by ${openRun.approver_name}` : ""
              }${openRun.payment_ref ? ` · ${openRun.payment_ref}` : ""}`}
            >
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm bg-white border border-line rounded">
                  <thead>
                    <tr className="text-xs text-muted text-left">
                      <th className="px-3 py-2 font-medium">Employee</th>
                      <th className="px-3 py-2 font-medium text-right">Gross</th>
                      <th className="px-3 py-2 font-medium text-right">NSSF</th>
                      <th className="px-3 py-2 font-medium text-right">SHIF</th>
                      <th className="px-3 py-2 font-medium text-right">Housing</th>
                      <th className="px-3 py-2 font-medium text-right">PAYE</th>
                      <th className="px-3 py-2 font-medium text-right">Other</th>
                      <th className="px-3 py-2 font-medium text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slips.map((p) => (
                      <tr key={p.id} className={`border-t border-line ${p.net_cents === 0 && p.gross_cents > 0 ? "bg-clock-soft" : ""}`}>
                        <td className="px-3 py-2">
                          {p.name}
                          <span className="font-mono text-[10px] text-muted ml-2">{p.payroll_no}</span>
                          {!p.kra_pin ? <span className="text-[10px] font-bold uppercase text-block ml-2">no PIN</span> : null}
                        </td>
                        <td className="px-3 py-2 text-right tnum">{formatKes(p.gross_cents)}</td>
                        <td className="px-3 py-2 text-right tnum text-muted">{formatKes(p.nssf_cents)}</td>
                        <td className="px-3 py-2 text-right tnum text-muted">{formatKes(p.shif_cents)}</td>
                        <td className="px-3 py-2 text-right tnum text-muted">{formatKes(p.housing_levy_cents)}</td>
                        <td className="px-3 py-2 text-right tnum text-muted">{formatKes(p.paye_cents)}</td>
                        <td className="px-3 py-2 text-right tnum text-muted">{p.other_deductions_cents ? formatKes(p.other_deductions_cents) : "—"}</td>
                        <td className={`px-3 py-2 text-right tnum font-semibold ${p.net_cents === 0 && p.gross_cents > 0 ? "text-clock" : ""}`}>
                          {formatKes(p.net_cents)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-ink font-bold">
                      <td className="px-3 py-2">{slips.length} employees</td>
                      <td className="px-3 py-2 text-right tnum">{formatKes(statutory.grossCents)}</td>
                      <td className="px-3 py-2 text-right tnum">{formatKes(statutory.nssfEmployeeCents)}</td>
                      <td className="px-3 py-2 text-right tnum">{formatKes(statutory.shifCents)}</td>
                      <td className="px-3 py-2 text-right tnum">{formatKes(statutory.housingEmployeeCents)}</td>
                      <td className="px-3 py-2 text-right tnum">{formatKes(statutory.payeCents)}</td>
                      <td className="px-3 py-2 text-right tnum">—</td>
                      <td className="px-3 py-2 text-right tnum">{formatKes(slips.reduce((s, p) => s + p.net_cents, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="bg-white border border-line rounded p-3 mb-4">
                <p className="text-sm font-semibold mb-1">What has to be remitted</p>
                <p className="text-xs text-muted mb-3">
                  The employer's own NSSF and housing levy are on top of what was deducted — a real cost that never
                  appears on a payslip.
                </p>
                <div className="grid gap-2 sm:grid-cols-3 text-sm">
                  {([
                    ["PAYE to KRA", statutory.payeCents],
                    ["SHIF", statutory.shifCents],
                    ["NSSF, employee", statutory.nssfEmployeeCents],
                    ["NSSF, employer", statutory.nssfEmployerCents],
                    ["Housing levy, employee", statutory.housingEmployeeCents],
                    ["Housing levy, employer", statutory.housingEmployerCents],
                  ] as const).map(([label, amount]) => (
                    <div key={label} className="flex justify-between border-b border-line py-1">
                      <span className="text-muted text-xs">{label}</span>
                      <span className="tnum">{formatKes(amount)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-sm font-bold mt-3">
                  Total remittable <span className="tnum">{formatKes(statutory.totalRemittableCents)}</span>
                </p>
              </div>

              {acting && openRun.status === "draft" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <form action={approveAction} className="bg-white border border-line rounded p-3">
                    <input type="hidden" name="runId" value={openRun.id} />
                    <p className="text-sm font-semibold mb-1">Approve</p>
                    <p className="text-xs text-muted mb-3">
                      {openRun.prepared_by === user.userId
                        ? "You prepared this one. Somebody else has to approve it — this is where a facility's largest recurring payment leaves."
                        : `Prepared by ${openRun.preparer_name}.`}
                    </p>
                    <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">Approve</button>
                  </form>
                  <form action={cancelAction} className="bg-white border border-line rounded p-3">
                    <input type="hidden" name="runId" value={openRun.id} />
                    <p className="text-sm font-semibold mb-1">Cancel and rerun</p>
                    <input name="reason" placeholder="why" className={FIELD} />
                    <button type="submit" className="mt-2 border border-line font-semibold rounded px-4 py-2 text-sm">Cancel</button>
                  </form>
                </div>
              ) : acting && openRun.status === "approved" ? (
                <form action={payAction} className="bg-white border border-line rounded p-3 flex gap-2 items-end">
                  <input type="hidden" name="runId" value={openRun.id} />
                  <label className="flex-1 max-w-xs"><span className={LABEL}>Payment reference</span>
                    <input name="paymentRef" className={FIELD} />
                  </label>
                  <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">Pay and post</button>
                </form>
              ) : null}
            </Section>
          ) : null}

          {acting ? (
            <Section title="Run a payroll" note="Refused if no statutory rate is in force for the pay date — producing zero deductions silently would be far worse.">
              <form action={runAction} className="bg-white border border-line rounded p-3 flex flex-wrap gap-3 items-end">
                <label className="w-40"><span className={LABEL}>Period</span>
                  <input name="period" defaultValue={nextPeriod} placeholder="2026-09" className={FIELD} />
                </label>
                <label className="w-44"><span className={LABEL}>Pay date</span>
                  <input type="date" name="payDate" defaultValue={`${nextPeriod}-28`} className={FIELD} />
                </label>
                <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">Prepare</button>
              </form>
            </Section>
          ) : null}
        </>
      ) : null}

      {/* =================================================== staff */}
      {view === "staff" ? (
        <>
          <Section title="Staff" note="A leaver stays on the record and off the payroll.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Number</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Terms</th>
                    <th className="px-3 py-2 font-medium text-right">Basic</th>
                    <th className="px-3 py-2 font-medium">KRA PIN</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((e) => (
                    <tr key={e.id} className={`border-t border-line ${!e.active ? "opacity-60" : ""} ${e.id === openEmployee?.id ? "bg-brand-soft" : ""}`}>
                      <td className="px-3 py-2 font-mono text-xs">{e.payroll_no}</td>
                      <td className="px-3 py-2">
                        {e.given_name} {e.family_name}
                        {!e.active ? <span className="text-[10px] uppercase text-muted ml-2">left {e.ended_on}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">{e.job_title}{e.department ? ` · ${e.department}` : ""}</td>
                      <td className="px-3 py-2 text-xs capitalize">{e.employment}</td>
                      <td className="px-3 py-2 text-right tnum">{formatKes(e.basic_cents)}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {e.kra_pin ?? <span className="text-block font-semibold">missing</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <a href={`/payroll?view=staff&e=${e.id}`} className="text-brand underline underline-offset-2 text-xs">Open</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {openEmployee ? (
            <Section
              title={`${openEmployee.given_name} ${openEmployee.family_name} — ${openEmployee.payroll_no}`}
              note={`${openEmployee.job_title || "no role recorded"} · ${openEmployee.employment} · started ${openEmployee.started_on}${
                openEmployee.ended_on ? ` · left ${openEmployee.ended_on}: ${openEmployee.end_reason}` : ""
              }`}
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  {preview ? (
                    <div className="bg-white border border-line rounded p-3 mb-4">
                      <p className="text-sm font-semibold mb-1">What this month would pay</p>
                      <p className="text-xs text-muted mb-3">Computed from the rates in force on the pay date, with the working shown.</p>
                      <div className="text-sm space-y-1">
                        {([
                          ["Gross", preview.grossCents],
                          ["NSSF", -preview.nssfCents],
                          ["SHIF", -preview.shifCents],
                          ["Housing levy", -preview.housingLevyCents],
                          ["PAYE", -preview.payeCents],
                          ["Other deductions", -preview.otherDeductionsCents],
                        ] as const).map(([label, amount]) => (
                          <div key={label} className="flex justify-between border-b border-line py-0.5">
                            <span className="text-muted text-xs">{label}</span>
                            <span className="tnum">{formatKes(amount)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between font-bold pt-1">
                          <span>Net</span>
                          <span className="tnum">{formatKes(preview.netCents)}</span>
                        </div>
                      </div>
                      <details className="mt-3">
                        <summary className="text-xs text-brand cursor-pointer">How it was arrived at</summary>
                        <ul className="text-xs text-muted mt-2 space-y-1">
                          {preview.workings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </details>
                    </div>
                  ) : null}

                  {openHistory.length > 0 ? (
                    <div className="bg-white border border-line rounded p-3">
                      <p className="text-sm font-semibold mb-2">Payslips</p>
                      <table className="w-full text-sm">
                        <tbody>
                          {openHistory.map((h) => (
                            <tr key={h.period} className="border-t border-line first:border-0">
                              <td className="py-1 font-mono text-xs">{h.period}</td>
                              <td className="py-1 text-right tnum text-muted">{formatKes(h.gross_cents)}</td>
                              <td className="py-1 text-right tnum font-semibold">{formatKes(h.net_cents)}</td>
                              <td className="py-1 text-xs text-muted capitalize pl-3">{h.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>

                <div>
                  <div className="bg-white border border-line rounded p-3 mb-4">
                    <p className="text-sm font-semibold mb-2">Allowances and deductions</p>
                    {openItems.length === 0 ? (
                      <p className="text-xs text-muted mb-3">Nothing beyond basic pay.</p>
                    ) : (
                      <table className="w-full text-sm mb-3">
                        <tbody>
                          {openItems.map((i) => (
                            <tr key={i.id} className="border-t border-line first:border-0">
                              <td className="py-1">{i.name}</td>
                              <td className="py-1 text-xs text-muted capitalize">{i.kind}</td>
                              <td className="py-1 text-xs">{i.kind === "allowance" ? (i.taxable ? "taxable" : "not taxable") : ""}</td>
                              <td className="py-1 text-right tnum">{formatKes(i.amount_cents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {acting && openEmployee.active ? (
                      <form action={payItemAction} className="border-t border-line pt-3">
                        <input type="hidden" name="employeeId" value={openEmployee.id} />
                        <div className="grid gap-2 sm:grid-cols-4">
                          <label><span className={LABEL}>Code</span><input name="code" className={FIELD} /></label>
                          <label className="sm:col-span-2"><span className={LABEL}>Name</span><input name="name" className={FIELD} /></label>
                          <label><span className={LABEL}>Amount (KES)</span><input name="amount" inputMode="decimal" className={FIELD} /></label>
                          <label><span className={LABEL}>Kind</span>
                            <select name="kind" className={FIELD}>
                              <option value="allowance">Allowance</option>
                              <option value="deduction">Deduction</option>
                            </select>
                          </label>
                          <label><span className={LABEL}>From</span><input type="date" name="startsOn" defaultValue={today()} className={FIELD} /></label>
                          <label><span className={LABEL}>Until</span><input type="date" name="endsOn" className={FIELD} /></label>
                          <label className="flex items-end pb-2">
                            <span className="flex items-center gap-1.5 text-sm">
                              <input type="checkbox" name="taxable" defaultChecked /> <span>Taxable</span>
                            </span>
                          </label>
                        </div>
                        <button type="submit" className="mt-2 border border-line font-semibold rounded px-4 py-2 text-sm">Add</button>
                      </form>
                    ) : null}
                  </div>

                  {acting && openEmployee.active ? (
                    <form action={endEmploymentAction} className="bg-white border border-line rounded p-3">
                      <input type="hidden" name="employeeId" value={openEmployee.id} />
                      <p className="text-sm font-semibold mb-2">End this employment</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label><span className={LABEL}>Last day</span><input type="date" name="endedOn" className={FIELD} /></label>
                        <label><span className={LABEL}>Why</span><input name="reason" className={FIELD} /></label>
                      </div>
                      <button type="submit" className="mt-2 border border-line text-muted font-semibold rounded px-4 py-2 text-sm">End</button>
                    </form>
                  ) : null}
                </div>
              </div>
            </Section>
          ) : null}

          {acting ? (
            <Section title="Add an employee" note="Without a KRA PIN there is no PAYE return; without an NSSF or SHIF number the contribution cannot be credited to the person it was deducted from.">
              <form action={hireAction} className="bg-white border border-line rounded p-3">
                <div className="grid gap-3 sm:grid-cols-4">
                  <label><span className={LABEL}>Payroll number</span><input name="payrollNo" className={FIELD} /></label>
                  <label><span className={LABEL}>Given name</span><input name="givenName" className={FIELD} /></label>
                  <label><span className={LABEL}>Family name</span><input name="familyName" className={FIELD} /></label>
                  <label><span className={LABEL}>Basic (KES)</span><input name="basic" inputMode="decimal" className={FIELD} /></label>
                  <label><span className={LABEL}>Job title</span><input name="jobTitle" className={FIELD} /></label>
                  <label><span className={LABEL}>Department</span><input name="department" className={FIELD} /></label>
                  <label><span className={LABEL}>Terms</span>
                    <select name="employment" className={FIELD}>
                      {["permanent", "contract", "locum", "intern", "casual"].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label><span className={LABEL}>Started</span><input type="date" name="startedOn" className={FIELD} /></label>
                  <label><span className={LABEL}>KRA PIN</span><input name="kraPin" className={FIELD} /></label>
                  <label><span className={LABEL}>NSSF number</span><input name="nssfNo" className={FIELD} /></label>
                  <label><span className={LABEL}>SHIF number</span><input name="shifNo" className={FIELD} /></label>
                  <label><span className={LABEL}>National ID</span><input name="nationalId" className={FIELD} /></label>
                  <label><span className={LABEL}>Bank</span><input name="bankName" className={FIELD} /></label>
                  <label><span className={LABEL}>Account</span><input name="bankAccount" className={FIELD} /></label>
                </div>
                <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">Add</button>
              </form>
            </Section>
          ) : null}
        </>
      ) : null}

      {/* =================================================== rates */}
      {view === "rates" ? (
        <Section
          title="Statutory rates"
          note="PAYE bands, NSSF tiers, SHIF and the housing levy have each changed within the last three years. Correcting one here is a data change, not a release."
        >
          <div className="bg-block-soft border border-block rounded p-3 mb-4">
            <p className="text-sm font-bold text-block mb-1">Confirm these before paying anybody</p>
            <p className="text-xs leading-relaxed">
              Every figure below was seeded from published rates as understood at the time of writing, which is not
              the same as being right today. An accountant must check each one against the current law. The reason
              they are rows rather than constants is precisely so that being wrong is a data problem.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-white border border-line rounded">
              <thead>
                <tr className="text-xs text-muted text-left">
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">In force from</th>
                  <th className="px-3 py-2 font-medium">Band</th>
                  <th className="px-3 py-2 font-medium text-right">Rate</th>
                  <th className="px-3 py-2 font-medium text-right">Amount</th>
                  <th className="px-3 py-2 font-medium">Where it came from</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r, i) => {
                  const current = ratesInForce(r.kind, today()).some((x) => x.effective_from === r.effective_from);
                  return (
                    <tr key={i} className={`border-t border-line ${current ? "" : "opacity-60"}`}>
                      <td className="px-3 py-2 text-xs capitalize">
                        {r.kind.replace(/_/g, " ")}
                        {current ? <span className="text-[10px] font-bold uppercase text-good ml-2">in force</span> : null}
                      </td>
                      <td className="px-3 py-2 tnum">{r.effective_from}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.lower_cents !== null
                          ? `${formatKes(r.lower_cents)} — ${r.upper_cents === null ? "above" : formatKes(r.upper_cents)}`
                          : r.label}
                      </td>
                      <td className="px-3 py-2 text-right tnum">{r.rate_bp !== null ? `${r.rate_bp / 100}%` : "—"}</td>
                      <td className="px-3 py-2 text-right tnum">
                        {r.amount_cents !== null ? formatKes(r.amount_cents)
                          : r.min_cents !== null ? `min ${formatKes(r.min_cents)}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">{r.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
    </Shell>
  );
}
