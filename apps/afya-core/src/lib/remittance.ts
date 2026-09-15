/**
 * M56 Remittance & Reconciliation — closing the money loop.
 *
 * Until this module, the system could say "we submitted a hundred claims". It
 * could not say "we were paid for eighty-seven, and here is why not the other
 * thirteen". That difference is the whole commercial argument: an acceptance
 * rate the facility RECORDED is an opinion, and an acceptance rate reconciled
 * against money that actually arrived is a fact.
 *
 * Three things this does that a spreadsheet cannot:
 *
 *  IT MATCHES AUTOMATICALLY AND SAYS HOW. A payment advice arrives with the
 *  payer's own references, not the facility's. Each line records whether it was
 *  matched by reference, by claim id, by a person, or not at all — so a wrong
 *  match can be found afterwards instead of being invisible.
 *
 *  IT NEVER DROPS A LINE IT CANNOT PLACE. A payer paying for a claim this
 *  facility has no record of is a real event — a duplicate submission, a mixed
 *  up file, somebody else's claim — and it must be visible, not swallowed
 *  because the import loop had nowhere to put it.
 *
 *  IT TURNS A SHORTFALL INTO A RULE. Every underpayment carries the payer's
 *  reason. `rejectionTaxonomy` ranks those reasons by the money they cost,
 *  which is the corpus the scrubber was always supposed to be built from — the
 *  roadmap asks for fifty real rejected claims, and this is how a facility
 *  accumulates them by doing its ordinary work.
 *
 * MONEY IS INTEGER CENTS. No `next/*` imports.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { getPayer } from "./payers.ts";
import { formatKes } from "./billing.ts";
import { notify } from "./notifications.ts";

export class RemittanceError extends Error {}

export interface Remittance {
  id: string;
  facility_id: number;
  payer_code: string;
  reference: string;
  advice_date: string;
  stated_total_cents: number;
  status: "imported" | "reconciled" | "disputed";
  imported_by: number | null;
  imported_at: string;
  reconciled_at: string | null;
  notes: string;
}

export interface RemittanceLine {
  id: number;
  remittance_id: string;
  claim_id: string | null;
  payer_reference: string;
  claimed_cents: number;
  paid_cents: number;
  reason_code: string | null;
  reason: string;
  matched_by: "reference" | "claim_id" | "manual" | "unmatched";
  disputed_at: string | null;
  dispute_reason: string | null;
  created_at: string;
}

/** One line as it arrives from the payer, before anything is matched. */
export interface AdviceLine {
  /** The payer's reference for the claim, as printed on the advice. */
  payerReference?: string;
  /** Our own claim id, when the payer echoes it back. */
  claimId?: string;
  claimedCents?: number;
  paidCents: number;
  reasonCode?: string;
  reason?: string;
}

/**
 * Import a payment advice.
 *
 * Idempotent on the payer's reference: importing the same advice twice is one
 * advice, because somebody will do it. Every line is matched if it can be and
 * kept if it cannot — the total the payer states and the total of the lines are
 * both recorded, and a difference between THOSE is a problem with the advice
 * itself rather than with any claim on it.
 */
