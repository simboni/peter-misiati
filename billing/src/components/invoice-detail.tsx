import Link from "next/link";
import { StatusBadge } from "./status-badge";
import { RecordPaymentForm } from "./record-payment-form";
import { formatMoney, formatQty, formatRate } from "@/server/money";
import { fmtDate } from "@/server/queries";
import {
  setInvoiceStatusAction,
  convertQuotationAction,
  deleteInvoiceAction,
} from "@/server/actions/invoices";
import { deletePaymentAction } from "@/server/actions/payments";
import { emailInvoiceAction } from "@/server/actions/email";
import type { Invoice, InvoiceLine, Client, Payment } from "@/server/db/schema";

const METHOD_LABELS: Record<string, string> = {
  mpesa: "M-Pesa",
  cash: "Cash",
  bank: "Bank transfer",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};

export function InvoiceDetail({
  invoice,
  lines,
  client,
  payments,
  error,
  sent,
  pdfEnabled,
}: {
  invoice: Invoice;
  lines: InvoiceLine[];
  client: Client | null;
  payments: Payment[];
  error?: string;
  sent?: boolean;
  pdfEnabled?: boolean;
}) {
  const isQuote = invoice.type === "quotation";
  const cur = invoice.currency;
  const base = isQuote ? "quotations" : "invoices";
  const depositMet = invoice.amountPaid >= invoice.depositAmount && invoice.depositAmount > 0;

  return (
    <div className="space-y-6">
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-ink">{invoice.number}</h1>
          <StatusBadge status={invoice.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/d/${invoice.shareToken}`} className="btn-ghost btn-sm" target="_blank">
            View / Print
          </Link>
          {pdfEnabled && (
            <a href={`/d/${invoice.shareToken}/pdf`} className="btn-ghost btn-sm" target="_blank" rel="noreferrer">
              Download PDF
            </a>
          )}
          <form action={emailInvoiceAction}>
            <input type="hidden" name="id" value={invoice.id} />
            <button className="btn-ghost btn-sm">Email to client</button>
          </form>
          {invoice.amountPaid === 0 && (
            <Link href={`/${base}/${invoice.id}/edit`} className="btn-ghost btn-sm">
              Edit
            </Link>
          )}
          {invoice.status === "draft" && (
            <form action={setInvoiceStatusAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <input type="hidden" name="status" value="sent" />
              <button className="btn-ghost btn-sm">Mark as sent</button>
            </form>
          )}
          {isQuote && invoice.status !== "accepted" && (
            <form action={convertQuotationAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <button className="btn-primary btn-sm">Convert to invoice</button>
            </form>
          )}
          {!isQuote && invoice.status !== "void" && invoice.amountPaid === 0 && (
            <form action={setInvoiceStatusAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <input type="hidden" name="status" value="void" />
              <button className="btn-ghost btn-sm">Void</button>
            </form>
          )}
          {invoice.amountPaid === 0 && (
            <form action={deleteInvoiceAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <input type="hidden" name="type" value={invoice.type} />
              <button className="btn-danger btn-sm">Delete</button>
            </form>
          )}
        </div>
      </div>

      {error === "cannot-delete" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Paid documents can’t be deleted — void it instead to keep your records intact.
        </p>
      )}
      {sent && (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
          Emailed to {client?.email ?? "the client"}.
        </p>
      )}
      {error === "no-email" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This client has no email address. Add one on the client record, or share the link / WhatsApp instead.
        </p>
      )}
      {error && !["cannot-delete", "no-email"].includes(error) && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Document body */}
        <div className="card p-6">
          <div className="mb-6 flex flex-wrap justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Bill to</p>
              <p className="mt-1 font-semibold text-ink">{client?.name ?? "—"}</p>
              {client?.email && <p className="text-sm text-muted">{client.email}</p>}
              {client?.phone && <p className="text-sm text-muted">{client.phone}</p>}
              {client?.kraPin && <p className="text-sm text-muted">KRA PIN: {client.kraPin}</p>}
            </div>
            <div className="text-right text-sm">
              <p className="text-muted">
                Issued: <span className="text-ink">{fmtDate(invoice.issueDate)}</span>
              </p>
              {!isQuote && (
                <p className="text-muted">
                  Due: <span className="text-ink">{fmtDate(invoice.dueDate)}</span>
                </p>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">Description</th>
                  <th className="th text-right">Qty</th>
                  <th className="th text-right">Unit price</th>
                  <th className="th text-right">VAT</th>
                  <th className="th text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="td">
                      <div className="font-medium text-ink">{l.title || l.description}</div>
                      {l.title && l.description ? (
                        <div className="text-xs text-muted">{l.description}</div>
                      ) : null}
                    </td>
                    <td className="td text-right tabular-nums">{formatQty(l.quantityMilli)}</td>
                    <td className="td text-right tabular-nums">{formatMoney(l.unitPrice, cur)}</td>
                    <td className="td text-right text-muted">{formatRate(l.taxRateBps)}%</td>
                    <td className="td text-right tabular-nums">{formatMoney(l.lineSubtotal, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex justify-end">
            <dl className="w-full max-w-xs space-y-1.5 text-sm">
              <Row label="Subtotal" value={formatMoney(invoice.subtotal, cur)} />
              {invoice.discountAmount > 0 && (
                <Row label="Discount" value={`− ${formatMoney(invoice.discountAmount, cur)}`} />
              )}
              <Row label="VAT" value={formatMoney(invoice.taxTotal, cur)} />
              <div className="border-t border-line pt-1.5">
                <Row label="Total" value={formatMoney(invoice.total, cur)} strong />
              </div>
              {!isQuote && (
                <>
                  <Row label="Paid" value={formatMoney(invoice.amountPaid, cur)} />
                  <Row label="Balance due" value={formatMoney(invoice.balanceDue, cur)} accent />
                </>
              )}
            </dl>
          </div>

          {(invoice.notes || invoice.terms) && (
            <div className="mt-6 space-y-2 border-t border-line pt-4 text-sm text-muted">
              {invoice.notes && <p>{invoice.notes}</p>}
              {invoice.terms && <p className="text-xs">{invoice.terms}</p>}
            </div>
          )}
        </div>

        {/* Side: deposit + payments (invoices only) */}
        {!isQuote && (
          <div className="space-y-6">
            {invoice.depositAmount > 0 && (
              <div className="card p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Deposit / downpayment
                </p>
                <p className="mt-1 text-2xl font-bold text-ink">{formatMoney(invoice.depositAmount, cur)}</p>
                <p className="mt-1 text-sm">
                  {depositMet ? (
                    <span className="text-brand-700">✔ Deposit received</span>
                  ) : (
                    <span className="text-amber-700">Awaiting deposit</span>
                  )}
                </p>
              </div>
            )}

            {invoice.status !== "void" && invoice.balanceDue > 0 && (
              <div className="card p-5">
                <p className="mb-3 text-sm font-semibold text-ink">Record a payment</p>
                <RecordPaymentForm
                  invoiceId={invoice.id}
                  balanceDue={invoice.balanceDue}
                  depositAmount={invoice.depositAmount}
                  amountPaid={invoice.amountPaid}
                  currency={cur}
                />
              </div>
            )}

            <div className="card p-5">
              <p className="mb-3 text-sm font-semibold text-ink">Receipts</p>
              {payments.length === 0 ? (
                <p className="text-sm text-muted">No payments recorded yet.</p>
              ) : (
                <ul className="space-y-3">
                  {payments.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-2 text-sm">
                      <div>
                        <Link href={`/d/${p.shareToken}`} target="_blank" className="font-medium text-ink hover:text-brand-700">
                          {p.number}
                        </Link>
                        <p className="text-xs text-muted">
                          {fmtDate(p.paidAt)} · {METHOD_LABELS[p.method] ?? p.method}
                          {p.reference ? ` · ${p.reference}` : ""} · <span className="capitalize">{p.kind}</span>
                        </p>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="tabular-nums font-medium text-ink">{formatMoney(p.amount, cur)}</span>
                        <form action={deletePaymentAction}>
                          <input type="hidden" name="id" value={p.id} />
                          <button className="text-xs text-muted hover:text-red-600">remove</button>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
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
      <dt className={accent ? "font-medium text-brand-700" : "text-muted"}>{label}</dt>
      <dd
        className={`tabular-nums ${strong ? "text-base font-bold text-ink" : accent ? "font-bold text-brand-700" : "text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}
