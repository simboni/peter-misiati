"use client";

/**
 * Repacking is the heart of the business, and its loss was invisible: a drum was
 * broken down, packs appeared on the shelf, and the difference simply evaporated.
 *
 * So the kg in / kg out / loss panel is computed live, before submitting, and it
 * is the largest thing on the screen. About 1.5% on Ungerol is roughly KES 1,900
 * a drum pair — money the owner could only ever find by weighing.
 */

import { useActionState, useEffect, useState } from "react";
import { formatKes, formatQty, formatUnits, formatDateTime } from "@/lib/units";
import {
  Alert, Button, Card, Chip, Field, PageTitle, SectionLabel, inputClass, inputClassBase,
} from "@/components/ui";
import type { BulkOption, RecentRepack } from "@/lib/stock-service";

export interface RepackState {
  ok?: string;
  error?: string;
}

const INITIAL: RepackState = {};

export function RepackClient({
  options,
  recent,
  owner,
  action,
  voidAction,
  voidNotice,
  voidError,
}: {
  options: BulkOption[];
  recent: RecentRepack[];
  owner: boolean;
  action: (state: RepackState, formData: FormData) => Promise<RepackState>;
  voidAction: (formData: FormData) => Promise<void>;
  voidNotice?: string;
  voidError?: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  const [bulkId, setBulkId] = useState(options[0]?.itemId ?? 0);
  const [bulkUnits, setBulkUnits] = useState("1");
  const [packUnits, setPackUnits] = useState<Record<number, string>>({});

  const sel = options.find((o) => o.itemId === bulkId);

  // A saved repack leaves the form ready for the next drum, not holding numbers
  // that have already been posted — re-submitting them would double the loss.
  useEffect(() => {
    if (state.ok) {
      setBulkUnits("1");
      setPackUnits({});
    }
  }, [state.ok]);

  const inMilli = sel ? Math.round((Number(bulkUnits) || 0) * sel.sizeMilli) : 0;
  const outMilli = sel
    ? sel.packs.reduce((sum, p) => {
        const n = Math.floor(Number(packUnits[p.itemId]) || 0);
        return sum + (n > 0 ? n * p.sizeMilli : 0);
      }, 0)
    : 0;
  const lossMilli = inMilli - outMilli;
  const lossPct = inMilli > 0 ? (lossMilli / inMilli) * 100 : 0;
  const lossCents = sel && sel.sizeMilli > 0 ? Math.round((lossMilli / sel.sizeMilli) * sel.costCents) : 0;

  const problem = !sel
    ? "Pick the container you are breaking down."
    : inMilli <= 0
      ? "Enter how many containers you are breaking down."
      : inMilli > sel.stockMilli
        ? `Not enough stock — only ${formatUnits(sel.stockMilli, sel.sizeMilli, sel.unitLabel)} of ${sel.name} on hand.`
        : outMilli <= 0
          ? "Enter how many packs you produced."
          : outMilli > inMilli
            ? `${formatQty(outMilli, sel.unit)} of packs cannot come out of ${formatQty(inMilli, sel.unit)}.`
            : null;

  const lossTone = lossMilli === 0 ? "good" : lossPct <= 2 ? "warn" : "bad";

  return (
    <div>
      <PageTitle title="Repack" subtitle="Break a drum or bag down into resale packs" />

      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="good">{state.ok}</Alert> : null}
      {voidError ? <Alert tone="bad">{voidError}</Alert> : null}
      {voidNotice ? <Alert tone="good">{voidNotice}</Alert> : null}

      {!options.length ? (
        <Card>
          <p className="text-sm text-muted">No bulk container has a repack size set up yet.</p>
        </Card>
      ) : (
        <form action={formAction} className="mt-3 space-y-3">
          <input type="hidden" name="bulkItemId" value={bulkId} />

          <Card className="space-y-3">
            <Field label="Break down">
              <select
                className={inputClass}
                value={bulkId}
                onChange={(e) => {
                  setBulkId(Number(e.target.value));
                  setPackUnits({});
                }}
              >
                {options.map((o) => (
                  <option key={o.itemId} value={o.itemId}>
                    {o.name} — {formatUnits(o.stockMilli, o.sizeMilli, o.unitLabel)} in stock
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label={`How many ${sel ? sel.unitLabel + "s" : "units"}`}
              hint={sel ? `One ${sel.unitLabel} holds ${formatQty(sel.sizeMilli, sel.unit)}.` : undefined}
            >
              <input
                className={inputClass}
                name="bulkUnits"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.25"
                value={bulkUnits}
                onChange={(e) => setBulkUnits(e.target.value)}
                required
              />
            </Field>
          </Card>

          <SectionLabel>Packs produced</SectionLabel>
          <Card className="space-y-2.5">
            {sel?.packs.map((p) => (
              <div key={p.itemId} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{p.name}</div>
                  <div className="text-[11px] text-muted tnum">
                    {formatUnits(p.stockMilli, p.sizeMilli, p.unitLabel)} on hand
                  </div>
                </div>
                <input
                  className={`${inputClassBase} w-24 shrink-0 text-right tnum`}
                  name={`units_${p.itemId}`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  placeholder="0"
                  aria-label={`Packs produced of ${p.name}`}
                  value={packUnits[p.itemId] ?? ""}
                  onChange={(e) =>
                    setPackUnits((prev) => ({ ...prev, [p.itemId]: e.target.value }))
                  }
                />
              </div>
            ))}
          </Card>

          {/* The panel the whole screen exists for. */}
          <div className="rounded-2xl border border-line bg-wash p-3.5">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">In</div>
                <div className="mt-0.5 text-lg font-extrabold tnum">
                  {sel ? formatQty(inMilli, sel.unit) : "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Out</div>
                <div className="mt-0.5 text-lg font-extrabold tnum">
                  {sel ? formatQty(outMilli, sel.unit) : "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Loss</div>
                <div className="mt-0.5 text-lg font-extrabold tnum">
                  {sel ? formatQty(lossMilli, sel.unit) : "—"}
                </div>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
              <Chip tone={lossTone}>{lossPct.toFixed(2)}% loss</Chip>
              {owner && lossCents > 0 ? (
                <span className="text-xs font-semibold text-muted tnum">
                  {formatKes(lossCents)} at cost
                </span>
              ) : null}
            </div>
          </div>

          {problem ? <Alert tone="bad">{problem}</Alert> : null}

          <Button type="submit" className="w-full" disabled={pending || problem !== null}>
            {pending ? "Saving…" : "Save repack"}
          </Button>
        </form>
      )}

      {recent.length ? (
        <>
          <SectionLabel>Recent repacks</SectionLabel>
          <Card className="space-y-2.5">
            {recent.map((r) => (
              <div key={r.id} className={r.status === "voided" ? "opacity-60" : ""}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {r.from_name}
                      {r.status === "voided" ? (
                        <span className="ml-1.5 text-[11px] font-bold text-bad">voided</span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-muted">
                      {formatDateTime(r.at)}
                      {r.user_name ? ` · ${r.user_name}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs tnum">
                      {formatQty(r.in_milli, r.unit)} → {formatQty(r.out_milli, r.unit)}
                    </div>
                    <div className="text-[11px] text-muted tnum">
                      loss {formatQty(r.loss_milli, r.unit)} (
                      {r.in_milli > 0 ? ((r.loss_milli / r.in_milli) * 100).toFixed(2) : "0.00"}%)
                    </div>
                  </div>
                </div>
                {r.status === "completed" ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] font-bold text-bad">
                      Void this repack
                    </summary>
                    <form action={voidAction} className="mt-1.5 flex items-center gap-1.5">
                      <input type="hidden" name="repackId" value={r.id} />
                      <input
                        className={`${inputClass} !py-1.5 text-xs`}
                        name="reason"
                        placeholder="Why? e.g. wrong drum picked"
                        required
                      />
                      <button
                        type="submit"
                        className="shrink-0 rounded-lg bg-bad px-2.5 py-1.5 text-[11px] font-bold text-white"
                      >
                        Void
                      </button>
                    </form>
                    <p className="mt-1 text-[11px] text-muted">
                      Puts the bulk back and takes the packs off the shelf again.
                    </p>
                  </details>
                ) : null}
              </div>
            ))}
          </Card>
        </>
      ) : null}
    </div>
  );
}
