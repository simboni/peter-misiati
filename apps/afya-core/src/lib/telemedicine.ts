/**
 * M74 Telemedicine — a remote consultation is a consultation.
 *
 * The temptation with telemedicine is to build it as its own thing, with its
 * own record and its own workflow. That is how one patient ends up with two
 * histories and a clinician reads the wrong one. So a session here hangs off an
 * ordinary encounter, is written in the same notes, needs the same coded
 * diagnosis and goes on the same claim. What this module adds is only the part
 * that is genuinely different.
 *
 *  THE LICENCE GATES IT EXACTLY AS IN PERSON. A consultation conducted over a
 *  telephone by somebody whose registration lapsed is the same problem as one
 *  conducted in a room, and the encounter it hangs off already refuses it.
 *
 *  IDENTITY IS ESTABLISHED AND RECORDED, AND IT CANNOT BE A FINGERPRINT. The
 *  patient is not in the building. What is left is a code to the number on file
 *  or a document held up to a camera, and which one was used is written down —
 *  because "I recognised her voice" is an answer, and it should be a visible
 *  one rather than an assumed one.
 *
 *  CONSENT TO BEING SEEN THIS WAY IS ITS OWN CONSENT, per session. A patient
 *  who agreed to a video call in March has not agreed to one in September, and
 *  who else is in the room at either end is part of what they are agreeing to.
 *
 *  SOME THINGS ARE NOT SEEN DOWN A TELEPHONE. Chest pain, bleeding in
 *  pregnancy, a baby under two months with a fever, a headache that came on
 *  like a thunderclap. `redFlags` names them from the reason for the visit,
 *  and closing a session on one without saying what was done about it is
 *  refused. It does not refuse the consultation — a patient two hours from the
 *  clinic being talked to is better than one who is not — it refuses to let it
 *  be closed quietly.
 *
 *  NO CONTROLLED DRUG ON A REMOTE CONSULTATION. Not a judgement call and not
 *  overridable here: the patient has not been examined and cannot be seen.
 *
 *  A CALL THAT BROKE IS NOT A CONSULTATION THAT HAPPENED. The line quality is
 *  recorded, and a failed connection is an outcome of its own rather than a
 *  completed visit with a short note.
 *
 * ⚠️ No video is carried, no call is placed and nothing is recorded. The
 * platform is a third party, the joining reference is not part of the medical
 * record, and a facility doing this at scale needs a platform decision, a data
 * processing agreement and KMPDC's current telemedicine guidance — none of
 * which this module substitutes for.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { resolvePatient } from "./patients.ts";
import { licenceStatus } from "./access.ts";
import { getEncounter } from "./encounters.ts";
import { notify } from "./notifications.ts";

export class TeleError extends Error {}

export type Channel = "video" | "voice" | "chat";
export type Quality = "good" | "poor" | "failed";
export type Outcome = "completed" | "patient_absent" | "failed_connection" | "converted_to_visit" | "cancelled";

/**
 * How the person at the other end was shown to be who they said they were.
 *
 * A fingerprint is not on this list and never will be: the patient is not in
 * the building.
 */
export const IDENTITY_METHODS = [
  "portal_code",
  "known_to_clinician",
  "document_on_camera",
  "guardian_present",
  "not_established",
] as const;
export type IdentityMethod = (typeof IDENTITY_METHODS)[number];

export const IDENTITY_LABEL: Record<IdentityMethod, string> = {
  portal_code: "Code sent to the number on the record",
  known_to_clinician: "Known personally to the clinician",
  document_on_camera: "Identity document shown on camera",
  guardian_present: "Identified by a guardian who is known",
  not_established: "Not established",
};

/**
 * Presenting complaints that should be seen in person.
 *
 * ⚠️ Matched on words in the reason for the visit, which is crude and will both
 * miss things and over-fire. It is a prompt for a clinician, never a diagnosis,
 * and the list itself needs a clinician's sign-off — what is on it is a
 * judgement about what cannot be assessed down a telephone.
 */
