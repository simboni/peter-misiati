/**
 * M05 Notifications — the 7-day claim clock, and everything else that expires.
 *
 * A notification here is a task with an owner, not a broadcast. "Someone should
 * look at this" is how nothing gets looked at, so every notification names the
 * role that can act on it and lands on that desk.
 *
 * `dedupe_key` is what stops a running job producing the same warning forty
 * times. A repeating condition updates one notification; it does not breed.
 *
 * The escalation schedule for claims is the one in the product spec, and it
 * exists because a claim submitted beyond SHA's seven-day window is rejected
 * automatically and nothing recovers it:
 *
 *   day 3   reminder to the claims officer
 *   day 5   reminder plus the facility administrator
 *   day 6   critical, on the administrator's red list
 *   day 7+  overdue — escalation path only
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";

export type Severity = "info" | "warning" | "critical";

export interface Notification {
  id: number;
  facility_id: number;
  owner_role: string;
  severity: Severity;
  kind: string;
  subject: string;
  body: string;
  entity: string | null;
  entity_id: string | null;
  dedupe_key: string | null;
  created_at: string;
  updated_at: string;
  acted_at: string | null;
  dismissed_at: string | null;
}

/**
 * Raise or update a notification.
 *
 * Idempotent on `dedupeKey`: the same condition reported twice updates the
 * existing row, including its severity, so an escalating problem escalates in
 * place instead of filling the list with its own history.
 */
