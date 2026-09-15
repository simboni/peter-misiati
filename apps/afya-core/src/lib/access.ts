/**
 * M01 Identity & Access — roles, permissions and the capability check.
 *
 * The rule that makes this module worth its own file: **a role grants a
 * permission, but a licence decides whether it resolves.**
 *
 * A clinical officer whose council registration lapsed last month still holds
 * the `clinician` role and still looks normal on screen. If the system lets them
 * prescribe, every claim citing that prescription is invalid — and the facility
 * discovers it two months later as a rejection, long after the drugs left the
 * shelf. So an expired licence switches the capability off at the door.
 *
 * The same check carries the MFA obligation. Permissions that move money, touch
 * controlled drugs or administer users require a second factor; holding the role
 * without the factor does not grant the capability.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, today } from "./db.ts";

export class AccessError extends Error {}

export interface PermissionRow {
  code: string;
  description: string;
  requires_licence: number;
  requires_mfa: number;
}

/**
 * Why a capability check came out the way it did.
 *
 * The reason is part of the contract, not a debugging aid: the UI has to tell a
 * clinician "your licence expired on 4 August", never a bare "not permitted",
 * or they will assume the system is broken and find a way around it.
 */
export type Decision =
  | { allowed: true }
  | { allowed: false; reason: "no-such-user" }
  | { allowed: false; reason: "inactive" }
  | { allowed: false; reason: "not-granted" }
  | { allowed: false; reason: "licence-missing"; regulator: string }
  | { allowed: false; reason: "licence-expired"; regulator: string; expiredOn: string }
  | { allowed: false; reason: "mfa-required" }
  | { allowed: false; reason: "mfa-stale" };

/** Human-readable text for a denial — used directly in the interface. */
export function explain(d: Decision): string {
  if (d.allowed) return "Permitted.";
  switch (d.reason) {
    case "no-such-user":
      return "That account does not exist.";
    case "inactive":
      return "That account has been deactivated.";
    case "not-granted":
      return "Your role does not include this.";
    case "licence-missing":
      return `This needs a current ${d.regulator} licence on file. None is recorded against your account.`;
    case "licence-expired":
      return `Your ${d.regulator} licence expired on ${d.expiredOn}. It must be renewed before you can do this — claims citing an expired licence are rejected.`;
    case "mfa-required":
      return "This needs two-factor authentication enabled on your account.";
    case "mfa-stale":
      return "Confirm the code from your authenticator app to continue.";
  }
}

// ------------------------------------------------------------------ catalogue

export function listPermissions(): PermissionRow[] {
  return all<PermissionRow>(`SELECT * FROM permissions ORDER BY code`);
}

export function permissionsForRole(roleCode: string): string[] {
  return all<{ permission_code: string }>(
    `SELECT permission_code FROM role_permissions WHERE role_code = ? ORDER BY permission_code`,
    roleCode,
  ).map((r) => r.permission_code);
}

export function rolesForUser(userId: number): string[] {
  return all<{ role_code: string }>(
    `SELECT role_code FROM user_roles WHERE user_id = ? ORDER BY role_code`,
    userId,
  ).map((r) => r.role_code);
}

/** Every permission a user's roles grant, before licence and MFA are applied. */
export function grantedPermissions(userId: number): string[] {
  return all<{ permission_code: string }>(
    `SELECT DISTINCT rp.permission_code
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_code = ur.role_code
      WHERE ur.user_id = ?
      ORDER BY rp.permission_code`,
    userId,
  ).map((r) => r.permission_code);
}

// ------------------------------------------------------------- the check

interface UserBits {
  id: number;
  active: number;
  cadre_code: string | null;
  mfa_secret: string | null;
}

/**
 * The current licence for a user, or the most recently expired one.
 *
 * Returns the expired licence rather than nothing so the denial can name the
 * date — telling someone *when* it lapsed is the difference between them
 * renewing it and them phoning support.
 */
export function licenceStatus(
  userId: number,
  asOf = today(),
): { state: "current" | "expired" | "none"; regulator: string; number?: string; expiresOn?: string } {
  const current = get<{ regulator: string; licence_number: string; expires_on: string }>(
    `SELECT regulator, licence_number, expires_on
       FROM practitioner_licences
      WHERE user_id = ? AND expires_on >= ?
      ORDER BY expires_on DESC LIMIT 1`,
    userId,
    asOf,
  );
  if (current) {
    return {
      state: "current",
      regulator: current.regulator,
      number: current.licence_number,
      expiresOn: current.expires_on,
    };
  }

  const lapsed = get<{ regulator: string; licence_number: string; expires_on: string }>(
    `SELECT regulator, licence_number, expires_on
       FROM practitioner_licences
      WHERE user_id = ?
      ORDER BY expires_on DESC LIMIT 1`,
    userId,
  );
  if (lapsed) {
    return {
      state: "expired",
      regulator: lapsed.regulator,
      number: lapsed.licence_number,
      expiresOn: lapsed.expires_on,
    };
  }

  const cadre = get<{ regulator: string }>(
    `SELECT c.regulator FROM users u JOIN cadres c ON c.code = u.cadre_code WHERE u.id = ?`,
    userId,
  );
  return { state: "none", regulator: cadre?.regulator ?? "professional" };
}

/**
 * Can this user do this thing, right now?
 *
 * Order matters. Account state first, then the grant, then licence, then MFA —
 * so the reason returned is the first real obstacle rather than an incidental
 * one, and the person is told the thing they can actually act on.
 */
