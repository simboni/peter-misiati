import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  biometricSummary, listReaders, enrolmentsFor, verificationsFor,
  eligibility, activeException, citableFor,
  FINGERS, MIN_QUALITY, MIN_AGE_YEARS,
} from "@/lib/biometrics.ts";
import { resolvePatient, searchPatients } from "@/lib/patients.ts";
import { hasConsent } from "@/lib/frontdesk.ts";
import { Shell, Stat, Section, Empty, Views } from "@/app/_components/shell.tsx";
import {
  consentAction, enrolAction, verifyAction, fallbackAction,
  exceptionAction, withdrawAction, readerAction, goLiveAction,
} from "./actions.ts";

/**
 * Biometric verification.
 *
 * The screen is built so that "no" is as easy to record as "yes". A clerk with
 * a queue of people behind them will take the quickest route available, so the
 * quickest route has to be the correct one.
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";
const LABEL = "block text-xs text-muted mb-1";

const FINGER_LABEL = (finger: string) =>
  finger.replace("_", " ").replace(/^(right|left)/, (side) => side[0].toUpperCase() + side.slice(1));

const EXCEPTION_LABEL: Record<string, string> = {
  infant: "Too young for a usable print",
  worn_ridges: "Ridges worn flat (manual work)",
  amputation: "Amputation",
  disease: "A condition affecting the fingertips",
  refused: "The patient declined",
  no_reader: "No reader available",
  other: "Other (say what)",
};

export default async function BiometricsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; mrn?: string; q?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "patient.read")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "desk";
  const configuring = can(user.userId, "facility.configure");

  const summary = biometricSummary(user.facilityId);
  const readers = listReaders(user.facilityId);
  const results = params.q ? searchPatients({ facilityId: user.facilityId, query: params.q, limit: 8 }) : [];

  const patient = params.mrn ? resolvePatient(params.mrn) : undefined;
  const enrolments = patient ? enrolmentsFor(patient.mrn) : [];
  const history = patient ? verificationsFor(patient.mrn, 12) : [];
  const eligible = patient ? eligibility(patient.mrn) : undefined;
  const exception = patient ? activeException(patient.mrn) : undefined;
  const consented = patient ? hasConsent(patient.mrn, "biometric") : false;
  const lastFailure = history.find((h) => h.matched === 0 && !h.fallback);

  return (
    <Shell
      user={user}
      current="/biometrics"
      error={params.error}
      title={view === "readers" ? "Fingerprint readers" : patient ? "Identity" : "Biometric verification"}
      subtitle={
        view === "desk" && !patient
          ? "A failed match never denies care. It routes to documents, and the failure stays on the record so a bad enrolment can be found."
          : undefined
      }
    >
      <Views
        current={view}
        views={[
          { key: "desk", label: "Desk", href: "/biometrics" },
          { key: "coverage", label: "Coverage", href: "/biometrics?view=coverage" },
          { key: "readers", label: "Readers", href: "/biometrics?view=readers" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Enrolled" value={summary.enrolled} note={`${summary.exceptions} on an exception`} />
        <Stat
          label="Match rate"
          value={summary.matchRatePercent === null ? "—" : `${summary.matchRatePercent}%`}
          tone={summary.matchRatePercent !== null && summary.matchRatePercent < 80 ? "clock" : "ink"}
          note={`${summary.matched} of ${summary.attempts} attempts in 90 days`}
        />
        <Stat
          label="Poor enrolments"
          value={summary.poorQualityEnrolments}
          tone={summary.poorQualityEnrolments > 0 ? "clock" : "good"}
          note={`quality under ${MIN_QUALITY} · ${summary.repeatFailures.length} failing repeatedly`}
        />
        <Stat
          label="Readers"
          value={`${summary.liveReaders}/${summary.readers}`}
          tone={summary.liveReaders === 0 ? "clock" : "good"}
          note={summary.liveReaders === 0 ? "all in demo mode — nothing here is evidence" : "live"}
        />
      </div>

      {summary.liveReaders === 0 ? (
        <p className="mt-4 text-xs bg-clock-soft border border-clock/25 text-clock rounded px-3 py-2">
          Every reader is in demo mode. Captures are simulated, matches are string comparisons and nothing
          produced here can be cited on a claim. That is deliberate: the moment a demonstration is
          indistinguishable from the real thing, somebody bills on it.
        </p>
      ) : null}

      {/* ===================================================== desk */}
      {view === "desk" && !patient ? (
        <Section title="Find a patient">
          <form className="bg-white border border-line rounded p-3 flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-60">
              <label className={LABEL}>Name, file number, ID or phone</label>
              <input name="q" defaultValue={params.q ?? ""} className={FIELD} placeholder="Wanjiku" />
            </div>
            <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Search</button>
          </form>

          {params.q ? (
            results.length === 0 ? (
              <p className="mt-3">
                <Empty>Nobody matches that.</Empty>
              </p>
            ) : (
              <div className="mt-3 bg-white border border-line rounded divide-y divide-line">
                {results.map((row) => (
                  <Link
                    key={row.mrn}
                    href={`/biometrics?mrn=${row.mrn}`}
                    className="block px-3 py-2 text-sm hover:bg-brand-soft"
                  >
                    <span className="font-medium">{row.given_name} {row.family_name}</span>
                    <span className="text-muted"> · {row.mrn}</span>
                    {row.national_id ? <span className="text-xs text-muted"> · ID {row.national_id}</span> : null}
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
                {patient.national_id ? ` · ID ${patient.national_id}` : ""}
                {patient.sha_number ? ` · SHA ${patient.sha_number}` : ""}
                {patient.date_of_birth ? ` · born ${patient.date_of_birth}` : ""}
              </p>
              <p className="mt-2">
                {enrolments.length > 0 ? (
                  <span className="text-good">
                    {enrolments.length} finger{enrolments.length === 1 ? "" : "s"} on file
                  </span>
                ) : exception ? (
                  <span className="text-clock">exception: {EXCEPTION_LABEL[exception.reason]}</span>
                ) : (
                  <span className="text-muted">nothing on file</span>
                )}
                <span className="text-muted">
                  {" "}· biometric consent {consented ? "recorded" : <span className="text-clock">not recorded</span>}
                </span>
              </p>
              {eligible && !eligible.attempt ? (
                <ul className="mt-2 text-clock text-sm list-disc pl-5">
                  {eligible.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              ) : null}
              <p className="mt-2 flex gap-3">
                <Link href={`/patients/${patient.mrn}`} className="text-brand text-sm hover:underline">
                  the patient record →
                </Link>
                <Link href="/biometrics" className="text-brand text-sm hover:underline">← the desk</Link>
              </p>
            </div>
          </Section>

          {!consented ? (
            <Section
              title="Consent"
              note={`Biometric data is a special category under the Data Protection Act. Consent to be treated is not consent to be fingerprinted, and "no" is a complete answer.`}
            >
              <form action={consentAction} className="bg-white border border-line rounded p-3 flex flex-wrap gap-2 items-end">
                <input type="hidden" name="patientMrn" value={patient.mrn} />
                <div>
                  <label className={LABEL}>They said</label>
                  <select name="granted" className={FIELD}>
                    <option value="yes">Yes — enrol me</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Given by</label>
                  <input name="givenBy" className={FIELD} placeholder="patient" defaultValue="patient" />
                </div>
                <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Record</button>
              </form>
            </Section>
          ) : null}

          <Section title="Verify" note="Nothing downstream refuses on a non-match. It routes to documents.">
            <form action={verifyAction} className="bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-5 items-end">
              <input type="hidden" name="patientMrn" value={patient.mrn} />
              <div>
                <label className={LABEL}>Reader</label>
                <select name="readerCode" className={FIELD}>
                  {readers.map((reader) => (
                    <option key={reader.code} value={reader.code}>
                      {reader.code} · {reader.mode}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL}>Finger</label>
                <select name="finger" className={FIELD}>
                  {FINGERS.map((finger) => (
                    <option key={finger} value={finger}>{FINGER_LABEL(finger)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL}>For</label>
                <select name="purpose" className={FIELD}>
                  <option value="service">Service</option>
                  <option value="claim">Claim</option>
                  <option value="dispense">Dispensing</option>
                  <option value="registration">Registration</option>
                </select>
              </div>
              <div>
                <label className={LABEL}>Simulated capture</label>
                <select name="present" className={FIELD}>
                  <option value="self">This patient's finger</option>
                  <option value="other">Somebody else's</option>
                </select>
              </div>
              <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Read the finger</button>
            </form>
          </Section>

          {lastFailure ? (
            <Section title="That did not match" note="Settle it from documents. The failure stays on the record, which is how a bad enrolment is ever found.">
              <form action={fallbackAction} className="bg-white border border-line rounded p-3 flex flex-wrap gap-2 items-end">
                <input type="hidden" name="patientMrn" value={patient.mrn} />
                <input type="hidden" name="verificationId" value={lastFailure.id} />
                <div className="flex-1 min-w-60">
                  <label className={LABEL}>What was checked instead</label>
                  <input name="fallback" required className={FIELD} placeholder="National ID 29104477 seen" />
                </div>
                <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Record</button>
              </form>
            </Section>
          ) : null}

          <Section title="Fingers on file">
            {enrolments.length === 0 ? (
              <Empty>Nothing is enrolled for this patient.</Empty>
            ) : (
              <div className="bg-white border border-line rounded divide-y divide-line">
                {enrolments.map((enrolment) => (
                  <div key={enrolment.id} className="px-3 py-2 text-sm flex flex-wrap gap-2 items-center">
                    <span className="font-medium">{FINGER_LABEL(enrolment.finger)}</span>
                    <span className={enrolment.quality !== null && enrolment.quality < MIN_QUALITY ? "text-clock" : "text-muted"}>
                      quality {enrolment.quality ?? "—"}
                    </span>
                    <span className="text-xs text-muted">
                      {enrolment.captured_at.slice(0, 10)} · {enrolment.reader_code}
                      {enrolment.demo ? " · demo" : ""}
                      {enrolment.template_format ? ` · ${enrolment.template_format}` : ""}
                    </span>
                    <form action={withdrawAction} className="ml-auto flex gap-2 items-center">
                      <input type="hidden" name="patientMrn" value={patient.mrn} />
                      <input type="hidden" name="enrolmentId" value={enrolment.id} />
                      <input name="reason" required className="border border-line rounded px-2 py-1 text-xs" placeholder="reason" />
                      <button className="text-xs border border-line rounded px-2 py-1 hover:border-block">
                        Withdraw
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {consented ? (
            <Section title="Enrol a finger" note="A re-capture supersedes; there is never a question of which template is current.">
              <form action={enrolAction} className="bg-white border border-line rounded p-3 flex flex-wrap gap-2 items-end">
                <input type="hidden" name="patientMrn" value={patient.mrn} />
                <div>
                  <label className={LABEL}>Reader</label>
                  <select name="readerCode" className={FIELD}>
                    {readers.map((reader) => (
                      <option key={reader.code} value={reader.code}>{reader.code} · {reader.mode}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Finger</label>
                  <select name="finger" className={FIELD}>
                    {FINGERS.map((finger) => (
                      <option key={finger} value={finger}>{FINGER_LABEL(finger)}</option>
                    ))}
                  </select>
                </div>
                <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Capture</button>
              </form>
            </Section>
          ) : null}

          <Section
            title="Or record why there is no fingerprint"
            note={`Under ${MIN_AGE_YEARS}, ridges worn flat, an amputation, or the patient said no. A system that requires a fingerprint denies care to exactly the people least able to argue with it.`}
          >
            <form action={exceptionAction} className="bg-white border border-line rounded p-3 flex flex-wrap gap-2 items-end">
              <input type="hidden" name="patientMrn" value={patient.mrn} />
              <div>
                <label className={LABEL}>Reason</label>
                <select name="reason" className={FIELD}>
                  {Object.entries(EXCEPTION_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-60">
                <label className={LABEL}>Note</label>
                <input name="note" className={FIELD} />
              </div>
              <button className="bg-white border border-line text-sm rounded px-3 py-1.5">Record</button>
            </form>
          </Section>

          <Section title="Attempts" note="Failures included. A table that keeps only the successes cannot tell you whose enrolment is bad.">
            {history.length === 0 ? (
              <Empty>Nothing has been attempted for this patient.</Empty>
            ) : (
              <div className="bg-white border border-line rounded divide-y divide-line">
                {history.map((row) => (
                  <div key={row.id} className="px-3 py-2 text-sm">
                    <span className="text-muted">{row.attempted_at.slice(0, 16).replace("T", " ")}</span>{" "}
                    <span className={row.matched ? "text-good" : "text-block"}>
                      {row.matched ? "matched" : "no match"}
                    </span>
                    <span className="text-muted">
                      {" "}· for {row.purpose} · {row.reader_code}
                      {row.finger ? ` · ${FINGER_LABEL(row.finger)}` : ""}
                      {row.demo ? " · demo, not evidence" : ""}
                    </span>
                    {row.fallback ? <span className="text-xs text-muted"> · settled from {row.fallback}</span> : null}
                    {row.matched && !row.demo && citableFor(row.id).citable ? (
                      <span className="text-xs text-good"> · citable</span>
                    ) : null}
                    <span className="text-xs text-muted"> · {row.attempter_name}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      ) : null}

      {/* ================================================= coverage */}
      {view === "coverage" && !patient ? (
        <Section
          title="Who keeps failing"
          note="More than one failed attempt in 90 days is a bad enrolment, not a bad person. Re-capture the finger."
        >
          {summary.repeatFailures.length === 0 ? (
            <Empty>Nobody has failed more than once.</Empty>
          ) : (
            <div className="bg-white border border-line rounded divide-y divide-line">
              {summary.repeatFailures.map((row) => {
                const person = resolvePatient(row.patientMrn);
                return (
                  <Link
                    key={row.patientMrn}
                    href={`/biometrics?mrn=${row.patientMrn}`}
                    className="block px-3 py-2 text-sm hover:bg-brand-soft"
                  >
                    <span className="font-medium">
                      {person ? `${person.given_name} ${person.family_name}` : row.patientMrn}
                    </span>
                    <span className="text-muted"> · {row.patientMrn}</span>
                    <span className="text-block"> · {row.failures} failed attempts</span>
                  </Link>
                );
              })}
            </div>
          )}
        </Section>
      ) : null}

      {/* ================================================== readers */}
      {view === "readers" && !patient ? (
        <Section title="Readers" note="A reader in demo mode produces nothing that can be cited. Going live needs its template format on the record.">
          <div className="bg-white border border-line rounded overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-2 py-2">Where</th>
                  <th className="px-2 py-2">Make</th>
                  <th className="px-2 py-2">Template format</th>
                  <th className="px-2 py-2 text-right">Threshold</th>
                  <th className="px-2 py-2">Mode</th>
                </tr>
              </thead>
              <tbody>
                {readers.map((reader) => (
                  <tr key={reader.code} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">{reader.code}</td>
                    <td className="px-2 py-2">{reader.label}</td>
                    <td className="px-2 py-2 text-muted">{[reader.make, reader.model].filter((v) => v && v !== "—").join(" ") || "—"}</td>
                    <td className="px-2 py-2 text-muted">{reader.template_format || "not recorded"}</td>
                    <td className="px-2 py-2 text-right">{reader.threshold}</td>
                    <td className="px-2 py-2">
                      {reader.mode === "live" ? (
                        <span className="text-good">live</span>
                      ) : (
                        <span className="text-clock">demo — not evidence</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {configuring ? (
            <>
              <form action={readerAction} className="mt-3 bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-5 items-end">
                <div>
                  <label className={LABEL}>Code</label>
                  <input name="code" required className={FIELD} placeholder="FP2" />
                </div>
                <div className="sm:col-span-2">
                  <label className={LABEL}>Where it sits</label>
                  <input name="label" required className={FIELD} placeholder="Claims desk" />
                </div>
                <div>
                  <label className={LABEL}>Make and model</label>
                  <div className="flex gap-2">
                    <input name="make" className={FIELD} />
                    <input name="model" className={FIELD} />
                  </div>
                </div>
                <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Register</button>
              </form>

              <form action={goLiveAction} className="mt-3 bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-4 items-end">
                <div>
                  <label className={LABEL}>Take live</label>
                  <select name="code" className={FIELD}>
                    {readers.filter((r) => r.mode === "demo").map((reader) => (
                      <option key={reader.code} value={reader.code}>{reader.code}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Template format</label>
                  <input name="templateFormat" required className={FIELD} placeholder="ISO/IEC 19794-2" />
                </div>
                <div>
                  <label className={LABEL}>Matching algorithm</label>
                  <input name="algorithm" required className={FIELD} placeholder="vendor and version" />
                </div>
                <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Go live</button>
              </form>
              <p className="mt-2 text-xs text-muted">
                A template captured on one vendor's reader does not match on another's. A facility that cannot
                say what format its templates are in re-enrols every patient when it changes supplier, and it
                finds that out after the contract is signed.
              </p>
            </>
          ) : null}
        </Section>
      ) : null}
    </Shell>
  );
}
