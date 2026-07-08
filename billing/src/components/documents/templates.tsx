/* eslint-disable @next/next/no-img-element */
import { formatMoney, formatQty, formatRate } from "@/server/money";
import { fmtDate } from "@/server/queries";
import type {
  Invoice,
  InvoiceLine,
  Client,
  Payment,
  OrgProfile,
  DeliveryNote,
} from "@/server/db/schema";

type Issuer = { name: string; profile: OrgProfile | null };

const METHOD_LABELS: Record<string, string> = {
  mpesa: "M-Pesa",
  cash: "Cash",
  bank: "Bank transfer",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};

function IssuerBlock({ issuer }: { issuer: Issuer }) {
  const p = issuer.profile;
  return (
    <div className="flex items-start gap-3">
      {p?.logoUrl ? (
        <img src={p.logoUrl} alt="" className="h-14 w-14 rounded object-contain" />
      ) : null}
      <div>
        <p className="text-lg font-bold text-ink">{p?.legalName || issuer.name}</p>
        {p?.addressLine1 && <p className="text-sm text-muted">{p.addressLine1}</p>}
        {p?.addressLine2 && <p className="text-sm text-muted">{p.addressLine2}</p>}
        <p className="text-sm text-muted">
          {[p?.city, p?.country].filter(Boolean).join(", ")}
        </p>
        {p?.phone && <p className="text-sm text-muted">{p.phone}</p>}
        {p?.email && <p className="text-sm text-muted">{p.email}</p>}
        {p?.kraPin && <p className="text-sm font-medium text-ink">KRA PIN: {p.kraPin}</p>}
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
    <div className="mx-auto max-w-[820px] bg-white p-8 text-ink shadow-sm print:max-w-none print:p-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <IssuerBlock issuer={issuer} />
        <div className="text-right">
          <h1 className="text-2xl font-extrabold uppercase tracking-wide text-brand-700">{title}</h1>
          <p className="mt-1 text-sm font-semibold text-ink">{number}</p>
          <dl className="mt-3 space-y-0.5 text-sm">
            {meta.map((m) => (
              <div key={m.label} className="flex justify-end gap-2">
                <dt className="text-muted">{m.label}:</dt>
                <dd className="min-w-[90px] text-ink">{m.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      {children}
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

export function InvoiceDocument({
  issuer,
  invoice,
  lines,
  client,
  payUrl,
}: {
  issuer: Issuer;
  invoice: Invoice;
  lines: InvoiceLine[];
  client: Client | null;
  payUrl?: string | null;
}) {
  const cur = invoice.currency;
  const isQuote = invoice.type === "quotation";
  const meta = [
    { label: "Issue date", value: fmtDate(invoice.issueDate) },
    ...(!isQuote ? [{ label: "Due date", value: fmtDate(invoice.dueDate) }] : []),
    { label: "Status", value: invoice.status },
  ];

  return (
    <DocumentShell
      issuer={issuer}
      title={isQuote ? "Quotation" : "Invoice"}
      number={invoice.number}
      meta={meta}
    >
      <div className="mt-6">
        <PartyBlock title={isQuote ? "Quotation for" : "Bill to"} client={client} />
      </div>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-line bg-canvas">
            <th className="px-3 py-2 text-left font-semibold">Description</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2 text-right font-semibold">Unit price</th>
            <th className="px-3 py-2 text-right font-semibold">VAT</th>
            <th className="px-3 py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b border-line">
              <td className="px-3 py-2">{l.description}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatQty(l.quantityMilli)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.unitPrice, cur)}</td>
              <td className="px-3 py-2 text-right text-muted">{formatRate(l.taxRateBps)}%</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.lineSubtotal, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-end">
        <dl className="w-full max-w-xs space-y-1 text-sm">
          <SummaryRow label="Subtotal" value={formatMoney(invoice.subtotal, cur)} />
          {invoice.discountAmount > 0 && (
            <SummaryRow label="Discount" value={`− ${formatMoney(invoice.discountAmount, cur)}`} />
          )}
          <SummaryRow label="VAT" value={formatMoney(invoice.taxTotal, cur)} />
          <div className="border-t border-line pt-1">
            <SummaryRow label="Total" value={formatMoney(invoice.total, cur)} strong />
          </div>
          {!isQuote && invoice.depositAmount > 0 && (
            <SummaryRow label="Deposit required" value={formatMoney(invoice.depositAmount, cur)} />
          )}
          {!isQuote && invoice.amountPaid > 0 && (
            <SummaryRow label="Amount paid" value={formatMoney(invoice.amountPaid, cur)} />
          )}
          {!isQuote && (
            <SummaryRow label="Balance due" value={formatMoney(invoice.balanceDue, cur)} accent />
          )}
        </dl>
      </div>

      {payUrl && (
        <div className="print-only" style={{ marginTop: "18px" }}>
          <a
            href={payUrl}
            style={{
              display: "inline-block",
              background: "#059669",
              color: "#ffffff",
              textDecoration: "none",
              fontWeight: 700,
              padding: "10px 18px",
              borderRadius: "8px",
            }}
          >
            Pay this invoice online →
          </a>
          <p className="text-xs text-muted" style={{ marginTop: "6px" }}>
            {payUrl}
          </p>
        </div>
      )}

      <DocFooter invoice={invoice} issuer={issuer} />
    </DocumentShell>
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
  priorPaid: number; // amount paid on the invoice before this payment
}) {
  const cur = invoice.currency;
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

      <div className="mt-6 rounded-lg border border-brand-200 bg-brand-50 px-5 py-4">
        <p className="text-sm text-brand-800">Amount received</p>
        <p className="text-3xl font-extrabold text-brand-800">{formatMoney(payment.amount, cur)}</p>
        <p className="mt-1 text-sm capitalize text-brand-700">
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

      <div className="mt-12 grid grid-cols-2 gap-8 text-sm">
        <div>
          <div className="border-t border-ink pt-1">Delivered by</div>
        </div>
        <div>
          <div className="border-t border-ink pt-1">
            Received by{note.receivedBy ? `: ${note.receivedBy}` : ""}
          </div>
        </div>
      </div>
    </DocumentShell>
  );
}

function DocFooter({ invoice, issuer }: { invoice: Invoice; issuer: Issuer }) {
  const bank = issuer.profile?.bankDetails;
  return (
    <div className="mt-8 space-y-3 border-t border-line pt-4 text-sm text-muted">
      {invoice.notes && <p>{invoice.notes}</p>}
      {bank && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Payment details</p>
          <p className="whitespace-pre-line">{bank}</p>
        </div>
      )}
      {invoice.terms && <p className="text-xs">{invoice.terms}</p>}
    </div>
  );
}

function SummaryRow({
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
      <dt className={accent ? "font-semibold text-brand-700" : "text-muted"}>{label}</dt>
      <dd
        className={`tabular-nums ${strong ? "text-base font-bold text-ink" : accent ? "font-bold text-brand-700" : "text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}
