import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  imagingWorklist, uncommunicatedCritical, imagingLog, radiologySummary,
  getStudy, reportsFor, safetyChecks, safetyState, cumulativeDose,
  needsPregnancyCheck, IONISING, MODALITY_LABEL, MRI_SCREENING, TYPICAL_DOSE_USV,
  CHILDBEARING_AGE, type Modality,
} from "@/lib/radiology.ts";
import { pendingOrders } from "@/lib/orders.ts";
import { resolvePatient } from "@/lib/patients.ts";
import { Shell, Stat, Section, Empty, Views } from "@/app/_components/shell.tsx";
import {
  openStudyAction, justifyAction, safetyAction, performAction,
  reportAction, communicateAction, cancelStudyAction,
} from "./actions.ts";

/**
 * Radiology.
 *
 * The screen is organised around what stands between a study and the scanner,
 * because that is the only question the department asks of a worklist. A study
 * that cannot be exposed says so on the row, in the words a radiographer uses.
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";
const LABEL = "block text-xs text-muted mb-1";

const PRIORITY_CHIP: Record<string, string> = {
  stat: "bg-block text-white",
  urgent: "bg-clock text-white",
  routine: "bg-brand-soft text-brand-dark",
};

/** Microsieverts read the way a department says them. */
function dose(usv: number | null): string {
  if (usv === null) return "—";
  if (usv >= 1000) return `${(usv / 1000).toFixed(2)} mSv`;
  return `${usv} µSv`;
}

