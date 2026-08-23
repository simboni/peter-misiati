import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { listQuotes } from "@/lib/quotes";
import { debtors } from "@/lib/credit";
import { formatKes } from "@/lib/units";
import { PageTitle, SectionLabel, Stat } from "@/components/ui";
import { WholesaleNav, NewBanner } from "@/components/wholesale-nav";

export const dynamic = "force-dynamic";

/**
 * The wholesale overview.
 *
 * Not a menu of links — the section bar above already is one. This answers the
 * question somebody actually opens wholesale to ask: what needs me today?
 *
 * Three things can need a person here, and each is a number that should be zero
 * on a good day: quotes the customer accepted but nobody has billed, quotes
 * sent that nobody has chased, and money owed for longer than it should be.
 * Everything else — the history, the customer list — is one tap along the bar
 * and does not belong on the front of it.
 */
export default async function WholesaleOverview() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const quotes = listQuotes(undefined, 200);
  const approved = quotes.filter((q) => q.status === "approved");
  const sent = quotes.filter((q) => q.status === "sent");
  const drafts = quotes.filter((q) => q.status === "draft");

  const owing = debtors();
  const owed = owing.reduce((s, r) => s + r.balance_cents, 0);
  const stale = owing.filter((r) => r.days > 30);

  const billed = all<{ n: number; total: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS total
       FROM sales WHERE tier = 'wholesale' AND status = 'complete'`,
  )[0];

  const waiting = approved.reduce((s, q) => s + q.total_cents, 0);

  return (
    <div>
      <PageTitle title="Wholesale" subtitle="Quotes, invoices, debts and the buyers behind them" />
      <WholesaleNav current="/wholesale" />

      <div className="grid gap-2.5 md:grid-cols-2">
        <NewBanner
          href="/wholesale/quotes/new"
          title="New quote"
          blurb="A price in writing. Nothing moves until it is accepted."
          cta="Start"
        />
        <NewBanner
          href="/wholesale/invoices/new"
          title="New invoice"
          blurb="Bill directly, or from an approved quote."
          cta="Start"
        />
      </div>

      <SectionLabel>What needs you</SectionLabel>
      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <Link href="/wholesale/quotes" className="block">
          <Stat
            label="Approved, not billed"
            value={String(approved.length)}
            detail={approved.length ? `${formatKes(waiting)} waiting to be invoiced` : "nothing waiting"}
          />
        </Link>
        <Link href="/wholesale/quotes" className="block">
          <Stat
            label="Sent, no answer"
            value={String(sent.length)}
            detail={sent.length ? "worth a phone call" : "nobody to chase"}
          />
        </Link>
        <Link href="/wholesale/debts" className="block">
          <Stat
            label="Owed over 30 days"
            value={formatKes(stale.reduce((s, r) => s + r.balance_cents, 0))}
            detail={`${stale.length} customer${stale.length === 1 ? "" : "s"}`}
          />
        </Link>
        <Link href="/wholesale/debts" className="block">
          <Stat label="Owed in total" value={formatKes(owed)} detail={`${owing.length} on account`} />
        </Link>
      </div>

      <SectionLabel>The books</SectionLabel>
      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <Link href="/wholesale/invoices" className="block">
          <Stat label="Invoices raised" value={String(billed?.n ?? 0)} detail="all time" />
        </Link>
        <Link href="/wholesale/invoices" className="block">
          <Stat label="Billed" value={formatKes(billed?.total ?? 0)} detail="all time" />
        </Link>
        <Link href="/wholesale/quotes" className="block">
          <Stat label="Quotes open" value={String(approved.length + sent.length + drafts.length)} detail={`${drafts.length} still draft`} />
        </Link>
        <Link href="/wholesale/customers" className="block">
          <Stat label="On account" value={String(owing.length)} detail="with a balance" />
        </Link>
      </div>
    </div>
  );
}
