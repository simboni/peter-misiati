"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "./submit-button";
import { savePaymentSettingsAction, type FormState } from "@/server/actions/payment-settings";

export function PaymentSettingsForm({
  enabled,
  baseUrl,
  till,
  clientId,
  hasSecret,
  hasApiKey,
  platformConfigured,
}: {
  enabled: boolean;
  baseUrl: string | null;
  till: string | null;
  clientId: string | null;
  hasSecret: boolean;
  hasApiKey: boolean;
  platformConfigured: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(savePaymentSettingsAction, {});
  const [on, setOn] = useState(enabled);

  return (
    <form action={formAction} className="card space-y-5 p-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          M-Pesa collection (Kopo Kopo)
        </h2>
        <p className="mt-1 text-sm text-muted">
          Let clients pay your invoices by M-Pesa. By default payments use the platform account
          {platformConfigured ? " (already set up)" : " (not set up yet)"}. Switch this on to collect
          into <strong>your own</strong> Kopo Kopo account instead.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="kopokopoEnabled"
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
          className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
        />
        Use my own Kopo Kopo account
      </label>

      <fieldset disabled={!on} className="space-y-4 disabled:opacity-50">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="kopokopoBaseUrl">
              Environment
            </label>
            <select
              id="kopokopoBaseUrl"
              name="kopokopoBaseUrl"
              className="input"
              defaultValue={baseUrl ?? "https://api.kopokopo.com"}
            >
              <option value="https://sandbox.kopokopo.com">Sandbox (testing)</option>
              <option value="https://api.kopokopo.com">Production (live money)</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="kopokopoTill">
              Till / online-payment number
            </label>
            <input
              id="kopokopoTill"
              name="kopokopoTill"
              className="input"
              defaultValue={till ?? ""}
              placeholder="K000000"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="kopokopoClientId">
            Client ID
          </label>
          <input
            id="kopokopoClientId"
            name="kopokopoClientId"
            className="input"
            defaultValue={clientId ?? ""}
            autoComplete="off"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="kopokopoClientSecret">
              Client Secret
            </label>
            <input
              id="kopokopoClientSecret"
              name="kopokopoClientSecret"
              type="password"
              className="input"
              autoComplete="new-password"
              placeholder={hasSecret ? "•••••••• (leave blank to keep)" : "Paste your client secret"}
            />
          </div>
          <div>
            <label className="label" htmlFor="kopokopoApiKey">
              API Key
            </label>
            <input
              id="kopokopoApiKey"
              name="kopokopoApiKey"
              type="password"
              className="input"
              autoComplete="new-password"
              placeholder={hasApiKey ? "•••••••• (leave blank to keep)" : "Paste your API key"}
            />
          </div>
        </div>
        <p className="text-xs text-muted">
          Secrets are encrypted before they’re stored, and never shown again. The API key is what
          verifies M-Pesa’s confirmation webhook.
        </p>
      </fieldset>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      {state.ok && (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
          M-Pesa settings saved.
        </p>
      )}

      <SubmitButton>Save M-Pesa settings</SubmitButton>
    </form>
  );
}
