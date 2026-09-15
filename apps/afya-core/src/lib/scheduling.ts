/**
 * M13 Scheduling & Appointments.
 *
 * Booking exists in this system for one reason that shows up in the accounts:
 * a patient who does not come is a slot that earned nothing and a follow-up
 * that did not happen. So the module tracks BOOKED AGAINST SEEN, not just
 * bookings, and `didNotAttend` is a state somebody has to set rather than a
 * silence.
 *
 * Two decisions worth stating:
 *
 *   SLOTS ARE GENERATED, THEN BOOKED INDIVIDUALLY. Not a recurrence rule
 *   evaluated at read time. A clinician cancelling one Tuesday morning should
 *   not require unpicking a rule while a patient is on the telephone.
 *
 *   TIMES ARE LOCAL WALL-CLOCK, NOT UTC. A clinic runs on the clock on the
 *   wall. A nine o'clock slot stays nine o'clock, and the machine's timezone is
 *   not allowed an opinion about it. (Kenya has no daylight saving, which is
 *   what makes this safe as well as simple.)
 *
 * Reminders go out through the integration hub, so the SMS that is sent in
 * demonstration mode is logged as simulated and never mistaken for a real one.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { resolvePatient } from "./patients.ts";
import { call } from "./integration.ts";
import { notify } from "./notifications.ts";

export class SchedulingError extends Error {}

export interface Slot {
  id: string;
  facility_id: number;
  provider_id: number;
  department: string;
  slot_date: string;
  start_time: string;
  minutes: number;
  capacity: number;
  blocked: number;
  block_reason: string | null;
  created_at: string;
}

export type AppointmentStatus = "booked" | "arrived" | "completed" | "cancelled" | "did_not_attend";

export interface Appointment {
  id: string;
  slot_id: string;
  patient_mrn: string;
  reason: string;
  status: AppointmentStatus;
  visit_id: string | null;
  booked_by: number | null;
  booker_name: string;
  cancelled_reason: string | null;
  reminded_at: string | null;
  created_at: string;
  updated_at: string;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lay out a clinic session as individual slots.
 *
 * Idempotent on (provider, date, time): running it twice for the same morning
 * does not double the clinic, which matters because somebody will.
 */
