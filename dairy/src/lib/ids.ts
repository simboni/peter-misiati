/**
 * Client-generated identifiers.
 *
 * The row UUID is generated on the device, not by the database. That single
 * choice is what makes the offline outbox safe: the server does
 * `INSERT ... ON CONFLICT (id) DO NOTHING`, so a double-flush over a flaky link
 * is a no-op rather than a duplicate milk record.
 */
import { randomUUID, randomBytes } from "node:crypto";

export function newId(): string {
  // crypto.randomUUID exists in the browser too; node:crypto is only reached
  // on the server, where this module is imported from Server Actions.
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : randomUUID();
}

/**
 * Short, speakable reference codes for receipts — the M-Pesa pattern.
 * Deliberately excludes I, O, 0, 1 so a code read aloud in a milking shed
 * cannot be mis-heard.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function refCode(prefix: string, length = 5): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}${out}`;
}

export const REF_PREFIX = {
  MILK: "MK",
  FEED: "FD",
  HEALTH: "HL",
  BREEDING: "BR",
  DELIVERY: "RD",
  PAYMENT: "PY",
  SALE: "SL",
  PAYROLL: "PR",
  EXPENSE: "EX",
} as const;