export const RED_FLAGS: { match: RegExp; why: string }[] = [
  { match: /\bchest pain|crushing|tight chest\b/i, why: "chest pain cannot be assessed remotely" },
  { match: /\bbleeding\b.*\bpregnan|pregnan.*\bbleeding\b/i, why: "bleeding in pregnancy needs to be seen" },
  { match: /\bthunderclap|worst headache|sudden.*headache\b/i, why: "a sudden severe headache needs to be seen" },
  { match: /\bshortness of breath|breathless|cannot breathe|difficulty breathing\b/i, why: "breathlessness needs examination" },
  { match: /\bnewborn|neonate|baby.*(fever|hot)|under two months\b/i, why: "a febrile baby under two months is an emergency" },
  { match: /\bconvuls|seizure|fitting\b/i, why: "convulsions need to be seen" },
  { match: /\bunconscious|drowsy|confus|not responding\b/i, why: "altered consciousness needs to be seen" },
  { match: /\bsuicid|harm (myself|himself|herself)|overdose\b/i, why: "risk of self-harm needs a person, urgently" },
  { match: /\bsevere abdominal|acute abdomen|rigid abdomen\b/i, why: "an acute abdomen needs examination" },
  { match: /\bsnake ?bite|poison|swallowed\b/i, why: "poisoning needs to be seen" },
];

export interface TeleSession {
  id: string;
  encounter_id: string;
  patient_mrn: string;
  appointment_id: string | null;
  clinician_id: number | null;
  clinician_name: string;
  clinician_licence: string;
  channel: Channel;
  platform: string;
  identity_method: IdentityMethod;
  identity_note: string;
  consent_at: string | null;
  consent_by: string;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  quality: Quality | null;
  outcome: Outcome | null;
  outcome_note: string;
  red_flag: string;
  red_flag_action: string;
  created_at: string;
}

/** What in this reason for the visit says "not down a telephone". */
export function redFlags(reason: string): string[] {
  return RED_FLAGS.filter((flag) => flag.match.test(reason)).map((flag) => flag.why);
}

// ---------------------------------------------------------------- sessions

/**
 * Start a remote consultation on an encounter that already exists.
 *
 * The encounter is opened the ordinary way, with the ordinary licence check and
 * the ordinary refusal for a deceased patient and a second open consultation.
 * Nothing about being remote changes any of that.
 */
