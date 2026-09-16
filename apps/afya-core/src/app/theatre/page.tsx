import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  theatreList, inTheatre, caseLog, theatreSummary, listTheatres,
  getCase, checklistAnswers, checklistOutstanding, counts, countDiscrepancies,
  teamFor, consentFor, CHECKLIST, URGENCY_TARGET_HOURS,
  type Stage, type Urgency, type CaseStatus,
} from "@/lib/theatre.ts";
import { searchPatients } from "@/lib/patients.ts";
import { today } from "@/lib/db.ts";
import { Shell, Stat, Section, Empty, Views } from "@/app/_components/shell.tsx";
import {
  bookAction, consentAction, teamAction, answerAction, completeStageAction,
  countInAction, countOutAction, resolveCountAction, stepAction, closeAction, cancelAction,
} from "./actions.ts";

/**
 * Theatre.
 *
 * The checklist is the screen. It is laid out as three stages a team reads
 * aloud, with each item answered separately, because a checklist presented as
 * one "done" button is a checklist nobody reads.
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";
const LABEL = "block text-xs text-muted mb-1";

const URGENCY_CHIP: Record<Urgency, string> = {
  immediate: "bg-block text-white",
  urgent: "bg-clock text-white",
  expedited: "bg-clock-soft text-clock",
  elective: "bg-brand-soft text-brand-dark",
};

const STAGE_LABEL: Record<Stage, string> = {
  sign_in: "Sign in — before anaesthesia",
  time_out: "Time out — before incision",
  sign_out: "Sign out — before leaving theatre",
};

const STATUS_LABEL: Record<CaseStatus, string> = {
  booked: "Booked",
  sent_for: "Sent for",
  in_theatre: "In theatre",
  anaesthetised: "Anaesthetised",
  incised: "Operating",
  closed: "Closed",
  in_recovery: "In recovery",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default async function TheatrePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; c?: string; stage?: string; q?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "patient.read")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "list";
  const acting = can(user.userId, "encounter.conduct");

  const list = theatreList(user.facilityId);
  const running = inTheatre(user.facilityId);
  const log = caseLog(user.facilityId, 40);
  const summary = theatreSummary(user.facilityId);
  const theatres = listTheatres(user.facilityId);

  const open = params.c ? getCase(params.c) : undefined;
  const stage = (params.stage ?? "sign_in") as Stage;
  const openRow = open ? [...list, ...log].find((r) => r.theatreCase.id === open.id) : undefined;
  const openCounts = open ? counts(open.id) : [];
  const openDiscrepancies = open ? countDiscrepancies(open.id) : [];
  const openTeam = open ? teamFor(open.id) : [];
  const answers = open ? new Map(checklistAnswers(open.id, stage).map((a) => [a.item_code, a])) : new Map();
  const outstanding = open ? checklistOutstanding(open.id, stage) : [];

  const candidates = params.q?.trim()
    ? searchPatients({ facilityId: user.facilityId, query: params.q, limit: 6 })
    : [];

  const href = (v: string) => (v === "list" ? "/theatre" : `/theatre?view=${v}`);
  const rows = view === "running" ? running : list;

  return (
    <Shell
      user={user}
      current={href(view)}
      error={params.error}
      title={view === "running" ? "In theatre now" : view === "log" ? "Theatre log" : "Today's list"}
      subtitle={
        view === "list"
          ? "Most urgent first. Anaesthesia waits for the sign-in, the knife waits for the time-out, and nobody leaves theatre on an unreconciled count."
          : undefined
      }
    >
      <Views
        current={view}
        views={[
          { key: "list", label: "Today's list", href: "/theatre" },
          { key: "running", label: "In theatre", href: "/theatre?view=running" },
          { key: "log", label: "Log", href: "/theatre?view=log" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="On the list" value={list.length} note={`${running.length} in theatre now`} />
        <Stat
          label="Checklist complete"
          value={summary.checklistCompliantPercent === null ? "—" : `${summary.checklistCompliantPercent}%`}
          tone={
            summary.checklistCompliantPercent === null ? "muted"
            : summary.checklistCompliantPercent >= 95 ? "good"
            : summary.checklistCompliantPercent >= 80 ? "clock" : "block"
          }
          note={`all three stages · ${summary.criticalNoes} critical "no"`}
        />
        <Stat
          label="Cancelled"
          value={summary.cancellationRatePercent === null ? "—" : `${summary.cancellationRatePercent}%`}
          tone={summary.cancelledOnTheDay > 0 ? "clock" : "good"}
          note={`${summary.cancelledOnTheDay} on the day`}
        />
        <Stat
          label="Count mismatches"
          value={summary.countMismatches}
          tone={summary.countMismatches > 0 ? "block" : "good"}
          note={`${summary.deviations} procedure deviations`}
        />
      </div>

      {/* ============================================ the list / in theatre */}
      {view === "list" || view === "running" ? (
        <>
          <Section
            title={view === "running" ? "On the table" : "Today's list"}
            note={
              view === "list"
                ? `Immediate within ${URGENCY_TARGET_HOURS.immediate} hour · urgent ${URGENCY_TARGET_HOURS.urgent} hours · expedited ${Math.round((URGENCY_TARGET_HOURS.expedited ?? 0) / 24)} days`
                : undefined
            }
          >
            {rows.length === 0 ? (
              <Empty>{view === "running" ? "No case is in a theatre." : "Nothing on today's list."}</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm bg-white border border-line rounded">
                  <thead>
                    <tr className="text-xs text-muted text-left">
                      <th className="px-3 py-2 font-medium">Urgency</th>
                      <th className="px-3 py-2 font-medium">Patient</th>
                      <th className="px-3 py-2 font-medium">Procedure</th>
                      <th className="px-3 py-2 font-medium">Theatre</th>
                      <th className="px-3 py-2 font-medium">Checklist</th>
                      <th className="px-3 py-2 font-medium">State</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.theatreCase.id}
                        className={`border-t border-line ${r.blockedBy ? "bg-clock-soft" : ""} ${
                          r.theatreCase.id === open?.id ? "bg-brand-soft" : ""
                        }`}
                      >
                        <td className="px-3 py-2">
                          <span className={`text-[10px] font-bold uppercase tracking-wide rounded px-2 py-1 ${URGENCY_CHIP[r.theatreCase.urgency]}`}>
                            {r.theatreCase.urgency}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <Link href={`/patients/${encodeURIComponent(r.theatreCase.patient_mrn)}`} className="underline underline-offset-2">
                            {r.patientName}
                          </Link>
                          {r.theatreCase.asa_grade ? (
                            <span className="text-[10px] text-muted ml-2 tnum">ASA {r.theatreCase.asa_grade}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          {r.theatreCase.procedure_planned}
                          {r.theatreCase.laterality && r.theatreCase.laterality !== "not_applicable" ? (
                            <span className="text-[10px] font-bold uppercase text-block ml-2">{r.theatreCase.laterality}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-muted text-xs">{r.theatreName ?? "—"}</td>
                        <td className="px-3 py-2">
                          <span className="flex gap-1">
                            {(["sign_in", "time_out", "sign_out"] as Stage[]).map((s) => {
                              const done = s === "sign_in" ? r.signInDone : s === "time_out" ? r.timeOutDone : r.signOutDone;
                              return (
                                <span
                                  key={s}
                                  title={STAGE_LABEL[s]}
                                  className={`text-[9px] font-bold uppercase rounded px-1.5 py-0.5 ${
                                    done ? "bg-good-soft text-good" : "bg-wash text-muted"
                                  }`}
                                >
                                  {s === "sign_in" ? "IN" : s === "time_out" ? "TO" : "OUT"}
                                </span>
                              );
                            })}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {r.blockedBy ? (
                            <span className="text-clock font-semibold">{r.blockedBy}</span>
                          ) : (
                            <span className="text-muted">{STATUS_LABEL[r.theatreCase.status]}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link href={`/theatre?c=${r.theatreCase.id}`} className="text-brand underline underline-offset-2 text-xs">
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

          {/* ------------------------------------------- one case, in detail */}
          {open && openRow ? (
            <Section
              title={`${openRow.patientName} — ${open.procedure_planned}`}
              note={`${STATUS_LABEL[open.status]}${openRow.blockedBy ? ` · waiting on: ${openRow.blockedBy}` : ""}${
                open.surgeon_name ? ` · ${open.surgeon_name}` : ""
              }`}
            >
              {/* consent */}
              {!openRow.consented ? (
                acting ? (
                  <form action={consentAction} className="bg-white border border-block rounded p-3 mb-4">
                    <input type="hidden" name="caseId" value={open.id} />
                    <p className="text-sm font-semibold mb-1 text-block">No recorded surgical consent</p>
                    <p className="text-xs text-muted mb-3">
                      Anaesthesia does not start without it. The signature covers the procedure and the risks
                      together, so a later change to either no longer matches.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label><span className={LABEL}>Procedure consented to</span>
                        <input name="consentedProcedure" defaultValue={open.procedure_planned} className={FIELD} />
                      </label>
                      <label><span className={LABEL}>Risks discussed</span><input name="risksDiscussed" className={FIELD} /></label>
                    </div>
                    <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                      Record consent
                    </button>
                  </form>
                ) : (
                  <p className="text-sm text-block font-semibold mb-4">No recorded surgical consent.</p>
                )
              ) : null}

              {/* ---- the checklist ---- */}
              <div className="flex gap-2 mb-3">
                {(["sign_in", "time_out", "sign_out"] as Stage[]).map((s) => {
                  const done = s === "sign_in" ? openRow.signInDone : s === "time_out" ? openRow.timeOutDone : openRow.signOutDone;
                  return (
                    <Link
                      key={s}
                      href={`/theatre?c=${open.id}&stage=${s}`}
                      className={`rounded px-3 py-2 text-xs font-semibold border ${
                        s === stage ? "bg-brand text-white border-brand" : "border-line"
                      }`}
                    >
                      {STAGE_LABEL[s]}
                      {done ? <span className="ml-2 text-[10px]">✓</span> : null}
                    </Link>
                  );
                })}
              </div>

              <div className="bg-white border border-line rounded mb-4">
                {CHECKLIST[stage].map((item) => {
                  const answer = answers.get(item.code);
                  return (
                    <div key={item.code} className="border-t border-line first:border-0 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="flex-1 text-sm">
                          {item.text}
                          {item.critical ? (
                            <span className="text-[9px] font-bold uppercase text-block ml-2 tracking-wide">critical</span>
                          ) : null}
                        </span>
                        {answer ? (
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wide rounded px-2 py-1 ${
                              answer.answer === "yes" ? "bg-good-soft text-good"
                              : answer.answer === "no" ? "bg-block text-white"
                              : "bg-wash text-muted"
                            }`}
                          >
                            {answer.answer === "not_applicable" ? "n/a" : answer.answer}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-clock">unanswered</span>
                        )}
                        {acting && open.status !== "cancelled" ? (
                          <span className="flex gap-1">
                            {(["yes", "no", "not_applicable"] as const).map((a) => (
                              <form action={answerAction} key={a}>
                                <input type="hidden" name="caseId" value={open.id} />
                                <input type="hidden" name="stage" value={stage} />
                                <input type="hidden" name="itemCode" value={item.code} />
                                <input type="hidden" name="answer" value={a} />
                                <button
                                  type="submit"
                                  className="border border-line rounded px-2 py-1 text-[10px] font-semibold uppercase hover:bg-wash"
                                >
                                  {a === "not_applicable" ? "n/a" : a}
                                </button>
                              </form>
                            ))}
                          </span>
                        ) : null}
                      </div>
                      {answer?.note ? <p className="text-xs text-muted mt-1">{answer.note}</p> : null}
                    </div>
                  );
                })}
              </div>

              {acting && outstanding.length === 0 && open.status !== "cancelled" ? (
                <form action={completeStageAction} className="mb-4">
                  <input type="hidden" name="caseId" value={open.id} />
                  <input type="hidden" name="stage" value={stage} />
                  <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                    Complete the {stage.replace("_", " ")}
                  </button>
                  {stage === "sign_out" && openDiscrepancies.length > 0 ? (
                    <span className="text-xs text-block font-semibold ml-3">
                      The count does not reconcile — this will be refused until it is resolved.
                    </span>
                  ) : null}
                </form>
              ) : outstanding.length > 0 ? (
                <p className="text-xs text-clock font-semibold mb-4">
                  {outstanding.length} item{outstanding.length === 1 ? "" : "s"} unanswered. "Not applicable" is an
                  answer; silence is not.
                </p>
              ) : null}

              {/* ---- the count ---- */}
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="bg-white border border-line rounded p-3">
                  <p className="text-sm font-semibold mb-1">The count</p>
                  <p className="text-xs text-muted mb-3">
                    Counted in and counted out. A mismatch blocks the sign-out and is cleared by recording how it
                    was resolved — never by editing the numbers.
                  </p>
                  {openCounts.length > 0 ? (
                    <table className="w-full text-sm mb-3">
                      <thead>
                        <tr className="text-xs text-muted text-left">
                          <th className="py-1 font-medium">Item</th>
                          <th className="py-1 font-medium text-right">In</th>
                          <th className="py-1 font-medium text-right">Out</th>
                          <th className="py-1 font-medium">Resolution</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openCounts.map((c) => {
                          const bad = c.counted_out !== c.counted_in && !c.resolution;
                          return (
                            <tr key={c.item} className={`border-t border-line ${bad ? "bg-block-soft" : ""}`}>
                              <td className="py-1.5">{c.item}</td>
                              <td className="py-1.5 text-right tnum">{c.counted_in}</td>
                              <td className={`py-1.5 text-right tnum ${bad ? "text-block font-bold" : ""}`}>
                                {c.counted_out ?? "—"}
                              </td>
                              <td className="py-1.5 text-xs text-muted">{c.resolution || (bad ? "unresolved" : "")}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-xs text-muted mb-3">Nothing counted yet.</p>
                  )}

                  {acting ? (
                    <div className="space-y-2">
                      <form action={countInAction} className="flex gap-2 items-end">
                        <input type="hidden" name="caseId" value={open.id} />
                        <label className="flex-1"><span className={LABEL}>Item</span>
                          <input name="item" placeholder="Swabs" className={FIELD} />
                        </label>
                        <label className="w-20"><span className={LABEL}>In</span><input name="count" inputMode="numeric" className={FIELD} /></label>
                        <button type="submit" className="border border-line font-semibold rounded px-3 py-2 text-sm">Count in</button>
                      </form>
                      <form action={countOutAction} className="flex gap-2 items-end">
                        <input type="hidden" name="caseId" value={open.id} />
                        <label className="flex-1"><span className={LABEL}>Item</span>
                          <select name="item" className={FIELD}>
                            {openCounts.map((c) => <option key={c.item} value={c.item}>{c.item}</option>)}
                          </select>
                        </label>
                        <label className="w-20"><span className={LABEL}>Out</span><input name="count" inputMode="numeric" className={FIELD} /></label>
                        <button type="submit" className="border border-line font-semibold rounded px-3 py-2 text-sm">Count out</button>
                      </form>
                      {openDiscrepancies.length > 0 ? (
                        <form action={resolveCountAction} className="flex gap-2 items-end pt-2 border-t border-line">
                          <input type="hidden" name="caseId" value={open.id} />
                          <label className="w-28"><span className={LABEL}>Item</span>
                            <select name="item" className={FIELD}>
                              {openDiscrepancies.map((c) => <option key={c.item} value={c.item}>{c.item}</option>)}
                            </select>
                          </label>
                          <label className="flex-1"><span className={LABEL}>How it was resolved</span>
                            <input name="resolution" placeholder="Found under the drape after a full search" className={FIELD} />
                          </label>
                          <button type="submit" className="bg-block text-white font-semibold rounded px-3 py-2 text-sm">Resolve</button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {/* ---- the case itself ---- */}
                <div>
                  {openTeam.length > 0 ? (
                    <div className="bg-white border border-line rounded p-3 mb-3">
                      <p className="text-sm font-semibold mb-2">In the room</p>
                      {openTeam.map((m, i) => (
                        <div key={i} className="flex gap-3 text-sm py-0.5">
                          <span className="text-xs text-muted w-36">{m.role}</span>
                          <span>{m.person_name}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {acting && !["completed", "cancelled"].includes(open.status) ? (
                    <div className="bg-white border border-line rounded p-3 mb-3">
                      <p className="text-sm font-semibold mb-2">Add to the room</p>
                      <form action={teamAction} className="flex gap-2 items-end">
                        <input type="hidden" name="caseId" value={open.id} />
                        <label className="w-36"><span className={LABEL}>Role</span><input name="role" placeholder="Scrub nurse" className={FIELD} /></label>
                        <label className="flex-1"><span className={LABEL}>Name</span><input name="personName" className={FIELD} /></label>
                        <button type="submit" className="border border-line font-semibold rounded px-3 py-2 text-sm">Add</button>
                      </form>
                    </div>
                  ) : null}

                  {acting && !["completed", "cancelled"].includes(open.status) ? (
                    <div className="bg-white border border-line rounded p-3 mb-3">
                      <p className="text-sm font-semibold mb-2">Move the case on</p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          ["send_for", "Send for", open.status === "booked"],
                          ["arrive", "Arrived in theatre", open.status === "booked" || open.status === "sent_for"],
                          ["incise", "Incision", open.status === "anaesthetised"],
                          ["leave", "Leave theatre", open.status === "closed"],
                          ["complete", "Complete", open.status === "in_recovery"],
                        ].map(([step, label, show]) =>
                          show ? (
                            <form action={stepAction} key={step as string}>
                              <input type="hidden" name="caseId" value={open.id} />
                              <input type="hidden" name="step" value={step as string} />
                              <button type="submit" className="border border-brand text-brand font-semibold rounded px-3 py-2 text-sm">
                                {label as string}
                              </button>
                            </form>
                          ) : null,
                        )}
                      </div>

                      {open.status === "in_theatre" ? (
                        <form action={stepAction} className="mt-3 pt-3 border-t border-line flex gap-2 items-end">
                          <input type="hidden" name="caseId" value={open.id} />
                          <input type="hidden" name="step" value="anaesthetise" />
                          <label className="w-32"><span className={LABEL}>Anaesthesia</span>
                            <select name="anaesthesia" className={FIELD}>
                              {["general", "spinal", "regional", "local", "sedation"].map((a) => (
                                <option key={a} value={a}>{a}</option>
                              ))}
                            </select>
                          </label>
                          <label className="flex-1"><span className={LABEL}>Anaesthetist</span><input name="anaesthetistName" className={FIELD} /></label>
                          <button type="submit" className="bg-brand text-white font-semibold rounded px-3 py-2 text-sm">
                            Anaesthetise
                          </button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}

                  {acting && open.status === "incised" ? (
                    <form action={closeAction} className="bg-white border border-line rounded p-3 mb-3">
                      <input type="hidden" name="caseId" value={open.id} />
                      <p className="text-sm font-semibold mb-1">The operation note</p>
                      <p className="text-xs text-muted mb-3">
                        What was done is recorded separately from what was planned. If they differ, that is a
                        deviation from consent and is recorded as one — the plan is never edited to match.
                      </p>
                      <div className="grid gap-2">
                        <label><span className={LABEL}>Procedure performed</span>
                          <input name="procedurePerformed" defaultValue={open.procedure_planned} className={FIELD} />
                        </label>
                        <label><span className={LABEL}>Findings</span><input name="findings" className={FIELD} /></label>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <label><span className={LABEL}>Blood loss (ml)</span><input name="bloodLossMl" inputMode="numeric" className={FIELD} /></label>
                          <label><span className={LABEL}>Specimen</span><input name="specimen" className={FIELD} /></label>
                          <label><span className={LABEL}>Implant</span><input name="implant" className={FIELD} /></label>
                        </div>
                        <label><span className={LABEL}>Complications</span><input name="complications" className={FIELD} /></label>
                      </div>
                      <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                        Close and sign the note
                      </button>
                    </form>
                  ) : null}

                  {open.procedure_performed ? (
                    <div className="bg-white border border-line rounded p-3 mb-3">
                      <p className="text-sm font-semibold mb-2">Operation note</p>
                      <dl className="text-sm space-y-1">
                        {[
                          ["Planned", open.procedure_planned],
                          ["Performed", open.procedure_performed],
                          ["Findings", open.findings],
                          ["Blood loss", open.blood_loss_ml === null ? "—" : `${open.blood_loss_ml} ml`],
                          ["Specimen", open.specimen || "—"],
                          ["Implant", open.implant || "—"],
                          ["Complications", open.complications || "none recorded"],
                        ].map(([label, value]) => (
                          <div key={label} className="grid grid-cols-[6rem_1fr] gap-2">
                            <dt className="text-xs text-muted pt-0.5">{label}</dt>
                            <dd
                              className={
                                label === "Performed" &&
                                open.procedure_performed.toLowerCase() !== open.procedure_planned.toLowerCase()
                                  ? "text-clock font-semibold"
                                  : ""
                              }
                            >
                              {value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ) : null}

                  {acting && !["completed", "cancelled"].includes(open.status) ? (
                    <form action={cancelAction} className="bg-white border border-line rounded p-3">
                      <input type="hidden" name="caseId" value={open.id} />
                      <p className="text-sm font-semibold mb-2">Cancel this case</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label><span className={LABEL}>Why, in one word</span>
                          <select name="category" className={FIELD}>
                            {[
                              ["no_theatre_time", "No theatre time"], ["no_surgeon", "No surgeon"],
                              ["no_anaesthetist", "No anaesthetist"], ["no_bed", "No bed"],
                              ["patient_unfit", "Patient unfit"], ["patient_did_not_attend", "Patient did not attend"],
                              ["no_blood", "No blood"], ["no_equipment", "No equipment"],
                              ["no_consent", "No consent"], ["other", "Other"],
                            ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </label>
                        <label><span className={LABEL}>And in full</span><input name="reason" className={FIELD} /></label>
                      </div>
                      <button type="submit" className="mt-3 border border-line text-muted font-semibold rounded px-4 py-2 text-sm">
                        Cancel the case
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            </Section>
          ) : null}

          {/* --------------------------------------------------- book a case */}
          {acting && view === "list" ? (
            <Section title="Book a case" note="The procedure named here is what the consent and the checklist are read against.">
              <form method="get" className="mb-3 flex gap-2">
                <input name="q" defaultValue={params.q ?? ""} placeholder="Find the patient" className={`${FIELD} max-w-sm`} />
                <button type="submit" className="border border-line font-semibold rounded px-4 py-2 text-sm">Search</button>
              </form>
              {candidates.length > 0 ? (
                <div className="space-y-2">
                  {candidates.map((c) => (
                    <form action={bookAction} key={c.mrn} className="bg-white border border-line rounded p-3">
                      <input type="hidden" name="mrn" value={c.mrn} />
                      <p className="text-sm font-semibold mb-2">
                        {c.given_name} {c.family_name} <span className="font-mono text-xs text-muted ml-2">{c.mrn}</span>
                      </p>
                      <div className="grid gap-3 sm:grid-cols-4">
                        <label className="sm:col-span-2"><span className={LABEL}>Procedure</span><input name="procedurePlanned" className={FIELD} /></label>
                        <label><span className={LABEL}>Side</span>
                          <select name="laterality" className={FIELD}>
                            <option value="not_applicable">Not applicable</option>
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                            <option value="bilateral">Bilateral</option>
                          </select>
                        </label>
                        <label><span className={LABEL}>Urgency</span>
                          <select name="urgency" className={FIELD} defaultValue="elective">
                            <option value="immediate">Immediate</option>
                            <option value="urgent">Urgent</option>
                            <option value="expedited">Expedited</option>
                            <option value="elective">Elective</option>
                          </select>
                        </label>
                        <label><span className={LABEL}>Theatre</span>
                          <select name="theatreCode" className={FIELD}>
                            {theatres.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                          </select>
                        </label>
                        <label><span className={LABEL}>Scheduled for</span><input type="datetime-local" name="scheduledFor" className={FIELD} /></label>
                        <label><span className={LABEL}>Minutes</span><input name="estimatedMinutes" inputMode="numeric" className={FIELD} /></label>
                        <label><span className={LABEL}>ASA grade</span><input name="asaGrade" inputMode="numeric" className={FIELD} /></label>
                      </div>
                      <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">Book</button>
                    </form>
                  ))}
                </div>
              ) : params.q ? (
                <Empty>No patient matches that.</Empty>
              ) : null}
            </Section>
          ) : null}
        </>
      ) : null}

      {/* ========================================================== log */}
      {view === "log" ? (
        <Section title="Theatre log" note="Every case, cancelled ones included.">
          {log.length === 0 ? (
            <Empty>No case has been booked.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Patient</th>
                    <th className="px-3 py-2 font-medium">Planned</th>
                    <th className="px-3 py-2 font-medium">Performed</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Why cancelled</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((r) => {
                    const c = r.theatreCase;
                    const deviated = c.procedure_performed && c.procedure_performed.toLowerCase() !== c.procedure_planned.toLowerCase();
                    return (
                      <tr key={c.id} className={`border-t border-line ${c.status === "cancelled" ? "opacity-70" : ""}`}>
                        <td className="px-3 py-2 tnum text-muted">{(c.scheduled_for ?? c.created_at).slice(0, 10)}</td>
                        <td className="px-3 py-2">
                          <Link href={`/theatre?c=${c.id}`} className="underline underline-offset-2">{r.patientName}</Link>
                        </td>
                        <td className="px-3 py-2">{c.procedure_planned}</td>
                        <td className={`px-3 py-2 ${deviated ? "text-clock font-semibold" : ""}`}>
                          {c.procedure_performed || "—"}
                          {deviated ? <span className="text-[10px] uppercase ml-2">deviation</span> : null}
                        </td>
                        <td className="px-3 py-2 text-xs">{STATUS_LABEL[c.status]}</td>
                        <td className="px-3 py-2 text-xs text-muted">
                          {c.cancel_category ? (
                            <>
                              <span className="font-semibold capitalize">{c.cancel_category.replace(/_/g, " ")}</span>
                              {c.cancel_reason ? ` — ${c.cancel_reason}` : ""}
                            </>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      ) : null}
    </Shell>
  );
}