export function importRemittance(input: {
  facilityId: number;
  payerCode: string;
  reference: string;
  adviceDate: string;
  statedTotalCents: number;
  lines: AdviceLine[];
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): { id: string; matched: number; unmatched: number; lineTotalCents: number } {
  const payerCode = input.payerCode.trim().toUpperCase();
  if (!getPayer(payerCode)) throw new RemittanceError(`unknown payer ${payerCode}`);
  if (!input.reference.trim()) {
    throw new RemittanceError("a payment advice must carry the payer's own reference — it is how a duplicate import is caught");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.adviceDate)) {
    throw new RemittanceError("the advice date must be YYYY-MM-DD");
  }
  if (input.lines.length === 0) throw new RemittanceError("that advice has no lines on it");

  const reference = input.reference.trim().toUpperCase();
  const existing = get<Remittance>(
    `SELECT * FROM remittances WHERE payer_code = ? AND reference = ?`,
    payerCode,
    reference,
  );
  if (existing) {
    throw new RemittanceError(
      `advice ${reference} from ${payerCode} was already imported on ${existing.imported_at.slice(0, 10)}`,
    );
  }

  const id = mintLocalId(input.deviceCode, 8);
  const at = now();
  let matched = 0;
  let unmatched = 0;
  let lineTotal = 0;

  return tx(() => {
    run(
      `INSERT INTO remittances
         (id, facility_id, payer_code, reference, advice_date, stated_total_cents, status, imported_by, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, 'imported', ?, ?)`,
      id,
      input.facilityId,
      payerCode,
      reference,
      input.adviceDate,
      input.statedTotalCents,
      input.byUserId,
      at,
    );

    for (const line of input.lines) {
      const found = matchLine(line, payerCode);
      lineTotal += line.paidCents;
      if (found.claimId) matched++;
      else unmatched++;

      run(
        `INSERT INTO remittance_lines
           (remittance_id, claim_id, payer_reference, claimed_cents, paid_cents,
            reason_code, reason, matched_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        found.claimId,
        line.payerReference?.trim() ?? "",
        line.claimedCents ?? found.claimedCents ?? 0,
        line.paidCents,
        line.reasonCode?.trim() ?? null,
        line.reason?.trim() ?? "",
        found.matchedBy,
        at,
      );
    }

    audit({
      action: "remittance_imported",
      entity: "remittance",
      entityId: id,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "billing",
      deviceCode: input.deviceCode,
      detail: {
        payer: payerCode,
        reference,
        lines: input.lines.length,
        matched,
        unmatched,
        statedTotalCents: input.statedTotalCents,
        lineTotalCents: lineTotal,
      },
    });

    // The advice disagreeing with its own lines is a problem with the advice,
    // not with any claim on it, and it must not be quietly absorbed.
    if (lineTotal !== input.statedTotalCents) {
      notify({
        facilityId: input.facilityId,
        ownerRole: "claims_officer",
        severity: "warning",
        kind: "advice_does_not_add_up",
        subject: `Advice ${reference} states ${formatKes(input.statedTotalCents)} but its lines total ${formatKes(lineTotal)}`,
        body: "Query it with the payer before reconciling. The difference is in the advice itself, not in a claim.",
        entity: "remittance",
        entityId: id,
        dedupeKey: `advice_total:${id}`,
      });
    }

    if (unmatched > 0) {
      notify({
        facilityId: input.facilityId,
        ownerRole: "claims_officer",
        severity: "warning",
        kind: "unmatched_remittance",
        subject: `${unmatched} line${unmatched === 1 ? "" : "s"} on advice ${reference} match no claim`,
        body: "A payer paying for a claim this facility has no record of is a real event. Match them by hand or query them.",
        entity: "remittance",
        entityId: id,
        dedupeKey: `unmatched:${id}`,
      });
    }

    return { id, matched, unmatched, lineTotalCents: lineTotal };
  });
}

/**
 * Find the claim an advice line is talking about.
 *
 * In order: our own claim id if the payer echoed it, then the reference we
 * recorded when we submitted. Anything else is left unmatched for a person —
 * guessing by amount would silently credit the wrong patient.
 */
function matchLine(
  line: AdviceLine,
  payerCode: string,
): { claimId: string | null; matchedBy: RemittanceLine["matched_by"]; claimedCents?: number } {
  if (line.claimId) {
    const claim = get<{ id: string; total_cents: number }>(
      `SELECT id, total_cents FROM claims WHERE id = ? AND payer_code = ?`,
      line.claimId,
      payerCode,
    );
    if (claim) return { claimId: claim.id, matchedBy: "claim_id", claimedCents: claim.total_cents };
  }

  if (line.payerReference?.trim()) {
    const claim = get<{ id: string; total_cents: number }>(
      `SELECT id, total_cents FROM claims WHERE reference = ? AND payer_code = ?`,
      line.payerReference.trim(),
      payerCode,
    );
    if (claim) return { claimId: claim.id, matchedBy: "reference", claimedCents: claim.total_cents };
  }

  return { claimId: null, matchedBy: "unmatched" };
}

/** Match a line to a claim by hand, when the references did not line up. */
export function matchByHand(input: {
  lineId: number;
  claimId: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const line = get<RemittanceLine>(`SELECT * FROM remittance_lines WHERE id = ?`, input.lineId);
  if (!line) throw new RemittanceError("no such remittance line");
  if (line.claim_id) throw new RemittanceError("that line is already matched");

  const claim = get<{ id: string; total_cents: number; payer_code: string }>(
    `SELECT id, total_cents, payer_code FROM claims WHERE id = ?`,
    input.claimId,
  );
  if (!claim) throw new RemittanceError("no such claim");

  const advice = get<Remittance>(`SELECT * FROM remittances WHERE id = ?`, line.remittance_id)!;
  if (claim.payer_code !== advice.payer_code) {
    throw new RemittanceError(
      `${claim.id} was claimed from ${claim.payer_code}, but this advice is from ${advice.payer_code}`,
    );
  }

  const already = get<{ id: number }>(
    `SELECT id FROM remittance_lines WHERE claim_id = ? AND id <> ?`,
    input.claimId,
    input.lineId,
  );
  if (already) throw new RemittanceError(`${claim.id} is already settled on another advice line`);

  tx(() => {
    run(
      `UPDATE remittance_lines SET claim_id = ?, matched_by = 'manual', claimed_cents = ? WHERE id = ?`,
      claim.id,
      line.claimed_cents || claim.total_cents,
      input.lineId,
    );
    audit({
      action: "remittance_line_matched",
      entity: "remittance",
      entityId: line.remittance_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "billing",
      detail: { lineId: input.lineId, claimId: claim.id, by: "manual" },
    });
  });
}

/**
 * Post an advice against the claims on it.
 *
 * A claim paid in full becomes `paid`. One paid short stays `rejected` with the
 * payer's own reason on it, because a partial payment IS a rejection of the
 * rest — and the reason is what the scrubber learns from. Nothing is posted
 * twice: an advice already reconciled is refused.
 */
export function reconcile(input: {
  remittanceId: string;
  byUserId: number | null;
  byUserName: string;
}): {
  claimsPaid: number;
  claimsShort: number;
  paidCents: number;
  shortfallCents: number;
  unmatched: number;
} {
  const advice = get<Remittance>(`SELECT * FROM remittances WHERE id = ?`, input.remittanceId);
  if (!advice) throw new RemittanceError("no such payment advice");
  if (advice.status === "reconciled") {
    throw new RemittanceError(`that advice was reconciled on ${advice.reconciled_at?.slice(0, 10)}`);
  }

  const lines = linesFor(input.remittanceId);
  const tally = { claimsPaid: 0, claimsShort: 0, paidCents: 0, shortfallCents: 0, unmatched: 0 };
  const at = now();

  return tx(() => {
    for (const line of lines) {
      tally.paidCents += line.paid_cents;

      if (!line.claim_id) {
        tally.unmatched++;
        continue;
      }

      const claim = get<{ id: string; total_cents: number; patient_mrn: string }>(
        `SELECT id, total_cents, patient_mrn FROM claims WHERE id = ?`,
        line.claim_id,
      );
      if (!claim) continue;

      const expected = line.claimed_cents || claim.total_cents;
      const short = expected - line.paid_cents;

      if (short <= 0) {
        tally.claimsPaid++;
        run(
          `UPDATE claims SET status = 'paid', decided_at = ?, updated_at = ? WHERE id = ?`,
          at,
          at,
          claim.id,
        );
      } else {
        tally.claimsShort++;
        tally.shortfallCents += short;
        // A partial payment is a rejection of the rest, and the payer's reason
        // for it is the asset — it is what makes the scrubber better.
        run(
          `UPDATE claims SET status = 'rejected', decided_at = ?, rejection_code = ?, rejection_reason = ?, updated_at = ? WHERE id = ?`,
          at,
          line.reason_code,
          line.reason ||
            `Paid ${formatKes(line.paid_cents)} of ${formatKes(expected)} with no reason stated`,
          at,
          claim.id,
        );
      }

      audit({
        action: short <= 0 ? "claim_paid" : "claim_short_paid",
        entity: "claim",
        entityId: claim.id,
        patientId: claim.patient_mrn,
        facilityId: advice.facility_id,
        actorId: input.byUserId,
        actorName: input.byUserName,
        purpose: "billing",
        detail: {
          advice: advice.reference,
          expectedCents: expected,
          paidCents: line.paid_cents,
          shortfallCents: Math.max(short, 0),
          reasonCode: line.reason_code,
        },
      });
    }

    run(`UPDATE remittances SET status = 'reconciled', reconciled_at = ? WHERE id = ?`, at, input.remittanceId);

    audit({
      action: "remittance_reconciled",
      entity: "remittance",
      entityId: input.remittanceId,
      facilityId: advice.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "billing",
      detail: tally,
    });

    if (tally.shortfallCents > 0) {
      notify({
        facilityId: advice.facility_id,
        ownerRole: "claims_officer",
        severity: "warning",
        kind: "shortfall",
        subject: `${formatKes(tally.shortfallCents)} short across ${tally.claimsShort} claim${tally.claimsShort === 1 ? "" : "s"} on advice ${advice.reference}`,
        body: "Each one carries the payer's reason. Those reasons are what the scrubber learns from.",
        entity: "remittance",
        entityId: input.remittanceId,
        dedupeKey: `shortfall:${input.remittanceId}`,
      });
    }

    return tally;
  });
}

/** Dispute one line. A shortfall the facility does not accept is not a loss yet. */
export function disputeLine(input: {
  lineId: number;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  if (!input.reason.trim()) throw new RemittanceError("a dispute must say what is being disputed");
  const line = get<RemittanceLine>(`SELECT * FROM remittance_lines WHERE id = ?`, input.lineId);
  if (!line) throw new RemittanceError("no such remittance line");

  tx(() => {
    run(
      `UPDATE remittance_lines SET disputed_at = ?, dispute_reason = ? WHERE id = ?`,
      now(),
      input.reason.trim(),
      input.lineId,
    );
    run(`UPDATE remittances SET status = 'disputed' WHERE id = ?`, line.remittance_id);
    audit({
      action: "remittance_line_disputed",
      entity: "remittance",
      entityId: line.remittance_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "billing",
      detail: { lineId: input.lineId, claimId: line.claim_id, reason: input.reason },
    });
  });
}

// ------------------------------------------------------------------- reading

export function getRemittance(id: string): Remittance | undefined {
  return get<Remittance>(`SELECT * FROM remittances WHERE id = ?`, id);
}

export function linesFor(remittanceId: string): RemittanceLine[] {
  return all<RemittanceLine>(
    `SELECT * FROM remittance_lines WHERE remittance_id = ? ORDER BY id`,
    remittanceId,
  );
}

export function listRemittances(facilityId: number, limit = 50): (Remittance & {
  lines: number;
  paid_cents: number;
  shortfall_cents: number;
})[] {
  return all(
    `SELECT r.*,
            (SELECT COUNT(*) FROM remittance_lines l WHERE l.remittance_id = r.id) AS lines,
            COALESCE((SELECT SUM(l.paid_cents) FROM remittance_lines l WHERE l.remittance_id = r.id), 0) AS paid_cents,
            COALESCE((SELECT SUM(MAX(l.claimed_cents - l.paid_cents, 0)) FROM remittance_lines l
                       WHERE l.remittance_id = r.id), 0) AS shortfall_cents
       FROM remittances r
      WHERE r.facility_id = ?
      ORDER BY r.advice_date DESC LIMIT ?`,
    facilityId,
    limit,
  );
}

export interface Reconciliation {
  submittedCents: number;
  paidCents: number;
  shortfallCents: number;
  /** Submitted, and no advice has mentioned it yet. */
  awaitingCents: number;
  claimsSubmitted: number;
  claimsSettled: number;
  claimsAwaiting: number;
  /** Paid over submitted, as a percentage of money. Null until something settles. */
  recoveryRatePercent: number | null;
}

/**
 * The money view: what was asked for, what arrived, what is still out.
 *
 * Deliberately by VALUE rather than by count. Ninety claims paid out of a
 * hundred sounds excellent and can still be a disaster if the ten that failed
 * were the expensive ones.
 */
export function reconciliation(facilityId: number): Reconciliation {
  const submitted = get<{ n: number; cents: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(c.total_cents), 0) AS cents
       FROM claims c JOIN encounters e ON e.id = c.encounter_id
      WHERE e.facility_id = ? AND c.status IN ('submitted','accepted','rejected','paid')`,
    facilityId,
  )!;

  const settled = get<{ n: number; paid: number; claimed: number }>(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(l.paid_cents), 0) AS paid,
            COALESCE(SUM(l.claimed_cents), 0) AS claimed
       FROM remittance_lines l
       JOIN remittances r ON r.id = l.remittance_id
      WHERE r.facility_id = ? AND r.status <> 'imported' AND l.claim_id IS NOT NULL`,
    facilityId,
  )!;

  const paid = settled.paid ?? 0;
  const claimed = settled.claimed ?? 0;

  return {
    submittedCents: submitted.cents ?? 0,
    paidCents: paid,
    shortfallCents: Math.max(claimed - paid, 0),
    awaitingCents: Math.max((submitted.cents ?? 0) - claimed, 0),
    claimsSubmitted: submitted.n ?? 0,
    claimsSettled: settled.n ?? 0,
    claimsAwaiting: Math.max((submitted.n ?? 0) - (settled.n ?? 0), 0),
    recoveryRatePercent: claimed === 0 ? null : Math.round((paid / claimed) * 1000) / 10,
  };
}

export interface TaxonomyEntry {
  code: string | null;
  reason: string;
  occurrences: number;
  costCents: number;
}

/**
 * Why money did not arrive, ranked by what it cost.
 *
 * This is the corpus the scrubber was always supposed to be built from. The
 * roadmap asks for fifty real rejected claims before writing the rules; this is
 * how a facility accumulates them by doing its ordinary work, and the ranking is
 * by MONEY rather than by frequency because a rare rejection on a large claim
 * matters more than a common one on a small one.
 */
export function rejectionTaxonomy(facilityId: number, limit = 20): TaxonomyEntry[] {
  const rows = all<{ code: string | null; reason: string; claimed: number; paid: number }>(
    `SELECT l.reason_code AS code, l.reason, l.claimed_cents AS claimed, l.paid_cents AS paid
       FROM remittance_lines l
       JOIN remittances r ON r.id = l.remittance_id
      WHERE r.facility_id = ? AND l.claimed_cents > l.paid_cents`,
    facilityId,
  );

  const byReason = new Map<string, TaxonomyEntry>();
  for (const row of rows) {
    const key = row.code ?? row.reason ?? "unstated";
    const entry = byReason.get(key) ?? {
      code: row.code,
      reason: row.reason || "No reason stated by the payer",
      occurrences: 0,
      costCents: 0,
    };
    entry.occurrences++;
    entry.costCents += row.claimed - row.paid;
    byReason.set(key, entry);
  }

  return [...byReason.values()].sort((a, b) => b.costCents - a.costCents).slice(0, limit);
}

/** Claims submitted long ago that no advice has ever mentioned. */
export function unsettledClaims(facilityId: number, olderThanDays = 30, asOf = today()) {
  const cutoff = new Date(Date.parse(`${asOf}T00:00:00.000Z`) - olderThanDays * 86_400_000).toISOString();
  return all<{
    id: string;
    payer_code: string;
    patient_mrn: string;
    total_cents: number;
    submitted_at: string;
    days: number;
  }>(
    `SELECT c.id, c.payer_code, c.patient_mrn, c.total_cents, c.submitted_at,
            CAST((julianday(?) - julianday(c.submitted_at)) AS INTEGER) AS days
       FROM claims c JOIN encounters e ON e.id = c.encounter_id
      WHERE e.facility_id = ? AND c.status = 'submitted' AND c.submitted_at < ?
        AND NOT EXISTS (SELECT 1 FROM remittance_lines l WHERE l.claim_id = c.id)
      ORDER BY c.submitted_at`,
    asOf,
    facilityId,
    cutoff,
  );
}
