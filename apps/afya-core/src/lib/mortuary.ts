/**
 * M64 Mortuary.
 *
 * Almost nothing in a hospital system is irreversible. This is. A body released
 * to the wrong family is buried, and no correction screen exists for that. So
 * this module is built around release, and everything before it is there to
 * make release safe.
 *
 *  A BODY IS ITS TAG, NOT ITS NAME. The tag goes on at the door and the name is
 *  attached to the tag afterwards, never the other way round. Two men called
 *  John Mwangi arriving on the same night is not a hypothetical, and the
 *  mistake it produces is discovered at a graveside.
 *
 *  A BODY IS NOT RELEASED ON AN UNCONFIRMED IDENTITY. Somebody who knew the
 *  person has to have viewed the body and signed. `release` refuses while the
 *  identity is provisional or unknown, and this is one of the few places in
 *  this system where refusing is plainly right: there is no undo.
 *
 *  A POLICE CASE IS NOT RELEASED WITHOUT A WRITTEN AUTHORITY. The body is
 *  evidence. A relative asking, however distressed and however genuine, is not
 *  the authority, and a clerk should not be the one holding that line alone.
 *
 *  A REQUIRED POSTMORTEM HAPPENS FIRST. Once a body is buried the examination
 *  cannot be done, so "release now, examine later" is not a thing that exists.
 *
 *  A MISSING DEATH NOTIFICATION ESCALATES RATHER THAN BLOCKS. This is the one
 *  requirement here that is administrative rather than irreversible. A family
 *  that cannot bury their dead because a reference number has not come back
 *  from the registrar is a family the facility has failed, so the release goes
 *  ahead on a written reason and raises an alert. That is a different judgement
 *  from the three above, and it is deliberate.
 *
 *  THE REGISTER IS APPEND-ONLY. Every viewing, examination and release is an
 *  event nobody can edit. The register a coroner or a family's advocate asks
 *  for is only worth anything if that is true.
 *
 * ⚠️ Storage fees, the free period, the unclaimed-body horizon and the
 * statutory process for a body nobody comes for are all facility and county
 * matters. What is here is a register and a fee calculation, not a legal
 * process. The review register says so.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { resolvePatient } from "./patients.ts";
import { notify } from "./notifications.ts";
import { postJournal, ACCOUNT } from "./accounting.ts";
import { formatKes } from "./billing.ts";
import { number as configNumber } from "./configuration.ts";

export class MortuaryError extends Error {}

export type Identity = "confirmed" | "provisional" | "unknown";
export type BodySource = "ward" | "casualty" | "theatre" | "maternity" | "brought_in" | "transferred_in";
export type BodyStatus = "in_store" | "released" | "transferred_out" | "disposed";

/**
 * Storage charging.
 *
 * ⚠️ Illustrative. Two free days then 500 shillings a day is a common shape in
 * Kenyan facilities, but the figures are a facility's own and belong in
 * configuration, which this module does not yet have.
 */
export const FREE_DAYS_DEFAULT = 2;
export const DAILY_FEE_CENTS_DEFAULT = 500_00;

/** What the facility charges, as it has it set. */
export function freeDays(): number {
  return configNumber("mortuary.free_days");
}
export function dailyFeeCents(): number {
  return configNumber("mortuary.daily_fee_cents");
}

/** When a body nobody has come for stops being a waiting family and becomes a problem. */
export const UNCLAIMED_DAYS_DEFAULT = 21;

/** When a body nobody has come for becomes a problem, as the facility has it. */
export function unclaimedDays(): number {
  return configNumber("mortuary.unclaimed_days");
}

export interface Body {
  id: string;
  facility_id: number;
  tag_no: string;
  patient_mrn: string | null;
  given_name: string;
  family_name: string;
  sex: "female" | "male" | "unknown" | null;
  age_years: number | null;
  identity: Identity;
  source: BodySource;
  died_at: string | null;
  place_of_death: string;
  received_at: string;
  receiver_name: string;
  unit_code: string | null;
  medico_legal: number;
  police_ob_no: string;
  investigating_officer: string;
  postmortem_required: number;
  postmortem_at: string | null;
  pathologist: string;
  postmortem_findings: string;
  cause_of_death: string;
  cause_code: string | null;
  certified_by: string;
  certified_at: string | null;
  notification_ref: string;
  status: BodyStatus;
  released_at: string | null;
  released_to_name: string;
  released_to_id: string;
  released_to_relationship: string;
  release_authority: string;
  releaser_name: string;
  release_override: string;
  fee_cents: number;
  waived_cents: number;
  paid_cents: number;
  waiver_reason: string;
}

