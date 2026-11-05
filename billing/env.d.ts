// Types for the environment variables this app reads at runtime. Self-hosted
// on Node, so these are plain process.env values (set from the compose file /
// .env on the server). See src/server/config.ts for how they are consumed.

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /** libSQL/SQLite connection string, e.g. file:/data/tallypay.db */
      DATABASE_URL?: string;
      DATABASE_AUTH_TOKEN?: string;
      BETTER_AUTH_SECRET?: string;
      BETTER_AUTH_URL?: string;
      RESEND_API_KEY?: string;
      RESEND_FROM?: string;
      /** Kopo Kopo (M-Pesa STK push) — platform-level for the pilot */
      KOPOKOPO_BASE_URL?: string;
      KOPOKOPO_CLIENT_ID?: string;
      KOPOKOPO_CLIENT_SECRET?: string;
      KOPOKOPO_API_KEY?: string;
      KOPOKOPO_TILL_NUMBER?: string;
      /** Absolute path to a Chromium binary; its presence enables PDF export. */
      CHROMIUM_PATH?: string;
      /** Comma-separated emails that bootstrap as platform super-admins. */
      OWNER_EMAILS?: string;
    }
  }
}

export {};
