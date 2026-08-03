"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { SubmitButton } from "./submit-button";
import { saveSettingsAction, type FormState } from "@/server/actions/settings";
import { formatRate } from "@/server/money";
import { TEMPLATES, ACCENTS } from "@/lib/doc-style";
import { TemplateThumb } from "./template-thumb";
import { ImageUploadField } from "./image-upload-field";
import type { OrgProfile } from "@/server/db/schema";

const CURRENCIES = ["KES", "USD", "EUR", "GBP", "UGX", "TZS"];

export function SettingsForm({
  orgName,
  profile,
  pro,
}: {
  orgName: string;
  profile: OrgProfile;
  pro: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveSettingsAction, {});
  const [vatRegistered, setVatRegistered] = useState(profile.vatRegistered);
  const [template, setTemplate] = useState(profile.invoiceTemplate || "column");
  const [accent, setAccent] = useState(profile.accentColor || "#0e9f6e");
  const [showSignature, setShowSignature] = useState(profile.showSignature);
  const [signatureAlign, setSignatureAlign] = useState<"left" | "center" | "right">(
    (profile.signatureAlign as "left" | "center" | "right") || "right",
  );

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
              <ImageUploadField
                name="logoUrl"
                initial={profile.logoUrl}
                label={`Logo${!pro ? " · Pro" : ""}`}
                hint={pro ? "PNG or JPG, under 500KB. Shown on your documents." : "Shown on documents once you upgrade to Pro."}
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
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Invoice template &amp; colour
          </h2>
          {!pro && (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
              Pro
            </span>
          )}
        </div>
        <p className="mb-4 text-sm text-muted">
          The look of your invoices, quotations and receipts. Applies to every document.
        </p>

        {!pro && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
            <p className="text-sm text-brand-800">
              On the free plan your documents use the default TallyPay look and carry a{" "}
              <b>Powered by TallyPay</b> mark. Upgrade to use your own logo, template and colour.
            </p>
            <Link href="/upgrade" className="btn-primary btn-sm whitespace-nowrap">
              Make it yours →
            </Link>
          </div>
        )}

        {/* Selections are kept even on Free, so they apply the moment you upgrade. */}
        <input type="hidden" name="invoiceTemplate" value={template} />
        <input type="hidden" name="accentColor" value={accent} />

        <fieldset
          disabled={!pro}
          className={!pro ? "pointer-events-none select-none opacity-60" : undefined}
          aria-hidden={!pro}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TEMPLATES.map((t) => {
              const active = template === t.id;
              return (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => setTemplate(t.id)}
                  aria-pressed={active}
                  className={`rounded-xl border p-2 text-left transition-colors ${
                    active ? "border-brand-500 ring-2 ring-brand-100" : "border-line hover:bg-canvas"
                  }`}
                >
                  <TemplateThumb id={t.id} accent={accent} />
                  <span className="mt-2 flex items-center gap-2 px-1">
                    <span
                      className={`inline-block h-3.5 w-3.5 flex-none rounded-full border ${active ? "" : "border-line"}`}
                      style={active ? { background: accent, borderColor: accent } : {}}
                    />
                    <span className="text-sm font-semibold text-ink">{t.name}</span>
                  </span>
                  <span className="mt-0.5 block px-1 text-xs text-muted">{t.desc}</span>
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
        </fieldset>
      </section>

      <section className="card p-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Signature</h2>
        <p className="mb-4 text-sm text-muted">
          Add an authorised signature to your invoices, receipts and other shared documents for credibility.
        </p>

        <input type="hidden" name="signatureAlign" value={signatureAlign} />
        <label className="mb-4 flex items-center gap-2.5">
          <input
            type="checkbox"
            name="showSignature"
            checked={showSignature}
            onChange={(e) => setShowSignature(e.target.checked)}
            className="h-4 w-4 rounded border-line text-brand-600"
          />
          <span className="text-sm text-ink">Show my signature on documents</span>
        </label>

        <div className="space-y-4">
          <ImageUploadField
            name="signatureUrl"
            initial={profile.signatureUrl}
            label="Signature image"
            hint="A PNG with a transparent background works best. Under 500KB."
            previewClass="h-16"
            previewBg="bg-white"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="signatureName">Name under signature</label>
              <input id="signatureName" name="signatureName" className="input" placeholder="e.g. Peter Misiati" defaultValue={profile.signatureName ?? ""} />
            </div>
            <div>
              <label className="label" htmlFor="signatureTitle">Title <span className="font-normal text-muted">(optional)</span></label>
              <input id="signatureTitle" name="signatureTitle" className="input" placeholder="e.g. Director" defaultValue={profile.signatureTitle ?? ""} />
            </div>
          </div>
          <div>
            <span className="label">Position on document</span>
            <div className="flex gap-2">
              {(["left", "center", "right"] as const).map((a) => (
                <button
                  type="button"
                  key={a}
                  onClick={() => setSignatureAlign(a)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                    signatureAlign === a ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-ink hover:bg-canvas"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
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
