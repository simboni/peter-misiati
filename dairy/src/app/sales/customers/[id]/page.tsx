import Link from "next/link";
import { requirePageCapability } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { kes } from "@/lib/money";
import { formatDay } from "@/server/milk";
import {
  approvePaymentAction,
  customerLedger,
  recordPaymentAction,
  CHANNEL_ICON,
} from "@/server/sales";
import { ApprovePaymentButton } from "@/components/sales/ApprovePaymentButton";
import { PaymentForm } from "@/components/sales/PaymentForm";
import { Card, Chip, EmptyState, PageTitle, SoftWarning } from "@/components/ui";

export const dynamic = "force-dynamic";

const ENTRY_LABEL: Record<string, string> = {
  DELIVERY: "Milk taken",
  PAYMENT: "Paid",
  ADJUSTMENT: "Adjustment",
  WRITE_OFF: "Written off",
  OPENING_BALANCE: "Opening balance",
};

/**
 * The running tab. Every delivery a debit, every payment a credit, with the
 * balance beside each line — the exercise book, except it can warn you.
 */
export default async function CustomerLedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requirePageCapability("VIEW_MONEY");
  const asOf = today();
  const view = await customerLedger(session, id, asOf);
  const c = view.customer;

  return (
    <main className="mx-auto max-w-3xl p-4 pb-16">
      <PageTitle
        sub={`${c.customerType.toLowerCase()} · ${c.paymentTerms.replace("_", " ").toLowerCase()}${
          c.phone ? ` · ${c.phone}` : ""
        }`}
      >
        <span aria-hidden className="mr-2">{CHANNEL_ICON[c.customerType]}</span>
        {c.name}
      </PageTitle>

      <p className="mb-4">
        <Link href="/sales/customers" className="text-sm underline">
          All customers
        </Link>
      </p>

      <Card className="mb-4">
        <div className="flex flex-wrap items-baseline gap-6">
          <div>
            <p className="text-sm text-ink-2">Owes us</p>
            <p className="text-3xl font-semibold tabular-nums">{kes(view.balance.balanceKes)}</p>
          </div>
          <div>
            <p className="text-sm text-ink-2">Last paid</p>
            <p className="text-lg font-semibold">
              {view.balance.lastPaidOn ? formatDay(view.balance.lastPaidOn) : "never"}
            </p>
          </div>
          {c.creditLimitKes ? (
            <div>
              <p className="text-sm text-ink-2">Limit</p>
              <p className="text-lg font-semibold tabular-nums">{kes(c.creditLimitKes)}</p>
            </div>
          ) : null}
          <div className="ml-auto flex flex-wrap gap-2">
            {view.aging.D90_PLUS > 0 ? <Chip tone="danger">{kes(view.aging.D90_PLUS)} over 90 days</Chip> : null}
            {view.aging.D60 > 0 ? <Chip tone="warn">{kes(view.aging.D60)} over 60 days</Chip> : null}
            {view.aging.D30 > 0 ? <Chip tone="warn">{kes(view.aging.D30)} over 30 days</Chip> : null}
            {view.aging.CURRENT > 0 ? <Chip>{kes(view.aging.CURRENT)} not yet due</Chip> : null}
          </div>
        </div>

        {view.creditCheck.message ? (
          <div className="mt-3">
            <SoftWarning message={view.creditCheck.message} />
          </div>
        ) : null}
        {view.pendingPaymentsKes > 0 ? (
          <div className="mt-3">
            <SoftWarning
              message={`${kes(view.pendingPaymentsKes)} has been recorded but not yet confirmed by a manager. It is not off the balance until it is.`}
            />
          </div>
        ) : null}
      </Card>

      <div className="mb-4">
        <PaymentForm customerId={c.id} customerName={c.name} date={asOf} action={recordPaymentAction} />
      </div>

      <h2 className="mb-2 text-lg font-semibold">The tab</h2>
      {view.entries.length === 0 ? (
        <EmptyState title="Nothing on the tab yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm print-sheet">
            <thead>
              <tr className="border-b border-line text-left text-ink-2">
                <th className="py-2">Date</th>
                <th>What</th>
                <th className="text-right">Took</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Balance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...view.entries].reverse().map((e) => (
                <tr key={e.id} className={`border-b border-line/60 ${e.pending ? "opacity-70" : ""}`}>
                  <td className="py-2 whitespace-nowrap">{formatDay(e.entryDate)}</td>
                  <td>
                    {ENTRY_LABEL[e.entryType] ?? e.entryType}
                    {e.litres ? ` · ${e.litres} L` : ""}
                    {e.mpesaRef ? ` · ${e.mpesaRef}` : ""}
                    {e.pending ? <span className="ml-2 text-xs text-brass">waiting to be confirmed</span> : null}
                  </td>
                  <td className="text-right tabular-nums">{e.debitKes ? kes(e.debitKes) : ""}</td>
                  <td className="text-right tabular-nums">{e.creditKes ? kes(e.creditKes) : ""}</td>
                  <td className="text-right tabular-nums">{e.pending ? "—" : kes(e.runningBalanceKes)}</td>
                  <td className="text-right">
                    {e.pending ? (
                      <ApprovePaymentButton entryId={e.id} action={approvePaymentAction} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
