/**
 * M28 Emergency & Casualty.
 *
 * The one module where the rest of this system has to get out of the way.
 *
 * EMERGENCY TREATMENT IS NEVER GATED ON MONEY. Article 43(2) of the
 * Constitution says a person shall not be denied emergency medical treatment,
 * and section 7 of the Health Act 2017 puts the same duty on every facility.
 * So an attendance opens with no payer check, no deposit, no coverage probe and
 * no consent form — `openAttendance` takes a name and a time, and will take an
 * attendance without even a name. Billing catches up afterwards, against a
 * record that already exists. Any HMIS that makes casualty wait for a cashier
 * is not merely inconvenient here; it is on the wrong side of the law.
 *
 * Four more decisions worth stating:
 *
 *  TRIAGE IS A SCORE PLUS A DISCRIMINATOR, AND THE DISCRIMINATOR ONLY EVER
 *  RAISES. The Triage Early Warning Score is arithmetic on observations; a
 *  discriminator is a nurse recognising something the arithmetic cannot see.
 *  The code lets the second override the first upwards and refuses to let
 *  anything pull a colour down, because the failure that kills people is a
 *  sick patient talked down into a lower queue.
 *
 *  EVERY TRIAGE IS KEPT. A patient who deteriorates in the waiting area is
 *  re-triaged, and the first assessment is not overwritten — it is the
 *  evidence of what was known then. The board reads the latest; the record
 *  keeps all of them.
 *
 *  A PATIENT WITHOUT A NAME STILL GETS A RECORD. Casualty receives people who
 *  cannot say who they are. `openUnidentified` mints a real patient record
 *  under a temporary name, so results, drugs and blood can be ordered against
 *  something. Identifying them later is a MERGE, not an edit, so nothing
 *  recorded under the temporary identity is lost.
 *
 *  THE CLOCK IS THE PRODUCT. Each colour carries a time target. The breach
 *  list — who is past target and still not seen — is the screen the department
 *  actually runs on, and it is computed from stored times rather than from
 *  anybody remembering to flag a patient.
 *
 * ⚠️ The triage scale, the score thresholds and the time targets are the
 * South African Triage Scale as published, which is widely used across East
 * Africa. Every one of them is in the clinical review register and needs an
 * emergency clinician's sign-off before go-live.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { resolvePatient, registerPatient, mergePatients } from "./patients.ts";
import { notify } from "./notifications.ts";

export class EmergencyError extends Error {}

export type Triage = "red" | "orange" | "yellow" | "green" | "blue";
export type ArrivalMode = "walk_in" | "ambulance" | "police" | "referred" | "carried" | "other";
export type Mobility = "walking" | "with_help" | "stretcher";
export type Avpu = "alert" | "voice" | "pain" | "unresponsive";
export type Disposition =
  | "admitted"
  | "discharged"
  | "referred"
  | "died"
  | "dead_on_arrival"
  | "left_without_being_seen"
  | "absconded"
  | "theatre";
export type MedicolegalKind =
  | "assault"
  | "road_traffic"
  | "gunshot"
  | "stabbing"
  | "burns"
  | "poisoning"
  | "sexual_violence"
  | "child_abuse"
  | "death_in_custody"
  | "other";

// ------------------------------------------------------------------ the scale

/**
 * How long each colour may wait before a clinician sees them, in minutes.
 *
 * ⚠️ South African Triage Scale targets. Red is "immediately", expressed here
 * as zero so any wait at all is a breach — which is the intention.
 */
export const TARGET_MINUTES: Record<Triage, number> = {
  red: 0,
  orange: 10,
  yellow: 60,
  green: 240,
  blue: 0,
};

export const TRIAGE_LABEL: Record<Triage, string> = {
  red: "Immediate",
  orange: "Very urgent",
  yellow: "Urgent",
  green: "Routine",
  blue: "Dead on arrival",
};

/** Colours in order of severity, worst first. Used wherever a board is sorted. */
export const TRIAGE_ORDER: Triage[] = ["red", "orange", "yellow", "green", "blue"];

const SEVERITY: Record<Triage, number> = { red: 0, orange: 1, yellow: 2, green: 3, blue: 4 };

export interface TriageObservations {
  mobility?: Mobility;
  respRate?: number;
  pulseBpm?: number;
  systolicMmhg?: number;
  /** Tenths of a degree, as everywhere else: 38.4 °C is 384. */
  tempTenthsC?: number;
  avpu?: Avpu;
  trauma?: boolean;
}

