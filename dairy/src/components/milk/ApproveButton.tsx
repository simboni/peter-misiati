"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/dal";
import { Button } from "@/components/ui";

type ApproveAction = (prev: unknown, formData: FormData) => Promise<ActionResult<{ id: string }>>;

/**
 * "Checked" is the manager's half of R10 — the record stands as the herdsman
 * entered it, and the approval is a separate, attributed fact.
 */
export function ApproveButton({ recordId, action }: { recordId: string; action: ApproveAction }) {
  const [state, formAction] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    async (prev, formData) => action(prev, formData),
    null,
  );

  if (state?.ok) {
    return <span className="text-sm font-medium text-ok">✓ Checked</span>;
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="recordId" value={recordId} />
      <Inner />
      {state && !state.ok ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

function Inner() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? "…" : "Checked"}
    </Button>
  );
}
