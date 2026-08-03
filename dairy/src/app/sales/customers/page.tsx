import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { kes } from "@/lib/money";
import { listCustomers, pendingPayments, CHANNEL_ICON } from "@/server/sales";
import { Card, Chip, EmptyState, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Who takes our milk, and what each of them owes. Worst first. */
export default async function CustomersPage() {
  const session = await verifySession();
  const asOf = today();
  const [customers, pending] = await Promise.all([
    listCustomers(session, asOf),
    pendingPayments(session),
  ]);

  const owed = customers.reduce((a, c) => a + Math.max(0, c.balance.balanceKes), 0);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-16">
      <PageTitle sub={`${customers.length} customers · ${kes(owed)} outstanding`}>Customers</PageTitle>

      <nav className="mb-4 flex flex-wrap gap-3 text-sm">
        <Link className="underline" href="/sales">Today&apos;s milk</Link>
        <Link className="underline" href="/sales/round">Delivery round</Link>
        <Link className="underline" href="/sales/aging">Who owes us</Link>
      </nav>

      {pending.length > 0 ? (
        <Card className="mb-4 border-brass">
          <p className="font-medium">
            {pending.length} payment{pending.length === 1 ? "" : "s"} waiting to be confirmed
          </p>
          <ul className="mt-1 text-sm text-ink-2">
            {pending.map((p) => (
              <li key={p.id}>
                <Link className="underline" href={`/sales/customers/${p.customerId}`}>
                  {p.customerName}
                </Link>{" "}
                — {kes(p.amountKes)}
                {p.recordedByName ? `, entered by ${p.recordedByName}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {customers.length === 0 ? (
        <EmptyState title="No customers yet" hint="Add the co-operative first — it takes the bulk of the milk." />
      ) : (
        <ul className="space-y-2">
          {customers.map((c) => (
            <li key={c.id}>
              <Link
                href={`/sales/customers/${c.id}`}
                className={`tap flex flex-wrap items-center gap-3 rounded-lg border bg-surface p-3 hover:border-brand ${
                  c.overLimit ? "border-danger" : "border-line"
                }`}
              >
                <span aria-hidden className="text-xl">{CHANNEL_ICON[c.customerType]}</span>
                <span className="text-lg font-semibold">{c.name}</span>
                {!c.active ? <Chip>paused</Chip> : null}
                {c.overLimit ? <Chip tone="danger">over limit</Chip> : null}
                {c.pendingPaymentsKes > 0 ? (
                  <Chip tone="warn">{kes(c.pendingPaymentsKes)} to confirm</Chip>
                ) : null}
                <span className="ml-auto text-right">
                  <span className="block text-lg font-semibold tabular-nums">
                    {kes(c.balance.balanceKes)}
                  </span>
                  <span className="block text-xs text-ink-3">
                    {c.balance.daysSincePayment === null
                      ? "never paid"
                      : `last paid ${c.balance.daysSincePayment} days ago`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
