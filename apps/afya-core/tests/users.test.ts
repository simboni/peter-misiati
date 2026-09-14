/**
 * M01 — accounts, licences and sessions.
 *
 * The lockout tests protect against the failure that takes a clinic off the air
 * mid-week: an administrator removing the last administrator.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-users-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const { seedDemo } = await import("../src/lib/seed.ts");
const U = await import("../src/lib/users.ts");
const { get, all } = await import("../src/lib/db.ts");
const { verifyPassword } = await import("../src/lib/passwords.ts");
const { registerDevice, revokeDevice, setSetting } = await import("../src/lib/facility.ts");

const { facilityId, adminId, clinicianId } = seedDemo();

test("a password is stored as a hash and never appears in the audit log", () => {
  const id = U.createUser({
    facilityId,
    name: "Grace Muthoni",
    username: "g.muthoni",
    password: "Sunrise4471",
    cadreCode: "nurse",
    roles: ["nurse"],
    byUserId: adminId,
    byUserName: "admin",
  });

  const row = get<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = ?`, id)!;
  assert.ok(!row.password_hash.includes("Sunrise4471"), "the password must not appear in the stored hash");
  assert.ok(verifyPassword("Sunrise4471", row.password_hash));
  assert.ok(!verifyPassword("Sunrise4472", row.password_hash));

  const logged = all<{ detail: string }>(
    `SELECT detail FROM audit_log WHERE action = 'user_created' AND entity_id = ?`,
    String(id),
  );
  assert.equal(logged.length, 1);
  assert.ok(!logged[0].detail.includes("Sunrise4471"), "the password must not reach the audit log");
});

test("weak passwords are refused before an account exists", () => {
  for (const bad of ["short1A", "password123", "alllowercase1", "NOLOWERCASE1"]) {
    assert.throws(
      () =>
        U.createUser({
          facilityId,
          name: "Weak",
          username: `weak${Math.random().toString(36).slice(2, 8)}`,
          password: bad,
          byUserName: "test",
        }),
      /password/i,
      `"${bad}" must be refused`,
    );
  }
});

test("a username cannot be reused — there are no shared logins", () => {
  assert.throws(
    () =>
      U.createUser({
        facilityId,
        name: "Someone Else",
        username: "admin",
        password: "AnotherPass123",
        byUserName: "test",
      }),
    /already taken/,
  );
});

test("the last administrator cannot be deactivated or demoted", () => {
  assert.throws(
    () => U.setActive({ userId: adminId, active: false, byUserId: adminId, byUserName: "admin" }),
    /your own account/,
    "you cannot switch yourself off",
  );

  // Even from another account, the last administrator is protected.
  const other = U.createUser({
    facilityId,
    name: "Second Admin",
    username: "admin2",
    password: "SecondPass123",
    roles: ["receptionist"],
    byUserId: adminId,
    byUserName: "admin",
  });
  assert.throws(
    () => U.setActive({ userId: adminId, active: false, byUserId: other, byUserName: "admin2" }),
    /last active administrator/,
  );
  assert.throws(
    () => U.assignRoles({ userId: adminId, roles: ["receptionist"], byUserId: other, byUserName: "admin2" }),
    /last active administrator/,
  );

  // With a second administrator in place, the first may step down.
  U.assignRoles({ userId: other, roles: ["administrator"], byUserId: adminId, byUserName: "admin" });
  U.assignRoles({ userId: adminId, roles: ["administrator", "receptionist"], byUserId: adminId, byUserName: "admin" });
});

test("signing in issues a session; signing out ends it", () => {
  const session = U.signIn({ facilityId, username: "g.muthoni", password: "Sunrise4471" });
  assert.ok(session.token.length > 20);

  const resolved = U.resolveSession(session.token);
  assert.equal(resolved?.userId, session.userId);

  U.signOut(session.token);
  assert.equal(U.resolveSession(session.token), null, "an ended session must not resolve");
});

test("a failed sign-in is recorded but does not reveal which half was wrong", () => {
  assert.throws(
    () => U.signIn({ facilityId, username: "g.muthoni", password: "WrongPass123" }),
    /do not match/,
  );
  assert.throws(
    () => U.signIn({ facilityId, username: "nobody.here", password: "WrongPass123" }),
    /do not match/,
  );

  const rows = all<{ detail: string }>(
    `SELECT detail FROM audit_log WHERE action = 'sign_in_failed' ORDER BY id DESC LIMIT 2`,
  );
  assert.equal(rows.length, 2, "both failures are recorded for an investigator");
  assert.ok(rows.some((r) => r.detail.includes("bad-password")));
  assert.ok(rows.some((r) => r.detail.includes("no-such-user")));
});

test("deactivating an account cuts its live sessions immediately", () => {
  const session = U.signIn({ facilityId, username: "g.muthoni", password: "Sunrise4471" });
  assert.ok(U.resolveSession(session.token));

  const nurse = get<{ id: number }>(`SELECT id FROM users WHERE username = 'g.muthoni'`)!;
  U.setActive({ userId: nurse.id, active: false, byUserId: adminId, byUserName: "admin", reason: "resigned" });

  assert.equal(U.resolveSession(session.token), null, "they must not keep working until the token expires");
  U.setActive({ userId: nurse.id, active: true, byUserId: adminId, byUserName: "admin" });
});

test("changing a password ends existing sessions", () => {
  const session = U.signIn({ facilityId, username: "g.muthoni", password: "Sunrise4471" });
  const nurse = get<{ id: number }>(`SELECT id FROM users WHERE username = 'g.muthoni'`)!;

  U.changePassword({ userId: nurse.id, newPassword: "Moonrise8823", byUserId: nurse.id, byUserName: "Grace" });

  assert.equal(U.resolveSession(session.token), null, "if the old password leaked, its sessions must not survive");
  assert.ok(U.signIn({ facilityId, username: "g.muthoni", password: "Moonrise8823" }));
});

test("a session expires when it is left idle", () => {
  setSetting("session_timeout_minutes", "0");
  const session = U.signIn({ facilityId, username: "g.muthoni", password: "Moonrise8823" });
  assert.equal(U.resolveSession(session.token), null, "a screen left open must lock");
  setSetting("session_timeout_minutes", "30");
});

test("a revoked device cannot sign in or keep a session", () => {
  registerDevice({ facilityId, code: "TAB9", label: "Consulting room tablet", byUserId: adminId, byUserName: "admin" });

  const session = U.signIn({ facilityId, username: "g.muthoni", password: "Moonrise8823", deviceCode: "TAB9" });
  assert.ok(U.resolveSession(session.token), "it works while the device is trusted");

  revokeDevice({ code: "TAB9", byUserId: adminId, byUserName: "admin", reason: "lost in transit" });

  assert.equal(U.resolveSession(session.token), null, "revocation must cut the live session");
  assert.throws(
    () => U.signIn({ facilityId, username: "g.muthoni", password: "Moonrise8823", deviceCode: "TAB9" }),
    /revoked/,
  );
});

test("licences about to lapse are surfaced before they bite", () => {
  const soon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const nurse = get<{ id: number }>(`SELECT id FROM users WHERE username = 'g.muthoni'`)!;
  U.recordLicence({
    userId: nurse.id,
    regulator: "NCK",
    licenceNumber: "NCK-99812",
    expiresOn: soon,
    byUserId: adminId,
    byUserName: "admin",
  });

  const expiring = U.expiringLicences(facilityId, 60);
  const hit = expiring.find((e) => e.user_id === nurse.id);
  assert.ok(hit, "a licence lapsing in 20 days must appear on the compliance list");
  assert.equal(hit!.regulator, "NCK");
  assert.ok(hit!.days_left <= 21 && hit!.days_left >= 19);

  // The clinician's licence runs a year out, so it is not noise on the list.
  assert.ok(!expiring.some((e) => e.user_id === clinicianId), "a current licence must not clutter the warning list");
});

test("a renewed licence clears the warning rather than sitting alongside the old one", () => {
  const nurse = get<{ id: number }>(`SELECT id FROM users WHERE username = 'g.muthoni'`)!;
  const nextYear = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
  U.recordLicence({
    userId: nurse.id,
    regulator: "NCK",
    licenceNumber: "NCK-99812-R",
    expiresOn: nextYear,
    byUserId: adminId,
    byUserName: "admin",
  });

  assert.ok(
    !U.expiringLicences(facilityId, 60).some((e) => e.user_id === nurse.id),
    "once renewed, the superseded licence must not keep raising a warning",
  );
});
