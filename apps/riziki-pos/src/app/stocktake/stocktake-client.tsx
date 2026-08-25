"use client";

/**
 * Physical count against the ledger — the shop's main anti-theft control.
 *
 * The variance is shown three ways because each answers a different question:
 * how much ("four kilos short"), what it is ("that is 4 kg of caustic") and, for
 * the owner only, shillings ("that is KES 1,040 walking out of the door").
 *
 * What is counted depends on the row. A jerrican is counted: there are eleven of
 * them or there are not. A chemical is weighed, because once the shop sells by
 * the kilogram a half-empty drum is not a countable number of anything — so the
 * box asks for kilograms and says so.
 */

import { useActionState, useEffect, useMemo, useState } from "react";
import { formatKes, formatQty, formatUnits } from "@/lib/units";
import {
  Alert, Button, Card, Chip, Empty, Field, PageTitle, SectionLabel, Stat, inputClass, inputClassBase,
} from "@/components/ui";
import type { StockLine } from "@/lib/stock-service";

export interface StocktakeState {
  ok?: string;
  error?: string;
}

const INITIAL: StocktakeState = {};

interface CountedLine {
  line: StockLine;
  countedUnits: number;
  countedMilli: number;
  deltaMilli: number;
  deltaUnits: number;
  deltaCents: number;
}

