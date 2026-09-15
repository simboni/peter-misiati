/**
 * M55 Claims Engine — assembly, the scrubber, submission and outcome tracking.
 *
 * This is the commercial heart of the product. Around 20% of claim value in
 * Kenya is rejected, returned for correction, or stuck awaiting documents, and
 * resubmission takes another two months only to be rejected again. Every gate
 * below maps to a documented rejection cause:
 *
 *   1  member not verified                      "unverified member"
 *   2  pre-authorisation missing                automatic rejection
 *   3  diagnosis missing or uncoded             "wrong or missing codes"
 *   4  service outside the benefit package      "not a covered benefit"
 *   5  tariff missing or stale                  "incorrect tariff"
 *   6  incoherent dates                         "date errors"
 *   7  required documents absent                "missing documentation"
 *   8  required signatures absent               "missing signatures"
 *   9  outside the submission window            late claims rejected outright
 *
 * A claim cannot be submitted while any BLOCKING gate fails, and each failure
 * names the person who can fix it. Gate 9 escalates rather than blocks, because
 * a late claim still has an appeal path and hiding it helps nobody.
 *
 * The verdict is stored on the claim. When a rejection comes back, it can be
 * compared against what we believed at submission — which is how the rule set
 * gets better instead of the facility just absorbing the loss.
 *
 * MONEY IS INTEGER CENTS. No `next/*` imports.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { recordOp } from "./sync.ts";
import { getEncounter, activeDiagnoses, currentNote, signableNote } from "./encounters.ts";
import { chargesFor, invoiceForEncounter, type Charge } from "./billing.ts";
import { getPayer, benefitFor, coveragesFor, preauthGap, requiredDocumentsFor, type Coverage } from "./payers.ts";
import { attachments, verifySignature } from "./documents.ts";
import { call } from "./integration.ts";
import { lookup as lookupCode, ICD11 } from "./terminology.ts";

export class ClaimError extends Error {}

export interface Claim {
  id: string;
  encounter_id: string;
  patient_mrn: string;
  payer_code: string;
  invoice_id: string | null;
  service_date: string;
  total_cents: number;
  status: "draft" | "ready" | "submitted" | "accepted" | "rejected" | "paid" | "abandoned";
  scrub_verdict: string;
  reference: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  rejection_code: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** One gate's outcome. `owner` is who can actually fix it. */
export interface GateResult {
  gate: number;
  name: string;
  passed: boolean;
  severity: "block" | "escalate" | "ok";
  message: string;
  owner: "clinician" | "claims officer" | "reception" | "administrator" | "pharmacy";
}

export interface Verdict {
  ready: boolean;
  gates: GateResult[];
  blocking: GateResult[];
  daysLeft: number;
  checkedAt: string;
}

