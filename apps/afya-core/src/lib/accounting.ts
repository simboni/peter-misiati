/**
 * M61 Accounting — a double-entry general ledger the rest of the system posts
 * into.
 *
 * The point is not that a facility gets a ledger. It is that the ledger and the
 * operational record are the same facts. In most hospital systems they are two
 * sets of numbers maintained by two sets of people, and the question "does the
 * cash book agree with the till" has no answer anyone can produce quickly. Here
 * it is one query, and when the answer is no, the screen says so.
 *
 *  A JOURNAL THAT DOES NOT BALANCE IS REFUSED. Not warned about, not flagged
 *  for review — refused, before anything is written. A ledger that can hold an
 *  unbalanced entry is not a ledger, and every hour spent hunting the shilling
 *  that broke a trial balance is an hour this refusal buys back.
 *
 *  A POSTED JOURNAL IS NEVER EDITED. It is reversed by a second journal that
 *  points at the first and says why. Both stand. This is the whole reason a
 *  ledger is trusted at all, and it is the first thing a spreadsheet gives up.
 *
 *  NOBODY TYPES A JOURNAL FOR ORDINARY WORK. `postFromOperations` derives the
 *  entries from what already happened — payments taken, invoices issued,
 *  suppliers paid. A clinician must never see a debit, and a cashier must never
 *  be asked which account something goes to. Every posting carries the id of
 *  the thing it is the accounting for, and that pair is unique, so running the
 *  job twice cannot double-post. That uniqueness is the whole design.
 *
 *  A CLOSED PERIOD TAKES NO POSTINGS. A late entry goes to the open period
 *  carrying a reference to what it is about, which is what actually happens in
 *  a real ledger rather than what a system wishes happened.
 *
 *  THE LEDGER IS RECONCILED AGAINST OPERATIONS, NOT ASSUMED TO AGREE. `reconcile`
 *  compares the ledger's cash against the till, and its receivables against the
 *  outstanding invoices. A system that cannot tell you they disagree will let
 *  them disagree for a year.
 *
 * ⚠️ The chart of accounts below is a starter. A facility's own chart, its
 * VAT treatment (most healthcare services in Kenya are exempt, which is not the
 * same as zero-rated) and its withholding obligations are matters for its
 * accountant, and nothing here should be mistaken for tax advice.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { formatKes, takings, outstandingInvoices } from "./billing.ts";

export class LedgerError extends Error {}

export type AccountKind = "asset" | "liability" | "equity" | "income" | "expense";
export type Side = "debit" | "credit";

export interface Account {
  code: string;
  name: string;
  kind: AccountKind;
  normal_side: Side;
  parent_code: string | null;
  reconcilable: number;
  active: number;
}

export interface JournalLineInput {
  accountCode: string;
  debitCents?: number;
  creditCents?: number;
  memo?: string;
}

/** Which side increases each kind of account, when nothing says otherwise. */
const NORMAL_SIDE: Record<AccountKind, Side> = {
  asset: "debit",
  expense: "debit",
  liability: "credit",
  equity: "credit",
  income: "credit",
};

// ----------------------------------------------------------------- accounts

export function defineAccount(input: {
  code: string;
  name: string;
  kind: AccountKind;
  normalSide?: Side;
  parentCode?: string;
  reconcilable?: boolean;
}): void {
  run(
    `INSERT INTO accounts (code, name, kind, normal_side, parent_code, reconcilable, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(code) DO UPDATE SET
       name = excluded.name, kind = excluded.kind, normal_side = excluded.normal_side,
       parent_code = excluded.parent_code, reconcilable = excluded.reconcilable`,
    input.code.trim().toUpperCase(),
    input.name.trim(),
    input.kind,
    input.normalSide ?? NORMAL_SIDE[input.kind],
    input.parentCode?.trim().toUpperCase() ?? null,
    input.reconcilable ? 1 : 0,
    now(),
  );
}

export function getAccount(code: string): Account | undefined {
  return get<Account>(`SELECT * FROM accounts WHERE code = ?`, code.trim().toUpperCase());
}

export function chartOfAccounts(): Account[] {
  return all<Account>(`SELECT * FROM accounts WHERE active = 1 ORDER BY code`);
}

// ------------------------------------------------------------------ periods

