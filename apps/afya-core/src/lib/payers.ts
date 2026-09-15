/**
 * M53 Payer & Coverage, and M54 Pre-authorisation.
 *
 * Built against weakness W5: verification and pre-authorisation are dead ends in
 * most systems. When SHA's pre-authorisation platform failed nationwide in March
 * 2026, facilities had no fallback — they assume the payer is always reachable.
 *
 * So this module never blocks care on a payer being up:
 *
 *   ONLINE       the payer answered. Trustworthy.
 *   CACHED       a recent answer reused. Trustworthy, dated.
 *   PROVISIONAL  the payer was unreachable. Care proceeds, the request is
 *                queued, and the claim carries the flag honestly.
 *   EMERGENCY    the SHA emergency path — ECCIF, OTP-only for an identified
 *                emergency patient, or a reason code for an unidentified one.
 *
 * The flag is never laundered. A provisional verification is reported as
 * provisional to the scrubber, because a claim that silently claims to be
 * verified when it is not is exactly how a facility gets 20% rejected.
 *
 * MONEY IS INTEGER CENTS. Never a float.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { call } from "./integration.ts";
import { resolvePatient } from "./patients.ts";

export class PayerError extends Error {}

export type PayerKind = "cash" | "sha" | "private" | "corporate";
export type VerificationSource = "online" | "cached" | "provisional" | "emergency";

export interface Payer {
  code: string;
  name: string;
  kind: PayerKind;
  claim_window_days: number;
  preauth_above_cents: number;
  active: number;
  created_at: string;
}

export interface Coverage {
  id: number;
  patient_mrn: string;
  payer_code: string;
  member_number: string;
  scheme_name: string;
  principal_mrn: string | null;
  valid_from: string | null;
  valid_to: string | null;
  status: "active" | "inactive" | "unknown";
  verified_at: string | null;
  verification_source: VerificationSource | null;
  created_at: string;
}

export interface BenefitRule {
  id: number;
  payer_code: string;
  service_code: string;
  covered: number;
  requires_preauth: number;
  limit_cents: number | null;
  required_documents: string;
  notes: string;
  source: string;
}

// -------------------------------------------------------------------- payers

export function definePayer(input: {
  code: string;
  name: string;
  kind: PayerKind;
  claimWindowDays?: number;
  preauthAboveCents?: number;
  byUserId?: number | null;
  byUserName?: string;
}): void {
  const code = input.code.trim().toUpperCase();
  tx(() => {
    run(
      `INSERT INTO payers (code, name, kind, claim_window_days, preauth_above_cents, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET
         name = excluded.name, kind = excluded.kind,
         claim_window_days = excluded.claim_window_days,
         preauth_above_cents = excluded.preauth_above_cents`,
      code,
      input.name.trim(),
      input.kind,
      // SHA rejects a claim submitted beyond seven days. The default is that
      // rule, not a guess.
      input.claimWindowDays ?? 7,
      input.preauthAboveCents ?? 0,
      now(),
    );
    audit({
      action: "payer_defined",
      entity: "payer",
      entityId: code,
      actorId: input.byUserId ?? null,
      actorName: input.byUserName ?? "system",
      purpose: "administration",
      detail: { code, kind: input.kind },
    });
  });
}

export function getPayer(code: string): Payer | undefined {
  return get<Payer>(`SELECT * FROM payers WHERE code = ?`, code.trim().toUpperCase());
}

export function listPayers(): Payer[] {
  return all<Payer>(`SELECT * FROM payers WHERE active = 1 ORDER BY kind, name`);
}

// ------------------------------------------------------------------ benefits

export function defineBenefit(input: {
  payerCode: string;
  serviceCode: string;
  covered?: boolean;
  requiresPreauth?: boolean;
  limitCents?: number | null;
  /** Document kinds the payer wants with the claim: lab_report, referral, ... */
  requiredDocuments?: string[];
  notes?: string;
  source: string;
}): void {
  if (!input.source.trim()) {
    throw new PayerError("a benefit rule must record its source, e.g. 'SHA benefit package 2026/28'");
  }
  run(
    `INSERT INTO benefit_rules (payer_code, service_code, covered, requires_preauth, limit_cents,
       required_documents, notes, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(payer_code, service_code) DO UPDATE SET
       covered = excluded.covered, requires_preauth = excluded.requires_preauth,
       limit_cents = excluded.limit_cents, required_documents = excluded.required_documents,
       notes = excluded.notes, source = excluded.source`,
    input.payerCode.trim().toUpperCase(),
    input.serviceCode.trim().toUpperCase(),
    input.covered === false ? 0 : 1,
    input.requiresPreauth ? 1 : 0,
    input.limitCents ?? null,
    (input.requiredDocuments ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean).join(","),
    input.notes ?? "",
    input.source.trim(),
  );
}

