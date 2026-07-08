import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { getAuth } from "./auth";
import { getDb, schema, type DB } from "./db";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

/** Current better-auth session (or null). Deduped per request via React cache. */
export const getSession = cache(async () => {
  const auth = await getAuth();
  return auth.api.getSession({ headers: await headers() });
});

/** Require a logged-in user; redirect to /login otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  return session.user as SessionUser;
}

export type OrgContext = {
  db: DB;
  userId: string;
  user: SessionUser;
  organizationId: string;
  role: string;
};

/**
 * The tenancy guard. EVERY authenticated data page/action starts here so that
 * queries are scoped to exactly one organization. Redirects to /login when not
 * signed in and /onboarding when the user has no organization yet.
 *
 * Org is resolved from the `member` table (never trusting client input), using
 * the session's active org when set, else the user's first membership.
 */
export async function requireOrg(): Promise<OrgContext> {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  const user = session.user as SessionUser;
  const db = await getDb();

  const memberships = await db
    .select()
    .from(schema.member)
    .where(eq(schema.member.userId, user.id));
  if (memberships.length === 0) redirect("/onboarding");

  const activeId = session.session.activeOrganizationId ?? undefined;
  const active =
    (activeId && memberships.find((m) => m.organizationId === activeId)) || memberships[0];

  return {
    db,
    userId: user.id,
    user,
    organizationId: active.organizationId,
    role: active.role,
  };
}

/** Load the org's accounting profile (name, KRA PIN, VAT settings, branding). */
export async function getOrgProfile(db: DB, organizationId: string) {
  const rows = await db
    .select()
    .from(schema.orgProfile)
    .where(eq(schema.orgProfile.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/** Count seats (members) in an org — used for per-user Pro pricing. */
export async function countSeats(db: DB, organizationId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(eq(schema.member.organizationId, organizationId));
  return Math.max(1, rows.length);
}

/** Load org name from the organization table. */
export async function getOrg(db: DB, organizationId: string) {
  const rows = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export { and, eq };
