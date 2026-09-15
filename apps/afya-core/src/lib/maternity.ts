/**
 * M26 Maternity & Child Health — antenatal, delivery, postnatal, immunisation.
 *
 * Commercially this is the largest single line a Kenyan facility bills: SHA
 * covers the maternity package, and the claim is made against the mother's SHA
 * number like any other. (Linda Mama, which used to pay for this separately, is
 * gone — it ended with NHIF when SHA took over, so there is no Linda Mama
 * number to capture and nothing here asks for one.) Clinically it is the module
 * where a missed contact is measured in mothers, so it is built around contacts
 * and their due dates rather than around encounters.
 *
 * Four decisions worth stating:
 *
 *  THE EXPECTED DATE IS DERIVED, NEVER STORED TWICE. It comes from the last
 *  menstrual period by Naegele's rule, unless a scan has dated the pregnancy
 *  differently — in which case the scan wins and the record says which was
 *  used. Storing an EDD alongside an LMP guarantees they eventually disagree,
 *  and then nobody knows which one the care was planned against.
 *
 *  GESTATION IS COMPUTED AND STORED AT EACH CONTACT. Recomputing it afterwards
 *  against a date that has since been corrected would rewrite what the midwife
 *  actually knew that morning.
 *
 *  A BABY GETS THEIR OWN RECORD AT BIRTH. A newborn with no file cannot be
 *  immunised, weighed or treated, and attaching them to the mother's record is
 *  how a child disappears from the system at six weeks. Twins are two rows,
 *  because twins are not an edge case.
 *
 *  THE IMMUNISATION SCHEDULE IS DATA. A change to the national schedule is a
 *  data load, not a release.
 *
 * WHAT A CLINICIAN MUST CHECK. The contact schedule, the postnatal timings, the
 * danger-sign thresholds and the immunisation schedule below are taken from WHO
 * and the Kenyan national schedule as published, but they are the kind of thing
 * that moves. They are listed in `docs/hms/06-clinical-review.md`.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { resolvePatient, registerPatient } from "./patients.ts";
import { notify } from "./notifications.ts";

export class MaternityError extends Error {}

export type PregnancyStatus =
  | "booked"
  | "delivered"
  | "miscarried"
  | "terminated"
  | "transferred"
  | "lost";

export type DeliveryMode = "spontaneous_vertex" | "assisted" | "caesarean" | "breech" | "other";
export type BirthOutcome = "live" | "stillbirth_fresh" | "stillbirth_macerated" | "died";

export interface Pregnancy {
  id: string;
  patient_mrn: string;
  cover_ref: string | null;
  lmp: string | null;
  edd_override: string | null;
  edd_source: "lmp" | "scan" | "unknown";
  gravida: number | null;
  para: number | null;
  booked_on: string;
  status: PregnancyStatus;
  outcome_on: string | null;
  outcome_note: string | null;
  booked_by: number | null;
  device_code: string | null;
  created_at: string;
}

/**
 * WHO recommends eight antenatal contacts, at these gestations in weeks.
 *
 * ⚠️ A clinical advisor must confirm this against what Kenya currently
 * schedules — several counties still run the older four-visit focused model,
 * and a facility reporting against one while the system schedules the other
 * produces a coverage figure nobody can defend.
 */
export const ANC_CONTACT_WEEKS = [12, 20, 26, 30, 34, 36, 38, 40];

/**
 * Postnatal contacts, as hours and then days after birth.
 *
 * ⚠️ The first twenty-four hours carry most of the maternal mortality, which is
 * why the first two are so close together. To be confirmed.
 */
export const PNC_SCHEDULE: { label: string; hoursAfter: number }[] = [
  { label: "Within 24 hours", hoursAfter: 24 },
  { label: "Day 3", hoursAfter: 72 },
  { label: "Week 1–2", hoursAfter: 7 * 24 },
  { label: "Week 6", hoursAfter: 42 * 24 },
];

/** A pregnancy is term from this many weeks. Below it, preterm. */
export const TERM_WEEKS = 37;

/** Below this birth weight in grams is low birth weight, and is reported. */
export const LOW_BIRTH_WEIGHT_GRAMS = 2500;

// --------------------------------------------------------------------- dating

/**
 * Expected date of delivery, by Naegele's rule: LMP plus 280 days.
 *
 * Returned with its source, so a screen can say "by scan" or "by dates" rather
 * than presenting a number whose provenance nobody can see.
 */
export function expectedDate(pregnancy: Pick<Pregnancy, "lmp" | "edd_override" | "edd_source">): {
  edd: string | null;
  source: "lmp" | "scan" | "unknown";
} {
  if (pregnancy.edd_override) return { edd: pregnancy.edd_override, source: "scan" };
  if (!pregnancy.lmp) return { edd: null, source: "unknown" };
  return {
    edd: new Date(Date.parse(`${pregnancy.lmp}T00:00:00.000Z`) + 280 * 86_400_000).toISOString().slice(0, 10),
    source: "lmp",
  };
}

