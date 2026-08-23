import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { debtors } from "@/lib/credit";
import { formatKes } from "@/lib/units";
import { Card, Empty, PageTitle, SectionLabel, Stat } from "@/components/ui";
import { WholesaleNav } from "@/components/wholesale-nav";

export const dynamic = "force-dynamic";

/**
 * Who owes the shop, oldest debt first.
 *
 * This is the same `debtors()` the main Debts screen uses — not a second
 * calculation, because two ways of totting up the same money is how the two
 * start disagreeing. What differs is where it sits: inside the section where
 * the debt was created, so chasing a bill does not mean leaving wholesale.
 *
 * Recording a payment stays on the customer's own page, where the ledger and
 * the statement already live.
 */
const BAND: Record<string, string> = {
  none: "bg-good-soft text-good",
  fresh: "bg-good-soft text-good",
  mid: "bg-warn-soft text-warn",
  old: "bg-bad-soft text-bad",
};

export default async function WholesaleDebtsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const rows = debtors();
  const total = rows.reduce((s, r) => s + r.balance_cents, 0);
  const overdue = rows.filter((r) => r.days > 30);

  return (
    <div>
      <PageTitle title="Debts" subtitle="What is owed, and how long it has been owed" />
      <WholesaleNav current="/wholesale/debts" />

      <div className="mb-4 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <Stat
          label="Owed in total"
          value={formatKes(total)}
          detail={`${rows.length} customer${rows.length === 1 ? "" : "s"}`}
        />
        <Stat
          label="Over 30 days"
          value={formatKes(overdue.reduce((s, r) => s + r.balance_cents, 0))}
          detail={`${overdue.length} to chase`}
        />
      </div>

      <SectionLabel>Oldest first</SectionLabel>
      {rows.length ? (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/customers/${r.id}`}
              className="block rounded-2xl bg-white p-3.5 shadow-card ring-1 ring-ink/5 transition-shadow hover:shadow-lift"
            >
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{r.name}</span>
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    BAND[r.band] ?? "bg-wash text-muted"
                  }`}
                >
                  {r.days}d
                </span>
              </div>
              <div className="mt-1 text-lg font-extrabold text-brand-deep tnum">
                {formatKes(r.balance_cents)}
              </div>
              {r.phone ? <div className="mt-0.5 text-[11px] text-muted tnum">{r.phone}</div> : null}
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <Empty>Nobody owes the shop anything. Rare, and good.</Empty>
        </Card>
      )}
    </div>
  );
}