/**
 * The Triage Early Warning Score.
 *
 * ⚠️ Scored per the published SATS table. Each component is scored only when
 * it was recorded, so a partial set under-reads rather than over-reads — which
 * is the safe direction for a score that can only be raised afterwards by a
 * discriminator, never lowered.
 */
export function tews(obs: TriageObservations): number {
  let score = 0;

  if (obs.mobility !== undefined) {
    score += obs.mobility === "walking" ? 0 : obs.mobility === "with_help" ? 1 : 2;
  }
  if (obs.respRate !== undefined) {
    score += obs.respRate < 9 ? 2 : obs.respRate <= 14 ? 0 : obs.respRate <= 20 ? 1 : obs.respRate <= 29 ? 2 : 3;
  }
  if (obs.pulseBpm !== undefined) {
    score += obs.pulseBpm < 41 ? 2 : obs.pulseBpm <= 50 ? 1 : obs.pulseBpm <= 100 ? 0 : obs.pulseBpm <= 110 ? 1 : obs.pulseBpm <= 129 ? 2 : 3;
  }
  if (obs.systolicMmhg !== undefined) {
    score += obs.systolicMmhg < 71 ? 3 : obs.systolicMmhg <= 80 ? 2 : obs.systolicMmhg <= 100 ? 1 : obs.systolicMmhg <= 199 ? 0 : 2;
  }
  if (obs.tempTenthsC !== undefined) {
    score += obs.tempTenthsC < 350 ? 2 : obs.tempTenthsC <= 383 ? 0 : 2;
  }
  if (obs.avpu !== undefined) {
    score += obs.avpu === "alert" ? 0 : obs.avpu === "voice" ? 1 : obs.avpu === "pain" ? 2 : 3;
  }
  if (obs.trauma) score += 1;

  return score;
}

/**
 * The colour the score alone gives.
 *
 * ⚠️ SATS bands: 7 and above is red, 5–6 orange, 3–4 yellow, 0–2 green.
 */
export function triageFromScore(score: number): Triage {
  if (score >= 7) return "red";
  if (score >= 5) return "orange";
  if (score >= 3) return "yellow";
  return "green";
}

/** The worse of two colours. A discriminator can only ever raise. */
export function worst(a: Triage, b: Triage): Triage {
  return SEVERITY[a] <= SEVERITY[b] ? a : b;
}

// ------------------------------------------------------------- the attendance

export interface Attendance {
  id: string;
  facility_id: number;
  patient_mrn: string;
  encounter_id: string | null;
  visit_id: string | null;
  unidentified: number;
  arrival_mode: ArrivalMode;
  arrived_at: string;
  presenting: string;
  triage: Triage | null;
  triaged_at: string | null;
  seen_at: string | null;
  seen_by: number | null;
  disposition: Disposition | null;
  disposition_at: string | null;
  disposition_note: string;
  admission_id: string | null;
  incident_ref: string | null;
  opened_by: number | null;
  opener_name: string;
  device_code: string | null;
  created_at: string;
}

/**
 * Open a casualty attendance.
 *
 * Deliberately asks for almost nothing: a patient and a time. There is no
 * payer check here and there must never be one — see the note at the top of
 * this file. Everything else can be filled in while the patient is being
 * treated.
 */
