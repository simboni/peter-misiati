/* eslint-disable @next/next/no-img-element */
import { formatMoney, formatQty } from "@/server/money";
import { fmtDate } from "@/server/queries";
import { isPro } from "@/lib/plan";
import { DEFAULT_ACCENT } from "@/lib/doc-style";
import type { Invoice, Client, Payment, OrgProfile, DeliveryNote, CreditNote } from "@/server/db/schema";
import { DocSignature } from "./signature";

// The multi-layout invoice/quotation renderer lives in its own module.
export { InvoiceDocument } from "./invoice-templates";

type Issuer = { name: string; profile: OrgProfile | null };

// Custom accent & logo are Pro-only; the free plan uses the default Tally look.
const proOf = (issuer: Issuer) => isPro(issuer.profile?.plan);

const METHOD_LABELS: Record<string, string> = {
  mpesa: "M-Pesa",
  cash: "Cash",
  bank: "Bank transfer",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};

const accentOf = (issuer: Issuer) => (proOf(issuer) ? issuer.profile?.accentColor || DEFAULT_ACCENT : DEFAULT_ACCENT);

function IssuerBlock({ issuer }: { issuer: Issuer }) {
  const p = issuer.profile;
  const cityCountry = [p?.city, p?.country].filter(Boolean).join(", ");
  return (
    <div className="min-w-0">
      {proOf(issuer) && p?.logoUrl ? (
        <img src={p.logoUrl} alt="" className="mb-3 block h-11 w-auto max-w-[220px] object-contain sm:h-14" />
      ) : null}
      <p className="text-base font-bold leading-tight text-ink sm:text-lg">{p?.legalName || issuer.name}</p>
      <div className="mt-1 space-y-0.5 text-sm text-muted">
        {p?.addressLine1 && <p className="break-words">{p.addressLine1}</p>}
        {p?.addressLine2 && <p className="break-words">{p.addressLine2}</p>}
        {cityCountry && <p>{cityCountry}</p>}
        {p?.phone && <p>{p.phone}</p>}
        {p?.email && <p className="break-all">{p.email}</p>}
        {p?.kraPin && <p className="font-medium text-ink">KRA PIN: {p.kraPin}</p>}
      </div>
    </div>
  );
}

function DocumentShell({
  issuer,
  title,
  number,
  meta,
  children,
}: {
  issuer: Issuer;
  title: string;
  number: string;
  meta: { label: string; value: string }[];
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[820px] bg-white p-5 text-ink shadow-sm sm:p-8 print:max-w-none print:p-0 print:shadow-none">
      <div className="flex flex-col gap-6 border-b border-line pb-6 sm:flex-row sm:items-start sm:justify-between">
        <IssuerBlock issuer={issuer} />
        <div className="sm:shrink-0 sm:text-right">
          <h1
            className="text-2xl font-extrabold uppercase tracking-wide sm:text-[26px]"
            style={{ color: accentOf(issuer) }}
          >
            {title}
          </h1>
          <p className="mt-1 text-sm font-semibold text-ink">{number}</p>
          <dl className="mt-3 space-y-1 text-sm">
            {meta.map((m) => (
              <div key={m.label} className="flex gap-2 sm:justify-end">
                <dt className="text-muted">{m.label}:</dt>
                <dd className="font-medium text-ink">{m.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      {children}
      <DocSignature profile={issuer.profile} />
      {!proOf(issuer) && (
        <div className="mt-8 flex items-center justify-center gap-2 text-[11px] text-muted">
          <svg width="16" height="16" viewBox="0 0 64 64" aria-hidden>
            <rect width="64" height="64" rx="17" fill="#059669" />
            <g fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="20" y1="22" x2="20" y2="42" />
              <line x1="29" y1="22" x2="29" y2="42" />
              <path d="M36 34 L43 42 L52 22" />
            </g>
          </svg>
          <span>
            Powered by <b className="font-extrabold text-ink">Tally<span className="text-brand-600">Pay</span></b> — free invoicing for Kenya
          </span>
        </div>
      )}
    </div>
  );
}

function PartyBlock({ title, client }: { title: string; client: Client | null }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <p className="mt-1 font-semibold text-ink">{client?.name ?? "—"}</p>
      {client?.addressLine1 && <p className="text-sm text-muted">{client.addressLine1}</p>}
      {client?.city && <p className="text-sm text-muted">{client.city}</p>}
      {client?.email && <p className="text-sm text-muted">{client.email}</p>}
      {client?.phone && <p className="text-sm text-muted">{client.phone}</p>}
      {client?.kraPin && <p className="text-sm text-ink">KRA PIN: {client.kraPin}</p>}
    </div>
  );
}

export function ReceiptDocument({
  issuer,
  payment,
  invoice,
  client,
  priorPaid,
}: {
  issuer: Issuer;
  payment: Payment;
  invoice: Invoice;
  client: Client | null;
  priorPaid: number;
}) {
  const cur = invoice.currency;
  const accent = accentOf(issuer);
  const balanceAfter = invoice.total - (priorPaid + payment.amount);
  return (
    <DocumentShell
      issuer={issuer}
      title="Receipt"
      number={payment.number}
      meta={[
        { label: "Date", value: fmtDate(payment.paidAt) },
        { label: "Method", value: METHOD_LABELS[payment.method] ?? payment.method },
        ...(payment.reference ? [{ label: "Ref", value: payment.reference }] : []),
      ]}
    >
      <div className="mt-6">
        <PartyBlock title="Received from" client={client} />
      </div>

      <div
        className="mt-6 rounded-lg border px-5 py-4"
        style={{ background: accent + "12", borderColor: accent + "55" }}
      >
        <p className="text-sm" style={{ color: accent }}>
          Amount received
        </p>
        <p className="text-3xl font-extrabold" style={{ color: accent }}>
          {formatMoney(payment.amount, cur)}
        </p>
        <p className="mt-1 text-sm capitalize" style={{ color: accent }}>
          {payment.kind} payment for invoice {invoice.number}
        </p>
      </div>

      <table className="mt-6 w-full border-collapse text-sm">
        <tbody>
          <tr className="border-b border-line">
            <td className="px-3 py-2 text-muted">Invoice total</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatMoney(invoice.total, cur)}</td>
          </tr>
          <tr className="border-b border-line">
            <td className="px-3 py-2 text-muted">Previously paid</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatMoney(priorPaid, cur)}</td>
          </tr>
          <tr className="border-b border-line">
            <td className="px-3 py-2 text-muted">This payment</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatMoney(payment.amount, cur)}</td>
          </tr>
          <tr className="border-b border-line font-semibold">
            <td className="px-3 py-2">Balance remaining</td>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatMoney(Math.max(balanceAfter, 0), cur)}
            </td>
          </tr>
        </tbody>
      </table>

      {payment.note && <p className="mt-4 text-sm text-muted">{payment.note}</p>}
      <p className="mt-10 text-xs text-muted">This is a computer-generated receipt.</p>
    </DocumentShell>
  );
}

