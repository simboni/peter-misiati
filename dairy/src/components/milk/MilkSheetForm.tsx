"use client";

/**
 * The bulk milk sheet. One row per cow, prefilled and labelled, tick to accept,
 * edit only the exceptions. Three fields in total — cow, session, litres.
 *
 * The save is written to the phone's outbox BEFORE the network is attempted, so
 * losing signal mid-milking costs nothing.
 */

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { MilkBatchResult, MilkSheet, MilkSheetRow } from "@/server/milk";
import type { ActionResult } from "@/lib/dal";
import { checkYieldPlausibility } from "@/lib/domain/milk";
import { Button, Card, Chip, HardBlock, Receipt, SoftWarning } from "@/components/ui";
import { count as outboxCount, enqueue, remove as outboxRemove } from "@/lib/outbox";

type SheetAction = (prev: unknown, formData: FormData) => Promise<ActionResult<MilkBatchResult>>;

interface Draft {
  id: string;
  value: string;
  included: boolean;
  touched: boolean;
  saved: boolean;
}

function newRowId(): string {
  // The device generates the id. That is what makes a replayed flush a no-op
  // rather than a second milking.
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function initialDraft(row: MilkSheetRow): Draft {
  const saved = row.recordedL !== null;
  const value = saved ? String(row.recordedL) : row.prefillL !== null ? String(row.prefillL) : "";
  return {
    id: row.recordedId ?? newRowId(),
    value,
    // A known value starts accepted, so the whole herd is two taps. A cow with
    // no history starts blank — nothing is invented on her behalf.
    included: value !== "" && !saved,
    touched: false,
    saved,
  };
}

export function MilkSheetForm({ sheet, action }: { sheet: MilkSheet; action: SheetAction }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(sheet.rows.map((r) => [r.animalId, initialDraft(r)])),
  );
  const [waiting, setWaiting] = useState(0);

  const [state, formAction] = useActionState<ActionResult<MilkBatchResult> | null, FormData>(
    async (prev, formData) => {
      const queueId = `milk:${sheet.date}:${sheet.session}:${String(formData.get("rows") ?? "").length}`;
      try {
        await enqueue({
          id: queueId,
          kind: "MILK_BATCH",
          payload: {
            date: formData.get("date"),
            session: formData.get("session"),
            rows: formData.get("rows"),
          },
        });
        setWaiting(await outboxCount());
      } catch {
        // No IndexedDB (private mode, an old browser). The post still goes.
      }

      const result = await action(prev, formData);

      if (result.ok) {
        try {
          await outboxRemove(queueId);
          setWaiting(await outboxCount());
        } catch {
          /* nothing to clean up */
        }
      }
      return result;
    },
    null,
  );

  useEffect(() => {
    void outboxCount().then(setWaiting).catch(() => setWaiting(0));
  }, []);

  const set = (animalId: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [animalId]: { ...d[animalId], ...patch } }));

  const included = useMemo(
    () => sheet.rows.filter((r) => drafts[r.animalId]?.included && drafts[r.animalId].value !== ""),
    [sheet.rows, drafts],
  );

  const rowsJson = useMemo(
    () =>
      JSON.stringify(
        included.map((r) => ({
          id: drafts[r.animalId].id,
          animalId: r.animalId,
          litres: Number(drafts[r.animalId].value),
        })),
      ),
    [included, drafts],
  );

  const total = useMemo(
    () => included.reduce((a, r) => a + (Number(drafts[r.animalId].value) || 0), 0),
    [included, drafts],
  );

  const alreadySavedL = useMemo(
    () => sheet.rows.reduce((a, r) => a + (r.recordedL ?? 0), 0),
    [sheet.rows],
  );

  if (sheet.rows.length === 0) {
    return (
      <Card>
        <p className="font-medium">No cows are in milk today.</p>
        <p className="mt-1 text-sm text-ink-3">
          A cow appears here once her calving is recorded. Record the calving first.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {state?.ok ? (
        <Receipt
          title={state.message ?? "Milking recorded"}
          lines={state.data.receiptLines}
          refCode={state.refCode}
          tone={state.data.drops.length || state.data.flagged.length ? "warn" : "ok"}
        >
          <p className="mt-3 text-sm">
            <Link className="underline" href={`/milk/receipt/${state.refCode}`}>
              Show this receipt again
            </Link>
          </p>
        </Receipt>
      ) : null}

      {state && !state.ok ? <HardBlock message={state.error} /> : null}

      <form action={formAction}>
        <input type="hidden" name="date" value={sheet.date} />
        <input type="hidden" name="session" value={sheet.session} />
        <input type="hidden" name="rows" value={rowsJson} />

        <ul className="space-y-2">
          {sheet.rows.map((row) => (
            <SheetRow
              key={row.animalId}
              row={row}
              draft={drafts[row.animalId]}
              onChange={(patch) => set(row.animalId, patch)}
            />
          ))}
        </ul>

        {/* Opaque, not translucent: at 95% the card behind bleeds through and
            the running total becomes unreadable over a row. It also needs its
            own horizontal padding and a negative inset, or it sits inside the
            page gutter and looks like a floating fragment rather than a bar. */}
        <div className="sticky bottom-0 -mx-5 mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-line bg-paper px-5 py-3 shadow-[0_-6px_16px_-8px_rgba(20,32,28,0.25)]">
          <div>
            <p className="text-sm text-ink-2">Total so far</p>
            <p className="text-2xl font-semibold tabular-nums">
              {total.toFixed(1)} L
              <span className="ml-2 text-sm font-normal text-ink-3">
                {included.length} of {sheet.rows.length} cows
                {alreadySavedL > 0 ? ` · ${alreadySavedL.toFixed(1)} L already saved` : ""}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {waiting > 0 ? <Chip tone="warn">Saved on phone ({waiting} waiting)</Chip> : null}
            <SaveButton disabled={included.length === 0} />
          </div>
        </div>
      </form>
    </div>
  );
}

