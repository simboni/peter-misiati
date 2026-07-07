import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireOrg, getOrgProfile } from "@/server/org";
import { schema } from "@/server/db";
import { ItemForm } from "@/components/item-form";
import { PageHeader } from "@/components/page-header";
import { deleteItemAction } from "@/server/actions/items";

export const metadata = { title: "Edit item" };

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, organizationId } = await requireOrg();

  const rows = await db
    .select()
    .from(schema.item)
    .where(and(eq(schema.item.id, id), eq(schema.item.organizationId, organizationId)))
    .limit(1);
  const item = rows[0];
  if (!item) notFound();

  const profile = await getOrgProfile(db, organizationId);

  return (
    <div>
      <PageHeader title={item.name} subtitle="Edit item details." />
      <ItemForm item={item} defaultVatRateBps={profile?.defaultVatRateBps ?? 1600} />
      <form action={deleteItemAction} className="mt-6 max-w-2xl">
        <input type="hidden" name="id" value={item.id} />
        <button className="btn-danger btn-sm">Delete item</button>
      </form>
    </div>
  );
}
