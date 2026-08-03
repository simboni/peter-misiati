"use client";

/**
 * The small client-side pieces the herd forms share.
 *
 * Deliberately free of any import from `@/server/*` or `@/lib/dal`: those pull
 * `server-only` into the client bundle. Server Actions arrive here as props,
 * which is also what keeps the action definitions in one place.
 */
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/** Mirrors `ActionResult` from the DAL without importing a server-only module. */
export type Result<T> =
  | { ok: true; data: T; refCode?: string; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type FormAction<T> = (
  prev: Result<T> | null,
  formData: FormData,
) => Promise<Result<T>>;

/**
 * `useFormStatus` only reports the status of the form it is a CHILD of, so the
 * submit button has to be its own component. Pending state matters here: on a
 * 2G link a second tap would otherwise send the entry twice.
 */
export function SubmitButton({
  children,
  pendingLabel = "Saving…",
}: {
  children: ReactNode;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand px-5 py-3 text-base font-semibold text-white disabled:opacity-50"
    >
      <span aria-hidden>{pending ? "⏳" : "✓"}</span>
      {pending ? pendingLabel : children}
    </button>
  );
}

/** Field-level error text, keyed the same way the actions return it. */
export function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <span className="mt-1 block text-xs font-medium text-danger" role="alert">
      {errors[0]}
    </span>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="rounded-md border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm font-medium"
      role="alert"
    >
      <span aria-hidden className="mr-2">
        ⛔
      </span>
      {message}
    </div>
  );
}

/** Extra detail that must not add a field to the main screen (R1). */
export function MoreFields({ children, label = "More detail" }: { children: ReactNode; label?: string }) {
  return (
    <details className="rounded-md border border-line bg-surface">
      <summary className="cursor-pointer px-3 py-3 text-sm font-medium">{label}</summary>
      <div className="space-y-4 border-t border-line p-3">{children}</div>
    </details>
  );
}
