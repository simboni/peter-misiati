/**
 * M01 Identity & Access — accounts, practitioner licences and sessions.
 *
 * Two rules here are load-bearing and easy to erode under pressure:
 *
 *  1. NO SHARED LOGINS. Enforced by a unique username per facility and by the
 *     fact that nothing else identifies a user. When a clinic is busy the
 *     temptation is a "reception" account everyone knows; that single change
 *     would make the audit trail worthless and every record access an
 *     unattributable disclosure under the Data Protection Act.
 *
 *  2. THE FACILITY CANNOT LOCK ITSELF OUT. The last active administrator cannot
 *     be deactivated or stripped of the role. A clinic that loses administrative
 *     access loses its own tariffs, users and claim configuration, mid-week,
 *     with patients in the corridor.
 *
 * Licences live here rather than in access.ts because they are a record about a
 * person; access.ts only *reads* them to decide capability.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { hashPassword, verifyPassword, isShippedPassword } from "./passwords.ts";
import { mintToken } from "./ids.ts";
import { activeDevice, daysBetween, getSettingNumber } from "./facility.ts";
import { rolesForUser } from "./access.ts";
import { generateSecret, enrolmentUri, verifyCode } from "./totp.ts";

export class UserError extends Error {}

export interface UserRow {
  id: number;
  facility_id: number;
  name: string;
  username: string;
  cadre_code: string | null;
  active: number;
  must_change_pw: number;
  last_login_at: string | null;
  created_at: string;
}

const PUBLIC_COLUMNS = `id, facility_id, name, username, cadre_code, active, must_change_pw, last_login_at, created_at`;

/** Default session lifetime. A consulting-room screen left open is a disclosure. */
const DEFAULT_SESSION_MINUTES = 30;

// -------------------------------------------------------------------- cadres

export interface Cadre {
  code: string;
  name: string;
  regulator: string;
  licensed: number;
}

export function listCadres(): Cadre[] {
  return all<Cadre>(`SELECT * FROM cadres ORDER BY name`);
}

// ------------------------------------------------------------------ accounts

export function createUser(input: {
  facilityId: number;
  name: string;
  username: string;
  password: string;
  cadreCode?: string | null;
  roles?: string[];
  mustChangePassword?: boolean;
  byUserId?: number | null;
  byUserName?: string;
}): number {
  const name = input.name.trim();
  const username = input.username.trim().toLowerCase();

  if (!name) throw new UserError("name is required");
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new UserError("username must be 3-32 characters: letters, digits, dot, underscore or hyphen");
  }
  if (get<{ id: number }>(`SELECT id FROM users WHERE facility_id = ? AND username = ?`, input.facilityId, username)) {
    throw new UserError(`username "${username}" is already taken — accounts are never shared`);
  }
  if (input.cadreCode && !get<{ code: string }>(`SELECT code FROM cadres WHERE code = ?`, input.cadreCode)) {
    throw new UserError(`unknown cadre "${input.cadreCode}"`);
  }

  // hashPassword asserts strength and throws before anything is written.
  const passwordHash = hashPassword(input.password);

  return tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO users (facility_id, name, username, password_hash, cadre_code, must_change_pw, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.facilityId,
      name,
      username,
      passwordHash,
      input.cadreCode ?? null,
      input.mustChangePassword ? 1 : 0,
      now(),
    );

    for (const role of input.roles ?? []) {
      if (!get<{ code: string }>(`SELECT code FROM roles WHERE code = ?`, role)) {
        throw new UserError(`unknown role "${role}"`);
      }
      run(`INSERT INTO user_roles (user_id, role_code) VALUES (?, ?)`, lastInsertRowid, role);
    }

    audit({
      action: "user_created",
      entity: "user",
      entityId: lastInsertRowid,
      facilityId: input.facilityId,
      actorId: input.byUserId ?? null,
      actorName: input.byUserName ?? "system",
      purpose: "administration",
      // Note what is absent: the password never reaches the audit log.
      detail: { name, username, cadre: input.cadreCode ?? null, roles: input.roles ?? [] },
    });

    return lastInsertRowid;
  });
}

