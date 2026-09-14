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
  // The administrator role grants user.manage, which is MFA-gated.
  assert.ok(A.grantedPermissions(adminId).includes("user.manage"), "the role grants it");

  const before = A.check(adminId, "user.manage");
  assert.equal(before.allowed, false, "holding the role is not enough");
  assert.equal(!before.allowed && before.reason, "mfa-required");

  U.enableMfa({ userId: adminId, secret: "JBSWY3DPEHPK3PXP", byUserName: "Facility Administrator" });
  assert.ok(A.can(adminId, "user.manage"), "with the second factor it resolves");
});

test("the MFA seed never reaches the audit log", () => {
  const rows = all<{ detail: string }>(`SELECT detail FROM audit_log WHERE action = 'mfa_enabled'`);
  assert.equal(rows.length, 1);
  assert.ok(!rows[0].detail.includes("JBSWY3DPEHPK3PXP"), "the seed must not be logged");
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
