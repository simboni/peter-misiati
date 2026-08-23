import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listCustomers, debtors } from "@/lib/credit";
import { formatKes } from "@/lib/units";
import { Card, Empty, PageTitle, SectionLabel } from "@/components/ui";
import { WholesaleNav, NewBanner, BackLink } from "@/components/wholesale-nav";

export const dynamic = "force-dynamic";

/**
 * The buyers, with what each of them owes already on the card.
 *
 * A wholesale customer is only half a fact without their balance — the question
 * asked at this shop is never "who are they" but "can they take another drum",
 * and that is a name, a limit and a balance side by side.
 */
export default async function WholesaleCustomersPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const owed = new Map(debtors().map((d) => [d.id, d.balance_cents]));
  const everyone = listCustomers();
  const wholesale = everyone.filter((c) => c.kind === "wholesale");
  const retail = everyone.filter((c) => c.kind !== "wholesale");

  const Row = ({ c }: { c: (typeof everyone)[number] }) => {
    const balance = owed.get(c.id) ?? 0;
    const noTerms = c.credit_limit_cents === 0;
    return (
      <Link
        href={`/customers/${c.id}`}
        className="block rounded-2xl bg-white p-3.5 shadow-card ring-1 ring-ink/5 transition-shadow hover:shadow-lift"
      >
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-bold">{c.name}</span>
          {balance > 0 ? (
            <span className="shrink-0 text-[11px] font-bold text-warn tnum">
              {formatKes(balance)} owing
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-baseline gap-2 text-[11px] text-muted">
          {c.phone ? <span className="tnum">{c.phone}</span> : <span>no number</span>}
          <span aria-hidden>·</span>
          <span className={noTerms ? "font-bold text-muted" : "tnum"}>
            {noTerms ? "no credit terms agreed" : `limit ${formatKes(c.credit_limit_cents)}`}
          </span>
        </div>
      </Link>
    );
  };

  const GRID = "grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

  return (
    <div>
      <BackLink href="/wholesale" label="Wholesale" />
      <PageTitle title="Customers" subtitle="Who buys on account, and where each of them stands" />
      <WholesaleNav current="/wholesale/customers" />

      <NewBanner
        href="/customers"
        title="Add a customer"
        blurb="Names, numbers, KRA PINs and credit limits — set the terms before the first bill."
        cta="Open"
      />

      <SectionLabel>Wholesale</SectionLabel>
      {wholesale.length ? (
        <div className={GRID}>{wholesale.map((c) => <Row key={c.id} c={c} />)}</div>
      ) : (
        <Card>
          <Empty>
            No wholesale customers yet. One is created automatically the first time a bill goes on
            account, at a zero limit until the owner agrees terms.
          </Empty>
        </Card>
      )}

      {retail.length ? (
        <>
          <SectionLabel>Also on the books</SectionLabel>
          <div className={GRID}>{retail.map((c) => <Row key={c.id} c={c} />)}</div>
        </>
      ) : null}
    </div>
  );
}
