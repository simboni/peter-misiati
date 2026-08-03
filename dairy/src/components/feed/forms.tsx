"use client";

/**
 * Feed entry forms.
 *
 * The Server Actions arrive as props from the page rather than being imported
 * here, so `src/server/feed.ts` — which reads the database and takes a session
 * — never enters the client bundle.
 */

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/dal";
import { Button, Card, Field, Receipt, Select, SoftWarning, TextInput } from "@/components/ui";
import { FEED_UNITS, UNIT_LABEL, requiresExplicitWeight, type FeedUnit } from "@/lib/domain/feed";

type Action<T> = (prev: unknown, formData: FormData) => Promise<ActionResult<T>>;

/* ---------------------------------------------------------------- */

function Submit({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Saving…" : children}
    </Button>
  );
}

/**
 * The result panel. A save is confirmed by a persistent receipt, never a toast
 * — a toast that vanishes before a herdsman looks up is the same as no
 * confirmation at all (R6).
 */
function Outcome({
  state,
  title,
  lines,
}: {
  state: ActionResult<unknown> | null;
  title: string;
  lines: (data: never) => string[];
}) {
  if (!state) return null;
  if (!state.ok) {
    return <Receipt title="Not saved" tone="danger" lines={[state.error]} />;
  }
  return <Receipt title={title} tone="ok" lines={lines(state.data as never)} refCode={state.refCode} />;
}

/* ---------------------------------------------------------------- */
/* Purchase                                                          */
/* ---------------------------------------------------------------- */

export interface FeedOption {
  id: string;
  name: string;
  defaultUnit: string;
  defaultUnitWeightKg: number | null;
}

