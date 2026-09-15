/**
 * M53 Payer & Coverage, M54 Pre-authorisation, M50 Billing, M52 eTIMS,
 * M55 Claims Engine and the scrubber.
 *
 * The scrubber tests are the commercially important ones: each gate maps to a
 * documented SHA rejection cause, and each must catch its case *before* the
 * claim leaves the building.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-rev-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";
import type { PayerProbe } from "../src/lib/payers.ts";
import type { Invoice } from "../src/lib/billing.ts";

const { seedDemo } = await import("../src/lib/seed.ts");
const Pay = await import("../src/lib/payers.ts");
const B = await import("../src/lib/billing.ts");
const C = await import("../src/lib/claims.ts");
const E = await import("../src/lib/encounters.ts");
const P = await import("../src/lib/patients.ts");
const Rx = await import("../src/lib/prescribing.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const T = await import("../src/lib/terminology.ts");
const { verifyAuditChain, get, all, run } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "CONS", label: "Consulting room", byUserId: adminId, byUserName: "admin" });

const DEV = "CONS";
const BY = { byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru" };
const TODAY = new Date().toISOString().slice(0, 10);

function newPatient(given: string, nid: string): string {
  return P.registerPatient({
    facilityId, deviceCode: DEV, givenName: given, familyName: "Test", sex: "male",
    nationalId: nid, byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
}

/** A complete, claimable encounter: diagnosed, noted, closed. */
function completeEncounter(mrn: string): string {
  const id = E.openEncounter({
    facilityId, patientMrn: mrn, kind: "outpatient",
    clinicianId, clinicianName: BY.byUserName, deviceCode: DEV,
  });
  E.addDiagnosis({ encounterId: id, code: "1F40", ...BY, deviceCode: DEV });
  E.writeNote({
    encounterId: id, complaint: "Fever", assessment: "Falciparum malaria, RDT positive",
    plan: "AL", authorId: clinicianId, authorName: BY.byUserName, deviceCode: DEV,
  });
  return id;
}

// ================================================================= M53 payers

test("the seeded payers carry SHA's real rules", () => {
  const sha = Pay.getPayer("SHA")!;
  assert.equal(sha.kind, "sha");
  assert.equal(sha.claim_window_days, 7, "a claim beyond seven days is rejected automatically");
  assert.ok(Pay.getPayer("CASH"));
});

test("an unreachable payer does not block care — it queues and says so", () => {
  const mrn = newPatient("Unreachable", "40000001");
  const result = Pay.verifyCoverage({
    patientMrn: mrn, payerCode: "SHA", memberNumber: "SHA-0001",
    byUserId: receptionistId, byUserName: "Joseph Otieno",
    // The default probe: nothing configured, so the payer is unreachable.
  });

  assert.equal(result.source, "provisional");
  assert.equal(result.provisional, true, "care proceeds");
  assert.match(result.message, /Queued/, "and the request is not lost");
  assert.ok(Pay.pendingVerifications().some((v) => v.patient_mrn === mrn));
});

test("a reachable payer gives a real verification, and it is cached", () => {
  const mrn = newPatient("Reachable", "40000002");
  const probe: PayerProbe = () => ({ reachable: true, active: true, schemeName: "Taifa Care" });

  const first = Pay.verifyCoverage({
    patientMrn: mrn, payerCode: "SHA", memberNumber: "SHA-0002",
    byUserId: receptionistId, byUserName: "Joseph Otieno", probe,
  });
  assert.equal(first.source, "online");
  assert.equal(first.coverage.status, "active");

  // A second check inside the cache window reuses the answer rather than
  // hammering a payer that is already known to be up.
  const second = Pay.verifyCoverage({
    patientMrn: mrn, payerCode: "SHA", memberNumber: "SHA-0002",
    byUserId: receptionistId, byUserName: "Joseph Otieno",
    probe: () => { throw new Error("must not be called"); },
  });
  assert.equal(second.source, "cached");
});

