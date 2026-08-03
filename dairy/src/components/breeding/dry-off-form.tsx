"use client";

import { useActionState } from "react";
import { Card, Field, TextInput, Select, Receipt, SoftWarning, HardBlock } from "@/components/ui";
import {
  SubmitButton,
  ErrorBanner,
  AnimalPicker,
  type AnimalOption,
  type FormAction,
  type Result,
} from "./form-kit";

export interface DryOffResultView {
  id: string;
  animalName: string;
  driedOn: string;
  expectedCalvingOn: string | null;
  dryDays: number | null;
  milkClearOn: string | null;
  warnings: string[];
  nextAction: string;
}

/**
 * Dry off, and start steaming up on the same day.
 *
 * Dry cow therapy is the one place a withdrawal is easy to get wrong: the milk
 * is not clear until BOTH 30 days after infusion AND 96 hours after calving,
 * whichever falls later. That comes back as a hard block, not a note.
 */
export function DryOffForm({
  action,
  animals,
  products,
  defaultAnimalId,
  today,
}: {
  action: FormAction<DryOffResultView>;
  animals: AnimalOption[];
  products: AnimalOption[];
  defaultAnimalId?: string;
  today: string;
}) {
  const [state, formAction] = useActionState<Result<DryOffResultView> | null, FormData>(action, null);

  return (
    <div className="space-y-4">
      {state?.ok ? (
        <>
          <Receipt
            title={`${state.data.animalName} is dry`}
            lines={[
              state.data.nextAction,
              ...(state.data.dryDays != null ? [`${state.data.dryDays} days until she calves.`] : []),
            ]}
            refCode={state.refCode}
            tone={state.data.warnings.length ? "warn" : "ok"}
          />
          {state.data.milkClearOn ? (
            <HardBlock
              message={`Do not sell ${state.data.animalName}'s milk until ${state.data.milkClearOn}.`}
            />
          ) : null}
          {state.data.warnings.map((w) => (
            <SoftWarning key={w} message={w} />
          ))}
        </>
      ) : null}

      <form action={formAction} className="space-y-4">
        {state && !state.ok ? <ErrorBanner message={state.error} /> : null}

        <Card className="space-y-4">
          <AnimalPicker
            animals={animals}
            defaultValue={defaultAnimalId}
            errors={state && !state.ok ? state.fieldErrors?.animalId : undefined}
          />

          <Field label="Day you stopped milking her">
            <TextInput type="date" name="driedOn" defaultValue={today} max={today} />
          </Field>

          <Field label="How" hint="Stopping all at once is the usual advice.">
            <Select name="method" defaultValue="ABRUPT">
              <option value="ABRUPT">All at once</option>
              <option value="GRADUAL">Gradually</option>
            </Select>
          </Field>

          <Field
            label="Dry cow tubes used"
            hint="Never prefilled. If you used them, the withdrawal is worked out for you."
          >
            <Select name="dryCowTherapyProductId" defaultValue="">
              <option value="">None used</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        </Card>

        <SubmitButton pendingLabel="Recording…">Dry her off</SubmitButton>
      </form>
    </div>
  );
}
