/**
 * Slowing down somebody guessing a PIN.
 *
 * THE PROBLEM THIS EXISTS FOR. The sign-in page is on the public internet, it
 * lists every account in a dropdown, and a PIN is four digits. That is ten
 * thousand possibilities, and nothing in the app counted wrong answers — so a
 * script could work through the whole space unattended. The owner's PIN opens
 * cost prices, every margin, the recipes, the full CSV export and a download
 * of the entire database.
 *
 * WHY A DELAY AND NOT A LOCK. A shop has no password reset: there is no email
 * to send a link to and nobody to ring at seven in the morning. An account
 * locked hard is a till that cannot open, and the attendant's answer to that
 * is to borrow the owner's PIN, which is worse than the attack. So wrong
 * answers buy time rather than a locked door: five tries free, then a wait
 * that grows and stops growing. A real person who has fumbled waits a minute
 * or two; a script needs about three weeks for the ten thousand.
 *
 * WHAT IT COUNTS. The `audit_log` rows the sign-in already writes — no new
 * table, and no state that can drift from the record. Only failures SINCE
 * that account last signed in successfully count, so getting it right wipes
 * the slate, and a day of ordinary fumbling never accumulates.
 *
 * No `next/*` import, so it runs under plain Node in the tests.
 */

import { get } from "./db.ts";

/** Tries that cost nothing — a fumbled PIN at the counter is not an attack. */
export const FREE_ATTEMPTS = 5;

/** How far back failures are counted. Older ones are forgiven. */
export const WINDOW_MINUTES = 15;

/** The longest anybody is ever made to wait. A shop must not be lockable. */
export const MAX_WAIT_SECONDS = 15 * 60;

/**
 * How long this account must wait before its next try, in seconds.
 *
 * Zero means go ahead. The wait doubles with each failure past the free ones
 * — 30s, 60s, 120s … — and stops at MAX_WAIT_SECONDS, so the worst an
 * attacker can do by hammering somebody else's account is impose a quarter of
 * an hour, repeatedly, on a shop that can see them doing it in the log.
 */
export function waitSeconds(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  const over = failures - FREE_ATTEMPTS;
  return Math.min(MAX_WAIT_SECONDS, 30 * 2 ** Math.min(over, 20));
}

/**
 * Wrong answers for this account since it last got in, inside the window.
 *
 * `datetime('now')` and the stored `at` are both UTC, so this needs none of
 * the shop-time arithmetic the reports do — it is an elapsed duration, not a
 * business date.
 */
export function recentFailures(userId: number): number {
  const row = get<{ n: number }>(
    `SELECT COUNT(*) AS n
       FROM audit_log
      WHERE user_id = ?
        AND action = 'login_failed'
        AND at >= datetime('now', ?)
        AND at > COALESCE((SELECT MAX(at) FROM audit_log
                            WHERE user_id = ? AND action = 'login'), '')`,
    userId,
    `-${WINDOW_MINUTES} minutes`,
    userId,
  );
  return row?.n ?? 0;
}

/** When the last failure was, so the wait can be counted from it. */
function lastFailureAt(userId: number): string | null {
  const row = get<{ at: string }>(
    `SELECT MAX(at) AS at FROM audit_log WHERE user_id = ? AND action = 'login_failed'`,
    userId,
  );
  return row?.at ?? null;
}

export interface Throttle {
  /** True while this account may not try again. */
  blocked: boolean;
  /** Seconds still to wait. Zero when not blocked. */
  retryInSeconds: number;
  /** Failures counted, for the message and the audit line. */
  failures: number;
}

/**
 * May this account try a PIN right now?
 *
 * `now` is injectable so the rule can be tested without waiting out a real
 * half-minute.
 */
export function throttleFor(userId: number, now: Date = new Date()): Throttle {
  const failures = recentFailures(userId);
  const wait = waitSeconds(failures);
  if (wait === 0) return { blocked: false, retryInSeconds: 0, failures };

  const last = lastFailureAt(userId);
  if (!last) return { blocked: false, retryInSeconds: 0, failures };

  // Stored by SQLite as "YYYY-MM-DD HH:MM:SS" in UTC.
  const lastMs = new Date(last.replace(" ", "T") + "Z").getTime();
  const elapsed = Math.floor((now.getTime() - lastMs) / 1000);
  const left = wait - elapsed;
  return left > 0
    ? { blocked: true, retryInSeconds: left, failures }
    : { blocked: false, retryInSeconds: 0, failures };
}

/** The wait, in the words the sign-in screen says it. */
export function waitWords(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

// ------------------------------------------------- the owner's PIN, inside

/**
 * The same brake on the owner's PIN, which is checked from INSIDE the app.
 *
 * `authoriseOwnerPin` approves a price below the floor and anything else that
 * needs the owner at the counter. It is reachable from four places, all of
 * them behind a sign-in — which sounds like protection and is not: an
 * attendant is signed in, and the owner's PIN is the four digits standing
 * between them and cost prices, margins and the recipes. Without a count, any
 * logged-in phone could work through ten thousand guesses.
 *
 * Counted across the whole shop rather than per person, because the thing
 * being guessed is one secret shared by the owners. The cost is that one
 * attendant fumbling slows the next owner approval; with five free tries and
 * a wait that caps, that is a minute at the counter against an afternoon's
 * silent brute force.
 */
export function ownerPinThrottle(now: Date = new Date()): Throttle {
  const row = get<{ n: number; last: string | null }>(
    `SELECT COUNT(*) AS n, MAX(at) AS last
       FROM audit_log
      WHERE action = 'owner_pin_failed'
        AND at >= datetime('now', ?)
        AND at > COALESCE((SELECT MAX(at) FROM audit_log
                            WHERE action = 'owner_pin_ok'), '')`,
    `-${WINDOW_MINUTES} minutes`,
  );
  const failures = row?.n ?? 0;
  const wait = waitSeconds(failures);
  if (wait === 0 || !row?.last) return { blocked: false, retryInSeconds: 0, failures };

  const lastMs = new Date(row.last.replace(" ", "T") + "Z").getTime();
  const left = wait - Math.floor((now.getTime() - lastMs) / 1000);
  return left > 0
    ? { blocked: true, retryInSeconds: left, failures }
    : { blocked: false, retryInSeconds: 0, failures };
}
