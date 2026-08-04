import Link from "next/link";
import { requirePageCapability } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { kes, litres } from "@/lib/money";
import { formatDay } from "@/server/milk";
import { allocateMilk, listCustomers, recordDisposalAction } from "@/server/sales";
import { DisposalForm } from "@/components/sales/DisposalForm";
import { BackLink, Card, Chip, HardBlock, PageTitle, SoftWarning } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Where is today's milk going? Σ(session yields) = Σ(disposals), and the
 * variance is shown rather than hidden — the gap between the parlour and the can
 * is the classic milk-theft signal, and it is only fixable while it is fresh.
 */
export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const session = await requirePageCapability("VIEW_MONEY");
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today();

  const [allocation, customers] = await Promise.all([
    allocateMilk(session, date),
    listCustomers(session, date),
  ]);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-16">
      <BackLink to="/" />
      <PageTitle sub={formatDay(date)}>Where is today&apos;s milk going?</PageTitle>

      <nav className="mb-4 flex flex-wrap gap-3 text-sm" aria-label="Sales">
        <Link className="underline" href="/sales/round">Delivery round</Link>
        <Link className="underline" href="/sales/customers">Customers</Link>
        <Link className="underline" href="/sales/aging">Who owes us</Link>
        <Link className="underline" href="/sales/statement">Co-op statement</Link>
      </nav>

      <Card className="mb-4">
        <div className="flex flex-wrap items-baseline gap-4">
          <div>
            <p className="text-sm text-ink-2">Milked today</p>
            <p className="text-3xl font-semibold tabular-nums">{litres(allocation.production.totalL)}</p>
          </div>
          <div>
            <p className="text-sm text-ink-2">May be sold</p>
            <p className="text-xl font-semibold tabular-nums">{litres(allocation.maxSaleableL)}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-sm text-ink-2">Blended price</p>
            <p className="text-xl font-semibold tabular-nums">{kes(allocation.blendedKes, 2)} a litre</p>
          </div>
        </div>

        <p className="mt-3">
          {allocation.reconciliation.balanced ? (
            <Chip tone="ok">✓ {allocation.reconciliation.message}</Chip>
          ) : (
            <Chip tone="warn">⚠ {allocation.reconciliation.message}</Chip>
          )}
        </p>
      </Card>

      {allocation.production.withheldL > 0 ? (
        <div className="mb-4">
          <HardBlock
            message={`${allocation.production.withheldL} L must not be sold today — ${allocation.production.withheldAnimals
              .filter((a) => a.reason === "WITHDRAWAL")
              .map((a) => a.name)
              .join(", ")} ${
              allocation.production.withheldAnimals.filter((a) => a.reason === "WITHDRAWAL").length === 1
                ? "was"
                : "were"
            } treated.`}
          />
        </div>
      ) : null}

      {allocation.warnings.map((w) => (
        <div key={w} className="mb-2">
          <SoftWarning message={w} />
        </div>
      ))}

      <section className="mb-4">
        <h2 className="mb-2 text-lg font-semibold">Today so far</h2>
        {allocation.lines.length === 0 ? (
          <Card>
            <p className="text-ink-2">Nothing recorded yet. Start with the biggest drop.</p>
          </Card>
        ) : (
          <ul className="space-y-2">
            {allocation.lines.map((l) => (
              <li
                key={l.channel}
                className={`flex flex-wrap items-center gap-3 rounded-lg border bg-surface p-3 ${
                  l.loss ? "border-danger" : l.imputed ? "border-brass" : "border-line"
                }`}
              >
                <span aria-hidden className="text-xl">{l.icon}</span>
                <span className="font-medium">{l.label}</span>
                <span className="ml-auto tabular-nums">{litres(l.litres)}</span>
                <span className="w-28 text-right tabular-nums text-ink-2">
                  {l.valueKes > 0 ? kes(l.valueKes) : "—"}
                </span>
                {l.imputed ? <Chip tone="warn">no money</Chip> : null}
                {l.loss ? <Chip tone="danger">lost</Chip> : null}
              </li>
            ))}
          </ul>
        )}

        {allocation.unallocatedL !== 0 ? (
          <p className="mt-2 text-sm text-ink-2">
            {allocation.unallocatedL > 0
              ? `${litres(allocation.unallocatedL)} still to account for.`
              : `${litres(Math.abs(allocation.unallocatedL))} more recorded out than in.`}
          </p>
        ) : null}
      </section>

      <DisposalForm
        date={date}
        customers={customers.map((c) => ({ id: c.id, name: c.name, customerType: c.customerType }))}
        action={recordDisposalAction}
      />
    </main>
  );
}
