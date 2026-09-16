/**
 * M60 Human Resources.
 *
 * Built on the payroll's `employees` and the access module's
 * `practitioner_licences` rather than a third list of staff, because three
 * lists of the same people is how a facility ends up paying somebody who left
 * and rostering somebody whose licence expired.
 *
 * What this module adds is contracts, leave, and one question that makes it a
 * clinical system rather than a personnel spreadsheet:
 *
 *  IF THIS PERSON IS AWAY, WHO COVERS THEM? A laboratory with one technologist
 *  is a laboratory that closes when she takes leave, and nobody finds out until
 *  the morning she does not arrive. `coverFor` answers it before the leave is
 *  approved, by looking at who else holds the same regulator's registration —
 *  not who has the same job title, because a title is what a facility calls
 *  somebody and a registration is what the law lets them do.
 *
 *  LEAVE IS NOT BLOCKED FOR WANT OF COVER — IT IS ACKNOWLEDGED. People are
 *  entitled to leave, and software that refuses it teaches a facility to keep
 *  its leave register in a notebook. So an approver who goes ahead with nobody
 *  covering has to say so, and that acknowledgement is the record.
 *
 *  A LICENCE EXPIRY IS NOT AN HR INCONVENIENCE. It stops the person working —
 *  the access module already refuses a licensed action on a lapsed licence, and
 *  has since the beginning. HR's job is to see it coming, far enough ahead that
 *  renewal is possible.
 *
 *  A LEAVE BALANCE IS THE SUM OF ROWS, NEVER A NUMBER SOMEBODY EDITED. Accrual,
 *  leave taken and explicit adjustments each leave a row, so a balance can
 *  always be explained.
 *
 * ⚠️ The statutory entitlements are the Employment Act 2007 minimums as
 * understood at the time of writing. A facility may be more generous, a
 * collective agreement may say otherwise, and both belong in the data rather
 * than in this file. An HR adviser must confirm them.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { getEmployee, listEmployees, type Employee } from "./payroll.ts";
import { notify } from "./notifications.ts";

export class HrError extends Error {}

export type ContractKind = "permanent" | "fixed_term" | "locum" | "internship" | "probation";
export type LeaveStatus = "requested" | "approved" | "declined" | "cancelled" | "taken";
export type CaseKind = "disciplinary" | "grievance" | "performance";
export type CaseOutcome =
  | "no_action"
  | "counselled"
  | "written_warning"
  | "final_warning"
  | "dismissed"
  | "upheld"
  | "not_upheld"
  | "withdrawn";

/**
 * How far ahead a licence or contract expiry is worth seeing.
 *
 * ⚠️ Ninety days is enough for a KMPDC or NCK renewal to be possible. It is a
 * judgement, and a facility with slower internal approvals wants longer.
 */
export const EXPIRY_HORIZON_DAYS = 90;

// ------------------------------------------------------------------ contracts

