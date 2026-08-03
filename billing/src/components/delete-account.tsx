"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "./submit-button";
import { deleteAccountAction, type FormState } from "@/server/actions/account";

export function DeleteAccount({ isOwner }: { isOwner: boolean }) {
  const [state, formAction] = useActionState<FormState, FormData>(deleteAccountAction, {});
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");

  return (
    <section className="card border-red-200 p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-red-700">Delete account</h2>
      <p className="mt-1 text-sm text-muted">
        Permanently delete your account and personal data. {isOwner ? (
          <>
            Because you own this workspace, <b>all of its data</b> — invoices, receipts, clients,
            items and settings — is deleted for everyone in it.
          </>
        ) : (
          <>You will be removed from this workspace; the workspace itself is kept.</>
        )}{" "}
        This cannot be undone.
      </p>

      {!open ? (
        <button onClick={() => setOpen(true)} className="btn-danger btn-sm mt-4">
          Delete my account
        </button>
      ) : (
        <form action={formAction} className="mt-4 space-y-3">
          <div>
            <label className="label" htmlFor="confirm-delete-account">
              Type <b className="text-ink">DELETE MY ACCOUNT</b> to confirm
            </label>
            <input
              id="confirm-delete-account"
              name="confirm"
              className="input max-w-xs"
              placeholder="DELETE MY ACCOUNT"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
          <div className="flex gap-2">
            <SubmitButton className="btn-danger btn-sm" pendingText="Deleting…">
              Permanently delete account
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
