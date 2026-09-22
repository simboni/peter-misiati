import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { currentUser, can } from "@/lib/auth";
import { getInvoice, getBusiness } from "@/lib/credit";
import { formatKes, formatAmount, formatQty, formatDateTime } from "@/lib/units";
import { Letterhead } from "@/components/letterhead";
import { PrintButton } from "../../invoice/[id]/print-button";

export const dynamic = "force-dynamic";

/*
  A5, the same as the invoice: it is the paper the shop's printer takes and the
  size of the duplicate book this replaces.
*/
const PRINT_CSS = `
@page { size: A5 portrait; margin: 10mm; }
.sheet { max-width: 148mm; }
@media print {
  html, body { background: #fff !important; }
  .sheet { max-width: none; border: 0 !important; padding: 0 !important; }
  .sheet .row { border-color: #999 !important; }
  .no-print { display: none !important; }
}
`;

/**
 * A delivery note for one sale — the paper that travels with the goods.
 *
 * It is not an invoice with the prices rubbed out. It answers a different
 * question: the invoice says what is owed, this says WHAT WAS HANDED OVER, and
 * it is the document the person receiving the goods signs. That signature is
 * the whole point of it — a customer in Narok who says two jerricans never
 * arrived is answered by a signed note and by nothing else.
 *
 * So: quantities, no money, and the receipt block at the foot. Money is one
 * click away for the deliveries that are paid for on the doorstep, because a
 * driver carrying goods to a cash customer needs both on one sheet — but it is
 * off by default, since a delivery note is about goods and a customer's own
 * staff should not need the shop's prices to count drums.
 *
 * Every figure is the snapshot on `sale_lines`, like the invoice: reprinting
 * last month's note must show last month's quantities and the name the product
 * was sold under, whatever has been renamed since.
 */