// -------------------------------------------------------------------- units

export function defineUnit(input: {
  facilityId: number;
  code: string;
  name: string;
  bays?: number;
  assetId?: string;
}): void {
  const bays = input.bays ?? 1;
  if (!Number.isInteger(bays) || bays <= 0) throw new MortuaryError("a unit has at least one bay");
  run(
    `INSERT INTO mortuary_units (code, facility_id, name, asset_id, bays, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name, asset_id = excluded.asset_id, bays = excluded.bays`,
    input.code.trim().toUpperCase(),
    input.facilityId,
    input.name.trim(),
    input.assetId ?? null,
    bays,
    now(),
  );
}

export interface UnitOccupancy {
  code: string;
  name: string;
  assetId: string | null;
  bays: number;
  occupied: number;
  free: number;
}

export function occupancy(facilityId: number): UnitOccupancy[] {
  return all<{ code: string; name: string; asset_id: string | null; bays: number }>(
    `SELECT code, name, asset_id, bays FROM mortuary_units WHERE facility_id = ? AND active = 1 ORDER BY code`,
    facilityId,
  ).map((u) => {
    const occupied =
      get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM bodies WHERE unit_code = ? AND status = 'in_store'`,
        u.code,
      )?.n ?? 0;
    return {
      code: u.code,
      name: u.name,
      assetId: u.asset_id,
      bays: u.bays,
      occupied,
      free: Math.max(0, u.bays - occupied),
    };
  });
}

// ------------------------------------------------------------------ receive

/**
 * The next tag number.
 *
 * Per facility per year, because that is how a mortuary register is written and
 * how a family is told to ask for it. Gapless within the year is not promised —
 * a tag is a reference, not a count.
 */
function nextTag(facilityId: number, onDate: string): string {
  const year = onDate.slice(0, 4);
  const last = get<{ tag_no: string }>(
    `SELECT tag_no FROM bodies WHERE facility_id = ? AND tag_no LIKE ? ORDER BY tag_no DESC LIMIT 1`,
    facilityId,
    `${year}/%`,
  );
  const n = last ? Number(last.tag_no.split("/")[1]) + 1 : 1;
  return `${year}/${String(n).padStart(4, "0")}`;
}

/**
 * Receive a body.
 *
 * The tag is minted here and nowhere else. Where the deceased was a patient of
 * this facility, the patient record is marked deceased in the same
 * transaction — which is what stops somebody opening an encounter on them next
 * week, and it is the only place in this system that sets that flag.
 */
export function receiveBody(input: {
  facilityId: number;
  patientMrn?: string;
  givenName?: string;
  familyName?: string;
  sex?: "female" | "male" | "unknown";
  ageYears?: number;
  identity?: Identity;
  source: BodySource;
  diedAt?: string;
  placeOfDeath?: string;
  receivedAt?: string;
  unitCode?: string;
  medicoLegal?: boolean;
  policeObNo?: string;
  investigatingOfficer?: string;
  postmortemRequired?: boolean;
  causeOfDeath?: string;
  certifiedBy?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): { bodyId: string; tagNo: string } {
  const patient = input.patientMrn ? resolvePatient(input.patientMrn) : undefined;
  if (input.patientMrn && !patient) throw new MortuaryError("no such patient");

  const givenName = (input.givenName ?? patient?.given_name ?? "").trim();
  const familyName = (input.familyName ?? patient?.family_name ?? "").trim();

  // An unknown body is a real and common case, and refusing to receive it
  // would mean it is not recorded anywhere at all. What is refused is a body
  // that claims a confirmed identity without a name to confirm.
  const identity = input.identity ?? (patient ? "confirmed" : givenName ? "provisional" : "unknown");
  if (identity === "confirmed" && !familyName && !patient) {
    throw new MortuaryError("a confirmed identity needs a name — confirmed by whom, of whom?");
  }

  // A police case that cannot say which police case is not a police case yet.
  if (input.medicoLegal && !input.policeObNo?.trim()) {
    throw new MortuaryError("a medico-legal body must carry the OB number it was brought in under");
  }

  if (input.unitCode) {
    const unit = occupancy(input.facilityId).find((u) => u.code === input.unitCode!.trim().toUpperCase());
    if (!unit) throw new MortuaryError("no such mortuary unit");
    if (unit.free <= 0) {
      throw new MortuaryError(
        `${unit.name} is full — ${unit.occupied} of ${unit.bays} bays. A body recorded in an occupied bay is a body somebody will look for in the wrong drawer.`,
      );
    }
  }

  const receivedAt = input.receivedAt ?? now();
  const tagNo = nextTag(input.facilityId, receivedAt.slice(0, 10));
  const id = mintLocalId(input.deviceCode, 8);

  return tx(() => {
    run(
      `INSERT INTO bodies
         (id, facility_id, tag_no, patient_mrn, given_name, family_name, sex, age_years,
          identity, source, died_at, place_of_death, received_at, received_by, receiver_name,
          unit_code, medico_legal, police_ob_no, investigating_officer, postmortem_required,
          cause_of_death, certified_by, certified_at, status, device_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_store', ?, ?)`,
      id,
      input.facilityId,
      tagNo,
      patient?.mrn ?? null,
      givenName,
      familyName,
      input.sex ?? patient?.sex ?? "unknown",
      input.ageYears ?? null,
      identity,
      input.source,
      input.diedAt ?? null,
      input.placeOfDeath?.trim() ?? "",
      receivedAt,
      input.byUserId,
      input.byUserName,
      input.unitCode?.trim().toUpperCase() ?? null,
      input.medicoLegal ? 1 : 0,
      input.policeObNo?.trim() ?? "",
      input.investigatingOfficer?.trim() ?? "",
      // A police case is always examined. Saying otherwise at the door is not
      // a thing a clerk does — it takes `waivePostmortem` and a named authority.
      input.medicoLegal || input.postmortemRequired ? 1 : 0,
      input.causeOfDeath?.trim() ?? "",
      input.certifiedBy?.trim() ?? "",
      input.causeOfDeath?.trim() ? receivedAt : null,
      input.deviceCode,
      now(),
    );

    logEvent({
      bodyId: id,
      kind: "received",
      detail: `From ${input.source.replace("_", " ")}${input.placeOfDeath ? ` · ${input.placeOfDeath}` : ""}`,
      happenedAt: receivedAt,
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });

    // The only place in this system that marks a patient deceased. Until it
    // runs, nothing stops a clinician opening an encounter on them.
    if (patient) {
      run(
        `UPDATE patients SET deceased = 1, deceased_date = ?, updated_at = ? WHERE mrn = ?`,
        (input.diedAt ?? receivedAt).slice(0, 10),
        now(),
        patient.mrn,
      );
    }

    if (identity === "unknown") {
      notify({
        facilityId: input.facilityId,
        ownerRole: "admin",
        severity: "warning",
        kind: "body_unidentified",
        subject: `Body ${tagNo} received unidentified`,
        body: "Somebody is looking for this person. The police and the county need to know it is here.",
        entity: "body",
        entityId: id,
        dedupeKey: `body_unknown:${id}`,
      });
    }

    audit({
      action: "body_received",
      entity: "body",
      entityId: id,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      patientId: patient?.mrn ?? null,
      detail: {
        tagNo,
        identity,
        source: input.source,
        medicoLegal: Boolean(input.medicoLegal),
        unit: input.unitCode ?? null,
      },
    });

    return { bodyId: id, tagNo };
  });
}

