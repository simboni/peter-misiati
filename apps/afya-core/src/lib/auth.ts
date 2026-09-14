/**
 * Server-side session resolution.
 *
 * The only module that bridges the request (a cookie) to the domain (a user).
 * Everything above it works with a resolved user; everything below it — the
 * services in this folder — never sees a cookie and stays unit-testable.
 *
 * Next.js 16: `cookies()` is async. Synchronous access was removed, so every
 * caller here awaits.
 */

import { cookies } from "next/headers";
import { resolveSession, type ActiveSession } from "./users.ts";
import { grantedPermissions, check, type Decision } from "./access.ts";

export const SESSION_COOKIE = "afya_session";

export interface CurrentUser extends ActiveSession {
  /** Permissions the roles grant, before licence and MFA are applied. */
  granted: string[];
}

/** The signed-in user for this request, or null. */
export async function currentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = resolveSession(token);
  if (!session) return null;

  return { ...session, granted: grantedPermissions(session.userId) };
}

/**
 * The signed-in user, or throw.
 *
 * For server actions, where an unauthenticated call is a bug or an attack
 * rather than a state the interface should render.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) throw new Error("You are signed out. Sign in again to continue.");
  return user;
}

/** Capability check for the current request. */
export async function currentCan(permission: string): Promise<Decision> {
  const user = await currentUser();
  if (!user) return { allowed: false, reason: "no-such-user" };
  return check(user.userId, permission);
}
