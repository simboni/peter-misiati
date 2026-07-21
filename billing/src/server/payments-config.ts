import { eq } from "drizzle-orm";
import { schema, type DB } from "./db";
import { appSecret as getAppSecret, type KopoKopoConfig } from "./config";
import { platformKopokopoConfig } from "./platform";
import { decryptSecret } from "./crypto";

/**
 * Resolve the effective Kopo Kopo config for an organization:
 *   1. the vendor's own credentials (if enabled + complete + decryptable), else
 *   2. the platform-level env credentials, else
 *   3. null (M-Pesa unavailable).
 */
export async function kopokopoConfigForOrg(
  db: DB,
  organizationId: string,
): Promise<KopoKopoConfig | null> {
  const rows = await db
    .select({
      enabled: schema.orgProfile.kopokopoEnabled,
      baseUrl: schema.orgProfile.kopokopoBaseUrl,
      till: schema.orgProfile.kopokopoTill,
      clientId: schema.orgProfile.kopokopoClientId,
      secretEnc: schema.orgProfile.kopokopoClientSecretEnc,
      apiKeyEnc: schema.orgProfile.kopokopoApiKeyEnc,
    })
    .from(schema.orgProfile)
    .where(eq(schema.orgProfile.organizationId, organizationId))
    .limit(1);
  const p = rows[0];

  if (p?.enabled && p.till && p.clientId && p.secretEnc && p.apiKeyEnc) {
    const appSecret = await getAppSecret();
    const [clientSecret, apiKey] = await Promise.all([
      decryptSecret(p.secretEnc, appSecret),
      decryptSecret(p.apiKeyEnc, appSecret),
    ]);
    if (clientSecret && apiKey) {
      return {
        baseUrl: (p.baseUrl || "https://api.kopokopo.com").replace(/\/$/, ""),
        clientId: p.clientId,
        clientSecret,
        apiKey,
        tillNumber: p.till,
      };
    }
  }

  // Fall back to the platform-level account (DB-managed first, else env).
  return platformKopokopoConfig(db);
}
