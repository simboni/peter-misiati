"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "./submit-button";
import { saveSettingsAction, type FormState } from "@/server/actions/settings";
import { formatRate } from "@/server/money";
import { TEMPLATES, ACCENTS } from "@/lib/doc-style";
import type { OrgProfile } from "@/server/db/schema";

const CURRENCIES = ["KES", "USD", "EUR", "GBP", "UGX", "TZS"];

export function SettingsForm({
  orgName,
  profile,
}: {
  orgName: string;
  profile: OrgProfile;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveSettingsAction, {});
  const [vatRegistered, setVatRegistered] = useState(profile.vatRegistered);
  const [template, setTemplate] = useState(profile.invoiceTemplate || "column");
  const [accent, setAccent] = useState(profile.accentColor || "#0e9f6e");

  return (
    <form action={formAction} className="space-y-6">
      <section className="card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
          Business identity
        </h2>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="name">
                Business / trading name *
              </label>
              <input id="name" name="name" className="input" defaultValue={orgName} required />
            </div>
            <div>
              <label className="label" htmlFor="legalName">
                Legal name
              </label>
              <input
                id="legalName"
                name="legalName"
                className="input"
                defaultValue={profile.legalName ?? ""}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="kraPin">
                KRA PIN
              </label>
              <input id="kraPin" name="kraPin" className="input" defaultValue={profile.kraPin ?? ""} />
            </div>
            <div>
              <label className="label" htmlFor="logoUrl">
                Logo URL (optional)
              </label>
              <input
                id="logoUrl"
                name="logoUrl"
                className="input"
                placeholder="https://…/logo.png"
                defaultValue={profile.logoUrl ?? ""}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
          Contact & address
        </h2>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input id="email" name="email" type="email" className="input" defaultValue={profile.email ?? ""} />
            </div>
            <div>
              <label className="label" htmlFor="phone">
                Phone
              </label>
              <input id="phone" name="phone" className="input" defaultValue={profile.phone ?? ""} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="addressLine1">
                Address line 1
              </label>
              <input
                id="addressLine1"
                name="addressLine1"
                className="input"
                defaultValue={profile.addressLine1 ?? ""}
              />
            </div>
            <div>
              <label className="label" htmlFor="addressLine2">
                Address line 2
              </label>
              <input
                id="addressLine2"
                name="addressLine2"
                className="input"
                defaultValue={profile.addressLine2 ?? ""}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="city">
                Town / City
              </label>
              <input id="city" name="city" className="input" defaultValue={profile.city ?? ""} />
            </div>
            <div>
              <label className="label" htmlFor="country">
                Country
              </label>
              <input id="country" name="country" className="input" defaultValue={profile.country ?? "Kenya"} />
            </div>
          </div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
          Tax & currency
        </h2>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="vatRegistered"
              checked={vatRegistered}
              onChange={(e) => setVatRegistered(e.target.checked)}
              className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
            />
            VAT registered (charge VAT on invoices)
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="vatRate">
                Default VAT rate (%)
              </label>
              <input
                id="vatRate"
                name="vatRate"
                className="input disabled:bg-canvas"
                defaultValue={formatRate(profile.defaultVatRateBps || 1600)}
                disabled={!vatRegistered}
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="label" htmlFor="currency">
                Base currency
              </label>
              <select id="currency" name="currency" className="input" defaultValue={profile.currency}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
          Documents
        </h2>
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="bankDetails">
              Bank / payment details (shown on invoices)
            </label>
            <textarea
              id="bankDetails"
              name="bankDetails"
              rows={3}
              className="input"
              placeholder="Bank, Account name, Account no., Branch / Paybill…"
              defaultValue={profile.bankDetails ?? ""}
            />
          </div>
          <div>
            <label className="label" htmlFor="invoiceFooter">
              Default invoice notes / terms
            </label>
            <textarea
              id="invoiceFooter"
              name="invoiceFooter"
              rows={3}
              className="input"
              placeholder="e.g. Payment due within 14 days. Thank you for your business."
              defaultValue={profile.invoiceFooter ?? ""}
            />
          </div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
          Invoice template &amp; colour
        </h2>
        <p className="mb-4 text-sm text-muted">
          The look of your invoices, quotations and receipts. Applies to every document.
        </p>
        <input type="hidden" name="invoiceTemplate" value={template} />
        <input type="hidden" name="accentColor" value={accent} />

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((t) => {
            const active = template === t.id;
            return (
              <button
                type="button"
                key={t.id}
                onClick={() => setTemplate(t.id)}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  active ? "border-brand-500 ring-2 ring-brand-100" : "border-line hover:bg-canvas"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-4 w-4 rounded-full border border-line"
                    style={{ background: active ? accent : "transparent" }}
                  />
                  <span className="font-semibold text-ink">{t.name}</span>
                </span>
                <span className="mt-1 block text-xs text-muted">{t.desc}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-5">
          <label className="label">Accent colour</label>
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((a) => (
              <button
                type="button"
                key={a.hex}
                onClick={() => setAccent(a.hex)}
                title={a.name}
                aria-label={a.name}
                className={`h-8 w-8 rounded-full border-2 transition-transform ${
                  accent === a.hex ? "scale-110 border-ink" : "border-white"
                }`}
                style={{ background: a.hex, boxShadow: "0 0 0 1px var(--color-line)" }}
              />
            ))}
          </div>
        </div>
      </section>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      {state.ok && (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">Settings saved.</p>
      )}

      <SubmitButton>Save settings</SubmitButton>
    </form>
  );
}
