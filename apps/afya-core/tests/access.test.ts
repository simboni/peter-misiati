/**
 * M01 — the capability check.
 *
 * The licence tests are the commercially important ones. A clinician with a
 * lapsed council registration who can still prescribe produces claims that are
 * rejected two months later, after the drugs have left the shelf.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-access-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const { seedDemo } = await import("../src/lib/seed.ts");
const A = await import("../src/lib/access.ts");
const U = await import("../src/lib/users.ts");
const { get, all } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();

/** A date far enough ahead that the demo licence has lapsed. */
const AFTER_LICENCE_LAPSES = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);

test("a role grants what it should and nothing more", () => {
  assert.ok(A.can(receptionistId, "patient.register"), "a receptionist registers patients");
  assert.ok(A.can(receptionistId, "payment.receive"), "and takes payment");
  assert.ok(!A.can(receptionistId, "prescription.write"), "but never prescribes");

  const denial = A.check(receptionistId, "prescription.write");
  assert.equal(denial.allowed, false);
  assert.equal(!denial.allowed && denial.reason, "not-granted");
});

test("a licensed clinician can prescribe while the licence is current", () => {
  assert.ok(A.can(clinicianId, "prescription.write"));
  assert.ok(A.can(clinicianId, "diagnosis.code"));
  assert.equal(A.licenceStatus(clinicianId).state, "current");
});

test("an expired licence switches the capability off, and says when it lapsed", () => {
  const decision = A.check(clinicianId, "prescription.write", AFTER_LICENCE_LAPSES);

  assert.equal(decision.allowed, false, "an expired licence must stop the act, not warn about it");
  assert.equal(!decision.allowed && decision.reason, "licence-expired");
  assert.equal(!decision.allowed && decision.reason === "licence-expired" && decision.regulator, "KMPDC");

  const message = A.explain(decision);
  assert.match(message, /KMPDC/, "the message names the council");
  assert.match(message, /expired on \d{4}-\d{2}-\d{2}/, "and the exact date, so it can be renewed");
});

test("an expired licence does not affect permissions that need no licence", () => {
  // The clinician still holds report.read through the clinician role.
  assert.ok(
    A.can(clinicianId, "report.read", AFTER_LICENCE_LAPSES),
    "a lapsed licence must not lock someone out of everything — only of licensed acts",
  );
});

test("a clinical permission is refused outright when no licence is on file", () => {
  const id = U.createUser({
    facilityId,
    name: "Unlicensed Locum",
    username: "locum",
    password: "TempPass123",
    cadreCode: "clinical_officer",
    roles: ["clinician"],
    byUserId: adminId,
    byUserName: "test",
  });

  const decision = A.check(id, "prescription.write");
  assert.equal(decision.allowed, false);
  assert.equal(!decision.allowed && decision.reason, "licence-missing");
  assert.match(A.explain(decision), /COC/, "it names the council the cadre answers to");
});

test("an MFA-gated permission needs the second factor, not just the role", () => {
  // A second administrator, with the role but no second factor yet.
  const deputyId = U.createUser({
    facilityId, name: "Deputy Administrator", username: "deputy", password: "ChangeMe123",
    cadreCode: "administrative", roles: ["administrator"], byUserId: adminId, byUserName: "admin",
  });
  assert.ok(A.grantedPermissions(deputyId).includes("user.manage"), "the role grants it");

  const before = A.check(deputyId, "user.manage");
  assert.equal(before.allowed, false, "holding the role is not enough");
  assert.equal(!before.allowed && before.reason, "mfa-required");
  assert.match(A.explain(before), /two-factor/);

  U.enableMfa({ userId: deputyId, secret: DEPUTY_SECRET, byUserName: "Deputy Administrator" });
  assert.ok(A.can(deputyId, "user.manage"), "with the second factor enrolled it resolves");
});

const DEPUTY_SECRET = "KRSXG5CTMVRXEZLUKBSWY3DPEHPK3PXP";

