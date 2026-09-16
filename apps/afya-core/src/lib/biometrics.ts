/**
 * M12 Biometric Verification.
 *
 * SHA verifies members biometrically at the point of service, and counties are
 * deploying readers, so a facility that cannot do it will be turning patients
 * away or eating rejected claims. That is the reason this module exists. It is
 * not the reason it is built the way it is.
 *
 *  A FAILED MATCH NEVER DENIES CARE. `verify` returns a result and a fallback
 *  route; it does not throw, and nothing downstream refuses on it. A worn
 *  thumb, a wet finger, a bad enrolment and a cheap reader all produce the
 *  same non-match, and none of them is a reason to send a sick person home.
 *
 *  NOT EVERYONE HAS A USABLE FINGERPRINT. Infants, masons and farmers with
 *  ridges worn flat, amputees, people with leprosy. A system that requires one
 *  denies care to exactly the people least able to argue with it, so an
 *  exception is a first-class record with a reason, not an empty column.
 *
 *  ENROLMENT WITHOUT CONSENT IS REFUSED, and refusal is a normal answer.
 *  Biometric data is a special category under the Data Protection Act 2019:
 *  consent to be treated is not consent to be fingerprinted. A patient who says
 *  no is recorded as an exception and treated exactly the same.
 *
 *  NO IMAGE IS EVER STORED. What is kept is an opaque reference to a template
 *  the reader produced. A fingerprint image in a hospital database is a breach
 *  nobody can remediate — a person cannot be issued with a new thumb.
 *
 *  MATCHING HAPPENS ON THE READER. This module records the score the device
 *  returned and the threshold it was set to. It does not implement matching,
 *  and it never will: a score here is evidence of what a device said.
 *
 *  A READER IN DEMO MODE NEVER PRETENDS. Every verification it produces is
 *  marked `demo`, says so on the screen, and `citableFor` refuses it as claim
 *  evidence. The same rule the integration hub works to, for the same reason:
 *  the moment a demonstration is indistinguishable from the real thing,
 *  somebody bills on it.
 *
 * ⚠️ Liveness detection is not modelled at all. A photograph of a finger, a
 * gelatine cast and a real thumb are the same thing to this module, because
 * whether they are the same thing to the reader is the reader's business and a
 * procurement question. The review register says so.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { createHash } from "node:crypto";
import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { resolvePatient } from "./patients.ts";
import { hasConsent } from "./frontdesk.ts";
import { number as configNumber } from "./configuration.ts";

export class BiometricError extends Error {}

export type Finger =
  | "right_thumb" | "right_index" | "right_middle" | "right_ring" | "right_little"
  | "left_thumb" | "left_index" | "left_middle" | "left_ring" | "left_little";

export type ExceptionReason =
  | "infant" | "worn_ridges" | "amputation" | "disease" | "refused" | "no_reader" | "other";

export type ReaderMode = "demo" | "live";

export const FINGERS: Finger[] = [
  "right_thumb", "right_index", "right_middle", "right_ring", "right_little",
  "left_thumb", "left_index", "left_middle", "left_ring", "left_little",
];

/**
 * ⚠️ The age below which a fingerprint is not expected to be usable.
 *
 * Infant ridge detail is too fine for the readers a Level 2 facility buys.
 * Five is a working convention and not a standard; a facility using infant
 * biometrics has different hardware and should set this itself.
 */
export const MIN_AGE_YEARS_DEFAULT = 5;

/** The age floor in force. */
export function minAgeYears(): number {
  return configNumber("biometrics.min_age_years");
}

/**
 * ⚠️ The quality below which an enrolment is a future problem.
 *
 * A poor capture enrolled is a patient who fails verification at every visit
 * afterwards and is told each time that they are not who they say they are.
 * Enrolment is allowed and warns, because a bad template is better than none
 * for a patient about to walk out of the door.
 */
export const MIN_QUALITY_DEFAULT = 40;

/** The quality floor in force. */
export function minQuality(): number {
  return configNumber("biometrics.min_quality");
}

export interface Reader {
  code: string;
  facility_id: number;
  label: string;
  make: string;
  model: string;
  template_format: string;
  algorithm: string;
  threshold: number;
  mode: ReaderMode;
  active: number;
}

