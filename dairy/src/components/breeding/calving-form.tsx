"use client";

import { useActionState, useState } from "react";
import { Card, Field, TextInput, Select, Receipt, SoftWarning, HardBlock, Chip } from "@/components/ui";
import {
  SubmitButton,
  ErrorBanner,
  MoreFields,
  AnimalPicker,
  type AnimalOption,
  type FormAction,
  type Result,
} from "./form-kit";

export interface CalvingResultView {
  id: string;
  damName: string;
  calvedOn: string;
  isAbortion: boolean;
  calves: { id: string; tag: string; name: string | null; sex: "F" | "M"; schedule: { routine: string; label: string; dueOn: string }[] }[];
  lactationNumber: number;
  colostrumUntil: string | null;
  vwpEndsOn: string | null;
  calvingIntervalDays: number | null;
  calvingIntervalTargetDays: number;
  excessDays: number;
  calvingIntervalCostKes: number;
  daysOpenDays: number | null;
  servicesPerConception: number | null;
  abortionProtocol: readonly string[] | null;
  warnings: string[];
}

type OutcomeDraft = { outcome: string; calfSex: string; birthWeightKg: string; calfName: string };

const BLANK: OutcomeDraft = { outcome: "LIVE", calfSex: "F", birthWeightKg: "", calfName: "" };

/**
 * Calving. One entry does four things: the calf record and her whole first-year
 * schedule, the dam's new lactation, the colostrum window, and the numbers —
 * calving interval, days open, services per conception — with what the overrun
 * cost in shillings.
 *
 * Twins are ordinary on a dairy farm, so the outcome list is a list from the
 * start rather than a special case bolted on later.
 */
export function CalvingForm({
  action,
  animals,
  defaultAnimalId,
  today,
}: {
  action: FormAction<CalvingResultView>;
  animals: AnimalOption[];
  defaultAnimalId?: string;
  today: string;
}) {
  const [state, formAction] = useActionState<Result<CalvingResultView> | null, FormData>(action, null);
  const [outcomes, setOutcomes] = useState<OutcomeDraft[]>([BLANK]);

  if (state?.ok) return <CalvingReceipt result={state} />;

  const set = (i: number, patch: Partial<OutcomeDraft>) =>
    setOutcomes((list) => list.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  const payload = JSON.stringify(
    outcomes.map((o) => ({
      outcome: o.outcome,
      ...(o.outcome === "ABORTION" ? {} : { calfSex: o.calfSex }),
      ...(o.birthWeightKg ? { birthWeightKg: Number(o.birthWeightKg) } : {}),
      ...(o.calfName ? { calfName: o.calfName } : {}),
    })),
  );

  return (
    <form action={formAction} className="space-y-4">
      {state && !state.ok ? <ErrorBanner message={state.error} /> : null}
      <input type="hidden" name="outcomes" value={payload} />

      <Card className="space-y-4">
        <AnimalPicker
          animals={animals}
          label="Which cow calved"
          name="damId"
          defaultValue={defaultAnimalId}
          errors={state && !state.ok ? state.fieldErrors?.damId : undefined}
        />

        <Field label="Day she calved">
          <TextInput type="date" name="calvedOn" defaultValue={today} max={today} required />
        </Field>

        <Field label="How hard it was" hint="1 is on her own, 5 is a caesarean.">
          <Select name="calvingEase" defaultValue="1">
            <option value="1">1 — on her own</option>
            <option value="2">2 — easy pull</option>
            <option value="3">3 — hard pull</option>
            <option value="4">4 — vet assisted</option>
            <option value="5">5 — caesarean</option>
          </Select>
        </Field>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">The calf</h2>
        {outcomes.map((o, i) => (
          <div key={i} className="space-y-3 border-t border-line pt-3 first:border-0 first:pt-0">
            {outcomes.length > 1 ? <p className="text-sm font-medium">Calf {i + 1}</p> : null}
            <Field label="What happened">
              <Select value={o.outcome} onChange={(e) => set(i, { outcome: e.target.value })}>
                <option value="LIVE">Born alive</option>
                <option value="STILLBIRTH">Stillborn</option>
                <option value="DIED_UNDER_24H">Died within a day</option>
                <option value="ABORTION">Aborted</option>
              </Select>
            </Field>

            {o.outcome !== "ABORTION" ? (
              <>
                <Field label="Heifer or bull calf">
                  <Select value={o.calfSex} onChange={(e) => set(i, { calfSex: e.target.value })}>
                    <option value="F">Heifer calf</option>
                    <option value="M">Bull calf</option>
                  </Select>
                </Field>
                <Field label="Birth weight, in kg">
                  <TextInput
                    type="number"
                    min={0}
                    step="0.5"
                    inputMode="decimal"
                    value={o.birthWeightKg}
                    onChange={(e) => set(i, { birthWeightKg: e.target.value })}
                  />
                </Field>
              </>
            ) : null}

            {o.outcome === "LIVE" ? (
              <Field label="Name for the calf" hint="A tag number is made up for you if you skip this.">
                <TextInput value={o.calfName} onChange={(e) => set(i, { calfName: e.target.value })} />
              </Field>
            ) : null}

            {o.outcome === "ABORTION" ? (
              <HardBlock message="Recording an abortion opens the brucellosis steps. It passes to people." />
            ) : null}
          </div>
        ))}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOutcomes((l) => [...l, { ...BLANK }])}
            className="rounded-md border border-line px-4 py-2 text-sm font-semibold"
          >
            <span aria-hidden>➕</span> Twins
          </button>
          {outcomes.length > 1 ? (
            <button
              type="button"
              onClick={() => setOutcomes((l) => l.slice(0, -1))}
              className="rounded-md border border-line px-4 py-2 text-sm"
            >
              Remove
            </button>
          ) : null}
        </div>
      </Card>

      <MoreFields label="How she is">
        <Field label="Placenta not passed within 12 hours">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" name="retainedPlacenta" className="h-6 w-6" /> Yes
          </label>
        </Field>
        <Field label="Milk fever — down, cold ears, wobbly">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" name="milkFever" className="h-6 w-6" /> Yes
          </label>
        </Field>
        <Field label="Notes">
          <TextInput name="notes" autoComplete="off" />
        </Field>
      </MoreFields>

      <SubmitButton pendingLabel="Recording…">Record the calving</SubmitButton>
    </form>
  );
}

