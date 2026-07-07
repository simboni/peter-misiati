"use client";

import { useActionState } from "react";
import Link from "next/link";
import { SubmitButton } from "./submit-button";
import { saveClientAction, type FormState } from "@/server/actions/clients";
import type { Client } from "@/server/db/schema";

const CURRENCIES = ["KES", "USD", "EUR", "GBP", "UGX", "TZS"];

export function ClientForm({ client }: { client?: Client }) {
  const [state, formAction] = useActionState<FormState, FormData>(saveClientAction, {});

  return (
    <form action={formAction} className="card max-w-2xl space-y-5 p-6">
      {client && <input type="hidden" name="id" value={client.id} />}

      <div>
        <label className="label" htmlFor="name">
          Client name *
        </label>
        <input id="name" name="name" className="input" defaultValue={client?.name ?? ""} required />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="contactPerson">
            Contact person
          </label>
          <input
            id="contactPerson"
            name="contactPerson"
            className="input"
            defaultValue={client?.contactPerson ?? ""}
          />
        </div>
        <div>
          <label className="label" htmlFor="kraPin">
            KRA PIN
          </label>
          <input id="kraPin" name="kraPin" className="input" defaultValue={client?.kraPin ?? ""} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" className="input" defaultValue={client?.email ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="phone">
            Phone
          </label>
          <input id="phone" name="phone" className="input" defaultValue={client?.phone ?? ""} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="addressLine1">
            Address
          </label>
          <input
            id="addressLine1"
            name="addressLine1"
            className="input"
            defaultValue={client?.addressLine1 ?? ""}
          />
        </div>
        <div>
          <label className="label" htmlFor="city">
            Town / City
          </label>
          <input id="city" name="city" className="input" defaultValue={client?.city ?? ""} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="currency">
            Billing currency
          </label>
          <select
            id="currency"
            name="currency"
            className="input"
            defaultValue={client?.currency ?? "KES"}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="notes">
          Notes
        </label>
        <textarea id="notes" name="notes" rows={3} className="input" defaultValue={client?.notes ?? ""} />
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex gap-3">
        <SubmitButton>{client ? "Save changes" : "Add client"}</SubmitButton>
        <Link href="/clients" className="btn-ghost">
          Cancel
        </Link>
      </div>
    </form>
  );
}
