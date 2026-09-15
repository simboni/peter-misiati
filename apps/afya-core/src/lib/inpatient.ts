/**
 * M24 Inpatient & Ward — beds, observations, the drug chart, and discharge.
 *
 * An admission is an encounter WITH A BED. The encounter already carries the
 * clinical record, the licence it was opened under and the charges; this module
 * carries where the patient physically is, and everything that follows from a
 * patient being in a building overnight.
 *
 * Four things this gets right that a spreadsheet cannot:
 *
 *  A BED CAN HOLD ONE PATIENT. Enforced in the database, not by looking first.
 *  Two clerks admitting at once is exactly when a double-booking happens, and
 *  it is the kind that ends with a porter, a patient and an occupied bed.
 *
 *  A BED A PATIENT CANNOT OCCUPY IS NOT AN EMPTY BED. A male patient and a
 *  maternity ward is not availability, and a bed board that pretends otherwise
 *  sends somebody up three floors for nothing.
 *
 *  BED NIGHTS ARE BILLED BY A JOB, NOT BY REMEMBERING. Recorded per night so
 *  running it twice cannot double-bill, and so a long stay does not quietly
 *  earn nothing.
 *
 *  A DOSE NOT GIVEN IS A RECORD. The medication administration record has an
 *  omission reason, because "no entry" could mean refused, vomited, absent,
 *  or forgotten, and those are very different things at an inquest.
 *
 * Every bed move is kept: "which bed was he in on Tuesday" is an
 * infection-control question with a real answer.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { check, explain, licenceStatus } from "./access.ts";
import { resolvePatient } from "./patients.ts";
import { getEncounter, signableNote } from "./encounters.ts";
import { addCharge } from "./billing.ts";
import { notify } from "./notifications.ts";
import { sign } from "./documents.ts";

export class WardError extends Error {}

export type WardKind = "general" | "maternity" | "paediatric" | "isolation" | "hdu";
export type DischargeType = "home" | "referred" | "absconded" | "against_advice" | "died";

export interface Ward {
  code: string;
  facility_id: number;
  name: string;
  kind: WardKind;
  admits_sex: string;
  active: number;
  created_at: string;
}

export interface Bed {
  code: string;
  ward_code: string;
  label: string;
  out_of_service: number;
  out_reason: string | null;
  created_at: string;
}

export interface Admission {
  id: string;
  encounter_id: string;
  patient_mrn: string;
  ward_code: string;
  bed_code: string;
  admitted_by: number | null;
  admitter_name: string;
  admitter_licence: string | null;
  reason: string;
  admitted_at: string;
  discharged_at: string | null;
  discharged_by: number | null;
  discharge_type: DischargeType | null;
  device_code: string | null;
}

// ---------------------------------------------------------------- the estate

export function defineWard(input: {
  facilityId: number;
  code: string;
  name: string;
  kind: WardKind;
  admitsSex?: "male" | "female" | "";
}): void {
  run(
    `INSERT INTO wards (code, facility_id, name, kind, admits_sex, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name, kind = excluded.kind, admits_sex = excluded.admits_sex`,
    input.code.trim().toUpperCase(),
    input.facilityId,
    input.name.trim(),
    input.kind,
    input.admitsSex ?? "",
    now(),
  );
}

export function defineBed(input: { wardCode: string; code: string; label: string }): void {
  run(
    `INSERT INTO beds (code, ward_code, label, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET label = excluded.label`,
    input.code.trim().toUpperCase(),
    input.wardCode.trim().toUpperCase(),
    input.label.trim(),
    now(),
  );
}

export function getWard(code: string): Ward | undefined {
  return get<Ward>(`SELECT * FROM wards WHERE code = ?`, code.trim().toUpperCase());
}

export function listWards(facilityId: number): Ward[] {
  return all<Ward>(`SELECT * FROM wards WHERE facility_id = ? AND active = 1 ORDER BY name`, facilityId);
}

export function takeBedOutOfService(input: { bedCode: string; reason: string; byUserName: string }): void {
  if (!input.reason.trim()) throw new WardError("taking a bed out of service must record why");
  if (occupant(input.bedCode)) throw new WardError("that bed is occupied — move the patient first");
  run(
    `UPDATE beds SET out_of_service = 1, out_reason = ? WHERE code = ?`,
    input.reason.trim(),
    input.bedCode.trim().toUpperCase(),
  );
}

export function returnBedToService(bedCode: string): void {
  run(`UPDATE beds SET out_of_service = 0, out_reason = NULL WHERE code = ?`, bedCode.trim().toUpperCase());
}

export function occupant(bedCode: string): Admission | undefined {
  return get<Admission>(
    `SELECT * FROM admissions WHERE bed_code = ? AND discharged_at IS NULL`,
    bedCode.trim().toUpperCase(),
  );
}

export interface BedState {
  bed: Bed;
  ward: Ward;
  occupied: boolean;
  patientMrn: string | null;
  patientName: string | null;
  admittedAt: string | null;
  nights: number;
}

/**
 * The bed board.
 *
 * Every bed in the facility with who is in it — the one screen a ward round and
 * a bed manager both start from.
 */
