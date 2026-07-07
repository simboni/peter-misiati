// Augment the Cloudflare bindings available at runtime (via getCloudflareContext)
// with the ones this app declares in wrangler.jsonc.
declare global {
  interface CloudflareEnv {
    DB: D1Database;
    // Secrets / vars (set via `wrangler secret put` or .dev.vars locally)
    BETTER_AUTH_SECRET?: string;
    BETTER_AUTH_URL?: string;
    RESEND_API_KEY?: string;
    RESEND_FROM?: string;
  }
}

export {};
