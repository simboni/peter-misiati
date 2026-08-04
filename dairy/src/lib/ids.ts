/**
 * Client-generated identifiers.
 *
 * The row UUID is generated on the device, not by the database. That single
 * choice is what makes the offline outbox safe: the server does
 * `INSERT ... ON CONFLICT (id) DO NOTHING`, so a double-flush over a flaky link
 * is a no-op rather than a duplicate milk record.
 */
import { randomUUID, randomBytes, createHash } from "node:crypto";

export function newId(): string {
  // crypto.randomUUID exists in the browser too; node:crypto is only reached
  // on the server, where this module is imported from Server Actions.
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : randomUUID();
}

/**
 * A stable UUID derived from a seed.
 *
 * Used where the device did NOT supply an id but the write still has to be
 * idempotent — an old client, a hand-built request, a replayed forced row.
 * Seeding it with whatever makes the row unique in the world (farm, animal,
 * date, session) means a second attempt collides with the first on the primary
 * key instead of booking the same milking twice.
 */
export function deterministicUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    // Version 4, variant 1 — shaped like a random UUID so nothing downstream
    // has to know it was derived.
    `4${hex.slice(13, 16)}`,
    ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");
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
  ANIMAL: "AN",
  WEIGHT: "WT",
  INVOICE: "IN",
  STATEMENT: "ST",
  FEED: "FD",
  HEALTH: "HL",
  BREEDING: "BR",
  DELIVERY: "RD",
  PAYMENT: "PY",
  SALE: "SL",
  PAYROLL: "PR",
  EXPENSE: "EX",
} as const;
