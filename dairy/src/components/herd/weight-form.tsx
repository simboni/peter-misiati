"use client";

import { useActionState } from "react";
import { Card, Field, TextInput, Select, Receipt, SoftWarning } from "@/components/ui";
import { SubmitButton, FieldError, ErrorBanner, type FormAction, type Result } from "./form-kit";

export interface WeightResultView {
  id: string;
  weightKg: number | null;
  bcs: number | null;
  gainGramsPerDay: number | null;
  sinceDays: number | null;
  warnings: string[];
}

/**
 * Weigh / score. Three fields, one of which blocks.
 *
 * The point of the screen is what comes back: grams a day since the last
 * weighing, which is the only form of the number a farmer can act on.
 */
export function WeightForm({
  action,
  animalId,
  animalName,
  today,
  lastWeightKg,
  lastWeightOn,
}: {
  action: FormAction<WeightResultView>;
  animalId: string;
  animalName: string;
  today: string;
  lastWeightKg?: number | null;
  lastWeightOn?: string | null;
}) {
  const [state, formAction] = useActionState<Result<WeightResultView> | null, FormData>(action, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <div className="space-y-4">
      {state?.ok ? (
        <Receipt
          title={state.message ?? "Recorded."}
          lines={[
            state.data.weightKg != null ? `${state.data.weightKg} kg` : "No weight taken",
            state.data.bcs != null ? `Body condition ${state.data.bcs.toFixed(2)} of 5` : "No score taken",
            state.data.gainGramsPerDay != null
              ? `${state.data.gainGramsPerDay} g a day over ${state.data.sinceDays} days`
              : "First weight on record — the next one will show her growth rate.",
          ]}
          refCode={state.refCode}
          tone={state.data.warnings.length ? "warn" : "ok"}
        />
      ) : null}

      {state?.ok && state.data.warnings.length
        ? state.data.warnings.map((w) => <SoftWarning key={w} message={w} />)
        : null}

      <form action={formAction} className="space-y-4">
        {state && !state.ok ? <ErrorBanner message={state.error} /> : null}
        <input type="hidden" name="animalId" value={animalId} />

        <Card className="space-y-4">
          <Field label="Day">
            <TextInput type="date" name="observedOn" defaultValue={today} max={today} />
          </Field>

          <Field
            label={`Weight of ${animalName}, in kg`}
            hint={
              lastWeightKg != null
                ? `Last time: ${lastWeightKg} kg on ${lastWeightOn}. Left blank on purpose — never prefill a measurement.`
                : "A heart-girth tape is fine. An estimate is better than nothing."
            }
          >
            <TextInput type="number" name="weightKg" min={0} step="0.5" inputMode="decimal" />
            <FieldError errors={fieldErrors?.weightKg} />
          </Field>

          <Field
            label="Body condition, 1 to 5"
            hint="3 is right for a milking cow. Quarter steps only."
          >
            <Select name="bcs" defaultValue="">
              <option value="">Not scored</option>
              {[1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 4.25, 4.5, 4.75, 5].map(
                (v) => (
                  <option key={v} value={v.toFixed(2)}>
                    {v.toFixed(2)}
                  </option>
                ),
              )}
            </Select>
            <FieldError errors={fieldErrors?.bcs} />
          </Field>

          <Field label="How it was measured">
            <Select name="method" defaultValue="HEART_GIRTH">
              <option value="SCALE">Weighbridge or scale</option>
              <option value="HEART_GIRTH">Heart-girth tape</option>
              <option value="ESTIMATE">Eye estimate</option>
            </Select>
          </Field>
        </Card>

        <SubmitButton>Record it</SubmitButton>
      </form>
    </div>
  );
}
