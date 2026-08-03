"use client";

/**
 * The client-side pieces the money, trading and payroll forms share.
 *
 * Nothing here imports from `@/server/*` or `@/lib/dal` — those pull
 * `server-only` into the client bundle. Server Actions arrive as props.
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
 * `useFormStatus` only reports on the form it is a CHILD of, so the submit
 * button is its own component. Pending state matters: on a 2G link a second
 * tap would otherwise send the entry twice.
 */
export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  tone = "primary",
}: {
  children: ReactNode;
  pendingLabel?: string;
  tone?: "primary" | "danger";
}) {
  const { pending } = useFormStatus();
  const bg = tone === "danger" ? "bg-danger" : "bg-brand";
  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-md ${bg} px-5 py-3 text-base font-semibold text-white disabled:opacity-50`}
    >
      <span aria-hidden>{pending ? "⏳" : "✓"}</span>
      {pending ? pendingLabel : children}
    </button>
  );
}

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
export function MoreFields({
  children,
  label = "More detail",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <details className="rounded-md border border-line bg-surface">
      <summary className="cursor-pointer px-3 py-3 text-sm font-medium">{label}</summary>
      <div className="space-y-4 border-t border-line p-3">{children}</div>
    </details>
  );
}

/** A labelled field. The label is always visible — placeholders are not labels. */
export function Field({
  label,
  hint,
  errors,
  children,
}: {
  label: string;
  hint?: ReactNode;
  errors?: string[];
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && !errors?.length ? (
        <span className="mt-1 block text-xs text-ink-3">{hint}</span>
      ) : null}
      <FieldError errors={errors} />
    </label>
  );
}

const CONTROL =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-base";

export function Text(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL} ${props.className ?? ""}`} />;
}

export function Money(props: React.InputHTMLAttributes<HTMLInputElement>) {
  // R5: money is NEVER prefilled from a previous entry.
  return (
    <input
      inputMode="decimal"
      type="number"
      step="0.01"
      min="0"
      {...props}
      className={`${CONTROL} ${props.className ?? ""}`}
    />
  );
}

export function Picker(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${CONTROL} ${props.className ?? ""}`} />;
}

/**
 * The confirmation card, modelled on the M-Pesa receipt — persistent and
 * re-viewable, never a toast that vanishes before the user has looked up (R6).
 */
export function ReceiptCard({
  title,
  lines,
  refCode,
  tone = "ok",
  children,
}: {
  title: string;
  lines: string[];
  refCode?: string;
  tone?: "ok" | "warn";
  children?: ReactNode;
}) {
  const border = tone === "warn" ? "border-brass" : "border-brand";
  const mark = tone === "warn" ? "!" : "✓";
  return (
    <div
      className={`rounded-lg border-l-4 ${border} border-y border-r border-line bg-surface p-4`}
      role="status"
    >
      <p className="font-semibold">
        <span aria-hidden className="mr-2">
          {mark}
        </span>
        {title}
      </p>
      <ul className="mt-2 space-y-1 text-sm text-ink-2">
        {lines.filter(Boolean).map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {refCode ? (
        <p className="mt-3 font-mono text-xs tracking-wider text-ink-3">Ref {refCode}</p>
      ) : null}
      {children}
    </div>
  );
}

/** KES for display, on the client where `@/lib/money` would be overkill. */
export function kesText(v: number, decimals = 0): string {
  return `KES ${v.toLocaleString("en-KE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
