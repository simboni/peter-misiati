"use client";

/**
 * Actual yield entry.
 *
 * The target is what we hoped for; this is what came out of the tank. Booking
 * finished stock at the target would invent inventory every single mix and hide
 * the spillage the owner is actually trying to see.
 */

import { useActionState } from "react";
import { Button, Alert, Field, inputClass } from "@/components/ui";

export type YieldState = { error?: string };

export interface OutputOption {
  id: number;
  name: string;
  suggested: boolean;
}

export function YieldForm({
  action,
  batchId,
  batchNo,
  targetLitres,
  outputs,
}: {
  action: (state: YieldState, formData: FormData) => Promise<YieldState>;
  batchId: number;
  batchNo: string;
  targetLitres: string;
  outputs: OutputOption[];
}) {
  const [state, formAction, pending] = useActionState(action, {} as YieldState);
  const suggested = outputs.find((o) => o.suggested);

  return (
    <form action={formAction} className="space-y-2.5">
      <input type="hidden" name="batchId" value={batchId} />

      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}

      <Field label="Litres actually produced" hint={`Target was ${targetLitres} L.`}>
        <input
          className={inputClass}
          type="number"
          name="actualLitres"
          min="0"
          step="0.001"
          inputMode="decimal"
          placeholder={targetLitres}
          aria-label={`Litres actually produced for batch ${batchNo}`}
          required
        />
      </Field>

      <Field label="Bottled as" hint="Leave as bulk if it has not been bottled yet.">
        <select className={inputClass} name="outputItemId" defaultValue={suggested?.id ?? 0}>
          <option value={0}>Bulk mix — not bottled</option>
          {outputs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.suggested ? " (suggested)" : ""}
            </option>
          ))}
        </select>
      </Field>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Record yield"}
      </Button>
    </form>
  );
}