export function PurchaseForm({
  action,
  feeds,
  today,
}: {
  action: Action<{ totalKg: number; costPerKgKes: number; balanceKg: number; receiptLines: string[] }>;
  feeds: FeedOption[];
  today: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const [feedId, setFeedId] = useState(feeds[0]?.id ?? "");
  const feed = feeds.find((f) => f.id === feedId);
  const [unit, setUnit] = useState<FeedUnit>((feed?.defaultUnit as FeedUnit) ?? "BAG_70KG");

  const knownWeight = feed && feed.defaultUnit === unit ? feed.defaultUnitWeightKg : null;
  const mustWeigh = requiresExplicitWeight(unit) && !knownWeight;

  return (
    <form action={formAction} className="space-y-4">
      <Card className="space-y-4">
        <Field label="Feed">
          <Select
            name="feedItemId"
            value={feedId}
            onChange={(e) => {
              setFeedId(e.target.value);
              const next = feeds.find((f) => f.id === e.target.value);
              if (next) setUnit(next.defaultUnit as FeedUnit);
            }}
            required
          >
            {feeds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="How many">
            <TextInput name="quantity" type="number" inputMode="decimal" step="0.001" min="0" required />
          </Field>
          <Field label="Measured in">
            <Select name="unit" value={unit} onChange={(e) => setUnit(e.target.value as FeedUnit)}>
              {FEED_UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {mustWeigh || requiresExplicitWeight(unit) ? (
          <Field
            label={`Weight of one ${UNIT_LABEL[unit].replace(/s$/, "")} (kg)`}
            hint="A bale is not a fixed size. Weigh one — every cost figure depends on this."
            error={state && !state.ok ? state.fieldErrors?.unitWeightKg?.[0] : undefined}
          >
            <TextInput
              name="unitWeightKg"
              type="number"
              inputMode="decimal"
              step="0.001"
              min="0"
              defaultValue={knownWeight ?? ""}
              required={mustWeigh}
            />
          </Field>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label={`Price per ${UNIT_LABEL[unit].replace(/s$/, "")} (KES)`}>
            {/* Never prefilled. Money is the one thing R5 does not carry over. */}
            <TextInput name="unitPriceKes" type="number" inputMode="decimal" step="0.01" min="0" required />
          </Field>
          <Field label="Bought on">
            <TextInput name="purchasedOn" type="date" defaultValue={today} required />
          </Field>
        </div>

        <Submit>Save purchase</Submit>
      </Card>

      <Outcome
        state={state}
        title="Feed received"
        lines={(d: { receiptLines: string[] }) => d.receiptLines}
      />
    </form>
  );
}

/* ---------------------------------------------------------------- */
/* Daily issue — prefilled from yesterday (R5)                       */
/* ---------------------------------------------------------------- */

export interface PrefillRow {
  feedItemId: string;
  name: string;
  unit: string;
  unitWeightKg: number;
  quantity: number;
  prefilledFrom: string | null;
}

export function IssueForm({
  action,
  rows,
  today,
  group,
}: {
  action: Action<{ lines: Array<{ line: string }>; message: string }>;
  rows: PrefillRow[];
  today: string;
  group: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const prefilledFrom = rows.find((r) => r.prefilledFrom)?.prefilledFrom ?? null;

  return (
    <form action={formAction} className="space-y-4">
      {prefilledFrom ? (
        <SoftWarning message={`Filled in from ${prefilledFrom}. Change anything that is different today.`} />
      ) : null}

      <Card className="space-y-4">
        <input type="hidden" name="issuedOn" value={today} />
        <input type="hidden" name="animalGroup" value={group} />

        {rows.map((r) => (
          <div key={r.feedItemId} className="grid grid-cols-[1fr_7rem] items-end gap-3">
            <input type="hidden" name="feedItemId" value={r.feedItemId} />
            <input type="hidden" name="unit" value={r.unit} />
            <input type="hidden" name="unitWeightKg" value={r.unitWeightKg} />
            <Field label={r.name} hint={UNIT_LABEL[r.unit as FeedUnit] ?? r.unit}>
              <TextInput
                name="quantity"
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                defaultValue={r.quantity}
              />
            </Field>
            <span className="pb-3 text-sm text-ink-3 tabular-nums">
              {r.unitWeightKg} kg each
            </span>
          </div>
        ))}

        <Submit>Save today&rsquo;s feeding</Submit>
      </Card>

      <Outcome
        state={state}
        title="Feed issued"
        lines={(d: { lines: Array<{ line: string }> }) => d.lines.map((l) => l.line)}
      />
    </form>
  );
}

/* ---------------------------------------------------------------- */
/* Fodder                                                            */
/* ---------------------------------------------------------------- */

export function FodderForm({
  action,
  today,
}: {
  action: Action<{ totalKg: number | null; costPerKgKes: number | null }>;
  today: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const [unit, setUnit] = useState<FeedUnit>("BALE");

  return (
    <form action={formAction} className="space-y-4">
      <Card className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Crop">
            <TextInput name="crop" placeholder="Napier (Bana)" required />
          </Field>
          <Field label="Plot">
            <TextInput name="plotName" placeholder="Lower plot" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Acres">
            <TextInput name="areaAcres" type="number" inputMode="decimal" step="0.01" min="0" />
          </Field>
          <Field label="Harvested on">
            <TextInput name="harvestedOn" type="date" defaultValue={today} />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="How much">
            <TextInput name="quantity" type="number" inputMode="decimal" step="0.001" min="0" />
          </Field>
          <Field label="Measured in">
            <Select name="unit" value={unit} onChange={(e) => setUnit(e.target.value as FeedUnit)}>
              {FEED_UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="kg each" hint={requiresExplicitWeight(unit) ? "Weigh one." : undefined}>
            <TextInput
              name="unitWeightKg"
              type="number"
              inputMode="decimal"
              step="0.001"
              min="0"
              required={requiresExplicitWeight(unit)}
            />
          </Field>
        </div>

        <Field label="What it cost to grow (KES)" hint="Seed, fertiliser, labour. This is what makes home-grown fodder comparable with bought feed.">
          <TextInput name="inputCostKes" type="number" inputMode="decimal" step="0.01" min="0" />
        </Field>

        <Submit>Save harvest</Submit>
      </Card>

      <Outcome
        state={state}
        title="Harvest recorded"
        lines={(d: { totalKg: number | null; costPerKgKes: number | null }) =>
          [
            d.totalKg ? `${d.totalKg} kg into the store.` : "Recorded.",
            d.costPerKgKes != null ? `KES ${d.costPerKgKes.toFixed(2)} a kilo to grow.` : "",
          ].filter(Boolean)
        }
      />
    </form>
  );
}
