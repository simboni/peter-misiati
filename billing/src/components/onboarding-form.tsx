"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "./submit-button";
import { createOrganizationAction, type FormState } from "@/server/actions/onboarding";

export function OnboardingForm() {
  const [state, formAction] = useActionState<FormState, FormData>(createOrganizationAction, {});
  const [vatRegistered, setVatRegistered] = useState(false);

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label className="label" htmlFor="name">
          Business / trading name *
        </label>
        <input id="name" name="name" className="input" placeholder="Acme Freelance Services" required />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="legalName">
            Legal name (optional)
          </label>
          <input id="legalName" name="legalName" className="input" placeholder="Acme Ltd" />
        </div>
        <div>
          <label className="label" htmlFor="kraPin">
            KRA PIN
          </label>
          <input id="kraPin" name="kraPin" className="input" placeholder="P051XXXXXXX" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="email">
            Business email
          </label>
          <input id="email" name="email" type="email" className="input" placeholder="billing@acme.co.ke" />
        </div>
        <div>
          <label className="label" htmlFor="phone">
            Phone
          </label>
          <input id="phone" name="phone" className="input" placeholder="+254 7xx xxx xxx" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="addressLine1">
            Address
          </label>
          <input id="addressLine1" name="addressLine1" className="input" placeholder="P.O. Box / Street" />
        </div>
        <div>
          <label className="label" htmlFor="city">
            Town / City
          </label>
          <input id="city" name="city" className="input" placeholder="Bungoma" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="currency">
            Base currency
          </label>
          <select id="currency" name="currency" className="input" defaultValue="KES">
            <option value="KES">KES — Kenyan Shilling</option>
            <option value="USD">USD — US Dollar</option>
            <option value="EUR">EUR — Euro</option>
            <option value="GBP">GBP — Pound</option>
            <option value="UGX">UGX — Ugandan Shilling</option>
            <option value="TZS">TZS — Tanzanian Shilling</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="vatRate">
            Default VAT rate (%)
          </label>
          <input
            id="vatRate"
            name="vatRate"
            className="input disabled:bg-canvas"
            defaultValue="16"
            inputMode="decimal"
            disabled={!vatRegistered}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="vatRegistered"
          checked={vatRegistered}
          onChange={(e) => setVatRegistered(e.target.checked)}
          className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
        />
        We are VAT registered (charge VAT on invoices)
      </label>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <SubmitButton className="btn-primary w-full" pendingText="Setting up…">
        Create workspace
      </SubmitButton>
    </form>
  );
}
