import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { getEncounter, currentNote, activeDiagnoses, readiness, noteHistory } from "@/lib/encounters.ts";
import { openPatient } from "@/lib/patients.ts";
import { topCodes, coverage, searchForCoding } from "@/lib/terminology.ts";
import ConsultForm from "./form";
import { addDiagnosisAction, removeDiagnosisAction } from "../actions.ts";

/** Next.js 16: params and searchParams are Promises. */
export default async function ConsultPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const { id } = await props.params;
  const encounterId = decodeURIComponent(id);
  const encounter = getEncounter(encounterId);
  if (!encounter) notFound();

  const params = await props.searchParams;
  const dxQuery = typeof params.dx === "string" ? params.dx.trim() : "";

  const patient = openPatient({
    mrn: encounter.patient_mrn,
    byUserId: user.userId,
    byUserName: user.name,
    purpose: "treatment",
    deviceCode: user.deviceCode ?? undefined,
  })!;

  const note = currentNote(encounterId);
  const diagnoses = activeDiagnoses(encounterId);
  const state = readiness(encounterId);
  const versions = noteHistory(encounterId).length;
  const favourites = topCodes(user.userId);
  const searchHits = dxQuery ? searchForCoding({ query: dxQuery, userId: user.userId }) : [];
  const cat = coverage();
  const closed = encounter.status !== "open";

  const age = patient.date_of_birth
    ? Math.floor((Date.now() - Date.parse(patient.date_of_birth)) / (365.25 * 86_400_000))
    : null;

  return (
    <main className="max-w-3xl mx-auto px-5 py-6">
      {/* Patient banner: who is in front of me, in one line. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-4 border-b border-line">
        <Link href={`/patients/${encodeURIComponent(patient.mrn)}`} className="text-lg font-bold tracking-tight">
          {patient.given_name} {patient.family_name}
        </Link>
        <span className="text-sm text-muted tnum">
          {[patient.sex, age !== null ? `${age} yrs` : "age unknown", patient.mrn].join(" · ")}
        </span>
        <span
          className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded ${
            closed ? "bg-good-soft text-good" : "bg-brand-soft text-brand"
          }`}
        >
          {closed ? "Closed" : "In consultation"}
        </span>
      </div>

      {/* Diagnoses first: it is the thing that blocks the claim, and the thing
          a clinician most often defers and then forgets. */}
      <section className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-muted">Diagnosis</h2>
          {cat.starterOnly ? (
            <span className="text-xs text-clock">
              Starter catalogue only — load the full ICD-11 release before go-live
            </span>
          ) : null}
        </div>

        {diagnoses.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1.5">
            {diagnoses.map((d) => (
              <li key={d.id} className="bg-white border border-line rounded px-3 py-2 flex flex-wrap items-baseline gap-x-3">
                <span className="text-xs font-semibold tnum text-brand">{d.code}</span>
                <span className="text-sm">{d.term}</span>
                <span className="text-xs text-muted">{d.rank === 1 ? "primary" : "additional"}</span>
                {!closed ? (
                  <form action={removeDiagnosisAction} className="ml-auto">
                    <input type="hidden" name="diagnosisId" value={d.id} />
                    <input type="hidden" name="encounterId" value={encounterId} />
                    <button type="submit" className="text-xs text-block underline underline-offset-2">Remove</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm bg-clock-soft border border-clock/25 text-clock rounded px-3 py-2">
            No diagnosis coded. A claim without one is rejected.
          </p>
        )}

        {!closed ? (
          <>
            {/* One tap for what this clinician codes all day. */}
            {favourites.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {favourites
                  .filter((f) => !diagnoses.some((d) => d.code === f.code))
                  .map((f) => (
                    <form key={f.code} action={addDiagnosisAction}>
                      <input type="hidden" name="encounterId" value={encounterId} />
                      <input type="hidden" name="code" value={f.code} />
                      <input type="hidden" name="rank" value={diagnoses.some((d) => d.rank === 1) ? 2 : 1} />
                      <button
                        type="submit"
                        className="text-sm border border-brand/40 text-brand bg-white rounded px-2.5 py-1.5"
                        title={f.term}
                      >
                        <span className="tnum font-semibold">{f.code}</span> {f.term.slice(0, 34)}
                      </button>
                    </form>
                  ))}
              </div>
            ) : null}

            <form className="mt-2 flex gap-2">
              <input
                id="dx"
                name="dx"
                defaultValue={dxQuery}
                placeholder="Search a diagnosis…"
                className="flex-1 border border-line rounded px-3 py-2 bg-white text-sm"
              />
              <button type="submit" className="border border-line rounded px-3 py-2 text-sm">Search</button>
            </form>

            {dxQuery && searchHits.length === 0 ? (
              <p className="mt-2 text-sm text-muted">
                Nothing in the loaded catalogue matches “{dxQuery}”. Do not pick something close — ask an
                administrator to load the full ICD-11 release.
              </p>
            ) : null}

            {searchHits.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {searchHits.slice(0, 6).map((h) => (
                  <li key={h.code}>
                    <form action={addDiagnosisAction}>
                      <input type="hidden" name="encounterId" value={encounterId} />
                      <input type="hidden" name="code" value={h.code} />
                      <input type="hidden" name="rank" value={diagnoses.some((d) => d.rank === 1) ? 2 : 1} />
                      <button
                        type="submit"
                        className="w-full text-left bg-white border border-line rounded px-3 py-2 text-sm hover:border-brand"
                      >
                        <span className="tnum font-semibold text-brand">{h.code}</span> {h.term}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </section>

      {/* The note. One form, saved once. */}
      <ConsultForm
        encounterId={encounterId}
        mrn={patient.mrn}
        closed={closed}
        blockers={state.blockers}
        note={{
          complaint: note?.complaint ?? "",
          history: note?.history ?? "",
          examination: note?.examination ?? "",
          assessment: note?.assessment ?? "",
          plan: note?.plan ?? "",
        }}
      />

      <footer className="mt-6 pt-4 border-t border-line text-xs text-muted leading-relaxed tnum">
        {encounter.clinician_name}
        {encounter.licence_number ? ` · ${encounter.licence_regulator} ${encounter.licence_number}` : " · no licence pinned"}
        {" · opened "}{encounter.opened_at.slice(0, 16).replace("T", " ")}
        {versions > 1 ? ` · note revised ${versions - 1}×, every version kept` : ""}
      </footer>
    </main>
  );
}