/** Gestation in completed weeks on a given date. Null when the pregnancy is undated. */
export function gestationWeeks(
  pregnancy: Pick<Pregnancy, "lmp" | "edd_override" | "edd_source">,
  onDate = today(),
): number | null {
  const { edd } = expectedDate(pregnancy);
  if (!edd) return null;
  // Forty weeks before the expected date is the notional start.
  const start = Date.parse(`${edd}T00:00:00.000Z`) - 280 * 86_400_000;
  const days = (Date.parse(`${onDate}T00:00:00.000Z`) - start) / 86_400_000;
  return Math.max(0, Math.floor(days / 7));
}

// ------------------------------------------------------------------- booking

/**
 * Book a pregnancy.
 *
 * Refuses a second open pregnancy for the same woman, because two open
 * pregnancies means two antenatal schedules and two claims for one delivery.
 */
export function bookPregnancy(input: {
  patientMrn: string;
  lmp?: string;
  eddOverride?: string;
  /** The payer's reference for maternity cover, if the scheme issues one. */
  coverRef?: string;
  gravida?: number;
  para?: number;
  bookedOn?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new MaternityError("no such patient");
  if (patient.sex !== "female") {
    throw new MaternityError("a pregnancy can only be booked against a patient recorded as female");
  }

  const open = get<Pregnancy>(
    `SELECT * FROM pregnancies WHERE patient_mrn = ? AND status = 'booked'`,
    patient.mrn,
  );
  if (open) {
    throw new MaternityError(
      `${patient.given_name} ${patient.family_name} already has an open pregnancy booked ${open.booked_on}. Close it before booking another.`,
    );
  }

  if (!input.lmp && !input.eddOverride) {
    // An undated pregnancy cannot be scheduled, cannot be assessed for
    // prematurity, and cannot be claimed properly. Saying so at booking is the
    // cheapest moment to fix it.
    throw new MaternityError(
      "a pregnancy needs either the last menstrual period or a scan date — an undated pregnancy cannot be scheduled or assessed",
    );
  }
  for (const [label, value] of [["last menstrual period", input.lmp], ["scan date", input.eddOverride]] as const) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new MaternityError(`the ${label} must be YYYY-MM-DD`);
    }
  }
  if (input.lmp && input.lmp > today()) throw new MaternityError("that last menstrual period is in the future");
  if (input.gravida !== undefined && input.para !== undefined && input.para > input.gravida) {
    throw new MaternityError("para cannot exceed gravida — a woman cannot have delivered more times than she has been pregnant");
  }

  const id = mintLocalId(input.deviceCode, 8);
  const bookedOn = input.bookedOn ?? today();

  return tx(() => {
    run(
      `INSERT INTO pregnancies
         (id, patient_mrn, cover_ref, lmp, edd_override, edd_source, gravida, para,
          booked_on, status, booked_by, device_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?, ?, ?)`,
      id,
      patient.mrn,
      input.coverRef?.trim().toUpperCase() || null,
      input.lmp ?? null,
      input.eddOverride ?? null,
      input.eddOverride ? "scan" : "lmp",
      input.gravida ?? null,
      input.para ?? null,
      bookedOn,
      input.byUserId,
      input.deviceCode,
      now(),
    );
    audit({
      action: "pregnancy_booked",
      entity: "pregnancy",
      entityId: id,
      patientId: patient.mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { coverRef: input.coverRef ?? null, gravida: input.gravida, para: input.para },
    });
    return id;
  });
}

export function getPregnancy(id: string): Pregnancy | undefined {
  return get<Pregnancy>(`SELECT * FROM pregnancies WHERE id = ?`, id);
}

export function openPregnancyFor(patientMrn: string): Pregnancy | undefined {
  return get<Pregnancy>(`SELECT * FROM pregnancies WHERE patient_mrn = ? AND status = 'booked'`, patientMrn);
}

export function pregnanciesFor(patientMrn: string): Pregnancy[] {
  return all<Pregnancy>(
    `SELECT * FROM pregnancies WHERE patient_mrn = ? ORDER BY booked_on DESC`,
    patientMrn,
  );
}

// ---------------------------------------------------------------- antenatal

export interface AncContact {
  id: string;
  pregnancy_id: string;
  encounter_id: string | null;
  contact_number: number;
  contact_date: string;
  gestation_weeks: number | null;
  weight_grams: number | null;
  systolic_mmhg: number | null;
  diastolic_mmhg: number | null;
  fundal_height_cm: number | null;
  haemoglobin_milli: number | null;
  tt_given: number;
  iptp_given: number;
  iron_given: number;
  llin_given: number;
  hiv_tested: number;
  danger_signs: string;
  next_due: string | null;
  note: string;
  seen_by: number | null;
  seen_by_name: string;
  created_at: string;
}

/**
 * Record an antenatal contact.
 *
 * Gestation is computed here and stored, so the record shows what was known
 * that morning rather than what a later correction implies. Danger signs raise
 * an alert rather than sitting in a note — pre-eclampsia found at a contact and
 * not acted on is the archetypal preventable maternal death.
 */
