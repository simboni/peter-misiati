import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { getAuth } from "./auth";
import { getDb, schema, type DB } from "./db";
import { ownerEmails } from "./config";
import { isPro } from "@/lib/plan";

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
 * One query that resolves everything an authenticated request needs: the
 * caller's memberships joined with each org's name, plan and suspended flag,
 * plus the user's platform-admin flags. Collapsing member + organization +
 * orgProfile + user into a single round-trip (instead of four sequential ones)
 * is what makes ordinary pages — new client, settings, dashboard — load fast.
 * Cached per request so requireOrg() and the app shell share the same fetch.
 */
const orgBundle = cache(async () => {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  const user = session.user as SessionUser;
  const db = await getDb();

  const rows = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
      orgName: schema.organization.name,
      plan: schema.orgProfile.plan,
      suspended: schema.orgProfile.suspended,
      isPlatformAdmin: schema.user.isPlatformAdmin,
      isSuperAdmin: schema.user.isSuperAdmin,
      disabled: schema.user.disabled,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .leftJoin(schema.orgProfile, eq(schema.orgProfile.organizationId, schema.member.organizationId))
    .where(eq(schema.member.userId, user.id));
  if (rows.length === 0) redirect("/onboarding");

  const activeId = session.session.activeOrganizationId ?? undefined;
  const active = (activeId ? rows.find((r) => r.organizationId === activeId) : undefined) ?? rows[0];

  // Block a user an admin has disabled (offboarded / compromised account) from
  // all authenticated pages and actions — not just the admin link.
  if (active.disabled) redirect("/suspended");
  // Block access to a workspace an admin has suspended.
  if (active.suspended) redirect("/suspended");

  return { db, user, active };
});

/**
 * The tenancy guard. EVERY authenticated data page/action starts here so that
 * queries are scoped to exactly one organization. Redirects to /login when not
 * signed in and /onboarding when the user has no organization yet.
 */
export const requireOrg = cache(async (): Promise<OrgContext> => {
  const b = await orgBundle();
  return {
    db: b.db,
    userId: b.user.id,
    user: b.user,
    organizationId: b.active.organizationId,
    role: b.active.role,
  };
});

/**
 * Everything the app shell (sidebar/header) needs — org name, plan, admin
 * link — served entirely from the cached orgBundle, so the layout adds ZERO
 * extra database round-trips on top of requireOrg. Owners listed in
 * OWNER_EMAILS see the admin link before their first /admin visit promotes them.
 */
export async function appShellContext() {
  const b = await orgBundle();
  const isOwner = (await ownerEmails()).includes(b.user.email.toLowerCase());
  return {
    orgName: b.active.orgName ?? "Workspace",
    userEmail: b.user.email,
    pro: isPro(b.active.plan ?? undefined),
    isAdmin: !b.active.disabled && Boolean(b.active.isSuperAdmin || b.active.isPlatformAdmin || isOwner),
  };
}

// Request-cached by orgId so the layout, the page, and requireOrg's suspended
// check all share a single query instead of re-fetching the profile 3×.
const orgProfileById = cache(async (organizationId: string) => {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.orgProfile)
    .where(eq(schema.orgProfile.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
});

/** Load the org's accounting profile (name, KRA PIN, VAT settings, branding). */
export async function getOrgProfile(_db: DB, organizationId: string) {
  return orgProfileById(organizationId);
}

/** Count seats (members) in an org — used for per-user Pro pricing. */
export async function countSeats(db: DB, organizationId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(eq(schema.member.organizationId, organizationId));
  return Math.max(1, rows.length);
}

// Request-cached by orgId so the layout and page don't both fetch it.
const orgById = cache(async (organizationId: string) => {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return rows[0] ?? null;
});

/** Load org name from the organization table. */
export async function getOrg(_db: DB, organizationId: string) {
  return orgById(organizationId);
}

export { and, eq };
