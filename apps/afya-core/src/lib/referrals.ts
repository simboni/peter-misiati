/**
 * M29 Referrals — sending a patient on, and the letter that comes back.
 *
 * Kenya's referral system works on paper and mostly in one direction. A
 * patient leaves a dispensary with a letter and, from the dispensary's point
 * of view, disappears. Whether they were seen, what was found, what the clinic
 * is meant to continue — none of it comes back. That is the gap this module is
 * built around, and it is why the interesting state here is not `departed` but
 * `completed`.
 *
 * Four decisions worth stating:
 *
 *  ACCEPTANCE IS A GATE, NOT A COURTESY. A patient cannot be recorded as
 *  having departed towards a hospital that has not accepted them. The failure
 *  this prevents is real and routine: a critically ill patient put in a vehicle
 *  towards a referral hospital that has no bed, no surgeon, or no oxygen, and
 *  who arrives to be turned away. `depart` refuses on a referral that is merely
 *  raised.
 *
 *  A REFERRAL UPWARDS MUST SAY WHAT WAS TRIED. `treatmentGiven` is required on
 *  anything sent to a higher level. A referral that cannot say what was already
 *  done is how a county hospital ends up seeing everything a dispensary could
 *  have handled, and it is the single biggest complaint referral hospitals make.
 *
 *  THE LOOP CLOSES OR IT STAYS OPEN. There is no automatic tidy-up. A referral
 *  with no outcome stays on `awaitingOutcome` forever, ageing, because that
 *  list is the module's whole point. Closing it needs somebody to say what
 *  happened to the patient.
 *
 *  BOTH DIRECTIONS ARE KEPT. A facility that only records what it sends cannot
 *  show what it receives, and "we are a receiving facility" is an argument made
 *  with numbers or not at all.
 *
 * ⚠️ The escalation rule — which level may refer to which — is deliberately
 * advisory rather than enforced. Kenya's levels are a guide to capability, not
 * a permission system, and a dispensary with a dying patient does not need
 * software telling it to go via the health centre first. The module warns and
 * records; it does not block.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { resolvePatient } from "./patients.ts";
import { getFacility, LEVELS } from "./facility.ts";
import { notify } from "./notifications.ts";

export class ReferralError extends Error {}

export type Direction = "out" | "in";
export type Urgency = "emergency" | "urgent" | "routine";
export type ReferralStatus =
  | "raised"
  | "accepted"
  | "declined"
  | "departed"
  | "arrived"
  | "completed"
  | "cancelled";
export type Outcome = "treated_returned" | "admitted_there" | "died" | "absconded" | "not_seen" | "other";

/**
 * How long a referral may sit unanswered before it is chased, by urgency.
 *
 * ⚠️ These are operational rather than clinical, but an emergency referral
 * waiting an hour for an answer is a patient not moving. Needs a clinician's
 * and an administrator's agreement before go-live.
 */
export const ACCEPTANCE_TARGET_MINUTES: Record<Urgency, number> = {
  emergency: 30,
  urgent: 240,
  routine: 2880,
};

/** After this many days with no counter-referral, the loop is treated as broken. */
export const OUTCOME_CHASE_DAYS = 7;

export interface Referral {
  id: string;
  facility_id: number;
  patient_mrn: string;
  encounter_id: string | null;
  attendance_id: string | null;
  admission_id: string | null;
  direction: Direction;
  counterpart_code: string | null;
  external_name: string;
  urgency: Urgency;
  reason: string;
  treatment_given: string;
  clinical_summary: string;
  service_needed: string;
  status: ReferralStatus;
  raised_at: string;
  accepted_at: string | null;
  accepted_by_name: string;
  decline_reason: string;
  departed_at: string | null;
  transport: string;
  escort: string;
  arrived_at: string | null;
  outcome: Outcome | null;
  outcome_note: string;
  outcome_at: string | null;
  outcome_by_name: string;
  cancel_reason: string;
  raised_by: number | null;
  raiser_name: string;
  device_code: string | null;
  created_at: string;
}

