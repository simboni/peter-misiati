import { requireOrg } from "@/server/org";
import { ClientForm } from "@/components/client-form";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  await requireOrg();
  return (
    <div>
      <PageHeader title="Add client" subtitle="Create a new client record." />
      <ClientForm />
    </div>
  );
}
