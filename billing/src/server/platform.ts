import { eq } from "drizzle-orm";
import { schema, type DB } from "./db";
import {
  appSecret,
  kopokopoConfig,
  resendConfig,
  type KopoKopoConfig,
  type ResendConfig,
} from "./config";
import { decryptSecret } from "./crypto";
import type { PlatformSettings } from "./db/schema";

const SINGLETON = "singleton";

/**
 * The single platform-settings row, creating it with defaults on first read so
 * the admin console always has something to edit.
 */
export async function getPlatformSettings(db: DB): Promise<PlatformSettings> {
  const rows = await db
    .select()
    .from(schema.platformSettings)
    .where(eq(schema.platformSettings.id, SINGLETON))
    .limit(1);
  if (rows[0]) return rows[0];

  await db
    .insert(schema.platformSettings)
    .values({ id: SINGLETON })
    .onConflictDoNothing();
  const again = await db
    .select()
    .from(schema.platformSettings)
    .where(eq(schema.platformSettings.id, SINGLETON))
    .limit(1);
  return again[0];
}

/** Per-seat Pro price (whole KES), from platform settings. */
export async function platformPricePerSeatKes(db: DB): Promise<number> {
  const s = await getPlatformSettings(db);
  return s.pricePerSeatKes;
}

/**
 * Platform-fallback Kopo Kopo config: the DB-managed account first (decrypted),
 * else the env credentials, else null. This is what a vendor without their own
 * account collects through.
 */
export async function platformKopokopoConfig(db: DB): Promise<KopoKopoConfig | null> {
  const s = await getPlatformSettings(db);
  if (s.kopokopoEnabled && s.kopokopoTill && s.kopokopoClientId && s.kopokopoClientSecretEnc && s.kopokopoApiKeyEnc) {
    const secret = await appSecret();
    const [clientSecret, apiKey] = await Promise.all([
      decryptSecret(s.kopokopoClientSecretEnc, secret),
      decryptSecret(s.kopokopoApiKeyEnc, secret),
    ]);
    if (clientSecret && apiKey) {
      return {
        baseUrl: (s.kopokopoBaseUrl || "https://api.kopokopo.com").replace(/\/$/, ""),
        clientId: s.kopokopoClientId,
        clientSecret,
        apiKey,
        tillNumber: s.kopokopoTill,
      };
    }
  }
  return kopokopoConfig();
}

/** Platform email (Resend): DB-managed key first, else env. */
export async function platformResendConfig(db: DB): Promise<ResendConfig | null> {
  const s = await getPlatformSettings(db);
  if (s.resendApiKeyEnc) {
    const apiKey = await decryptSecret(s.resendApiKeyEnc, await appSecret());
    if (apiKey) {
      return { apiKey, from: s.resendFrom || "Billing <onboarding@resend.dev>" };
    }
  }
  return resendConfig();
}
