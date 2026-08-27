"use client";

/**
 * The four numbers behind a product row.
 *
 * A client component only so that a refusal can be answered where it happened.
 * The band rules are real and worth keeping — a price outside its own band
 * would refuse every sale at the asking price, which reads as the till being
 * broken — but they have to be argued with next to the box, not from the top
 * of a screen the owner has scrolled well past.
 *
 * So the boxes hold what was typed, the message lands under them, and the row
 * stays open with the numbers still in it. Correcting a refused price is then
 * one edit rather than: scroll back down, find the row, open it, retype all
 * four figures.
 */

import { useActionState, useState } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { savePricingAction, type PricingState } from "./actions";
import { BundleRows, type BundleRow } from "./bundle-rows";

const EMPTY: PricingState = {};

export default function PriceForm({
  itemId,
  per,
  reorderHint,
  price,
  floor,
  ceiling,
  reorder,
  unit,
  bundles,
}: {
  itemId: number;
  /** "per kg", or "each" — what the price is the price of. */
  per: string;
  reorderHint: string;
  price: number;
  floor: number;
  ceiling: number;
  reorder: number;
  /** kg, L or pcs — what a bundle's size is counted in. */
  unit: string;
  /** The sizes this is also sold in, as they stand. */
  bundles: BundleRow[];
}) {
  const [state, action, pending] = useActionState(savePricingAction, EMPTY);

  // Seeded from the shelf, then owned here — which is the whole point: a
  // refused save must not take the typed figures down with it.
  const [priceText, setPriceText] = useState(num(price));
  const [floorText, setFloorText] = useState(num(floor));
  const [ceilingText, setCeilingText] = useState(num(ceiling));
  const [reorderText, setReorderText] = useState(num(reorder));
  const [bundleRows, setBundleRows] = useState<BundleRow[]>(bundles);

  return (
    <form action={action} className="space-y-2.5">
      <input type="hidden" name="itemId" value={itemId} />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Field label={`Price ${per}`} hint="What the shop asks.">
          <Money name="price" label={`Price ${per}`} value={priceText} onValue={setPriceText} />
        </Field>
        <Field label="Never below" hint="Under this needs your PIN. Blank for no floor.">
          <Money name="floor" label="Never below" value={floorText} onValue={setFloorText} />
        </Field>
        <Field label="Never beyond" hint="Over this needs your PIN. Blank for no ceiling.">
          <Money name="ceiling" label="Never beyond" value={ceilingText} onValue={setCeilingText} />
        </Field>
        <Field label="Warn me at" hint={reorderHint}>
          <Money name="reorder" label="Warn me at" value={reorderText} onValue={setReorderText} />
        </Field>
      </div>

      {/*
        The sizes, under the price they are measured against.

        Folded away by default: most of the catalogue has no bundles, and an
        empty editor open on every row would make a hundred-row screen twice as
        long for nothing. Open already when there are some, because then it is
        the thing being looked for.
      */}
      <details open={bundleRows.length > 0}>
        <summary className="cursor-pointer text-[13px] font-bold text-brand-dark">
          Bundles{bundleRows.length ? ` (${bundleRows.length})` : ""} ▾
        </summary>
        <p className="mb-2 mt-1.5 text-[11px] leading-relaxed text-muted">
          Sizes sold whole, at a price of their own — a 20 kg for a round number
          rather than twenty times the price above. Stock comes off the same
          place either way; this is a price, not a second shelf.
        </p>
        <BundleRows
          rows={bundleRows}
          onRows={setBundleRows}
          unit={unit}
          unitPriceCents={Math.round((Number(priceText) || 0) * 100)}
        />
      </details>

      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {/* Keyed on the save, so a second save says so again rather than
            leaving a tick from the first one standing. */}
        {!state.error && state.savedAt ? (
          <span key={state.savedAt} className="text-[12px] font-bold text-good">
            ✓ Saved
          </span>
        ) : null}
      </div>
    </form>
  );
}

/**
 * A money box that keeps what was typed.
 *
 * `type="number"` is deliberately not used: on a refused save it would silently
 * drop anything the browser considered invalid, and this is the one form where
 * the point is that nothing typed goes missing.
 */
function Money({
  name,
  label,
  value,
  onValue,
}: {
  name: string;
  label: string;
  value: string;
  onValue: (v: string) => void;
}) {
  return (
    <input
      className={`${inputClass} tnum`}
      name={name}
      inputMode="decimal"
      autoComplete="off"
      aria-label={label}
      value={value}
      onChange={(e) => {
        const raw = e.target.value;
        if (!/^\d*\.?\d*$/.test(raw)) return;
        onValue(raw);
      }}
    />
  );
}

/** Blank for nothing set, so an empty box reads as "no floor" and not "zero". */
function num(n: number): string {
  return n ? String(Number(n.toFixed(3))) : "";
}
