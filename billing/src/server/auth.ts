import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { nextCookies } from "better-auth/next-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb, schema } from "./db";

/**
 * better-auth instance, built per request because the D1 binding and secrets
 * are only available inside the Cloudflare request context.
 */
export async function getAuth() {
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
    // organization() adds multi-tenant orgs; nextCookies() MUST be last so
    // Set-Cookie headers from Server Actions are applied.
    plugins: [organization(), nextCookies()],
  });
}

export type Auth = Awaited<ReturnType<typeof getAuth>>;
