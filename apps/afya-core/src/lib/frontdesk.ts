/**
 * M11 Consent and M14 Queue & Triage.
 *
 * CONSENT is granular and versioned. Consent to treatment is not consent to
 * share a record with an employer, and consent to wording that has since
 * changed is not consent to the new wording. Both facts are Data Protection Act
 * requirements and both are trivially got wrong by a single "agreed: yes" flag.
 *
 * THE QUEUE is ordered by clinical priority, not arrival. An emergency case that
 * waits behind eleven routine ones because the software sorts by check-in time
 * is a software-caused harm.
 *
 * VITALS ARE INTEGERS IN FIXED UNITS — tenths of a degree, grams, millimetres,
 * mmHg. Same reason money is cents: floats drift, and a drifting weight changes
 * a paediatric dose.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { recordOp } from "./sync.ts";
import { resolvePatient } from "./patients.ts";

export class FrontDeskError extends Error {}

// ------------------------------------------------------------------- consent

export type ConsentPurpose = "treatment" | "billing" | "claim" | "research" | "data_sharing";

export interface Consent {
  id: number;
  patient_mrn: string;
  purpose: ConsentPurpose;
  version: string;
  granted: number;
  given_by: string;
  recorded_by: number | null;
  recorded_at: string;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
}

/** The wording currently in force, per purpose. Bump when the text changes. */
export const CONSENT_VERSIONS: Record<ConsentPurpose, string> = {
  treatment: "treatment-v1",
  billing: "billing-v1",
  claim: "claim-v1",
  research: "research-v1",
  data_sharing: "data-sharing-v1",
};

export function recordConsent(input: {
  patientMrn: string;
  purpose: ConsentPurpose;
  granted: boolean;
  givenBy?: string;
  byUserId: number | null;
  byUserName: string;
}): number {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new FrontDeskError("no such patient");

  return tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO consents (patient_mrn, purpose, version, granted, given_by, recorded_by, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      patient.mrn,
      input.purpose,
      CONSENT_VERSIONS[input.purpose],
      input.granted ? 1 : 0,
      input.givenBy ?? "patient",
      input.byUserId,
      now(),
    );
    audit({
      action: input.granted ? "consent_given" : "consent_refused",
      entity: "consent",
      entityId: lastInsertRowid,
      patientId: patient.mrn,
      facilityId: patient.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { purpose: input.purpose, version: CONSENT_VERSIONS[input.purpose] },
    });
    return lastInsertRowid;
  });
}

/**
 * Does this patient currently consent to this purpose?
 *
 * False when never asked, when refused, when withdrawn, OR when the consent on
 * file is against superseded wording. That last case is the one systems miss.
 */
export function hasConsent(patientMrn: string, purpose: ConsentPurpose): boolean {
  const patient = resolvePatient(patientMrn);
  if (!patient) return false;
  const latest = get<Consent>(
    `SELECT * FROM consents WHERE patient_mrn = ? AND purpose = ? ORDER BY recorded_at DESC, id DESC LIMIT 1`,
    patient.mrn,
    purpose,
  );
  if (!latest) return false;
  if (!latest.granted) return false;
  if (latest.withdrawn_at) return false;
  return latest.version === CONSENT_VERSIONS[purpose];
}