export interface ReferralFacility {
  kmhfl_code: string;
  name: string;
  level: number;
  county: string;
  services: string;
  phone: string;
  active: number;
}

// ------------------------------------------------------------- the directory

export function defineReferralFacility(input: {
  kmhflCode: string;
  name: string;
  level: number;
  county?: string;
  services?: string;
  phone?: string;
}): void {
  if (input.level < 2 || input.level > 6) {
    throw new ReferralError("a facility level runs from 2 (dispensary) to 6 (national referral)");
  }
  run(
    `INSERT INTO referral_facilities (kmhfl_code, name, level, county, services, phone, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(kmhfl_code) DO UPDATE SET
       name = excluded.name, level = excluded.level, county = excluded.county,
       services = excluded.services, phone = excluded.phone`,
    input.kmhflCode.trim().toUpperCase(),
    input.name.trim(),
    input.level,
    input.county?.trim() ?? "",
    input.services?.trim() ?? "",
    input.phone?.trim() ?? "",
    now(),
  );
}

export function getReferralFacility(kmhflCode: string): ReferralFacility | undefined {
  return get<ReferralFacility>(
    `SELECT * FROM referral_facilities WHERE kmhfl_code = ?`,
    kmhflCode.trim().toUpperCase(),
  );
}

/** Destinations, highest level first — that is the order somebody scans them in. */
export function referralDirectory(minLevel = 2): ReferralFacility[] {
  return all<ReferralFacility>(
    `SELECT * FROM referral_facilities WHERE active = 1 AND level >= ? ORDER BY level DESC, name`,
    minLevel,
  );
}

// ------------------------------------------------------------------- raising

