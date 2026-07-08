"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { SubmitButton } from "./submit-button";
import { saveInvoiceAction, type FormState } from "@/server/actions/invoices";
import { calcTotals } from "@/server/totals";
import { parseAmount, parseQty, parseRate, formatMoney } from "@/server/money";
import type { Client, Item, Invoice, InvoiceLine } from "@/server/db/schema";

type EditorLine = {
  key: string;
  itemId: string;
  title: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
};

let counter = 0;
const newKey = () => `l${counter++}`;
const emptyLine = (vatBps: number): EditorLine => ({
  key: newKey(),
  itemId: "",
  title: "",
  description: "",
  quantity: "1",
  unitPrice: "",
  taxRate: String(vatBps / 100),
});

function toDateInput(d?: Date | null): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export function InvoiceEditor({
  type,
  clients,
  items,
  defaultCurrency,
  defaultVatRateBps,
  defaultTerms,
  invoice,
  lines: existingLines,
}: {
  type: "invoice" | "quotation";
  clients: Pick<Client, "id" | "name" | "currency">[];
  items: Pick<Item, "id" | "name" | "description" | "unitPrice" | "taxRateBps" | "unit">[];
  defaultCurrency: string;
  defaultVatRateBps: number;
  defaultTerms: string;
  invoice?: Invoice;
  lines?: InvoiceLine[];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveInvoiceAction, {});
  const noun = type === "quotation" ? "Quotation" : "Invoice";
  const backHref = type === "quotation" ? "/quotations" : "/invoices";

  const [lines, setLines] = useState<EditorLine[]>(() =>
    existingLines && existingLines.length
      ? existingLines.map((l) => ({
          key: newKey(),
          itemId: l.itemId ?? "",
          title: l.title ?? l.description,
          description: l.title ? l.description : "",
          quantity: String(l.quantityMilli / 1000),
          unitPrice: (l.unitPrice / 100).toFixed(2),
          taxRate: String(l.taxRateBps / 100),
        }))
      : [emptyLine(defaultVatRateBps)],
  );

  const [discountType, setDiscountType] = useState<string>(invoice?.discountType ?? "");
  const [discountValue, setDiscountValue] = useState<string>(
    invoice?.discountType === "percent"
      ? String((invoice?.discountValue ?? 0) / 100)
      : invoice?.discountType === "fixed"
        ? ((invoice?.discountValue ?? 0) / 100).toFixed(2)
        : "",
  );
  const [depositType, setDepositType] = useState<string>(invoice?.depositType ?? "none");
  const [depositValue, setDepositValue] = useState<string>(
    invoice?.depositType === "percent"
      ? String((invoice?.depositValue ?? 0) / 100)
      : invoice?.depositType === "fixed"
        ? ((invoice?.depositValue ?? 0) / 100).toFixed(2)
        : "",
  );
  const [currency, setCurrency] = useState<string>(invoice?.currency ?? defaultCurrency);
  const [clientId, setClientId] = useState<string>(invoice?.clientId ?? "");
  const [showMore, setShowMore] = useState<boolean>(
    Boolean(invoice?.discountType) || (invoice?.depositType && invoice.depositType !== "none") || Boolean(invoice?.notes) || Boolean(invoice?.terms),
  );

  function updateLine(key: string, patch: Partial<EditorLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function pickItem(key: string, itemId: string) {
    const it = items.find((i) => i.id === itemId);
    if (!it) return updateLine(key, { itemId: "" });
    updateLine(key, {
      itemId,
      title: it.name,
      description: it.description ?? "",
      unitPrice: (it.unitPrice / 100).toFixed(2),
      taxRate: String(it.taxRateBps / 100),
    });
  }
  const addLine = () => setLines((ls) => [...ls, emptyLine(defaultVatRateBps)]);
  const removeLine = (key: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  const totals = useMemo(
    () =>
      calcTotals({
        lines: lines.map((l) => ({
          quantityMilli: parseQty(l.quantity),
          unitPrice: parseAmount(l.unitPrice),
          taxRateBps: parseRate(l.taxRate),
        })),
        discountType: (discountType || null) as "percent" | "fixed" | null,
        discountValue: discountType === "percent" ? parseRate(discountValue) : parseAmount(discountValue),
        depositType: depositType as "none" | "percent" | "fixed",
        depositValue: depositType === "percent" ? parseRate(depositValue) : parseAmount(depositValue),
      }),
    [lines, discountType, discountValue, depositType, depositValue],
  );

  const linesJson = JSON.stringify(
    lines.map((l) => ({
      itemId: l.itemId || null,
      title: l.title,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
    })),
  );

  const cur = currency;
  const money = (n: number) => formatMoney(n, cur);

  return (
    <form action={formAction} className="pb-24 lg:pb-0">
      <input type="hidden" name="type" value={type} />
      {invoice && <input type="hidden" name="id" value={invoice.id} />}
      <input type="hidden" name="lines" value={linesJson} />
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="discountType" value={discountType} />
      <input type="hidden" name="discountValue" value={discountValue} />
      <input type="hidden" name="depositType" value={depositType} />
      <input type="hidden" name="depositValue" value={depositValue} />
      <input type="hidden" name="currency" value={currency} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ---------------- Left: the form ---------------- */}
        <div className="space-y-5">
          {/* Client + meta */}
          <section className="card p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <label className="label mb-0" htmlFor="clientSel">Bill to</label>
              <Link href="/clients/new" className="text-xs font-semibold text-brand-700 hover:underline">
                ＋ New client
              </Link>
            </div>
            <select
              id="clientSel"
              className="input"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                const c = clients.find((x) => x.id === e.target.value);
                if (c) setCurrency(c.currency);
              }}
              required
            >
              <option value="" disabled>Choose a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {clients.length === 0 && (
              <p className="mt-2 text-xs text-amber-700">
                No clients yet — <Link href="/clients/new" className="underline">add one first</Link>.
              </p>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="issueDate">Issue date</label>
                <input id="issueDate" name="issueDate" type="date" className="input"
                  defaultValue={toDateInput(invoice?.issueDate) || toDateInput(new Date())} />
              </div>
              {type === "invoice" && (
                <div>
                  <label className="label" htmlFor="dueDate">Due date</label>
                  <input id="dueDate" name="dueDate" type="date" className="input" defaultValue={toDateInput(invoice?.dueDate)} />
                </div>
              )}
              <div>
                <label className="label" htmlFor="currencySel">Currency</label>
                <select id="currencySel" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {["KES", "USD", "EUR", "GBP", "UGX", "TZS"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Items */}
          <section className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Items &amp; services</h2>
              <span className="text-xs text-muted">{lines.length} line{lines.length === 1 ? "" : "s"}</span>
            </div>

            {lines.map((l, idx) => {
              const amount = parseAmount(l.unitPrice) * (parseQty(l.quantity) / 1000);
              return (
                <div key={l.key} className="card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{idx + 1}</span>
                    <button type="button" onClick={() => removeLine(l.key)} disabled={lines.length === 1}
                      className="text-xs font-medium text-muted hover:text-red-600 disabled:opacity-40">Remove</button>
                  </div>

                  {items.length > 0 && (
                    <select className="input mb-2 text-sm" value={l.itemId} onChange={(e) => pickItem(l.key, e.target.value)} aria-label="Pick a saved item">
                      <option value="">＋ Pick a saved item (autofills)</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>{it.name} — {money(it.unitPrice)}</option>
                      ))}
                    </select>
                  )}

                  <input className="input font-medium" placeholder="Product / service name *" value={l.title}
                    onChange={(e) => updateLine(l.key, { title: e.target.value, itemId: "" })} />
                  <input className="input mt-2 text-sm" placeholder="Description (optional)" value={l.description}
                    onChange={(e) => updateLine(l.key, { description: e.target.value })} />

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Field label="Qty">
                      <input className="input text-right" inputMode="decimal" value={l.quantity}
                        onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                    </Field>
                    <Field label={`Rate (${cur})`}>
                      <input className="input text-right" inputMode="decimal" placeholder="0.00" value={l.unitPrice}
                        onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} />
                    </Field>
                    <Field label="VAT %">
                      <input className="input text-right" inputMode="decimal" value={l.taxRate}
                        onChange={(e) => updateLine(l.key, { taxRate: e.target.value })} />
                    </Field>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                    <span className="text-xs text-muted">Line total</span>
                    <span className="font-semibold tabular-nums text-ink">{money(Math.round(amount))}</span>
                  </div>
                </div>
              );
            })}

            <button type="button" onClick={addLine}
              className="w-full rounded-xl border-2 border-dashed border-line py-3 text-sm font-semibold text-brand-700 transition-colors hover:border-brand-300 hover:bg-brand-50">
              ＋ Add another item
            </button>
          </section>

          {/* More options (progressive disclosure) */}
          <section className="card overflow-hidden">
            <button type="button" onClick={() => setShowMore((s) => !s)}
              className="flex w-full items-center justify-between px-5 py-4 text-left">
              <span className="text-sm font-semibold text-ink">Discount, deposit &amp; notes</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`h-4 w-4 text-muted transition-transform ${showMore ? "rotate-180" : ""}`}>
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {showMore && (
              <div className="space-y-4 border-t border-line p-5">
                <div>
                  <label className="label">Discount</label>
                  <div className="flex gap-2">
                    <select className="input w-40" value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
                      <option value="">No discount</option>
                      <option value="percent">Percent %</option>
                      <option value="fixed">Fixed amount</option>
                    </select>
                    {discountType && (
                      <input className="input" inputMode="decimal" placeholder={discountType === "percent" ? "e.g. 10" : "0.00"}
                        value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
                    )}
                  </div>
                </div>
                {type === "invoice" && (
                  <div>
                    <label className="label">Deposit / downpayment required</label>
                    <div className="flex gap-2">
                      <select className="input w-40" value={depositType} onChange={(e) => setDepositType(e.target.value)}>
                        <option value="none">None</option>
                        <option value="percent">Percent %</option>
                        <option value="fixed">Fixed amount</option>
                      </select>
                      {depositType !== "none" && (
                        <input className="input" inputMode="decimal" placeholder={depositType === "percent" ? "e.g. 50" : "0.00"}
                          value={depositValue} onChange={(e) => setDepositValue(e.target.value)} />
                      )}
                    </div>
                  </div>
                )}
                <div>
                  <label className="label" htmlFor="notes">Notes (visible to client)</label>
                  <textarea id="notes" name="notes" rows={2} className="input" defaultValue={invoice?.notes ?? ""} />
                </div>
                <div>
                  <label className="label" htmlFor="terms">Terms</label>
                  <textarea id="terms" name="terms" rows={2} className="input" defaultValue={invoice?.terms ?? defaultTerms} />
                </div>
              </div>
            )}
          </section>
        </div>

        {/* ---------------- Right: sticky summary (desktop) ---------------- */}
        <aside className="hidden lg:block">
          <div className="card sticky top-6 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{noun} summary</h2>
            <dl className="mt-4 space-y-2.5 text-sm">
              <Row label="Subtotal" value={money(totals.subtotal)} />
              {totals.discountAmount > 0 && <Row label="Discount" value={`− ${money(totals.discountAmount)}`} />}
              <Row label="VAT" value={money(totals.taxTotal)} />
              <div className="my-2 border-t border-line" />
              <Row label="Total" value={money(totals.total)} strong />
              {type === "invoice" && totals.depositAmount > 0 && (
                <>
                  <Row label="Deposit due now" value={money(totals.depositAmount)} accent />
                  <Row label="Balance later" value={money(totals.total - totals.depositAmount)} />
                </>
              )}
            </dl>
            {state.error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
            <div className="mt-5 space-y-2">
              <SubmitButton className="btn-primary w-full py-2.5">
                {invoice ? `Save ${noun.toLowerCase()}` : `Create ${noun.toLowerCase()}`}
              </SubmitButton>
              <Link href={backHref} className="btn-ghost w-full py-2.5">Cancel</Link>
            </div>
          </div>
        </aside>
      </div>

      {/* ---------------- Mobile sticky action bar ---------------- */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 p-3 backdrop-blur lg:hidden">
        {state.error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">{state.error}</p>}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-muted">Total</p>
            <p className="truncate text-lg font-extrabold tabular-nums text-ink">{money(totals.total)}</p>
          </div>
          <SubmitButton className="btn-primary px-6 py-3">
            {invoice ? "Save" : `Create ${noun.toLowerCase()}`}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={accent ? "text-brand-700" : "text-muted"}>{label}</dt>
      <dd className={`tabular-nums ${strong ? "text-xl font-extrabold text-ink" : accent ? "font-semibold text-brand-700" : "text-ink"}`}>{value}</dd>
    </div>
  );
}
