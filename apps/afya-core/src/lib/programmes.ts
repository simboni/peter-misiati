/**
 * M27 Programme Registers — HIV, TB and the NCD clinic.
 *
 * A programme is a long course of care with its own register, its own numbering
 * and its own reporting, and it cannot be produced from ordinary encounter data
 * afterwards. Three things make it a separate module rather than a report:
 *
 *  THE PATIENT HAS A SECOND NUMBER. The programme knows them by a CCC number or
 *  a TB register number, not by the facility's file number. Every return, every
 *  transfer letter and every donor audit uses that number, so it is stored,
 *  unique within the programme, and never re-used.
 *
 *  REPORTING IS BY COHORT, NOT BY MONTH. "Of everyone who started treatment in
 *  April, where are they twelve months later" is the question these programmes
 *  are judged on, and it cannot be answered from a monthly activity count. So
 *  the cohort is stamped at enrolment and never moves.
 *
 *  THE NUMBER THAT MATTERS IS WHO DID NOT COME BACK. Lost to follow-up is the
 *  single measure a programme lives or dies by. It needs an appointment date
 *  recorded at every visit, and a defined number of days after which somebody
 *  is counted missing rather than merely late.
 *
 * WHAT A CLINICIAN MUST CHECK. The lost-to-follow-up thresholds below, the
 * cohort length, and the findings each programme records are all set from
 * general practice, not from Kenya's current programme guidelines. They are
 * data, not code, and are listed in `docs/hms/06-clinical-review.md` for a
 * clinical advisor to confirm or correct.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { resolvePatient } from "./patients.ts";
import { notify } from "./notifications.ts";

export class ProgrammeError extends Error {}

export type EnrolmentStatus =
  | "active"
  | "transferred_out"
  | "lost"
  | "stopped"
  | "completed"
  | "died";

export interface Programme {
  code: string;
  name: string;
  cohort_months: number;
  active: number;
  notes: string;
  created_at: string;
}

export interface Enrolment {
  id: string;
  programme_code: string;
  patient_mrn: string;
  programme_number: string;
  enrolled_on: string;
  cohort: string;
  status: EnrolmentStatus;
  outcome_on: string | null;
  outcome_note: string | null;
  enrolled_by: number | null;
  device_code: string | null;
  created_at: string;
}

export interface ProgrammeVisit {
  id: string;
  enrolment_id: string;
  encounter_id: string | null;
  visit_date: string;
  next_due: string | null;
  findings: string;
  note: string;
  seen_by: number | null;
  seen_by_name: string;
  created_at: string;
}

/**
 * How many days past an appointment before somebody is LOST rather than late.
 *
 * ⚠️ These are the numbers a clinical advisor must confirm against the current
 * Kenyan programme guidelines. They differ by programme because the
 * consequences differ: a fortnight off antiretrovirals risks resistance, while
 * an NCD review is a month's grace.
 */
export const LOST_AFTER_DAYS: Record<string, number> = {
  HIV: 28,
  TB: 14,
  NCD: 60,
};

/** The default, for a programme with no threshold of its own. */
export const LOST_AFTER_DAYS_DEFAULT = 30;

export function defineProgramme(input: {
  code: string;
  name: string;
  cohortMonths?: number;
  notes?: string;
}): void {
  run(
    `INSERT INTO programmes (code, name, cohort_months, notes, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name,
       cohort_months = excluded.cohort_months, notes = excluded.notes`,
    input.code.trim().toUpperCase(),
    input.name.trim(),
    input.cohortMonths ?? 12,
    input.notes ?? "",
    now(),
  );
}

export function getProgramme(code: string): Programme | undefined {
  return get<Programme>(`SELECT * FROM programmes WHERE code = ?`, code.trim().toUpperCase());
}

export function listProgrammes(): Programme[] {
  return all<Programme>(`SELECT * FROM programmes WHERE active = 1 ORDER BY name`);
}

