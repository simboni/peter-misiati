import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";

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

/**
 * Public base URL of the app (for building share + callback links). Prefers the
 * configured BETTER_AUTH_URL, but when that's unset (or points at localhost) it
 * derives the real origin from the incoming request — so links never leak
 * "localhost" in production. Falls back to the canonical domain as a last resort.
 */
export async function appBaseUrl(): Promise<string> {
  const env = await getEnv();
  const configured = env.BETTER_AUTH_URL?.replace(/\/$/, "");
  if (configured && !configured.includes("localhost")) return configured;

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
      return `${proto}://${host}`.replace(/\/$/, "");
    }
  } catch {
    // headers() is unavailable outside a request scope — fall through.
  }
  return configured || "https://tallypay.co.ke";
}

/** Whether the Cloudflare Browser Rendering binding is available (PDF export). */
export async function browserEnabled(): Promise<boolean> {
  const env = await getEnv();
  return Boolean(env.BROWSER);
}

/** App secret used to derive the AES-GCM key for encrypting stored secrets. */
export async function appSecret(): Promise<string> {
  const env = await getEnv();
  return env.BETTER_AUTH_SECRET || "dev-secret-please-change-in-production";
}

/** Emails (lowercased) that bootstrap as platform super-admins on login. */
export async function ownerEmails(): Promise<string[]> {
  const env = await getEnv();
  const raw = env.OWNER_EMAILS ?? process.env.OWNER_EMAILS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
