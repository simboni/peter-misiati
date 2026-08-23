import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { formatKes, formatDate } from "@/lib/units";
import { Card, Empty, PageTitle, SectionLabel, Stat } from "@/components/ui";
import { WholesaleNav, NewBanner } from "@/components/wholesale-nav";

export const dynamic = "force-dynamic";

interface Row {
  id: number;
  at: string;
  total_cents: number;
  paid_cents: number;
  status: string;
  customer_name: string | null;
  note: string;
}

export default async function InvoicesPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  // A wholesale invoice is a wholesale sale — there is no second table, which is
  // why this list and the debtors list can never disagree about what is owed.
  const rows = all<Row>(
    `SELECT s.id, s.at, s.total_cents, s.paid_cents, s.status, s.note, c.name AS customer_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.tier = 'wholesale'
      ORDER BY s.at DESC
      LIMIT 120`,
  );

  const live = rows.filter((r) => r.status === "complete");
  const owed = live.reduce((s, r) => s + Math.max(0, r.total_cents - r.paid_cents), 0);
  const billed = live.reduce((s, r) => s + r.total_cents, 0);

  return (
    <div>
      <PageTitle title="Invoices" subtitle="Every wholesale bill, paid or outstanding" />
      <WholesaleNav current="/wholesale/invoices" />

      <NewBanner
        href="/wholesale/invoices/new"
        title="New invoice"
        blurb="Bill a customer directly, or start from a quote they have approved."
        cta="Start"
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <Stat label="Invoices" value={String(live.length)} />
        <Stat label="Billed" value={formatKes(billed)} />
        <Stat label="Still owed" value={formatKes(owed)} detail={owed > 0 ? "chase these" : "all settled"} />
      </div>

      <SectionLabel>Newest first</SectionLabel>
      {rows.length ? (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5">
          {rows.map((r) => {
            const owing = r.total_cents - r.paid_cents;
            const voided = r.status !== "complete";
            return (
              <Link
                key={r.id}
                href={`/invoice/${r.id}`}
                className="block rounded-2xl bg-white p-3.5 shadow-card ring-1 ring-ink/5 transition-shadow hover:shadow-lift"
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">
                    {r.customer_name ?? "Walk-in"}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">{formatDate(r.at)}</span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className={`text-lg font-extrabold tnum ${voided ? "text-muted line-through" : "text-brand-deep"}`}>
                    {formatKes(r.total_cents)}
                  </span>
                  {voided ? (
                    <span className="text-[11px] font-bold text-bad">voided</span>
                  ) : owing > 0 ? (
                    <span className="text-[11px] font-bold text-warn tnum">{formatKes(owing)} owing</span>
                  ) : (
                    <span className="text-[11px] font-bold text-good">paid</span>
                  )}
                </div>
                {r.note ? (
                  <div className="mt-0.5 truncate text-[11px] text-muted">{r.note}</div>
                ) : null}
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