export function notify(input: {
  facilityId: number;
  ownerRole: string;
  severity: Severity;
  kind: string;
  subject: string;
  body?: string;
  entity?: string;
  entityId?: string;
  dedupeKey?: string;
}): number {
  const at = now();

  if (input.dedupeKey) {
    const existing = get<Notification>(
      `SELECT * FROM notifications WHERE dedupe_key = ?`,
      input.dedupeKey,
    );
    if (existing) {
      const worse = rank(input.severity) > rank(existing.severity);

      // An already-handled notification is not resurrected by the same
      // condition being seen again — only by one that has got worse. Otherwise
      // a nightly sweep would reopen everything a person dealt with yesterday.
      if (existing.acted_at && !worse) return existing.id;

      run(
        `UPDATE notifications SET severity = ?, subject = ?, body = ?, updated_at = ?, acted_at = ? WHERE id = ?`,
        input.severity,
        input.subject,
        input.body ?? "",
        at,
        // Reopen only on escalation.
        worse ? null : existing.acted_at,
        existing.id,
      );
      return existing.id;
    }
  }

  const { lastInsertRowid } = run(
    `INSERT INTO notifications
       (facility_id, owner_role, severity, kind, subject, body, entity, entity_id, dedupe_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.facilityId,
    input.ownerRole,
    input.severity,
    input.kind,
    input.subject,
    input.body ?? "",
    input.entity ?? null,
    input.entityId ?? null,
    input.dedupeKey ?? null,
    at,
    at,
  );
  return lastInsertRowid;
}

function rank(s: Severity): number {
  return s === "critical" ? 3 : s === "warning" ? 2 : 1;
}

/** Open notifications, worst first, then oldest. */
export function inbox(facilityId: number, ownerRole?: string): Notification[] {
  const rows = ownerRole
    ? all<Notification>(
        `SELECT * FROM notifications WHERE facility_id = ? AND acted_at IS NULL AND dismissed_at IS NULL AND owner_role = ?`,
        facilityId,
        ownerRole,
      )
    : all<Notification>(
        `SELECT * FROM notifications WHERE facility_id = ? AND acted_at IS NULL AND dismissed_at IS NULL`,
        facilityId,
      );
  return rows.sort((a, b) => rank(b.severity) - rank(a.severity) || a.created_at.localeCompare(b.created_at));
}

export function countOpen(facilityId: number): { total: number; critical: number } {
  const open = inbox(facilityId);
  return { total: open.length, critical: open.filter((n) => n.severity === "critical").length };
}

export function markActed(input: { id: number; byUserId: number | null; byUserName: string }): void {
  const n = get<Notification>(`SELECT * FROM notifications WHERE id = ?`, input.id);
  if (!n) return;
  tx(() => {
    run(`UPDATE notifications SET acted_at = ?, acted_by = ? WHERE id = ?`, now(), input.byUserId, input.id);
    audit({
      action: "notification_actioned",
      entity: n.entity ?? "notification",
      entityId: n.entity_id ?? String(n.id),
      facilityId: n.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { kind: n.kind, subject: n.subject },
    });
  });
}

export function dismiss(id: number): void {
  run(`UPDATE notifications SET dismissed_at = ? WHERE id = ?`, now(), id);
}

// --------------------------------------------------------------- the sweeper

export interface SweepResult {
  raised: number;
  claimsClosingSoon: number;
  claimsOverdue: number;
  licencesExpiring: number;
  etimsBacklog: number;
  deadLetters: number;
}

/**
 * Look at everything that expires and raise what needs a person.
 *
 * Run on a schedule, and on demand from the dashboard. Deliberately one
 * function: a facility with a dozen separate cron jobs has a dozen ways to
 * silently stop running.
 */
export function sweep(facilityId: number, asOf = today()): SweepResult {
  const result: SweepResult = {
    raised: 0,
    claimsClosingSoon: 0,
    claimsOverdue: 0,
    licencesExpiring: 0,
    etimsBacklog: 0,
    deadLetters: 0,
  };

  // ---- claims against their submission window
  const claims = all<{ id: string; payer_code: string; service_date: string; total_cents: number; status: string }>(
    `SELECT c.id, c.payer_code, c.service_date, c.total_cents, c.status
       FROM claims c WHERE c.status IN ('draft','ready')`,
  );

  for (const claim of claims) {
    const window =
      get<{ claim_window_days: number }>(`SELECT claim_window_days FROM payers WHERE code = ?`, claim.payer_code)
        ?.claim_window_days ?? 7;
    const age = Math.round(
      (Date.parse(`${asOf}T00:00:00.000Z`) - Date.parse(`${claim.service_date}T00:00:00.000Z`)) / 86_400_000,
    );
    const daysLeft = window - age;

    if (daysLeft < 0) {
      result.claimsOverdue++;
      notify({
        facilityId,
        ownerRole: "administrator",
        severity: "critical",
        kind: "claim_overdue",
        subject: `Claim ${claim.id} is ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? "" : "s"} past the submission window`,
        body: "Late claims are rejected automatically. This one now needs the escalation path.",
        entity: "claim",
        entityId: claim.id,
        dedupeKey: `claim_window:${claim.id}`,
      });
      result.raised++;
    } else if (age >= 6) {
      result.claimsClosingSoon++;
      notify({
        facilityId,
        ownerRole: "administrator",
        severity: "critical",
        kind: "claim_closing",
        subject: `Claim ${claim.id} must be submitted today`,
        body: `${daysLeft} day left of the ${window}-day window.`,
        entity: "claim",
        entityId: claim.id,
        dedupeKey: `claim_window:${claim.id}`,
      });
      result.raised++;
    } else if (age >= 5) {
      result.claimsClosingSoon++;
      notify({
        facilityId,
        ownerRole: "claims_officer",
        severity: "warning",
        kind: "claim_closing",
        subject: `Claim ${claim.id} has ${daysLeft} days left`,
        body: "Day five — the facility administrator has also been notified.",
        entity: "claim",
        entityId: claim.id,
        dedupeKey: `claim_window:${claim.id}`,
      });
      result.raised++;
    } else if (age >= 3) {
      result.claimsClosingSoon++;
      notify({
        facilityId,
        ownerRole: "claims_officer",
        severity: "info",
        kind: "claim_closing",
        subject: `Claim ${claim.id} has ${daysLeft} days left to submit`,
        entity: "claim",
        entityId: claim.id,
        dedupeKey: `claim_window:${claim.id}`,
      });
      result.raised++;
    }
  }

  // ---- practitioner licences
  const licences = all<{ user_id: number; name: string; regulator: string; licence_number: string; expires_on: string }>(
    `SELECT l.user_id, u.name, l.regulator, l.licence_number, l.expires_on
       FROM practitioner_licences l JOIN users u ON u.id = l.user_id
      WHERE u.facility_id = ? AND u.active = 1`,
    facilityId,
  );
  const latest = new Map<number, (typeof licences)[number]>();
  for (const l of licences) {
    const held = latest.get(l.user_id);
    if (!held || l.expires_on > held.expires_on) latest.set(l.user_id, l);
  }
  for (const l of latest.values()) {
    const daysLeft = Math.round(
      (Date.parse(`${l.expires_on}T00:00:00.000Z`) - Date.parse(`${asOf}T00:00:00.000Z`)) / 86_400_000,
    );
    if (daysLeft > 60) continue;
    result.licencesExpiring++;
    notify({
      facilityId,
      ownerRole: "administrator",
      severity: daysLeft < 0 ? "critical" : daysLeft <= 14 ? "warning" : "info",
      kind: "licence_expiry",
      subject:
        daysLeft < 0
          ? `${l.name}'s ${l.regulator} licence expired ${Math.abs(daysLeft)} days ago`
          : `${l.name}'s ${l.regulator} licence expires in ${daysLeft} days`,
      body:
        daysLeft < 0
          ? "Prescribing, diagnosis and discharge are switched off for this person, and claims citing the licence are rejected."
          : "Renew before it lapses — a lapsed licence switches off prescribing and invalidates claims.",
      entity: "user",
      entityId: String(l.user_id),
      dedupeKey: `licence:${l.user_id}`,
    });
    result.raised++;
  }

  // ---- untransmitted tax invoices
  const etims = get<{ n: number }>(`SELECT COUNT(*) AS n FROM etims_queue WHERE status = 'queued'`);
  if ((etims?.n ?? 0) > 0) {
    result.etimsBacklog = etims!.n;
    notify({
      facilityId,
      ownerRole: "administrator",
      severity: etims!.n > 10 ? "critical" : "warning",
      kind: "etims_backlog",
      subject: `${etims!.n} invoice${etims!.n === 1 ? "" : "s"} not transmitted to KRA`,
      body: "Every encounter must end in a KRA-compliant invoice. An untransmitted one is a tax compliance failure.",
      entity: "integration",
      entityId: "ETIMS",
      dedupeKey: "etims_backlog",
    });
    result.raised++;
  }

  // ---- integration dead letters
  const dl = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM integration_dead_letters WHERE resolved_at IS NULL`,
  );
  if ((dl?.n ?? 0) > 0) {
    result.deadLetters = dl!.n;
    notify({
      facilityId,
      ownerRole: "administrator",
      severity: "warning",
      kind: "dead_letters",
      subject: `${dl!.n} outbound request${dl!.n === 1 ? "" : "s"} failed every retry`,
      body: "These are waiting for a person. Nothing has been dropped.",
      entity: "integration",
      entityId: "*",
      dedupeKey: "dead_letters",
    });
    result.raised++;
  }

  return result;
}