export function openPeriod(input: {
  facilityId: number;
  code: string;
  startsOn: string;
  endsOn: string;
}): void {
  const code = input.code.trim().toUpperCase();
  if (input.endsOn < input.startsOn) throw new LedgerError("a period cannot end before it starts");
  run(
    `INSERT INTO periods (code, facility_id, starts_on, ends_on, status, created_at)
     VALUES (?, ?, ?, ?, 'open', ?)
     ON CONFLICT(code) DO NOTHING`,
    code,
    input.facilityId,
    input.startsOn,
    input.endsOn,
    now(),
  );
}

export function getPeriod(code: string) {
  return get<{
    code: string;
    facility_id: number;
    starts_on: string;
    ends_on: string;
    status: "open" | "closed";
    closed_at: string | null;
    closer_name: string;
  }>(`SELECT * FROM periods WHERE code = ?`, code.trim().toUpperCase());
}

export function listPeriods(facilityId: number) {
  return all<{
    code: string;
    starts_on: string;
    ends_on: string;
    status: "open" | "closed";
    closed_at: string | null;
    closer_name: string;
  }>(`SELECT * FROM periods WHERE facility_id = ? ORDER BY starts_on DESC`, facilityId);
}

/** The period a date falls in, or nothing. Months are created on demand. */
export function periodFor(facilityId: number, onDate: string) {
  const existing = get<{ code: string; status: string }>(
    `SELECT code, status FROM periods WHERE facility_id = ? AND starts_on <= ? AND ends_on >= ?`,
    facilityId,
    onDate,
    onDate,
  );
  if (existing) return existing;

  // A calendar month, opened the first time anything is posted into it. A
  // facility that wants a different year-end defines its own periods instead.
  const month = onDate.slice(0, 7);
  const [year, mon] = month.split("-").map(Number);
  const endsOn = new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);
  openPeriod({ facilityId, code: month, startsOn: `${month}-01`, endsOn });
  return { code: month, status: "open" };
}

export function closePeriod(input: {
  code: string;
  byUserId: number;
  byUserName: string;
}): void {
  const period = getPeriod(input.code);
  if (!period) throw new LedgerError("no such period");
  if (period.status === "closed") throw new LedgerError(`${period.code} is already closed`);

  // Closing a period whose books do not balance would freeze the error in
  // place, which is exactly what a close is meant to prevent.
  const balance = trialBalance(period.facility_id, period.ends_on);
  if (balance.differenceCents !== 0) {
    throw new LedgerError(
      `the trial balance is out by ${formatKes(Math.abs(balance.differenceCents))} — a period is not closed over an error, it is closed after it is found`,
    );
  }

  tx(() => {
    run(
      `UPDATE periods SET status = 'closed', closed_at = ?, closed_by = ?, closer_name = ? WHERE code = ?`,
      now(),
      input.byUserId,
      input.byUserName,
      period.code,
    );
    audit({
      action: "period_closed",
      entity: "period",
      entityId: period.code,
      facilityId: period.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { startsOn: period.starts_on, endsOn: period.ends_on, totalCents: balance.debitCents },
    });
  });
}

export function reopenPeriod(input: {
  code: string;
  reason: string;
  byUserId: number;
  byUserName: string;
}): void {
  const period = getPeriod(input.code);
  if (!period) throw new LedgerError("no such period");
  if (period.status === "open") throw new LedgerError("that period is already open");
  if (!input.reason.trim()) {
    throw new LedgerError("reopening a closed period must record why — it is a thing auditors ask about");
  }

  tx(() => {
    run(`UPDATE periods SET status = 'open', closed_at = NULL WHERE code = ?`, period.code);
    audit({
      action: "period_reopened",
      entity: "period",
      entityId: period.code,
      facilityId: period.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { reason: input.reason, hadBeenClosedAt: period.closed_at },
    });
  });
}

// ----------------------------------------------------------------- journals

/**
 * Post a journal.
 *
 * Refuses an unbalanced entry before anything is written. A ledger that can
 * hold one is not a ledger.
 */
