import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getInvoice, issueInvoiceNo, invoiceMessage, getBusiness } from "@/lib/credit";
import { getPrintSettings, receiptFromInvoice } from "@/lib/print-settings";
import { lineDiscountCents } from "@/lib/sales";
import { formatKes, formatAmount, formatQty, formatDateTime } from "@/lib/units";
import { ThermalPrint } from "@/components/thermal-print";
import { PdfShareButton } from "@/components/pdf-share-button";
import { PrintButton } from "./print-button";
import { PayInvoiceForm } from "./pay-form";

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
  searchParams: Promise<{ new?: string; paid?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  // `params` and `searchParams` are Promises in Next.js 16 — synchronous access
  // was removed.
  const { id } = await props.params;
  const { new: justSold, paid: justPaid } = await props.searchParams;
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

  const { sale, lines, tenders, balanceCents, subtotalCents, discountCents } = invoice;

  // Named once here rather than called four times inline: the same line feeds
  // the price column, the amount column and the totals, and they must agree.
  const discountOf = (l: (typeof lines)[number]) => lineDiscountCents(l);
  const business = getBusiness();

  // The thermal copy is built from the same snapshotted figures as the sheet
  // below, so the two can never disagree about what was charged.
  const printer = getPrintSettings();
  const receipt = receiptFromInvoice(invoice, printer);

  // Somebody reaching an unpaid bill from the Owing list has come to take money
  // off it. A receipt fresh from the till (`?new=1`) is the other errand
  // entirely — the customer is still standing there — so that one is left alone.
  const collecting = balanceCents > 0 && sale.status === "completed" && justSold !== "1";

  // Set by the redirect after a payment. Read defensively — it arrives in a URL,
  // and a URL is whatever somebody types into it.
  const paidCents = Math.max(0, Math.trunc(Number(justPaid ?? 0)) || 0);

  // Where "back" goes depends on where this bill came from. A wholesale bill is
  // reached from the wholesale section; everything else is a till sale, and the
  // till is where the person wants to be.
  const backHref = sale.tier === "wholesale" ? "/wholesale/invoices" : "/sell";
  const backLabel = sale.tier === "wholesale" ? "Invoices" : "Back to selling";

  return (
    <div>
      <style>{PRINT_CSS}</style>

      {/*
        The way out, at the top, on every invoice.

        This page is a dead end otherwise, and worse on a big screen than a
        small one: the bottom tab bar is `lg:hidden`, so on the shop's tablet or
        a laptop the only route back to the till is the hamburger. The invoice
        itself is a full A5 sheet, so anything placed under it is below the fold
        — which is exactly where somebody lands after printing.

        A till sale gets the counter's own words: the till is where they were,
        and "Next sale" is what they are about to do.
      */}
      <div className="no-print mb-2 flex items-center gap-3">
        <Link
          href={backHref}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-brand hover:underline xl:min-h-9"
        >
          <span aria-hidden>←</span> {backLabel}
        </Link>

        {justSold === "1" ? (
          <Link
            href="/sell"
            className="ml-auto flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-bold text-white shadow-sm hover:bg-brand-dark xl:min-h-10"
          >
            Next sale →
          </Link>
        ) : null}
      </div>

      {/* Rendered by the server, so it is still here after a payment that
          settled the bill and took the form away with it. */}
      {paidCents > 0 ? (
        <div className="no-print mx-auto mb-4 max-w-[148mm] rounded-2xl bg-good-soft px-4 py-3 text-sm font-bold text-good">
          {formatKes(paidCents)} received.{" "}
          {balanceCents > 0
            ? `${formatKes(balanceCents)} still due on this invoice.`
            : "This invoice is settled in full."}
        </div>
      ) : null}

      {collecting ? (
        <div className="no-print mx-auto mb-4 max-w-[148mm] rounded-2xl bg-white p-4 shadow-card ring-1 ring-ink/5">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-dark">
            Record a payment
          </div>
          <PayInvoiceForm
            saleId={sale.id}
            balanceCents={balanceCents}
            customerName={sale.customer_name ?? "this customer"}
          />
        </div>
      ) : null}

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
            {/*
              Two shapes of line, and the two middle columns say which.

              Sold whole: "3" at "250.00" each. Weighed: "400 g" at "133.00/kg".
              Putting a weighed line in the first shape reads as one of
              something at 53.20 — a quantity of one, and the price of the
              scoop where the price of a kilogram belongs. The customer checks
              these two numbers against what they were told at the counter.
            */}
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="row border-b border-line py-1.5 pr-2 align-top">
                  {l.name_snapshot}
                  {l.canonical_unit && !l.rate_cents ? (
                    <span className="block text-[10px] text-muted">
                      {formatQty(l.qty_milli, l.canonical_unit)}
                    </span>
                  ) : null}
                </td>
                <td className="row border-b border-line py-1.5 text-right align-top tnum">
                  {l.rate_cents && l.canonical_unit
                    ? formatQty(l.qty_milli, l.canonical_unit)
                    : l.units}
                </td>
                <td className="row border-b border-line py-1.5 text-right align-top tnum">
                  {/* The asking price when the line was discounted, with what
                      was charged beneath it. A document that showed only the
                      haggled figure would give the customer no way to see the
                      concession they negotiated. */}
                  {(() => {
                    const shown = discountOf(l) > 0 ? l.list_price_cents : l.rate_cents || l.unit_price_cents;
                    const per = l.rate_cents ? `/${l.canonical_unit}` : "";
                    return (
                      <>
                        {formatAmount(shown)}
                        {per}
                        {discountOf(l) > 0 ? (
                          <span className="block text-[10px] font-semibold text-good">
                            you pay {formatAmount(l.rate_cents || l.unit_price_cents)}
                            {per}
                          </span>
                        ) : null}
                      </>
                    );
                  })()}
                </td>
                <td className="row border-b border-line py-1.5 text-right align-top tnum font-semibold">
                  {formatAmount(l.line_total_cents + discountOf(l))}
                  {discountOf(l) > 0 ? (
                    <span className="block text-[10px] font-semibold text-good">
                      −{formatAmount(discountOf(l))}
                    </span>
                  ) : null}
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
          {/* Subtotal and discount only when there was one. On an ordinary sale
              the document shows a single Total and no arithmetic nobody asked
              for; when there was haggling, the three rows reconcile, so the
              customer can add the Amount column up and land on the Total. */}
          {discountCents > 0 ? (
            <>
              <div className="flex justify-between text-muted">
                <span>Subtotal</span>
                <span className="tnum">{formatKes(subtotalCents)}</span>
              </div>
              <div className="flex justify-between font-bold text-good">
                <span>Discount</span>
                <span className="tnum">−{formatKes(discountCents)}</span>
              </div>
            </>
          ) : null}
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

        {collecting ? (
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
            Or send it on
          </div>
        ) : null}

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
          “Print” makes the A5 paper copy. “Share on WhatsApp” sends the invoice
          itself — on a phone, straight into WhatsApp as a file, the same as sharing any document.{" "}
          <Link href="/settings/printer" className="font-semibold text-brand">
            Printer settings
          </Link>
        </p>

        {/*
          A big way out, right under the print button.

          Printing leaves you at the bottom of the page, so this is where the
          hand already is. It is not conditional on the sale being fresh: the
          same dead end catches somebody who opened an old receipt from the
          sales history to reprint it.
        */}
        <Link
          href={justSold === "1" ? "/sell" : backHref}
          className="flex min-h-12 w-full items-center justify-center rounded-full bg-brand text-sm font-bold text-white shadow-sm hover:bg-brand-dark"
        >
          {justSold === "1" ? "Next sale →" : `← ${backLabel}`}
        </Link>
      </div>

      {/* Where you came from, most likely. A wholesale bill is reached from the
          wholesale section and billing redirects straight here, so without this
          the only way back into that section is the main menu — which is now
          behind a hamburger, making it two taps to undo one. The wholesale link
          is already at the top of the page for those bills, so it is not
          repeated here. */}
      <div className="no-print mt-4 flex flex-wrap items-center gap-x-4 text-sm font-bold text-brand [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center sm:[&>a]:min-h-9">
        {sale.tier !== "wholesale" ? <Link href="/customers">All debtors</Link> : null}
        {sale.customer_id ? (
          <Link href={`/customers/${sale.customer_id}`}>
            {sale.customer_name} — full account
          </Link>
        ) : null}
      </div>
    </div>
  );
}
