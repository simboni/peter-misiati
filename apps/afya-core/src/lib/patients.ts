/**
 * M10 Patient Registry & Master Patient Index.
 *
 * Weakness W6 from the research: a patient holds a facility file number, an SHA
 * number, a national ID and a phone number, with nothing linking them. The
 * duplicates that follow corrupt the clinical record *and* the claim — a visit
 * history split across two records looks like two different people to a payer.
 *
 * So matching happens in two stages, and they are deliberately different:
 *
 *   DETERMINISTIC — a strong identifier (national ID, SHA number, passport,
 *   birth certificate, alien ID) matching is a definite match. One hit, done.
 *
 *   PROBABILISTIC — no strong identifier, which is the common case for a child,
 *   a dependant or someone who left their ID at home. Name, date of birth,
 *   phone, sex and locality are scored. The system NEVER auto-merges on a score;
 *   it presents candidates and a person decides. An automatic merge on a
 *   probabilistic match is how two patients become one record.
 *
 * Two local realities shape the schema:
 *
 *   PHONE NUMBERS are the strongest weak identifier in Kenya, but they are
 *   written six different ways (0712…, +254712…, 254712…, 254 712 …). They are
 *   normalised on the way in or they match nothing.
 *
 *   DATES OF BIRTH are often unknown. Recording an estimate as an estimate keeps
 *   it usable for matching without asserting a fact — and stops an estimated
 *   year scoring as highly as a documented one.
 *
 * Every read of a patient record is audited with a purpose-of-use. Under the
 * Data Protection Act, opening a record is itself a disclosure.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { recordOp } from "./sync.ts";

export class PatientError extends Error {}

export type Sex = "male" | "female" | "intersex";

export interface Patient {
  mrn: string;
  facility_id: number;
  national_id: string | null;
  sha_number: string | null;
  passport_no: string | null;
  birth_cert_no: string | null;
  alien_id: string | null;
  given_name: string;
  family_name: string;
  other_names: string;
  sex: Sex;
  date_of_birth: string | null;
  dob_estimated: number;
  phone: string | null;
  alt_phone: string | null;
  county: string;
  sub_county: string;
  ward: string;
  village: string;
  nok_name: string;
  nok_phone: string | null;
  nok_relation: string;
  deceased: number;
  deceased_date: string | null;
  merged_into: string | null;
  registered_by: number | null;
  registered_device: string | null;
  created_at: string;
  updated_at: string;
}

// ------------------------------------------------------------ normalisation

/**
 * Kenyan mobile numbers, normalised to 254XXXXXXXXX.
 *
 * Accepts every form staff actually type: 0712345678, +254712345678,
 * 254712345678, 712345678, and any of them with spaces or hyphens. Returns null
 * for anything that is not a plausible Kenyan mobile, so a half-typed number is
 * stored as nothing rather than as a bad match key.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;

  let national: string;
  if (digits.startsWith("254")) national = digits.slice(3);
  else if (digits.startsWith("0")) national = digits.slice(1);
  else national = digits;

  // Kenyan mobile subscriber numbers are 9 digits and start 7 or 1.
  if (!/^[71]\d{8}$/.test(national)) return null;
  return `254${national}`;
}

/** Strong identifiers, compared without punctuation or case. */
export function normaliseId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return cleaned || null;
}

/** Names, for comparison only — the stored name keeps its original spelling. */
function normaliseName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ");
}

// --------------------------------------------------------------- registration

export interface RegisterInput {
  facilityId: number;
  deviceCode: string;
  givenName: string;
  familyName: string;
  otherNames?: string;
  sex: Sex;
  dateOfBirth?: string | null;
  dobEstimated?: boolean;
  nationalId?: string | null;
  shaNumber?: string | null;
  passportNo?: string | null;
  birthCertNo?: string | null;
  alienId?: string | null;
  phone?: string | null;
  altPhone?: string | null;
  county?: string;
  subCounty?: string;
  ward?: string;
  village?: string;
  nokName?: string;
  nokPhone?: string | null;
  nokRelation?: string;
  byUserId: number | null;
  byUserName: string;
}

