/**
 * M51 Payments — the till, refunds, and what is owed.
 *
 * The test that matters is the refund one: money that left the till has to stay
 * visible as a row, because a receipt the patient is holding must still
 * correspond to something, and "the payment disappeared" is how a till is
 * robbed.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-till-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const { seedDemo } = await import("../src/lib/seed.ts");
const B = await import("../src/lib/billing.ts");
const P = await import("../src/lib/patients.ts");
const E = await import("../src/lib/encounters.ts");
const Pay = await import("../src/lib/payers.ts");
const I = await import("../src/lib/integration.ts");
const U = await import("../src/lib/users.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get, all, run } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "TILL", label: "Cash desk", byUserId: adminId, byUserName: "admin" });

const DEV = "TILL";
const DOC = { byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru" };
const DESK = { byUserId: receptionistId, byUserName: "Joseph Otieno" };

let nid = 90_000_000;

/** A closed consultation with an invoice against it. */
function invoiced(payerCode: "CASH" | "SHA" = "CASH"): { mrn: string; invoiceId: string; totalCents: number } {
  const mrn = P.registerPatient({
    facilityId, deviceCode: DEV, givenName: "Payer", familyName: "Test", sex: "male",
    nationalId: String(++nid), ...DESK,
  });
  if (payerCode === "SHA") {
    Pay.verifyCoverage({
      patientMrn: mrn, payerCode: "SHA", memberNumber: `SHA-${nid}`,
      probe: () => ({ reachable: true, active: true }), ...DESK,
    });
  }
  const enc = E.openEncounter({
    facilityId, patientMrn: mrn, kind: "outpatient",
    clinicianId, clinicianName: DOC.byUserName, deviceCode: DEV,
  });
  E.addDiagnosis({ encounterId: enc, code: "1F40", ...DOC, deviceCode: DEV });
  E.writeNote({
    encounterId: enc, complaint: "Fever", assessment: "Malaria", plan: "Treat",
    authorId: clinicianId, authorName: DOC.byUserName, deviceCode: DEV,
  });
  B.assembleCharges({ encounterId: enc, payerCode, deviceCode: DEV, ...DOC });
  const invoiceId = B.issueInvoice({ encounterId: enc, payerCode, deviceCode: DEV, ...DOC });
  E.closeEncounter({ encounterId: enc, byUserId: clinicianId, byUserName: DOC.byUserName, deviceCode: DEV });
  return { mrn, invoiceId, totalCents: B.getInvoice(invoiceId)!.total_cents };
}

// ================================================================== payments

test("a part payment leaves a balance and the invoice stays open", () => {
  const { invoiceId, totalCents } = invoiced();
  B.recordPayment({ invoiceId, method: "cash", amountCents: 10_000, deviceCode: DEV, ...DESK });

  assert.equal(B.paidCents(invoiceId), 10_000);
  assert.equal(B.balanceCents(invoiceId), totalCents - 10_000);
  assert.equal(B.getInvoice(invoiceId)!.status, "issued");
});

test("settling it in full marks it paid", () => {
  const { invoiceId, totalCents } = invoiced();
  B.recordPayment({ invoiceId, method: "mpesa", amountCents: totalCents, reference: "QK71HJ2P9A", deviceCode: DEV, ...DESK });
  assert.equal(B.getInvoice(invoiceId)!.status, "paid");
  assert.equal(B.balanceCents(invoiceId), 0);
});

test("overpaying is refused, and says by how much", () => {
  const { invoiceId, totalCents } = invoiced();
  B.recordPayment({ invoiceId, method: "cash", amountCents: 10_000, deviceCode: DEV, ...DESK });
  assert.throws(
    () => B.recordPayment({ invoiceId, method: "cash", amountCents: totalCents, deviceCode: DEV, ...DESK }),
    /already received against/,
  );
});

// =================================================================== refunds