export function openAttendance(input: {
  facilityId: number;
  patientMrn: string;
  arrivalMode?: ArrivalMode;
  arrivedAt?: string;
  presenting?: string;
  incidentRef?: string;
  visitId?: string | null;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new EmergencyError("no such patient");

  const open = get<Attendance>(
    `SELECT * FROM emergency_attendances WHERE patient_mrn = ? AND disposition IS NULL`,
    patient.mrn,
  );
  if (open) {
    // Two open attendances means two triage clocks and two boards disagreeing
    // about the same person standing in the same corridor.
    throw new EmergencyError(
      `${patient.given_name} ${patient.family_name} is already in casualty, arrived ${open.arrived_at.slice(11, 16)}. Use that attendance.`,
    );
  }
  if (input.incidentRef && !getIncident(input.incidentRef)) {
    throw new EmergencyError(`no incident is declared under ${input.incidentRef}`);
  }

  const id = mintLocalId(input.deviceCode, 8);

  return tx(() => {
    run(
      `INSERT INTO emergency_attendances
         (id, facility_id, patient_mrn, visit_id, unidentified, arrival_mode, arrived_at,
          presenting, incident_ref, opened_by, opener_name, device_code, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.facilityId,
      patient.mrn,
      input.visitId ?? null,
      input.arrivalMode ?? "walk_in",
      input.arrivedAt ?? now(),
      input.presenting?.trim() ?? "",
      input.incidentRef ?? null,
      input.byUserId,
      input.byUserName,
      input.deviceCode,
      now(),
    );
    audit({
      action: "ed_attendance_opened",
      entity: "attendance",
      entityId: id,
      patientId: patient.mrn,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { arrivalMode: input.arrivalMode ?? "walk_in", incidentRef: input.incidentRef ?? null },
    });
    return id;
  });
}

/**
 * Open an attendance for somebody who cannot say who they are.
 *
 * Mints a real patient record under a temporary name so blood, imaging and
 * drugs can be ordered against something. The name is deliberately ugly and
 * obviously provisional — "Unknown Male A4C2" is not a name anybody files and
 * forgets, which is the point.
 */
export function openUnidentified(input: {
  facilityId: number;
  sex: "male" | "female";
  estimatedAge?: number;
  arrivalMode?: ArrivalMode;
  arrivedAt?: string;
  presenting?: string;
  incidentRef?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): { attendanceId: string; patientMrn: string } {
  // Four characters is enough to tell two unidentified patients apart on a
  // board, and short enough to say out loud across a resuscitation room.
  const tag = mintLocalId(input.deviceCode, 4).split("-").pop()!.slice(-4).toUpperCase();

  const patientMrn = registerPatient({
    facilityId: input.facilityId,
    deviceCode: input.deviceCode,
    givenName: `Unknown ${input.sex === "male" ? "Male" : "Female"}`,
    familyName: tag,
    sex: input.sex,
    // An estimated age gives a plausible year of birth, which is what a weight
    // chart and a drug dose need. It is marked estimated so nobody treats it
    // as a birthday.
    dateOfBirth: input.estimatedAge === undefined
      ? null
      : `${new Date().getUTCFullYear() - input.estimatedAge}-01-01`,
    dobEstimated: input.estimatedAge !== undefined,
    byUserId: input.byUserId,
    byUserName: input.byUserName,
  });

  const attendanceId = openAttendance({
    facilityId: input.facilityId,
    patientMrn,
    arrivalMode: input.arrivalMode,
    arrivedAt: input.arrivedAt,
    presenting: input.presenting,
    incidentRef: input.incidentRef,
    byUserId: input.byUserId,
    byUserName: input.byUserName,
    deviceCode: input.deviceCode,
  });

  run(`UPDATE emergency_attendances SET unidentified = 1 WHERE id = ?`, attendanceId);

  return { attendanceId, patientMrn };
}

/**
 * Identify a patient who arrived without a name.
 *
 * A merge, never an edit: everything ordered, given and charged under the
 * temporary identity has to follow them into their real record, and a merge is
 * the only operation in this system that does that reversibly.
 */
export function identify(input: {
  attendanceId: string;
  realPatientMrn: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): void {
  const attendance = getAttendance(input.attendanceId);
  if (!attendance) throw new EmergencyError("no such attendance");
  if (!attendance.unidentified) throw new EmergencyError("that patient is already identified");

  const real = resolvePatient(input.realPatientMrn);
  if (!real) throw new EmergencyError("no such patient to identify them as");
  if (real.mrn === attendance.patient_mrn) throw new EmergencyError("that is the same record");

  tx(() => {
    mergePatients({
      keepMrn: real.mrn,
      mergeMrn: attendance.patient_mrn,
      reason: input.reason.trim() || `Identified in casualty as ${real.given_name} ${real.family_name}`,
      deviceCode: input.deviceCode,
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });
    run(
      `UPDATE emergency_attendances SET patient_mrn = ?, unidentified = 0 WHERE id = ?`,
      real.mrn,
      attendance.id,
    );
    audit({
      action: "ed_patient_identified",
      entity: "attendance",
      entityId: attendance.id,
      patientId: real.mrn,
      facilityId: attendance.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { from: attendance.patient_mrn, to: real.mrn },
    });
  });
}

export function getAttendance(id: string): Attendance | undefined {
  return get<Attendance>(`SELECT * FROM emergency_attendances WHERE id = ?`, id);
}

export function openAttendanceFor(patientMrn: string): Attendance | undefined {
  return get<Attendance>(
    `SELECT * FROM emergency_attendances WHERE patient_mrn = ? AND disposition IS NULL`,
    patientMrn,
  );
}

// ------------------------------------------------------------------- triage

export interface TriageAssessment {
  id: string;
  attendance_id: string;
  sequence: number;
  assessed_at: string;
  mobility: Mobility | null;
  resp_rate: number | null;
  pulse_bpm: number | null;
  systolic_mmhg: number | null;
  temp_tenths_c: number | null;
  avpu: Avpu | null;
  trauma: number;
  tews: number;
  discriminator: string;
  triage: Triage;
  triage_by_score: Triage;
  note: string;
  assessed_by: number | null;
  assessor_name: string;
  created_at: string;
}

/**
 * Triage, or re-triage, a patient.
 *
 * The score gives a colour; a discriminator may raise it and can never lower
 * it. `deadOnArrival` short-circuits to blue, which is the one colour that is
 * not a queue position.
 */
export function triagePatient(input: {
  attendanceId: string;
  observations: TriageObservations;
  /** What the nurse saw that the numbers cannot: "active bleeding", "seizing". */
  discriminator?: string;
  /** The colour that discriminator demands. Ignored if it is milder than the score's. */
  discriminatorTriage?: Triage;
  deadOnArrival?: boolean;
  note?: string;
  assessedAt?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): { id: string; tews: number; triage: Triage; raised: boolean } {
  const attendance = getAttendance(input.attendanceId);
  if (!attendance) throw new EmergencyError("no such attendance");
  if (attendance.disposition) {
    throw new EmergencyError(`that attendance is closed — ${attendance.disposition.replace(/_/g, " ")}`);
  }
  if (input.discriminatorTriage && !input.discriminator?.trim()) {
    throw new EmergencyError("a triage raised by hand must say what was seen");
  }

  const obs = input.observations;
  const ranges: [string, number | undefined, number, number][] = [
    ["respiratory rate", obs.respRate, 4, 90],
    ["pulse", obs.pulseBpm, 20, 250],
    ["systolic", obs.systolicMmhg, 40, 300],
    ["temperature", obs.tempTenthsC, 250, 450],
  ];
  for (const [label, value, min, max] of ranges) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new EmergencyError(`${label} of ${value} is outside a plausible range — check for a transposed digit`);
    }
  }

  const score = tews(obs);
  const byScore: Triage = input.deadOnArrival ? "blue" : triageFromScore(score);
  const triage: Triage = input.deadOnArrival
    ? "blue"
    : input.discriminatorTriage
      ? worst(byScore, input.discriminatorTriage)
      : byScore;
  const raised = triage !== byScore;

  const sequence =
    (get<{ n: number }>(
      `SELECT COALESCE(MAX(sequence), 0) AS n FROM triage_assessments WHERE attendance_id = ?`,
      attendance.id,
    )?.n ?? 0) + 1;

  const id = mintLocalId(input.deviceCode, 8);
  const assessedAt = input.assessedAt ?? now();

  return tx(() => {
    run(
      `INSERT INTO triage_assessments
         (id, attendance_id, sequence, assessed_at, mobility, resp_rate, pulse_bpm,
          systolic_mmhg, temp_tenths_c, avpu, trauma, tews, discriminator, triage,
          triage_by_score, note, assessed_by, assessor_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      attendance.id,
      sequence,
      assessedAt,
      obs.mobility ?? null,
      obs.respRate ?? null,
      obs.pulseBpm ?? null,
      obs.systolicMmhg ?? null,
      obs.tempTenthsC ?? null,
      obs.avpu ?? null,
      obs.trauma ? 1 : 0,
      score,
      input.discriminator?.trim() ?? "",
      triage,
      byScore,
      input.note?.trim() ?? "",
      input.byUserId,
      input.byUserName,
      now(),
    );

    // The board reads the latest colour. Only the first assessment sets the
    // triage clock: re-triaging a patient who has been waiting must not hand
    // the department a fresh target and erase the wait.
    run(
      `UPDATE emergency_attendances
          SET triage = ?, triaged_at = COALESCE(triaged_at, ?)
        WHERE id = ?`,
      triage,
      assessedAt,
      attendance.id,
    );

    if (triage === "red") {
      notify({
        facilityId: attendance.facility_id,
        ownerRole: "clinician",
        severity: "critical",
        kind: "ed_red",
        subject: `RED in casualty — ${attendance.presenting || "see the patient"}${input.discriminator ? ` (${input.discriminator})` : ""}`,
        body: "Immediate. A red patient has no waiting time at all.",
        entity: "attendance",
        entityId: attendance.id,
        dedupeKey: `ed_red:${attendance.id}`,
      });
    }

    audit({
      action: sequence === 1 ? "ed_triaged" : "ed_retriaged",
      entity: "attendance",
      entityId: attendance.id,
      patientId: attendance.patient_mrn,
      facilityId: attendance.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { sequence, tews: score, triageByScore: byScore, triage, raised, discriminator: input.discriminator ?? null },
    });

    return { id, tews: score, triage, raised };
  });
}

export function triageHistory(attendanceId: string): TriageAssessment[] {
  return all<TriageAssessment>(
    `SELECT * FROM triage_assessments WHERE attendance_id = ? ORDER BY sequence`,
    attendanceId,
  );
}

/** Record that a clinician has taken the patient. This stops the triage clock. */
export function startTreatment(input: {
  attendanceId: string;
  encounterId?: string | null;
  seenAt?: string;
  byUserId: number;
  byUserName: string;
}): void {
  const attendance = getAttendance(input.attendanceId);
  if (!attendance) throw new EmergencyError("no such attendance");
  if (attendance.disposition) throw new EmergencyError("that attendance is closed");
  if (attendance.seen_at) throw new EmergencyError("that patient has already been taken");

  tx(() => {
    run(
      `UPDATE emergency_attendances SET seen_at = ?, seen_by = ?, encounter_id = COALESCE(?, encounter_id) WHERE id = ?`,
      input.seenAt ?? now(),
      input.byUserId,
      input.encounterId ?? null,
      attendance.id,
    );
    audit({
      action: "ed_treatment_started",
      entity: "attendance",
      entityId: attendance.id,
      patientId: attendance.patient_mrn,
      facilityId: attendance.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { waitedMinutes: waitMinutes(attendance, input.seenAt ?? now()) },
    });
  });
}

/** How long this patient waited, or has waited so far, in whole minutes. */
export function waitMinutes(attendance: Attendance, asOf = now()): number | null {
  const from = attendance.triaged_at ?? attendance.arrived_at;
  const to = attendance.seen_at ?? asOf;
  return Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 60_000));
}

