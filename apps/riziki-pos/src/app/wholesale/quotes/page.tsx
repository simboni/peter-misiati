import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listQuotes, type QuoteRow } from "@/lib/quotes";
import { formatKes, formatDate } from "@/lib/units";
import { Card, Empty, PageTitle, SectionLabel } from "@/components/ui";
import { WholesaleNav, NewBanner } from "@/components/wholesale-nav";

export const dynamic = "force-dynamic";

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
      href={`/wholesale/quotes/${q.id}`}
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
      <div className="mt-0.5 text-[11px] font-semibold text-muted">
        {s.who || formatDate(q.created_at)}
      </div>
    </Link>
  );
}

const GRID = "grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5";

export default async function QuotesPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const all = listQuotes(undefined, 120);
  const group = (s: string) => all.filter((q) => q.status === s);
  const approved = group("approved");
  const sent = group("sent");
  const drafts = group("draft");
  const done = all.filter((q) => q.status === "invoiced" || q.status === "declined");

  return (
    <div>
      <PageTitle title="Quotes" subtitle="Prices offered, and what became of them" />
      <WholesaleNav current="/wholesale/quotes" />

      <NewBanner
        href="/wholesale/quotes/new"
        title="New quote"
        blurb="Put a price in writing. Nothing moves until the customer accepts it."
        cta="Start"
      />

      {approved.length ? (
        <>
          <SectionLabel>Approved · ready to invoice</SectionLabel>
          <div className={GRID}>{approved.map((q) => <QuoteCard key={q.id} q={q} />)}</div>
        </>
      ) : null}

      {sent.length ? (
        <>
          <SectionLabel>Sent · waiting on the customer</SectionLabel>
          <div className={GRID}>{sent.map((q) => <QuoteCard key={q.id} q={q} />)}</div>
        </>
      ) : null}

      {drafts.length ? (
        <>
          <SectionLabel>Drafts</SectionLabel>
          <div className={GRID}>{drafts.map((q) => <QuoteCard key={q.id} q={q} />)}</div>
        </>
      ) : null}

      {done.length ? (
        <>
          <SectionLabel>Settled</SectionLabel>
          <div className={GRID}>{done.map((q) => <QuoteCard key={q.id} q={q} />)}</div>
        </>
      ) : null}

      {!all.length ? (
        <Card>
          <Empty>No quotes yet. Raise one when a customer asks what something would cost.</Empty>
        </Card>
      ) : null}
    </div>
  );
}