test("a refund is a negative payment, not a deleted one", () => {
  const { invoiceId, totalCents } = invoiced();
  const paymentId = B.recordPayment({ invoiceId, method: "cash", amountCents: totalCents, deviceCode: DEV, ...DESK });
  assert.equal(B.getInvoice(invoiceId)!.status, "paid");

  B.refundPayment({
    paymentId, amountCents: 20_000, reason: "Procedure not performed",
    deviceCode: DEV, byUserId: adminId, byUserName: "Facility Administrator",
  });

  const ledger = B.paymentsFor(invoiceId);
  assert.equal(ledger.length, 2, "the original is still there — the patient is holding its receipt");
  assert.equal(ledger[0].amount_cents, totalCents);
  assert.equal(ledger[1].amount_cents, -20_000);
  assert.equal(ledger[1].refund_of, paymentId);
  assert.match(ledger[1].reason, /not performed/);

  assert.equal(B.paidCents(invoiceId), totalCents - 20_000, "the two never add up wrongly");
  assert.equal(B.getInvoice(invoiceId)!.status, "issued", "money went back out, so it is not settled");
});

test("a refund must record why, and cannot exceed what is left", () => {
  const { invoiceId } = invoiced();
  const paymentId = B.recordPayment({ invoiceId, method: "cash", amountCents: 30_000, deviceCode: DEV, ...DESK });
  const by = { byUserId: adminId, byUserName: "Facility Administrator", deviceCode: DEV };

  assert.throws(() => B.refundPayment({ paymentId, reason: "  ", ...by }), /must record why/);
  assert.throws(() => B.refundPayment({ paymentId, amountCents: 40_000, reason: "too much", ...by }), /can still be refunded/);

  B.refundPayment({ paymentId, amountCents: 25_000, reason: "Overcharged", ...by });
  assert.throws(
    () => B.refundPayment({ paymentId, amountCents: 10_000, reason: "again", ...by }),
    /only KES 50.00 of that/,
    "what is left is what is left",
  );
});

test("refunding with no amount gives back everything still refundable", () => {
  const { invoiceId } = invoiced();
  const paymentId = B.recordPayment({ invoiceId, method: "cash", amountCents: 40_000, deviceCode: DEV, ...DESK });
  B.refundPayment({ paymentId, amountCents: 15_000, reason: "Part", deviceCode: DEV, byUserId: adminId, byUserName: "admin" });
  B.refundPayment({ paymentId, reason: "The rest", deviceCode: DEV, byUserId: adminId, byUserName: "admin" });
  assert.equal(B.paidCents(invoiceId), 0);
});

test("a refund of a refund is refused", () => {
  const { invoiceId } = invoiced();
  const paymentId = B.recordPayment({ invoiceId, method: "cash", amountCents: 20_000, deviceCode: DEV, ...DESK });
  const refundId = B.refundPayment({ paymentId, reason: "All of it", deviceCode: DEV, byUserId: adminId, byUserName: "admin" });
  assert.throws(
    () => B.refundPayment({ paymentId: refundId, reason: "undo", deviceCode: DEV, byUserId: adminId, byUserName: "admin" }),
    /itself a refund/,
  );
});

test("a receptionist cannot refund — it is money leaving the till", () => {
  const { invoiceId } = invoiced();
  const paymentId = B.recordPayment({ invoiceId, method: "cash", amountCents: 20_000, deviceCode: DEV, ...DESK });
  assert.throws(
    () => B.refundPayment({ paymentId, reason: "test", deviceCode: DEV, byUserId: receptionistId, byUserName: "Joseph Otieno" }),
    /role does not include this/,
  );
});

test("an enrolled account left signed in cannot refund without a recent code", async () => {
  const { codeAt } = await import("../src/lib/totp.ts");
  const { DEMO_MFA_SECRET } = await import("../src/lib/seed.ts");

  const { invoiceId } = invoiced();
  const paymentId = B.recordPayment({ invoiceId, method: "cash", amountCents: 20_000, deviceCode: DEV, ...DESK });

  const session = U.signIn({ facilityId, username: "admin", password: "ChangeMe123" });
  assert.throws(
    () => B.refundPayment({
      paymentId, reason: "test", deviceCode: DEV, byUserId: adminId, byUserName: "admin",
      sessionToken: session.token,
    }),
    /authenticator/,
  );

  U.verifyMfa({ token: session.token, code: codeAt(DEMO_MFA_SECRET, Date.now()) });
  const refundId = B.refundPayment({
    paymentId, reason: "Confirmed with a code", deviceCode: DEV, byUserId: adminId, byUserName: "admin",
    sessionToken: session.token,
  });
  assert.ok(refundId);
});

// ============================================================ what is owed

