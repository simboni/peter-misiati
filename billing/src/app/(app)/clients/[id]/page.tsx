import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { ClientForm } from "@/components/client-form";
import { deleteClientAction } from "@/server/actions/clients";

export const metadata = { title: "Edit client" };

export default async function EditClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const { db, organizationId } = await requireOrg();

  const rows = await db
    .select()
    .from(schema.client)
    .where(and(eq(schema.client.id, id), eq(schema.client.organizationId, organizationId)))
    .limit(1);
  const client = rows[0];
  if (!client) notFound();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{client.name}</h1>
          <p className="mt-1 text-sm text-muted">Edit client details.</p>
        </div>
        <Link href={`/clients/${client.id}/statement`} className="btn-ghost btn-sm">
          View statement
        </Link>
      </div>

      {error === "has-invoices" && (
        <p className="mb-4 max-w-2xl rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This client can’t be deleted because they have invoices. Void or remove those first.
        </p>
      )}

      <ClientForm client={client} />

      <form action={deleteClientAction} className="mt-6 max-w-2xl">
        <input type="hidden" name="id" value={client.id} />
        <button className="btn-danger btn-sm">Delete client</button>
      </form>
    </div>
  );
}