export function bedBoard(facilityId: number, wardCode?: string): BedState[] {
  const rows = all<
    Bed & {
      ward_name: string;
      ward_kind: WardKind;
      admits_sex: string;
      w_facility: number;
      w_active: number;
      ward_created: string;
      patient_mrn: string | null;
      patient_name: string | null;
      admitted_at: string | null;
    }
  >(
    `SELECT b.*, w.name AS ward_name, w.kind AS ward_kind, w.admits_sex,
            w.facility_id AS w_facility, w.active AS w_active, w.created_at AS ward_created,
            a.patient_mrn, a.admitted_at,
            p.given_name || ' ' || p.family_name AS patient_name
       FROM beds b
       JOIN wards w ON w.code = b.ward_code
       LEFT JOIN admissions a ON a.bed_code = b.code AND a.discharged_at IS NULL
       LEFT JOIN patients p ON p.mrn = a.patient_mrn
      WHERE w.facility_id = ? AND (? IS NULL OR b.ward_code = ?)
      ORDER BY w.name, b.label`,
    facilityId,
    wardCode?.trim().toUpperCase() ?? null,
    wardCode?.trim().toUpperCase() ?? null,
  );

  return rows.map((r) => ({
    bed: {
      code: r.code,
      ward_code: r.ward_code,
      label: r.label,
      out_of_service: r.out_of_service,
      out_reason: r.out_reason,
      created_at: r.created_at,
    },
    ward: {
      code: r.ward_code,
      facility_id: r.w_facility,
      name: r.ward_name,
      kind: r.ward_kind,
      admits_sex: r.admits_sex,
      active: r.w_active,
      created_at: r.ward_created,
    },
    occupied: Boolean(r.patient_mrn),
    patientMrn: r.patient_mrn,
    patientName: r.patient_name,
    admittedAt: r.admitted_at,
    nights: r.admitted_at ? nightsBetween(r.admitted_at.slice(0, 10), today()) : 0,
  }));
}

/**
 * Beds this particular patient could actually go into.
 *
 * Sex-restricted wards are filtered here rather than at the point of refusal,
 * because "that bed is not available to this patient" is information a bed
 * manager needs before they promise it to somebody.
 */
export function bedsAvailableFor(facilityId: number, patientMrn: string, wardCode?: string): BedState[] {
  const patient = resolvePatient(patientMrn);
  if (!patient) throw new WardError("no such patient");

  return bedBoard(facilityId, wardCode).filter(
    (b) =>
      !b.occupied &&
      !b.bed.out_of_service &&
      (b.ward.admits_sex === "" || b.ward.admits_sex === patient.sex),
  );
}

function nightsBetween(from: string, to: string): number {
  return Math.max(
    0,
    Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000),
  );
}

// ------------------------------------------------------------------ admission

/**
 * Admit a patient to a bed.
 *
 * Licence-gated, and the database enforces one patient per bed: the unique
 * index on (bed, discharged_at) means two clerks admitting simultaneously
 * produces an error rather than two patients in one bed.
 */
