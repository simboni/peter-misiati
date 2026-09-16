/**
 * M25 Theatre — the list, the checklist, and the count.
 *
 * Two things in surgery are known to save lives and are routinely not done:
 * the WHO Surgical Safety Checklist, and the swab count. Both fail the same
 * way — somebody is in a hurry, and there is nothing to stop them. So in this
 * module neither is a form to fill in afterwards. Both are gates.
 *
 *  THE CHECKLIST GATES THE OPERATION. Anaesthesia cannot be recorded without
 *  sign-in. Incision cannot be recorded without time-out. The patient cannot
 *  leave theatre without sign-out. Every answer is stored individually rather
 *  than as one "checklist done" flag, because a checklist recorded as a single
 *  tick is a checklist nobody read out loud — which is the whole mechanism.
 *
 *  THE COUNT MUST RECONCILE. Swabs, instruments and needles are counted in and
 *  counted out. A mismatch blocks sign-out and raises a critical alert, and is
 *  cleared by recording how it was resolved — never by editing the numbers.
 *  A retained swab is a never-event; the count is the only thing between a
 *  theatre and one.
 *
 *  A "NO" ON THE CHECKLIST DOES NOT STOP THE LIST. It is recorded, and it is
 *  reportable. Software that refuses to proceed on a "no" teaches the team to
 *  answer yes, which is worse than no checklist at all. The module records
 *  truthfully and escalates; the decision to proceed stays with the surgeon.
 *
 *  CANCELLATION IS A FIRST-CLASS OUTCOME WITH A CATEGORY. Theatre utilisation
 *  is what a hospital is judged on, and "the list was cancelled" with no reason
 *  teaches nobody anything. The categories are the ones a theatre manager
 *  actually argues about: no anaesthetist, no bed, no blood, patient unfit.
 *
 * ⚠️ The checklist items below are the WHO Surgical Safety Checklist as
 * published. They are data, and a facility that has adapted the checklist
 * loads its own. Both the items and the ASA grading need a surgeon's and an
 * anaesthetist's sign-off.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { resolvePatient } from "./patients.ts";
import { notify } from "./notifications.ts";
import { equipmentBlock } from "./assets.ts";
import { sign, signedFor } from "./documents.ts";

export class TheatreError extends Error {}

export type Urgency = "immediate" | "urgent" | "expedited" | "elective";
export type CaseStatus =
  | "booked"
  | "sent_for"
  | "in_theatre"
  | "anaesthetised"
  | "incised"
  | "closed"
  | "in_recovery"
  | "completed"
  | "cancelled";
export type Stage = "sign_in" | "time_out" | "sign_out";
export type Answer = "yes" | "no" | "not_applicable";
export type CancelCategory =
  | "no_theatre_time"
  | "no_surgeon"
  | "no_anaesthetist"
  | "no_bed"
  | "patient_unfit"
  | "patient_did_not_attend"
  | "no_blood"
  | "no_equipment"
  | "no_consent"
  | "other";
export type Laterality = "left" | "right" | "bilateral" | "not_applicable";
export type Anaesthesia = "general" | "spinal" | "regional" | "local" | "sedation";

/**
 * How soon each urgency should reach theatre.
 *
 * ⚠️ The NCEPOD classification, widely used and widely adapted. Needs a
 * surgeon's confirmation that these are the windows this facility works to.
 */
export const URGENCY_TARGET_HOURS: Record<Urgency, number | null> = {
  immediate: 1,
  urgent: 24,
  expedited: 168,
  elective: null,
};

export interface ChecklistItem {
  code: string;
  text: string;
  /** Answering "no" here is escalated rather than merely recorded. */
  critical?: boolean;
}

/**
 * The WHO Surgical Safety Checklist.
 *
 * ⚠️ As published. Items marked critical are the ones where a "no" raises an
 * alert: identity, site, consent, allergy, airway, blood, and the count.
 */
export const CHECKLIST: Record<Stage, ChecklistItem[]> = {
  sign_in: [
    { code: "IDENTITY", text: "Patient has confirmed identity, site, procedure and consent", critical: true },
    { code: "SITE_MARKED", text: "Surgical site is marked, or marking is not applicable", critical: true },
    { code: "ANAESTHESIA_CHECK", text: "Anaesthesia machine and medication check complete", critical: true },
    { code: "PULSE_OXIMETER", text: "Pulse oximeter is on the patient and functioning", critical: true },
    { code: "ALLERGY", text: "Known allergy has been asked about and acted on", critical: true },
    { code: "AIRWAY", text: "Difficult airway or aspiration risk assessed and equipment available", critical: true },
    { code: "BLOOD_LOSS_RISK", text: "Risk of more than 500 ml blood loss assessed, access and fluids planned", critical: true },
  ],
  time_out: [
    { code: "TEAM_INTRODUCED", text: "All team members have introduced themselves by name and role" },
    { code: "CONFIRM_ALOUD", text: "Surgeon, anaesthetist and nurse confirm patient, site and procedure aloud", critical: true },
    { code: "CRITICAL_STEPS", text: "Surgeon has stated critical or unexpected steps, and expected duration" },
    { code: "ANAESTHETIC_CONCERNS", text: "Anaesthetist has stated any patient-specific concerns" },
    { code: "STERILITY", text: "Nursing team has confirmed sterility and equipment issues", critical: true },
    { code: "ANTIBIOTIC", text: "Antibiotic prophylaxis given within the last 60 minutes, or not indicated", critical: true },
    { code: "IMAGING", text: "Essential imaging is displayed, or is not needed" },
  ],
  sign_out: [
    { code: "PROCEDURE_RECORDED", text: "Nurse has confirmed aloud the name of the procedure recorded", critical: true },
    { code: "COUNTS_CORRECT", text: "Instrument, swab and needle counts are correct", critical: true },
    { code: "SPECIMEN_LABELLED", text: "Specimen is labelled, including the patient's name, or there is none", critical: true },
    { code: "EQUIPMENT_PROBLEMS", text: "Any equipment problems have been stated" },
    { code: "RECOVERY_CONCERNS", text: "Surgeon, anaesthetist and nurse have reviewed recovery and management concerns" },
  ],
};

