/**
 * M32 Radiology.
 *
 * Built on the same `orders` row the laboratory uses — an imaging request IS
 * an order, and giving a facility a second worklist would give it two ideas of
 * what is outstanding. What this module adds is everything that makes imaging
 * different from a blood test.
 *
 * The difference is that you cannot un-expose somebody.
 *
 *  NOTHING IONISING HAPPENS WITHOUT A JUSTIFICATION AND, WHERE IT APPLIES, A
 *  PREGNANCY CHECK. Both are enforced before `performStudy`, not collected
 *  afterwards. Justification before exposure is what the Radiation Protection
 *  Act and the IAEA standards require, and a justification recorded after the
 *  film is a different thing with the same name. The pregnancy question is
 *  asked of any woman who could be pregnant; "not applicable" is an answer and
 *  has to say why.
 *
 *  A POSSIBLE PREGNANCY DOES NOT BLOCK THE SCAN — IT ESCALATES IT. A chest
 *  film in a shocked trauma patient who might be pregnant is still the right
 *  film. Blocking teaches people to answer "not pregnant" to get past the
 *  screen, which is how the question stops being asked at all. The module
 *  records the answer truthfully, raises it, and leaves the decision with the
 *  practitioner who signs the justification.
 *
 *  DOSE IS CUMULATIVE AND PER PATIENT. "How much has this child had this year"
 *  is the question nobody can answer, because dose is recorded per study and
 *  never summed. Here it is summed.
 *
 *  A CRITICAL FINDING IS COMMUNICATED TO A NAMED PERSON AT A RECORDED TIME.
 *  Exactly as a panic laboratory value is. "It was in the report" is not
 *  communication, and a pneumothorax found at 2am is not a filing problem.
 *
 *  A FINAL REPORT THAT DISAGREES WITH THE PROVISIONAL ONE IS A DISCREPANCY,
 *  AND IS KEPT AS ONE. The provisional read is what the ward acted on
 *  overnight. If the radiologist disagrees in the morning, that difference is
 *  the most useful thing in the module: it is how a department learns, and
 *  overwriting the provisional report destroys it.
 *
 * ⚠️ The dose reference levels, the MRI safety questions and the modality
 * classification all need a radiographer's and a radiologist's sign-off, and
 * the facility's radiation licence sits with the national regulator, not with
 * this software.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { resolvePatient } from "./patients.ts";
import { notify } from "./notifications.ts";
import { getOrder, setOrderStatus } from "./orders.ts";
import { licenceStatus } from "./access.ts";
import { sign } from "./documents.ts";

export class RadiologyError extends Error {}

export type Modality = "xray" | "ultrasound" | "ct" | "mri" | "fluoroscopy" | "mammography";
export type StudyStatus =
  | "requested"
  | "justified"
  | "scheduled"
  | "performed"
  | "reported"
  | "verified"
  | "cancelled";
export type PregnancyCheck = "not_pregnant" | "possible" | "pregnant" | "not_applicable" | "declined";
export type ReportKind = "provisional" | "final" | "addendum";
export type Laterality = "left" | "right" | "bilateral" | "not_applicable";

/**
 * Which modalities use ionising radiation.
 *
 * Ultrasound and MRI do not, which is why neither needs a justification for
 * dose or a pregnancy check — and why MRI has a screening list of its own that
 * is far more dangerous to skip.
 */
export const IONISING: Record<Modality, boolean> = {
  xray: true,
  ct: true,
  fluoroscopy: true,
  mammography: true,
  ultrasound: false,
  mri: false,
};

export const MODALITY_LABEL: Record<Modality, string> = {
  xray: "X-ray",
  ultrasound: "Ultrasound",
  ct: "CT",
  mri: "MRI",
  fluoroscopy: "Fluoroscopy",
  mammography: "Mammography",
};

/**
 * Ages between which the pregnancy question is asked of a female patient.
 *
 * ⚠️ A convention, not a law. Set too narrow and somebody is missed; too wide
 * and the question becomes noise that gets clicked through. Needs a
 * radiographer's agreement.
 */
export const CHILDBEARING_AGE = { from: 12, to: 55 };