/** Whole days between two ISO dates. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

// ------------------------------------------------------------------ assembly

export function assembleClaim(input: {
  encounterId: string;
  payerCode: string;
  deviceCode: string;
  byUserId: number | null;
  byUserName: string;
}): string {
  const encounter = getEncounter(input.encounterId);
  if (!encounter) throw new ClaimError("no such encounter");

  const payerCode = input.payerCode.trim().toUpperCase();
  const payer = getPayer(payerCode);
  if (!payer) throw new ClaimError(`unknown payer ${payerCode}`);
  if (payer.kind === "cash") {
    throw new ClaimError("a cash payer is not claimed against — the patient pays at the counter");
  }

  const existing = get<Claim>(
    `SELECT * FROM claims WHERE encounter_id = ? AND status NOT IN ('abandoned','rejected')`,
    input.encounterId,
  );
  if (existing) throw new ClaimError(`this encounter already has claim ${existing.id}`);

  const charges = chargesFor(input.encounterId);
  if (charges.length === 0) throw new ClaimError("there is nothing to claim — assemble the charges first");

  const diagnoses = activeDiagnoses(input.encounterId);
  const primary = diagnoses.find((d) => d.rank === 1);

  const id = mintLocalId(input.deviceCode, 8);
  // The clock runs from the date of service, not from when somebody got round
  // to assembling the claim.
  const serviceDate = encounter.opened_at.slice(0, 10);
  const total = charges.reduce((sum, c) => sum + c.amount_cents, 0);
  const invoice = invoiceForEncounter(input.encounterId);
  const at = now();

  return tx(() => {
    run(
      `INSERT INTO claims
         (id, encounter_id, patient_mrn, payer_code, invoice_id, service_date,
          total_cents, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      id,
      input.encounterId,
      encounter.patient_mrn,
      payerCode,
      invoice?.id ?? null,
      serviceDate,
      total,
      at,
      at,
    );

    for (const charge of charges) {
      run(
        `INSERT INTO claim_items (claim_id, charge_id, service_code, description, quantity, amount_cents, diagnosis_code)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        charge.id,
        charge.service_code,
        charge.description,
        charge.quantity,
        charge.amount_cents,
        primary?.code ?? null,
      );
    }

    logEvent(id, "assembled", input.byUserId, input.byUserName, {
      lines: charges.length,
      totalCents: total,
    });

    recordOp({
      deviceCode: input.deviceCode,
      entity: "claim",
      entityId: id,
      dataClass: "ledger",
      payload: { encounter_id: input.encounterId, payer_code: payerCode, total_cents: total },
      actorId: input.byUserId,
      actorName: input.byUserName,
    });

    audit({
      action: "claim_assembled",
      entity: "claim",
      entityId: id,
      patientId: encounter.patient_mrn,
      facilityId: encounter.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "claim",
      detail: { payer: payerCode, totalCents: total, lines: charges.length },
    });

    return id;
  });
}

// ------------------------------------------------------------------ scrubber

/**
 * Run every gate against a claim.
 *
 * Pure inspection — it changes nothing, so it can be shown live on a screen
 * while a claims officer works. `scrub` is what `submitClaim` calls, so a claim
 * can never be submitted against a verdict different from the one displayed.
 */
