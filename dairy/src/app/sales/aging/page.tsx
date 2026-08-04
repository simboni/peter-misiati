import Link from "next/link";
import { requirePageCapability } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { kes } from "@/lib/money";
import { channelMix, debtorAging } from "@/server/sales";
import { addDays } from "@/lib/domain/dates";
import { Card, Chip, EmptyState, PageTitle, SoftWarning } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Who owes us, how old it is, and what the channel mix is really earning.
 *
 * An institutional delivery is a receivable, not revenue. Public-sector payment
 * in Kenya runs 30–90 days and "in many cases significantly longer", so the
 * buckets are the difference between a cash position and a hope.
 */
export default async function AgingPage() {
  const session = await requirePageCapability("VIEW_MONEY");
  const asOf = today();
  const [aging, mix] = await Promise.all([
    debtorAging(session, asOf),
    channelMix(session, addDays(asOf, -30), asOf),
  ]);

  const buckets: Array<{ key: "CURRENT" | "D30" | "D60" | "D90_PLUS"; label: string; tone: "ok" | "warn" | "danger" }> = [
    { key: "CURRENT", label: "Not yet due", tone: "ok" },
    { key: "D30", label: "Up to 30 days late", tone: "warn" },
    { key: "D60", label: "31–60 days late", tone: "warn" },
    { key: "D90_PLUS", label: "Over 60 days late", tone: "danger" },
  ];

  return (
    <main className="mx-auto max-w-3xl p-4 pb-16">
      <PageTitle sub={`As at ${asOf}`}>Who owes us</PageTitle>

      <nav className="mb-4 flex flex-wrap gap-3 text-sm">
        <Link className="underline" href="/sales">Today&apos;s milk</Link>
        <Link className="underline" href="/sales/customers">Customers</Link>
        <Link className="underline" href="/sales/statement">Co-op statement</Link>
      </nav>

      <Card className="mb-4">
        <p className="text-sm text-ink-2">Outstanding</p>
        <p className="text-3xl font-semibold tabular-nums">{kes(aging.total.totalKes)}</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {buckets.map((b) => (
            <div key={b.key} className="rounded-md border border-line p-2">
              <dt className="text-xs text-ink-2">{b.label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{kes(aging.total[b.key])}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="mb-4">
        <p className="text-sm text-ink-2">Last 30 days</p>
        <p className="text-2xl font-semibold tabular-nums">{kes(mix.blendedKes, 2)} a litre blended</p>
        <p className="mt-1 text-sm text-ink-2">{mix.message}</p>
        {mix.lossL > 0 ? (
          <p className="mt-1 text-sm text-ink-3">
            {mix.lossL} L lost ({mix.lossPct}% of what left the parlour) · {kes(mix.imputedValueKes)} given away.
          </p>
        ) : null}
      </Card>

      {aging.debtors.length === 0 ? (
        <EmptyState title="Nobody owes us anything" hint="Every delivery has been settled." />
      ) : (
        <ul className="space-y-2">
          {aging.debtors.map((d) => (
            <li key={d.customerId}>
              <Link
                href={`/sales/customers/${d.customerId}`}
                className={`tap block rounded-lg border bg-surface p-3 hover:border-brand ${
                  d.aging.D90_PLUS > 0 ? "border-danger" : d.aging.D60 > 0 ? "border-brass" : "border-line"
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-lg font-semibold">{d.name}</span>
                  {d.overLimit ? <Chip tone="danger">over limit</Chip> : null}
                  {d.oldestDays > 0 ? <Chip tone="warn">{d.oldestDays} days late</Chip> : null}
                  <span className="ml-auto text-lg font-semibold tabular-nums">{kes(d.balanceKes)}</span>
                </div>
                {d.interestNote ? (
                  <p className="mt-1 text-xs text-ink-3">{d.interestNote}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {aging.worst.length > 0 ? (
        <div className="mt-4">
          <SoftWarning
            message={`${aging.worst.map((w) => w.name).join(", ")} ${
              aging.worst.length === 1 ? "is" : "are"
            } more than 30 days past due. Under LN 20/2021 late payment carries interest at the CBK base rate (${aging.cbkBaseRatePct}%) — it is computable, and almost nobody claims it.`}
          />
        </div>
      ) : null}
    </main>
  );
}
