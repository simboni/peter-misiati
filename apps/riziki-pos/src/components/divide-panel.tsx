"use client";

/**
 * Break a jerrican open and fill smaller ones out of it.
 *
 * One sentence, laid out the way the yard says it:
 *
 *     Take  [1] × 23 kg          = 23 kg
 *     Fill  [4] × 5 kg           = 20 kg
 *           [3] × 1 kg           =  3 kg
 *     ─────────────────────────────────
 *     3 kg goes back in the drum
 *
 * The panel it replaces asked for the resulting COUNT of every size and left
 * the owner to work out that dividing a 23 into 5s means "minus one, plus
 * four". That is bookkeeping, not pouring, and it is the arithmetic this screen
 * exists to do for him.
 *
 * What will not go into a smaller container is not an error and is not lost:
 * 23 kg into four 5 kg jerricans leaves 3 kg, and it says so and puts it back
 * in the drum, which is where it goes in the yard.
 */

import { useActionState, useMemo, useState } from "react";
import { Alert, Button, inputClassBase } from "@/components/ui";
import { formatQty } from "@/lib/units";
import { divideAction, type DivideState } from "@/app/items/pack-actions";

const EMPTY: DivideState = {};

export interface DivideSize {
  bundleId: number;
  sizeMilli: number;
  filled: number;
}

export function DividePanel({
  itemId,
  unit,
  sizes,
}: {
  itemId: number;
  unit: string;
  sizes: DivideSize[];
}) {
  const [state, action, pending] = useActionState(divideAction, EMPTY);

  /*
    The biggest size that has anything standing in it, chosen for him.

    A shop that pours has one habit — break open the big one — and the picker is
    there for the day it is a 5 kg being split into 1 kg bottles, not to be
    answered every time.
  */
  const openable = useMemo(
    () => [...sizes].sort((a, b) => b.sizeMilli - a.sizeMilli),
    [sizes],
  );
  const [fromId, setFromId] = useState<number>(
    () => (openable.find((z) => z.filled > 0) ?? openable[0])?.bundleId ?? 0,
  );
  const [fromUnits, setFromUnits] = useState("1");
  const [into, setInto] = useState<Record<number, string>>({});

  const from = sizes.find((z) => z.bundleId === fromId) ?? null;
  const smaller = from ? sizes.filter((z) => z.sizeMilli < from.sizeMilli) : [];

  const nOf = (id: number) => Math.max(0, Math.floor(Number(into[id]) || 0));
  const takeN = Math.max(0, Math.floor(Number(fromUnits) || 0));
  const tookMilli = from ? takeN * from.sizeMilli : 0;
  const filledMilli = smaller.reduce((n, z) => n + nOf(z.bundleId) * z.sizeMilli, 0);
  const overMilli = filledMilli - tookMilli;

  const problem = !from
    ? "This product has no container sizes yet."
    : !smaller.length
      ? `${formatQty(from.sizeMilli, unit)} is the smallest size there is. Add a smaller one under Products & prices to pour into.`
      : takeN <= 0
        ? "Say how many you are opening."
        : takeN > from.filled
          ? `Only ${from.filled} × ${formatQty(from.sizeMilli, unit)} ${from.filled === 1 ? "is" : "are"} standing filled.`
          : filledMilli <= 0
            ? "Say what you are filling out of it."
            : overMilli > 0
              ? `That is ${formatQty(overMilli, unit)} more than comes out of it.`
              : null;

  return (
    <form action={action} className="space-y-2.5">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="from" value={fromId} />

      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="good">{state.ok}</Alert> : null}

      {/* Take — how many of which container is being opened. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-10 shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          Take
        </span>
        <input
          className={`${inputClassBase} w-16 shrink-0 !py-2 text-center tnum`}
          type="text"
          inputMode="numeric"
          name="fromUnits"
          value={fromUnits}
          onChange={(e) => setFromUnits(e.target.value.replace(/[^\d]/g, ""))}
          aria-label="How many containers are you opening"
        />
        <span className="shrink-0 text-sm font-bold">×</span>
        <select
          className={`${inputClassBase} min-w-0 flex-1 !py-2 text-sm font-bold`}
          value={fromId}
          onChange={(e) => {
            setFromId(Number(e.target.value));
            setInto({});
          }}
          aria-label="Which container are you opening"
        >
          {openable.map((z) => (
            <option key={z.bundleId} value={z.bundleId}>
              {formatQty(z.sizeMilli, unit)} — {z.filled} filled
            </option>
          ))}
        </select>
      </div>

      {/* Fill — one row per smaller size. */}
      {smaller.length ? (
        <div className="space-y-1.5">
          {smaller.map((z, i) => {
            const n = nOf(z.bundleId);
            return (
              <div key={z.bundleId} className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  {i === 0 ? "Fill" : ""}
                </span>
                <input
                  className={`${inputClassBase} w-16 shrink-0 !py-2 text-center tnum`}
                  type="text"
                  inputMode="numeric"
                  value={into[z.bundleId] ?? ""}
                  placeholder="0"
                  onChange={(e) =>
                    setInto((c) => ({
                      ...c,
                      [z.bundleId]: e.target.value.replace(/[^\d]/g, ""),
                    }))
                  }
                  aria-label={`How many ${formatQty(z.sizeMilli, unit)} are you filling`}
                />
                <input type="hidden" name={`into:${z.bundleId}`} value={n} />
                <span className="shrink-0 text-sm font-bold">
                  × {formatQty(z.sizeMilli, unit)}
                </span>
                <span className="ml-auto whitespace-nowrap text-xs tnum text-muted">
                  {n > 0 ? formatQty(n * z.sizeMilli, unit) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* What it comes to, and what is left over. */}
      <div className="flex items-baseline justify-between gap-3 rounded-xl bg-wash px-3 py-2 text-sm">
        {overMilli > 0 ? (
          <>
            <span className="text-muted">More than comes out of it</span>
            <span className="font-bold text-bad tnum">
              {formatQty(overMilli, unit)} over
            </span>
          </>
        ) : filledMilli <= 0 ? (
          /*
            At rest, before anything is typed. It used to run the arithmetic on
            an empty form and announce "23 kg back in the drum", which is a true
            sentence about a thing nobody has done and reads as a mistake.
          */
          <span className="text-muted">
            Say how many smaller ones you filled out of it.
          </span>
        ) : (
          <>
            <span className="text-muted">
              {formatQty(tookMilli, unit)} opened, {formatQty(filledMilli, unit)} filled
            </span>
            <span className="font-bold tnum">
              {tookMilli - filledMilli > 0
                ? `${formatQty(tookMilli - filledMilli, unit)} back in the drum`
                : "nothing left over"}
            </span>
          </>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={pending || !!problem}>
        {pending
          ? "Pouring…"
          : problem
            ? "Divide it"
            : `Divide ${takeN} × ${from ? formatQty(from.sizeMilli, unit) : ""}`}
      </Button>
      {problem && !pending ? <p className="text-xs text-muted">{problem}</p> : null}
    </form>
  );
}
