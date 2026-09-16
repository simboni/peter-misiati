import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  teleSummary, runningSessions, recentSessions, redFlags,
  IDENTITY_METHODS, IDENTITY_LABEL, RED_FLAGS,
} from "@/lib/telemedicine.ts";
import { searchPatients, resolvePatient } from "@/lib/patients.ts";
import { Shell, Stat, Section, Empty, Views } from "@/app/_components/shell.tsx";
import { startAction, endAction } from "./actions.ts";

/**
 * Remote consultations.
 *
 * The screen leads with the sessions still running, because a consultation
 * nobody ended is a consultation nobody closed, and the clinician who left it
 * open is the one person who can say what happened on it.
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";
const LABEL = "block text-xs text-muted mb-1";

const OUTCOME_LABEL: Record<string, string> = {
  completed: "Completed",
  patient_absent: "Patient did not answer",
  failed_connection: "The line failed",
  converted_to_visit: "Converted to a visit",
  cancelled: "Cancelled",
};

export default async function TelemedicinePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; mrn?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "patient.read")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "running";
  const conducting = can(user.userId, "encounter.conduct");

  const summary = teleSummary(user.facilityId);
  const running = runningSessions(user.facilityId);
  const recent = recentSessions(user.facilityId, 25);
  const results = params.q ? searchPatients({ facilityId: user.facilityId, query: params.q, limit: 8 }) : [];
  const patient = params.mrn ? resolvePatient(params.mrn) : undefined;

  return (
    <Shell
      user={user}
      current="/telemedicine"
      error={params.error}
      title={
        view === "log" ? "Remote consultations"
        : view === "rules" ? "What cannot be done down a telephone"
        : "Sessions running"
      }
      subtitle={
        view === "running"
          ? "A remote consultation is a consultation: same encounter, same notes, same coded diagnosis, same claim."
          : undefined
      }
    >
      <Views
        current={view}
        views={[
          { key: "running", label: "Running", href: "/telemedicine" },
          { key: "start", label: "Start one", href: "/telemedicine?view=start" },
          { key: "log", label: "Log", href: "/telemedicine?view=log" },
          { key: "rules", label: "Red flags", href: "/telemedicine?view=rules" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat
          label="Running"
          value={summary.running}
          tone={summary.running > 0 ? "clock" : "good"}
          note={`${summary.sessions} in 90 days`}
        />
        <Stat
          label="Completed"
          value={summary.completionRatePercent === null ? "—" : `${summary.completionRatePercent}%`}
          note={`${summary.failedConnection} lines failed · ${summary.patientAbsent} no answer`}
        />
        <Stat
          label="Sent to be seen"
          value={summary.convertedToVisit}
          note={`${summary.redFlagged} started on something that should be seen`}
          tone={summary.redFlagged > 0 ? "clock" : "ink"}
        />
        <Stat
          label="Identity not established"
          value={summary.identityNotEstablished}
          tone={summary.identityNotEstablished > 0 ? "block" : "good"}
          note={`${summary.poorLines} poor or failed lines`}
        />
      </div>

      <p className="mt-4 text-xs bg-clock-soft border border-clock/25 text-clock rounded px-3 py-2">
        No video is carried, no call is placed and nothing is recorded. The platform is a third party, and the
        joining reference is not part of the medical record. A facility doing this at scale needs a platform
        decision, a data processing agreement and KMPDC's current telemedicine guidance.
      </p>

      {/* ================================================== running */}
      {view === "running" ? (
        <Section title="Sessions nobody has ended">
          {running.length === 0 ? (
            <Empty>Nothing is running.</Empty>
          ) : (
            <div className="space-y-3">
              {running.map((session) => (
                <div key={session.id} className="bg-white border border-line rounded p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link href={`/encounters/${session.encounter_id}`} className="font-medium text-brand hover:underline">
                      {session.patient_mrn}
                    </Link>
                    <span className="text-sm">{session.channel}</span>
                    <span className="text-xs text-muted">
                      {IDENTITY_LABEL[session.identity_method]} · started{" "}
                      {session.started_at?.slice(11, 16)} · {session.clinician_name}
                    </span>
                    {session.identity_method === "not_established" ? (
                      <span className="text-xs text-block">identity not established</span>
                    ) : null}
                  </div>
                  {session.red_flag ? (
                    <p className="text-sm text-block mt-1">Should be seen in person: {session.red_flag}</p>
                  ) : null}

                  <form action={endAction} className="mt-3 grid gap-2 sm:grid-cols-5 items-end">
                    <input type="hidden" name="sessionId" value={session.id} />
                    <div>
                      <label className={LABEL}>How it ended</label>
                      <select name="outcome" className={FIELD}>
                        {Object.entries(OUTCOME_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL}>The line</label>
                      <select name="quality" className={FIELD}>
                        <option value="good">Good</option>
                        <option value="poor">Poor</option>
                        <option value="failed">Failed</option>
                      </select>
                    </div>
                    <div className={session.red_flag ? "" : "sm:col-span-2"}>
                      <label className={LABEL}>Note</label>
                      <input name="note" className={FIELD} placeholder="Required unless it completed" />
                    </div>
                    {session.red_flag ? (
                      <div>
                        <label className={LABEL}>What was done about the red flag</label>
                        <input name="redFlagAction" className={FIELD} placeholder="Told to come in now" />
                      </div>
                    ) : null}
                    <button className="bg-brand text-white text-sm rounded px-3 py-1.5">End</button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </Section>
      ) : null}

      {/* ==================================================== start */}
      {view === "start" ? (
        <>
          <Section title="Who is on the call">
            <form className="bg-white border border-line rounded p-3 flex flex-wrap gap-2 items-end">
              <input type="hidden" name="view" value="start" />
              <div className="flex-1 min-w-60">
                <label className={LABEL}>Name, file number, ID or phone</label>
                <input name="q" defaultValue={params.q ?? ""} className={FIELD} />
              </div>
              <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Search</button>
            </form>

            {params.q && !patient ? (
              results.length === 0 ? (
                <p className="mt-3"><Empty>Nobody matches that.</Empty></p>
              ) : (
                <div className="mt-3 bg-white border border-line rounded divide-y divide-line">
                  {results.map((row) => (
                    <Link
                      key={row.mrn}
                      href={`/telemedicine?view=start&mrn=${row.mrn}`}
                      className="block px-3 py-2 text-sm hover:bg-brand-soft"
                    >
                      <span className="font-medium">{row.given_name} {row.family_name}</span>
                      <span className="text-muted"> · {row.mrn}</span>
                    </Link>
                  ))}
                </div>
              )
            ) : null}
          </Section>

          {patient && conducting ? (
            <Section
              title={`Start a remote consultation with ${patient.given_name} ${patient.family_name}`}
              note="The encounter is opened the ordinary way. If the reason names something that should be seen in person, the session will say so and will not let you close it quietly."
            >
              <form action={startAction} className="bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-3">
                <input type="hidden" name="patientMrn" value={patient.mrn} />
                <div>
                  <label className={LABEL}>Channel</label>
                  <select name="channel" className={FIELD}>
                    <option value="video">Video</option>
                    <option value="voice">Voice</option>
                    <option value="chat">Chat</option>
                  </select>
                </div>
                <div>
                  <label className={LABEL}>How you know it is them</label>
                  <select name="identityMethod" className={FIELD}>
                    {IDENTITY_METHODS.map((method) => (
                      <option key={method} value={method}>{IDENTITY_LABEL[method]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>If not established, what was tried</label>
                  <input name="identityNote" className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>Who agreed to be seen this way</label>
                  <input name="consentBy" required className={FIELD} defaultValue="patient" />
                </div>
                <div>
                  <label className={LABEL}>Platform</label>
                  <input name="platform" className={FIELD} placeholder="whichever service carries the call" />
                </div>
                <div>
                  <label className={LABEL}>Reason for the call</label>
                  <input name="reason" className={FIELD} placeholder="Review of blood pressure" />
                </div>
                <div className="sm:col-span-3">
                  <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Start the session</button>
                </div>
              </form>
            </Section>
          ) : null}
        </>
      ) : null}

      {/* ====================================================== log */}
      {view === "log" ? (
        <Section title="Remote consultations">
          {recent.length === 0 ? (
            <Empty>None yet.</Empty>
          ) : (
            <div className="bg-white border border-line rounded overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-2 py-2">Patient</th>
                    <th className="px-2 py-2">How</th>
                    <th className="px-2 py-2">Identity</th>
                    <th className="px-2 py-2">Outcome</th>
                    <th className="px-2 py-2">Red flag</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((session) => (
                    <tr key={session.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 text-muted whitespace-nowrap">
                        {session.created_at.slice(0, 16).replace("T", " ")}
                      </td>
                      <td className="px-2 py-2">
                        <Link href={`/patients/${session.patient_mrn}`} className="text-brand hover:underline">
                          {session.patient_name}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-muted">
                        {session.channel}
                        {session.quality && session.quality !== "good" ? (
                          <span className="text-clock"> · {session.quality} line</span>
                        ) : null}
                      </td>
                      <td className={`px-2 py-2 text-muted ${session.identity_method === "not_established" ? "text-block" : ""}`}>
                        {IDENTITY_LABEL[session.identity_method]}
                      </td>
                      <td className="px-2 py-2">
                        {session.outcome ? (
                          <span className={session.outcome === "completed" ? "text-good" : "text-clock"}>
                            {OUTCOME_LABEL[session.outcome]}
                          </span>
                        ) : (
                          <span className="text-clock">still running</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {session.red_flag ? (
                          <span className="text-block">
                            {session.red_flag}
                            {session.red_flag_action ? (
                              <span className="text-muted"> — {session.red_flag_action}</span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      ) : null}

      {/* ==================================================== rules */}
      {view === "rules" ? (
        <>
          <Section
            title="Things that are not seen down a telephone"
            note="Matched on words in the reason for the call, which is crude and will both miss things and over-fire. It is a prompt for a clinician, never a diagnosis."
          >
            <div className="bg-white border border-line rounded divide-y divide-line">
              {RED_FLAGS.map((flag) => (
                <p key={flag.why} className="px-3 py-2 text-sm">{flag.why}</p>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              This list is this system's own and needs a clinician's sign-off — what belongs on it is a
              judgement about what cannot be assessed remotely. Section 22 of the clinical review register
              asks for it.
            </p>
          </Section>

          <Section title="And one rule that does not bend">
            <p className="bg-white border border-line rounded px-3 py-2 text-sm">
              <strong>A controlled drug is not prescribed on a remote consultation.</strong> Not a judgement
              call and not overridable from this screen: the patient has not been examined and cannot be seen.
              The pharmacy module refuses it at the point of prescribing, not here.
            </p>
          </Section>
        </>
      ) : null}
    </Shell>
  );
}
