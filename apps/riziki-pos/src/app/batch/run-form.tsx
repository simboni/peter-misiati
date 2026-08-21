"use client";

/**
 * The "Run batch" button.
 *
 * It carries nothing but the version, the target size and whether the mix is
 * blocked — no ingredient ever crosses to the client, because staff use this
 * screen too.
 */

import { useActionState } from "react";
import { Button, Alert } from "@/components/ui";

export type RunState = { error?: string };

export function RunBatchForm({
  action,
  versionId,
  targetMilli,
  blocked,
  blockedReason,
  batchNo,
}: {
  action: (state: RunState, formData: FormData) => Promise<RunState>;
  versionId: number;
  targetMilli: number;
  blocked: boolean;
  blockedReason: string | null;
  batchNo: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as RunState);

  return (
    <form action={formAction} className="mt-2.5 space-y-2">
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="targetMilli" value={targetMilli} />

      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {blocked && blockedReason ? <Alert tone="bad">{blockedReason}</Alert> : null}

      <Button type="submit" disabled={pending || blocked} className="w-full">
        {pending ? "Taking stock…" : "Run batch"}
      </Button>

      <p className="text-center text-xs text-muted">
        The chemicals come off the shelf now and the mix is numbered{" "}
        <span className="font-bold tnum">{batchNo}</span>. You enter the litres actually produced
        once it is finished.
      </p>
    </form>
  );
}