const REFUND_LABELS = METHOD_LABELS;

type StatementEntryVM = {
  date: Date;
  doc: string;
  kind: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
};

export function StatementDocument({
  issuer,
  client,
  entries,
  totalDebit,
  totalCredit,
  closingBalance,
  currency,
  asOf,
}: {
  issuer: Issuer;
  client: Client | null;
  entries: StatementEntryVM[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  currency: string;
  asOf: Date;
}) {
  const accent = accentOf(issuer);
  return (
    <DocumentShell
      issuer={issuer}
      title="Statement"
      number={client?.name ?? ""}
      meta={[{ label: "As of", value: fmtDate(asOf) }]}
    >
      <div className="mt-6">
        <PartyBlock title="Statement for" client={client} />
      </div>

      <div className="mt-6 rounded-lg border px-5 py-4" style={{ background: accent + "12", borderColor: accent + "55" }}>
        <p className="text-sm" style={{ color: accent }}>Balance due</p>
        <p className="text-3xl font-extrabold" style={{ color: accent }}>{formatMoney(Math.max(closingBalance, 0), currency)}</p>
      </div>

      <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-y border-line bg-canvas">
            <th className="px-3 py-2 text-left font-semibold">Date</th>
            <th className="px-3 py-2 text-left font-semibold">Document</th>
            <th className="px-3 py-2 text-left font-semibold">Details</th>
            <th className="px-3 py-2 text-right font-semibold">Charge</th>
            <th className="px-3 py-2 text-right font-semibold">Paid / credit</th>
            <th className="px-3 py-2 text-right font-semibold">Balance</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr><td className="px-3 py-4 text-center text-muted" colSpan={6}>No activity yet.</td></tr>
          ) : (
            entries.map((e, i) => (
              <tr key={i} className="border-b border-line">
                <td className="whitespace-nowrap px-3 py-2 text-muted">{fmtDate(e.date)}</td>
                <td className="px-3 py-2">{e.doc}</td>
                <td className="px-3 py-2 text-muted">{e.description}</td>
                <td className="px-3 py-2 text-right tabular-nums">{e.debit ? formatMoney(e.debit, currency) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{e.credit ? formatMoney(e.credit, currency) : "—"}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(e.balance, currency)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line font-bold">
            <td className="px-3 py-2" colSpan={3}>Totals</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totalDebit, currency)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totalCredit, currency)}</td>
            <td className="px-3 py-2 text-right tabular-nums" style={{ color: accent }}>{formatMoney(Math.max(closingBalance, 0), currency)}</td>
          </tr>
        </tfoot>
      </table>
      </div>
    </DocumentShell>
  );
}

export function CreditNoteDocument({
  issuer,
  creditNote,
  lines,
  client,
  invoiceNumber,
}: {
  issuer: Issuer;
  creditNote: CreditNote;
  lines: { id: string; title: string | null; description: string; quantityMilli: number; unitPrice: number; taxRateBps: number; lineSubtotal: number; taxAmount: number }[];
  client: Client | null;
  invoiceNumber?: string | null;
}) {
  const cur = creditNote.currency;
  const accent = accentOf(issuer);
  return (
    <DocumentShell
      issuer={issuer}
      title="Credit Note"
      number={creditNote.number}
      meta={[
        { label: "Date", value: fmtDate(creditNote.issueDate) },
        ...(invoiceNumber ? [{ label: "Against", value: invoiceNumber }] : []),
      ]}
    >
      <div className="mt-6">
        <PartyBlock title="Credit to" client={client} />
      </div>

      {creditNote.reason && (
        <p className="mt-6 text-sm text-ink">
          <span className="font-semibold">Reason:</span> {creditNote.reason}
        </p>
      )}

      <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[460px] border-collapse text-sm">
        <thead>
          <tr className="border-y border-line bg-canvas">
            <th className="px-3 py-2 text-left font-semibold">Description</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2 text-right font-semibold">Rate</th>
            <th className="px-3 py-2 text-right font-semibold">VAT</th>
            <th className="px-3 py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b border-line align-top">
              <td className="px-3 py-2">
                <div className="font-medium text-ink">{l.title || l.description}</div>
                {l.title && l.description && <div className="whitespace-pre-line text-xs text-muted">{l.description}</div>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatQty(l.quantityMilli)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.unitPrice, cur)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{(l.taxRateBps / 100).toFixed(0)}%</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.lineSubtotal, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <div className="mt-4 flex justify-end">
        <table className="w-full max-w-xs text-sm">
          <tbody>
            <tr>
              <td className="px-3 py-1.5 text-muted">Subtotal</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(creditNote.subtotal, cur)}</td>
            </tr>
            <tr>
              <td className="px-3 py-1.5 text-muted">VAT</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(creditNote.taxTotal, cur)}</td>
            </tr>
            <tr className="border-t border-line font-bold" style={{ color: accent }}>
              <td className="px-3 py-2">Total credit</td>
              <td className="px-3 py-2 text-right tabular-nums">− {formatMoney(creditNote.total, cur)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {creditNote.refunded && (
        <p className="mt-4 text-sm text-ink">
          Refund of {formatMoney(creditNote.total, cur)} paid by{" "}
          {REFUND_LABELS[creditNote.refundMethod ?? "other"] ?? creditNote.refundMethod}
          {creditNote.refundReference ? ` (ref ${creditNote.refundReference})` : ""}.
        </p>
      )}
      {creditNote.appliedToInvoice && invoiceNumber && (
        <p className="mt-2 text-sm text-muted">Applied to invoice {invoiceNumber} — reduces the balance owed.</p>
      )}
      {creditNote.notes && <p className="mt-4 text-sm text-muted">{creditNote.notes}</p>}
      <p className="mt-10 text-xs text-muted">This is a computer-generated credit note.</p>
    </DocumentShell>
  );
}

