export const dynamic = "force-dynamic";
import { eq, desc } from "drizzle-orm";
import { requireOrg, getOrgProfile } from "@/server/org";
import { schema } from "@/server/db";
import { PageHeader, EmptyState } from "@/components/page-header";
import { RecurringListView } from "@/components/recurring-list-view";
import { runDueRecurring } from "@/server/recurring";
import { calcTotals } from "@/server/totals";
import { fmtDate } from "@/server/queries";

export const metadata = { title: "Recurring invoices" };

const FREQ_LABEL: Record<string, string> = { weekly: "week", monthly: "month", quarterly: "quarter", yearly: "year" };
function repeats(frequency: string, interval: number): string {
  const unit = FREQ_LABEL[frequency] ?? "month";
  return interval > 1 ? `Every ${interval} ${unit}s` : `Every ${unit}`;
}

export default async function RecurringPage() {
  const { db, organizationId } = await requireOrg();

  // Catch up on any invoices that have come due since the last visit.
  await runDueRecurring(db, organizationId);

  const [schedules, profile] = await Promise.all([
    db
      .select({
        id: schema.recurringInvoice.id,
        clientId: schema.recurringInvoice.clientId,
        title: schema.recurringInvoice.title,
        frequency: schema.recurringInvoice.frequency,
        interval: schema.recurringInvoice.interval,
        status: schema.recurringInvoice.status,
        nextRunDate: schema.recurringInvoice.nextRunDate,
        currency: schema.recurringInvoice.currency,
        discountType: schema.recurringInvoice.discountType,
        discountValue: schema.recurringInvoice.discountValue,
        client: schema.client.name,
      })
      .from(schema.recurringInvoice)
      .leftJoin(schema.client, eq(schema.client.id, schema.recurringInvoice.clientId))
      .where(eq(schema.recurringInvoice.organizationId, organizationId))
      .orderBy(desc(schema.recurringInvoice.createdAt)),
    getOrgProfile(db, organizationId),
  ]);
  const cur = profile?.currency ?? "KES";

  // Compute each schedule's per-invoice total from its lines (fetched in one go).
  const allLines = schedules.length ? await db.select().from(schema.recurringInvoiceLine) : [];
  const byId = new Map<string, typeof allLines>();
  for (const l of allLines) {
    const arr = byId.get(l.recurringInvoiceId) ?? [];
    arr.push(l);
    byId.set(l.recurringInvoiceId, arr);
  }

  const rows = schedules.map((s) => {
    const ls = byId.get(s.id) ?? [];
    const t = calcTotals({
      lines: ls.map((l) => ({ quantityMilli: l.quantityMilli, unitPrice: l.unitPrice, taxRateBps: l.taxRateBps })),
      discountType: s.discountType as "percent" | "fixed" | null,
      discountValue: s.discountValue,
    });
    return {
      id: s.id,
      label: s.title || (s.client ?? "Recurring invoice"),
      client: s.client ?? "—",
      frequencyLabel: repeats(s.frequency, s.interval),
      status: s.status,
      nextRun: fmtDate(s.nextRunDate),
      nextRunMs: new Date(s.nextRunDate).getTime(),
      total: t.total,
      currency: s.currency || cur,
    };
  });

  return (
    <div>
      <PageHeader
        title="Recurring invoices"
        subtitle="Set up retainers and subscriptions once — invoices are created automatically on schedule."
        action={{ href: "/recurring/new", label: "New schedule" }}
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No recurring invoices yet"
          body="Bill a client the same amount every week, month or quarter without lifting a finger. New invoices appear in your Invoices list automatically."
          action={{ href: "/recurring/new", label: "New schedule" }}
        />
      ) : (
        <RecurringListView rows={rows} />
      )}
    </div>
  );
}
