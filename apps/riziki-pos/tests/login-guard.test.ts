/**
 * Slowing down somebody guessing a PIN.
 *
 * The sign-in page is on the public internet, it names every account in a
 * dropdown, and a PIN is four digits — ten thousand possibilities. Nothing
 * counted wrong answers, so the whole space was a short unattended script,
 * and the owner's PIN opens cost prices, every margin, the recipes, the CSV
 * exports and a download of the entire database.
 *
 * Two things have to hold at once, and they pull against each other:
 *
 *   - a script must not get thousands of tries;
 *   - a shop must never be lockable, by anyone, including an attacker
 *     hammering the owner's account at seven in the morning. There is no
 *     password reset here: no email, nobody to ring. An account locked hard
 *     is a till that will not open, and the counter's answer to that is to
 *     borrow somebody else's PIN.
 *
 * So the wait grows and then stops growing, and getting in clears it.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-login-guard-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { run, get } = await import("../src/lib/db.ts");
const guard = await import("../src/lib/login-guard.ts");

seed();
const STAFF = 2;

/** A wrong answer, recorded the way the sign-in records one. */
function failed(userId: number, secondsAgo = 0) {
  run(
    `INSERT INTO audit_log (at, user_id, action, entity, entity_id)
     VALUES (datetime('now', ?), ?, 'login_failed', 'user', ?)`,
    `-${secondsAgo} seconds`,
    userId,
    userId,
  );
}
function succeeded(userId: number, secondsAgo = 0) {
  run(
    `INSERT INTO audit_log (at, user_id, action, entity, entity_id)
     VALUES (datetime('now', ?), ?, 'login', 'user', ?)`,
    `-${secondsAgo} seconds`,
    userId,
    userId,
  );
}
const clear = () => run(`DELETE FROM audit_log`);

test("a fumbled PIN at the counter costs nothing", () => {
  clear();
  for (let i = 0; i < guard.FREE_ATTEMPTS - 1; i++) failed(STAFF);
  assert.equal(guard.throttleFor(STAFF).blocked, false, "four wrong is a person, not a script");
});

test("past the free tries, the wait starts and then doubles", () => {
  assert.equal(guard.waitSeconds(guard.FREE_ATTEMPTS - 1), 0);
  assert.equal(guard.waitSeconds(guard.FREE_ATTEMPTS), 30);
  assert.equal(guard.waitSeconds(guard.FREE_ATTEMPTS + 1), 60);
  assert.equal(guard.waitSeconds(guard.FREE_ATTEMPTS + 2), 120);
});

test("and it stops growing, because a shop must not be lockable", () => {
  // A thousand wrong answers must not mean a till that opens tomorrow.
  assert.equal(guard.waitSeconds(1000), guard.MAX_WAIT_SECONDS);
  assert.ok(guard.MAX_WAIT_SECONDS <= 15 * 60, "never more than a quarter of an hour");
});

test("the fifth wrong answer blocks the next try", () => {
  clear();
  for (let i = 0; i < guard.FREE_ATTEMPTS; i++) failed(STAFF);
  const t = guard.throttleFor(STAFF);
  assert.equal(t.blocked, true);
  assert.ok(t.retryInSeconds > 0 && t.retryInSeconds <= 30);
});

test("waiting it out lets them back in", () => {
  clear();
  // Five failures, the most recent a full minute ago: the 30s wait has passed.
  for (let i = 0; i < guard.FREE_ATTEMPTS; i++) failed(STAFF, 60);
  assert.equal(guard.throttleFor(STAFF).blocked, false);
});

test("getting it right wipes the slate", () => {
  clear();
  for (let i = 0; i < guard.FREE_ATTEMPTS + 3; i++) failed(STAFF, 120);
  succeeded(STAFF, 60);
  assert.equal(guard.recentFailures(STAFF), 0, "failures before the last sign-in are forgiven");
  assert.equal(guard.throttleFor(STAFF).blocked, false);
});

test("yesterday's fumbling does not accumulate", () => {
  clear();
  for (let i = 0; i < 50; i++) failed(STAFF, (guard.WINDOW_MINUTES + 5) * 60);
  assert.equal(guard.recentFailures(STAFF), 0, "outside the window and forgiven");
});

test("one account's failures never block another", () => {
  clear();
  for (let i = 0; i < 20; i++) failed(STAFF);
  assert.equal(guard.throttleFor(STAFF).blocked, true);
  assert.equal(guard.throttleFor(1).blocked, false, "the owner can still open the shop");
});

test("the arithmetic actually costs an attacker the time it claims", () => {
  /*
    The whole point, as a number. Ten thousand PINs, five free tries then a
    wait capped at MAX_WAIT_SECONDS: the space takes weeks, not minutes.
  */
  const perTry = guard.MAX_WAIT_SECONDS;
  const days = ((10_000 - guard.FREE_ATTEMPTS) * perTry) / 86_400;
  assert.ok(days > 14, `exhausting four digits should take weeks, got ${days.toFixed(1)} days`);
});

test("the wait is said in words a counter can act on", () => {
  assert.equal(guard.waitWords(30), "30 seconds");
  assert.equal(guard.waitWords(60), "1 minute");
  assert.equal(guard.waitWords(600), "10 minutes");
});

test("a signed-in session is untouched by any of this", () => {
  // The brake is on the door, not on the people already inside: an attacker
  // hammering an account must not log the shop out mid-sale.
  clear();
  for (let i = 0; i < 50; i++) failed(STAFF);
  const session = get<{ n: number }>(`SELECT COUNT(*) AS n FROM sessions`);
  assert.equal(session?.n ?? 0, 0, "nothing here creates or destroys sessions");
});

// ------------------------------------------- the owner's PIN, from inside

const { authoriseOwnerPin } = await import("../src/lib/sales.ts");

test("the owner's PIN is counted too, because an attendant is already signed in", () => {
  /*
    `authoriseOwnerPin` approves a below-floor price and is reachable from
    four places, all behind a sign-in. That is not protection: an attendant
    IS signed in, and these four digits are the gate on cost prices, margins
    and the recipes. Unwatched, one logged-in phone grinds the whole space.
  */
  clear();
  for (let i = 0; i < guard.FREE_ATTEMPTS; i++) {
    assert.equal(authoriseOwnerPin("0000"), null, "a wrong owner PIN approves nothing");
  }
  assert.equal(guard.ownerPinThrottle().blocked, true, "and the wrong ones are counted");

  // While blocked, even the RIGHT PIN is refused — the brake cannot be
  // stepped around by finally guessing correctly.
  assert.equal(authoriseOwnerPin("1234"), null, "blocked means blocked");
});

test("a correct owner PIN clears the count once the wait has passed", () => {
  clear();
  // Five wrong, long enough ago that the wait has expired.
  for (let i = 0; i < guard.FREE_ATTEMPTS; i++) {
    run(
      `INSERT INTO audit_log (at, action, entity) VALUES (datetime('now', '-120 seconds'), 'owner_pin_failed', 'user')`,
    );
  }
  assert.equal(guard.ownerPinThrottle().blocked, false, "the wait is over");
  assert.equal(authoriseOwnerPin("1234"), 1, "the real PIN works and names the owner");
  assert.equal(guard.ownerPinThrottle().failures, 0, "success wipes the slate");
});
