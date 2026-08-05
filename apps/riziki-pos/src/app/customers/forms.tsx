"use client";

/**
 * The two forms the debtors screens need. Both use `useActionState`, which in
 * React 19 hands back `[state, formAction, pending]` — the pending flag is what
 * stops a distracted attendant double-tapping a payment onto the account.
 */

import { useActionState, useState } from "react";
import { Button, Field, inputClass, Alert } from "@/components/ui";
import { fromCents, formatKes } from "@/lib/units";
import { saveCustomerAction, recordPaymentAction, type FormState } from "./actions";

const EMPTY: FormState = {};

export interface CustomerFields {
  id: number;
  name: string;
  phone: string;
  kind: string;
  credit_limit_cents: number;
  kra_pin: string;
}

export function CustomerForm({ customer }: { customer?: CustomerFields }) {
  const [state, action, pending] = useActionState(saveCustomerAction, EMPTY);

  return (
    <form action={action} className="space-y-3.5">
      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="good">{state.ok}</Alert> : null}

      {customer ? <input type="hidden" name="id" value={customer.id} /> : null}

      <Field label="Name">
        <input className={inputClass} name="name" defaultValue={customer?.name} required autoComplete="off" />
      </Field>

      <Field label="Phone" hint="Used for the WhatsApp reminder — 0722… or +254 722… both work.">
        <input
          className={inputClass}
          name="phone"
          type="tel"
          inputMode="tel"
          defaultValue={customer?.phone}
          placeholder="0722 111 222"
          autoComplete="off"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Buys at">
          <select className={inputClass} name="kind" defaultValue={customer?.kind ?? "retail"}>
            <option value="retail">Retail prices</option>
            <option value="wholesale">Wholesale prices</option>
          </select>
        </Field>

        <Field label="Credit limit (KES)">
          <input
            className={inputClass}
            name="credit_limit"
            type="text"
            inputMode="decimal"
            defaultValue={customer ? String(fromCents(customer.credit_limit_cents)) : "0"}
            autoComplete="off"
          />
        </Field>
      </div>

      <Field label="KRA PIN" hint="The buyer's PIN. eTIMS will need it on every invoice.">
        <input
          className={inputClass}
          name="kra_pin"
          defaultValue={customer?.kra_pin}
          placeholder="P051234567X"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : customer ? "Save changes" : "Add customer"}
      </Button>
    </form>
  );
}

export function PaymentForm({
  customerId,
  balanceCents,
  openSales,
}: {
  customerId: number;
  balanceCents: number;
  openSales: number;
}) {
  const [state, action, pending] = useActionState(recordPaymentAction, EMPTY);
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState("");

  return (
    <form action={action} className="space-y-3.5">
      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="good">{state.ok}</Alert> : null}

      <input type="hidden" name="customer_id" value={customerId} />

      <Field
        label="Amount received (KES)"
        hint={
          openSales > 1
            ? `Applied to the oldest unpaid sale first, then rolls onto the next (${openSales} unpaid).`
            : "Applied to the oldest unpaid sale first."
        }
      >
        <input
          className={inputClass}
          name="amount"
          type="text"
          inputMode="decimal"
          placeholder={String(fromCents(balanceCents))}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoComplete="off"
          required
        />
      </Field>
      {/* The common case — "here is everything I owe" — becomes one tap. */}
      <button
        type="button"
        onClick={() => setAmount(String(fromCents(balanceCents)))}
        className="rounded-full bg-brand-soft px-3.5 py-2 text-xs font-bold text-brand-dark"
      >
        All of it — {formatKes(balanceCents)}
      </button>

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

      <Button type="submit" className="w-full" disabled={pending || balanceCents <= 0}>
        {pending ? "Recording…" : "Record payment"}
      </Button>
    </form>
  );
}
