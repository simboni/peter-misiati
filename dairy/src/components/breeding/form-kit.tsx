"use client";

/**
 * Client-side pieces the breeding forms share. Kept free of any import from
 * `@/server/*` — Server Actions arrive as props.
 */
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { Field, Select } from "@/components/ui";

export type Result<T> =
  | { ok: true; data: T; refCode?: string; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type FormAction<T> = (prev: Result<T> | null, formData: FormData) => Promise<Result<T>>;

export interface AnimalOption {
  id: string;
  label: string;
  detail?: string;
}

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
    <div className="rounded-md border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm font-medium" role="alert">
      <span aria-hidden className="mr-2">
        ⛔
      </span>
      {message}
    </div>
  );
}

export function MoreFields({ children, label = "More detail" }: { children: ReactNode; label?: string }) {
  return (
    <details className="rounded-md border border-line bg-surface">
      <summary className="cursor-pointer px-3 py-3 text-sm font-medium">{label}</summary>
      <div className="space-y-4 border-t border-line p-3">{children}</div>
    </details>
  );
}

/** One picker, used by every breeding screen so the first tap is always the same. */
export function AnimalPicker({
  animals,
  defaultValue,
  label = "Which cow",
  name = "animalId",
  errors,
}: {
  animals: AnimalOption[];
  defaultValue?: string;
  label?: string;
  name?: string;
  errors?: string[];
}) {
  return (
    <Field label={label}>
      <Select name={name} defaultValue={defaultValue ?? ""} required>
        <option value="" disabled>
          Choose…
        </option>
        {animals.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
            {a.detail ? ` — ${a.detail}` : ""}
          </option>
        ))}
      </Select>
      <FieldError errors={errors} />
    </Field>
  );
}
