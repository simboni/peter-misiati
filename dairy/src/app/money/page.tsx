import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { today, startOfMonth } from "@/lib/domain/dates";
import { kes, litres } from "@/lib/money";
import { approvalQueue, costOfProduction, monthToDate } from "@/server/money";
import { BackLink, Card, Chip, EmptyState, Num, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The money screen. It opens with a sentence, not a table — every number is
 * paired with what to do about it.
 */
export default async function MoneyPage() {
  const session = await verifySession();
  const to = today();
  const from = startOfMonth(to);

  const [mtd, cop, queue] = await Promise.all([
    monthToDate(session, to),
    costOfProduction(session, from, to),
    approvalQueue(session).catch(() => []),
  ]);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <BackLink to="/" label="Home" />
      <PageTitle sub={`${from} to ${to}`}>Money this month</PageTitle>

      <Card className="mb-4">
        <p className="text-base">{mtd.headline}</p>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div>
            <dt className="text-xs text-ink-3">In</dt>
            <dd className="text-lg font-semibold text-ok">
              <Num>{kes(mtd.incomeKes)}</Num>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Out</dt>
            <dd className="text-lg font-semibold text-danger">
              <Num>{kes(mtd.expenseKes)}</Num>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Left</dt>
            <dd className="text-lg font-semibold">
              <Num>{kes(mtd.netKes)}</Num>
            </dd>
          </div>
        </dl>
      </Card>

      {mtd.pendingCount > 0 ? (
        <Link href="/money/approve" className="tap mb-4 block">
          <div className="rounded-md border-l-4 border-brass bg-brass-soft px-3 py-3 text-sm">
            <span aria-hidden className="mr-2">
              ⚠
            </span>
            {mtd.pendingCount} {mtd.pendingCount === 1 ? "entry is" : "entries are"} waiting for you to
            approve — {kes(mtd.pendingKes)}. Nothing above counts them.
          </div>
        </Link>
      ) : null}

      {/* Cost per litre, BOTH variants, always labelled. */}
      <Card className="mb-4">
        <h2 className="text-lg font-semibold">Cost per litre</h2>
        <p className="mt-1 text-sm text-ink-2">{cop.verdict}</p>

        <div className="mt-4 space-y-3">
          <CostBar
            label="Cash — what left your pocket"
            perLitre={cop.cash.perLitreKes}
            total={cop.cash.totalKes}
            benchmark={cop.benchmark}
          />
          <CostBar
            label="Full economic — including your own fodder, your own labour and wear on the shed"
            perLitre={cop.full.perLitreKes}
            total={cop.full.totalKes}
            benchmark={cop.benchmark}
          />
        </div>

        <p className="mt-3 text-xs text-ink-3">
          Divided by <Num>{litres(cop.litresProduced)}</Num> produced — not litres sold. Milk drunk at
          home, fed to calves or spilled cost exactly as much to make. Kenya Dairy Board benchmark:
          KES {cop.benchmark.lowKes}–{cop.benchmark.highKes} a litre.
        </p>
      </Card>

      {cop.byCategory.length > 0 ? (
        <Card className="mb-4">
          <h2 className="text-lg font-semibold">Where the money went</h2>
          <ul className="mt-3 space-y-2">
            {cop.byCategory.map((c) => (
              <li key={c.category} className="flex items-baseline justify-between gap-3 text-sm">
                <span>{c.label}</span>
                <span className="tabular-nums">
                  {kes(c.amountKes)} <span className="text-ink-3">({c.pctOfCash}%)</span>
                </span>
              </li>
            ))}
          </ul>
          {cop.feedSharePct > 0 ? (
            <p className="mt-3 text-xs text-ink-3">
              Feed is {cop.feedSharePct}% of your full cost. On a working Kenyan dairy it usually runs
              55–65%.
            </p>
          ) : null}
        </Card>
      ) : (
        <EmptyState
          title="Nothing approved yet this month"
          hint="Record an expense or a payment in, then approve it, and the figures above start moving."
        />
      )}

      <nav className="mt-6 grid grid-cols-2 gap-3" aria-label="Money">
        <Tile href="/money/expense" icon="↗" label="Money out" detail="Record an expense" />
        <Tile href="/money/income" icon="↘" label="Money in" detail="Record a payment" />
        <Tile
          href="/money/approve"
          icon="✓"
          label="Approve"
          detail={queue.length > 0 ? `${queue.length} waiting` : "Nothing waiting"}
        />
        <Tile href="/money/reconcile" icon="⇄" label="M-Pesa" detail="Match the statement" />
        <Tile href="/money/suppliers" icon="🏪" label="Suppliers" detail="Who you buy from" />
        <Tile href="/trading" icon="🐄" label="Buying & selling" detail="Animals and the cull list" />
      </nav>
    </main>
  );
}

function CostBar({
  label,
  perLitre,
  total,
  benchmark,
}: {
  label: string;
  perLitre: number;
  total: number;
  benchmark: { lowKes: number; highKes: number };
}) {
  const tone =
    perLitre === 0 ? "neutral" : perLitre > benchmark.highKes ? "warn" : ("ok" as const);
  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Chip tone={tone === "warn" ? "warn" : tone === "ok" ? "ok" : "neutral"}>
          {perLitre > 0 ? `${kes(perLitre, 2)} / L` : "no milk yet"}
        </Chip>
      </div>
      <p className="mt-1 text-xs text-ink-3">
        <Num>{kes(total)}</Num> in total
      </p>
    </div>
  );
}

function Tile({
  href,
  icon,
  label,
  detail,
}: {
  href: string;
  icon: string;
  label: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="tap flex flex-col items-start gap-1 rounded-lg border border-line bg-surface p-4 hover:border-brand"
    >
      <span aria-hidden className="text-2xl leading-none">
        {icon}
      </span>
      <span className="mt-1 font-semibold">{label}</span>
      <span className="text-xs text-ink-3">{detail}</span>
    </Link>
  );
}
