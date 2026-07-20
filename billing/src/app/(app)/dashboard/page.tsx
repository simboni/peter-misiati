import Link from "next/link";
import { and, eq, desc } from "drizzle-orm";
import { requireOrg, getOrgProfile } from "@/server/org";
import { schema } from "@/server/db";
import { formatMoney, formatAmount } from "@/server/money";
import { fmtDate } from "@/server/queries";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/page-header";
import { Collapsible } from "@/components/collapsible";
import { HeroCarousel, type HeroCard } from "@/components/hero-carousel";
import { runDueRecurring } from "@/server/recurring";

export const metadata = { title: "Dashboard" };

// Quick-action glyphs (kept local so the dashboard stays a lean server component).
const ICN = {
  invoice: "M6 2h9l3 3v17l-3-2-3 2-3-2-3 2V2zM9 8h6M9 12h6M9 16h4",
  quote: "M6 2h8l4 4v16H6zM14 2v4h4M9 13h6M9 17h4",
  users: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87M16 3.13A4 4 0 0116 11",
  wallet: "M3 7a2 2 0 012-2h12a2 2 0 012 2v2M3 7v10a2 2 0 002 2h14a2 2 0 002-2v-4M21 13h-4a2 2 0 010-4h4z",
  truck: "M1 4h13v10H1zM14 8h4l3 3v3h-7zM5.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM18.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
  box: "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8",
  receipt: "M5 3h14v18l-2.5-1.6L14 21l-2-1.4L10 21l-2.5-1.6L5 21zM8.5 8h7M8.5 12h7",
  chart: "M3 3v18h18M8 15v3M13 10v8M18 6v12",
} as const;

function DIcon({ d, className = "h-6 w-6" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={d} />
    </svg>
  );
}

