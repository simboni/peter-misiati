"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/dal";
import type { PaymentResult } from "@/server/sales";
import { Button, Card, Field, HardBlock, Receipt, Select, SoftWarning, TextInput } from "@/components/ui";

type PaymentAction = (prev: unknown, formData: FormData) => Promise<ActionResult<PaymentResult>>;

/**
 * Recording money in. A payment entered by a rider or herdsman does not move the
 * balance until a manager confirms it — this is the point on a Kenyan farm where
 * cash most often goes missing, and dividing the process is the documented
 * remedy.
 */
export function PaymentForm({
  customerId,
  customerName,
  date,
  action,
}: {
  customerId: string;
  customerName: string;
  date: string;
  action: PaymentAction;
}) {
  const [state, formAction] = useActionState<ActionResult<PaymentResult> | null, FormData>(
    async (prev, formData) => action(prev, formData),
    null,
  );

  return (
    <Card>
      <h2 className="mb-3 text-lg font-semibold">{customerName} paid</h2>

      {state?.ok ? (
        <div className="mb-3 space-y-2">
          <Receipt
            title={state.message ?? "Payment recorded"}
            lines={[`Balance now KES ${state.data.balanceAfterKes.toLocaleString()}`]}
            refCode={state.refCode}
            tone={state.data.pending ? "warn" : "ok"}
          />
          {state.data.pending ? (
            <SoftWarning message="Waiting for the manager to confirm before it comes off the balance." />
          ) : null}
        </div>
      ) : null}
      {state && !state.ok ? <div className="mb-3"><HardBlock message={state.error} /></div> : null}

      <form action={formAction} className="grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="customerId" value={customerId} />
        <input type="hidden" name="date" value={date} />

        <Field label="How much">
          <TextInput name="amountKes" type="number" inputMode="decimal" step="1" min="1" required />
        </Field>

        <Field label="How">
          <Select name="paymentMethod" defaultValue="CASH">
            <option value="CASH">Cash</option>
            <option value="MPESA">M-Pesa</option>
            <option value="BANK">Bank</option>
            <option value="CHEQUE">Cheque</option>
          </Select>
        </Field>

        <Field label="M-Pesa code" hint="If there is one.">
          <TextInput name="mpesaRef" />
        </Field>

        <div className="sm:col-span-3">
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
      {pending ? "Saving…" : "Record payment"}
    </Button>
  );
}