/** The items that must be answered before a stage counts as complete. */
function required(stage: Stage): string[] {
  return CHECKLIST[stage].map((i) => i.code);
}

export interface TheatreCase {
  id: string;
  facility_id: number;
  patient_mrn: string;
  theatre_code: string | null;
  encounter_id: string | null;
  admission_id: string | null;
  source: "elective" | "casualty" | "ward" | "maternity" | "referral";
  attendance_id: string | null;
  urgency: Urgency;
  procedure_planned: string;
  procedure_code: string | null;
  laterality: Laterality | null;
  surgeon_id: number | null;
  surgeon_name: string;
  anaesthetist_name: string;
  anaesthesia: Anaesthesia | null;
  scheduled_for: string | null;
  estimated_minutes: number | null;
  status: CaseStatus;
  sign_in_at: string | null;
  time_out_at: string | null;
  sign_out_at: string | null;
  incision_at: string | null;
  closed_at: string | null;
  procedure_performed: string;
  findings: string;
  blood_loss_ml: number | null;
  specimen: string;
  implant: string;
  complications: string;
  asa_grade: number | null;
  cancel_reason: string;
  cancel_category: CancelCategory | null;
  cancelled_at: string | null;
  booked_by: number | null;
  booker_name: string;
  device_code: string | null;
  created_at: string;
}

// ------------------------------------------------------------------ theatres

export function defineTheatre(input: {
  facilityId: number;
  code: string;
  name: string;
  capability?: string;
}): void {
  run(
    `INSERT INTO theatres (code, facility_id, name, capability, active, created_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name, capability = excluded.capability`,
    input.code.trim().toUpperCase(),
    input.facilityId,
    input.name.trim(),
    input.capability?.trim() ?? "",
    now(),
  );
}

export function listTheatres(facilityId: number) {
  return all<{ code: string; name: string; capability: string; active: number }>(
    `SELECT * FROM theatres WHERE facility_id = ? AND active = 1 ORDER BY code`,
    facilityId,
  );
}

// ------------------------------------------------------------------- booking

