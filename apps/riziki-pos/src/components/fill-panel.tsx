"use client";

/**
 * How the shelf is poured: one row per size, each a count you can check by
 * looking.
 *
 * The panel asks for the COUNT STANDING THERE, not the change. "There are four
 * 5 kg jerricans" is something the owner can verify with his eyes; "add three"
 * is something he has to work out first, and working it out is where a miscount
 * comes from. The difference against the tally is the computer's job.
 *
 * Minus and plus rather than the counter's tap-to-add chips, because this is an
 * adjustment of a number that already exists rather than a pile being built:
 * the shelf holds two jerricans and one was opened, so the act is "two becomes
 * one", not "start again and tap once". The box between them takes a typed
 * number for the day twenty bottles were filled at once.
 *
 * The loose line underneath is the check. It is what is left in the drum after
 * everything above it has been poured, and it goes red before it goes wrong —
 * a plan that would pour more than the shop holds is refused by the server, but
 * being told at the moment of typing is what stops the trip.
 */

import { useActionState, useMemo, useState } from "react";
import { Alert, Button, inputClassBase } from "@/components/ui";
import { formatQty } from "@/lib/units";
import { saveFillAction, type FillState } from "@/app/items/pack-actions";

const EMPTY: FillState = {};

export interface FillSize {
  bundleId: number;
  sizeMilli: number;
  filled: number;
}

export function FillPanel({
  itemId,
  itemName,
  unit,
  stockMilli,
  sizes,
  /** A heading, when the panel is not already under one. */
  title = null,
}: {
  itemId: number;
  itemName: string;
  unit: string;
  stockMilli: number;
  sizes: FillSize[];
  title?: string | null;
}) {
  const [state, action, pending] = useActionState(saveFillAction, EMPTY);
  const [counts, setCounts] = useState<Record<number, string>>(
    Object.fromEntries(sizes.map((s) => [s.bundleId, String(s.filled)])),
  );

  const nOf = (id: number) => Math.max(0, Math.floor(Number(counts[id]) || 0));
  const set = (id: number, n: number) =>
    setCounts((c) => ({ ...c, [id]: String(Math.max(0, n)) }));

  const packedMilli = useMemo(
    () => sizes.reduce((n, s) => n + nOf(s.bundleId) * s.sizeMilli, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [counts, sizes],
  );
  const looseMilli = stockMilli - packedMilli;
  const changed = sizes.some((s) => nOf(s.bundleId) !== s.filled);

  if (!sizes.length) {
    return (
      <p className="text-sm text-muted">
        {itemName} has no container sizes yet. Add the sizes it is filled into, under Products
        & prices, and they will appear here to be counted.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-2.5">
      <input type="hidden" name="itemId" value={itemId} />

      {title ? (
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          {title}
        </div>
      ) : null}

      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="good">{state.ok}</Alert> : null}

      <div className="space-y-1.5">
        {sizes.map((s) => {
          const n = nOf(s.bundleId);
          return (
            <div
              key={s.bundleId}
              className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 ${
                n > 0 ? "border-brand/40 bg-brand-soft" : "border-line bg-white"
              }`}
            >
              <span className="w-16 shrink-0 text-sm font-bold tnum">
                {formatQty(s.sizeMilli, unit)}
              </span>

              {/*
                Two big targets and a box between them. No long press and no
                drag: this is filled in beside a drum with wet hands, and a
                sustained touch is the gesture a wet screen loses halfway
                through.
              */}
              <button
                type="button"
                onClick={() => set(s.bundleId, n - 1)}
                disabled={n <= 0}
                aria-label={`One fewer ${formatQty(s.sizeMilli, unit)} filled`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-lg font-bold text-brand-dark ring-1 ring-inset ring-line disabled:text-muted disabled:opacity-50 xl:h-9 xl:w-9"
              >
                −
              </button>
              <input
                className={`${inputClassBase} w-14 shrink-0 !px-1 !py-1.5 text-center tnum`}
                type="text"
                inputMode="numeric"
                value={counts[s.bundleId] ?? "0"}
                onChange={(e) =>
                  setCounts((c) => ({
                    ...c,
                    [s.bundleId]: e.target.value.replace(/[^\d]/g, ""),
                  }))
                }
                aria-label={`How many ${formatQty(s.sizeMilli, unit)} are filled`}
              />
              <input type="hidden" name={`filled:${s.bundleId}`} value={n} />
              <button
                type="button"
                onClick={() => set(s.bundleId, n + 1)}
                aria-label={`One more ${formatQty(s.sizeMilli, unit)} filled`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-lg font-bold text-brand-dark ring-1 ring-inset ring-line xl:h-9 xl:w-9"
              >
                +
              </button>

              <span className="ml-auto whitespace-nowrap text-right text-xs tnum">
                {n > 0 ? (
                  <span className="font-semibold text-muted">
                    {formatQty(n * s.sizeMilli, unit)}
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* The check: what is left in the drum once everything above is poured. */}
      <div className="flex items-baseline justify-between gap-3 rounded-xl bg-wash px-3 py-2 text-sm">
        <span className="text-muted">
          Left loose in the drum
          <span className="text-muted"> of {formatQty(stockMilli, unit)} held</span>
        </span>
        <span className={`font-bold tnum ${looseMilli < 0 ? "text-bad" : "text-ink"}`}>
          {looseMilli < 0 ? "−" : ""}
          {formatQty(Math.abs(looseMilli), unit)}
        </span>
      </div>

      {looseMilli < 0 ? (
        <p className="text-xs font-semibold text-bad">
          That is {formatQty(-looseMilli, unit)} more than {itemName} holds. Open a container, or
          record what arrived first.
        </p>
      ) : null}

      <Button
        type="submit"
        className="w-full"
        variant="ghost"
        disabled={pending || !changed || looseMilli < 0}
      >
        {pending ? "Saving…" : changed ? "Save how it is poured" : "Nothing to save"}
      </Button>
    </form>
  );
}
