"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/dal";
import { Button } from "@/components/ui";

type ApproveAction = (
  prev: unknown,
  formData: FormData,
) => Promise<ActionResult<{ id: string; balanceKes: number }>>;

/** Nothing staff recorded counts until this happens (R10). */
export function ApprovePaymentButton({ entryId, action }: { entryId: string; action: ApproveAction }) {
  const [state, formAction] = useActionState<ActionResult<{ id: string; balanceKes: number }> | null, FormData>(
    async (prev, formData) => action(prev, formData),
    null,
  );

  if (state?.ok) return <span className="text-sm font-medium text-ok">✓ Confirmed</span>;

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="entryId" value={entryId} />
      <Inner />
      {state && !state.ok ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

function Inner() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? "…" : "Confirm"}
    </Button>
  );
}
