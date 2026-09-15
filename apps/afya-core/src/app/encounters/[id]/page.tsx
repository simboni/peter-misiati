import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { getEncounter, currentNote, activeDiagnoses, readiness, noteHistory } from "@/lib/encounters.ts";
import { openPatient } from "@/lib/patients.ts";
import { topCodes, coverage, searchForCoding } from "@/lib/terminology.ts";
import ConsultForm from "./form";
import PrescribeForm from "./prescribe";
import { addDiagnosisAction, removeDiagnosisAction, cancelPrescriptionAction, recordAllergyAction, placeOrderAction, acknowledgeOrderAction } from "../actions.ts";
import { prescriptionsFor, allergiesFor, listProducts } from "@/lib/prescribing.ts";
import { chargesFor, invoiceForEncounter, leakageReport, formatKes, listServices } from "@/lib/billing.ts";
import { ordersFor } from "@/lib/orders.ts";
import { resultsFor, formatValue } from "@/lib/laboratory.ts";
import { claimForEncounter, scrub } from "@/lib/claims.ts";
import { listPayers, coveragesFor } from "@/lib/payers.ts";
import { billEncounterAction } from "../actions.ts";

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
  const orders = ordersFor(encounter.id);
  const investigations = listServices().filter(
    (svc) => svc.active && (svc.code.startsWith("LAB-") || svc.code.startsWith("IMG-")),
  );
  const prescriptions = prescriptionsFor(encounterId);
  const allergies = allergiesFor(patient.mrn);
  // A clinic formulary is a short list, so it is offered whole. Once the real
  // PPB register is loaded this becomes a type-ahead against findProducts().
  const charges = chargesFor(encounterId);
  const invoice = invoiceForEncounter(encounterId);
  const claim = claimForEncounter(encounterId);
  const verdict = claim ? scrub(claim.id) : null;
  const leaks = leakageReport(encounterId);
  const payers = listPayers();
  const patientCoverage = coveragesFor(patient.mrn);
  const total = charges.reduce((sum, c) => sum + c.amount_cents, 0);

  const products = listProducts().map((p) => ({
    code: p.code,
    label: `${p.name}${p.form ? ` (${p.form})` : ""}`,
    controlled: p.controlled === 1,
  }));

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

      {/* Allergies sit above everything. They are the one thing on this screen
          that can kill someone, and they belong to the patient, not the visit. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {allergies.length > 0 ? (
          allergies.map((a) => (
            <span
              key={a.id}
              className={`text-xs font-semibold px-2 py-1 rounded ${
                a.severity === "mild" ? "bg-clock-soft text-clock" : "bg-block-soft text-block"
              }`}
            >
              {a.substance}
              {a.reaction ? ` — ${a.reaction}` : ""} ({a.severity})
            </span>
          ))
        ) : (
          <span className="text-xs text-muted">No known allergies recorded</span>
        )}

        {!closed ? (
          <form action={recordAllergyAction} className="flex flex-wrap items-center gap-1.5 ml-auto">
            <input type="hidden" name="encounterId" value={encounterId} />
            <input type="hidden" name="mrn" value={patient.mrn} />
            <input
              id="substance"
              name="substance"
              required
              placeholder="Allergy (generic name)"
              className="border border-line rounded px-2 py-1 bg-white text-xs w-40"
            />
            <input
              id="reaction"
              name="reaction"
              placeholder="Reaction"
              className="border border-line rounded px-2 py-1 bg-white text-xs w-28"
            />
            <select
              id="severity"
              name="severity"
              defaultValue="severe"
              className="border border-line rounded px-2 py-1 bg-white text-xs"
            >
              <option value="mild">mild</option>
              <option value="severe">severe</option>
              <option value="anaphylaxis">anaphylaxis</option>
            </select>
            <button type="submit" className="text-xs border border-line rounded px-2 py-1">Add</button>
          </form>
        ) : null}
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

      <section className="mt-6">
        <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-muted">Prescription</h2>

        {prescriptions.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1.5">
            {prescriptions.map((rx) => (
              <li
                key={rx.id}
                className={`bg-white border rounded px-3 py-2 ${
                  rx.status === "cancelled" ? "border-line opacity-60" : "border-line"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-sm font-medium">{rx.product_name}</span>
                  <span className="text-sm text-muted tnum">
                    {rx.dose} · {rx.frequency} · {rx.quantity}
                    {rx.duration_days ? ` · ${rx.duration_days} days` : ""}
                  </span>
                  {rx.status === "cancelled" ? (
                    <span className="text-xs text-muted">cancelled — {rx.cancelled_reason}</span>
                  ) : !closed ? (
                    <form action={cancelPrescriptionAction} className="ml-auto">
                      <input type="hidden" name="prescriptionId" value={rx.id} />
                      <input type="hidden" name="encounterId" value={encounterId} />
                      <button type="submit" className="text-xs text-block underline underline-offset-2">Cancel</button>
                    </form>
                  ) : null}
                </div>
                {rx.override_reason ? (
                  <p className="text-xs text-block mt-1">
                    Prescribed over a warning: {rx.override_reason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">Nothing prescribed yet.</p>
        )}

        {!closed ? <PrescribeForm encounterId={encounterId} products={products} /> : null}
      </section>

      {/* ---- investigations ------------------------------------------- */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-muted">Investigations</h2>

        {orders.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1.5">
            {orders.map((order) => {
              const results = resultsFor(order.id);
              const released = results.filter((r) => r.released_at);
              return (
                <li key={order.id} className="bg-white border border-line rounded px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    {order.priority !== "routine" ? (
                      <span
                        className={`text-[11px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${
                          order.priority === "stat" ? "bg-block text-white" : "bg-clock-soft text-clock"
                        }`}
                      >
                        {order.priority}
                      </span>
                    ) : null}
                    <span className="text-sm font-medium">{order.service_name}</span>
                    <span
                      className={`text-xs ${
                        order.status === "acknowledged"
                          ? "text-good"
                          : order.status === "resulted"
                            ? "text-clock font-semibold"
                            : "text-muted"
                      }`}
                    >
                      {order.status.replace(/_/g, " ")}
                    </span>
                    {order.clinical_question ? (
                      <span className="text-xs text-muted">· {order.clinical_question}</span>
                    ) : null}
                  </div>

                  {released.length > 0 ? (
                    <ul className="mt-1.5 flex flex-col gap-0.5">
                      {released.map((r) => (
                        <li key={r.id} className="text-sm tnum">
                          <span className="font-medium">{r.analyte}</span>{" "}
                          <span
                            className={
                              r.flag === "panic_low" || r.flag === "panic_high"
                                ? "text-block font-bold"
                                : r.flag === "normal"
                                  ? ""
                                  : "text-clock"
                            }
                          >
                            {r.value_milli === null ? r.value_text : formatValue(r.value_milli, r.unit)}
                            {r.flag !== "normal" ? ` (${r.flag.replace("_", " ")})` : ""}
                          </span>
                          {r.low_milli !== null && r.high_milli !== null ? (
                            <span className="text-xs text-muted">
                              {" "}
                              ref {formatValue(r.low_milli)}–{formatValue(r.high_milli)}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {order.status === "resulted" ? (
                    <form action={acknowledgeOrderAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="orderId" value={order.id} />
                      <input type="hidden" name="encounterId" value={encounterId} />
                      <input
                        name="action"
                        placeholder="What are you doing about it?"
                        className="flex-1 min-w-[12rem] border border-line rounded px-2 py-1.5 text-sm bg-white"
                      />
                      <button type="submit" className="bg-brand text-white font-semibold rounded px-3 py-1.5 text-sm">
                        Acknowledge
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">Nothing ordered yet.</p>
        )}

        {!closed ? (
          <form action={placeOrderAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="encounterId" value={encounterId} />
            <input type="hidden" name="kind" value="lab" />
            <label className="text-xs text-muted">
              Investigation
              <select
                name="serviceCode"
                className="block w-56 border border-line rounded px-2 py-1.5 text-sm bg-white"
              >
                {investigations.map((svc) => (
                  <option key={svc.code} value={svc.code}>
                    {svc.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              Priority
              <select name="priority" className="block border border-line rounded px-2 py-1.5 text-sm bg-white">
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="stat">Stat</option>
              </select>
            </label>
            <label className="text-xs text-muted flex-1 min-w-[12rem]">
              What are you asking
              <input
                name="clinicalQuestion"
                placeholder="Rule out sepsis"
                className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white"
              />
            </label>
            <label className="text-xs text-muted">
              Bill to
              <select
                name="payerCode"
                defaultValue={patientCoverage[0]?.payer_code ?? "CASH"}
                className="block border border-line rounded px-2 py-1.5 text-sm bg-white"
              >
                {payers.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
              Order
            </button>
          </form>
        ) : null}
        <p className="text-xs text-muted mt-2 leading-relaxed">
          The charge is raised as the order is placed. An investigation done and not billed is revenue
          the facility never sees; one billed and not ordered is a claim that gets rejected.
        </p>
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

      {/* ---- money and the claim ---------------------------------------- */}
      <section className="mt-7">
        <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-muted">Billing</h2>

        {charges.length > 0 ? (
          <div className="mt-2 border border-line rounded overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {charges.map((c) => (
                  <tr key={c.id} className="bg-white border-b border-line last:border-0">
                    <td className="px-3 py-2">{c.description}</td>
                    <td className="px-3 py-2 text-muted tnum text-right">×{c.quantity}</td>
                    <td className="px-3 py-2 tnum text-right font-medium">{formatKes(c.amount_cents)}</td>
                  </tr>
                ))}
                <tr className="bg-wash">
                  <td className="px-3 py-2 font-semibold" colSpan={2}>Total</td>
                  <td className="px-3 py-2 tnum text-right font-bold">{formatKes(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">Nothing billed yet.</p>
        )}

        {leaks.length > 0 ? (
          <div className="mt-2 bg-clock-soft border border-clock/25 rounded px-3 py-2">
            <p className="text-sm font-semibold text-clock">Done but not billed</p>
            <ul className="text-sm text-clock mt-0.5">
              {leaks.map((l) => <li key={`${l.kind}-${l.ref}`}>{l.description}</li>)}
            </ul>
          </div>
        ) : null}

        {invoice ? (
          <p className="mt-2 text-sm text-muted tnum">
            Invoice {invoice.id} · {formatKes(invoice.total_cents)} ·{" "}
            {invoice.etims_number
              ? `eTIMS ${invoice.etims_number}`
              : `eTIMS ${invoice.etims_status} — the number on the patient's slip is ${invoice.id}`}
          </p>
        ) : null}

        {/*
          Billing stays available AFTER the consultation closes. In a real clinic
          the clinician finishes and the patient walks to the cashier; gating this
          on an open encounter made the "done but not billed" warning above
          impossible to act on, which is the exact revenue leakage (W7) the
          warning exists to catch. Only a cancelled encounter is unbillable.
        */}
        {encounter.status !== "cancelled" && charges.length === 0 ? (
          <form action={billEncounterAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="encounterId" value={encounterId} />
            <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="payerCode">
              Payer
              <select id="payerCode" name="payerCode" defaultValue={patientCoverage[0]?.payer_code ?? "CASH"} className="border border-line rounded px-3 py-2 bg-white text-sm">
                {payers.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </label>
            <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2.5 text-sm">
              Bill and assemble claim
            </button>
          </form>
        ) : null}
      </section>

      {/* ---- the scrubber, live, while the patient is still here ---------- */}
      {verdict ? (
        <section className="mt-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-muted">Claim check</h2>
            <span className={`text-xs font-semibold tnum ${verdict.daysLeft < 3 ? "text-clock" : "text-muted"}`}>
              {verdict.daysLeft >= 0 ? `${verdict.daysLeft} days to submit` : `${Math.abs(verdict.daysLeft)} days overdue`}
            </span>
          </div>

          <ul className="mt-2 flex flex-col gap-px bg-line border border-line rounded overflow-hidden">
            {verdict.gates.map((g) => (
              <li key={g.gate} className="bg-white px-3 py-2 flex flex-wrap gap-x-3 gap-y-0.5 items-baseline">
                <span className={`text-xs font-bold tnum ${
                  g.severity === "block" ? "text-block" : g.severity === "escalate" ? "text-clock" : "text-good"
                }`}>
                  {g.severity === "block" ? "BLOCK" : g.severity === "escalate" ? "LATE" : "OK"}
                </span>
                <span className="text-sm font-medium">{g.name}</span>
                <span className="text-sm text-muted flex-1 min-w-[16rem]">{g.message}</span>
                {!g.passed ? <span className="text-xs text-muted">→ {g.owner}</span> : null}
              </li>
            ))}
          </ul>

          <p className={`mt-2 text-sm font-semibold ${verdict.ready ? "text-good" : "text-block"}`}>
            {verdict.ready
              ? "Ready to submit — every gate passes."
              : `${verdict.blocking.length} thing${verdict.blocking.length === 1 ? "" : "s"} would get this rejected. Fix them before it leaves the building.`}
          </p>
        </section>
      ) : null}

      <footer className="mt-6 pt-4 border-t border-line text-xs text-muted leading-relaxed tnum">
        {encounter.clinician_name}
        {encounter.licence_number ? ` · ${encounter.licence_regulator} ${encounter.licence_number}` : " · no licence pinned"}
        {" · opened "}{encounter.opened_at.slice(0, 16).replace("T", " ")}
        {versions > 1 ? ` · note revised ${versions - 1}×, every version kept` : ""}
      </footer>
    </main>
  );
}
