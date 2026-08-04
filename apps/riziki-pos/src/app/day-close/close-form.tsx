"use client";

/**
 * The cash count itself.
 *
 * The variance has to appear while the owner is still holding the notes — if it
 * only showed up after a save, they would have to re-count from memory. So this
 * one small piece is a client component; everything around it stays on the
 * server, and the expected figure is computed there and passed in.
 */

import { useActionState, useState } from "react";
import { formatKes, toCents } from "@/lib/units";
import { Field, inputClass, Button, Alert, Chip } from "@/components/ui";

export interface CloseState {
  ok?: boolean;
  error?: string;
  varianceCents?: number;
}

export function CloseForm({
  date,
  expectedCashCents,
  warnCents,
  badCents,
  defaultCounted,
  defaultNote,
  alreadyClosed,
  action,
}: {
  date: string;
  expectedCashCents: number;
  warnCents: number;
  badCents: number;
  defaultCounted: string;
  defaultNote: string;
  alreadyClosed: boolean;
  action: (prev: CloseState, formData: FormData) => Promise<CloseState>;
}) {
  const [state, formAction, pending] = useActionState<CloseState, FormData>(action, {});
  const [counted, setCounted] = useState(defaultCounted);

  const typed = counted.trim();
  const parsed = typed === "" ? null : Number(typed);
  const valid = parsed !== null && Number.isFinite(parsed) && parsed >= 0;
  const variance = valid ? toCents(parsed) - expectedCashCents : null;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="date" value={date} />

      <Field
        label="Cash counted in the drawer"
        hint="Count the notes and coins, then type the total. Nothing is judged until you save."
      >
        <input
          className={`${inputClass} text-2xl font-extrabold tnum`}
          type="number"
          name="counted"
          inputMode="decimal"
          step="0.01"
          min="0"
          autoComplete="off"
          placeholder="0"
          value={counted}
          onChange={(e) => setCounted(e.target.value)}
          required
        />
      </Field>

      <VarianceReadout variance={variance} warnCents={warnCents} badCents={badCents} />

      <Field label="Note" hint="Optional — e.g. “KES 200 float taken for lunch, returned Monday”.">
        <input
          className={inputClass}
          type="text"
          name="note"
          defaultValue={defaultNote}
          maxLength={200}
          autoComplete="off"
        />
      </Field>

      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {state.ok ? (
        <Alert tone="good">
          Day closed. Difference {formatKes(state.varianceCents ?? 0)}.
        </Alert>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending || !valid}>
        {pending ? "Saving…" : alreadyClosed ? "Update today’s close" : "Close the day"}
      </Button>
    </form>
  );
}

/**
 * Colour is never the only signal — the chip carries a word too, because the
 * counter phone is used in daylight and by whoever is on shift.
 */
function VarianceReadout({
  variance,
  warnCents,
  badCents,
}: {
  variance: number | null;
  warnCents: number;
  badCents: number;
}) {
  if (variance === null) {
    return (
      <div className="rounded-2xl border border-dashed border-line px-3.5 py-3 text-sm text-muted">
        Type the counted cash to see the difference.
      </div>
    );
  }

  const gap = Math.abs(variance);
  const tone = gap <= warnCents ? "good" : gap <= badCents ? "warn" : "bad";
  const word =
    variance === 0
      ? "Balanced"
      : gap <= warnCents
        ? "Balanced"
        : variance < 0
          ? "Short"
          : "Over";

  const box =
    tone === "good"
      ? "border-good/30 bg-good-soft"
      : tone === "warn"
        ? "border-warn/30 bg-warn-soft"
        : "border-bad/30 bg-bad-soft";
  const text = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-bad";

  return (
    <div className={`rounded-2xl border px-3.5 py-3 ${box}`} aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
          Difference
        </span>
        <Chip tone={tone}>{word}</Chip>
      </div>
      <div className={`mt-1 text-2xl font-extrabold tracking-tight tnum ${text}`}>
        {variance > 0 ? "+" : ""}
        {formatKes(variance)}
      </div>
      {variance !== 0 ? (
        <p className="mt-1 text-xs text-muted">
          {variance < 0
            ? "Less cash than the sales say there should be."
            : "More cash than the sales say there should be — a sale may not have been rung up."}
        </p>
      ) : null}
    </div>
  );
}