export function withdrawConsent(input: {
  consentId: number;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const consent = get<Consent>(`SELECT * FROM consents WHERE id = ?`, input.consentId);
  if (!consent) throw new FrontDeskError("no such consent record");
  if (consent.withdrawn_at) throw new FrontDeskError("that consent has already been withdrawn");

  tx(() => {
    run(
      `UPDATE consents SET withdrawn_at = ?, withdrawn_reason = ? WHERE id = ?`,
      now(),
      input.reason.trim(),
      input.consentId,
    );
    audit({
      action: "consent_withdrawn",
      entity: "consent",
      entityId: input.consentId,
      patientId: consent.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { purpose: consent.purpose, reason: input.reason },
    });
  });
}

export function consentsFor(patientMrn: string): Consent[] {
  const patient = resolvePatient(patientMrn);
  if (!patient) return [];
  return all<Consent>(`SELECT * FROM consents WHERE patient_mrn = ? ORDER BY recorded_at DESC`, patient.mrn);
}

/** Purposes with no current consent — what the front desk still has to ask. */
export function missingConsents(patientMrn: string): ConsentPurpose[] {
  // Research and data sharing are opt-in and their absence is normal, so only
  // the purposes needed to treat and bill are reported as outstanding.
  return (["treatment", "billing", "claim"] as ConsentPurpose[]).filter((p) => !hasConsent(patientMrn, p));
}

// --------------------------------------------------------------------- queue

export type Priority = "emergency" | "urgent" | "routine";
export type VisitState = "waiting" | "in_triage" | "in_consultation" | "done" | "left";

export interface Visit {
  id: string;
  facility_id: number;
  patient_mrn: string;
  priority: Priority;
  state: VisitState;
  department: string;
  token: string;
  encounter_id: string | null;
  checked_in_at: string;
  triaged_at: string | null;
  seen_at: string | null;
  done_at: string | null;
  device_code: string | null;
}

const PRIORITY_ORDER: Record<Priority, number> = { emergency: 0, urgent: 1, routine: 2 };

export function checkIn(input: {
  facilityId: number;
  patientMrn: string;
  priority?: Priority;
  department?: string;
  deviceCode: string;
  byUserId: number | null;
  byUserName: string;
}): Visit {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new FrontDeskError("no such patient");

  const open = get<Visit>(
    `SELECT * FROM visits WHERE patient_mrn = ? AND state NOT IN ('done','left')`,
    patient.mrn,
  );
  if (open) throw new FrontDeskError(`this patient is already in the queue as ${open.token}`);

  const id = mintLocalId(input.deviceCode, 8);
  // A short token the patient is called by, device-prefixed so two disconnected
  // desks cannot issue the same one.
  const todayCount =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM visits WHERE facility_id = ? AND checked_in_at >= ?`,
      input.facilityId,
      now().slice(0, 10),
    )?.n ?? 0;
  const token = `${input.deviceCode}-${String(todayCount + 1).padStart(3, "0")}`;

  return tx(() => {
    run(
      `INSERT INTO visits (id, facility_id, patient_mrn, priority, state, department, token, checked_in_at, device_code)
       VALUES (?, ?, ?, ?, 'waiting', ?, ?, ?, ?)`,
      id,
      input.facilityId,
      patient.mrn,
      input.priority ?? "routine",
      input.department ?? "outpatient",
      token,
      now(),
      input.deviceCode,
    );

    recordOp({
      deviceCode: input.deviceCode,
      entity: "visit",
      entityId: id,
      dataClass: "demographic",
      payload: { patient_mrn: patient.mrn, state: "waiting", token },
      actorId: input.byUserId,
      actorName: input.byUserName,
    });

    audit({
      action: "patient_checked_in",
      entity: "visit",
      entityId: id,
      patientId: patient.mrn,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      // Named `queueToken`, not `token`: the audit guard rightly refuses a bare
      // "token" key, and a reader months from now must not have to guess whether
      // this is the number shouted across a waiting room or a session secret.
      detail: { queueToken: token, priority: input.priority ?? "routine" },
    });

    return get<Visit>(`SELECT * FROM visits WHERE id = ?`, id)!;
  });
}

/**
 * The queue, in the order people should actually be seen.
 *
 * Priority first, then waiting time. Sorting by arrival alone is how an
 * emergency case ends up behind eleven routine ones.
 */
export function queue(facilityId: number, department?: string): Visit[] {
  const rows = all<Visit>(
    department
      ? `SELECT * FROM visits WHERE facility_id = ? AND state IN ('waiting','in_triage','in_consultation') AND department = ?`
      : `SELECT * FROM visits WHERE facility_id = ? AND state IN ('waiting','in_triage','in_consultation')`,
    ...(department ? [facilityId, department] : [facilityId]),
  );
  return rows.sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      a.checked_in_at.localeCompare(b.checked_in_at),
  );
}

export function setPriority(input: {
  visitId: string;
  priority: Priority;
  byUserId: number | null;
  byUserName: string;
}): void {
  const visit = get<Visit>(`SELECT * FROM visits WHERE id = ?`, input.visitId);
  if (!visit) throw new FrontDeskError("no such visit");

  tx(() => {
    run(`UPDATE visits SET priority = ? WHERE id = ?`, input.priority, input.visitId);
    audit({
      action: "triage_priority_set",
      entity: "visit",
      entityId: input.visitId,
      patientId: visit.patient_mrn,
      facilityId: visit.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { from: visit.priority, to: input.priority },
    });
  });
}

export function advanceVisit(input: {
  visitId: string;
  state: VisitState;
  encounterId?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const visit = get<Visit>(`SELECT * FROM visits WHERE id = ?`, input.visitId);
  if (!visit) throw new FrontDeskError("no such visit");

  const stamp =
    input.state === "in_triage"
      ? "triaged_at"
      : input.state === "in_consultation"
        ? "seen_at"
        : input.state === "done" || input.state === "left"
          ? "done_at"
          : null;

  tx(() => {
    run(
      `UPDATE visits SET state = ?${stamp ? `, ${stamp} = ?` : ""}${input.encounterId ? `, encounter_id = ?` : ""} WHERE id = ?`,
      ...([input.state, ...(stamp ? [now()] : []), ...(input.encounterId ? [input.encounterId] : []), input.visitId] as (
        | string
        | number
      )[]),
    );
    audit({
      action: "visit_advanced",
      entity: "visit",
      entityId: input.visitId,
      patientId: visit.patient_mrn,
      facilityId: visit.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { from: visit.state, to: input.state },
    });
  });
}

// -------------------------------------------------------------------- vitals

export interface Vitals {
  id: number;
  visit_id: string;
  patient_mrn: string;
  temp_tenths_c: number | null;
  weight_grams: number | null;
  height_mm: number | null;
  systolic_mmhg: number | null;
  diastolic_mmhg: number | null;
  pulse_bpm: number | null;
  resp_rate: number | null;
  spo2_percent: number | null;
  recorded_by: number | null;
  recorded_at: string;
}

/**
 * Record triage observations.
 *
 * Ranges are checked because a transposed digit — 380 instead of 38.0 — is how
 * a typo becomes a clinical decision.
 */
export function recordVitals(input: {
  visitId: string;
  tempTenthsC?: number;
  weightGrams?: number;
  heightMm?: number;
  systolicMmhg?: number;
  diastolicMmhg?: number;
  pulseBpm?: number;
  respRate?: number;
  spo2Percent?: number;
  byUserId: number | null;
  byUserName: string;
}): number {
  const visit = get<Visit>(`SELECT * FROM visits WHERE id = ?`, input.visitId);
  if (!visit) throw new FrontDeskError("no such visit");

  const ranges: [string, number | undefined, number, number][] = [
    ["temperature", input.tempTenthsC, 250, 450],
    ["weight", input.weightGrams, 300, 400_000],
    ["height", input.heightMm, 200, 2_500],
    ["systolic", input.systolicMmhg, 40, 300],
    ["diastolic", input.diastolicMmhg, 20, 200],
    ["pulse", input.pulseBpm, 20, 250],
    ["respiratory rate", input.respRate, 4, 90],
    ["oxygen saturation", input.spo2Percent, 40, 100],
  ];
  for (const [label, value, min, max] of ranges) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new FrontDeskError(`${label} of ${value} is outside a plausible range — check for a transposed digit`);
    }
  }
  if (
    input.systolicMmhg !== undefined &&
    input.diastolicMmhg !== undefined &&
    input.diastolicMmhg >= input.systolicMmhg
  ) {
    throw new FrontDeskError("diastolic pressure cannot be at or above systolic — the readings look swapped");
  }

  return tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO vitals
         (visit_id, patient_mrn, temp_tenths_c, weight_grams, height_mm, systolic_mmhg,
          diastolic_mmhg, pulse_bpm, resp_rate, spo2_percent, recorded_by, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.visitId,
      visit.patient_mrn,
      input.tempTenthsC ?? null,
      input.weightGrams ?? null,
      input.heightMm ?? null,
      input.systolicMmhg ?? null,
      input.diastolicMmhg ?? null,
      input.pulseBpm ?? null,
      input.respRate ?? null,
      input.spo2Percent ?? null,
      input.byUserId,
      now(),
    );
    audit({
      action: "vitals_recorded",
      entity: "visit",
      entityId: input.visitId,
      patientId: visit.patient_mrn,
      facilityId: visit.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { visit: input.visitId },
    });
    return lastInsertRowid;
  });
}

export function vitalsFor(visitId: string): Vitals[] {
  return all<Vitals>(`SELECT * FROM vitals WHERE visit_id = ? ORDER BY recorded_at DESC`, visitId);
}

/** Display helpers — presentation only, never arithmetic. */
export const show = {
  temp: (tenths: number | null) => (tenths === null ? "—" : `${(tenths / 10).toFixed(1)} °C`),
  weight: (grams: number | null) => (grams === null ? "—" : `${(grams / 1000).toFixed(1)} kg`),
  height: (mm: number | null) => (mm === null ? "—" : `${(mm / 10).toFixed(0)} cm`),
  bp: (s: number | null, d: number | null) => (s === null || d === null ? "—" : `${s}/${d} mmHg`),
};
