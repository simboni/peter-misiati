import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getCustomer, balanceOf, statement, getBusiness } from "@/lib/credit";
import { formatAmount, formatKes, formatDate } from "@/lib/units";
import { Empty } from "@/components/ui";
import { PrintButton } from "@/app/invoice/[id]/print-button";

export const dynamic = "force-dynamic";

/* Same paper as the invoice: A5, fits the shop's printer and a delivery book. */
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
 * A printable statement of account for one customer.
 *
 * The debtors book answers the owner's question ("who owes me?"); this answers
 * the customer's ("how did you get that figure?"). Every completed sale and
 * every shilling received, in order, ending on the balance being chased —
 * the document a wholesale buyer's bookkeeper actually reconciles against.
 */
export default async function StatementPage(props: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { id } = await props.params;
  const customerId = Number(id);
  if (!Number.isInteger(customerId)) notFound();

  const customer = getCustomer(customerId);
  if (!customer) notFound();

  const rows = statement(customerId);
  const balance = balanceOf(customerId);
  const business = getBusiness();

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="no-print mb-3 flex items-center justify-between gap-2">
        <Link href={`/customers/${customerId}`} className="text-sm font-bold text-brand">
          ← {customer.name}
        </Link>
        <PrintButton />
      </div>

      <div className="sheet mx-auto rounded-2xl border border-line bg-white p-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">{business.name}</h1>
            {business.address ? <p className="text-xs text-muted">{business.address}</p> : null}
            <p className="text-xs text-muted">{business.phone}</p>
            {business.kraPin ? <p className="text-xs text-muted">KRA PIN {business.kraPin}</p> : null}
          </div>
          <div className="text-right">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
              Statement of account
            </div>
            <div className="mt-0.5 text-xs text-muted">as at {formatDate(new Date().toISOString())}</div>
          </div>
        </header>

        <div className="row mt-4 border-t border-line pt-3">
          <div className="text-sm font-bold">{customer.name}</div>
          <div className="text-xs text-muted">
            {customer.phone || ""}
            {customer.kra_pin ? ` · KRA PIN ${customer.kra_pin}` : ""}
          </div>
        </div>

        {rows.length ? (
          <table className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                <th className="row border-b border-line py-1.5 text-left">Date</th>
                <th className="row border-b border-line py-1.5 text-left">Detail</th>
                <th className="row border-b border-line py-1.5 text-right">Goods</th>
                <th className="row border-b border-line py-1.5 text-right">Paid</th>
                <th className="row border-b border-line py-1.5 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="row border-t border-line py-1.5 pr-2 whitespace-nowrap">
                    {formatDate(r.at)}
                  </td>
                  <td className="row border-t border-line py-1.5 pr-2">{r.ref}</td>
                  <td className="row border-t border-line py-1.5 text-right tnum">
                    {r.debit_cents ? formatAmount(r.debit_cents) : ""}
                  </td>
                  <td className="row border-t border-line py-1.5 text-right tnum">
                    {r.credit_cents ? formatAmount(r.credit_cents) : ""}
                  </td>
                  <td className="row border-t border-line py-1.5 text-right tnum">
                    {formatAmount(r.balance_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="row border-t-2 border-ink py-2 text-right font-bold">
                  Balance due
                </td>
                <td className="row border-t-2 border-ink py-2 text-right text-base font-extrabold tnum">
                  {formatKes(balance)}
                </td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <Empty>No completed sales on this account yet.</Empty>
        )}

        <p className="mt-5 text-[11px] text-muted">
          All figures in Kenya Shillings. Amounts under &ldquo;Paid&rdquo; are money received
          (cash or M-Pesa); the balance is what remains owing. Queries: {business.phone}.
        </p>
      </div>
    </div>
  );
}
