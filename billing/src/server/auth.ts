import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { nextCookies } from "better-auth/next-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb, schema } from "./db";

// Building a better-auth instance is EXPENSIVE — it compiles every auth route
// and initialises the Drizzle adapter + organization plugin. Its inputs (the
// D1 binding, the secret, the base URL) are identical for every request and
// every tenant, so we build it exactly once per V8 isolate and reuse it. A
// per-request React cache() only dedupes within a single request and left the
// full construction cost on the critical path of every page load — including
// onboarding — which is what made the app feel slow.
// Inferred from buildAuth() so the organization plugin's augmented API
// (createOrganization, setActiveOrganization, …) is preserved for callers.
let authPromise: ReturnType<typeof buildAuth> | null = null;

/** The shared, isolate-wide better-auth instance (built lazily, once). */
export function getAuth() {
  // If construction fails (e.g. binding not ready), clear the cache so the
  // next request retries instead of being stuck with a rejected promise.
  return (authPromise ??= buildAuth().catch((err) => {
    authPromise = null;
    throw err;
  }));
}

async function buildAuth() {
  const { env } = await getCloudflareContext({ async: true });
  const db = await getDb();

  const baseURL = env.BETTER_AUTH_URL ?? "http://localhost:3000";
  // Fail CLOSED: without a real secret, session cookies would be signed with a
  // public constant — anyone could forge a session for any user. Never fall
  // back to a hardcoded value in a deployed app.
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET is not set (or under 32 chars); refusing to start auth with a fallback secret.");
  }

  return betterAuth({
    baseURL,
    secret,
    // Lock CSRF/redirect handling to known hosts rather than relying on the
    // baseURL alone (which collapses to localhost if BETTER_AUTH_URL is unset).
    trustedOrigins: [
      "https://tallypay.co.ke",
      "https://www.tallypay.co.ke",
      "https://billing-platform.misiatipeter.workers.dev",
    ],
    // Throttle auth endpoints (sign-in/up/change) to blunt brute-force and
    // enumeration. Note: on Workers this in-memory limiter is per-isolate;
    // Cloudflare WAF rate-limiting rules on /api/auth/* are the production-grade
    // layer (see docs/security.md).
    rateLimit: { enabled: true, window: 10, max: 50 },
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      minPasswordLength: 8,
    },
    session: {
      // Cache the session in a short-lived signed cookie so most requests
      // validate the session without a database round-trip. The DB is still
      // the source of truth and is re-read after maxAge (or on sign-out).
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    // organization() adds multi-tenant orgs; nextCookies() MUST be last so
    // Set-Cookie headers from Server Actions are applied.
    plugins: [organization(), nextCookies()],
  });
}

export type Auth = Awaited<ReturnType<typeof getAuth>>;
