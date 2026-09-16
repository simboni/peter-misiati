/**
 * M61 Accounting.
 *
 * Three things make a ledger a ledger: it refuses an entry that does not
 * balance, it never edits a posted entry, and it agrees with the operational
 * record. The fourth thing — that nobody types a journal for ordinary work —
 * is what makes it survive contact with a clinic.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-gl-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const A = await import("../src/lib/accounting.ts");
const B = await import("../src/lib/billing.ts");
const E = await import("../src/lib/encounters.ts");
const P = await import("../src/lib/patients.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get, run: raw, today } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "GLD1", label: "Finance", byUserId: adminId, byUserName: "admin" });
A.seedChartOfAccounts();

const DEV = "GLD1";
const BY = { byUserId: adminId!, byUserName: "Facility Administrator" };
const POST = { facilityId, ...BY };

let nid = 77_000_000;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** A patient with a closed encounter, an invoice and a payment. */
function billedPatient(given: string, payerCode = "CASH", payCents?: number) {
  const mrn = P.registerPatient({
    facilityId, deviceCode: DEV, givenName: given, familyName: "Ledger", sex: "female",
    nationalId: String(++nid), byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
  const enc = E.openEncounter({
    facilityId, patientMrn: mrn, kind: "outpatient",
    clinicianId: clinicianId!, clinicianName: "Dr. Achieng Wanjiru", deviceCode: DEV,
  });
  B.addCharge({
    encounterId: enc, serviceCode: "CONSULT-OP", payerCode,
    sourceKind: "consultation", sourceRef: enc, deviceCode: DEV,
    byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru",
  });
  const invoice = B.issueInvoice({
    encounterId: enc, payerCode, byUserId: receptionistId!, byUserName: "Joseph Otieno", deviceCode: DEV,
  });
  if (payCents !== undefined) {
    B.recordPayment({
      invoiceId: invoice, method: "cash", amountCents: payCents,
      byUserId: receptionistId!, byUserName: "Joseph Otieno", deviceCode: DEV,
    });
  }
  return { mrn, enc, invoice };
}

// =============================================================== the accounts

test("the chart carries each account's normal side, so a contra account needs no special case", () => {
  assert.equal(A.getAccount("1010")!.normal_side, "debit", "an asset increases on the debit side");
  assert.equal(A.getAccount("4000")!.normal_side, "credit", "income increases on the credit side");
  assert.equal(A.getAccount("2100")!.kind, "liability");
  assert.ok(A.chartOfAccounts().length >= 17);
});

// =============================================================== the journal

test("A JOURNAL THAT DOES NOT BALANCE IS REFUSED", () => {
  assert.throws(
    () => A.postJournal({
      ...POST, narrative: "Out by a hundred",
      lines: [
        { accountCode: "1010", debitCents: 10_000 },
        { accountCode: "4000", creditCents: 9_900 },
      ],
    }),
    /does not balance.*out by KES 1\.00/s,
    "a ledger that can hold an unbalanced entry is not a ledger",
  );
});

test("one side of an entry is not an entry", () => {
  assert.throws(
    () => A.postJournal({ ...POST, narrative: "Half", lines: [{ accountCode: "1010", debitCents: 100 }] }),
    /at least two lines/,
  );
});

test("a line is a debit or a credit, never both and never neither", () => {
  assert.throws(
    () => A.postJournal({
      ...POST, narrative: "Both",
      lines: [
        { accountCode: "1010", debitCents: 100, creditCents: 100 },
        { accountCode: "4000", creditCents: 100 },
      ],
    }),
    /never both and never neither/,
  );
});

test("negative amounts are refused — the side carries the sign", () => {
  assert.throws(
    () => A.postJournal({
      ...POST, narrative: "Negative",
      lines: [
        { accountCode: "1010", debitCents: -500 },
        { accountCode: "4000", creditCents: -500 },
      ],
    }),
    /whole cents and never negative/,
  );
});

test("an account that is not on the chart is refused rather than created", () => {
  assert.throws(
    () => A.postJournal({
      ...POST, narrative: "Invented",
      lines: [
        { accountCode: "9999", debitCents: 100 },
        { accountCode: "4000", creditCents: 100 },
      ],
    }),
    /is not an account on this chart/,
  );
});

test("a balanced journal posts, and reads back in two columns", () => {
  const id = A.postJournal({
    ...POST, narrative: "Opening capital",
    lines: [
      { accountCode: "1030", debitCents: 500_000 },
      { accountCode: "3000", creditCents: 500_000 },
    ],
  });
  const lines = A.journalLines(id);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].debit_cents, 500_000);
  assert.equal(lines[0].credit_cents, 0);
  assert.equal(A.getJournal(id)!.narrative, "Opening capital");
});

