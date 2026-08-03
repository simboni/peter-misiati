"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "./submit-button";
import { clearInvoicesAction, type FormState } from "@/server/actions/reset";

export function DangerZone() {
  const [state, formAction] = useActionState<FormState, FormData>(clearInvoicesAction, {});
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");

  return (
    <section className="card border-red-200 p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-red-700">Danger zone</h2>
      <p className="mt-1 text-sm text-muted">
        Delete <b>all invoices</b> and their receipts, then restart numbering at <b>0001</b>. Your
        clients, saved items, quotations and settings are kept. This cannot be undone.
      </p>

      {state.ok ? (
        <p className="mt-4 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
          Cleared {state.cleared} invoice{state.cleared === 1 ? "" : "s"}. Your next invoice will be numbered 0001.
        </p>
      ) : !open ? (
        <button onClick={() => setOpen(true)} className="btn-danger btn-sm mt-4">
          Clear all invoices
        </button>
      ) : (
        <form action={formAction} className="mt-4 space-y-3">
          <div>
            <label className="label" htmlFor="confirm">
              Type <b className="text-ink">DELETE INVOICES</b> to confirm
            </label>
            <input
              id="confirm"
              name="confirm"
              className="input max-w-xs"
              placeholder="DELETE INVOICES"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
          <div className="flex gap-2">
            <SubmitButton className="btn-danger btn-sm" pendingText="Clearing…">
              Permanently delete
            </SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost btn-sm">
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
