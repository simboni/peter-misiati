"use client";

import { useFormStatus } from "react-dom";

/** A small inline spinner shown while a form submission is in flight. */
function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z" />
    </svg>
  );
}

/**
 * A submit button that shows a spinner + "working" label and disables itself
 * while its form's server action runs — immediate loading feedback, and no
 * double-submits. Drop-in for any `<form action={...}>`.
 */
export function SubmitButton({
  children,
  className = "btn-primary",
  pendingText,
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending} data-pending={pending}>
      {pending ? (
        <>
          <Spinner />
          {pendingText ?? "Working…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}