export function startSession(input: {
  encounterId: string;
  channel: Channel;
  identityMethod: IdentityMethod;
  identityNote?: string;
  platform?: string;
  appointmentId?: string;
  /** Who agreed to be seen this way, and when. */
  consentBy?: string;
  reason?: string;
  clinicianId: number;
  clinicianName: string;
  deviceCode: string;
}): { sessionId: string; redFlags: string[] } {
  const encounter = getEncounter(input.encounterId);
  if (!encounter) throw new TeleError("no such encounter");
  if (encounter.status !== "open") throw new TeleError("that consultation is already closed");

  const existing = get<{ id: string }>(`SELECT id FROM tele_sessions WHERE encounter_id = ?`, encounter.id);
  if (existing) throw new TeleError("that consultation already has a remote session on it");

  // Consent to being seen remotely is its own consent: a patient who agreed in
  // March has not agreed in September.
  if (!input.consentBy?.trim()) {
    throw new TeleError(
      "record who agreed to being seen remotely — consent to a consultation is not consent to a remote one",
    );
  }
  if (!IDENTITY_METHODS.includes(input.identityMethod)) throw new TeleError("that is not an identity method");
  if (input.identityMethod === "not_established") {
    // Allowed, and never silent. A clinician on a call with somebody they
    // cannot place may still be the right thing; pretending otherwise is not.
    if (!input.identityNote?.trim()) {
      throw new TeleError("if identity could not be established, say what was tried");
    }
  }

  const licence = licenceStatus(input.clinicianId);
  const flags = redFlags(input.reason ?? "");
  const consentBy = input.consentBy.trim();
  const id = mintLocalId(input.deviceCode, 8);
  const at = now();

  return tx(() => {
    run(
      `INSERT INTO tele_sessions
         (id, encounter_id, patient_mrn, appointment_id, clinician_id, clinician_name, clinician_licence,
          channel, platform, identity_method, identity_note, consent_at, consent_by,
          started_at, red_flag, device_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      encounter.id,
      encounter.patient_mrn,
      input.appointmentId ?? null,
      input.clinicianId,
      input.clinicianName,
      licence?.number ?? "",
      input.channel,
      input.platform?.trim() ?? "",
      input.identityMethod,
      input.identityNote?.trim() ?? "",
      at,
      consentBy,
      at,
      flags.join("; "),
      input.deviceCode,
      at,
      at,
    );

    if (flags.length > 0) {
      notify({
        facilityId: encounter.facility_id,
        ownerRole: "clinician",
        severity: "warning",
        kind: "tele_red_flag",
        subject: `Remote consultation on something that should be seen: ${flags[0]}`,
        body: "Closing this session will ask what was done about it.",
        entity: "encounter",
        entityId: encounter.id,
        dedupeKey: `tele_flag:${id}`,
      });
    }

    audit({
      action: "tele_session_started",
      entity: "encounter",
      entityId: encounter.id,
      patientId: encounter.patient_mrn,
      facilityId: encounter.facility_id,
      actorId: input.clinicianId,
      actorName: input.clinicianName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: {
        channel: input.channel,
        identityMethod: input.identityMethod,
        platform: input.platform ?? null,
        redFlags: flags,
      },
    });

    return { sessionId: id, redFlags: flags };
  });
}

export function getSession(id: string): TeleSession | undefined {
  return get<TeleSession>(`SELECT * FROM tele_sessions WHERE id = ?`, id);
}

export function sessionForEncounter(encounterId: string): TeleSession | undefined {
  return get<TeleSession>(`SELECT * FROM tele_sessions WHERE encounter_id = ?`, encounterId);
}

export function sessionsFor(patientMrn: string, limit = 20): TeleSession[] {
  return all<TeleSession>(
    `SELECT * FROM tele_sessions WHERE patient_mrn = ? ORDER BY created_at DESC LIMIT ?`,
    patientMrn,
    limit,
  );
}

/**
 * End it, and say how it went.
 *
 * A session opened on a red flag cannot be closed without saying what was done
 * about it. That does not refuse the consultation — a patient two hours from
 * the clinic being talked to is better than one who is not — it refuses to let
 * it be closed quietly.
 */
export function endSession(input: {
  sessionId: string;
  outcome: Outcome;
  quality: Quality;
  note?: string;
  redFlagAction?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const session = getSession(input.sessionId);
  if (!session) throw new TeleError("no such session");
  if (session.ended_at) throw new TeleError("that session has already ended");

  if (session.red_flag && !input.redFlagAction?.trim()) {
    throw new TeleError(
      `this was started on something that should be seen in person (${session.red_flag}). Say what was done about it.`,
    );
  }
  if (input.outcome !== "completed" && !input.note?.trim()) {
    throw new TeleError("a session that did not complete records what happened");
  }
  // A completed consultation over a line that failed is a contradiction, and
  // the one that matters: it is how a consultation with gaps in it gets
  // recorded as a consultation.
  if (input.outcome === "completed" && input.quality === "failed") {
    throw new TeleError("a call that failed did not complete — record it as a failed connection");
  }

  const at = now();
  tx(() => {
    run(
      `UPDATE tele_sessions SET ended_at = ?, outcome = ?, quality = ?, outcome_note = ?,
              red_flag_action = ?, updated_at = ? WHERE id = ?`,
      at,
      input.outcome,
      input.quality,
      input.note?.trim() ?? "",
      input.redFlagAction?.trim() ?? "",
      at,
      session.id,
    );

    if (input.outcome === "converted_to_visit" || (session.red_flag && input.outcome !== "completed")) {
      notify({
        facilityId: getEncounter(session.encounter_id)!.facility_id,
        ownerRole: "clinician",
        severity: "warning",
        kind: "tele_needs_visit",
        subject: `${session.patient_mrn} needs to be seen in person`,
        body: input.redFlagAction?.trim() || input.note?.trim() || "",
        entity: "encounter",
        entityId: session.encounter_id,
        dedupeKey: `tele_visit:${session.id}`,
      });
    }

    audit({
      action: "tele_session_ended",
      entity: "encounter",
      entityId: session.encounter_id,
      patientId: session.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: {
        outcome: input.outcome,
        quality: input.quality,
        minutes: Math.round((Date.parse(at) - Date.parse(session.started_at ?? at)) / 60_000),
        redFlag: session.red_flag || null,
        redFlagAction: input.redFlagAction ?? null,
      },
    });
  });
}

/**
 * Whether a medicine may be prescribed on this consultation.
 *
 * A controlled drug may not, and that is not overridable here: the patient has
 * not been examined and cannot be seen. Everything else is the prescriber's
 * judgement, as it is in a room.
 */
export function prescribingCheck(
  encounterId: string,
  controlled: boolean,
): { allowed: boolean; why: string } {
  const session = sessionForEncounter(encounterId);
  if (!session) return { allowed: true, why: "" };
  if (!controlled) return { allowed: true, why: "" };
  return {
    allowed: false,
    why: "a controlled drug is not prescribed on a remote consultation — the patient has not been examined",
  };
}

// ----------------------------------------------------------------- reports

export interface TeleSummary {
  sessions: number;
  completed: number;
  failedConnection: number;
  patientAbsent: number;
  convertedToVisit: number;
  redFlagged: number;
  /** Of sessions that ended. */
  completionRatePercent: number | null;
  poorLines: number;
  identityNotEstablished: number;
  /** Still open — a session nobody ended is a consultation nobody closed. */
  running: number;
}

export function teleSummary(facilityId: number, sinceDays = 90, asOf = today()): TeleSummary {
  const since = new Date(Date.parse(`${asOf}T00:00:00.000Z`) - sinceDays * 86_400_000).toISOString();
  const rows = all<TeleSession>(
    `SELECT t.* FROM tele_sessions t JOIN encounters e ON e.id = t.encounter_id
      WHERE e.facility_id = ? AND t.created_at >= ?`,
    facilityId,
    since,
  );

  const ended = rows.filter((r) => r.ended_at);
  const completed = ended.filter((r) => r.outcome === "completed").length;

  return {
    sessions: rows.length,
    completed,
    failedConnection: ended.filter((r) => r.outcome === "failed_connection").length,
    patientAbsent: ended.filter((r) => r.outcome === "patient_absent").length,
    convertedToVisit: ended.filter((r) => r.outcome === "converted_to_visit").length,
    redFlagged: rows.filter((r) => r.red_flag).length,
    completionRatePercent: ended.length > 0 ? Math.round((completed / ended.length) * 1000) / 10 : null,
    poorLines: ended.filter((r) => r.quality === "poor" || r.quality === "failed").length,
    identityNotEstablished: rows.filter((r) => r.identity_method === "not_established").length,
    running: rows.filter((r) => !r.ended_at).length,
  };
}

/** Sessions nobody ended. A consultation left running is one nobody closed. */
export function runningSessions(facilityId: number): TeleSession[] {
  return all<TeleSession>(
    `SELECT t.* FROM tele_sessions t JOIN encounters e ON e.id = t.encounter_id
      WHERE e.facility_id = ? AND t.ended_at IS NULL ORDER BY t.started_at`,
    facilityId,
  );
}

export function recentSessions(facilityId: number, limit = 30) {
  return all<TeleSession & { patient_name: string }>(
    `SELECT t.*, p.given_name || ' ' || p.family_name AS patient_name
       FROM tele_sessions t
       JOIN encounters e ON e.id = t.encounter_id
       JOIN patients p ON p.mrn = t.patient_mrn
      WHERE e.facility_id = ? ORDER BY t.created_at DESC LIMIT ?`,
    facilityId,
    limit,
  );
}