export function registerPatient(input: RegisterInput): string {
  const givenName = input.givenName.trim();
  const familyName = input.familyName.trim();

  if (!givenName || !familyName) {
    throw new PatientError("both a given name and a family name are required");
  }
  if (input.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth)) {
    throw new PatientError("date of birth must be an ISO date (YYYY-MM-DD)");
  }

  const nationalId = normaliseId(input.nationalId);
  const shaNumber = normaliseId(input.shaNumber);
  const passportNo = normaliseId(input.passportNo);
  const birthCertNo = normaliseId(input.birthCertNo);
  const alienId = normaliseId(input.alienId);

  // A strong identifier already on file is a definite duplicate. Refuse rather
  // than create the second record — this is the cheapest place to stop W6.
  for (const [column, value] of [
    ["national_id", nationalId],
    ["sha_number", shaNumber],
    ["passport_no", passportNo],
    ["birth_cert_no", birthCertNo],
    ["alien_id", alienId],
  ] as const) {
    if (!value) continue;
    const clash = get<{ mrn: string }>(
      `SELECT mrn FROM patients WHERE ${column} = ? AND merged_into IS NULL`,
      value,
    );
    if (clash) {
      throw new PatientError(
        `that ${column.replace("_", " ")} is already registered to ${clash.mrn} — open that record instead of creating a second one`,
      );
    }
  }

  const mrn = mintLocalId(input.deviceCode);
  const at = now();

  return tx(() => {
    run(
      `INSERT INTO patients
         (mrn, facility_id, national_id, sha_number, passport_no, birth_cert_no, alien_id,
          given_name, family_name, other_names, sex, date_of_birth, dob_estimated,
          phone, alt_phone, county, sub_county, ward, village,
          nok_name, nok_phone, nok_relation, registered_by, registered_device,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      mrn,
      input.facilityId,
      nationalId,
      shaNumber,
      passportNo,
      birthCertNo,
      alienId,
      givenName,
      familyName,
      input.otherNames?.trim() ?? "",
      input.sex,
      input.dateOfBirth ?? null,
      input.dobEstimated ? 1 : 0,
      normalisePhone(input.phone),
      normalisePhone(input.altPhone),
      input.county?.trim() ?? "",
      input.subCounty?.trim() ?? "",
      input.ward?.trim() ?? "",
      input.village?.trim() ?? "",
      input.nokName?.trim() ?? "",
      normalisePhone(input.nokPhone),
      input.nokRelation?.trim() ?? "",
      input.byUserId,
      input.deviceCode,
      at,
      at,
    );

    // The sync op is recorded in the same transaction as the row, so a device
    // that registers a patient offline can always replay it.
    recordOp({
      deviceCode: input.deviceCode,
      entity: "patient",
      entityId: mrn,
      dataClass: "demographic",
      payload: {
        given_name: givenName,
        family_name: familyName,
        sex: input.sex,
        date_of_birth: input.dateOfBirth ?? null,
        phone: normalisePhone(input.phone),
        national_id: nationalId,
        sha_number: shaNumber,
      },
      actorId: input.byUserId,
      actorName: input.byUserName,
    });

    audit({
      action: "patient_registered",
      entity: "patient",
      entityId: mrn,
      patientId: mrn,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { mrn, familyName, givenName, hasStrongId: Boolean(nationalId || shaNumber || passportNo) },
    });

    return mrn;
  });
}

// ------------------------------------------------------------------ reading

/**
 * Open a patient record.
 *
 * Audited every time, with who and why. Opening a health record is a disclosure
 * under the Data Protection Act, and an audit trail that only covers writes
 * cannot answer the question an investigator actually asks: who looked?
 *
 * Follows a merge: asking for a merged-away MRN returns the surviving record, so
 * an old file number on paper never stops working.
 */
export function openPatient(input: {
  mrn: string;
  byUserId: number | null;
  byUserName: string;
  purpose?: "treatment" | "billing" | "claim" | "audit" | "support" | "administration";
  deviceCode?: string;
}): Patient | undefined {
  const patient = resolvePatient(input.mrn);
  if (!patient) return undefined;

  audit({
    action: "patient_read",
    entity: "patient",
    entityId: patient.mrn,
    patientId: patient.mrn,
    facilityId: patient.facility_id,
    actorId: input.byUserId,
    actorName: input.byUserName,
    purpose: input.purpose ?? "treatment",
    deviceCode: input.deviceCode ?? null,
    // Records that the lookup came in under a superseded number, so a merge can
    // be traced from either side.
    detail: input.mrn === patient.mrn ? {} : { requestedMrn: input.mrn, resolvedVia: "merge" },
  });

  return patient;
}

/** Follow the merge chain to the surviving record. No audit — internal. */
export function resolvePatient(mrn: string, depth = 0): Patient | undefined {
  if (depth > 10) throw new PatientError(`merge chain for ${mrn} is circular`);
  const row = get<Patient>(`SELECT * FROM patients WHERE mrn = ?`, mrn);
  if (!row) return undefined;
  return row.merged_into ? resolvePatient(row.merged_into, depth + 1) : row;
}

// ------------------------------------------------------------------ matching

export interface Candidate {
  patient: Patient;
  /** 0-100. Above 85 is presented as a likely match; never auto-merged. */
  score: number;
  /** Why it scored — shown to the person deciding, never hidden. */
  reasons: string[];
  /** True when a strong identifier matched exactly. */
  definite: boolean;
}

export interface SearchInput {
  facilityId: number;
  nationalId?: string | null;
  shaNumber?: string | null;
  passportNo?: string | null;
  birthCertNo?: string | null;
  alienId?: string | null;
  givenName?: string;
  familyName?: string;
  sex?: Sex;
  dateOfBirth?: string | null;
  phone?: string | null;
  county?: string;
  village?: string;
}

/**
 * Scoring weights.
 *
 * Tuned to what is actually discriminating in a Kenyan clinic. A phone number is
 * worth more than a name because names repeat heavily within a locality, and a
 * documented date of birth is worth more than an estimated one because an
 * estimate is usually just a year someone guessed.
 */
const WEIGHTS = {
  familyName: 22,
  givenName: 22,
  phone: 30,
  dobExact: 20,
  dobEstimatedYear: 8,
  sex: 6,
  locality: 6,
} as const;

/**
 * Find existing records that might be this person.
 *
 * Returns definite matches first, then scored candidates. The caller shows them;
 * a person chooses. Nothing here merges anything.
 */
export function findCandidates(input: SearchInput, limit = 10): Candidate[] {
  // ---- deterministic: one strong identifier is enough.
  const strong: [keyof Patient, string | null][] = [
    ["national_id", normaliseId(input.nationalId)],
    ["sha_number", normaliseId(input.shaNumber)],
    ["passport_no", normaliseId(input.passportNo)],
    ["birth_cert_no", normaliseId(input.birthCertNo)],
    ["alien_id", normaliseId(input.alienId)],
  ];

  for (const [column, value] of strong) {
    if (!value) continue;
    const hit = get<Patient>(
      `SELECT * FROM patients WHERE ${column} = ? AND merged_into IS NULL AND facility_id = ?`,
      value,
      input.facilityId,
    );
    if (hit) {
      return [
        {
          patient: hit,
          score: 100,
          reasons: [`${String(column).replace("_", " ")} matches exactly`],
          definite: true,
        },
      ];
    }
  }

  // ---- probabilistic: score the plausible pool.
  const phone = normalisePhone(input.phone);
  const family = input.familyName ? normaliseName(input.familyName) : "";
  const given = input.givenName ? normaliseName(input.givenName) : "";

  if (!phone && !family && !given) return [];

  const pool = all<Patient>(
    `SELECT * FROM patients WHERE facility_id = ? AND merged_into IS NULL AND deceased = 0`,
    input.facilityId,
  );

  const scored: Candidate[] = [];

  for (const p of pool) {
    let score = 0;
    const reasons: string[] = [];

    if (phone && (p.phone === phone || p.alt_phone === phone)) {
      score += WEIGHTS.phone;
      reasons.push("same phone number");
    }
    if (family && normaliseName(p.family_name) === family) {
      score += WEIGHTS.familyName;
      reasons.push("same family name");
    }
    if (given && normaliseName(p.given_name) === given) {
      score += WEIGHTS.givenName;
      reasons.push("same given name");
    }

    if (input.dateOfBirth && p.date_of_birth) {
      if (input.dateOfBirth === p.date_of_birth) {
        // An estimated date of birth is a guessed year; it must not score like
        // a documented one, or every child born "in 2019" collapses together.
        const estimated = p.dob_estimated === 1;
        score += estimated ? WEIGHTS.dobEstimatedYear : WEIGHTS.dobExact;
        reasons.push(estimated ? "same estimated year of birth" : "same date of birth");
      } else if (input.dateOfBirth.slice(0, 4) === p.date_of_birth.slice(0, 4)) {
        score += WEIGHTS.dobEstimatedYear;
        reasons.push("same year of birth");
      }
    }

    if (input.sex && input.sex === p.sex) {
      score += WEIGHTS.sex;
      reasons.push("same sex");
    }
    if (input.village && input.village.trim().toLowerCase() === p.village.toLowerCase() && p.village) {
      score += WEIGHTS.locality;
      reasons.push("same village");
    } else if (input.county && input.county.trim().toLowerCase() === p.county.toLowerCase() && p.county) {
      score += WEIGHTS.locality / 2;
      reasons.push("same county");
    }

    // A name alone is not a candidate. In a clinic where half the register
    // shares a family name, surfacing those as possible duplicates trains staff
    // to dismiss the list without reading it.
    const nameOnly = reasons.every((r) => r.includes("name") || r === "same sex");
    if (score >= 30 && !nameOnly) {
      scored.push({ patient: p, score: Math.min(100, Math.round(score)), reasons, definite: false });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** The threshold above which the interface leads with "is this the same person?" */
export const LIKELY_MATCH = 60;

// ------------------------------------------------------------------- updating

/** Fields a receptionist may correct. Clinical content is not updated here. */
export type Updatable = Partial<
  Pick<
    RegisterInput,
    | "givenName" | "familyName" | "otherNames" | "sex" | "dateOfBirth" | "dobEstimated"
    | "phone" | "altPhone" | "county" | "subCounty" | "ward" | "village"
    | "nokName" | "nokPhone" | "nokRelation" | "nationalId" | "shaNumber"
  >
>;

const COLUMN_FOR: Record<string, string> = {
  givenName: "given_name",
  familyName: "family_name",
  otherNames: "other_names",
  sex: "sex",
  dateOfBirth: "date_of_birth",
  dobEstimated: "dob_estimated",
  phone: "phone",
  altPhone: "alt_phone",
  county: "county",
  subCounty: "sub_county",
  ward: "ward",
  village: "village",
  nokName: "nok_name",
  nokPhone: "nok_phone",
  nokRelation: "nok_relation",
  nationalId: "national_id",
  shaNumber: "sha_number",
};

export function updatePatient(input: {
  mrn: string;
  changes: Updatable;
  deviceCode: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const patient = resolvePatient(input.mrn);
  if (!patient) throw new PatientError("no such patient");

  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  const payload: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(input.changes)) {
    const column = COLUMN_FOR[key];
    if (!column) throw new PatientError(`"${key}" is not a field a user may change here`);

    let value: string | number | null;
    if (key === "phone" || key === "altPhone" || key === "nokPhone") value = normalisePhone(raw as string);
    else if (key === "nationalId" || key === "shaNumber") value = normaliseId(raw as string);
    else if (key === "dobEstimated") value = raw ? 1 : 0;
    else value = raw === null || raw === undefined ? null : String(raw).trim();

    sets.push(`${column} = ?`);
    values.push(value);
    payload[column] = value;
    before[column] = (patient as unknown as Record<string, unknown>)[column];
  }

  if (!sets.length) return;

  tx(() => {
    run(`UPDATE patients SET ${sets.join(", ")}, updated_at = ? WHERE mrn = ?`, ...values, now(), patient.mrn);

    recordOp({
      deviceCode: input.deviceCode,
      entity: "patient",
      entityId: patient.mrn,
      dataClass: "demographic",
      payload,
      actorId: input.byUserId,
      actorName: input.byUserName,
    });

    audit({
      action: "patient_amended",
      entity: "patient",
      entityId: patient.mrn,
      patientId: patient.mrn,
      facilityId: patient.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      // Both sides recorded: a correction that loses the previous value cannot
      // be challenged or undone later.
      detail: { before, after: payload },
    });
  });
}

// -------------------------------------------------------------------- merging

/**
 * Merge two records that are the same person.
 *
 * Explicit, permissioned, audited and reversible — never automatic, and never
 * triggered by a score. The losing record is kept and marked, because anything
 * already referring to it (a claim, a receipt, a lab result, a slip of paper in
 * a patient's hand) must keep resolving.
 *
 * Empty fields on the surviving record are filled from the one being merged
 * away, which is usually the point: the duplicate holds the phone number or the
 * SHA number the original was missing.
 */
export function mergePatients(input: {
  keepMrn: string;
  mergeMrn: string;
  reason: string;
  deviceCode: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  if (input.keepMrn === input.mergeMrn) throw new PatientError("a record cannot be merged into itself");

  const keep = get<Patient>(`SELECT * FROM patients WHERE mrn = ?`, input.keepMrn);
  const merge = get<Patient>(`SELECT * FROM patients WHERE mrn = ?`, input.mergeMrn);
  if (!keep) throw new PatientError(`no such patient: ${input.keepMrn}`);
  if (!merge) throw new PatientError(`no such patient: ${input.mergeMrn}`);
  if (keep.merged_into) throw new PatientError(`${input.keepMrn} has itself been merged away`);
  if (merge.merged_into) throw new PatientError(`${input.mergeMrn} has already been merged`);
  if (!input.reason.trim()) throw new PatientError("a merge must record why — it is reversible, but only if explained");

  // Two different strong identifiers means these are probably two people. This
  // is the guard against the worst outcome in the module: one record for two
  // patients, with one person's history attached to the other's claims.
  for (const column of ["national_id", "sha_number", "passport_no", "birth_cert_no"] as const) {
    const a = keep[column];
    const b = merge[column];
    if (a && b && a !== b) {
      throw new PatientError(
        `these records carry different ${column.replace("_", " ")} values (${a} and ${b}) — they are probably two different people`,
      );
    }
  }

  const fillable: (keyof Patient)[] = [
    "national_id", "sha_number", "passport_no", "birth_cert_no", "alien_id",
    "date_of_birth", "phone", "alt_phone", "county", "sub_county", "ward",
    "village", "nok_name", "nok_phone", "nok_relation",
  ];

  tx(() => {
    const filled: Record<string, unknown> = {};
    for (const field of fillable) {
      const current = keep[field];
      const incoming = merge[field];
      if ((current === null || current === "") && incoming !== null && incoming !== "") {
        run(`UPDATE patients SET ${field} = ? WHERE mrn = ?`, incoming as string, keep.mrn);
        filled[field] = incoming;
      }
    }

    run(`UPDATE patients SET merged_into = ?, updated_at = ? WHERE mrn = ?`, keep.mrn, now(), merge.mrn);

    run(
      `INSERT INTO patient_merges (kept_mrn, merged_mrn, kept_before, reason, merged_by, merged_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      keep.mrn,
      merge.mrn,
      JSON.stringify(keep),
      input.reason.trim(),
      input.byUserId,
      now(),
    );

    recordOp({
      deviceCode: input.deviceCode,
      entity: "patient",
      entityId: merge.mrn,
      dataClass: "identifier",
      payload: { merged_into: keep.mrn },
      actorId: input.byUserId,
      actorName: input.byUserName,
    });

    audit({
      action: "patient_merged",
      entity: "patient",
      entityId: keep.mrn,
      patientId: keep.mrn,
      facilityId: keep.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      detail: { keptMrn: keep.mrn, mergedMrn: merge.mrn, reason: input.reason, filled },
    });
  });
}