export function DeliveryNoteDocument({
  issuer,
  note,
  lines,
  client,
  invoiceNumber,
}: {
  issuer: Issuer;
  note: DeliveryNote;
  lines: { id: string; description: string; quantityMilli: number; unit: string }[];
  client: Client | null;
  invoiceNumber?: string | null;
}) {
  return (
    <DocumentShell
      issuer={issuer}
      title="Delivery Note"
      number={note.number}
      meta={[
        { label: "Date", value: fmtDate(note.deliveryDate) },
        ...(invoiceNumber ? [{ label: "Invoice", value: invoiceNumber }] : []),
        { label: "Status", value: note.status },
      ]}
    >
      <div className="mt-6">
        <PartyBlock title="Deliver to" client={client} />
      </div>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-line bg-canvas">
            <th className="px-3 py-2 text-left font-semibold">Description</th>
            <th className="px-3 py-2 text-right font-semibold">Quantity</th>
            <th className="px-3 py-2 text-left font-semibold">Unit</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b border-line">
              <td className="px-3 py-2">{l.description}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatQty(l.quantityMilli)}</td>
              <td className="px-3 py-2">{l.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {note.notes && <p className="mt-4 text-sm text-muted">{note.notes}</p>}

      <div className="mt-14 grid grid-cols-1 gap-10 text-sm sm:grid-cols-2 sm:gap-8">
        <div>
          <div className="h-14" aria-hidden />
          <div className="border-t border-ink pt-1 font-semibold text-ink">Delivered by</div>
          <div className="mt-1 text-xs text-muted">Name &amp; signature</div>
          <div className="mt-4 flex items-end gap-2 text-xs text-muted">
            <span>Date:</span>
            <span className="min-w-[120px] flex-1 border-b border-ink" />
          </div>
        </div>
        <div>
          <div className="h-14" aria-hidden />
          <div className="border-t border-ink pt-1 font-semibold text-ink">
            Received by{note.receivedBy ? `: ${note.receivedBy}` : ""}
          </div>
          <div className="mt-1 text-xs text-muted">Name &amp; signature</div>
          <div className="mt-4 flex items-end gap-2 text-xs text-muted">
            <span>Date:</span>
            <span className="min-w-[120px] flex-1 border-b border-ink" />
          </div>
        </div>
      </div>
    </DocumentShell>
  );
}