test("the emergency pathway treats first and is honest about it", () => {
  const mrn = newPatient("Emergency", "40000003");
  const result = Pay.verifyCoverage({
    patientMrn: mrn, payerCode: "SHA", memberNumber: "UNKNOWN",
    byUserId: receptionistId, byUserName: "Joseph Otieno",
    emergency: { reason: "ECCIF — unidentified emergency patient" },
  });
  assert.equal(result.source, "emergency");
  assert.equal(result.provisional, true);
  assert.match(result.message, /unconfirmed/, "the claim will not pretend the member was verified");
});

test("a benefit rule must record its source, and absence is not permission", () => {
  assert.throws(
    () => Pay.defineBenefit({ payerCode: "SHA", serviceCode: "X", source: " " }),
    /source/,
  );
  assert.equal(Pay.benefitFor("SHA", "NOT-A-SERVICE"), null, "unknown means uncovered, not covered");
});

// ================================================================ M50 billing

test("money is integer cents, and formatting never touches arithmetic", () => {
  assert.equal(B.formatKes(50_000), "KES 500.00");
  assert.equal(B.formatKes(12_34), "KES 12.34");
  assert.equal(B.formatKes(0), "KES 0.00");
});

test("a tariff must record its source and cannot be a float or negative", () => {
  assert.throws(() => B.setTariff({ payerCode: "CASH", serviceCode: "CONSULT-OP", priceCents: 100, source: " " }), /source/);
  assert.throws(() => B.setTariff({ payerCode: "CASH", serviceCode: "CONSULT-OP", priceCents: 10.5, source: "x" }), /whole number/);
  assert.throws(() => B.setTariff({ payerCode: "CASH", serviceCode: "CONSULT-OP", priceCents: -1, source: "x" }), /negative/);
});

test("a tariff is priced as of the date of service, not today", () => {
  B.setTariff({ payerCode: "CASH", serviceCode: "CONSULT-OP", priceCents: 90_000, effectiveFrom: "2099-01-01", source: "future" });
  const now = B.priceFor("CASH", "CONSULT-OP", TODAY)!;
  assert.equal(now.price_cents, 50_000, "a future tariff must not reprice care given today");
  assert.equal(B.priceFor("CASH", "CONSULT-OP", "2099-06-01")!.price_cents, 90_000);
});

test("an unpriced service is refused rather than billed at zero", () => {
  B.defineService({ code: "NOPRICE", name: "Unpriced thing" });
  const mrn = newPatient("Unpriced", "40000004");
  const enc = completeEncounter(mrn);
  assert.throws(
    () => B.addCharge({ encounterId: enc, serviceCode: "NOPRICE", payerCode: "CASH", sourceKind: "other", deviceCode: DEV, ...BY }),
    /Load the tariff before billing it/,
    "an unpriced line is a rejected claim line",
  );
});

test("charges assemble from the clinical record, once each", () => {
  const mrn = newPatient("Assembly", "40000005");
  const enc = completeEncounter(mrn);
  Rx.prescribe({
    encounterId: enc, productCode: "AL-20-120", dose: "4 tablets", frequency: "bd",
    quantity: 24, deviceCode: DEV, prescriberId: clinicianId, prescriberName: BY.byUserName,
  });

  const first = B.assembleCharges({ encounterId: enc, payerCode: "CASH", deviceCode: DEV, ...BY });
  assert.equal(first.added.length, 2, "the consultation and the prescription");

  // Running it again must not double-bill.
  const second = B.assembleCharges({ encounterId: enc, payerCode: "CASH", deviceCode: DEV, ...BY });
  assert.equal(second.added.length, 0);
  assert.equal(B.chargesFor(enc).length, 2);

  // 500.00 consultation + 24 x 350.00 artemether
  assert.equal(B.encounterTotalCents(enc), 50_000 + 24 * 35_000);
});

test("the leakage report names clinical events with no charge against them", () => {
  const mrn = newPatient("Leakage", "40000006");
  const enc = completeEncounter(mrn);
  Rx.prescribe({
    encounterId: enc, productCode: "PARA-500", dose: "1 g", frequency: "tds",
    quantity: 21, deviceCode: DEV, prescriberId: clinicianId, prescriberName: BY.byUserName,
  });

  const gaps = B.leakageReport(enc);
  assert.equal(gaps.length, 2, "nothing is billed yet");
  assert.ok(gaps.some((g) => g.kind === "consultation"));
  assert.ok(gaps.some((g) => g.kind === "prescription"));

  B.assembleCharges({ encounterId: enc, payerCode: "CASH", deviceCode: DEV, ...BY });
  assert.deepEqual(B.leakageReport(enc), [], "once billed, the gap closes");
});

