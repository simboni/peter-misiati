"use client";

import { useActionState } from "react";
import { Card, Field, TextInput, Select, Receipt } from "@/components/ui";
import {
  SubmitButton,
  ErrorBanner,
  MoreFields,
  AnimalPicker,
  type AnimalOption,
  type FormAction,
  type Result,
} from "./form-kit";

export interface PdResultView {
  id: string;
  animalName: string;
  result: "POSITIVE" | "NEGATIVE" | "INCONCLUSIVE";
  expectedCalvingOn: string | null;
  dryOffDueOn: string | null;
  recheckOn: string | null;
  nextAction: string;
}

/**
 * Pregnancy diagnosis. Rectal palpation is the Kenyan default, so it leads.
 *
 * The result is not filed — it changes the diary. A positive confirms the
 * calving date and the dry-off; a negative tears the rest of the calendar down
 * and puts her back on heat watch the same afternoon.
 */
export function PregnancyCheckForm({
  action,
  animals,
  defaultAnimalId,
  today,
}: {
  action: FormAction<PdResultView>;
  animals: AnimalOption[];
  defaultAnimalId?: string;
  today: string;
}) {
  const [state, formAction] = useActionState<Result<PdResultView> | null, FormData>(action, null);

  return (
    <div className="space-y-4">
      {state?.ok ? (
        <Receipt
          title={`${state.data.animalName}: ${
            state.data.result === "POSITIVE"
              ? "in calf"
              : state.data.result === "NEGATIVE"
                ? "not in calf"
                : "not clear yet"
          }`}
          lines={[
            state.data.nextAction,
            ...(state.data.expectedCalvingOn ? [`Calving expected ${state.data.expectedCalvingOn}`] : []),
            ...(state.data.dryOffDueOn ? [`Dry her off ${state.data.dryOffDueOn}`] : []),
            ...(state.data.recheckOn ? [`Check again ${state.data.recheckOn}`] : []),
          ]}
          refCode={state.refCode}
          tone={state.data.result === "POSITIVE" ? "ok" : state.data.result === "NEGATIVE" ? "warn" : "warn"}
        />
      ) : null}

      <form action={formAction} className="space-y-4">
        {state && !state.ok ? <ErrorBanner message={state.error} /> : null}

        <Card className="space-y-4">
          <AnimalPicker
            animals={animals}
            defaultValue={defaultAnimalId}
            errors={state && !state.ok ? state.fieldErrors?.animalId : undefined}
          />

          <Field label="Day of the check">
            <TextInput type="date" name="checkedOn" defaultValue={today} max={today} />
          </Field>

          <Field label="Result">
            <Select name="result" defaultValue="POSITIVE" required>
              <option value="POSITIVE">In calf</option>
              <option value="NEGATIVE">Not in calf</option>
              <option value="INCONCLUSIVE">Not clear</option>
            </Select>
          </Field>

          <Field label="How she was checked">
            <Select name="method" defaultValue="PALPATION">
              <option value="PALPATION">Rectal palpation</option>
              <option value="ULTRASOUND">Ultrasound</option>
              <option value="PROGESTERONE">Progesterone test</option>
              <option value="PAG">Blood (PAG) test</option>
              <option value="NON_RETURN">She simply did not return</option>
            </Select>
          </Field>
        </Card>

        <MoreFields>
          <Field label="How many months in calf">
            <TextInput type="number" name="monthsPregnant" min={0} max={10} step="0.5" inputMode="decimal" />
          </Field>
          <Field label="What the visit cost, in shillings">
            <TextInput type="number" name="costKes" min={0} step="1" inputMode="numeric" />
          </Field>
        </MoreFields>

        <SubmitButton pendingLabel="Recording…">Record the result</SubmitButton>
      </form>
    </div>
  );
}
