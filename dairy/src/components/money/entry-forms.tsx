"use client";

import { useActionState } from "react";
import {
  ErrorBanner,
  Field,
  Money,
  MoreFields,
  Picker,
  ReceiptCard,
  SubmitButton,
  Text,
  kesText,
  type FormAction,
  type Result,
} from "./form-kit";

export interface SupplierOption {
  id: string;
  name: string;
}

export interface CategoryOption {
  value: string;
  label: string;
}

interface Position {
  incomeKes: number;
  expenseKes: number;
  netKes: number;
  litresProduced: number;
  cashCostPerLitreKes: number;
  headline: string;
}

type EntryData = { id: string; refCode: string; status: string; position: Position };

/**
 * The position that comes back with every entry (R7). An expense is never just
 * a number going into a hole.
 */
function PositionCard({ position, refCode }: { position: Position; refCode: string }) {
  return (
    <ReceiptCard
      title="Recorded — waiting for approval"
      refCode={refCode}
      tone="warn"
      lines={[
        position.headline,
        position.litresProduced > 0
          ? `Cash cost so far this month: ${kesText(position.cashCostPerLitreKes, 2)} a litre.`
          : "",
      ]}
    >
      <p className="mt-3 text-sm text-ink-2">
        It does not move any total until a manager approves it.
      </p>
    </ReceiptCard>
  );
}

/* ---------------------------------------------------------------- */