/**
 * Typical effective dose per study, in microsieverts.
 *
 * ⚠️ Order-of-magnitude figures used only where the equipment reports no dose
 * of its own, so that a cumulative total is not silently zero for a facility
 * with older machines. A unit that reports its own dose always wins. These must
 * be replaced with the facility's own measured values — they are illustrative.
 */
export const TYPICAL_DOSE_USV: Partial<Record<Modality, number>> = {
  xray: 100,
  ct: 7000,
  fluoroscopy: 3000,
  mammography: 400,
};

/**
 * MRI safety screening.
 *
 * ⚠️ A short form of the standard screening. A "yes" to any of the first four
 * stops the scan until a radiologist or MRI safety officer clears it — this is
 * the one place in the system where the module does block, because a pacemaker
 * in a magnet is not a risk to be weighed at the console.
 */
export const MRI_SCREENING: { code: string; text: string; blocking: boolean }[] = [
  { code: "PACEMAKER", text: "Pacemaker, implanted defibrillator or neurostimulator", blocking: true },
  { code: "ANEURYSM_CLIP", text: "Aneurysm clip or other intracranial metal", blocking: true },
  { code: "COCHLEAR", text: "Cochlear implant", blocking: true },
  { code: "METAL_EYE", text: "Metal fragment in the eye, or history of metalwork or welding", blocking: true },
  { code: "OTHER_IMPLANT", text: "Any other implant, prosthesis, stent or surgical clip", blocking: false },
  { code: "PREGNANT", text: "Pregnant, or possibly pregnant", blocking: false },
  { code: "CLAUSTROPHOBIA", text: "Claustrophobia, or unable to lie still for the scan", blocking: false },
];

export interface Study {
  id: string;
  order_id: string;
  patient_mrn: string;
  accession: string;
  modality: Modality;
  body_part: string;
  laterality: Laterality | null;
  justification: string;
  justified_by: number | null;
  justifier_name: string;
  pregnancy_check: PregnancyCheck | null;
  pregnancy_note: string;
  dose_ugy_m2: number | null;
  dose_usv: number | null;
  images: number | null;
  repeat_of: string | null;
  repeat_reason: string;
  status: StudyStatus;
  performed_at: string | null;
  performed_by: number | null;
  radiographer_name: string;
  equipment: string;
  cancel_reason: string;
  device_code: string | null;
  created_at: string;
}

// ------------------------------------------------------------------ helpers

/** Whole years, or null when the patient has no date of birth. */
function ageOf(patientMrn: string, asOf = today()): number | null {
  const patient = resolvePatient(patientMrn);
  if (!patient?.date_of_birth) return null;
  const years = (Date.parse(`${asOf}T00:00:00.000Z`) - Date.parse(`${patient.date_of_birth}T00:00:00.000Z`)) / (365.2425 * 86_400_000);
  return Math.floor(years);
}

/**
 * Whether this patient needs the pregnancy question before an ionising study.
 *
 * Errs towards asking: a female patient whose age is unknown is asked, because
 * an unknown date of birth is common and is not a reason to skip the question.
 */
export function needsPregnancyCheck(patientMrn: string, modality: Modality, asOf = today()): boolean {
  if (!IONISING[modality]) return false;
  const patient = resolvePatient(patientMrn);
  if (!patient || patient.sex !== "female") return false;
  const age = ageOf(patientMrn, asOf);
  if (age === null) return true;
  return age >= CHILDBEARING_AGE.from && age <= CHILDBEARING_AGE.to;
}

// ------------------------------------------------------------------ the study

/**
 * Open a study against an imaging order.
 *
 * The accession is minted here and is the number the images are filed under.
 */
