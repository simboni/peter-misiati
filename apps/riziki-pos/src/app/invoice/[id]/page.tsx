import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getInvoice, issueInvoiceNo, invoiceMessage, getBusiness } from "@/lib/credit";
import { getPrintSettings, receiptFromInvoice } from "@/lib/print-settings";
import { formatKes, formatAmount, formatQty, formatDateTime } from "@/lib/units";
import { ThermalPrint } from "@/components/thermal-print";
import { PdfShareButton } from "@/components/pdf-share-button";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  mpesa: "M-Pesa",
  credit: "On credit",
};

/*
  A5 is what the shop's little printer takes, and what fits a delivery book.
  Kept local to this route: no other screen prints, and globals.css belongs to
  another module.
*/
const PRINT_CSS = `
@page { size: A5 portrait; margin: 10mm; }
.sheet { max-width: 148mm; }
@media print {
  html, body { background: #fff !important; }
  .sheet { max-width: none; border: 0 !important; padding: 0 !important; }
  .sheet .row { border-color: #999 !important; }
}
`;

/**
 * A printable invoice / receipt for one sale.
 *
 * Every money figure comes from the snapshot columns on `sale_lines`, never
 * from `items` — reprinting January's invoice must show January's price even
 * after the drum price has moved twice since.
 */
