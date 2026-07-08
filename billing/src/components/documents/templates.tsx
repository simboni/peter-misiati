/* eslint-disable @next/next/no-img-element */
import { formatMoney, formatQty } from "@/server/money";
import { fmtDate } from "@/server/queries";
import { isPro } from "@/lib/plan";
import { DEFAULT_ACCENT } from "@/lib/doc-style";
import type { Invoice, Client, Payment, OrgProfile, DeliveryNote } from "@/server/db/schema";

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
  return (
    <div className="flex items-start gap-3">
      {proOf(issuer) && p?.logoUrl ? (
        <img src={p.logoUrl} alt="" className="h-14 w-14 rounded object-contain" />
      ) : null}
      <div>
        <p className="text-lg font-bold text-ink">{p?.legalName || issuer.name}</p>
        {p?.addressLine1 && <p className="text-sm text-muted">{p.addressLine1}</p>}
        {p?.addressLine2 && <p className="text-sm text-muted">{p.addressLine2}</p>}
        <p className="text-sm text-muted">{[p?.city, p?.country].filter(Boolean).join(", ")}</p>
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
          <h1
            className="text-2xl font-extrabold uppercase tracking-wide"
            style={{ color: accentOf(issuer) }}
          >
            {title}
          </h1>
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
      {!proOf(issuer) && (
        <div className="mt-8 flex items-center justify-center gap-2 text-[11px] text-muted">
          <svg width="15" height="15" viewBox="0 0 64 64" fill="none" stroke="#0e9f6e" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="16" y1="20" x2="16" y2="44" />
            <line x1="26" y1="20" x2="26" y2="44" />
            <path d="M34 35 L42 44 L54 20" />
          </svg>
          <span>
            Powered by <b className="font-extrabold text-ink">Ta<span className="text-brand-600">ll</span>y</b> — free invoicing for Kenya
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