function SheetRow({
  row,
  draft,
  onChange,
}: {
  row: MilkSheetRow;
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
}) {
  // Warn as she types, not next month (R7). Pure rule, no round trip.
  const check =
    draft.touched && draft.value !== ""
      ? checkYieldPlausibility(Number(draft.value), {
          recentAverageL: row.recentAverageL,
          animalName: row.name,
        })
      : null;

  const border =
    row.lockReason === "WITHDRAWAL"
      ? "border-danger"
      : row.lockReason === "COLOSTRUM"
        ? "border-brass"
        : "border-line";

  return (
    <li className={`rounded-lg border bg-surface p-3 ${border}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="text-xl">
          {row.lockReason === "WITHDRAWAL" ? "⛔" : row.lockReason === "COLOSTRUM" ? "🍼" : "🐄"}
        </span>
        <Link href={`/milk/${row.animalId}`} className="min-w-32 text-lg font-semibold hover:underline">
          {row.name}
        </Link>

        <label className="flex items-center gap-2">
          <span className="sr-only">Litres for {row.name}</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            value={draft.value}
            onChange={(e) =>
              onChange({ value: e.target.value, touched: true, included: e.target.value !== "" })
            }
            className="w-24 rounded-md border border-line bg-surface px-3 py-2 text-lg tabular-nums"
          />
          <span className="text-ink-2">L</span>
        </label>

        {draft.saved ? (
          <Chip tone="ok">already saved</Chip>
        ) : row.prefillL !== null && !draft.touched ? (
          <span className="text-sm text-ink-3">{row.prefillLabel}</span>
        ) : null}

        {row.daysInMilk !== null ? <span className="text-xs text-ink-3">day {row.daysInMilk}</span> : null}

        <label className="ml-auto flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.included}
            onChange={(e) => onChange({ included: e.target.checked })}
            className="size-6"
            aria-label={`Record ${row.name}`}
          />
          <span aria-hidden className={draft.included ? "text-ok" : "text-ink-3"}>
            ✓
          </span>
        </label>
      </div>

      {row.lockMessage ? (
        <div className="mt-2">
          {row.lockReason === "WITHDRAWAL" ? (
            <HardBlock message={row.lockMessage} />
          ) : (
            <SoftWarning message={row.lockMessage} />
          )}
        </div>
      ) : null}

      {row.warning ? (
        <div className="mt-2">
          <SoftWarning message={row.warning} />
        </div>
      ) : null}

      {check?.flagged && check.message ? (
        <div className="mt-2">
          <SoftWarning message={check.message} />
        </div>
      ) : null}
    </li>
  );
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}
