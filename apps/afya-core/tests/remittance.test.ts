/**
 * M56 Remittance & Reconciliation.
 *
 * The commercially important tests are the two about honesty: a line the
 * importer cannot place is kept rather than dropped, and a claim paid short is
 * recorded as a rejection with the payer's own reason — because that reason is
 * the corpus the scrubber was always supposed to be built from.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-remit-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const { seedDemo } = await import("../src/lib/seed.ts");
const R = await import("../src/lib/remittance.ts");
const C = await import("../src/lib/claims.ts");
const B = await import("../src/lib/billing.ts");
const P = await import("../src/lib/patients.ts");
const E = await import("../src/lib/encounters.ts");
const Pay = await import("../src/lib/payers.ts");
const N = await import("../src/lib/notifications.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get, all, run } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "REM1", label: "Claims desk", byUserId: adminId, byUserName: "admin" });

const DEV = "REM1";
const DOC = { byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru" };
const DESK = { byUserId: receptionistId, byUserName: "Joseph Otieno" };
const BY = { byUserId: adminId, byUserName: "Claims Officer" };

let nid = 95_000_000;
let ref = 0;

/** A submitted SHA claim, with a known reference. */
function submittedClaim(): { claimId: string; reference: string; totalCents: number } {
  const mrn = P.registerPatient({
    facilityId, deviceCode: DEV, givenName: "Claimant", familyName: "Test", sex: "female",
    nationalId: String(++nid), ...DESK,
  });
  Pay.verifyCoverage({
    patientMrn: mrn, payerCode: "SHA", memberNumber: `SHA-${nid}`,
    probe: () => ({ reachable: true, active: true }), ...DESK,
  });
  const enc = E.openEncounter({
    facilityId, patientMrn: mrn, kind: "outpatient",
    clinicianId, clinicianName: DOC.byUserName, deviceCode: DEV,
  });
  E.addDiagnosis({ encounterId: enc, code: "1F40", ...DOC, deviceCode: DEV });
  E.writeNote({
    encounterId: enc, complaint: "Fever", assessment: "Malaria", plan: "Treat",
    authorId: clinicianId, authorName: DOC.byUserName, deviceCode: DEV,
  });
  B.assembleCharges({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...DOC });
  B.issueInvoice({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...DOC });
  E.closeEncounter({ encounterId: enc, byUserId: clinicianId, byUserName: DOC.byUserName, deviceCode: DEV });

  const claimId = C.assembleClaim({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...DOC });
  const reference = `SHA-REF-${String(++ref).padStart(4, "0")}`;
  const result = C.submitClaim({ claimId, ...BY, submit: () => ({ ok: true, reference }) });
  assert.equal(result.submitted, true, result.error ?? "");
  return { claimId, reference, totalCents: C.getClaim(claimId)!.total_cents };
}

// ==================================================================== import

test("an advice must carry the payer's own reference", () => {
  assert.throws(
    () => R.importRemittance({
      facilityId, payerCode: "SHA", reference: "  ", adviceDate: "2026-09-01",
      statedTotalCents: 1000, lines: [{ paidCents: 1000 }], deviceCode: DEV, ...BY,
    }),
    /payer's own reference/,
  );
});

test("the same advice cannot be imported twice", () => {
  const claim = submittedClaim();
  const advice = {
    facilityId, payerCode: "SHA", reference: "PA-0001", adviceDate: "2026-09-01",
    statedTotalCents: claim.totalCents,
    lines: [{ payerReference: claim.reference, paidCents: claim.totalCents }],
    deviceCode: DEV, ...BY,
  };
  R.importRemittance(advice);
  assert.throws(() => R.importRemittance(advice), /already imported/, "somebody will do it");
});

test("a line is matched by the reference we recorded at submission, and says so", () => {
  const claim = submittedClaim();
  const { id, matched, unmatched } = R.importRemittance({
    facilityId, payerCode: "SHA", reference: "PA-0002", adviceDate: "2026-09-02",
    statedTotalCents: claim.totalCents,
    lines: [{ payerReference: claim.reference, paidCents: claim.totalCents }],
    deviceCode: DEV, ...BY,
  });

  assert.equal(matched, 1);
  assert.equal(unmatched, 0);
  const line = R.linesFor(id)[0];
  assert.equal(line.claim_id, claim.claimId);
  assert.equal(line.matched_by, "reference", "so a wrong match can be found afterwards");
  assert.equal(line.claimed_cents, claim.totalCents, "and what we asked for is filled in from the claim");
});

test("a line the importer cannot place is kept, not dropped", () => {
  const { id, matched, unmatched } = R.importRemittance({
    facilityId, payerCode: "SHA", reference: "PA-0003", adviceDate: "2026-09-03",
    statedTotalCents: 50_000,
    lines: [{ payerReference: "SHA-REF-NOT-OURS", paidCents: 50_000 }],
    deviceCode: DEV, ...BY,
  });

  assert.equal(matched, 0);
  assert.equal(unmatched, 1);
  const line = R.linesFor(id)[0];
  assert.equal(line.claim_id, null);
  assert.equal(line.paid_cents, 50_000, "a payer paying for a claim we have no record of is a real event");
  assert.ok(N.inbox(facilityId, "claims_officer").some((n) => n.kind === "unmatched_remittance"));
});

