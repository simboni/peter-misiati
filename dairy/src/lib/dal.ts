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
  constructor(public readonly capability: Capability) {
    // No capability name in the message. It means nothing to a herdsman, and
    // it hands the permission model to anyone who can POST.
    super("Your work on the farm does not include this. Ask the owner or a manager.");
    this.name = "NotPermittedError";
  }
}

/**
 * Who on this farm could do the thing the caller just could not — by role, in
 * the words the farm uses.
 */
export function whoCan(capability: Capability): string {
  const roles = CAPABILITIES[capability] as readonly Role[];
  const labels = roles.map((r) => ROLE_LABEL[r]);
  if (labels.length === 0) return "nobody on this farm";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
}

const ROLE_LABEL: Record<Role, string> = {
  OWNER: "the owner",
  MANAGER: "a manager",
  ACCOUNTANT: "the bookkeeper",
  HERDSMAN: "a herdsman",
  RIDER: "a rider",
  VET: "the vet",
};

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

/**
 * The same check, for a PAGE rather than a Server Action.
 *
 * A Server Action wants the throw: `guard()` turns it into a sentence the form
 * can show without losing what the user typed. A page has nobody to catch it,
 * so the throw went to the crash boundary and five screens met a herdsman with
 *
 *     This page couldn't load. A server error occurred. [Reload]  ERROR 230055567
 *
 * — one button, reloading into the same wall. That is the `rc=6` failure this
 * product exists to avoid, and it was ours.
 *
 * Four people share one phone here. Opening a page your role cannot use is an
 * ordinary Tuesday, not an error, so it gets a real screen: what this is, that
 * it is not yours, who can do it, and a way back.
 */
export async function requirePageCapability(capability: Capability): Promise<Session> {
  const session = await verifySession();
  if (!can(session.role, capability)) {
    const { forbidden } = await import("next/navigation");
    forbidden();
  }
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
    throw new RefusedError(`That ${what} was not found.`);
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
    if (err && typeof err === "object" && "digest" in err) throw err; // redirect/notFound/forbidden

    // A refusal we wrote is meant to be read. Anything else is a fault, and its
    // message belongs in the log, not on a phone in a milking shed: a raw
    // Postgres string ("duplicate key value violates unique constraint
    // milk_one_per_session_uq") told the herdsman nothing, and it arrived in
    // the same red as a withdrawal warning — so a database constraint looked
    // exactly like "do not sell this milk".
    if (err instanceof NotPermittedError) return actionError(err.message);
    if (err instanceof RefusedError) return actionError(err.message);

    const ref = logFault(err);
    return actionError(
      `That did not save. Nothing was changed — try once more. If it keeps happening, quote ${ref}.`,
    );
  }
}

/**
 * A refusal the user is supposed to read: "A calving is already recorded for
 * Njeri today." Distinct from a fault so that `guard` can tell a sentence we
 * wrote from a stack trace we did not.
 */
export class RefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefusedError";
  }
}

/**
 * Log a fault server-side and hand back a short code the farm can quote.
 *
 * Derived from the error rather than random, so the same fault reported by
 * three people carries the same code and is obviously one problem.
 */
function logFault(err: unknown): string {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const ref = faultRef(detail);
  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      level: "error",
      ref,
      detail,
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
  return ref;
}

const FAULT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function faultRef(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += FAULT_ALPHABET[Math.abs(h >> (i * 5)) % FAULT_ALPHABET.length];
  }
  return `E-${out}`;
}
