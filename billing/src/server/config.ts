import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function getEnv(): Promise<CloudflareEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env;
}

export type KopoKopoConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  apiKey: string;
  tillNumber: string;
};

/** Kopo Kopo config, or null when the platform hasn't set the secrets yet. */
export async function kopokopoConfig(): Promise<KopoKopoConfig | null> {
  const env = await getEnv();
  if (
    !env.KOPOKOPO_CLIENT_ID ||
    !env.KOPOKOPO_CLIENT_SECRET ||
    !env.KOPOKOPO_API_KEY ||
    !env.KOPOKOPO_TILL_NUMBER
  ) {
    return null;
  }
  return {
    baseUrl: (env.KOPOKOPO_BASE_URL || "https://sandbox.kopokopo.com").replace(/\/$/, ""),
    clientId: env.KOPOKOPO_CLIENT_ID,
    clientSecret: env.KOPOKOPO_CLIENT_SECRET,
    apiKey: env.KOPOKOPO_API_KEY,
    tillNumber: env.KOPOKOPO_TILL_NUMBER,
  };
}

export type ResendConfig = { apiKey: string; from: string };

/** Resend config, or null when no key is set (falls back to copy-link/WhatsApp). */
export async function resendConfig(): Promise<ResendConfig | null> {
  const env = await getEnv();
  if (!env.RESEND_API_KEY) return null;
  return { apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM || "Billing <onboarding@resend.dev>" };
}

/** Public base URL of the app (for building share + callback links). */
export async function appBaseUrl(): Promise<string> {
  const env = await getEnv();
  return (env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** Whether the Cloudflare Browser Rendering binding is available (PDF export). */
export async function browserEnabled(): Promise<boolean> {
  const env = await getEnv();
  return Boolean(env.BROWSER);
}