export function postJournal(input: {
  facilityId: number;
  entryDate?: string;
  narrative: string;
  lines: JournalLineInput[];
  sourceKind?: string;
  sourceRef?: string;
  reverses?: string;
  reversalReason?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode?: string;
}): string {
  if (!input.narrative.trim()) throw new LedgerError("a journal must say what it is for");
  if (input.lines.length < 2) {
    throw new LedgerError("a journal needs at least two lines — one side of an entry is not an entry");
  }

  let debits = 0;
  let credits = 0;
  for (const line of input.lines) {
    const account = getAccount(line.accountCode);
    if (!account) throw new LedgerError(`${line.accountCode} is not an account on this chart`);
    if (!account.active) throw new LedgerError(`${account.name} is not in use`);

    const debit = line.debitCents ?? 0;
    const credit = line.creditCents ?? 0;
    if (!Number.isInteger(debit) || !Number.isInteger(credit) || debit < 0 || credit < 0) {
      throw new LedgerError("amounts are whole cents and never negative — the side carries the sign");
    }
    if ((debit === 0) === (credit === 0)) {
      throw new LedgerError(
        `each line is a debit or a credit, never both and never neither (${account.code})`,
      );
    }
    debits += debit;
    credits += credit;
  }

  if (debits !== credits) {
    throw new LedgerError(
      `this journal does not balance: ${formatKes(debits)} debit against ${formatKes(credits)} credit, out by ${formatKes(Math.abs(debits - credits))}`,
    );
  }

  const entryDate = input.entryDate ?? today();
  const period = periodFor(input.facilityId, entryDate);
  if (period.status === "closed") {
    throw new LedgerError(
      `${period.code} is closed — post this to the open period with a note about what it is for, rather than reaching back into a closed one`,
    );
  }

  if (input.sourceRef) {
    const already = get<{ id: string }>(
      `SELECT id FROM journals WHERE source_kind = ? AND source_ref = ?`,
      input.sourceKind ?? "manual",
      input.sourceRef,
    );
    // Not an error: this is what makes the posting job safe to run repeatedly.
    if (already) return already.id;
  }

  const id = mintLocalId(input.deviceCode ?? "GL", 8);

  return tx(() => {
    run(
      `INSERT INTO journals
         (id, facility_id, period_code, entry_date, narrative, source_kind, source_ref,
          reverses, reversal_reason, posted_by, poster_name, posted_at, device_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.facilityId,
      period.code,
      entryDate,
      input.narrative.trim(),
      input.sourceKind ?? "manual",
      input.sourceRef ?? null,
      input.reverses ?? null,
      input.reversalReason?.trim() ?? "",
      input.byUserId,
      input.byUserName,
      now(),
      input.deviceCode ?? null,
    );

    for (const line of input.lines) {
      run(
        `INSERT INTO journal_lines (journal_id, account_code, debit_cents, credit_cents, memo)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        line.accountCode.trim().toUpperCase(),
        line.debitCents ?? 0,
        line.creditCents ?? 0,
        line.memo?.trim() ?? "",
      );
    }

    audit({
      action: input.reverses ? "journal_reversed" : "journal_posted",
      entity: "journal",
      entityId: id,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      detail: {
        narrative: input.narrative,
        totalCents: debits,
        lines: input.lines.length,
        period: period.code,
        sourceKind: input.sourceKind ?? "manual",
        sourceRef: input.sourceRef ?? null,
        reverses: input.reverses ?? null,
      },
    });

    return id;
  });
}

/**
 * Reverse a journal.
 *
 * A new entry with the sides swapped, pointing at the original. Both stand:
 * this is the whole reason a ledger is trusted, and the first thing a
 * spreadsheet gives up.
 */
export function reverseJournal(input: {
  journalId: string;
  reason: string;
  entryDate?: string;
  byUserId: number | null;
  byUserName: string;
}): string {
  const journal = getJournal(input.journalId);
  if (!journal) throw new LedgerError("no such journal");
  if (!input.reason.trim()) throw new LedgerError("a reversal must record why");

  const already = get<{ id: string }>(`SELECT id FROM journals WHERE reverses = ?`, journal.id);
  if (already) throw new LedgerError("that journal has already been reversed");

  const lines = journalLines(journal.id).map((l) => ({
    accountCode: l.account_code,
    debitCents: l.credit_cents,
    creditCents: l.debit_cents,
    memo: l.memo,
  }));

  return postJournal({
    facilityId: journal.facility_id,
    entryDate: input.entryDate,
    narrative: `Reversal of ${journal.narrative}`,
    lines,
    sourceKind: "reversal",
    reverses: journal.id,
    reversalReason: input.reason,
    byUserId: input.byUserId,
    byUserName: input.byUserName,
  });
}

export function getJournal(id: string) {
  return get<{
    id: string;
    facility_id: number;
    period_code: string;
    entry_date: string;
    narrative: string;
    source_kind: string;
    source_ref: string | null;
    reverses: string | null;
    reversal_reason: string;
    poster_name: string;
    posted_at: string;
  }>(`SELECT * FROM journals WHERE id = ?`, id);
}

export function journalLines(journalId: string) {
  return all<{
    id: number;
    account_code: string;
    debit_cents: number;
    credit_cents: number;
    memo: string;
  }>(`SELECT * FROM journal_lines WHERE journal_id = ? ORDER BY id`, journalId);
}

