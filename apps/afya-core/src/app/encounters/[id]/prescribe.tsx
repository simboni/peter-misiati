"use client";

import { useActionState } from "react";
import { prescribeAction, type PrescribeState } from "../actions.ts";

const box = "border border-line rounded px-3 py-2 bg-white text-sm w-full";

/**
 * Prescribing, inside the consultation.
 *
 * A blocking warning appears here with the form still filled in, so the
 * prescriber answers it in place. Advisory warnings sit quietly above the form
 * and never take a click to clear — that distinction is the whole defence
 * against alert fatigue.
 */
export default function PrescribeForm({
  encounterId,
  products,
}: {
  encounterId: string;
  products: { code: string; label: string; controlled: boolean }[];
}) {
  const [state, action, pending] = useActionState<PrescribeState, FormData>(prescribeAction, {});
  const v = state.values ?? {};

  /*
    Remount the whole form after a successful prescription.

    Without this the fields keep what was typed — including an override reason
    from a blocked attempt — and the next prescription inherits it. The domain
    drops a stale override, but a form that silently carries one forward is
    still lying to the prescriber about what they are submitting.
  */
  const formKey = state.blocked?.length ? "blocked" : `fresh-${state.advice ? "a" : "b"}-${v.productCode ?? ""}`;

  return (
    <form key={formKey} action={action} className="mt-3 bg-white border border-line rounded p-3 flex flex-col gap-3">
      <input type="hidden" name="encounterId" value={encounterId} />

      {state.advice?.length ? (
        <ul className="flex flex-col gap-1">
          {state.advice.map((a) => (
            <li key={a} className="text-sm text-muted border-l-2 border-line pl-2">{a}</li>
          ))}
        </ul>
      ) : null}

      {state.blocked?.length ? (
        <div className="bg-block-soft border border-block/25 rounded p-3">
          {state.blocked.map((b) => (
            <p key={b} className="text-sm font-semibold text-block">{b}</p>
          ))}
          <label className="flex flex-col gap-1 mt-2 text-sm font-medium text-block" htmlFor="overrideReason">
            To prescribe anyway, record why
            <input
              id="overrideReason"
              name="overrideReason"
              required
              className={box}
              placeholder="This becomes a permanent part of the record"
            />
          </label>
        </div>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm bg-block-soft text-block border border-block/25 rounded px-3 py-2">
          {state.error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2" htmlFor="productCode">
          Medicine
          <select
            id="productCode"
            name="productCode"
            key={`prod-${v.productCode ?? ""}`}
            defaultValue={v.productCode ?? ""}
            required
            className={box}
          >
            <option value="" disabled>Choose…</option>
            {products.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}{p.controlled ? " — controlled" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="dose">
          Dose
          <input id="dose" key={`dose-${v.dose ?? ""}`} name="dose" required defaultValue={v.dose} placeholder="500 mg" className={box} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="frequency">
          Frequency
          <input id="frequency" key={`frequency-${v.frequency ?? ""}`} name="frequency" required defaultValue={v.frequency} placeholder="three times daily" className={box} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="quantity">
          Quantity
          <input id="quantity" key={`quantity-${v.quantity ?? ""}`} name="quantity" type="number" min="1" step="1" required defaultValue={v.quantity} className={box} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="durationDays">
          Days <span className="font-normal text-muted">(optional)</span>
          <input id="durationDays" key={`durationDays-${v.durationDays ?? ""}`} name="durationDays" type="number" min="1" step="1" defaultValue={v.durationDays} className={box} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2" htmlFor="instructions">
          Instructions <span className="font-normal text-muted">(optional)</span>
          <input id="instructions" key={`instructions-${v.instructions ?? ""}`} name="instructions" defaultValue={v.instructions} placeholder="after food" className={box} />
        </label>
      </div>

      <button
        type="submit"
        disabled={pending}
        className={`font-semibold rounded px-4 py-2.5 text-sm disabled:opacity-60 ${
          state.blocked?.length ? "bg-block text-white" : "border border-brand text-brand"
        }`}
      >
        {pending ? "Adding…" : state.blocked?.length ? "Prescribe anyway" : "Add prescription"}
      </button>
    </form>
  );
}
