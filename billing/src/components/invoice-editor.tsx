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
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
};

let counter = 0;
const newKey = () => `l${counter++}`;

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
  items: Pick<Item, "id" | "name" | "unitPrice" | "taxRateBps" | "unit">[];
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
          description: l.description,
          quantity: String(l.quantityMilli / 1000),
          unitPrice: (l.unitPrice / 100).toFixed(2),
          taxRate: String(l.taxRateBps / 100),
        }))
      : [
          {
            key: newKey(),
            itemId: "",
            description: "",
            quantity: "1",
            unitPrice: "",
            taxRate: String(defaultVatRateBps / 100),
          },
        ],
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
      description: it.name,
      unitPrice: (it.unitPrice / 100).toFixed(2),
      taxRate: String(it.taxRateBps / 100),
    });
  }
  const addLine = () =>
    setLines((ls) => [
      ...ls,
      { key: newKey(), itemId: "", description: "", quantity: "1", unitPrice: "", taxRate: String(defaultVatRateBps / 100) },
    ]);
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

      {/* Lines */}
      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-line bg-canvas">
              <tr>
                <th className="th">Item / description</th>
                <th className="th w-24 text-right">Qty</th>
                <th className="th w-32 text-right">Unit price</th>
                <th className="th w-20 text-right">VAT %</th>
                <th className="th w-32 text-right">Amount</th>
                <th className="th w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lines.map((l) => {
                const amount = parseAmount(l.unitPrice) * (parseQty(l.quantity) / 1000);
                return (
                  <tr key={l.key} className="align-top">
                    <td className="td">
                      {items.length > 0 && (
                        <select
                          className="input mb-1 text-xs"
                          value={l.itemId}
                          onChange={(e) => pickItem(l.key, e.target.value)}
                        >
                          <option value="">— pick a saved item —</option>
                          {items.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <input
                        className="input"
                        placeholder="Description"
                        value={l.description}
                        onChange={(e) => updateLine(l.key, { description: e.target.value })}
                      />
                    </td>
                    <td className="td">
                      <input
                        className="input text-right"
                        inputMode="decimal"
                        value={l.quantity}
                        onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                      />
                    </td>
                    <td className="td">
                      <input
                        className="input text-right"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={l.unitPrice}
                        onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })}
                      />
                    </td>
                    <td className="td">
                      <input
                        className="input text-right"
                        inputMode="decimal"
                        value={l.taxRate}
                        onChange={(e) => updateLine(l.key, { taxRate: e.target.value })}
                      />
                    </td>
                    <td className="td text-right tabular-nums">{formatMoney(Math.round(amount), currency)}</td>
                    <td className="td">
                      <button
                        type="button"
                        onClick={() => removeLine(l.key)}
                        className="text-muted hover:text-red-600"
                        aria-label="Remove line"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line p-3">
          <button type="button" onClick={addLine} className="btn-ghost btn-sm">
            + Add line
          </button>
        </div>
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
