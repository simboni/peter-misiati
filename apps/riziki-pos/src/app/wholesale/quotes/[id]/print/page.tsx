import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { getQuote, quoteLines } from "@/lib/quotes";
import { formatKes, formatDate } from "@/lib/units";
import { PrintButton } from "@/app/invoice/[id]/print-button";

export const dynamic = "force-dynamic";

/**
 * The quote on paper — or as a PDF, which on a phone is the same button.
 *
 * A4-shaped rather than 80mm: a quotation is filed, emailed and argued over,
 * which is a different object from the till receipt the thermal printer makes.
 * It deliberately reads like the invoice at /invoice/[id], because the customer
 * receives both and they should look like they came from the same shop.
 */
export default async function QuotePrintPage(props: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { id } = await props.params;
  const quote = getQuote(Number(id));
  if (!quote) notFound();
  const lines = quoteLines(quote.id);

  const setting = (key: string) =>
    get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, key)?.value ?? "";
  const shopName = setting("business.name") || "Riziki Industrial Chemicals";
  const shopPhone = setting("business.phone");
  const kraPin = setting("business.kra_pin");

  const customer = quote.customer_id
    ? get<{ name: string; phone: string; kra_pin: string }>(
        `SELECT name, phone, kra_pin FROM customers WHERE id = ?`,
        quote.customer_id,
      )
    : undefined;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-3 flex gap-2">
        <PrintButton />
        <a
          href={`/wholesale/quotes/${quote.id}`}
          className="flex min-h-11 items-center rounded-xl px-4 text-sm font-bold text-muted hover:bg-wash xl:min-h-10"
        >
          Back
        </a>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-card ring-1 ring-ink/5 print:rounded-none print:p-0 print:shadow-none print:ring-0">
        <div className="flex items-start justify-between gap-4 border-b-2 border-brand-deep pb-3">
          <div>
            <h1 className="text-xl font-extrabold text-brand-deep">{shopName}</h1>
            {shopPhone ? <p className="text-xs text-muted">{shopPhone}</p> : null}
            {kraPin ? <p className="text-xs text-muted">KRA PIN: {kraPin}</p> : null}
          </div>
          <div className="text-right">
            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
              Quotation
            </div>
            <div className="text-lg font-extrabold tnum">{quote.quote_no}</div>
            <div className="text-xs text-muted">{formatDate(quote.created_at)}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
              Quotation for
            </div>
            <div className="text-sm font-bold">{quote.customer_name || "—"}</div>
            {customer?.phone ? <div className="text-xs text-muted">{customer.phone}</div> : null}
            {customer?.kra_pin ? (
              <div className="text-xs text-muted">KRA PIN: {customer.kra_pin}</div>
            ) : null}
          </div>
          {quote.valid_until ? (
            <div className="sm:text-right">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                Price holds until
              </div>
              <div className="text-sm font-bold">{quote.valid_until}</div>
            </div>
          ) : null}
        </div>

        <table className="mt-5 w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[10px] uppercase tracking-[0.12em] text-muted">
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Units</th>
              <th className="py-2 text-right">Price</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-line">
                <td className="py-2 font-semibold">{l.item_name}</td>
                <td className="py-2 text-right tnum">{l.units}</td>
                <td className="py-2 text-right tnum">{formatKes(l.unit_price_cents)}</td>
                <td className="py-2 text-right font-bold tnum">
                  {formatKes(l.units * l.unit_price_cents)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-3 text-right text-sm font-bold">
                Total
              </td>
              <td className="pt-3 text-right text-lg font-extrabold text-brand-deep tnum">
                {formatKes(quote.total_cents)}
              </td>
            </tr>
          </tfoot>
        </table>

        {quote.note ? <p className="mt-4 text-sm text-muted">{quote.note}</p> : null}

        <p className="mt-6 border-t border-line pt-3 text-[11px] text-muted">
          This is a quotation, not an invoice — no goods are reserved and nothing is owed until it
          is accepted and invoiced.
        </p>
      </div>
    </div>
  );
}
