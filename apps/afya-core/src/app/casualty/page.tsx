import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  board, breaches, attendanceLog, emergencySummary, getAttendance, triageHistory,
  medicolegalFor, listIncidents, incidentBoard, waitMinutes,
  TARGET_MINUTES, TRIAGE_LABEL, TRIAGE_ORDER,
  type Triage,
} from "@/lib/emergency.ts";
import { searchPatients, resolvePatient } from "@/lib/patients.ts";
import { Shell, Stat, Section, Empty, Views } from "@/app/_components/shell.tsx";
import {
  arriveAction, arriveUnknownAction, identifyAction, triageAction, takeAction,
  dispositionAction, medicolegalAction, p3Action, declareAction, standDownAction,
} from "./actions.ts";

/**
 * Casualty.
 *
 * The board is the product. It is sorted by colour and then by how long
 * somebody has waited, with untriaged patients above everything, because an
 * unknown colour is not a mild one.
 *
 * Nothing on the arrival form asks about money, and that is deliberate — see
 * the note at the top of `emergency.ts`.
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";
const LABEL = "block text-xs text-muted mb-1";

/** Colour classes per triage colour. Presentation only. */
const CHIP: Record<Triage, string> = {
  red: "bg-block text-white",
  orange: "bg-clock text-white",
  yellow: "bg-clock-soft text-clock",
  green: "bg-good-soft text-good",
  blue: "bg-ink text-white",
};
const ROW: Record<Triage, string> = {
  red: "bg-block-soft",
  orange: "bg-clock-soft",
  yellow: "",
  green: "",
  blue: "opacity-70",
};

