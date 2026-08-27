"use client";

/**
 * The sizes a mixed product is sold in.
 *
 * Carwash Shampoo is mixed to order, and the shop sells it as a 5 L, a 10 L and
 * a 20 L for round numbers that have nothing to do with adding up the chemicals
 * that go into it. This is where those are set.
 *
 * A separate form from the recipe itself, and deliberately so: editing a recipe
 * writes a NEW VERSION, because a batch has to be able to say exactly what went
 * into it. A price is not part of that record — changing what a 5 L costs is not
 * a change to how it is mixed — so putting the two on one button would produce a
 * new version of the recipe every time the price of soda ash moved.
 */

import { useActionState, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { BundleRows, type BundleRow } from "@/app/items/bundle-rows";
import type { BundleFormState } from "./bundle-action";

const EMPTY: BundleFormState = {};

export default function BundleForm({
  formulaId,
  bundles,
  action,
}: {
  formulaId: number;
  bundles: BundleRow[];
  action: (prev: BundleFormState, formData: FormData) => Promise<BundleFormState>;
}) {
  const [state, submit, pending] = useActionState(action, EMPTY);
  const [rows, setRows] = useState<BundleRow[]>(bundles);

  return (
    <form action={submit} className="space-y-2.5">
      <input type="hidden" name="formulaId" value={formulaId} />

      <p className="text-[12px] leading-relaxed text-muted">
        A size sold whole, at a price of its own. The counter charges this price;
        the chemicals below come off the shelf in the amounts the recipe asks
        for, and appear on the receipt as amounts with no money against them.
      </p>

      {/* No per-unit price to measure a saving against: a mixed product has no
          "loose" rate, so the rate per litre is all this can honestly show. */}
      <BundleRows rows={rows} onRows={setRows} unit="L" unitPriceCents={0} />

      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save sizes"}
        </Button>
        {!state.error && state.savedAt ? (
          <span key={state.savedAt} className="text-[12px] font-bold text-good">
            ✓ Saved
          </span>
        ) : null}
      </div>
    </form>
  );
}
