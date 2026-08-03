import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { readSessionCookie, type SessionPayload } from "./session";
import type { Role } from "@/db/schema";

/**
 * The Data Access Layer — the real security boundary.
 *
 * Proxy does optimistic checks only (it runs on every route, including
 * prefetches, so it must not touch the database). Auth checks do NOT belong in
 * layouts, because layouts do not re-render on navigation. And `return null` in
 * a component is not a security boundary.
 *
 * So: every Server Action and every data read calls `verifySession()` first.
 * Server Functions are reachable by direct POST, not only through our own UI —
 * treat every one as an untrusted entry point.
 */

export type Session = SessionPayload;

/** Throws (redirects) when there is no session. Use in pages and actions. */
export const verifySession = cache(async (): Promise<Session> => {
  const session = await readSessionCookie();
  if (!session?.userId) redirect("/login");
  return session;
});

/** Non-redirecting variant, for places that must branch rather than bounce. */
export const optionalSession = cache(async (): Promise<Session | null> => {
  return readSessionCookie();
});

/* ---------------------------------------------------------------- */
/* Authorisation                                                     */
/* ---------------------------------------------------------------- */

/**
 * Herdsmen record, the manager approves, the owner reads.
 *
 * Segregation of duties is not decoration here: theft on Kenyan farms
 * concentrates precisely where one person controls a whole transaction, and the
 * documented remedy is dividing the process.
 */
export const CAPABILITIES = {
  /** Record routine capture — milk, feed, heat, observations. */
  RECORD: ["OWNER", "MANAGER", "HERDSMAN", "RIDER"] as Role[],
  /** Record a delivery on the round and take payment. */
  DELIVER: ["OWNER", "MANAGER", "RIDER"] as Role[],
  /** Clinical treatment and pregnancy diagnosis. */
  TREAT: ["OWNER", "MANAGER", "VET"] as Role[],
  /** Breeding decisions — services, dry-off, calving. */
  BREED: ["OWNER", "MANAGER", "VET"] as Role[],
  /** See money at all. Herdsmen never do. */
  VIEW_MONEY: ["OWNER", "MANAGER", "ACCOUNTANT"] as Role[],
  /** Create expenses, purchases, payroll. */
  MANAGE_MONEY: ["OWNER", "MANAGER"] as Role[],
  /** Approve anything staff recorded. Nothing counts until this happens. */
  APPROVE: ["OWNER", "MANAGER"] as Role[],
  /** Change the herd register, staff, customers, prices, reference data. */
  ADMIN: ["OWNER", "MANAGER"] as Role[],
  /** Farm-level settings and user management. */
  OWNER_ONLY: ["OWNER"] as Role[],
} as const;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: Role, capability: Capability): boolean {
  return (CAPABILITIES[capability] as readonly Role[]).includes(role);
}

export class NotPermittedError extends Error {
  constructor(capability: Capability) {
    super(`You do not have permission to do this (${capability}).`);
    this.name = "NotPermittedError";
  }
}

/**
 * The standard opening line of every Server Action:
 *
 *     const session = await requireCapability("RECORD");
 *
 * Returns the session so the caller has `farmId` to scope with, which makes the
 * tenant guard hard to forget.
 */
export async function requireCapability(capability: Capability): Promise<Session> {
  const session = await verifySession();
  if (!can(session.role, capability)) throw new NotPermittedError(capability);
  return session;
}

/* ---------------------------------------------------------------- */
/* Tenant scoping                                                    */
/* ---------------------------------------------------------------- */

/**
 * Zod validates the SHAPE of input; it does not validate OWNERSHIP. A perfectly
 * well-formed UUID can belong to another farm. In a multi-tenant system that
 * check *is* the tenancy boundary, so it never comes from the client.
 *
 * Every query filters on `farmId` explicitly. RLS is the second lock, not the
 * only one.
 */
export function assertOwned<T extends { farmId: string | null }>(
  row: T | undefined | null,
  session: Session,
  what = "record",
): T {
  // farmId is nullable on shared reference rows (the drug catalogue), which
  // every farm may read but none owns.
  if (!row || (row.farmId !== null && row.farmId !== session.farmId)) {
    // Deliberately identical for "missing" and "someone else's" — telling an
    // attacker which one it was leaks the existence of other farms' data.
    throw new Error(`That ${what} was not found.`);
  }
  return row;
}

/** Result shape every Server Action returns, so forms can render uniformly. */
export type ActionResult<T = void> =
  | { ok: true; data: T; refCode?: string; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function actionError(error: string, fieldErrors?: Record<string, string[]>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

export function actionOk<T>(data: T, message?: string, refCode?: string): ActionResult<T> {
  return { ok: true, data, message, refCode };
}

/**
 * Wraps an action body so a thrown error becomes a message a farm worker can
 * read, rather than a stack trace or a silent failure. Errors explain what went
 * wrong; they do not apologise.
 */
export async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err; // redirect/notFound
    const message = err instanceof Error ? err.message : "Something went wrong. Try again.";
    return actionError(message);
  }
}