export function issueContract(input: {
  employeeId: string;
  kind: ContractKind;
  startsOn: string;
  endsOn?: string;
  noticeDays?: number;
  terms?: string;
  signedOn?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const employee = getEmployee(input.employeeId);
  if (!employee) throw new HrError("no such employee");
  if (input.kind !== "permanent" && !input.endsOn) {
    // A fixed-term contract with no end date is a permanent contract nobody
    // meant to give, and a tribunal will read it that way.
    throw new HrError(`a ${input.kind.replace("_", " ")} contract must say when it ends`);
  }
  if (input.endsOn && input.endsOn < input.startsOn) {
    throw new HrError("a contract cannot end before it starts");
  }

  const id = mintLocalId(input.deviceCode, 8);
  const current = currentContract(employee.id);

  return tx(() => {
    run(
      `INSERT INTO contracts
         (id, employee_id, kind, starts_on, ends_on, notice_days, terms, signed_on,
          created_by, creator_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      employee.id,
      input.kind,
      input.startsOn,
      input.endsOn ?? null,
      input.noticeDays ?? null,
      input.terms?.trim() ?? "",
      input.signedOn ?? null,
      input.byUserId,
      input.byUserName,
      now(),
    );
    // A renewal supersedes rather than replaces: the old terms are what applied
    // while they applied, and an employment dispute is fought over exactly that.
    if (current) run(`UPDATE contracts SET superseded_by = ? WHERE id = ?`, id, current.id);

    audit({
      action: "contract_issued",
      entity: "employee",
      entityId: employee.id,
      facilityId: employee.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      detail: { kind: input.kind, startsOn: input.startsOn, endsOn: input.endsOn ?? null, supersedes: current?.id ?? null },
    });
    return id;
  });
}

export function currentContract(employeeId: string) {
  return get<{
    id: string;
    kind: ContractKind;
    starts_on: string;
    ends_on: string | null;
    notice_days: number | null;
    terms: string;
    signed_on: string | null;
  }>(
    `SELECT * FROM contracts WHERE employee_id = ? AND superseded_by IS NULL
      ORDER BY starts_on DESC LIMIT 1`,
    employeeId,
  );
}

export function contractHistory(employeeId: string) {
  return all<{
    id: string;
    kind: ContractKind;
    starts_on: string;
    ends_on: string | null;
    signed_on: string | null;
    superseded_by: string | null;
    creator_name: string;
  }>(`SELECT * FROM contracts WHERE employee_id = ? ORDER BY starts_on DESC`, employeeId);
}

// --------------------------------------------------------------------- leave

export function defineLeaveType(input: {
  code: string;
  name: string;
  annualDays?: number;
  perEventDays?: number;
  paid?: boolean;
  carriesOver?: boolean;
  maxCarryDays?: number;
  effectiveFrom: string;
  source: string;
}): void {
  if (!input.source.trim()) throw new HrError("a leave entitlement must record where it comes from");
  run(
    `INSERT INTO leave_types
       (code, name, annual_days, per_event_days, paid, carries_over, max_carry_days, effective_from, source, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(code) DO UPDATE SET
       name = excluded.name, annual_days = excluded.annual_days, per_event_days = excluded.per_event_days,
       paid = excluded.paid, carries_over = excluded.carries_over, max_carry_days = excluded.max_carry_days,
       effective_from = excluded.effective_from, source = excluded.source`,
    input.code.trim().toUpperCase(),
    input.name.trim(),
    input.annualDays ?? null,
    input.perEventDays ?? null,
    input.paid === false ? 0 : 1,
    input.carriesOver ? 1 : 0,
    input.maxCarryDays ?? null,
    input.effectiveFrom,
    input.source.trim(),
    now(),
  );
}

export function leaveTypes() {
  return all<{
    code: string;
    name: string;
    annual_days: number | null;
    per_event_days: number | null;
    paid: number;
    carries_over: number;
    max_carry_days: number | null;
    effective_from: string;
    source: string;
  }>(`SELECT * FROM leave_types WHERE active = 1 ORDER BY code`);
}

export function getLeaveType(code: string) {
  return leaveTypes().find((t) => t.code === code.trim().toUpperCase());
}

/**
 * Working days between two dates, inclusive, excluding weekends.
 *
 * ⚠️ Public holidays are not excluded, because Kenya's are partly gazetted
 * each year and partly moveable. A facility that wants them handled loads a
 * holiday calendar, and that is a gap the review register names.
 */
export function workingDays(from: string, to: string): number {
  if (to < from) throw new HrError("leave cannot end before it starts");
  let days = 0;
  for (let t = Date.parse(`${from}T00:00:00.000Z`); t <= Date.parse(`${to}T00:00:00.000Z`); t += 86_400_000) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) days++;
  }
  return days;
}

export interface LeaveBalance {
  code: string;
  name: string;
  entitledDays: number;
  takenDays: number;
  bookedDays: number;
  adjustmentDays: number;
  remainingDays: number;
  paid: boolean;
}

/**
 * A leave balance, as the sum of rows.
 *
 * Never a stored number: accrual, leave taken and explicit adjustments each
 * leave a row, so a balance can always be explained to the person whose it is.
 */
export function leaveBalance(employeeId: string, year = Number(today().slice(0, 4))): LeaveBalance[] {
  const employee = getEmployee(employeeId);
  if (!employee) throw new HrError("no such employee");

  return leaveTypes()
    .filter((t) => t.annual_days !== null)
    .map((t) => {
      const rows = all<{ status: LeaveStatus; days: number }>(
        `SELECT status, days FROM leave_requests
          WHERE employee_id = ? AND leave_code = ? AND substr(starts_on, 1, 4) = ?
            AND status IN ('approved','taken')`,
        employeeId,
        t.code,
        String(year),
      );
      const taken = rows.filter((r) => r.status === "taken").reduce((sum, r) => sum + r.days, 0);
      const booked = rows.filter((r) => r.status === "approved").reduce((sum, r) => sum + r.days, 0);

      const adjustment =
        get<{ total: number }>(
          `SELECT COALESCE(SUM(days), 0) AS total FROM leave_adjustments
            WHERE employee_id = ? AND leave_code = ? AND year = ?`,
          employeeId,
          t.code,
          year,
        )?.total ?? 0;

      const entitled = t.annual_days ?? 0;
      return {
        code: t.code,
        name: t.name,
        entitledDays: entitled,
        takenDays: taken,
        bookedDays: booked,
        adjustmentDays: adjustment,
        remainingDays: entitled + adjustment - taken - booked,
        paid: t.paid === 1,
      };
    });
}

export function adjustLeave(input: {
  employeeId: string;
  leaveCode: string;
  year: number;
  days: number;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  if (!getEmployee(input.employeeId)) throw new HrError("no such employee");
  if (!getLeaveType(input.leaveCode)) throw new HrError("no such leave type");
  if (!Number.isInteger(input.days) || input.days === 0) {
    throw new HrError("an adjustment is a whole number of days and never zero");
  }
  if (!input.reason.trim()) throw new HrError("a leave adjustment must record why");

  run(
    `INSERT INTO leave_adjustments (employee_id, leave_code, year, days, reason, by_user_id, by_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    input.employeeId,
    input.leaveCode.trim().toUpperCase(),
    input.year,
    input.days,
    input.reason.trim(),
    input.byUserId,
    input.byUserName,
    now(),
  );
  audit({
    action: "leave_adjusted",
    entity: "employee",
    entityId: input.employeeId,
    actorId: input.byUserId,
    actorName: input.byUserName,
    purpose: "administration",
    detail: { leaveCode: input.leaveCode, year: input.year, days: input.days, reason: input.reason },
  });
}

// ------------------------------------------------------------------- cover

export interface Cover {
  employeeId: string;
  name: string;
  jobTitle: string;
  regulator: string;
  licenceNumber: string;
  expiresOn: string;
  /** Already on leave over the same dates. */
  alsoAway: boolean;
}

/**
 * Who else could do this person's licensed work while they are away.
 *
 * Matched on the REGULATOR, not the job title: a title is what a facility calls
 * somebody and a registration is what the law lets them do. Two people both
 * called "Clinical Officer" where only one holds a COC registration is exactly
 * the case this has to get right.
 */
export function coverFor(employeeId: string, from: string, to: string): {
  regulators: string[];
  candidates: Cover[];
  uncovered: string[];
} {
  const employee = getEmployee(employeeId);
  if (!employee) throw new HrError("no such employee");

  // The registrations this person holds. Somebody with none — a cleaner, a
  // records clerk — needs no licensed cover, and saying so is not a failure.
  const held = employee.user_id
    ? all<{ regulator: string }>(
        `SELECT DISTINCT regulator FROM practitioner_licences WHERE user_id = ? AND expires_on >= ?`,
        employee.user_id,
        from,
      ).map((r) => r.regulator)
    : [];

  if (held.length === 0) return { regulators: [], candidates: [], uncovered: [] };

  const candidates: Cover[] = [];
  for (const regulator of held) {
    const others = all<{
      employee_id: string;
      name: string;
      job_title: string;
      regulator: string;
      licence_number: string;
      expires_on: string;
    }>(
      `SELECT e.id AS employee_id, e.given_name || ' ' || e.family_name AS name, e.job_title,
              l.regulator, l.licence_number, l.expires_on
         FROM practitioner_licences l
         JOIN employees e ON e.user_id = l.user_id
        WHERE l.regulator = ? AND e.id <> ? AND e.active = 1
          -- A licence that lapses during the absence is not cover.
          AND l.expires_on >= ?`,
      regulator,
      employee.id,
      to,
    );

    for (const other of others) {
      const away = get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM leave_requests
          WHERE employee_id = ? AND status IN ('approved','taken')
            AND starts_on <= ? AND ends_on >= ?`,
        other.employee_id,
        to,
        from,
      );
      candidates.push({
        employeeId: other.employee_id,
        name: other.name,
        jobTitle: other.job_title,
        regulator: other.regulator,
        licenceNumber: other.licence_number,
        expiresOn: other.expires_on,
        alsoAway: (away?.n ?? 0) > 0,
      });
    }
  }

  const uncovered = held.filter(
    (regulator) => !candidates.some((c) => c.regulator === regulator && !c.alsoAway),
  );

  return { regulators: held, candidates, uncovered };
}

// ----------------------------------------------------------- leave requests

export function requestLeave(input: {
  employeeId: string;
  leaveCode: string;
  startsOn: string;
  endsOn: string;
  reason?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): { id: string; days: number; uncovered: string[] } {
  const employee = getEmployee(input.employeeId);
  if (!employee) throw new HrError("no such employee");
  if (!employee.active) throw new HrError("that employment has ended");
  const type = getLeaveType(input.leaveCode);
  if (!type) throw new HrError(`${input.leaveCode} is not a leave type on this system`);

  const days = workingDays(input.startsOn, input.endsOn);
  if (days === 0) throw new HrError("that is no working days — check the dates");

  const overlap = get<{ id: string }>(
    `SELECT id FROM leave_requests
      WHERE employee_id = ? AND status IN ('requested','approved','taken')
        AND starts_on <= ? AND ends_on >= ?`,
    employee.id,
    input.endsOn,
    input.startsOn,
  );
  if (overlap) throw new HrError("that overlaps leave already on the register");

  const cover = coverFor(employee.id, input.startsOn, input.endsOn);
  const id = mintLocalId(input.deviceCode, 8);

  return tx(() => {
    run(
      `INSERT INTO leave_requests
         (id, employee_id, leave_code, starts_on, ends_on, days, reason, status,
          requested_by, requester_name, requested_at, device_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?)`,
      id,
      employee.id,
      type.code,
      input.startsOn,
      input.endsOn,
      days,
      input.reason?.trim() ?? "",
      input.byUserId,
      input.byUserName,
      now(),
      input.deviceCode,
      now(),
    );
    audit({
      action: "leave_requested",
      entity: "employee",
      entityId: employee.id,
      facilityId: employee.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      detail: { leaveCode: type.code, startsOn: input.startsOn, endsOn: input.endsOn, days, uncovered: cover.uncovered },
    });
    return { id, days, uncovered: cover.uncovered };
  });
}

/**
 * Approve or decline leave.
 *
 * Going ahead with nobody holding the same registration is allowed — people are
 * entitled to leave — but it has to be acknowledged in writing. Refusing
 * outright would teach a facility to keep its leave register in a notebook,
 * where nobody can see the gap at all.
 */
export function decideLeave(input: {
  requestId: string;
  approve: boolean;
  coverEmployeeId?: string;
  coverNote?: string;
  uncoveredAck?: string;
  note?: string;
  byUserId: number;
  byUserName: string;
}): void {
  const request = getLeaveRequest(input.requestId);
  if (!request) throw new HrError("no such leave request");
  if (request.status !== "requested") throw new HrError(`that request is already ${request.status}`);
  if (request.requested_by === input.byUserId) {
    throw new HrError("somebody else approves leave — not the person who asked for it");
  }
  if (!input.approve && !input.note?.trim()) {
    throw new HrError("declining leave must say why");
  }

  const employee = getEmployee(request.employee_id)!;

  if (input.approve) {
    const balance = leaveBalance(employee.id, Number(request.starts_on.slice(0, 4)))
      .find((b) => b.code === request.leave_code);
    if (balance && balance.remainingDays < request.days) {
      throw new HrError(
        `${employee.given_name} has ${balance.remainingDays} days of ${balance.name} left and this is ${request.days}. Adjust the balance first, with a reason, rather than approving past it.`,
      );
    }

    const cover = coverFor(employee.id, request.starts_on, request.ends_on);
    if (cover.uncovered.length > 0 && !input.uncoveredAck?.trim()) {
      throw new HrError(
        `nobody else registered with ${cover.uncovered.join(" or ")} is available over those dates. Approving anyway must record how the work will be covered.`,
      );
    }
  }

  tx(() => {
    run(
      `UPDATE leave_requests
          SET status = ?, cover_employee_id = ?, cover_note = ?, uncovered_ack = ?,
              decided_by = ?, decider_name = ?, decided_at = ?, decision_note = ?
        WHERE id = ?`,
      input.approve ? "approved" : "declined",
      input.coverEmployeeId ?? null,
      input.coverNote?.trim() ?? "",
      input.uncoveredAck?.trim() ?? "",
      input.byUserId,
      input.byUserName,
      now(),
      input.note?.trim() ?? "",
      request.id,
    );

    if (input.approve && input.uncoveredAck?.trim()) {
      notify({
        facilityId: employee.facility_id,
        ownerRole: "admin",
        severity: "warning",
        kind: "leave_uncovered",
        subject: `${employee.given_name} ${employee.family_name} away ${request.starts_on} to ${request.ends_on} with nobody registered to cover`,
        body: input.uncoveredAck.trim(),
        entity: "employee",
        entityId: employee.id,
        dedupeKey: `leave_uncovered:${request.id}`,
      });
    }

    audit({
      action: input.approve ? "leave_approved" : "leave_declined",
      entity: "employee",
      entityId: employee.id,
      facilityId: employee.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: {
        leaveCode: request.leave_code,
        days: request.days,
        requestedBy: request.requester_name,
        cover: input.coverEmployeeId ?? null,
        uncoveredAck: input.uncoveredAck ?? null,
      },
    });
  });
}

export function markTaken(input: { requestId: string; byUserId: number | null; byUserName: string }): void {
  const request = getLeaveRequest(input.requestId);
  if (!request) throw new HrError("no such leave request");
  if (request.status !== "approved") throw new HrError(`that request is ${request.status}`);
  run(`UPDATE leave_requests SET status = 'taken' WHERE id = ?`, request.id);
}

export function cancelLeave(input: {
  requestId: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const request = getLeaveRequest(input.requestId);
  if (!request) throw new HrError("no such leave request");
  if (request.status === "taken") throw new HrError("that leave has been taken");
  if (!input.reason.trim()) throw new HrError("cancelling leave must record why");

  run(
    `UPDATE leave_requests SET status = 'cancelled', decision_note = ? WHERE id = ?`,
    input.reason.trim(),
    request.id,
  );
  audit({
    action: "leave_cancelled",
    entity: "employee",
    entityId: request.employee_id,
    actorId: input.byUserId,
    actorName: input.byUserName,
    purpose: "administration",
    detail: { reason: input.reason, wasStatus: request.status },
  });
}

export function getLeaveRequest(id: string) {
  return get<{
    id: string;
    employee_id: string;
    leave_code: string;
    starts_on: string;
    ends_on: string;
    days: number;
    reason: string;
    status: LeaveStatus;
    cover_employee_id: string | null;
    cover_note: string;
    uncovered_ack: string;
    decider_name: string;
    decided_at: string | null;
    decision_note: string;
    requested_by: number | null;
    requester_name: string;
  }>(`SELECT * FROM leave_requests WHERE id = ?`, id);
}

export function leaveFor(employeeId: string, limit = 30) {
  return all<{
    id: string;
    leave_code: string;
    starts_on: string;
    ends_on: string;
    days: number;
    status: LeaveStatus;
    reason: string;
    uncovered_ack: string;
    decider_name: string;
  }>(`SELECT * FROM leave_requests WHERE employee_id = ? ORDER BY starts_on DESC LIMIT ?`, employeeId, limit);
}

export function leaveRegister(facilityId: number, from = today(), to?: string) {
  const until = to ?? new Date(Date.parse(`${from}T00:00:00.000Z`) + 60 * 86_400_000).toISOString().slice(0, 10);
  return all<{
    id: string;
    employee_id: string;
    name: string;
    job_title: string;
    leave_code: string;
    leave_name: string;
    starts_on: string;
    ends_on: string;
    days: number;
    status: LeaveStatus;
    uncovered_ack: string;
    requester_name: string;
  }>(
    `SELECT r.*, e.given_name || ' ' || e.family_name AS name, e.job_title, t.name AS leave_name
       FROM leave_requests r
       JOIN employees e ON e.id = r.employee_id
       JOIN leave_types t ON t.code = r.leave_code
      WHERE e.facility_id = ? AND r.status IN ('requested','approved','taken')
        AND r.ends_on >= ? AND r.starts_on <= ?
      ORDER BY r.status = 'requested' DESC, r.starts_on`,
    facilityId,
    from,
    until,
  );
}

// -------------------------------------------------------------- the expiries

export interface Expiry {
  employeeId: string;
  name: string;
  jobTitle: string;
  what: string;
  reference: string;
  expiresOn: string;
  daysLeft: number;
  /** Already lapsed — the access module is refusing licensed work today. */
  lapsed: boolean;
}

/**
 * Licences and contracts about to expire, or already gone.
 *
 * A lapsed licence is not a reminder: the access module has been refusing that
 * person's licensed actions since the day it expired. This list exists so that
 * never comes as a surprise.
 */
export function expiries(facilityId: number, withinDays = EXPIRY_HORIZON_DAYS, asOf = today()): Expiry[] {
  const horizon = new Date(Date.parse(`${asOf}T00:00:00.000Z`) + withinDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const daysTo = (date: string) =>
    Math.round((Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${asOf}T00:00:00.000Z`)) / 86_400_000);

  const licences = all<{
    employee_id: string;
    name: string;
    job_title: string;
    regulator: string;
    licence_number: string;
    expires_on: string;
  }>(
    `SELECT e.id AS employee_id, e.given_name || ' ' || e.family_name AS name, e.job_title,
            l.regulator, l.licence_number, l.expires_on
       FROM practitioner_licences l
       JOIN employees e ON e.user_id = l.user_id
      WHERE e.facility_id = ? AND e.active = 1 AND l.expires_on <= ?
        -- Only the latest licence per regulator: a renewed one is not expiring.
        AND l.expires_on = (SELECT MAX(l2.expires_on) FROM practitioner_licences l2
                             WHERE l2.user_id = l.user_id AND l2.regulator = l.regulator)`,
    facilityId,
    horizon,
  );

  const contracts = all<{
    employee_id: string;
    name: string;
    job_title: string;
    kind: string;
    ends_on: string;
  }>(
    `SELECT e.id AS employee_id, e.given_name || ' ' || e.family_name AS name, e.job_title,
            c.kind, c.ends_on
       FROM contracts c
       JOIN employees e ON e.id = c.employee_id
      WHERE e.facility_id = ? AND e.active = 1 AND c.superseded_by IS NULL
        AND c.ends_on IS NOT NULL AND c.ends_on <= ?`,
    facilityId,
    horizon,
  );

  return [
    ...licences.map((l) => ({
      employeeId: l.employee_id,
      name: l.name,
      jobTitle: l.job_title,
      what: `${l.regulator} registration`,
      reference: l.licence_number,
      expiresOn: l.expires_on,
      daysLeft: daysTo(l.expires_on),
      lapsed: l.expires_on < asOf,
    })),
    ...contracts.map((c) => ({
      employeeId: c.employee_id,
      name: c.name,
      jobTitle: c.job_title,
      what: `${c.kind.replace("_", " ")} contract`,
      reference: "",
      expiresOn: c.ends_on,
      daysLeft: daysTo(c.ends_on),
      lapsed: c.ends_on < asOf,
    })),
  ].sort((a, b) => a.daysLeft - b.daysLeft);
}

// --------------------------------------------------------------- HR cases

export function openCase(input: {
  employeeId: string;
  kind: CaseKind;
  summary: string;
  raisedOn?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const employee = getEmployee(input.employeeId);
  if (!employee) throw new HrError("no such employee");
  if (!input.summary.trim()) throw new HrError("a case must say what it is about");

  const id = mintLocalId(input.deviceCode, 8);
  run(
    `INSERT INTO hr_cases (id, employee_id, kind, summary, raised_on, opened_by, opener_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    employee.id,
    input.kind,
    input.summary.trim(),
    input.raisedOn ?? today(),
    input.byUserId,
    input.byUserName,
    now(),
  );
  audit({
    action: "hr_case_opened",
    entity: "employee",
    entityId: employee.id,
    facilityId: employee.facility_id,
    actorId: input.byUserId,
    actorName: input.byUserName,
    purpose: "administration",
    deviceCode: input.deviceCode,
    detail: { kind: input.kind, summary: input.summary },
  });
  return id;
}

export function recordHearing(input: {
  caseId: string;
  notifiedOn: string;
  heardOn: string;
  accompaniedBy?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const record = getCase(input.caseId);
  if (!record) throw new HrError("no such case");
  if (input.heardOn < input.notifiedOn) {
    // The Employment Act requires notice BEFORE the hearing. A hearing held
    // before the notice is not a hearing, however well minuted.
    throw new HrError("the employee cannot be heard before being notified — that is not due process");
  }
  run(
    `UPDATE hr_cases SET notified_on = ?, heard_on = ?, accompanied_by = ? WHERE id = ?`,
    input.notifiedOn,
    input.heardOn,
    input.accompaniedBy?.trim() ?? "",
    record.id,
  );
  audit({
    action: "hr_hearing_recorded",
    entity: "employee",
    entityId: record.employee_id,
    actorId: input.byUserId,
    actorName: input.byUserName,
    purpose: "administration",
    detail: { caseId: record.id, notifiedOn: input.notifiedOn, heardOn: input.heardOn, accompaniedBy: input.accompaniedBy ?? null },
  });
}

export function closeCase(input: {
  caseId: string;
  outcome: CaseOutcome;
  note: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const record = getCase(input.caseId);
  if (!record) throw new HrError("no such case");
  if (record.outcome) throw new HrError("that case is already closed");
  if (!input.note.trim()) throw new HrError("an outcome must record its reasons");

  // Dismissal without a recorded hearing is the single most expensive mistake
  // a Kenyan employer can make at the tribunal.
  if (input.outcome === "dismissed" && !record.heard_on) {
    throw new HrError(
      "there is no hearing on this case. A dismissal without one is unfair whatever the employee did — record the notice and the hearing first.",
    );
  }

  run(
    `UPDATE hr_cases SET outcome = ?, outcome_on = ?, outcome_note = ? WHERE id = ?`,
    input.outcome,
    today(),
    input.note.trim(),
    record.id,
  );
  audit({
    action: "hr_case_closed",
    entity: "employee",
    entityId: record.employee_id,
    actorId: input.byUserId,
    actorName: input.byUserName,
    purpose: "administration",
    detail: { caseId: record.id, kind: record.kind, outcome: input.outcome, heardOn: record.heard_on },
  });
}

export function getCase(id: string) {
  return get<{
    id: string;
    employee_id: string;
    kind: CaseKind;
    summary: string;
    raised_on: string;
    notified_on: string | null;
    heard_on: string | null;
    accompanied_by: string;
    outcome: CaseOutcome | null;
    outcome_on: string | null;
    outcome_note: string;
    opener_name: string;
  }>(`SELECT * FROM hr_cases WHERE id = ?`, id);
}

export function casesFor(employeeId: string) {
  return all<{
    id: string;
    kind: CaseKind;
    summary: string;
    raised_on: string;
    notified_on: string | null;
    heard_on: string | null;
    outcome: CaseOutcome | null;
    outcome_on: string | null;
    opener_name: string;
  }>(`SELECT * FROM hr_cases WHERE employee_id = ? ORDER BY raised_on DESC`, employeeId);
}

export function openCases(facilityId: number) {
  return all<{
    id: string;
    employee_id: string;
    name: string;
    kind: CaseKind;
    summary: string;
    raised_on: string;
    notified_on: string | null;
    heard_on: string | null;
  }>(
    `SELECT c.*, e.given_name || ' ' || e.family_name AS name
       FROM hr_cases c JOIN employees e ON e.id = c.employee_id
      WHERE e.facility_id = ? AND c.outcome IS NULL
      ORDER BY c.raised_on`,
    facilityId,
  );
}

// ------------------------------------------------------------------ summary

export interface HrSummary {
  staff: number;
  leavers: number;
  onLeaveToday: number;
  leaveWaiting: number;
  uncoveredLeave: number;
  lapsedLicences: number;
  expiringSoon: number;
  contractsEnding: number;
  noContract: number;
  openCases: number;
}

export function hrSummary(facilityId: number, asOf = today()): HrSummary {
  const staff = listEmployees(facilityId);
  const soon = expiries(facilityId, EXPIRY_HORIZON_DAYS, asOf);
  // The near window is what is happening now — who is away, what is waiting for
  // a decision. Leave approved with nobody covering matters whenever it falls,
  // so it is counted over the year rather than only the next two months.
  const register = leaveRegister(facilityId, asOf);
  const year = leaveRegister(
    facilityId,
    asOf,
    new Date(Date.parse(`${asOf}T00:00:00.000Z`) + 365 * 86_400_000).toISOString().slice(0, 10),
  );

  return {
    staff: staff.length,
    leavers: listEmployees(facilityId, true).filter((e) => !e.active).length,
    onLeaveToday: register.filter(
      (r) => r.status !== "requested" && r.starts_on <= asOf && r.ends_on >= asOf,
    ).length,
    leaveWaiting: register.filter((r) => r.status === "requested").length,
    uncoveredLeave: year.filter((r) => r.uncovered_ack.trim().length > 0).length,
    lapsedLicences: soon.filter((e) => e.lapsed && e.what.includes("registration")).length,
    expiringSoon: soon.filter((e) => !e.lapsed).length,
    contractsEnding: soon.filter((e) => e.what.includes("contract")).length,
    noContract: staff.filter((e) => !currentContract(e.id)).length,
    openCases: openCases(facilityId).length,
  };
}

/**
 * Kenyan statutory leave entitlements.
 *
 * ⚠️ The Employment Act 2007 minimums as understood at the time of writing. A
 * facility may be more generous and a collective agreement may say otherwise;
 * both belong here as data rather than in code. An HR adviser must confirm
 * them before the leave register is relied on.
 */
export function seedLeaveTypes(): void {
  const ACT = "Employment Act 2007 minimum — CONFIRM with an HR adviser, and check any collective agreement";

  defineLeaveType({
    code: "ANNUAL", name: "Annual leave", annualDays: 21, paid: true,
    carriesOver: true, maxCarryDays: 10,
    effectiveFrom: "2008-01-01", source: `${ACT}: 21 working days after 12 months' service`,
  });
  defineLeaveType({
    code: "SICK", name: "Sick leave", annualDays: 14, paid: true,
    effectiveFrom: "2008-01-01",
    source: `${ACT}: 7 days full pay and 7 half pay after two months' service — the half-pay half is NOT modelled`,
  });
  defineLeaveType({
    code: "MATERNITY", name: "Maternity leave", perEventDays: 90, paid: true,
    effectiveFrom: "2008-01-01", source: `${ACT}: three months' full pay`,
  });
  defineLeaveType({
    code: "PATERNITY", name: "Paternity leave", perEventDays: 14, paid: true,
    effectiveFrom: "2008-01-01", source: `${ACT}: two weeks' full pay`,
  });
  defineLeaveType({
    code: "COMPASSIONATE", name: "Compassionate leave", annualDays: 5, paid: true,
    effectiveFrom: "2008-01-01", source: "Facility policy — not a statutory entitlement",
  });
  defineLeaveType({
    code: "UNPAID", name: "Unpaid leave", annualDays: 30, paid: false,
    effectiveFrom: "2008-01-01", source: "Facility policy",
  });
}