export function openStudy(input: {
  orderId: string;
  modality: Modality;
  bodyPart: string;
  laterality?: Laterality;
  repeatOf?: string;
  repeatReason?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const order = getOrder(input.orderId);
  if (!order) throw new RadiologyError("no such order");
  if (order.kind !== "imaging") throw new RadiologyError("that order is not an imaging request");
  if (order.status === "cancelled") throw new RadiologyError("that order was cancelled");
  if (!input.bodyPart.trim()) throw new RadiologyError("a study must say what is being imaged");

  const existing = get<{ id: string }>(
    `SELECT id FROM imaging_studies WHERE order_id = ? AND status <> 'cancelled'`,
    order.id,
  );
  if (existing) throw new RadiologyError("a study is already open on that order");

  if (input.repeatOf && !getStudy(input.repeatOf)) throw new RadiologyError("no such study to repeat");
  if (input.repeatOf && !input.repeatReason?.trim()) {
    // A repeat is a second dose. Recording why is how a department finds out
    // that one machine, or one projection, is repeating far more than the rest.
    throw new RadiologyError("a repeat must record why the first study was not adequate");
  }

  const id = mintLocalId(input.deviceCode, 8);
  const accession = `${input.modality.toUpperCase().slice(0, 3)}-${id.split("-").pop()}`;

  return tx(() => {
    run(
      `INSERT INTO imaging_studies
         (id, order_id, patient_mrn, accession, modality, body_part, laterality,
          repeat_of, repeat_reason, status, device_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)`,
      id,
      order.id,
      order.patient_mrn,
      accession,
      input.modality,
      input.bodyPart.trim(),
      input.laterality ?? null,
      input.repeatOf ?? null,
      input.repeatReason?.trim() ?? "",
      input.deviceCode,
      now(),
    );
    audit({
      action: "imaging_study_opened",
      entity: "imaging_study",
      entityId: id,
      patientId: order.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { accession, modality: input.modality, bodyPart: input.bodyPart, repeatOf: input.repeatOf ?? null },
    });
    return id;
  });
}

export function getStudy(id: string): Study | undefined {
  return get<Study>(`SELECT * FROM imaging_studies WHERE id = ?`, id);
}

export function studyByAccession(accession: string): Study | undefined {
  return get<Study>(`SELECT * FROM imaging_studies WHERE accession = ?`, accession.trim().toUpperCase());
}

export function studiesFor(patientMrn: string): Study[] {
  return all<Study>(`SELECT * FROM imaging_studies WHERE patient_mrn = ? ORDER BY created_at DESC`, patientMrn);
}

/**
 * Justify the exposure, and answer the pregnancy question.
 *
 * A "possible" or "pregnant" answer is recorded and escalated, never refused:
 * blocking teaches people to answer "not pregnant" to get past the screen,
 * which is how the question stops being asked at all.
 */
export function justifyStudy(input: {
  studyId: string;
  justification: string;
  pregnancyCheck?: PregnancyCheck;
  pregnancyNote?: string;
  facilityId: number;
  byUserId: number;
  byUserName: string;
}): { escalated: boolean } {
  const study = getStudy(input.studyId);
  if (!study) throw new RadiologyError("no such study");
  if (study.status === "cancelled") throw new RadiologyError("that study was cancelled");
  if (!input.justification.trim()) {
    throw new RadiologyError(
      "an exposure must be justified before it happens — a justification written after the film is a different thing with the same name",
    );
  }

  const needs = needsPregnancyCheck(study.patient_mrn, study.modality);
  if (needs && !input.pregnancyCheck) {
    throw new RadiologyError(
      "this patient needs the pregnancy question answered before an ionising exposure — 'not applicable' is an answer, but it has to be given",
    );
  }
  if (input.pregnancyCheck === "not_applicable" && needs && !input.pregnancyNote?.trim()) {
    throw new RadiologyError("'not applicable' has to say why");
  }

  const escalated = input.pregnancyCheck === "possible" || input.pregnancyCheck === "pregnant";

  return tx(() => {
    run(
      `UPDATE imaging_studies
          SET justification = ?, justified_by = ?, justifier_name = ?,
              pregnancy_check = ?, pregnancy_note = ?,
              status = CASE WHEN status = 'requested' THEN 'justified' ELSE status END
        WHERE id = ?`,
      input.justification.trim(),
      input.byUserId,
      input.byUserName,
      input.pregnancyCheck ?? null,
      input.pregnancyNote?.trim() ?? "",
      study.id,
    );

    if (escalated) {
      notify({
        facilityId: input.facilityId,
        ownerRole: "clinician",
        severity: "critical",
        kind: "imaging_pregnancy",
        subject: `${MODALITY_LABEL[study.modality]} ${study.body_part} on a patient recorded as ${
          input.pregnancyCheck === "pregnant" ? "pregnant" : "possibly pregnant"
        }`,
        body: "Not blocked — a necessary film in a shocked patient is still the right film. Shield, justify, and use the lowest dose that answers the question.",
        entity: "imaging_study",
        entityId: study.id,
        dedupeKey: `imaging_pregnancy:${study.id}`,
      });
    }

    audit({
      action: "imaging_justified",
      entity: "imaging_study",
      entityId: study.id,
      patientId: study.patient_mrn,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: {
        modality: study.modality,
        ionising: IONISING[study.modality],
        justification: input.justification,
        pregnancyCheck: input.pregnancyCheck ?? null,
        escalated,
      },
    });

    return { escalated };
  });
}

// ---------------------------------------------------------- safety screening

export function answerSafetyCheck(input: {
  studyId: string;
  itemCode: string;
  answer: "yes" | "no" | "unknown";
  note?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const study = getStudy(input.studyId);
  if (!study) throw new RadiologyError("no such study");
  const code = input.itemCode.trim().toUpperCase();
  if (!MRI_SCREENING.some((i) => i.code === code)) {
    throw new RadiologyError(`${code} is not on the safety screening`);
  }

  run(
    `INSERT INTO imaging_safety_checks (study_id, item_code, answer, note, answered_by, answerer_name, answered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(study_id, item_code) DO UPDATE SET
       answer = excluded.answer, note = excluded.note, answered_by = excluded.answered_by,
       answerer_name = excluded.answerer_name, answered_at = excluded.answered_at`,
    study.id,
    code,
    input.answer,
    input.note?.trim() ?? "",
    input.byUserId,
    input.byUserName,
    now(),
  );
}

export function safetyChecks(studyId: string) {
  return all<{ item_code: string; answer: "yes" | "no" | "unknown"; note: string; answerer_name: string }>(
    `SELECT item_code, answer, note, answerer_name FROM imaging_safety_checks WHERE study_id = ? ORDER BY id`,
    studyId,
  );
}

/** Screening items not yet answered, and blocking answers that stop the scan. */
export function safetyState(studyId: string): {
  outstanding: string[];
  blocking: { code: string; text: string; answer: string }[];
} {
  const answers = new Map(safetyChecks(studyId).map((a) => [a.item_code, a.answer]));
  return {
    outstanding: MRI_SCREENING.filter((i) => !answers.has(i.code)).map((i) => i.code),
    blocking: MRI_SCREENING.filter(
      (i) => i.blocking && (answers.get(i.code) === "yes" || answers.get(i.code) === "unknown"),
    ).map((i) => ({ code: i.code, text: i.text, answer: answers.get(i.code)! })),
  };
}

// ---------------------------------------------------------- the exposure

/**
 * Record that the study was performed.
 *
 * The gates are here rather than at the console, because this is the moment
 * the record is made and the last one at which a refusal is still useful.
 */
export function performStudy(input: {
  studyId: string;
  radiographerName: string;
  equipment?: string;
  doseUgyM2?: number;
  doseUsv?: number;
  images?: number;
  at?: string;
  facilityId: number;
  byUserId: number;
  byUserName: string;
}): void {
  const study = getStudy(input.studyId);
  if (!study) throw new RadiologyError("no such study");
  if (study.status === "cancelled") throw new RadiologyError("that study was cancelled");
  if (study.performed_at) throw new RadiologyError("that study has already been performed");
  if (!input.radiographerName.trim()) {
    throw new RadiologyError("a study must record who performed it");
  }

  if (!study.justification.trim()) {
    throw new RadiologyError(
      "this study has not been justified — nothing is exposed before somebody has put their name to why",
    );
  }
  if (needsPregnancyCheck(study.patient_mrn, study.modality) && !study.pregnancy_check) {
    throw new RadiologyError("the pregnancy question has not been answered for this patient");
  }

  // MRI is the one place this module blocks outright. A pacemaker in a magnet
  // is not a risk to be weighed at the console.
  if (study.modality === "mri") {
    const state = safetyState(study.id);
    if (state.outstanding.length > 0) {
      throw new RadiologyError(
        `the MRI safety screening is not complete — ${state.outstanding.length} question${
          state.outstanding.length === 1 ? "" : "s"
        } unanswered`,
      );
    }
    if (state.blocking.length > 0) {
      throw new RadiologyError(
        `the MRI safety screening blocks this scan: ${state.blocking
          .map((b) => `${b.text} (${b.answer})`)
          .join("; ")}. A radiologist or the MRI safety officer must clear it.`,
      );
    }
  }

  // Where the equipment reports no dose, fall back to a typical figure so a
  // cumulative total is not silently zero for a facility with older machines.
  const dose = input.doseUsv ?? TYPICAL_DOSE_USV[study.modality] ?? null;

  tx(() => {
    run(
      `UPDATE imaging_studies
          SET status = 'performed', performed_at = ?, performed_by = ?, radiographer_name = ?,
              equipment = ?, dose_ugy_m2 = ?, dose_usv = ?, images = ?
        WHERE id = ?`,
      input.at ?? now(),
      input.byUserId,
      input.radiographerName.trim(),
      input.equipment?.trim() ?? "",
      input.doseUgyM2 ?? null,
      dose,
      input.images ?? null,
      study.id,
    );
    setOrderStatus({
      orderId: study.order_id,
      status: "in_progress",
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });
    audit({
      action: "imaging_performed",
      entity: "imaging_study",
      entityId: study.id,
      patientId: study.patient_mrn,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: {
        accession: study.accession,
        modality: study.modality,
        doseUsv: dose,
        doseEstimated: input.doseUsv === undefined && dose !== null,
        equipment: input.equipment ?? null,
      },
    });
  });
}

export function cancelStudy(input: {
  studyId: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const study = getStudy(input.studyId);
  if (!study) throw new RadiologyError("no such study");
  if (study.performed_at) throw new RadiologyError("that study has been performed and cannot be cancelled");
  if (!input.reason.trim()) throw new RadiologyError("cancelling a study must record why");

  run(
    `UPDATE imaging_studies SET status = 'cancelled', cancel_reason = ? WHERE id = ?`,
    input.reason.trim(),
    study.id,
  );
  audit({
    action: "imaging_cancelled",
    entity: "imaging_study",
    entityId: study.id,
    patientId: study.patient_mrn,
    actorId: input.byUserId,
    actorName: input.byUserName,
    purpose: "treatment",
    detail: { reason: input.reason },
  });
}

// ------------------------------------------------------------------ reports

/**
 * Report a study.
 *
 * A final report that disagrees with the provisional one is a discrepancy and
 * is kept as one: the provisional is what the ward acted on overnight, and
 * overwriting it destroys the most useful record a department has.
 */
export function reportStudy(input: {
  studyId: string;
  kind: ReportKind;
  findings: string;
  impression: string;
  critical?: boolean;
  discrepancy?: boolean;
  discrepancyNote?: string;
  facilityId: number;
  byUserId: number;
  byUserName: string;
}): string {
  const study = getStudy(input.studyId);
  if (!study) throw new RadiologyError("no such study");
  if (!study.performed_at) throw new RadiologyError("that study has not been performed — there is nothing to report");
  if (!input.findings.trim()) throw new RadiologyError("a report must record the findings");
  if (!input.impression.trim()) {
    throw new RadiologyError("a report must give an impression — findings without one leave the decision to the reader");
  }
  if (input.kind === "final" && input.discrepancy && !input.discrepancyNote?.trim()) {
    throw new RadiologyError("a discrepancy must say what the difference is, and what follows from it");
  }

  const existing = reportsFor(study.id);
  if (input.kind === "provisional" && existing.some((r) => r.kind === "provisional")) {
    throw new RadiologyError("there is already a provisional report — a correction is an addendum");
  }
  if (input.kind === "final" && existing.some((r) => r.kind === "final")) {
    throw new RadiologyError("there is already a final report — a correction is an addendum");
  }

  const id = mintLocalId(study.device_code ?? "RAD", 8);
  const licence = licenceStatus(input.byUserId);

  return tx(() => {
    run(
      `INSERT INTO imaging_reports
         (id, study_id, kind, findings, impression, critical, discrepancy, discrepancy_note,
          reported_by, reporter_name, reporter_licence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      study.id,
      input.kind,
      input.findings.trim(),
      input.impression.trim(),
      input.critical ? 1 : 0,
      input.discrepancy ? 1 : 0,
      input.discrepancyNote?.trim() ?? "",
      input.byUserId,
      input.byUserName,
      licence.state === "current" ? (licence.number ?? null) : null,
      now(),
    );

    run(
      `UPDATE imaging_studies SET status = ? WHERE id = ?`,
      input.kind === "final" ? "verified" : "reported",
      study.id,
    );

    if (input.kind === "final") {
      setOrderStatus({
        orderId: study.order_id,
        status: "resulted",
        byUserId: input.byUserId,
        byUserName: input.byUserName,
      });
    }

    sign({
      entity: "imaging_study",
      entityId: study.id,
      purpose: `imaging_report_${input.kind}`,
      content: `${input.findings.trim()}|${input.impression.trim()}`,
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });

    if (input.critical) {
      notify({
        facilityId: input.facilityId,
        ownerRole: "clinician",
        severity: "critical",
        kind: "imaging_critical",
        subject: `Critical imaging finding — ${study.accession} ${MODALITY_LABEL[study.modality]} ${study.body_part}: ${input.impression.trim()}`,
        body: "This needs telling to somebody by name, now. Filing it is not communicating it.",
        entity: "imaging_study",
        entityId: study.id,
        dedupeKey: `imaging_critical:${id}`,
      });
    }

    if (input.discrepancy) {
      notify({
        facilityId: input.facilityId,
        ownerRole: "clinician",
        severity: "warning",
        kind: "imaging_discrepancy",
        subject: `Final report differs from the provisional — ${study.accession}`,
        body: input.discrepancyNote?.trim() || "The ward acted on the provisional report overnight. Check what follows from the difference.",
        entity: "imaging_study",
        entityId: study.id,
        dedupeKey: `imaging_discrepancy:${id}`,
      });
    }

    audit({
      action: "imaging_reported",
      entity: "imaging_study",
      entityId: study.id,
      patientId: study.patient_mrn,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { kind: input.kind, critical: Boolean(input.critical), discrepancy: Boolean(input.discrepancy) },
    });

    return id;
  });
}

/**
 * Record that a critical finding was told to somebody, by name and at a time.
 *
 * Exactly as a panic laboratory value is. A report that says "urgent" and sits
 * unread has communicated nothing.
 */
export function recordCommunication(input: {
  reportId: string;
  communicatedTo: string;
  at?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const report = get<{ id: string; study_id: string; critical: number; communicated_at: string | null }>(
    `SELECT id, study_id, critical, communicated_at FROM imaging_reports WHERE id = ?`,
    input.reportId,
  );
  if (!report) throw new RadiologyError("no such report");
  if (!input.communicatedTo.trim()) {
    throw new RadiologyError("a critical finding is told to a person, not to a system — record who");
  }

  run(
    `UPDATE imaging_reports SET communicated_to = ?, communicated_at = ? WHERE id = ?`,
    input.communicatedTo.trim(),
    input.at ?? now(),
    report.id,
  );
  audit({
    action: "imaging_critical_communicated",
    entity: "imaging_study",
    entityId: report.study_id,
    actorId: input.byUserId,
    actorName: input.byUserName,
    purpose: "treatment",
    detail: { reportId: report.id, to: input.communicatedTo },
  });
}

export function reportsFor(studyId: string) {
  return all<{
    id: string;
    kind: ReportKind;
    findings: string;
    impression: string;
    critical: number;
    communicated_to: string;
    communicated_at: string | null;
    discrepancy: number;
    discrepancy_note: string;
    reporter_name: string;
    reporter_licence: string | null;
    created_at: string;
  }>(`SELECT * FROM imaging_reports WHERE study_id = ? ORDER BY created_at`, studyId);
}

// ------------------------------------------------------------------- dose

export interface DoseRecord {
  studyId: string;
  accession: string;
  modality: Modality;
  bodyPart: string;
  performedAt: string;
  doseUsv: number | null;
  estimated: boolean;
}

/**
 * Everything this patient has been exposed to, and the total.
 *
 * "How much has this child had this year" is the question nobody can answer,
 * because dose is recorded per study and never summed. Here it is summed, and
 * the answer says how much of it is estimated rather than measured.
 */
export function cumulativeDose(patientMrn: string, since?: string): {
  studies: DoseRecord[];
  totalUsv: number;
  measuredUsv: number;
  estimatedUsv: number;
} {
  const clause = since ? `AND performed_at >= ?` : "";
  const params: string[] = since ? [`${since}T00:00:00.000Z`] : [];

  const rows = all<Study>(
    `SELECT * FROM imaging_studies
      WHERE patient_mrn = ? AND performed_at IS NOT NULL AND status <> 'cancelled' ${clause}
      ORDER BY performed_at DESC`,
    patientMrn,
    ...params,
  ).filter((s) => IONISING[s.modality]);

  const studies: DoseRecord[] = rows.map((s) => ({
    studyId: s.id,
    accession: s.accession,
    modality: s.modality,
    bodyPart: s.body_part,
    performedAt: s.performed_at!,
    doseUsv: s.dose_usv,
    // A dose equal to the typical figure and no reported DAP is one we filled
    // in. Saying which is the difference between a number and a guess.
    estimated: s.dose_ugy_m2 === null && s.dose_usv === (TYPICAL_DOSE_USV[s.modality] ?? null),
  }));

  return {
    studies,
    totalUsv: studies.reduce((sum, s) => sum + (s.doseUsv ?? 0), 0),
    measuredUsv: studies.filter((s) => !s.estimated).reduce((sum, s) => sum + (s.doseUsv ?? 0), 0),
    estimatedUsv: studies.filter((s) => s.estimated).reduce((sum, s) => sum + (s.doseUsv ?? 0), 0),
  };
}

// --------------------------------------------------------------- worklists

export interface StudyRow {
  study: Study;
  patientName: string;
  priority: string;
  clinicalQuestion: string;
  ordererName: string;
  reports: ReturnType<typeof reportsFor>;
  /** What stands between this study and the scanner, in the words a department uses. */
  blockedBy: string | null;
  criticalUncommunicated: boolean;
}

function decorate(rows: (Study & { patient_name: string; priority: string; clinical_question: string; orderer_name: string })[]): StudyRow[] {
  return rows.map((s) => {
    const reports = reportsFor(s.id);
    let blockedBy: string | null = null;
    if (s.status !== "cancelled" && !s.performed_at) {
      if (!s.justification.trim()) blockedBy = "not justified";
      else if (needsPregnancyCheck(s.patient_mrn, s.modality) && !s.pregnancy_check) blockedBy = "pregnancy question unanswered";
      else if (s.modality === "mri") {
        const state = safetyState(s.id);
        if (state.outstanding.length > 0) blockedBy = "MRI screening incomplete";
        else if (state.blocking.length > 0) blockedBy = "MRI screening blocks the scan";
      }
    }
    return {
      study: s,
      patientName: s.patient_name,
      priority: s.priority,
      clinicalQuestion: s.clinical_question,
      ordererName: s.orderer_name,
      reports,
      blockedBy,
      criticalUncommunicated: reports.some((r) => r.critical && !r.communicated_at),
    };
  });
}

const PRIORITY_ORDER: Record<string, number> = { stat: 0, urgent: 1, routine: 2 };

/** Everything not yet reported. Most urgent first. */
export function imagingWorklist(): StudyRow[] {
  const rows = all<Study & { patient_name: string; priority: string; clinical_question: string; orderer_name: string }>(
    `SELECT s.*, p.given_name || ' ' || p.family_name AS patient_name,
            o.priority, o.clinical_question, o.orderer_name
       FROM imaging_studies s
       JOIN orders o ON o.id = s.order_id
       JOIN patients p ON p.mrn = s.patient_mrn
      WHERE s.status NOT IN ('verified','cancelled')`,
  );
  return decorate(rows).sort(
    (a, b) =>
      Number(Boolean(b.blockedBy)) - Number(Boolean(a.blockedBy)) ||
      (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3) ||
      a.study.created_at.localeCompare(b.study.created_at),
  );
}

/** Critical findings reported and not yet told to anybody. */
export function uncommunicatedCritical(): StudyRow[] {
  const rows = all<Study & { patient_name: string; priority: string; clinical_question: string; orderer_name: string }>(
    `SELECT s.*, p.given_name || ' ' || p.family_name AS patient_name,
            o.priority, o.clinical_question, o.orderer_name
       FROM imaging_studies s
       JOIN orders o ON o.id = s.order_id
       JOIN patients p ON p.mrn = s.patient_mrn
      WHERE EXISTS (SELECT 1 FROM imaging_reports r
                     WHERE r.study_id = s.id AND r.critical = 1 AND r.communicated_at IS NULL)`,
  );
  return decorate(rows);
}

export function imagingLog(limit = 50): StudyRow[] {
  const rows = all<Study & { patient_name: string; priority: string; clinical_question: string; orderer_name: string }>(
    `SELECT s.*, p.given_name || ' ' || p.family_name AS patient_name,
            o.priority, o.clinical_question, o.orderer_name
       FROM imaging_studies s
       JOIN orders o ON o.id = s.order_id
       JOIN patients p ON p.mrn = s.patient_mrn
      ORDER BY s.created_at DESC LIMIT ?`,
    limit,
  );
  return decorate(rows);
}

export interface RadiologySummary {
  studies: number;
  performed: number;
  awaitingReport: number;
  blocked: number;
  cancelled: number;
  repeats: number;
  repeatRatePercent: number | null;
  byModality: Record<Modality, number>;
  criticalFindings: number;
  criticalUncommunicated: number;
  discrepancies: number;
  pregnancyEscalations: number;
  /** Total effective dose delivered by this department, in millisieverts. */
  totalDoseMsv: number;
  /** How much of that total is an estimate rather than a reported figure. */
  estimatedSharePercent: number | null;
}

export function radiologySummary(from?: string, to?: string): RadiologySummary {
  const clause = from && to ? `WHERE created_at >= ? AND created_at <= ?` : "";
  const params: string[] = from && to ? [`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`] : [];

  const rows = all<Study>(`SELECT * FROM imaging_studies ${clause}`, ...params);
  const ids = rows.map((r) => r.id);

  const byModality: Record<Modality, number> = {
    xray: 0, ultrasound: 0, ct: 0, mri: 0, fluoroscopy: 0, mammography: 0,
  };
  for (const r of rows) byModality[r.modality]++;

  const reports = ids.length
    ? all<{ critical: number; communicated_at: string | null; discrepancy: number }>(
        `SELECT critical, communicated_at, discrepancy FROM imaging_reports
          WHERE study_id IN (${ids.map(() => "?").join(",")})`,
        ...ids,
      )
    : [];

  const performed = rows.filter((r) => r.performed_at);
  const ionising = performed.filter((r) => IONISING[r.modality]);
  const totalUsv = ionising.reduce((sum, r) => sum + (r.dose_usv ?? 0), 0);
  const estimatedUsv = ionising
    .filter((r) => r.dose_ugy_m2 === null && r.dose_usv === (TYPICAL_DOSE_USV[r.modality] ?? null))
    .reduce((sum, r) => sum + (r.dose_usv ?? 0), 0);

  const repeats = rows.filter((r) => r.repeat_of).length;

  return {
    studies: rows.length,
    performed: performed.length,
    awaitingReport: rows.filter((r) => r.status === "performed").length,
    blocked: imagingWorklist().filter((r) => r.blockedBy).length,
    cancelled: rows.filter((r) => r.status === "cancelled").length,
    repeats,
    // The repeat rate is the number a radiography department is judged on: a
    // repeat is a second dose for the same question.
    repeatRatePercent: performed.length === 0 ? null : Math.round((repeats / performed.length) * 1000) / 10,
    byModality,
    criticalFindings: reports.filter((r) => r.critical).length,
    criticalUncommunicated: reports.filter((r) => r.critical && !r.communicated_at).length,
    discrepancies: reports.filter((r) => r.discrepancy).length,
    pregnancyEscalations: rows.filter((r) => r.pregnancy_check === "possible" || r.pregnancy_check === "pregnant").length,
    totalDoseMsv: Math.round(totalUsv / 100) / 10,
    estimatedSharePercent: totalUsv === 0 ? null : Math.round((estimatedUsv / totalUsv) * 1000) / 10,
  };
}
