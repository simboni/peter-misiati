/**
 * M73 Patient Portal — over SMS and USSD, because that is the phone people have.
 *
 * Most patients at a Level 2 clinic in Nairobi carry a feature phone, and data
 * costs money they would rather spend on something else. A portal that needs a
 * smartphone and a browser serves the patients who need it least, so what is
 * built here is content short enough to be a text message, reached with a code
 * sent to the number the clinic already holds.
 *
 *  A RESULT REACHES A PATIENT AFTER A CLINICIAN HAS SEEN IT, NEVER BEFORE. A
 *  panic potassium arriving on somebody's phone at 9pm with nobody to ask is
 *  not transparency, it is harm. Results become visible when the ordering
 *  clinician has acknowledged them, which is a state this system already
 *  tracks and already chases.
 *
 *  SOME RESULTS ARE NEVER SENT, ONLY OFFERED. An HIV result, a pregnancy test,
 *  a tuberculosis result and anything flagged panic are withheld from the
 *  message with a line saying the clinic will discuss it. The patient is told
 *  something exists — hiding that would be its own harm — but the finding
 *  itself waits for a person.
 *
 *  A TEENAGER'S RECORD IS NOT THEIR PARENT'S. Proxy access stops at the age
 *  Kenya sets, and for an adolescent the sensitive categories are withheld from
 *  a proxy even inside that age. A girl who cannot get tested without her
 *  mother reading the result does not get tested.
 *
 *  A CODE IS NEVER STORED IN THE CLEAR and expires in minutes. A table of live
 *  codes is a table that opens every record in the clinic if it is ever copied.
 *
 *  A PATIENT SEES; A PATIENT DOES NOT EDIT. Nothing here writes clinical
 *  content. The one thing a patient can change is whether they want the portal
 *  at all.
 *
 * ⚠️ No SMS is actually sent and no USSD session is served. Messages go through
 * the integration hub's SMS endpoint, which is in demo mode until a facility
 * contracts a licensed Kenyan aggregator, and the mode is visible on every
 * screen. What is real here is the content, the access rules and the
 * withholding.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { createHash, randomInt } from "node:crypto";
import { all, get, run, tx, audit, now, today } from "./db.ts";
import { resolvePatient, normalisePhone } from "./patients.ts";
import { patientResults, formatValue } from "./laboratory.ts";
import { call } from "./integration.ts";
import { outstandingInvoices } from "./billing.ts";
import { formatKes } from "./billing.ts";

export class PortalError extends Error {}

export type Channel = "sms" | "ussd" | "web";
export type Language = "en" | "sw";
export type AccountStatus = "active" | "suspended" | "revoked";

/** How long a one-time code lives. Long enough to read a text, not long enough to forget. */
export const CODE_MINUTES = 10;

/** Wrong codes before the code is dead. */
export const MAX_ATTEMPTS = 3;

/**
 * ⚠️ The age at which a person's record stops being their parent's.
 *
 * 18 is majority in Kenya. Adolescent confidentiality for sensitive services
 * starts well below it and is a matter of national guidance a facility must
 * confirm — which is why the sensitive categories below are withheld from a
 * proxy at any age.
 */
export const MAJORITY_YEARS = 18;

/**
 * ⚠️ Findings that are never put in a message.
 *
 * Matched on the analyte. The list is this system's own and a clinician must
 * confirm it: what belongs here is a judgement about harm, not a rule anybody
 * has written down.
 */
export const WITHHELD_ANALYTES = ["HIV", "HIV1", "HIV2", "VL", "CD4", "TB", "GENEXPERT", "HCG", "PREGNANCY"];

export interface PortalAccount {
  patient_mrn: string;
  phone: string;
  channel: Channel;
  status: AccountStatus;
  language: Language;
  enrolled_at: string;
  enroller_name: string;
  revoked_at: string | null;
  revoked_reason: string;
  last_seen_at: string | null;
}

// ---------------------------------------------------------------- accounts