export function getUser(id: number): UserRow | undefined {
  return get<UserRow>(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, id);
}

export function listUsers(facilityId: number): UserRow[] {
  return all<UserRow>(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE facility_id = ? ORDER BY name`, facilityId);
}

/** Active administrators, used to stop the facility locking itself out. */
function activeAdministrators(facilityId: number): number[] {
  return all<{ id: number }>(
    `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
      WHERE u.facility_id = ? AND u.active = 1 AND ur.role_code = 'administrator'`,
    facilityId,
  ).map((r) => r.id);
}

export function setActive(input: {
  userId: number;
  active: boolean;
  byUserId: number | null;
  byUserName: string;
  reason?: string;
}): void {
  const user = get<UserRow>(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, input.userId);
  if (!user) throw new UserError("no such user");

  if (input.userId === input.byUserId && !input.active) {
    throw new UserError("you cannot deactivate your own account");
  }

  if (!input.active) {
    const admins = activeAdministrators(user.facility_id);
    if (admins.length === 1 && admins[0] === input.userId) {
      throw new UserError(
        "this is the last active administrator — deactivating it would lock the facility out of its own configuration",
      );
    }
  }

  tx(() => {
    run(`UPDATE users SET active = ? WHERE id = ?`, input.active ? 1 : 0, input.userId);
    // Deactivation must end sessions immediately, or the person keeps working
    // until their token happens to expire.
    if (!input.active) {
      run(`UPDATE sessions SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL`, now(), input.userId);
    }
    audit({
      action: input.active ? "user_reactivated" : "user_deactivated",
      entity: "user",
      entityId: input.userId,
      facilityId: user.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { username: user.username, reason: input.reason ?? "" },
    });
  });
}

export function assignRoles(input: {
  userId: number;
  roles: string[];
  byUserId: number | null;
  byUserName: string;
}): void {
  const user = get<UserRow>(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, input.userId);
  if (!user) throw new UserError("no such user");

  for (const role of input.roles) {
    if (!get<{ code: string }>(`SELECT code FROM roles WHERE code = ?`, role)) {
      throw new UserError(`unknown role "${role}"`);
    }
  }

  const losingAdmin = rolesForUser(input.userId).includes("administrator") && !input.roles.includes("administrator");
  if (losingAdmin) {
    const admins = activeAdministrators(user.facility_id);
    if (admins.length === 1 && admins[0] === input.userId) {
      throw new UserError("this is the last active administrator — the role cannot be removed");
    }
  }

  tx(() => {
    run(`DELETE FROM user_roles WHERE user_id = ?`, input.userId);
    for (const role of input.roles) {
      run(`INSERT INTO user_roles (user_id, role_code) VALUES (?, ?)`, input.userId, role);
    }
    audit({
      action: "user_roles_changed",
      entity: "user",
      entityId: input.userId,
      facilityId: user.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { username: user.username, roles: input.roles },
    });
  });
}

export function changePassword(input: {
  userId: number;
  newPassword: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const user = get<UserRow>(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, input.userId);
  if (!user) throw new UserError("no such user");

  const hash = hashPassword(input.newPassword);

  tx(() => {
    run(`UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?`, hash, input.userId);
    // A password change ends other sessions: if it was changed because the old
    // one leaked, leaving those sessions open defeats the point.
    run(`UPDATE sessions SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL`, now(), input.userId);
    audit({
      action: "password_changed",
      entity: "user",
      entityId: input.userId,
      facilityId: user.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { username: user.username, self: input.userId === input.byUserId },
    });
  });
}

/**
 * Begin enrolling a second factor.
 *
 * Returns the secret and the `otpauth://` URI for the authenticator app to
 * scan. Nothing is stored yet: enrolment only completes when the person proves
 * they can produce a code, so a mis-scanned QR cannot lock them out of the
 * actions MFA gates.
 */
export function beginMfaEnrolment(input: { userId: number; issuer?: string }): {
  secret: string;
  uri: string;
} {
  const user = get<UserRow>(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, input.userId);
  if (!user) throw new UserError("no such user");

  const secret = generateSecret();
  return {
    secret,
    uri: enrolmentUri({ secret, account: user.username, issuer: input.issuer ?? "Afya Core" }),
  };
}

/**
 * Finish enrolment by proving the code works.
 *
 * `confirmMfaEnrolment` is the only supported way to switch MFA on. It exists
 * instead of a plain setter because "the secret is stored" and "this person can
 * produce codes from it" are different facts, and only the second one is worth
 * anything.
 */
export function confirmMfaEnrolment(input: {
  userId: number;
  secret: string;
  code: string;
  byUserName: string;
}): void {
  if (!verifyCode(input.secret, input.code)) {
    throw new UserError("that code is not right — check the time on the phone and try the next one");
  }
  enableMfa({ userId: input.userId, secret: input.secret, byUserName: input.byUserName });
}

/** Store a confirmed second factor. Prefer `confirmMfaEnrolment`. */
export function enableMfa(input: { userId: number; secret: string; byUserName: string }): void {
  const user = get<UserRow>(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, input.userId);
  if (!user) throw new UserError("no such user");
  tx(() => {
    run(`UPDATE users SET mfa_secret = ? WHERE id = ?`, input.secret, input.userId);
    audit({
      action: "mfa_enabled",
      entity: "user",
      entityId: input.userId,
      facilityId: user.facility_id,
      actorId: input.userId,
      actorName: input.byUserName,
      purpose: "administration",
      // The seed itself must never be logged.
      detail: { username: user.username },
    });
  });
}

// ------------------------------------------------------------------ licences

export function recordLicence(input: {
  userId: number;
  regulator: string;
  licenceNumber: string;
  expiresOn: string;
  issuedOn?: string;
  byUserId: number | null;
  byUserName: string;
}): number {
  const user = get<UserRow>(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, input.userId);
  if (!user) throw new UserError("no such user");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn)) {
    throw new UserError("licence expiry must be an ISO date (YYYY-MM-DD)");
  }

  return tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO practitioner_licences (user_id, regulator, licence_number, issued_on, expires_on, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      input.userId,
      input.regulator.trim().toUpperCase(),
      input.licenceNumber.trim(),
      input.issuedOn ?? null,
      input.expiresOn,
      now(),
    );
    audit({
      action: "licence_recorded",
      entity: "practitioner_licence",
      entityId: lastInsertRowid,
      facilityId: user.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: {
        username: user.username,
        regulator: input.regulator,
        licenceNumber: input.licenceNumber,
        expiresOn: input.expiresOn,
      },
    });
    return lastInsertRowid;
  });
}