export function recordAncContact(input: {
  pregnancyId: string;
  encounterId?: string | null;
  contactDate?: string;
  weightGrams?: number;
  systolic?: number;
  diastolic?: number;
  fundalHeightCm?: number;
  /** Haemoglobin in g/dL, e.g. 10.4. Stored in thousandths like every result. */
  haemoglobin?: number;
  ttGiven?: boolean;
  iptpGiven?: boolean;
  ironGiven?: boolean;
  llinGiven?: boolean;
  hivTested?: boolean;
  dangerSigns?: string;
  nextDue?: string;
  note?: string;
  facilityId: number;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): { id: string; contactNumber: number; gestationWeeks: number | null; escalated: boolean } {
  const pregnancy = getPregnancy(input.pregnancyId);
  if (!pregnancy) throw new MaternityError("no such pregnancy");
  if (pregnancy.status !== "booked") {
    throw new MaternityError(`that pregnancy is recorded as ${pregnancy.status}`);
  }

  const contactDate = input.contactDate ?? today();
  if (contactDate < pregnancy.booked_on) {
    throw new MaternityError("a contact cannot be before the booking");
  }
  if (input.systolic !== undefined && input.diastolic !== undefined && input.diastolic > input.systolic) {
    throw new MaternityError("diastolic cannot be above systolic — the two are probably the wrong way round");
  }

  const previous =
    get<{ n: number }>(
      `SELECT COALESCE(MAX(contact_number), 0) AS n FROM anc_contacts WHERE pregnancy_id = ?`,
      pregnancy.id,
    )?.n ?? 0;
  const contactNumber = previous + 1;
  const weeks = gestationWeeks(pregnancy, contactDate);

  // Raised blood pressure in pregnancy is pre-eclampsia until proven otherwise,
  // and it is the one finding that must never wait for somebody to read a note.
  const highBp =
    (input.systolic !== undefined && input.systolic >= 140) ||
    (input.diastolic !== undefined && input.diastolic >= 90);
  const severeAnaemia = input.haemoglobin !== undefined && input.haemoglobin < 7;
  const escalated = highBp || severeAnaemia || Boolean(input.dangerSigns?.trim());

  const id = mintLocalId(input.deviceCode, 8);

  return tx(() => {
    run(
      `INSERT INTO anc_contacts
         (id, pregnancy_id, encounter_id, contact_number, contact_date, gestation_weeks,
          weight_grams, systolic_mmhg, diastolic_mmhg, fundal_height_cm, haemoglobin_milli,
          tt_given, iptp_given, iron_given, llin_given, hiv_tested,
          danger_signs, next_due, note, seen_by, seen_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      pregnancy.id,
      input.encounterId ?? null,
      contactNumber,
      contactDate,
      weeks,
      input.weightGrams ?? null,
      input.systolic ?? null,
      input.diastolic ?? null,
      input.fundalHeightCm ?? null,
      input.haemoglobin === undefined ? null : Math.round(input.haemoglobin * 1000),
      input.ttGiven ? 1 : 0,
      input.iptpGiven ? 1 : 0,
      input.ironGiven ? 1 : 0,
      input.llinGiven ? 1 : 0,
      input.hivTested ? 1 : 0,
      input.dangerSigns?.trim() ?? "",
      input.nextDue ?? null,
      input.note?.trim() ?? "",
      input.byUserId,
      input.byUserName,
      now(),
    );

    if (escalated) {
      const reasons = [
        highBp ? `blood pressure ${input.systolic}/${input.diastolic}` : null,
        severeAnaemia ? `haemoglobin ${input.haemoglobin} g/dL` : null,
        input.dangerSigns?.trim() || null,
      ].filter(Boolean);

      notify({
        facilityId: input.facilityId,
        ownerRole: "clinician",
        severity: highBp || severeAnaemia ? "critical" : "warning",
        kind: "anc_danger",
        subject: `${pregnancy.patient_mrn} at ${weeks ?? "?"} weeks — ${reasons.join(", ")}`,
        body: "Raised blood pressure in pregnancy is pre-eclampsia until proven otherwise. This needs review now, not on the next round.",
        entity: "pregnancy",
        entityId: pregnancy.id,
        dedupeKey: `anc_danger:${id}`,
      });
    }

    audit({
      action: "anc_contact",
      entity: "pregnancy",
      entityId: pregnancy.id,
      patientId: pregnancy.patient_mrn,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { contactNumber, gestationWeeks: weeks, escalated },
    });

    return { id, contactNumber, gestationWeeks: weeks, escalated };
  });
}

export function ancContactsFor(pregnancyId: string): AncContact[] {
  return all<AncContact>(
    `SELECT * FROM anc_contacts WHERE pregnancy_id = ? ORDER BY contact_number`,
    pregnancyId,
  );
}

/**
 * The next contact WHO's schedule expects, given what has happened so far.
 *
 * Chosen by gestation, not by counting. Counting contacts would tell a woman at
 * 38 weeks that her next contact is expected at 34 — which is how a clinic ends
 * up apparently running a schedule nobody is on. The next contact is the first
 * one on the schedule that is still ahead of both her last contact and today.
 */
export function nextAncContact(
  pregnancyId: string,
  asOf = today(),
): { number: number; atWeeks: number } | null {
  const pregnancy = getPregnancy(pregnancyId);
  if (!pregnancy) return null;

  const contacts = ancContactsFor(pregnancyId);
  if (contacts.length >= ANC_CONTACT_WEEKS.length) return null;

  const lastWeeks = contacts.length ? contacts[contacts.length - 1].gestation_weeks : null;
  const nowWeeks = gestationWeeks(pregnancy, asOf);
  // Strictly after the last contact, and not behind where she already is.
  const floor = Math.max(lastWeeks === null ? 0 : lastWeeks + 1, nowWeeks ?? 0);

  return {
    number: contacts.length + 1,
    atWeeks: ANC_CONTACT_WEEKS.find((w) => w >= floor) ?? ANC_CONTACT_WEEKS[ANC_CONTACT_WEEKS.length - 1],
  };
}

// --------------------------------------------------------------------- birth

export interface Delivery {
  id: string;
  pregnancy_id: string;
  encounter_id: string | null;
  admission_id: string | null;
  delivered_at: string;
  mode: DeliveryMode;
  place: string;
  gestation_weeks: number | null;
  blood_loss_ml: number | null;
  complications: string;
  mother_outcome: "alive" | "died";
  attended_by: number | null;
  attendant_name: string;
  attendant_licence: string | null;
  device_code: string | null;
  created_at: string;
}

export interface BabyInput {
  sex: "male" | "female" | "unknown";
  birthWeightGrams?: number;
  apgar1?: number;
  apgar5?: number;
  outcome: BirthOutcome;
  notificationNo?: string;
  note?: string;
  /** Register the baby as a patient in their own right. Default true for a live birth. */
  registerAsPatient?: boolean;
  givenName?: string;
}

/**
 * Record a delivery and the babies.
 *
 * A live baby is registered as a patient in their own right, with their own
 * file number, because a newborn attached only to the mother's record cannot be
 * immunised or weighed and disappears from the system at six weeks. Twins are
 * two rows and two records.
 */
export function recordDelivery(input: {
  pregnancyId: string;
  encounterId?: string | null;
  admissionId?: string | null;
  deliveredAt?: string;
  mode: DeliveryMode;
  place?: "facility" | "home" | "in_transit" | "other";
  bloodLossMl?: number;
  complications?: string;
  motherOutcome?: "alive" | "died";
  babies: BabyInput[];
  facilityId: number;
  byUserId: number;
  byUserName: string;
  attendantLicence?: string | null;
  deviceCode: string;
}): { deliveryId: string; babies: { birthId: string; patientMrn: string | null }[] } {
  const pregnancy = getPregnancy(input.pregnancyId);
  if (!pregnancy) throw new MaternityError("no such pregnancy");
  if (pregnancy.status !== "booked") {
    throw new MaternityError(`that pregnancy is already recorded as ${pregnancy.status}`);
  }
  if (input.babies.length === 0) {
    throw new MaternityError("a delivery must record at least one baby, even a stillbirth");
  }

  const mother = resolvePatient(pregnancy.patient_mrn)!;
  const deliveredAt = input.deliveredAt ?? now();
  const deliveryDate = deliveredAt.slice(0, 10);
  const weeks = gestationWeeks(pregnancy, deliveryDate);

  const deliveryId = mintLocalId(input.deviceCode, 8);
  const results: { birthId: string; patientMrn: string | null }[] = [];

  return tx(() => {
    run(
      `INSERT INTO deliveries
         (id, pregnancy_id, encounter_id, admission_id, delivered_at, mode, place, gestation_weeks,
          blood_loss_ml, complications, mother_outcome, attended_by, attendant_name,
          attendant_licence, device_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      deliveryId,
      pregnancy.id,
      input.encounterId ?? null,
      input.admissionId ?? null,
      deliveredAt,
      input.mode,
      input.place ?? "facility",
      weeks,
      input.bloodLossMl ?? null,
      input.complications?.trim() ?? "",
      input.motherOutcome ?? "alive",
      input.byUserId,
      input.byUserName,
      input.attendantLicence ?? null,
      input.deviceCode,
      now(),
    );

    for (const [index, baby] of input.babies.entries()) {
      const birthId = mintLocalId(input.deviceCode, 8);
      let babyMrn: string | null = null;

      const live = baby.outcome === "live";
      if (live && (baby.registerAsPatient ?? true)) {
        // Their own record, from the first minute. Named "Baby of <mother>"
        // until the family names them, which is what a ward actually writes —
        // and "Twin 1 of" / "Twin 2 of" when there is more than one, because
        // two children with the same name on a ward list is how the wrong baby
        // gets weighed.
        const placeholder =
          input.babies.length > 1
            ? `Twin ${index + 1} of ${mother.given_name}`
            : `Baby of ${mother.given_name}`;
        babyMrn = registerPatient({
          facilityId: input.facilityId,
          deviceCode: input.deviceCode,
          givenName: baby.givenName?.trim() || placeholder,
          familyName: mother.family_name,
          sex: baby.sex === "unknown" ? "male" : baby.sex,
          dateOfBirth: deliveryDate,
          byUserId: input.byUserId,
          byUserName: input.byUserName,
        });
      }

      run(
        `INSERT INTO births
           (id, delivery_id, patient_mrn, birth_order, sex, birth_weight_grams,
            apgar_1, apgar_5, outcome, notification_no, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        birthId,
        deliveryId,
        babyMrn,
        index + 1,
        baby.sex,
        baby.birthWeightGrams ?? null,
        baby.apgar1 ?? null,
        baby.apgar5 ?? null,
        baby.outcome,
        baby.notificationNo?.trim() ?? null,
        baby.note?.trim() ?? "",
        now(),
      );

      results.push({ birthId, patientMrn: babyMrn });

      // Low birth weight and prematurity both change the care plan immediately.
      if (live && baby.birthWeightGrams !== undefined && baby.birthWeightGrams < LOW_BIRTH_WEIGHT_GRAMS) {
        notify({
          facilityId: input.facilityId,
          ownerRole: "clinician",
          severity: "warning",
          kind: "low_birth_weight",
          subject: `Low birth weight: ${baby.birthWeightGrams} g${weeks ? ` at ${weeks} weeks` : ""}`,
          body: "Kangaroo care, feeding support and closer follow-up. Below 2500 g is reported.",
          entity: "delivery",
          entityId: deliveryId,
          dedupeKey: `lbw:${birthId}`,
        });
      }
    }

    run(
      `UPDATE pregnancies SET status = 'delivered', outcome_on = ? WHERE id = ?`,
      deliveryDate,
      pregnancy.id,
    );

    audit({
      action: "delivery_recorded",
      entity: "delivery",
      entityId: deliveryId,
      patientId: pregnancy.patient_mrn,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: {
        mode: input.mode,
        gestationWeeks: weeks,
        preterm: weeks !== null && weeks < TERM_WEEKS,
        babies: input.babies.length,
        liveBirths: input.babies.filter((b) => b.outcome === "live").length,
        motherOutcome: input.motherOutcome ?? "alive",
        coverRef: pregnancy.cover_ref,
      },
    });

    return { deliveryId, babies: results };
  });
}

export function getDelivery(id: string): Delivery | undefined {
  return get<Delivery>(`SELECT * FROM deliveries WHERE id = ?`, id);
}

export function deliveryFor(pregnancyId: string): Delivery | undefined {
  return get<Delivery>(`SELECT * FROM deliveries WHERE pregnancy_id = ?`, pregnancyId);
}

export function birthsFor(deliveryId: string) {
  return all<{
    id: string;
    patient_mrn: string | null;
    birth_order: number;
    sex: string;
    birth_weight_grams: number | null;
    apgar_1: number | null;
    apgar_5: number | null;
    outcome: BirthOutcome;
    notification_no: string | null;
    note: string;
  }>(`SELECT * FROM births WHERE delivery_id = ? ORDER BY birth_order`, deliveryId);
}

/** End a pregnancy that did not reach delivery. */
export function closePregnancy(input: {
  pregnancyId: string;
  status: Extract<PregnancyStatus, "miscarried" | "terminated" | "transferred" | "lost">;
  note: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const pregnancy = getPregnancy(input.pregnancyId);
  if (!pregnancy) throw new MaternityError("no such pregnancy");
  if (pregnancy.status !== "booked") throw new MaternityError(`that pregnancy is already ${pregnancy.status}`);
  if (!input.note.trim()) throw new MaternityError("closing a pregnancy must record why");

  tx(() => {
    run(
      `UPDATE pregnancies SET status = ?, outcome_on = ?, outcome_note = ? WHERE id = ?`,
      input.status,
      today(),
      input.note.trim(),
      input.pregnancyId,
    );
    audit({
      action: "pregnancy_closed",
      entity: "pregnancy",
      entityId: input.pregnancyId,
      patientId: pregnancy.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { status: input.status, note: input.note },
    });
  });
}

// ---------------------------------------------------------------- postnatal

export function recordPncContact(input: {
  deliveryId: string;
  encounterId?: string | null;
  contactDate?: string;
  scheduledAt: string;
  motherFindings?: string;
  babyFindings?: string;
  dangerSigns?: string;
  nextDue?: string;
  facilityId: number;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const delivery = getDelivery(input.deliveryId);
  if (!delivery) throw new MaternityError("no such delivery");

  const id = mintLocalId(input.deviceCode, 8);
  const contactDate = input.contactDate ?? today();

  return tx(() => {
    run(
      `INSERT INTO pnc_contacts
         (id, delivery_id, encounter_id, contact_date, scheduled_at, mother_findings,
          baby_findings, danger_signs, next_due, seen_by, seen_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      delivery.id,
      input.encounterId ?? null,
      contactDate,
      input.scheduledAt,
      input.motherFindings?.trim() ?? "",
      input.babyFindings?.trim() ?? "",
      input.dangerSigns?.trim() ?? "",
      input.nextDue ?? null,
      input.byUserId,
      input.byUserName,
      now(),
    );

    if (input.dangerSigns?.trim()) {
      notify({
        facilityId: input.facilityId,
        ownerRole: "clinician",
        severity: "critical",
        kind: "pnc_danger",
        subject: `Postnatal danger sign — ${input.dangerSigns.trim()}`,
        body: "Most maternal deaths happen in the first days after birth. This needs review now.",
        entity: "delivery",
        entityId: delivery.id,
        dedupeKey: `pnc_danger:${id}`,
      });
    }

    return id;
  });
}

export function pncContactsFor(deliveryId: string) {
  return all<{
    id: string;
    contact_date: string;
    scheduled_at: string;
    mother_findings: string;
    baby_findings: string;
    danger_signs: string;
    next_due: string | null;
    seen_by_name: string;
  }>(`SELECT * FROM pnc_contacts WHERE delivery_id = ? ORDER BY contact_date`, deliveryId);
}

// ------------------------------------------------------------- immunisation

export function defineVaccine(input: {
  code: string;
  name: string;
  dueWeeks: number;
  sequence?: number;
  source?: string;
}): void {
  run(
    `INSERT INTO immunisation_schedule (code, name, due_weeks, sequence, source)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name, due_weeks = excluded.due_weeks,
       sequence = excluded.sequence, source = excluded.source`,
    input.code.trim().toUpperCase(),
    input.name.trim(),
    input.dueWeeks,
    input.sequence ?? 1,
    input.source ?? "",
  );
}

export function immunisationSchedule() {
  return all<{ code: string; name: string; due_weeks: number; sequence: number; source: string }>(
    `SELECT * FROM immunisation_schedule ORDER BY due_weeks, sequence`,
  );
}

/**
 * Record an immunisation.
 *
 * The batch is recorded because a vaccine recall names one, exactly as a
 * medicine recall does. Giving the same vaccine twice is refused rather than
 * duplicated — a double dose is a reportable event, not a second row.
 */
export function recordImmunisation(input: {
  patientMrn: string;
  vaccineCode: string;
  givenOn?: string;
  batchId?: string | null;
  batchNumber?: string;
  site?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new MaternityError("no such patient");

  const code = input.vaccineCode.trim().toUpperCase();
  const vaccine = get<{ code: string; name: string }>(
    `SELECT code, name FROM immunisation_schedule WHERE code = ?`,
    code,
  );
  if (!vaccine) throw new MaternityError(`${code} is not on the immunisation schedule`);

  const already = get<{ given_on: string }>(
    `SELECT given_on FROM immunisations WHERE patient_mrn = ? AND vaccine_code = ?`,
    patient.mrn,
    code,
  );
  if (already) {
    throw new MaternityError(
      `${vaccine.name} was already given on ${already.given_on}. A repeat dose is a reportable event, not a second entry.`,
    );
  }

  const id = mintLocalId(input.deviceCode, 8);
  const givenOn = input.givenOn ?? today();

  return tx(() => {
    run(
      `INSERT INTO immunisations
         (id, patient_mrn, vaccine_code, given_on, batch_id, batch_number, site, given_by, giver_name, device_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      patient.mrn,
      code,
      givenOn,
      input.batchId ?? null,
      input.batchNumber?.trim() ?? "",
      input.site?.trim() ?? "",
      input.byUserId,
      input.byUserName,
      input.deviceCode,
      now(),
    );
    audit({
      action: "immunisation_given",
      entity: "patient",
      entityId: patient.mrn,
      patientId: patient.mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { vaccine: code, givenOn, batch: input.batchNumber ?? null },
    });
    return id;
  });
}

export interface ImmunisationStatus {
  code: string;
  name: string;
  dueWeeks: number;
  dueOn: string | null;
  givenOn: string | null;
  /** Past due and not given. */
  overdue: boolean;
}

/**
 * A child's immunisation card: what is due, what was given, what is overdue.
 *
 * Due dates come from the child's own date of birth, which is why registering
 * the baby as a patient at delivery matters — without a date of birth there is
 * no card.
 */
export function immunisationCard(patientMrn: string, asOf = today()): ImmunisationStatus[] {
  const patient = resolvePatient(patientMrn);
  if (!patient) throw new MaternityError("no such patient");

  const given = new Map(
    all<{ vaccine_code: string; given_on: string }>(
      `SELECT vaccine_code, given_on FROM immunisations WHERE patient_mrn = ?`,
      patient.mrn,
    ).map((r) => [r.vaccine_code, r.given_on]),
  );

  return immunisationSchedule().map((v) => {
    const dueOn = patient.date_of_birth
      ? new Date(Date.parse(`${patient.date_of_birth}T00:00:00.000Z`) + v.due_weeks * 7 * 86_400_000)
          .toISOString()
          .slice(0, 10)
      : null;
    const givenOn = given.get(v.code) ?? null;
    return {
      code: v.code,
      name: v.name,
      dueWeeks: v.due_weeks,
      dueOn,
      givenOn,
      overdue: !givenOn && dueOn !== null && dueOn < asOf,
    };
  });
}

// ------------------------------------------------------------------- reports

export interface MaternitySummary {
  booked: number;
  activePregnancies: number;
  deliveries: number;
  liveBirths: number;
  stillbirths: number;
  caesareans: number;
  preterm: number;
  lowBirthWeight: number;
  maternalDeaths: number;
  /** Caesareans as a percentage of deliveries. Watched by every referral hospital. */
  caesareanRatePercent: number | null;
  /** Stillbirths per 1000 total births. */
  stillbirthRatePer1000: number | null;
}

export function maternitySummary(from?: string, to?: string): MaternitySummary {
  const clause = from && to ? `WHERE d.delivered_at >= ? AND d.delivered_at <= ?` : "";
  const params = from && to ? [`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`] : [];

  const deliveries = all<{ id: string; mode: string; gestation_weeks: number | null; mother_outcome: string }>(
    `SELECT d.id, d.mode, d.gestation_weeks, d.mother_outcome FROM deliveries d ${clause}`,
    ...params,
  );
  const ids = deliveries.map((d) => d.id);

  const babies = ids.length
    ? all<{ outcome: BirthOutcome; birth_weight_grams: number | null }>(
        `SELECT outcome, birth_weight_grams FROM births WHERE delivery_id IN (${ids.map(() => "?").join(",")})`,
        ...ids,
      )
    : [];

  const live = babies.filter((b) => b.outcome === "live").length;
  const still = babies.filter((b) => b.outcome.startsWith("stillbirth")).length;
  const totalBirths = live + still;

  return {
    booked: get<{ n: number }>(`SELECT COUNT(*) AS n FROM pregnancies`)?.n ?? 0,
    activePregnancies: get<{ n: number }>(`SELECT COUNT(*) AS n FROM pregnancies WHERE status = 'booked'`)?.n ?? 0,
    deliveries: deliveries.length,
    liveBirths: live,
    stillbirths: still,
    caesareans: deliveries.filter((d) => d.mode === "caesarean").length,
    preterm: deliveries.filter((d) => d.gestation_weeks !== null && d.gestation_weeks < TERM_WEEKS).length,
    lowBirthWeight: babies.filter(
      (b) => b.outcome === "live" && b.birth_weight_grams !== null && b.birth_weight_grams < LOW_BIRTH_WEIGHT_GRAMS,
    ).length,
    maternalDeaths: deliveries.filter((d) => d.mother_outcome === "died").length,
    caesareanRatePercent:
      deliveries.length === 0
        ? null
        : Math.round((deliveries.filter((d) => d.mode === "caesarean").length / deliveries.length) * 1000) / 10,
    stillbirthRatePer1000: totalBirths === 0 ? null : Math.round((still / totalBirths) * 1000),
  };
}

/** Pregnancies with an antenatal contact overdue. */
export function ancDefaulters(asOf = today()) {
  return all<{
    pregnancy_id: string;
    patient_mrn: string;
    patient_name: string;
    next_due: string;
    last_seen: string;
    contact_number: number;
  }>(
    `SELECT c.pregnancy_id, p.patient_mrn, pt.given_name || ' ' || pt.family_name AS patient_name,
            c.next_due, c.contact_date AS last_seen, c.contact_number
       FROM anc_contacts c
       JOIN pregnancies p ON p.id = c.pregnancy_id
       JOIN patients pt ON pt.mrn = p.patient_mrn
      WHERE p.status = 'booked' AND c.next_due IS NOT NULL AND c.next_due < ?
        AND c.contact_number = (SELECT MAX(c2.contact_number) FROM anc_contacts c2 WHERE c2.pregnancy_id = p.id)
      ORDER BY c.next_due`,
    asOf,
  );
}

/**
 * The Kenyan childhood immunisation schedule.
 *
 * ⚠️ Taken from the national schedule as published. A clinical advisor must
 * confirm it against the current KEPI schedule before go-live — it changes, and
 * a card built on a stale schedule marks children overdue who are not.
 */
export function seedImmunisationSchedule(): void {
  const SOURCE = "Kenya national immunisation schedule — confirm against current KEPI before go-live";
  const schedule: [string, string, number, number][] = [
    ["BCG", "BCG", 0, 1],
    ["OPV0", "Polio, birth dose", 0, 2],
    ["OPV1", "Polio 1", 6, 1],
    ["PCV1", "Pneumococcal 1", 6, 2],
    ["PENTA1", "Pentavalent 1", 6, 3],
    ["ROTA1", "Rotavirus 1", 6, 4],
    ["OPV2", "Polio 2", 10, 1],
    ["PCV2", "Pneumococcal 2", 10, 2],
    ["PENTA2", "Pentavalent 2", 10, 3],
    ["ROTA2", "Rotavirus 2", 10, 4],
    ["OPV3", "Polio 3", 14, 1],
    ["PCV3", "Pneumococcal 3", 14, 2],
    ["PENTA3", "Pentavalent 3", 14, 3],
    ["IPV", "Inactivated polio", 14, 4],
    ["VITA6", "Vitamin A, 6 months", 26, 1],
    ["MR1", "Measles–rubella 1", 39, 1],
    ["MR2", "Measles–rubella 2", 78, 1],
  ];
  for (const [code, name, dueWeeks, sequence] of schedule) {
    defineVaccine({ code, name, dueWeeks, sequence, source: SOURCE });
  }
}

// ------------------------------------------------------------- worklists

export interface AncRegisterRow {
  pregnancy: Pregnancy;
  patientName: string;
  edd: string | null;
  eddSource: "lmp" | "scan" | "unknown";
  gestationWeeks: number | null;
  contacts: number;
  lastSeen: string | null;
  nextDue: string | null;
  /** Past the expected date and still booked — the pregnancy that gets forgotten. */
  overdue: boolean;
}

/**
 * The antenatal register: every open pregnancy, soonest due first.
 *
 * Ordered by expected date rather than by booking date, because the question a
 * midwife asks the register is "who is delivering next", never "who booked
 * first".
 */
export function ancRegister(asOf = today()): AncRegisterRow[] {
  const open = all<Pregnancy & { patient_name: string }>(
    `SELECT p.*, pt.given_name || ' ' || pt.family_name AS patient_name
       FROM pregnancies p
       JOIN patients pt ON pt.mrn = p.patient_mrn
      WHERE p.status = 'booked'`,
  );

  return open
    .map((p) => {
      const last = get<{ n: number; contact_date: string; next_due: string | null }>(
        `SELECT COUNT(*) AS n, MAX(contact_date) AS contact_date,
                (SELECT next_due FROM anc_contacts WHERE pregnancy_id = ?
                  ORDER BY contact_number DESC LIMIT 1) AS next_due
           FROM anc_contacts WHERE pregnancy_id = ?`,
        p.id,
        p.id,
      );
      const { edd, source } = expectedDate(p);
      return {
        pregnancy: p,
        patientName: p.patient_name,
        edd,
        eddSource: source,
        gestationWeeks: gestationWeeks(p, asOf),
        contacts: last?.n ?? 0,
        lastSeen: last?.contact_date ?? null,
        nextDue: last?.next_due ?? null,
        overdue: edd !== null && edd < asOf,
      };
    })
    .sort((a, b) => (a.edd ?? "9999").localeCompare(b.edd ?? "9999"));
}

/** Recent deliveries, newest first, with the babies attached. */
export function deliveryRegister(limit = 50) {
  const rows = all<Delivery & { patient_name: string; patient_mrn: string }>(
    `SELECT d.*, p.patient_mrn, pt.given_name || ' ' || pt.family_name AS patient_name
       FROM deliveries d
       JOIN pregnancies p ON p.id = d.pregnancy_id
       JOIN patients pt ON pt.mrn = p.patient_mrn
      ORDER BY d.delivered_at DESC
      LIMIT ?`,
    limit,
  );
  return rows.map((d) => ({
    delivery: d,
    patientName: d.patient_name,
    patientMrn: d.patient_mrn,
    babies: birthsFor(d.id),
    preterm: d.gestation_weeks !== null && d.gestation_weeks < TERM_WEEKS,
  }));
}

/**
 * Babies born here, with what their immunisation card says today.
 *
 * The count of overdue vaccines is the number the child health clinic works
 * from — a defaulter list for children, built from the same schedule the card
 * is printed from rather than from a second copy of it.
 */
export function childRegister(asOf = today()) {
  const babies = all<{ patient_mrn: string; name: string; date_of_birth: string | null; delivered_at: string }>(
    `SELECT b.patient_mrn, pt.given_name || ' ' || pt.family_name AS name,
            pt.date_of_birth, d.delivered_at
       FROM births b
       JOIN deliveries d ON d.id = b.delivery_id
       JOIN patients pt ON pt.mrn = b.patient_mrn
      WHERE b.patient_mrn IS NOT NULL AND b.outcome = 'live'
      ORDER BY d.delivered_at DESC`,
  );

  return babies.map((b) => {
    const card = immunisationCard(b.patient_mrn, asOf);
    return {
      mrn: b.patient_mrn,
      name: b.name,
      dateOfBirth: b.date_of_birth,
      ageWeeks: b.date_of_birth
        ? Math.floor((Date.parse(`${asOf}T00:00:00.000Z`) - Date.parse(`${b.date_of_birth}T00:00:00.000Z`)) / (7 * 86_400_000))
        : null,
      given: card.filter((v) => v.givenOn).length,
      overdue: card.filter((v) => v.overdue).length,
      nextDue: card.find((v) => !v.givenOn) ?? null,
    };
  });
}

/** Deliveries whose postnatal contacts are not complete. */
export function pncDue(asOf = today()) {
  return deliveryRegister(100)
    .filter((d) => d.delivery.mother_outcome === "alive")
    .map((d) => {
      const done = pncContactsFor(d.delivery.id);
      const hoursSince = (Date.parse(now()) - Date.parse(d.delivery.delivered_at)) / 3_600_000;
      const expected = PNC_SCHEDULE.filter((s) => hoursSince >= s.hoursAfter);
      return {
        deliveryId: d.delivery.id,
        patientName: d.patientName,
        patientMrn: d.patientMrn,
        deliveredAt: d.delivery.delivered_at,
        done: done.length,
        expected: expected.length,
        // The next one on the schedule that has not been done.
        next: PNC_SCHEDULE[done.length] ?? null,
        behind: done.length < expected.length,
      };
    })
    .filter((d) => d.next !== null)
    .sort((a, b) => Number(b.behind) - Number(a.behind) || a.deliveredAt.localeCompare(b.deliveredAt));
}
