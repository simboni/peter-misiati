import { requireOrg, getOrg, getOrgProfile } from "@/server/org";
import { platformKopokopoConfig } from "@/server/platform";
import { isPro } from "@/lib/plan";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";
import { PaymentSettingsForm } from "@/components/payment-settings-form";
import { DangerZone } from "@/components/danger-zone";
import { DeleteAccount } from "@/components/delete-account";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { db, organizationId, role } = await requireOrg();
  const [org, profile, platformCfg] = await Promise.all([
    getOrg(db, organizationId),
    getOrgProfile(db, organizationId),
    platformKopokopoConfig(db),
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
      <SettingsForm
        orgName={org?.name ?? ""}
        // Strip encrypted secrets before handing the profile to a Client
        // Component — Next serializes every prop into the browser payload, and
        // the form never needs the ciphertext (payment secrets are managed by
        // PaymentSettingsForm via boolean flags).
        profile={{ ...profile, kopokopoClientSecretEnc: null, kopokopoApiKeyEnc: null }}
        pro={isPro(profile.plan)}
      />
      <PaymentSettingsForm
        enabled={profile.kopokopoEnabled}
        baseUrl={profile.kopokopoBaseUrl}
        till={profile.kopokopoTill}
        clientId={profile.kopokopoClientId}
        hasSecret={Boolean(profile.kopokopoClientSecretEnc)}
        hasApiKey={Boolean(profile.kopokopoApiKeyEnc)}
        platformConfigured={platformCfg !== null}
      />
      <DangerZone />
      <DeleteAccount isOwner={role === "owner"} />
    </div>
  );
}
