/**
 * Password hashing.
 *
 * scrypt with a per-password salt. Deliberately free of any framework import so
 * it can be unit tested and used by the seed script without booting Next.
 *
 * Weak-password rejection matters more here than in most systems: these accounts
 * open health records, and the Data Protection Act makes the facility liable for
 * the disclosure, not the person who chose "password".
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export class PasswordError extends Error {}

/** Passwords an attacker tries first, plus the ones this system ships with. */
const OBVIOUS = new Set([
  "password", "password1", "passw0rd", "12345678", "123456789", "qwerty123",
  "admin123", "letmein", "welcome1", "hospital", "clinic123", "afyacore",
  "changeme", "test1234",
]);

/** The passwords seeded accounts start with, so setup can nag until they change. */
export const SHIPPED = ["ChangeMe123", "Afya#2026"];

export function assertStrong(password: string): void {
  if (password.length < 10) {
    throw new PasswordError("password must be at least 10 characters");
  }
  if (OBVIOUS.has(password.toLowerCase())) {
    throw new PasswordError("that password is one of the first an attacker tries");
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new PasswordError("password must mix upper case, lower case and a digit");
  }
}

export function hashPassword(password: string): string {
  assertStrong(password);
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/** True while an account still opens with a password the system shipped with. */
export function isShippedPassword(password: string): boolean {
  return SHIPPED.includes(password);
}
