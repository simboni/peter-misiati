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

  const [lines, setLines] = useState<EditorLine[]>(() =>
    existingLines && existingLines.length
      ? existingLines.map((l) => ({
          key: newKey(),
          itemId: l.itemId ?? "",
          title: l.title ?? l.description, // legacy rows kept the name in description
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

  function updateLine(key: string, patch: Partial<EditorLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function pickItem(key: string, itemId: string) {
    const it = items.find((i) => i.id === itemId);
    if (!it) {
      updateLine(key, { itemId: "" });
      return;
    }
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

  const noun = type === "quotation" ? "Quotation" : "Invoice";
  const backHref = type === "quotation" ? "/quotations" : "/invoices";

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="type" value={type} />
      {invoice && <input type="hidden" name="id" value={invoice.id} />}
      <input type="hidden" name="lines" value={linesJson} />
      <input type="hidden" name="discountType" value={discountType} />
      <input type="hidden" name="discountValue" value={discountValue} />
      <input type="hidden" name="depositType" value={depositType} />
      <input type="hidden" name="depositValue" value={depositValue} />
      <input type="hidden" name="currency" value={currency} />

      {/* Header */}
      <section className="card grid gap-4 p-6 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="clientId">
            Client *
          </label>
          <select
            id="clientId"
            name="clientId"
            className="input"
            defaultValue={invoice?.clientId ?? ""}
            onChange={(e) => {
              const c = clients.find((x) => x.id === e.target.value);
              if (c) setCurrency(c.currency);
            }}
            required
          >
            <option value="" disabled>
              Choose a client…
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {clients.length === 0 && (
            <p className="mt-1 text-xs text-amber-700">
              You have no clients yet.{" "}
              <Link href="/clients/new" className="underline">
                Add one first
              </Link>
              .
            </p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="currencySel">
            Currency
          </label>
          <select
            id="currencySel"
            className="input"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {["KES", "USD", "EUR", "GBP", "UGX", "TZS"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="issueDate">
            Issue date
          </label>
          <input
            id="issueDate"
            name="issueDate"
            type="date"
            className="input"
            defaultValue={toDateInput(invoice?.issueDate) || toDateInput(new Date())}
          />
        </div>
        {type === "invoice" && (
          <div>
            <label className="label" htmlFor="dueDate">
              Due date
            </label>
            <input
              id="dueDate"
              name="dueDate"
              type="date"
              className="input"
              defaultValue={toDateInput(invoice?.dueDate)}
            />
          </div>
        )}
      </section>

      {/* Lines — one interactive card per item (mobile friendly) */}
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
                <span className="text-xs font-semibold text-muted">Item {idx + 1}</span>
                <button
                  type="button"
                  onClick={() => removeLine(l.key)}
                  disabled={lines.length === 1}
                  className="text-xs font-medium text-muted hover:text-red-600 disabled:opacity-40"
                >
                  Remove
                </button>
              </div>

              {items.length > 0 && (
                <select
                  className="input mb-2 text-sm"
                  value={l.itemId}
                  onChange={(e) => pickItem(l.key, e.target.value)}
                  aria-label="Pick a saved item"
                >
                  <option value="">＋ Pick a saved item (autofills below)</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} — {formatMoney(it.unitPrice, currency)}
                    </option>
                  ))}
                </select>
              )}

              <input
                className="input font-medium"
                placeholder="Product / service name *"
                value={l.title}
                onChange={(e) => updateLine(l.key, { title: e.target.value, itemId: "" })}
              />
              <input
                className="input mt-2 text-sm"
                placeholder="Description (optional)"
                value={l.description}
                onChange={(e) => updateLine(l.key, { description: e.target.value })}
              />

              <div className="mt-3 grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted">Qty</span>
                  <input
                    className="input text-right"
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted">Rate</span>
                  <input
                    className="input text-right"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={l.unitPrice}
                    onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted">VAT %</span>
                  <input
                    className="input text-right"
                    inputMode="decimal"
                    value={l.taxRate}
                    onChange={(e) => updateLine(l.key, { taxRate: e.target.value })}
                  />
                </label>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                <span className="text-xs text-muted">Line amount</span>
                <span className="font-semibold tabular-nums text-ink">
                  {formatMoney(Math.round(amount), currency)}
                </span>
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={addLine}
          className="w-full rounded-xl border-2 border-dashed border-line py-3 text-sm font-semibold text-brand-700 transition-colors hover:border-brand-300 hover:bg-brand-50"
        >
          ＋ Add another item
        </button>
      </section>

      {/* Totals + deposit + notes */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-4 p-6">
          <div>
            <label className="label">Discount</label>
            <div className="flex gap-2">
              <select
                className="input w-40"
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value)}
              >
                <option value="">No discount</option>
                <option value="percent">Percent %</option>
                <option value="fixed">Fixed amount</option>
              </select>
              {discountType && (
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder={discountType === "percent" ? "e.g. 10" : "0.00"}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                />
              )}
            </div>
          </div>

          {type === "invoice" && (
            <div>
              <label className="label">Deposit / downpayment required</label>
              <div className="flex gap-2">
                <select
                  className="input w-40"
                  value={depositType}
                  onChange={(e) => setDepositType(e.target.value)}
                >
                  <option value="none">None</option>
                  <option value="percent">Percent %</option>
                  <option value="fixed">Fixed amount</option>
                </select>
                {depositType !== "none" && (
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder={depositType === "percent" ? "e.g. 50" : "0.00"}
                    value={depositValue}
                    onChange={(e) => setDepositValue(e.target.value)}
                  />
                )}
              </div>
            </div>
          )}

          <div>
            <label className="label" htmlFor="notes">
              Notes (visible to client)
            </label>
            <textarea id="notes" name="notes" rows={2} className="input" defaultValue={invoice?.notes ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="terms">
              Terms
            </label>
            <textarea
              id="terms"
              name="terms"
              rows={2}
              className="input"
              defaultValue={invoice?.terms ?? defaultTerms}
            />
          </div>
        </section>

        <section className="card p-6">
          <dl className="space-y-2 text-sm">
            <Row label="Subtotal" value={formatMoney(totals.subtotal, currency)} />
            {totals.discountAmount > 0 && (
              <Row label="Discount" value={`− ${formatMoney(totals.discountAmount, currency)}`} />
            )}
            <Row label="VAT" value={formatMoney(totals.taxTotal, currency)} />
            <div className="my-2 border-t border-line" />
            <Row label="Total" value={formatMoney(totals.total, currency)} strong />
            {type === "invoice" && totals.depositAmount > 0 && (
              <>
                <Row label="Deposit due now" value={formatMoney(totals.depositAmount, currency)} accent />
                <Row
                  label="Balance later"
                  value={formatMoney(totals.total - totals.depositAmount, currency)}
                />
              </>
            )}
          </dl>
        </section>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex gap-3">
        <SubmitButton>{invoice ? `Save ${noun.toLowerCase()}` : `Create ${noun.toLowerCase()}`}</SubmitButton>
        <Link href={backHref} className="btn-ghost">
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Row({
  label,
  value,
  strong,
  accent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className={accent ? "text-brand-700" : "text-muted"}>{label}</dt>
      <dd
        className={`tabular-nums ${strong ? "text-lg font-bold text-ink" : accent ? "font-semibold text-brand-700" : "text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}