export function scrub(claimId: string, asOf = today()): Verdict {
  const claim = get<Claim>(`SELECT * FROM claims WHERE id = ?`, claimId);
  if (!claim) throw new ClaimError("no such claim");

  const encounter = getEncounter(claim.encounter_id);
  const payer = getPayer(claim.payer_code)!;
  const items = all<{ service_code: string; description: string; amount_cents: number }>(
    `SELECT service_code, description, amount_cents FROM claim_items WHERE claim_id = ?`,
    claimId,
  );
  const gates: GateResult[] = [];

  // --- 1. Member verified -------------------------------------------------
  const coverage = coveragesFor(claim.patient_mrn).find((c) => c.payer_code === claim.payer_code);
  gates.push(gateMemberVerified(coverage));

  // --- 2. Pre-authorisation -----------------------------------------------
  const gap = preauthGap({
    encounterId: claim.encounter_id,
    payerCode: claim.payer_code,
    serviceCodes: items.map((i) => i.service_code),
    totalCents: claim.total_cents,
  });
  gates.push({
    gate: 2,
    name: "Pre-authorisation",
    passed: gap.missing.length === 0,
    severity: gap.missing.length === 0 ? "ok" : "block",
    owner: "claims officer",
    message:
      gap.missing.length === 0
        ? gap.required.length === 0
          ? "No service on this claim needs pre-authorisation."
          : `Pre-authorisation held for ${gap.required.join(", ")}.`
        : `No approved pre-authorisation for ${gap.missing.join(", ")}. Submitting without it is an automatic rejection.`,
  });

  // --- 3. Diagnosis coded --------------------------------------------------
  const diagnoses = activeDiagnoses(claim.encounter_id);
  const primary = diagnoses.find((d) => d.rank === 1);
  const codeKnown = primary ? lookupCode(primary.code, ICD11) : undefined;
  gates.push({
    gate: 3,
    name: "Diagnosis",
    passed: Boolean(primary && codeKnown?.verified),
    severity: primary && codeKnown?.verified ? "ok" : "block",
    owner: "clinician",
    message: !primary
      ? "No primary diagnosis on the encounter. A claim without one is rejected."
      : !codeKnown
        ? `${primary.code} is not in the loaded ICD-11 catalogue. It cannot be claimed.`
        : !codeKnown.verified
          ? `${primary.code} is unverified against the issuing authority and must not go on a claim.`
          : `Primary diagnosis ${primary.code} — ${primary.term}.`,
  });

  // --- 4. Inside the benefit package --------------------------------------
  const uncovered = items.filter((i) => {
    const rule = benefitFor(claim.payer_code, i.service_code);
    // Absence is not permission.
    return !rule || !rule.covered;
  });
  gates.push({
    gate: 4,
    name: "Benefit package",
    passed: uncovered.length === 0,
    severity: uncovered.length === 0 ? "ok" : "block",
    owner: "claims officer",
    message:
      uncovered.length === 0
        ? `All ${items.length} line${items.length === 1 ? "" : "s"} are inside the ${payer.name} package.`
        : `Not covered by ${payer.name}: ${uncovered.map((i) => i.service_code).join(", ")}. Reprice as cash or appeal before submitting.`,
  });

  // --- 5. Tariffs current --------------------------------------------------
  const charges = chargesFor(claim.encounter_id);
  const unpriced = charges.filter((c) => !c.tariff_source);
  gates.push({
    gate: 5,
    name: "Tariff",
    passed: unpriced.length === 0,
    severity: unpriced.length === 0 ? "ok" : "block",
    owner: "administrator",
    message:
      unpriced.length === 0
        ? "Every line was priced from a dated tariff."
        : `No tariff source recorded for ${unpriced.map((c) => c.service_code).join(", ")}.`,
  });

  // --- 6. Dates coherent ---------------------------------------------------
  gates.push(gateDates(claim, encounter?.closed_at ?? null, asOf));

  // --- 7. Documentation ----------------------------------------------------
  gates.push(gateDocumentation(claim, items));

  // --- 8. Signature / attribution -----------------------------------------
  gates.push(gateSignature(claim, encounter));

  // --- 9. Submission window ------------------------------------------------
  const age = daysBetween(claim.service_date, asOf);
  const daysLeft = payer.claim_window_days - age;
  gates.push({
    gate: 9,
    name: "Submission window",
    passed: daysLeft >= 0,
    // Escalates rather than blocks: a late claim still has an appeal path, and
    // hiding it helps nobody.
    severity: daysLeft >= 0 ? "ok" : "escalate",
    owner: "claims officer",
    message:
      daysLeft >= 0
        ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left of the ${payer.claim_window_days}-day window.`
        : `${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? "" : "s"} past the ${payer.claim_window_days}-day window. Late claims are rejected automatically — escalate.`,
  });

  const blocking = gates.filter((g) => g.severity === "block");
  return {
    ready: blocking.length === 0,
    gates,
    blocking,
    daysLeft,
    checkedAt: now(),
  };
}

function gateMemberVerified(coverage: Coverage | undefined): GateResult {
  if (!coverage) {
    return {
      gate: 1,
      name: "Member verification",
      passed: false,
      severity: "block",
      owner: "reception",
      message: "No cover on file for this payer. Verify the member before claiming.",
    };
  }
  if (coverage.verification_source === "online" || coverage.verification_source === "cached") {
    return {
      gate: 1,
      name: "Member verification",
      passed: coverage.status === "active",
      severity: coverage.status === "active" ? "ok" : "block",
      owner: "reception",
      message:
        coverage.status === "active"
          ? `Member ${coverage.member_number} verified active.`
          : `The payer says member ${coverage.member_number} is ${coverage.status}.`,
    };
  }
  if (coverage.verification_source === "emergency") {
    // SHA's own emergency pathway. The claim carries the flag honestly rather
    // than being blocked — that is the point of the exception existing.
    return {
      gate: 1,
      name: "Member verification",
      passed: true,
      severity: "ok",
      owner: "reception",
      message: "Emergency pathway used. The claim will state that cover was unconfirmed at the time of care.",
    };
  }
  return {
    gate: 1,
    name: "Member verification",
    passed: false,
    severity: "block",
    owner: "reception",
    message:
      "Cover is provisional — the payer could not be reached when this patient was seen. Re-verify before submitting.",
  };
}

/**
 * Gate 7 — is everything the payer will ask for actually here?
 *
 * Three things, and each names what is missing rather than saying
 * "documentation incomplete", which is the message that sends a claims officer
 * hunting for an hour:
 *
 *   the clinical assessment  — written, not just an encounter that exists
 *   the invoice              — a claim with no priced invoice has no amount
 *   the payer's own list     — whatever the benefit rule for each service says
 *                              must accompany it, checked against real files
 *
 * The third is the one that was missing until the document store existed. A
 * benefit rule that says a lab report must accompany a malaria claim is now
 * checked against a lab report that is genuinely attached.
 */
function gateDocumentation(claim: Claim, items: { service_code: string }[]): GateResult {
  const note = currentNote(claim.encounter_id);
  const hasNote = Boolean(note?.assessment.trim());

  const held = new Set(
    [...attachments("claim", claim.id), ...attachments("encounter", claim.encounter_id)].map((d) => d.kind),
  );

  const required = new Map<string, string[]>();
  for (const item of items) {
    for (const kind of requiredDocumentsFor(claim.payer_code, item.service_code)) {
      if (held.has(kind)) continue;
      required.set(kind, [...(required.get(kind) ?? []), item.service_code]);
    }
  }

  const missing: string[] = [];
  if (!hasNote) missing.push("the clinical assessment");
  if (!claim.invoice_id) missing.push("the invoice");
  for (const [kind, services] of required) {
    missing.push(`${kind.replace(/_/g, " ")} (required for ${services.join(", ")})`);
  }

  return {
    gate: 7,
    name: "Documentation",
    passed: missing.length === 0,
    severity: missing.length === 0 ? "ok" : "block",
    owner: hasNote && claim.invoice_id ? "clinician" : hasNote ? "claims officer" : "clinician",
    message:
      missing.length === 0
        ? held.size > 0
          ? `Assessment, invoice and ${held.size} attachment${held.size === 1 ? "" : "s"} are all present.`
          : "Clinical assessment and invoice are both present."
        : `Missing: ${missing.join("; ")}.`,
  };
}

/**
 * Gate 8 — did a licensed person put their name to this, and does it still hold?
 *
 * Two failures, and the second is the one nobody catches by hand: a note signed
 * off at the end of a consultation and then amended afterwards. The signature
 * stores a digest of what was signed, so an amendment makes it stop matching —
 * and a claim resting on a signature that no longer covers the record is
 * exactly what a payer audit looks for.
 */
function gateSignature(claim: Claim, encounter: ReturnType<typeof getEncounter>): GateResult {
  const base = { gate: 8, name: "Signature", owner: "clinician" as const };

  if (!encounter?.licence_number) {
    return {
      ...base,
      passed: false,
      severity: "block",
      message: "No practitioner licence was pinned when this encounter opened. A claim citing it is rejected.",
    };
  }
  if (encounter.status !== "closed") {
    return {
      ...base,
      passed: false,
      severity: "block",
      message: "The encounter is still open. A claim cannot be signed off from an unfinished consultation.",
    };
  }

  const check = verifySignature({
    entity: "encounter",
    entityId: claim.encounter_id,
    purpose: "clinical_note",
    content: signableNote(claim.encounter_id),
  });

  if (check.signed && !check.stillValid) {
    return {
      ...base,
      passed: false,
      severity: "block",
      message: `The record was amended after ${check.signature!.signer_name} signed it. It must be signed again before this claim goes out.`,
    };
  }

  return {
    ...base,
    passed: true,
    severity: "ok",
    message: check.signed
      ? `Signed by ${check.signature!.signer_name} (${check.signature!.licence_regulator} ${check.signature!.licence_number}) on ${check.signature!.signed_at.slice(0, 10)}.`
      : `Attributed to ${encounter.clinician_name} (${encounter.licence_regulator} ${encounter.licence_number}).`,
  };
}

function gateDates(claim: Claim, closedAt: string | null, asOf: string): GateResult {
  const problems: string[] = [];
  if (claim.service_date > asOf) problems.push("the date of service is in the future");
  if (closedAt && closedAt.slice(0, 10) < claim.service_date) {
    problems.push("the encounter closed before it opened");
  }
  return {
    gate: 6,
    name: "Dates",
    passed: problems.length === 0,
    severity: problems.length === 0 ? "ok" : "block",
    owner: "claims officer",
    message: problems.length === 0 ? "Service and discharge dates are coherent." : `Date error: ${problems.join("; ")}.`,
  };
}

// ---------------------------------------------------------------- submission

/**
 * The payer submission channel, injected so the real SHA adapter drops in
 * without touching this module.
 */
export type ClaimSubmitter = (payload: string) =>
  | { ok: true; reference: string }
  | { ok: false; error: string };

/** For a payer with no channel at all. The claim stays ready and visible. */
export const SUBMISSION_NOT_CONFIGURED: ClaimSubmitter = () => ({
  ok: false,
  error: "no payer claim adapter is configured on this installation",
});

/**
 * The default: submit through the integration hub.
 *
 * An acknowledgement is not a decision. SHA acknowledges on receipt and decides
 * later, which is why this only records the reference — the outcome arrives
 * through `pollOutcomes`, and the dashboard tracks days-to-decision rather than
 * pretending an answer came back with the submission.
 */
export const SUBMIT_VIA_HUB: ClaimSubmitter = (payload) => {
  const claim = JSON.parse(payload) as { claimId: string; payer: string };
  const payer = getPayer(claim.payer);
  if (payer?.kind !== "sha") {
    return { ok: false, error: `no claim channel is configured for ${payer?.name ?? claim.payer}` };
  }

  const result = call({ endpoint: "SHA", operation: "submitClaim", request: JSON.parse(payload) });
  if (!result.ok) return { ok: false, error: result.error };

  const reference = result.data.reference;
  if (typeof reference !== "string" || !reference) {
    return { ok: false, error: "the payer acknowledged without returning a reference — treat it as not received" };
  }
  return { ok: true, reference };
};

/**
 * Submit a claim — only if the scrubber passes.
 *
 * The verdict is re-run here rather than trusted from the screen, and stored on
 * the claim. A claim that leaves this building has been checked against every
 * known rejection cause at the moment it left.
 */
export function submitClaim(input: {
  claimId: string;
  byUserId: number | null;
  byUserName: string;
  submit?: ClaimSubmitter;
  /** Only an explicit override lets a late claim out, and it is recorded. */
  lateOverrideReason?: string;
}): { submitted: boolean; verdict: Verdict; reference?: string; error?: string } {
  const claim = get<Claim>(`SELECT * FROM claims WHERE id = ?`, input.claimId);
  if (!claim) throw new ClaimError("no such claim");
  if (claim.status === "submitted" || claim.status === "accepted" || claim.status === "paid") {
    throw new ClaimError(`claim ${claim.id} has already been submitted`);
  }

  const verdict = scrub(input.claimId);

  run(
    `UPDATE claims SET scrub_verdict = ?, status = ?, updated_at = ? WHERE id = ?`,
    JSON.stringify(verdict),
    verdict.ready ? "ready" : "draft",
    now(),
    input.claimId,
  );

  if (!verdict.ready) {
    logEvent(input.claimId, "scrub_blocked", input.byUserId, input.byUserName, {
      blocking: verdict.blocking.map((g) => ({ gate: g.gate, name: g.name, owner: g.owner })),
    });
    return {
      submitted: false,
      verdict,
      error: verdict.blocking.map((g) => g.message).join(" "),
    };
  }

  const late = verdict.daysLeft < 0;
  if (late && !input.lateOverrideReason?.trim()) {
    return {
      submitted: false,
      verdict,
      error: `This claim is ${Math.abs(verdict.daysLeft)} days past the submission window. To submit anyway, record why.`,
    };
  }

  const payload = JSON.stringify({
    claimId: claim.id,
    payer: claim.payer_code,
    patient: claim.patient_mrn,
    serviceDate: claim.service_date,
    totalCents: claim.total_cents,
    items: all(`SELECT service_code, description, quantity, amount_cents, diagnosis_code FROM claim_items WHERE claim_id = ?`, claim.id),
  });

  const result = (input.submit ?? SUBMIT_VIA_HUB)(payload);

  if (!result.ok) {
    logEvent(input.claimId, "submission_failed", input.byUserId, input.byUserName, { error: result.error });
    return { submitted: false, verdict, error: result.error };
  }

  tx(() => {
    run(
      `UPDATE claims SET status = 'submitted', reference = ?, submitted_at = ?, updated_at = ? WHERE id = ?`,
      result.reference,
      now(),
      now(),
      input.claimId,
    );
    logEvent(input.claimId, "submitted", input.byUserId, input.byUserName, {
      reference: result.reference,
      late,
      lateReason: input.lateOverrideReason ?? null,
    });
    audit({
      action: "claim_submitted",
      entity: "claim",
      entityId: input.claimId,
      patientId: claim.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "claim",
      detail: { reference: result.reference, totalCents: claim.total_cents, late },
    });
  });

  return { submitted: true, verdict, reference: result.reference };
}

export function recordOutcome(input: {
  claimId: string;
  outcome: "accepted" | "rejected" | "paid";
  rejectionCode?: string;
  rejectionReason?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const claim = get<Claim>(`SELECT * FROM claims WHERE id = ?`, input.claimId);
  if (!claim) throw new ClaimError("no such claim");

  if (input.outcome === "rejected" && !input.rejectionReason?.trim()) {
    // The reason is the asset. Without it the facility cannot learn, and the
    // rejection taxonomy that improves the scrubber never gets built.
    throw new ClaimError("a rejection must record the payer's reason — it is what improves the scrubber");
  }

  tx(() => {
    run(
      `UPDATE claims SET status = ?, decided_at = ?, rejection_code = ?, rejection_reason = ?, updated_at = ? WHERE id = ?`,
      input.outcome,
      now(),
      input.rejectionCode?.trim() ?? null,
      input.rejectionReason?.trim() ?? null,
      now(),
      input.claimId,
    );
    logEvent(input.claimId, input.outcome, input.byUserId, input.byUserName, {
      code: input.rejectionCode ?? null,
      reason: input.rejectionReason ?? null,
    });
    audit({
      action: `claim_${input.outcome}`,
      entity: "claim",
      entityId: input.claimId,
      patientId: claim.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "claim",
      detail: { code: input.rejectionCode ?? null, reason: input.rejectionReason ?? null },
    });
  });
}

function logEvent(
  claimId: string,
  kind: string,
  actorId: number | null,
  actorName: string,
  detail: Record<string, unknown>,
): void {
  run(
    `INSERT INTO claim_events (claim_id, at, kind, actor_id, actor_name, detail) VALUES (?, ?, ?, ?, ?, ?)`,
    claimId,
    now(),
    kind,
    actorId,
    actorName,
    JSON.stringify(detail),
  );
}

export function getClaim(id: string): Claim | undefined {
  return get<Claim>(`SELECT * FROM claims WHERE id = ?`, id);
}

export function claimForEncounter(encounterId: string): Claim | undefined {
  return get<Claim>(
    `SELECT * FROM claims WHERE encounter_id = ? AND status <> 'abandoned' ORDER BY created_at DESC LIMIT 1`,
    encounterId,
  );
}

export function claimEvents(claimId: string) {
  return all<{ at: string; kind: string; actor_name: string; detail: string }>(
    `SELECT at, kind, actor_name, detail FROM claim_events WHERE claim_id = ? ORDER BY at`,
    claimId,
  );
}

/**
 * Ask the payer what it decided about everything still outstanding.
 *
 * Run on a schedule and from the claims screen. A payer that has not decided
 * yet says so and the claim stays submitted — nothing is guessed, and a claim
 * is never moved off `submitted` without the payer's own answer.
 */
export function pollOutcomes(input: {
  byUserId: number | null;
  byUserName: string;
  limit?: number;
}): { checked: number; decided: number; accepted: number; rejected: number; paid: number } {
  const outstanding = all<Claim>(
    `SELECT * FROM claims WHERE status = 'submitted' ORDER BY submitted_at LIMIT ?`,
    input.limit ?? 50,
  );

  const tally = { checked: 0, decided: 0, accepted: 0, rejected: 0, paid: 0 };

  for (const claim of outstanding) {
    const payer = getPayer(claim.payer_code);
    if (payer?.kind !== "sha") continue;

    tally.checked++;
    const result = call({
      endpoint: "SHA",
      operation: "pollOutcome",
      request: { claimId: claim.id, reference: claim.reference ?? "" },
    });
    if (!result.ok || result.data.decided !== true) continue;

    const outcome = String(result.data.outcome);
    if (outcome !== "accepted" && outcome !== "rejected" && outcome !== "paid") continue;

    recordOutcome({
      claimId: claim.id,
      outcome,
      rejectionCode: typeof result.data.code === "string" ? result.data.code : undefined,
      // recordOutcome refuses a rejection with no reason, and rightly so: the
      // reason is the asset that improves the scrubber.
      rejectionReason:
        outcome === "rejected"
          ? String(result.data.reason ?? "rejected without a stated reason — query the payer")
          : undefined,
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });

    tally.decided++;
    tally[outcome]++;
  }

  return tally;
}

// ----------------------------------------------------------------- dashboard

export interface ClaimsSummary {
  total: number;
  submitted: number;
  accepted: number;
  rejected: number;
  paid: number;
  draft: number;
  /** The number the facility owner actually watches. */
  acceptanceRatePercent: number | null;
  valueAtRiskCents: number;
  /** Claims inside the window but not yet submitted, soonest first. */
  closingSoon: { id: string; daysLeft: number; totalCents: number; patient: string }[];
  overdue: { id: string; daysLate: number; totalCents: number }[];
  /** Rejection reasons ranked by how much they cost. */
  topRejectionReasons: { reason: string; count: number; valueCents: number }[];
}

/**
 * The claims dashboard.
 *
 * Acceptance rate is the headline because it is the only number the facility
 * owner actually watches, and the one no incumbent publishes.
 */
export function claimsSummary(asOf = today()): ClaimsSummary {
  const claims = all<Claim>(`SELECT * FROM claims`);
  const decided = claims.filter((c) => c.status === "accepted" || c.status === "paid" || c.status === "rejected");
  const good = decided.filter((c) => c.status !== "rejected").length;

  const closingSoon: ClaimsSummary["closingSoon"] = [];
  const overdue: ClaimsSummary["overdue"] = [];

  for (const claim of claims) {
    if (claim.status !== "draft" && claim.status !== "ready") continue;
    const payer = getPayer(claim.payer_code);
    const daysLeft = (payer?.claim_window_days ?? 7) - daysBetween(claim.service_date, asOf);
    if (daysLeft < 0) {
      overdue.push({ id: claim.id, daysLate: Math.abs(daysLeft), totalCents: claim.total_cents });
    } else {
      closingSoon.push({
        id: claim.id,
        daysLeft,
        totalCents: claim.total_cents,
        patient: claim.patient_mrn,
      });
    }
  }
  closingSoon.sort((a, b) => a.daysLeft - b.daysLeft);
  overdue.sort((a, b) => b.daysLate - a.daysLate);

  const reasons = new Map<string, { count: number; valueCents: number }>();
  for (const claim of claims) {
    if (claim.status !== "rejected" || !claim.rejection_reason) continue;
    const key = claim.rejection_reason;
    const seen = reasons.get(key) ?? { count: 0, valueCents: 0 };
    reasons.set(key, { count: seen.count + 1, valueCents: seen.valueCents + claim.total_cents });
  }

  return {
    total: claims.length,
    submitted: claims.filter((c) => c.status === "submitted").length,
    accepted: claims.filter((c) => c.status === "accepted").length,
    rejected: claims.filter((c) => c.status === "rejected").length,
    paid: claims.filter((c) => c.status === "paid").length,
    draft: claims.filter((c) => c.status === "draft" || c.status === "ready").length,
    acceptanceRatePercent: decided.length === 0 ? null : Math.round((good / decided.length) * 100),
    valueAtRiskCents: claims
      .filter((c) => c.status === "draft" || c.status === "ready" || c.status === "submitted")
      .reduce((sum, c) => sum + c.total_cents, 0),
    closingSoon: closingSoon.slice(0, 10),
    overdue: overdue.slice(0, 10),
    topRejectionReasons: [...reasons.entries()]
      .map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => b.valueCents - a.valueCents)
      .slice(0, 5),
  };
}