export function journalsIn(facilityId: number, from?: string, to?: string, limit = 100) {
  const clause = from && to ? `AND entry_date BETWEEN ? AND ?` : "";
  const params: (string | number)[] = from && to ? [from, to, limit] : [limit];
  return all<{
    id: string;
    entry_date: string;
    period_code: string;
    narrative: string;
    source_kind: string;
    source_ref: string | null;
    reverses: string | null;
    poster_name: string;
    total_cents: number;
  }>(
    `SELECT j.*, (SELECT COALESCE(SUM(debit_cents), 0) FROM journal_lines l WHERE l.journal_id = j.id) AS total_cents
       FROM journals j
      WHERE j.facility_id = ? ${clause}
      ORDER BY j.entry_date DESC, j.posted_at DESC
      LIMIT ?`,
    facilityId,
    ...params,
  );
}

// ------------------------------------------------------------------ reports

export interface TrialLine {
  code: string;
  name: string;
  kind: AccountKind;
  normalSide: Side;
  debitCents: number;
  creditCents: number;
  /** Net on the account's own normal side. */
  balanceCents: number;
}

export interface TrialBalance {
  lines: TrialLine[];
  debitCents: number;
  creditCents: number;
  /** Zero, or the ledger is broken. */
  differenceCents: number;
  asOf: string;
}

export function trialBalance(facilityId: number, asOf = today(), from?: string): TrialBalance {
  const clause = from ? `AND j.entry_date >= ?` : "";
  const params: string[] = from ? [asOf, from] : [asOf];

  // The date filter has to eliminate the LINE, not merely the journal. Put
  // these predicates in a LEFT JOIN's ON clause and a journal outside the
  // range yields a null journal while its lines are still summed — which
  // silently makes every period-bounded report wrong. So the lines are
  // aggregated first, with an inner join, and the accounts are attached to
  // that.
  const rows = all<{
    code: string;
    name: string;
    kind: AccountKind;
    normal_side: Side;
    debit: number;
    credit: number;
  }>(
    `SELECT a.code, a.name, a.kind, a.normal_side,
            COALESCE(m.debit, 0) AS debit,
            COALESCE(m.credit, 0) AS credit
       FROM accounts a
       LEFT JOIN (
         SELECT l.account_code,
                SUM(l.debit_cents) AS debit,
                SUM(l.credit_cents) AS credit
           FROM journal_lines l
           JOIN journals j ON j.id = l.journal_id
          WHERE j.facility_id = ? AND j.entry_date <= ? ${clause}
          GROUP BY l.account_code
       ) m ON m.account_code = a.code
      ORDER BY a.code`,
    facilityId,
    ...params,
  );

  const lines: TrialLine[] = rows
    .filter((r) => r.debit !== 0 || r.credit !== 0)
    .map((r) => ({
      code: r.code,
      name: r.name,
      kind: r.kind,
      normalSide: r.normal_side,
      debitCents: r.debit,
      creditCents: r.credit,
      balanceCents: r.normal_side === "debit" ? r.debit - r.credit : r.credit - r.debit,
    }));

  const debitCents = lines.reduce((sum, l) => sum + l.debitCents, 0);
  const creditCents = lines.reduce((sum, l) => sum + l.creditCents, 0);

  return { lines, debitCents, creditCents, differenceCents: debitCents - creditCents, asOf };
}

export interface IncomeStatement {
  income: TrialLine[];
  expenses: TrialLine[];
  incomeCents: number;
  expenseCents: number;
  surplusCents: number;
  from: string;
  to: string;
}

export function incomeStatement(facilityId: number, from: string, to: string): IncomeStatement {
  const balance = trialBalance(facilityId, to, from);
  const income = balance.lines.filter((l) => l.kind === "income");
  const expenses = balance.lines.filter((l) => l.kind === "expense");
  const incomeCents = income.reduce((sum, l) => sum + l.balanceCents, 0);
  const expenseCents = expenses.reduce((sum, l) => sum + l.balanceCents, 0);
  return { income, expenses, incomeCents, expenseCents, surplusCents: incomeCents - expenseCents, from, to };
}

export interface BalanceSheet {
  assets: TrialLine[];
  liabilities: TrialLine[];
  equity: TrialLine[];
  assetCents: number;
  liabilityCents: number;
  equityCents: number;
  /** Surplus for the period, which is what makes the sheet balance. */
  surplusCents: number;
  balancesCents: number;
  asOf: string;
}

