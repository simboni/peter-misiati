/**
 * M00 — the facility, its identifiers and its compliance flags.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-facility-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const { seedReferenceData } = await import("../src/lib/seed.ts");
const F = await import("../src/lib/facility.ts");
const { verifyAuditChain, get } = await import("../src/lib/db.ts");

seedReferenceData();

const facilityId = F.registerFacility({
  name: "Bungoma Family Clinic",
  kmhflCode: "17284",
  level: 2,
  county: "Bungoma",
});

test("a facility needs a KMHFL code, and it must be unique", () => {
  assert.throws(
    () => F.registerFacility({ name: "No Code", kmhflCode: "  ", level: 2 }),
    /KMHFL/,
    "MOH returns are rejected without it",
  );
  assert.throws(
    () => F.registerFacility({ name: "Duplicate", kmhflCode: "17284", level: 3 }),
    /already registered/,
  );
});

test("the facility level must be one MOH actually uses", () => {
  assert.throws(() => F.registerFacility({ name: "Bad Level", kmhflCode: "99991", level: 1 }), /level must be 2-6/);
  assert.throws(() => F.registerFacility({ name: "Bad Level", kmhflCode: "99992", level: 7 }), /level must be 2-6/);
});

test("missing payer and tax identifiers are flagged as critical, not as warnings", () => {
  const flags = F.facilityCompliance(facilityId);
  const byKey = Object.fromEntries(flags.map((f) => [f.key, f]));

  assert.equal(byKey["sha_provider_code"].severity, "critical", "no SHA code means no claim can be submitted");
  assert.equal(byKey["kra_pin"].severity, "critical", "no KRA PIN means no eTIMS invoice can be issued");
  assert.equal(byKey["odpc_registration"].severity, "critical");
});

test("an ODPC registration nearing expiry warns before it lapses", () => {
  const in30Days = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  F.setOdpcRegistration({
    facilityId,
    registration: "ODPC/DC/2026/00412",
    expiresOn: in30Days,
    byUserId: null,
    byUserName: "test",
  });

  const flag = F.facilityCompliance(facilityId).find((f) => f.key === "odpc_registration")!;
  assert.equal(flag.severity, "warning");
  assert.match(flag.message, /expires in 30 days/);
});

test("an expired ODPC registration is critical", () => {
  const lastMonth = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  F.setOdpcRegistration({
    facilityId,
    registration: "ODPC/DC/2024/00412",
    expiresOn: lastMonth,
    byUserId: null,
    byUserName: "test",
  });
  const flag = F.facilityCompliance(facilityId).find((f) => f.key === "odpc_registration")!;
  assert.equal(flag.severity, "critical");
  assert.match(flag.message, /expired on/);
});

test("a device code cannot be registered twice", () => {
  F.registerDevice({ facilityId, code: "TAB1", label: "Reception tablet", byUserId: null, byUserName: "test" });
  assert.throws(
    () => F.registerDevice({ facilityId, code: "TAB1", label: "Another", byUserId: null, byUserName: "test" }),
    /already registered/,
    "two devices sharing a prefix would mint colliding identifiers",
  );
});

test("settings round-trip, with a usable numeric fallback", () => {
  F.setSetting("claim_submission_window_days", "7");
  assert.equal(F.getSetting("claim_submission_window_days"), "7");
  assert.equal(F.getSettingNumber("claim_submission_window_days", 5), 7);
  assert.equal(F.getSettingNumber("not_set_at_all", 5), 5);
  F.setSetting("garbage", "not-a-number");
  assert.equal(F.getSettingNumber("garbage", 5), 5, "a corrupt value falls back rather than yielding NaN");
});

test("every configuration change left an intact audit trail", () => {
  const result = verifyAuditChain();
  assert.equal(result.ok, true, "the chain must survive a full session of ordinary work");
  assert.ok(result.ok && result.checked > 5);
});
