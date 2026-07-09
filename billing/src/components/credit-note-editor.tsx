"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { SubmitButton } from "./submit-button";
import { saveCreditNoteAction, type FormState } from "@/server/actions/credit-notes";
import { calcTotals } from "@/server/totals";
import { parseAmount, parseQty, parseRate, formatMoney } from "@/server/money";
import { AutoTextarea } from "./auto-textarea";
import type { Client, Item, CreditNote, CreditNoteLine } from "@/server/db/schema";

type EditorLine = {
  key: string;
  itemId: string;
  title: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
};

type InvoiceRef = { id: string; number: string; clientId: string; total: number; currency: string };

let counter = 0;
const newKey = () => `c${counter++}`;
// VAT starts blank — the user enters a rate only if the line is taxable.
const emptyLine = (): EditorLine => ({
  key: newKey(),
  itemId: "",
  title: "",
  description: "",
  quantity: "1",
  unitPrice: "",
  taxRate: "",
});

function toDateInput(d?: Date | null): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

const METHODS = [
  { v: "cash", label: "Cash" },
  { v: "mpesa", label: "M-Pesa" },
  { v: "bank", label: "Bank" },
  { v: "cheque", label: "Cheque" },
  { v: "card", label: "Card" },
  { v: "other", label: "Other" },
];