export function enrol(input: {
  patientMrn: string;
  phone?: string;
  channel?: Channel;
  language?: Language;
  byUserId: number | null;
  byUserName: string;
}): void {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new PortalError("no such patient");

  const phone = normalisePhone(input.phone ?? patient.phone);
  if (!phone) {
    throw new PortalError(
      "this patient has no phone number on file, and a portal reached by a code sent to a phone needs one",
    );
  }

  const at = now();
  tx(() => {
    run(
      `INSERT INTO portal_accounts
         (patient_mrn, phone, channel, status, language, enrolled_at, enrolled_by, enroller_name, created_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
       ON CONFLICT(patient_mrn) DO UPDATE SET
         phone = excluded.phone, channel = excluded.channel, language = excluded.language,
         status = 'active', revoked_at = NULL, revoked_reason = ''`,
      patient.mrn,
      phone,
      input.channel ?? "sms",
      input.language ?? "en",
      at,
      input.byUserId,
      input.byUserName,
      at,
    );
    audit({
      action: "portal_enrolled",
      entity: "patient",
      entityId: patient.mrn,
      patientId: patient.mrn,
      facilityId: patient.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { channel: input.channel ?? "sms", language: input.language ?? "en" },
    });
  });
}

export function accountFor(patientMrn: string): PortalAccount | undefined {
  return get<PortalAccount>(`SELECT * FROM portal_accounts WHERE patient_mrn = ?`, patientMrn);
}

/**
 * Turn it off.
 *
 * The one thing a patient can change about their own record here, and it takes
 * effect immediately — a revoked account cannot be sent a code.
 */
