import { eq, desc } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { PageHeader, EmptyState } from "@/components/page-header";
import { ClientListView } from "@/components/client-list-view";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const { db, organizationId } = await requireOrg();
  const clients = await db
    .select()
    .from(schema.client)
    .where(eq(schema.client.organizationId, organizationId))
    .orderBy(desc(schema.client.createdAt));

  const shaped = clients.map((c) => ({
    id: c.id,
    name: c.name,
    contact: c.email || c.phone || c.contactPerson || "",
    kraPin: c.kraPin || "",
    currency: c.currency,
  }));

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle="The people and businesses you invoice."
        action={{ href: "/clients/new", label: "Add client" }}
      />
      {shaped.length === 0 ? (
        <EmptyState
          title="No clients yet"
          body="Add your first client to start sending quotations and invoices."
          action={{ href: "/clients/new", label: "Add client" }}
        />
      ) : (
        <ClientListView rows={shaped} />
      )}
    </div>
  );
}