/**
 * The benefit rule for a service, or null when none is loaded.
 *
 * Null means "we do not know", and callers must treat that as uncovered.
 * Absence is not permission — assuming cover costs a rejection two months later.
 */
export function benefitFor(payerCode: string, serviceCode: string): BenefitRule | null {
  return (
    get<BenefitRule>(
      `SELECT * FROM benefit_rules WHERE payer_code = ? AND service_code = ?`,
      payerCode.trim().toUpperCase(),
      serviceCode.trim().toUpperCase(),
    ) ?? null
  );
}

// ------------------------------------------------------------------ coverage

/**
 * How a verification attempt went.
 *
 * The probe is injected so the real SHA adapter can be dropped in without
 * touching this module — the anti-corruption layer the architecture note calls
 * for. The default routes through the integration hub, which runs the real
 * adapter in live mode and a labelled simulator in demo mode.
 */
export type PayerProbe = (input: {
  payerCode: string;
  memberNumber: string;
}) => { reachable: true; active: boolean; schemeName?: string; validTo?: string } | { reachable: false; error: string };

/** The honest fallback for a payer with no channel at all. */
export const UNREACHABLE: PayerProbe = () => ({
  reachable: false,
  error: "no payer adapter is configured on this installation",
});

/** Document kinds this payer requires for a service, from its benefit rule. */
export function requiredDocumentsFor(payerCode: string, serviceCode: string): string[] {
  const rule = benefitFor(payerCode, serviceCode);
  return (rule?.required_documents ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}

/**
 * The default probe: ask the integration hub.
 *
 * SHA-kind payers have an endpoint; private and corporate payers do not yet, so
 * for them this stays honestly unreachable and the provisional path runs. The
 * hub decides whether the answer came from a real link or a simulator, and says
 * which — this module only has to pass the answer on truthfully.
 */
export const VIA_HUB: PayerProbe = ({ payerCode, memberNumber }) => {
  const payer = getPayer(payerCode);
  if (payer?.kind !== "sha") {
    return { reachable: false, error: `no integration is configured for ${payer?.name ?? payerCode}` };
  }

  const result = call({ endpoint: "SHA", operation: "verifyMember", request: { memberNumber } });
  if (!result.ok) return { reachable: false, error: result.error };

  return {
    reachable: true,
    active: result.data.active === true,
    schemeName: typeof result.data.schemeName === "string" ? result.data.schemeName : undefined,
    validTo: typeof result.data.validUntil === "string" ? result.data.validUntil : undefined,
  };
};

/** How long an online verification stays good before it is re-checked. */
const CACHE_HOURS = 24;

export interface VerificationResult {
  coverage: Coverage;
  source: VerificationSource;
  /** True when the payer could not be reached and care proceeded regardless. */
  provisional: boolean;
  message: string;
}

/**
 * Verify a patient's cover — and never block care on the answer.
 */
export function verifyCoverage(input: {
  patientMrn: string;
  payerCode: string;
  memberNumber: string;
  byUserId: number | null;
  byUserName: string;
  probe?: PayerProbe;
  /** Set for the SHA emergency pathway: ECCIF, OTP-only, unidentified patient. */
  emergency?: { reason: string };
}): VerificationResult {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new PayerError("no such patient");

  const payerCode = input.payerCode.trim().toUpperCase();
  const payer = getPayer(payerCode);
  if (!payer) throw new PayerError(`unknown payer ${payerCode}`);

  const member = input.memberNumber.trim().toUpperCase();

  const existing = get<Coverage>(
    `SELECT * FROM coverages WHERE patient_mrn = ? AND payer_code = ? AND member_number = ?`,
    patient.mrn,
    payerCode,
    member,
  );

  // The emergency path short-circuits everything. SHA itself supports treating
  // an identified emergency patient on OTP alone, and an unidentified one on a
  // reason code — the point is that care is not held up at the door.
  if (input.emergency) {
    const coverage = upsertCoverage({
      patientMrn: patient.mrn,
      payerCode,
      memberNumber: member,
      status: "unknown",
      source: "emergency",
      schemeName: existing?.scheme_name ?? "",
    });
    recordVerificationAudit(patient.mrn, payerCode, "emergency", input, {
      reason: input.emergency.reason,
    });
    return {
      coverage,
      source: "emergency",
      provisional: true,
      message: `Emergency pathway: ${input.emergency.reason}. Cover is unconfirmed and the claim will say so.`,
    };
  }

  // A recent online answer is reused rather than re-asked.
  if (
    existing?.verified_at &&
    existing.verification_source === "online" &&
    Date.now() - Date.parse(existing.verified_at) < CACHE_HOURS * 3_600_000
  ) {
    return {
      coverage: existing,
      source: "cached",
      provisional: false,
      message: `Verified ${existing.verified_at.slice(0, 16).replace("T", " ")} and still current.`,
    };
  }

  const probe = input.probe ?? VIA_HUB;
  const answer = probe({ payerCode, memberNumber: member });

  if (answer.reachable) {
    const coverage = upsertCoverage({
      patientMrn: patient.mrn,
      payerCode,
      memberNumber: member,
      status: answer.active ? "active" : "inactive",
      source: "online",
      schemeName: answer.schemeName ?? existing?.scheme_name ?? "",
      validTo: answer.validTo ?? existing?.valid_to ?? null,
    });
    recordVerificationAudit(patient.mrn, payerCode, "online", input, { active: answer.active });
    return {
      coverage,
      source: "online",
      provisional: false,
      message: answer.active ? "Cover confirmed active." : "The payer says this cover is not active.",
    };
  }

  // Unreachable. Queue it, mark the coverage provisional, and let care proceed.
  run(
    `INSERT INTO verification_queue (patient_mrn, payer_code, member_number, queued_at, status, last_error)
     VALUES (?, ?, ?, ?, 'queued', ?)`,
    patient.mrn,
    payerCode,
    member,
    now(),
    answer.error,
  );

  const coverage = upsertCoverage({
    patientMrn: patient.mrn,
    payerCode,
    memberNumber: member,
    status: existing?.status ?? "unknown",
    source: "provisional",
    schemeName: existing?.scheme_name ?? "",
  });
  recordVerificationAudit(patient.mrn, payerCode, "provisional", input, { error: answer.error });

  return {
    coverage,
    source: "provisional",
    provisional: true,
    message: `Could not reach ${payer.name} (${answer.error}). Queued — care can proceed, and the claim will show the cover as unconfirmed.`,
  };
}

function upsertCoverage(input: {
  patientMrn: string;
  payerCode: string;
  memberNumber: string;
  status: "active" | "inactive" | "unknown";
  source: VerificationSource;
  schemeName: string;
  validTo?: string | null;
}): Coverage {
  run(
    `INSERT INTO coverages
       (patient_mrn, payer_code, member_number, scheme_name, valid_to, status,
        verified_at, verification_source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(patient_mrn, payer_code, member_number) DO UPDATE SET
       status = excluded.status,
       scheme_name = excluded.scheme_name,
       valid_to = excluded.valid_to,
       verified_at = excluded.verified_at,
       verification_source = excluded.verification_source`,
    input.patientMrn,
    input.payerCode,
    input.memberNumber,
    input.schemeName,
    input.validTo ?? null,
    input.status,
    now(),
    input.source,
    now(),
  );
  return get<Coverage>(
    `SELECT * FROM coverages WHERE patient_mrn = ? AND payer_code = ? AND member_number = ?`,
    input.patientMrn,
    input.payerCode,
    input.memberNumber,
  )!;
}

function recordVerificationAudit(
  mrn: string,
  payerCode: string,
  source: VerificationSource,
  by: { byUserId: number | null; byUserName: string },
  detail: Record<string, unknown>,
): void {
  audit({
    action: "coverage_verified",
    entity: "coverage",
    entityId: `${mrn}:${payerCode}`,
    patientId: mrn,
    actorId: by.byUserId,
    actorName: by.byUserName,
    purpose: "claim",
    detail: { payer: payerCode, source, ...detail },
  });
}

export function coveragesFor(patientMrn: string): Coverage[] {
  const patient = resolvePatient(patientMrn);
  if (!patient) return [];
  return all<Coverage>(
    `SELECT * FROM coverages WHERE patient_mrn = ? ORDER BY status, payer_code`,
    patient.mrn,
  );
}

/** Verifications still waiting on a payer to come back. */
export function pendingVerifications(): { id: number; patient_mrn: string; payer_code: string; queued_at: string }[] {
  return all(`SELECT id, patient_mrn, payer_code, queued_at FROM verification_queue WHERE status = 'queued' ORDER BY queued_at`);
}

// ------------------------------------------------------------ pre-authorisation

export interface Preauth {
  id: string;
  encounter_id: string | null;
  patient_mrn: string;
  payer_code: string;
  service_codes: string;
  clinical_summary: string;
  status: "draft" | "requested" | "approved" | "declined" | "expired";
  reference: string | null;
  approved_amount_cents: number | null;
  valid_until: string | null;
  decline_reason: string | null;
  requested_by: number | null;
  requested_at: string | null;
  decided_at: string | null;
  created_at: string;
}

/**
 * Which services on this encounter need pre-authorisation and do not have it.
 *
 * Submitting without preauth where it is required is an automatic rejection, so
 * this is surfaced during the visit rather than discovered at submission.
 */
export function preauthGap(input: {
  encounterId: string;
  payerCode: string;
  serviceCodes: string[];
  totalCents: number;
}): { required: string[]; held: string[]; missing: string[] } {
  const payer = getPayer(input.payerCode);
  if (!payer) throw new PayerError(`unknown payer ${input.payerCode}`);

  const required = input.serviceCodes.filter((code) => {
    const rule = benefitFor(input.payerCode, code);
    if (rule?.requires_preauth) return true;
    // A payer may also require authorisation purely on amount.
    return payer.preauth_above_cents > 0 && input.totalCents > payer.preauth_above_cents;
  });

  const approved = all<Preauth>(
    `SELECT * FROM preauths WHERE encounter_id = ? AND payer_code = ? AND status = 'approved'`,
    input.encounterId,
    input.payerCode.trim().toUpperCase(),
  );

  const held = new Set<string>();
  for (const p of approved) {
    // An approval that has lapsed is not an approval.
    if (p.valid_until && p.valid_until < today()) continue;
    for (const code of JSON.parse(p.service_codes) as string[]) held.add(code);
  }

  return {
    required,
    held: [...held],
    missing: required.filter((code) => !held.has(code)),
  };
}

export function requestPreauth(input: {
  encounterId: string;
  patientMrn: string;
  payerCode: string;
  serviceCodes: string[];
  clinicalSummary: string;
  deviceCode: string;
  byUserId: number;
  byUserName: string;
}): string {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new PayerError("no such patient");
  if (input.serviceCodes.length === 0) throw new PayerError("a pre-authorisation must name the services it covers");
  if (!input.clinicalSummary.trim()) {
    throw new PayerError("a pre-authorisation needs a clinical summary — a payer declines requests without one");
  }

  const id = mintLocalId(input.deviceCode, 8);
  const at = now();

  return tx(() => {
    run(
      `INSERT INTO preauths
         (id, encounter_id, patient_mrn, payer_code, service_codes, clinical_summary,
          status, requested_by, requested_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?)`,
      id,
      input.encounterId,
      patient.mrn,
      input.payerCode.trim().toUpperCase(),
      JSON.stringify(input.serviceCodes.map((c) => c.trim().toUpperCase())),
      input.clinicalSummary.trim(),
      input.byUserId,
      at,
      at,
    );
    audit({
      action: "preauth_requested",
      entity: "preauth",
      entityId: id,
      patientId: patient.mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "claim",
      detail: { payer: input.payerCode, services: input.serviceCodes },
    });
    return id;
  });

  // Sent after the row exists, not before: a request the facility cannot show
  // it made is worthless, and the transmission may well fail.
  sendPreauth(id, input);

  return id;
}

/**
 * Put a recorded pre-authorisation on the wire.
 *
 * A payer that answers immediately has its decision recorded here. One that
 * does not — or that cannot be reached — leaves the request 'requested', which
 * is what the pre-auth worklist is for. Nothing is invented either way.
 */
function sendPreauth(
  preauthId: string,
  input: { payerCode: string; serviceCodes: string[]; clinicalSummary: string; byUserId: number; byUserName: string },
): void {
  const payer = getPayer(input.payerCode);
  if (payer?.kind !== "sha") return;

  const result = call({
    endpoint: "SHA",
    operation: "requestPreauth",
    request: {
      preauthId,
      serviceCodes: input.serviceCodes.map((c) => c.trim().toUpperCase()),
      clinicalSummary: input.clinicalSummary.trim(),
    },
  });

  if (!result.ok) {
    run(`UPDATE preauths SET decline_reason = ? WHERE id = ?`, `Not yet decided: ${result.error}`, preauthId);
    return;
  }

  const approved = result.data.approved === true;
  const reference = typeof result.data.reference === "string" ? result.data.reference : undefined;
  if (approved && !reference) return; // An approval without a reference is not usable.

  const validDays = typeof result.data.validUntilDays === "number" ? result.data.validUntilDays : 30;

  recordPreauthDecision({
    preauthId,
    approved,
    reference,
    validUntil: new Date(Date.now() + validDays * 86_400_000).toISOString().slice(0, 10),
    declineReason: approved ? undefined : String(result.data.reason ?? "declined by the payer"),
    byUserId: input.byUserId,
    byUserName: input.byUserName,
  });
}

export function recordPreauthDecision(input: {
  preauthId: string;
  approved: boolean;
  reference?: string;
  approvedAmountCents?: number;
  validUntil?: string;
  declineReason?: string;
  byUserId: number;
  byUserName: string;
}): void {
  const preauth = get<Preauth>(`SELECT * FROM preauths WHERE id = ?`, input.preauthId);
  if (!preauth) throw new PayerError("no such pre-authorisation");

  if (input.approved && !input.reference?.trim()) {
    throw new PayerError(
      "an approval must carry the payer's reference — a claim citing an approval without one is rejected",
    );
  }

  tx(() => {
    run(
      `UPDATE preauths SET status = ?, reference = ?, approved_amount_cents = ?, valid_until = ?,
         decline_reason = ?, decided_at = ? WHERE id = ?`,
      input.approved ? "approved" : "declined",
      input.reference?.trim() ?? null,
      input.approvedAmountCents ?? null,
      input.validUntil ?? null,
      input.approved ? null : (input.declineReason?.trim() ?? ""),
      now(),
      input.preauthId,
    );
    audit({
      action: input.approved ? "preauth_approved" : "preauth_declined",
      entity: "preauth",
      entityId: input.preauthId,
      patientId: preauth.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "claim",
      detail: { reference: input.reference ?? null, reason: input.declineReason ?? null },
    });
  });
}

export function preauthsFor(encounterId: string): Preauth[] {
  return all<Preauth>(`SELECT * FROM preauths WHERE encounter_id = ? ORDER BY created_at`, encounterId);
}
