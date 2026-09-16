import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  hrSummary, leaveRegister, expiries, openCases, leaveTypes,
  currentContract, contractHistory, leaveBalance, leaveFor, coverFor,
  getLeaveRequest, casesFor, getCase, expiryHorizonDays,
} from "@/lib/hr.ts";
import { listEmployees, getEmployee } from "@/lib/payroll.ts";
import { today } from "@/lib/db.ts";
import { Shell, Stat, Section, Empty, Views } from "@/app/_components/shell.tsx";
import {
  contractAction, requestLeaveAction, decideLeaveAction, takenAction,
  cancelLeaveAction, adjustLeaveAction, openCaseAction, hearingAction, closeCaseAction,
} from "./actions.ts";

/**
 * Human resources.
 *
 * The leave register leads, because the question it answers — who is away, and
 * who is covering their licensed work — is the one an HR module in a clinic
 * exists for. Everything else here is paperwork by comparison.
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";
const LABEL = "block text-xs text-muted mb-1";

export default async function HrPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; e?: string; l?: string; c?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "user.manage")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "leave";
  const acting = can(user.userId, "user.manage");

  const summary = hrSummary(user.facilityId);
  const register = leaveRegister(user.facilityId, today());
  const expiring = expiries(user.facilityId);
  const cases = openCases(user.facilityId);
  const staff = listEmployees(user.facilityId, true);
  const types = leaveTypes();

  const openEmployee = params.e ? getEmployee(params.e) : undefined;
  const contract = openEmployee ? currentContract(openEmployee.id) : undefined;
  const contracts = openEmployee ? contractHistory(openEmployee.id) : [];
  const balances = openEmployee ? leaveBalance(openEmployee.id) : [];
  const history = openEmployee ? leaveFor(openEmployee.id) : [];
  const employeeCases = openEmployee ? casesFor(openEmployee.id) : [];

  const openRequest = params.l ? getLeaveRequest(params.l) : undefined;
  const requestCover = openRequest
    ? coverFor(openRequest.employee_id, openRequest.starts_on, openRequest.ends_on)
    : undefined;

  const openCase_ = params.c ? getCase(params.c) : undefined;
  const expiryHorizon = expiryHorizonDays();

  const href = (v: string) => (v === "leave" ? "/hr" : `/hr?view=${v}`);

  return (
    <Shell
      user={user}
      current={href(view)}
      error={params.error}
      title={
        view === "staff" ? "Staff records"
        : view === "expiries" ? "Licences & contracts"
        : view === "cases" ? "Disciplinary & grievance"
        : "Leave register"
      }
      subtitle={
        view === "leave"
          ? "Who is away, and who holds the same registration while they are. Matched on the regulator, not the job title."
          : view === "expiries"
            ? `Anything lapsing within ${expiryHorizon} days. A lapsed registration is not a reminder — the system is already refusing that person's licensed work.`
            : undefined
      }
    >
      <Views
        current={view}
        views={[
          { key: "leave", label: "Leave", href: "/hr" },
          { key: "staff", label: "Staff", href: "/hr?view=staff" },
          { key: "expiries", label: "Licences & contracts", href: "/hr?view=expiries" },
          { key: "cases", label: "Cases", href: "/hr?view=cases" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Staff" value={summary.staff} note={`${summary.onLeaveToday} away today · ${summary.leavers} left`} />
        <Stat
          label="Leave waiting"
          value={summary.leaveWaiting}
          tone={summary.leaveWaiting > 0 ? "clock" : "good"}
          note={summary.uncoveredLeave > 0 ? `${summary.uncoveredLeave} approved with nobody covering` : "nothing uncovered"}
        />
        <Stat
          label="Lapsed registrations"
          value={summary.lapsedLicences}
          tone={summary.lapsedLicences > 0 ? "block" : "good"}
          note={`${summary.expiringSoon} more expiring within ${expiryHorizon} days`}
        />
        <Stat
          label="Working with no contract"
          value={summary.noContract}
          tone={summary.noContract > 0 ? "block" : "good"}
          note={`${summary.contractsEnding} contracts ending · ${summary.openCases} open cases`}
        />
      </div>

      {/* ===================================================== leave */}
      {view === "leave" ? (
        <>
          <Section title="Leave register" note="Requests first, then by date.">
            {register.length === 0 ? (
              <Empty>Nobody is away and nothing is waiting.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm bg-white border border-line rounded">
                  <thead>
                    <tr className="text-xs text-muted text-left">
                      <th className="px-3 py-2 font-medium">Who</th>
                      <th className="px-3 py-2 font-medium">Leave</th>
                      <th className="px-3 py-2 font-medium">From</th>
                      <th className="px-3 py-2 font-medium">To</th>
                      <th className="px-3 py-2 font-medium text-right">Days</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {register.map((r) => (
                      <tr
                        key={r.id}
                        className={`border-t border-line ${
                          r.status === "requested" ? "bg-clock-soft" : r.uncovered_ack ? "bg-block-soft" : ""
                        } ${r.id === openRequest?.id ? "bg-brand-soft" : ""}`}
                      >
                        <td className="px-3 py-2">
                          {r.name}
                          <span className="text-xs text-muted ml-2">{r.job_title}</span>
                          {r.uncovered_ack ? (
                            <span className="text-[10px] font-bold uppercase text-block ml-2 tracking-wide">uncovered</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs">{r.leave_name}</td>
                        <td className="px-3 py-2 tnum">{r.starts_on}</td>
                        <td className="px-3 py-2 tnum">{r.ends_on}</td>
                        <td className="px-3 py-2 text-right tnum">{r.days}</td>
                        <td className={`px-3 py-2 text-xs font-semibold capitalize ${
                          r.status === "requested" ? "text-clock" : r.status === "taken" ? "text-muted" : "text-good"
                        }`}>{r.status}</td>
                        <td className="px-3 py-2 text-right">
                          <a href={`/hr?l=${r.id}`} className="text-brand underline underline-offset-2 text-xs">Open</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {openRequest && requestCover ? (
            <Section
              title={`${openRequest.starts_on} to ${openRequest.ends_on} — ${openRequest.days} working days`}
              note={`${openRequest.leave_code} · asked for by ${openRequest.requester_name} · ${openRequest.status}${
                openRequest.reason ? ` · ${openRequest.reason}` : ""
              }`}
            >
              <div className="bg-white border border-line rounded p-3 mb-4">
                <p className="text-sm font-semibold mb-1">Who could cover</p>
                <p className="text-xs text-muted mb-3">
                  Matched on the regulator's registration, not the job title — a title is what a facility calls
                  somebody and a registration is what the law lets them do.
                </p>
                {requestCover.regulators.length === 0 ? (
                  <p className="text-sm text-muted">
                    This person holds no registration, so no licensed cover is needed.
                  </p>
                ) : (
                  <>
                    <p className="text-xs mb-2">
                      Holds: <strong>{requestCover.regulators.join(", ")}</strong>
                    </p>
                    {requestCover.candidates.length === 0 ? (
                      <p className="text-sm text-block font-semibold">Nobody else at this facility holds it.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody>
                          {requestCover.candidates.map((c) => (
                            <tr key={c.employeeId} className={`border-t border-line first:border-0 ${c.alsoAway ? "opacity-60" : ""}`}>
                              <td className="py-1.5">{c.name}</td>
                              <td className="py-1.5 text-xs text-muted">{c.jobTitle}</td>
                              <td className="py-1.5 font-mono text-xs">{c.regulator} {c.licenceNumber}</td>
                              <td className="py-1.5 text-xs text-right">
                                {c.alsoAway ? <span className="text-block font-semibold">away too</span> : <span className="text-good">available</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {requestCover.uncovered.length > 0 ? (
                      <p className="text-sm text-block font-bold mt-3">
                        Nobody registered with {requestCover.uncovered.join(" or ")} is available over those dates.
                      </p>
                    ) : null}
                  </>
                )}
              </div>

              {openRequest.uncovered_ack ? (
                <p className="text-sm bg-block-soft border border-block rounded p-3 mb-4">
                  <strong className="block text-xs uppercase tracking-wide text-block mb-1">
                    Approved with nobody covering
                  </strong>
                  {openRequest.uncovered_ack}
                </p>
              ) : null}

              {acting && openRequest.status === "requested" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <form action={decideLeaveAction} className="bg-white border border-line rounded p-3">
                    <input type="hidden" name="requestId" value={openRequest.id} />
                    <input type="hidden" name="decision" value="approve" />
                    <p className="text-sm font-semibold mb-2">Approve</p>
                    <label className="block mb-2"><span className={LABEL}>Who is covering</span>
                      <select name="coverEmployeeId" className={FIELD} defaultValue="">
                        <option value="">Nobody named</option>
                        {requestCover.candidates.filter((c) => !c.alsoAway).map((c) => (
                          <option key={c.employeeId} value={c.employeeId}>{c.name}</option>
                        ))}
                      </select>
                    </label>
                    {requestCover.uncovered.length > 0 ? (
                      <label className="block mb-2"><span className={LABEL}>
                        Nobody registered is available — how will the work be covered?
                      </span>
                        <input name="uncoveredAck" className={FIELD} />
                      </label>
                    ) : null}
                    <label className="block"><span className={LABEL}>Note</span><input name="coverNote" className={FIELD} /></label>
                    <button type="submit" className="mt-2 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">Approve</button>
                  </form>
                  <form action={decideLeaveAction} className="bg-white border border-line rounded p-3 self-start">
                    <input type="hidden" name="requestId" value={openRequest.id} />
                    <input type="hidden" name="decision" value="decline" />
                    <p className="text-sm font-semibold mb-2">Decline</p>
                    <input name="note" placeholder="why — required" className={FIELD} />
                    <button type="submit" className="mt-2 border border-line font-semibold rounded px-4 py-2 text-sm">Decline</button>
                  </form>
                </div>
              ) : acting && openRequest.status === "approved" ? (
                <div className="flex gap-3">
                  <form action={takenAction}>
                    <input type="hidden" name="requestId" value={openRequest.id} />
                    <button type="submit" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
                      Mark taken
                    </button>
                  </form>
                  <form action={cancelLeaveAction} className="flex gap-2 items-end">
                    <input type="hidden" name="requestId" value={openRequest.id} />
                    <input name="reason" placeholder="cancel — why" className={FIELD} />
                    <button type="submit" className="border border-line font-semibold rounded px-3 py-2 text-sm">Cancel</button>
                  </form>
                </div>
              ) : null}
            </Section>
          ) : null}
        </>
      ) : null}

      {/* ===================================================== staff */}
      {view === "staff" ? (
        <>
          <Section title="Staff records">
            <div className="overflow-x-auto">
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Number</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Contract</th>
                    <th className="px-3 py-2 font-medium">Started</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((e) => {
                    const c = currentContract(e.id);
                    return (
                      <tr key={e.id} className={`border-t border-line ${!e.active ? "opacity-60" : ""} ${e.id === openEmployee?.id ? "bg-brand-soft" : ""}`}>
                        <td className="px-3 py-2 font-mono text-xs">{e.payroll_no}</td>
                        <td className="px-3 py-2">
                          {e.given_name} {e.family_name}
                          {!e.active ? <span className="text-[10px] uppercase text-muted ml-2">left</span> : null}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted">{e.job_title}</td>
                        <td className="px-3 py-2 text-xs">
                          {c ? (
                            <span className="capitalize">{c.kind.replace("_", " ")}{c.ends_on ? ` to ${c.ends_on}` : ""}</span>
                          ) : (
                            <span className="text-block font-semibold">none on file</span>
                          )}
                        </td>
                        <td className="px-3 py-2 tnum text-muted">{e.started_on}</td>
                        <td className="px-3 py-2 text-right">
                          <a href={`/hr?view=staff&e=${e.id}`} className="text-brand underline underline-offset-2 text-xs">Open</a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {openEmployee ? (
            <Section
              title={`${openEmployee.given_name} ${openEmployee.family_name} — ${openEmployee.payroll_no}`}
              note={`${openEmployee.job_title || "no role recorded"} · ${openEmployee.department || "no department"} · started ${openEmployee.started_on}`}
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="bg-white border border-line rounded p-3 mb-4">
                    <p className="text-sm font-semibold mb-2">Leave balance</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-muted text-left">
                          <th className="py-1 font-medium">Type</th>
                          <th className="py-1 font-medium text-right">Entitled</th>
                          <th className="py-1 font-medium text-right">Adjusted</th>
                          <th className="py-1 font-medium text-right">Booked</th>
                          <th className="py-1 font-medium text-right">Taken</th>
                          <th className="py-1 font-medium text-right">Left</th>
                        </tr>
                      </thead>
                      <tbody>
                        {balances.map((b) => (
                          <tr key={b.code} className="border-t border-line">
                            <td className="py-1.5">{b.name}{!b.paid ? <span className="text-[10px] text-muted ml-1">unpaid</span> : null}</td>
                            <td className="py-1.5 text-right tnum text-muted">{b.entitledDays}</td>
                            <td className="py-1.5 text-right tnum text-muted">{b.adjustmentDays || "—"}</td>
                            <td className="py-1.5 text-right tnum">{b.bookedDays || "—"}</td>
                            <td className="py-1.5 text-right tnum">{b.takenDays || "—"}</td>
                            <td className="py-1.5 text-right tnum font-semibold">{b.remainingDays}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-xs text-muted mt-2">
                      A balance is the sum of these rows, never a number somebody edited.
                    </p>
                  </div>

                  {history.length > 0 ? (
                    <div className="bg-white border border-line rounded p-3">
                      <p className="text-sm font-semibold mb-2">Leave taken</p>
                      <table className="w-full text-sm">
                        <tbody>
                          {history.map((h) => (
                            <tr key={h.id} className="border-t border-line first:border-0">
                              <td className="py-1 text-xs">{h.leave_code}</td>
                              <td className="py-1 tnum text-xs">{h.starts_on} — {h.ends_on}</td>
                              <td className="py-1 text-right tnum">{h.days} d</td>
                              <td className="py-1 text-xs capitalize text-muted pl-3">{h.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>

                <div>
                  <div className="bg-white border border-line rounded p-3 mb-4">
                    <p className="text-sm font-semibold mb-2">Contracts</p>
                    {contracts.length === 0 ? (
                      <p className="text-sm text-block font-semibold mb-3">Working with no contract on file.</p>
                    ) : (
                      <table className="w-full text-sm mb-3">
                        <tbody>
                          {contracts.map((c) => (
                            <tr key={c.id} className={`border-t border-line first:border-0 ${c.superseded_by ? "opacity-60" : ""}`}>
                              <td className="py-1 capitalize text-xs">{c.kind.replace("_", " ")}</td>
                              <td className="py-1 tnum text-xs">{c.starts_on} — {c.ends_on ?? "open"}</td>
                              <td className="py-1 text-xs text-muted">{c.superseded_by ? "superseded" : "current"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {acting && openEmployee.active ? (
                      <form action={contractAction} className="border-t border-line pt-3">
                        <input type="hidden" name="employeeId" value={openEmployee.id} />
                        <div className="grid gap-2 sm:grid-cols-3">
                          <label><span className={LABEL}>Kind</span>
                            <select name="kind" className={FIELD}>
                              {["permanent", "fixed_term", "locum", "internship", "probation"].map((k) => (
                                <option key={k} value={k}>{k.replace("_", " ")}</option>
                              ))}
                            </select>
                          </label>
                          <label><span className={LABEL}>From</span><input type="date" name="startsOn" defaultValue={today()} className={FIELD} /></label>
                          <label><span className={LABEL}>Until</span><input type="date" name="endsOn" className={FIELD} /></label>
                        </div>
                        <label className="block mt-2"><span className={LABEL}>Terms</span><input name="terms" className={FIELD} /></label>
                        <button type="submit" className="mt-2 border border-line font-semibold rounded px-4 py-2 text-sm">Issue</button>
                      </form>
                    ) : null}
                  </div>

                  {acting && openEmployee.active ? (
                    <>
                      <form action={requestLeaveAction} className="bg-white border border-line rounded p-3 mb-4">
                        <input type="hidden" name="employeeId" value={openEmployee.id} />
                        <p className="text-sm font-semibold mb-2">Request leave</p>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <label><span className={LABEL}>Type</span>
                            <select name="leaveCode" className={FIELD}>
                              {types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                            </select>
                          </label>
                          <label><span className={LABEL}>From</span><input type="date" name="startsOn" className={FIELD} /></label>
                          <label><span className={LABEL}>To</span><input type="date" name="endsOn" className={FIELD} /></label>
                        </div>
                        <label className="block mt-2"><span className={LABEL}>Reason</span><input name="reason" className={FIELD} /></label>
                        <button type="submit" className="mt-2 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">Request</button>
                      </form>

                      <form action={adjustLeaveAction} className="bg-white border border-line rounded p-3 mb-4">
                        <input type="hidden" name="employeeId" value={openEmployee.id} />
                        <p className="text-sm font-semibold mb-2">Adjust a balance</p>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <label><span className={LABEL}>Type</span>
                            <select name="leaveCode" className={FIELD}>
                              {types.filter((t) => t.annual_days !== null).map((t) => (
                                <option key={t.code} value={t.code}>{t.name}</option>
                              ))}
                            </select>
                          </label>
                          <label><span className={LABEL}>Year</span><input name="year" defaultValue={today().slice(0, 4)} className={FIELD} /></label>
                          <label><span className={LABEL}>Days (+/−)</span><input name="days" className={FIELD} /></label>
                        </div>
                        <label className="block mt-2"><span className={LABEL}>Why</span><input name="reason" className={FIELD} /></label>
                        <button type="submit" className="mt-2 border border-line font-semibold rounded px-4 py-2 text-sm">Adjust</button>
                      </form>

                      <form action={openCaseAction} className="bg-white border border-line rounded p-3">
                        <input type="hidden" name="employeeId" value={openEmployee.id} />
                        <p className="text-sm font-semibold mb-2">Open a case</p>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <label><span className={LABEL}>Kind</span>
                            <select name="kind" className={FIELD}>
                              <option value="disciplinary">Disciplinary</option>
                              <option value="grievance">Grievance</option>
                              <option value="performance">Performance</option>
                            </select>
                          </label>
                          <label className="sm:col-span-2"><span className={LABEL}>About</span><input name="summary" className={FIELD} /></label>
                        </div>
                        <button type="submit" className="mt-2 border border-line font-semibold rounded px-4 py-2 text-sm">Open</button>
                      </form>
                    </>
                  ) : null}

                  {employeeCases.length > 0 ? (
                    <div className="bg-white border border-line rounded p-3 mt-4">
                      <p className="text-sm font-semibold mb-2">Cases</p>
                      {employeeCases.map((c) => (
                        <div key={c.id} className="border-t border-line first:border-0 py-1.5 text-sm">
                          <span className="capitalize text-xs text-muted mr-2">{c.kind}</span>
                          {c.summary}
                          <span className={`text-xs ml-2 ${c.outcome ? "text-muted" : "text-clock font-semibold"}`}>
                            {c.outcome ? c.outcome.replace(/_/g, " ") : "open"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </Section>
          ) : null}
        </>
      ) : null}

      {/* ================================================= expiries */}
      {view === "expiries" ? (
        <Section
          title="Expiring and lapsed"
          note="Sorted by how long is left. A lapsed registration is at the top because the system is already refusing that person's licensed work."
        >
          {expiring.length === 0 ? (
            <Empty>Nothing lapses in the next {expiryHorizon} days.</Empty>
          ) : (
            <table className="w-full text-sm bg-white border border-line rounded">
              <thead>
                <tr className="text-xs text-muted text-left">
                  <th className="px-3 py-2 font-medium">Who</th>
                  <th className="px-3 py-2 font-medium">What</th>
                  <th className="px-3 py-2 font-medium">Reference</th>
                  <th className="px-3 py-2 font-medium">Expires</th>
                  <th className="px-3 py-2 font-medium text-right">Days</th>
                  <th className="px-3 py-2 font-medium">What it means</th>
                </tr>
              </thead>
              <tbody>
                {expiring.map((e, i) => (
                  <tr key={i} className={`border-t border-line ${e.lapsed ? "bg-block-soft" : "bg-clock-soft"}`}>
                    <td className="px-3 py-2">
                      <a href={`/hr?view=staff&e=${e.employeeId}`} className="underline underline-offset-2">{e.name}</a>
                      <span className="text-xs text-muted ml-2">{e.jobTitle}</span>
                    </td>
                    <td className="px-3 py-2 capitalize">{e.what}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.reference || "—"}</td>
                    <td className="px-3 py-2 tnum">{e.expiresOn}</td>
                    <td className={`px-3 py-2 text-right tnum font-bold ${e.lapsed ? "text-block" : "text-clock"}`}>
                      {e.daysLeft}
                    </td>
                    <td className={`px-3 py-2 text-xs font-semibold ${e.lapsed ? "text-block" : "text-clock"}`}>
                      {e.lapsed
                        ? e.what.includes("registration")
                          ? "Licensed work is being refused today"
                          : "Working without a contract"
                        : "Renew before it lapses"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      ) : null}

      {/* ==================================================== cases */}
      {view === "cases" ? (
        <>
          <Section
            title="Open cases"
            note="Due process has dates, and a facility that cannot show it followed them loses at the tribunal whatever actually happened."
          >
            {cases.length === 0 ? (
              <Empty>No case is open.</Empty>
            ) : (
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Who</th>
                    <th className="px-3 py-2 font-medium">Kind</th>
                    <th className="px-3 py-2 font-medium">About</th>
                    <th className="px-3 py-2 font-medium">Raised</th>
                    <th className="px-3 py-2 font-medium">Notified</th>
                    <th className="px-3 py-2 font-medium">Heard</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.id} className={`border-t border-line ${c.id === openCase_?.id ? "bg-brand-soft" : ""}`}>
                      <td className="px-3 py-2">{c.name}</td>
                      <td className="px-3 py-2 text-xs capitalize">{c.kind}</td>
                      <td className="px-3 py-2">{c.summary}</td>
                      <td className="px-3 py-2 tnum text-muted">{c.raised_on}</td>
                      <td className={`px-3 py-2 tnum text-xs ${c.notified_on ? "" : "text-clock font-semibold"}`}>
                        {c.notified_on ?? "not yet"}
                      </td>
                      <td className={`px-3 py-2 tnum text-xs ${c.heard_on ? "" : "text-clock font-semibold"}`}>
                        {c.heard_on ?? "not yet"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <a href={`/hr?view=cases&c=${c.id}`} className="text-brand underline underline-offset-2 text-xs">Open</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {openCase_ && acting ? (
            <Section title={openCase_.summary} note={`${openCase_.kind} · raised ${openCase_.raised_on} by ${openCase_.opener_name}`}>
              <div className="grid gap-4 sm:grid-cols-2">
                <form action={hearingAction} className="bg-white border border-line rounded p-3">
                  <input type="hidden" name="caseId" value={openCase_.id} />
                  <p className="text-sm font-semibold mb-1">Notice and hearing</p>
                  <p className="text-xs text-muted mb-3">
                    The employee must be notified before being heard, and may be accompanied. A hearing held before
                    the notice is not a hearing, however well minuted.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label><span className={LABEL}>Notified on</span>
                      <input type="date" name="notifiedOn" defaultValue={openCase_.notified_on ?? ""} className={FIELD} />
                    </label>
                    <label><span className={LABEL}>Heard on</span>
                      <input type="date" name="heardOn" defaultValue={openCase_.heard_on ?? ""} className={FIELD} />
                    </label>
                  </div>
                  <label className="block mt-2"><span className={LABEL}>Accompanied by</span>
                    <input name="accompaniedBy" defaultValue={openCase_.accompanied_by} className={FIELD} />
                  </label>
                  <button type="submit" className="mt-2 border border-line font-semibold rounded px-4 py-2 text-sm">Record</button>
                </form>

                <form action={closeCaseAction} className="bg-white border border-line rounded p-3 self-start">
                  <input type="hidden" name="caseId" value={openCase_.id} />
                  <p className="text-sm font-semibold mb-1">Outcome</p>
                  <p className="text-xs text-muted mb-3">
                    A dismissal without a recorded hearing is refused — it is unfair whatever the employee did.
                  </p>
                  <label className="block"><span className={LABEL}>Outcome</span>
                    <select name="outcome" className={FIELD}>
                      {[
                        ["no_action", "No action"], ["counselled", "Counselled"],
                        ["written_warning", "Written warning"], ["final_warning", "Final warning"],
                        ["dismissed", "Dismissed"], ["upheld", "Grievance upheld"],
                        ["not_upheld", "Grievance not upheld"], ["withdrawn", "Withdrawn"],
                      ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  <label className="block mt-2"><span className={LABEL}>Reasons</span><input name="note" className={FIELD} /></label>
                  <button type="submit" className="mt-2 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">Close</button>
                </form>
              </div>
            </Section>
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}
