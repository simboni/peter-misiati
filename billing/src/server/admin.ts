import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { getSession } from "./org";
import { getDb, schema, type DB } from "./db";
import { ownerEmails } from "./config";
import type { User } from "./db/schema";

export type AdminContext = {
  db: DB;
  user: User;
  isSuper: boolean;
};

/**
 * Resolve the current admin, or null if the caller isn't a platform admin.
 *
 * Bootstrap: any signed-in user whose email is in OWNER_EMAILS is promoted to
 * super-admin on the spot. This is how the very first admin is created without
 * touching the database — after that, super-admins appoint others from the UI.
 */
export const getAdminContext = cache(async (): Promise<AdminContext | null> => {
  const session = await getSession();
  if (!session?.user) return null;

  const db = await getDb();
  const rows = await db.select().from(schema.user).where(eq(schema.user.id, session.user.id)).limit(1);
  let u = rows[0];
  if (!u || u.disabled) return null;

  const owners = await ownerEmails();
  if (owners.includes(u.email.toLowerCase()) && !u.isSuperAdmin) {
    await db
      .update(schema.user)
      .set({ isSuperAdmin: true, isPlatformAdmin: true, updatedAt: new Date() })
      .where(eq(schema.user.id, u.id));
    await audit(db, { id: u.id, email: u.email }, "admin.bootstrap", {
      targetType: "user",
      targetId: u.id,
      targetLabel: u.email,
      detail: "Auto-promoted to super-admin from OWNER_EMAILS",
    });
    u = { ...u, isSuperAdmin: true, isPlatformAdmin: true };
  }

  if (!u.isPlatformAdmin && !u.isSuperAdmin) return null;
  return { db, user: u, isSuper: u.isSuperAdmin };
});

/** Guard for admin pages/actions. Redirects non-admins away. */
export async function requireAdmin(): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx) {
    const session = await getSession();
    redirect(session?.user ? "/dashboard" : "/login");
  }
  return ctx;
}

/** Guard for super-admin-only actions (appoint admins, money settings). */
export async function requireSuperAdmin(): Promise<AdminContext> {
  const ctx = await requireAdmin();
  if (!ctx.isSuper) redirect("/admin");
  return ctx;
}

/** Append an entry to the admin audit log. */
export async function audit(
  db: DB,
  actor: { id: string; email: string },
  action: string,
  opts: { targetType?: string; targetId?: string; targetLabel?: string; detail?: string } = {},
): Promise<void> {
  await db.insert(schema.adminAuditLog).values({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action,
    targetType: opts.targetType ?? null,
    targetId: opts.targetId ?? null,
    targetLabel: opts.targetLabel ?? null,
    detail: opts.detail ?? null,
  });
}
