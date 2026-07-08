import { requireOrg, getOrg, getOrgProfile } from "@/server/org";
import { kopokopoConfig } from "@/server/config";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";
import { PaymentSettingsForm } from "@/components/payment-settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { db, organizationId } = await requireOrg();
  const [org, profile, platformCfg] = await Promise.all([
    getOrg(db, organizationId),
    getOrgProfile(db, organizationId),
    kopokopoConfig(),
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
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" subtitle="Your business details appear on every document." />
      <SettingsForm orgName={org?.name ?? ""} profile={profile} />
      <PaymentSettingsForm
        enabled={profile.kopokopoEnabled}
        baseUrl={profile.kopokopoBaseUrl}
        till={profile.kopokopoTill}
        clientId={profile.kopokopoClientId}
        hasSecret={Boolean(profile.kopokopoClientSecretEnc)}
        hasApiKey={Boolean(profile.kopokopoApiKeyEnc)}
        platformConfigured={platformCfg !== null}
      />
    </div>
  );
}
