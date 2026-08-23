"use client";

/**
 * Taking money on the invoice itself.
 *
 * Somebody opening a bill from the Owing list is nearly always holding money,
 * not looking for the print button — so this sits above the document rather
 * than under it, and the amount starts filled in at the full balance, which is
 * what gets paid most of the time. Sharing the invoice is still one screen
 * away, below, for the times it is the other errand.
 *
 * The pending flag from `useActionState` is what stops a distracted attendant
 * tapping the same payment on twice.
 */

import { useActionState, useState } from "react";
import { Button, Field, inputClass, Alert } from "@/components/ui";
import { fromCents, formatKes } from "@/lib/units";
import { payInvoiceAction, type PayState } from "./actions";

const EMPTY: PayState = {};

export function PayInvoiceForm({
  saleId,
  balanceCents,
  customerName,
}: {
  saleId: number;
  balanceCents: number;
  customerName: string;
}) {
  const [state, action, pending] = useActionState(payInvoiceAction, EMPTY);
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState(String(fromCents(balanceCents)));

  // Success is not handled here: the action redirects, so the page comes back
  // with the new balance already in it and the confirmation rendered by the
  // server — which is the only way the message survives a payment that settles
  // the bill and removes this form.
  return (
    <form action={action} className="space-y-3.5">
      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}

      <input type="hidden" name="sale_id" value={saleId} />

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
          Still due
        </span>
        <span className="text-2xl font-extrabold text-bad tnum">{formatKes(balanceCents)}</span>
      </div>

      <Field label="Amount received (KES)" hint={`Applied to this invoice only, not to ${customerName}'s other bills.`}>
        <input
          className={inputClass}
          name="amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoComplete="off"
          required
        />
      </Field>

      {/* Part payments are normal here, so the full amount is offered back as
          one tap after the field has been edited down. */}
      {amount !== String(fromCents(balanceCents)) ? (
        <button
          type="button"
          onClick={() => setAmount(String(fromCents(balanceCents)))}
          className="rounded-full bg-brand-soft px-3.5 py-2 text-xs font-bold text-brand-dark"
        >
          All of it — {formatKes(balanceCents)}
        </button>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="How">
          <select
            className={inputClass}
            name="method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="cash">Cash</option>
            <option value="mpesa">M-Pesa</option>
          </select>
        </Field>

        <Field label="M-Pesa code">
          <input
            className={inputClass}
            name="mpesa_code"
            placeholder={method === "mpesa" ? "TFG7HJ2K90" : "—"}
            disabled={method !== "mpesa"}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Recording…" : "Record payment"}
      </Button>
    </form>
  );
}