// ============================================================== reversal

test("A POSTED JOURNAL IS NEVER EDITED — IT IS REVERSED, AND BOTH STAND", () => {
  const id = A.postJournal({
    ...POST, narrative: "Rent paid in error",
    lines: [
      { accountCode: "5200", debitCents: 80_000 },
      { accountCode: "1030", creditCents: 80_000 },
    ],
  });

  assert.throws(() => A.reverseJournal({ journalId: id, reason: "  ", ...BY }), /must record why/);

  const reversal = A.reverseJournal({
    journalId: id, reason: "Posted against the wrong month — re-entered in September", ...BY,
  });

  const original = A.journalLines(id);
  const reversed = A.journalLines(reversal);
  assert.equal(reversed[0].credit_cents, original[0].debit_cents, "the sides are swapped");
  assert.equal(A.getJournal(reversal)!.reverses, id, "and it says what it reverses");
  assert.equal(A.getJournal(id)!.narrative, "Rent paid in error", "the original is untouched");

  assert.throws(
    () => A.reverseJournal({ journalId: id, reason: "again", ...BY }),
    /already been reversed/,
  );
});

test("a reversal nets the account back to where it was", () => {
  const before = A.trialBalance(facilityId).lines.find((l) => l.code === "5200")?.balanceCents ?? 0;
  const id = A.postJournal({
    ...POST, narrative: "Duplicate utility bill",
    lines: [
      { accountCode: "5200", debitCents: 12_345 },
      { accountCode: "1030", creditCents: 12_345 },
    ],
  });
  A.reverseJournal({ journalId: id, reason: "Billed twice by the landlord", ...BY });
  const after = A.trialBalance(facilityId).lines.find((l) => l.code === "5200")?.balanceCents ?? 0;
  assert.equal(after, before);
});

// =============================================================== periods

test("a period is created the first time something is posted into it", () => {
  const month = today().slice(0, 7);
  assert.ok(A.getPeriod(month), "opened on demand, so nobody has to remember to create January");
  assert.equal(A.getPeriod(month)!.status, "open");
});

test("A CLOSED PERIOD TAKES NO POSTINGS", () => {
  A.openPeriod({ facilityId, code: "2099-01", startsOn: "2099-01-01", endsOn: "2099-01-31" });
  A.closePeriod({ code: "2099-01", byUserId: adminId!, byUserName: "Facility Administrator" });

  assert.throws(
    () => A.postJournal({
      ...POST, entryDate: "2099-01-15", narrative: "Late entry",
      lines: [
        { accountCode: "1010", debitCents: 100 },
        { accountCode: "4000", creditCents: 100 },
      ],
    }),
    /is closed — post this to the open period/,
  );
});

test("a period is not closed over an error", () => {
  A.openPeriod({ facilityId, code: "2098-01", startsOn: "2098-01-01", endsOn: "2098-01-31" });
  // Put the ledger out of balance for that date by writing a single-sided row
  // the way a broken import would.
  const id = A.postJournal({
    ...POST, entryDate: "2098-01-10", narrative: "Will be broken",
    lines: [
      { accountCode: "1010", debitCents: 1_000 },
      { accountCode: "4000", creditCents: 1_000 },
    ],
  });
  raw(`UPDATE journal_lines SET credit_cents = 900 WHERE journal_id = ? AND credit_cents > 0`, id);

  assert.throws(
    () => A.closePeriod({ code: "2098-01", byUserId: adminId!, byUserName: "Facility Administrator" }),
    /a period is not closed over an error, it is closed after it is found/,
  );
  raw(`UPDATE journal_lines SET credit_cents = 1000 WHERE journal_id = ? AND credit_cents > 0`, id);
  A.closePeriod({ code: "2098-01", byUserId: adminId!, byUserName: "Facility Administrator" });
});

test("reopening a closed period must record why", () => {
  assert.throws(
    () => A.reopenPeriod({ code: "2099-01", reason: "  ", byUserId: adminId!, byUserName: "admin" }),
    /it is a thing auditors ask about/,
  );
  A.reopenPeriod({
    code: "2099-01", reason: "Auditor asked for a reclassification of the rent accrual",
    byUserId: adminId!, byUserName: "Facility Administrator",
  });
  assert.equal(A.getPeriod("2099-01")!.status, "open");
});

// ======================================================== posting from events

