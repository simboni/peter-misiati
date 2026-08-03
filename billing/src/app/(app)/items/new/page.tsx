import { requireOrg, getOrgProfile } from "@/server/org";
import { ItemForm } from "@/components/item-form";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "New item" };

export default async function NewItemPage() {
  const { db, organizationId } = await requireOrg();
  const profile = await getOrgProfile(db, organizationId);
  return (
    <div>
      <PageHeader title="Add item" subtitle="A product or service you bill for." />
      <ItemForm defaultVatRateBps={profile?.vatRegistered ? profile.defaultVatRateBps : 0} />
    </div>
  );
}
