import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  referralWorklist, awaitingOutcome, referralLog, referralSummary, referralDirectory,
  getReferral, referralHistory, referralLetter,
  ACCEPTANCE_TARGET_MINUTES, OUTCOME_CHASE_DAYS,
  type Urgency, type ReferralStatus,
} from "@/lib/referrals.ts";
import { searchPatients } from "@/lib/patients.ts";
import { getFacility, LEVELS } from "@/lib/facility.ts";
import { Shell, Stat, Section, Empty, Views } from "@/app/_components/shell.tsx";
import {
  raiseAction, acceptAction, declineAction, departAction,
  arriveAction, outcomeAction, cancelAction,
} from "./actions.ts";

/**
 * Referrals.
 *
 * Four views, but one of them is the point: "Never came back". A referral
 * system that can only show what it sent is the thing this module exists to
 * replace.
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";
const LABEL = "block text-xs text-muted mb-1";

const URGENCY_CHIP: Record<Urgency, string> = {
  emergency: "bg-block text-white",
  urgent: "bg-clock text-white",
  routine: "bg-brand-soft text-brand-dark",
};

const STATUS_TONE: Record<ReferralStatus, string> = {
  raised: "text-clock",
  accepted: "text-good",
  declined: "text-block",
  departed: "text-brand-dark",
  arrived: "text-brand-dark",
  completed: "text-good",
  cancelled: "text-muted",
};

function clock(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 2880) return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}`;
  return `${Math.floor(minutes / 1440)} days`;
}

export default async function ReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; r?: string; q?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "patient.read")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "out";
  const acting = can(user.userId, "encounter.conduct");

  const here = getFacility(user.facilityId)!;
  const out = referralWorklist(user.facilityId, "out");
  const incoming = referralWorklist(user.facilityId, "in");
  const waiting = awaitingOutcome(user.facilityId);
  const log = referralLog(user.facilityId, undefined, 40);
  const summary = referralSummary(user.facilityId);
  const directory = referralDirectory();

  const open = params.r ? getReferral(params.r) : undefined;
  const openLetter = open ? referralLetter(open.id) : undefined;
  const openHistory = open ? referralHistory(open.id) : [];

  const candidates = params.q?.trim()
    ? searchPatients({ facilityId: user.facilityId, query: params.q, limit: 6 })
    : [];

  const href = (v: string) => (v === "out" ? "/referrals" : `/referrals?view=${v}`);
  const rows = view === "in" ? incoming : out;

  return (
    <Shell
      user={user}
      current={href(view)}
      error={params.error}
      title={
        view === "in" ? "Referrals in"
        : view === "awaiting" ? "Never came back"
        : view === "log" ? "Referral log"
        : "Referrals out"
      }
      subtitle={
        view === "awaiting"
          ? `Patients who left and whose outcome nobody here knows. Past ${OUTCOME_CHASE_DAYS} days the loop is treated as broken. Oldest first, because the oldest is the one nobody will chase unless a screen says so.`
          : view === "out"
            ? `${here.name} is ${LEVELS[here.level]} (level ${here.level}). Nobody travels towards a hospital that has not accepted them.`
            : undefined
      }
    >
      <Views
        current={view}
        views={[
          { key: "out", label: "Out", href: "/referrals" },
          { key: "in", label: "In", href: "/referrals?view=in" },
          { key: "awaiting", label: "Never came back", href: "/referrals?view=awaiting" },
          { key: "log", label: "Log", href: "/referrals?view=log" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Live referrals" value={summary.live} note={`${summary.out} sent · ${summary.in} received`} />
        <Stat
          label="Nobody has answered"
          value={summary.unanswered}
          tone={summary.unanswered > 0 ? "block" : "good"}
          note={`emergency answered in ${ACCEPTANCE_TARGET_MINUTES.emergency} min`}
        />
        <Stat
          label="Loop closed"
          value={summary.loopClosedPercent === null ? "—" : `${summary.loopClosedPercent}%`}
          tone={
            summary.loopClosedPercent === null ? "muted"
            : summary.loopClosedPercent >= 80 ? "good"
            : summary.loopClosedPercent >= 50 ? "clock" : "block"
          }
          note="of those who left, came back with an outcome"
        />
        <Stat
          label="Loop broken"
          value={summary.loopBroken}
          tone={summary.loopBroken > 0 ? "block" : "good"}
          note={`gone over ${OUTCOME_CHASE_DAYS} days, nothing heard`}
        />
      </div>

      {/* ============================================== never came back */}
      {view === "awaiting" ? (
        <Section
          title="Patients we have not heard about"
          note="This is the half of a referral that almost never happens. Recording it here is what turns a stack of letters into a referral system."
        >
          {waiting.length === 0 ? (
            <Empty>Every referral that left has come back with an outcome.</Empty>
          ) : (
            <div className="space-y-3">
              {waiting.map((r) => (
                <div
                  key={r.referral.id}
                  className={`bg-white border rounded p-3 ${r.loopBroken ? "border-block" : "border-line"}`}
                >
                  <div className="flex flex-wrap items-baseline gap-3">
                    <Link href={`/patients/${encodeURIComponent(r.referral.patient_mrn)}`} className="font-semibold underline underline-offset-2">
                      {r.patientName}
                    </Link>
                    <span className={`text-[10px] font-bold uppercase tracking-wide rounded px-2 py-1 ${URGENCY_CHIP[r.referral.urgency]}`}>
                      {r.referral.urgency}
                    </span>
                    <span className="text-sm text-muted">to {r.destination}</span>
                    <span className={`text-sm tnum font-bold ml-auto ${r.loopBroken ? "text-block" : "text-muted"}`}>
                      {r.daysOpen} days
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-1">
                    {r.referral.reason}
                    {r.referral.departed_at ? ` · left ${r.referral.departed_at.slice(0, 10)}` : ""}
                    {r.referral.transport ? ` by ${r.referral.transport}` : ""}
                  </p>

                  {acting ? (
                    <form action={outcomeAction} className="mt-3 pt-3 border-t border-line">
                      <input type="hidden" name="referralId" value={r.referral.id} />
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label><span className={LABEL}>What happened</span>
                          <select name="outcome" className={FIELD}>
                            {[
                              ["treated_returned", "Treated and returned to us"],
                              ["admitted_there", "Admitted there"],
                              ["died", "Died"],
                              ["absconded", "Absconded"],
                              ["not_seen", "Never seen"],
                              ["other", "Other"],
                            ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </label>
                        <label className="sm:col-span-2"><span className={LABEL}>What was done, and what we should continue</span>
                          <input name="note" className={FIELD} placeholder="e.g. conservative management, discharged day 2, continue phenytoin 100mg tds" />
                        </label>
                      </div>
                      <div className="flex gap-3 mt-2 items-end">
                        <label className="flex-1 max-w-xs"><span className={LABEL}>Who told us</span><input name="outcomeByName" className={FIELD} /></label>
                        <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                          Close the loop
                        </button>
                        <Link href={`/referrals?r=${r.referral.id}`} className="text-brand underline underline-offset-2 text-xs pb-2">
                          Open
                        </Link>
                      </div>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Section>
      ) : null}

      {/* ================================================ out and in */}
      {view === "out" || view === "in" ? (
        <>
          <Section
            title={view === "in" ? "Arriving with a letter" : "Live referrals"}
            note={
              view === "out"
                ? `Unanswered first. Emergency ${ACCEPTANCE_TARGET_MINUTES.emergency} min · urgent ${Math.round(ACCEPTANCE_TARGET_MINUTES.urgent / 60)}h · routine ${Math.round(ACCEPTANCE_TARGET_MINUTES.routine / 1440)} days.`
                : "A facility that only records what it sends cannot show what it receives."
            }
          >
            {rows.length === 0 ? (
              <Empty>{view === "in" ? "Nobody has arrived on a referral." : "No referral is outstanding."}</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm bg-white border border-line rounded">
                  <thead>
                    <tr className="text-xs text-muted text-left">
                      <th className="px-3 py-2 font-medium">Urgency</th>
                      <th className="px-3 py-2 font-medium">Patient</th>
                      <th className="px-3 py-2 font-medium">{view === "in" ? "From" : "To"}</th>
                      <th className="px-3 py-2 font-medium">Reason</th>
                      <th className="px-3 py-2 font-medium text-right">Waiting</th>
                      <th className="px-3 py-2 font-medium">State</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.referral.id}
                        className={`border-t border-line ${r.unanswered ? "bg-block-soft" : ""} ${
                          r.referral.id === open?.id ? "bg-brand-soft" : ""
                        }`}
                      >
                        <td className="px-3 py-2">
                          <span className={`text-[10px] font-bold uppercase tracking-wide rounded px-2 py-1 ${URGENCY_CHIP[r.referral.urgency]}`}>
                            {r.referral.urgency}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <Link href={`/patients/${encodeURIComponent(r.referral.patient_mrn)}`} className="underline underline-offset-2">
                            {r.patientName}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          {r.destination}
                          {r.destinationLevel !== null ? (
                            <span className="text-[10px] text-muted ml-1">level {r.destinationLevel}</span>
                          ) : (
                            <span className="text-[10px] text-muted ml-1">not in the directory</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted">{r.referral.reason}</td>
                        <td className={`px-3 py-2 text-right tnum font-bold ${r.unanswered ? "text-block" : ""}`}>
                          {clock(r.minutesWaiting)}
                        </td>
                        <td className={`px-3 py-2 text-xs font-semibold capitalize ${STATUS_TONE[r.referral.status]}`}>
                          {r.unanswered ? "Nobody has answered" : r.referral.status}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link href={`/referrals?r=${r.referral.id}`} className="text-brand underline underline-offset-2 text-xs">
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ------------------------------------ one referral, and its letter */}
          {open && openLetter ? (
            <Section
              title={`${openLetter.patient.name} — ${openLetter.to.name}`}
              note={`Raised ${open.raised_at.slice(0, 16).replace("T", " ")} by ${open.raiser_name} · ${open.status}`}
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="bg-white border border-line rounded p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted mb-3">Referral letter</p>
                  <dl className="text-sm space-y-2">
                    {[
                      ["From", `${openLetter.from.name} · KMHFL ${openLetter.from.kmhflCode} · ${openLetter.from.levelName}`],
                      ["To", `${openLetter.to.name}${openLetter.to.phone ? ` · ${openLetter.to.phone}` : ""}`],
                      ["Patient", `${openLetter.patient.name} · ${openLetter.patient.mrn}${openLetter.patient.shaNumber ? ` · SHA ${openLetter.patient.shaNumber}` : ""}`],
                      ["Service needed", openLetter.serviceNeeded || "—"],
                      ["Reason", openLetter.reason],
                      ["Already done here", openLetter.treatmentGiven || "—"],
                      ["Clinical summary", openLetter.clinicalSummary || "—"],
                      ["Accepted by", openLetter.acceptedBy ?? "not yet accepted"],
                      ["Transport", openLetter.transport ?? "—"],
                    ].map(([label, value]) => (
                      <div key={label} className="grid grid-cols-[9rem_1fr] gap-2">
                        <dt className="text-xs text-muted pt-0.5">{label}</dt>
                        <dd className={label === "Accepted by" && !openLetter.acceptedBy ? "text-clock font-semibold" : ""}>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div>
                  <div className="bg-white border border-line rounded p-3 mb-4">
                    <p className="text-sm font-semibold mb-2">Timeline</p>
                    {openHistory.map((e, index) => (
                      <div key={index} className="flex gap-3 text-sm py-1 border-t border-line first:border-0">
                        <span className="tnum text-xs text-muted w-32 shrink-0">{e.at.slice(0, 16).replace("T", " ")}</span>
                        <span className="font-medium capitalize w-24 shrink-0">{e.to_status}</span>
                        <span className="text-xs text-muted flex-1">{e.note || "—"}</span>
                        <span className="text-xs text-muted">{e.by_name}</span>
                      </div>
                    ))}
                  </div>

                  {acting && open.status === "raised" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <form action={acceptAction} className="bg-white border border-line rounded p-3">
                        <input type="hidden" name="referralId" value={open.id} />
                        <p className="text-sm font-semibold mb-1">They have accepted</p>
                        <p className="text-xs text-muted mb-2">A name, not just a yes — somebody has to be findable at the gate.</p>
                        <input name="acceptedByName" placeholder="Dr. Owino, casualty registrar" className={FIELD} />
                        <button type="submit" className="mt-2 bg-brand text-white font-semibold rounded px-4 py-2 text-sm w-full">
                          Accepted
                        </button>
                      </form>
                      <form action={declineAction} className="bg-white border border-line rounded p-3">
                        <input type="hidden" name="referralId" value={open.id} />
                        <p className="text-sm font-semibold mb-1">They have declined</p>
                        <p className="text-xs text-muted mb-2">Say why, so the next facility knows whether to try the same place.</p>
                        <input name="reason" placeholder="No ICU bed until Thursday" className={FIELD} />
                        <button type="submit" className="mt-2 border border-line font-semibold rounded px-4 py-2 text-sm w-full">
                          Declined
                        </button>
                      </form>
                    </div>
                  ) : null}

                  {acting && open.status === "accepted" ? (
                    <form action={departAction} className="bg-white border border-line rounded p-3">
                      <input type="hidden" name="referralId" value={open.id} />
                      <p className="text-sm font-semibold mb-2">The patient has left</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label><span className={LABEL}>Transport</span><input name="transport" placeholder="County ambulance KCB 411X" className={FIELD} /></label>
                        <label><span className={LABEL}>Escort</span><input name="escort" className={FIELD} /></label>
                      </div>
                      <button type="submit" className="mt-2 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                        Departed
                      </button>
                    </form>
                  ) : null}

                  {acting && open.status === "departed" ? (
                    <form action={arriveAction} className="bg-white border border-line rounded p-3">
                      <input type="hidden" name="referralId" value={open.id} />
                      <p className="text-sm font-semibold mb-2">They arrived</p>
                      <input name="note" placeholder="Confirmed by telephone" className={FIELD} />
                      <button type="submit" className="mt-2 border border-line font-semibold rounded px-4 py-2 text-sm">
                        Confirm arrival
                      </button>
                    </form>
                  ) : null}

                  {acting && !["completed", "cancelled"].includes(open.status) ? (
                    <form action={cancelAction} className="mt-3 flex gap-2 items-end">
                      <input type="hidden" name="referralId" value={open.id} />
                      <label className="flex-1"><span className={LABEL}>Cancel this referral</span>
                        <input name="reason" placeholder="why" className={FIELD} />
                      </label>
                      <button type="submit" className="border border-line text-muted font-semibold rounded px-3 py-2 text-sm">
                        Cancel
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            </Section>
          ) : null}

          {/* ------------------------------------------------ raise a referral */}
          {acting ? (
            <Section
              title={view === "in" ? "Log a referral in" : "Refer a patient"}
              note={
                view === "in"
                  ? "Somebody has arrived carrying a letter from another facility."
                  : `Sending a patient above level ${here.level} must record what was already done here. A referral that cannot say what was tried is how a referral hospital ends up seeing everything.`
              }
            >
              <form method="get" className="mb-3 flex gap-2">
                {view === "in" ? <input type="hidden" name="view" value="in" /> : null}
                <input name="q" defaultValue={params.q ?? ""} placeholder="Find the patient" className={`${FIELD} max-w-sm`} />
                <button type="submit" className="border border-line font-semibold rounded px-4 py-2 text-sm">Search</button>
              </form>

              {candidates.length > 0 ? (
                <div className="space-y-2">
                  {candidates.map((c) => (
                    <form action={raiseAction} key={c.mrn} className="bg-white border border-line rounded p-3">
                      <input type="hidden" name="mrn" value={c.mrn} />
                      <input type="hidden" name="direction" value={view === "in" ? "in" : "out"} />
                      <p className="text-sm font-semibold mb-2">
                        {c.given_name} {c.family_name} <span className="font-mono text-xs text-muted ml-2">{c.mrn}</span>
                      </p>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label><span className={LABEL}>{view === "in" ? "From" : "To"}</span>
                          <select name="counterpartCode" className={FIELD} defaultValue="">
                            <option value="">Somewhere else — name it below</option>
                            {directory.map((f) => (
                              <option key={f.kmhfl_code} value={f.kmhfl_code}>
                                {f.name} — level {f.level}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label><span className={LABEL}>Or name it</span><input name="externalName" className={FIELD} /></label>
                        <label><span className={LABEL}>Urgency</span>
                          <select name="urgency" className={FIELD} defaultValue="urgent">
                            <option value="emergency">Emergency</option>
                            <option value="urgent">Urgent</option>
                            <option value="routine">Routine</option>
                          </select>
                        </label>
                        <label><span className={LABEL}>Service needed</span><input name="serviceNeeded" placeholder="Neurosurgery" className={FIELD} /></label>
                        <label className="sm:col-span-2"><span className={LABEL}>Reason</span><input name="reason" className={FIELD} /></label>
                        <label className="sm:col-span-2"><span className={LABEL}>Already done here</span>
                          <input name="treatmentGiven" placeholder="IV fluids, analgesia, cervical collar" className={FIELD} />
                        </label>
                        <label><span className={LABEL}>Clinical summary</span><input name="clinicalSummary" className={FIELD} /></label>
                      </div>
                      <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                        {view === "in" ? "Log it" : "Refer"}
                      </button>
                    </form>
                  ))}
                </div>
              ) : params.q ? (
                <Empty>No patient matches that.</Empty>
              ) : null}
            </Section>
          ) : null}

          {view === "out" ? (
            <Section title="Where we refer to" note="A directory, not free text. A destination nobody can telephone is not a destination.">
              <div className="overflow-x-auto">
                <table className="w-full text-sm bg-white border border-line rounded">
                  <thead>
                    <tr className="text-xs text-muted text-left">
                      <th className="px-3 py-2 font-medium">Facility</th>
                      <th className="px-3 py-2 font-medium text-right">Level</th>
                      <th className="px-3 py-2 font-medium">County</th>
                      <th className="px-3 py-2 font-medium">What they take</th>
                      <th className="px-3 py-2 font-medium">Telephone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {directory.map((f) => (
                      <tr key={f.kmhfl_code} className="border-t border-line">
                        <td className="px-3 py-2">
                          {f.name} <span className="font-mono text-[10px] text-muted ml-1">{f.kmhfl_code}</span>
                        </td>
                        <td className="px-3 py-2 text-right tnum font-semibold">{f.level}</td>
                        <td className="px-3 py-2 text-muted">{f.county}</td>
                        <td className="px-3 py-2 text-xs text-muted">{f.services}</td>
                        <td className="px-3 py-2 tnum text-xs">{f.phone || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted mt-3 leading-relaxed">
                Demonstration directory. The real one is a KMHFL extract for this county and its neighbours,
                loaded at commissioning — a data task, not a release.
              </p>
            </Section>
          ) : null}
        </>
      ) : null}

      {/* ========================================================= log */}
      {view === "log" ? (
        <Section title="Referral log" note="Everything, both directions, newest first.">
          {log.length === 0 ? (
            <Empty>No referral has been made.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Raised</th>
                    <th className="px-3 py-2 font-medium">Way</th>
                    <th className="px-3 py-2 font-medium">Patient</th>
                    <th className="px-3 py-2 font-medium">Counterpart</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((r) => (
                    <tr key={r.referral.id} className="border-t border-line">
                      <td className="px-3 py-2 tnum text-muted">{r.referral.raised_at.slice(0, 10)}</td>
                      <td className="px-3 py-2 text-xs uppercase tracking-wide font-semibold text-muted">
                        {r.referral.direction}
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/referrals?r=${r.referral.id}`} className="underline underline-offset-2">
                          {r.patientName}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{r.destination}</td>
                      <td className={`px-3 py-2 text-xs font-semibold capitalize ${STATUS_TONE[r.referral.status]}`}>
                        {r.referral.status}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {r.referral.outcome ? (
                          <span className="capitalize">{r.referral.outcome.replace(/_/g, " ")}</span>
                        ) : r.loopBroken ? (
                          <span className="text-block font-semibold">nothing heard, {r.daysOpen} days</span>
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
    </Shell>
  );
}