test("NOBODY TYPES A JOURNAL FOR ORDINARY WORK", () => {
  billedPatient("Autoposted", "CASH", 50_000);
  const first = A.postFromOperations({ facilityId, ...BY });
  assert.ok(first.posted >= 2, "an invoice and a payment became journals without anybody choosing an account");

  const invoiceJournal = get<{ id: string; narrative: string }>(
    `SELECT id, narrative FROM journals WHERE source_kind = 'invoice' ORDER BY posted_at DESC LIMIT 1`,
  )!;
  assert.match(invoiceJournal.narrative, /^Invoice /);
});

test("RUNNING THE POSTING JOB TWICE CANNOT DOUBLE-POST", () => {
  // The whole design rests on this: without it a posting job is a machine for
  // double-counting.
  const before = A.trialBalance(facilityId);
  const second = A.postFromOperations({ facilityId, ...BY });
  const after = A.trialBalance(facilityId);

  assert.equal(second.posted, 0);
  assert.ok(second.skipped > 0);
  assert.equal(after.debitCents, before.debitCents);
  assert.equal(after.creditCents, before.creditCents);
});

test("a payer's debt and a patient's are different debts", () => {
  // One of each, both unpaid, so neither balance can be borrowed from the other.
  billedPatient("Insured", "SHA");
  billedPatient("Owing", "CASH");
  A.postFromOperations({ facilityId, ...BY });
  const balance = A.trialBalance(facilityId);
  assert.ok((balance.lines.find((l) => l.code === "1200")?.balanceCents ?? 0) > 0, "patients owe");
  assert.ok((balance.lines.find((l) => l.code === "1210")?.balanceCents ?? 0) > 0, "and so do payers");
});

test("a waiver is not money — it is the debt written off", () => {
  const { invoice } = billedPatient("Waived", "CASH");
  B.recordPayment({
    invoiceId: invoice, method: "waiver", amountCents: 50_000, reference: "Destitute, approved by the administrator",
    byUserId: adminId!, byUserName: "Facility Administrator", deviceCode: DEV,
  });
  const cashBefore = A.trialBalance(facilityId).lines.find((l) => l.code === "1010")?.balanceCents ?? 0;
  A.postFromOperations({ facilityId, ...BY });
  const after = A.trialBalance(facilityId);

  assert.equal(after.lines.find((l) => l.code === "1010")?.balanceCents ?? 0, cashBefore,
    "pretending a waiver is cash inflates both the income and the cash book");
  assert.ok((after.lines.find((l) => l.code === "5900")?.balanceCents ?? 0) >= 50_000);
});

test("a refund posts the other way round, from the same rows", () => {
  const { invoice } = billedPatient("Refunded", "CASH", 50_000);
  A.postFromOperations({ facilityId, ...BY });
  const cashBefore = A.trialBalance(facilityId).lines.find((l) => l.code === "1010")!.balanceCents;

  const payment = B.paymentsFor(invoice).find((p) => p.amount_cents > 0)!;
  B.refundPayment({
    paymentId: payment.id, reason: "Charged for a consultation that did not happen",
    byUserId: adminId!, byUserName: "Facility Administrator", deviceCode: DEV,
  });
  A.postFromOperations({ facilityId, ...BY });

  const cashAfter = A.trialBalance(facilityId).lines.find((l) => l.code === "1010")!.balanceCents;
  assert.equal(cashAfter, cashBefore - 50_000);
});

// ================================================================= reports

test("the trial balance balances, which is the only thing it is for", () => {
  const balance = A.trialBalance(facilityId);
  assert.equal(balance.debitCents, balance.creditCents);
  assert.equal(balance.differenceCents, 0);
  assert.ok(balance.lines.length >= 5);
});

test("an account's balance is shown on its own normal side", () => {
  const balance = A.trialBalance(facilityId);
  const cash = balance.lines.find((l) => l.code === "1010")!;
  const income = balance.lines.find((l) => l.code === "4000")!;
  assert.equal(cash.balanceCents, cash.debitCents - cash.creditCents);
  assert.equal(income.balanceCents, income.creditCents - income.debitCents);
  assert.ok(income.balanceCents > 0, "income read as a positive figure, not as a negative asset");
});

test("the income statement covers a period, not everything ever", () => {
  const month = today().slice(0, 7);
  const thisMonth = A.incomeStatement(facilityId, `${month}-01`, today());
  const longAgo = A.incomeStatement(facilityId, "1990-01-01", "1990-12-31");

  assert.ok(thisMonth.incomeCents > 0);
  assert.equal(thisMonth.surplusCents, thisMonth.incomeCents - thisMonth.expenseCents);
  assert.equal(longAgo.incomeCents, 0);
  assert.equal(longAgo.surplusCents, 0);
});