export function balanceSheet(facilityId: number, asOf = today()): BalanceSheet {
  const balance = trialBalance(facilityId, asOf);
  const assets = balance.lines.filter((l) => l.kind === "asset");
  const liabilities = balance.lines.filter((l) => l.kind === "liability");
  const equity = balance.lines.filter((l) => l.kind === "equity");

  const assetCents = assets.reduce((sum, l) => sum + l.balanceCents, 0);
  const liabilityCents = liabilities.reduce((sum, l) => sum + l.balanceCents, 0);
  const equityCents = equity.reduce((sum, l) => sum + l.balanceCents, 0);

  // Income less expense to date. Without it the sheet does not balance, and
  // showing it separately is more honest than folding it into equity.
  const surplusCents =
    balance.lines.filter((l) => l.kind === "income").reduce((sum, l) => sum + l.balanceCents, 0) -
    balance.lines.filter((l) => l.kind === "expense").reduce((sum, l) => sum + l.balanceCents, 0);

  return {
    assets,
    liabilities,
    equity,
    assetCents,
    liabilityCents,
    equityCents,
    surplusCents,
    balancesCents: assetCents - (liabilityCents + equityCents + surplusCents),
    asOf,
  };
}

export function accountLedger(accountCode: string, facilityId: number, limit = 100) {
  return all<{
    journal_id: string;
    entry_date: string;
    narrative: string;
    debit_cents: number;
    credit_cents: number;
    memo: string;
  }>(
    `SELECT j.id AS journal_id, j.entry_date, j.narrative, l.debit_cents, l.credit_cents, l.memo
       FROM journal_lines l
       JOIN journals j ON j.id = l.journal_id
      WHERE l.account_code = ? AND j.facility_id = ?
      ORDER BY j.entry_date DESC, j.posted_at DESC
      LIMIT ?`,
    accountCode.trim().toUpperCase(),
    facilityId,
    limit,
  );
}

// ------------------------------------------------------ posting from events

/** The accounts the automatic postings use. Defined once, referenced by name. */
export const ACCOUNT = {
  CASH: "1010",
  MPESA: "1020",
  BANK: "1030",
  RECEIVABLE_PATIENT: "1200",
  RECEIVABLE_PAYER: "1210",
  STOCK: "1300",
  PAYABLE_SUPPLIER: "2100",
  INCOME_SERVICES: "4000",
  INCOME_PHARMACY: "4100",
  EXPENSE_PURCHASES: "5000",
  EXPENSE_WRITEOFF: "5900",
} as const;

/**
 * Derive journals from what already happened.
 *
 * Safe to run as often as you like: every posting carries the id of the thing
 * it is the accounting for, and that pair is unique, so a second run finds the
 * journal already there and does nothing. That uniqueness is the whole design —
 * without it a posting job is a machine for double-counting.
 */