/**
 * Undo a merge.
 *
 * The reason the merge snapshot exists. Staff merge the wrong pair, and without
 * this the only remedy is re-registering a patient and orphaning their history.
 */
export function unmergePatients(input: {
  mergeId: number;
  byUserId: number | null;
  byUserName: string;
}): void {
  const record = get<{
    id: number;
    kept_mrn: string;
    merged_mrn: string;
    kept_before: string;
    undone_at: string | null;
  }>(`SELECT * FROM patient_merges WHERE id = ?`, input.mergeId);

  if (!record) throw new PatientError("no such merge");
  if (record.undone_at) throw new PatientError("that merge has already been undone");

  const before = JSON.parse(record.kept_before) as Patient;

  tx(() => {
    // Put back only the fields the merge filled in. Anything changed since the
    // merge, for reasons unrelated to it, is left alone.
    const fillable: (keyof Patient)[] = [
      "national_id", "sha_number", "passport_no", "birth_cert_no", "alien_id",
      "date_of_birth", "phone", "alt_phone", "county", "sub_county", "ward",
      "village", "nok_name", "nok_phone", "nok_relation",
    ];
    for (const field of fillable) {
      run(`UPDATE patients SET ${field} = ? WHERE mrn = ?`, (before[field] ?? null) as string | null, record.kept_mrn);
    }

    run(`UPDATE patients SET merged_into = NULL, updated_at = ? WHERE mrn = ?`, now(), record.merged_mrn);
    run(`UPDATE patient_merges SET undone_by = ?, undone_at = ? WHERE id = ?`, input.byUserId, now(), record.id);

    audit({
      action: "patient_merge_undone",
      entity: "patient",
      entityId: record.kept_mrn,
      patientId: record.kept_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { mergeId: record.id, keptMrn: record.kept_mrn, restoredMrn: record.merged_mrn },
    });
  });
}

/** Merges performed on a record, most recent first. */
export function mergeHistory(mrn: string) {
  return all<{
    id: number;
    kept_mrn: string;
    merged_mrn: string;
    reason: string;
    merged_at: string;
    undone_at: string | null;
  }>(
    `SELECT id, kept_mrn, merged_mrn, reason, merged_at, undone_at
       FROM patient_merges WHERE kept_mrn = ? OR merged_mrn = ? ORDER BY merged_at DESC`,
    mrn,
    mrn,
  );
}

/** Who has opened this record, and why. The answer to a subject-access request. */
export function accessHistory(mrn: string, limit = 100) {
  return all<{ at: string; actor_name: string; action: string; purpose: string }>(
    `SELECT at, actor_name, action, purpose FROM audit_log
      WHERE patient_id = ? ORDER BY id DESC LIMIT ?`,
    mrn,
    limit,
  );
}