test("an invoice is issued with a provisional number and queued for eTIMS", () => {
  const mrn = newPatient("Invoice", "40000007");
  const enc = completeEncounter(mrn);
  B.assembleCharges({ encounterId: enc, payerCode: "CASH", deviceCode: DEV, ...BY });

  const invoiceId = B.issueInvoice({ encounterId: enc, payerCode: "CASH", deviceCode: DEV, ...BY });
  assert.match(invoiceId, /^CONS-/, "minted on the device, so it works offline");

  const invoice = B.getInvoice(invoiceId)!;
  assert.equal(invoice.etims_status, "queued", "issued locally, transmitted when a link exists");
  assert.equal(invoice.etims_number, null);
  assert.equal(invoice.total_cents, 50_000);

  assert.throws(
    () => B.issueInvoice({ encounterId: enc, payerCode: "CASH", deviceCode: DEV, ...BY }),
    /already has invoice/,
  );
});

test("eTIMS keeps both numbers: the provisional one and KRA's", () => {
  const before = B.etimsBacklog();
  assert.ok(before.queued >= 1, "an untransmitted invoice is visible, not silently lost");

  let n = 0;
  const result = B.flushEtims(() => ({ ok: true, canonicalNumber: `KRA-INV-${String(++n).padStart(6, "0")}` }));
  assert.ok(result.sent >= 1);

  const invoice = all<Invoice>(`SELECT * FROM invoices WHERE etims_status = 'sent' LIMIT 1`)[0];
  assert.match(invoice.etims_number!, /^KRA-INV-/);
  assert.match(invoice.id, /^CONS-/, "the number on the patient's slip still resolves");
  assert.equal(B.etimsBacklog().queued, 0);
});

test("a failed transmission stays queued with its error, never dropped", () => {
  const mrn = newPatient("Etimsfail", "40000008");
  const enc = completeEncounter(mrn);
  B.assembleCharges({ encounterId: enc, payerCode: "CASH", deviceCode: DEV, ...BY });
  B.issueInvoice({ encounterId: enc, payerCode: "CASH", deviceCode: DEV, ...BY });

  const result = B.flushEtims(() => ({ ok: false, error: "KRA gateway timeout" }));
  assert.equal(result.failed, 1);
  const backlog = B.etimsBacklog();
  assert.equal(backlog.queued, 1);
  assert.match(backlog.lastError!, /timeout/, "an untransmitted invoice is a tax compliance failure — it must stay visible");
});

test("a payment cannot overpay an invoice", () => {
  const mrn = newPatient("Payment", "40000009");
  const enc = completeEncounter(mrn);
  B.assembleCharges({ encounterId: enc, payerCode: "CASH", deviceCode: DEV, ...BY });
  const inv = B.issueInvoice({ encounterId: enc, payerCode: "CASH", deviceCode: DEV, ...BY });

  B.recordPayment({ invoiceId: inv, method: "mpesa", amountCents: 20_000, reference: "QK12345", deviceCode: DEV, ...BY });
  assert.equal(B.balanceCents(inv), 30_000);
  assert.equal(B.getInvoice(inv)!.status, "issued", "part paid is not paid");

  assert.throws(
    () => B.recordPayment({ invoiceId: inv, method: "cash", amountCents: 40_000, deviceCode: DEV, ...BY }),
    /overpay/,
  );

  B.recordPayment({ invoiceId: inv, method: "cash", amountCents: 30_000, deviceCode: DEV, ...BY });
  assert.equal(B.balanceCents(inv), 0);
  assert.equal(B.getInvoice(inv)!.status, "paid");
});

// ============================================================ M55 the scrubber