export default async function DashboardPage() {
  const { db, organizationId } = await requireOrg();

  // Generate any recurring invoices that have come due since the last visit.
  await runDueRecurring(db, organizationId);

  // Fetch everything the dashboard needs in one parallel batch (one D1
  // round-trip's worth of latency instead of five sequential ones).
  const [profile, invoices, payments, expenses] = await Promise.all([
    getOrgProfile(db, organizationId),
    db
      .select({
        id: schema.invoice.id,
        number: schema.invoice.number,
        status: schema.invoice.status,
        total: schema.invoice.total,
        balanceDue: schema.invoice.balanceDue,
        dueDate: schema.invoice.dueDate,
        issueDate: schema.invoice.issueDate,
        createdAt: schema.invoice.createdAt,
        clientId: schema.invoice.clientId,
        clientName: schema.client.name,
      })
      .from(schema.invoice)
      .leftJoin(schema.client, eq(schema.client.id, schema.invoice.clientId))
      .where(and(eq(schema.invoice.organizationId, organizationId), eq(schema.invoice.type, "invoice")))
      .orderBy(desc(schema.invoice.createdAt)),
    db
      .select({ amount: schema.payment.amount, paidAt: schema.payment.paidAt })
      .from(schema.payment)
      .where(eq(schema.payment.organizationId, organizationId)),
    db
      .select({ amount: schema.expense.amount, date: schema.expense.expenseDate })
      .from(schema.expense)
      .where(eq(schema.expense.organizationId, organizationId)),
  ]);
  const cur = profile?.currency ?? "KES";

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const issued = invoices.filter((i) => i.status !== "draft" && i.status !== "void");
  const totalInvoiced = issued.reduce((a, i) => a + i.total, 0);
  const totalPaid = payments.reduce((a, p) => a + p.amount, 0);
  const outstanding = invoices
    .filter((i) => i.status !== "void")
    .reduce((a, i) => a + i.balanceDue, 0);
  const overdueList = invoices.filter(
    (i) => i.status !== "void" && i.balanceDue > 0 && i.dueDate && new Date(i.dueDate) < now,
  );
  const overdue = overdueList.reduce((a, i) => a + i.balanceDue, 0);
  const monthRevenue = payments
    .filter((p) => new Date(p.paidAt) >= monthStart)
    .reduce((a, p) => a + p.amount, 0);
  const monthExpenses = expenses
    .filter((e) => new Date(e.date) >= monthStart)
    .reduce((a, e) => a + e.amount, 0);
  const monthNet = monthRevenue - monthExpenses;

  // Top clients by invoiced value
  const byClient = new Map<string, { name: string; total: number }>();
  for (const i of issued) {
    const k = i.clientId;
    const prev = byClient.get(k) ?? { name: i.clientName ?? "—", total: 0 };
    prev.total += i.total;
    byClient.set(k, prev);
  }
  const topClients = [...byClient.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const recent = invoices.slice(0, 6);

  const openCount = invoices.filter((i) => i.status !== "void" && i.balanceDue > 0).length;
  // Whole-shilling formatting for the compact stat chips (no cents, so the
  // figures never get clipped in their narrow cards).
  const whole = (v: number) => formatAmount(v).replace(/\.\d+$/, "");

  // Warm greeting in East Africa Time (server clock is UTC).
  const eatHour = (now.getUTCHours() + 3) % 24;
  const greeting = eatHour < 12 ? "Good morning" : eatHour < 17 ? "Good afternoon" : "Good evening";

  const heroCards: HeroCard[] = [
    {
      label: "You're owed",
      amount: formatAmount(outstanding),
      cur,
      chips: [
        { text: `${openCount} open invoice${openCount === 1 ? "" : "s"}` },
        ...(overdue > 0 ? [{ text: `${overdueList.length} overdue · ${whole(overdue)}`, amber: true }] : []),
      ],
      link: { href: "/invoices", label: "View all →" },
    },
    {
      label: "Received this month",
      amount: formatAmount(monthRevenue),
      cur,
      chips: [{ text: `All-time ${whole(totalPaid)}` }],
      link: { href: "/receipts", label: "Receipts →" },
    },
    {
      label: "Net this month",
      amount: formatAmount(monthNet),
      cur,
      chips: [{ text: `Income ${whole(monthRevenue)}` }, { text: `Expenses ${whole(monthExpenses)}` }],
    },
  ];

  const chips = [
    { label: "Received", sub: "this month", value: monthRevenue, tone: "accent" as const },
    { label: "Invoiced", sub: "all time", value: totalInvoiced, tone: "ink" as const },
    { label: "Net", sub: "this month", value: monthNet, tone: monthNet >= 0 ? ("accent" as const) : ("danger" as const) },
  ];

  const actions: { href: string; label: string; icon: keyof typeof ICN; primary?: boolean }[] = [
    { href: "/invoices/new", label: "Invoice", icon: "invoice", primary: true },
    { href: "/quotations/new", label: "Quotation", icon: "quote" },
    { href: "/clients/new", label: "Client", icon: "users" },
    { href: "/expenses/new", label: "Expense", icon: "wallet" },
    { href: "/delivery-notes/new", label: "Delivery", icon: "truck" },
    { href: "/items/new", label: "Item", icon: "box" },
    { href: "/receipts", label: "Receipts", icon: "receipt" },
    { href: "/reports", label: "Reports", icon: "chart" },
  ];

  const noData = invoices.length === 0 && payments.length === 0;

  return (
    <div className="space-y-6">
      {/* Greeting + swipeable money cards */}
      <p className="px-1 text-sm font-medium text-muted">{greeting} 👋</p>
      <HeroCarousel cards={heroCards} />

      {/* Quick stat chips */}
      <div className="grid grid-cols-3 gap-3">
        {chips.map((c) => (
          <div key={c.label} className="card p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{c.label}</p>
            <p
              className={`mt-1 truncate text-[15px] font-bold tabular-nums ${
                c.tone === "accent" ? "text-brand-700" : c.tone === "danger" ? "text-red-600" : "text-ink"
              }`}
            >
              {whole(c.value)}
            </p>
            <p className="text-[11px] text-muted">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <section>
        <h2 className="mb-3 text-sm font-bold text-ink">What would you like to do?</h2>
        <div className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-8">
          {actions.map((a) => (
            <Link key={a.href} href={a.href} className="group flex flex-col items-center gap-2">
              <span
                className={`grid h-14 w-14 place-items-center rounded-2xl transition-transform group-active:scale-90 ${
                  a.primary ? "bg-brand-600 text-white shadow-sm" : "bg-brand-50 text-brand-700"
                }`}
              >
                <DIcon d={ICN[a.icon]} />
              </span>
              <span className="text-center text-[11px] font-medium leading-tight text-muted">{a.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {noData ? (
        <EmptyState
          title="Let’s get you started"
          body="Add a client, then create your first invoice. Record the deposit and balance as they come in — receipts are generated automatically."
          action={{ href: "/clients/new", label: "Add your first client" }}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Collapsible title="Recent invoices" meta={String(recent.length)} defaultOpen={false}>
            {recent.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">No invoices yet.</p>
            ) : (
              // A reflowing row rather than a table: on a narrow phone the
              // number + status sit on top, the client · date truncates, and
              // the amount stays pinned to the right so it's never clipped.
              <ul className="divide-y divide-line">
                {recent.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/invoices/${r.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-canvas"
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-ink">{r.number}</span>
                          <StatusBadge status={r.status} />
                        </span>
                        <span className="mt-0.5 block truncate text-sm text-muted">
                          {r.clientName ?? "—"} · {fmtDate(r.issueDate)}
                        </span>
                      </span>
                      <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-ink">
                        {formatMoney(r.total, cur)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Collapsible>

          <Collapsible title="Top clients" meta={String(topClients.length)} bodyClassName="p-5" defaultOpen={false}>
            {topClients.length === 0 ? (
              <p className="text-sm text-muted">No data yet.</p>
            ) : (
              <ul className="space-y-3">
                {topClients.map((c) => (
                  <li key={c.id} className="flex items-center justify-between text-sm">
                    <Link href={`/clients/${c.id}`} className="text-ink hover:text-brand-700">
                      {c.name}
                    </Link>
                    <span className="tabular-nums font-medium text-ink">{formatMoney(c.total, cur)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Collapsible>
        </div>
      )}
    </div>
  );
}
