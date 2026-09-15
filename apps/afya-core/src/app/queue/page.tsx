import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import { queue, vitalsFor, show } from "@/lib/frontdesk.ts";
import { resolvePatient } from "@/lib/patients.ts";
import { Shell } from "@/app/_components/shell.tsx";
import { setPriorityAction, recordVitalsAction, seeNextAction, closeVisitAction } from "./actions.ts";

/**
 * The waiting list, in the order people should be seen.
 *
 * Priority first, then waiting time — the sort is the clinical decision, and it
 * is the screen's whole reason to exist.
 */
export default async function QueuePage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const waiting = queue(user.facilityId);
  const canTriage = can(user.userId, "triage.record");
  const canConsult = can(user.userId, "encounter.conduct");

  const tone: Record<string, string> = {
    emergency: "bg-block-soft text-block border-block/25",
    urgent: "bg-clock-soft text-clock border-clock/25",
    routine: "bg-white text-ink border-line",
  };

  return (
    <Shell
      user={user}
      current="/queue"
      title="Waiting"
      subtitle={`${waiting.length} in the queue · ${waiting.filter((v) => v.priority === "emergency").length} emergency`}
      actions={
        <Link href="/appointments" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
          Appointments
        </Link>
      }
    >

      {waiting.length === 0 ? (
        <p className="mt-6 text-sm text-muted">
          Nobody is waiting. Check a patient in from their record.
        </p>
      ) : (
        <ul className="mt-5 flex flex-col gap-2">
          {waiting.map((visit) => {
            const patient = resolvePatient(visit.patient_mrn);
            const vitals = vitalsFor(visit.id)[0];
            const waited = Math.round((Date.now() - Date.parse(visit.checked_in_at)) / 60_000);

            return (
              <li key={visit.id} className={`border rounded px-4 py-3 ${tone[visit.priority]}`}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-xs font-bold tnum">{visit.token}</span>
                  <Link
                    href={`/patients/${encodeURIComponent(visit.patient_mrn)}`}
                    className="font-semibold underline underline-offset-2"
                  >
                    {patient ? `${patient.given_name} ${patient.family_name}` : visit.patient_mrn}
                  </Link>
                  <span className="text-xs uppercase font-semibold tracking-wide">{visit.priority}</span>
                  <span className="text-sm tnum ml-auto">waiting {waited} min</span>
                </div>

                {vitals ? (
                  <p className="text-sm mt-1 tnum opacity-80">
                    {[
                      show.temp(vitals.temp_tenths_c),
                      show.bp(vitals.systolic_mmhg, vitals.diastolic_mmhg),
                      vitals.pulse_bpm ? `${vitals.pulse_bpm} bpm` : null,
                      vitals.spo2_percent ? `SpO₂ ${vitals.spo2_percent}%` : null,
                    ]
                      .filter((x) => x && x !== "—")
                      .join(" · ")}
                  </p>
                ) : canTriage ? (
                  <form action={recordVitalsAction} className="mt-2 flex flex-wrap items-end gap-1.5">
                    <input type="hidden" name="visitId" value={visit.id} />
                    {[
                      ["tempC", "Temp °C", "38.9"],
                      ["systolic", "Sys", "120"],
                      ["diastolic", "Dia", "80"],
                      ["pulse", "Pulse", "88"],
                      ["spo2", "SpO₂", "98"],
                    ].map(([name, label, placeholder]) => (
                      <label key={name} className="flex flex-col gap-0.5 text-[11px] font-medium">
                        {label}
                        <input
                          id={`${visit.id}-${name}`}
                          name={name}
                          inputMode="decimal"
                          placeholder={placeholder}
                          className="border border-line rounded px-2 py-1 bg-white text-sm w-20"
                        />
                      </label>
                    ))}
                    <button type="submit" className="border border-line bg-white rounded px-3 py-1.5 text-sm">
                      Save vitals
                    </button>
                  </form>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {canTriage
                    ? (["emergency", "urgent", "routine"] as const)
                        .filter((p) => p !== visit.priority)
                        .map((p) => (
                          <form key={p} action={setPriorityAction}>
                            <input type="hidden" name="visitId" value={visit.id} />
                            <input type="hidden" name="priority" value={p} />
                            <button type="submit" className="text-xs border border-current/30 rounded px-2 py-1 bg-white/60">
                              Set {p}
                            </button>
                          </form>
                        ))
                    : null}

                  {canConsult ? (
                    <form action={seeNextAction} className="ml-auto">
                      <input type="hidden" name="visitId" value={visit.id} />
                      <input type="hidden" name="mrn" value={visit.patient_mrn} />
                      <button type="submit" className="bg-brand text-white font-semibold rounded px-3 py-1.5 text-sm">
                        See now
                      </button>
                    </form>
                  ) : (
                    <form action={closeVisitAction} className="ml-auto">
                      <input type="hidden" name="visitId" value={visit.id} />
                      <button type="submit" className="text-xs border border-line bg-white rounded px-2 py-1">
                        Mark done
                      </button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}