export default async function DeliveryNotePage(props: {
  // `params` and `searchParams` are Promises in Next.js 16.
  params: Promise<{ id: string }>;
  searchParams: Promise<{ prices?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { id } = await props.params;
  const { prices } = await props.searchParams;
  const saleId = Number(id);
  if (!Number.isInteger(saleId)) notFound();

  const invoice = getInvoice(saleId);
  if (!invoice) notFound();

  const { sale, lines } = invoice;
  const business = getBusiness();

  // Money on a delivery note is a deliberate act, and never the default.
  const showPrices = prices === "1";

  /*
    The recipe never travels with the goods.

    The ingredient lines of a mixed product are the formula; they are already
    kept off the receipt and off the invoice, and a note the customer's own
    staff will read is the last place they should appear.
  */
  const goods = lines.filter((l) => !l.is_component);

  const reference = sale.invoice_no ? `DN ${sale.invoice_no}` : `DN #${sale.id}`;

  return (
    <div>
      <style>{PRINT_CSS}</style>

      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/invoice/${sale.id}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-brand hover:underline xl:min-h-9"
        >
          <span aria-hidden>←</span> Back to the invoice
        </Link>
        <span className="flex-1" />
        <Link
          href={`/delivery/${sale.id}${showPrices ? "" : "?prices=1"}`}
          className="rounded-lg border border-line px-3 py-2 text-[12px] font-bold hover:bg-wash"
        >
          {showPrices ? "Hide the prices" : "Show the prices"}
        </Link>
        <PrintButton />
      </div>

      <div className="sheet mx-auto rounded-2xl border border-line bg-white p-5 text-ink">
        <Letterhead
          business={business}
          kind="Delivery note"
          reference={reference}
          date={formatDateTime(sale.at)}
        />

        {/* ------------------------------------------------------- who it is for */}
        <div className="mt-4 grid grid-cols-2 gap-4 text-[12px]">
          <div>
            <div className="text-[10px] uppercase tracking-[0.1em] text-muted">Deliver to</div>
            <div className="mt-0.5 font-bold">{sale.customer_name || "Walk-in customer"}</div>
            {sale.customer_phone ? <div>{sale.customer_phone}</div> : null}
            {/*
              A blank line, printed on purpose.

              The address is not in the system — the shop writes it on the note
              as the driver is leaving, exactly as it wrote it in the duplicate
              book. A ruled line is a better answer than a field nobody fills in
              on a phone at the counter.
            */}
            <div className="row mt-3 border-b border-line pb-4" />
            <div className="text-[10px] text-muted">Address / destination</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.1em] text-muted">Sale</div>
            <div className="mt-0.5 font-bold">{sale.invoice_no ?? `#${sale.id}`}</div>
            <div className="text-muted">Served by {sale.user_name ?? "the counter"}</div>
            {sale.status === "voided" ? (
              <div className="mt-1 font-bold text-bad">THIS SALE WAS VOIDED</div>
            ) : null}
            <div className="row mt-3 border-b border-line pb-4" />
            <div className="text-[10px] text-muted">Vehicle / driver</div>
          </div>
        </div>

        {/* ---------------------------------------------------------- the goods */}
        <table className="mt-4 w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.1em] text-muted">
              <th className="row border-b border-line pb-1 text-left font-bold">#</th>
              <th className="row border-b border-line pb-1 text-left font-bold">Item</th>
              <th className="row border-b border-line pb-1 text-right font-bold">Quantity</th>
              {showPrices ? (
                <th className="row border-b border-line pb-1 text-right font-bold">Amount</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {goods.map((l, i) => (
              <tr key={l.id}>
                <td className="row border-b border-line py-1.5 pr-2 align-top text-muted tnum">
                  {i + 1}
                </td>
                <td className="row border-b border-line py-1.5 pr-2 align-top">{l.name_snapshot}</td>
                <td className="row border-b border-line py-1.5 text-right align-top tnum">
                  {/*
                    What was physically handed over, in the words the yard uses:
                    a weighed line is a weight, a whole one is a count.
                  */}
                  {l.rate_cents && l.canonical_unit
                    ? formatQty(l.qty_milli, l.canonical_unit)
                    : `${l.units}${l.canonical_unit ? ` (${formatQty(l.qty_milli, l.canonical_unit)})` : ""}`}
                </td>
                {showPrices ? (
                  <td className="row border-b border-line py-1.5 text-right align-top tnum">
                    {formatAmount(l.line_total_cents)}
                  </td>
                ) : null}
              </tr>
            ))}
            {goods.length === 0 ? (
              <tr>
                <td className="py-3 text-center text-muted" colSpan={showPrices ? 4 : 3}>
                  No goods recorded on this sale.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {showPrices ? (
          <div className="mt-2 flex items-baseline justify-between gap-3 text-[12px]">
            <span className="font-bold">Total</span>
            <span className="font-extrabold tnum">{formatKes(sale.total_cents)}</span>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted">
            {goods.length} {goods.length === 1 ? "line" : "lines"} · this note is for the goods
            only. The invoice carries the money.
          </p>
        )}

        {/* ------------------------------------------------------ the signature */}
        <div className="mt-6 rounded-xl border border-line p-3">
          <p className="text-[12px] font-semibold">
            Received the above goods in good order and condition.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 text-[10px] uppercase tracking-[0.1em] text-muted">
            <div>
              <div className="row border-b border-line pb-5" />
              <div className="mt-1">Received by (name)</div>
            </div>
            <div>
              <div className="row border-b border-line pb-5" />
              <div className="mt-1">Signature</div>
            </div>
            <div>
              <div className="row border-b border-line pb-5" />
              <div className="mt-1">Date</div>
            </div>
            <div>
              <div className="row border-b border-line pb-5" />
              <div className="mt-1">Delivered by</div>
            </div>
          </div>
        </div>

        <p className="mt-3 text-[10px] text-muted">
          Goods remain the property of {business.name} until paid for in full. Any shortage or
          damage must be reported on the day of delivery.
        </p>
      </div>

      {can(user, "cost") ? null : (
        <p className="no-print mt-3 text-center text-[11px] text-muted">
          Prices on this note are the selling prices from the sale.
        </p>
      )}
    </div>
  );
}
