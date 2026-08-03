"use client";

/**
 * Physical count against the ledger — the shop's main anti-theft control.
 *
 * The variance is shown three ways because each answers a different question:
 * units ("four packs are missing"), substance ("that is 4 kg") and, for the owner
 * only, shillings ("that is KES 1,040 walking out of the door").
 */

import { useActionState, useEffect, useMemo, useState } from "react";
import { formatKes, formatQty, formatUnits } from "@/lib/units";
import { Alert, Button, Card, Chip, Empty, Field, PageTitle, SectionLabel, Stat, inputClass } from "@/components/ui";
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
}: {
  lines: StockLine[];
  owner: boolean;
  action: (state: StocktakeState, formData: FormData) => Promise<StocktakeState>;
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
      const countedMilli = Math.round(countedUnits * line.sizeMilli);
      const deltaMilli = countedMilli - line.qtyMilli;
      out.push({
        line,
        countedUnits,
        countedMilli,
        deltaMilli,
        deltaUnits: line.sizeMilli > 0 ? deltaMilli / line.sizeMilli : 0,
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
      <PageTitle title="Stock take" subtitle="Count the shelf, then post the difference" />

      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="good">{state.ok}</Alert> : null}

      <form action={formAction} className="mt-3 space-y-3">
        <div className={owner ? "grid grid-cols-2 gap-2.5" : ""}>
          <Stat
            label="Counted"
            value={`${counted.length}`}
            detail={`${variances.length} differ from the system`}
          />
          {owner ? (
            <Stat
              label="Variance at cost"
              value={formatKes(varianceCents)}
              detail={varianceCents < 0 ? "stock is short" : "stock is over"}
            />
          ) : null}
        </div>

        <input
          className={inputClass}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search — try SLES, soda ash, jerrican"
          aria-label="Search items to count"
          autoComplete="off"
        />

        <SectionLabel>Items</SectionLabel>
        {!visible.length ? <Empty>Nothing matches “{query}”.</Empty> : null}

        <Card className="space-y-3">
          {visible.map((line) => {
            const c = byId.get(line.id);
            return (
              <div key={line.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold leading-snug">{line.name}</div>
                    <div className="text-[11px] text-muted tnum">
                      system {formatUnits(line.qtyMilli, line.sizeMilli, line.unitLabel)} ·{" "}
                      {formatQty(line.qtyMilli, line.unit)}
                    </div>
                  </div>
                  <input
                    className={`${inputClass} w-24 shrink-0 text-right tnum`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    placeholder="count"
                    aria-label={`Counted ${line.unitLabel}s of ${line.name}`}
                    value={counts[line.id] ?? ""}
                    onChange={(e) => setCounts((prev) => ({ ...prev, [line.id]: e.target.value }))}
                  />
                </div>

                {c && c.deltaMilli !== 0 ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Chip tone={c.deltaMilli < 0 ? "bad" : "warn"}>
                      {c.deltaUnits > 0 ? "+" : ""}
                      {Number(c.deltaUnits.toFixed(2))} {line.unitLabel}
                      {Math.abs(Number(c.deltaUnits.toFixed(2))) === 1 ? "" : "s"}
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
      </form>
    </div>
  );
}