export function ExpenseForm({
  action,
  suppliers,
  categories,
  today,
}: {
  action: FormAction<EntryData>;
  suppliers: SupplierOption[];
  categories: CategoryOption[];
  today: string;
}) {
  const [state, formAction] = useActionState<Result<EntryData> | null, FormData>(action, null);

  return (
    <div className="space-y-4">
      {state?.ok ? <PositionCard position={state.data.position} refCode={state.data.refCode} /> : null}
      {state && !state.ok ? <ErrorBanner message={state.error} /> : null}

      <form action={formAction} className="space-y-4">
        {/* R1: five fields, only three of which can block a save. */}
        <Field label="What was it for?" errors={state && !state.ok ? state.fieldErrors?.category : undefined}>
          <Picker name="category" defaultValue="FEEDS" required>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Picker>
        </Field>

        <Field
          label="How much?"
          hint="Shillings. Never filled in for you."
          errors={state && !state.ok ? state.fieldErrors?.amountKes : undefined}
        >
          <Money name="amountKes" required autoFocus placeholder="0" />
        </Field>

        <Field label="On what day?" errors={state && !state.ok ? state.fieldErrors?.incurredOn : undefined}>
          <Text type="date" name="incurredOn" defaultValue={today} required />
        </Field>

        <Field label="Who was paid?" hint="Leave blank if it was not a supplier on the list.">
          <Picker name="counterpartyId" defaultValue="">
            <option value="">—</option>
            {suppliers.map((sup) => (
              <option key={sup.id} value={sup.id}>
                {sup.name}
              </option>
            ))}
          </Picker>
        </Field>

        <Field label="A short note" hint="What a person would say out loud. &ldquo;2 bags dairy meal&rdquo;.">
          <Text name="description" maxLength={120} />
        </Field>

        <MoreFields label="How it was paid">
          <Field label="Payment method">
            <Picker name="paymentMethod" defaultValue="MPESA">
              {["MPESA", "CASH", "BANK", "COOP_CHECKOFF", "CREDIT", "CHEQUE"].map((m) => (
                <option key={m} value={m}>
                  {m === "COOP_CHECKOFF" ? "Co-op check-off" : m[0] + m.slice(1).toLowerCase()}
                </option>
              ))}
            </Picker>
          </Field>
          <Field label="M-Pesa confirmation code" hint="Copy it from the SMS. It is what the reconcile matches on.">
            <Text name="mpesaRef" autoCapitalize="characters" />
          </Field>
          <Field label="Voucher number">
            <Text name="voucherNo" />
          </Field>
        </MoreFields>

        <SubmitButton>Record this expense</SubmitButton>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------- */

export function IncomeForm({
  action,
  today,
}: {
  action: FormAction<EntryData>;
  today: string;
}) {
  const [state, formAction] = useActionState<Result<EntryData> | null, FormData>(action, null);

  return (
    <div className="space-y-4">
      {state?.ok ? <PositionCard position={state.data.position} refCode={state.data.refCode} /> : null}
      {state && !state.ok ? <ErrorBanner message={state.error} /> : null}

      <form action={formAction} className="space-y-4">
        <Field label="Where did it come from?">
          <Picker name="source" defaultValue="MILK" required>
            <option value="MILK">Milk</option>
            <option value="ANIMAL_SALE">Animal sale</option>
            <option value="MANURE">Manure</option>
            <option value="FODDER">Fodder</option>
            <option value="OTHER">Something else</option>
          </Picker>
        </Field>

        <Field label="How much?" errors={state && !state.ok ? state.fieldErrors?.amountKes : undefined}>
          <Money name="amountKes" required autoFocus placeholder="0" />
        </Field>

        <Field label="On what day?" errors={state && !state.ok ? state.fieldErrors?.receivedOn : undefined}>
          <Text type="date" name="receivedOn" defaultValue={today} required />
        </Field>

        <Field label="A short note">
          <Text name="description" maxLength={120} />
        </Field>

        <MoreFields label="How it was paid">
          <Field label="Payment method">
            <Picker name="paymentMethod" defaultValue="MPESA">
              {["MPESA", "CASH", "BANK", "COOP_CHECKOFF", "CREDIT", "CHEQUE"].map((m) => (
                <option key={m} value={m}>
                  {m === "COOP_CHECKOFF" ? "Co-op check-off" : m[0] + m.slice(1).toLowerCase()}
                </option>
              ))}
            </Picker>
          </Field>
          <Field label="M-Pesa confirmation code">
            <Text name="mpesaRef" autoCapitalize="characters" />
          </Field>
        </MoreFields>

        <SubmitButton>Record this payment in</SubmitButton>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------- */

export function SupplierForm({
  action,
  types,
}: {
  action: FormAction<{ id: string }>;
  types: CategoryOption[];
}) {
  const [state, formAction] = useActionState<Result<{ id: string }> | null, FormData>(action, null);

  return (
    <div className="space-y-4">
      {state?.ok ? (
        <ReceiptCard title={state.message ?? "Supplier saved."} lines={[]} />
      ) : null}
      {state && !state.ok ? <ErrorBanner message={state.error} /> : null}

      <form action={formAction} className="space-y-4">
        <Field label="Name" errors={state && !state.ok ? state.fieldErrors?.name : undefined}>
          <Text name="name" required autoFocus />
        </Field>

        <Field
          label="What kind?"
          hint="Tick more than one where it applies — a co-op sells you inputs and buys your milk."
          errors={state && !state.ok ? state.fieldErrors?.types : undefined}
        >
          <div className="grid grid-cols-2 gap-2">
            {types.map((t) => (
              <label key={t.value} className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm">
                <input type="checkbox" name="types" value={t.value} className="size-5" />
                {t.label}
              </label>
            ))}
          </div>
        </Field>

        <Field label="Phone">
          <Text name="phone" type="tel" inputMode="tel" />
        </Field>

        <Field label="Payment terms" hint="Cash, 30 days, co-op check-off…">
          <Text name="paymentTerms" />
        </Field>

        <SubmitButton>Save supplier</SubmitButton>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------- */

export function MpesaImportForm({
  action,
}: {
  action: FormAction<{ parsed: number; imported: number; duplicates: number; malformed: number }>;
}) {
  const [state, formAction] = useActionState<
    Result<{ parsed: number; imported: number; duplicates: number; malformed: number }> | null,
    FormData
  >(action, null);

  return (
    <div className="space-y-4">
      {state?.ok ? (
        <ReceiptCard
          title={state.message ?? "Statement imported."}
          lines={[
            `${state.data.parsed} transactions read.`,
            state.data.duplicates > 0 ? `${state.data.duplicates} were already on file and were skipped.` : "",
            state.data.malformed > 0 ? `${state.data.malformed} rows could not be read.` : "",
          ]}
        />
      ) : null}
      {state && !state.ok ? <ErrorBanner message={state.error} /> : null}

      <form action={formAction} className="space-y-4">
        <Field
          label="M-Pesa statement file"
          hint="Export it as CSV from the M-Pesa app or the Safaricom portal. Importing the same file twice changes nothing."
        >
          <input
            type="file"
            name="statement"
            accept=".csv,text/csv,text/plain"
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base"
          />
        </Field>

        <MoreFields label="Or paste the rows instead">
          <Field label="Statement rows">
            <textarea
              name="csvText"
              rows={6}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs"
            />
          </Field>
        </MoreFields>

        <SubmitButton pendingLabel="Reading…">Import statement</SubmitButton>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------- */

/** One row of the approval queue. Approve, or cancel, and say which. */
export function ApproveRow({
  action,
  kind,
  id,
  label,
  onDate,
  amountKes,
}: {
  action: FormAction<{ id: string }>;
  kind: "EXPENSE" | "INCOME";
  id: string;
  label: string;
  onDate: string;
  amountKes: number;
}) {
  const [state, formAction] = useActionState<Result<{ id: string }> | null, FormData>(action, null);

  if (state?.ok) {
    return (
      <li className="rounded-lg border border-line bg-brand-soft p-3 text-sm">
        <span aria-hidden className="mr-2">
          ✓
        </span>
        {state.message ?? "Done."}
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          <span aria-hidden className="mr-2">
            {kind === "INCOME" ? "↘" : "↗"}
          </span>
          {label}
        </span>
        <span className="tabular-nums font-semibold">
          {kind === "INCOME" ? "+" : "−"}
          {kesText(amountKes)}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-3">{onDate}</p>
      {state && !state.ok ? <p className="mt-2 text-xs text-danger">{state.error}</p> : null}
      <form action={formAction} className="mt-3 flex gap-2">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="kind" value={kind} />
        <button
          type="submit"
          name="decision"
          value="APPROVE"
          className="flex-1 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white"
        >
          <span aria-hidden className="mr-1">
            ✓
          </span>
          Approve
        </button>
        {kind === "EXPENSE" ? (
          <button
            type="submit"
            name="decision"
            value="VOID"
            className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink-2"
          >
            <span aria-hidden className="mr-1">
              ✕
            </span>
            Cancel it
          </button>
        ) : null}
      </form>
    </li>
  );
}
