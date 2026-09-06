"use client";

/**
 * The mixing board: one screen, one batch.
 *
 * The screen it replaced was a form — eight stacked sections, four number
 * boxes, and `Record this batch` two and a half phone screens below the fold.
 * It printed the same batch three times over: once as row totals, again as
 * "Making 46 kg", again as "What came out", and a fourth time in a sentence
 * underneath. Every one of those was the same number said in a different voice.
 *
 * The insight that collapses it: the container counts are the ONLY thing the
 * owner actually knows. He does not think "I am making 46 kg" — he thinks "two
 * 23s", because two jerricans are what he filled. Everything else on the old
 * screen was arithmetic the system had already done and was then asking him to
 * confirm, which is not a check: a pre-filled box gets accepted unread, so it
 * bought no accuracy and cost most of the height.
 *
 * So the board is a calculator, not a form, and it has four zones:
 *
 *   1  which recipe, and how much of what it makes is on the shelf
 *   2  the sizes, as squares — tap one to add a jerrican, tap its badge to
 *      clear them. The same chip, and the same gesture, as the counter.
 *   3  what that will do: what comes off the shelf, what goes on it, the margin
 *   4  the button, with the batch written into its label
 *
 * Everything that only matters AFTER the drum is filled — what the jug actually
 * gave, what actually went in, a note — is folded behind "Adjust". It is one
 * disclosure, not a second screen, so nothing moves when it opens.
 *
 * Two things are deliberately NOT here. There is no confirm dialog: the owner
 * mixes several batches a day, a prompt he meets that often is a reflex tap
 * within a week, and a wet finger can satisfy a dialog exactly as easily as it
 * can trip the button underneath it. The screen itself is the confirmation —
 * every figure it will write is on it, changing under his hand, and the button
 * says the quantity it is about to commit. And there is no stepper minus: a
 * badge that clears the whole size is what somebody who tapped twice too many
 * wants, and it is what the counter already taught his hand.
 */

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Field, Empty, inputClass, inputClassBase } from "@/components/ui";
import { SizeChip } from "@/components/size-chip";
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
   * Open this recipe straight away.
   *
   * Set when the owner arrived from the recipe itself — having just said the
   * recipe is mixed in advance, the next thing he wants is to mix it, and a
   * board that made him find it again would break that in two.
   */
  openFormulaId = null,
}: {
  rows: MixableRow[];
  openFormulaId?: number | null;
}) {
  const first = rows.find((r) => r.formulaId === openFormulaId) ?? rows[0] ?? null;
  const [chosenId, setChosenId] = useState<number | null>(first ? first.formulaId : null);
  const row = rows.find((r) => r.formulaId === chosenId) ?? first;

  if (!rows.length || !row) {
    return (
      <Card>
        <Empty>No recipe is mixed in advance yet.</Empty>
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
    <div className="space-y-2.5">
      {/*
        Which recipe, when there is more than one.

        A row of pills rather than a stack of fold-open cards: the cards were
        what made this a page you scroll, and the recipe you are mixing should
        be the whole screen rather than the first item on a list of them.
      */}
      {rows.length > 1 ? (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5" role="tablist">
          {rows.map((r) => (
            <button
              key={r.formulaId}
              type="button"
              role="tab"
              aria-selected={r.formulaId === row.formulaId}
              onClick={() => setChosenId(r.formulaId)}
              className={`min-h-11 shrink-0 whitespace-nowrap rounded-xl px-4 text-sm font-bold ring-1 ring-inset xl:min-h-9 ${
                r.formulaId === row.formulaId
                  ? "bg-brand text-white ring-brand"
                  : "bg-white text-brand-dark ring-line hover:bg-wash"
              }`}
            >
              {r.outputName}
            </button>
          ))}
        </div>
      ) : null}

      {/*
        Remounted per recipe on purpose. A batch half-counted for one product
        must not survive into another — the counts, the corrections and the
        result banner all belong to the recipe they were typed against.
      */}
      <BatchBoard key={row.formulaId} row={row} />
    </div>
  );
}

function BatchBoard({ row }: { row: MixableRow }) {
  const [state, action, pending] = useActionState(recordMixAction, EMPTY);

  /** How many of each size are being filled. The one real input on this screen. */
  const [counts, setCounts] = useState<Record<number, string>>({});
  /** The odd quantity a set of sizes leaves over, and the only control when a product has no sizes. */
  const [loose, setLoose] = useState("");
  const [priced, setPriced] = useState<MixPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  /** What actually went in, when the jug disagreed with the arithmetic. */
  const [used, setUsed] = useState<Record<number, string>>({});
  const [touchedUsed, setTouchedUsed] = useState(false);
  /**
   * What came out, when it was not what was set out to be made.
   *
   * Null means "exactly the jerricans counted above", which is the ordinary
   * case and is why there is no box for it on the face of the screen. A string
   * means the owner corrected it, and then it is his and the sizes stop moving
   * it.
   */
  const [made, setMade] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  /**
   * The last result the owner has finished with.
   *
   * A recorded batch replaces the form rather than sitting above it, because
   * the old screen kept every value and kept the button live: after a submit
   * from the bottom of a long page the success message was most of a screen
   * ABOVE the viewport, so nothing appeared to happen and the natural next act
   * was to press again — which mixed the batch a second time and took the
   * concentrate off the shelf twice. A form that is not on the screen cannot be
   * submitted twice.
   */
  const [donewith, setDonewith] = useState<string | null>(null);

  const nOf = (bundleId: number) => Math.max(0, Math.floor(Number(counts[bundleId]) || 0));

  /** What the counted jerricans and the loose remainder come to, in thousandths. */
  const targetMilli = useMemo(() => {
    let total = toMilli(loose);
    for (const b of row.outputBundles) total += nOf(b.id) * b.sizeMilli;
    return total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts, loose, row.outputBundles]);

  /** What actually lands on the shelf: the correction if there is one, else the count. */
  const madeMilli = made === null ? targetMilli : toMilli(made);

  /**
   * What the batch is worth at the prices the counter charges.
   *
   * Counted off the jerricans, then scaled if the drum disagreed with them. The
   * scaling is the point: the old screen worked this out from the counts alone,
   * so correcting a batch of two 23s down to 40 kg left the money — and the
   * margin underneath it — still priced on 46 kg that would never be sold.
   */
  const countedWorthCents = useMemo(() => {
    let total = 0;
    for (const b of row.outputBundles) total += nOf(b.id) * b.priceCents;
    // A loose remainder is worth its per-unit price, which is the only price a
    // quantity that is not a size can be sold at.
    return total + Math.round((toMilli(loose) * row.outputPriceCents) / 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts, loose, row.outputBundles, row.outputPriceCents]);

  const worthCents =
    targetMilli > 0 && madeMilli !== targetMilli
      ? Math.round((countedWorthCents * madeMilli) / targetMilli)
      : countedWorthCents;

  /** "2 × 23 kg · 4 × 5 kg" — the batch read back in the containers it was counted in. */
  const saidAsSizes = useMemo(() => {
    const parts = row.outputBundles
      .filter((b) => nOf(b.id) > 0)
      .map((b) => `${nOf(b.id)} × ${formatQty(b.sizeMilli, row.outputUnit)}`);
    if (toMilli(loose) > 0) parts.push(`${formatQty(toMilli(loose), row.outputUnit)} loose`);
    return parts.join(" · ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts, loose, row.outputBundles, row.outputUnit]);

  /*
    Price the batch up whenever the count changes.

    Debounced only for the typed loose box, which is a keystroke away from a
    server round trip. A tap on a chip is a whole jerrican and there is nothing
    on the way to it, so the wait would be felt rather than useful.
  */
  useEffect(() => {
    if (!(targetMilli > 0)) return;
    let live = true;
    const t = setTimeout(async () => {
      const res = await planMixAction(row.versionId, targetMilli);
      if (!live) return;
      if (res.error) {
        setPlanError(res.error);
        setPriced(null);
        return;
      }
      setPlanError(null);
      setPriced(res.plan ?? null);
      /*
        The ingredient quantities follow the count until somebody types one in.

        Changing two 23s to three moves the concentrate with it, or the form
        would quietly propose the old quantity for a bigger batch. But once a
        box has been corrected by hand that is a measurement, and from then on
        nothing overwrites it — not a recount either, which is what the old
        screen did: it re-armed the overwrite on every tap, so the one number on
        the form that came from the jug rather than from arithmetic was the one
        it threw away. The way back is the button that says so.
      */
      if (!touchedUsed) {
        const seeded: Record<number, string> = {};
        for (const line of res.plan?.lines ?? []) {
          if (line.itemId !== null) seeded[line.itemId] = fromMilli(line.neededMilli);
        }
        setUsed(seeded);
      }
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [row.versionId, targetMilli, touchedUsed]);

  /**
   * The plan, but only while there is a batch for it to be a plan of.
   *
   * Derived rather than cleared, because clearing it was a step somebody had to
   * remember: "Mix another batch" emptied the counts and left the panel showing
   * the finished batch's ingredients, its costs and its pre-batch stock figure,
   * under a sentence that read "puts 0 kg on the shelf".
   */
  const plan = targetMilli > 0 ? priced : null;

  /**
   * What will actually come off the shelf, and what it will cost.
   *
   * The plan's own figures are what the recipe asks for; these are what the jug
   * says went in, once the owner has corrected a box. They are the same number
   * until he does. Keeping the strip on the plan's figures was the same fault
   * as pricing a corrected batch off the jerrican count — the ledger printed
   * "takes 36 kg" over a box the owner had just typed 26 into.
   */
  const takes = (plan?.lines ?? []).map((line) => {
    const typed =
      line.itemId !== null && touchedUsed ? toMilli(used[line.itemId] ?? "") : 0;
    const qtyMilli = typed > 0 ? typed : line.neededMilli;
    const costCents =
      line.neededMilli > 0
        ? Math.round((line.costCents * qtyMilli) / line.neededMilli)
        : line.costCents;
    return { ...line, qtyMilli, costCents, short: line.availableMilli < qtyMilli };
  });
  const takesCostCents = takes.reduce((n, l) => n + l.costCents, 0);
  const shortLines = takes.filter((l) => l.short || l.itemId === null);

  /*
    One string for what is stopping this, driving both the message and the dead
    button — the stocktake screen's pattern. A dead button with no reason beside
    it is the thing this app has fixed everywhere else.
  */
  const problem =
    targetMilli <= 0
      ? `Tap a size to say how much ${row.outputName} you made.`
      : shortLines.length
        ? `Not enough in the store: ${shortLines.map((l) => l.itemName).join(", ")}. ` +
          (plan && plan.possibleMilli > 0
            ? `The most you could mix right now is ${formatQty(plan.possibleMilli, row.unit)}.`
            : "Record the delivery first.")
        : !(madeMilli > 0)
          ? "Say how much the batch actually made."
          : null;

  /** The batch just recorded, until the owner says they are ready for the next. */
  const recorded = state.ok && state.ok !== donewith ? state.ok : null;

  const next = () => {
    setDonewith(state.ok ?? null);
    setCounts({});
    setLoose("");
    setMade(null);
    setUsed({});
    setTouchedUsed(false);
    setAdjusting(false);
    setPriced(null);
  };

  return (
    <Card className="space-y-3">
      {/*
        ZONE 1 — what is being mixed, and how much of it is already on the shelf.

        The shelf figure is the question that brought the owner here at all
        ("have I got any mild?"), so it stays on the screen while he counts
        rather than being something he came from another page to find out.
      */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold">{row.outputName}</div>
          {/*
            The price, not the recipe's name. "Hypochlorite mild" is made by
            "Hypochlorite — mild" and saying both taught nobody anything — it
            just pushed the rate off the end of a 360 px line as an ellipsis.
          */}
          {row.outputPriceCents > 0 ? (
            <div className="mt-0.5 text-xs font-semibold text-brand-dark tnum">
              sells at {formatKes(row.outputPriceCents)}/{row.outputUnit}
            </div>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            on the shelf
          </div>
          <div className="text-lg font-extrabold leading-tight tnum">
            {formatQty(row.outputOnHandMilli, row.outputUnit)}
          </div>
        </div>
      </div>

      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {planError && !recorded ? <Alert tone="warn">{planError}</Alert> : null}

      {/*
        A batch is rarely one batch — the shop mixes a drum in halves and starts
        on the next — so what follows a recorded batch is an invitation to mix
        the next one, in the place the form was, where the eye already is.
      */}
      {recorded ? (
        <div className="space-y-2.5">
          <Alert tone="good">{recorded}</Alert>
          <Button className="w-full !min-h-14 text-base" onClick={next}>
            Mix another batch
          </Button>
        </div>
      ) : null}

      <form action={action} className={`space-y-3 ${recorded ? "hidden" : ""}`}>
        <input type="hidden" name="versionId" value={row.versionId} />
        <input type="hidden" name="targetMilli" value={targetMilli} />
        {/*
          The correction, when there is one, travels as a hidden field: the box
          it is typed into lives inside a disclosure, and a closed disclosure
          must not quietly drop what was typed into it.
        */}
        <input type="hidden" name="made" value={fromMilli(madeMilli)} />

        {/*
          ZONE 2 — the sizes, as squares. The only real input on the screen.

          Two columns on a phone and three from `sm`, which is the counter's
          grid: a chip is never narrower than a thumb, and the row of them never
          wraps into something you have to read rather than aim at.
        */}
        {row.outputBundles.length ? (
          <div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {row.outputBundles.map((b) => (
                <SizeChip
                  key={b.id}
                  noun="this batch"
                  size={formatQty(b.sizeMilli, row.outputUnit)}
                  price={formatKes(b.priceCents)}
                  /*
                    No rate on the chip. At the counter each size can be priced
                    at its own rate, so the third line earns its place; here they
                    are all the one product's price and it printed "KES 320/kg"
                    three times under three different sizes. The rate is said
                    once, beside the name at the top.
                  */
                  count={nOf(b.id)}
                  onPick={() => {
                    setMade(null);
                    setCounts((c) => ({ ...c, [b.id]: String(nOf(b.id) + 1) }));
                  }}
                  onRemove={() => {
                    setMade(null);
                    setCounts((c) => ({ ...c, [b.id]: "0" }));
                  }}
                />
              ))}
            </div>

            {/* The odd batch, and the remainder a set of jerricans leaves over. */}
            <div className="mt-2 flex items-center gap-2.5">
              <input
                className={`${inputClassBase} w-24 shrink-0 !py-2 text-center tnum`}
                type="text"
                inputMode="decimal"
                value={loose}
                placeholder="0"
                onChange={(e) => {
                  setMade(null);
                  setLoose(e.target.value.replace(/[^\d.]/g, ""));
                }}
                aria-label={`Any quantity of ${row.outputName} not in a jerrican, in ${row.outputUnit}`}
              />
              <span className="text-sm font-semibold text-muted">
                {row.outputUnit} loose
              </span>
            </div>
          </div>
        ) : (
          <Field
            label={`How much did you make, in ${row.outputUnit}`}
            hint={`The recipe is written for ${formatQty(row.refSizeMilli, row.unit)}. Set the sizes it is sold in on ${row.outputName}, under Products & prices, to count it by the jerrican instead.`}
          >
            <input
              className={inputClass}
              type="text"
              inputMode="decimal"
              value={loose}
              onChange={(e) => {
                setMade(null);
                setLoose(e.target.value.replace(/[^\d.]/g, ""));
              }}
            />
          </Field>
        )}

        {/*
          ZONE 3 — what pressing the button will do, in the two directions it
          does it: off the shelf and onto it.

          This is the check-your-answers page, merged into the form. It is here
          rather than at the end because it changes under the owner's hand as he
          taps, which is what makes it get read at all.
        */}
        <div className="rounded-xl bg-wash px-3.5 py-2.5">
          {targetMilli > 0 && plan ? (
            /*
              Three lines, each a phrase on the left and a figure on the right.
              They were two sentences with the money at the end, and on a 360 px
              phone every one of them wrapped and dropped its figure onto a line
              of its own, so the column of numbers this exists to be was ragged.
            */
            <div className="space-y-0.5 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-muted">
                  Takes{" "}
                  <span className="font-semibold text-ink">
                    {takes
                      .map((l) => `${formatQty(l.qtyMilli, l.unit)} ${l.itemName}`)
                      .join(", ")}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tnum">
                  {formatKes(takesCostCents)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-muted">
                  Puts on the shelf{" "}
                  <span className="font-semibold text-ink tnum">
                    {formatQty(madeMilli, row.outputUnit)}
                  </span>
                </span>
                <span className="shrink-0 font-semibold text-brand-dark tnum">
                  {formatKes(worthCents)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-line pt-0.5">
                <span className="text-muted">
                  {worthCents - takesCostCents >= 0 ? "Margin" : "Loses"}
                </span>
                <span
                  className={`shrink-0 font-bold tnum ${
                    worthCents - takesCostCents >= 0 ? "text-good" : "text-bad"
                  }`}
                >
                  {formatKes(Math.abs(worthCents - takesCostCents))}
                </span>
              </div>
              {/*
                The one thing a counted screen can say that the old one could
                not: the jug and the jerricans disagreed, and by how much. Shown
                only when they do, which is the only time it is information.
              */}
              {made !== null && madeMilli !== targetMilli ? (
                <div className="text-xs font-semibold text-warn tnum">
                  {madeMilli < targetMilli ? "Short of" : "Over"} the{" "}
                  {formatQty(targetMilli, row.outputUnit)} counted by{" "}
                  {formatQty(Math.abs(targetMilli - madeMilli), row.outputUnit)}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">
              {row.outputBundles.length
                ? "Tap a size for each jerrican you filled."
                : `Say how much ${row.outputName} the batch made.`}
            </p>
          )}
        </div>

        {/*
          Everything that only matters after the drum is filled.

          Folded, because it is the same arithmetic already shown above and a
          pre-filled box gets accepted unread — asking the owner to confirm a
          number the system worked out from his own recipe buys no accuracy and
          costs most of a phone screen. It opens in place, so nothing moves.
        */}
        <details
          open={adjusting}
          onToggle={(e) => setAdjusting((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-bold text-brand xl:min-h-9">
            <span aria-hidden className="text-xs">
              {adjusting ? "▾" : "▸"}
            </span>
            Adjust what went in or came out
          </summary>

          <div className="mt-1 space-y-3 border-l-2 border-line pl-3">
            {row.steps.trim() ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted">
                {row.steps.trim()}
              </p>
            ) : null}

            {plan
              ? takes.map((line) =>
                  line.itemId === null ? (
                    <p key={line.chemicalId} className="text-xs font-semibold text-bad">
                      {line.itemName} is not stocked — add it under Products &amp; prices before
                      mixing.
                    </p>
                  ) : (
                    <Field
                      key={line.chemicalId}
                      label={`${line.itemName}, in ${line.unit}`}
                      hint={`${formatQty(line.availableMilli, line.unit)} in the store`}
                    >
                      <input
                        className={`${inputClassBase} w-32 tnum`}
                        name={`used:${line.itemId}`}
                        type="text"
                        inputMode="decimal"
                        value={used[line.itemId] ?? fromMilli(line.neededMilli)}
                        onChange={(e) => {
                          setTouchedUsed(true);
                          setUsed((u) => ({
                            ...u,
                            [line.itemId!]: e.target.value.replace(/[^\d.]/g, ""),
                          }));
                        }}
                      />
                    </Field>
                  ),
                )
              : null}

            <Field
              label={`What came out, in ${row.outputUnit}`}
              hint="Only if the drum gave something other than the jerricans counted above."
            >
              <input
                className={`${inputClassBase} w-32 tnum`}
                type="text"
                inputMode="decimal"
                value={made ?? fromMilli(targetMilli)}
                onChange={(e) => setMade(e.target.value.replace(/[^\d.]/g, ""))}
              />
            </Field>

            <Field label="Note" hint="Anything about this batch worth remembering.">
              <input className={inputClass} name="note" autoComplete="off" />
            </Field>

            {touchedUsed || made !== null ? (
              <button
                type="button"
                onClick={() => {
                  setTouchedUsed(false);
                  setMade(null);
                }}
                className="min-h-11 text-sm font-bold text-brand xl:min-h-9"
              >
                Put it back to what the recipe says
              </button>
            ) : null}
          </div>
        </details>

        {/*
          ZONE 4 — the button, with the batch written into it.

          `Record this batch` said nothing; this says the quantity and the
          product it is about to put on the shelf, which is the whole summary
          sentence that used to sit above it in prose. Whatever is stopping it
          is said directly underneath, because a dead button with no reason is
          the worst thing on any screen in this app.
        */}
        <div className="space-y-1.5 pt-0.5">
          {saidAsSizes ? (
            <p className="truncate text-xs text-muted tnum">{saidAsSizes}</p>
          ) : null}
          <Button
            type="submit"
            className="w-full !min-h-14 text-base"
            disabled={pending || !plan || !!problem}
          >
            {pending
              ? "Recording…"
              : madeMilli > 0
                ? `Record ${formatQty(madeMilli, row.outputUnit)} of ${row.outputName}`
                : "Record this batch"}
          </Button>
          {problem && !pending ? <p className="text-xs text-muted">{problem}</p> : null}
        </div>
      </form>
    </Card>
  );
}