// -------------------------------------------------------------- disposition

/**
 * Close an attendance.
 *
 * `left_without_being_seen` is deliberately a first-class outcome rather than a
 * tidy-up. It is the number that tells a department it is too slow, and a
 * system that only records the patients it treated will never show it.
 */
export function recordDisposition(input: {
  attendanceId: string;
  disposition: Disposition;
  note?: string;
  admissionId?: string | null;
  at?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const attendance = getAttendance(input.attendanceId);
  if (!attendance) throw new EmergencyError("no such attendance");
  if (attendance.disposition) {
    throw new EmergencyError(`that attendance is already closed — ${attendance.disposition.replace(/_/g, " ")}`);
  }
  if (input.disposition === "admitted" && !input.admissionId) {
    throw new EmergencyError("an admission from casualty must name the admission — otherwise nobody knows which bed");
  }
  if ((input.disposition === "referred" || input.disposition === "died") && !input.note?.trim()) {
    throw new EmergencyError(
      input.disposition === "referred"
        ? "a referral must say where to and why"
        : "a death must record the circumstances",
    );
  }

  tx(() => {
    run(
      `UPDATE emergency_attendances
          SET disposition = ?, disposition_at = ?, disposition_note = ?, admission_id = ?
        WHERE id = ?`,
      input.disposition,
      input.at ?? now(),
      input.note?.trim() ?? "",
      input.admissionId ?? null,
      attendance.id,
    );
    audit({
      action: "ed_disposition",
      entity: "attendance",
      entityId: attendance.id,
      patientId: attendance.patient_mrn,
      facilityId: attendance.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: {
        disposition: input.disposition,
        triage: attendance.triage,
        waitedMinutes: waitMinutes(attendance, input.at ?? now()),
        neverSeen: attendance.seen_at === null,
      },
    });
  });
}

// ------------------------------------------------------------- medico-legal

/**
 * Open a police case alongside the clinical record.
 *
 * Kept separate because it is disclosed separately: the P3 goes to the police,
 * the notes do not. Sexual violence and child abuse raise an alert on opening,
 * because both have care pathways with clocks of their own.
 */
export function openMedicolegalCase(input: {
  attendanceId: string;
  kind: MedicolegalKind;
  policeStation?: string;
  obNumber?: string;
  note?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const attendance = getAttendance(input.attendanceId);
  if (!attendance) throw new EmergencyError("no such attendance");

  const existing = get<{ id: string }>(
    `SELECT id FROM medicolegal_cases WHERE attendance_id = ? AND kind = ?`,
    attendance.id,
    input.kind,
  );
  if (existing) throw new EmergencyError(`a ${input.kind.replace(/_/g, " ")} case is already open on this attendance`);

  const id = mintLocalId(input.deviceCode, 8);

  return tx(() => {
    run(
      `INSERT INTO medicolegal_cases
         (id, attendance_id, patient_mrn, kind, police_station, ob_number, note,
          opened_by, opener_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      attendance.id,
      attendance.patient_mrn,
      input.kind,
      input.policeStation?.trim() ?? "",
      input.obNumber?.trim().toUpperCase() ?? "",
      input.note?.trim() ?? "",
      input.byUserId,
      input.byUserName,
      now(),
    );

    if (input.kind === "sexual_violence" || input.kind === "child_abuse") {
      notify({
        facilityId: attendance.facility_id,
        ownerRole: "clinician",
        severity: "critical",
        kind: "ed_safeguarding",
        subject: `${input.kind === "sexual_violence" ? "Sexual violence" : "Child protection"} case opened in casualty`,
        body: "This has a care pathway and a clock of its own. Do not leave it to the general queue.",
        entity: "attendance",
        entityId: attendance.id,
        dedupeKey: `ed_safeguarding:${id}`,
      });
    }

    audit({
      action: "medicolegal_case_opened",
      entity: "attendance",
      entityId: attendance.id,
      patientId: attendance.patient_mrn,
      facilityId: attendance.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { kind: input.kind, obNumber: input.obNumber ?? null },
    });
    return id;
  });
}

/** Record that the P3 form has been handed over, and to whom. */
export function issueP3(input: {
  caseId: string;
  issuedTo: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const record = get<{ id: string; attendance_id: string; patient_mrn: string; p3_issued: number }>(
    `SELECT id, attendance_id, patient_mrn, p3_issued FROM medicolegal_cases WHERE id = ?`,
    input.caseId,
  );
  if (!record) throw new EmergencyError("no such case");
  if (record.p3_issued) throw new EmergencyError("that P3 has already been issued");
  if (!input.issuedTo.trim()) {
    throw new EmergencyError("a P3 must record who it was handed to — it is a disclosure, and it is tracked");
  }

  tx(() => {
    run(
      `UPDATE medicolegal_cases SET p3_issued = 1, p3_issued_at = ?, p3_issued_to = ? WHERE id = ?`,
      now(),
      input.issuedTo.trim(),
      record.id,
    );
    audit({
      action: "p3_issued",
      entity: "medicolegal_case",
      entityId: record.id,
      patientId: record.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      // A P3 leaves the facility, so this entry is the disclosure record: who
      // it went to is in the detail, and the chain makes it undeniable.
      purpose: "administration",
      detail: { issuedTo: input.issuedTo },
    });
  });
}

export function medicolegalFor(attendanceId: string) {
  return all<{
    id: string;
    kind: MedicolegalKind;
    police_station: string;
    ob_number: string;
    p3_issued: number;
    p3_issued_at: string | null;
    p3_issued_to: string;
    note: string;
    opener_name: string;
    created_at: string;
  }>(`SELECT * FROM medicolegal_cases WHERE attendance_id = ? ORDER BY created_at`, attendanceId);
}

// ---------------------------------------------------------- mass casualty

export function declareIncident(input: {
  facilityId: number;
  reference: string;
  kind: string;
  description?: string;
  declaredAt?: string;
  byUserId: number | null;
  byUserName: string;
}): string {
  const reference = input.reference.trim().toUpperCase();
  if (!reference) throw new EmergencyError("an incident needs a reference everybody can say out loud");
  if (getIncident(reference)) throw new EmergencyError(`${reference} is already declared`);

  tx(() => {
    run(
      `INSERT INTO mci_incidents
         (reference, facility_id, kind, description, declared_at, declared_by, declarer_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      reference,
      input.facilityId,
      input.kind.trim(),
      input.description?.trim() ?? "",
      input.declaredAt ?? now(),
      input.byUserId,
      input.byUserName,
      now(),
    );
    notify({
      facilityId: input.facilityId,
      ownerRole: "clinician",
      severity: "critical",
      kind: "mci_declared",
      subject: `Mass casualty declared — ${reference}: ${input.kind}`,
      body: input.description?.trim() || "Casualty is receiving multiple patients from one incident.",
      entity: "incident",
      entityId: reference,
      dedupeKey: `mci:${reference}`,
    });
    audit({
      action: "mci_declared",
      entity: "incident",
      entityId: reference,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { kind: input.kind, description: input.description ?? null },
    });
  });

  return reference;
}

export function standDownIncident(input: {
  reference: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const incident = getIncident(input.reference);
  if (!incident) throw new EmergencyError("no such incident");
  if (incident.stood_down_at) throw new EmergencyError("that incident is already stood down");

  run(`UPDATE mci_incidents SET stood_down_at = ? WHERE reference = ?`, now(), incident.reference);
  audit({
    action: "mci_stood_down",
    entity: "incident",
    entityId: incident.reference,
    facilityId: incident.facility_id,
    actorId: input.byUserId,
    actorName: input.byUserName,
    purpose: "treatment",
    detail: { casualties: incidentBoard(incident.reference).length },
  });
}

export function getIncident(reference: string) {
  return get<{
    reference: string;
    facility_id: number;
    kind: string;
    description: string;
    declared_at: string;
    stood_down_at: string | null;
    declarer_name: string;
  }>(`SELECT * FROM mci_incidents WHERE reference = ?`, reference.trim().toUpperCase());
}

export function listIncidents(facilityId: number) {
  return all<{
    reference: string;
    kind: string;
    description: string;
    declared_at: string;
    stood_down_at: string | null;
    declarer_name: string;
  }>(`SELECT * FROM mci_incidents WHERE facility_id = ? ORDER BY declared_at DESC`, facilityId);
}

/** Everybody from one incident and where they are now. */
export function incidentBoard(reference: string) {
  return all<{
    id: string;
    patient_mrn: string;
    patient_name: string;
    triage: Triage | null;
    disposition: Disposition | null;
    arrived_at: string;
    unidentified: number;
  }>(
    `SELECT a.id, a.patient_mrn, p.given_name || ' ' || p.family_name AS patient_name,
            a.triage, a.disposition, a.arrived_at, a.unidentified
       FROM emergency_attendances a
       JOIN patients p ON p.mrn = a.patient_mrn
      WHERE a.incident_ref = ?
      ORDER BY CASE a.triage WHEN 'red' THEN 0 WHEN 'orange' THEN 1 WHEN 'yellow' THEN 2
                             WHEN 'green' THEN 3 WHEN 'blue' THEN 4 ELSE 5 END, a.arrived_at`,
    reference.trim().toUpperCase(),
  );
}

// ------------------------------------------------------------------ the board

export interface BoardRow {
  attendance: Attendance;
  patientName: string;
  /** Minutes waited, or waited so far. */
  waited: number | null;
  targetMinutes: number | null;
  /** Past target and still not seen. */
  breached: boolean;
  /** Not yet triaged at all — the worst state a casualty board can be in. */
  untriaged: boolean;
  medicolegal: number;
}

/**
 * The casualty board: everybody currently in the department.
 *
 * Sorted by colour, then by how long they have waited. Untriaged patients sort
 * above everything, because an unknown colour is not a mild one — it is a
 * patient nobody has looked at.
 */
export function board(facilityId: number, asOf = now()): BoardRow[] {
  const rows = all<Attendance & { patient_name: string; mlc: number }>(
    `SELECT a.*, p.given_name || ' ' || p.family_name AS patient_name,
            (SELECT COUNT(*) FROM medicolegal_cases m WHERE m.attendance_id = a.id) AS mlc
       FROM emergency_attendances a
       JOIN patients p ON p.mrn = a.patient_mrn
      WHERE a.facility_id = ? AND a.disposition IS NULL`,
    facilityId,
  );

  return rows
    .map((a) => {
      const waited = waitMinutes(a, asOf);
      const target = a.triage ? TARGET_MINUTES[a.triage] : null;
      return {
        attendance: a,
        patientName: a.patient_name,
        waited,
        targetMinutes: target,
        breached:
          a.seen_at === null && target !== null && waited !== null && waited > target && a.triage !== "blue",
        untriaged: a.triage === null,
        medicolegal: a.mlc,
      };
    })
    .sort(
      (a, b) =>
        Number(b.untriaged) - Number(a.untriaged) ||
        (a.attendance.triage ? SEVERITY[a.attendance.triage] : -1) -
          (b.attendance.triage ? SEVERITY[b.attendance.triage] : -1) ||
        (b.waited ?? 0) - (a.waited ?? 0),
    );
}

/** Who is past their target and still has not been seen. */
export function breaches(facilityId: number, asOf = now()): BoardRow[] {
  return board(facilityId, asOf).filter((r) => r.breached || r.untriaged);
}

export interface EmergencySummary {
  attendances: number;
  open: number;
  /** Still in the department and never triaged. */
  untriaged: number;
  breached: number;
  byTriage: Record<Triage, number>;
  admitted: number;
  died: number;
  deadOnArrival: number;
  leftWithoutBeingSeen: number;
  medicolegal: number;
  /** Median minutes from triage to a clinician, for those who were seen. */
  medianWaitMinutes: number | null;
  /** The share seen inside their colour's target, as a percentage. */
  withinTargetPercent: number | null;
}

export function emergencySummary(facilityId: number, from?: string, to?: string): EmergencySummary {
  const clause = from && to ? `AND a.arrived_at >= ? AND a.arrived_at <= ?` : "";
  const params: (string | number)[] = from && to ? [`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`] : [];

  const rows = all<Attendance>(
    `SELECT a.* FROM emergency_attendances a WHERE a.facility_id = ? ${clause}`,
    facilityId,
    ...params,
  );

  const byTriage: Record<Triage, number> = { red: 0, orange: 0, yellow: 0, green: 0, blue: 0 };
  for (const a of rows) if (a.triage) byTriage[a.triage]++;

  // Only patients who were actually seen have a wait that has ended.
  const seen = rows.filter((a) => a.seen_at && a.triage && a.triage !== "blue");
  const waits = seen.map((a) => waitMinutes(a, a.seen_at!)!).sort((x, y) => x - y);
  const withinTarget = seen.filter((a) => waitMinutes(a, a.seen_at!)! <= TARGET_MINUTES[a.triage!]).length;

  const live = board(facilityId);

  return {
    attendances: rows.length,
    open: rows.filter((a) => !a.disposition).length,
    untriaged: live.filter((r) => r.untriaged).length,
    breached: live.filter((r) => r.breached).length,
    byTriage,
    admitted: rows.filter((a) => a.disposition === "admitted").length,
    died: rows.filter((a) => a.disposition === "died").length,
    deadOnArrival: rows.filter((a) => a.disposition === "dead_on_arrival").length,
    leftWithoutBeingSeen: rows.filter((a) => a.disposition === "left_without_being_seen").length,
    medicolegal:
      get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM medicolegal_cases m
          JOIN emergency_attendances a ON a.id = m.attendance_id
         WHERE a.facility_id = ?`,
        facilityId,
      )?.n ?? 0,
    medianWaitMinutes: waits.length === 0 ? null : waits[Math.floor(waits.length / 2)],
    withinTargetPercent: seen.length === 0 ? null : Math.round((withinTarget / seen.length) * 1000) / 10,
  };
}

/** Recent attendances, closed ones included. */
export function attendanceLog(facilityId: number, limit = 50) {
  return all<Attendance & { patient_name: string }>(
    `SELECT a.*, p.given_name || ' ' || p.family_name AS patient_name
       FROM emergency_attendances a
       JOIN patients p ON p.mrn = a.patient_mrn
      WHERE a.facility_id = ?
      ORDER BY a.arrived_at DESC
      LIMIT ?`,
    facilityId,
    limit,
  );
}