/** A fully correct SHA claim, used as the baseline the gate tests break. */
function goodClaim(nid: string): { mrn: string; enc: string; claim: string } {
  const mrn = newPatient("Claimant", nid);
  Pay.verifyCoverage({
    patientMrn: mrn, payerCode: "SHA", memberNumber: `SHA-${nid}`,
    byUserId: receptionistId, byUserName: "Joseph Otieno",
    probe: () => ({ reachable: true, active: true }),
  });
  const enc = completeEncounter(mrn);
  B.assembleCharges({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...BY });
  B.issueInvoice({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...BY });
  E.closeEncounter({ encounterId: enc, byUserId: clinicianId, byUserName: BY.byUserName, deviceCode: DEV });
  const claim = C.assembleClaim({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...BY });
  return { mrn, enc, claim };
}

test("a correct claim passes all nine gates", () => {
  const { claim } = goodClaim("41000001");
  const verdict = C.scrub(claim);
  assert.equal(verdict.ready, true, verdict.blocking.map((g) => g.message).join(" | "));
  assert.equal(verdict.gates.length, 9);
  assert.equal(verdict.blocking.length, 0);
  assert.ok(verdict.daysLeft >= 6, "the seven-day clock has barely started");
});

test("gate 1 — a provisional verification blocks until it is re-checked", () => {
  const mrn = newPatient("Provisional", "41000002");
  Pay.verifyCoverage({
    patientMrn: mrn, payerCode: "SHA", memberNumber: "SHA-PROV",
    byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
  const enc = completeEncounter(mrn);
  B.assembleCharges({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...BY });
  B.issueInvoice({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...BY });
  E.closeEncounter({ encounterId: enc, byUserId: clinicianId, byUserName: BY.byUserName, deviceCode: DEV });
  const claim = C.assembleClaim({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...BY });

  const gate = C.scrub(claim).gates.find((g) => g.gate === 1)!;
  assert.equal(gate.passed, false);
  assert.equal(gate.owner, "reception", "it names who can fix it");
  assert.match(gate.message, /provisional/);
});

test("gate 2 — a service needing pre-authorisation blocks without one", () => {
  const mrn = newPatient("Preauth", "41000003");
  Pay.verifyCoverage({
    patientMrn: mrn, payerCode: "SHA", memberNumber: "SHA-PRE",
    byUserId: receptionistId, byUserName: "Joseph Otieno",
    probe: () => ({ reachable: true, active: true }),
  });
  const enc = completeEncounter(mrn);
  B.assembleCharges({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...BY });
  // Suturing requires pre-authorisation under the seeded benefit rules.
  B.addCharge({ encounterId: enc, serviceCode: "PROC-SUTURE", payerCode: "SHA", sourceKind: "procedure", deviceCode: DEV, ...BY });
  B.issueInvoice({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...BY });
  E.closeEncounter({ encounterId: enc, byUserId: clinicianId, byUserName: BY.byUserName, deviceCode: DEV });
  const claim = C.assembleClaim({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...BY });

  const gate = C.scrub(claim).gates.find((g) => g.gate === 2)!;
  assert.equal(gate.passed, false);
  assert.match(gate.message, /PROC-SUTURE/);
  assert.match(gate.message, /automatic rejection/);

  // Approve it and the gate clears.
  const pa = Pay.requestPreauth({
    encounterId: enc, patientMrn: mrn, payerCode: "SHA", serviceCodes: ["PROC-SUTURE"],
    clinicalSummary: "Laceration to left forearm, 4 cm", deviceCode: DEV,
    byUserId: clinicianId, byUserName: BY.byUserName,
  });
  Pay.recordPreauthDecision({
    preauthId: pa, approved: true, reference: "SHA-PA-88213",
    byUserId: clinicianId, byUserName: BY.byUserName,
  });
  assert.equal(C.scrub(claim).gates.find((g) => g.gate === 2)!.passed, true);
});

test("an approval without the payer's reference is refused", () => {
  const refMrn = newPatient("Ref", "41000010");
  const refEnc = completeEncounter(refMrn);
  const pa = Pay.requestPreauth({
    encounterId: refEnc, patientMrn: refMrn, payerCode: "SHA",
    serviceCodes: ["PROC-NEB"], clinicalSummary: "Acute asthma", deviceCode: DEV,
    byUserId: clinicianId, byUserName: BY.byUserName,
  });
  assert.throws(
    () => Pay.recordPreauthDecision({ preauthId: pa, approved: true, byUserId: clinicianId, byUserName: BY.byUserName }),
    /reference/,
    "a claim citing an approval without a reference is rejected",
  );
});

test("gate 3 — an unverified diagnosis code blocks the claim", () => {
  const { claim, enc } = goodClaim("41000004");
  assert.equal(C.scrub(claim).gates.find((g) => g.gate === 3)!.passed, true);

  // Swap the encounter's diagnosis for one that is in the catalogue but has not
  // been verified against the issuing authority.
  T.importCodes({ system: "ICD-11-MMS", source: "unchecked", concepts: [{ code: "QQ11", term: "Unchecked", verified: false }], byUserName: "test" });
  run(`UPDATE encounter_diagnoses SET code = 'QQ11' WHERE encounter_id = ? AND rank = 1`, enc);

  const gate = C.scrub(claim).gates.find((g) => g.gate === 3)!;
  assert.equal(gate.passed, false);
  assert.match(gate.message, /unverified/);
  assert.equal(gate.owner, "clinician");
});

test("gate 4 — a service outside the benefit package blocks", () => {
  const { claim, enc } = goodClaim("41000005");
  B.defineService({ code: "COSMETIC", name: "Cosmetic procedure" });
  B.setTariff({ payerCode: "SHA", serviceCode: "COSMETIC", priceCents: 100_000, effectiveFrom: "2020-01-01", source: "test" });
  // Deliberately no benefit rule: absence is not permission.
  B.addCharge({ encounterId: enc, serviceCode: "COSMETIC", payerCode: "SHA", sourceKind: "procedure", deviceCode: DEV, ...BY });
  run(`INSERT INTO claim_items (claim_id, service_code, description, quantity, amount_cents) VALUES (?, 'COSMETIC', 'Cosmetic', 1, 100000)`, claim);

  const gate = C.scrub(claim).gates.find((g) => g.gate === 4)!;
  assert.equal(gate.passed, false);
  assert.match(gate.message, /COSMETIC/);
  assert.match(gate.message, /Reprice as cash or appeal/);
});

test("gate 6 — an incoherent date blocks", () => {
  const { claim } = goodClaim("41000006");
  run(`UPDATE claims SET service_date = '2099-01-01' WHERE id = ?`, claim);
  const gate = C.scrub(claim).gates.find((g) => g.gate === 6)!;
  assert.equal(gate.passed, false);
  assert.match(gate.message, /future/);
});

test("gate 7 — a missing document is named exactly, not 'incomplete'", () => {
  const { claim } = goodClaim("41000007");
  run(`UPDATE claims SET invoice_id = NULL WHERE id = ?`, claim);
  const gate = C.scrub(claim).gates.find((g) => g.gate === 7)!;
  assert.equal(gate.passed, false);
  assert.match(gate.message, /the invoice/, "'documentation incomplete' sends a claims officer hunting for an hour");
});

test("gate 8 — an unsigned encounter blocks", () => {
  const mrn = newPatient("Unsigned", "41000008");
  Pay.verifyCoverage({
    patientMrn: mrn, payerCode: "SHA", memberNumber: "SHA-UNS",
    byUserId: receptionistId, byUserName: "Joseph Otieno", probe: () => ({ reachable: true, active: true }),
  });
  const enc = completeEncounter(mrn);
  B.assembleCharges({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...BY });
  B.issueInvoice({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...BY });
  // Deliberately left open.
  const claim = C.assembleClaim({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...BY });

  const gate = C.scrub(claim).gates.find((g) => g.gate === 8)!;
  assert.equal(gate.passed, false);
  assert.match(gate.message, /still open/);
});

test("gate 9 — a late claim escalates rather than blocking, and needs a reason", () => {
  const { claim } = goodClaim("41000009");
  // Backdate the service beyond SHA's seven-day window.
  const old = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
  run(`UPDATE claims SET service_date = ? WHERE id = ?`, old, claim);

  const verdict = C.scrub(claim);
  const gate = verdict.gates.find((g) => g.gate === 9)!;
  assert.equal(gate.severity, "escalate", "a late claim still has an appeal path — hiding it helps nobody");
  assert.ok(verdict.daysLeft < 0);
  assert.equal(verdict.ready, true, "escalation does not block the other gates");

  const attempt = C.submitClaim({
    claimId: claim, ...BY,
    submit: () => ({ ok: true, reference: "SHA-REF-1" }),
  });
  assert.equal(attempt.submitted, false);
  assert.match(attempt.error!, /past the submission window/);

  const forced = C.submitClaim({
    claimId: claim, ...BY,
    lateOverrideReason: "payer portal was down for nine days, appealing",
    submit: () => ({ ok: true, reference: "SHA-REF-1" }),
  });
  assert.equal(forced.submitted, true);
});

test("a blocked claim cannot be submitted, and the block is logged", () => {
  const mrn = newPatient("Blocked", "42000001");
  Pay.verifyCoverage({
    patientMrn: mrn, payerCode: "SHA", memberNumber: "SHA-BLK",
    byUserId: receptionistId, byUserName: "Joseph Otieno",
  }); // provisional — gate 1 will block
  const enc = completeEncounter(mrn);
  B.assembleCharges({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...BY });
  B.issueInvoice({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...BY });
  E.closeEncounter({ encounterId: enc, byUserId: clinicianId, byUserName: BY.byUserName, deviceCode: DEV });
  const claim = C.assembleClaim({ encounterId: enc, payerCode: "SHA", deviceCode: DEV, ...BY });

  const result = C.submitClaim({
    claimId: claim, ...BY,
    submit: () => { throw new Error("must never reach the payer"); },
  });
  assert.equal(result.submitted, false);
  assert.ok(result.error!.length > 0);
  assert.equal(C.getClaim(claim)!.status, "draft");
  assert.ok(C.claimEvents(claim).some((e) => e.kind === "scrub_blocked"));
});

test("a clean claim submits and stores the verdict it was checked against", () => {
  const { claim } = goodClaim("42000002");
  const result = C.submitClaim({
    claimId: claim, ...BY,
    submit: () => ({ ok: true, reference: "SHA-REF-42" }),
  });

  assert.equal(result.submitted, true);
  assert.equal(result.reference, "SHA-REF-42");

  const stored = C.getClaim(claim)!;
  assert.equal(stored.status, "submitted");
  const verdict = JSON.parse(stored.scrub_verdict);
  assert.equal(verdict.gates.length, 9, "the verdict is kept so a rejection can be compared against what we believed");

  assert.throws(() => C.submitClaim({ claimId: claim, ...BY }), /already been submitted/);
});

test("a cash payer is never claimed against", () => {
  const mrn = newPatient("Cashonly", "42000003");
  const enc = completeEncounter(mrn);
  B.assembleCharges({ encounterId: enc, payerCode: "CASH", deviceCode: DEV, ...BY });
  assert.throws(
    () => C.assembleClaim({ encounterId: enc, payerCode: "CASH", deviceCode: DEV, ...BY }),
    /cash payer is not claimed/,
  );
});

test("a rejection must record the payer's reason — it is the asset", () => {
  const { claim } = goodClaim("42000004");
  C.submitClaim({ claimId: claim, ...BY, submit: () => ({ ok: true, reference: "R1" }) });

  assert.throws(
    () => C.recordOutcome({ claimId: claim, outcome: "rejected", ...BY }),
    /must record the payer's reason/,
  );
  C.recordOutcome({
    claimId: claim, outcome: "rejected", rejectionCode: "E07",
    rejectionReason: "Missing specialist report", ...BY,
  });
  assert.equal(C.getClaim(claim)!.status, "rejected");
});

test("the dashboard reports acceptance rate and ranks rejections by value", () => {
  const summary = C.claimsSummary();
  assert.ok(summary.total > 0);
  assert.ok(summary.acceptanceRatePercent !== null, "the number the owner actually watches");
  assert.ok(summary.topRejectionReasons.some((r) => r.reason.includes("specialist report")));
  assert.ok(summary.valueAtRiskCents >= 0);
  assert.ok(Array.isArray(summary.closingSoon));
});

test("the audit chain survives the whole revenue cycle", () => {
  assert.equal(verifyAuditChain().ok, true);
});
