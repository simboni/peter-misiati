/**
 * Sessions, PINs and roles.
 *
 * The shop shares one counter phone, so two things matter more than usual:
 *   - every person has their own account, or the audit trail is worthless;
 *   - the owner's view (formulas, cost prices, profit) is gated server-side,
 *     never merely hidden in the UI, because a hidden tab still ships the data.
 */

import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { get, run, audit, type Role, type User } from "./db.ts";
import { hashPin, verifyPin } from "./pin.ts";

const COOKIE = "riziki_session";
const SESSION_HOURS = 12;

// --------------------------------------------------------------- sessions

export function createSession(userId: number): string {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
  run(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`, token, userId, expires);
  return token;
}

export function destroySession(token: string): void {
  run(`DELETE FROM sessions WHERE token = ?`, token);
}

/**
 * The signed-in user, or null. `cookies()` is async in Next.js 16 — synchronous
 * access was removed, so this must be awaited everywhere.
 */
export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  const row = get<User & { expires_at: string }>(
    `SELECT u.id, u.name, u.role, u.active, u.permissions, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`,
    token,
  );
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    destroySession(token);
    return null;
  }
  if (!row.active) return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    active: row.active,
    permissions: row.permissions ?? "",
  };
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) destroySession(token);
  store.delete(COOKIE);
}

// ------------------------------------------------------------------ guards

/** Throws unless someone is signed in. Use at the top of every server action. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new Error("Please sign in to continue.");
  return user;
}

// ------------------------------------------------------------- permissions

/*
  The rules themselves live in `permissions.ts`, which imports nothing from
  Next, so they can be unit-tested and read by a script. Re-exported here
  because a screen asking "may this person" is already importing from auth.
*/
import { PERMISSIONS, can, type Permission } from "./permissions.ts";

export { PERMISSIONS, isPermission, grantedTo, can, type Permission } from "./permissions.ts";

/** The signed-in user, and whether they may. For a page that needs both. */
export async function currentCan(permission: Permission): Promise<boolean> {
  return can(await currentUser(), permission);
}

/**
 * Throws unless the signed-in user may do this.
 *
 * The counterpart of `requireOwner`, and used the same way: at the top of a
 * server action, before anything is read or written.
 */
export async function requirePermission(permission: Permission): Promise<User> {
  const user = await requireUser();
  if (!can(user, permission)) {
    const what = PERMISSIONS.find((p) => p.key === permission)?.label ?? permission;
    throw new Error(`Your account is not allowed to: ${what.toLowerCase()}. Ask the owner.`);
  }
  return user;
}

/**
 * Throws unless the signed-in user is the owner.
 *
 * Guards formulas, cost prices, profit reports and voids. This runs on the
 * server before any such data is read, so a staff session never receives the
 * bytes at all.
 */
export async function requireOwner(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "owner") {
    throw new Error("Only the owner can do this.");
  }
  return user;
}

export async function isOwner(): Promise<boolean> {
  const user = await currentUser();
  return user?.role === "owner";
}

// ------------------------------------------------------------------- login

export function authenticate(userId: number, pin: string): User | null {
  const row = get<User & { pin_hash: string }>(
    `SELECT id, name, role, active, pin_hash FROM users WHERE id = ? AND active = 1`,
    userId,
  );
  if (!row) return null;
  if (!verifyPin(pin, row.pin_hash)) {
    audit(row.id, "login_failed", "user", row.id);
    return null;
  }
  audit(row.id, "login", "user", row.id);
  return { id: row.id, name: row.name, role: row.role, active: row.active };
}

export { hashPin, verifyPin };
export type { Role, User };
