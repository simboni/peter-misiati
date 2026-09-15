import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  listProgrammes, getProgramme, register, defaulters, cohortReport, visitsFor,
  getEnrolment, LOST_AFTER_DAYS, LOST_AFTER_DAYS_DEFAULT,
} from "@/lib/programmes.ts";
import { searchPatients } from "@/lib/patients.ts";
import { today } from "@/lib/db.ts";
import { Shell, Stat, Section, Empty, Banner, Views } from "@/app/_components/shell.tsx";
import { enrolAction, visitAction, outcomeAction, sweepAction } from "./actions.ts";

/**
 * Programme registers — HIV, TB and the NCD clinic.
 *
 * Three views because a programme is run three ways: the register (who is on
 * it), the defaulter list (who has not come back — the number the programme is
 * judged on), and the cohort report (of everyone who started in April, where
 * are they now).
 */
export default async function ProgrammesPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; view?: string; e?: string; q?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "patient.read")) redirect("/");

  const params = await searchParams;
  const programmes = listProgrammes();
  const programme = getProgramme(params.p ?? "HIV") ?? programmes[0];
  if (!programme) {
    return (
      <Shell user={user} current="/programmes" title="Programmes">
        <Empty>No programme register is configured.</Empty>
      </Shell>
    );
  }

  const view = params.view ?? "register";
  const rows = register(programme.code);
  const overdue = defaulters(programme.code);
  const cohorts = cohortReport(programme.code);
  const candidates = params.q?.trim()
    ? searchPatients({ facilityId: user.facilityId, query: params.q, limit: 6 })
    : [];
  const open = params.e ? getEnrolment(params.e) : undefined;
  const openVisits = open ? visitsFor(open.id) : [];
  const threshold = LOST_AFTER_DAYS[programme.code] ?? LOST_AFTER_DAYS_DEFAULT;

  const active = rows.filter((r) => r.status === "active").length;
  const lost = rows.filter((r) => r.status === "lost").length;
  const latest = cohorts[0];

  const statusTone: Record<string, string> = {
    active: "text-good",
    transferred_out: "text-muted",
    completed: "text-good",
    lost: "text-block",
    stopped: "text-clock",
    died: "text-muted",
  };

  return (
    <Shell
      user={user}
      current={view === "register" ? "/programmes" : `/programmes?view=${view}`}
      error={params.error}
      title={
        view === "defaulters" ? "Who has not come back" : view === "cohorts" ? "Cohort report" : programme.name
      }
      subtitle={programme.notes}
      actions={programmes.map((p) => (
        <a
          key={p.code}
          href={`/programmes?p=${p.code}${view !== "register" ? `&view=${view}` : ""}`}
          className={`font-semibold rounded px-3 py-2 text-sm ${
            p.code === programme.code ? "bg-brand text-white" : "border border-line"
          }`}
        >
          {p.code}
        </a>
      ))}
    >
      <Views
        current={view}
        views={[
          { key: "register", label: "Register", href: `/programmes?p=${programme.code}` },
          { key: "defaulters", label: "Not come back", href: `/programmes?p=${programme.code}&view=defaulters` },
          { key: "cohorts", label: "Cohort report", href: `/programmes?p=${programme.code}&view=cohorts` },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="On the register" value={active} note={`${rows.length} ever enrolled`} />
        <Stat
          label="Missed an appointment"
          value={overdue.length}
          tone={overdue.some((d) => d.lost) ? "block" : overdue.length > 0 ? "clock" : "good"}
          note={`${overdue.filter((d) => d.lost).length} past ${threshold} days`}
        />
        <Stat label="Lost to follow-up" value={lost} tone={lost > 0 ? "block" : "good"} note="recorded as lost" />
        <Stat
          label={latest ? `Retention, ${latest.cohort}` : "Retention"}
          value={latest ? `${latest.retentionPercent}%` : "—"}
          tone={!latest ? "muted" : latest.retentionPercent >= 85 ? "good" : latest.retentionPercent >= 70 ? "clock" : "block"}
          note={latest ? `${latest.started} started that month` : "no cohort yet"}
        />
      </div>

      {/* ------------------------------------------------ who has not come back */}
      {view === "defaulters" ? (
        <Section
          title="Missed an appointment"
          note={`Past ${threshold} days on ${programme.code} counts as lost rather than late. Longest gone first.`}
        >
          <form action={sweepAction} className="mb-3">
            <button type="submit" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
              Raise these onto the right desks
            </button>
          </form>

          {overdue.length === 0 ? (
            <Empty>Everybody on this register has been seen when they were due.</Empty>
          ) : (
            <table className="w-full text-sm bg-white border border-line rounded">
              <thead>
                <tr className="text-xs text-muted text-left">
                  <th className="px-3 py-2 font-medium">Number</th>
                  <th className="px-3 py-2 font-medium">Patient</th>
                  <th className="px-3 py-2 font-medium">Last seen</th>
                  <th className="px-3 py-2 font-medium">Was due</th>
                  <th className="px-3 py-2 font-medium text-right">Days</th>
                  <th className="px-3 py-2 font-medium">What it means</th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((d) => (
                  <tr key={d.enrolment.id} className={`border-t border-line ${d.lost ? "bg-block-soft" : ""}`}>
                    <td className="px-3 py-2 font-mono text-xs tnum">{d.enrolment.programme_number}</td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/patients/${encodeURIComponent(d.enrolment.patient_mrn)}`}
                        className="underline underline-offset-2"
                      >
                        {d.patientName}
                      </Link>
                    </td>
                    <td className="px-3 py-2 tnum text-muted">{d.lastSeen}</td>
                    <td className="px-3 py-2 tnum text-muted">{d.nextDue}</td>
                    <td className={`px-3 py-2 text-right tnum font-bold ${d.lost ? "text-block" : "text-clock"}`}>
                      {d.daysOverdue}
                    </td>
                    <td className={`px-3 py-2 text-xs ${d.lost ? "text-block font-semibold" : "text-clock"}`}>
                      {d.lost ? "Trace and report as lost" : "Telephone them today"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      ) : null}

      {/* -------------------------------------------------------- cohort report */}
      {view === "cohorts" ? (
        <Section
          title="Cohort report"
          note="Of everyone who started in a month, where are they now. A monthly activity count cannot answer this, however many of them you have."
        >
          {cohorts.length === 0 ? (
            <Empty>Nobody has been enrolled yet.</Empty>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm bg-white border border-line rounded">
                  <thead>
                    <tr className="text-xs text-muted text-left">
                      <th className="px-3 py-2 font-medium">Started</th>
                      <th className="px-3 py-2 font-medium text-right">Enrolled</th>
                      <th className="px-3 py-2 font-medium text-right">Still in care</th>
                      <th className="px-3 py-2 font-medium text-right">Transferred</th>
                      <th className="px-3 py-2 font-medium text-right">Completed</th>
                      <th className="px-3 py-2 font-medium text-right">Lost</th>
                      <th className="px-3 py-2 font-medium text-right">Stopped</th>
                      <th className="px-3 py-2 font-medium text-right">Died</th>
                      <th className="px-3 py-2 font-medium text-right">Retention</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cohorts.map((c) => (
                      <tr key={c.cohort} className="border-t border-line">
                        <td className="px-3 py-2 tnum font-medium">{c.cohort}</td>
                        <td className="px-3 py-2 text-right tnum">{c.started}</td>
                        <td className="px-3 py-2 text-right tnum text-good">{c.active}</td>
                        <td className="px-3 py-2 text-right tnum text-muted">{c.transferredOut || "—"}</td>
                        <td className="px-3 py-2 text-right tnum text-good">{c.completed || "—"}</td>
                        <td className="px-3 py-2 text-right tnum text-block">{c.lost || "—"}</td>
                        <td className="px-3 py-2 text-right tnum text-clock">{c.stopped || "—"}</td>
                        <td className="px-3 py-2 text-right tnum text-muted">{c.died || "—"}</td>
                        <td
                          className={`px-3 py-2 text-right tnum font-bold ${
                            c.retentionPercent >= 85 ? "text-good" : c.retentionPercent >= 70 ? "text-clock" : "text-block"
                          }`}
                        >
                          {c.retentionPercent}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted mt-3 leading-relaxed">
                Transferred out counts as retained — they are in care, elsewhere. That is how programme
                reporting treats it, and getting it wrong understates every facility that refers.
              </p>
            </>
          )}
        </Section>
      ) : null}

      {/* ------------------------------------------------- one patient, in detail */}
      {view === "register" && open ? (
        <Section
          title={`${open.programme_number} — enrolled ${open.enrolled_on}`}
          note={`Cohort ${open.cohort} · ${open.status.replace("_", " ")}`}
        >
          {openVisits.length > 0 ? (
            <table className="w-full text-sm bg-white border border-line rounded">
              <thead>
                <tr className="text-xs text-muted text-left">
                  <th className="px-3 py-2 font-medium">Seen</th>
                  <th className="px-3 py-2 font-medium">Findings</th>
                  <th className="px-3 py-2 font-medium">Note</th>
                  <th className="px-3 py-2 font-medium text-right">Next due</th>
                  <th className="px-3 py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {openVisits.map((v) => {
                  const findings = JSON.parse(v.findings) as Record<string, string>;
                  return (
                    <tr key={v.id} className="border-t border-line align-top">
                      <td className="px-3 py-2 tnum">{v.visit_date}</td>
                      <td className="px-3 py-2 text-xs">
                        {Object.entries(findings).length === 0
                          ? "—"
                          : Object.entries(findings).map(([k, val]) => (
                              <div key={k}>
                                <span className="text-muted">{k}: </span>
                                <span className="font-medium">{val}</span>
                              </div>
                            ))}
                      </td>
                      <td className="px-3 py-2 text-xs">{v.note || "—"}</td>
                      <td className="px-3 py-2 text-right tnum text-muted">{v.next_due ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted">{v.seen_by_name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <Empty>No visit recorded on this enrolment yet.</Empty>
          )}

          {open.status === "active" ? (
            <>
              <form action={visitAction} className="mt-3 bg-white border border-line rounded px-4 py-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="enrolmentId" value={open.id} />
                <input type="hidden" name="programmeCode" value={programme.code} />
                <label className="text-xs text-muted">
                  Seen on
                  <input name="visitDate" type="date" defaultValue={today()} className="block border border-line rounded px-2 py-1.5 text-sm tnum bg-white" />
                </label>
                {programme.code === "HIV" ? (
                  <>
                    <label className="text-xs text-muted">
                      Viral load
                      <input name="viralLoad" placeholder="Undetectable" className="block w-32 border border-line rounded px-2 py-1.5 text-sm bg-white" />
                    </label>
                    <label className="text-xs text-muted">
                      Adherence
                      <input name="adherence" placeholder="Good" className="block w-24 border border-line rounded px-2 py-1.5 text-sm bg-white" />
                    </label>
                  </>
                ) : programme.code === "TB" ? (
                  <label className="text-xs text-muted">
                    Sputum
                    <input name="sputum" placeholder="Negative" className="block w-28 border border-line rounded px-2 py-1.5 text-sm bg-white" />
                  </label>
                ) : (
                  <>
                    <label className="text-xs text-muted">
                      Blood pressure
                      <input name="bloodPressure" placeholder="128/82" className="block w-24 border border-line rounded px-2 py-1.5 text-sm tnum bg-white" />
                    </label>
                    <label className="text-xs text-muted">
                      HbA1c
                      <input name="hba1c" placeholder="6.8" className="block w-20 border border-line rounded px-2 py-1.5 text-sm tnum bg-white" />
                    </label>
                  </>
                )}
                <label className="text-xs text-muted">
                  Weight (kg)
                  <input name="weightKg" className="block w-20 border border-line rounded px-2 py-1.5 text-sm tnum bg-white" />
                </label>
                <label className="text-xs text-muted flex-1 min-w-[10rem]">
                  Note
                  <input name="note" className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white" />
                </label>
                <label className="text-xs text-muted">
                  Next due
                  <input name="nextDue" type="date" className="block border border-line rounded px-2 py-1.5 text-sm tnum bg-white" />
                </label>
                <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                  Record visit
                </button>
              </form>
              <p className="text-xs text-muted mt-2">
                The next-due date is what the defaulter list is built from. A visit recorded without one
                leaves this patient invisible to it.
              </p>

              <form action={outcomeAction} className="mt-3 bg-white border border-line rounded px-4 py-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="enrolmentId" value={open.id} />
                <input type="hidden" name="programmeCode" value={programme.code} />
                <label className="text-xs text-muted">
                  They left the programme
                  <select name="status" className="block border border-line rounded px-2 py-1.5 text-sm bg-white">
                    <option value="transferred_out">Transferred out</option>
                    <option value="completed">Completed treatment</option>
                    <option value="lost">Lost to follow-up</option>
                    <option value="stopped">Stopped</option>
                    <option value="died">Died</option>
                  </select>
                </label>
                <label className="text-xs text-muted flex-1 min-w-[14rem]">
                  Why
                  <input name="note" required className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white" />
                </label>
                <button type="submit" className="border border-line font-semibold rounded px-4 py-2 text-sm">
                  Record outcome
                </button>
              </form>
            </>
          ) : (
            <div className="mt-3">
              <Banner tone="info">
                Left the programme as {open.status.replace("_", " ")}
                {open.outcome_on ? ` on ${open.outcome_on}` : ""}. {open.outcome_note}
              </Banner>
            </div>
          )}
        </Section>
      ) : null}

      {/* -------------------------------------------------------- the register */}
      {view === "register" ? (
        <>
          <Section title={`${programme.name} register`}>
            {rows.length === 0 ? (
              <Empty>Nobody is enrolled yet.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm bg-white border border-line rounded">
                  <thead>
                    <tr className="text-xs text-muted text-left">
                      <th className="px-3 py-2 font-medium">Number</th>
                      <th className="px-3 py-2 font-medium">Patient</th>
                      <th className="px-3 py-2 font-medium">Enrolled</th>
                      <th className="px-3 py-2 font-medium">Cohort</th>
                      <th className="px-3 py-2 font-medium">Last seen</th>
                      <th className="px-3 py-2 font-medium">Next due</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-line">
                        <td className="px-3 py-2 font-mono text-xs tnum">
                          <a href={`/programmes?p=${programme.code}&e=${r.id}`} className="text-brand underline underline-offset-2">
                            {r.programme_number}
                          </a>
                        </td>
                        <td className="px-3 py-2">{r.patient_name}</td>
                        <td className="px-3 py-2 tnum text-muted">{r.enrolled_on}</td>
                        <td className="px-3 py-2 tnum text-muted">{r.cohort}</td>
                        <td className="px-3 py-2 tnum text-muted">{r.last_seen ?? "—"}</td>
                        <td
                          className={`px-3 py-2 tnum ${
                            r.next_due && r.next_due < today() ? "text-block font-semibold" : "text-muted"
                          }`}
                        >
                          {r.next_due ?? "—"}
                        </td>
                        <td className={`px-3 py-2 ${statusTone[r.status]}`}>{r.status.replace("_", " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Enrol somebody" note="The programme number is theirs for good — it is what every return and transfer letter uses.">
            <form className="bg-white border border-line rounded px-4 py-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="p" value={programme.code} />
              <label className="text-xs text-muted flex-1 min-w-[14rem]">
                Find the patient
                <input
                  name="q"
                  defaultValue={params.q ?? ""}
                  placeholder="Name, file number or national ID"
                  className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white"
                />
              </label>
              <button type="submit" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
                Search
              </button>
            </form>

            {candidates.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2">
                {candidates.map((p) => (
                  <li key={p.mrn} className="bg-white border border-line rounded px-4 py-3">
                    <form action={enrolAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="mrn" value={p.mrn} />
                      <input type="hidden" name="programmeCode" value={programme.code} />
                      <div className="min-w-[10rem]">
                        <div className="font-medium text-sm">
                          {p.given_name} {p.family_name}
                        </div>
                        <div className="font-mono text-xs text-muted tnum">{p.mrn}</div>
                      </div>
                      <label className="text-xs text-muted">
                        {programme.code} number
                        <input
                          name="programmeNumber"
                          required
                          placeholder={programme.code === "HIV" ? "CCC-01234" : `${programme.code}-0001`}
                          className="block w-36 border border-line rounded px-2 py-1.5 text-sm font-mono bg-white"
                        />
                      </label>
                      <label className="text-xs text-muted">
                        Enrolled on
                        <input name="enrolledOn" type="date" defaultValue={today()} className="block border border-line rounded px-2 py-1.5 text-sm tnum bg-white" />
                      </label>
                      <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                        Enrol
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : params.q ? (
              <p className="mt-3 text-sm text-muted">Nobody matches that.</p>
            ) : null}
          </Section>
        </>
      ) : null}
    </Shell>
  );
}
