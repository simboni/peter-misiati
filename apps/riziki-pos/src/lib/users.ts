/**
 * Accounts and shop settings.
 *
 * The shop runs on one counter phone, so the account rules carry more weight
 * than they look. Every sale, price override and stock movement is stamped with
 * a user id; if two people share a login, the audit trail — the owner's only
 * real defence against shrinkage — is worthless. And because the owner account
 * gates the formulas, letting the last owner be deactivated would lock the
 * business out of its own recipes permanently.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit } from "./db.ts";
import { hashPin, verifyPin } from "./pin.ts";

export interface UserRow {
  id: number;
  name: string;
  role: "owner" | "staff";
  active: number;
  created_at: string;
  last_login: string | null;
  /** True while this account still opens with the PIN it shipped with. */
  demo_pin: boolean;
}

/** PINs anyone would try first. These accounts gate trade secrets and profit. */
const OBVIOUS = new Set(["1234", "0000", "1111", "1122", "4321", "2580", "1212"]);

/** The PINs the system ships with, so the setup screen can nag until they change. */
const SHIPPED = ["1234", "1111"];

export class UserError extends Error {}

// ------------------------------------------------------------------ settings

/**
 * A tiny key/value store for things like the business name and KRA PIN that
 * appear on an invoice. Created here rather than in schema.sql because this
 * module does not own the schema file.
 */
export function ensureSettings(): void {
  // Defined in schema.sql; this stays only so a database created before the
  // table joined the schema still gains it. The shape must match exactly, or
  // whichever module runs first wins and the other's writes fail.
  run(`CREATE TABLE IF NOT EXISTS settings (
         key        TEXT PRIMARY KEY,
         value      TEXT NOT NULL DEFAULT '',
         updated_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`);
}

export function getSetting(key: string, fallback = ""): string {
  ensureSettings();
  const row = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, key);
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string, userId: number | null): void {
  ensureSettings();
  run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
  audit(userId, "setting_changed", "setting", null, key);
}

export const SHOP_KEYS = ["shop_name", "shop_phone", "shop_kra_pin", "cash_float_cents"] as const;

// --------------------------------------------------------------------- reads

export function listUsers(): UserRow[] {
  const rows = all<Omit<UserRow, "demo_pin"> & { pin_hash: string }>(
    `SELECT u.id, u.name, u.role, u.active, u.created_at, u.pin_hash,
            (SELECT MAX(a.at) FROM audit_log a
              WHERE a.user_id = u.id AND a.action = 'login') AS last_login
       FROM users u
      ORDER BY u.role DESC, u.id`,
  );
  return rows.map(({ pin_hash, ...u }) => ({
    ...u,
    demo_pin: SHIPPED.some((p) => verifyPin(p, pin_hash)),
  }));
}

/** Accounts still opening with a shipped PIN — the likeliest hole at go-live. */
export function usersOnDemoPin(): UserRow[] {
  return listUsers().filter((u) => u.active && u.demo_pin);
}

function activeOwnerCount(exceptId?: number): number {
  const row = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND id <> ?`,
    exceptId ?? -1,
  );
  return row?.n ?? 0;
}

// ---------------------------------------------------------------- validation

export function checkPin(pin: string): void {
  if (!/^\d{4}$/.test(pin)) {
    throw new UserError("A PIN must be exactly 4 digits.");
  }
  if (OBVIOUS.has(pin) || /^(\d)\1{3}$/.test(pin)) {
    throw new UserError(
      "That PIN is too easy to guess. This account opens the formulas and the profit figures — pick something only you would try.",
    );
  }
}

function checkNameFree(name: string, exceptId?: number): void {
  const clean = name.trim();
  if (clean.length < 2) throw new UserError("Enter the person's name.");
  const clash = get<{ id: number }>(
    `SELECT id FROM users WHERE active = 1 AND lower(name) = lower(?) AND id <> ?`,
    clean,
    exceptId ?? -1,
  );
  if (clash) {
    throw new UserError(
      `Someone called ${clean} already uses the system. Two people with the same name make the sign-in list — and the record of who sold what — ambiguous.`,
    );
  }
}

// -------------------------------------------------------------------- writes

export function createUser(input: {
  name: string;
  pin: string;
  role: "owner" | "staff";
  byUserId: number;
}): number {
  const name = input.name.trim();
  checkNameFree(name);
  checkPin(input.pin);

  return tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO users (name, role, pin_hash) VALUES (?, ?, ?)`,
      name,
      input.role,
      hashPin(input.pin),
    );
    // Never write a PIN into the audit log — it is read by the same people the
    // log exists to hold accountable.
    audit(input.byUserId, "user_created", "user", lastInsertRowid, `${name} (${input.role})`);
    return lastInsertRowid;
  });
}

