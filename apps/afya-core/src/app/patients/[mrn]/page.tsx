import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { openPatient, accessHistory, mergeHistory } from "@/lib/patients.ts";
import { encountersFor, openEncounterFor } from "@/lib/encounters.ts";
import { check } from "@/lib/access.ts";
import { startEncounterAction } from "@/app/encounters/actions.ts";

/**
 * A patient record.
 *
 * Opening this page is itself a disclosure, so `openPatient` audits it with the
 * purpose. The access list at the bottom is the same data read back — a patient
 * asking "who has seen my record?" is exercising a right, not making a complaint.
 *
 * Next.js 16: params is a Promise.
 */
export default async function PatientPage(props: { params: Promise<{ mrn: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const { mrn } = await props.params;
  const requested = decodeURIComponent(mrn);

  const patient = openPatient({
    mrn: requested,
    byUserId: user.userId,
    byUserName: user.name,
    purpose: "treatment",
    deviceCode: user.deviceCode ?? undefined,
  });
  if (!patient) notFound();

  const merges = mergeHistory(patient.mrn).filter((m) => !m.undone_at);
  const visits = encountersFor(patient.mrn, 10);
  const openVisit = openEncounterFor(patient.mrn);
  const canConsult = check(user.userId, "encounter.conduct");
  const access = accessHistory(patient.mrn, 8);
  const age = patient.date_of_birth
    ? Math.floor((Date.now() - Date.parse(patient.date_of_birth)) / (365.25 * 86_400_000))
    : null;

  return (
    <main className="max-w-3xl mx-auto px-5 py-8">
      <Link href="/patients" className="text-xs text-brand underline underline-offset-2">← Find a patient</Link>

      {requested !== patient.mrn ? (
        <p className="mt-3 bg-brand-soft border border-brand/20 text-brand rounded px-4 py-2.5 text-sm">
          {requested} was merged into this record. The old number still works.
        </p>
      ) : null}

      <h1 className="text-2xl font-bold tracking-tight mt-3">
        {patient.given_name} {patient.family_name}
      </h1>
      <p className="text-sm text-muted mt-1 tnum">
        {[
          patient.mrn,
          patient.sex,
          age !== null ? `${age} yrs${patient.dob_estimated ? " (est.)" : ""}` : "age unknown",
        ].join(" · ")}
      </p>

      <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-px bg-line border border-line rounded overflow-hidden">
        {[
          ["National ID", patient.national_id],
          ["SHA number", patient.sha_number],
          ["Phone", patient.phone],
          ["Alternate phone", patient.alt_phone],
          ["Date of birth", patient.date_of_birth ? `${patient.date_of_birth}${patient.dob_estimated ? " (estimated)" : ""}` : null],
          ["Locality", [patient.village, patient.ward, patient.sub_county, patient.county].filter(Boolean).join(", ")],
          ["Next of kin", patient.nok_name ? `${patient.nok_name}${patient.nok_relation ? ` (${patient.nok_relation})` : ""}` : null],
          ["Next of kin phone", patient.nok_phone],
        ].map(([term, value]) => (
          <div key={term as string} className="bg-white px-4 py-3">
            <dt className="text-xs text-muted">{term}</dt>
            <dd className={`text-sm mt-0.5 tnum ${value ? "" : "text-muted italic"}`}>{value || "not recorded"}</dd>
          </div>
        ))}
      </dl>

      {/* The clinician's next action, or the reason there isn't one. */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {openVisit ? (
          <Link
            href={`/encounters/${encodeURIComponent(openVisit.id)}`}
            className="bg-brand text-white font-semibold rounded px-4 py-2.5 text-sm"
          >
            Continue consultation
          </Link>
        ) : canConsult.allowed ? (
          <form action={startEncounterAction}>
            <input type="hidden" name="mrn" value={patient.mrn} />
            <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2.5 text-sm">
              Start consultation
            </button>
          </form>
        ) : null}
      </div>

      {visits.length > 0 ? (
        <section className="mt-7">
          <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-muted">Visits</h2>
          <ul className="mt-2 flex flex-col gap-px bg-line border border-line rounded overflow-hidden">
            {visits.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/encounters/${encodeURIComponent(v.id)}`}
                  className="bg-white px-4 py-2.5 flex flex-wrap gap-x-3 gap-y-1 items-baseline hover:bg-wash"
                >
                  <span className="text-sm tnum text-muted">{v.opened_at.slice(0, 10)}</span>
                  <span className="text-sm font-medium">{v.kind}</span>
                  <span className="text-sm text-muted">{v.clinician_name}</span>
                  <span className="ml-auto text-xs text-muted">{v.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!patient.national_id && !patient.sha_number ? (
        <p className="mt-3 bg-clock-soft border border-clock/25 text-clock rounded px-4 py-2.5 text-sm">
          No national ID or SHA number on file. A claim for this patient cannot be verified until one is added.
        </p>
      ) : null}

      {merges.length > 0 ? (
        <section className="mt-7">
          <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-muted">Merged records</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {merges.map((m) => (
              <li key={m.id} className="bg-white border border-line rounded px-4 py-2.5 text-sm tnum">
                {m.merged_mrn === patient.mrn ? `Merged into ${m.kept_mrn}` : `${m.merged_mrn} merged in`} ·{" "}
                {m.merged_at.slice(0, 10)} — {m.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-7">
        <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-muted">Who has opened this record</h2>
        <ul className="mt-2 flex flex-col gap-px bg-line border border-line rounded overflow-hidden">
          {access.map((a, i) => (
            <li key={i} className="bg-white px-4 py-2 text-sm flex flex-wrap gap-x-3 tnum">
              <span className="text-muted">{a.at.slice(0, 16).replace("T", " ")}</span>
              <span className="font-medium">{a.actor_name}</span>
              <span className="text-muted ml-auto">{a.purpose}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted mt-2 leading-relaxed">
          Every access is recorded, reads included. This is what a patient is entitled to see when they ask.
        </p>
      </section>
    </main>
  );
}
