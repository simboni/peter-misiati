"use client";

import { useActionState } from "react";
import { Card, Field, TextInput, Select, Receipt, SoftWarning } from "@/components/ui";
import {
  SubmitButton,
  ErrorBanner,
  AnimalPicker,
  type AnimalOption,
  type FormAction,
  type Result,
} from "./form-kit";

export interface HeatResultView {
  id: string;
  observedAt: string;
  advice: string;
  serveOn: string;
  animalName: string;
  servable: boolean;
  warning: string | null;
}

/**
 * Heat, in five seconds: pick the cow, tap save.
 *
 * The date and time are prefilled with now, which is the one prefill that is
 * always safe (R5 forbids prefilling money and drug doses, not the clock). What
 * comes back is the AM/PM rule already applied, not explained.
 */
export function HeatForm({
  action,
  animals,
  defaultAnimalId,
  nowLocal,
}: {
  action: FormAction<HeatResultView>;
  animals: AnimalOption[];
  defaultAnimalId?: string;
  nowLocal: string;
}) {
  const [state, formAction] = useActionState<Result<HeatResultView> | null, FormData>(action, null);

  return (
    <div className="space-y-4">
      {state?.ok ? (
        <>
          <Receipt
            title={`${state.data.animalName} is on heat`}
            lines={[state.data.advice, `Serve on ${state.data.serveOn}`]}
            refCode={state.refCode}
            tone={state.data.warning ? "warn" : "ok"}
          >
            <p className="mt-3">
              <a
                href="/breeding/service"
                className="tap inline-flex rounded-md border border-line px-4 py-2 text-sm font-semibold"
              >
                Record the service
              </a>
            </p>
          </Receipt>
          {state.data.warning ? <SoftWarning message={state.data.warning} /> : null}
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

          <Field label="When you saw it" hint="Morning or evening changes when she should be served.">
            <TextInput type="datetime-local" name="observedAt" defaultValue={nowLocal} />
          </Field>

          <Field label="What you saw" hint="Standing to be mounted is the certain one.">
            <Select name="sign" defaultValue="STANDING">
              <option value="STANDING">Standing to be mounted</option>
              <option value="MOUNTING_OTHERS">Mounting others</option>
              <option value="MUCUS">Clear mucus</option>
              <option value="SWOLLEN_VULVA">Swollen vulva</option>
              <option value="RESTLESS">Restless, bellowing</option>
              <option value="YIELD_DROP">Milk dropped</option>
            </Select>
          </Field>
        </Card>

        <SubmitButton pendingLabel="Saving…">She is on heat</SubmitButton>
      </form>
    </div>
  );
}
