"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { savePlatformSettingsAction, type SettingsState } from "@/server/actions/admin";

type Props = {
  pricePerSeatKes: number;
  currency: string;
  kopokopoEnabled: boolean;
  kopokopoBaseUrl: string | null;
  kopokopoTill: string | null;
  kopokopoClientId: string | null;
  hasClientSecret: boolean;
  hasApiKey: boolean;
  resendFrom: string | null;
  hasResendKey: boolean;
};

export function PlatformSettingsForm(p: Props) {
  const [state, action] = useActionState<SettingsState, FormData>(savePlatformSettingsAction, {});

  return (
    <form action={action} className="space-y-6">
      <section className="card p-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Pricing</h2>
        <p className="mb-4 text-sm text-muted">The Pro (white-label) plan price shown to every vendor.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="pricePerSeatKes">Price per user / month (KES)</label>
            <input id="pricePerSeatKes" name="pricePerSeatKes" className="input" inputMode="numeric" defaultValue={p.pricePerSeatKes} />
          </div>
          <div>
            <label className="label" htmlFor="currency">Currency</label>
            <input id="currency" name="currency" className="input" defaultValue={p.currency} />
          </div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
          Platform M-Pesa (Kopo Kopo)
        </h2>
        <p className="mb-4 text-sm text-muted">
          The fallback account that collects for vendors who haven’t connected their own. Secrets are
          encrypted — leave blank to keep the current value.
        </p>
        <label className="mb-4 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="kopokopoEnabled" defaultChecked={p.kopokopoEnabled} className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500" />
          Enable platform M-Pesa collection
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="kopokopoBaseUrl">Base URL</label>
            <input id="kopokopoBaseUrl" name="kopokopoBaseUrl" className="input" placeholder="https://api.kopokopo.com" defaultValue={p.kopokopoBaseUrl ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="kopokopoTill">Till / online-payment number</label>
            <input id="kopokopoTill" name="kopokopoTill" className="input" defaultValue={p.kopokopoTill ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="kopokopoClientId">Client ID</label>
            <input id="kopokopoClientId" name="kopokopoClientId" className="input" defaultValue={p.kopokopoClientId ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="kopokopoClientSecret">Client secret {p.hasClientSecret && <span className="text-brand-600">· set</span>}</label>
            <input id="kopokopoClientSecret" name="kopokopoClientSecret" type="password" className="input" placeholder={p.hasClientSecret ? "•••••••• (leave blank to keep)" : ""} />
          </div>
          <div>
            <label className="label" htmlFor="kopokopoApiKey">API key (webhook verify) {p.hasApiKey && <span className="text-brand-600">· set</span>}</label>
            <input id="kopokopoApiKey" name="kopokopoApiKey" type="password" className="input" placeholder={p.hasApiKey ? "•••••••• (leave blank to keep)" : ""} />
          </div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Email (Resend)</h2>
        <p className="mb-4 text-sm text-muted">Used to email pay links to clients. Leave the key blank to keep the current one.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="resendApiKey">Resend API key {p.hasResendKey && <span className="text-brand-600">· set</span>}</label>
            <input id="resendApiKey" name="resendApiKey" type="password" className="input" placeholder={p.hasResendKey ? "•••••••• (leave blank to keep)" : "re_…"} />
          </div>
          <div>
            <label className="label" htmlFor="resendFrom">From address</label>
            <input id="resendFrom" name="resendFrom" className="input" placeholder="Tally <billing@yourdomain.com>" defaultValue={p.resendFrom ?? ""} />
          </div>
        </div>
      </section>

      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">Settings saved.</p>}

      <SubmitButton>Save platform settings</SubmitButton>
    </form>
  );
}