test("an advice that disagrees with its own lines is flagged as an advice problem", () => {
  const claim = submittedClaim();
  R.importRemittance({
    facilityId, payerCode: "SHA", reference: "PA-0004", adviceDate: "2026-09-04",
    // The payer states one figure and the lines add up to another.
    statedTotalCents: claim.totalCents + 10_000,
    lines: [{ payerReference: claim.reference, paidCents: claim.totalCents }],
    deviceCode: DEV, ...BY,
  });

  const raised = N.inbox(facilityId, "claims_officer").find((n) => n.kind === "advice_does_not_add_up")!;
  assert.ok(raised, "the difference is in the advice itself, not in a claim");
  assert.match(raised.subject, /but its lines total/);
});

test("an unknown payer and an empty advice are refused", () => {
  assert.throws(
    () => R.importRemittance({
      facilityId, payerCode: "NHIF", reference: "X", adviceDate: "2026-09-01",
      statedTotalCents: 0, lines: [{ paidCents: 1 }], deviceCode: DEV, ...BY,
    }),
    /unknown payer/,
  );
  assert.throws(
    () => R.importRemittance({
      facilityId, payerCode: "SHA", reference: "PA-EMPTY", adviceDate: "2026-09-01",
      statedTotalCents: 0, lines: [], deviceCode: DEV, ...BY,
    }),
    /no lines/,
  );
});

// ================================================================ reconciling

test("a claim paid in full is paid", () => {
  const claim = submittedClaim();
  const { id } = R.importRemittance({
    facilityId, payerCode: "SHA", reference: "PA-0010", adviceDate: "2026-09-10",
    statedTotalCents: claim.totalCents,
    lines: [{ payerReference: claim.reference, paidCents: claim.totalCents }],
    deviceCode: DEV, ...BY,
  });

  const result = R.reconcile({ remittanceId: id, ...BY });
  assert.equal(result.claimsPaid, 1);
  assert.equal(result.shortfallCents, 0);
  assert.equal(C.getClaim(claim.claimId)!.status, "paid");
});

test("a claim paid short is a rejection, and keeps the payer's reason", () => {
  const claim = submittedClaim();
  const { id } = R.importRemittance({
    facilityId, payerCode: "SHA", reference: "PA-0011", adviceDate: "2026-09-11",
    statedTotalCents: claim.totalCents - 20_000,
    lines: [{
      payerReference: claim.reference,
      paidCents: claim.totalCents - 20_000,
      reasonCode: "E11",
      reason: "Service not covered under the member's package",
    }],
    deviceCode: DEV, ...BY,
  });

  const result = R.reconcile({ remittanceId: id, ...BY });
  assert.equal(result.claimsShort, 1);
  assert.equal(result.shortfallCents, 20_000);

  const settled = C.getClaim(claim.claimId)!;
  assert.equal(settled.status, "rejected", "a partial payment is a rejection of the rest");
  assert.equal(settled.rejection_code, "E11");
  assert.match(settled.rejection_reason!, /not covered/);

  assert.ok(N.inbox(facilityId, "claims_officer").some((n) => n.kind === "shortfall"));
});

test("a shortfall with no stated reason says so rather than inventing one", () => {
  const claim = submittedClaim();
  const { id } = R.importRemittance({
    facilityId, payerCode: "SHA", reference: "PA-0012", adviceDate: "2026-09-12",
    statedTotalCents: 10_000,
    lines: [{ payerReference: claim.reference, paidCents: 10_000 }],
    deviceCode: DEV, ...BY,
  });
  R.reconcile({ remittanceId: id, ...BY });
  assert.match(C.getClaim(claim.claimId)!.rejection_reason!, /no reason stated/);
});

test("an advice cannot be reconciled twice", () => {
  const claim = submittedClaim();
  const { id } = R.importRemittance({
    facilityId, payerCode: "SHA", reference: "PA-0013", adviceDate: "2026-09-13",
    statedTotalCents: claim.totalCents,
    lines: [{ payerReference: claim.reference, paidCents: claim.totalCents }],
    deviceCode: DEV, ...BY,
  });
  R.reconcile({ remittanceId: id, ...BY });
  assert.throws(() => R.reconcile({ remittanceId: id, ...BY }), /was reconciled on/);
});

// ============================================================ matching by hand

test("an unmatched line can be matched by a person, and records that it was", () => {
  const claim = submittedClaim();
  const { id } = R.importRemittance({
    facilityId, payerCode: "SHA", reference: "PA-0020", adviceDate: "2026-09-20",
    statedTotalCents: claim.totalCents,
    lines: [{ payerReference: "THEIR-OWN-FILING-CODE", paidCents: claim.totalCents }],
    deviceCode: DEV, ...BY,
  });

  const line = R.linesFor(id)[0];
  assert.equal(line.matched_by, "unmatched");

  R.matchByHand({ lineId: line.id, claimId: claim.claimId, ...BY });
  const matched = R.linesFor(id)[0];
  assert.equal(matched.claim_id, claim.claimId);
  assert.equal(matched.matched_by, "manual");
  assert.equal(matched.claimed_cents, claim.totalCents);
});