export function getBody(id: string): Body | undefined {
  return get<Body>(`SELECT * FROM bodies WHERE id = ?`, id);
}

export function bodyByTag(facilityId: number, tagNo: string): Body | undefined {
  return get<Body>(`SELECT * FROM bodies WHERE facility_id = ? AND tag_no = ?`, facilityId, tagNo.trim());
}

export function listBodies(facilityId: number, status?: BodyStatus): Body[] {
  return status
    ? all<Body>(
        `SELECT * FROM bodies WHERE facility_id = ? AND status = ? ORDER BY received_at DESC`,
        facilityId,
        status,
      )
    : all<Body>(`SELECT * FROM bodies WHERE facility_id = ? ORDER BY received_at DESC`, facilityId);
}

// ------------------------------------------------------------------ events

function logEvent(input: {
  bodyId: string;
  kind: string;
  detail?: string;
  personName?: string;
  personId?: string;
  relationship?: string;
  happenedAt?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  run(
    `INSERT INTO body_events
       (body_id, kind, detail, person_name, person_id, relationship, happened_at, recorded_by, recorder_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.bodyId,
    input.kind,
    input.detail?.trim() ?? "",
    input.personName?.trim() ?? "",
    input.personId?.trim() ?? "",
    input.relationship?.trim() ?? "",
    input.happenedAt ?? now(),
    input.byUserId,
    input.byUserName,
    now(),
  );
}

export function eventsFor(bodyId: string) {
  return all<{
    id: number;
    kind: string;
    detail: string;
    person_name: string;
    person_id: string;
    relationship: string;
    happened_at: string;
    recorder_name: string;
  }>(`SELECT * FROM body_events WHERE body_id = ? ORDER BY happened_at, id`, bodyId);
}

// ---------------------------------------------------------- identification

/**
 * A viewing, and what it settled.
 *
 * This is the function that turns a provisional name into a confirmed one, and
 * it is the gate `release` stands behind. The person who identified the body is
 * recorded by name, by identity document and by their relationship to the
 * deceased, because if it turns out to be the wrong body those three facts are
 * the whole investigation.
 */
export function recordViewing(input: {
  bodyId: string;
  personName: string;
  personId: string;
  relationship: string;
  identified: boolean;
  /** A name given at the viewing, where the body arrived unknown. */
  givenName?: string;
  familyName?: string;
  note?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const body = getBody(input.bodyId);
  if (!body) throw new MortuaryError("no such body");
  if (body.status !== "in_store") throw new MortuaryError(`that body has been ${body.status.replace("_", " ")}`);
  if (!input.personName.trim()) throw new MortuaryError("a viewing records who viewed");
  if (input.identified && !input.personId.trim()) {
    // Without it the identification cannot be traced back to a person, which
    // is the only thing that makes it worth anything.
    throw new MortuaryError("an identification records the identity document of the person who made it");
  }
  if (input.identified && !input.relationship.trim()) {
    throw new MortuaryError("an identification records how they knew the deceased");
  }

  const givenName = input.givenName?.trim() || body.given_name;
  const familyName = input.familyName?.trim() || body.family_name;
  if (input.identified && !familyName) {
    throw new MortuaryError("an identification needs the name of the person identified");
  }

  tx(() => {
    if (input.identified) {
      run(
        `UPDATE bodies SET identity = 'confirmed', given_name = ?, family_name = ? WHERE id = ?`,
        givenName,
        familyName,
        body.id,
      );
    }
    logEvent({
      bodyId: body.id,
      kind: input.identified ? "identified" : "viewed",
      detail: input.identified
        ? `Identified as ${givenName} ${familyName}`.trim()
        : input.note?.trim() || "Viewed; not identified",
      personName: input.personName,
      personId: input.personId,
      relationship: input.relationship,
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });
    audit({
      action: input.identified ? "body_identified" : "body_viewed",
      entity: "body",
      entityId: body.id,
      facilityId: body.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: {
        tagNo: body.tag_no,
        by: input.personName,
        idNumber: input.personId,
        relationship: input.relationship,
        identified: input.identified,
      },
    });
  });
}

// ------------------------------------------------------------- postmortem

export function recordPostmortem(input: {
  bodyId: string;
  pathologist: string;
  findings: string;
  causeOfDeath: string;
  causeCode?: string;
  doneAt?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const body = getBody(input.bodyId);
  if (!body) throw new MortuaryError("no such body");
  if (body.status !== "in_store") throw new MortuaryError("that body is no longer here");
  if (!input.pathologist.trim()) throw new MortuaryError("a postmortem records who performed it");
  if (!input.causeOfDeath.trim()) throw new MortuaryError("a postmortem records a cause of death");

  const doneAt = input.doneAt ?? now();
  tx(() => {
    run(
      `UPDATE bodies SET postmortem_at = ?, pathologist = ?, postmortem_findings = ?,
              cause_of_death = ?, cause_code = ?, certified_by = ?, certified_at = ?
        WHERE id = ?`,
      doneAt,
      input.pathologist.trim(),
      input.findings.trim(),
      input.causeOfDeath.trim(),
      input.causeCode?.trim().toUpperCase() ?? null,
      input.pathologist.trim(),
      doneAt,
      body.id,
    );
    logEvent({
      bodyId: body.id,
      kind: "postmortem",
      detail: `${input.causeOfDeath.trim()} — ${input.pathologist.trim()}`,
      happenedAt: doneAt,
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });
    audit({
      action: "postmortem_recorded",
      entity: "body",
      entityId: body.id,
      facilityId: body.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { tagNo: body.tag_no, pathologist: input.pathologist, causeOfDeath: input.causeOfDeath },
    });
  });
}

/**
 * Waive a required postmortem.
 *
 * Somebody with the authority to say it is not needed has to be named, and the
 * authority recorded. A postmortem quietly dropped is how a death that should
 * have been investigated is not.
 */
export function waivePostmortem(input: {
  bodyId: string;
  authority: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const body = getBody(input.bodyId);
  if (!body) throw new MortuaryError("no such body");
  if (!body.postmortem_required) throw new MortuaryError("no postmortem was required on that body");
  if (body.postmortem_at) throw new MortuaryError("that postmortem has already been done");
  if (!input.authority.trim()) throw new MortuaryError("waiving a postmortem records who authorised it");
  if (!input.reason.trim()) throw new MortuaryError("waiving a postmortem records why");

  tx(() => {
    run(`UPDATE bodies SET postmortem_required = 0 WHERE id = ?`, body.id);
    logEvent({
      bodyId: body.id,
      kind: "postmortem_waived",
      detail: `${input.reason.trim()} — authorised by ${input.authority.trim()}`,
      personName: input.authority,
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });
    audit({
      action: "postmortem_waived",
      entity: "body",
      entityId: body.id,
      facilityId: body.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { tagNo: body.tag_no, authority: input.authority, reason: input.reason },
    });
  });
}

// ----------------------------------------------------------- notification

/** The reference the registrar gives back. The family needs it to bury. */
export function recordNotification(input: {
  bodyId: string;
  reference: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const body = getBody(input.bodyId);
  if (!body) throw new MortuaryError("no such body");
  if (!input.reference.trim()) throw new MortuaryError("a death notification has a reference or it has not been made");

  tx(() => {
    run(`UPDATE bodies SET notification_ref = ? WHERE id = ?`, input.reference.trim(), body.id);
    logEvent({
      bodyId: body.id,
      kind: "death_notified",
      detail: input.reference.trim(),
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });
  });
}

// -------------------------------------------------------------------- fees

/** Whole days in store, counted from the day of receipt. */
export function daysInStore(body: Body, asOf = now()): number {
  const from = Date.parse(`${body.received_at.slice(0, 10)}T00:00:00.000Z`);
  const to = Date.parse(`${(body.released_at ?? asOf).slice(0, 10)}T00:00:00.000Z`);
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export interface Fee {
  days: number;
  chargeableDays: number;
  feeCents: number;
}

/**
 * What is owed for storage.
 *
 * ⚠️ Two free days then a daily rate. Both figures are illustrative and belong
 * in a facility's own configuration.
 */
export function storageFee(body: Body, asOf = now()): Fee {
  const days = daysInStore(body, asOf);
  const chargeableDays = Math.max(0, days - freeDays());
  return { days, chargeableDays, feeCents: chargeableDays * dailyFeeCents() };
}

// ----------------------------------------------------------------- release

export interface ReleaseCheck {
  ok: boolean;
  /** What stops the release outright. */
  blockers: string[];
  /** What can be gone past on a written reason. */
  overridable: string[];
}

/**
 * Whether this body may be released, and why not.
 *
 * Split into two lists on purpose. The blockers are irreversible mistakes —
 * the wrong body, a police case, an examination that can never be done after
 * burial. The overridable one is administrative: a family should not be kept
 * from burying their dead because a reference number has not come back.
 */
export function releaseCheck(bodyId: string, authority?: string): ReleaseCheck {
  const body = getBody(bodyId);
  if (!body) throw new MortuaryError("no such body");

  const blockers: string[] = [];
  const overridable: string[] = [];

  if (body.status !== "in_store") blockers.push(`already ${body.status.replace("_", " ")}`);
  if (body.identity !== "confirmed") {
    blockers.push(
      body.identity === "unknown"
        ? "nobody has identified this body"
        : "the identity is provisional — somebody who knew them must view and sign first",
    );
  }
  // An authority being offered now satisfies the check. Nothing is written
  // until the release itself succeeds, so a refused attempt leaves no trace of
  // a police authority on a body that is still here.
  if (body.medico_legal && !(authority?.trim() || body.release_authority)) {
    blockers.push(`police case ${body.police_ob_no || "(no OB number)"} — a written release authority is required`);
  }
  if (body.postmortem_required && !body.postmortem_at) {
    blockers.push("a postmortem is required and has not been done — it cannot be done after burial");
  }
  if (!body.notification_ref) {
    overridable.push("no death notification reference has been recorded");
  }

  return { ok: blockers.length === 0 && overridable.length === 0, blockers, overridable };
}

/**
 * Release a body to the family.
 *
 * The end of the line. Everything the checks above can catch is caught here,
 * and the three blockers cannot be argued past by anybody at any level —
 * because the mistake they prevent is discovered at a graveside.
 */
export function release(input: {
  bodyId: string;
  toName: string;
  toIdNumber: string;
  relationship: string;
  /** The police authority, on a medico-legal case. */
  authority?: string;
  /** Written reason for going ahead without a death notification. */
  override?: string;
  paidCents?: number;
  waivedCents?: number;
  waiverReason?: string;
  releasedAt?: string;
  byUserId: number | null;
  byUserName: string;
}): { feeCents: number; days: number } {
  const body = getBody(input.bodyId);
  if (!body) throw new MortuaryError("no such body");
  if (!input.toName.trim()) throw new MortuaryError("a release records who took the body");
  if (!input.toIdNumber.trim()) {
    throw new MortuaryError("a release records the identity document of the person who took the body");
  }
  if (!input.relationship.trim()) throw new MortuaryError("a release records their relationship to the deceased");

  const check = releaseCheck(body.id, input.authority);
  if (check.blockers.length > 0) {
    throw new MortuaryError(`this body cannot be released: ${check.blockers.join("; ")}`);
  }
  if (check.overridable.length > 0 && !input.override?.trim()) {
    throw new MortuaryError(
      `${check.overridable.join("; ")}. Releasing anyway is allowed and needs a written reason.`,
    );
  }

  const releasedAt = input.releasedAt ?? now();
  const fee = storageFee(body, releasedAt);
  const waived = input.waivedCents ?? 0;
  if (waived > 0 && !input.waiverReason?.trim()) {
    throw new MortuaryError("waiving a storage fee records why");
  }
  if (waived > fee.feeCents) throw new MortuaryError("more cannot be waived than is owed");
  const paid = input.paidCents ?? Math.max(0, fee.feeCents - waived);

  return tx(() => {
    run(
      `UPDATE bodies SET status = 'released', released_at = ?, release_authority = ?, released_to_name = ?,
              released_to_id = ?, released_to_relationship = ?, released_by = ?, releaser_name = ?,
              release_override = ?, fee_cents = ?, waived_cents = ?, waiver_reason = ?, paid_cents = ?
        WHERE id = ?`,
      releasedAt,
      input.authority?.trim() || body.release_authority,
      input.toName.trim(),
      input.toIdNumber.trim(),
      input.relationship.trim(),
      input.byUserId,
      input.byUserName,
      input.override?.trim() ?? "",
      fee.feeCents,
      waived,
      input.waiverReason?.trim() ?? "",
      paid,
      body.id,
    );

    logEvent({
      bodyId: body.id,
      kind: "released",
      detail: `${fee.days} day${fee.days === 1 ? "" : "s"} in store · ${formatKes(fee.feeCents)}${
        waived > 0 ? ` · ${formatKes(waived)} waived` : ""
      }`,
      personName: input.toName,
      personId: input.toIdNumber,
      relationship: input.relationship,
      happenedAt: releasedAt,
      byUserId: input.byUserId,
      byUserName: input.byUserName,
    });

    // Money taken is money in the ledger. Idempotent on the body, like every
    // other posting, so a correction cannot double-count it.
    if (paid > 0) {
      postJournal({
        facilityId: body.facility_id,
        entryDate: releasedAt.slice(0, 10),
        narrative: `Mortuary storage — body ${body.tag_no}`,
        sourceKind: "mortuary_fee",
        sourceRef: body.id,
        lines: [
          { accountCode: ACCOUNT.CASH, debitCents: paid },
          { accountCode: ACCOUNT.INCOME_SERVICES, creditCents: paid, memo: `${fee.chargeableDays} chargeable days` },
        ],
        byUserId: input.byUserId,
        byUserName: input.byUserName,
      });
    }

    if (input.override?.trim()) {
      notify({
        facilityId: body.facility_id,
        ownerRole: "admin",
        severity: "warning",
        kind: "release_without_notification",
        subject: `Body ${body.tag_no} released without a death notification reference`,
        body: input.override.trim(),
        entity: "body",
        entityId: body.id,
        dedupeKey: `release_override:${body.id}`,
      });
    }

    audit({
      action: "body_released",
      entity: "body",
      entityId: body.id,
      facilityId: body.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      patientId: body.patient_mrn,
      detail: {
        tagNo: body.tag_no,
        to: input.toName,
        idNumber: input.toIdNumber,
        relationship: input.relationship,
        authority: input.authority ?? body.release_authority ?? null,
        override: input.override ?? null,
        days: fee.days,
        feeCents: fee.feeCents,
        waivedCents: waived,
        paidCents: paid,
      },
    });

    return { feeCents: fee.feeCents, days: fee.days };
  });
}

// ----------------------------------------------------------------- reports

export interface Unclaimed {
  body: Body;
  days: number;
  feeCents: number;
}

/** Bodies nobody has come for. Sorted longest first, because that is the order they matter in. */
export function unclaimed(facilityId: number, afterDays = unclaimedDays(), asOf = now()): Unclaimed[] {
  return listBodies(facilityId, "in_store")
    .map((body) => ({ body, days: daysInStore(body, asOf), feeCents: storageFee(body, asOf).feeCents }))
    .filter((row) => row.days >= afterDays)
    .sort((a, b) => b.days - a.days);
}

export interface MortuarySummary {
  inStore: number;
  bays: number;
  free: number;
  unidentified: number;
  medicoLegal: number;
  awaitingPostmortem: number;
  releasable: number;
  blocked: number;
  unclaimed: number;
  longestDays: number;
  accruedFeeCents: number;
  releasedThisMonth: number;
  releasedWithoutNotification: number;
}

export function mortuarySummary(facilityId: number, asOf = now()): MortuarySummary {
  const inStore = listBodies(facilityId, "in_store");
  const units = occupancy(facilityId);
  const month = asOf.slice(0, 7);
  const released = listBodies(facilityId, "released");

  const checks = inStore.map((body) => releaseCheck(body.id));

  return {
    inStore: inStore.length,
    bays: units.reduce((sum, u) => sum + u.bays, 0),
    free: units.reduce((sum, u) => sum + u.free, 0),
    unidentified: inStore.filter((b) => b.identity !== "confirmed").length,
    medicoLegal: inStore.filter((b) => b.medico_legal).length,
    awaitingPostmortem: inStore.filter((b) => b.postmortem_required && !b.postmortem_at).length,
    releasable: checks.filter((c) => c.ok).length,
    blocked: checks.filter((c) => c.blockers.length > 0).length,
    unclaimed: unclaimed(facilityId, unclaimedDays(), asOf).length,
    longestDays: inStore.reduce((max, b) => Math.max(max, daysInStore(b, asOf)), 0),
    accruedFeeCents: inStore.reduce((sum, b) => sum + storageFee(b, asOf).feeCents, 0),
    releasedThisMonth: released.filter((b) => (b.released_at ?? "").slice(0, 7) === month).length,
    releasedWithoutNotification: released.filter((b) => b.release_override).length,
  };
}

/**
 * The register, as a mortuary keeps it.
 *
 * One row per body, in the order they arrived, with what is holding each one
 * up. This is the screen an attendant works from.
 */
export interface RegisterRow {
  body: Body;
  days: number;
  feeCents: number;
  check: ReleaseCheck;
}

export function register(facilityId: number, asOf = now()): RegisterRow[] {
  return listBodies(facilityId, "in_store")
    .map((body) => ({
      body,
      days: daysInStore(body, asOf),
      feeCents: storageFee(body, asOf).feeCents,
      check: releaseCheck(body.id),
    }))
    .sort((a, b) => b.days - a.days);
}

/**
 * ⚠️ A demonstration mortuary. Bay counts and the fridge are illustrative; a
 * facility with no mortuary simply defines no units and the module stays empty.
 */
export function seedMortuary(facilityId: number, assetId?: string): void {
  defineUnit({ facilityId, code: "MORT-A", name: "Cold room A", bays: 4, assetId });
  defineUnit({ facilityId, code: "MORT-B", name: "Cold room B", bays: 2 });
}
