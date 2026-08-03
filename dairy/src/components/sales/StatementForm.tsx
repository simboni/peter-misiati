"use client";

/**
 * Co-op statement entry.
 *
 * "Why is my cheque smaller than I expected" is the number one dairy co-op
 * grievance in Kenya. Entering their statement here answers it line by line:
 * their litres against ours, and every check-off deduction either matched to a
 * farm record or flagged as having nothing behind it.
 */

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/dal";
import type { StatementResult } from "@/server/sales";
import { kes } from "@/lib/money";
import { Button, Card, Field, HardBlock, Receipt, Select, TextInput } from "@/components/ui";

type StatementAction = (prev: unknown, formData: FormData) => Promise<ActionResult<StatementResult>>;

const DEDUCTION_TYPES = [
  { value: "AI", label: "AI services" },
  { value: "FEEDS", label: "Feeds on check-off" },
  { value: "VET", label: "Vet" },
  { value: "ADVANCE", label: "Advance" },
  { value: "SACCO_LOAN", label: "SACCO loan" },
  { value: "SHARES", label: "Shares" },
  { value: "TRANSPORT", label: "Transport levy" },
  { value: "MEMBERSHIP", label: "Membership" },
  { value: "OTHER", label: "Something else" },
];

interface DeductionDraft {
  key: string;
  deductionType: string;
  description: string;
  amountKes: string;
}

export function StatementForm({
  customers,
  memberNo,
  defaultPeriod,
  action,
}: {
  customers: Array<{ id: string; name: string }>;
  memberNo: string | null;
  defaultPeriod: { start: string; end: string };
  action: StatementAction;
}) {
  const [state, formAction] = useActionState<ActionResult<StatementResult> | null, FormData>(
    async (prev, formData) => action(prev, formData),
    null,
  );
  const [deductions, setDeductions] = useState<DeductionDraft[]>([]);

  const addLine = () =>
    setDeductions((d) => [
      ...d,
      { key: `${Date.now()}-${d.length}`, deductionType: "AI", description: "", amountKes: "" },
    ]);

  const setLine = (key: string, patch: Partial<DeductionDraft>) =>
    setDeductions((d) => d.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const json = JSON.stringify(
    deductions
      .filter((d) => d.amountKes !== "")
      .map((d) => ({
        deductionType: d.deductionType,
        description: d.description || null,
        amountKes: Number(d.amountKes),
      })),
  );

  return (
    <Card>
      <h2 className="mb-3 text-lg font-semibold">Enter the co-op&apos;s statement</h2>

      {state?.ok ? (
        <div className="mb-3">
          <Receipt
            title={state.data.reconciliation.message}
            lines={[
              `They recorded ${state.data.reconciliation.litresTheirs} L; we recorded ${state.data.ourLitres} L.`,
              ...state.data.reconciliation.deductionLines.map(
                (l) => `${l.matched ? "✓" : "?"} ${l.label} — ${kes(l.theirValue ?? 0)}${l.note ? ` (${l.note})` : ""}`,
              ),
            ]}
            refCode={state.refCode}
            tone={
              state.data.reconciliation.unmatchedDeductionsKes > 0 ||
              Math.abs(state.data.reconciliation.litresVariance) > 0.5
                ? "warn"
                : "ok"
            }
          />
        </div>
      ) : null}
      {state && !state.ok ? <div className="mb-3"><HardBlock message={state.error} /></div> : null}

      <form action={formAction} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="deductions" value={json} />

        <Field label="Which co-op or processor">
          <Select name="customerId" required defaultValue={customers[0]?.id ?? ""}>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Member number">
          <TextInput name="memberNo" defaultValue={memberNo ?? ""} />
        </Field>

        <Field label="Period from">
          <TextInput name="periodStart" type="date" defaultValue={defaultPeriod.start} required />
        </Field>
        <Field label="Period to">
          <TextInput name="periodEnd" type="date" defaultValue={defaultPeriod.end} required />
        </Field>

        <Field label="Litres THEY recorded" hint="Straight off the statement, not our own figure.">
          <TextInput name="coopLitres" type="number" inputMode="decimal" step="0.01" min="0" required />
        </Field>
        <Field label="Rate a litre">
          <TextInput name="rateKesPerLitre" type="number" inputMode="decimal" step="0.01" min="0" required />
        </Field>

        <Field label="Quality bonus">
          <TextInput name="qualityBonusKes" type="number" inputMode="decimal" step="0.01" min="0" />
        </Field>
        <Field label="County cess" hint="Capped at 0.5% of the farm gate price.">
          <TextInput name="cessKes" type="number" inputMode="decimal" step="0.01" min="0" />
        </Field>

        <Field label="Gross pay">
          <TextInput name="grossPayKes" type="number" inputMode="decimal" step="0.01" required />
        </Field>
        <Field label="Net pay" hint="What actually reached the account.">
          <TextInput name="netPayKes" type="number" inputMode="decimal" step="0.01" required />
        </Field>

        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium">Every deduction on the statement</legend>
          <ul className="space-y-2">
            {deductions.map((d) => (
              <li key={d.key} className="grid gap-2 sm:grid-cols-3">
                <Select value={d.deductionType} onChange={(e) => setLine(d.key, { deductionType: e.target.value })}>
                  {DEDUCTION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
                <TextInput
                  placeholder="As it is written on the statement"
                  value={d.description}
                  onChange={(e) => setLine(d.key, { description: e.target.value })}
                />
                <TextInput
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  placeholder="KES"
                  value={d.amountKes}
                  onChange={(e) => setLine(d.key, { amountKes: e.target.value })}
                />
              </li>
            ))}
          </ul>
          <div className="mt-2">
            <Button type="button" variant="secondary" onClick={addLine}>
              Add a deduction
            </Button>
          </div>
        </fieldset>

        <div className="sm:col-span-2">
          <Submit />
        </div>
      </form>
    </Card>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Checking…" : "Check this statement"}
    </Button>
  );
}