function CalvingReceipt({ result }: { result: Extract<Result<CalvingResultView>, { ok: true }> }) {
  const { data, refCode, message } = result;

  return (
    <div className="space-y-4">
      {data.abortionProtocol ? (
        <Card className="border-danger">
          <h2 className="text-lg font-semibold text-danger">
            <span aria-hidden className="mr-2">
              ⛔
            </span>
            Do these things now
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            Brucellosis is common in Kenya, it passes to people, and an abortion is how it usually
            shows itself. This is not paperwork.
          </p>
          <ol className="mt-3 space-y-2 text-sm">
            {data.abortionProtocol.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-bold tabular-nums">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <Receipt
        title={message ?? `${data.damName} calved`}
        lines={[
          `${data.calvedOn} · lactation ${data.lactationNumber}`,
          ...(data.colostrumUntil
            ? [`Her milk is colostrum until ${data.colostrumUntil} — it goes to the calf, not the can.`]
            : []),
          ...(data.vwpEndsOn ? [`Ready to serve again from ${data.vwpEndsOn}.`] : []),
        ]}
        refCode={refCode}
        tone={data.isAbortion ? "danger" : "ok"}
      />

      {data.calves.length > 0 ? (
        <Card>
          <h2 className="text-lg font-semibold">
            {data.calves.length > 1 ? "The calves are registered" : "The calf is registered"}
          </h2>
          <ul className="mt-3 space-y-3">
            {data.calves.map((c) => (
              <li key={c.id} className="border-t border-line pt-3 first:border-0 first:pt-0">
                <p className="font-medium">
                  {c.name ?? c.tag} <span className="text-ink-3">{c.tag}</span>{" "}
                  <Chip tone="neutral">{c.sex === "F" ? "Heifer calf" : "Bull calf"}</Chip>
                </p>
                <p className="mt-1 text-sm text-ink-2">
                  {c.schedule.length} reminders set for her first year — starting with{" "}
                  {c.schedule[0]?.label.toLowerCase()} on {c.schedule[0]?.dueOn}.
                </p>
                <a href={`/herd/${c.id}`} className="mt-2 inline-block text-sm underline">
                  Open the calf&apos;s card
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {data.calvingIntervalDays != null ? (
        <Card>
          <h2 className="text-lg font-semibold">How she did</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm tabular-nums">
            <div>
              <dt className="text-ink-3">Calving interval</dt>
              <dd className={data.excessDays > 0 ? "text-danger font-semibold" : "font-semibold"}>
                {data.calvingIntervalDays} days
                <span className="ml-1 font-normal text-ink-3">
                  (target {data.calvingIntervalTargetDays})
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Days open</dt>
              <dd className="font-semibold">{data.daysOpenDays ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Services to conceive</dt>
              <dd className="font-semibold">{data.servicesPerConception ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink-3">What the extra days cost</dt>
              <dd className={data.calvingIntervalCostKes > 0 ? "text-danger font-semibold" : "font-semibold"}>
                KES {data.calvingIntervalCostKes.toLocaleString("en-KE")}
              </dd>
            </div>
          </dl>
          {data.excessDays > 0 ? (
            <p className="mt-3 text-sm text-ink-2">
              {data.excessDays} days longer than target, at about 4 litres a day of milk she did not
              give. Serving her sooner after this calving is where that comes back.
            </p>
          ) : null}
        </Card>
      ) : null}

      {data.warnings.map((w) => (
        <SoftWarning key={w} message={w} />
      ))}

      <a href="/breeding" className="tap inline-flex rounded-md border border-line bg-surface px-4 py-2 text-sm font-semibold">
        Back to the board
      </a>
    </div>
  );
}
