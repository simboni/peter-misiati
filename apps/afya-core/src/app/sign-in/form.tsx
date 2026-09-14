"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "@/app/actions/session.ts";

export default function SignInForm({ facilities }: { facilities: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInAction, {});

  return (
    <form action={action} className="bg-white border border-line rounded-md p-5 flex flex-col gap-4">
      {facilities.length > 1 ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Facility</span>
          <select
            id="facilityId"
            name="facilityId"
            className="border border-line rounded px-3 py-2.5 bg-white"
            defaultValue={facilities[0]?.id}
          >
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="facilityId" value={facilities[0]?.id ?? 1} />
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Username</span>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          required
          className="border border-line rounded px-3 py-2.5"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Password</span>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="border border-line rounded px-3 py-2.5"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">
          Device code <span className="font-normal text-muted">(optional)</span>
        </span>
        <input
          id="deviceCode"
          name="deviceCode"
          placeholder="e.g. TAB1"
          autoCapitalize="characters"
          className="border border-line rounded px-3 py-2.5 uppercase"
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-sm bg-block-soft text-block border border-block/25 rounded px-3 py-2">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="bg-brand text-white font-semibold rounded px-4 py-3 disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
