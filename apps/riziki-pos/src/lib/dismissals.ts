/**
 * "I have dealt with this."
 *
 * The books check and the dashboard work everything out from the shop's own
 * figures every time a page is opened. Nothing is stored, so nearly every
 * finding disappears by itself the moment the thing it is about is put right —
 * which is the behaviour to want, and the reason there has never been a way to
 * tick one off.
 *
 * But some do not go, and the two reasons want opposite answers. The owner may
 * have dealt with it somewhere the check cannot see: a word with the supplier, a
 * decision that the price is right as it stands, a delivery note that says the
 * odd container really was odd. Or the fix did not take. A plain "hide" serves
 * the first and buries the second.
 *
 * So a dismissal remembers WHAT was dismissed. The fingerprint is a digest of
 * the figures the finding was asserting; it hides the finding while those
 * figures hold, and the moment one moves the finding returns saying what it now
 * says. Answering today's problem cannot silence tomorrow's.
 *
 * Nothing here touches the DOM, so the arithmetic runs under plain Node.
 */

import { all, get, run, audit } from "./db.ts";

/**
 * A short, stable digest of whatever a finding is claiming.
 *
 * FNV-1a, written out rather than reached for, because the only properties that
 * matter here are that it is deterministic across restarts and that any change
 * to the text changes it. It is not a security boundary and nothing is hidden
 * behind it: a collision costs one stale row on one screen.
 *
 * The input is the finding's own words. That is deliberate — the sentence a
 * check writes already carries every number it is asserting, so there is no
 * second list of figures to keep in step with the first.
 */
export function fingerprint(said: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < said.length; i++) {
    h ^= said.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface Dismissal {
  key: string;
  fingerprint: string;
  said: string;
  at: string;
}

/** Every dismissal still standing, by key. */
export function activeDismissals(): Map<string, Dismissal> {
  const rows = all<Dismissal>(
    `SELECT key, fingerprint, said, at FROM dismissals
      WHERE undone_at IS NULL
      ORDER BY id`,
  );
  // Later wins: a key dismissed, undone and dismissed again is dismissed.
  return new Map(rows.map((r) => [r.key, r]));
}

/**
 * Whether this exact finding has been answered.
 *
 * Both halves have to match. A key with a different fingerprint is the same
 * KIND of problem saying something new, and something new has not been answered.
 */
export function isDismissed(
  dismissed: Map<string, Dismissal>,
  key: string,
  said: string,
): boolean {
  const row = dismissed.get(key);
  return row !== undefined && row.fingerprint === fingerprint(said);
}

/** Drop the ones the owner has already answered, in their current words. */
export function undismissed<T extends { id: string; detail: string }>(findings: T[]): T[] {
  const dismissed = activeDismissals();
  return findings.filter((f) => !isDismissed(dismissed, f.id, f.detail));
}

export function dismiss(key: string, said: string, userId: number, note = ""): void {
  run(
    `INSERT INTO dismissals (key, fingerprint, said, user_id, note)
     VALUES (?, ?, ?, ?, ?)`,
    key,
    fingerprint(said),
    said,
    userId,
    note,
  );
  audit(userId, "dismiss", "finding", null, `${key} — ${said}`);
}

/**
 * Put one back, because a dismissal is a judgement and judgements are revisited.
 *
 * The row is marked rather than removed: "who hid this, and when" has to keep
 * its answer, and so does "who brought it back".
 */
export function restore(key: string, userId: number): void {
  run(
    `UPDATE dismissals SET undone_at = datetime('now')
      WHERE key = ? AND undone_at IS NULL`,
    key,
  );
  audit(userId, "restore", "finding", null, key);
}

/** What has been set aside, newest first, for a screen that lists them. */
export function setAside(): Dismissal[] {
  return all<Dismissal>(
    `SELECT key, fingerprint, said, at FROM dismissals
      WHERE undone_at IS NULL
      ORDER BY id DESC`,
  );
}

/** How many are set aside, for a line that says so without listing them. */
export function setAsideCount(): number {
  return get<{ n: number }>(`SELECT COUNT(*) AS n FROM dismissals WHERE undone_at IS NULL`)?.n ?? 0;
}
