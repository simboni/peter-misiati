"use client";

import { useActionState } from "react";
import Link from "next/link";
import { SubmitButton } from "./submit-button";
import type { FormState } from "@/server/actions/auth";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export function AuthForm({ mode, action }: { mode: "login" | "signup"; action: Action }) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const isSignup = mode === "signup";

  return (
    <form action={formAction} className="space-y-4">
      {isSignup && (
        <div>
          <label className="label" htmlFor="name">
            Your name
          </label>
          <input id="name" name="name" className="input" placeholder="Jane Doe" required />
        </div>
      )}
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          placeholder="you@business.co.ke"
          autoComplete="email"
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          placeholder={isSignup ? "At least 8 characters" : "••••••••"}
          autoComplete={isSignup ? "new-password" : "current-password"}
          required
        />
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <SubmitButton className="btn-primary w-full" pendingText={isSignup ? "Creating…" : "Signing in…"}>
        {isSignup ? "Create account" : "Sign in"}
      </SubmitButton>

      <p className="text-center text-sm text-muted">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-brand-700 hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="font-semibold text-brand-700 hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
