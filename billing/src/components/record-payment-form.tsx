"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "./submit-button";
import { recordPaymentAction, type FormState } from "@/server/actions/payments";
import { formatAmount, formatMoney } from "@/server/money";

const METHODS = [
  { v: "mpesa", label: "M-Pesa" },
  { v: "cash", label: "Cash" },
  { v: "bank", label: "Bank" },
  { v: "cheque", label: "Cheque" },
  { v: "card", label: "Card" },
  { v: "other", label: "Other" },
];

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
  const suggestDeposit = amountPaid === 0 && depositAmount > 0 && depositAmount < balanceDue;
  const suggested = suggestDeposit ? depositAmount : balanceDue;

  const [amount, setAmount] = useState(formatAmount(suggested));
  const [method, setMethod] = useState("mpesa");

  const presets = [
    { label: "Full balance", value: balanceDue },
    ...(suggestDeposit ? [{ label: "Deposit", value: depositAmount }] : []),
  ];
  const activePreset = presets.find((p) => formatAmount(p.value) === amount)?.value ?? null;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="method" value={method} />

      {/* Amount presets */}
      <div>
        <span className="label">How much?</span>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => {
            const active = activePreset === p.value;
            return (
              <button
                type="button"
                key={p.label}
                onClick={() => setAmount(formatAmount(p.value))}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-ink hover:bg-canvas"
                }`}
              >
                {p.label} · {formatMoney(p.value, currency)}
              </button>
            );
          })}
          <span className="rounded-full border border-line px-3 py-1.5 text-sm text-muted">
            or type a custom amount ↓
          </span>
        </div>
      </div>

      {/* Amount input with currency prefix */}
      <div>
        <label className="label" htmlFor="amount">Amount received</label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted">
            {currency}
          </span>
          <input
            id="amount"
            name="amount"
            className="input pl-12 text-lg font-semibold tabular-nums"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      </div>

      {/* Method chips */}
      <div>
        <span className="label">Paid by</span>
        <div className="flex flex-wrap gap-2">
          {METHODS.map((m) => (
            <button
              type="button"
              key={m.v}
              onClick={() => setMethod(m.v)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                method === m.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-ink hover:bg-canvas"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="paidAt">Date received</label>
          <input id="paidAt" name="paidAt" type="date" className="input" defaultValue={new Date().toISOString().slice(0, 10)} />
        </div>
        <div>
          <label className="label" htmlFor="reference">Reference <span className="font-normal text-muted">(optional)</span></label>
          <input id="reference" name="reference" className="input" placeholder="M-Pesa code, cheque no…" />
        </div>
      </div>

      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

      <SubmitButton className="btn-primary w-full py-2.5" pendingText="Recording…">
        Record payment &amp; issue receipt
      </SubmitButton>
    </form>
  );
}