export function postFromOperations(input: {
  facilityId: number;
  byUserId: number | null;
  byUserName: string;
}): { posted: number; skipped: number } {
  let posted = 0;
  let skipped = 0;

  const note = (id: string | null) => {
    if (id === null) skipped++;
    else posted++;
  };

  // --- invoices issued: income earned, and somebody owes it.
  const invoices = all<{
    id: string;
    payer_code: string;
    total_cents: number;
    issued_at: string;
    patient_mrn: string;
  }>(
    `SELECT i.id, i.payer_code, i.total_cents, i.issued_at, i.patient_mrn
       FROM invoices i
       JOIN encounters e ON e.id = i.encounter_id
      WHERE e.facility_id = ? AND i.status <> 'void' AND i.total_cents > 0`,
    input.facilityId,
  );
  for (const invoice of invoices) {
    const before = existingJournal("invoice", invoice.id);
    postJournal({
      facilityId: input.facilityId,
      entryDate: invoice.issued_at.slice(0, 10),
      narrative: `Invoice ${invoice.id} — ${invoice.payer_code}`,
      sourceKind: "invoice",
      sourceRef: invoice.id,
      lines: [
        {
          // A payer's debt and a patient's are different debts with different
          // ages and different people chasing them.
          accountCode: invoice.payer_code === "CASH" ? ACCOUNT.RECEIVABLE_PATIENT : ACCOUNT.RECEIVABLE_PAYER,
          debitCents: invoice.total_cents,
          memo: invoice.patient_mrn,
        },
        { accountCode: ACCOUNT.INCOME_SERVICES, creditCents: invoice.total_cents },
      ],
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });
    note(before);
  }

  // --- payments taken: cash in, debt down. A refund is a negative payment and
  // posts the other way round, from the same rows.
  const payments = all<{
    id: string;
    invoice_id: string;
    method: string;
    amount_cents: number;
    received_at: string;
    payer_code: string;
  }>(
    `SELECT p.id, p.invoice_id, p.method, p.amount_cents, p.received_at, i.payer_code
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN encounters e ON e.id = i.encounter_id
      WHERE e.facility_id = ? AND p.voided_at IS NULL`,
    input.facilityId,
  );
  for (const payment of payments) {
    const before = existingJournal("payment", payment.id);
    const cashAccount =
      payment.method === "mpesa" ? ACCOUNT.MPESA
      : payment.method === "card" || payment.method === "cheque" ? ACCOUNT.BANK
      : ACCOUNT.CASH;
    const receivable = payment.payer_code === "CASH" ? ACCOUNT.RECEIVABLE_PATIENT : ACCOUNT.RECEIVABLE_PAYER;
    const amount = Math.abs(payment.amount_cents);
    const isRefund = payment.amount_cents < 0;

    if (payment.method === "waiver") {
      // A waiver is not money. It is the debt being written off, and pretending
      // otherwise inflates both the income and the cash book.
      postJournal({
        facilityId: input.facilityId,
        entryDate: payment.received_at.slice(0, 10),
        narrative: `Waiver on ${payment.invoice_id}`,
        sourceKind: "payment",
        sourceRef: payment.id,
        lines: [
          { accountCode: ACCOUNT.EXPENSE_WRITEOFF, debitCents: amount },
          { accountCode: receivable, creditCents: amount },
        ],
        byUserId: input.byUserId,
        byUserName: input.byUserName,
      });
    } else {
      postJournal({
        facilityId: input.facilityId,
        entryDate: payment.received_at.slice(0, 10),
        narrative: `${isRefund ? "Refund on" : "Payment against"} ${payment.invoice_id} (${payment.method})`,
        sourceKind: "payment",
        sourceRef: payment.id,
        lines: isRefund
          ? [
              { accountCode: receivable, debitCents: amount },
              { accountCode: cashAccount, creditCents: amount },
            ]
          : [
              { accountCode: cashAccount, debitCents: amount },
              { accountCode: receivable, creditCents: amount },
            ],
        byUserId: input.byUserId,
        byUserName: input.byUserName,
      });
    }
    note(before);
  }

  // --- goods received: stock on hand, and a supplier owed.
  const deliveries = all<{ grn_id: string; received_at: string; reference: string; value: number }>(
    `SELECT g.id AS grn_id, g.received_at, g.reference,
            SUM(l.quantity * COALESCE(pol.unit_cost_cents, 0)) AS value
       FROM goods_received g
       JOIN goods_received_lines l ON l.grn_id = g.id
       JOIN purchase_orders po ON po.id = g.po_id
       LEFT JOIN purchase_order_lines pol ON pol.po_id = po.id AND pol.product_code = l.product_code
      WHERE po.facility_id = ?
      GROUP BY g.id, g.received_at, g.reference
     HAVING value > 0`,
    input.facilityId,
  );
  for (const delivery of deliveries) {
    const before = existingJournal("grn", delivery.grn_id);
    postJournal({
      facilityId: input.facilityId,
      entryDate: delivery.received_at.slice(0, 10),
      narrative: `Goods received ${delivery.reference}`,
      sourceKind: "grn",
      sourceRef: delivery.grn_id,
      lines: [
        { accountCode: ACCOUNT.STOCK, debitCents: delivery.value },
        { accountCode: ACCOUNT.PAYABLE_SUPPLIER, creditCents: delivery.value },
      ],
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });
    note(before);
  }

  // --- suppliers paid: the payable settled.
  const settled = all<{ id: string; invoice_no: string; total_cents: number; paid_at: string }>(
    `SELECT i.id, i.invoice_no, i.total_cents, i.paid_at
       FROM supplier_invoices i
       JOIN purchase_orders p ON p.id = i.po_id
      WHERE p.facility_id = ? AND i.status = 'paid' AND i.paid_at IS NOT NULL`,
    input.facilityId,
  );
  for (const invoice of settled) {
    const before = existingJournal("supplier_payment", invoice.id);
    postJournal({
      facilityId: input.facilityId,
      entryDate: invoice.paid_at.slice(0, 10),
      narrative: `Paid supplier invoice ${invoice.invoice_no}`,
      sourceKind: "supplier_payment",
      sourceRef: invoice.id,
      lines: [
        { accountCode: ACCOUNT.PAYABLE_SUPPLIER, debitCents: invoice.total_cents },
        { accountCode: ACCOUNT.BANK, creditCents: invoice.total_cents },
      ],
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });
    note(before);
  }

  return { posted, skipped };
}

