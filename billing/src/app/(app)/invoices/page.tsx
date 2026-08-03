import { and, eq, or, like, desc, asc, count, sql } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { PageHeader, EmptyState } from "@/components/page-header";
import { InvoiceListView } from "@/components/invoice-list-view";
import { fmtDate } from "@/server/queries";

export const metadata = { title: "Invoices" };

const PAGE_SIZE = 50;
const SORTS = {
  newest: desc(schema.invoice.createdAt),
  oldest: asc(schema.invoice.createdAt),
  total: desc(schema.invoice.total),
  balance: desc(schema.invoice.balanceDue),
} as const;
type SortKey = keyof typeof SORTS;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; client?: string; sort?: string; page?: string }>;
}) {
  const { db, organizationId } = await requireOrg();
  const sp = await searchParams;

  const q = (sp.q ?? "").trim();
  const status = sp.status && sp.status !== "all" ? sp.status : "";
  const clientId = sp.client && sp.client !== "all" ? sp.client : "";
  const sort: SortKey = (sp.sort && sp.sort in SORTS ? sp.sort : "newest") as SortKey;
  const page = Math.max(1, Number(sp.page) || 1);

  // Build the filter once; reused by the page, count and total queries so all
  // three see exactly the same set.
  const filters = [
    eq(schema.invoice.organizationId, organizationId),
    eq(schema.invoice.type, "invoice"),
  ];
  if (status) filters.push(eq(schema.invoice.status, status));
  if (clientId) filters.push(eq(schema.invoice.clientId, clientId));
  if (q) {
    const needle = `%${q}%`;
    filters.push(or(like(schema.invoice.number, needle), like(schema.client.name, needle))!);
  }
  const where = and(...filters);

  const [rows, totalRow, sumRow, clients] = await Promise.all([
    db
      .select({
        id: schema.invoice.id,
        number: schema.invoice.number,
        status: schema.invoice.status,
        issueDate: schema.invoice.issueDate,
        total: schema.invoice.total,
        balanceDue: schema.invoice.balanceDue,
        amountPaid: schema.invoice.amountPaid,
        currency: schema.invoice.currency,
        shareToken: schema.invoice.shareToken,
        clientName: schema.client.name,
      })
      .from(schema.invoice)
      .leftJoin(schema.client, eq(schema.client.id, schema.invoice.clientId))
      .where(where)
      .orderBy(SORTS[sort])
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ c: count() })
      .from(schema.invoice)
      .leftJoin(schema.client, eq(schema.client.id, schema.invoice.clientId))
      .where(where),
    db
      .select({ outstanding: sql<number>`COALESCE(SUM(${schema.invoice.balanceDue}), 0)` })
      .from(schema.invoice)
      .leftJoin(schema.client, eq(schema.client.id, schema.invoice.clientId))
      .where(where),
    // Client dropdown — the org's clients (bounded, indexed), not derived from
    // the current page so filtering by any client still works.
    db
      .select({ id: schema.client.id, name: schema.client.name })
      .from(schema.client)
      .where(eq(schema.client.organizationId, organizationId))
      .orderBy(asc(schema.client.name)),
  ]);

  const total = totalRow[0]?.c ?? 0;
  const outstanding = Number(sumRow[0]?.outstanding ?? 0);
  const hasAny = total > 0 || q !== "" || status !== "" || clientId !== "";

  const shaped = rows.map((r) => ({
    id: r.id,
    number: r.number,
    client: r.clientName ?? "—",
    date: fmtDate(r.issueDate),
    status: r.status,
    total: r.total,
    balance: r.balanceDue,
    received: r.amountPaid,
    currency: r.currency,
    shareToken: r.shareToken,
  }));

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Bill clients, track deposits and balances."
        action={{ href: "/invoices/new", label: "New invoice" }}
      />
      {!hasAny ? (
        <EmptyState
          title="No invoices yet"
          body="Create your first invoice — add a deposit if the client pays a downpayment upfront."
          action={{ href: "/invoices/new", label: "New invoice" }}
        />
      ) : (
        <InvoiceListView
          rows={shaped}
          clients={clients.map((c) => ({ id: c.id, name: c.name }))}
          total={total}
          outstanding={outstanding}
          page={page}
          pageSize={PAGE_SIZE}
          filters={{ q, status: sp.status ?? "all", client: sp.client ?? "all", sort }}
        />
      )}
    </div>
  );
}