export interface ExpiringLicence {
  user_id: number;
  name: string;
  regulator: string;
  licence_number: string;
  expires_on: string;
  days_left: number;
}

/**
 * Licences expiring within `withinDays`, soonest first — expired ones included.
 *
 * This feeds the compliance dashboard. A clinician whose licence lapses does not
 * find out from their council in time; the facility finds out from a rejected
 * claim. Surfacing it early is the whole point.
 */
export function expiringLicences(facilityId: number, withinDays = 60, asOf = today()): ExpiringLicence[] {
  const rows = all<{
    user_id: number;
    name: string;
    regulator: string;
    licence_number: string;
    expires_on: string;
  }>(
    `SELECT l.user_id, u.name, l.regulator, l.licence_number, l.expires_on
       FROM practitioner_licences l
       JOIN users u ON u.id = l.user_id
      WHERE u.facility_id = ? AND u.active = 1
      ORDER BY l.expires_on ASC`,
    facilityId,
  );

  // Only the latest licence per user matters — an older expired one alongside a
  // current renewal is not a problem, and reporting it would train people to
  // ignore the list.
  const latest = new Map<number, (typeof rows)[number]>();
  for (const row of rows) {
    const held = latest.get(row.user_id);
    if (!held || row.expires_on > held.expires_on) latest.set(row.user_id, row);
  }

  return [...latest.values()]
    .map((row) => ({ ...row, days_left: daysBetween(asOf, row.expires_on) }))
    .filter((row) => row.days_left <= withinDays)
    .sort((a, b) => a.days_left - b.days_left);
}