export default async function InvoicePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  // `params` and `searchParams` are Promises in Next.js 16 — synchronous access
  // was removed.
  const { id } = await props.params;
  const { new: justSold } = await props.searchParams;
  const saleId = Number(id);
  if (!Number.isInteger(saleId)) notFound();

  let invoice = getInvoice(saleId);
  if (!invoice) notFound();

  // The number is allocated the first time an invoice is actually issued, so a
  // cash sale that is never printed does not burn one out of the sequence.
  // Idempotent, and inside a transaction, so a double render cannot double-issue.
  if (!invoice.sale.invoice_no && invoice.sale.status === "completed") {
    issueInvoiceNo(saleId, user.id);
    invoice = getInvoice(saleId)!;
  }

  const { sale, lines, tenders, balanceCents } = invoice;
  const business = getBusiness();

  // The thermal copy is built from the same snapshotted figures as the sheet
  // below, so the two can never disagree about what was charged.
  const printer = getPrintSettings();
  const receipt = receiptFromInvoice(invoice, printer);

  return (
    <div>
      <style>{PRINT_CSS}</style>

      <div className="sheet mx-auto rounded-2xl border border-line bg-white p-5 text-[13px] leading-relaxed">
        {/* ---------------------------------------------------------- header */}
        <div className="flex items-start justify-between gap-4 border-b border-line pb-3">
          <div>
            <div className="text-base font-extrabold tracking-tight">{business.name}</div>
            <div className="text-[11px] text-muted">{business.address}</div>
            {business.phone ? <div className="text-[11px] text-muted">{business.phone}</div> : null}
            {business.kraPin ? (
              <div className="text-[11px] text-muted">PIN {business.kraPin}</div>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
              {balanceCents > 0 ? "Invoice" : "Receipt"}
            </div>
            <div className="text-base font-extrabold tnum">{sale.invoice_no ?? `#${sale.id}`}</div>
            <div className="text-[11px] text-muted">{formatDateTime(sale.at)}</div>
          </div>
        </div>

        {sale.status === "voided" ? (
          <div className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-xs font-bold text-bad">
            VOIDED — this sale was cancelled and does not fall due.
          </div>
        ) : null}

        {/* ---------------------------------------------------------- buyer */}
        <div className="mt-3 grid grid-cols-2 gap-3 border-b border-line pb-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Billed to</div>
            <div className="font-bold">{sale.customer_name ?? "Walk-in customer"}</div>
            {sale.customer_phone ? <div className="text-[11px] text-muted">{sale.customer_phone}</div> : null}
            {/* eTIMS will require the buyer's PIN on every fiscalised invoice. */}
            {sale.customer_kra_pin ? (
              <div className="text-[11px] text-muted">PIN {sale.customer_kra_pin}</div>
            ) : null}
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Prices</div>
            <div className="font-bold capitalize">{sale.tier}</div>
            {sale.user_name ? <div className="text-[11px] text-muted">Served by {sale.user_name}</div> : null}
          </div>
        </div>

        {/* ---------------------------------------------------------- lines */}
        <table className="mt-3 w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.1em] text-muted">
              <th className="row border-b border-line pb-1 text-left font-bold">Item</th>
              <th className="row border-b border-line pb-1 text-right font-bold">Qty</th>
              <th className="row border-b border-line pb-1 text-right font-bold">Price</th>
              <th className="row border-b border-line pb-1 text-right font-bold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="row border-b border-line py-1.5 pr-2 align-top">
                  {l.name_snapshot}
                  {l.canonical_unit ? (
                    <span className="block text-[10px] text-muted">
                      {formatQty(l.qty_milli, l.canonical_unit)}
                    </span>
                  ) : null}
                </td>
                <td className="row border-b border-line py-1.5 text-right align-top tnum">{l.units}</td>
                <td className="row border-b border-line py-1.5 text-right align-top tnum">
                  {formatAmount(l.unit_price_cents)}
                </td>
                <td className="row border-b border-line py-1.5 text-right align-top tnum font-semibold">
                  {formatAmount(l.line_total_cents)}
                </td>
              </tr>
            ))}
            {lines.length === 0 ? (
              <tr>
                <td className="py-3 text-center text-muted" colSpan={4}>
                  No lines recorded on this sale.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {/* --------------------------------------------------------- totals */}
        <div className="mt-3 ml-auto w-full max-w-[62%] space-y-1">
          <div className="flex justify-between font-extrabold">
            <span>Total</span>
            <span className="tnum">{formatKes(sale.total_cents)}</span>
          </div>
          <div className="flex justify-between text-muted">
            <span>Paid</span>
            <span className="tnum">{formatKes(sale.paid_cents)}</span>
          </div>
          <div
            className={`flex justify-between border-t border-line pt-1 font-extrabold ${
              balanceCents > 0 ? "text-bad" : "text-good"
            }`}
          >
            <span>{balanceCents > 0 ? "Balance due" : "Settled"}</span>
            <span className="tnum">{formatKes(balanceCents)}</span>
          </div>
        </div>

        {/* -------------------------------------------------------- tenders */}
        <div className="mt-3 border-t border-line pt-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Payment</div>
          {tenders.length ? (
            <ul className="mt-1 space-y-0.5">
              {tenders.map((t) => (
                <li key={t.method} className="flex justify-between text-[12px]">
                  <span>
                    {METHOD_LABEL[t.method] ?? t.method}
                    {t.codes ? <span className="ml-1.5 text-[10px] text-muted">{t.codes}</span> : null}
                  </span>
                  <span className="tnum">{formatKes(t.amount_cents)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[12px] text-muted">Nothing paid yet — the full amount is on credit.</p>
          )}
          {balanceCents > 0 ? (
            <p className="mt-2 text-[11px] text-muted">
              Goods remain the property of {business.name} until paid in full.
            </p>
          ) : null}
        </div>

        {sale.note ? <p className="mt-2 text-[11px] text-muted">{sale.note}</p> : null}

        <p className="mt-4 border-t border-line pt-2 text-center text-[10px] text-muted">
          Asante sana for your business.
        </p>
      </div>

      {/* --------------------------------------------------------- actions */}
      <div className="no-print mt-4 space-y-2">
        {/*
          The till printer first: it is the copy the customer walks out with.
          Auto-print only fires when the sale has just been taken (`?new=1`) —
          opening an old invoice to check a figure must not burn a roll.
        */}
        <ThermalPrint
          receipt={receipt}
          paper={printer.paper}
          auto={printer.autoPrint && justSold === "1" && sale.status === "completed"}
        />

        <div className="flex gap-2">
          <PrintButton />
          <PdfShareButton
            source={{ href: `/invoice/${sale.id}/pdf` }}
            fileName={`${sale.invoice_no ?? `sale-${sale.id}`}.pdf`}
            shareTitle={sale.invoice_no ?? `Sale #${sale.id}`}
            shareText={invoiceMessage(invoice)}
            label="Share on WhatsApp"
            busyLabel="Preparing…"
          />
        </div>

        <p className="text-center text-[11px] text-muted">
          &ldquo;Print&rdquo; makes the A5 paper copy. &ldquo;Share on WhatsApp&rdquo; sends the invoice
          itself — on a phone, straight into WhatsApp as a file, the same as sharing any document.{" "}
          <Link href="/settings/printer" className="font-semibold text-brand">
            Printer settings
          </Link>
        </p>

        {/* Fresh from the counter: the way back to the queue is one big button. */}
        {justSold === "1" ? (
          <Link
            href="/sell"
            className="flex min-h-12 w-full items-center justify-center rounded-full bg-brand text-sm font-bold text-white shadow-sm hover:bg-brand-dark"
          >
            Next sale →
          </Link>
        ) : null}
      </div>

      <div className="no-print mt-4 flex gap-4 text-sm font-bold text-brand">
        {sale.customer_id ? <Link href={`/customers/${sale.customer_id}`}>← {sale.customer_name}</Link> : null}
        <Link href="/customers">All debtors</Link>
      </div>
    </div>
  );
}