export function changePin(input: {
  userId: number;
  newPin: string;
  currentPin?: string;
  byUserId: number;
}): void {
  checkPin(input.newPin);

  const target = get<{ id: number; name: string; pin_hash: string }>(
    `SELECT id, name, pin_hash FROM users WHERE id = ?`,
    input.userId,
  );
  if (!target) throw new UserError("That account no longer exists.");

  // Changing your own PIN means proving you know the old one. An owner resetting
  // an attendant's does not — someone has to be able to help when a PIN is
  // forgotten, and the audit line records who did it.
  if (input.userId === input.byUserId) {
    if (!input.currentPin || !verifyPin(input.currentPin, target.pin_hash)) {
      throw new UserError("That is not your current PIN.");
    }
  }

  tx(() => {
    run(`UPDATE users SET pin_hash = ? WHERE id = ?`, hashPin(input.newPin), input.userId);
    // Force a fresh sign-in everywhere: if the PIN was changed because someone
    // learned it, leaving their session alive defeats the change.
    run(`DELETE FROM sessions WHERE user_id = ?`, input.userId);
    audit(
      input.byUserId,
      input.userId === input.byUserId ? "pin_changed" : "pin_reset",
      "user",
      input.userId,
      target.name,
    );
  });
}

export function setActive(input: { userId: number; active: boolean; byUserId: number }): void {
  const target = get<{ id: number; name: string; role: string; active: number }>(
    `SELECT id, name, role, active FROM users WHERE id = ?`,
    input.userId,
  );
  if (!target) throw new UserError("That account no longer exists.");

  if (!input.active) {
    if (input.userId === input.byUserId) {
      throw new UserError("You cannot switch off your own account.");
    }
    if (target.role === "owner" && activeOwnerCount(input.userId) === 0) {
      throw new UserError(
        "This is the only owner account. Switching it off would lock the business out of its own formulas and reports for good.",
      );
    }
  }

  tx(() => {
    run(`UPDATE users SET active = ? WHERE id = ?`, input.active ? 1 : 0, input.userId);
    if (!input.active) {
      // Without this a sacked attendant stays signed in on the counter phone
      // until the session happens to expire.
      run(`DELETE FROM sessions WHERE user_id = ?`, input.userId);
    }
    audit(
      input.byUserId,
      input.active ? "user_reactivated" : "user_deactivated",
      "user",
      input.userId,
      target.name,
    );
  });
}

export function setRole(input: { userId: number; role: "owner" | "staff"; byUserId: number }): void {
  const target = get<{ id: number; name: string; role: string }>(
    `SELECT id, name, role FROM users WHERE id = ?`,
    input.userId,
  );
  if (!target) throw new UserError("That account no longer exists.");

  if (target.role === "owner" && input.role === "staff" && activeOwnerCount(input.userId) === 0) {
    throw new UserError(
      "This is the only owner account. Making it an attendant would leave nobody able to see the formulas.",
    );
  }

  tx(() => {
    run(`UPDATE users SET role = ? WHERE id = ?`, input.role, input.userId);
    audit(input.byUserId, "role_changed", "user", input.userId, `${target.name} → ${input.role}`);
  });
}

export function renameUser(input: { userId: number; name: string; byUserId: number }): void {
  const name = input.name.trim();
  checkNameFree(name, input.userId);
  run(`UPDATE users SET name = ? WHERE id = ?`, name, input.userId);
  audit(input.byUserId, "user_renamed", "user", input.userId, name);
}
