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
import {
  Alert,
  Button,
  Card,
  Field,
  SectionLabel,
  Empty,
  inputClass,
  inputClassBase,
} from "@/components/ui";
import { formatQty, formatKes } from "@/lib/units";
import type { MixableRow, MixPlan } from "@/lib/mixing";
import { planMixAction, recordMixAction, type MixState } from "./actions";

const EMPTY: MixState = {};

/** Thousandths, from a typed decimal. */
const toMilli = (text: string) => Math.round((Number(text) || 0) * 1000);
const fromMilli = (milli: number) => String(Math.round(milli) / 1000);

export function MixClient({
  rows,
  /**
   * Open this recipe's card straight away.
   *
   * Set when the owner arrived from the recipe itself — having just said the
   * recipe is mixed in advance, the next thing they want is to mix it, and a
   * board that made them find it again would break that in two.
   */
  openFormulaId = null,
}: {
  rows: MixableRow[];
  openFormulaId?: number | null;
}) {
  const [openId, setOpenId] = useState<number | null>(
    openFormulaId ?? (rows.length === 1 ? rows[0].formulaId : null),
  );
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
          {row.outputPriceCents > 0 ? (
            <div className="text-[11px] font-semibold text-brand-dark tnum">
              sells at {formatKes(row.outputPriceCents)}/{row.outputUnit}
            </div>
          ) : null}
        </div>
      </button>

      {open ? <BatchForm row={row} /> : null}
    </Card>
  );
}