export function admit(input: {
  encounterId: string;
  wardCode: string;
  bedCode: string;
  reason: string;
  byUserId: number;
  byUserName: string;
  deviceCode: string;
}): string {
  const encounter = getEncounter(input.encounterId);
  if (!encounter) throw new WardError("no such encounter");
  if (encounter.status !== "open") throw new WardError("that encounter is closed");

  const decision = check(input.byUserId, "patient.admit");
  if (!decision.allowed) throw new WardError(explain(decision));

  const ward = getWard(input.wardCode);
  if (!ward) throw new WardError(`no such ward ${input.wardCode}`);

  const bedCode = input.bedCode.trim().toUpperCase();
  const bed = get<Bed>(`SELECT * FROM beds WHERE code = ?`, bedCode);
  if (!bed) throw new WardError(`no such bed ${bedCode}`);
  if (bed.ward_code !== ward.code) throw new WardError(`${bedCode} is not in ${ward.name}`);
  if (bed.out_of_service) throw new WardError(`${bedCode} is out of service: ${bed.out_reason ?? ""}`.trim());

  const patient = resolvePatient(encounter.patient_mrn)!;
  if (ward.admits_sex && ward.admits_sex !== patient.sex) {
    throw new WardError(`${ward.name} admits ${ward.admits_sex} patients only`);
  }

  const already = get<Admission>(
    `SELECT * FROM admissions WHERE patient_mrn = ? AND discharged_at IS NULL`,
    patient.mrn,
  );
  if (already) throw new WardError(`this patient is already admitted in bed ${already.bed_code}`);

  // Checked here so the usual case gets a useful message. The guard that
  // actually holds is the partial unique index below, because between this read
  // and the insert somebody else can take the bed.
  const taken = occupant(bedCode);
  if (taken) throw new WardError(`${bedCode} is occupied by ${taken.patient_mrn}`);

  const id = mintLocalId(input.deviceCode, 8);
  const licence = licenceStatus(input.byUserId);
  const at = now();

  return tx(() => {
    try {
      run(
        `INSERT INTO admissions
           (id, encounter_id, patient_mrn, ward_code, bed_code, admitted_by, admitter_name,
            admitter_licence, reason, admitted_at, device_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        encounter.id,
        patient.mrn,
        ward.code,
        bedCode,
        input.byUserId,
        input.byUserName,
        licence.state === "current" ? (licence.number ?? null) : null,
        input.reason.trim(),
        at,
        input.deviceCode,
      );
    } catch (err) {
      // The partial unique index did its job: somebody took the bed between the
      // check above and this insert. Two clerks admitting at once is exactly
      // when that happens, and it must not end with two patients in one bed.
      throw new WardError(`${bedCode} was taken while you were admitting — choose another bed`);
    }

    run(
      `INSERT INTO bed_movements (admission_id, from_bed, to_bed, reason, by_user_id, by_user_name, at)
       VALUES (?, NULL, ?, 'admission', ?, ?, ?)`,
      id,
      bedCode,
      input.byUserId,
      input.byUserName,
      at,
    );

    audit({
      action: "patient_admitted",
      entity: "admission",
      entityId: id,
      patientId: patient.mrn,
      facilityId: encounter.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { ward: ward.code, bed: bedCode, reason: input.reason, licence: licence.number ?? null },
    });

    return id;
  });
}

export function getAdmission(id: string): Admission | undefined {
  return get<Admission>(`SELECT * FROM admissions WHERE id = ?`, id);
}

export function currentAdmission(patientMrn: string): Admission | undefined {
  return get<Admission>(`SELECT * FROM admissions WHERE patient_mrn = ? AND discharged_at IS NULL`, patientMrn);
}

/** Move a patient to another bed, keeping the trail. */
export function transfer(input: {
  admissionId: string;
  toBedCode: string;
  reason: string;
  byUserId: number;
  byUserName: string;
}): void {
  const admission = getAdmission(input.admissionId);
  if (!admission) throw new WardError("no such admission");
  if (admission.discharged_at) throw new WardError("that patient has been discharged");
  if (!input.reason.trim()) throw new WardError("a transfer must record why");

  const toBed = input.toBedCode.trim().toUpperCase();
  if (toBed === admission.bed_code) throw new WardError("that is the bed the patient is already in");

  const bed = get<Bed>(`SELECT * FROM beds WHERE code = ?`, toBed);
  if (!bed) throw new WardError(`no such bed ${toBed}`);
  if (bed.out_of_service) throw new WardError(`${toBed} is out of service`);
  if (occupant(toBed)) throw new WardError(`${toBed} is occupied`);

  const ward = getWard(bed.ward_code)!;
  const patient = resolvePatient(admission.patient_mrn)!;
  if (ward.admits_sex && ward.admits_sex !== patient.sex) {
    throw new WardError(`${ward.name} admits ${ward.admits_sex} patients only`);
  }

  const from = admission.bed_code;
  tx(() => {
    run(
      `UPDATE admissions SET bed_code = ?, ward_code = ? WHERE id = ?`,
      toBed,
      bed.ward_code,
      input.admissionId,
    );
    run(
      `INSERT INTO bed_movements (admission_id, from_bed, to_bed, reason, by_user_id, by_user_name, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.admissionId,
      from,
      toBed,
      input.reason.trim(),
      input.byUserId,
      input.byUserName,
      now(),
    );
    audit({
      action: "patient_transferred",
      entity: "admission",
      entityId: input.admissionId,
      patientId: admission.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { from, to: toBed, reason: input.reason },
    });
  });
}

/** Where a patient has been, in order. An infection-control question. */
export function bedHistory(admissionId: string) {
  return all<{ from_bed: string | null; to_bed: string; reason: string; by_user_name: string; at: string }>(
    `SELECT from_bed, to_bed, reason, by_user_name, at FROM bed_movements WHERE admission_id = ? ORDER BY id`,
    admissionId,
  );
}

// --------------------------------------------------------------- bed nights

/**
 * Bill the nights that have been slept.
 *
 * Idempotent per admission per night, so running it twice in a day cannot
 * double-charge, and a run that was missed yesterday catches up today. A long
 * stay that quietly earns nothing is a real and common way for a small hospital
 * to lose money.
 */
export function billBedNights(input: {
  facilityId: number;
  payerCode: string;
  serviceCode?: string;
  asOf?: string;
  deviceCode: string;
  byUserId: number | null;
  byUserName: string;
}): { nights: number; admissions: number } {
  const asOf = input.asOf ?? today();
  const serviceCode = input.serviceCode ?? "BED-DAY";

  const open = all<Admission>(
    `SELECT a.* FROM admissions a JOIN wards w ON w.code = a.ward_code
      WHERE w.facility_id = ? AND (a.discharged_at IS NULL OR a.discharged_at >= ?)`,
    input.facilityId,
    `${asOf}T00:00:00.000Z`,
  );

  let nights = 0;
  const touched = new Set<string>();

  for (const admission of open) {
    const from = admission.admitted_at.slice(0, 10);
    const to = admission.discharged_at ? admission.discharged_at.slice(0, 10) : asOf;

    for (let d = 0; d < nightsBetween(from, to); d++) {
      const night = new Date(Date.parse(`${from}T00:00:00.000Z`) + d * 86_400_000).toISOString().slice(0, 10);

      const billed = get<{ night_date: string }>(
        `SELECT night_date FROM bed_nights WHERE admission_id = ? AND night_date = ?`,
        admission.id,
        night,
      );
      if (billed) continue;

      tx(() => {
        const chargeId = addCharge({
          encounterId: admission.encounter_id,
          serviceCode,
          payerCode: input.payerCode,
          sourceKind: "other",
          sourceRef: admission.id,
          description: `Bed night ${night}`,
          deviceCode: input.deviceCode,
          byUserId: input.byUserId,
          byUserName: input.byUserName,
        });
        run(
          `INSERT INTO bed_nights (admission_id, night_date, charge_id, billed_at) VALUES (?, ?, ?, ?)`,
          admission.id,
          night,
          chargeId,
          now(),
        );
      });

      nights++;
      touched.add(admission.id);
    }
  }

  return { nights, admissions: touched.size };
}

// ------------------------------------------------------------- observations

export interface Observation {
  temp?: number;
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  respRate?: number;
  spo2?: number;
}

/**
 * NEWS2, the aggregate early-warning score.
 *
 * Computed and STORED rather than derived on read, so a ward round sees the
 * trend that was actually acted on. Recomputing history under a changed scoring
 * table would rewrite what people knew at the time.
 *
 * This is the standard scoring table without the supplemental-oxygen and
 * consciousness components, which this module does not yet record — so it
 * under-reads rather than over-reads, and the threshold below is set
 * accordingly.
 */
export function news2(obs: Observation): number {
  let score = 0;

  if (obs.respRate !== undefined) {
    score += obs.respRate <= 8 ? 3 : obs.respRate <= 11 ? 1 : obs.respRate <= 20 ? 0 : obs.respRate <= 24 ? 2 : 3;
  }
  if (obs.spo2 !== undefined) {
    score += obs.spo2 <= 91 ? 3 : obs.spo2 <= 93 ? 2 : obs.spo2 <= 95 ? 1 : 0;
  }
  if (obs.systolic !== undefined) {
    score +=
      obs.systolic <= 90 ? 3 : obs.systolic <= 100 ? 2 : obs.systolic <= 110 ? 1 : obs.systolic <= 219 ? 0 : 3;
  }
  if (obs.pulse !== undefined) {
    score += obs.pulse <= 40 ? 3 : obs.pulse <= 50 ? 1 : obs.pulse <= 90 ? 0 : obs.pulse <= 110 ? 1 : obs.pulse <= 130 ? 2 : 3;
  }
  if (obs.temp !== undefined) {
    score += obs.temp <= 35 ? 3 : obs.temp <= 36 ? 1 : obs.temp <= 38 ? 0 : obs.temp <= 39 ? 1 : 2;
  }

  return score;
}

/** A score at or above this is escalated rather than filed. */
export const NEWS2_ESCALATION = 5;

export function recordObservation(input: {
  admissionId: string;
  observation: Observation;
  note?: string;
  byUserId: number;
  byUserName: string;
}): { id: number; score: number; escalated: boolean } {
  const admission = getAdmission(input.admissionId);
  if (!admission) throw new WardError("no such admission");
  if (admission.discharged_at) throw new WardError("that patient has been discharged");

  const o = input.observation;
  if (o.temp !== undefined && (o.temp < 25 || o.temp > 45)) {
    throw new WardError(`a temperature of ${o.temp}°C is not survivable — check the reading`);
  }
  if (o.spo2 !== undefined && (o.spo2 < 0 || o.spo2 > 100)) {
    throw new WardError("oxygen saturation is a percentage");
  }
  if (o.systolic !== undefined && o.diastolic !== undefined && o.diastolic > o.systolic) {
    throw new WardError("diastolic cannot be above systolic — the two are probably the wrong way round");
  }

  const score = news2(o);
  const escalated = score >= NEWS2_ESCALATION;

  return tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO ward_observations
         (admission_id, patient_mrn, temp_tenths_c, systolic_mmhg, diastolic_mmhg, pulse_bpm,
          resp_rate, spo2_percent, news2_score, note, recorded_by, recorder_name, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.admissionId,
      admission.patient_mrn,
      o.temp === undefined ? null : Math.round(o.temp * 10),
      o.systolic ?? null,
      o.diastolic ?? null,
      o.pulse ?? null,
      o.respRate ?? null,
      o.spo2 ?? null,
      score,
      input.note?.trim() ?? "",
      input.byUserId,
      input.byUserName,
      now(),
    );

    if (escalated) {
      const ward = getWard(admission.ward_code)!;
      notify({
        facilityId: ward.facility_id,
        ownerRole: "clinician",
        severity: score >= 7 ? "critical" : "warning",
        kind: "deteriorating_patient",
        subject: `${admission.patient_mrn} in ${admission.bed_code} scores NEWS2 ${score}`,
        body: "A deteriorating patient. This needs a clinical review now.",
        entity: "admission",
        entityId: admission.id,
        // Keyed on the score too, so a patient getting worse escalates again
        // rather than hiding behind an alert somebody already acknowledged.
        dedupeKey: `news2:${admission.id}:${score}`,
      });
    }

    return { id: lastInsertRowid, score, escalated };
  });
}