/** Whether a journal already exists for this source. Null when it does. */
function existingJournal(kind: string, ref: string): string | null {
  const row = get<{ id: string }>(
    `SELECT id FROM journals WHERE source_kind = ? AND source_ref = ?`,
    kind,
    ref,
  );
  return row ? null : ref;
}

// ------------------------------------------------------------ reconciliation

export interface ReconciliationLine {
  what: string;
  ledgerCents: number;
  operationalCents: number;
  differenceCents: number;
  agrees: boolean;
  note: string;
}

/**
 * Does the ledger agree with the rest of the system?
 *
 * The question most hospital systems cannot answer, because the ledger and the
 * operational record are kept by different people from different sources. Here
 * they are the same facts, so disagreement means something is genuinely wrong
 * — most often a posting job that has not been run since the last takings.
 */
export function reconcile(facilityId: number, onDate = today()): {
  lines: ReconciliationLine[];
  agrees: boolean;
  /** Cash that moved today for reasons other than a patient payment. */
  otherCashCents: number;
} {
  const balance = trialBalance(facilityId, onDate);
  const ledgerOf = (code: string) => balance.lines.find((l) => l.code === code)?.balanceCents ?? 0;

  const till = takings(facilityId, onDate);
  const tillCash = till.filter((t) => t.method === "cash").reduce((sum, t) => sum + t.netCents, 0);
  const tillMpesa = till.filter((t) => t.method === "mpesa").reduce((sum, t) => sum + t.netCents, 0);

  const owed = outstandingInvoices(facilityId, onDate);
  const owedByPatients = owed.filter((o) => !o.payerOwes).reduce((sum, o) => sum + o.balanceCents, 0);
  const owedByPayers = owed.filter((o) => o.payerOwes).reduce((sum, o) => sum + o.balanceCents, 0);

  const make = (what: string, ledger: number, operational: number, note: string): ReconciliationLine => ({
    what,
    ledgerCents: ledger,
    operationalCents: operational,
    differenceCents: ledger - operational,
    agrees: ledger === operational,
    note,
  });

  const lines = [
    // Cash and M-Pesa are compared for the day, because the ledger holds
    // everything ever taken and the till report is today's. Only
    // payment-sourced movement is compared: a petty-cash entry or a correction
    // is real cash and is not a till discrepancy.
    make(
      "Cash taken today",
      cashPostedOn(facilityId, onDate, ACCOUNT.CASH, "payment"),
      tillCash,
      "payments against the till",
    ),
    make(
      "M-Pesa taken today",
      cashPostedOn(facilityId, onDate, ACCOUNT.MPESA, "payment"),
      tillMpesa,
      "payments against the till",
    ),
    make("Owed by patients", ledgerOf(ACCOUNT.RECEIVABLE_PATIENT), owedByPatients, "against outstanding invoices"),
    make("Owed by payers", ledgerOf(ACCOUNT.RECEIVABLE_PAYER), owedByPayers, "against outstanding claims"),
  ];

  // Everything else that touched cash today, shown rather than hidden. It is
  // not a discrepancy — it is the reason the two figures above are not simply
  // the account balance, and somebody reading the page deserves to see it.
  const otherCash =
    cashPostedOn(facilityId, onDate, ACCOUNT.CASH) - cashPostedOn(facilityId, onDate, ACCOUNT.CASH, "payment");
  const otherMpesa =
    cashPostedOn(facilityId, onDate, ACCOUNT.MPESA) - cashPostedOn(facilityId, onDate, ACCOUNT.MPESA, "payment");

  return {
    lines,
    agrees: lines.every((l) => l.agrees),
    otherCashCents: otherCash + otherMpesa,
  };
}

/**
 * Net movement on a cash account on one day.
 *
 * `sourceKind` matters: comparing ALL cash movement against the till report is
 * a comparison of unlike things, and it breaks the moment somebody posts a
 * legitimate petty-cash entry or a correction. The reconciliation compares
 * payment-sourced movement against the till, and shows everything else
 * separately rather than letting it masquerade as a discrepancy.
 */
