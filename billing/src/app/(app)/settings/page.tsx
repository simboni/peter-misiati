import { requireOrg, getOrg, getOrgProfile } from "@/server/org";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { db, organizationId } = await requireOrg();
  const [org, profile] = await Promise.all([
    getOrg(db, organizationId),
    getOrgProfile(db, organizationId),
  ]);

  if (!profile) {
    return (
      <div>
        <PageHeader title="Settings" />
        <p className="text-muted">Profile not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle="Your business details appear on every document." />
      <SettingsForm orgName={org?.name ?? ""} profile={profile} />
    </div>
  );
}
