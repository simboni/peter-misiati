"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { getEnv } from "@/server/config";
import { schema } from "@/server/db";
import { encryptSecret } from "@/server/crypto";
import { kopokopoConfigForOrg } from "@/server/payments-config";
import { testConnection } from "@/server/kopokopo";

export type FormState = { error?: string; ok?: boolean };
export type TestState = { error?: string; message?: string };

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** Save the vendor's own Kopo Kopo credentials (secrets encrypted at rest). */
export async function savePaymentSettingsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, organizationId } = await requireOrg();
  const env = await getEnv();
  const appSecret = env.BETTER_AUTH_SECRET || "dev-secret-please-change-in-production";

  const enabled = fd.get("kopokopoEnabled") === "on";
  const baseUrl =
    str(fd, "kopokopoBaseUrl") === "https://sandbox.kopokopo.com"
      ? "https://sandbox.kopokopo.com"
      : "https://api.kopokopo.com";
  const till = str(fd, "kopokopoTill") || null;
  const clientId = str(fd, "kopokopoClientId") || null;
  const newSecret = str(fd, "kopokopoClientSecret");
  const newApiKey = str(fd, "kopokopoApiKey");

  // Load current encrypted values so blank fields keep the existing secret.
  const rows = await db
    .select({
      secretEnc: schema.orgProfile.kopokopoClientSecretEnc,
      apiKeyEnc: schema.orgProfile.kopokopoApiKeyEnc,
    })
    .from(schema.orgProfile)
    .where(eq(schema.orgProfile.organizationId, organizationId))
    .limit(1);
  const current = rows[0];

  const secretEnc = newSecret ? await encryptSecret(newSecret, appSecret) : (current?.secretEnc ?? null);
  const apiKeyEnc = newApiKey ? await encryptSecret(newApiKey, appSecret) : (current?.apiKeyEnc ?? null);

  if (enabled && (!till || !clientId || !secretEnc || !apiKeyEnc)) {
    return {
      error:
        "To use your own account, fill in the till number, client ID, client secret and API key.",
    };
  }

  await db
    .update(schema.orgProfile)
    .set({
      kopokopoEnabled: enabled,
      kopokopoBaseUrl: baseUrl,
      kopokopoTill: till,
      kopokopoClientId: clientId,
      kopokopoClientSecretEnc: secretEnc,
      kopokopoApiKeyEnc: apiKeyEnc,
    })
    .where(eq(schema.orgProfile.organizationId, organizationId));

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Verify the saved Kopo Kopo credentials by performing the OAuth handshake only.
 * Uses whatever config currently applies to this org (own account if enabled,
 * else the platform account). No STK push, no money moved. Save before testing.
 */
export async function testPaymentConnectionAction(_prev: TestState): Promise<TestState> {
  const { db, organizationId } = await requireOrg();
  const cfg = await kopokopoConfigForOrg(db, organizationId);
  if (!cfg) {
    return { error: "No M-Pesa account is configured yet. Fill in the details, save, then test." };
  }
  const env = cfg.baseUrl.includes("sandbox") ? "Sandbox" : "Production";
  const res = await testConnection(cfg);
  if (res.ok) {
    return { message: `Connected to Kopo Kopo (${env}) successfully — till ${cfg.tillNumber}. M-Pesa is ready.` };
  }
  return { error: res.error ?? "Connection failed." };
}
