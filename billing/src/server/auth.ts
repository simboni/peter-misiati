import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { nextCookies } from "better-auth/next-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cache } from "react";
import { getDb, schema } from "./db";

/**
 * better-auth instance. The D1 binding and secrets only exist inside the
 * Cloudflare request context, so it's built there — but memoised per request
 * (React cache) so we don't rebuild the whole instance on every helper call.
 */
export const getAuth = cache(async () => {
  const { env } = await getCloudflareContext({ async: true });
  const db = await getDb();

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret: env.BETTER_AUTH_SECRET ?? "dev-secret-please-change-in-production",
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
});

export type Auth = Awaited<ReturnType<typeof getAuth>>;
