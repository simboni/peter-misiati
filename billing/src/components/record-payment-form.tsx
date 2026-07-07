"use client";

import { useActionState } from "react";
import { SubmitButton } from "./submit-button";
import { recordPaymentAction, type FormState } from "@/server/actions/payments";
import { formatAmount } from "@/server/money";

export function RecordPaymentForm({
  invoiceId,
  balanceDue,
  depositAmount,
  amountPaid,
  currency,
}: {
  invoiceId: string;
  balanceDue: number;
  depositAmount: number;
  amountPaid: number;
  currency: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(recordPaymentAction, {});
  const suggestDeposit = amountPaid === 0 && depositAmount > 0 && depositAmount <= balanceDue;
  const suggested = suggestDeposit ? depositAmount : balanceDue;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="amount">
            Amount ({currency})
          </label>
          <input
            id="amount"
            name="amount"
            className="input"
            inputMode="decimal"
            defaultValue={formatAmount(suggested)}
          />
          {suggestDeposit && (
            <p className="mt-1 text-xs text-brand-700">Suggested deposit: {formatAmount(depositAmount)}</p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="method">
            Method
          </label>
          <select id="method" name="method" className="input" defaultValue="mpesa">
            <option value="mpesa">M-Pesa</option>
            <option value="cash">Cash</option>
            <option value="bank">Bank transfer</option>
            <option value="cheque">Cheque</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="paidAt">
            Date received
          </label>
          <input
            id="paidAt"
            name="paidAt"
            type="date"
            className="input"
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </div>
        <div>
          <label className="label" htmlFor="reference">
            Reference (M-Pesa code, cheque no…)
          </label>
          <input id="reference" name="reference" className="input" placeholder="Optional" />
        </div>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <SubmitButton pendingText="Recording…">Record payment &amp; issue receipt</SubmitButton>
    </form>
  );
}
