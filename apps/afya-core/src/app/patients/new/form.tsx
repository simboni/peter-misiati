"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerPatientAction, type RegisterState } from "../actions.ts";

const field = "border border-line rounded px-3 py-2.5 bg-white w-full";
const label = "flex flex-col gap-1.5 text-sm font-medium";

export default function RegisterForm() {
  const [state, action, pending] = useActionState<RegisterState, FormData>(registerPatientAction, {});
  const v = state.values ?? {};

  return (
    <form action={action} className="mt-5 flex flex-col gap-4">
      {/* Possible duplicates: shown before anything is created, never merged. */}
      {state.candidates?.length ? (
        <div className="bg-clock-soft border border-clock/25 rounded p-4">
          <h2 className="text-sm font-bold text-clock">
            {state.candidates.length === 1 ? "This may already be registered" : "These may already be registered"}
          </h2>
          <p className="text-sm text-clock mt-1 leading-relaxed">
            Open the existing record if it is the same person. Registering again splits their history in two.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {state.candidates.map((c) => (
              <li key={c.mrn} className="bg-white border border-line rounded px-3 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <Link
                    href={`/patients/${encodeURIComponent(c.mrn)}`}
                    className="font-semibold text-brand underline underline-offset-2"
                  >
                    {c.name}
                  </Link>
                  <span className="text-xs text-muted tnum">{c.mrn}</span>
                  <span className="ml-auto text-xs font-semibold tnum">{c.score}%</span>
                </div>
                <div className="text-sm text-muted mt-0.5 tnum">{c.detail}</div>
                <div className="text-xs text-muted mt-0.5">{c.reasons.join(", ")}</div>
              </li>
            ))}
          </ul>
          <button
            type="submit"
            name="confirmNew"
            value="yes"
            className="mt-3 border border-clock text-clock font-semibold rounded px-3 py-2 text-sm"
          >
            None of these — this is a different person
          </button>
        </div>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm bg-block-soft text-block border border-block/25 rounded px-3 py-2">
          {state.error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className={label} htmlFor="givenName">
          Given name
          <input id="givenName" name="givenName" required defaultValue={v.givenName} className={field} />
        </label>
        <label className={label} htmlFor="familyName">
          Family name
          <input id="familyName" name="familyName" required defaultValue={v.familyName} className={field} />
        </label>
        <label className={label} htmlFor="sex">
          Sex
          {/* Keyed so React remounts it when the server echoes a value back:
              `defaultValue` alone does not update an input that is already
              mounted, and a receptionist re-picking sex after every duplicate
              check is exactly the friction that gets a system worked around. */}
          <select
            id="sex"
            name="sex"
            key={`sex-${v.sex ?? ""}`}
            required
            defaultValue={v.sex ?? ""}
            className={field}
          >
            <option value="" disabled>Choose…</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="intersex">Intersex</option>
          </select>
        </label>
        <label className={label} htmlFor="dateOfBirth">
          Date of birth
          <input
            id="dateOfBirth"
            name="dateOfBirth"
            type="date"
            key={`dob-${v.dateOfBirth ?? ""}`}
            defaultValue={v.dateOfBirth}
            className={field}
          />
          <span className="flex items-center gap-2 font-normal text-sm text-muted">
            <input
              id="dobEstimated"
              name="dobEstimated"
              type="checkbox"
              key={`est-${v.dobEstimated ?? ""}`}
              defaultChecked={v.dobEstimated === "on"}
            />
            Estimated — the patient does not know
          </span>
        </label>
        <label className={label} htmlFor="nationalId">
          National ID
          <input id="nationalId" name="nationalId" inputMode="numeric" defaultValue={v.nationalId} className={field} />
        </label>
        <label className={label} htmlFor="shaNumber">
          SHA number
          <input id="shaNumber" name="shaNumber" defaultValue={v.shaNumber} className={field} />
        </label>
        <label className={label} htmlFor="phone">
          Phone
          <input id="phone" name="phone" inputMode="tel" placeholder="07…" defaultValue={v.phone} className={field} />
        </label>
        <label className={label} htmlFor="county">
          County
          <input id="county" name="county" defaultValue={v.county} className={field} />
        </label>
        <label className={label} htmlFor="village">
          Village / estate
          <input id="village" name="village" defaultValue={v.village} className={field} />
        </label>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="bg-brand text-white font-semibold rounded px-4 py-3 disabled:opacity-60"
      >
        {pending ? "Checking…" : state.candidates?.length ? "Check again" : "Register patient"}
      </button>
    </form>
  );
}