export function CreditNoteEditor({
  clients,
  items,
  invoices,
  defaultCurrency,
  defaultVatRateBps,
  creditNote,
  lines: existingLines,
}: {
  clients: Pick<Client, "id" | "name" | "currency">[];
  items: Pick<Item, "id" | "name" | "description" | "unitPrice" | "taxRateBps" | "unit">[];
  invoices: InvoiceRef[];
  defaultCurrency: string;
  defaultVatRateBps: number;
  creditNote?: CreditNote;
  lines?: CreditNoteLine[];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveCreditNoteAction, {});

  const [lines, setLines] = useState<EditorLine[]>(() =>
    existingLines && existingLines.length
      ? existingLines.map((l) => ({
          key: newKey(),
          itemId: "",
          title: l.title ?? l.description,
          description: l.title ? l.description : "",
          quantity: String(l.quantityMilli / 1000),
          unitPrice: (l.unitPrice / 100).toFixed(2),
          taxRate: String(l.taxRateBps / 100),
        }))
      : [emptyLine()],
  );

  const [clientId, setClientId] = useState<string>(creditNote?.clientId ?? "");
  const [currency, setCurrency] = useState<string>(creditNote?.currency ?? defaultCurrency);
  const [invoiceId, setInvoiceId] = useState<string>(creditNote?.invoiceId ?? "");
  const [applyToInvoice, setApplyToInvoice] = useState<boolean>(creditNote?.appliedToInvoice ?? true);
  const [refunded, setRefunded] = useState<boolean>(creditNote?.refunded ?? false);
  const [refundMethod, setRefundMethod] = useState<string>(creditNote?.refundMethod ?? "cash");

  const clientInvoices = useMemo(() => invoices.filter((i) => i.clientId === clientId), [invoices, clientId]);

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
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (key: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  const totals = useMemo(
    () =>
      calcTotals({
        lines: lines.map((l) => ({
          quantityMilli: parseQty(l.quantity),
          unitPrice: parseAmount(l.unitPrice),
          taxRateBps: parseRate(l.taxRate),
        })),
      }),
    [lines],
  );

  const linesJson = JSON.stringify(
    lines.map((l) => ({ title: l.title, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate })),
  );
  const money = (n: number) => formatMoney(n, currency);

  return (
    <form action={formAction} className="pb-24 lg:pb-0">
      {creditNote && <input type="hidden" name="id" value={creditNote.id} />}
      <input type="hidden" name="lines" value={linesJson} />
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="refundMethod" value={refundMethod} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section className="card p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <label className="label mb-0" htmlFor="clientSel">Credit to</label>
              <Link href="/clients/new" className="text-xs font-semibold text-brand-700 hover:underline">＋ New client</Link>
            </div>
            <select
              id="clientSel"
              className="input"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setInvoiceId("");
                const c = clients.find((x) => x.id === e.target.value);
                if (c) setCurrency(c.currency);
              }}
              required
            >
              <option value="" disabled>Choose a client…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="issueDate">Date</label>
                <input id="issueDate" name="issueDate" type="date" className="input"
                  defaultValue={toDateInput(creditNote?.issueDate) || toDateInput(new Date())} />
              </div>
              <div>
                <label className="label" htmlFor="invSel">Against invoice <span className="font-normal text-muted">(optional)</span></label>
                <select id="invSel" className="input" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} disabled={!clientId}>
                  <option value="">Not linked</option>
                  {clientInvoices.map((i) => <option key={i.id} value={i.id}>{i.number} — {formatMoney(i.total, i.currency)}</option>)}
                </select>
              </div>
            </div>

            {invoiceId && (
              <label className="mt-4 flex items-center gap-2.5">
                <input type="checkbox" name="appliedToInvoice" checked={applyToInvoice} onChange={(e) => setApplyToInvoice(e.target.checked)} className="h-4 w-4 rounded border-line text-brand-600" />
                <span className="text-sm text-ink">Reduce the balance owed on this invoice</span>
              </label>
            )}

            <div className="mt-4">
              <label className="label" htmlFor="reason">Reason</label>
              <input id="reason" name="reason" className="input" placeholder="e.g. Returned goods, overcharge correction" defaultValue={creditNote?.reason ?? ""} />
            </div>
          </section>

          {/* Items */}
          <section className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">What is being credited</h2>
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
                      {items.map((it) => <option key={it.id} value={it.id}>{it.name} — {money(it.unitPrice)}</option>)}
                    </select>
                  )}
                  <input className="input font-medium" placeholder="Item / reason name *" value={l.title}
                    onChange={(e) => updateLine(l.key, { title: e.target.value, itemId: "" })} />
                  <AutoTextarea className="input mt-2 text-sm" placeholder="Description — press Enter for a new line" value={l.description}
                    onChange={(v) => updateLine(l.key, { description: v })} />
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Field label="Qty">
                      <input className="input text-right" inputMode="decimal" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                    </Field>
                    <Field label={`Rate (${currency})`}>
                      <input className="input text-right" inputMode="decimal" placeholder="0.00" value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} />
                    </Field>
                    <Field label="VAT %">
                      <input className="input text-right" inputMode="decimal" value={l.taxRate} placeholder={defaultVatRateBps ? String(defaultVatRateBps / 100) : "0"} onChange={(e) => updateLine(l.key, { taxRate: e.target.value })} />
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
              ＋ Add another line
            </button>
          </section>

          {/* Refund + notes */}
          <section className="card space-y-4 p-5">
            <label className="flex items-center gap-2.5">
              <input type="checkbox" name="refunded" checked={refunded} onChange={(e) => setRefunded(e.target.checked)} className="h-4 w-4 rounded border-line text-brand-600" />
              <span className="text-sm text-ink">Cash was refunded to the client</span>
            </label>
            {refunded && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <span className="label">Refund method</span>
                  <div className="flex flex-wrap gap-2">
                    {METHODS.map((m) => (
                      <button type="button" key={m.v} onClick={() => setRefundMethod(m.v)}
                        className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                          refundMethod === m.v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-ink hover:bg-canvas"
                        }`}>{m.label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="refundReference">Reference <span className="font-normal text-muted">(optional)</span></label>
                  <input id="refundReference" name="refundReference" className="input" placeholder="M-Pesa code, cheque no…" defaultValue={creditNote?.refundReference ?? ""} />
                </div>
              </div>
            )}
            <div>
              <label className="label" htmlFor="notes">Notes <span className="font-normal text-muted">(optional)</span></label>
              <textarea id="notes" name="notes" rows={2} className="input" defaultValue={creditNote?.notes ?? ""} />
            </div>
          </section>
        </div>

        {/* Summary rail */}
        <aside className="hidden lg:block">
          <div className="card sticky top-6 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Credit note</h2>
            <dl className="mt-4 space-y-2.5 text-sm">
              <Row label="Subtotal" value={money(totals.subtotal)} />
              <Row label="VAT" value={money(totals.taxTotal)} />
              <div className="my-2 border-t border-line" />
              <Row label="Total credit" value={`− ${money(totals.total)}`} strong />
            </dl>
            {state.error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
            <div className="mt-5 space-y-2">
              <SubmitButton className="btn-primary w-full py-2.5">{creditNote ? "Save credit note" : "Create credit note"}</SubmitButton>
              <Link href="/credit-notes" className="btn-ghost w-full py-2.5">Cancel</Link>
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 p-3 backdrop-blur lg:hidden">
        {state.error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">{state.error}</p>}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-muted">Total credit</p>
            <p className="truncate text-lg font-extrabold tabular-nums text-ink">− {money(totals.total)}</p>
          </div>
          <SubmitButton className="btn-primary px-6 py-3">{creditNote ? "Save" : "Create"}</SubmitButton>
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

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={`tabular-nums ${strong ? "text-xl font-extrabold text-ink" : "text-ink"}`}>{value}</dd>
    </div>
  );
}
