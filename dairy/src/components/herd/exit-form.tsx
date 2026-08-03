"use client";

import { useActionState } from "react";
import { Card, Field, TextInput, Select, Receipt, SoftWarning } from "@/components/ui";
import { SubmitButton, ErrorBanner, MoreFields, type FormAction, type Result } from "./form-kit";

export interface ExitResultView {
  id: string;
  classAtExit: string;
  classLabel: string;
  daysInMilkAtSale: number | null;
  valueKes: number | null;
  warnings: string[];
}

/**
 * An animal leaving the herd.
 *
 * The extra fields are not bureaucracy: in a Kenyan market the price is driven
 * by months in calf, litres a day and weight, and a farm that never records
 * them can never tell whether it sold well.
 */
export function ExitForm({
  action,
  animalId,
  animalName,
  today,
}: {
  action: FormAction<ExitResultView>;
  animalId: string;
  animalName: string;
  today: string;
}) {
  const [state, formAction] = useActionState<Result<ExitResultView> | null, FormData>(action, null);

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <Receipt
          title={state.message ?? `${animalName} has left the herd.`}
          lines={[
            `Recorded as a ${state.data.classLabel.toLowerCase()}`,
            state.data.daysInMilkAtSale != null
              ? `${state.data.daysInMilkAtSale} days into her lactation`
              : "Not in milk",
          ]}
          refCode={state.refCode}
          tone="warn"
        />
        {state.data.warnings.map((w) => (
          <SoftWarning key={w} message={w} />
        ))}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state && !state.ok ? <ErrorBanner message={state.error} /> : null}
      <input type="hidden" name="animalId" value={animalId} />

      <Card className="space-y-4">
        <Field label={`Why ${animalName} left`}>
          <Select name="reason" defaultValue="SOLD" required>
            <option value="SOLD">Sold</option>
            <option value="CULLED">Culled</option>
            <option value="DIED">Died</option>
            <option value="SLAUGHTERED">Slaughtered</option>
            <option value="STOLEN">Stolen</option>
            <option value="LOST">Lost</option>
          </Select>
        </Field>

        <Field label="Day">
          <TextInput type="date" name="exitDate" defaultValue={today} max={today} />
        </Field>

        <Field label="What she fetched, in shillings" hint="Leave blank if nothing changed hands.">
          <TextInput type="number" name="valueKes" min={0} step="1" inputMode="numeric" />
        </Field>
      </Card>

      <MoreFields label="What the price was based on">
        <Field label="Weight, in kg">
          <TextInput type="number" name="weightKg" min={0} step="0.5" inputMode="decimal" />
        </Field>
        <Field label="Months in calf" hint="Most of what an in-calf cow is worth.">
          <TextInput type="number" name="monthsPregnant" min={0} max={10} step="0.5" inputMode="decimal" />
        </Field>
        <Field label="Litres a day at the time">
          <TextInput type="number" name="dailyYieldAtSaleL" min={0} step="0.5" inputMode="decimal" />
        </Field>
        <Field label="What she died of, or why she was culled">
          <TextInput name="cause" autoComplete="off" />
        </Field>
      </MoreFields>

      <SubmitButton pendingLabel="Recording…">Record that she left</SubmitButton>
    </form>
  );
}