export function openClinic(input: {
  facilityId: number;
  providerId: number;
  date: string;
  /** 24-hour local times, e.g. "09:00" and "12:30". */
  from: string;
  to: string;
  minutes?: number;
  capacity?: number;
  department?: string;
  deviceCode: string;
}): string[] {
  if (!DATE.test(input.date)) throw new SchedulingError("a clinic date must be YYYY-MM-DD");
  if (!TIME.test(input.from) || !TIME.test(input.to)) {
    throw new SchedulingError("clinic times must be 24-hour HH:MM, e.g. 09:00");
  }

  const minutes = input.minutes ?? 15;
  if (minutes <= 0) throw new SchedulingError("a slot must be longer than zero minutes");

  const start = toMinutes(input.from);
  const end = toMinutes(input.to);
  if (end <= start) throw new SchedulingError(`the clinic ends at ${input.to}, which is not after ${input.from}`);

  const created: string[] = [];

  return tx(() => {
    for (let at = start; at + minutes <= end; at += minutes) {
      const time = fromMinutes(at);
      const existing = get<Slot>(
        `SELECT * FROM slots WHERE provider_id = ? AND slot_date = ? AND start_time = ?`,
        input.providerId,
        input.date,
        time,
      );
      if (existing) {
        created.push(existing.id);
        continue;
      }

      const id = mintLocalId(input.deviceCode, 8);
      run(
        `INSERT INTO slots (id, facility_id, provider_id, department, slot_date, start_time, minutes, capacity, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.facilityId,
        input.providerId,
        input.department ?? "outpatient",
        input.date,
        time,
        minutes,
        input.capacity ?? 1,
        now(),
      );
      created.push(id);
    }
    return created;
  });
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Take a slot out of use.
 *
 * Refuses while somebody is booked into it: the patients have to be moved
 * first, and told. Closing a clinic over the top of live bookings is how people
 * arrive to find nobody expecting them.
 */
export function blockSlot(input: { slotId: string; reason: string; byUserId: number | null; byUserName: string }): void {
  if (!input.reason.trim()) throw new SchedulingError("blocking a slot must record why");
  const booked = bookingsIn(input.slotId).filter((a) => a.status === "booked" || a.status === "arrived");
  if (booked.length > 0) {
    throw new SchedulingError(
      `${booked.length} patient${booked.length === 1 ? " is" : "s are"} booked into this slot — move them first`,
    );
  }
  run(`UPDATE slots SET blocked = 1, block_reason = ? WHERE id = ?`, input.reason.trim(), input.slotId);
}

export function getSlot(id: string): Slot | undefined {
  return get<Slot>(`SELECT * FROM slots WHERE id = ?`, id);
}

export function bookingsIn(slotId: string): Appointment[] {
  return all<Appointment>(`SELECT * FROM appointments WHERE slot_id = ?`, slotId);
}

function takenIn(slotId: string): number {
  return bookingsIn(slotId).filter((a) => a.status === "booked" || a.status === "arrived" || a.status === "completed")
    .length;
}

export interface FreeSlot extends Slot {
  providerName: string;
  taken: number;
  free: number;
}

/** What can actually be booked on a day. */
export function availability(input: {
  facilityId: number;
  date: string;
  providerId?: number;
  department?: string;
}): FreeSlot[] {
  const rows = all<Slot & { provider_name: string }>(
    `SELECT s.*, u.name AS provider_name FROM slots s JOIN users u ON u.id = s.provider_id
      WHERE s.facility_id = ? AND s.slot_date = ? AND s.blocked = 0
        AND (? IS NULL OR s.provider_id = ?)
        AND (? IS NULL OR s.department = ?)
      ORDER BY s.start_time, u.name`,
    input.facilityId,
    input.date,
    input.providerId ?? null,
    input.providerId ?? null,
    input.department ?? null,
    input.department ?? null,
  );

  return rows
    .map((s) => {
      const taken = takenIn(s.id);
      return { ...s, providerName: s.provider_name, taken, free: s.capacity - taken };
    })
    .filter((s) => s.free > 0);
}

/**
 * Book a patient into a slot.
 *
 * Refuses an over-booking, a blocked slot and a date in the past, and refuses
 * to book the same patient twice into the same slot — all three of which happen
 * at a busy desk.
 */
export function book(input: {
  slotId: string;
  patientMrn: string;
  reason?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const slot = getSlot(input.slotId);
  if (!slot) throw new SchedulingError("no such slot");
  if (slot.blocked) throw new SchedulingError(`that slot is not available: ${slot.block_reason ?? "blocked"}`);
  if (slot.slot_date < today()) throw new SchedulingError("that slot is in the past");

  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new SchedulingError("no such patient");

  const existing = bookingsIn(slot.id);
  if (existing.some((a) => a.patient_mrn === patient.mrn && (a.status === "booked" || a.status === "arrived"))) {
    throw new SchedulingError("this patient is already booked into that slot");
  }
  if (takenIn(slot.id) >= slot.capacity) {
    throw new SchedulingError(`${slot.start_time} is full`);
  }

  const id = mintLocalId(input.deviceCode, 8);
  const at = now();

  return tx(() => {
    run(
      `INSERT INTO appointments (id, slot_id, patient_mrn, reason, status, booked_by, booker_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'booked', ?, ?, ?, ?)`,
      id,
      slot.id,
      patient.mrn,
      input.reason?.trim() ?? "",
      input.byUserId,
      input.byUserName,
      at,
      at,
    );
    audit({
      action: "appointment_booked",
      entity: "appointment",
      entityId: id,
      patientId: patient.mrn,
      facilityId: slot.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { date: slot.slot_date, time: slot.start_time, providerId: slot.provider_id },
    });
    return id;
  });
}

export function getAppointment(id: string): (Appointment & Pick<Slot, "slot_date" | "start_time">) | undefined {
  return get(
    `SELECT a.*, s.slot_date, s.start_time FROM appointments a JOIN slots s ON s.id = a.slot_id WHERE a.id = ?`,
    id,
  );
}

export function cancelAppointment(input: {
  appointmentId: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const appointment = getAppointment(input.appointmentId);
  if (!appointment) throw new SchedulingError("no such appointment");
  if (!input.reason.trim()) throw new SchedulingError("cancelling an appointment must record why");
  if (appointment.status === "completed") throw new SchedulingError("that appointment has already happened");

  tx(() => {
    run(
      `UPDATE appointments SET status = 'cancelled', cancelled_reason = ?, updated_at = ? WHERE id = ?`,
      input.reason.trim(),
      now(),
      input.appointmentId,
    );
    audit({
      action: "appointment_cancelled",
      entity: "appointment",
      entityId: input.appointmentId,
      patientId: appointment.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { reason: input.reason, date: appointment.slot_date },
    });
  });
}

/** Link an appointment to the visit it became, when the patient checks in. */
export function markArrived(input: { appointmentId: string; visitId: string }): void {
  run(
    `UPDATE appointments SET status = 'arrived', visit_id = ?, updated_at = ? WHERE id = ?`,
    input.visitId,
    now(),
    input.appointmentId,
  );
}

export function markCompleted(appointmentId: string): void {
  run(`UPDATE appointments SET status = 'completed', updated_at = ? WHERE id = ?`, now(), appointmentId);
}

/**
 * Close off yesterday's clinic.
 *
 * Everything still merely `booked` after its slot has passed did not attend.
 * Saying so is what makes the no-show rate a real number rather than an
 * impression, and a patient who misses a follow-up is somebody to telephone.
 */
export function closeOutDay(input: { facilityId: number; date: string }): { didNotAttend: number } {
  const stale = all<Appointment & { slot_date: string }>(
    `SELECT a.*, s.slot_date FROM appointments a JOIN slots s ON s.id = a.slot_id
      WHERE s.facility_id = ? AND s.slot_date = ? AND a.status = 'booked'`,
    input.facilityId,
    input.date,
  );

  for (const appointment of stale) {
    run(`UPDATE appointments SET status = 'did_not_attend', updated_at = ? WHERE id = ?`, now(), appointment.id);
  }

  if (stale.length > 0) {
    notify({
      facilityId: input.facilityId,
      ownerRole: "receptionist",
      severity: "info",
      kind: "did_not_attend",
      subject: `${stale.length} patient${stale.length === 1 ? "" : "s"} did not attend on ${input.date}`,
      body: "Follow-ups that did not happen. Each is somebody to telephone.",
      entity: "appointment",
      entityId: input.date,
      dedupeKey: `dna:${input.date}`,
    });
  }

  return { didNotAttend: stale.length };
}

/**
 * Send tomorrow's reminders.
 *
 * Through the integration hub, so a reminder "sent" in demonstration mode is
 * recorded as simulated. A patient with no mobile number on file is reported,
 * not silently skipped — that is a data-quality job for the front desk.
 */
export function sendReminders(input: { facilityId: number; date: string }): {
  sent: number;
  failed: number;
  noNumber: string[];
} {
  const due = all<Appointment & { slot_date: string; start_time: string; phone: string | null; given_name: string }>(
    `SELECT a.*, s.slot_date, s.start_time, p.phone, p.given_name
       FROM appointments a
       JOIN slots s ON s.id = a.slot_id
       JOIN patients p ON p.mrn = a.patient_mrn
      WHERE s.facility_id = ? AND s.slot_date = ? AND a.status = 'booked' AND a.reminded_at IS NULL`,
    input.facilityId,
    input.date,
  );

  let sent = 0;
  let failed = 0;
  const noNumber: string[] = [];

  for (const appointment of due) {
    if (!appointment.phone) {
      noNumber.push(appointment.patient_mrn);
      continue;
    }

    const result = call({
      endpoint: "SMS",
      operation: "send",
      request: {
        to: appointment.phone,
        body: `Hello ${appointment.given_name}, your appointment is on ${appointment.slot_date} at ${appointment.start_time}. Reply if you cannot come.`,
      },
    });

    if (result.ok) {
      run(`UPDATE appointments SET reminded_at = ? WHERE id = ?`, now(), appointment.id);
      sent++;
    } else {
      failed++;
    }
  }

  return { sent, failed, noNumber };
}

// ------------------------------------------------------------------- reports

export function appointmentsFor(patientMrn: string): (Appointment & { slot_date: string; start_time: string })[] {
  return all(
    `SELECT a.*, s.slot_date, s.start_time FROM appointments a JOIN slots s ON s.id = a.slot_id
      WHERE a.patient_mrn = ? ORDER BY s.slot_date DESC, s.start_time DESC`,
    patientMrn,
  );
}

export function dayList(input: { facilityId: number; date: string }): (Appointment & {
  slot_date: string;
  start_time: string;
  patient_name: string;
  provider_name: string;
})[] {
  return all(
    `SELECT a.*, s.slot_date, s.start_time,
            p.given_name || ' ' || p.family_name AS patient_name,
            u.name AS provider_name
       FROM appointments a
       JOIN slots s ON s.id = a.slot_id
       JOIN patients p ON p.mrn = a.patient_mrn
       JOIN users u ON u.id = s.provider_id
      WHERE s.facility_id = ? AND s.slot_date = ? AND a.status <> 'cancelled'
      ORDER BY s.start_time`,
    input.facilityId,
    input.date,
  );
}

export interface AttendanceStats {
  booked: number;
  attended: number;
  didNotAttend: number;
  cancelled: number;
  /** Null until there is something to divide by. */
  noShowRatePercent: number | null;
  utilisationPercent: number | null;
}

/**
 * Booked against seen.
 *
 * The no-show rate is the number this module exists to produce: it is the
 * difference between a clinic that looks busy on paper and one that earns.
 */
export function attendance(input: { facilityId: number; from: string; to: string }): AttendanceStats {
  const rows = all<{ status: AppointmentStatus }>(
    `SELECT a.status FROM appointments a JOIN slots s ON s.id = a.slot_id
      WHERE s.facility_id = ? AND s.slot_date BETWEEN ? AND ?`,
    input.facilityId,
    input.from,
    input.to,
  );

  const capacity =
    get<{ c: number }>(
      `SELECT COALESCE(SUM(capacity), 0) AS c FROM slots
        WHERE facility_id = ? AND slot_date BETWEEN ? AND ? AND blocked = 0`,
      input.facilityId,
      input.from,
      input.to,
    )?.c ?? 0;

  const count = (s: AppointmentStatus) => rows.filter((r) => r.status === s).length;
  const attended = count("arrived") + count("completed");
  const didNotAttend = count("did_not_attend");
  const decided = attended + didNotAttend;

  return {
    booked: rows.length,
    attended,
    didNotAttend,
    cancelled: count("cancelled"),
    noShowRatePercent: decided === 0 ? null : Math.round((didNotAttend / decided) * 1000) / 10,
    utilisationPercent: capacity === 0 ? null : Math.round((attended / capacity) * 1000) / 10,
  };
}
