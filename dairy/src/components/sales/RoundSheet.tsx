"use client";

/**
 * The delivery round, generated from standing orders and prefilled. The rider
 * edits exceptions only.
 *
 * The credit-limit warning fires BEFORE the milk changes hands. That is the
 * cheapest bad-debt control there is, and the one thing an exercise book
 * structurally cannot do.
 */

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { ActionResult } from "@/lib/dal";
import type { DeliveryRound, RoundResult } from "@/server/sales";
import { kes } from "@/lib/money";
import { Button, Card, Chip, EmptyState, HardBlock, Receipt, Select, SoftWarning } from "@/components/ui";

type RoundAction = (prev: unknown, formData: FormData) => Promise<ActionResult<RoundResult>>;

type Settlement = "CASH" | "MPESA" | "CREDIT";

interface StopDraft {
  id: string;
  litres: string;
  settlement: Settlement;
  skipped: boolean;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function RoundSheet({ round, action }: { round: DeliveryRound; action: RoundAction }) {
  const [drafts, setDrafts] = useState<Record<string, StopDraft>>(() =>
    Object.fromEntries(
      round.stops.map((s) => [
        s.customerId,
        {
          id: newId(),
          litres: String(s.litres),
          settlement: (s.customerType === "INSTITUTION" || s.customerType === "COOP"
            ? "CREDIT"
            : "CASH") as Settlement,
          skipped: s.deliveredL !== null,
        },
      ]),
    ),
  );

  const [state, formAction] = useActionState<ActionResult<RoundResult> | null, FormData>(
    async (prev, formData) => action(prev, formData),
    null,
  );

  const set = (id: string, patch: Partial<StopDraft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  const live = round.stops.filter((s) => !drafts[s.customerId]?.skipped);

  const stopsJson = useMemo(
    () =>
      JSON.stringify(
        live.map((s) => ({
          id: drafts[s.customerId].id,
          customerId: s.customerId,
          litres: Number(drafts[s.customerId].litres) || 0,
          settlement: drafts[s.customerId].settlement,
          date: round.date,
        })),
      ),
    [live, drafts, round.date],
  );

  const totals = useMemo(() => {
    let l = 0;
    let cash = 0;
    let credit = 0;
    for (const s of live) {
      const litres = Number(drafts[s.customerId].litres) || 0;
      const value = (s.rateKesPerLitre ?? 0) * litres;
      l += litres;
      if (drafts[s.customerId].settlement === "CREDIT") credit += value;
      else cash += value;
    }
    return { litres: l, cash, credit };
  }, [live, drafts]);

  if (round.stops.length === 0 && round.pausedToday.length === 0) {
    return (
      <EmptyState
        title="Nobody is expecting milk this session"
        hint="Standing orders build this round. Add one from a customer's page."
      />
    );
  }

  return (
    <div className="space-y-4">
      {state?.ok ? (
        <Receipt
          title={state.message ?? "Round complete"}
          lines={state.data.receiptLines}
          refCode={state.refCode}
          tone={state.data.overLimit.length ? "warn" : "ok"}
        />
      ) : null}
      {state && !state.ok ? <HardBlock message={state.error} /> : null}

      <form action={formAction}>
        <input type="hidden" name="date" value={round.date} />
        <input type="hidden" name="session" value={round.session} />
        <input type="hidden" name="stops" value={stopsJson} />

        <ul className="space-y-2">
          {round.stops.map((s) => {
            const d = drafts[s.customerId];
            return (
              <li
                key={s.customerId}
                className={`rounded-lg border bg-surface p-3 ${
                  s.creditCheck.overLimit ? "border-danger" : "border-line"
                } ${d.skipped ? "opacity-50" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span aria-hidden className="text-xl">
                    {s.customerType === "INSTITUTION" ? "🏫" : s.customerType === "COOP" ? "🏢" : "🏠"}
                  </span>
                  <Link
                    href={`/sales/customers/${s.customerId}`}
                    className="min-w-36 text-lg font-semibold hover:underline"
                  >
                    {s.name}
                  </Link>

                  <label className="flex items-center gap-2">
                    <span className="sr-only">Litres for {s.name}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min="0"
                      value={d.litres}
                      onChange={(e) => set(s.customerId, { litres: e.target.value })}
                      className="w-24 rounded-md border border-line bg-surface px-3 py-2 text-lg tabular-nums"
                    />
                    <span className="text-ink-2">L</span>
                  </label>

                  {s.rateKesPerLitre !== null ? (
                    <span className="text-sm text-ink-3">
                      {kes(s.rateKesPerLitre, 2)} · {kes((Number(d.litres) || 0) * s.rateKesPerLitre)}
                    </span>
                  ) : (
                    <Chip tone="warn">no price set</Chip>
                  )}

                  <label className="ml-auto flex items-center gap-2">
                    <span className="sr-only">How {s.name} paid</span>
                    <Select
                      className="w-36"
                      value={d.settlement}
                      onChange={(e) => set(s.customerId, { settlement: e.target.value as Settlement })}
                    >
                      <option value="CASH">Cash</option>
                      <option value="MPESA">M-Pesa</option>
                      <option value="CREDIT">On the tab</option>
                    </Select>
                  </label>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!d.skipped}
                      onChange={(e) => set(s.customerId, { skipped: !e.target.checked })}
                      className="size-6"
                      aria-label={`Deliver to ${s.name}`}
                    />
                    <span aria-hidden className={d.skipped ? "text-ink-3" : "text-ok"}>✓</span>
                  </label>
                </div>

                {s.balanceKes > 0 ? (
                  <p className="mt-1 text-sm text-ink-2">
                    Owes {kes(s.balanceKes)}
                    {s.daysSincePayment !== null ? ` · last paid ${s.daysSincePayment} days ago` : ""}
                  </p>
                ) : null}

                {s.creditCheck.overLimit && s.creditCheck.message ? (
                  <div className="mt-2">
                    <SoftWarning message={s.creditCheck.message}>
                      <span className="mt-2 block text-xs">
                        Untick the ✓ to skip, or leave it to deliver anyway.
                      </span>
                    </SoftWarning>
                  </div>
                ) : null}

                {s.deliveredL !== null ? (
                  <p className="mt-1 text-sm text-ok">Already delivered {s.deliveredL} L today.</p>
                ) : null}
                {s.requiresDeliveryNote ? (
                  <p className="mt-1 text-xs text-ink-3">Needs a delivery note, counter-signed.</p>
                ) : null}
              </li>
            );
          })}
        </ul>

        {round.pausedToday.length > 0 ? (
          <Card className="mt-3">
            <p className="text-sm font-medium">Not today</p>
            <ul className="mt-1 text-sm text-ink-2">
              {round.pausedToday.map((p) => (
                <li key={p.customerId}>
                  {p.name} — {p.note}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-line bg-paper/95 py-3">
          <div>
            <p className="text-sm text-ink-2">{live.length} stops</p>
            <p className="text-2xl font-semibold tabular-nums">{totals.litres.toFixed(1)} L</p>
            <p className="text-sm text-ink-3">
              {kes(totals.cash)} paid · {kes(totals.credit)} on credit
            </p>
          </div>
          <SaveButton disabled={live.length === 0} />
        </div>
      </form>
    </div>
  );
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? "Saving…" : "Finish round"}
    </Button>
  );
}
