/**
 * M75 Configuration Studio.
 *
 * The test that matters most is the one about a review going stale: a sign-off
 * vouches for a number, not for a key, and a register that carries a review
 * forward over a changed value is worse than one with no reviews in it.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-config-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const C = await import("../src/lib/configuration.ts");
const A = await import("../src/lib/assets.ts");
const M = await import("../src/lib/mortuary.ts");
const I = await import("../src/lib/indicators.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, all } = await import("../src/lib/db.ts");

const { facilityId, adminId } = seedDemo();
registerDevice({ facilityId, code: "CFG1", label: "Office", byUserId: adminId, byUserName: "admin" });
const BY = { byUserId: adminId!, byUserName: "Facility Administrator" };

// ------------------------------------------------------------------ reading

test("a setting with nothing set reads the value in the code", () => {
  assert.equal(C.raw("mortuary.free_days"), "2");
  assert.equal(C.number("mortuary.free_days"), 2);
  assert.equal(C.stateOf("mortuary.free_days").isDefault, true);
  assert.equal(C.stateOf("mortuary.free_days").status, "default");
});

test("an unregistered key is an error, not a silent empty string", () => {
  assert.throws(() => C.raw("something.invented"), /not a registered setting/);
});

test("every registered setting names the rule it is the number behind", () => {
  for (const definition of C.REGISTRY) {
    assert.match(definition.rule, /^\d+\./, `${definition.key} cites no rule`);
    assert.ok(definition.explains.length > 20, `${definition.key} explains nothing`);
    assert.ok(definition.reviewer.length > 2, `${definition.key} says nobody should review it`);
    assert.doesNotThrow(() => C.raw(definition.key));
  }
});

// ------------------------------------------------------------------ writing

test("changing a setting changes what the module actually does", () => {
  // The whole point. A studio whose numbers the modules ignore is a screen.
  assert.equal(M.freeDays(), 2);
  C.apply({ key: "mortuary.free_days", value: "3", reason: "County practice is three days", ...BY });
  assert.equal(M.freeDays(), 3);

  const body = { received_at: new Date(Date.now() - 5 * 86_400_000).toISOString(), released_at: null } as never;
  assert.equal(M.storageFee(body).chargeableDays, 2, "five days less three free");
});

test("a clinical threshold cannot be changed without a source", () => {
  // "The pharmacist said so" is a reason. It cannot be defended eighteen
  // months later by somebody who was not in the room.
  assert.throws(
    () => C.apply({ key: "cold_chain.min_tenths", value: "25", reason: "The pharmacist asked", ...BY }),
    /Record the source it comes from/,
  );

  C.apply({
    key: "cold_chain.min_tenths", value: "25",
    reason: "This facility stores a product with a narrower range",
    source: "Manufacturer's stability data for the product, 2026 insert",
    ...BY,
  });
  assert.equal(A.coldChainRange().minTenths, 25);
});

test("a non-clinical setting still records why", () => {
  assert.throws(
    () => C.apply({ key: "assets.due_horizon_days", value: "45", reason: "  ", ...BY }),
    /records why/,
  );
});

test("a value outside its bounds is refused", () => {
  assert.throws(
    () => C.apply({ key: "indicators.small_cell", value: "500", reason: "why not", ...BY }),
    /cannot be above/,
  );
  assert.throws(
    () => C.apply({ key: "indicators.small_cell", value: "2.5", reason: "why not", ...BY }),
    /whole number/,
  );
});

test("setting a value to what it already is is refused rather than logged as a change", () => {
  assert.throws(
    () => C.apply({ key: "mortuary.free_days", value: "3", reason: "again", ...BY }),
    /already 3/,
  );
});

test("resetting puts it back and is itself recorded", () => {
  C.apply({ key: "mortuary.unclaimed_days", value: "30", reason: "County asked for thirty", ...BY });
  assert.equal(M.unclaimedDays(), 30);

  C.reset({ key: "mortuary.unclaimed_days", reason: "County withdrew the request", ...BY });
  assert.equal(M.unclaimedDays(), 21);
  assert.equal(C.stateOf("mortuary.unclaimed_days").isDefault, true);
  assert.ok(C.historyFor("mortuary.unclaimed_days").some((h) => h.kind === "reset"));
});

test("resetting something already at its default is refused", () => {
  assert.throws(
    () => C.reset({ key: "mortuary.unclaimed_days", reason: "again", ...BY }),
    /already the default/,
  );
});

// ------------------------------------------------------------------ reviews

test("a review records that somebody read it and kept it", () => {
  // The most valuable thing here: it turns a red row in the review register
  // into a green one without a line of code changing.
  assert.equal(C.stateOf("indicators.min_denominator").status, "default");

  C.markReviewed({
    key: "indicators.min_denominator",
    reviewerName: "Beatrice Kilonzo",
    reviewerRole: "Facility manager",
    note: "Twenty is right for our volumes",
    ...BY,
  });

  const state = C.stateOf("indicators.min_denominator");
  assert.equal(state.status, "reviewed");
  assert.equal(state.isDefault, true, "reviewed and unchanged is the commonest good outcome");
  assert.equal(state.reviewedBy!.name, "Beatrice Kilonzo");
});

test("a review records who by name, not by role alone", () => {
  assert.throws(
    () => C.markReviewed({ key: "assets.due_horizon_days", reviewerName: "  ", ...BY }),
    /by name, not by role alone/,
  );
});

test("reviewing a clinical threshold records what it was checked against", () => {
  assert.throws(
    () => C.markReviewed({ key: "cold_chain.max_tenths", reviewerName: "Grace Kimani", ...BY }),
    /what it was checked against/,
  );

  C.markReviewed({
    key: "cold_chain.max_tenths",
    reviewerName: "Grace Kimani",
    reviewerRole: "Pharmacist",
    source: "WHO cold chain guidance for EPI vaccines",
    ...BY,
  });
  assert.equal(C.stateOf("cold_chain.max_tenths").status, "reviewed");
});

test("changing the value retires the review rather than carrying it forward", () => {
  // A sign-off vouches for a number, not for a key.
  assert.equal(C.stateOf("cold_chain.max_tenths").status, "reviewed");

  C.apply({
    key: "cold_chain.max_tenths", value: "70",
    reason: "Narrower range for a product we now stock",
    source: "Manufacturer's stability data",
    ...BY,
  });

  const state = C.stateOf("cold_chain.max_tenths");
  assert.equal(state.status, "changed_unreviewed", "nobody has vouched for 70");
  assert.equal(state.reviewedBy, undefined);
});

test("a review of a changed value stands until the value moves again", () => {
  C.markReviewed({
    key: "cold_chain.max_tenths", reviewerName: "Grace Kimani",
    reviewerRole: "Pharmacist", source: "Manufacturer's stability data", ...BY,
  });
  assert.equal(C.stateOf("cold_chain.max_tenths").status, "reviewed");
  assert.equal(C.stateOf("cold_chain.max_tenths").isDefault, false);
});

// ------------------------------------------------------------------ history

test("the history is append-only and keeps what the number used to be", () => {
  // A threshold that was 20 last year is what a case from last year was judged
  // against.
  const history = C.historyFor("cold_chain.max_tenths");
  assert.ok(history.length >= 3);
  assert.ok(history.some((h) => h.kind === "changed" && h.old_value === "80" && h.new_value === "70"));
  assert.ok(history.some((h) => h.kind === "reviewed"));
});

test("a change is on the audit log with its source", () => {
  const entries = all<{ detail: string }>(
    `SELECT detail FROM audit_log WHERE action = 'setting_changed' AND entity_id = ?`,
    "cold_chain.max_tenths",
  );
  assert.ok(entries.some((e) => e.detail.includes("stability data")));
});

// ------------------------------------------------------------------ reports

test("the worklist is what nobody has signed off, clinical first", () => {
  const outstanding = C.outstanding();
  assert.ok(outstanding.length > 0);

  const firstNonClinical = outstanding.findIndex((s) => !s.definition.clinical);
  const lastClinical = outstanding.map((s) => s.definition.clinical).lastIndexOf(true);
  if (firstNonClinical !== -1 && lastClinical !== -1) {
    assert.ok(lastClinical < firstNonClinical, "clinical settings come first");
  }
  assert.ok(!outstanding.some((s) => s.definition.key === "indicators.min_denominator"), "reviewed ones drop off");
});

test("the summary counts what is left to confirm", () => {
  const summary = C.configSummary();
  assert.equal(summary.settings, C.REGISTRY.length);
  assert.ok(summary.reviewed >= 2);
  assert.ok(summary.changed >= 2);
  assert.ok(summary.clinicalUnreviewed >= 1);
  assert.equal(summary.locked, C.LOCKED.length);
  assert.equal(summary.hardCoded, C.HARD_CODED.length);
});

test("what cannot be changed is listed rather than hidden", () => {
  // A facility asking "can we turn that off" deserves to be told no and why,
  // on a screen, rather than by nobody.
  assert.ok(C.LOCKED.length >= 5);
  for (const locked of C.LOCKED) {
    assert.ok(locked.why.length > 20, `${locked.name} does not say why`);
    assert.ok(locked.where.endsWith(".ts"));
  }
});

test("constants that are still hard-coded are named, not implied away", () => {
  assert.ok(C.HARD_CODED.length >= 5);
  for (const item of C.HARD_CODED) {
    assert.ok(item.rule.length > 1, `${item.name} cites no rule`);
  }
  const registered = new Set(C.REGISTRY.map((r) => r.key));
  assert.ok(!C.HARD_CODED.some((h) => registered.has(h.name)));
});

test("the audit chain still verifies after all of that", () => {
  assert.equal(verifyAuditChain().ok, true);
});