// ------------------------------------------------------------------ sessions

export interface SignInResult {
  token: string;
  userId: number;
  name: string;
  expiresAt: string;
  mustChangePassword: boolean;
  /** True while the account still opens with a password the system shipped with. */
  usingShippedPassword: boolean;
  /** True when this account has a second factor enrolled. */
  mfaEnrolled: boolean;
  /** True when a code was supplied and accepted on this sign-in. */
  mfaVerified: boolean;
}

/**
 * Sign in.
 *
 * Failures are audited as carefully as successes — a run of failed attempts
 * against one username is the signal an investigator looks for. The message
 * returned never says whether it was the username or the password that was
 * wrong, so it cannot be used to enumerate staff.
 */
export function signIn(input: {
  facilityId: number;
  username: string;
  password: string;
  deviceCode?: string;
  /** The authenticator code, when the account has a second factor enrolled. */
  mfaCode?: string;
}): SignInResult {
  const username = input.username.trim().toLowerCase();
  const row = get<{
    id: number; name: string; password_hash: string; active: number; must_change_pw: number; mfa_secret: string | null;
  }>(
    `SELECT id, name, password_hash, active, must_change_pw, mfa_secret FROM users WHERE facility_id = ? AND username = ?`,
    input.facilityId,
    username,
  );

  const fail = (reason: string): never => {
    audit({
      action: "sign_in_failed",
      entity: "user",
      entityId: row?.id ?? null,
      facilityId: input.facilityId,
      actorId: row?.id ?? null,
      actorName: username,
      purpose: "audit",
      detail: { username, reason, device: input.deviceCode ?? null },
    });
    throw new UserError("that username and password do not match");
  };

  if (!row) fail("no-such-user");
  if (!row!.active) fail("inactive");
  if (!verifyPassword(input.password, row!.password_hash)) fail("bad-password");

  if (input.deviceCode && !activeDevice(input.deviceCode)) {
    audit({
      action: "sign_in_failed",
      entity: "user",
      entityId: row!.id,
      facilityId: input.facilityId,
      actorId: row!.id,
      actorName: username,
      purpose: "audit",
      detail: { username, reason: "device-revoked", device: input.deviceCode },
    });
    throw new UserError("this device has been revoked — contact the facility administrator");
  }

  // A wrong second factor is a failed sign-in, not a half-open session. A
  // missing one is not: the account still signs in, and the MFA-gated actions
  // simply do not resolve until a code is given — which is what lets a
  // pharmacist look at the counter on a phone they left at home.
  const mfaEnrolled = Boolean(row!.mfa_secret);
  let mfaVerified = false;
  if (mfaEnrolled && input.mfaCode?.trim()) {
    if (!verifyCode(row!.mfa_secret!, input.mfaCode)) fail("bad-mfa-code");
    mfaVerified = true;
  }

  const minutes = getSettingNumber("session_timeout_minutes", DEFAULT_SESSION_MINUTES);
  const token = mintToken();
  const createdAt = now();
  const expiresAt = new Date(Date.parse(createdAt) + minutes * 60_000).toISOString();

  return tx(() => {
    run(
      `INSERT INTO sessions (token, user_id, device_code, created_at, expires_at, mfa_verified_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      token,
      row!.id,
      input.deviceCode ?? null,
      createdAt,
      expiresAt,
      mfaVerified ? createdAt : null,
    );
    run(`UPDATE users SET last_login_at = ? WHERE id = ?`, createdAt, row!.id);
    audit({
      action: "sign_in",
      entity: "user",
      entityId: row!.id,
      facilityId: input.facilityId,
      actorId: row!.id,
      actorName: row!.name,
      purpose: "audit",
      detail: { username, device: input.deviceCode ?? null },
    });
    return {
      token,
      userId: row!.id,
      name: row!.name,
      expiresAt,
      mustChangePassword: !!row!.must_change_pw,
      usingShippedPassword: isShippedPassword(input.password),
      mfaEnrolled,
      mfaVerified,
    };
  });
}

// ------------------------------------------------------------------- step-up

/**
 * How long a proved second factor stays good on a session.
 *
 * Long enough that a pharmacist is not re-authenticating for every item in one
 * dispensing round; short enough that a machine left logged in at the counter
 * cannot be used for a controlled drug an hour later.
 */
export const MFA_WINDOW_MINUTES = 15;

/**
 * Prove a second factor on an existing session.
 *
 * Called when someone reaches an MFA-gated action without a recent code —
 * merging two patients, refunding money, dispensing a controlled drug. Failing
 * is audited, because repeated failures on one session are what an attack looks
 * like from the log.
 */
export function verifyMfa(input: { token: string; code: string }): boolean {
  const row = get<{ user_id: number; name: string; facility_id: number; mfa_secret: string | null; ended_at: string | null }>(
    `SELECT s.user_id, s.ended_at, u.name, u.facility_id, u.mfa_secret
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    input.token,
  );
  if (!row || row.ended_at) return false;
  if (!row.mfa_secret) throw new UserError("this account has no second factor enrolled yet");

  const ok = verifyCode(row.mfa_secret, input.code);

  audit({
    action: ok ? "mfa_verified" : "mfa_failed",
    entity: "user",
    entityId: row.user_id,
    facilityId: row.facility_id,
    actorId: row.user_id,
    actorName: row.name,
    purpose: "audit",
    detail: {},
  });

  if (ok) run(`UPDATE sessions SET mfa_verified_at = ? WHERE token = ?`, now(), input.token);
  return ok;
}

/** Is a second factor currently proved on this session? */
export function mfaIsFresh(token: string, withinMinutes = MFA_WINDOW_MINUTES): boolean {
  const row = get<{ mfa_verified_at: string | null }>(
    `SELECT mfa_verified_at FROM sessions WHERE token = ?`,
    token,
  );
  if (!row?.mfa_verified_at) return false;
  return Date.now() - Date.parse(row.mfa_verified_at) < withinMinutes * 60_000;
}

export interface ActiveSession {
  token: string;
  userId: number;
  name: string;
  facilityId: number;
  deviceCode: string | null;
  expiresAt: string;
}

/**
 * Resolve a session token, sliding its expiry forward on use.
 *
 * Sliding rather than fixed: a clinician mid-consultation should not be logged
 * out for reading rather than typing, but a screen nobody has touched for the
 * timeout must lock.
 */
export function resolveSession(token: string): ActiveSession | null {
  const row = get<{
    token: string;
    user_id: number;
    device_code: string | null;
    expires_at: string;
    ended_at: string | null;
    name: string;
    facility_id: number;
    active: number;
  }>(
    `SELECT s.token, s.user_id, s.device_code, s.expires_at, s.ended_at, u.name, u.facility_id, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`,
    token,
  );

  if (!row || row.ended_at || !row.active) return null;
  if (row.expires_at <= now()) return null;
  if (row.device_code && !activeDevice(row.device_code)) return null;

  const minutes = getSettingNumber("session_timeout_minutes", DEFAULT_SESSION_MINUTES);
  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
  run(`UPDATE sessions SET expires_at = ? WHERE token = ?`, expiresAt, token);

  return {
    token: row.token,
    userId: row.user_id,
    name: row.name,
    facilityId: row.facility_id,
    deviceCode: row.device_code,
    expiresAt,
  };
}

export function signOut(token: string): void {
  const row = get<{ user_id: number; name: string; facility_id: number }>(
    `SELECT s.user_id, u.name, u.facility_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    token,
  );
  if (!row) return;
  tx(() => {
    run(`UPDATE sessions SET ended_at = ? WHERE token = ? AND ended_at IS NULL`, now(), token);
    audit({
      action: "sign_out",
      entity: "user",
      entityId: row.user_id,
      facilityId: row.facility_id,
      actorId: row.user_id,
      actorName: row.name,
      purpose: "audit",
    });
  });
}
