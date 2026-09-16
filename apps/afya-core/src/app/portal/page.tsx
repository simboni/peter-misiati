import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  portalSummary, accountFor, proxiesFor, viewFor, viewHistory, asMessage,
  CODE_MINUTES, MAX_ATTEMPTS, MAJORITY_YEARS, WITHHELD_ANALYTES,
} from "@/lib/portal.ts";
import { resolvePatient, searchPatients } from "@/lib/patients.ts";
import { formatKes } from "@/lib/billing.ts";
import { Shell, Stat, Section, Empty, Views } from "@/app/_components/shell.tsx";
import {
  enrolAction, revokeAction, codeAction, summaryAction, proxyAction, revokeProxyAction,
} from "./actions.ts";

/**
 * The patient portal, from the clinic's side.
 *
 * There is no patient-facing screen here on purpose: the patient's side is a
 * text message and a USSD menu, because that is the phone they have. What this
 * screen shows is exactly what would be sent, so a clerk can read it out at the
 * counter and a patient can see there is nothing hidden behind it.
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";
const LABEL = "block text-xs text-muted mb-1";

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; mrn?: string; q?: string; sent?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "patient.read")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "desk";

  const summary = portalSummary(user.facilityId);
  const results = params.q ? searchPatients({ facilityId: user.facilityId, query: params.q, limit: 8 }) : [];

  const patient = params.mrn ? resolvePatient(params.mrn) : undefined;
  const account = patient ? accountFor(patient.mrn) : undefined;
  const proxies = patient ? proxiesFor(patient.mrn) : [];
  // Reading the preview from the clinic's side is not the patient reading their
  // own record, so it is not recorded as one.
  const preview = patient ? viewFor({ patientMrn: patient.mrn, record: false }) : undefined;
  const history = patient ? viewHistory(patient.mrn, 10) : [];

  return (
    <Shell
      user={user}
      current="/portal"
      error={params.error}
      title={patient ? "Portal access" : "Patient portal"}
      subtitle={
        !patient
          ? "A code to the phone already on the record. No app, no data bundle, no password to forget."
          : undefined
      }
    >
      <Views
        current={view}
        views={[
          { key: "desk", label: "Desk", href: "/portal" },
          { key: "rules", label: "What is sent", href: "/portal?view=rules" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Enrolled" value={summary.enrolled} note={`${summary.revoked} revoked`} />
        <Stat label="Used this month" value={summary.usedThisMonth} note={`${summary.viewsThisMonth} record views`} />
        <Stat
          label="Withheld this month"
          value={summary.withheldThisMonth}
          note="findings a person will go through instead"
        />
        <Stat
          label="SMS gateway"
          value={summary.gatewayLive ? "live" : "demo"}
          tone={summary.gatewayLive ? "good" : "clock"}
          note={summary.gatewayLive ? "messages are being sent" : "nothing actually leaves the building"}
        />
      </div>

      {!summary.gatewayLive ? (
        <p className="mt-4 text-xs bg-clock-soft border border-clock/25 text-clock rounded px-3 py-2">
          The SMS gateway is in demo mode, so no message is sent and the one-time code is shown on this screen
          instead of going to a phone. A live gateway never hands the code back. Going live needs a licensed
          Kenyan aggregator and a sender ID.
        </p>
      ) : null}

      {params.sent ? (
        <p className="mt-4 text-xs bg-brand-soft border border-brand/20 text-brand-dark rounded px-3 py-2">
          Sent. While the gateway is simulated the message is recorded in the integration log rather than
          delivered — see Administration → Integrations.
        </p>
      ) : null}

      {/* ===================================================== desk */}
      {view === "desk" && !patient ? (
        <Section title="Find a patient">
          <form className="bg-white border border-line rounded p-3 flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-60">
              <label className={LABEL}>Name, file number, ID or phone</label>
              <input name="q" defaultValue={params.q ?? ""} className={FIELD} placeholder="Njeri" />
            </div>
            <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Search</button>
          </form>

          {params.q ? (
            results.length === 0 ? (
              <p className="mt-3"><Empty>Nobody matches that.</Empty></p>
            ) : (
              <div className="mt-3 bg-white border border-line rounded divide-y divide-line">
                {results.map((row) => (
                  <Link
                    key={row.mrn}
                    href={`/portal?mrn=${row.mrn}`}
                    className="block px-3 py-2 text-sm hover:bg-brand-soft"
                  >
                    <span className="font-medium">{row.given_name} {row.family_name}</span>
                    <span className="text-muted"> · {row.mrn}</span>
                    {row.phone ? <span className="text-xs text-muted"> · {row.phone}</span> : (
                      <span className="text-xs text-clock"> · no phone on file</span>
                    )}
                  </Link>
                ))}
              </div>
            )
          ) : null}
        </Section>
      ) : null}

      {/* ================================================ one patient */}
      {patient ? (
        <>
          <Section title={`${patient.given_name} ${patient.family_name}`}>
            <div className="bg-white border border-line rounded p-3 text-sm">
              <p className="text-muted">
                {patient.mrn}
                {patient.phone ? ` · ${patient.phone}` : " · no phone on file"}
                {patient.date_of_birth ? ` · born ${patient.date_of_birth}` : ""}
              </p>
              <p className="mt-2">
                {account ? (
                  account.status === "active" ? (
                    <span className="text-good">enrolled — codes go to {account.phone}</span>
                  ) : (
                    <span className="text-block">{account.status}{account.revoked_reason ? ` — ${account.revoked_reason}` : ""}</span>
                  )
                ) : (
                  <span className="text-muted">not enrolled</span>
                )}
                {account ? (
                  <span className="text-muted">
                    {" "}· {account.channel.toUpperCase()} · {account.language === "sw" ? "Kiswahili" : "English"}
                    {account.last_seen_at ? ` · last used ${account.last_seen_at.slice(0, 10)}` : " · never used"}
                  </span>
                ) : null}
              </p>
              <p className="mt-2">
                <Link href={`/patients/${patient.mrn}`} className="text-brand text-sm hover:underline">
                  the patient record →
                </Link>{" "}
                <Link href="/portal" className="text-brand text-sm hover:underline">← the desk</Link>
              </p>
            </div>
          </Section>

          {!account || account.status !== "active" ? (
            <Section title="Enrol" note="The number the clinic already holds. A portal that texts a code to whatever number is offered hands records to whoever asks.">
              <form action={enrolAction} className="bg-white border border-line rounded p-3 flex flex-wrap gap-2 items-end">
                <input type="hidden" name="patientMrn" value={patient.mrn} />
                <div>
                  <label className={LABEL}>Phone</label>
                  <input name="phone" defaultValue={patient.phone ?? ""} className={FIELD} placeholder="07xx xxx xxx" />
                </div>
                <div>
                  <label className={LABEL}>Channel</label>
                  <select name="channel" className={FIELD}>
                    <option value="sms">SMS</option>
                    <option value="ussd">USSD</option>
                    <option value="web">Web</option>
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Language</label>
                  <select name="language" className={FIELD}>
                    <option value="en">English</option>
                    <option value="sw">Kiswahili</option>
                  </select>
                </div>
                <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Enrol</button>
              </form>
            </Section>
          ) : (
            <>
              <Section
                title="What they would be sent right now"
                note="Exactly this, and nothing else. A clerk can read it out at the counter."
              >
                <pre className="bg-white border border-line rounded p-3 text-sm whitespace-pre-wrap">
                  {asMessage(preview!, account.language)}
                </pre>
                <p className="mt-1 text-xs text-muted">
                  {asMessage(preview!, account.language).length} characters — two SMS segments at most, because
                  a message that runs to five costs five times as much and gets read as often as one.
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <form action={codeAction}>
                    <input type="hidden" name="patientMrn" value={patient.mrn} />
                    <button className="bg-white border border-line text-sm rounded px-3 py-1.5 hover:border-brand">
                      Send a sign-in code
                    </button>
                  </form>
                  <form action={summaryAction}>
                    <input type="hidden" name="patientMrn" value={patient.mrn} />
                    <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Send this summary</button>
                  </form>
                </div>
              </Section>

              <Section title="What is behind it">
                <div className="bg-white border border-line rounded p-3 text-sm space-y-2">
                  <div>
                    <p className="text-xs text-muted uppercase tracking-wide">Results they can see</p>
                    {preview!.results.length === 0 ? (
                      <p className="text-muted">None yet — a result appears once the clinician has acknowledged it.</p>
                    ) : (
                      <ul className="list-disc pl-5">
                        {preview!.results.map((r) => (
                          <li key={`${r.analyte}${r.releasedAt}`}>
                            {r.serviceName}: {r.analyte} {r.value}
                            {r.flag !== "normal" ? <span className="text-clock"> ({r.flag.replace("_", " ")})</span> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {preview!.withheld.length > 0 ? (
                    <div>
                      <p className="text-xs text-muted uppercase tracking-wide">Held back for a person</p>
                      <ul className="list-disc pl-5 text-clock">
                        {preview!.withheld.map((w, index) => (
                          <li key={index}>{w.serviceName} — {w.why}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {preview!.appointments.length > 0 ? (
                    <p className="text-muted">
                      Next visit {preview!.appointments[0].date} at {preview!.appointments[0].time}
                    </p>
                  ) : null}
                  {preview!.owedCents > 0 ? (
                    <p className="text-muted">Balance of their own: {formatKes(preview!.owedCents)}</p>
                  ) : null}
                </div>
              </Section>

              <Section title="Stop it">
                <form action={revokeAction} className="bg-white border border-line rounded p-3 flex flex-wrap gap-2 items-end">
                  <input type="hidden" name="patientMrn" value={patient.mrn} />
                  <div className="flex-1 min-w-60">
                    <label className={LABEL}>Why</label>
                    <input name="reason" required className={FIELD} placeholder="Patient asked to stop" />
                  </div>
                  <button className="bg-white border border-line text-sm rounded px-3 py-1.5 hover:border-block">
                    Revoke access
                  </button>
                </form>
              </Section>
            </>
          )}

          <Section
            title="Somebody else reading this record"
            note={`Time-limited and revocable. Over ${MAJORITY_YEARS} the patient has to have agreed, and a teenager's sensitive results are never shown to a proxy at all.`}
          >
            {proxies.length === 0 ? (
              <Empty>Nobody else may read this record.</Empty>
            ) : (
              <div className="bg-white border border-line rounded divide-y divide-line">
                {proxies.map((proxy) => (
                  <div key={proxy.id} className="px-3 py-2 text-sm flex flex-wrap gap-2 items-center">
                    <span className="font-medium">{proxy.proxy_name}</span>
                    <span className="text-muted">{proxy.relationship} · {proxy.proxy_phone}</span>
                    <span className="text-xs text-muted">until {proxy.granted_until}</span>
                    <form action={revokeProxyAction} className="ml-auto flex gap-2 items-center">
                      <input type="hidden" name="patientMrn" value={patient.mrn} />
                      <input type="hidden" name="proxyId" value={proxy.id} />
                      <input name="reason" required className="border border-line rounded px-2 py-1 text-xs" placeholder="reason" />
                      <button className="text-xs border border-line rounded px-2 py-1 hover:border-block">Revoke</button>
                    </form>
                  </div>
                ))}
              </div>
            )}

            <form action={proxyAction} className="mt-3 bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-5 items-end">
              <input type="hidden" name="patientMrn" value={patient.mrn} />
              <div>
                <label className={LABEL}>Their name</label>
                <input name="proxyName" required className={FIELD} />
              </div>
              <div>
                <label className={LABEL}>Their phone</label>
                <input name="proxyPhone" required className={FIELD} placeholder="07xx xxx xxx" />
              </div>
              <div>
                <label className={LABEL}>Relationship</label>
                <input name="relationship" required className={FIELD} placeholder="mother" />
              </div>
              <div>
                <label className={LABEL}>Until</label>
                <input name="untilDate" type="date" required className={FIELD} />
              </div>
              <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Grant</button>
              <label className="flex items-center gap-2 text-sm sm:col-span-5">
                <input type="checkbox" name="patientConsented" />
                The patient agreed to this in person (required for anybody {MAJORITY_YEARS} or over)
              </label>
            </form>
          </Section>

          <Section title="What was looked at" note="The patient's own right to ask, kept separately from the audit log.">
            {history.length === 0 ? (
              <Empty>Nobody has opened this record through the portal.</Empty>
            ) : (
              <div className="bg-white border border-line rounded divide-y divide-line">
                {history.map((row) => (
                  <div key={row.id} className="px-3 py-2 text-sm">
                    <span className="text-muted">{row.viewed_at.slice(0, 16).replace("T", " ")}</span>{" "}
                    {row.by_proxy ? <span>{row.proxy_name}</span> : <span>the patient</span>}
                    <span className="text-muted">
                      {" "}· {row.items} item{row.items === 1 ? "" : "s"} shown
                      {row.withheld > 0 ? `, ${row.withheld} held back` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      ) : null}

      {/* ==================================================== rules */}
      {view === "rules" && !patient ? (
        <Section title="What reaches a phone, and what does not">
          <div className="bg-white border border-line rounded p-3 text-sm space-y-3">
            <p>
              <strong>A result reaches a patient after a clinician has seen it, never before.</strong> A panic
              potassium arriving on somebody's phone at 9pm with nobody to ask is not transparency, it is harm.
              Results become visible when the ordering clinician acknowledges them — a state this system already
              tracks and already chases.
            </p>
            <p>
              <strong>Some findings are never put in a message.</strong> Anything flagged panic, and anything
              matching {WITHHELD_ANALYTES.slice(0, 6).join(", ")} and the rest of that list. The patient is told
              a result exists, because hiding that would be its own harm, with a line saying the clinic will go
              through it with them. <em>Which findings belong on that list is a clinician's judgement and section
              21 of the clinical review register asks for it.</em>
            </p>
            <p>
              <strong>A teenager's record is not their parent's.</strong> Proxy access needs the patient's own
              agreement from {MAJORITY_YEARS}, and from twelve their results are shown only to them. A girl who
              cannot get tested without her mother reading the result does not get tested.
            </p>
            <p>
              <strong>A code lives {CODE_MINUTES} minutes and dies after {MAX_ATTEMPTS} wrong tries.</strong> It
              is stored as a digest, never in the clear: a table of live codes is a table that opens every record
              in the clinic if it is ever copied.
            </p>
            <p>
              <strong>A patient sees; a patient does not edit.</strong> Nothing here writes clinical content. The
              one thing they can change is whether they want the portal at all.
            </p>
          </div>
        </Section>
      ) : null}
    </Shell>
  );
}
