/**
 * Time-based one-time passwords (RFC 6238), for the permissions that need a
 * second factor: merging patient records, refunding money, dispensing a
 * controlled drug.
 *
 * Written against the specification rather than pulled in as a dependency. It
 * is roughly forty lines of HMAC, it must keep working offline on a clinic's one
 * machine for years, and a supply-chain compromise in an authentication library
 * is the worst place to have one. Node's `crypto` does the actual work.
 *
 * SHA-1, six digits, a thirty-second step: not a modern choice, but what Google
 * Authenticator, Authy and FreeOTP actually implement. A second factor nobody
 * can enrol protects nothing.
 *
 * The verifier accepts the step before and after the current one, because
 * clinic machines drift and a clock nobody can set is a lockout.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DIGITS = 6;
const STEP_SECONDS = 30;
/** How many steps either side of now are accepted. One step = 30 seconds. */
const DRIFT_STEPS = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A fresh secret, base32 as every authenticator app expects. */
export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code for one time step. Exported so tests can be deterministic. */
export function codeAt(secret: string, atMs: number): string {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);

  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest();

  // RFC 6238 dynamic truncation.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Is this the code for this secret, now?
 *
 * Compared in constant time, and the surrounding steps are accepted so a clock
 * that drifts by a few seconds does not lock a pharmacist out mid-shift.
 */
export function verifyCode(secret: string, code: string, atMs = Date.now()): boolean {
  const given = code.trim().replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return false;

  for (let step = -DRIFT_STEPS; step <= DRIFT_STEPS; step++) {
    const expected = codeAt(secret, atMs + step * STEP_SECONDS * 1000);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return true;
  }
  return false;
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * The secret is in it, so this is shown once at enrolment and never logged,
 * stored or e-mailed.
 */
export function enrolmentUri(input: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