function record(
  referralId: string,
  from: ReferralStatus | "",
  to: ReferralStatus,
  note: string,
  byUserId: number | null,
  byName: string,
  at = now(),
): void {
  run(
    `INSERT INTO referral_events (referral_id, at, from_status, to_status, note, by_user_id, by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    referralId,
    at,
    from,
    to,
    note,
    byUserId,
    byName,
  );
}

/**
 * Raise a referral.
 *
 * Refuses a referral upwards that cannot say what was already done here. The
 * check is on the level difference rather than on a specialty list, because
 * what a facility can actually do is not something this software knows.
 */
export function raiseReferral(input: {
  facilityId: number;
  patientMrn: string;
  direction?: Direction;
  counterpartCode?: string;
  externalName?: string;
  urgency: Urgency;
  reason: string;
  treatmentGiven?: string;
  clinicalSummary?: string;
  serviceNeeded?: string;
  encounterId?: string | null;
  attendanceId?: string | null;
  admissionId?: string | null;
  raisedAt?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new ReferralError("no such patient");

  const direction = input.direction ?? "out";
  if (!input.reason.trim()) {
    throw new ReferralError("a referral must say why — the letter is read by somebody who has never met this patient");
  }

  const counterpart = input.counterpartCode ? getReferralFacility(input.counterpartCode) : undefined;
  if (input.counterpartCode && !counterpart) {
    throw new ReferralError(`${input.counterpartCode} is not in the referral directory`);
  }
  if (!counterpart && !input.externalName?.trim()) {
    throw new ReferralError("a referral needs a destination — pick one from the directory or name it");
  }

  const here = getFacility(input.facilityId);
  const goingUp = direction === "out" && here && counterpart && counterpart.level > here.level;

  if (goingUp && !input.treatmentGiven?.trim()) {
    throw new ReferralError(
      `a referral to ${counterpart!.name} (level ${counterpart!.level}) must record what was already done here — a referral that cannot say what was tried is how a referral hospital ends up seeing everything`,
    );
  }

  const id = mintLocalId(input.deviceCode, 8);
  const raisedAt = input.raisedAt ?? now();

  return tx(() => {
    run(
      `INSERT INTO referrals
         (id, facility_id, patient_mrn, encounter_id, attendance_id, admission_id, direction,
          counterpart_code, external_name, urgency, reason, treatment_given, clinical_summary,
          service_needed, status, raised_at, raised_by, raiser_name, device_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'raised', ?, ?, ?, ?, ?)`,
      id,
      input.facilityId,
      patient.mrn,
      input.encounterId ?? null,
      input.attendanceId ?? null,
      input.admissionId ?? null,
      direction,
      counterpart?.kmhfl_code ?? null,
      input.externalName?.trim() ?? "",
      input.urgency,
      input.reason.trim(),
      input.treatmentGiven?.trim() ?? "",
      input.clinicalSummary?.trim() ?? "",
      input.serviceNeeded?.trim() ?? "",
      raisedAt,
      input.byUserId,
      input.byUserName,
      input.deviceCode,
      now(),
    );
    record(id, "", "raised", input.reason.trim(), input.byUserId, input.byUserName, raisedAt);

    if (input.urgency === "emergency" && direction === "out") {
      notify({
        facilityId: input.facilityId,
        ownerRole: "clinician",
        severity: "critical",
        kind: "referral_emergency",
        subject: `Emergency referral to ${counterpart?.name ?? input.externalName} — ${input.reason.trim()}`,
        body: `Nobody travels until they accept. Chase the answer inside ${ACCEPTANCE_TARGET_MINUTES.emergency} minutes.`,
        entity: "referral",
        entityId: id,
        dedupeKey: `referral_emergency:${id}`,
      });
    }

    audit({
      action: "referral_raised",
      entity: "referral",
      entityId: id,
      patientId: patient.mrn,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: {
        direction,
        urgency: input.urgency,
        to: counterpart?.name ?? input.externalName,
        levelFrom: here?.level ?? null,
        levelTo: counterpart?.level ?? null,
      },
    });

    return id;
  });
}

export function getReferral(id: string): Referral | undefined {
  return get<Referral>(`SELECT * FROM referrals WHERE id = ?`, id);
}

export function referralsFor(patientMrn: string): Referral[] {
  return all<Referral>(`SELECT * FROM referrals WHERE patient_mrn = ? ORDER BY raised_at DESC`, patientMrn);
}

export function referralHistory(referralId: string) {
  return all<{ at: string; from_status: string; to_status: string; note: string; by_name: string }>(
    `SELECT at, from_status, to_status, note, by_name FROM referral_events WHERE referral_id = ? ORDER BY at, id`,
    referralId,
  );
}

// ------------------------------------------------------------ the transitions

const NEXT: Record<ReferralStatus, ReferralStatus[]> = {
  raised: ["accepted", "declined", "cancelled"],
  accepted: ["departed", "cancelled"],
  declined: ["cancelled"],
  departed: ["arrived", "completed"],
  arrived: ["completed"],
  completed: [],
  cancelled: [],
};

function move(
  referral: Referral,
  to: ReferralStatus,
  note: string,
  byUserId: number | null,
  byName: string,
  at = now(),
): void {
  if (!NEXT[referral.status].includes(to)) {
    throw new ReferralError(
      `a referral that is ${referral.status} cannot become ${to}${
        NEXT[referral.status].length ? ` — only ${NEXT[referral.status].join(" or ")}` : " — it is finished"
      }`,
    );
  }
  run(`UPDATE referrals SET status = ? WHERE id = ?`, to, referral.id);
  record(referral.id, referral.status, to, note, byUserId, byName, at);
}

/** The destination has said yes, and who said so. */
export function acceptReferral(input: {
  referralId: string;
  acceptedByName: string;
  note?: string;
  at?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const referral = getReferral(input.referralId);
  if (!referral) throw new ReferralError("no such referral");
  if (!input.acceptedByName.trim()) {
    // A name, because "they accepted" is not something anybody can follow up on
    // at two in the morning when the patient is turned away at the gate.
    throw new ReferralError("an acceptance must record who accepted it — a name, not just a yes");
  }

  tx(() => {
    move(referral, "accepted", input.note?.trim() ?? "", input.byUserId, input.byUserName, input.at);
    run(
      `UPDATE referrals SET accepted_at = ?, accepted_by_name = ? WHERE id = ?`,
      input.at ?? now(),
      input.acceptedByName.trim(),
      referral.id,
    );
    audit({
      action: "referral_accepted",
      entity: "referral",
      entityId: referral.id,
      patientId: referral.patient_mrn,
      facilityId: referral.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { acceptedBy: input.acceptedByName },
    });
  });
}

export function declineReferral(input: {
  referralId: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const referral = getReferral(input.referralId);
  if (!referral) throw new ReferralError("no such referral");
  if (!input.reason.trim()) {
    throw new ReferralError("a decline must say why — the next facility needs to know whether to try the same place");
  }

  tx(() => {
    move(referral, "declined", input.reason.trim(), input.byUserId, input.byUserName);
    run(`UPDATE referrals SET decline_reason = ? WHERE id = ?`, input.reason.trim(), referral.id);

    notify({
      facilityId: referral.facility_id,
      ownerRole: "clinician",
      severity: referral.urgency === "emergency" ? "critical" : "warning",
      kind: "referral_declined",
      subject: `Referral declined — ${input.reason.trim()}`,
      body: "The patient is still here and still needs somewhere to go. Find another destination.",
      entity: "referral",
      entityId: referral.id,
      dedupeKey: `referral_declined:${referral.id}`,
    });

    audit({
      action: "referral_declined",
      entity: "referral",
      entityId: referral.id,
      patientId: referral.patient_mrn,
      facilityId: referral.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { reason: input.reason },
    });
  });
}

/**
 * The patient has left.
 *
 * Only from `accepted`. This is the gate: nobody travels towards a hospital
 * that has not said it can take them.
 */
export function departReferral(input: {
  referralId: string;
  transport?: string;
  escort?: string;
  at?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const referral = getReferral(input.referralId);
  if (!referral) throw new ReferralError("no such referral");
  if (referral.status === "raised") {
    throw new ReferralError(
      "that referral has not been accepted yet — a patient must not travel towards a hospital that has not said it can take them",
    );
  }

  tx(() => {
    move(
      referral,
      "departed",
      [input.transport?.trim(), input.escort?.trim() && `escorted by ${input.escort.trim()}`].filter(Boolean).join(", "),
      input.byUserId,
      input.byUserName,
      input.at,
    );
    run(
      `UPDATE referrals SET departed_at = ?, transport = ?, escort = ? WHERE id = ?`,
      input.at ?? now(),
      input.transport?.trim() ?? "",
      input.escort?.trim() ?? "",
      referral.id,
    );
    audit({
      action: "referral_departed",
      entity: "referral",
      entityId: referral.id,
      patientId: referral.patient_mrn,
      facilityId: referral.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { transport: input.transport ?? null, escort: input.escort ?? null },
    });
  });
}

/** Confirmation that the patient reached the other end. */
export function confirmArrival(input: {
  referralId: string;
  at?: string;
  note?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const referral = getReferral(input.referralId);
  if (!referral) throw new ReferralError("no such referral");

  tx(() => {
    move(referral, "arrived", input.note?.trim() ?? "", input.byUserId, input.byUserName, input.at);
    run(`UPDATE referrals SET arrived_at = ? WHERE id = ?`, input.at ?? now(), referral.id);
  });
}

/**
 * Close the loop: the counter-referral.
 *
 * What the receiving facility did, and what this one is asked to continue.
 * This is the half of a referral that almost never comes back, and the reason
 * the module exists.
 */
export function recordOutcome(input: {
  referralId: string;
  outcome: Outcome;
  note: string;
  outcomeByName?: string;
  at?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const referral = getReferral(input.referralId);
  if (!referral) throw new ReferralError("no such referral");
  if (!input.note.trim()) {
    throw new ReferralError(
      "a counter-referral must say what happened and what this facility should continue — that is the whole point of it coming back",
    );
  }

  tx(() => {
    move(referral, "completed", input.note.trim(), input.byUserId, input.byUserName, input.at);
    run(
      `UPDATE referrals SET outcome = ?, outcome_note = ?, outcome_at = ?, outcome_by_name = ? WHERE id = ?`,
      input.outcome,
      input.note.trim(),
      input.at ?? now(),
      input.outcomeByName?.trim() ?? "",
      referral.id,
    );
    audit({
      action: "referral_completed",
      entity: "referral",
      entityId: referral.id,
      patientId: referral.patient_mrn,
      facilityId: referral.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { outcome: input.outcome, daysOpen: daysOpen(referral, input.at ?? now()) },
    });
  });
}

export function cancelReferral(input: {
  referralId: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const referral = getReferral(input.referralId);
  if (!referral) throw new ReferralError("no such referral");
  if (!input.reason.trim()) throw new ReferralError("cancelling a referral must record why");

  tx(() => {
    move(referral, "cancelled", input.reason.trim(), input.byUserId, input.byUserName);
    run(`UPDATE referrals SET cancel_reason = ? WHERE id = ?`, input.reason.trim(), referral.id);
    audit({
      action: "referral_cancelled",
      entity: "referral",
      entityId: referral.id,
      patientId: referral.patient_mrn,
      facilityId: referral.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { reason: input.reason, wasStatus: referral.status },
    });
  });
}

// ------------------------------------------------------------------ worklists

/** Whole days since the referral was raised. */
export function daysOpen(referral: Referral, asOf = now()): number {
  return Math.floor((Date.parse(asOf) - Date.parse(referral.raised_at)) / 86_400_000);
}

export function minutesWaiting(referral: Referral, asOf = now()): number {
  return Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(referral.raised_at)) / 60_000));
}

export interface ReferralRow {
  referral: Referral;
  patientName: string;
  destination: string;
  destinationLevel: number | null;
  minutesWaiting: number;
  daysOpen: number;
  /** Raised, and nobody has answered inside the target for its urgency. */
  unanswered: boolean;
  /** Gone, and no counter-referral after the chase period. */
  loopBroken: boolean;
}

function decorate(rows: (Referral & { patient_name: string })[], asOf: string): ReferralRow[] {
  return rows.map((r) => {
    const destination = r.counterpart_code ? getReferralFacility(r.counterpart_code) : undefined;
    const waiting = minutesWaiting(r, asOf);
    const days = daysOpen(r, asOf);
    return {
      referral: r,
      patientName: r.patient_name,
      destination: destination?.name ?? r.external_name,
      destinationLevel: destination?.level ?? null,
      minutesWaiting: waiting,
      daysOpen: days,
      unanswered: r.status === "raised" && waiting > ACCEPTANCE_TARGET_MINUTES[r.urgency],
      loopBroken:
        (r.status === "departed" || r.status === "arrived") && days >= OUTCOME_CHASE_DAYS,
    };
  });
}

/** Everything still live, worst first. */
export function referralWorklist(facilityId: number, direction: Direction = "out", asOf = now()): ReferralRow[] {
  const rows = all<Referral & { patient_name: string }>(
    `SELECT r.*, p.given_name || ' ' || p.family_name AS patient_name
       FROM referrals r
       JOIN patients p ON p.mrn = r.patient_mrn
      WHERE r.facility_id = ? AND r.direction = ? AND r.status NOT IN ('completed','cancelled')`,
    facilityId,
    direction,
  );

  const urgencyOrder = { emergency: 0, urgent: 1, routine: 2 } as const;
  return decorate(rows, asOf).sort(
    (a, b) =>
      Number(b.unanswered) - Number(a.unanswered) ||
      urgencyOrder[a.referral.urgency] - urgencyOrder[b.referral.urgency] ||
      b.minutesWaiting - a.minutesWaiting,
  );
}

/**
 * Referrals that left and never came back.
 *
 * The module's headline list. Oldest first, because the oldest is the one
 * nobody is going to chase unless a screen says so.
 */
export function awaitingOutcome(facilityId: number, asOf = now()): ReferralRow[] {
  const rows = all<Referral & { patient_name: string }>(
    `SELECT r.*, p.given_name || ' ' || p.family_name AS patient_name
       FROM referrals r
       JOIN patients p ON p.mrn = r.patient_mrn
      WHERE r.facility_id = ? AND r.direction = 'out' AND r.status IN ('departed','arrived')`,
    facilityId,
  );
  return decorate(rows, asOf).sort((a, b) => b.daysOpen - a.daysOpen);
}

export function referralLog(facilityId: number, direction?: Direction, limit = 50): ReferralRow[] {
  const clause = direction ? `AND r.direction = ?` : "";
  const params: (string | number)[] = direction ? [direction, limit] : [limit];
  const rows = all<Referral & { patient_name: string }>(
    `SELECT r.*, p.given_name || ' ' || p.family_name AS patient_name
       FROM referrals r
       JOIN patients p ON p.mrn = r.patient_mrn
      WHERE r.facility_id = ? ${clause}
      ORDER BY r.raised_at DESC
      LIMIT ?`,
    facilityId,
    ...params,
  );
  return decorate(rows, now());
}

export interface ReferralSummary {
  out: number;
  in: number;
  live: number;
  unanswered: number;
  declined: number;
  /** Departed or arrived, no counter-referral, past the chase period. */
  loopBroken: number;
  completed: number;
  /**
   * The share of referrals sent out that ever came back with an outcome. The
   * number that says whether the referral system works, and the one nobody
   * currently has.
   */
  loopClosedPercent: number | null;
  medianAcceptanceMinutes: number | null;
  byOutcome: Record<Outcome, number>;
}

export function referralSummary(facilityId: number, from?: string, to?: string): ReferralSummary {
  const clause = from && to ? `AND raised_at >= ? AND raised_at <= ?` : "";
  const params: (string | number)[] = from && to ? [`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`] : [];

  const rows = all<Referral>(`SELECT * FROM referrals WHERE facility_id = ? ${clause}`, facilityId, ...params);
  const outbound = rows.filter((r) => r.direction === "out");

  const accepted = rows.filter((r) => r.accepted_at);
  const acceptance = accepted
    .map((r) => Math.floor((Date.parse(r.accepted_at!) - Date.parse(r.raised_at)) / 60_000))
    .sort((a, b) => a - b);

  const byOutcome: Record<Outcome, number> = {
    treated_returned: 0, admitted_there: 0, died: 0, absconded: 0, not_seen: 0, other: 0,
  };
  for (const r of rows) if (r.outcome) byOutcome[r.outcome]++;

  // Only referrals that actually left can have a loop to close. One still
  // waiting for acceptance is a different problem.
  const departed = outbound.filter((r) => r.departed_at);
  const closed = departed.filter((r) => r.status === "completed");

  const live = referralWorklist(facilityId, "out").concat(referralWorklist(facilityId, "in"));

  return {
    out: outbound.length,
    in: rows.length - outbound.length,
    live: live.length,
    unanswered: live.filter((r) => r.unanswered).length,
    declined: rows.filter((r) => r.status === "declined").length,
    loopBroken: awaitingOutcome(facilityId).filter((r) => r.loopBroken).length,
    completed: rows.filter((r) => r.status === "completed").length,
    loopClosedPercent: departed.length === 0 ? null : Math.round((closed.length / departed.length) * 1000) / 10,
    medianAcceptanceMinutes: acceptance.length === 0 ? null : acceptance[Math.floor(acceptance.length / 2)],
    byOutcome,
  };
}

/**
 * The referral letter, assembled.
 *
 * Returned as data rather than rendered, so the same letter can be printed,
 * shown on a screen or sent through the integration hub without three versions
 * of it drifting apart.
 */
export function referralLetter(referralId: string) {
  const referral = getReferral(referralId);
  if (!referral) throw new ReferralError("no such referral");
  const patient = resolvePatient(referral.patient_mrn)!;
  const here = getFacility(referral.facility_id)!;
  const destination = referral.counterpart_code ? getReferralFacility(referral.counterpart_code) : undefined;

  return {
    reference: referral.id,
    raisedAt: referral.raised_at,
    from: { name: here.name, kmhflCode: here.kmhfl_code, level: here.level, levelName: LEVELS[here.level] },
    to: destination
      ? { name: destination.name, kmhflCode: destination.kmhfl_code, level: destination.level, phone: destination.phone }
      : { name: referral.external_name, kmhflCode: null, level: null, phone: "" },
    patient: {
      mrn: patient.mrn,
      name: `${patient.given_name} ${patient.family_name}`,
      sex: patient.sex,
      dateOfBirth: patient.date_of_birth,
      shaNumber: patient.sha_number,
    },
    urgency: referral.urgency,
    serviceNeeded: referral.service_needed,
    reason: referral.reason,
    treatmentGiven: referral.treatment_given,
    clinicalSummary: referral.clinical_summary,
    raisedBy: referral.raiser_name,
    status: referral.status,
    acceptedBy: referral.accepted_by_name || null,
    transport: referral.transport || null,
    escort: referral.escort || null,
  };
}

/**
 * The destinations a Kenyan facility actually refers to.
 *
 * ⚠️ Demonstration directory. The real one is a KMHFL extract for the county
 * and its neighbours, loaded at commissioning — which is a data task, not a
 * release.
 */
export function seedReferralDirectory(): void {
  const facilities: [string, string, number, string, string, string][] = [
    ["KNH-001", "Kenyatta National Hospital", 6, "Nairobi", "All specialties, ICU, trauma, oncology, renal", "020-2726300"],
    ["MTRH-001", "Moi Teaching & Referral Hospital", 6, "Uasin Gishu", "All specialties, ICU, oncology, cardiothoracic", "053-2033471"],
    ["KUTRRH-001", "Kenyatta University Teaching, Referral & Research Hospital", 6, "Kiambu", "Oncology, trauma, ICU, imaging", "0709-854000"],
    ["MAMA-LUCY-01", "Mama Lucy Kibaki Hospital", 5, "Nairobi", "Obstetrics, paediatrics, surgery, casualty", "020-2596453"],
    ["PUMWANI-01", "Pumwani Maternity Hospital", 5, "Nairobi", "Obstetrics, neonatal care", "020-2246650"],
    ["MBAGATHI-01", "Mbagathi County Hospital", 5, "Nairobi", "Medicine, surgery, obstetrics, HIV & TB", "020-2726300"],
    ["KIAMBU-L4-01", "Kiambu Level 4 Hospital", 4, "Kiambu", "Surgery, obstetrics, paediatrics, laboratory", "0721-000000"],
    ["MATHARE-HC-01", "Mathare North Health Centre", 3, "Nairobi", "Outpatient, maternity, immunisation", "0722-000000"],
    // A same-level neighbour. Sideways referrals are real — a dispensary with a
    // working laboratory takes what one without cannot do — and a directory of
    // only bigger hospitals quietly teaches everybody to refer upwards.
    ["KAYOLE-DISP-01", "Kayole Dispensary", 2, "Nairobi", "Outpatient, laboratory, family planning", "0733-000000"],
  ];
  for (const [code, name, level, county, services, phone] of facilities) {
    defineReferralFacility({ kmhflCode: code, name, level, county, services, phone });
  }
}
