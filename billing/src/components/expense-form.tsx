"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { SubmitButton } from "./submit-button";
import { saveExpenseAction, type FormState } from "@/server/actions/expenses";
import { formatAmount } from "@/server/money";
import type { Expense } from "@/server/db/schema";

const CATEGORIES = ["Rent", "Utilities", "Transport", "Supplies", "Salaries & wages", "Marketing", "Software", "Bank charges", "Professional fees", "Stock / inventory", "Other"];
const METHODS = [
  { v: "cash", label: "Cash" },
  { v: "mpesa", label: "M-Pesa" },
  { v: "bank", label: "Bank" },
  { v: "cheque", label: "Cheque" },
  { v: "card", label: "Card" },
  { v: "other", label: "Other" },
];

function toDateInput(d?: Date | null) {
  return d ? new Date(d).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

export function ExpenseForm({ expense, currency = "KES" }: { expense?: Expense; currency?: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(saveExpenseAction, {});
  const [method, setMethod] = useState(expense?.method ?? "cash");

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      {expense && <input type="hidden" name="id" value={expense.id} />}
      <input type="hidden" name="method" value={method} />

      <section className="card space-y-4 p-5 sm:p-6">
        <div>
          <label className="label" htmlFor="description">What was it for? *</label>
          <input id="description" name="description" className="input" placeholder="e.g. Office rent — July" defaultValue={expense?.description ?? ""} required />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="amount">Amount ({currency}) *</label>
            <input id="amount" name="amount" className="input text-lg font-semibold tabular-nums" inputMode="decimal" placeholder="0.00"
              defaultValue={expense ? formatAmount(expense.amount) : ""} required />
          </div>
          <div>
            <label className="label" htmlFor="taxAmount">of which VAT <span className="font-normal text-muted">(optional)</span></label>
            <input id="taxAmount" name="taxAmount" className="input tabular-nums" inputMode="decimal" placeholder="0.00"
              defaultValue={expense && expense.taxAmount > 0 ? formatAmount(expense.taxAmount) : ""} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="expenseDate">Date</label>
            <input id="expenseDate" name="expenseDate" type="date" className="input" defaultValue={toDateInput(expense?.expenseDate)} />
          </div>
          <div>
            <label className="label" htmlFor="category">Category</label>
            <input id="category" name="category" className="input" list="expense-cats" placeholder="e.g. Rent" defaultValue={expense?.category ?? ""} />
            <datalist id="expense-cats">
              {CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="payee">Paid to <span className="font-normal text-muted">(supplier / vendor)</span></label>
          <input id="payee" name="payee" className="input" placeholder="e.g. Kenya Power" defaultValue={expense?.payee ?? ""} />
        </div>

        <div>
          <span className="label">Paid by</span>
          <div className="flex flex-wrap gap-2">
            {METHODS.map((m) => (
              <button type="button" key={m.v} onClick={() => setMethod(m.v)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  method === m.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-ink hover:bg-canvas"
                }`}>{m.label}</button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="reference">Reference <span className="font-normal text-muted">(optional)</span></label>
            <input id="reference" name="reference" className="input" placeholder="M-Pesa code, receipt no…" defaultValue={expense?.reference ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="notes">Notes <span className="font-normal text-muted">(optional)</span></label>
            <input id="notes" name="notes" className="input" defaultValue={expense?.notes ?? ""} />
          </div>
        </div>
      </section>

      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

      <div className="flex gap-3">
        <SubmitButton>{expense ? "Save expense" : "Add expense"}</SubmitButton>
        <Link href="/expenses" className="btn-ghost">Cancel</Link>
      </div>
    </form>
  );
}