export function bookCase(input: {
  facilityId: number;
  patientMrn: string;
  procedurePlanned: string;
  urgency: Urgency;
  theatreCode?: string;
  source?: TheatreCase["source"];
  attendanceId?: string | null;
  encounterId?: string | null;
  admissionId?: string | null;
  laterality?: Laterality;
  procedureCode?: string;
  surgeonId?: number | null;
  surgeonName?: string;
  anaesthetistName?: string;
  anaesthesia?: Anaesthesia;
  scheduledFor?: string;
  estimatedMinutes?: number;
  asaGrade?: number;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new TheatreError("no such patient");
  if (!input.procedurePlanned.trim()) {
    throw new TheatreError("a case must name the procedure — it is what the consent and the checklist are read against");
  }
  if (input.theatreCode) {
    const theatre = get<{ code: string }>(`SELECT code FROM theatres WHERE code = ?`, input.theatreCode.trim().toUpperCase());
    if (!theatre) throw new TheatreError(`no such theatre ${input.theatreCode}`);
  }
  if (input.asaGrade !== undefined && (input.asaGrade < 1 || input.asaGrade > 6)) {
    throw new TheatreError("ASA grade runs from 1 to 6");
  }

  const id = mintLocalId(input.deviceCode, 8);

  return tx(() => {
    run(
      `INSERT INTO theatre_cases
         (id, facility_id, patient_mrn, theatre_code, encounter_id, admission_id, source,
          attendance_id, urgency, procedure_planned, procedure_code, laterality, surgeon_id,
          surgeon_name, anaesthetist_name, anaesthesia, scheduled_for, estimated_minutes,
          asa_grade, status, booked_by, booker_name, device_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?, ?, ?, ?)`,
      id,
      input.facilityId,
      patient.mrn,
      input.theatreCode?.trim().toUpperCase() ?? null,
      input.encounterId ?? null,
      input.admissionId ?? null,
      input.source ?? "elective",
      input.attendanceId ?? null,
      input.urgency,
      input.procedurePlanned.trim(),
      input.procedureCode?.trim() ?? null,
      input.laterality ?? null,
      input.surgeonId ?? null,
      input.surgeonName?.trim() ?? "",
      input.anaesthetistName?.trim() ?? "",
      input.anaesthesia ?? null,
      input.scheduledFor ?? null,
      input.estimatedMinutes ?? null,
      input.asaGrade ?? null,
      input.byUserId,
      input.byUserName,
      input.deviceCode,
      now(),
    );

    if (input.urgency === "immediate") {
      notify({
        facilityId: input.facilityId,
        ownerRole: "clinician",
        severity: "critical",
        kind: "theatre_immediate",
        subject: `Immediate case booked — ${input.procedurePlanned.trim()}`,
        body: `To theatre within ${URGENCY_TARGET_HOURS.immediate} hour. Confirm the anaesthetist and the blood.`,
        entity: "theatre_case",
        entityId: id,
        dedupeKey: `theatre_immediate:${id}`,
      });
    }

    audit({
      action: "theatre_case_booked",
      entity: "theatre_case",
      entityId: id,
      patientId: patient.mrn,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: {
        procedure: input.procedurePlanned,
        urgency: input.urgency,
        laterality: input.laterality ?? null,
        source: input.source ?? "elective",
      },
    });
    return id;
  });
}

export function getCase(id: string): TheatreCase | undefined {
  return get<TheatreCase>(`SELECT * FROM theatre_cases WHERE id = ?`, id);
}

export function casesFor(patientMrn: string): TheatreCase[] {
  return all<TheatreCase>(`SELECT * FROM theatre_cases WHERE patient_mrn = ? ORDER BY created_at DESC`, patientMrn);
}

// -------------------------------------------------------------------- consent

/**
 * Record surgical consent for this specific procedure.
 *
 * Separate from the general treatment consent, and tied to the procedure text,
 * so that consent for one operation cannot silently cover another.
 */
export function recordSurgicalConsent(input: {
  caseId: string;
  consentedProcedure?: string;
  risksDiscussed: string;
  byUserId: number;
  byUserName: string;
}): void {
  const theatreCase = getCase(input.caseId);
  if (!theatreCase) throw new TheatreError("no such case");
  if (!input.risksDiscussed.trim()) {
    throw new TheatreError("consent must record what risks were discussed — a signature against nothing is not consent");
  }

  const procedure = input.consentedProcedure?.trim() || theatreCase.procedure_planned;
  sign({
    entity: "theatre_case",
    entityId: theatreCase.id,
    purpose: "surgical_consent",
    // The signed content is the procedure and the risks, so a later change to
    // either one no longer matches the signature.
    content: `${procedure}|${theatreCase.laterality ?? "not_applicable"}|${input.risksDiscussed.trim()}`,
    byUserId: input.byUserId,
    byUserName: input.byUserName,
  });
}

export function consentFor(caseId: string) {
  return signedFor("theatre_case", caseId, "surgical_consent");
}

// ------------------------------------------------------------------ the team

export function addTeamMember(input: {
  caseId: string;
  role: string;
  personName: string;
  userId?: number | null;
}): void {
  if (!input.personName.trim()) throw new TheatreError("a team member needs a name");
  run(
    `INSERT INTO theatre_team (case_id, role, person_name, user_id) VALUES (?, ?, ?, ?)
     ON CONFLICT(case_id, role, person_name) DO NOTHING`,
    input.caseId,
    input.role.trim(),
    input.personName.trim(),
    input.userId ?? null,
  );
}

export function teamFor(caseId: string) {
  return all<{ role: string; person_name: string }>(
    `SELECT role, person_name FROM theatre_team WHERE case_id = ? ORDER BY id`,
    caseId,
  );
}

// -------------------------------------------------------------- the checklist

/**
 * Answer one checklist item.
 *
 * A "no" on a critical item is recorded and escalated, never refused. Software
 * that blocks on a "no" teaches a team to answer yes, which is worse than
 * having no checklist at all.
 */
export function answerChecklist(input: {
  caseId: string;
  stage: Stage;
  itemCode: string;
  answer: Answer;
  note?: string;
  byUserId: number | null;
  byUserName: string;
}): { escalated: boolean } {
  const theatreCase = getCase(input.caseId);
  if (!theatreCase) throw new TheatreError("no such case");
  if (theatreCase.status === "cancelled") throw new TheatreError("that case was cancelled");

  const code = input.itemCode.trim().toUpperCase();
  const item = CHECKLIST[input.stage].find((i) => i.code === code);
  if (!item) throw new TheatreError(`${code} is not an item on the ${input.stage.replace("_", " ")}`);

  const escalated = input.answer === "no" && Boolean(item.critical);

  return tx(() => {
    run(
      `INSERT INTO checklist_answers
         (case_id, stage, item_code, answer, note, answered_by, answerer_name, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(case_id, stage, item_code) DO UPDATE SET
         answer = excluded.answer, note = excluded.note, answered_by = excluded.answered_by,
         answerer_name = excluded.answerer_name, answered_at = excluded.answered_at`,
      theatreCase.id,
      input.stage,
      code,
      input.answer,
      input.note?.trim() ?? "",
      input.byUserId,
      input.byUserName,
      now(),
    );

    if (escalated) {
      notify({
        facilityId: theatreCase.facility_id,
        ownerRole: "clinician",
        severity: "critical",
        kind: "checklist_no",
        subject: `Checklist "no" in theatre — ${item.text}`,
        body: `${theatreCase.procedure_planned}. Recorded, not blocked: the decision to proceed is the surgeon's, and this is the record that it was known.`,
        entity: "theatre_case",
        entityId: theatreCase.id,
        dedupeKey: `checklist_no:${theatreCase.id}:${code}`,
      });
    }

    audit({
      action: "checklist_answered",
      entity: "theatre_case",
      entityId: theatreCase.id,
      patientId: theatreCase.patient_mrn,
      facilityId: theatreCase.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { stage: input.stage, item: code, answer: input.answer, escalated },
    });

    return { escalated };
  });
}

export function checklistAnswers(caseId: string, stage?: Stage) {
  const clause = stage ? `AND stage = ?` : "";
  const params: (string | number)[] = stage ? [stage] : [];
  return all<{
    stage: Stage;
    item_code: string;
    answer: Answer;
    note: string;
    answerer_name: string;
    answered_at: string;
  }>(
    `SELECT stage, item_code, answer, note, answerer_name, answered_at
       FROM checklist_answers WHERE case_id = ? ${clause} ORDER BY id`,
    caseId,
    ...params,
  );
}

/** Which items on a stage are still unanswered. */
export function checklistOutstanding(caseId: string, stage: Stage): ChecklistItem[] {
  const answered = new Set(checklistAnswers(caseId, stage).map((a) => a.item_code));
  return CHECKLIST[stage].filter((i) => !answered.has(i.code));
}

/**
 * Complete a checklist stage.
 *
 * Refuses while any item is unanswered. "Not applicable" is an answer; silence
 * is not.
 */
export function completeStage(input: {
  caseId: string;
  stage: Stage;
  at?: string;
  byUserId: number;
  byUserName: string;
}): void {
  const theatreCase = getCase(input.caseId);
  if (!theatreCase) throw new TheatreError("no such case");

  const outstanding = checklistOutstanding(theatreCase.id, input.stage);
  if (outstanding.length > 0) {
    throw new TheatreError(
      `${outstanding.length} item${outstanding.length === 1 ? "" : "s"} on the ${input.stage.replace("_", " ")} not answered: ${outstanding
        .map((i) => i.text)
        .join("; ")}`,
    );
  }

  // Sign-out additionally requires the count to reconcile. This is the gate
  // that stands between a theatre and a retained swab.
  if (input.stage === "sign_out") {
    const bad = countDiscrepancies(theatreCase.id);
    if (bad.length > 0) {
      throw new TheatreError(
        `the count does not reconcile: ${bad
          .map((c) => `${c.item} ${c.counted_in} in, ${c.counted_out ?? "none"} out`)
          .join("; ")}. Resolve it and record how — the patient does not leave theatre on an unreconciled count.`,
      );
    }
  }

  const column = { sign_in: "sign_in_at", time_out: "time_out_at", sign_out: "sign_out_at" }[input.stage];
  const at = input.at ?? now();

  tx(() => {
    run(`UPDATE theatre_cases SET ${column} = ? WHERE id = ?`, at, theatreCase.id);

    const answers = checklistAnswers(theatreCase.id, input.stage);
    sign({
      entity: "theatre_case",
      entityId: theatreCase.id,
      purpose: `checklist_${input.stage}`,
      content: answers.map((a) => `${a.item_code}=${a.answer}`).join("|"),
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });

    audit({
      action: `checklist_${input.stage}`,
      entity: "theatre_case",
      entityId: theatreCase.id,
      patientId: theatreCase.patient_mrn,
      facilityId: theatreCase.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: {
        stage: input.stage,
        answers: answers.length,
        noes: answers.filter((a) => a.answer === "no").length,
      },
    });
  });
}

// ------------------------------------------------------------------ the count

export function recordCountIn(input: {
  caseId: string;
  item: string;
  count: number;
  byUserId: number | null;
  byUserName: string;
}): void {
  if (!Number.isInteger(input.count) || input.count < 0) throw new TheatreError("a count must be a whole number");
  run(
    `INSERT INTO theatre_counts (case_id, item, counted_in, counted_by, counter_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(case_id, item) DO UPDATE SET counted_in = excluded.counted_in, updated_at = excluded.updated_at`,
    input.caseId,
    input.item.trim(),
    input.count,
    input.byUserId,
    input.byUserName,
    now(),
  );
}

export function recordCountOut(input: {
  caseId: string;
  item: string;
  count: number;
  byUserId: number | null;
  byUserName: string;
}): { reconciles: boolean } {
  const theatreCase = getCase(input.caseId);
  if (!theatreCase) throw new TheatreError("no such case");

  const row = get<{ counted_in: number }>(
    `SELECT counted_in FROM theatre_counts WHERE case_id = ? AND item = ?`,
    input.caseId,
    input.item.trim(),
  );
  if (!row) throw new TheatreError(`${input.item} was never counted in — there is nothing to count out against`);
  if (!Number.isInteger(input.count) || input.count < 0) throw new TheatreError("a count must be a whole number");

  const reconciles = input.count === row.counted_in;

  return tx(() => {
    run(
      `UPDATE theatre_counts SET counted_out = ?, counted_by = ?, counter_name = ?, updated_at = ?
        WHERE case_id = ? AND item = ?`,
      input.count,
      input.byUserId,
      input.byUserName,
      now(),
      input.caseId,
      input.item.trim(),
    );

    if (!reconciles) {
      notify({
        facilityId: theatreCase.facility_id,
        ownerRole: "clinician",
        severity: "critical",
        kind: "count_mismatch",
        subject: `COUNT DOES NOT RECONCILE — ${input.item}: ${row.counted_in} in, ${input.count} out`,
        body: "Nobody leaves theatre. Search, image if needed, and record how it was resolved.",
        entity: "theatre_case",
        entityId: theatreCase.id,
        dedupeKey: `count_mismatch:${theatreCase.id}:${input.item}`,
      });
      audit({
        action: "count_mismatch",
        entity: "theatre_case",
        entityId: theatreCase.id,
        patientId: theatreCase.patient_mrn,
        facilityId: theatreCase.facility_id,
        actorId: input.byUserId,
        actorName: input.byUserName,
        purpose: "treatment",
        detail: { item: input.item, countedIn: row.counted_in, countedOut: input.count },
      });
    }

    return { reconciles };
  });
}

/**
 * Resolve a discrepancy by recording how — never by changing the numbers.
 *
 * The counts stay as they were found. That is the point: the record has to
 * show that there was a discrepancy and what was done about it.
 */
export function resolveCount(input: {
  caseId: string;
  item: string;
  resolution: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  if (!input.resolution.trim()) {
    throw new TheatreError("resolving a count discrepancy must record how — the numbers themselves are never edited");
  }
  const row = get<{ counted_in: number; counted_out: number | null }>(
    `SELECT counted_in, counted_out FROM theatre_counts WHERE case_id = ? AND item = ?`,
    input.caseId,
    input.item.trim(),
  );
  if (!row) throw new TheatreError(`no count recorded for ${input.item}`);

  tx(() => {
    run(
      `UPDATE theatre_counts SET resolution = ?, updated_at = ? WHERE case_id = ? AND item = ?`,
      input.resolution.trim(),
      now(),
      input.caseId,
      input.item.trim(),
    );
    audit({
      action: "count_resolved",
      entity: "theatre_case",
      entityId: input.caseId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { item: input.item, countedIn: row.counted_in, countedOut: row.counted_out, resolution: input.resolution },
    });
  });
}

export function counts(caseId: string) {
  return all<{
    item: string;
    counted_in: number;
    counted_out: number | null;
    resolution: string;
    counter_name: string;
  }>(`SELECT * FROM theatre_counts WHERE case_id = ? ORDER BY item`, caseId);
}

/** Counts that do not reconcile and have not been resolved. */
export function countDiscrepancies(caseId: string) {
  return counts(caseId).filter((c) => c.counted_out !== c.counted_in && !c.resolution.trim());
}

// ------------------------------------------------------------- the operation

const NEXT: Record<CaseStatus, CaseStatus[]> = {
  booked: ["sent_for", "in_theatre", "cancelled"],
  sent_for: ["in_theatre", "cancelled"],
  in_theatre: ["anaesthetised", "cancelled"],
  anaesthetised: ["incised", "cancelled"],
  incised: ["closed"],
  closed: ["in_recovery", "completed"],
  in_recovery: ["completed"],
  completed: [],
  cancelled: [],
};

function move(theatreCase: TheatreCase, to: CaseStatus): void {
  if (!NEXT[theatreCase.status].includes(to)) {
    throw new TheatreError(
      `a case that is ${theatreCase.status.replace(/_/g, " ")} cannot become ${to.replace(/_/g, " ")}${
        NEXT[theatreCase.status].length ? "" : " — it is finished"
      }`,
    );
  }
  run(`UPDATE theatre_cases SET status = ? WHERE id = ?`, to, theatreCase.id);
}

export function sendFor(input: { caseId: string; byUserId: number | null; byUserName: string }): void {
  const theatreCase = getCase(input.caseId);
  if (!theatreCase) throw new TheatreError("no such case");
  move(theatreCase, "sent_for");
}

export function arriveInTheatre(input: { caseId: string; byUserId: number | null; byUserName: string }): void {
  const theatreCase = getCase(input.caseId);
  if (!theatreCase) throw new TheatreError("no such case");
  move(theatreCase, "in_theatre");
}

/** Anaesthesia. Gated on sign-in and on consent. */
export function startAnaesthesia(input: {
  caseId: string;
  anaesthesia: Anaesthesia;
  anaesthetistName: string;
  byUserId: number;
  byUserName: string;
}): void {
  const theatreCase = getCase(input.caseId);
  if (!theatreCase) throw new TheatreError("no such case");
  if (!theatreCase.sign_in_at) {
    throw new TheatreError("the sign-in has not been completed — anaesthesia does not start before it");
  }
  if (!consentFor(theatreCase.id)) {
    throw new TheatreError("there is no recorded surgical consent for this case");
  }

  tx(() => {
    move(theatreCase, "anaesthetised");
    run(
      `UPDATE theatre_cases SET anaesthesia = ?, anaesthetist_name = ? WHERE id = ?`,
      input.anaesthesia,
      input.anaesthetistName.trim(),
      theatreCase.id,
    );
  });
}

/** Incision. Gated on time-out. */
export function recordIncision(input: {
  caseId: string;
  at?: string;
  byUserId: number;
  byUserName: string;
}): void {
  const theatreCase = getCase(input.caseId);
  if (!theatreCase) throw new TheatreError("no such case");
  if (!theatreCase.time_out_at) {
    throw new TheatreError(
      "the time-out has not been completed — the knife does not touch the patient before the team has confirmed who this is, what is being done and where",
    );
  }

  tx(() => {
    move(theatreCase, "incised");
    run(`UPDATE theatre_cases SET incision_at = ? WHERE id = ?`, input.at ?? now(), theatreCase.id);
    audit({
      action: "theatre_incision",
      entity: "theatre_case",
      entityId: theatreCase.id,
      patientId: theatreCase.patient_mrn,
      facilityId: theatreCase.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { procedure: theatreCase.procedure_planned },
    });
  });
}

/**
 * Close, and write the operation note.
 *
 * `procedurePerformed` is separate from `procedure_planned` on purpose. If they
 * differ, that is a deviation from consent and is recorded and escalated as
 * one — the planned procedure is never edited to match what happened.
 */
export function closeCase(input: {
  caseId: string;
  procedurePerformed: string;
  findings: string;
  bloodLossMl?: number;
  specimen?: string;
  implant?: string;
  complications?: string;
  at?: string;
  byUserId: number;
  byUserName: string;
}): { deviated: boolean } {
  const theatreCase = getCase(input.caseId);
  if (!theatreCase) throw new TheatreError("no such case");
  if (!input.procedurePerformed.trim()) throw new TheatreError("the operation note must say what was done");
  if (!input.findings.trim()) throw new TheatreError("the operation note must record the findings");

  const performed = input.procedurePerformed.trim();
  const deviated = performed.toLowerCase() !== theatreCase.procedure_planned.toLowerCase();

  return tx(() => {
    move(theatreCase, "closed");
    run(
      `UPDATE theatre_cases
          SET procedure_performed = ?, findings = ?, blood_loss_ml = ?, specimen = ?,
              implant = ?, complications = ?, closed_at = ?
        WHERE id = ?`,
      performed,
      input.findings.trim(),
      input.bloodLossMl ?? null,
      input.specimen?.trim() ?? "",
      input.implant?.trim() ?? "",
      input.complications?.trim() ?? "",
      input.at ?? now(),
      theatreCase.id,
    );

    sign({
      entity: "theatre_case",
      entityId: theatreCase.id,
      purpose: "operation_note",
      content: `${performed}|${input.findings.trim()}|${input.specimen?.trim() ?? ""}|${input.implant?.trim() ?? ""}`,
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });

    if (deviated) {
      notify({
        facilityId: theatreCase.facility_id,
        ownerRole: "clinician",
        severity: "warning",
        kind: "procedure_deviation",
        subject: `Procedure differs from what was consented — planned "${theatreCase.procedure_planned}", performed "${performed}"`,
        body: "Recorded as a deviation. The planned procedure is not edited to match; both stand, and the reason belongs in the findings.",
        entity: "theatre_case",
        entityId: theatreCase.id,
        dedupeKey: `procedure_deviation:${theatreCase.id}`,
      });
    }

    audit({
      action: "theatre_case_closed",
      entity: "theatre_case",
      entityId: theatreCase.id,
      patientId: theatreCase.patient_mrn,
      facilityId: theatreCase.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: {
        planned: theatreCase.procedure_planned,
        performed,
        deviated,
        bloodLossMl: input.bloodLossMl ?? null,
        implant: input.implant ?? null,
        minutes: theatreCase.incision_at
          ? Math.round((Date.parse(input.at ?? now()) - Date.parse(theatreCase.incision_at)) / 60_000)
          : null,
      },
    });

    return { deviated };
  });
}

/** Out of theatre. Requires the sign-out, which requires the count. */
export function leaveTheatre(input: {
  caseId: string;
  toRecovery?: boolean;
  byUserId: number | null;
  byUserName: string;
}): void {
  const theatreCase = getCase(input.caseId);
  if (!theatreCase) throw new TheatreError("no such case");
  if (!theatreCase.sign_out_at) {
    throw new TheatreError("the sign-out has not been completed — the patient does not leave theatre before it");
  }
  move(theatreCase, input.toRecovery === false ? "completed" : "in_recovery");
}

export function completeCase(input: { caseId: string; byUserId: number | null; byUserName: string }): void {
  const theatreCase = getCase(input.caseId);
  if (!theatreCase) throw new TheatreError("no such case");
  move(theatreCase, "completed");
}

export function cancelCase(input: {
  caseId: string;
  category: CancelCategory;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const theatreCase = getCase(input.caseId);
  if (!theatreCase) throw new TheatreError("no such case");
  if (!input.reason.trim()) throw new TheatreError("a cancellation must record why");

  tx(() => {
    move(theatreCase, "cancelled");
    run(
      `UPDATE theatre_cases SET cancel_reason = ?, cancel_category = ?, cancelled_at = ? WHERE id = ?`,
      input.reason.trim(),
      input.category,
      now(),
      theatreCase.id,
    );
    audit({
      action: "theatre_case_cancelled",
      entity: "theatre_case",
      entityId: theatreCase.id,
      patientId: theatreCase.patient_mrn,
      facilityId: theatreCase.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { category: input.category, reason: input.reason, wasStatus: theatreCase.status },
    });
  });
}

// ------------------------------------------------------------------ the list

export interface ListRow {
  theatreCase: TheatreCase;
  patientName: string;
  theatreName: string | null;
  consented: boolean;
  signInDone: boolean;
  timeOutDone: boolean;
  signOutDone: boolean;
  countOutstanding: number;
  /** What the case is waiting for, in the words a theatre uses. */
  blockedBy: string | null;
}

function blockedBy(row: ListRow): string | null {
  const c = row.theatreCase;
  if (c.status === "cancelled" || c.status === "completed") return null;
  if (!row.consented) return "no recorded consent";
  // An autoclave past its pressure test is not a maintenance backlog item, it
  // is a theatre that should not open. Asked here rather than shown on the
  // estates screen, because a rule nobody asks is a rule nobody follows.
  //
  // Only until the patient is anaesthetised. After that the operation is
  // happening or has happened, and telling the list that a finished case is
  // blocked by a service schedule is noise that teaches everybody to ignore
  // the column.
  if (c.theatre_code && (c.status === "booked" || c.status === "sent_for" || c.status === "in_theatre")) {
    const equipment = equipmentBlock("theatre", c.theatre_code);
    if (equipment) return equipment;
  }
  if (c.status === "in_theatre" && !row.signInDone) return "sign-in not complete";
  if (c.status === "anaesthetised" && !row.timeOutDone) return "time-out not complete";
  if (c.status === "closed" && row.countOutstanding > 0) return "count does not reconcile";
  if (c.status === "closed" && !row.signOutDone) return "sign-out not complete";
  return null;
}

function decorate(rows: (TheatreCase & { patient_name: string; theatre_name: string | null })[]): ListRow[] {
  return rows.map((c) => {
    const row: ListRow = {
      theatreCase: c,
      patientName: c.patient_name,
      theatreName: c.theatre_name,
      consented: Boolean(consentFor(c.id)),
      signInDone: Boolean(c.sign_in_at),
      timeOutDone: Boolean(c.time_out_at),
      signOutDone: Boolean(c.sign_out_at),
      countOutstanding: countDiscrepancies(c.id).length,
      blockedBy: null,
    };
    row.blockedBy = blockedBy(row);
    return row;
  });
}

const URGENCY_ORDER: Record<Urgency, number> = { immediate: 0, urgent: 1, expedited: 2, elective: 3 };

/** The list for a day. Most urgent first, then in scheduled order. */
export function theatreList(facilityId: number, date = today()): ListRow[] {
  const rows = all<TheatreCase & { patient_name: string; theatre_name: string | null }>(
    `SELECT c.*, p.given_name || ' ' || p.family_name AS patient_name, t.name AS theatre_name
       FROM theatre_cases c
       JOIN patients p ON p.mrn = c.patient_mrn
       LEFT JOIN theatres t ON t.code = c.theatre_code
      WHERE c.facility_id = ?
        AND (substr(COALESCE(c.scheduled_for, c.created_at), 1, 10) = ?
             OR c.status IN ('sent_for','in_theatre','anaesthetised','incised','closed','in_recovery'))`,
    facilityId,
    date,
  );

  return decorate(rows).sort(
    (a, b) =>
      URGENCY_ORDER[a.theatreCase.urgency] - URGENCY_ORDER[b.theatreCase.urgency] ||
      (a.theatreCase.scheduled_for ?? "").localeCompare(b.theatreCase.scheduled_for ?? ""),
  );
}

/** Cases currently in a theatre, whatever day they were booked for. */
export function inTheatre(facilityId: number): ListRow[] {
  const rows = all<TheatreCase & { patient_name: string; theatre_name: string | null }>(
    `SELECT c.*, p.given_name || ' ' || p.family_name AS patient_name, t.name AS theatre_name
       FROM theatre_cases c
       JOIN patients p ON p.mrn = c.patient_mrn
       LEFT JOIN theatres t ON t.code = c.theatre_code
      WHERE c.facility_id = ? AND c.status IN ('in_theatre','anaesthetised','incised','closed','in_recovery')`,
    facilityId,
  );
  return decorate(rows);
}

export function caseLog(facilityId: number, limit = 50): ListRow[] {
  const rows = all<TheatreCase & { patient_name: string; theatre_name: string | null }>(
    `SELECT c.*, p.given_name || ' ' || p.family_name AS patient_name, t.name AS theatre_name
       FROM theatre_cases c
       JOIN patients p ON p.mrn = c.patient_mrn
       LEFT JOIN theatres t ON t.code = c.theatre_code
      WHERE c.facility_id = ?
      ORDER BY COALESCE(c.scheduled_for, c.created_at) DESC
      LIMIT ?`,
    facilityId,
    limit,
  );
  return decorate(rows);
}

export interface TheatreSummary {
  booked: number;
  completed: number;
  cancelled: number;
  /** Cancelled after the patient was already sent for or in theatre. */
  cancelledOnTheDay: number;
  cancellationRatePercent: number | null;
  byCancelCategory: Record<CancelCategory, number>;
  /** Completed cases where all three checklist stages were signed. */
  checklistCompliantPercent: number | null;
  /** Any "no" answered on a critical item, across all cases. */
  criticalNoes: number;
  countMismatches: number;
  deviations: number;
  medianKnifeToSkinMinutes: number | null;
}

export function theatreSummary(facilityId: number, from?: string, to?: string): TheatreSummary {
  const clause = from && to ? `AND substr(COALESCE(scheduled_for, created_at), 1, 10) BETWEEN ? AND ?` : "";
  const params: (string | number)[] = from && to ? [from, to] : [];

  const rows = all<TheatreCase>(`SELECT * FROM theatre_cases WHERE facility_id = ? ${clause}`, facilityId, ...params);
  const ids = rows.map((r) => r.id);

  const byCancelCategory: Record<CancelCategory, number> = {
    no_theatre_time: 0, no_surgeon: 0, no_anaesthetist: 0, no_bed: 0, patient_unfit: 0,
    patient_did_not_attend: 0, no_blood: 0, no_equipment: 0, no_consent: 0, other: 0,
  };
  for (const r of rows) if (r.cancel_category) byCancelCategory[r.cancel_category]++;

  const completed = rows.filter((r) => r.status === "completed");
  const compliant = completed.filter((r) => r.sign_in_at && r.time_out_at && r.sign_out_at);

  const durations = rows
    .filter((r) => r.incision_at && r.closed_at)
    .map((r) => Math.round((Date.parse(r.closed_at!) - Date.parse(r.incision_at!)) / 60_000))
    .sort((a, b) => a - b);

  const criticalCodes = new Set(
    (["sign_in", "time_out", "sign_out"] as Stage[]).flatMap((s) =>
      CHECKLIST[s].filter((i) => i.critical).map((i) => i.code),
    ),
  );
  const noes = ids.length
    ? all<{ item_code: string }>(
        `SELECT item_code FROM checklist_answers
          WHERE answer = 'no' AND case_id IN (${ids.map(() => "?").join(",")})`,
        ...ids,
      ).filter((a) => criticalCodes.has(a.item_code)).length
    : 0;

  const mismatches = ids.length
    ? get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM theatre_counts
          WHERE counted_out IS NOT NULL AND counted_out <> counted_in
            AND case_id IN (${ids.map(() => "?").join(",")})`,
        ...ids,
      )!.n
    : 0;

  const cancelled = rows.filter((r) => r.status === "cancelled");

  // "On the day" means the patient had already been called for, or the
  // cancellation fell on the date the case was scheduled for. That is the
  // cancellation a theatre manager is actually asked about: a list cancelled
  // a week ahead costs paperwork, one cancelled at the door costs a bed, a
  // fasted patient and a slot nobody else can use.
  const onTheDay = cancelled.filter(
    (r) =>
      Boolean(r.sign_in_at) ||
      (r.cancelled_at !== null &&
        r.scheduled_for !== null &&
        r.cancelled_at.slice(0, 10) === r.scheduled_for.slice(0, 10)),
  );

  return {
    booked: rows.length,
    completed: completed.length,
    cancelled: cancelled.length,
    cancelledOnTheDay: onTheDay.length,
    cancellationRatePercent: rows.length === 0 ? null : Math.round((cancelled.length / rows.length) * 1000) / 10,
    byCancelCategory,
    checklistCompliantPercent:
      completed.length === 0 ? null : Math.round((compliant.length / completed.length) * 1000) / 10,
    criticalNoes: noes,
    countMismatches: mismatches,
    deviations: rows.filter(
      (r) => r.procedure_performed && r.procedure_performed.toLowerCase() !== r.procedure_planned.toLowerCase(),
    ).length,
    medianKnifeToSkinMinutes: durations.length === 0 ? null : durations[Math.floor(durations.length / 2)],
  };
}

/** ⚠️ Demonstration theatres. A real facility defines its own at commissioning. */
export function seedTheatres(facilityId: number): void {
  defineTheatre({ facilityId, code: "OT1", name: "Main theatre", capability: "General surgery, obstetrics, orthopaedics" });
  defineTheatre({ facilityId, code: "OT2", name: "Minor theatre", capability: "Minor procedures under local anaesthesia" });
}
