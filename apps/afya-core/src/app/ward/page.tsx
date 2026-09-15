import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  bedBoard, census, currentAdmission, observationsFor, drugChart, missedDoses,
  bedHistory, bedsAvailableFor, NEWS2_ESCALATION,
} from "@/lib/inpatient.ts";
import { searchPatients } from "@/lib/patients.ts";
import { listPayers } from "@/lib/payers.ts";
import { Shell, Stat, Section, Empty, Banner, Views } from "@/app/_components/shell.tsx";
import { admitAction, transferAction, observationAction, dischargeAction, billNightsAction } from "./actions.ts";

/**
 * The ward.
 *
 * The bed board first, because it is what a ward round and a bed manager both
 * start from, and then one patient in detail when a bed is chosen. Beds a
 * patient could not occupy are shown greyed rather than hidden — a bed manager
 * needs to know the bed exists and why it is not an option.
 */
export default async function WardPage({
  searchParams,
}: {
  searchParams: Promise<{ bed?: string; q?: string; view?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const { bed: selectedBed, q, view = "beds", error } = await searchParams;
  const board = bedBoard(user.facilityId);
  const wards = census(user.facilityId);
  const missed = missedDoses(user.facilityId);
  const payers = listPayers();
  const canAdmit = can(user.userId, "patient.admit");
  const canDischarge = can(user.userId, "patient.discharge");

  const chosen = board.find((b) => b.bed.code === selectedBed?.toUpperCase());

  const candidates = q?.trim() ? searchPatients({ facilityId: user.facilityId, query: q, limit: 8 }) : [];
  const freeBeds = board.filter((b) => !b.occupied && !b.bed.out_of_service);

  return (
    <Shell
      user={user}
      current={view === "charts" ? "/ward?view=charts" : "/ward"}
      error={error}
      title={view === "charts" ? "Drug charts" : "Ward"}
      subtitle="The bed board, the observations, and the drug chart."
      actions={
        <form action={billNightsAction} className="flex items-end gap-2">
          <select name="payerCode" defaultValue="CASH" className="border border-line rounded px-2 py-2 text-sm bg-white">
            {payers.map((p) => (
              <option key={p.code} value={p.code}>{p.name}</option>
            ))}
          </select>
          <button type="submit" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
            Bill bed nights
          </button>
        </form>
      }
    >
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Occupied" value={board.filter((b) => b.occupied).length} note={`of ${board.length} beds`} />
        <Stat
          label="Free"
          value={freeBeds.length}
          tone={freeBeds.length === 0 ? "block" : "good"}
          note="ready now"
        />
        <Stat
          label="Out of service"
          value={board.filter((b) => b.bed.out_of_service).length}
          tone="muted"
        />
        <Stat
          label="Doses past due"
          value={missed.length}
          tone={missed.length > 0 ? "block" : "good"}
          note="unsigned on the chart"
        />
      </div>

      {missed.length > 0 ? (
        <div className="mt-5">
          <Banner tone="block">
            {missed.length} dose{missed.length === 1 ? " is" : "s are"} past due and unsigned —{" "}
            {/* Grouped: three doses of the same drug in the same bed is one
                thing a nurse has to go and do, not three separate readings. */}
            {[...missed.reduce((by, m) => {
              const key = `${m.product_name} in ${m.bed_code}`;
              return by.set(key, (by.get(key) ?? 0) + 1);
            }, new Map<string, number>())]
              .map(([what, n]) => (n > 1 ? `${what} (${n})` : what))
              .join(", ")}
            .
          </Banner>
        </div>
      ) : null}

      <Views
        current={view}
        views={[
          { key: "beds", label: "Bed board", href: "/ward" },
          { key: "charts", label: "Drug charts", href: "/ward?view=charts" },
        ]}
      />

      {view === "charts" ? (
        <Section
          title="Doses past due and unsigned"
          note="What a shift handover asks about. A dose not given is a record, not a blank."
        >
          {missed.length === 0 ? (
            <Empty>Every dose due so far has been signed for.</Empty>
          ) : (
            <table className="w-full text-sm bg-white border border-line rounded">
              <thead>
                <tr className="text-xs text-muted text-left">
                  <th className="px-3 py-2 font-medium">Due</th>
                  <th className="px-3 py-2 font-medium">Bed</th>
                  <th className="px-3 py-2 font-medium">Patient</th>
                  <th className="px-3 py-2 font-medium">Medicine</th>
                </tr>
              </thead>
              <tbody>
                {missed.map((m) => (
                  <tr key={m.id} className="border-t border-line">
                    <td className="px-3 py-2 tnum text-block font-semibold">
                      {m.due_at.slice(5, 16).replace("T", " ")}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link href={`/ward?bed=${m.bed_code}`} className="text-brand underline underline-offset-2">
                        {m.bed_code}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs tnum">{m.patient_mrn}</td>
                    <td className="px-3 py-2">{m.product_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-muted mt-3 leading-relaxed">
            Open a bed from the board to sign for a dose, or to record why one was withheld — refused,
            vomited, absent and forgotten are entirely different things at an inquest.
          </p>
        </Section>
      ) : null}

      {view === "beds" ? (
      <Section title="Bed board">
        {wards.map((ward) => (
          <div key={ward.wardCode} className="mb-5">
            <div className="flex flex-wrap items-baseline gap-x-3 pb-2">
              <h3 className="font-semibold">{ward.wardName}</h3>
              <span className="text-xs text-muted tnum">
                {ward.occupied}/{ward.beds - ward.outOfService} occupied · {ward.occupancyPercent}%
                {ward.outOfService > 0 ? ` · ${ward.outOfService} out of service` : ""}
              </span>
              <span className="text-xs text-muted tnum ml-auto">
                {ward.admissionsToday} admitted today · {ward.dischargesToday} discharged
              </span>
            </div>
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6">
              {board
                .filter((b) => b.ward.code === ward.wardCode)
                .map((b) => (
                  <a
                    key={b.bed.code}
                    href={`/ward?bed=${b.bed.code}`}
                    className={`border rounded px-3 py-2.5 block ${
                      b.bed.code === chosen?.bed.code
                        ? "border-brand bg-brand-soft"
                        : b.bed.out_of_service
                          ? "border-line bg-wash opacity-60"
                          : b.occupied
                            ? "border-line bg-white"
                            : "border-good/30 bg-good-soft"
                    }`}
                  >
                    <div className="font-mono text-xs font-bold tnum">{b.bed.code}</div>
                    {b.bed.out_of_service ? (
                      <div className="text-xs text-muted mt-0.5">{b.bed.out_reason ?? "out of service"}</div>
                    ) : b.occupied ? (
                      <>
                        <div className="text-sm font-medium mt-0.5 truncate">{b.patientName}</div>
                        <div className="text-xs text-muted tnum">
                          {b.nights} night{b.nights === 1 ? "" : "s"}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-good mt-0.5">free</div>
                    )}
                  </a>
                ))}
            </div>
          </div>
        ))}
      </Section>

      ) : null}

      {/* ---- one patient, when a bed is chosen ---- */}
      {chosen?.occupied && chosen.patientMrn ? (
        <PatientPanel
          bedCode={chosen.bed.code}
          patientMrn={chosen.patientMrn}
          patientName={chosen.patientName ?? chosen.patientMrn}
          // Only beds this patient could actually occupy. Offering a male
          // patient a maternity bed is the same mistake as counting it empty.
          freeBeds={bedsAvailableFor(user.facilityId, chosen.patientMrn).map((b) => b.bed.code)}
          canDischarge={canDischarge}
        />
      ) : chosen && !chosen.occupied && canAdmit ? (
        <Section title={`Admit to ${chosen.bed.code}`} note={`${chosen.ward.name}${chosen.ward.admits_sex ? ` — ${chosen.ward.admits_sex} patients only` : ""}`}>
          <form className="bg-white border border-line rounded px-4 py-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="bed" value={chosen.bed.code} />
            <label className="text-xs text-muted flex-1 min-w-[14rem]">
              Find the patient
              <input
                name="q"
                defaultValue={q ?? ""}
                placeholder="Name, file number or national ID"
                className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white"
              />
            </label>
            <button type="submit" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
              Search
            </button>
          </form>

          {candidates.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2">
              {candidates.map((p) => (
                <li key={p.mrn} className="bg-white border border-line rounded px-4 py-3">
                  <form action={admitAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="mrn" value={p.mrn} />
                    <input type="hidden" name="wardCode" value={chosen.ward.code} />
                    <input type="hidden" name="bedCode" value={chosen.bed.code} />
                    <div className="min-w-[10rem]">
                      <div className="font-medium text-sm">
                        {p.given_name} {p.family_name}
                      </div>
                      <div className="font-mono text-xs text-muted tnum">
                        {p.mrn} · {p.sex}
                      </div>
                    </div>
                    <label className="text-xs text-muted flex-1 min-w-[14rem]">
                      Reason for admission
                      <input
                        name="reason"
                        required
                        placeholder="Community-acquired pneumonia, for IV antibiotics"
                        className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white"
                      />
                    </label>
                    <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                      Admit
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : q ? (
            <Empty>Nobody matches that.</Empty>
          ) : null}
        </Section>
      ) : null}
    </Shell>
  );
}

/**
 * Blood pressure as a person writes it.
 *
 * A systolic with no diastolic is a real reading — an automated cuff that only
 * caught one number, or a manual palpated systolic — and it must not render as
 * "118/null", which reads on a ward round as a broken machine.
 */
function bp(systolic: number | null, diastolic: number | null): string {
  if (systolic === null && diastolic === null) return "";
  if (systolic === null) return `?/${diastolic}`;
  if (diastolic === null) return `${systolic}/–`;
  return `${systolic}/${diastolic}`;
}

/** One admitted patient: observations, the chart, transfer and discharge. */
function PatientPanel({
  bedCode,
  patientMrn,
  patientName,
  freeBeds,
  canDischarge,
}: {
  bedCode: string;
  patientMrn: string;
  patientName: string;
  freeBeds: string[];
  canDischarge: boolean;
}) {
  const admission = currentAdmission(patientMrn)!;
  const observations = observationsFor(admission.id).slice(-6).reverse();
  const chart = drugChart(admission.id);
  const moves = bedHistory(admission.id);
  const latest = observations[0];

  return (
    <Section title={`${patientName} — ${bedCode}`} note={admission.reason}>
      <div className="bg-white border border-line rounded px-4 py-3">
        <p className="text-xs text-muted tnum">
          Admitted {admission.admitted_at.slice(0, 16).replace("T", " ")} by {admission.admitter_name}
          {admission.admitter_licence ? ` (${admission.admitter_licence})` : ""} ·{" "}
          <Link href={`/patients/${encodeURIComponent(patientMrn)}`} className="text-brand underline underline-offset-2">
            open the record
          </Link>
        </p>

        {latest ? (
          <p className="mt-2 text-sm">
            <span className="text-muted">Latest NEWS2 </span>
            <span
              className={`font-bold tnum ${
                latest.news2_score >= 7 ? "text-block" : latest.news2_score >= NEWS2_ESCALATION ? "text-clock" : "text-good"
              }`}
            >
              {latest.news2_score}
            </span>
            <span className="text-muted tnum">
              {" "}
              · {latest.temp_tenths_c !== null ? `${(latest.temp_tenths_c / 10).toFixed(1)}°C ` : ""}
              {bp(latest.systolic_mmhg, latest.diastolic_mmhg)}{latest.systolic_mmhg !== null ? " " : ""}
              {latest.pulse_bpm !== null ? `${latest.pulse_bpm}bpm ` : ""}
              {latest.spo2_percent !== null ? `SpO₂ ${latest.spo2_percent}% ` : ""}
              at {latest.recorded_at.slice(11, 16)}
            </span>
          </p>
        ) : null}

        {moves.length > 1 ? (
          <p className="text-xs text-muted mt-1 tnum">
            Beds: {moves.map((m) => m.to_bed).join(" → ")}
          </p>
        ) : null}
      </div>

      {/* ---- observations ---- */}
      <form action={observationAction} className="mt-3 bg-white border border-line rounded px-4 py-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="admissionId" value={admission.id} />
        {[
          { name: "temp", label: "Temp °C", step: "0.1", width: "w-20" },
          { name: "systolic", label: "Systolic", step: "1", width: "w-20" },
          { name: "diastolic", label: "Diastolic", step: "1", width: "w-20" },
          { name: "pulse", label: "Pulse", step: "1", width: "w-20" },
          { name: "respRate", label: "Resp", step: "1", width: "w-16" },
          { name: "spo2", label: "SpO₂ %", step: "1", width: "w-20" },
        ].map((f) => (
          <label key={f.name} className="text-xs text-muted">
            {f.label}
            <input
              name={f.name}
              type="number"
              step={f.step}
              className={`block ${f.width} border border-line rounded px-2 py-1.5 text-sm tnum bg-white`}
            />
          </label>
        ))}
        <label className="text-xs text-muted flex-1 min-w-[10rem]">
          Note
          <input name="note" className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white" />
        </label>
        <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
          Record
        </button>
      </form>

      {observations.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm bg-white border border-line rounded">
            <thead>
              <tr className="text-xs text-muted text-left">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium text-right">Temp</th>
                <th className="px-3 py-2 font-medium text-right">BP</th>
                <th className="px-3 py-2 font-medium text-right">Pulse</th>
                <th className="px-3 py-2 font-medium text-right">Resp</th>
                <th className="px-3 py-2 font-medium text-right">SpO₂</th>
                <th className="px-3 py-2 font-medium text-right">NEWS2</th>
                <th className="px-3 py-2 font-medium">By</th>
              </tr>
            </thead>
            <tbody>
              {observations.map((o) => (
                <tr key={o.id} className="border-t border-line">
                  <td className="px-3 py-1.5 tnum text-muted">{o.recorded_at.slice(5, 16).replace("T", " ")}</td>
                  <td className="px-3 py-1.5 text-right tnum">{o.temp_tenths_c !== null ? (o.temp_tenths_c / 10).toFixed(1) : "—"}</td>
                  <td className="px-3 py-1.5 text-right tnum">{bp(o.systolic_mmhg, o.diastolic_mmhg) || "—"}</td>
                  <td className="px-3 py-1.5 text-right tnum">{o.pulse_bpm ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tnum">{o.resp_rate ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tnum">{o.spo2_percent ?? "—"}</td>
                  <td
                    className={`px-3 py-1.5 text-right tnum font-bold ${
                      o.news2_score >= 7 ? "text-block" : o.news2_score >= NEWS2_ESCALATION ? "text-clock" : ""
                    }`}
                  >
                    {o.news2_score}
                  </td>
                  <td className="px-3 py-1.5 text-muted">{o.recorder_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* ---- drug chart ---- */}
      {chart.length > 0 ? (
        <div className="mt-3">
          <h3 className="text-xs font-semibold tracking-[0.08em] uppercase text-muted">Drug chart, today</h3>
          <table className="w-full text-sm bg-white border border-line rounded mt-2">
            <tbody>
              {chart.map((d) => (
                <tr key={d.id} className="border-t border-line first:border-t-0">
                  <td className="px-3 py-1.5 tnum text-muted w-16">{d.due_at.slice(11, 16)}</td>
                  <td className="px-3 py-1.5">{d.product_name}</td>
                  <td className="px-3 py-1.5 text-muted">{d.dose}</td>
                  <td className="px-3 py-1.5 text-right text-xs">
                    {d.given_at ? (
                      <span className="text-good">given {d.given_at.slice(11, 16)} · {d.giver_name}</span>
                    ) : d.omitted_reason ? (
                      <span className="text-clock">omitted — {d.omitted_reason}</span>
                    ) : (
                      <span className="text-muted">not signed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* ---- move and discharge ---- */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <form action={transferAction} className="bg-white border border-line rounded px-4 py-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="admissionId" value={admission.id} />
          <label className="text-xs text-muted">
            Move to
            <select
              name="toBedCode"
              disabled={freeBeds.length === 0}
              className="block border border-line rounded px-2 py-1.5 text-sm bg-white"
            >
              {freeBeds.length === 0 ? (
                <option value="">no bed this patient can occupy</option>
              ) : (
                freeBeds.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))
              )}
            </select>
          </label>
          <label className="text-xs text-muted flex-1 min-w-[8rem]">
            Why
            <input name="reason" required className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white" />
          </label>
          <button type="submit" className="border border-line font-semibold rounded px-3 py-2 text-sm">
            Transfer
          </button>
        </form>

        {canDischarge ? (
          <form action={dischargeAction} className="bg-white border border-line rounded px-4 py-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="admissionId" value={admission.id} />
            <label className="text-xs text-muted">
              Outcome
              <select name="type" className="block border border-line rounded px-2 py-1.5 text-sm bg-white">
                <option value="home">Home</option>
                <option value="referred">Referred</option>
                <option value="against_advice">Against advice</option>
                <option value="absconded">Absconded</option>
                <option value="died">Died</option>
              </select>
            </label>
            <label className="text-xs text-muted flex-1 min-w-[12rem]">
              Discharge summary
              <input
                name="summary"
                required
                placeholder="What happened, and what happens next"
                className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white"
              />
            </label>
            <button type="submit" className="bg-good text-white font-semibold rounded px-4 py-2 text-sm">
              Discharge
            </button>
          </form>
        ) : null}
      </div>
    </Section>
  );
}