export function revoke(input: {
  patientMrn: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const account = accountFor(input.patientMrn);
  if (!account) throw new PortalError("that patient is not enrolled");
  if (!input.reason.trim()) throw new PortalError("revoking portal access records why");

  tx(() => {
    run(
      `UPDATE portal_accounts SET status = 'revoked', revoked_at = ?, revoked_reason = ? WHERE patient_mrn = ?`,
      now(),
      input.reason.trim(),
      account.patient_mrn,
    );
    // Any code already in flight dies with the account.
    run(`UPDATE portal_codes SET used_at = ? WHERE patient_mrn = ? AND used_at IS NULL`, now(), account.patient_mrn);
    audit({
      action: "portal_revoked",
      entity: "patient",
      entityId: account.patient_mrn,
      patientId: account.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { reason: input.reason },
    });
  });
}

// ------------------------------------------------------------------- codes

function hashCode(patientMrn: string, code: string): string {
  return createHash("sha256").update(`${patientMrn}:${code}`).digest("hex");
}

/**
 * Send a one-time code to the number on the record.
 *
 * To the number the clinic already holds, never to one typed at the moment of
 * asking — a portal that texts a code to whatever number is offered is a portal
 * that hands records to whoever asks.
 */
export function sendCode(input: {
  patientMrn: string;
  byUserId?: number | null;
  byUserName?: string;
}): { sentTo: string; expiresAt: string; simulated: boolean; code?: string } {
  const account = accountFor(input.patientMrn);
  if (!account) throw new PortalError("that patient is not enrolled in the portal");
  if (account.status !== "active") throw new PortalError(`that portal account is ${account.status}`);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const issuedAt = now();
  const expiresAt = new Date(Date.parse(issuedAt) + CODE_MINUTES * 60_000).toISOString();

  return tx(() => {
    // Only one code lives at a time. A patient who asks twice uses the second.
    run(`UPDATE portal_codes SET used_at = ? WHERE patient_mrn = ? AND used_at IS NULL`, issuedAt, account.patient_mrn);
    run(
      `INSERT INTO portal_codes (patient_mrn, code_hash, sent_to, issued_at, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      account.patient_mrn,
      hashCode(account.patient_mrn, code),
      account.phone,
      issuedAt,
      expiresAt,
      now(),
    );

    const sent = call({
      endpoint: "SMS",
      operation: "send",
      request: {
        to: account.phone,
        body:
          account.language === "sw"
            ? `Msimbo wako wa Afya Core ni ${code}. Unaisha baada ya dakika ${CODE_MINUTES}. Usimpe mtu mwingine.`
            : `Your Afya Core code is ${code}. It expires in ${CODE_MINUTES} minutes. Do not share it.`,
      },
    });

    audit({
      action: "portal_code_sent",
      entity: "patient",
      entityId: account.patient_mrn,
      patientId: account.patient_mrn,
      actorId: input.byUserId ?? null,
      actorName: input.byUserName ?? "portal",
      purpose: "patient_access",
      // The code is deliberately not here. The audit log is the artefact most
      // likely to be exported.
      detail: { sentTo: account.phone, simulated: Boolean(sent.simulated) },
    });

    return {
      sentTo: account.phone,
      expiresAt,
      simulated: Boolean(sent.simulated),
      // Returned ONLY while the gateway is simulated, so a demonstration can be
      // given without a phone. A live gateway never hands the code back.
      code: sent.simulated ? code : undefined,
    };
  });
}

export function checkCode(input: { patientMrn: string; code: string }): { ok: boolean; why?: string } {
  const row = get<{ id: number; code_hash: string; expires_at: string; attempts: number; used_at: string | null }>(
    `SELECT * FROM portal_codes WHERE patient_mrn = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1`,
    input.patientMrn,
  );
  if (!row) return { ok: false, why: "no code has been sent, or it has already been used" };
  if (row.expires_at < now()) return { ok: false, why: "that code has expired — ask for another" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, why: "too many wrong tries — ask for another code" };

  if (row.code_hash !== hashCode(input.patientMrn, input.code.trim())) {
    run(`UPDATE portal_codes SET attempts = attempts + 1 WHERE id = ?`, row.id);
    const left = MAX_ATTEMPTS - (row.attempts + 1);
    return { ok: false, why: left > 0 ? `that code is wrong — ${left} tries left` : "too many wrong tries — ask for another code" };
  }

  run(`UPDATE portal_codes SET used_at = ? WHERE id = ?`, now(), row.id);
  run(`UPDATE portal_accounts SET last_seen_at = ? WHERE patient_mrn = ?`, now(), input.patientMrn);
  return { ok: true };
}

// ----------------------------------------------------------------- proxies

export interface Proxy {
  id: number;
  patient_mrn: string;
  proxy_name: string;
  proxy_phone: string;
  proxy_id_no: string;
  relationship: string;
  granted_until: string;
  granted_at: string;
  granter_name: string;
  revoked_at: string | null;
  revoked_reason: string;
}

function ageYears(dateOfBirth: string | null, asOf = today()): number | null {
  if (!dateOfBirth) return null;
  return Math.floor(
    (Date.parse(`${asOf}T00:00:00.000Z`) - Date.parse(`${dateOfBirth}T00:00:00.000Z`)) / (365.25 * 86_400_000),
  );
}

/**
 * Let somebody else read this record.
 *
 * Time-limited, never open-ended, and refused outright for an adult who has not
 * asked for it. A mother reading her three-year-old's results is ordinary; the
 * same arrangement for a nineteen-year-old is a different thing and needs that
 * person's own say-so, which this system records as a consent rather than
 * inferring from a family relationship.
 */
export function grantProxy(input: {
  patientMrn: string;
  proxyName: string;
  proxyPhone: string;
  proxyIdNo?: string;
  relationship: string;
  untilDate: string;
  /** Required when the patient is old enough to speak for themselves. */
  patientConsented?: boolean;
  byUserId: number | null;
  byUserName: string;
}): number {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new PortalError("no such patient");
  if (!input.proxyName.trim()) throw new PortalError("a proxy has a name");
  if (!input.relationship.trim()) throw new PortalError("a proxy records how they are related");

  const phone = normalisePhone(input.proxyPhone);
  if (!phone) throw new PortalError("a proxy needs a phone number the code can be sent to");
  if (input.untilDate <= today()) throw new PortalError("a proxy grant that has already expired is not a grant");

  const age = ageYears(patient.date_of_birth);
  if (age !== null && age >= MAJORITY_YEARS && !input.patientConsented) {
    throw new PortalError(
      `${patient.given_name} is ${age} and speaks for themselves — record that they agreed to this before granting it`,
    );
  }

  return tx(() => {
    run(
      `INSERT INTO portal_proxies
         (patient_mrn, proxy_name, proxy_phone, proxy_id_no, relationship, granted_until,
          granted_at, granted_by, granter_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      patient.mrn,
      input.proxyName.trim(),
      phone,
      input.proxyIdNo?.trim() ?? "",
      input.relationship.trim(),
      input.untilDate,
      now(),
      input.byUserId,
      input.byUserName,
      now(),
    );
    const row = get<{ id: number }>(`SELECT last_insert_rowid() AS id`)!;
    audit({
      action: "portal_proxy_granted",
      entity: "patient",
      entityId: patient.mrn,
      patientId: patient.mrn,
      facilityId: patient.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: {
        proxy: input.proxyName,
        relationship: input.relationship,
        until: input.untilDate,
        patientAge: age,
        patientConsented: Boolean(input.patientConsented),
      },
    });
    return row.id;
  });
}

export function proxiesFor(patientMrn: string, includeExpired = false): Proxy[] {
  const rows = all<Proxy>(
    `SELECT * FROM portal_proxies WHERE patient_mrn = ? AND revoked_at IS NULL ORDER BY granted_until DESC`,
    patientMrn,
  );
  return includeExpired ? rows : rows.filter((p) => p.granted_until >= today());
}

export function revokeProxy(input: {
  proxyId: number;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const proxy = get<Proxy>(`SELECT * FROM portal_proxies WHERE id = ?`, input.proxyId);
  if (!proxy) throw new PortalError("no such proxy");
  if (proxy.revoked_at) throw new PortalError("that proxy has already been revoked");
  if (!input.reason.trim()) throw new PortalError("revoking a proxy records why");

  run(
    `UPDATE portal_proxies SET revoked_at = ?, revoked_reason = ? WHERE id = ?`,
    now(),
    input.reason.trim(),
    proxy.id,
  );
  audit({
    action: "portal_proxy_revoked",
    entity: "patient",
    entityId: proxy.patient_mrn,
    patientId: proxy.patient_mrn,
    actorId: input.byUserId,
    actorName: input.byUserName,
    purpose: "administration",
    detail: { proxy: proxy.proxy_name, reason: input.reason },
  });
}

// ---------------------------------------------------------------- the view

export interface VisibleResult {
  analyte: string;
  serviceName: string;
  value: string;
  flag: string;
  releasedAt: string;
}

export interface Withheld {
  serviceName: string;
  why: string;
}

export interface PatientView {
  patientMrn: string;
  name: string;
  results: VisibleResult[];
  withheld: Withheld[];
  appointments: { id: string; date: string; time: string; reason: string }[];
  owedCents: number;
  invoices: number;
  byProxy: boolean;
}

/** Whether this finding goes in a message at all. */
function withholdReason(
  analyte: string,
  flag: string,
  byProxy: boolean,
  patientAge: number | null,
): string | null {
  if (WITHHELD_ANALYTES.some((a) => analyte.toUpperCase().startsWith(a))) {
    // Withheld from everybody, and from a proxy for good: a girl who cannot be
    // tested without her mother reading the result does not get tested.
    return byProxy
      ? "this one is only discussed with the patient"
      : "the clinic will go through this one with you";
  }
  if (flag === "panic_low" || flag === "panic_high") {
    // A panic value arriving on a phone at 9pm with nobody to ask is not
    // transparency. The clinician has already been telephoned about it.
    return "the clinic is contacting you about this one";
  }
  if (byProxy && patientAge !== null && patientAge >= 12) {
    // Not majority: adolescence. A twelve-year-old's results are not
    // automatically their parent's to read.
    return "only shown to the patient themselves";
  }
  return null;
}

/**
 * What this patient may see right now.
 *
 * A result appears here once the ordering clinician has acknowledged it, and
 * not before. Everything withheld is still listed — the patient is told
 * something exists, because hiding that would be its own harm — with a line
 * saying who will go through it with them.
 */
export function viewFor(input: {
  patientMrn: string;
  byProxy?: { name: string; relationship: string };
  record?: boolean;
}): PatientView {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new PortalError("no such patient");

  const byProxy = Boolean(input.byProxy);
  const age = ageYears(patient.date_of_birth);

  const acknowledged = all<{
    analyte: string;
    service_name: string;
    value_milli: number | null;
    value_text: string;
    unit: string;
    flag: string;
    released_at: string;
  }>(
    `SELECT r.analyte, o.service_name, r.value_milli, r.value_text, r.unit, r.flag, r.released_at
       FROM lab_results r JOIN orders o ON o.id = r.order_id
      WHERE r.patient_mrn = ? AND r.released_at IS NOT NULL AND r.superseded_at IS NULL
        AND o.acknowledged_at IS NOT NULL
      ORDER BY r.released_at DESC LIMIT 20`,
    patient.mrn,
  );

  const results: VisibleResult[] = [];
  const withheld: Withheld[] = [];

  for (const row of acknowledged) {
    const why = withholdReason(row.analyte, row.flag, byProxy, age);
    if (why) {
      withheld.push({ serviceName: row.service_name, why });
      continue;
    }
    results.push({
      analyte: row.analyte,
      serviceName: row.service_name,
      value: row.value_milli === null ? row.value_text : formatValue(row.value_milli, row.unit),
      flag: row.flag,
      releasedAt: row.released_at,
    });
  }

  const appointments = all<{ id: string; slot_date: string; start_time: string; reason: string }>(
    `SELECT a.id, s.slot_date, s.start_time, a.reason
       FROM appointments a JOIN slots s ON s.id = a.slot_id
      WHERE a.patient_mrn = ? AND a.status = 'booked' AND s.slot_date >= ?
      ORDER BY s.slot_date, s.start_time`,
    patient.mrn,
    today(),
  ).map((row) => ({ id: row.id, date: row.slot_date, time: row.start_time, reason: row.reason }));

  // Only what this patient owes themselves. A balance the payer settles is not
  // a bill to put in somebody's pocket.
  const owed = outstandingInvoices(patient.facility_id).filter(
    (o) => o.invoice.patient_mrn === patient.mrn && !o.payerOwes,
  );

  if (input.record !== false) {
    run(
      `INSERT INTO portal_views (patient_mrn, section, by_proxy, proxy_name, items, withheld, viewed_at, created_at)
       VALUES (?, 'record', ?, ?, ?, ?, ?, ?)`,
      patient.mrn,
      byProxy ? 1 : 0,
      input.byProxy?.name ?? "",
      results.length + appointments.length,
      withheld.length,
      now(),
      now(),
    );
    audit({
      action: "portal_viewed",
      entity: "patient",
      entityId: patient.mrn,
      patientId: patient.mrn,
      facilityId: patient.facility_id,
      actorName: input.byProxy ? `${input.byProxy.name} (${input.byProxy.relationship})` : "the patient",
      // Reads of a patient record are logged with a purpose, and a patient
      // reading their own is a purpose of its own rather than "treatment".
      purpose: "patient_access",
      detail: { byProxy, results: results.length, withheld: withheld.length },
    });
  }

  return {
    patientMrn: patient.mrn,
    name: `${patient.given_name} ${patient.family_name}`,
    results,
    withheld,
    appointments,
    owedCents: owed.reduce((sum, o) => sum + o.balanceCents, 0),
    invoices: owed.length,
    byProxy,
  };
}

/** What this patient's record says was looked at, and by whom. Their right to ask. */
export function viewHistory(patientMrn: string, limit = 20) {
  return all<{
    id: number;
    section: string;
    by_proxy: number;
    proxy_name: string;
    items: number;
    withheld: number;
    viewed_at: string;
  }>(`SELECT * FROM portal_views WHERE patient_mrn = ? ORDER BY viewed_at DESC LIMIT ?`, patientMrn, limit);
}

// ---------------------------------------------------------------- messages

/**
 * The record as a text message.
 *
 * ⚠️ Kept inside 320 characters — two SMS segments. A message that runs to
 * five segments costs five times as much and gets read as often as one.
 */
export function asMessage(view: PatientView, language: Language = "en"): string {
  const lines: string[] = [];

  if (language === "sw") {
    lines.push(`Habari ${view.name.split(" ")[0]}.`);
    if (view.results.length > 0) {
      lines.push(`Majibu: ${view.results.slice(0, 2).map((r) => `${r.analyte} ${r.value}`).join("; ")}.`);
    }
    if (view.withheld.length > 0) lines.push(`Majibu ${view.withheld.length} yatajadiliwa kliniki.`);
    if (view.appointments.length > 0) {
      lines.push(`Miadi: ${view.appointments[0].date} saa ${view.appointments[0].time}.`);
    }
    if (view.owedCents > 0) lines.push(`Deni: ${formatKes(view.owedCents)}.`);
  } else {
    lines.push(`Hello ${view.name.split(" ")[0]}.`);
    if (view.results.length > 0) {
      lines.push(`Results: ${view.results.slice(0, 2).map((r) => `${r.analyte} ${r.value}`).join("; ")}.`);
    }
    if (view.withheld.length > 0) {
      lines.push(
        `${view.withheld.length} result${view.withheld.length === 1 ? "" : "s"} the clinic will go through with you.`,
      );
    }
    if (view.appointments.length > 0) {
      lines.push(`Next visit: ${view.appointments[0].date} at ${view.appointments[0].time}.`);
    }
    if (view.owedCents > 0) lines.push(`Balance: ${formatKes(view.owedCents)}.`);
  }

  if (lines.length === 1) lines.push(language === "sw" ? "Hakuna jipya." : "Nothing new on your record.");

  const message = lines.join(" ");
  return message.length <= 320 ? message : `${message.slice(0, 317)}...`;
}

/** Send that message. Through the hub, like everything else that leaves the building. */
export function sendSummary(input: {
  patientMrn: string;
  byUserId: number | null;
  byUserName: string;
}): { sent: boolean; simulated: boolean; body: string } {
  const account = accountFor(input.patientMrn);
  if (!account) throw new PortalError("that patient is not enrolled in the portal");
  if (account.status !== "active") throw new PortalError(`that portal account is ${account.status}`);

  const view = viewFor({ patientMrn: input.patientMrn, record: false });
  const body = asMessage(view, account.language);

  const sent = call({ endpoint: "SMS", operation: "send", request: { to: account.phone, body } });

  audit({
    action: "portal_summary_sent",
    entity: "patient",
    entityId: account.patient_mrn,
    patientId: account.patient_mrn,
    actorId: input.byUserId,
    actorName: input.byUserName,
    purpose: "patient_access",
    // The body is not logged: it carries clinical content, and the audit log
    // is read by people who have no business seeing it.
    detail: { simulated: Boolean(sent.simulated), characters: body.length, withheld: view.withheld.length },
  });

  return { sent: sent.ok, simulated: Boolean(sent.simulated), body };
}

// ----------------------------------------------------------------- reports

export interface PortalSummary {
  enrolled: number;
  revoked: number;
  usedThisMonth: number;
  proxies: number;
  /** Enrolled patients with no phone number that still works. */
  unreachable: number;
  viewsThisMonth: number;
  withheldThisMonth: number;
  gatewayLive: boolean;
}

export function portalSummary(facilityId: number, asOf = today()): PortalSummary {
  const month = asOf.slice(0, 7);
  const accounts = all<PortalAccount>(
    `SELECT a.* FROM portal_accounts a JOIN patients p ON p.mrn = a.patient_mrn WHERE p.facility_id = ?`,
    facilityId,
  );
  const views = all<{ withheld: number; viewed_at: string }>(
    `SELECT v.withheld, v.viewed_at FROM portal_views v JOIN patients p ON p.mrn = v.patient_mrn
      WHERE p.facility_id = ? AND v.viewed_at >= ?`,
    facilityId,
    `${month}-01`,
  );

  const gateway = get<{ mode: string }>(`SELECT mode FROM integration_endpoints WHERE code = 'SMS'`);

  return {
    enrolled: accounts.filter((a) => a.status === "active").length,
    revoked: accounts.filter((a) => a.status === "revoked").length,
    usedThisMonth: accounts.filter((a) => (a.last_seen_at ?? "").slice(0, 7) === month).length,
    proxies:
      get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM portal_proxies x JOIN patients p ON p.mrn = x.patient_mrn
          WHERE p.facility_id = ? AND x.revoked_at IS NULL AND x.granted_until >= ?`,
        facilityId,
        asOf,
      )?.n ?? 0,
    unreachable: accounts.filter((a) => a.status === "active" && !a.phone).length,
    viewsThisMonth: views.length,
    withheldThisMonth: views.reduce((sum, v) => sum + v.withheld, 0),
    gatewayLive: gateway?.mode === "live",
  };
}