function clock(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}`;
}

export default async function CasualtyPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; a?: string; i?: string; q?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "patient.read")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "board";
  const triageable = can(user.userId, "queue.manage");
  const treating = can(user.userId, "encounter.conduct");

  const rows = board(user.facilityId);
  const breached = breaches(user.facilityId);
  const summary = emergencySummary(user.facilityId);
  const log = attendanceLog(user.facilityId, 40);
  const incidents = listIncidents(user.facilityId);
  const live = incidents.filter((i) => !i.stood_down_at);

  const open = params.a ? getAttendance(params.a) : undefined;
  const openRow = open ? rows.find((r) => r.attendance.id === open.id) : undefined;
  const openPatient = open ? resolvePatient(open.patient_mrn) : undefined;
  const openTriage = open ? triageHistory(open.id) : [];
  const openCases = open ? medicolegalFor(open.id) : [];

  const incident = params.i ? incidents.find((i) => i.reference === params.i) : undefined;
  const casualties = incident ? incidentBoard(incident.reference) : [];

  const candidates = params.q?.trim()
    ? searchPatients({ facilityId: user.facilityId, query: params.q, limit: 6 })
    : [];

  const href = (v: string) => (v === "board" ? "/casualty" : `/casualty?view=${v}`);

  return (
    <Shell
      user={user}
      current={href(view)}
      error={params.error}
      title={
        view === "incidents" ? "Mass casualty incidents"
        : view === "log" ? "Casualty log"
        : "Casualty board"
      }
      subtitle={
        view === "board"
          ? "Worst colour first, longest wait first, and anybody nobody has looked at above all of it. Emergency treatment is never gated on payment — Article 43(2) of the Constitution and section 7 of the Health Act."
          : undefined
      }
      actions={
        live.length > 0 ? (
          <Link
            href={`/casualty?view=incidents&i=${live[0].reference}`}
            className="bg-block text-white font-semibold rounded px-3 py-2 text-sm"
          >
            {live.length === 1 ? live[0].reference : `${live.length} incidents`} live
          </Link>
        ) : null
      }
    >
      <Views
        current={view}
        views={[
          { key: "board", label: "Board", href: "/casualty" },
          { key: "incidents", label: "Incidents", href: "/casualty?view=incidents" },
          { key: "log", label: "Log", href: "/casualty?view=log" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="In the department" value={summary.open} note={`${summary.attendances} attendances in all`} />
        <Stat
          label="Past target"
          value={summary.breached + summary.untriaged}
          tone={summary.breached + summary.untriaged > 0 ? "block" : "good"}
          note={summary.untriaged > 0 ? `${summary.untriaged} never triaged` : "everybody inside target"}
        />
        <Stat
          label="Seen within target"
          value={summary.withinTargetPercent === null ? "—" : `${summary.withinTargetPercent}%`}
          tone={
            summary.withinTargetPercent === null ? "muted"
            : summary.withinTargetPercent >= 90 ? "good"
            : summary.withinTargetPercent >= 70 ? "clock" : "block"
          }
          note={summary.medianWaitMinutes === null ? "nobody seen yet" : `median wait ${clock(summary.medianWaitMinutes)}`}
        />
        <Stat
          label="Left without being seen"
          value={summary.leftWithoutBeingSeen}
          tone={summary.leftWithoutBeingSeen > 0 ? "clock" : "good"}
          note={`${summary.deadOnArrival} dead on arrival · ${summary.medicolegal} police cases`}
        />
      </div>

      {/* ===================================================== the board */}
      {view === "board" ? (
        <>
          <Section
            title="In the department"
            note={TRIAGE_ORDER.map((t) => `${TRIAGE_LABEL[t]} ${t === "blue" ? "" : `${TARGET_MINUTES[t]} min`}`).join(" · ")}
          >
            {rows.length === 0 ? (
              <Empty>Casualty is empty.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm bg-white border border-line rounded">
                  <thead>
                    <tr className="text-xs text-muted text-left">
                      <th className="px-3 py-2 font-medium">Triage</th>
                      <th className="px-3 py-2 font-medium">Patient</th>
                      <th className="px-3 py-2 font-medium">Presenting</th>
                      <th className="px-3 py-2 font-medium">Arrived</th>
                      <th className="px-3 py-2 font-medium text-right">Waited</th>
                      <th className="px-3 py-2 font-medium">State</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.attendance.id}
                        className={`border-t border-line ${
                          r.untriaged ? "bg-block-soft" : r.attendance.triage ? ROW[r.attendance.triage] : ""
                        } ${r.attendance.id === open?.id ? "bg-brand-soft" : ""}`}
                      >
                        <td className="px-3 py-2">
                          {r.attendance.triage ? (
                            <span className={`text-[10px] font-bold uppercase tracking-wide rounded px-2 py-1 ${CHIP[r.attendance.triage]}`}>
                              {TRIAGE_LABEL[r.attendance.triage]}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold uppercase tracking-wide rounded px-2 py-1 bg-block text-white">
                              Not triaged
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Link href={`/patients/${encodeURIComponent(r.attendance.patient_mrn)}`} className="underline underline-offset-2">
                            {r.patientName}
                          </Link>
                          {r.attendance.unidentified ? (
                            <span className="text-[10px] font-bold text-clock ml-2 uppercase tracking-wide">no name</span>
                          ) : null}
                          {r.medicolegal > 0 ? (
                            <span className="text-[10px] font-bold text-block ml-2 uppercase tracking-wide">police</span>
                          ) : null}
                          {r.attendance.incident_ref ? (
                            <span className="text-[10px] text-muted ml-2 font-mono">{r.attendance.incident_ref}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted">{r.attendance.presenting || "—"}</td>
                        <td className="px-3 py-2 tnum text-muted">
                          {r.attendance.arrived_at.slice(11, 16)}
                          <span className="text-[10px] ml-1 capitalize">{r.attendance.arrival_mode.replace(/_/g, " ")}</span>
                        </td>
                        <td className={`px-3 py-2 text-right tnum font-bold ${r.breached || r.untriaged ? "text-block" : ""}`}>
                          {clock(r.waited)}
                          {r.targetMinutes !== null ? (
                            <span className="text-[10px] text-muted font-normal ml-1">/ {r.targetMinutes}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {r.attendance.seen_at ? (
                            <span className="text-good font-semibold">With a clinician</span>
                          ) : r.untriaged ? (
                            <span className="text-block font-semibold">Nobody has looked</span>
                          ) : r.breached ? (
                            <span className="text-block font-semibold">Past target</span>
                          ) : (
                            <span className="text-muted">Waiting</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link href={`/casualty?a=${r.attendance.id}`} className="text-brand underline underline-offset-2 text-xs">
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

          {/* ------------------------------------------- one patient in detail */}
          {open && openPatient ? (
            <Section
              title={`${openPatient.given_name} ${openPatient.family_name} — arrived ${open.arrived_at.slice(11, 16)}`}
              note={
                openRow
                  ? `${open.triage ? TRIAGE_LABEL[open.triage] : "Not triaged"} · waited ${clock(openRow.waited)}${open.presenting ? ` · ${open.presenting}` : ""}`
                  : open.presenting
              }
            >
              {openTriage.length > 0 ? (
                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm bg-white border border-line rounded">
                    <thead>
                      <tr className="text-xs text-muted text-left">
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">At</th>
                        <th className="px-3 py-2 font-medium">Mobility</th>
                        <th className="px-3 py-2 font-medium">RR</th>
                        <th className="px-3 py-2 font-medium">Pulse</th>
                        <th className="px-3 py-2 font-medium">Systolic</th>
                        <th className="px-3 py-2 font-medium">AVPU</th>
                        <th className="px-3 py-2 font-medium text-right">TEWS</th>
                        <th className="px-3 py-2 font-medium">Colour</th>
                        <th className="px-3 py-2 font-medium">Raised because</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openTriage.map((t) => (
                        <tr key={t.id} className="border-t border-line">
                          <td className="px-3 py-2 tnum">{t.sequence}</td>
                          <td className="px-3 py-2 tnum text-muted">{t.assessed_at.slice(11, 16)}</td>
                          <td className="px-3 py-2 text-xs capitalize">{t.mobility?.replace(/_/g, " ") ?? "—"}</td>
                          <td className="px-3 py-2 tnum">{t.resp_rate ?? "—"}</td>
                          <td className="px-3 py-2 tnum">{t.pulse_bpm ?? "—"}</td>
                          <td className="px-3 py-2 tnum">{t.systolic_mmhg ?? "—"}</td>
                          <td className="px-3 py-2 text-xs capitalize">{t.avpu ?? "—"}</td>
                          <td className="px-3 py-2 text-right tnum font-bold">{t.tews}</td>
                          <td className="px-3 py-2">
                            <span className={`text-[10px] font-bold uppercase tracking-wide rounded px-2 py-1 ${CHIP[t.triage]}`}>
                              {TRIAGE_LABEL[t.triage]}
                            </span>
                            {t.triage !== t.triage_by_score ? (
                              <span className="text-[10px] text-muted ml-1">score said {t.triage_by_score}</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-xs text-block font-semibold">{t.discriminator || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-block font-semibold mb-4">Nobody has triaged this patient yet.</p>
              )}

              {openCases.length > 0 ? (
                <div className="mb-4 bg-white border border-line rounded p-3">
                  <p className="text-sm font-semibold mb-2">Police cases</p>
                  {openCases.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center gap-3 text-sm py-1 border-t border-line first:border-0">
                      <span className="capitalize font-medium">{c.kind.replace(/_/g, " ")}</span>
                      {c.ob_number ? <span className="font-mono text-xs text-muted">{c.ob_number}</span> : null}
                      {c.police_station ? <span className="text-xs text-muted">{c.police_station}</span> : null}
                      {c.p3_issued ? (
                        <span className="text-xs text-good font-semibold">P3 issued to {c.p3_issued_to}</span>
                      ) : treating ? (
                        <form action={p3Action} className="flex gap-1 items-center">
                          <input type="hidden" name="attendanceId" value={open.id} />
                          <input type="hidden" name="caseId" value={c.id} />
                          <input name="issuedTo" placeholder="handed to" className="border border-line rounded px-2 py-1 text-xs w-40" />
                          <button type="submit" className="border border-brand text-brand font-semibold rounded px-2 py-1 text-xs">
                            Issue P3
                          </button>
                        </form>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {open.unidentified && treating ? (
                <form action={identifyAction} className="bg-white border border-line rounded p-3 mb-4">
                  <input type="hidden" name="attendanceId" value={open.id} />
                  <p className="text-sm font-semibold mb-1">Identify this patient</p>
                  <p className="text-xs text-muted mb-3">
                    A merge, not an edit. Everything ordered, given and charged under the temporary name follows
                    them into their real record, and the temporary number keeps resolving.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label><span className={LABEL}>Their real file number</span><input name="mrn" className={FIELD} /></label>
                    <label><span className={LABEL}>How they were identified</span><input name="reason" className={FIELD} /></label>
                  </div>
                  <button type="submit" className="mt-3 border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
                    Identify
                  </button>
                </form>
              ) : null}

              {triageable && !open.disposition ? (
                <form action={triageAction} className="bg-white border border-line rounded p-3">
                  <input type="hidden" name="attendanceId" value={open.id} />
                  <p className="text-sm font-semibold mb-1">{openTriage.length === 0 ? "Triage" : "Re-triage"}</p>
                  <p className="text-xs text-muted mb-3">
                    The score gives a colour. Raising it by hand needs a reason, and nothing can lower it.
                    {openTriage.length > 0 ? " Re-triaging does not reset the clock." : ""}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <label><span className={LABEL}>Mobility</span>
                      <select name="mobility" className={FIELD} defaultValue="walking">
                        <option value="walking">Walking</option>
                        <option value="with_help">With help</option>
                        <option value="stretcher">Stretcher</option>
                      </select>
                    </label>
                    <label><span className={LABEL}>Respiratory rate</span><input name="respRate" inputMode="numeric" className={FIELD} /></label>
                    <label><span className={LABEL}>Pulse</span><input name="pulseBpm" inputMode="numeric" className={FIELD} /></label>
                    <label><span className={LABEL}>Systolic</span><input name="systolicMmhg" inputMode="numeric" className={FIELD} /></label>
                    <label><span className={LABEL}>Temperature (°C)</span><input name="tempC" inputMode="decimal" className={FIELD} /></label>
                    <label><span className={LABEL}>Responsiveness</span>
                      <select name="avpu" className={FIELD} defaultValue="alert">
                        <option value="alert">Alert</option>
                        <option value="voice">Responds to voice</option>
                        <option value="pain">Responds to pain</option>
                        <option value="unresponsive">Unresponsive</option>
                      </select>
                    </label>
                    <label><span className={LABEL}>Raise to</span>
                      <select name="discriminatorTriage" className={FIELD} defaultValue="">
                        <option value="">Leave it to the score</option>
                        {TRIAGE_ORDER.filter((t) => t !== "blue").map((t) => (
                          <option key={t} value={t}>{TRIAGE_LABEL[t]}</option>
                        ))}
                      </select>
                    </label>
                    <label><span className={LABEL}>What you saw</span><input name="discriminator" placeholder="active bleeding, seizing…" className={FIELD} /></label>
                  </div>
                  <div className="flex flex-wrap gap-4 mt-3 text-sm">
                    <label className="flex items-center gap-1.5"><input type="checkbox" name="trauma" /> <span>Trauma</span></label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" name="deadOnArrival" /> <span>Dead on arrival</span></label>
                  </div>
                  <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                    {openTriage.length === 0 ? "Triage" : "Re-triage"}
                  </button>
                </form>
              ) : null}

              {treating && !open.disposition ? (
                <div className="grid gap-4 sm:grid-cols-3 mt-4">
                  {!open.seen_at ? (
                    <form action={takeAction} className="bg-white border border-line rounded p-3 self-start">
                      <input type="hidden" name="attendanceId" value={open.id} />
                      <p className="text-sm font-semibold mb-1">Take this patient</p>
                      <p className="text-xs text-muted mb-3">Stops the triage clock. This is the moment the department is measured on.</p>
                      <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                        I have taken them
                      </button>
                    </form>
                  ) : null}

                  <form action={medicolegalAction} className="bg-white border border-line rounded p-3 self-start">
                    <input type="hidden" name="attendanceId" value={open.id} />
                    <p className="text-sm font-semibold mb-1">Open a police case</p>
                    <p className="text-xs text-muted mb-3">Kept apart from the notes, because the P3 goes to the police and the notes do not.</p>
                    <label className="block"><span className={LABEL}>Kind</span>
                      <select name="kind" className={FIELD}>
                        {[
                          ["assault", "Assault"], ["road_traffic", "Road traffic"], ["gunshot", "Gunshot"],
                          ["stabbing", "Stabbing"], ["burns", "Burns"], ["poisoning", "Poisoning"],
                          ["sexual_violence", "Sexual violence"], ["child_abuse", "Child protection"],
                          ["death_in_custody", "Death in custody"], ["other", "Other"],
                        ].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className="block mt-2"><span className={LABEL}>Police station</span><input name="policeStation" className={FIELD} /></label>
                    <label className="block mt-2"><span className={LABEL}>OB number</span><input name="obNumber" className={FIELD} /></label>
                    <button type="submit" className="mt-3 border border-line font-semibold rounded px-4 py-2 text-sm">
                      Open case
                    </button>
                  </form>

                  <form action={dispositionAction} className="bg-white border border-line rounded p-3 self-start">
                    <input type="hidden" name="attendanceId" value={open.id} />
                    <p className="text-sm font-semibold mb-1">Close the attendance</p>
                    <p className="text-xs text-muted mb-3">
                      Left without being seen is a real outcome, not a tidy-up. It is the number that says the
                      department is too slow.
                    </p>
                    <label className="block"><span className={LABEL}>Outcome</span>
                      <select name="disposition" className={FIELD}>
                        {[
                          ["discharged", "Discharged"], ["admitted", "Admitted"], ["theatre", "To theatre"],
                          ["referred", "Referred out"], ["died", "Died"], ["dead_on_arrival", "Dead on arrival"],
                          ["left_without_being_seen", "Left without being seen"], ["absconded", "Absconded"],
                        ].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className="block mt-2"><span className={LABEL}>Admission id, if admitted</span><input name="admissionId" className={FIELD} /></label>
                    <label className="block mt-2"><span className={LABEL}>Note</span><input name="note" className={FIELD} /></label>
                    <button type="submit" className="mt-3 border border-line font-semibold rounded px-4 py-2 text-sm">
                      Close
                    </button>
                  </form>
                </div>
              ) : null}
            </Section>
          ) : null}

          {/* ------------------------------------------------------ arrivals */}
          {triageable ? (
            <Section
              title="Somebody has arrived"
              note="Nothing here asks about payment, a deposit or a scheme. Article 43(2) of the Constitution: a person shall not be denied emergency medical treatment."
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <form method="get" className="mb-3 flex gap-2">
                    <input name="q" defaultValue={params.q ?? ""} placeholder="Find them by name or file number" className={`${FIELD} max-w-sm`} />
                    <button type="submit" className="border border-line font-semibold rounded px-4 py-2 text-sm">Search</button>
                  </form>
                  {candidates.length > 0 ? (
                    <div className="space-y-2">
                      {candidates.map((c) => (
                        <form action={arriveAction} key={c.mrn} className="bg-white border border-line rounded p-3">
                          <input type="hidden" name="mrn" value={c.mrn} />
                          <p className="text-sm font-semibold mb-2">
                            {c.given_name} {c.family_name} <span className="font-mono text-xs text-muted ml-2">{c.mrn}</span>
                          </p>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <label><span className={LABEL}>How they came</span>
                              <select name="arrivalMode" className={FIELD}>
                                {[["walk_in", "Walked in"], ["ambulance", "Ambulance"], ["police", "Police"],
                                  ["referred", "Referred"], ["carried", "Carried"], ["other", "Other"]].map(([v, l]) => (
                                  <option key={v} value={v}>{l}</option>
                                ))}
                              </select>
                            </label>
                            <label><span className={LABEL}>Presenting complaint</span><input name="presenting" className={FIELD} /></label>
                            <label><span className={LABEL}>Incident, if any</span>
                              <select name="incidentRef" className={FIELD} defaultValue="">
                                <option value="">None</option>
                                {live.map((i) => <option key={i.reference} value={i.reference}>{i.reference}</option>)}
                              </select>
                            </label>
                          </div>
                          <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                            Arrived
                          </button>
                        </form>
                      ))}
                    </div>
                  ) : params.q ? (
                    <Empty>Nobody matches that. Use the form beside this one if they cannot tell you who they are.</Empty>
                  ) : null}
                </div>

                <form action={arriveUnknownAction} className="bg-white border border-line rounded p-3 self-start">
                  <p className="text-sm font-semibold mb-1">They cannot say who they are</p>
                  <p className="text-xs text-muted mb-3">
                    Opens a real record under a deliberately provisional name, so blood, imaging and drugs can be
                    ordered against something. Identifying them later is a merge, and loses nothing.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label><span className={LABEL}>Apparent sex</span>
                      <select name="sex" className={FIELD}>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                    </label>
                    <label><span className={LABEL}>Estimated age</span><input name="estimatedAge" inputMode="numeric" className={FIELD} /></label>
                    <label><span className={LABEL}>How they came</span>
                      <select name="arrivalMode" className={FIELD} defaultValue="ambulance">
                        {[["ambulance", "Ambulance"], ["police", "Police"], ["carried", "Carried"],
                          ["walk_in", "Walked in"], ["other", "Other"]].map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </label>
                    <label><span className={LABEL}>Incident, if any</span>
                      <select name="incidentRef" className={FIELD} defaultValue="">
                        <option value="">None</option>
                        {live.map((i) => <option key={i.reference} value={i.reference}>{i.reference}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="block mt-2"><span className={LABEL}>What is wrong</span><input name="presenting" className={FIELD} /></label>
                  <button type="submit" className="mt-3 border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
                    Open an unidentified record
                  </button>
                </form>
              </div>
            </Section>
          ) : null}
        </>
      ) : null}

      {/* ================================================= mass casualty */}
      {view === "incidents" ? (
        <>
          <Section
            title="Incidents"
            note="One reference, many patients. How many came from the crash and where they are now is one question, not a memory of which names were involved."
          >
            {incidents.length === 0 ? (
              <Empty>No incident has been declared.</Empty>
            ) : (
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Reference</th>
                    <th className="px-3 py-2 font-medium">What happened</th>
                    <th className="px-3 py-2 font-medium">Declared</th>
                    <th className="px-3 py-2 font-medium text-right">Casualties</th>
                    <th className="px-3 py-2 font-medium">State</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((i) => {
                    const count = incidentBoard(i.reference).length;
                    return (
                      <tr key={i.reference} className={`border-t border-line ${!i.stood_down_at ? "bg-block-soft" : ""}`}>
                        <td className="px-3 py-2 font-mono text-xs font-bold">{i.reference}</td>
                        <td className="px-3 py-2">
                          {i.kind}
                          {i.description ? <span className="text-xs text-muted ml-2">{i.description}</span> : null}
                        </td>
                        <td className="px-3 py-2 tnum text-muted">{i.declared_at.slice(0, 16).replace("T", " ")}</td>
                        <td className="px-3 py-2 text-right tnum font-bold">{count}</td>
                        <td className="px-3 py-2 text-xs">
                          {i.stood_down_at ? (
                            <span className="text-muted">Stood down {i.stood_down_at.slice(11, 16)}</span>
                          ) : (
                            <span className="text-block font-bold uppercase tracking-wide">Live</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link href={`/casualty?view=incidents&i=${i.reference}`} className="text-brand underline underline-offset-2 text-xs">
                            Open
                          </Link>
                          {!i.stood_down_at && triageable ? (
                            <form action={standDownAction} className="inline ml-2">
                              <input type="hidden" name="reference" value={i.reference} />
                              <button type="submit" className="text-muted underline underline-offset-2 text-xs">Stand down</button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>

          {incident ? (
            <Section title={`${incident.reference} — ${incident.kind}`} note={incident.description}>
              {casualties.length === 0 ? (
                <Empty>Nobody has been logged against this incident yet.</Empty>
              ) : (
                <table className="w-full text-sm bg-white border border-line rounded">
                  <thead>
                    <tr className="text-xs text-muted text-left">
                      <th className="px-3 py-2 font-medium">Triage</th>
                      <th className="px-3 py-2 font-medium">Patient</th>
                      <th className="px-3 py-2 font-medium">Arrived</th>
                      <th className="px-3 py-2 font-medium">Where they are now</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {casualties.map((c) => (
                      <tr key={c.id} className={`border-t border-line ${c.triage ? ROW[c.triage] : ""}`}>
                        <td className="px-3 py-2">
                          {c.triage ? (
                            <span className={`text-[10px] font-bold uppercase tracking-wide rounded px-2 py-1 ${CHIP[c.triage]}`}>
                              {TRIAGE_LABEL[c.triage]}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold uppercase tracking-wide text-block">Not triaged</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {c.patient_name}
                          {c.unidentified ? (
                            <span className="text-[10px] font-bold text-clock ml-2 uppercase tracking-wide">no name</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 tnum text-muted">{c.arrived_at.slice(11, 16)}</td>
                        <td className="px-3 py-2 text-xs capitalize">
                          {c.disposition ? c.disposition.replace(/_/g, " ") : <span className="text-muted">still in casualty</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link href={`/casualty?a=${c.id}`} className="text-brand underline underline-offset-2 text-xs">Open</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          ) : null}

          {triageable ? (
            <Section title="Declare an incident" note="A reference everybody can say out loud, because it will be said out loud.">
              <form action={declareAction} className="bg-white border border-line rounded p-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <label><span className={LABEL}>Reference</span><input name="reference" placeholder="MCI-THIKA-01" className={FIELD} /></label>
                  <label><span className={LABEL}>What happened</span><input name="kind" placeholder="Road traffic collision" className={FIELD} /></label>
                  <label><span className={LABEL}>Detail</span><input name="description" className={FIELD} /></label>
                </div>
                <button type="submit" className="mt-3 bg-block text-white font-semibold rounded px-4 py-2 text-sm">
                  Declare
                </button>
              </form>
            </Section>
          ) : null}
        </>
      ) : null}

      {/* ========================================================== log */}
      {view === "log" ? (
        <Section title="Casualty log" note="Every attendance, closed ones included. Newest first.">
          {log.length === 0 ? (
            <Empty>Nothing has come through casualty.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Arrived</th>
                    <th className="px-3 py-2 font-medium">Patient</th>
                    <th className="px-3 py-2 font-medium">Triage</th>
                    <th className="px-3 py-2 font-medium">Presenting</th>
                    <th className="px-3 py-2 font-medium text-right">Waited</th>
                    <th className="px-3 py-2 font-medium">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((a) => (
                    <tr key={a.id} className="border-t border-line">
                      <td className="px-3 py-2 tnum text-muted">{a.arrived_at.slice(0, 16).replace("T", " ")}</td>
                      <td className="px-3 py-2">
                        <Link href={`/casualty?a=${a.id}`} className="underline underline-offset-2">{a.patient_name}</Link>
                      </td>
                      <td className="px-3 py-2">
                        {a.triage ? (
                          <span className={`text-[10px] font-bold uppercase tracking-wide rounded px-2 py-1 ${CHIP[a.triage]}`}>
                            {TRIAGE_LABEL[a.triage]}
                          </span>
                        ) : (
                          <span className="text-xs text-block font-semibold">never triaged</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">{a.presenting || "—"}</td>
                      <td className="px-3 py-2 text-right tnum">
                        {clock(a.seen_at ? waitMinutes(a, a.seen_at) : a.disposition ? null : waitMinutes(a))}
                      </td>
                      <td className="px-3 py-2 text-xs capitalize">
                        {a.disposition ? (
                          <span className={a.disposition === "left_without_being_seen" ? "text-clock font-semibold" : ""}>
                            {a.disposition.replace(/_/g, " ")}
                          </span>
                        ) : (
                          <span className="text-muted">still here</span>
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