export function observationsFor(admissionId: string) {
  return all<{
    id: number;
    temp_tenths_c: number | null;
    systolic_mmhg: number | null;
    diastolic_mmhg: number | null;
    pulse_bpm: number | null;
    resp_rate: number | null;
    spo2_percent: number | null;
    news2_score: number;
    note: string;
    recorder_name: string;
    recorded_at: string;
  }>(`SELECT * FROM ward_observations WHERE admission_id = ? ORDER BY recorded_at`, admissionId);
}

// -------------------------------------------- medication administration record

/**
 * Schedule the doses a prescription implies, so the chart has rows to sign.
 *
 * Starts from `from`, defaulting to the admission date. A drug started on the
 * third day of a stay is charted from the third day — back-dating it would put
 * rows on the chart for days nobody could have given it, which reads at a
 * glance as a fortnight of missed doses.
 */
export function scheduleDoses(input: {
  admissionId: string;
  prescriptionId: string;
  /** Local times the dose is due, e.g. ["08:00", "20:00"]. */
  times: string[];
  days: number;
  /** ISO date the chart starts. Defaults to the day of admission. */
  from?: string;
  deviceCode: string;
}): number {
  const admission = getAdmission(input.admissionId);
  if (!admission) throw new WardError("no such admission");
  if (input.times.length === 0) throw new WardError("a drug chart needs the times the dose is due");

  const start = new Date(input.from ?? admission.admitted_at.slice(0, 10));
  let created = 0;

  tx(() => {
    for (let day = 0; day < input.days; day++) {
      const date = new Date(start.getTime() + day * 86_400_000).toISOString().slice(0, 10);
      for (const time of input.times) {
        const dueAt = `${date}T${time}:00.000Z`;
        const existing = get<{ id: string }>(
          `SELECT id FROM medication_administrations WHERE prescription_id = ? AND due_at = ?`,
          input.prescriptionId,
          dueAt,
        );
        if (existing) continue;

        run(
          `INSERT INTO medication_administrations
             (id, admission_id, prescription_id, patient_mrn, due_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          mintLocalId(input.deviceCode, 8),
          input.admissionId,
          input.prescriptionId,
          admission.patient_mrn,
          dueAt,
          now(),
        );
        created++;
      }
    }
  });

  return created;
}

/**
 * Sign for a dose — given, or not given and why.
 *
 * "No entry" could mean refused, vomited, absent or forgotten, and at an
 * inquest those are entirely different things. So an omission is a record, not
 * a blank.
 */
export function recordAdministration(input: {
  administrationId: string;
  given: boolean;
  omittedReason?: string;
  byUserId: number;
  byUserName: string;
}): void {
  const row = get<{ id: string; given_at: string | null; omitted_reason: string | null; patient_mrn: string }>(
    `SELECT id, given_at, omitted_reason, patient_mrn FROM medication_administrations WHERE id = ?`,
    input.administrationId,
  );
  if (!row) throw new WardError("no such scheduled dose");
  if (row.given_at || row.omitted_reason) throw new WardError("that dose has already been signed for");
  if (!input.given && !input.omittedReason?.trim()) {
    throw new WardError("a dose not given must record why — refused, vomited, absent and forgotten are different things");
  }

  tx(() => {
    run(
      `UPDATE medication_administrations SET given_at = ?, omitted_reason = ?, given_by = ?, giver_name = ? WHERE id = ?`,
      input.given ? now() : null,
      input.given ? null : input.omittedReason!.trim(),
      input.byUserId,
      input.byUserName,
      input.administrationId,
    );
    audit({
      action: input.given ? "dose_given" : "dose_omitted",
      entity: "administration",
      entityId: input.administrationId,
      patientId: row.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { reason: input.omittedReason ?? null },
    });
  });
}

/** The drug chart for a shift: what is due, what was given, what was missed. */
export function drugChart(admissionId: string, onDate = today()) {
  return all<{
    id: string;
    prescription_id: string;
    product_name: string;
    dose: string;
    due_at: string;
    given_at: string | null;
    omitted_reason: string | null;
    giver_name: string | null;
  }>(
    `SELECT m.id, m.prescription_id, r.product_name, r.dose, m.due_at, m.given_at, m.omitted_reason, m.giver_name
       FROM medication_administrations m
       JOIN prescriptions r ON r.id = m.prescription_id
      WHERE m.admission_id = ? AND m.due_at LIKE ?
      ORDER BY m.due_at, r.product_name`,
    admissionId,
    `${onDate}%`,
  );
}

/** Doses that are past due and unsigned. The question a shift handover asks. */
export function missedDoses(facilityId: number, asOf = now()) {
  return all<{
    id: string;
    patient_mrn: string;
    product_name: string;
    due_at: string;
    bed_code: string;
  }>(
    `SELECT m.id, m.patient_mrn, r.product_name, m.due_at, a.bed_code
       FROM medication_administrations m
       JOIN prescriptions r ON r.id = m.prescription_id
       JOIN admissions a ON a.id = m.admission_id
       JOIN wards w ON w.code = a.ward_code
      WHERE w.facility_id = ? AND m.due_at < ? AND m.given_at IS NULL AND m.omitted_reason IS NULL
        AND a.discharged_at IS NULL
      ORDER BY m.due_at`,
    facilityId,
    asOf,
  );
}

// ------------------------------------------------------------------ discharge

/**
 * Discharge a patient.
 *
 * Licence-gated and signed: the discharge summary is what the next clinician
 * reads and what a payer reads, and an unsigned one is neither. The bed is free
 * the moment this commits.
 */
export function discharge(input: {
  admissionId: string;
  type: DischargeType;
  summary: string;
  byUserId: number;
  byUserName: string;
  deviceCode: string;
}): void {
  const admission = getAdmission(input.admissionId);
  if (!admission) throw new WardError("no such admission");
  if (admission.discharged_at) throw new WardError("that patient has already been discharged");

  const decision = check(input.byUserId, "patient.discharge");
  if (!decision.allowed) throw new WardError(explain(decision));

  if (!input.summary.trim()) {
    throw new WardError("a discharge needs a summary — it is what the next clinician and the payer read");
  }

  const unsigned = all<{ id: string }>(
    `SELECT id FROM medication_administrations WHERE admission_id = ? AND due_at < ? AND given_at IS NULL AND omitted_reason IS NULL`,
    input.admissionId,
    now(),
  );

  const at = now();
  const ward = getWard(admission.ward_code)!;

  tx(() => {
    run(
      `UPDATE admissions SET discharged_at = ?, discharged_by = ?, discharge_type = ? WHERE id = ?`,
      at,
      input.byUserId,
      input.type,
      input.admissionId,
    );

    sign({
      entity: "admission",
      entityId: input.admissionId,
      purpose: "discharge_summary",
      content: `${input.summary.trim()}\n---\n${signableNote(admission.encounter_id)}`,
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });

    audit({
      action: "patient_discharged",
      entity: "admission",
      entityId: input.admissionId,
      patientId: admission.patient_mrn,
      facilityId: ward.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: {
        type: input.type,
        nights: nightsBetween(admission.admitted_at.slice(0, 10), at.slice(0, 10)),
        unsignedDoses: unsigned.length,
      },
    });

    // Not a blocker — the patient is going home either way — but the ward
    // sister has to know the chart is incomplete before the notes are filed.
    if (unsigned.length > 0) {
      notify({
        facilityId: ward.facility_id,
        ownerRole: "nurse",
        severity: "warning",
        kind: "unsigned_doses",
        subject: `${unsigned.length} dose${unsigned.length === 1 ? "" : "s"} unsigned on a discharged patient`,
        body: `${admission.patient_mrn} left ${ward.name} with an incomplete drug chart.`,
        entity: "admission",
        entityId: admission.id,
        dedupeKey: `unsigned:${admission.id}`,
      });
    }
  });
}

export interface WardCensus {
  wardCode: string;
  wardName: string;
  beds: number;
  occupied: number;
  outOfService: number;
  occupancyPercent: number;
  admissionsToday: number;
  dischargesToday: number;
}

/** The census a Level 4 facility reports and a bed manager lives by. */
export function census(facilityId: number, onDate = today()): WardCensus[] {
  return listWards(facilityId).map((ward) => {
    const beds = all<Bed>(`SELECT * FROM beds WHERE ward_code = ?`, ward.code);
    const occupied = beds.filter((b) => occupant(b.code)).length;
    const outOfService = beds.filter((b) => b.out_of_service).length;
    const usable = beds.length - outOfService;

    return {
      wardCode: ward.code,
      wardName: ward.name,
      beds: beds.length,
      occupied,
      outOfService,
      occupancyPercent: usable === 0 ? 0 : Math.round((occupied / usable) * 1000) / 10,
      admissionsToday:
        get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM admissions WHERE ward_code = ? AND admitted_at LIKE ?`,
          ward.code,
          `${onDate}%`,
        )?.n ?? 0,
      dischargesToday:
        get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM admissions WHERE ward_code = ? AND discharged_at LIKE ?`,
          ward.code,
          `${onDate}%`,
        )?.n ?? 0,
    };
  });
}