test("the balance sheet balances, with the surplus shown separately", () => {
  const sheet = A.balanceSheet(facilityId);
  assert.equal(
    sheet.balancesCents, 0,
    "assets equal liabilities plus equity plus the surplus — that is the identity, and it holds",
  );
  assert.ok(sheet.assetCents > 0);
  // Shown separately rather than folded into equity, which is more honest.
  assert.equal(
    sheet.assetCents,
    sheet.liabilityCents + sheet.equityCents + sheet.surplusCents,
  );
});

test("an account ledger shows the entries behind a balance", () => {
  const rows = A.accountLedger("1010", facilityId);
  assert.ok(rows.length > 0);
  assert.ok(rows[0].narrative.length > 0);
});

// =========================================================== reconciliation

test("THE LEDGER IS RECONCILED AGAINST OPERATIONS, NOT ASSUMED TO AGREE", () => {
  A.postFromOperations({ facilityId, ...BY });
  const result = A.reconcile(facilityId);

  assert.equal(result.lines.length, 4);
  for (const line of result.lines) {
    assert.equal(
      line.agrees, true,
      `${line.what} disagrees: ledger ${line.ledgerCents}, operations ${line.operationalCents}`,
    );
  }
  assert.equal(result.agrees, true);
});

test("a legitimate cash entry is shown, not reported as a till discrepancy", () => {
  // Petty cash, a float, a correction — real cash that the till report was
  // never going to know about. Comparing ALL cash movement against the till is
  // a comparison of unlike things, and it cries wolf every time somebody posts
  // a perfectly good journal.
  A.postJournal({
    ...POST, narrative: "Petty cash float drawn from the bank",
    lines: [
      { accountCode: "1010", debitCents: 7_500 },
      { accountCode: "1030", creditCents: 7_500 },
    ],
  });
  const result = A.reconcile(facilityId);
  assert.equal(result.agrees, true, "the till still agrees, because this was never a till transaction");
  assert.equal(result.otherCashCents, 7_500, "and it is shown rather than hidden");
});

test("reconciliation catches a ledger that HAS drifted", () => {
  // The thing that actually goes wrong: a payment journal whose figure no
  // longer matches the payment it came from.
  const before = A.reconcile(facilityId);
  assert.equal(before.agrees, true);

  const journal = get<{ id: string }>(
    `SELECT j.id FROM journals j
       JOIN journal_lines l ON l.journal_id = j.id
      WHERE j.source_kind = 'payment' AND l.account_code = '1010' AND l.debit_cents > 0
      ORDER BY j.posted_at DESC LIMIT 1`,
  )!;
  raw(`UPDATE journal_lines SET debit_cents = debit_cents + 1500 WHERE journal_id = ? AND account_code = '1010'`, journal.id);

  const after = A.reconcile(facilityId);
  const cash = after.lines.find((l) => l.what === "Cash taken today")!;
  assert.equal(cash.agrees, false);
  assert.equal(cash.differenceCents, 1_500, "and it says by how much, so somebody can go and look");
  assert.equal(after.agrees, false);

  raw(`UPDATE journal_lines SET debit_cents = debit_cents - 1500 WHERE journal_id = ? AND account_code = '1010'`, journal.id);
  assert.equal(A.reconcile(facilityId).agrees, true);
});

test("the summary says whether the posting job is behind", () => {
  billedPatient("Unposted", "CASH", 50_000);
  const behind = A.ledgerSummary(facilityId);
  assert.ok(behind.unpostedSources >= 2, "the number that says nobody has run the posting");

  A.postFromOperations({ facilityId, ...BY });
  const caught = A.ledgerSummary(facilityId);
  assert.equal(caught.unpostedSources, 0);
  assert.equal(caught.trialBalanceDifferenceCents, 0);
  assert.ok(caught.journals > 0);
  assert.ok(caught.openPeriod !== null);
});

// ==================================================================== audit

test("every journal is on the audit chain, and the chain verifies", () => {
  const count = (action: string) =>
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`, action)!.n;

  assert.ok(count("journal_posted") >= 10);
  assert.ok(count("journal_reversed") >= 2);
  assert.ok(count("period_closed") >= 2);
  assert.ok(count("period_reopened") >= 1);

  const v = verifyAuditChain();
  assert.equal(v.ok, true);
});
