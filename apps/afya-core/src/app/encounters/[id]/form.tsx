"use client";

import { useActionState } from "react";
import { saveConsultAction, type ConsultState } from "../actions.ts";

const box = "border border-line rounded px-3 py-2 bg-white w-full text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";

export default function ConsultForm({
  encounterId,
  mrn,
  closed,
  blockers,
  note,
}: {
  encounterId: string;
  mrn: string;
  closed: boolean;
  blockers: string[];
  note: { complaint: string; history: string; examination: string; assessment: string; plan: string };
}) {
  const [state, action, pending] = useActionState<ConsultState, FormData>(saveConsultAction, {});

  if (closed) {
    return (
      <section className="mt-6">
        <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-muted">Consultation note</h2>
        <dl className="mt-2 flex flex-col gap-px bg-line border border-line rounded overflow-hidden">
          {([["Complaint", note.complaint], ["History", note.history], ["Examination", note.examination],
             ["Assessment", note.assessment], ["Plan", note.plan]] as const).map(([term, value]) => (
            <div key={term} className="bg-white px-3 py-2">
              <dt className="text-xs text-muted">{term}</dt>
              <dd className={`text-sm mt-0.5 ${value ? "" : "text-muted italic"}`}>{value || "not recorded"}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }

  return (
    <form action={action} className="mt-6 flex flex-col gap-3">
      <input type="hidden" name="encounterId" value={encounterId} />
      <input type="hidden" name="mrn" value={mrn} />

      <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-muted">Consultation note</h2>

      <label className={label} htmlFor="complaint">
        Complaint
        <input id="complaint" name="complaint" defaultValue={note.complaint} className={box} />
      </label>
      <label className={label} htmlFor="history">
        History
        <textarea id="history" name="history" rows={2} defaultValue={note.history} className={box} />
      </label>
      <label className={label} htmlFor="examination">
        Examination
        <textarea id="examination" name="examination" rows={2} defaultValue={note.examination} className={box} />
      </label>
      <label className={label} htmlFor="assessment">
        Assessment
        <textarea id="assessment" name="assessment" rows={2} defaultValue={note.assessment} className={box} />
      </label>
      <label className={label} htmlFor="plan">
        Plan
        <textarea id="plan" name="plan" rows={2} defaultValue={note.plan} className={box} />
      </label>

      {state.error ? (
        <p role="alert" className="text-sm bg-clock-soft text-clock border border-clock/25 rounded px-3 py-2">
          {state.error}
          {state.saved ? " Your note has been saved." : ""}
        </p>
      ) : null}

      {!state.error && state.saved ? (
        <p role="status" className="text-sm bg-good-soft text-good border border-good/25 rounded px-3 py-2">
          Saved.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {/*
          Finish is the primary action: write up and close in one interaction.

          Deliberately NOT disabled by `blockers`. Those are computed on the
          server when the page rendered, before the clinician typed the
          assessment sitting in front of them — disabling on stale state means a
          doctor who has just written a full note finds the finish button dead
          and concludes the system is broken. The action re-checks readiness
          after saving and says exactly what is missing, so the note is never
          lost and the reason is never wrong.
        */}
        <button
          type="submit"
          name="finish"
          value="yes"
          disabled={pending}
          className="bg-brand text-white font-semibold rounded px-4 py-2.5 text-sm disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save and finish"}
        </button>
        <button type="submit" disabled={pending} className="border border-line rounded px-4 py-2.5 text-sm">
          Save, keep open
        </button>
      </div>

      {blockers.length > 0 && !state.saved ? (
        <p className="text-xs text-muted leading-relaxed">
          Still outstanding as of the last save: {blockers.join(" ")}
        </p>
      ) : null}
    </form>
  );
}
