import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { listQuotes, type QuoteRow } from "@/lib/quotes";
import { formatKes, formatDate } from "@/lib/units";
import { Card, Empty, PageTitle, SectionLabel } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Wholesale — the working list.
 *
 * Ordered by who is waiting on whom, not by date. A quote sitting in draft is
 * waiting on the shop; one that was sent is waiting on the customer; one the
 * customer approved is waiting on the shop again, to be billed. That last group
 * is the money not yet earned, so it goes first.
 */
interface WholesaleInvoice {
  id: number;
  at: string;
  total_cents: number;
  paid_cents: number;
  customer_name: string | null;
  note: string;
}

const STATUS: Record<string, { label: string; tone: string; who: string }> = {
  approved: { label: "Approved", tone: "bg-good-soft text-good", who: "ready to invoice" },
  sent: { label: "Sent", tone: "bg-warn-soft text-warn", who: "waiting on the customer" },
  draft: { label: "Draft", tone: "bg-wash text-muted", who: "not sent yet" },
  declined: { label: "Declined", tone: "bg-bad-soft text-bad", who: "" },
  invoiced: { label: "Invoiced", tone: "bg-brand-soft text-brand-dark", who: "" },
};

function QuoteCard({ q }: { q: QuoteRow }) {
  const s = STATUS[q.status] ?? STATUS.draft;
  return (
    <Link
      href={`/wholesale/${q.id}`}
      className="block rounded-2xl bg-white p-3.5 shadow-card ring-1 ring-ink/5 transition-shadow hover:shadow-lift"
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
          {q.customer_name || "Unnamed customer"}
        </span>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.tone}`}>
          {s.label}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-lg font-extrabold text-brand-deep tnum">{formatKes(q.total_cents)}</span>
        <span className="text-[11px] text-muted tnum">
          {q.line_count} line{q.line_count === 1 ? "" : "s"} · {q.quote_no}
        </span>
      </div>
      {s.who ? <div className="mt-0.5 text-[11px] font-semibold text-muted">{s.who}</div> : null}
    </Link>
  );
}

export default async function WholesalePage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const quotes = listQuotes("open", 60);
  const approved = quotes.filter((q) => q.status === "approved");
  const waiting = quotes.filter((q) => q.status === "sent");
  const drafts = quotes.filter((q) => q.status === "draft");

  // Wholesale bills are ordinary sales; these are the recent ones.
  const invoices = all<WholesaleInvoice>(
    `SELECT s.id, s.at, s.total_cents, s.paid_cents, c.name AS customer_name, s.note
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.tier = 'wholesale' AND s.status = 'complete'
      ORDER BY s.at DESC
      LIMIT 12`,
  );

  return (
    <div>
      <PageTitle title="Wholesale" subtitle="Quotes, invoices and what is still owed" />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/wholesale/new?mode=quote"
          className="flex min-h-11 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-sm xl:min-h-10"
        >
          New quote
        </Link>
        <Link
          href="/wholesale/new?mode=invoice"
          className="flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-bold text-brand-dark ring-1 ring-inset ring-line xl:min-h-10"
        >
          New invoice
        </Link>
      </div>

      {approved.length ? (
        <>
          <SectionLabel>Approved · ready to invoice</SectionLabel>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {approved.map((q) => <QuoteCard key={q.id} q={q} />)}
          </div>
        </>
      ) : null}

      {waiting.length ? (
        <>
          <SectionLabel>Sent · waiting on the customer</SectionLabel>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {waiting.map((q) => <QuoteCard key={q.id} q={q} />)}
          </div>
        </>
      ) : null}

      {drafts.length ? (
        <>
          <SectionLabel>Drafts</SectionLabel>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {drafts.map((q) => <QuoteCard key={q.id} q={q} />)}
          </div>
        </>
      ) : null}

      {!quotes.length ? (
        <Card>
          <Empty>
            No quotes yet. Raise one when a customer asks for a price, or invoice a regular
            buyer directly when the price is already agreed.
          </Empty>
        </Card>
      ) : null}

      <SectionLabel>Recent wholesale invoices</SectionLabel>
      {invoices.length ? (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {invoices.map((inv) => {
            const owing = inv.total_cents - inv.paid_cents;
            return (
              <Link
                key={inv.id}
                href={`/invoice/${inv.id}`}
                className="block rounded-2xl bg-white p-3.5 shadow-card ring-1 ring-ink/5 transition-shadow hover:shadow-lift"
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">
                    {inv.customer_name ?? "Walk-in"}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">{formatDate(inv.at)}</span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-lg font-extrabold text-brand-deep tnum">
                    {formatKes(inv.total_cents)}
                  </span>
                  {owing > 0 ? (
                    <span className="text-[11px] font-bold text-warn tnum">
                      {formatKes(owing)} owing
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold text-good">paid</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <Card>
          <Empty>No wholesale invoices yet.</Empty>
        </Card>
      )}
    </div>
  );
}
