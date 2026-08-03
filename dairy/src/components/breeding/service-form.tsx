"use client";

import { useActionState } from "react";
import { Card, Field, TextInput, Select, Receipt, SoftWarning, Chip } from "@/components/ui";
import {
  SubmitButton,
  FieldError,
  ErrorBanner,
  MoreFields,
  AnimalPicker,
  type AnimalOption,
  type FormAction,
  type Result,
} from "./form-kit";

export interface CalendarView {
  servedOn: string;
  expectedReturnOn: string;
  pdDueOn: string;
  expectedCalvingOn: string;
  dryOffDueOn: string;
  steamingUpFrom: string;
  gestationDays: number;
}

export interface ServiceResultView {
  id: string;
  animalName: string;
  serviceNumber: number;
  calendar: CalendarView;
  returnInterpretation:
    | { verdict: string; intervalDays: number; message: string; previousServedOn: string }
    | null;
  warnings: string[];
  calendarLines: string[];
}

/**
 * Record a service — the flow that sells the system.
 *
 * Everything above the fold is one tap plus a date. What justifies the screen
 * is what comes back: a whole calendar, generated and shown at the moment of
 * entry rather than arriving as alerts months later.
 */
export function ServiceForm({
  action,
  animals,
  bulls,
  defaultAnimalId,
  today,
}: {
  action: FormAction<ServiceResultView>;
  animals: AnimalOption[];
  bulls: AnimalOption[];
  defaultAnimalId?: string;
  today: string;
}) {
  const [state, formAction] = useActionState<Result<ServiceResultView> | null, FormData>(action, null);

  if (state?.ok) return <ServiceReceipt result={state} />;

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-4">
      {state && !state.ok ? <ErrorBanner message={state.error} /> : null}

      <Card className="space-y-4">
        <AnimalPicker animals={animals} defaultValue={defaultAnimalId} errors={fieldErrors?.animalId} />

        <Field label="Day she was served">
          <TextInput type="date" name="servedOn" defaultValue={today} max={today} required />
          <FieldError errors={fieldErrors?.servedOn} />
        </Field>

        <Field label="How">
          <Select name="serviceType" defaultValue="AI">
            <option value="AI">AI (straw)</option>
            <option value="NATURAL">Bull</option>
            <option value="ET">Embryo transfer</option>
          </Select>
        </Field>

        <Field label="Straw code" hint="Whatever is written on the straw.">
          <TextInput name="strawCode" autoComplete="off" />
        </Field>

        <Field label="What it cost, in shillings" hint="Never prefilled — AI prices move.">
          <TextInput type="number" name="costKes" min={0} step="1" inputMode="numeric" />
        </Field>
      </Card>

      <MoreFields>
        <Field label="Semen type">
          <Select name="semenType" defaultValue="">
            <option value="">Not recorded</option>
            <option value="CONVENTIONAL">Conventional</option>
            <option value="SEXED">Sexed</option>
          </Select>
        </Field>
        <Field label="Straw batch">
          <TextInput name="strawBatch" autoComplete="off" />
        </Field>
        <Field label="Sire breed">
          <TextInput name="sireBreed" autoComplete="off" />
        </Field>
        <Field label="If a bull on this farm served her">
          <Select name="bullId" defaultValue="">
            <option value="">Not our bull</option>
            {bulls.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="How it was paid for">
          <Select name="costSettledBy" defaultValue="">
            <option value="">Not recorded</option>
            <option value="CASH">Cash</option>
            <option value="CREDIT">On credit</option>
            <option value="COOP_CHECKOFF">Co-op check-off</option>
          </Select>
        </Field>
      </MoreFields>

      <SubmitButton pendingLabel="Recording…">Record the service</SubmitButton>
    </form>
  );
}

function ServiceReceipt({ result }: { result: Extract<Result<ServiceResultView>, { ok: true }> }) {
  const { data, refCode } = result;
  const c = data.calendar;

  return (
    <div className="space-y-4">
      <Receipt
        title={`${data.animalName} served — service ${data.serviceNumber}`}
        lines={[`${c.servedOn} · ${c.gestationDays}-day gestation for her breed`]}
        refCode={refCode}
      />

      <Card>
        <h2 className="text-lg font-semibold">What happens next</h2>
        <p className="mt-1 text-sm text-ink-2">
          All of it is already in the diary. You will be told on the day.
        </p>
        <ol className="mt-4 space-y-3">
          <Step icon="♥" when={c.expectedReturnOn} what="Watch for a return to heat" note="21 days" />
          <Step icon="🩺" when={c.pdDueOn} what="Pregnancy check due" note="60 days" />
          <Step icon="🌾" when={c.dryOffDueOn} what="Dry her off and start steaming up" note="60 days before calving" />
          <Step icon="🐄" when={c.expectedCalvingOn} what="Calving expected" note={`${c.gestationDays} days`} emphasise />
        </ol>
      </Card>

      {data.returnInterpretation ? (
        <Card>
          <div className="flex items-start gap-3">
            <span aria-hidden className="text-2xl">
              {data.returnInterpretation.verdict === "MISSED_HEAT" ? "🔴" : "🟠"}
            </span>
            <div>
              <p className="font-semibold">
                {data.returnInterpretation.intervalDays} days since the service on{" "}
                {data.returnInterpretation.previousServedOn}
              </p>
              <p className="mt-1 text-sm text-ink-2">{data.returnInterpretation.message}</p>
              {data.returnInterpretation.verdict === "MISSED_HEAT" ? (
                <p className="mt-2">
                  <Chip tone="danger">Heat detection, not fertility</Chip>
                </p>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {data.warnings.map((w) => (
        <SoftWarning key={w} message={w} />
      ))}

      <div className="flex flex-wrap gap-2">
        <a href="/breeding" className="tap rounded-md border border-line bg-surface px-4 py-2 text-sm font-semibold">
          Back to the board
        </a>
        <a href="/breeding/service" className="tap rounded-md border border-line bg-surface px-4 py-2 text-sm font-semibold">
          Record another
        </a>
      </div>
    </div>
  );
}

function Step({
  icon,
  when,
  what,
  note,
  emphasise,
}: {
  icon: string;
  when: string;
  what: string;
  note?: string;
  emphasise?: boolean;
}) {
  return (
    <li className="flex items-baseline gap-3 border-t border-line pt-3 first:border-0 first:pt-0">
      <span aria-hidden className="text-lg">
        {icon}
      </span>
      <span className={`tabular-nums ${emphasise ? "text-lg font-bold" : "font-semibold"}`}>{when}</span>
      <span className="min-w-0 text-sm text-ink-2">
        {what}
        {note ? <span className="text-ink-3"> · {note}</span> : null}
      </span>
    </li>
  );
}
