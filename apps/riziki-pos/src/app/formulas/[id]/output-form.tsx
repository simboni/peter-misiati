"use client";

/**
 * How this recipe reaches the customer: mixed to order, or mixed in advance.
 *
 * The most consequential switch on the screen, so it is written as a choice
 * between two ways of working rather than as a product picker with a label. An
 * owner reading it should be able to tell which one his shop actually does
 * without knowing the words "phantom" or "bill of materials".
 *
 * The trade is stated on the face of it, both ways round, because both have a
 * real cost and the shop is the one qualified to choose. Mixed to order asks
 * nobody to remember anything and cannot tell you what is in the bucket; mixed
 * in advance tells you exactly what is in the bucket and stops the counter
 * selling it if somebody forgets to record the batch.
 */

import { useActionState, useState } from "react";
import Link from "next/link";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { saveFormulaOutput, type OutputFormState } from "./output-action";

const EMPTY: OutputFormState = {};

export interface OutputChoice {
  id: number;
  name: string;
  unit: string;
}

export function OutputForm({
  formulaId,
  outputItemId,
  choices,
}: {
  formulaId: number;
  /** What it makes today, or null when it is billed at the counter. */
  outputItemId: number | null;
  /** Products that could be the thing this recipe makes. */
  choices: OutputChoice[];
}) {
  const [state, action, pending] = useActionState(saveFormulaOutput, EMPTY);
  // Held locally so the two panels swap the moment the radio is tapped, rather
  // than after a round trip — the explanation under each is the whole point of
  // the control, and it should answer while the owner is still deciding.
  const [inAdvance, setInAdvance] = useState(outputItemId !== null);
  const [picked, setPicked] = useState(outputItemId ? String(outputItemId) : "");

  return (
    <form action={action} className="space-y-3.5">
      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {state.ok ? (
        <div className="space-y-2">
          <Alert tone="good">{state.ok}</Alert>
          {/* The next thing they want, offered rather than described. Saving
              this switch is never the errand — mixing a batch is. */}
          {inAdvance && picked ? (
            <a
              href="#mix-a-batch"
              className="flex min-h-11 w-full items-center justify-center rounded-full bg-brand px-4 text-sm font-bold text-white hover:bg-brand-dark"
            >
              Proceed to mix →
            </a>
          ) : null}
        </div>
      ) : null}

      <input type="hidden" name="formulaId" value={formulaId} />
      {/* The picker is only submitted on the "in advance" branch; the other
          branch submits an empty string, which the action reads as "clear it". */}
      <input type="hidden" name="outputItemId" value={inAdvance ? picked : ""} />

      <div className="grid gap-2.5">
        <label
          className={`flex cursor-pointer gap-3 rounded-2xl border px-3.5 py-3 ${
            inAdvance ? "border-line bg-white" : "border-brand bg-brand-soft"
          }`}
        >
          <input
            type="radio"
            name="how"
            className="mt-1 h-4 w-4 shrink-0"
            checked={!inAdvance}
            onChange={() => setInAdvance(false)}
          />
          <span className="text-sm">
            <span className="block font-bold">Mixed to order</span>
            <span className="mt-0.5 block text-xs text-muted">
              The counter sells a size and the chemicals come off the shelf at that moment.
              Nothing to remember, and no stock figure for the mix — because until somebody
              buys it, there is none.
            </span>
          </span>
        </label>

        <label
          className={`flex cursor-pointer gap-3 rounded-2xl border px-3.5 py-3 ${
            inAdvance ? "border-brand bg-brand-soft" : "border-line bg-white"
          }`}
        >
          <input
            type="radio"
            name="how"
            className="mt-1 h-4 w-4 shrink-0"
            checked={inAdvance}
            onChange={() => setInAdvance(true)}
          />
          <span className="text-sm">
            <span className="block font-bold">Mixed in advance</span>
            <span className="mt-0.5 block text-xs text-muted">
              You mix a batch on the{" "}
              <Link href="/mix" className="font-semibold text-brand">
                Mixing board
              </Link>{" "}
              and what it makes goes on the shelf as a product with its own count. The counter
              sells that, not the recipe. Somebody has to remember to record the batch — if they
              do not, the till will say there is none.
            </span>
          </span>
        </label>
      </div>

      {inAdvance ? (
        <Field
          label="What this recipe makes"
          hint="The product the batch puts on the shelf. Add it under Products & prices first if it is not here."
        >
          <select
            className={inputClass}
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
          >
            <option value="">Choose a product…</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (per {c.unit})
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending || (inAdvance && !picked)}>
        {pending ? "Saving…" : "Save how it is made"}
      </Button>
    </form>
  );
}
