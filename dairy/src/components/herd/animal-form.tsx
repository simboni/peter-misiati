"use client";

import Link from "next/link";

import { useActionState } from "react";
import { Card, Field, TextInput, Select, Receipt, Chip } from "@/components/ui";
import { SubmitButton, FieldError, ErrorBanner, MoreFields, type FormAction, type Result } from "./form-kit";

export interface ScheduleItemView {
  routine: string;
  label: string;
  dueOn: string;
  windowClosesOn: string | null;
  onceInLifetime: boolean;
  action: string;
  note?: string;
  severity: "INFO" | "WARN" | "CRITICAL";
}

export interface RegisterResultView {
  id: string;
  tag: string;
  name: string | null;
  cls: string;
  classLabel: string;
  schedule: ScheduleItemView[];
}

export interface ParentOption {
  id: string;
  label: string;
}

/**
 * Add an animal.
 *
 * Five fields carry the screen and only two of them can stop a save (R1). The
 * payoff is R7: the moment she is registered the whole first year of her care
 * comes back, on this screen, rather than as reminders someone hopes will
 * arrive later.
 */
export function AnimalForm({
  action,
  dams,
  sires,
  today,
}: {
  action: FormAction<RegisterResultView>;
  dams: ParentOption[];
  sires: ParentOption[];
  today: string;
}) {
  const [state, formAction] = useActionState<Result<RegisterResultView> | null, FormData>(
    action,
    null,
  );

  if (state?.ok) {
    return <RegisteredReceipt result={state} />;
  }

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-4">
      {state && !state.ok ? <ErrorBanner message={state.error} /> : null}

      <Card className="space-y-4">
        <Field label="Ear tag number" hint="However you write it on the tag.">
          <TextInput name="tag" required autoComplete="off" inputMode="text" />
          <FieldError errors={fieldErrors?.tag} />
        </Field>

        <Field label="Name" hint="Optional, but everyone will use it instead of the tag.">
          <TextInput name="name" autoComplete="off" />
        </Field>

        <Field label="Female or male">
          <Select name="sex" defaultValue="F" required>
            <option value="F">Female</option>
            <option value="M">Male</option>
          </Select>
          <FieldError errors={fieldErrors?.sex} />
        </Field>

        <Field
          label="Date of birth"
          hint="Her vaccination dates are worked out from this. An estimate is far better than nothing."
        >
          <TextInput type="date" name="dateOfBirth" max={today} />
          <FieldError errors={fieldErrors?.dateOfBirth} />
        </Field>

        <Field label="Breed" hint="Drives how long she carries a calf.">
          <Select name="primaryBreed" defaultValue="">
            <option value="">Not sure</option>
            <option value="FRIESIAN">Friesian</option>
            <option value="HOLSTEIN-FRIESIAN">Holstein-Friesian</option>
            <option value="AYRSHIRE">Ayrshire</option>
            <option value="JERSEY">Jersey</option>
            <option value="GUERNSEY">Guernsey</option>
            <option value="SAHIWAL">Sahiwal</option>
            <option value="BORAN">Boran</option>
            <option value="ZEBU">Zebu</option>
          </Select>
        </Field>
      </Card>

      <MoreFields>
        <Field label="Is the date of birth a guess?">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" name="dobEstimated" className="h-6 w-6" />
            Yes, it is estimated
          </label>
        </Field>

        <Field label="Breed mix" hint="For example: 3/4 Friesian x 1/4 Zebu">
          <TextInput name="breedComposition" autoComplete="off" />
        </Field>

        <Field label="How she came to the farm">
          <Select name="origin" defaultValue="BORN">
            <option value="BORN">Born here</option>
            <option value="PURCHASED">Bought</option>
            <option value="GIFT">Gift</option>
            <option value="DONATION">Donation</option>
          </Select>
        </Field>

        <Field label="Day she joined the herd">
          <TextInput type="date" name="enteredHerdOn" defaultValue={today} max={today} />
        </Field>

        <Field label="Mother">
          <Select name="damId" defaultValue="">
            <option value="">Not recorded</option>
            {dams.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Father">
          <Select name="sireId" defaultValue="">
            <option value="">Not recorded</option>
            {sires.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Straw code" hint="If she was bred by AI.">
          <TextInput name="sireStrawCode" autoComplete="off" />
        </Field>

        <Field label="What she cost" hint="Only if you bought her.">
          <TextInput type="number" name="purchasePriceKes" min={0} step="1" inputMode="numeric" />
        </Field>

        <Field label="KLBA registration number">
          <TextInput name="klbaRegNo" autoComplete="off" />
        </Field>

        <Field
          label="Set her stage by hand"
          hint="Only for a bought-in animal whose history you do not have. Otherwise the app works it out from her records."
        >
          <Select name="classOverride" defaultValue="">
            <option value="">Work it out from her records</option>
            <option value="CALF">Calf</option>
            <option value="WEANER">Weaner</option>
            <option value="HEIFER">Heifer</option>
            <option value="BULLING_HEIFER">Bulling heifer</option>
            <option value="INCALF_HEIFER">In-calf heifer</option>
            <option value="SPRINGER">Springer</option>
            <option value="FIRST_CALVER">First calver</option>
            <option value="LACTATING_COW">Milking cow</option>
            <option value="DRY_COW">Dry cow</option>
            <option value="MATURE_COW">Mature milking cow</option>
            <option value="BULL">Bull</option>
            <option value="STEER">Steer</option>
          </Select>
        </Field>

        <Field label="Castrated">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" name="castrated" className="h-6 w-6" />
            Yes
          </label>
        </Field>

        <Field label="Notes">
          <TextInput name="notes" autoComplete="off" />
        </Field>
      </MoreFields>

      <SubmitButton pendingLabel="Adding…">Add to the herd</SubmitButton>
    </form>
  );
}

const SEVERITY_MARK: Record<string, string> = { CRITICAL: "🔴", WARN: "🟠", INFO: "🟢" };

/**
 * R7 in its purest form: one registration in, a year of care out, shown now.
 */
function RegisteredReceipt({ result }: { result: Extract<Result<RegisterResultView>, { ok: true }> }) {
  const { data, message, refCode } = result;
  return (
    <div className="space-y-4">
      <Receipt
        title={message ?? `${data.name ?? data.tag} is registered.`}
        lines={[`Tag ${data.tag}`, `Stage today: ${data.classLabel}`]}
        refCode={refCode}
      >
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/herd/${data.id}`}
            className="tap inline-flex items-center rounded-md border border-line px-4 py-2 text-sm font-semibold"
          >
            Open her card
          </a>
          <Link
            href="/herd/new"
            className="tap inline-flex items-center rounded-md border border-line px-4 py-2 text-sm font-semibold"
          >
            Add another
          </Link>
        </div>
      </Receipt>

      {data.schedule.length > 0 ? (
        <Card>
          <h2 className="text-lg font-semibold">Her first year</h2>
          <p className="mt-1 text-sm text-ink-2">
            {data.schedule.length} things she needs, with the dates already worked out. You will be
            reminded on the day.
          </p>
          <ol className="mt-4 space-y-3">
            {data.schedule.map((i) => (
              <li key={i.routine} className="flex gap-3 border-t border-line pt-3 first:border-0 first:pt-0">
                <span aria-hidden className="text-lg leading-6">
                  {SEVERITY_MARK[i.severity]}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">
                    {i.label}{" "}
                    <span className="tabular-nums font-normal text-ink-2">· {i.dueOn}</span>
                  </p>
                  {i.windowClosesOn ? (
                    <p className="mt-0.5 text-xs text-ink-3">
                      The window closes {i.windowClosesOn}
                      {i.onceInLifetime ? " — and it is once in her life" : ""}.
                    </p>
                  ) : null}
                  {i.note ? <p className="mt-0.5 text-xs text-ink-3">{i.note}</p> : null}
                </div>
                {i.onceInLifetime ? (
                  <span className="ml-auto shrink-0">
                    <Chip tone="warn">Once only</Chip>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </div>
  );
}