function BatchForm({ row }: { row: MixableRow }) {
  const [state, action, pending] = useActionState(recordMixAction, EMPTY);
  /*
    How the batch is said.

    The shop does not think "I am making 66 kg" — it thinks "two 23s and four
    5s", because those are the containers being filled. So the sizes the
    product is sold in are the primary control, each with a count, and the
    weight follows from them. `loose` is the way out for an odd batch, and the
    only control at all when a product has no sizes set.
  */
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [loose, setLoose] = useState(row.outputBundles.length ? "" : fromMilli(row.refSizeMilli));
  const [plan, setPlan] = useState<MixPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [used, setUsed] = useState<Record<number, string>>({});
  const [touchedUsed, setTouchedUsed] = useState(false);
  /**
   * What came out, when it was not what was set out to be made.
   *
   * Null means "the same as the batch above", which is the ordinary case and
   * saves the owner confirming a number they have just typed. A string means
   * they corrected it, and then it is theirs and the sizes stop moving it.
   */
  const [made, setMade] = useState<string | null>(null);

  /** What the size counts and the loose box come to, in thousandths. */
  const targetMilli = useMemo(() => {
    let total = toMilli(loose);
    for (const b of row.outputBundles) {
      const n = Math.max(0, Math.floor(Number(counts[b.id]) || 0));
      total += n * b.sizeMilli;
    }
    return total;
  }, [counts, loose, row.outputBundles]);

  /** What actually goes on the shelf: the correction if there is one, else the batch. */
  const madeMilli = made === null ? targetMilli : toMilli(made);

  /** And what it is worth at the prices the counter charges. */
  const worthCents = useMemo(() => {
    let total = 0;
    for (const b of row.outputBundles) {
      const n = Math.max(0, Math.floor(Number(counts[b.id]) || 0));
      total += n * b.priceCents;
    }
    // A loose remainder is worth its per-unit price, which is the only price
    // a quantity that is not a size can be sold at.
    total += Math.round((toMilli(loose) * row.outputPriceCents) / 1000);
    return total;
  }, [counts, loose, row.outputBundles, row.outputPriceCents]);

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
      /*
        The ingredient boxes follow the batch size until somebody types in one.

        Changing "two 23s" to "three" must move the concentrate with it, or the
        form would quietly propose the old quantity for a bigger batch. Once the
        owner has corrected a box by hand, that is a measurement and the arithmetic
        stops overwriting it.
      */
      if (!touchedUsed) {
        const seeded: Record<number, string> = {};
        for (const line of res.plan?.lines ?? []) {
          if (line.itemId !== null) seeded[line.itemId] = fromMilli(line.neededMilli);
        }
        setUsed(seeded);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [row.versionId, targetMilli, touchedUsed]);

  const shortLines = (plan?.lines ?? []).filter((l) => l.short || l.itemId === null);

  return (
    <div className="mt-3 border-t border-line pt-3">
      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {planError ? <Alert tone="warn">{planError}</Alert> : null}

      {/*
        A batch is rarely one batch.

        The shop mixes a drum in halves and then starts on the next, so the
        screen offers the next one rather than leaving the last one's numbers
        sitting there to be recorded twice by accident.
      */}
      {state.ok ? (
        <div className="space-y-2">
          <Alert tone="good">{state.ok}</Alert>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setCounts({});
              setLoose(row.outputBundles.length ? "" : fromMilli(row.refSizeMilli));
              setMade(null);
              setUsed({});
              setTouchedUsed(false);
            }}
          >
            Mix another batch
          </Button>
        </div>
      ) : null}

      <form action={action} className="mt-2 space-y-3.5">
        <input type="hidden" name="versionId" value={row.versionId} />
        <input type="hidden" name="targetMilli" value={targetMilli} />

        {/*
          How much is being made, said in the containers being filled.

          One row per size the product is sold in, each with a count and the
          price the counter charges for it. The weight and the money follow.
          A shop with no sizes set gets the plain weight box instead, which is
          also the way out for an odd batch.
        */}
        <div>
          <SectionLabel>How much are you making</SectionLabel>
          {row.outputBundles.length ? (
            <div className="space-y-2">
              {row.outputBundles.map((b) => {
                const n = Math.max(0, Math.floor(Number(counts[b.id]) || 0));
                return (
                  <div
                    key={b.id}
                    className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 ${
                      n > 0 ? "border-brand/40 bg-brand-soft" : "border-line bg-white"
                    }`}
                  >
                    <input
                      className={`${inputClassBase} w-16 shrink-0 !py-2 text-center tnum`}
                      inputMode="numeric"
                      value={counts[b.id] ?? ""}
                      placeholder="0"
                      onChange={(e) => {
                        setTouchedUsed(false);
                        setCounts((c) => ({
                          ...c,
                          [b.id]: e.target.value.replace(/[^\d]/g, ""),
                        }));
                      }}
                      aria-label={`How many ${formatQty(b.sizeMilli, row.outputUnit)} of ${row.outputName}`}
                    />
                    <span className="shrink-0 whitespace-nowrap text-sm font-bold">
                      × {formatQty(b.sizeMilli, row.outputUnit)}
                    </span>
                    <span className="hidden shrink-0 whitespace-nowrap text-xs text-muted sm:inline">
                      at {formatKes(b.priceCents)}
                    </span>
                    <span className="ml-auto whitespace-nowrap text-right text-sm font-semibold tnum">
                      {n > 0 ? (
                        <>
                          <span className="text-muted">
                            {formatQty(n * b.sizeMilli, row.outputUnit)}
                          </span>{" "}
                          <span className="text-brand-dark">{formatKes(n * b.priceCents)}</span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </span>
                  </div>
                );
              })}

              {/* The odd batch, and the remainder a set of sizes leaves over. */}
              <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-line bg-white px-3 py-2.5">
                <input
                  className={`${inputClassBase} w-20 shrink-0 !py-2 text-center tnum`}
                  inputMode="decimal"
                  value={loose}
                  placeholder="0"
                  onChange={(e) => {
                    setTouchedUsed(false);
                    setLoose(e.target.value.replace(/[^\d.]/g, ""));
                  }}
                  aria-label={`Any other quantity of ${row.outputName}, in ${row.outputUnit}`}
                />
                <span className="shrink-0 whitespace-nowrap text-sm font-bold">
                  {row.outputUnit} loose
                </span>
                <span className="ml-auto whitespace-nowrap text-xs text-muted">
                  at {formatKes(row.outputPriceCents)}/{row.outputUnit}
                </span>
              </div>
            </div>
          ) : (
            <Field
              label={`How big a batch, in ${row.outputUnit}`}
              hint={`The recipe is written for ${formatQty(row.refSizeMilli, row.unit)}. Set sizes on ${row.outputName} under Products & prices to fill it by the jerrican instead.`}
            >
              <input
                className={inputClass}
                inputMode="decimal"
                value={loose}
                onChange={(e) => {
                  setTouchedUsed(false);
                  setLoose(e.target.value.replace(/[^\d.]/g, ""));
                }}
              />
            </Field>
          )}

          {/*
            What the batch comes to, both ways round.

            The chemicals it eats and the money it will fetch, on one line and
            next to each other, because that is the decision: a batch that costs
            more than it sells for is worth knowing about before the drum is
            opened, not at the end of the month. The difference is only shown
            once both halves are known.
          */}
          <div className="mt-2 rounded-xl bg-sunken px-3.5 py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-bold">
                Making {formatQty(targetMilli, row.outputUnit)}
              </span>
              <span className="text-sm font-semibold tnum">
                worth <span className="text-brand-dark">{formatKes(worthCents)}</span>
              </span>
            </div>
            {plan && targetMilli > 0 ? (
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="text-muted tnum">
                  chemicals cost {formatKes(plan.totalCostCents)}
                </span>
                <span
                  className={`font-bold tnum ${
                    worthCents - plan.totalCostCents >= 0 ? "text-good" : "text-bad"
                  }`}
                >
                  {worthCents - plan.totalCostCents >= 0 ? "margin " : "loses "}
                  {formatKes(Math.abs(worthCents - plan.totalCostCents))}
                </span>
              </div>
            ) : null}
          </div>
        </div>

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
                        className={`${inputClassBase} w-28 shrink-0 !py-2 tnum`}
                        name={`used:${line.itemId}`}
                        inputMode="decimal"
                        value={used[line.itemId] ?? fromMilli(line.neededMilli)}
                        onChange={(e) => {
                          setTouchedUsed(true);
                          setUsed((u) => ({
                            ...u,
                            [line.itemId!]: e.target.value.replace(/[^\d.]/g, ""),
                          }));
                        }}
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

        {/*
          What actually landed.

          Seeded from the sizes above and typed over when the drum disagreed —
          which it will, because the shop mixes by eye. Water and anything else
          added but not counted is a note on the recipe rather than a line
          here: it has no cost and no shelf.
        */}
        <Field
          label={`What came out, in ${row.outputUnit}`}
          hint={`Goes on the shelf as ${row.outputName}. Type what the drum actually gave, if it was not what you set out to make.`}
        >
          <input
            className={inputClass}
            name="made"
            inputMode="decimal"
            value={made ?? fromMilli(targetMilli)}
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
            {formatQty(madeMilli, row.outputUnit)} of {row.outputName} on it.
          </p>
        ) : null}

        <Button
          type="submit"
          className="w-full"
          disabled={pending || !plan || shortLines.length > 0 || !(madeMilli > 0)}
        >
          {pending ? "Recording…" : "Record this batch"}
        </Button>
      </form>
    </div>
  );
}