export function StocktakeClient({
  lines,
  owner,
  action,
  heading = true,
}: {
  lines: StockLine[];
  owner: boolean;
  action: (state: StocktakeState, formData: FormData) => Promise<StocktakeState>;
  /** False when the Stock window supplies the title and the tabs above it. */
  heading?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("");
  const [query, setQuery] = useState("");

  // Once posted, the counts are history — leaving them on screen would invite a
  // second submission against stock that has already been corrected.
  useEffect(() => {
    if (state.ok) {
      setCounts({});
      setReason("");
    }
  }, [state.ok]);

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const visible = useMemo(
    () => (terms.length ? lines.filter((l) => terms.every((t) => l.search.includes(t))) : lines),
    [lines, terms],
  );

  const counted = useMemo(() => {
    const out: CountedLine[] = [];
    for (const line of lines) {
      const raw = counts[line.id];
      if (raw === undefined || raw.trim() === "") continue;
      const countedUnits = Number(raw);
      if (!Number.isFinite(countedUnits)) continue;
      // What one counted unit is worth: a container, or one kilogram. Mirrors
      // `planStocktake`, which is what actually posts the movement.
      const perCount = line.basis === "unit" ? 1000 : line.sizeMilli;
      const countedMilli = Math.round(countedUnits * perCount);
      const deltaMilli = countedMilli - line.qtyMilli;
      out.push({
        line,
        countedUnits,
        countedMilli,
        deltaMilli,
        deltaUnits: perCount > 0 ? deltaMilli / perCount : 0,
        deltaCents:
          line.sizeMilli > 0 ? Math.round((deltaMilli / line.sizeMilli) * line.costCents) : 0,
      });
    }
    return out;
  }, [lines, counts]);

  const byId = useMemo(() => new Map(counted.map((c) => [c.line.id, c])), [counted]);
  const variances = counted.filter((c) => c.deltaMilli !== 0);
  const varianceCents = variances.reduce((s, c) => s + c.deltaCents, 0);
  const negative = counted.some((c) => c.countedUnits < 0);

  const problem = negative
    ? "A counted quantity cannot be negative."
    : !counted.length
      ? "Enter what you actually counted, at least for one item."
      : !variances.length
        ? "Every count matches the system — nothing to post."
        : !reason.trim()
          ? "Say why the count differs before posting."
          : null;

  return (
    <div>
      {heading === false ? null : (
        <PageTitle title="Stock take" subtitle="Count the shelf, then post the difference" />
      )}

      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="good">{state.ok}</Alert> : null}

      <form action={formAction} className="mt-3 space-y-3">
        <div className={owner ? "grid grid-cols-2 gap-3 xl:max-w-2xl" : "xl:max-w-sm"}>
          <Stat
            label="Counted"
            value={`${counted.length}`}
            detail={`${variances.length} differ from the system`}
          />
          {owner ? (
            <Stat
              label="Difference at cost"
              value={formatKes(varianceCents)}
              detail={varianceCents < 0 ? "stock is short" : "stock is over"}
            />
          ) : null}
        </div>

        <input
          className={`${inputClass} xl:max-w-2xl`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search — try SLES, soda ash, jerrican"
          aria-label="Search items to count"
          autoComplete="off"
        />

        <SectionLabel>Items</SectionLabel>
        {!visible.length ? <Empty>Nothing matches “{query}”.</Empty> : null}

        {/* A hundred-odd lines have to be counted in one pass. Flowing them into
            newspaper columns is the difference between four rows on screen and
            most of a shelf. */}
        <Card className="gap-x-6 md:columns-2 xl:columns-3 2xl:columns-4 3xl:columns-5">
          {visible.map((line) => {
            const c = byId.get(line.id);
            return (
              <div
                key={line.id}
                className="break-inside-avoid border-t border-line py-2 first:border-t-0"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold leading-snug">{line.name}</div>
                    <div className="text-[11px] text-muted tnum">
                      {line.basis === "unit" ? (
                        <>
                          system {formatQty(line.qtyMilli, line.unit)} ·{" "}
                          {formatUnits(line.qtyMilli, line.sizeMilli, line.unitLabel === line.unit ? "container" : line.unitLabel)}
                        </>
                      ) : (
                        <>
                          system {formatUnits(line.qtyMilli, line.sizeMilli, line.unitLabel)} ·{" "}
                          {formatQty(line.qtyMilli, line.unit)}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <input
                      className={`${inputClassBase} w-24 text-right tnum xl:!px-3 xl:!py-2`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      // No placeholder on a weighed row: the unit is already
                      // printed against the box, and "kg" inside it as well
                      // reads as a value that has been entered.
                      placeholder={line.basis === "unit" ? "" : "count"}
                      aria-label={
                        line.basis === "unit"
                          ? `Weighed ${line.unit} of ${line.name}`
                          : `Counted ${line.unitLabel}s of ${line.name}`
                      }
                      value={counts[line.id] ?? ""}
                      onChange={(e) => setCounts((prev) => ({ ...prev, [line.id]: e.target.value }))}
                    />
                    {line.basis === "unit" ? (
                      <span className="w-6 text-[11px] font-bold text-muted">{line.unit}</span>
                    ) : null}
                  </div>
                </div>

                {c && c.deltaMilli !== 0 ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Chip tone={c.deltaMilli < 0 ? "bad" : "warn"}>
                      {c.deltaUnits > 0 ? "+" : ""}
                      {Number(c.deltaUnits.toFixed(2))} {line.unitLabel}
                      {line.basis === "unit" || Math.abs(Number(c.deltaUnits.toFixed(2))) === 1
                        ? ""
                        : "s"}
                    </Chip>
                    <span className="text-[11px] text-muted tnum">
                      {c.deltaMilli > 0 ? "+" : ""}
                      {formatQty(c.deltaMilli, line.unit)}
                    </span>
                    {owner ? (
                      <span className="text-[11px] font-semibold text-muted tnum">
                        {formatKes(c.deltaCents)}
                      </span>
                    ) : null}
                  </div>
                ) : c ? (
                  <div className="mt-1.5">
                    <Chip tone="good">Matches</Chip>
                  </div>
                ) : null}
              </div>
            );
          })}
        </Card>

        {/* Counts live in state, not in the visible inputs, so filtering the list
            can never quietly drop a count that was already entered. */}
        {counted.map((c) => (
          <input
            key={c.line.id}
            type="hidden"
            name={`count_${c.line.id}`}
            value={counts[c.line.id] ?? ""}
          />
        ))}

        {/* Writing and the decision to post stay at reading width, however wide
            the monitor is. */}
        <div className="max-w-2xl space-y-3">
          <Field label="Reason" hint="Required. This is what the owner reads when the shelf is short.">
            <textarea
              className={inputClass}
              name="reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Monthly count — 4 packs missing from the shelf"
            />
          </Field>

          {problem ? <Alert tone="bad">{problem}</Alert> : null}

          <Button type="submit" className="w-full" disabled={pending || problem !== null}>
            {pending ? "Posting…" : `Post ${variances.length || ""} adjustment${variances.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </form>
    </div>
  );
}