export interface Enrolment {
  id: string;
  patient_mrn: string;
  finger: Finger;
  template_ref: string;
  template_format: string;
  algorithm: string;
  quality: number | null;
  reader_code: string | null;
  demo: number;
  status: "active" | "superseded" | "withdrawn";
  withdrawn_at: string | null;
  withdrawn_reason: string;
  captured_at: string;
  capturer_name: string;
}

// ------------------------------------------------------------------ readers

export function registerReader(input: {
  facilityId: number;
  code: string;
  label: string;
  make?: string;
  model?: string;
  templateFormat?: string;
  algorithm?: string;
  threshold?: number;
  mode?: ReaderMode;
  byUserId?: number | null;
  byUserName?: string;
}): void {
  const threshold = input.threshold ?? 40;
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
    throw new BiometricError("a match threshold is a whole number from 0 to 100");
  }
  const code = input.code.trim().toUpperCase();

  run(
    `INSERT INTO biometric_readers
       (code, facility_id, label, make, model, template_format, algorithm, threshold, mode, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(code) DO UPDATE SET
       label = excluded.label, make = excluded.make, model = excluded.model,
       template_format = excluded.template_format, algorithm = excluded.algorithm,
       threshold = excluded.threshold, mode = excluded.mode`,
    code,
    input.facilityId,
    input.label.trim(),
    input.make?.trim() ?? "",
    input.model?.trim() ?? "",
    input.templateFormat?.trim() ?? "",
    input.algorithm?.trim() ?? "",
    threshold,
    input.mode ?? "demo",
    now(),
  );

  audit({
    action: "biometric_reader_registered",
    entity: "biometric_reader",
    entityId: code,
    facilityId: input.facilityId,
    actorId: input.byUserId ?? null,
    actorName: input.byUserName ?? "system",
    purpose: "administration",
    detail: { label: input.label, mode: input.mode ?? "demo", threshold },
  });
}

export function getReader(code: string): Reader | undefined {
  return get<Reader>(`SELECT * FROM biometric_readers WHERE code = ?`, code.trim().toUpperCase());
}

export function listReaders(facilityId: number): Reader[] {
  return all<Reader>(
    `SELECT * FROM biometric_readers WHERE facility_id = ? AND active = 1 ORDER BY code`,
    facilityId,
  );
}

/**
 * Switch a reader to live.
 *
 * Refused unless it can say what format its templates are in and what algorithm
 * matches them. A live reader whose format nobody wrote down is a facility that
 * cannot change vendor without re-enrolling every patient, and that is found
 * out at the worst possible moment.
 */
