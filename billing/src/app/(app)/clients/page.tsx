import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { PageHeader, EmptyState } from "@/components/page-header";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const { db, organizationId } = await requireOrg();
  const clients = await db
    .select()
    .from(schema.client)
    .where(eq(schema.client.organizationId, organizationId))
    .orderBy(desc(schema.client.createdAt));

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle="The people and businesses you invoice."
        action={{ href: "/clients/new", label: "Add client" }}
      />

      {clients.length === 0 ? (
        <EmptyState
          title="No clients yet"
          body="Add your first client to start sending quotations and invoices."
          action={{ href: "/clients/new", label: "Add client" }}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line">
              <tr>
                <th className="th">Name</th>
                <th className="th">Contact</th>
                <th className="th">KRA PIN</th>
                <th className="th">Currency</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {clients.map((c) => (
                <tr key={c.id} className="hover:bg-canvas">
                  <td className="td font-medium">
                    <Link href={`/clients/${c.id}`} className="hover:text-brand-700">
                      {c.name}
                    </Link>
                  </td>
                  <td className="td text-muted">
                    {c.email || c.phone || c.contactPerson || "—"}
                  </td>
                  <td className="td text-muted">{c.kraPin || "—"}</td>
                  <td className="td text-muted">{c.currency}</td>
                  <td className="td text-right">
                    <Link href={`/clients/${c.id}`} className="btn-ghost btn-sm">
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
