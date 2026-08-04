import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { SERVER_IDLE_SECONDS } from "./idle";
import { scrypt, randomBytes, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { Role } from "@/db/schema";

/**
 * `promisify(scrypt)` loses the options overload — TypeScript picks the
 * three-argument signature and rejects the cost parameter — so the callback is
 * wrapped by hand instead.
 */
function scryptAsync(
  password: string,
  salt: string,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derived) =>
      err ? reject(err) : resolve(derived),
    );
  });
}

/* ---------------------------------------------------------------- */
/* PIN hashing                                                       */
/* ---------------------------------------------------------------- */

/**
 * Four-digit PINs, not passwords.
 *
 * Only about half of rural Kenyans personally own the handset they use, and
 * "login restrictions" are a named killer of African field deployments. One
 * phone has to serve four herdsmen, so the sign-in is a person picker plus a
 * PIN — never an email and password, and never a silently persisted session.
 *
 * A 4-digit PIN has only 10,000 possibilities, so the work factor and the
 * per-user rate limit in `pinAttempt` are doing the real security work here,
 * not the secret's entropy.
 */
const SCRYPT_N = 16384;
const KEY_LEN = 64;

export async function hashPin(pin: string): Promise<string> {
  if (!/^\d{4}$/.test(pin)) throw new Error("A PIN must be four digits.");
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(pin, salt, KEY_LEN, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt}$${derived.toString("hex")}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const [, nStr, salt, hex] = parts;
  const derived = await scryptAsync(pin, salt, KEY_LEN, { N: Number(nStr) });
  const expected = Buffer.from(hex, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

/* ---------------------------------------------------------------- */
/* Rate limiting                                                     */
/* ---------------------------------------------------------------- */

const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

export function pinAttempt(userId: string): { allowed: boolean; retryInSeconds?: number } {
  const now = Date.now();
  const rec = attempts.get(userId);
  if (rec && rec.until > now && rec.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryInSeconds: Math.ceil((rec.until - now) / 1000) };
  }
  if (!rec || rec.until <= now) attempts.set(userId, { count: 1, until: now + LOCKOUT_MS });
  else rec.count += 1;
  return { allowed: true };
}

export function clearPinAttempts(userId: string): void {
  attempts.delete(userId);
}

/* ---------------------------------------------------------------- */
/* Session cookie                                                    */
/* ---------------------------------------------------------------- */

export interface SessionPayload {
  userId: string;
  farmId: string;
  role: Role;
  fullName: string;
  language: "en" | "sw";
  expiresAt: number;
  /** When the server last saw a request on this session. Rolls forward. */
  lastSeenAt?: number;
}

const COOKIE = "dairy_session";

const SESSION_SECONDS = 60 * 60 * 12;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set in production.");
    }
    return new TextEncoder().encode("dev-only-insecure-secret-do-not-ship-32b");
  }
  return new TextEncoder().encode(s);
}

export async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(secret());
}

export async function decrypt(token?: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function createSession(payload: Omit<SessionPayload, "expiresAt">): Promise<void> {
  const now = Date.now();
  const expiresAt = now + SESSION_SECONDS * 1000;
  const token = await encrypt({ ...payload, expiresAt, lastSeenAt: now });
  await writeCookie(token, expiresAt);
}

async function writeCookie(token: string, expiresAt: number): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

/**
 * Roll the last-seen stamp forward. Called from the DAL on every verified
 * request. Deliberately cheap and deliberately quiet: it re-signs the same
 * payload, so nothing about who the user is can change here.
 */
export async function touchSession(session: SessionPayload): Promise<void> {
  const now = Date.now();
  // Re-signing on every single request would be a JWT sign per page view for
  // no benefit. Only write when the stamp is meaningfully stale.
  if (session.lastSeenAt != null && now - session.lastSeenAt < 60_000) return;
  const token = await encrypt({ ...session, lastSeenAt: now });
  await writeCookie(token, session.expiresAt);
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function readSessionCookie(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return decrypt(jar.get(COOKIE)?.value);
}

export const SESSION_COOKIE_NAME = COOKIE;