export default async function RadiologyPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; s?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "patient.read")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "worklist";
  const acting = can(user.userId, "encounter.conduct");

  const worklist = imagingWorklist();
  const critical = uncommunicatedCritical();
  const log = imagingLog(40);
  const summary = radiologySummary();
  // Imaging orders with no study opened on them yet.
  const started = new Set(log.map((r) => r.study.order_id));
  const unstarted = pendingOrders("imaging").filter((o) => !started.has(o.id));

  const open = params.s ? getStudy(params.s) : undefined;
  const openRow = open ? [...worklist, ...log].find((r) => r.study.id === open.id) : undefined;
  const openPatient = open ? resolvePatient(open.patient_mrn) : undefined;
  const openReports = open ? reportsFor(open.id) : [];
  const openSafety = open ? new Map(safetyChecks(open.id).map((a) => [a.item_code, a])) : new Map();
  const openState = open?.modality === "mri" ? safetyState(open.id) : null;
  const openDose = open ? cumulativeDose(open.patient_mrn) : null;
  const needsCheck = open ? needsPregnancyCheck(open.patient_mrn, open.modality) : false;

  const href = (v: string) => (v === "worklist" ? "/radiology" : `/radiology?view=${v}`);
  const rows = view === "critical" ? critical : worklist;

  return (
    <Shell
      user={user}
      current={href(view)}
      error={params.error}
      title={view === "critical" ? "Critical findings" : view === "log" ? "Imaging log" : "Imaging worklist"}
      subtitle={
        view === "worklist"
          ? "Blocked studies first. Nothing ionising is exposed without a justification and, where it applies, the pregnancy question."
          : view === "critical"
            ? "Reported and not yet told to anybody by name. Filing a finding is not communicating it."
            : undefined
      }
    >
      <Views
        current={view}
        views={[
          { key: "worklist", label: "Worklist", href: "/radiology" },
          { key: "critical", label: "Critical findings", href: "/radiology?view=critical" },
          { key: "log", label: "Log", href: "/radiology?view=log" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat
          label="On the worklist"
          value={worklist.length}
          tone={summary.blocked > 0 ? "clock" : "good"}
          note={`${summary.blocked} cannot be exposed yet`}
        />
        <Stat
          label="Critical, not told"
          value={summary.criticalUncommunicated}
          tone={summary.criticalUncommunicated > 0 ? "block" : "good"}
          note={`${summary.criticalFindings} critical findings in all`}
        />
        <Stat
          label="Repeat rate"
          value={summary.repeatRatePercent === null ? "—" : `${summary.repeatRatePercent}%`}
          tone={
            summary.repeatRatePercent === null ? "muted"
            : summary.repeatRatePercent <= 5 ? "good"
            : summary.repeatRatePercent <= 10 ? "clock" : "block"
          }
          note={`${summary.repeats} repeats — each one a second dose`}
        />
        <Stat
          label="Dose delivered"
          value={`${summary.totalDoseMsv} mSv`}
          tone="muted"
          note={
            summary.estimatedSharePercent === null
              ? "no ionising studies yet"
              : `${summary.estimatedSharePercent}% of it estimated, not measured`
          }
        />
      </div>

      {/* ================================================= the worklist */}
      {view === "worklist" || view === "critical" ? (
        <>
          <Section
            title={view === "critical" ? "Waiting to be told to somebody" : "Studies"}
            note={
              view === "worklist"
                ? `The pregnancy question is asked of a female patient between ${CHILDBEARING_AGE.from} and ${CHILDBEARING_AGE.to}, for ionising studies only.`
                : undefined
            }
          >
            {rows.length === 0 ? (
              <Empty>
                {view === "critical" ? "Every critical finding has been told to somebody." : "Nothing on the worklist."}
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm bg-white border border-line rounded">
                  <thead>
                    <tr className="text-xs text-muted text-left">
                      <th className="px-3 py-2 font-medium">Priority</th>
                      <th className="px-3 py-2 font-medium">Accession</th>
                      <th className="px-3 py-2 font-medium">Patient</th>
                      <th className="px-3 py-2 font-medium">Study</th>
                      <th className="px-3 py-2 font-medium">Question</th>
                      <th className="px-3 py-2 font-medium">State</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.study.id}
                        className={`border-t border-line ${
                          r.criticalUncommunicated ? "bg-block-soft" : r.blockedBy ? "bg-clock-soft" : ""
                        } ${r.study.id === open?.id ? "bg-brand-soft" : ""}`}
                      >
                        <td className="px-3 py-2">
                          <span className={`text-[10px] font-bold uppercase tracking-wide rounded px-2 py-1 ${PRIORITY_CHIP[r.priority] ?? ""}`}>
                            {r.priority}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{r.study.accession}</td>
                        <td className="px-3 py-2">
                          <Link href={`/patients/${encodeURIComponent(r.study.patient_mrn)}`} className="underline underline-offset-2">
                            {r.patientName}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          {MODALITY_LABEL[r.study.modality]} {r.study.body_part}
                          {r.study.laterality && r.study.laterality !== "not_applicable" ? (
                            <span className="text-[10px] font-bold uppercase text-block ml-2">{r.study.laterality}</span>
                          ) : null}
                          {r.study.repeat_of ? (
                            <span className="text-[10px] font-bold uppercase text-clock ml-2">repeat</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted">{r.clinicalQuestion || "—"}</td>
                        <td className="px-3 py-2 text-xs">
                          {r.criticalUncommunicated ? (
                            <span className="text-block font-bold">Critical, not told</span>
                          ) : r.blockedBy ? (
                            <span className="text-clock font-semibold">{r.blockedBy}</span>
                          ) : (
                            <span className="text-muted capitalize">{r.study.status}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link href={`/radiology?view=${view}&s=${r.study.id}`} className="text-brand underline underline-offset-2 text-xs">
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

          {/* ------------------------------------------ one study in detail */}
          {open && openRow && openPatient ? (
            <Section
              title={`${open.accession} — ${MODALITY_LABEL[open.modality]} ${open.body_part}`}
              note={`${openPatient.given_name} ${openPatient.family_name} · ${open.status}${
                openRow.blockedBy ? ` · ${openRow.blockedBy}` : ""
              }${IONISING[open.modality] ? "" : " · no ionising radiation"}`}
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  {/* justification */}
                  {!open.justification ? (
                    acting ? (
                      <form action={justifyAction} className="bg-white border border-block rounded p-3 mb-4">
                        <input type="hidden" name="studyId" value={open.id} />
                        <p className="text-sm font-semibold text-block mb-1">Not justified</p>
                        <p className="text-xs text-muted mb-3">
                          Nothing is exposed before somebody has put their name to why. A justification written
                          after the film is a different thing with the same name.
                        </p>
                        <label className="block"><span className={LABEL}>Why this exposure is justified</span>
                          <input name="justification" className={FIELD} />
                        </label>
                        {needsCheck ? (
                          <div className="mt-3 pt-3 border-t border-line">
                            <p className="text-xs font-semibold mb-2">
                              This patient needs the pregnancy question answered. It does not block the study —
                              a necessary film in a shocked patient is still the right film.
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <label><span className={LABEL}>Answer</span>
                                <select name="pregnancyCheck" className={FIELD}>
                                  {[
                                    ["not_pregnant", "Not pregnant"], ["possible", "Possibly pregnant"],
                                    ["pregnant", "Pregnant"], ["declined", "Declined to answer"],
                                    ["not_applicable", "Not applicable"],
                                  ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>
                              </label>
                              <label><span className={LABEL}>Note</span><input name="pregnancyNote" className={FIELD} /></label>
                            </div>
                          </div>
                        ) : null}
                        <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                          Justify
                        </button>
                      </form>
                    ) : (
                      <p className="text-sm text-block font-semibold mb-4">This study has not been justified.</p>
                    )
                  ) : (
                    <div className="bg-white border border-line rounded p-3 mb-4">
                      <p className="text-sm font-semibold mb-2">Justification</p>
                      <p className="text-sm">{open.justification}</p>
                      <p className="text-xs text-muted mt-1">{open.justifier_name}</p>
                      {open.pregnancy_check ? (
                        <p
                          className={`text-xs mt-2 ${
                            open.pregnancy_check === "possible" || open.pregnancy_check === "pregnant"
                              ? "text-block font-semibold"
                              : "text-muted"
                          }`}
                        >
                          Pregnancy: {open.pregnancy_check.replace(/_/g, " ")}
                          {open.pregnancy_note ? ` — ${open.pregnancy_note}` : ""}
                        </p>
                      ) : null}
                    </div>
                  )}

                  {/* MRI screening */}
                  {open.modality === "mri" && openState ? (
                    <div className="bg-white border border-line rounded p-3 mb-4">
                      <p className="text-sm font-semibold mb-1">MRI safety screening</p>
                      <p className="text-xs text-muted mb-3">
                        The one place this system refuses outright. A pacemaker in a magnet is not a risk to be
                        weighed at the console.
                      </p>
                      {MRI_SCREENING.map((item) => {
                        const answer = openSafety.get(item.code);
                        const blocks = item.blocking && (answer?.answer === "yes" || answer?.answer === "unknown");
                        return (
                          <div key={item.code} className={`border-t border-line first:border-0 py-2 ${blocks ? "bg-block-soft -mx-3 px-3" : ""}`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="flex-1 text-sm">
                                {item.text}
                                {item.blocking ? (
                                  <span className="text-[9px] font-bold uppercase text-block ml-2 tracking-wide">stops the scan</span>
                                ) : null}
                              </span>
                              {answer ? (
                                <span
                                  className={`text-[10px] font-bold uppercase rounded px-2 py-1 ${
                                    blocks ? "bg-block text-white"
                                    : answer.answer === "no" ? "bg-good-soft text-good" : "bg-wash text-muted"
                                  }`}
                                >
                                  {answer.answer}
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold uppercase text-clock">unanswered</span>
                              )}
                              {acting && open.status !== "cancelled" && !open.performed_at ? (
                                <span className="flex gap-1">
                                  {(["yes", "no", "unknown"] as const).map((a) => (
                                    <form action={safetyAction} key={a}>
                                      <input type="hidden" name="studyId" value={open.id} />
                                      <input type="hidden" name="itemCode" value={item.code} />
                                      <input type="hidden" name="answer" value={a} />
                                      <button type="submit" className="border border-line rounded px-2 py-1 text-[10px] font-semibold uppercase hover:bg-wash">
                                        {a}
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
                  ) : null}

                  {/* perform */}
                  {acting && !open.performed_at && open.status !== "cancelled" ? (
                    <form action={performAction} className="bg-white border border-line rounded p-3 mb-4">
                      <input type="hidden" name="studyId" value={open.id} />
                      <p className="text-sm font-semibold mb-1">Record the exposure</p>
                      {IONISING[open.modality] ? (
                        <p className="text-xs text-muted mb-3">
                          Leave the dose blank and a typical figure for {MODALITY_LABEL[open.modality]} (
                          {TYPICAL_DOSE_USV[open.modality]} µSv) is used, and marked as an estimate — so a
                          cumulative total is never silently zero.
                        </p>
                      ) : (
                        <p className="text-xs text-muted mb-3">No ionising radiation, so no dose to record.</p>
                      )}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label><span className={LABEL}>Radiographer</span><input name="radiographerName" defaultValue={user.name} className={FIELD} /></label>
                        <label><span className={LABEL}>Equipment</span><input name="equipment" className={FIELD} /></label>
                        {IONISING[open.modality] ? (
                          <>
                            <label><span className={LABEL}>Dose area product (µGy·m²)</span><input name="doseUgyM2" inputMode="numeric" className={FIELD} /></label>
                            <label><span className={LABEL}>Effective dose (µSv)</span><input name="doseUsv" inputMode="numeric" className={FIELD} /></label>
                          </>
                        ) : null}
                        <label><span className={LABEL}>Images</span><input name="images" inputMode="numeric" className={FIELD} /></label>
                      </div>
                      <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                        Performed
                      </button>
                    </form>
                  ) : null}

                  {acting && !open.performed_at && open.status !== "cancelled" ? (
                    <form action={cancelStudyAction} className="flex gap-2 items-end">
                      <input type="hidden" name="studyId" value={open.id} />
                      <label className="flex-1"><span className={LABEL}>Cancel this study</span>
                        <input name="reason" placeholder="why" className={FIELD} />
                      </label>
                      <button type="submit" className="border border-line text-muted font-semibold rounded px-3 py-2 text-sm">Cancel</button>
                    </form>
                  ) : null}
                </div>

                <div>
                  {/* the dose record */}
                  {openDose && openDose.studies.length > 0 ? (
                    <div className="bg-white border border-line rounded p-3 mb-4">
                      <p className="text-sm font-semibold mb-1">
                        Everything this patient has been exposed to — {dose(openDose.totalUsv)}
                      </p>
                      <p className="text-xs text-muted mb-3">
                        {dose(openDose.measuredUsv)} measured, {dose(openDose.estimatedUsv)} estimated. Summed here
                        because "how much has this patient had" is the question nobody can usually answer.
                      </p>
                      <table className="w-full text-sm">
                        <tbody>
                          {openDose.studies.map((d) => (
                            <tr key={d.studyId} className="border-t border-line first:border-0">
                              <td className="py-1.5 tnum text-xs text-muted">{d.performedAt.slice(0, 10)}</td>
                              <td className="py-1.5">{MODALITY_LABEL[d.modality]} {d.bodyPart}</td>
                              <td className="py-1.5 text-right tnum">
                                {dose(d.doseUsv)}
                                {d.estimated ? <span className="text-[10px] text-muted ml-1">est.</span> : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  {/* reports */}
                  {openReports.length > 0 ? (
                    <div className="bg-white border border-line rounded p-3 mb-4">
                      <p className="text-sm font-semibold mb-2">Reports</p>
                      {openReports.map((r) => (
                        <div key={r.id} className={`border-t border-line first:border-0 py-2 ${r.critical ? "bg-block-soft -mx-3 px-3" : ""}`}>
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-xs font-bold uppercase tracking-wide">{r.kind}</span>
                            {r.critical ? (
                              <span className="text-[10px] font-bold uppercase text-block tracking-wide">critical</span>
                            ) : null}
                            {r.discrepancy ? (
                              <span className="text-[10px] font-bold uppercase text-clock tracking-wide">discrepancy</span>
                            ) : null}
                            <span className="text-xs text-muted ml-auto">
                              {r.reporter_name}{r.reporter_licence ? ` · ${r.reporter_licence}` : ""}
                            </span>
                          </div>
                          <p className="text-sm mt-1">{r.findings}</p>
                          <p className="text-sm font-semibold mt-1">{r.impression}</p>
                          {r.discrepancy_note ? (
                            <p className="text-xs text-clock font-semibold mt-1">{r.discrepancy_note}</p>
                          ) : null}
                          {r.critical ? (
                            r.communicated_at ? (
                              <p className="text-xs text-good font-semibold mt-1">
                                Told to {r.communicated_to} at {r.communicated_at.slice(11, 16)}
                              </p>
                            ) : acting ? (
                              <form action={communicateAction} className="flex gap-2 mt-2 items-end">
                                <input type="hidden" name="studyId" value={open.id} />
                                <input type="hidden" name="reportId" value={r.id} />
                                <label className="flex-1"><span className={LABEL}>Told to whom</span>
                                  <input name="communicatedTo" placeholder="Dr. Wanjiru, by telephone" className={FIELD} />
                                </label>
                                <button type="submit" className="bg-block text-white font-semibold rounded px-3 py-2 text-sm">
                                  Record
                                </button>
                              </form>
                            ) : null
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {acting && open.performed_at ? (
                    <form action={reportAction} className="bg-white border border-line rounded p-3">
                      <input type="hidden" name="studyId" value={open.id} />
                      <p className="text-sm font-semibold mb-1">Report</p>
                      <p className="text-xs text-muted mb-3">
                        A provisional read and a final one are both kept. If the final disagrees, that difference
                        is the most useful record the department has — it is never overwritten.
                      </p>
                      <div className="grid gap-2">
                        <label><span className={LABEL}>Kind</span>
                          <select name="kind" className={FIELD} defaultValue={openReports.some((r) => r.kind === "provisional") ? "final" : "provisional"}>
                            <option value="provisional">Provisional</option>
                            <option value="final">Final</option>
                            <option value="addendum">Addendum</option>
                          </select>
                        </label>
                        <label><span className={LABEL}>Findings</span><input name="findings" className={FIELD} /></label>
                        <label><span className={LABEL}>Impression</span><input name="impression" className={FIELD} /></label>
                        <label><span className={LABEL}>If it differs from the provisional, how</span>
                          <input name="discrepancyNote" className={FIELD} />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-4 mt-3 text-sm">
                        <label className="flex items-center gap-1.5"><input type="checkbox" name="critical" /> <span>Critical finding</span></label>
                        <label className="flex items-center gap-1.5"><input type="checkbox" name="discrepancy" /> <span>Differs from the provisional</span></label>
                      </div>
                      <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                        Sign the report
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            </Section>
          ) : null}

          {/* --------------------------------------- orders with no study */}
          {acting && view === "worklist" && unstarted.length > 0 ? (
            <Section title="Requests with no study opened" note="An imaging order becomes a study, and the study gets the accession the images are filed under.">
              <div className="space-y-2">
                {unstarted.map((o) => (
                  <form action={openStudyAction} key={o.id} className="bg-white border border-line rounded p-3">
                    <input type="hidden" name="orderId" value={o.id} />
                    <p className="text-sm font-semibold mb-2">
                      {o.patient_name} — {o.service_name}
                      {o.clinical_question ? <span className="text-xs text-muted ml-2">{o.clinical_question}</span> : null}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label><span className={LABEL}>Modality</span>
                        <select name="modality" className={FIELD}>
                          {(Object.keys(MODALITY_LABEL) as Modality[]).map((m) => (
                            <option key={m} value={m}>{MODALITY_LABEL[m]}</option>
                          ))}
                        </select>
                      </label>
                      <label><span className={LABEL}>Body part</span><input name="bodyPart" className={FIELD} /></label>
                      <label><span className={LABEL}>Side</span>
                        <select name="laterality" className={FIELD}>
                          <option value="not_applicable">Not applicable</option>
                          <option value="left">Left</option>
                          <option value="right">Right</option>
                          <option value="bilateral">Bilateral</option>
                        </select>
                      </label>
                    </div>
                    <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">Open study</button>
                  </form>
                ))}
              </div>
            </Section>
          ) : null}
        </>
      ) : null}

      {/* ========================================================= log */}
      {view === "log" ? (
        <Section title="Imaging log" note="Every study, cancelled ones included.">
          {log.length === 0 ? (
            <Empty>No study has been opened.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Accession</th>
                    <th className="px-3 py-2 font-medium">Patient</th>
                    <th className="px-3 py-2 font-medium">Study</th>
                    <th className="px-3 py-2 font-medium">Performed</th>
                    <th className="px-3 py-2 font-medium text-right">Dose</th>
                    <th className="px-3 py-2 font-medium">Impression</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((r) => {
                    const final = r.reports.find((x) => x.kind === "final") ?? r.reports.at(-1);
                    return (
                      <tr key={r.study.id} className={`border-t border-line ${r.study.status === "cancelled" ? "opacity-70" : ""}`}>
                        <td className="px-3 py-2 font-mono text-xs">
                          <Link href={`/radiology?view=log&s=${r.study.id}`} className="underline underline-offset-2">
                            {r.study.accession}
                          </Link>
                        </td>
                        <td className="px-3 py-2">{r.patientName}</td>
                        <td className="px-3 py-2">
                          {MODALITY_LABEL[r.study.modality]} {r.study.body_part}
                          {r.study.repeat_of ? <span className="text-[10px] uppercase text-clock ml-2">repeat</span> : null}
                        </td>
                        <td className="px-3 py-2 tnum text-muted text-xs">
                          {r.study.performed_at ? r.study.performed_at.slice(0, 16).replace("T", " ") : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tnum text-xs">{dose(r.study.dose_usv)}</td>
                        <td className="px-3 py-2 text-xs">
                          {final ? (
                            <span className={final.critical ? "text-block font-semibold" : ""}>{final.impression}</span>
                          ) : r.study.status === "cancelled" ? (
                            <span className="text-muted">{r.study.cancel_reason}</span>
                          ) : (
                            <span className="text-muted">not reported</span>
                          )}
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