export function goLive(input: {
  code: string;
  templateFormat: string;
  algorithm: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const reader = getReader(input.code);
  if (!reader) throw new BiometricError("no such reader");
  if (!input.templateFormat.trim() || !input.algorithm.trim()) {
    throw new BiometricError(
      "a live reader must record its template format and matching algorithm — a facility that cannot say them cannot change vendor without re-enrolling everybody",
    );
  }

  run(
    `UPDATE biometric_readers SET mode = 'live', template_format = ?, algorithm = ? WHERE code = ?`,
    input.templateFormat.trim(),
    input.algorithm.trim(),
    reader.code,
  );
  audit({
    action: "biometric_reader_live",
    entity: "biometric_reader",
    entityId: reader.code,
    facilityId: reader.facility_id,
    actorId: input.byUserId,
    actorName: input.byUserName,
    purpose: "administration",
    detail: { templateFormat: input.templateFormat, algorithm: input.algorithm },
  });
}

// -------------------------------------------------------------- eligibility

export interface Eligibility {
  /** Whether a fingerprint is worth attempting at all. */
  attempt: boolean;
  reasons: string[];
  /** An exception already on file, if there is one. */
  exception?: { reason: ExceptionReason; note: string };
}

/**
 * Whether to try a fingerprint on this patient.
 *
 * Advisory, always. Nothing here refuses anything — it tells a clerk what to
 * expect so that a two-year-old is not held over a scanner for five minutes in
 * front of their mother.
 */
export function eligibility(patientMrn: string, asOf = today()): Eligibility {
  const patient = resolvePatient(patientMrn);
  if (!patient) throw new BiometricError("no such patient");

  const reasons: string[] = [];
  const exception = activeException(patient.mrn);

  if (patient.date_of_birth) {
    const years = Math.floor(
      (Date.parse(`${asOf}T00:00:00.000Z`) - Date.parse(`${patient.date_of_birth}T00:00:00.000Z`)) /
        (365.25 * 86_400_000),
    );
    if (years < minAgeYears()) {
      reasons.push(`${years < 1 ? "an infant" : `${years} years old`} — ridge detail is too fine for these readers`);
    }
  }

  if (exception) reasons.push(exceptionText(exception.reason, exception.note));

  return {
    attempt: reasons.length === 0,
    reasons,
    exception: exception ? { reason: exception.reason, note: exception.note } : undefined,
  };
}

function exceptionText(reason: ExceptionReason, note: string): string {
  const said: Record<ExceptionReason, string> = {
    infant: "too young for a usable print",
    worn_ridges: "ridges worn flat — manual work",
    amputation: "amputation",
    disease: "a condition affecting the fingertips",
    refused: "the patient declined, which is their right",
    no_reader: "no reader available at this facility",
    other: "an exception is on file",
  };
  return note ? `${said[reason]} — ${note}` : said[reason];
}

export function activeException(patientMrn: string) {
  return get<{ id: number; reason: ExceptionReason; note: string; recorder_name: string; recorded_at: string }>(
    `SELECT * FROM biometric_exceptions WHERE patient_mrn = ? AND active = 1 ORDER BY id DESC LIMIT 1`,
    patientMrn,
  );
}

/**
 * Record why this patient has no fingerprint on file.
 *
 * Including "they said no", which is a complete answer and needs no further
 * justification from anybody.
 */
export function recordException(input: {
  patientMrn: string;
  reason: ExceptionReason;
  note?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new BiometricError("no such patient");
  if (input.reason === "other" && !input.note?.trim()) {
    throw new BiometricError("'other' must say what it is, or it says nothing");
  }

  tx(() => {
    run(`UPDATE biometric_exceptions SET active = 0 WHERE patient_mrn = ? AND active = 1`, patient.mrn);
    run(
      `INSERT INTO biometric_exceptions
         (patient_mrn, reason, note, active, recorded_at, recorded_by, recorder_name, created_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
      patient.mrn,
      input.reason,
      input.note?.trim() ?? "",
      now(),
      input.byUserId,
      input.byUserName,
      now(),
    );
    audit({
      action: "biometric_exception",
      entity: "patient",
      entityId: patient.mrn,
      patientId: patient.mrn,
      facilityId: patient.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { reason: input.reason, note: input.note ?? null },
    });
  });
}

// ---------------------------------------------------------------- enrolment

/**
 * A capture, as the reader hands it over.
 *
 * `template` is whatever opaque string the driver produced. It is hashed on the
 * way in and the original is never written anywhere.
 */
export interface Capture {
  template: string;
  quality?: number;
}

/** What is stored: a digest, not the template, and certainly not an image. */
function templateRef(template: string): string {
  return createHash("sha256").update(template).digest("hex");
}

/**
 * Simulate a capture on a reader in demo mode.
 *
 * Deterministic on the patient and the finger, so a demonstration can show a
 * match and a non-match on purpose. THIS IS AN EQUALITY CHECK ON A STRING AND
 * NOT BIOMETRICS, which is exactly why everything it touches is marked `demo`
 * and refused as evidence.
 */
export function simulateCapture(patientMrn: string, finger: Finger, correct = true): Capture {
  return {
    template: `demo:${patientMrn}:${finger}:${correct ? "self" : "somebody-else"}`,
    quality: correct ? 78 : 71,
  };
}

export function enrol(input: {
  patientMrn: string;
  finger: Finger;
  capture: Capture;
  readerCode: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): { enrolmentId: string; quality: number | null; poorQuality: boolean } {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new BiometricError("no such patient");

  const reader = getReader(input.readerCode);
  if (!reader) throw new BiometricError("no such reader");
  if (!input.capture.template.trim()) throw new BiometricError("that capture is empty");

  // The Data Protection Act treats this as a special category. Consent to be
  // treated is not consent to be fingerprinted, and there is no override.
  if (!hasConsent(patient.mrn, "biometric")) {
    throw new BiometricError(
      "this patient has not consented to biometric enrolment. Record the consent, or record an exception — either is a complete answer.",
    );
  }

  const quality = input.capture.quality ?? null;
  const poorQuality = quality !== null && quality < minQuality();
  const id = mintLocalId(input.deviceCode, 8);
  const at = now();

  return tx(() => {
    // A re-capture supersedes. There is never a question of which template is
    // the current one for a finger.
    run(
      `UPDATE biometric_enrolments SET status = 'superseded' WHERE patient_mrn = ? AND finger = ? AND status = 'active'`,
      patient.mrn,
      input.finger,
    );
    run(
      `INSERT INTO biometric_enrolments
         (id, patient_mrn, finger, template_ref, template_format, algorithm, quality, reader_code,
          demo, status, captured_at, captured_by, capturer_name, device_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      id,
      patient.mrn,
      input.finger,
      templateRef(input.capture.template),
      reader.template_format,
      reader.algorithm,
      quality,
      reader.code,
      reader.mode === "demo" ? 1 : 0,
      at,
      input.byUserId,
      input.byUserName,
      input.deviceCode,
      now(),
    );

    // An exception and an enrolment cannot both be true.
    run(`UPDATE biometric_exceptions SET active = 0 WHERE patient_mrn = ? AND active = 1`, patient.mrn);

    audit({
      action: "biometric_enrolled",
      entity: "patient",
      entityId: patient.mrn,
      patientId: patient.mrn,
      facilityId: patient.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      // The template reference is deliberately NOT here. The audit log is the
      // artefact most likely to be exported and emailed.
      detail: { finger: input.finger, quality, reader: reader.code, demo: reader.mode === "demo", poorQuality },
    });

    return { enrolmentId: id, quality, poorQuality };
  });
}

export function enrolmentsFor(patientMrn: string, includeInactive = false): Enrolment[] {
  return all<Enrolment>(
    `SELECT * FROM biometric_enrolments WHERE patient_mrn = ? ${includeInactive ? "" : "AND status = 'active'"}
      ORDER BY captured_at DESC`,
    patientMrn,
  );
}

/**
 * Withdraw an enrolment.
 *
 * The Data Protection Act gives a right to withdraw consent, and a withdrawal
 * that leaves the template in place is not a withdrawal. The reference is
 * cleared, not just flagged.
 */
export function withdrawEnrolment(input: {
  enrolmentId: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const enrolment = get<Enrolment>(`SELECT * FROM biometric_enrolments WHERE id = ?`, input.enrolmentId);
  if (!enrolment) throw new BiometricError("no such enrolment");
  if (!input.reason.trim()) throw new BiometricError("withdrawing an enrolment records why");

  const patient = resolvePatient(enrolment.patient_mrn);

  tx(() => {
    run(
      `UPDATE biometric_enrolments
          SET status = 'withdrawn', withdrawn_at = ?, withdrawn_reason = ?, template_ref = ''
        WHERE id = ?`,
      now(),
      input.reason.trim(),
      enrolment.id,
    );
    audit({
      action: "biometric_withdrawn",
      entity: "patient",
      entityId: enrolment.patient_mrn,
      patientId: enrolment.patient_mrn,
      facilityId: patient?.facility_id ?? null,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { finger: enrolment.finger, reason: input.reason, templateErased: true },
    });
  });
}

// -------------------------------------------------------------- verification

export interface Verification {
  matched: boolean;
  score: number | null;
  threshold: number | null;
  finger: Finger | null;
  /** True when the reader had no hardware behind it. Never evidence of anything. */
  demo: boolean;
  /** What to do next, in the words a clerk would use. */
  next: string;
  verificationId: number;
}

/**
 * Verify a patient against what is on file.
 *
 * NEVER THROWS ON A NON-MATCH. It returns a result and what to do next. A worn
 * thumb, a wet finger, a bad enrolment and a cheap reader all produce the same
 * non-match, and none of them is a reason to send a sick person home.
 */
export function verify(input: {
  patientMrn: string;
  capture: Capture;
  readerCode: string;
  purpose: string;
  finger?: Finger;
  byUserId: number | null;
  byUserName: string;
  deviceCode?: string;
}): Verification {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new BiometricError("no such patient");
  const reader = getReader(input.readerCode);
  if (!reader) throw new BiometricError("no such reader");

  const enrolments = enrolmentsFor(patient.mrn).filter((e) => !input.finger || e.finger === input.finger);
  const ref = templateRef(input.capture.template);

  // The comparison is an equality of references, because matching is the
  // reader's job and this module does not pretend to do it. On live hardware
  // the driver returns the score and this records it.
  const hit = enrolments.find((e) => e.template_ref && e.template_ref === ref);
  const matched = Boolean(hit);
  const score = matched ? input.capture.quality ?? reader.threshold : 0;

  const at = now();
  const next = matched
    ? reader.mode === "demo"
      ? "matched on a reader in demo mode — this is a demonstration and cannot be cited as evidence"
      : "identity verified"
    : enrolments.length === 0
      ? "nothing is enrolled for this patient — verify from documents and enrol if they consent"
      : "no match — verify from documents, and re-capture the finger before they leave";

  const id = tx(() => {
    run(
      `INSERT INTO biometric_verifications
         (patient_mrn, purpose, enrolment_id, finger, reader_code, matched, score, threshold,
          demo, attempted_at, attempted_by, attempter_name, device_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      patient.mrn,
      input.purpose,
      hit?.id ?? null,
      hit?.finger ?? input.finger ?? "",
      reader.code,
      matched ? 1 : 0,
      score,
      reader.threshold,
      reader.mode === "demo" ? 1 : 0,
      at,
      input.byUserId,
      input.byUserName,
      input.deviceCode ?? null,
      now(),
    );
    const row = get<{ id: number }>(`SELECT last_insert_rowid() AS id`)!;

    audit({
      action: matched ? "biometric_verified" : "biometric_not_matched",
      entity: "patient",
      entityId: patient.mrn,
      patientId: patient.mrn,
      facilityId: patient.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode ?? null,
      detail: { purposeOfCheck: input.purpose, matched, reader: reader.code, demo: reader.mode === "demo" },
    });
    return row.id;
  });

  return {
    matched,
    score: matched ? score : 0,
    threshold: reader.threshold,
    finger: (hit?.finger ?? input.finger) ?? null,
    demo: reader.mode === "demo",
    next,
    verificationId: id,
  };
}

/**
 * Record how identity was established when the finger did not do it.
 *
 * Attached to the failed attempt rather than replacing it, so the register
 * still shows that the fingerprint did not work — which is how a bad enrolment
 * is ever discovered.
 */
export function recordFallback(input: {
  verificationId: number;
  fallback: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  if (!input.fallback.trim()) throw new BiometricError("a fallback records what identity was checked against");
  const row = get<{ id: number; patient_mrn: string; matched: number }>(
    `SELECT id, patient_mrn, matched FROM biometric_verifications WHERE id = ?`,
    input.verificationId,
  );
  if (!row) throw new BiometricError("no such verification");

  run(`UPDATE biometric_verifications SET fallback = ? WHERE id = ?`, input.fallback.trim(), row.id);
  audit({
    action: "identity_verified_from_documents",
    entity: "patient",
    entityId: row.patient_mrn,
    patientId: row.patient_mrn,
    actorId: input.byUserId,
    actorName: input.byUserName,
    purpose: "administration",
    detail: { verificationId: row.id, fallback: input.fallback },
  });
}

/**
 * Whether a verification can be cited as evidence for a purpose.
 *
 * A demonstration match cannot, ever. The moment a demonstration is
 * indistinguishable from the real thing, somebody bills on it.
 */
export function citableFor(verificationId: number): { citable: boolean; why: string } {
  const row = get<{ matched: number; demo: number; attempted_at: string }>(
    `SELECT matched, demo, attempted_at FROM biometric_verifications WHERE id = ?`,
    verificationId,
  );
  if (!row) throw new BiometricError("no such verification");
  if (row.demo) return { citable: false, why: "captured on a reader in demo mode — a demonstration is not evidence" };
  if (!row.matched) return { citable: false, why: "the finger did not match" };
  return { citable: true, why: "" };
}

export function verificationsFor(patientMrn: string, limit = 30) {
  return all<{
    id: number;
    purpose: string;
    finger: string;
    reader_code: string;
    matched: number;
    score: number | null;
    threshold: number | null;
    demo: number;
    fallback: string;
    attempted_at: string;
    attempter_name: string;
  }>(
    `SELECT * FROM biometric_verifications WHERE patient_mrn = ? ORDER BY attempted_at DESC LIMIT ?`,
    patientMrn,
    limit,
  );
}

// ----------------------------------------------------------------- reports

export interface BiometricSummary {
  readers: number;
  liveReaders: number;
  enrolled: number;
  exceptions: number;
  refusals: number;
  attempts: number;
  matched: number;
  /** Of attempts that had something to match against. */
  matchRatePercent: number | null;
  demoAttempts: number;
  poorQualityEnrolments: number;
  /** Patients who have failed more than once — a bad enrolment, not a bad person. */
  repeatFailures: { patientMrn: string; failures: number }[];
}

export function biometricSummary(facilityId: number, sinceDays = 90, asOf = today()): BiometricSummary {
  const since = new Date(Date.parse(`${asOf}T00:00:00.000Z`) - sinceDays * 86_400_000).toISOString();
  const readers = listReaders(facilityId);

  const enrolled =
    get<{ n: number }>(
      `SELECT COUNT(DISTINCT e.patient_mrn) AS n FROM biometric_enrolments e
         JOIN patients p ON p.mrn = e.patient_mrn
        WHERE p.facility_id = ? AND e.status = 'active'`,
      facilityId,
    )?.n ?? 0;

  const exceptions = all<{ reason: ExceptionReason; n: number }>(
    `SELECT x.reason, COUNT(*) AS n FROM biometric_exceptions x
       JOIN patients p ON p.mrn = x.patient_mrn
      WHERE p.facility_id = ? AND x.active = 1 GROUP BY x.reason`,
    facilityId,
  );

  const attempts = all<{ matched: number; demo: number; enrolment_id: string | null; patient_mrn: string }>(
    `SELECT v.matched, v.demo, v.enrolment_id, v.patient_mrn FROM biometric_verifications v
       JOIN patients p ON p.mrn = v.patient_mrn
      WHERE p.facility_id = ? AND v.attempted_at >= ?`,
    facilityId,
    since,
  );

  const matched = attempts.filter((a) => a.matched === 1).length;
  const failures = new Map<string, number>();
  for (const attempt of attempts) {
    if (attempt.matched === 0) failures.set(attempt.patient_mrn, (failures.get(attempt.patient_mrn) ?? 0) + 1);
  }

  const poor =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM biometric_enrolments e JOIN patients p ON p.mrn = e.patient_mrn
        WHERE p.facility_id = ? AND e.status = 'active' AND e.quality IS NOT NULL AND e.quality < ?`,
      facilityId,
      minQuality(),
    )?.n ?? 0;

  return {
    readers: readers.length,
    liveReaders: readers.filter((r) => r.mode === "live").length,
    enrolled,
    exceptions: exceptions.reduce((sum, e) => sum + e.n, 0),
    refusals: exceptions.find((e) => e.reason === "refused")?.n ?? 0,
    attempts: attempts.length,
    matched,
    matchRatePercent: attempts.length > 0 ? Math.round((matched / attempts.length) * 1000) / 10 : null,
    demoAttempts: attempts.filter((a) => a.demo === 1).length,
    poorQualityEnrolments: poor,
    repeatFailures: [...failures.entries()]
      .filter(([, n]) => n > 1)
      .map(([patientMrn, n]) => ({ patientMrn, failures: n }))
      .sort((a, b) => b.failures - a.failures),
  };
}

/**
 * ⚠️ One reader, in demo mode, because there is no hardware. Everything it
 * produces says so.
 */
export function seedBiometrics(facilityId: number): void {
  registerReader({
    facilityId,
    code: "FP1",
    label: "Reception fingerprint reader",
    make: "—",
    model: "—",
    threshold: 40,
    mode: "demo",
    byUserName: "seed",
  });
}