test("what is owed is split by who can actually be asked for it", () => {
  const cash = invoiced("CASH");
  const sha = invoiced("SHA");

  const outstanding = B.outstandingInvoices(facilityId);
  const mine = outstanding.find((o) => o.invoice.id === cash.invoiceId)!;
  const theirs = outstanding.find((o) => o.invoice.id === sha.invoiceId)!;

  assert.equal(mine.payerOwes, false, "a cashier can ask the person at the desk");
  assert.equal(theirs.payerOwes, true, "nobody can ask SHA at the counter");
  assert.equal(mine.balanceCents, cash.totalCents);
  assert.ok(mine.patientName.includes("Payer"));
});

test("a settled invoice leaves the list", () => {
  const { invoiceId, totalCents } = invoiced();
  assert.ok(B.outstandingInvoices(facilityId).some((o) => o.invoice.id === invoiceId));
  B.recordPayment({ invoiceId, method: "cash", amountCents: totalCents, deviceCode: DEV, ...DESK });
  assert.ok(!B.outstandingInvoices(facilityId).some((o) => o.invoice.id === invoiceId));
});

test("the list is oldest first, because that is the one least likely to be paid", () => {
  const { invoiceId } = invoiced();
  run(`UPDATE invoices SET issued_at = ? WHERE id = ?`,
    new Date(Date.now() - 120 * 86_400_000).toISOString(), invoiceId);

  const outstanding = B.outstandingInvoices(facilityId);
  assert.equal(outstanding[0].invoice.id, invoiceId);
  assert.ok(outstanding[0].ageDays >= 119);
  assert.deepEqual(
    outstanding.map((o) => o.ageDays),
    [...outstanding.map((o) => o.ageDays)].sort((a, b) => b - a),
  );
});

test("ageing buckets what is owed, and separates the two debtors", () => {
  const ageing = B.debtorAgeing(facilityId);
  assert.deepEqual(ageing.patient.map((b) => b.bucket), ["0-30", "31-60", "61-90", "90+"]);
  assert.ok(ageing.patient.find((b) => b.bucket === "90+")!.cents > 0, "the backdated one landed in 90+");
  assert.ok(ageing.payer.some((b) => b.cents > 0));
  assert.ok(ageing.patient.every((b) => b.cents >= 0 && Number.isInteger(b.cents)));
});

test("the till totals what came through today, by method, net of refunds", () => {
  const { invoiceId } = invoiced();
  const paymentId = B.recordPayment({ invoiceId, method: "card", amountCents: 30_000, deviceCode: DEV, ...DESK });
  B.refundPayment({ paymentId, amountCents: 5_000, reason: "Overcharged", deviceCode: DEV, byUserId: adminId, byUserName: "admin" });

  const card = B.takings(facilityId).find((t) => t.method === "card")!;
  assert.equal(card.received, 30_000);
  assert.equal(card.refunded, 5_000);
  assert.equal(card.netCents, 25_000, "what the drawer should actually hold");
});

// =================================================================== M-Pesa

test("M-Pesa goes through the hub and comes back with a receipt", () => {
  const result = I.call({
    endpoint: "MPESA",
    operation: "requestPayment",
    request: { phone: "254712345678", amountCents: 45_000, account: "INV-1" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.simulated, true);
  assert.match(String(result.ok && result.data.receipt), /^[A-Z0-9]{10}$/, "ten characters, as M-Pesa issues");
});

test("a bad number is refused before anything reaches the ledger", () => {
  const result = I.call({
    endpoint: "MPESA",
    operation: "requestPayment",
    request: { phone: "0712345678", amountCents: 45_000 },
  });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /2547XXXXXXXX/);
  assert.equal(result.ok === false && result.retryable, false);
});

test("a prompt the customer does not complete is a retryable failure, not a payment", () => {
  const outcomes = Array.from({ length: 60 }, (_, i) =>
    I.call({
      endpoint: "MPESA",
      operation: "requestPayment",
      request: { phone: `2547120000${String(i).padStart(2, "0")}`, amountCents: 10_000 },
    }),
  );
  const failed = outcomes.filter((r) => !r.ok);
  assert.ok(failed.length > 0, "not every prompt is answered");
  assert.ok(failed.every((r) => r.ok === false && r.retryable), "the cashier sends it again");
  assert.ok(
    failed.some((r) => r.ok === false && /cancelled|timed out|Insufficient/.test(r.error)),
    "and is told which of the three it was",
  );
});

test("the audit chain survives the till", () => {
  const v = verifyAuditChain();
  assert.equal(v.ok, true, v.ok ? "" : `broken at entry ${v.failedAtId}`);
});
