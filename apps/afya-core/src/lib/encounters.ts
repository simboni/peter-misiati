/**
 * M20 Encounter & Clinical Record.
 *
 * The consultation itself, and the three rules that make it claimable later.
 *
 *  1. THE LICENCE IS PINNED AT THE MOMENT CARE IS GIVEN.
 *     A claim cites the practitioner's council registration as it stood on the
 *     day of service. If the clinician renews next month, or lets it lapse, the
 *     claim must still show what was true then. So the licence is copied onto
 *     the encounter when it opens and never resolved by joining to the current
 *     one. This is also what makes a claim defensible in an audit years later.
 *
 *  2. NOTHING CLINICAL IS OVERWRITTEN.
 *     A correction writes a new version and marks the previous one superseded.
 *     Both stay. This is the rule the whole record depends on: it is what lets a
 *     facility answer "what did you actually write at 14:20?" and what stops a
 *     dispute becoming one person's word against a mutable database.
 *
 *  3. AN ENCOUNTER CANNOT CLOSE WITHOUT A CODED PRIMARY DIAGNOSIS.
 *     A claim without one is rejected. Enforcing it here — where the clinician
 *     is still with the patient and knows the answer — is the whole design
 *     principle: validate the claim before it is created, not on day six when
 *     the billing clerk is guessing from a handwritten note.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { recordOp } from "./sync.ts";
import { check, explain, licenceStatus } from "./access.ts";
import { resolvePatient } from "./patients.ts";
import { assertCodable, noteUse, ICD11 } from "./terminology.ts";

export class EncounterError extends Error {}

export type EncounterKind = "outpatient" | "inpatient" | "emergency" | "anc" | "followup";

export interface Encounter {
  id: string;
  facility_id: number;
  patient_mrn: string;
  kind: EncounterKind;
  status: "open" | "closed" | "cancelled";
  clinician_id: number | null;
  clinician_name: string;
  cadre_code: string | null;
  licence_regulator: string | null;
  licence_number: string | null;
  licence_expires_on: string | null;
  device_code: string | null;
  opened_at: string;
  closed_at: string | null;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: number;
  encounter_id: string;
  version: number;
  complaint: string;
  history: string;
  examination: string;
  assessment: string;
  plan: string;
  author_id: number | null;
  author_name: string;
  written_at: string;
  superseded_at: string | null;
}

export interface Diagnosis {
  id: number;
  encounter_id: string;
  system: string;
  code: string;
  term: string;
  rank: number;
  certainty: "confirmed" | "suspected";
  added_by: number | null;
  added_at: string;
  removed_at: string | null;
  removed_by: number | null;
}

// --------------------------------------------------------------- opening

export function openEncounter(input: {
  facilityId: number;
  patientMrn: string;
  kind: EncounterKind;
  clinicianId: number;
  clinicianName: string;
  deviceCode: string;
}): string {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new EncounterError("no such patient");
  if (patient.deceased) {
    throw new EncounterError(`${patient.given_name} ${patient.family_name} is recorded as deceased`);
  }

  // Licence-gated: an expired council registration stops the consultation here,
  // where it can still be fixed, rather than invalidating the claim silently.
  const decision = check(input.clinicianId, "encounter.conduct");
  if (!decision.allowed) throw new EncounterError(explain(decision));

  const existing = get<{ id: string }>(
    `SELECT id FROM encounters WHERE patient_mrn = ? AND status = 'open'`,
    patient.mrn,
  );
  if (existing) {
    throw new EncounterError(
      `this patient already has an open encounter (${existing.id}). Continue it rather than starting a second.`,
    );
  }

  // Rule 1: pin the licence as it stands right now.
  const licence = licenceStatus(input.clinicianId);
  const cadre = get<{ cadre_code: string | null }>(
    `SELECT cadre_code FROM users WHERE id = ?`,
    input.clinicianId,
  );

  const id = mintLocalId(input.deviceCode, 8);
  const at = now();

  return tx(() => {
    run(
      `INSERT INTO encounters
         (id, facility_id, patient_mrn, kind, status, clinician_id, clinician_name, cadre_code,
          licence_regulator, licence_number, licence_expires_on, device_code,
          opened_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.facilityId,
      patient.mrn,
      input.kind,
      input.clinicianId,
      input.clinicianName,
      cadre?.cadre_code ?? null,
      licence.state === "current" ? licence.regulator : null,
      licence.state === "current" ? (licence.number ?? null) : null,
      licence.state === "current" ? (licence.expiresOn ?? null) : null,
      input.deviceCode,
      at,
      at,
      at,
    );

    recordOp({
      deviceCode: input.deviceCode,
      entity: "encounter",
      entityId: id,
      dataClass: "clinical",
      payload: { patient_mrn: patient.mrn, kind: input.kind, status: "open", opened_at: at },
      actorId: input.clinicianId,
      actorName: input.clinicianName,
    });

    audit({
      action: "encounter_opened",
      entity: "encounter",
      entityId: id,
      patientId: patient.mrn,
      facilityId: input.facilityId,
      actorId: input.clinicianId,
      actorName: input.clinicianName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { kind: input.kind, licence: licence.number ?? null },
    });

    return id;
  });
}

export function getEncounter(id: string): Encounter | undefined {
  return get<Encounter>(`SELECT * FROM encounters WHERE id = ?`, id);
}

export function openEncounterFor(patientMrn: string): Encounter | undefined {
  const patient = resolvePatient(patientMrn);
  if (!patient) return undefined;
  return get<Encounter>(`SELECT * FROM encounters WHERE patient_mrn = ? AND status = 'open'`, patient.mrn);
}

export function encountersFor(patientMrn: string, limit = 50): Encounter[] {
  const patient = resolvePatient(patientMrn);
  if (!patient) return [];
  return all<Encounter>(
    `SELECT * FROM encounters WHERE patient_mrn = ? ORDER BY opened_at DESC LIMIT ?`,
    patient.mrn,
    limit,
  );
}

// ------------------------------------------------------------------ the note

/**
 * Write the consultation note.
 *
 * Rule 2: every write is a new version. The previous one is marked superseded
 * and kept, so the record shows what was written and when it changed — not just
 * where it ended up.
 */
