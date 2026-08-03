// Augment the Cloudflare bindings available at runtime (via getCloudflareContext)
// with the ones this app declares in wrangler.jsonc.
import type { BrowserWorker } from "@cloudflare/puppeteer";

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    // Cloudflare Browser Rendering binding (optional) — enables PDF generation.
    BROWSER?: BrowserWorker;
    // Secrets / vars (set via `wrangler secret put` or .dev.vars locally)
    BETTER_AUTH_SECRET?: string;
    BETTER_AUTH_URL?: string;
    RESEND_API_KEY?: string;
    RESEND_FROM?: string;
    // Kopo Kopo (M-Pesa STK push) — platform-level for the pilot
    KOPOKOPO_BASE_URL?: string; // default https://sandbox.kopokopo.com
    KOPOKOPO_CLIENT_ID?: string;
    KOPOKOPO_CLIENT_SECRET?: string;
    KOPOKOPO_API_KEY?: string; // used to verify webhook signatures
    KOPOKOPO_TILL_NUMBER?: string;
    // Comma-separated emails that bootstrap as platform super-admins on login.
    OWNER_EMAILS?: string;
  }
}

export {};