/**
 * Enrol a patient.
 *
 * The programme number is theirs for good: unique within the programme, never
 * re-used, and refused if it is already on somebody. A patient already enrolled
 * is refused rather than given a second number, because two registers entries
 * for one person is how a cohort report stops adding up.
 */
export function enrol(input: {
  programmeCode: string;
  patientMrn: string;
  programmeNumber: string;
  enrolledOn?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const programme = getProgramme(input.programmeCode);
  if (!programme) throw new ProgrammeError(`no such programme ${input.programmeCode}`);

  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new ProgrammeError("no such patient");

  const number = input.programmeNumber.trim().toUpperCase();
  if (!number) {
    throw new ProgrammeError(
      `an enrolment needs the ${programme.name} number — it is what every return and every transfer letter uses`,
    );
  }

  const enrolledOn = input.enrolledOn ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(enrolledOn)) throw new ProgrammeError("the enrolment date must be YYYY-MM-DD");
  if (enrolledOn > today()) throw new ProgrammeError("that enrolment date is in the future");

  const existing = get<Enrolment>(
    `SELECT * FROM enrolments WHERE programme_code = ? AND patient_mrn = ?`,
    programme.code,
    patient.mrn,
  );
  if (existing) {
    throw new ProgrammeError(
      existing.status === "active"
        ? `${patient.given_name} ${patient.family_name} is already on the ${programme.name} register as ${existing.programme_number}`
        : `${patient.given_name} ${patient.family_name} was on the ${programme.name} register as ${existing.programme_number} and left as ${existing.status.replace("_", " ")}. Re-open that enrolment rather than making a second one.`,
    );
  }

  const taken = get<{ patient_mrn: string }>(
    `SELECT patient_mrn FROM enrolments WHERE programme_code = ? AND programme_number = ?`,
    programme.code,
    number,
  );
  if (taken) throw new ProgrammeError(`${number} is already on the register, against ${taken.patient_mrn}`);

  const id = mintLocalId(input.deviceCode, 8);
  // The cohort is the month they started, stamped now and never moved: "of
  // everyone who started in April, where are they a year later" is the question.
  const cohort = enrolledOn.slice(0, 7);

  return tx(() => {
    run(
      `INSERT INTO enrolments
         (id, programme_code, patient_mrn, programme_number, enrolled_on, cohort, status,
          enrolled_by, device_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      id,
      programme.code,
      patient.mrn,
      number,
      enrolledOn,
      cohort,
      input.byUserId,
      input.deviceCode,
      now(),
    );
    audit({
      action: "programme_enrolled",
      entity: "enrolment",
      entityId: id,
      patientId: patient.mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      // A programme enrolment is among the most sensitive facts a record holds.
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { programme: programme.code, number, cohort },
    });
    return id;
  });
}

export function getEnrolment(id: string): Enrolment | undefined {
  return get<Enrolment>(`SELECT * FROM enrolments WHERE id = ?`, id);
}

export function enrolmentFor(programmeCode: string, patientMrn: string): Enrolment | undefined {
  return get<Enrolment>(
    `SELECT * FROM enrolments WHERE programme_code = ? AND patient_mrn = ?`,
    programmeCode.trim().toUpperCase(),
    patientMrn,
  );
}

export function enrolmentsFor(patientMrn: string): (Enrolment & { programme_name: string })[] {
  return all(
    `SELECT e.*, p.name AS programme_name FROM enrolments e
       JOIN programmes p ON p.code = e.programme_code
      WHERE e.patient_mrn = ? ORDER BY e.enrolled_on DESC`,
    patientMrn,
  );
}

/**
 * Record a programme visit.
 *
 * `nextDue` is the load-bearing field. Every follow-up system in every
 * programme hangs on somebody writing down when the patient is expected back,
 * and a visit recorded without one leaves that patient invisible to the
 * defaulter list — so this says so rather than accepting it silently.
 */
export function recordVisit(input: {
  enrolmentId: string;
  encounterId?: string | null;
  visitDate?: string;
  nextDue?: string;
  findings?: Record<string, string | number>;
  note?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const enrolment = getEnrolment(input.enrolmentId);
  if (!enrolment) throw new ProgrammeError("no such enrolment");
  if (enrolment.status !== "active") {
    throw new ProgrammeError(
      `that enrolment ended as ${enrolment.status.replace("_", " ")}. Re-open it before recording a visit.`,
    );
  }

  const visitDate = input.visitDate ?? today();
  if (visitDate < enrolment.enrolled_on) {
    throw new ProgrammeError("a visit cannot be before the enrolment");
  }
  if (input.nextDue && input.nextDue <= visitDate) {
    throw new ProgrammeError("the next appointment must be after this visit");
  }

  const id = mintLocalId(input.deviceCode, 8);

  return tx(() => {
    run(
      `INSERT INTO programme_visits
         (id, enrolment_id, encounter_id, visit_date, next_due, findings, note, seen_by, seen_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      enrolment.id,
      input.encounterId ?? null,
      visitDate,
      input.nextDue ?? null,
      JSON.stringify(input.findings ?? {}),
      input.note?.trim() ?? "",
      input.byUserId,
      input.byUserName,
      now(),
    );

    audit({
      action: "programme_visit",
      entity: "enrolment",
      entityId: enrolment.id,
      patientId: enrolment.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { programme: enrolment.programme_code, visitDate, nextDue: input.nextDue ?? null },
    });

    return id;
  });
}

export function visitsFor(enrolmentId: string): ProgrammeVisit[] {
  return all<ProgrammeVisit>(
    `SELECT * FROM programme_visits WHERE enrolment_id = ? ORDER BY visit_date DESC`,
    enrolmentId,
  );
}

/**
 * End an enrolment.
 *
 * Transferred out, stopped, completed, died, or lost. Every one needs a date
 * and a note, because a cohort report is read as "of a hundred who started,
 * this is where they all are" and an outcome with no explanation is a hole in
 * that sentence.
 */
export function recordOutcome(input: {
  enrolmentId: string;
  status: Exclude<EnrolmentStatus, "active">;
  outcomeOn?: string;
  note: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const enrolment = getEnrolment(input.enrolmentId);
  if (!enrolment) throw new ProgrammeError("no such enrolment");
  if (enrolment.status !== "active") {
    throw new ProgrammeError(`that enrolment already ended as ${enrolment.status.replace("_", " ")}`);
  }
  if (!input.note.trim()) {
    throw new ProgrammeError("an outcome must record why — a cohort report with an unexplained exit is a hole in it");
  }

  const outcomeOn = input.outcomeOn ?? today();

  tx(() => {
    run(
      `UPDATE enrolments SET status = ?, outcome_on = ?, outcome_note = ? WHERE id = ?`,
      input.status,
      outcomeOn,
      input.note.trim(),
      input.enrolmentId,
    );
    audit({
      action: "programme_outcome",
      entity: "enrolment",
      entityId: input.enrolmentId,
      patientId: enrolment.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { programme: enrolment.programme_code, status: input.status, outcomeOn, note: input.note },
    });
  });
}

/** Put somebody back on the register — they came back, or the outcome was wrong. */
export function reopen(input: {
  enrolmentId: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const enrolment = getEnrolment(input.enrolmentId);
  if (!enrolment) throw new ProgrammeError("no such enrolment");
  if (enrolment.status === "active") throw new ProgrammeError("that enrolment is already active");
  if (enrolment.status === "died") {
    throw new ProgrammeError("that enrolment is closed as died. If that was wrong, it is a records correction, not a re-opening.");
  }
  if (!input.reason.trim()) throw new ProgrammeError("re-opening an enrolment must record why");

  tx(() => {
    run(
      `UPDATE enrolments SET status = 'active', outcome_on = NULL,
         outcome_note = COALESCE(outcome_note, '') || ' — re-opened: ' || ? WHERE id = ?`,
      input.reason.trim(),
      input.enrolmentId,
    );
    audit({
      action: "programme_reopened",
      entity: "enrolment",
      entityId: input.enrolmentId,
      patientId: enrolment.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { programme: enrolment.programme_code, was: enrolment.status, reason: input.reason },
    });
  });
}

// ------------------------------------------------------------- the worklists

export interface DueVisit {
  enrolment: Enrolment;
  patientName: string;
  programmeName: string;
  nextDue: string;
  daysOverdue: number;
  /** Past the programme's threshold: counted lost rather than merely late. */
  lost: boolean;
  lastSeen: string;
}

/**
 * Who has not come back.
 *
 * The single number these programmes are judged on. Split by whether they are
 * late or past the threshold, because the action differs: a late patient is
 * telephoned, and one past the threshold is traced and reported as lost.
 */
export function defaulters(programmeCode?: string, asOf = today()): DueVisit[] {
  const rows = all<{
    enrolment_id: string;
    next_due: string;
    visit_date: string;
    patient_name: string;
    programme_name: string;
  }>(
    `SELECT v.enrolment_id, v.next_due, v.visit_date,
            p.given_name || ' ' || p.family_name AS patient_name,
            g.name AS programme_name
       FROM programme_visits v
       JOIN enrolments e ON e.id = v.enrolment_id
       JOIN patients p ON p.mrn = e.patient_mrn
       JOIN programmes g ON g.code = e.programme_code
      WHERE e.status = 'active' AND v.next_due IS NOT NULL AND v.next_due < ?
        AND (? IS NULL OR e.programme_code = ?)
        -- Only the latest appointment for each enrolment counts; an older one
        -- they already came back for is not a default.
        AND v.next_due = (SELECT MAX(v2.next_due) FROM programme_visits v2 WHERE v2.enrolment_id = e.id)
        -- And nobody has been seen since it fell due.
        AND NOT EXISTS (
          SELECT 1 FROM programme_visits v3
           WHERE v3.enrolment_id = e.id AND v3.visit_date > v.next_due
        )`,
    asOf,
    programmeCode?.trim().toUpperCase() ?? null,
    programmeCode?.trim().toUpperCase() ?? null,
  );

  return rows
    .map((r) => {
      const enrolment = getEnrolment(r.enrolment_id)!;
      const daysOverdue = Math.round(
        (Date.parse(`${asOf}T00:00:00.000Z`) - Date.parse(`${r.next_due}T00:00:00.000Z`)) / 86_400_000,
      );
      const threshold = LOST_AFTER_DAYS[enrolment.programme_code] ?? LOST_AFTER_DAYS_DEFAULT;
      return {
        enrolment,
        patientName: r.patient_name,
        programmeName: r.programme_name,
        nextDue: r.next_due,
        daysOverdue,
        lost: daysOverdue >= threshold,
        lastSeen: r.visit_date,
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

/** Raise the defaulter list onto the desk that traces people. Run on a schedule. */
export function sweepDefaulters(facilityId: number, asOf = today()): { late: number; lost: number } {
  const all = defaulters(undefined, asOf);
  const lost = all.filter((d) => d.lost);
  const late = all.filter((d) => !d.lost);

  if (lost.length > 0) {
    notify({
      facilityId,
      ownerRole: "clinician",
      severity: "critical",
      kind: "programme_lost",
      subject: `${lost.length} patient${lost.length === 1 ? "" : "s"} lost to follow-up`,
      body: "Past the programme threshold. These need tracing, and they are what the programme is judged on.",
      entity: "programme",
      entityId: asOf,
      dedupeKey: `lost:${asOf}`,
    });
  }
  if (late.length > 0) {
    notify({
      facilityId,
      ownerRole: "receptionist",
      severity: "warning",
      kind: "programme_late",
      subject: `${late.length} programme patient${late.length === 1 ? "" : "s"} missed an appointment`,
      body: "Still inside the threshold. A telephone call now is what stops them becoming a defaulter.",
      entity: "programme",
      entityId: asOf,
      dedupeKey: `late:${asOf}`,
    });
  }

  return { late: late.length, lost: lost.length };
}

/** Everyone on a register, newest first. */
export function register(programmeCode: string, status?: EnrolmentStatus): (Enrolment & {
  patient_name: string;
  last_seen: string | null;
  next_due: string | null;
})[] {
  return all(
    `SELECT e.*,
            p.given_name || ' ' || p.family_name AS patient_name,
            (SELECT MAX(v.visit_date) FROM programme_visits v WHERE v.enrolment_id = e.id) AS last_seen,
            (SELECT MAX(v.next_due) FROM programme_visits v WHERE v.enrolment_id = e.id) AS next_due
       FROM enrolments e JOIN patients p ON p.mrn = e.patient_mrn
      WHERE e.programme_code = ? AND (? IS NULL OR e.status = ?)
      ORDER BY e.enrolled_on DESC`,
    programmeCode.trim().toUpperCase(),
    status ?? null,
    status ?? null,
  );
}

export interface CohortRow {
  cohort: string;
  started: number;
  active: number;
  transferredOut: number;
  lost: number;
  stopped: number;
  completed: number;
  died: number;
  /** Still in care as a percentage of those who started. The headline number. */
  retentionPercent: number;
}

/**
 * The cohort report.
 *
 * "Of everyone who started treatment in April, where are they now." This is the
 * question these programmes are judged on and the reason the cohort is stamped
 * at enrolment and never moved — a monthly activity count cannot answer it,
 * however many months of them you have.
 */
export function cohortReport(programmeCode: string): CohortRow[] {
  const rows = all<{ cohort: string; status: EnrolmentStatus; n: number }>(
    `SELECT cohort, status, COUNT(*) AS n FROM enrolments
      WHERE programme_code = ? GROUP BY cohort, status ORDER BY cohort DESC`,
    programmeCode.trim().toUpperCase(),
  );

  const byCohort = new Map<string, CohortRow>();
  for (const row of rows) {
    const entry = byCohort.get(row.cohort) ?? {
      cohort: row.cohort,
      started: 0,
      active: 0,
      transferredOut: 0,
      lost: 0,
      stopped: 0,
      completed: 0,
      died: 0,
      retentionPercent: 0,
    };
    entry.started += row.n;
    if (row.status === "active") entry.active += row.n;
    else if (row.status === "transferred_out") entry.transferredOut += row.n;
    else if (row.status === "lost") entry.lost += row.n;
    else if (row.status === "stopped") entry.stopped += row.n;
    else if (row.status === "completed") entry.completed += row.n;
    else if (row.status === "died") entry.died += row.n;
    byCohort.set(row.cohort, entry);
  }

  return [...byCohort.values()]
    .map((c) => ({
      ...c,
      // Transferred out counts as retained: they are in care, elsewhere. This
      // is how programme reporting treats it and getting it wrong understates
      // every facility that refers.
      retentionPercent:
        c.started === 0
          ? 0
          : Math.round(((c.active + c.transferredOut + c.completed) / c.started) * 1000) / 10,
    }))
    .sort((a, b) => b.cohort.localeCompare(a.cohort));
}

/** The three registers a Kenyan facility runs. Idempotent. */
export function seedProgrammes(): void {
  defineProgramme({
    code: "HIV",
    name: "HIV care and treatment",
    cohortMonths: 12,
    notes: "Comprehensive care centre. Patients are known by their CCC number.",
  });
  defineProgramme({
    code: "TB",
    name: "Tuberculosis",
    cohortMonths: 6,
    notes: "Treatment is a fixed course, so the cohort is six months, not twelve.",
  });
  defineProgramme({
    code: "NCD",
    name: "Non-communicable disease clinic",
    cohortMonths: 12,
    notes: "Hypertension and diabetes review. Lifelong, so retention is the measure.",
  });
}