function cashPostedOn(
  facilityId: number,
  onDate: string,
  accountCode: string,
  sourceKind?: string,
): number {
  const clause = sourceKind ? `AND j.source_kind = ?` : "";
  const params: (string | number)[] = sourceKind
    ? [facilityId, onDate, accountCode, sourceKind]
    : [facilityId, onDate, accountCode];
  const row = get<{ debit: number; credit: number }>(
    `SELECT COALESCE(SUM(l.debit_cents), 0) AS debit, COALESCE(SUM(l.credit_cents), 0) AS credit
       FROM journal_lines l
       JOIN journals j ON j.id = l.journal_id
      WHERE j.facility_id = ? AND j.entry_date = ? AND l.account_code = ? ${clause}`,
    ...params,
  );
  return (row?.debit ?? 0) - (row?.credit ?? 0);
}

export interface LedgerSummary {
  accounts: number;
  journals: number;
  unpostedSources: number;
  openPeriod: string | null;
  trialBalanceDifferenceCents: number;
  cashCents: number;
  receivableCents: number;
  payableCents: number;
  incomeCents: number;
  expenseCents: number;
  surplusCents: number;
  reconciles: boolean;
}

export function ledgerSummary(facilityId: number, asOf = today()): LedgerSummary {
  const balance = trialBalance(facilityId, asOf);
  const of = (code: string) => balance.lines.find((l) => l.code === code)?.balanceCents ?? 0;

  const month = asOf.slice(0, 7);
  const income = incomeStatement(facilityId, `${month}-01`, asOf);
  const open = listPeriods(facilityId).find((p) => p.status === "open");

  // Operational rows with no journal against them. The number that says the
  // posting job has not been run.
  const unposted =
    (get<{ n: number }>(
      `SELECT
         (SELECT COUNT(*) FROM payments p
            JOIN invoices i ON i.id = p.invoice_id
            JOIN encounters e ON e.id = i.encounter_id
           WHERE e.facility_id = ? AND p.voided_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM journals j WHERE j.source_kind = 'payment' AND j.source_ref = p.id))
       + (SELECT COUNT(*) FROM invoices i
            JOIN encounters e ON e.id = i.encounter_id
           WHERE e.facility_id = ? AND i.status <> 'void' AND i.total_cents > 0
             AND NOT EXISTS (SELECT 1 FROM journals j WHERE j.source_kind = 'invoice' AND j.source_ref = i.id))
         AS n`,
      facilityId,
      facilityId,
    )?.n ?? 0);

  return {
    accounts: chartOfAccounts().length,
    journals: get<{ n: number }>(`SELECT COUNT(*) AS n FROM journals WHERE facility_id = ?`, facilityId)?.n ?? 0,
    unpostedSources: unposted,
    openPeriod: open?.code ?? null,
    trialBalanceDifferenceCents: balance.differenceCents,
    cashCents: of(ACCOUNT.CASH) + of(ACCOUNT.MPESA) + of(ACCOUNT.BANK),
    receivableCents: of(ACCOUNT.RECEIVABLE_PATIENT) + of(ACCOUNT.RECEIVABLE_PAYER),
    payableCents: of(ACCOUNT.PAYABLE_SUPPLIER),
    incomeCents: income.incomeCents,
    expenseCents: income.expenseCents,
    surplusCents: income.surplusCents,
    reconciles: reconcile(facilityId, asOf).agrees,
  };
}

/**
 * A starter chart of accounts.
 *
 * ⚠️ Illustrative. A facility's own chart, its VAT treatment (most healthcare
 * services in Kenya are exempt, which is not the same as zero-rated) and its
 * withholding obligations are matters for its accountant.
 */
export function seedChartOfAccounts(): void {
  const accounts: [string, string, AccountKind, boolean][] = [
    ["1010", "Cash in hand", "asset", true],
    ["1020", "M-Pesa", "asset", true],
    ["1030", "Bank", "asset", true],
    ["1200", "Receivable — patients", "asset", false],
    ["1210", "Receivable — payers", "asset", false],
    ["1300", "Stock on hand", "asset", false],
    ["1500", "Equipment", "asset", false],
    ["2100", "Payable — suppliers", "liability", false],
    ["2200", "Payable — staff", "liability", false],
    ["2300", "Tax payable", "liability", false],
    ["3000", "Owner's capital", "equity", false],
    ["4000", "Income — services", "income", false],
    ["4100", "Income — pharmacy", "income", false],
    ["5000", "Cost of goods", "expense", false],
    ["5100", "Staff costs", "expense", false],
    ["5200", "Rent and utilities", "expense", false],
    ["5900", "Waivers and bad debt", "expense", false],
  ];
  for (const [code, name, kind, reconcilable] of accounts) {
    defineAccount({ code, name, kind, reconcilable });
  }
}