export function writeNote(input: {
  encounterId: string;
  complaint?: string;
  history?: string;
  examination?: string;
  assessment?: string;
  plan?: string;
  authorId: number;
  authorName: string;
  deviceCode: string;
}): number {
  const encounter = requireOpen(input.encounterId);

  const decision = check(input.authorId, "encounter.conduct");
  if (!decision.allowed) throw new EncounterError(explain(decision));

  const current = currentNote(input.encounterId);
  const next = {
    complaint: input.complaint ?? current?.complaint ?? "",
    history: input.history ?? current?.history ?? "",
    examination: input.examination ?? current?.examination ?? "",
    assessment: input.assessment ?? current?.assessment ?? "",
    plan: input.plan ?? current?.plan ?? "",
  };

  const unchanged =
    current &&
    current.complaint === next.complaint &&
    current.history === next.history &&
    current.examination === next.examination &&
    current.assessment === next.assessment &&
    current.plan === next.plan;

  // A no-op save must not create a version. Otherwise the history fills with
  // identical entries and the one real correction becomes impossible to find.
  if (unchanged) return current!.version;

  const version = (current?.version ?? 0) + 1;
  const at = now();

  return tx(() => {
    if (current) {
      run(`UPDATE encounter_notes SET superseded_at = ? WHERE id = ?`, at, current.id);
    }

    run(
      `INSERT INTO encounter_notes
         (encounter_id, version, complaint, history, examination, assessment, plan,
          author_id, author_name, written_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.encounterId,
      version,
      next.complaint,
      next.history,
      next.examination,
      next.assessment,
      next.plan,
      input.authorId,
      input.authorName,
      at,
    );

    run(`UPDATE encounters SET updated_at = ? WHERE id = ?`, at, input.encounterId);

    recordOp({
      deviceCode: input.deviceCode,
      entity: "encounter",
      entityId: input.encounterId,
      dataClass: "clinical",
      payload: { note_version: version, ...next },
      actorId: input.authorId,
      actorName: input.authorName,
    });

    audit({
      action: version === 1 ? "encounter_note_written" : "encounter_note_amended",
      entity: "encounter",
      entityId: input.encounterId,
      patientId: encounter.patient_mrn,
      facilityId: encounter.facility_id,
      actorId: input.authorId,
      actorName: input.authorName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { version },
    });

    return version;
  });
}

export function currentNote(encounterId: string): Note | undefined {
  return get<Note>(
    `SELECT * FROM encounter_notes WHERE encounter_id = ? AND superseded_at IS NULL`,
    encounterId,
  );
}

/** Every version, newest first. The answer to "what did you write at 14:20?" */
export function noteHistory(encounterId: string): Note[] {
  return all<Note>(
    `SELECT * FROM encounter_notes WHERE encounter_id = ? ORDER BY version DESC`,
    encounterId,
  );
}

// ----------------------------------------------------------------- diagnoses

export function addDiagnosis(input: {
  encounterId: string;
  code: string;
  system?: string;
  rank?: number;
  certainty?: "confirmed" | "suspected";
  byUserId: number;
  byUserName: string;
  deviceCode: string;
}): number {
  const encounter = requireOpen(input.encounterId);
  const system = input.system ?? ICD11;

  const decision = check(input.byUserId, "diagnosis.code");
  if (!decision.allowed) throw new EncounterError(explain(decision));

  // Stopped here, where the clinician can still fix it.
  const concept = assertCodable(input.code, system);

  const existing = get<{ id: number }>(
    `SELECT id FROM encounter_diagnoses
      WHERE encounter_id = ? AND system = ? AND code = ? AND removed_at IS NULL`,
    input.encounterId,
    system,
    concept.code,
  );
  if (existing) throw new EncounterError(`${concept.code} is already on this encounter`);

  const rank = input.rank ?? (activeDiagnoses(input.encounterId).length === 0 ? 1 : 2);

  if (rank === 1) {
    const primary = get<{ id: number }>(
      `SELECT id FROM encounter_diagnoses WHERE encounter_id = ? AND rank = 1 AND removed_at IS NULL`,
      input.encounterId,
    );
    if (primary) {
      throw new EncounterError(
        "this encounter already has a primary diagnosis. A claim carries exactly one — add this as additional, or remove the primary first.",
      );
    }
  }

  const at = now();

  return tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO encounter_diagnoses
         (encounter_id, system, code, term, rank, certainty, added_by, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      input.encounterId,
      system,
      concept.code,
      // Pinned: catalogues get re-released, and the claim must keep showing what
      // the clinician actually picked.
      concept.term,
      rank,
      input.certainty ?? "confirmed",
      input.byUserId,
      at,
    );

    noteUse(input.byUserId, concept.code, system);

    recordOp({
      deviceCode: input.deviceCode,
      entity: "encounter",
      entityId: input.encounterId,
      dataClass: "clinical",
      payload: { diagnosis_added: concept.code, term: concept.term, rank },
      actorId: input.byUserId,
      actorName: input.byUserName,
    });

    audit({
      action: "diagnosis_added",
      entity: "encounter",
      entityId: input.encounterId,
      patientId: encounter.patient_mrn,
      facilityId: encounter.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { code: concept.code, term: concept.term, rank, certainty: input.certainty ?? "confirmed" },
    });

    return lastInsertRowid;
  });
}

/** Remove a diagnosis. Marked, never deleted — it was clinical reasoning. */
export function removeDiagnosis(input: {
  diagnosisId: number;
  byUserId: number;
  byUserName: string;
  reason: string;
}): void {
  const dx = get<Diagnosis>(`SELECT * FROM encounter_diagnoses WHERE id = ?`, input.diagnosisId);
  if (!dx) throw new EncounterError("no such diagnosis");
  if (dx.removed_at) throw new EncounterError("that diagnosis has already been removed");

  const encounter = requireOpen(dx.encounter_id);

  tx(() => {
    run(
      `UPDATE encounter_diagnoses SET removed_at = ?, removed_by = ? WHERE id = ?`,
      now(),
      input.byUserId,
      input.diagnosisId,
    );
    audit({
      action: "diagnosis_removed",
      entity: "encounter",
      entityId: dx.encounter_id,
      patientId: encounter.patient_mrn,
      facilityId: encounter.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { code: dx.code, term: dx.term, reason: input.reason },
    });
  });
}

export function activeDiagnoses(encounterId: string): Diagnosis[] {
  return all<Diagnosis>(
    `SELECT * FROM encounter_diagnoses WHERE encounter_id = ? AND removed_at IS NULL ORDER BY rank, added_at`,
    encounterId,
  );
}

// ------------------------------------------------------------------- closing

/** What still stands between this encounter and a submittable claim. */
export interface Readiness {
  ready: boolean;
  blockers: string[];
}

/**
 * The claim scrubber's rules, applied at the point of care.
 *
 * Deliberately the same shape the scrubber (M55) will use, so a clinician never
 * meets a requirement for the first time at the billing desk on day six.
 */
export function readiness(encounterId: string): Readiness {
  const encounter = getEncounter(encounterId);
  if (!encounter) return { ready: false, blockers: ["no such encounter"] };

  const blockers: string[] = [];

  const note = currentNote(encounterId);
  if (!note || !note.assessment.trim()) {
    blockers.push("No assessment recorded. A claim needs clinical justification for what was done.");
  }

  const diagnoses = activeDiagnoses(encounterId);
  const primary = diagnoses.find((d) => d.rank === 1);
  if (!primary) {
    blockers.push("No primary diagnosis coded. A claim without one is rejected.");
  }

  if (!encounter.licence_number) {
    blockers.push(
      "No current practitioner licence was on file when this encounter opened. A claim citing it will be rejected.",
    );
  }

  return { ready: blockers.length === 0, blockers };
}

export function closeEncounter(input: {
  encounterId: string;
  byUserId: number;
  byUserName: string;
  deviceCode: string;
}): void {
  const encounter = requireOpen(input.encounterId);

  const state = readiness(input.encounterId);
  if (!state.ready) {
    // Rule 3. The clinician is still with the patient; this is the cheapest
    // moment in the whole revenue cycle to fix it.
    throw new EncounterError(state.blockers.join(" "));
  }

  const at = now();

  tx(() => {
    run(`UPDATE encounters SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?`, at, at, input.encounterId);

    recordOp({
      deviceCode: input.deviceCode,
      entity: "encounter",
      entityId: input.encounterId,
      dataClass: "clinical",
      payload: { status: "closed", closed_at: at },
      actorId: input.byUserId,
      actorName: input.byUserName,
    });

    audit({
      action: "encounter_closed",
      entity: "encounter",
      entityId: input.encounterId,
      patientId: encounter.patient_mrn,
      facilityId: encounter.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { diagnoses: activeDiagnoses(input.encounterId).map((d) => d.code) },
    });
  });
}

export function cancelEncounter(input: {
  encounterId: string;
  reason: string;
  byUserId: number;
  byUserName: string;
}): void {
  const encounter = requireOpen(input.encounterId);
  if (!input.reason.trim()) throw new EncounterError("cancelling an encounter must record why");

  tx(() => {
    run(
      `UPDATE encounters SET status = 'cancelled', cancelled_reason = ?, updated_at = ? WHERE id = ?`,
      input.reason.trim(),
      now(),
      input.encounterId,
    );
    audit({
      action: "encounter_cancelled",
      entity: "encounter",
      entityId: input.encounterId,
      patientId: encounter.patient_mrn,
      facilityId: encounter.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { reason: input.reason },
    });
  });
}

function requireOpen(encounterId: string): Encounter {
  const encounter = getEncounter(encounterId);
  if (!encounter) throw new EncounterError("no such encounter");
  if (encounter.status === "closed") {
    throw new EncounterError(
      "this encounter is closed. Reopening a signed record is not possible — start a follow-up encounter instead.",
    );
  }
  if (encounter.status === "cancelled") throw new EncounterError("this encounter was cancelled");
  return encounter;
}