export function check(
  userId: number,
  permission: string,
  asOf = today(),
  /**
   * The session asking. Pass it wherever it is known: an MFA-gated permission
   * then requires a code proved on that session inside the step-up window,
   * not merely an enrolled account. Omit it — `undefined` — and only enrolment
   * is checked, which is the honest answer to "could this person, in
   * principle, do this?" for a worklist or a menu.
   */
  sessionToken?: string | null,
): Decision {
  const user = get<UserBits>(`SELECT id, active, cadre_code, mfa_secret FROM users WHERE id = ?`, userId);
  if (!user) return { allowed: false, reason: "no-such-user" };
  if (!user.active) return { allowed: false, reason: "inactive" };

  const perm = get<PermissionRow>(`SELECT * FROM permissions WHERE code = ?`, permission);
  if (!perm) {
    // An unknown permission is a programming error, not a denial. Failing loudly
    // here stops a typo in a permission name from silently granting access.
    throw new AccessError(`unknown permission "${permission}"`);
  }

  if (!grantedPermissions(userId).includes(permission)) {
    return { allowed: false, reason: "not-granted" };
  }

  if (perm.requires_licence) {
    const licence = licenceStatus(userId, asOf);
    if (licence.state === "none") {
      return { allowed: false, reason: "licence-missing", regulator: licence.regulator };
    }
    if (licence.state === "expired") {
      return {
        allowed: false,
        reason: "licence-expired",
        regulator: licence.regulator,
        expiredOn: licence.expiresOn!,
      };
    }
  }

  if (perm.requires_mfa) {
    if (!user.mfa_secret) return { allowed: false, reason: "mfa-required" };

    // Enrolment alone is not the protection. When the caller knows which
    // session is asking, a code must have been proved on it recently —
    // otherwise a machine left signed in at a counter can dispense a
    // controlled drug an hour after the pharmacist walked away.
    if (sessionToken !== undefined && !mfaIsFresh(sessionToken)) {
      return { allowed: false, reason: "mfa-stale" };
    }
  }

  return { allowed: true };
}

/**
 * How long a proved second factor stays good on a session.
 *
 * Long enough not to re-authenticate for every item in one dispensing round;
 * short enough that walking away ends it.
 */
export const MFA_WINDOW_MINUTES = 15;

function mfaIsFresh(token: string | null): boolean {
  if (!token) return false;
  const row = get<{ mfa_verified_at: string | null; ended_at: string | null }>(
    `SELECT mfa_verified_at, ended_at FROM sessions WHERE token = ?`,
    token,
  );
  if (!row || row.ended_at || !row.mfa_verified_at) return false;
  return Date.now() - Date.parse(row.mfa_verified_at) < MFA_WINDOW_MINUTES * 60_000;
}

/** Convenience wrapper for call sites that only need a boolean. */
export function can(userId: number, permission: string, asOf = today()): boolean {
  return check(userId, permission, asOf).allowed;
}

/**
 * Assert a capability, throwing if absent.
 *
 * Every server action calls this before doing work. A denial is audited: an
 * attempt to reach something you are not entitled to is exactly the event an
 * investigator comes looking for.
 */
export function requirePermission(
  userId: number,
  permission: string,
  context?: { actorName?: string; facilityId?: number; patientId?: string },
): void {
  const decision = check(userId, permission);
  if (decision.allowed) return;

  audit({
    action: "access_denied",
    entity: "permission",
    entityId: permission,
    actorId: userId,
    actorName: context?.actorName ?? `user:${userId}`,
    facilityId: context?.facilityId ?? null,
    patientId: context?.patientId ?? null,
    purpose: "audit",
    detail: { permission, reason: decision.reason },
  });

  throw new AccessError(explain(decision));
}

// ------------------------------------------------------------- administration

export function defineRole(input: {
  code: string;
  name: string;
  description?: string;
  permissions: string[];
  system?: boolean;
  byUserId?: number | null;
  byUserName?: string;
}): void {
  for (const p of input.permissions) {
    if (!get<{ code: string }>(`SELECT code FROM permissions WHERE code = ?`, p)) {
      throw new AccessError(`unknown permission "${p}"`);
    }
  }

  tx(() => {
    run(
      `INSERT INTO roles (code, name, description, system) VALUES (?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET name = excluded.name, description = excluded.description`,
      input.code,
      input.name,
      input.description ?? "",
      input.system ? 1 : 0,
    );
    run(`DELETE FROM role_permissions WHERE role_code = ?`, input.code);
    for (const p of input.permissions) {
      run(`INSERT INTO role_permissions (role_code, permission_code) VALUES (?, ?)`, input.code, p);
    }
    audit({
      action: "role_defined",
      entity: "role",
      entityId: input.code,
      actorId: input.byUserId ?? null,
      actorName: input.byUserName ?? "system",
      purpose: "administration",
      detail: { role: input.code, permissions: input.permissions },
    });
  });
}

export function definePermission(input: {
  code: string;
  description: string;
  requiresLicence?: boolean;
  requiresMfa?: boolean;
}): void {
  run(
    `INSERT INTO permissions (code, description, requires_licence, requires_mfa) VALUES (?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       description = excluded.description,
       requires_licence = excluded.requires_licence,
       requires_mfa = excluded.requires_mfa`,
    input.code,
    input.description,
    input.requiresLicence ? 1 : 0,
    input.requiresMfa ? 1 : 0,
  );
}
