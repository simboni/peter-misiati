"use client";

/**
 * The mixing board.
 *
 * One recipe at a time, and the screen answers four questions in the order the
 * shop asks them:
 *
 *   what have I got     — the concentrate on the shelf, and how much mix it
 *                         could carry
 *   what am I making    — the batch size, seeded from the recipe, typed over
 *                         freely
 *   what goes in        — one line per ingredient, each a box, because the jug
 *                         is what happened and the arithmetic is only a guess
 *   what comes out      — the quantity that lands on the shelf
 *
 * The two quantities are boxes rather than figures on purpose. The shop
 * dilutes by eye with a hosepipe; a screen that prints 23.000 kg and refuses
 * anything else is a screen somebody works around, and the working-around is
 * what puts the ledger wrong.
 */

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Field, SectionLabel, Empty, inputClass } from "@/components/ui";
import { formatQty, formatKes } from "@/lib/units";
import type { MixableRow, MixPlan } from "@/lib/mixing";
import { planMixAction, recordMixAction, type MixState } from "./actions";

const EMPTY: MixState = {};

/** Thousandths, from a typed decimal. */
const toMilli = (text: string) => Math.round((Number(text) || 0) * 1000);
const fromMilli = (milli: number) => String(Math.round(milli) / 1000);

export function MixClient({ rows }: { rows: MixableRow[] }) {
  const [openId, setOpenId] = useState<number | null>(rows.length === 1 ? rows[0].formulaId : null);
  const chosen = rows.find((r) => r.formulaId === openId) ?? null;

  if (!rows.length) {
    return (
      <Card>
        <Empty>
          No recipe is mixed in advance yet.
        </Empty>
        <p className="mt-3 text-sm text-muted">
          Open a recipe under{" "}
          <Link href="/formulas" className="font-semibold text-brand">
            Recipes
          </Link>{" "}
          and set it to <span className="font-semibold">mixed in advance</span>, naming the product
          the batch makes. It will appear here.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <RecipeCard
          key={row.formulaId}
          row={row}
          open={openId === row.formulaId}
          onOpen={() => setOpenId(openId === row.formulaId ? null : row.formulaId)}
        />
      ))}
      {chosen ? null : (
        <p className="text-sm text-muted">Tap a recipe to mix a batch of it.</p>
      )}
    </div>
  );
}

function RecipeCard({
  row,
  open,
  onOpen,
}: {
  row: MixableRow;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <Card>
      {/*
        The head of the card is the answer to "have I got any", which is the
        question that brought the owner to this screen. It stays readable
        whether the batch form below is open or shut.
      */}
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold">{row.name}</div>
          <div className="mt-0.5 text-xs text-muted">
            makes <span className="font-semibold text-ink">{row.outputName}</span> ·{" "}
            {row.ingredientCount} chemical{row.ingredientCount === 1 ? "" : "s"}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
            on the shelf
          </div>
          <div className="text-lg font-extrabold tnum">
            {formatQty(row.outputOnHandMilli, row.outputUnit)}
          </div>
          <div className="text-[11px] text-muted">
            room for {formatQty(row.possibleMilli, row.unit)} more
          </div>
        </div>
      </button>

      {open ? <BatchForm row={row} /> : null}
    </Card>
  );
}

