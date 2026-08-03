"use client";

import { useActionState, useState } from "react";
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
} from "@/components/money/form-kit";

export interface RoleOption {
  value: string;
  label: string;
}

type EmployeeData = {
  id: string;
  minimumWage: { below: boolean; minimumKes?: number; message?: string };
  missingPaperwork: string[];
};

/**
 * Onboarding. Only three things can block a save — a name, a role and a start
 * date. Everything statutory is collected but never demanded, because a
 * required field does not produce complete data, it produces invented data.
 */
export function EmployeeForm({
  action,
  roles,
  today,
}: {
  action: FormAction<EmployeeData>;
  roles: RoleOption[];
  today: string;
}) {
  const [state, formAction] = useActionState<Result<EmployeeData> | null, FormData>(action, null);
  const [housed, setHoused] = useState(true);

  if (state?.ok) {
    return (
      <ReceiptCard
        title={state.message ?? "Saved."}
        tone={state.data.minimumWage.below ? "warn" : "ok"}
        lines={[
          state.data.minimumWage.below && state.data.minimumWage.message
            ? state.data.minimumWage.message
            : "",
          state.data.missingPaperwork.length
            ? `Still to collect: ${state.data.missingPaperwork.join(", ")}.`
            : "All the statutory paperwork is on file.",
        ]}
      >
        <div className="mt-4 flex gap-3">
          <a href={`/people/${state.data.id}`} className="text-sm underline">
            Open their record
          </a>
          <a href="/people" className="text-sm underline">
            Back to staff
          </a>
        </div>
      </ReceiptCard>
    );
  }

  return (
    <div className="space-y-4">
      {state && !state.ok ? <ErrorBanner message={state.error} /> : null}

      <form action={formAction} className="space-y-4">
        <Field label="Full name" errors={state && !state.ok ? state.fieldErrors?.fullName : undefined}>
          <Text name="fullName" required autoFocus />
        </Field>

        <Field label="What do they do?" errors={state && !state.ok ? state.fieldErrors?.role : undefined}>
          <Picker name="role" defaultValue="HERDSMAN" required>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Picker>
        </Field>

        <Field
          label="On what terms?"
          hint="A casual who works more than one month straight becomes a term employee by law. We will warn you before that happens."
        >
          <Picker name="employmentType" defaultValue="PERMANENT" required>
            <option value="PERMANENT">Permanent</option>
            <option value="TERM">Fixed term</option>
            <option value="CASUAL">Casual (kibarua)</option>
          </Picker>
        </Field>

        <Field label="First day" errors={state && !state.ok ? state.fieldErrors?.startedOn : undefined}>
          <Text type="date" name="startedOn" defaultValue={today} required />
        </Field>

        <Field label="Wage" hint="Never filled in for you.">
          <div className="flex gap-2">
            <Money name="basicWageKes" placeholder="0" className="flex-1" />
            <Picker name="wagePeriod" defaultValue="MONTHLY" className="w-40">
              <option value="MONTHLY">a month</option>
              <option value="DAILY">a day</option>
            </Picker>
          </div>
        </Field>

        <label className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-3 text-sm">
          <input
            type="checkbox"
            name="housingProvided"
            className="size-5"
            checked={housed}
            onChange={(e) => setHoused(e.target.checked)}
          />
          The farm houses them
          <span className="ml-auto text-xs text-ink-3">
            {housed ? "no housing allowance" : "15% housing allowance is due"}
          </span>
        </label>

        <MoreFields label="Statutory paperwork and next of kin">
          <p className="text-xs text-ink-3">
            None of this blocks the save. Fill it in as you get it.
          </p>
          <Field label="National ID number">
            <Text name="nationalId" inputMode="numeric" />
          </Field>
          <Field label="KRA PIN">
            <Text name="kraPin" autoCapitalize="characters" />
          </Field>
          <Field label="NSSF number">
            <Text name="nssfNo" />
          </Field>
          <Field label="SHA / SHIF number">
            <Text name="shaNo" />
          </Field>
          <Field label="Phone">
            <Text name="phone" type="tel" inputMode="tel" />
          </Field>
          <Field label="Next of kin" hint="Name and a phone number.">
            <Text name="nextOfKin" />
          </Field>
        </MoreFields>

        <SubmitButton>Add to the staff list</SubmitButton>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------- */

type AttendanceData = {
  id: string;
  consecutiveDays: number;
  casual: { warn: boolean; converted: boolean; daysWorked: number; message?: string };
};

/** Two taps: pick the day, tap present. */
export function AttendanceForm({
  action,
  employeeId,
  employeeName,
  today,
}: {
  action: FormAction<AttendanceData>;
  employeeId: string;
  employeeName: string;
  today: string;
}) {
  const [state, formAction] = useActionState<Result<AttendanceData> | null, FormData>(action, null);

  return (
    <div className="space-y-3">
      {state?.ok && state.data.casual.warn ? (
        <div
          className={`rounded-md border-l-4 px-3 py-2 text-sm ${
            state.data.casual.converted
              ? "border-danger bg-danger-soft font-medium"
              : "border-brass bg-brass-soft"
          }`}
          role="alert"
        >
          <span aria-hidden className="mr-2">
            ⚠
          </span>
          {state.data.casual.message}
        </div>
      ) : null}
      {state?.ok && !state.data.casual.warn ? (
        <div className="rounded-md border-l-4 border-brand bg-brand-soft px-3 py-2 text-sm" role="status">
          <span aria-hidden className="mr-2">
            ✓
          </span>
          {state.message} Day {state.data.consecutiveDays} in a row.
        </div>
      ) : null}
      {state && !state.ok ? <ErrorBanner message={state.error} /> : null}

      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="employeeId" value={employeeId} />
        <label className="flex-1">
          <span className="mb-1 block text-sm font-medium">Day worked</span>
          <input
            type="date"
            name="workedOn"
            defaultValue={today}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base"
          />
        </label>
        <label className="w-28">
          <span className="mb-1 block text-sm font-medium">Days</span>
          <input
            type="number"
            step="0.5"
            min="0"
            max="2"
            name="days"
            defaultValue="1"
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-brand px-5 py-3 text-base font-semibold text-white"
        >
          <span aria-hidden className="mr-1">
            ✓
          </span>
          {employeeName.split(" ")[0]} was here
        </button>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------- */

type PayrollData = {
  runId: string;
  periodMonth: string;
  payslips: unknown[];
  totalGrossKes: number;
  totalNetKes: number;
  totalEmployerCostKes: number;
  headline: string;
};

export function RunPayrollForm({
  action,
  month,
}: {
  action: FormAction<PayrollData>;
  month: string;
}) {
  const [state, formAction] = useActionState<Result<PayrollData> | null, FormData>(action, null);

  return (
    <div className="space-y-3">
      {state?.ok ? (
        <ReceiptCard
          title="Payroll calculated"
          lines={[
            state.data.headline,
            `To pay out: ${kesText(state.data.totalNetKes)}.`,
            "It is a draft until you approve it.",
          ]}
        >
          <a href={`/people/payroll/${state.data.periodMonth.slice(0, 7)}`} className="mt-3 inline-block text-sm underline">
            Open the payslips
          </a>
        </ReceiptCard>
      ) : null}
      {state && !state.ok ? <ErrorBanner message={state.error} /> : null}

      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-sm font-medium">Month</span>
          <input
            type="month"
            name="month"
            defaultValue={month}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base"
          />
        </label>
        <SubmitButtonInline label="Work out the payroll" />
      </form>
    </div>
  );
}

function SubmitButtonInline({ label }: { label: string }) {
  return (
    <button type="submit" className="rounded-md bg-brand px-5 py-3 text-base font-semibold text-white">
      {label}
    </button>
  );
}

/* ---------------------------------------------------------------- */

/** Approve, then mark paid. Two acts, in that order, never one. */
export function PayrollActions({
  approveAction,
  payAction,
  runId,
  status,
  today,
}: {
  approveAction: FormAction<{ id: string }>;
  payAction: FormAction<{ id: string; expenseId: string | null }>;
  runId: string;
  status: "DRAFT" | "APPROVED" | "PAID";
  today: string;
}) {
  const [approveState, approve] = useActionState<Result<{ id: string }> | null, FormData>(
    approveAction,
    null,
  );
  const [payState, pay] = useActionState<
    Result<{ id: string; expenseId: string | null }> | null,
    FormData
  >(payAction, null);

  const approved = status !== "DRAFT" || approveState?.ok === true;
  const paid = status === "PAID" || payState?.ok === true;

  if (paid) {
    return (
      <div className="rounded-md border-l-4 border-brand bg-brand-soft px-3 py-3 text-sm" role="status">
        <span aria-hidden className="mr-2">
          ✓
        </span>
        {payState?.ok ? payState.message : "This payroll has been paid."}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {approveState && !approveState.ok ? <ErrorBanner message={approveState.error} /> : null}
      {payState && !payState.ok ? <ErrorBanner message={payState.error} /> : null}

      {!approved ? (
        <form action={approve}>
          <input type="hidden" name="runId" value={runId} />
          <SubmitButton>Approve this payroll</SubmitButton>
        </form>
      ) : (
        <form action={pay} className="space-y-3">
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="postExpense" value="true" />
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1">
              <span className="mb-1 block text-sm font-medium">Paid on</span>
              <input
                type="date"
                name="paidOn"
                defaultValue={today}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base"
              />
            </label>
            <label className="w-40">
              <span className="mb-1 block text-sm font-medium">How</span>
              <select
                name="paymentMethod"
                defaultValue="MPESA"
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base"
              >
                <option value="MPESA">M-Pesa</option>
                <option value="CASH">Cash</option>
                <option value="BANK">Bank</option>
                <option value="CHEQUE">Cheque</option>
              </select>
            </label>
          </div>
          <SubmitButton>Mark as paid</SubmitButton>
        </form>
      )}
    </div>
  );
}
