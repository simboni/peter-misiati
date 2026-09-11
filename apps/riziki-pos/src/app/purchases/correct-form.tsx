"use client";

/**
 * Putting right what a delivery was charged.
 *
 * Folded away, because a delivery recorded properly needs nothing done to it
 * and every row on this screen would otherwise carry a form. Open, it shows
 * what each line was charged BEFORE transport — which is what the owner has on
 * the delivery note in front of them, and not the landed figure the row above
 * prints.
 *
 * Only money. The quantities are not here and cannot be changed from here: the
 * same drums arrived whatever they cost, and correcting what ARRIVED is a stock
 * take, which is a counted fact with a reason against it.
 */

import { useActionState, useState } from "react";
import { Alert, Button, inputClassBase } from "@/components/ui";
import { formatQty } from "@/lib/units";
import { correctPricesAction, type CorrectState } from "./correct-action";

const EMPTY: CorrectState = {};

export interface CorrectLine {
  lineId: number;
  itemName: string;
  qtyMilli: number;
  unit: string;
  /** What the supplier charged for this line before transport, in shillings. */
  goods: string;
}

export function CorrectForm({
  purchaseId,
  lines,
  transport,
}: {
  purchaseId: number;
  lines: CorrectLine[];
  /** Transport on the whole delivery, in shillings. */
  transport: string;
}) {
  const [state, action, pending] = useActionState(correctPricesAction, EMPTY);
  const [open, setOpen] = useState(false);

  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="mt-1 inline-flex min-h-11 cursor-pointer list-none items-center text-[11px] font-bold text-brand xl:min-h-8">
        {open ? "▾" : "▸"} Correct what it cost
      </summary>

      <form action={action} className="mt-1.5 space-y-2 rounded-xl border border-line bg-wash/60 p-2.5">
        <input type="hidden" name="purchaseId" value={purchaseId} />

        {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
        {state.ok ? <Alert tone="good">{state.ok}</Alert> : null}

        <p className="text-[11px] text-muted">
          What the supplier charged, before transport. The quantities stay as they are — to
          change what arrived, do a stock take.
        </p>

        {lines.map((l) => (
          <label key={l.lineId} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">
              {l.itemName}
              <span className="ml-1 font-normal text-muted tnum">
                {formatQty(l.qtyMilli, l.unit)}
              </span>
            </span>
            <span className="text-[11px] text-muted">KES</span>
            <input
              className={`${inputClassBase} w-28 !py-1.5 text-right text-sm tnum`}
              type="text"
              inputMode="decimal"
              name={`line:${l.lineId}`}
              defaultValue={l.goods}
              aria-label={`What ${l.itemName} cost, before transport`}
            />
          </label>
        ))}

        <label className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <span className="min-w-0 flex-1 text-[11px] font-semibold text-muted">
            Transport on the whole delivery
          </span>
          <span className="text-[11px] text-muted">KES</span>
          <input
            className={`${inputClassBase} w-28 !py-1.5 text-right text-sm tnum`}
            type="text"
            inputMode="decimal"
            name="transport"
            defaultValue={transport}
            aria-label="Transport on the whole delivery"
          />
        </label>

        <Button type="submit" variant="ghost" className="w-full !min-h-10" disabled={pending}>
          {pending ? "Putting it right…" : "Save the corrected prices"}
        </Button>
      </form>
    </details>
  );
}