function BatchForm({ row }: { row: MixableRow }) {
  const [state, action, pending] = useActionState(recordMixAction, EMPTY);
  const [target, setTarget] = useState(fromMilli(row.refSizeMilli));
  const [plan, setPlan] = useState<MixPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [used, setUsed] = useState<Record<number, string>>({});
  const [made, setMade] = useState(fromMilli(row.refSizeMilli));

  const targetMilli = useMemo(() => toMilli(target), [target]);

  /*
    Re-price the batch whenever the size changes.

    Debounced, because this is a keystroke away from a server round trip and
    the owner types "2", "23", "230" on the way to what they meant.
  */
  useEffect(() => {
    if (!(targetMilli > 0)) return;
    let live = true;
    const t = setTimeout(async () => {
      const res = await planMixAction(row.versionId, targetMilli);
      if (!live) return;
      if (res.error) {
        setPlanError(res.error);
        setPlan(null);
        return;
      }
      setPlanError(null);
      setPlan(res.plan ?? null);
      // Seed the ingredient boxes from the plan, and the made box from the
      // size asked for. Anything the owner has already typed over stays.
      setUsed((prev) => {
        const next = { ...prev };
        for (const line of res.plan?.lines ?? []) {
          if (line.itemId !== null && next[line.itemId] === undefined) {
            next[line.itemId] = fromMilli(line.neededMilli);
          }
        }
        return next;
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [row.versionId, targetMilli]);

  const shortLines = (plan?.lines ?? []).filter((l) => l.short || l.itemId === null);

  return (
    <div className="mt-3 border-t border-line pt-3">
      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="good">{state.ok}</Alert> : null}
      {planError ? <Alert tone="warn">{planError}</Alert> : null}

      <form action={action} className="mt-2 space-y-3.5">
        <input type="hidden" name="versionId" value={row.versionId} />
        <input type="hidden" name="targetMilli" value={targetMilli} />

        <Field
          label={`How big a batch, in ${row.unit}`}
          hint={`The recipe is written for ${formatQty(row.refSizeMilli, row.unit)}. Change it and the quantities below follow.`}
        >
          <input
            className={inputClass}
            inputMode="decimal"
            value={target}
            /*
              Changing the size clears what the last size suggested.

              Done here rather than in an effect on `target`: the suggestion is
              a consequence of this keystroke, not of the value settling, and
              deriving it in an effect makes React render twice for every digit
              typed.
            */
            onChange={(e) => {
              const next = e.target.value.replace(/[^\d.]/g, "");
              setTarget(next);
              setUsed({});
              setMade(next);
            }}
          />
        </Field>

        {/*
          How it is made, in the owner's own words.

          Above the quantities because it is read first and at the drum: it is
          where "bring it up to 23 kg with water" is written, and the water is
          the one part of the mix the system does not count and therefore
          cannot show anywhere else.
        */}
        {row.steps.trim() ? (
          <div className="rounded-xl bg-wash px-3.5 py-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
              How it is mixed
            </div>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{row.steps.trim()}</p>
          </div>
        ) : null}

        <div>
          <SectionLabel>What goes in</SectionLabel>
          {plan ? (
            <div className="space-y-2">
              {plan.lines.map((line) => (
                <div
                  key={`${line.chemicalId}`}
                  className={`rounded-xl border px-3 py-2.5 ${
                    line.short || line.itemId === null
                      ? "border-bad/40 bg-bad-soft"
                      : "border-line bg-white"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-bold">{line.itemName}</span>
                    <span className="shrink-0 text-[11px] text-muted">
                      {formatQty(line.availableMilli, line.unit)} in the store
                    </span>
                  </div>
                  {line.itemId === null ? (
                    <p className="mt-1 text-xs font-semibold text-bad">
                      Not stocked — add it under Products &amp; prices before mixing.
                    </p>
                  ) : (
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        className={`${inputClass} !py-2 max-w-32 tnum`}
                        name={`used:${line.itemId}`}
                        inputMode="decimal"
                        value={used[line.itemId] ?? fromMilli(line.neededMilli)}
                        onChange={(e) =>
                          setUsed((u) => ({
                            ...u,
                            [line.itemId!]: e.target.value.replace(/[^\d.]/g, ""),
                          }))
                        }
                        aria-label={`How much ${line.itemName} went in, in ${line.unit}`}
                      />
                      <span className="text-xs font-semibold text-muted">{line.unit}</span>
                      <span className="ml-auto text-xs text-muted tnum">
                        {formatKes(line.costCents)}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Working it out…</p>
          )}
        </div>

        {/* Water, and anything else that is added but not counted, is a note on
            the recipe rather than a line here — it has no cost and no shelf. */}
        <Field
          label={`What came out, in ${row.outputUnit}`}
          hint={`Goes on the shelf as ${row.outputName}. Type what the drum actually gave, not what the recipe said.`}
        >
          <input
            className={inputClass}
            name="made"
            inputMode="decimal"
            value={made}
            onChange={(e) => setMade(e.target.value.replace(/[^\d.]/g, ""))}
          />
        </Field>

        <Field label="Note" hint="Optional — anything about this batch worth remembering.">
          <input className={inputClass} name="note" autoComplete="off" />
        </Field>

        {shortLines.length ? (
          <Alert tone="bad">
            Not enough in the store to mix this:{" "}
            {shortLines.map((l) => l.itemName).join(", ")}. Record the delivery first, or mix a
            smaller batch.
          </Alert>
        ) : null}

        {plan && plan.canMake ? (
          <p className="text-xs text-muted">
            Takes {formatKes(plan.totalCostCents)} of stock off the shelf and puts{" "}
            {formatQty(toMilli(made), row.outputUnit)} of {row.outputName} on it.
          </p>
        ) : null}

        <Button
          type="submit"
          className="w-full"
          disabled={pending || !plan || shortLines.length > 0 || !(toMilli(made) > 0)}
        >
          {pending ? "Recording…" : "Record this batch"}
        </Button>
      </form>
    </div>
  );
}
