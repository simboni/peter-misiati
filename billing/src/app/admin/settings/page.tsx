export const dynamic = "force-dynamic";
import { requireSuperAdmin } from "@/server/admin";
import { getPlatformSettings } from "@/server/platform";
import { PlatformSettingsForm } from "@/components/admin/platform-settings-form";

export const metadata = { title: "Platform settings · Admin" };

export default async function AdminSettings() {
  const { db } = await requireSuperAdmin();
  const s = await getPlatformSettings(db);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Platform settings</h1>
        <p className="text-sm text-muted">
          Pricing and the platform-level integrations. Stored in the database; environment
          variables are used only as a fallback.
        </p>
      </div>

      <PlatformSettingsForm
        pricePerSeatKes={s.pricePerSeatKes}
        currency={s.currency}
        kopokopoEnabled={s.kopokopoEnabled}
        kopokopoBaseUrl={s.kopokopoBaseUrl}
        kopokopoTill={s.kopokopoTill}
        kopokopoClientId={s.kopokopoClientId}
        hasClientSecret={Boolean(s.kopokopoClientSecretEnc)}
        hasApiKey={Boolean(s.kopokopoApiKeyEnc)}
        resendFrom={s.resendFrom}
        hasResendKey={Boolean(s.resendApiKeyEnc)}
      />
    </div>
  );
}
