/**
 * Identifier minting.
 *
 * The rule that drives this file: never invent a bare global sequence while
 * offline. Two tablets in the same clinic, both disconnected, will both reach
 * for "the next number" and both be right — and the collision surfaces days
 * later as two patients sharing a file number, or two receipts with one number.
 *
 * So anything minted at the edge carries the device code that minted it. The
 * prefix makes it unique without coordination, and it stays on the record after
 * sync so the provisional identifier a patient was handed on paper can still be
 * found.
 *
 * Canonical identifiers that MUST be gapless and globally sequential — a KRA
 * eTIMS invoice number is the example — are never minted here. They are
 * assigned on transmission, and both numbers are kept.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { randomBytes } from "node:crypto";

/** Unambiguous alphabet: no I, O, 0, 1 — these are read aloud and hand-copied. */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export class IdError extends Error {}

/** A device code is the uniqueness guarantee, so it is validated on the way in. */
export function assertDeviceCode(code: string): void {
  if (!/^[A-Z0-9]{2,6}$/.test(code)) {
    throw new IdError(
      `device code "${code}" must be 2-6 uppercase letters or digits — it prefixes every identifier this device mints`,
    );
  }
}

function randomPart(length: number): string {
  // rejection-free: 32-character alphabet maps exactly onto 5 bits.
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/**
 * A provisional identifier minted on a device, e.g. `TAB1-7K4QMX`.
 *
 * Used for anything a patient or cashier is handed before the record has
 * reached the server: medical record numbers, receipt numbers, claim drafts.
 */
export function mintLocalId(deviceCode: string, length = 6): string {
  assertDeviceCode(deviceCode);
  return `${deviceCode}-${randomPart(length)}`;
}

/** True when `id` was minted at the edge and still awaits a canonical number. */
export function isLocalId(id: string): boolean {
  return /^[A-Z0-9]{2,6}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4,}$/.test(id);
}

/** The device that minted a local identifier, or null if it is not one. */
export function mintingDevice(id: string): string | null {
  return isLocalId(id) ? id.split("-")[0] : null;
}

/** An opaque, unguessable token — session tokens and the like. */
export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}