test("the MFA seed never reaches the audit log", () => {
  const rows = all<{ detail: string }>(`SELECT detail FROM audit_log WHERE action = 'mfa_enabled'`);
  assert.ok(rows.length > 0);
  assert.ok(
    rows.every((r) => !r.detail.includes(DEPUTY_SECRET) && !r.detail.includes("JBSWY3DP")),
    "the seed must not be logged",
  );
});

test("an MFA-gated action asks for a code when the session cannot show a recent one", async () => {
  const U2 = await import("../src/lib/users.ts");
  const { codeAt } = await import("../src/lib/totp.ts");
  const { DEMO_MFA_SECRET } = await import("../src/lib/seed.ts");

  // Signed in with a password only: enrolled, but nothing proved on this session.
  const session = U2.signIn({ facilityId, username: "admin", password: "ChangeMe123" });
  assert.equal(session.mfaEnrolled, true);
  assert.equal(session.mfaVerified, false);

  const stale = A.check(adminId, "user.manage", undefined, session.token);
  assert.equal(stale.allowed, false, "an enrolled account left signed in is not an authenticated one");
  assert.equal(!stale.allowed && stale.reason, "mfa-stale");
  assert.match(A.explain(stale), /authenticator/);

  assert.equal(U2.verifyMfa({ token: session.token, code: "000000" }), false);
  assert.equal(U2.verifyMfa({ token: session.token, code: codeAt(DEMO_MFA_SECRET, Date.now()) }), true);

  assert.ok(A.can(adminId, "user.manage"), "and without a session it is still the capability question");
  assert.equal(A.check(adminId, "user.manage", undefined, session.token).allowed, true);
});

test("signing in with the code proves it on the session straight away", async () => {
  const U2 = await import("../src/lib/users.ts");
  const { codeAt } = await import("../src/lib/totp.ts");
  const { DEMO_MFA_SECRET } = await import("../src/lib/seed.ts");

  const session = U2.signIn({
    facilityId, username: "admin", password: "ChangeMe123",
    mfaCode: codeAt(DEMO_MFA_SECRET, Date.now()),
  });
  assert.equal(session.mfaVerified, true);
  assert.equal(A.check(adminId, "user.manage", undefined, session.token).allowed, true);

  assert.throws(
    () => U2.signIn({ facilityId, username: "admin", password: "ChangeMe123", mfaCode: "111111" }),
    /do not match/,
    "a wrong code is a failed sign-in, not a half-open session",
  );
});

test("a deactivated account can do nothing", () => {
  U.setActive({ userId: receptionistId, active: false, byUserId: adminId, byUserName: "admin", reason: "left" });
  const decision = A.check(receptionistId, "patient.register");
  assert.equal(decision.allowed, false);
  assert.equal(!decision.allowed && decision.reason, "inactive");
  U.setActive({ userId: receptionistId, active: true, byUserId: adminId, byUserName: "admin" });
});

test("a typo in a permission name fails loudly instead of granting access", () => {
  assert.throws(
    () => A.check(clinicianId, "prescription.writee"),
    A.AccessError,
    "an unknown permission is a programming error, and a silent false would hide it",
  );
});

test("a refused attempt is recorded for the investigator", () => {
  assert.throws(
    () => A.requirePermission(receptionistId, "claim.submit", { actorName: "Joseph Otieno" }),
    A.AccessError,
  );
  const row = get<{ action: string; detail: string }>(
    `SELECT action, detail FROM audit_log ORDER BY id DESC LIMIT 1`,
  )!;
  assert.equal(row.action, "access_denied");
  assert.match(row.detail, /claim\.submit/);
});

test("every licence-gated permission is a clinical act, and every clinical act is gated", () => {
  const gated = A.listPermissions().filter((p) => p.requires_licence).map((p) => p.code);
  for (const code of ["prescription.write", "diagnosis.code", "dispense.controlled", "patient.discharge"]) {
    assert.ok(gated.includes(code), `${code} must require a current licence`);
  }
  for (const code of ["payment.receive", "patient.register", "report.read"]) {
    assert.ok(!gated.includes(code), `${code} is not a licensed act and must not be gated`);
  }
});