test("a line cannot be matched to another payer's claim, or to a claim already settled", () => {
  const claim = submittedClaim();
  Pay.definePayer({ code: "BUPA", name: "Bupa", kind: "private", byUserName: "seed" });

  const { id } = R.importRemittance({
    facilityId, payerCode: "BUPA", reference: "PA-0021", adviceDate: "2026-09-21",
    statedTotalCents: 1000, lines: [{ paidCents: 1000 }], deviceCode: DEV, ...BY,
  });
  assert.throws(
    () => R.matchByHand({ lineId: R.linesFor(id)[0].id, claimId: claim.claimId, ...BY }),
    /but this advice is from BUPA/,
  );

  // And a claim already on another advice cannot be claimed twice.
  const first = R.importRemittance({
    facilityId, payerCode: "SHA", reference: "PA-0022", adviceDate: "2026-09-22",
    statedTotalCents: claim.totalCents,
    lines: [{ payerReference: claim.reference, paidCents: claim.totalCents }],
    deviceCode: DEV, ...BY,
  });
  assert.ok(first.matched === 1);

  const second = R.importRemittance({
    facilityId, payerCode: "SHA", reference: "PA-0023", adviceDate: "2026-09-23",
    statedTotalCents: 1000, lines: [{ paidCents: 1000 }], deviceCode: DEV, ...BY,
  });
  assert.throws(
    () => R.matchByHand({ lineId: R.linesFor(second.id)[0].id, claimId: claim.claimId, ...BY }),
    /already settled on another advice/,
  );
});

test("a shortfall the facility does not accept can be disputed", () => {
  const claim = submittedClaim();
  const { id } = R.importRemittance({
    facilityId, payerCode: "SHA", reference: "PA-0030", adviceDate: "2026-09-30",
    statedTotalCents: 5_000,
    lines: [{ payerReference: claim.reference, paidCents: 5_000, reasonCode: "E03", reason: "Pre-authorisation not quoted" }],
    deviceCode: DEV, ...BY,
  });
  const line = R.linesFor(id)[0];

  assert.throws(() => R.disputeLine({ lineId: line.id, reason: "  ", ...BY }), /what is being disputed/);
  R.disputeLine({ lineId: line.id, reason: "Pre-authorisation SHA-PA-441029 was quoted on the claim", ...BY });

  assert.ok(R.linesFor(id)[0].disputed_at);
  assert.equal(R.getRemittance(id)!.status, "disputed", "a shortfall not accepted is not a loss yet");
});

// ===================================================== the money, and the rules

test("reconciliation reports by value, not by count", () => {
  const view = R.reconciliation(facilityId);
  assert.ok(view.submittedCents > 0);
  assert.ok(view.paidCents > 0);
  assert.ok(view.shortfallCents > 0);
  assert.ok(view.recoveryRatePercent !== null && view.recoveryRatePercent < 100);
  assert.equal(
    view.claimsSubmitted >= view.claimsSettled,
    true,
    "ninety claims paid out of a hundred can still be a disaster if the ten were the expensive ones",
  );
});

test("the rejection taxonomy ranks reasons by what they cost, not how often they happen", () => {
  const taxonomy = R.rejectionTaxonomy(facilityId);
  assert.ok(taxonomy.length > 0);
  assert.deepEqual(
    taxonomy.map((t) => t.costCents),
    [...taxonomy.map((t) => t.costCents)].sort((a, b) => b - a),
  );
  assert.ok(taxonomy.some((t) => t.code === "E11"));
  assert.ok(taxonomy.every((t) => t.occurrences > 0 && t.costCents > 0));
});

test("claims nobody has ever paid for are findable", () => {
  const claim = submittedClaim();
  run(
    `UPDATE claims SET submitted_at = ? WHERE id = ?`,
    new Date(Date.now() - 75 * 86_400_000).toISOString(),
    claim.claimId,
  );

  const stale = R.unsettledClaims(facilityId, 30);
  const found = stale.find((s) => s.id === claim.claimId)!;
  assert.ok(found, "submitted, and no advice has ever mentioned it");
  assert.ok(found.days >= 74);
});

test("the advice register shows what arrived against what was asked for", () => {
  const register = R.listRemittances(facilityId);
  assert.ok(register.length > 0);
  assert.ok(register.every((r) => r.lines > 0));
  assert.ok(register.some((r) => r.shortfall_cents > 0));
  assert.ok(register.some((r) => r.status === "reconciled"));
});

test("the audit chain survives reconciliation", () => {
  const v = verifyAuditChain();
  assert.equal(v.ok, true, v.ok ? "" : `broken at entry ${v.failedAtId}`);
});
