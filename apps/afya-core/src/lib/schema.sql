-- Afya Core — database schema
--
-- Phase 0 scope: M00 Platform Core, M01 Identity & Access, M02 Audit.
--
-- Design rules (load-bearing — read before changing anything):
--
--  1. NAMED USERS ONLY. There is no shared login and no "reception" account.
--     Every clinical and financial action is attributable to one person, because
--     a claim carries the identity of whoever performed the service and the Data
--     Protection Act treats an unattributable health-record access as a breach.
--
--  2. THE AUDIT LOG IS A HASH CHAIN. `audit_log` is append-only and each row
--     stores the hash of the row before it. Editing or deleting history breaks
--     the chain and `verifyAuditChain()` reports exactly where. This is what
--     makes "immutable audit trail" a fact rather than a promise.
--
--  3. READS ARE AUDITED, NOT JUST WRITES. Health data is *sensitive* personal
--     data. Looking up a patient is itself a disclosure, so it is logged with a
--     purpose-of-use. This is why the audit table has a `patient_id` column in
--     Phase 0, before a patient table exists — the column is the contract.
--
--  4. LICENCE GATES CAPABILITY, ROLE ALONE DOES NOT. A role may grant
--     `prescribe`, but the permission only resolves if the user holds a current
--     practitioner licence. An expired licence silently invalidates claims, so
--     it must switch the capability off, not raise a warning nobody reads.
--
--  5. IDs ARE DEVICE-PREFIXED WHERE THEY ARE ISSUED OFFLINE. A facility keeps
--     working without connectivity, so two devices must never mint the same
--     identifier. See ids.ts — never invent a bare global sequence offline.
--
--  6. TIME IS UTC ISO-8601 TEXT. Stored as `YYYY-MM-DDTHH:MM:SS.sssZ`. Kenya has
--     no DST, but claims carry a 7-day submission clock and audit evidence has to
--     survive a server moving timezone, so everything persists as UTC.

PRAGMA foreign_keys = ON;

-- ============================================================ M00 PLATFORM CORE

-- Tracks which migrations have run. Phase 0 ships one baseline; later phases
-- append. A facility's database is upgraded in place, never recreated — it holds
-- the only copy of records that must be retained for years.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

-- The facility itself. One row for a single clinic; several once a network runs
-- branches off one database (Phase 4). Every identifier a regulator or payer
-- uses to recognise this provider lives here, because a claim, an eTIMS invoice
-- and an MOH return each need a different one.
CREATE TABLE IF NOT EXISTS facilities (
  id                  INTEGER PRIMARY KEY,
  name                TEXT    NOT NULL,
  -- Kenya Master Health Facility List code. MOH returns are rejected without it.
  kmhfl_code          TEXT    NOT NULL UNIQUE,
  -- SHA provider code. Every claim is submitted under it.
  sha_provider_code   TEXT,
  -- KRA PIN. Every eTIMS tax invoice is issued under it.
  kra_pin             TEXT,
  -- Keyed to the MOH facility levels: 2 dispensary/clinic .. 6 national referral.
  level               INTEGER NOT NULL CHECK (level BETWEEN 2 AND 6),
  county              TEXT    NOT NULL DEFAULT '',
  -- Office of the Data Protection Commissioner registration. Certificates run
  -- 24 months; an expired one makes the facility, not just the software,
  -- non-compliant, so the date is tracked and surfaced before it lapses.
  odpc_registration   TEXT,
  odpc_expires_on     TEXT,
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at          TEXT    NOT NULL
);

-- Key/value configuration. Anything an administrator can change without a
-- deployment: tariff version in force, claim-submission reminder days, session
-- timeout. Values are TEXT; callers parse. Changes are audited.
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL
);

-- Every device that may hold facility data offline. Two jobs: it supplies the
-- prefix that keeps offline-minted identifiers unique, and it is the thing an
-- administrator revokes when a tablet is lost — revocation is what makes the
-- local encrypted store safe to have existed at all.
CREATE TABLE IF NOT EXISTS devices (
  id            INTEGER PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  -- Short, unique, human-readable. Becomes the prefix on offline identifiers.
  code          TEXT    NOT NULL UNIQUE,
  label         TEXT    NOT NULL,
  revoked_at    TEXT,
  last_seen_at  TEXT,
  created_at    TEXT    NOT NULL
);

-- =================================================== M01 IDENTITY & ACCESS

-- Clinical cadres, each answering to a different regulator. Held as data rather
-- than an enum because the councils and their titles change, and because a
-- cadre decides which permissions a licence can unlock.
CREATE TABLE IF NOT EXISTS cadres (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- The body that licenses this cadre: KMPDC, NCK, COC, KMLTTB, PPB.
  regulator   TEXT NOT NULL,
  -- 1 when practising under this cadre requires a licence on file.
  licensed    INTEGER NOT NULL DEFAULT 1 CHECK (licensed IN (0, 1))
);

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY,
  facility_id    INTEGER NOT NULL REFERENCES facilities(id),
  name           TEXT    NOT NULL,
  -- Unique per facility. The technical guarantee behind "no shared logins".
  username       TEXT    NOT NULL,
  password_hash  TEXT    NOT NULL,
  cadre_code     TEXT    REFERENCES cadres(code),
  -- Non-clinical staff (cashier, records clerk) have no cadre and no licence.
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  -- Privileged roles must carry a second factor. Enforced in access.ts, stored
  -- here so an administrator can see who is exposed.
  mfa_secret     TEXT,
  must_change_pw INTEGER NOT NULL DEFAULT 0 CHECK (must_change_pw IN (0, 1)),
  last_login_at  TEXT,
  created_at     TEXT    NOT NULL,
  UNIQUE (facility_id, username)
);

-- A practitioner's registration with their council. Expiry is the point of this
-- table: an expired licence invalidates the claims that cite it, so the system
-- stops the capability at the door rather than discovering it at rejection.
CREATE TABLE IF NOT EXISTS practitioner_licences (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  regulator      TEXT    NOT NULL,
  licence_number TEXT    NOT NULL,
  issued_on      TEXT,
  -- ISO date. Compared against the clock on every permission check.
  expires_on     TEXT    NOT NULL,
  created_at     TEXT    NOT NULL,
  UNIQUE (regulator, licence_number)
);
CREATE INDEX IF NOT EXISTS idx_licence_user ON practitioner_licences(user_id);

-- Roles are named bundles of permissions. Seeded with the ward-round reality of
-- a Kenyan facility (receptionist, clinician, pharmacist ...) and editable.
CREATE TABLE IF NOT EXISTS roles (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- A system role cannot be deleted; removing `administrator` would strand the
  -- facility outside its own configuration.
  system      INTEGER NOT NULL DEFAULT 0 CHECK (system IN (0, 1))
);

-- The permission catalogue. `requires_licence` is rule 4 above: these
-- permissions resolve only while the holder's licence is current.
CREATE TABLE IF NOT EXISTS permissions (
  code             TEXT PRIMARY KEY,
  description      TEXT NOT NULL,
  requires_licence INTEGER NOT NULL DEFAULT 0 CHECK (requires_licence IN (0, 1)),
  -- 1 when holding this permission obliges the account to carry a second factor
  -- (finance, controlled drugs, claims, user administration).
  requires_mfa     INTEGER NOT NULL DEFAULT 0 CHECK (requires_mfa IN (0, 1))
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_code       TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code TEXT    NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_code)
);

-- Sessions expire on inactivity: a consulting room screen left open is a
-- disclosure of whoever is on it.
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_code TEXT,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  -- When a second factor was last proved on this session. An MFA-gated action
  -- needs one inside the step-up window, not merely an account that has MFA
  -- enrolled — otherwise enrolment is the whole protection.
  mfa_verified_at TEXT,
  ended_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_user ON sessions(user_id);

-- ============================================================== M02 AUDIT

-- Append-only, hash-chained. Never UPDATE or DELETE a row here; the chain is the
-- evidence. `patient_id` and `purpose` exist so a *read* of a clinical record is
-- as auditable as a change to one.
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT    NOT NULL,
  facility_id  INTEGER REFERENCES facilities(id),
  actor_id     INTEGER REFERENCES users(id),
  -- Denormalised deliberately: the log must stay readable years later even if
  -- the account is renamed or removed from the roster.
  actor_name   TEXT    NOT NULL DEFAULT 'system',
  action       TEXT    NOT NULL,
  entity       TEXT    NOT NULL,
  entity_id    TEXT,
  -- Set whenever the entry concerns an identifiable patient, including reads.
  patient_id   TEXT,
  -- Why the data was touched: treatment, billing, claim, audit, support.
  purpose      TEXT    NOT NULL DEFAULT 'treatment',
  device_code  TEXT,
  -- JSON. Must never carry a secret: no passwords, PINs, tokens or MFA seeds.
  detail       TEXT    NOT NULL DEFAULT '{}',
  -- Hash of the preceding row; '' for the first. Chain rule 2.
  prev_hash    TEXT    NOT NULL,
  hash         TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_patient ON audit_log(patient_id);

-- ============================================================ M03 SYNC ENGINE
--
-- Rule: a device writes locally and never blocks on the network. Every change
-- is recorded here as an immutable operation, then pushed when a link exists.
--
-- Ordering is a Lamport clock, not wall time. Two tablets in a clinic with
-- drifting clocks — one of them set by hand — must still agree on what happened
-- after what, and wall time cannot give that. `at` is kept for display and as a
-- last-resort tie-break only.
--
-- `data_class` decides how a conflict is resolved, because the right answer
-- differs by what the data is:
--
--   clinical     never lose data. Both versions kept, a human reviews.
--   ledger       stock and money. Server authoritative, variance logged.
--   demographic  field-level last-writer-wins, audited.
--   identifier   provisional and canonical both retained, never overwritten.

CREATE TABLE IF NOT EXISTS sync_ops (
  -- Local arrival order. Says nothing about causal order; use lamport.
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Globally unique without coordination: device-prefixed. Also the idempotency
  -- key — a retried push must not apply twice.
  op_id        TEXT    NOT NULL UNIQUE,
  device_code  TEXT    NOT NULL,
  lamport      INTEGER NOT NULL,
  at           TEXT    NOT NULL,
  actor_id     INTEGER REFERENCES users(id),
  actor_name   TEXT    NOT NULL DEFAULT 'system',
  entity       TEXT    NOT NULL,
  entity_id    TEXT    NOT NULL,
  data_class   TEXT    NOT NULL CHECK (data_class IN ('clinical','ledger','demographic','identifier')),
  -- JSON object of changed fields only, never a whole row: a device that was
  -- offline must not clobber fields it never saw.
  payload      TEXT    NOT NULL DEFAULT '{}',
  origin       TEXT    NOT NULL CHECK (origin IN ('local','remote')),
  status       TEXT    NOT NULL CHECK (status IN ('pending','applied','superseded')),
  applied_at   TEXT,
  pushed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_ops_entity ON sync_ops(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_ops_status ON sync_ops(status, origin);
CREATE INDEX IF NOT EXISTS idx_ops_order ON sync_ops(lamport, device_code);

-- This device's Lamport clock, and how far it has read the upstream log.
CREATE TABLE IF NOT EXISTS sync_state (
  device_code     TEXT PRIMARY KEY,
  lamport         INTEGER NOT NULL DEFAULT 0,
  last_pulled_op  TEXT,
  last_synced_at  TEXT
);

-- Conflicts that a person has to look at. A clinical conflict is never resolved
-- silently: two clinicians documented the same encounter from different devices
-- and both versions are real.
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id           INTEGER PRIMARY KEY,
  entity       TEXT    NOT NULL,
  entity_id    TEXT    NOT NULL,
  field        TEXT,
  data_class   TEXT    NOT NULL,
  kept_op_id   TEXT    NOT NULL,
  other_op_id  TEXT    NOT NULL,
  resolution   TEXT    NOT NULL CHECK (resolution IN ('both-kept','server-wins','field-merged')),
  detected_at  TEXT    NOT NULL,
  -- Null until a human has looked. Only clinical conflicts require this.
  reviewed_at  TEXT,
  reviewed_by  INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_conflicts_open ON sync_conflicts(reviewed_at);

-- ================================================ M10 PATIENT REGISTRY & MPI

CREATE TABLE IF NOT EXISTS patients (
  -- The facility's own medical record number, minted on the device that
  -- registered the patient. Carries that device's prefix so two disconnected
  -- tablets cannot issue the same one.
  mrn                TEXT PRIMARY KEY,
  facility_id        INTEGER NOT NULL REFERENCES facilities(id),

  -- Strong identifiers. Any one of these matching is a definite match, so each
  -- is stored normalised (trimmed, upper-cased, punctuation removed).
  national_id        TEXT,
  sha_number         TEXT,
  passport_no        TEXT,
  birth_cert_no      TEXT,
  alien_id           TEXT,

  given_name         TEXT NOT NULL,
  family_name        TEXT NOT NULL,
  other_names        TEXT NOT NULL DEFAULT '',
  -- Kenyan identity documents recognise intersex, so the record must too.
  sex                TEXT NOT NULL CHECK (sex IN ('male','female','intersex')),
  date_of_birth      TEXT,
  -- Many patients do not know their date of birth. Recording an estimate as an
  -- estimate keeps it usable for matching without asserting a fact.
  dob_estimated      INTEGER NOT NULL DEFAULT 0 CHECK (dob_estimated IN (0,1)),

  -- Normalised to 254XXXXXXXXX. The single strongest weak identifier in Kenya.
  phone              TEXT,
  alt_phone          TEXT,

  county             TEXT NOT NULL DEFAULT '',
  sub_county         TEXT NOT NULL DEFAULT '',
  ward               TEXT NOT NULL DEFAULT '',
  village            TEXT NOT NULL DEFAULT '',

  nok_name           TEXT NOT NULL DEFAULT '',
  nok_phone          TEXT,
  nok_relation       TEXT NOT NULL DEFAULT '',

  deceased           INTEGER NOT NULL DEFAULT 0 CHECK (deceased IN (0,1)),
  deceased_date      TEXT,

  -- Set when this record has been merged away into another. The row is never
  -- deleted: anything already pointing at this MRN must keep resolving, and the
  -- merge has to be reversible.
  merged_into        TEXT REFERENCES patients(mrn),

  registered_by      INTEGER REFERENCES users(id),
  registered_device  TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pt_national ON patients(national_id);
CREATE INDEX IF NOT EXISTS idx_pt_sha ON patients(sha_number);
CREATE INDEX IF NOT EXISTS idx_pt_phone ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_pt_name ON patients(family_name, given_name);
CREATE INDEX IF NOT EXISTS idx_pt_merged ON patients(merged_into);

-- A merge is an event, not a state change, so it can be undone. Holds enough to
-- restore the losing record exactly as it was.
CREATE TABLE IF NOT EXISTS patient_merges (
  id           INTEGER PRIMARY KEY,
  kept_mrn     TEXT    NOT NULL REFERENCES patients(mrn),
  merged_mrn   TEXT    NOT NULL REFERENCES patients(mrn),
  -- JSON snapshot of the kept record before the merge, so an unmerge restores
  -- fields the merge filled in.
  kept_before  TEXT    NOT NULL,
  reason       TEXT    NOT NULL DEFAULT '',
  merged_by    INTEGER REFERENCES users(id),
  merged_at    TEXT    NOT NULL,
  undone_by    INTEGER REFERENCES users(id),
  undone_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_merge_kept ON patient_merges(kept_mrn);

-- ========================================================= M21 TERMINOLOGY
--
-- Coded terminology: ICD-11 diagnoses, billable services, product codes.
--
-- Why this is a table and not a constant: a wrong diagnosis code is a named SHA
-- rejection cause. Codes must be loadable from the authority that issues them
-- (the WHO ICD-11 MMS release, the SHA tariff schedule) and must carry their
-- provenance, so a coder can be told where a code came from and when.
--
-- `verified` is deliberately conservative. Only codes checked against the
-- issuing authority are marked 1. An unverified code can be stored but is never
-- offered for a claim, because guessing a code is worse than having none.

CREATE TABLE IF NOT EXISTS terminology (
  system      TEXT    NOT NULL,   -- 'ICD-11-MMS', 'service', 'product'
  code        TEXT    NOT NULL,
  term        TEXT    NOT NULL,
  -- Comma-separated alternatives staff actually type: "URTI", "flu", "homa".
  synonyms    TEXT    NOT NULL DEFAULT '',
  -- Parent code, for a hierarchy that can be walked.
  parent_code TEXT,
  -- 1 when this is a leaf usable on a claim; 0 for chapter and block headings.
  billable    INTEGER NOT NULL DEFAULT 1 CHECK (billable IN (0,1)),
  verified    INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  -- Where it came from, e.g. 'WHO ICD-11 MMS 2026-01' or 'SHA tariff 2026/28'.
  source      TEXT    NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  loaded_at   TEXT    NOT NULL,
  PRIMARY KEY (system, code)
);
CREATE INDEX IF NOT EXISTS idx_term_term ON terminology(system, term);
CREATE INDEX IF NOT EXISTS idx_term_parent ON terminology(system, parent_code);

-- Codes a clinician reaches for constantly. The single biggest lever on the
-- 90-second consultation budget: in a Kenyan outpatient clinic a handful of
-- diagnoses cover most of the day, and making those one tap is the difference
-- between coding at the point of care and coding badly at the billing desk.
CREATE TABLE IF NOT EXISTS terminology_favourites (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  system    TEXT    NOT NULL,
  code      TEXT    NOT NULL,
  uses      INTEGER NOT NULL DEFAULT 0,
  last_used TEXT,
  PRIMARY KEY (user_id, system, code)
);

-- ============================================================ M20 ENCOUNTER

CREATE TABLE IF NOT EXISTS encounters (
  id             TEXT PRIMARY KEY,         -- device-prefixed, minted at the bedside
  facility_id    INTEGER NOT NULL REFERENCES facilities(id),
  patient_mrn    TEXT    NOT NULL REFERENCES patients(mrn),
  kind           TEXT    NOT NULL CHECK (kind IN ('outpatient','inpatient','emergency','anc','followup')),
  status         TEXT    NOT NULL CHECK (status IN ('open','closed','cancelled')),

  clinician_id   INTEGER REFERENCES users(id),
  clinician_name TEXT    NOT NULL,
  cadre_code     TEXT    REFERENCES cadres(code),
  -- The licence PINNED as it stood when care was given. A claim cites the
  -- practitioner's registration at the time of service; if they renew or let it
  -- lapse afterwards, the claim must still show what was true on the day. Never
  -- resolve this by joining to the current licence.
  licence_regulator TEXT,
  licence_number    TEXT,
  licence_expires_on TEXT,

  device_code    TEXT,
  opened_at      TEXT NOT NULL,
  closed_at      TEXT,
  cancelled_reason TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_enc_patient ON encounters(patient_mrn);
CREATE INDEX IF NOT EXISTS idx_enc_status ON encounters(facility_id, status);

-- Append-only. A correction is a NEW version; the previous one is marked
-- superseded and kept. Nothing clinical is ever overwritten or deleted — that is
-- the rule the whole record depends on, and the reason a dispute can be settled.
CREATE TABLE IF NOT EXISTS encounter_notes (
  id            INTEGER PRIMARY KEY,
  encounter_id  TEXT    NOT NULL REFERENCES encounters(id),
  version       INTEGER NOT NULL,
  complaint     TEXT    NOT NULL DEFAULT '',
  history       TEXT    NOT NULL DEFAULT '',
  examination   TEXT    NOT NULL DEFAULT '',
  assessment    TEXT    NOT NULL DEFAULT '',
  plan          TEXT    NOT NULL DEFAULT '',
  author_id     INTEGER REFERENCES users(id),
  author_name   TEXT    NOT NULL,
  written_at    TEXT    NOT NULL,
  -- Null on the current version. Set when a later version replaces it.
  superseded_at TEXT,
  UNIQUE (encounter_id, version)
);
CREATE INDEX IF NOT EXISTS idx_note_current ON encounter_notes(encounter_id, superseded_at);

CREATE TABLE IF NOT EXISTS encounter_diagnoses (
  id           INTEGER PRIMARY KEY,
  encounter_id TEXT    NOT NULL REFERENCES encounters(id),
  system       TEXT    NOT NULL DEFAULT 'ICD-11-MMS',
  code         TEXT    NOT NULL,
  -- The term as it read when chosen. Catalogues get re-released; the claim must
  -- keep showing what the clinician actually picked.
  term         TEXT    NOT NULL,
  -- 1 is the primary diagnosis. A claim needs exactly one.
  rank         INTEGER NOT NULL DEFAULT 1,
  certainty    TEXT    NOT NULL DEFAULT 'confirmed' CHECK (certainty IN ('confirmed','suspected')),
  added_by     INTEGER REFERENCES users(id),
  added_at     TEXT    NOT NULL,
  -- Removal is a mark, never a delete.
  removed_at   TEXT,
  removed_by   INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_dx_encounter ON encounter_diagnoses(encounter_id, removed_at);

-- ========================================================= M23 PRESCRIBING
--
-- Only PPB-registered products may be dispensed, so the catalogue is keyed to
-- the registration rather than to a name someone typed. Names repeat across
-- manufacturers; a registration number does not.
--
-- `controlled` drives a separate register and a second signature at dispensing.

CREATE TABLE IF NOT EXISTS products (
  code             TEXT PRIMARY KEY,
  name             TEXT    NOT NULL,          -- as it appears on the pack
  generic_name     TEXT    NOT NULL,          -- what an allergy is actually to
  form             TEXT    NOT NULL DEFAULT '', -- tablet, suspension, injection
  strength         TEXT    NOT NULL DEFAULT '',
  -- Pharmacy and Poisons Board registration. Without it the product must not be
  -- dispensed, whatever is sitting on the shelf.
  ppb_registration TEXT,
  controlled       INTEGER NOT NULL DEFAULT 0 CHECK (controlled IN (0,1)),
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  source           TEXT    NOT NULL DEFAULT '',
  loaded_at        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prod_generic ON products(generic_name);

-- Allergies belong to the patient, not the visit: they must be visible at every
-- encounter, forever, by whoever is prescribing.
CREATE TABLE IF NOT EXISTS allergies (
  id           INTEGER PRIMARY KEY,
  patient_mrn  TEXT    NOT NULL REFERENCES patients(mrn),
  -- Recorded as a generic substance so it matches across brands.
  substance    TEXT    NOT NULL,
  reaction     TEXT    NOT NULL DEFAULT '',
  severity     TEXT    NOT NULL CHECK (severity IN ('mild','severe','anaphylaxis')),
  recorded_by  INTEGER REFERENCES users(id),
  recorded_at  TEXT    NOT NULL,
  -- Marked, never deleted: a retracted allergy is still clinically relevant.
  removed_at   TEXT,
  removed_by   INTEGER REFERENCES users(id),
  removed_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_allergy_patient ON allergies(patient_mrn, removed_at);

CREATE TABLE IF NOT EXISTS prescriptions (
  id                TEXT PRIMARY KEY,          -- device-prefixed
  encounter_id      TEXT    NOT NULL REFERENCES encounters(id),
  patient_mrn       TEXT    NOT NULL REFERENCES patients(mrn),

  product_code      TEXT    NOT NULL REFERENCES products(code),
  -- Pinned as it read when prescribed. Catalogues get re-released and a
  -- dispensing error is argued over the words on the prescription.
  product_name      TEXT    NOT NULL,
  generic_name      TEXT    NOT NULL,

  dose              TEXT    NOT NULL,
  route             TEXT    NOT NULL DEFAULT 'oral',
  frequency         TEXT    NOT NULL,
  duration_days     INTEGER,
  quantity          INTEGER NOT NULL,
  instructions      TEXT    NOT NULL DEFAULT '',

  prescriber_id     INTEGER REFERENCES users(id),
  prescriber_name   TEXT    NOT NULL,
  -- Pinned like the encounter's: a claim cites the prescriber's registration as
  -- it stood on the day.
  prescriber_licence TEXT,

  -- Recorded when the prescriber knowingly overrode a warning. This is the
  -- entry a coroner or a claims auditor asks for.
  override_reason   TEXT,

  status            TEXT    NOT NULL CHECK (status IN ('active','dispensed','cancelled')),
  cancelled_reason  TEXT,
  device_code       TEXT,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rx_encounter ON prescriptions(encounter_id);
CREATE INDEX IF NOT EXISTS idx_rx_patient ON prescriptions(patient_mrn, status);

-- ================================================== M53 PAYER & COVERAGE
--
-- MONEY IS INTEGER CENTS OF KES. Never a float, `_cents` suffix always.
-- A rounding error in a tariff becomes a rejected claim line.

CREATE TABLE IF NOT EXISTS payers (
  code                 TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  kind                 TEXT NOT NULL CHECK (kind IN ('cash','sha','private','corporate')),
  -- SHA's rule: a claim submitted beyond this many days is rejected outright.
  claim_window_days    INTEGER NOT NULL DEFAULT 7,
  -- Services above this need pre-authorisation. 0 means "never by amount".
  preauth_above_cents  INTEGER NOT NULL DEFAULT 0,
  active               INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at           TEXT NOT NULL
);

-- A patient's cover with a payer. `verification_source` is the honest part: a
-- result obtained while the payer was unreachable is marked provisional, not
-- passed off as a verification.
CREATE TABLE IF NOT EXISTS coverages (
  id                  INTEGER PRIMARY KEY,
  patient_mrn         TEXT NOT NULL REFERENCES patients(mrn),
  payer_code          TEXT NOT NULL REFERENCES payers(code),
  member_number       TEXT NOT NULL,
  scheme_name         TEXT NOT NULL DEFAULT '',
  -- The principal member, when this patient is a dependant.
  principal_mrn       TEXT REFERENCES patients(mrn),
  valid_from          TEXT,
  valid_to            TEXT,
  status              TEXT NOT NULL CHECK (status IN ('active','inactive','unknown')),
  verified_at         TEXT,
  verification_source TEXT CHECK (verification_source IN ('online','cached','provisional','emergency')),
  created_at          TEXT NOT NULL,
  UNIQUE (patient_mrn, payer_code, member_number)
);
CREATE INDEX IF NOT EXISTS idx_cov_patient ON coverages(patient_mrn, status);

-- What a payer covers. Absence is not permission: a service with no rule is
-- treated as uncovered, because guessing costs a rejection.
CREATE TABLE IF NOT EXISTS benefit_rules (
  id              INTEGER PRIMARY KEY,
  payer_code      TEXT NOT NULL REFERENCES payers(code),
  service_code    TEXT NOT NULL,
  covered         INTEGER NOT NULL DEFAULT 1 CHECK (covered IN (0,1)),
  requires_preauth INTEGER NOT NULL DEFAULT 0 CHECK (requires_preauth IN (0,1)),
  limit_cents     INTEGER,
  -- Document kinds the payer requires before it will pay for this service,
  -- comma-separated (e.g. 'lab_report,preauth_letter'). "Missing documentation"
  -- is a named SHA rejection cause, so the rule that prevents it lives with the
  -- benefit it applies to rather than in code.
  required_documents TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT '',
  UNIQUE (payer_code, service_code)
);

-- Verification attempts that could not reach the payer. The March 2026 SHA
-- outage is the reason this exists: care continues, the request is queued, and
-- the claim carries an honest provisional flag until it resolves.
CREATE TABLE IF NOT EXISTS verification_queue (
  id            INTEGER PRIMARY KEY,
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  payer_code    TEXT NOT NULL REFERENCES payers(code),
  member_number TEXT NOT NULL,
  queued_at     TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL CHECK (status IN ('queued','resolved','failed')),
  last_error    TEXT,
  resolved_at   TEXT
);

-- ==================================================== M54 PRE-AUTHORISATION

CREATE TABLE IF NOT EXISTS preauths (
  id                   TEXT PRIMARY KEY,
  encounter_id         TEXT REFERENCES encounters(id),
  patient_mrn          TEXT NOT NULL REFERENCES patients(mrn),
  payer_code           TEXT NOT NULL REFERENCES payers(code),
  -- JSON array of service codes this authorisation covers.
  service_codes        TEXT NOT NULL DEFAULT '[]',
  clinical_summary     TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL CHECK (status IN ('draft','requested','approved','declined','expired')),
  -- The payer's reference. A claim cites it; without it the claim is rejected.
  reference            TEXT,
  approved_amount_cents INTEGER,
  valid_until          TEXT,
  decline_reason       TEXT,
  requested_by         INTEGER REFERENCES users(id),
  requested_at         TEXT,
  decided_at           TEXT,
  created_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_preauth_enc ON preauths(encounter_id, status);

-- ======================================================== M50 BILLING

CREATE TABLE IF NOT EXISTS services (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'general',
  -- eTIMS item classification. Every billable line needs one.
  etims_class TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

-- Priced per payer, and dated. A tariff that changed last month must not
-- silently reprice a claim for care given before it.
CREATE TABLE IF NOT EXISTS tariffs (
  id             INTEGER PRIMARY KEY,
  payer_code     TEXT NOT NULL REFERENCES payers(code),
  service_code   TEXT NOT NULL REFERENCES services(code),
  price_cents    INTEGER NOT NULL CHECK (price_cents >= 0),
  effective_from TEXT NOT NULL,
  effective_to   TEXT,
  source         TEXT NOT NULL DEFAULT '',
  UNIQUE (payer_code, service_code, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_tariff_lookup ON tariffs(payer_code, service_code, effective_from);

-- One charge line. `source_kind`/`source_ref` are the spine: a charge always
-- points back at the clinical event that produced it, so a bill can be defended
-- line by line and revenue leakage becomes visible.
CREATE TABLE IF NOT EXISTS charges (
  id               TEXT PRIMARY KEY,
  encounter_id     TEXT NOT NULL REFERENCES encounters(id),
  patient_mrn      TEXT NOT NULL REFERENCES patients(mrn),
  service_code     TEXT NOT NULL REFERENCES services(code),
  description      TEXT NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  amount_cents     INTEGER NOT NULL CHECK (amount_cents >= 0),
  payer_code       TEXT NOT NULL REFERENCES payers(code),
  source_kind      TEXT NOT NULL CHECK (source_kind IN ('consultation','prescription','procedure','lab','imaging','other')),
  source_ref       TEXT,
  tariff_source    TEXT NOT NULL DEFAULT '',
  created_by       INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL,
  voided_at        TEXT,
  voided_by        INTEGER REFERENCES users(id),
  void_reason      TEXT
);
CREATE INDEX IF NOT EXISTS idx_charge_enc ON charges(encounter_id, voided_at);

CREATE TABLE IF NOT EXISTS invoices (
  id             TEXT PRIMARY KEY,
  encounter_id   TEXT NOT NULL REFERENCES encounters(id),
  patient_mrn    TEXT NOT NULL REFERENCES patients(mrn),
  payer_code     TEXT NOT NULL REFERENCES payers(code),
  total_cents    INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('issued','paid','void')),
  issued_at      TEXT NOT NULL,
  issued_by      INTEGER REFERENCES users(id),
  -- The KRA number, assigned on transmission. The provisional id above is what
  -- the patient was handed; both are kept, forever.
  etims_number   TEXT,
  etims_status   TEXT NOT NULL DEFAULT 'queued' CHECK (etims_status IN ('queued','sent','failed','not_required')),
  void_reason    TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_enc ON invoices(encounter_id);

CREATE TABLE IF NOT EXISTS payments (
  id           TEXT PRIMARY KEY,
  invoice_id   TEXT NOT NULL REFERENCES invoices(id),
  method       TEXT NOT NULL CHECK (method IN ('cash','mpesa','card','cheque','insurance','waiver')),
  -- Negative for a refund. Never zero.
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
  reference    TEXT NOT NULL DEFAULT '',
  -- A refund is a NEGATIVE payment pointing at the one it reverses. Same
  -- ledger, so the two can never be added up wrongly, and the refund carries
  -- the reason it was given.
  refund_of    TEXT REFERENCES payments(id),
  reason       TEXT NOT NULL DEFAULT '',
  received_by  INTEGER REFERENCES users(id),
  received_at  TEXT NOT NULL,
  voided_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_payment_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pay_invoice ON payments(invoice_id);

-- ========================================================== M52 eTIMS
--
-- Hospitals must onboard to eTIMS even though medical services are VAT-exempt,
-- and every encounter must end in a KRA-compliant invoice. The queue is what
-- makes that survivable offline: the invoice is issued locally and transmitted
-- when a link exists, and the two numbers are reconciled, never conflated.

CREATE TABLE IF NOT EXISTS etims_queue (
  id                INTEGER PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES invoices(id),
  kind              TEXT NOT NULL CHECK (kind IN ('invoice','credit_note')),
  payload           TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('queued','sent','failed')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  canonical_number  TEXT,
  queued_at         TEXT NOT NULL,
  sent_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_etims_status ON etims_queue(status);

-- ==================================================== M55 CLAIMS ENGINE

CREATE TABLE IF NOT EXISTS claims (
  id             TEXT PRIMARY KEY,
  encounter_id   TEXT NOT NULL REFERENCES encounters(id),
  patient_mrn    TEXT NOT NULL REFERENCES patients(mrn),
  payer_code     TEXT NOT NULL REFERENCES payers(code),
  invoice_id     TEXT REFERENCES invoices(id),
  -- The date of service. The submission clock runs from here, not from when
  -- somebody got round to assembling the claim.
  service_date   TEXT NOT NULL,
  total_cents    INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL CHECK (status IN ('draft','ready','submitted','accepted','rejected','paid','abandoned')),
  -- The scrubber's last verdict, as JSON. Kept so a rejection can be compared
  -- against what we believed at submission.
  scrub_verdict  TEXT NOT NULL DEFAULT '{}',
  reference      TEXT,
  submitted_at   TEXT,
  decided_at     TEXT,
  rejection_code TEXT,
  rejection_reason TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claim_status ON claims(status, service_date);

CREATE TABLE IF NOT EXISTS claim_items (
  id             INTEGER PRIMARY KEY,
  claim_id       TEXT NOT NULL REFERENCES claims(id),
  charge_id      TEXT REFERENCES charges(id),
  service_code   TEXT NOT NULL,
  description    TEXT NOT NULL,
  quantity       INTEGER NOT NULL,
  amount_cents   INTEGER NOT NULL,
  diagnosis_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_citem_claim ON claim_items(claim_id);

-- Append-only history: assembled, scrubbed, submitted, rejected, resubmitted.
-- This is what the claims dashboard reads to compute acceptance rate and
-- days-to-payment, and what turns "20% rejected" into a ranked list of causes.
CREATE TABLE IF NOT EXISTS claim_events (
  id        INTEGER PRIMARY KEY,
  claim_id  TEXT NOT NULL REFERENCES claims(id),
  at        TEXT NOT NULL,
  kind      TEXT NOT NULL,
  actor_id  INTEGER REFERENCES users(id),
  actor_name TEXT NOT NULL DEFAULT 'system',
  detail    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_cevent_claim ON claim_events(claim_id, at);

-- ============================================================ M11 CONSENT

CREATE TABLE IF NOT EXISTS consents (
  id           INTEGER PRIMARY KEY,
  patient_mrn  TEXT NOT NULL REFERENCES patients(mrn),
  -- What was consented to. Granular, because consent to treatment is not
  -- consent to share a record with an employer.
  purpose      TEXT NOT NULL CHECK (purpose IN ('treatment','billing','claim','research','data_sharing')),
  -- The wording shown, versioned. Consent to text that has since changed is not
  -- consent to the new text.
  version      TEXT NOT NULL,
  granted      INTEGER NOT NULL CHECK (granted IN (0,1)),
  given_by     TEXT NOT NULL DEFAULT 'patient',
  recorded_by  INTEGER REFERENCES users(id),
  recorded_at  TEXT NOT NULL,
  withdrawn_at TEXT,
  withdrawn_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_consent_patient ON consents(patient_mrn, purpose);

-- ==================================================== M14 QUEUE & TRIAGE

CREATE TABLE IF NOT EXISTS visits (
  id            TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  -- Kenyan triage practice: emergency first, then urgent, then routine.
  priority      TEXT NOT NULL CHECK (priority IN ('emergency','urgent','routine')),
  state         TEXT NOT NULL CHECK (state IN ('waiting','in_triage','in_consultation','done','left')),
  department    TEXT NOT NULL DEFAULT 'outpatient',
  token         TEXT NOT NULL,
  encounter_id  TEXT REFERENCES encounters(id),
  checked_in_at TEXT NOT NULL,
  triaged_at    TEXT,
  seen_at       TEXT,
  done_at       TEXT,
  device_code   TEXT
);
CREATE INDEX IF NOT EXISTS idx_visit_queue ON visits(facility_id, state);

CREATE TABLE IF NOT EXISTS vitals (
  id           INTEGER PRIMARY KEY,
  visit_id     TEXT NOT NULL REFERENCES visits(id),
  patient_mrn  TEXT NOT NULL REFERENCES patients(mrn),
  -- Integers in fixed units, never floats: temp in tenths of a degree C,
  -- weight in grams, height in mm, BP in mmHg.
  temp_tenths_c   INTEGER,
  weight_grams    INTEGER,
  height_mm       INTEGER,
  systolic_mmhg   INTEGER,
  diastolic_mmhg  INTEGER,
  pulse_bpm       INTEGER,
  resp_rate       INTEGER,
  spo2_percent    INTEGER,
  recorded_by  INTEGER REFERENCES users(id),
  recorded_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vitals_visit ON vitals(visit_id);

-- ==================================================== M04 INTEGRATION HUB
--
-- Every external system sits behind one contract: queue → transform → transmit
-- → confirm → reconcile. No domain module calls SHA or KRA directly, so when a
-- specification changes exactly one adapter changes.
--
-- `mode` is the honest part. 'demo' runs a deterministic in-process simulator
-- so the whole flow can be shown end to end; 'live' uses the real adapter once
-- the specification is in hand; 'disabled' queues everything and says so. The
-- mode is displayed wherever its results are, so nobody mistakes a simulated
-- acknowledgement for a real one.

CREATE TABLE IF NOT EXISTS integration_endpoints (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('payer','tax','hie','sms','dhis2','money')),
  mode       TEXT NOT NULL CHECK (mode IN ('demo','live','disabled')),
  base_url   TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- Append-only record of every call out of the building. This is the evidence
-- when a payer says "we never received it".
CREATE TABLE IF NOT EXISTS integration_log (
  id          INTEGER PRIMARY KEY,
  endpoint    TEXT NOT NULL,
  operation   TEXT NOT NULL,
  mode        TEXT NOT NULL,
  request     TEXT NOT NULL DEFAULT '{}',
  response    TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL CHECK (status IN ('ok','failed')),
  attempts    INTEGER NOT NULL DEFAULT 1,
  error       TEXT,
  at          TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_intlog_at ON integration_log(endpoint, at);

-- Calls that failed every retry. A dead letter is never silently dropped: it
-- sits here until a person deals with it.
CREATE TABLE IF NOT EXISTS integration_dead_letters (
  id         INTEGER PRIMARY KEY,
  endpoint   TEXT NOT NULL,
  operation  TEXT NOT NULL,
  request    TEXT NOT NULL,
  last_error TEXT NOT NULL,
  attempts   INTEGER NOT NULL,
  queued_at  TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id)
);

-- ==================================================== M05 NOTIFICATIONS

-- Things a person has to know about. Deliberately a queue with an owner rather
-- than a broadcast: "someone should look at this" is how nothing gets looked at.
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY,
  facility_id INTEGER NOT NULL REFERENCES facilities(id),
  -- The role that can act on it, so it lands on the right desk.
  owner_role  TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  kind        TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  -- What it is about, so the interface can link straight to it.
  entity      TEXT,
  entity_id   TEXT,
  -- Set so a repeating condition updates one notification instead of making a
  -- new one every time the job runs.
  dedupe_key  TEXT UNIQUE,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  acted_at    TEXT,
  acted_by    INTEGER REFERENCES users(id),
  dismissed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_open ON notifications(facility_id, acted_at, severity);

-- ==================================================== M06 DOCUMENT STORE

-- Attachments: lab reports, referral letters, signed consent, scanned IDs.
-- Content is stored as a base64 payload in the facility database so the file
-- travels with the record and survives being copied to a stick — a separate
-- blob store is another thing to back up, secure and explain to an auditor.
CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  facility_id  INTEGER NOT NULL REFERENCES facilities(id),
  -- What it is attached to: encounter, claim, patient, preauth.
  entity       TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  patient_mrn  TEXT REFERENCES patients(mrn),
  kind         TEXT NOT NULL,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  -- SHA-256 of the content, so tampering with a stored file is detectable.
  sha256       TEXT NOT NULL,
  content_b64  TEXT NOT NULL,
  uploaded_by  INTEGER REFERENCES users(id),
  uploaded_at  TEXT NOT NULL,
  removed_at   TEXT,
  removed_by   INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_doc_entity ON documents(entity, entity_id, removed_at);

-- A signature is a person putting their name to something, with their licence
-- as it stood at that moment. Kept separate from documents because it is an
-- assertion, not a file.
CREATE TABLE IF NOT EXISTS signatures (
  id            INTEGER PRIMARY KEY,
  entity        TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  purpose       TEXT NOT NULL,
  signed_by     INTEGER NOT NULL REFERENCES users(id),
  signer_name   TEXT NOT NULL,
  licence_regulator TEXT,
  licence_number    TEXT,
  -- Digest of what was signed, so a later edit cannot hide behind the signature.
  content_sha256 TEXT NOT NULL,
  signed_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sig_entity ON signatures(entity, entity_id);

-- ==================================================== M41 INVENTORY & STORES

-- Where stock physically sits. A clinic has a main store and a dispensing
-- point; a hospital has ward stores and a theatre store too. Stock is always
-- in a named place, because "we have 400 tablets somewhere" is not an answer
-- a pharmacist can act on.
CREATE TABLE IF NOT EXISTS stores (
  code        TEXT PRIMARY KEY,
  facility_id INTEGER NOT NULL REFERENCES facilities(id),
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('main','pharmacy','ward','theatre','lab')),
  -- Only a dispensing point may hand medicine to a patient.
  dispensing  INTEGER NOT NULL DEFAULT 0 CHECK (dispensing IN (0,1)),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TEXT NOT NULL
);

-- Stock is held per BATCH, never as a single number per product. A recall names
-- a batch, an expiry belongs to a batch, and a pharmacist asked which batch a
-- patient received must be able to answer.
CREATE TABLE IF NOT EXISTS stock_batches (
  id            TEXT PRIMARY KEY,
  store_code    TEXT NOT NULL REFERENCES stores(code),
  product_code  TEXT NOT NULL REFERENCES products(code),
  batch_number  TEXT NOT NULL,
  expires_on    TEXT NOT NULL,
  -- Running balance, maintained only by stock_movements. Never set directly.
  quantity      INTEGER NOT NULL DEFAULT 0,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  -- A quarantined batch is on the shelf but must not be issued: recalled,
  -- damaged, or awaiting a pharmacist's decision.
  quarantined   INTEGER NOT NULL DEFAULT 0 CHECK (quarantined IN (0,1)),
  quarantine_reason TEXT,
  received_at   TEXT NOT NULL,
  UNIQUE (store_code, product_code, batch_number)
);
CREATE INDEX IF NOT EXISTS idx_batch_pick ON stock_batches(store_code, product_code, expires_on);

-- The ledger. Append-only: a correction is another movement, never an edit, so
-- the sum of movements always equals what is on the shelf and a discrepancy has
-- a history rather than a mystery.
CREATE TABLE IF NOT EXISTS stock_movements (
  id           INTEGER PRIMARY KEY,
  batch_id     TEXT NOT NULL REFERENCES stock_batches(id),
  store_code   TEXT NOT NULL REFERENCES stores(code),
  product_code TEXT NOT NULL REFERENCES products(code),
  kind         TEXT NOT NULL CHECK (kind IN
                 ('receipt','issue','dispense','return','adjustment','write_off','transfer_in','transfer_out')),
  -- Signed: positive adds to the shelf, negative takes off it.
  quantity     INTEGER NOT NULL,
  -- Balance after this movement, so a stock card can be read without replaying.
  balance_after INTEGER NOT NULL,
  -- What caused it: a prescription id, a requisition id, a stock take id.
  reference    TEXT,
  reason       TEXT NOT NULL DEFAULT '',
  patient_mrn  TEXT REFERENCES patients(mrn),
  by_user_id   INTEGER REFERENCES users(id),
  by_user_name TEXT NOT NULL,
  at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_move_batch ON stock_movements(batch_id, at);
CREATE INDEX IF NOT EXISTS idx_move_product ON stock_movements(store_code, product_code, at);

-- When to reorder, per store. Absent means nobody has decided, which the
-- reorder report says rather than assuming zero.
CREATE TABLE IF NOT EXISTS reorder_levels (
  store_code   TEXT NOT NULL REFERENCES stores(code),
  product_code TEXT NOT NULL REFERENCES products(code),
  reorder_at   INTEGER NOT NULL,
  reorder_to   INTEGER NOT NULL,
  set_at       TEXT NOT NULL,
  PRIMARY KEY (store_code, product_code)
);

-- ==================================================== M40 PHARMACY DISPENSING

-- One dispensing event. A prescription may be dispensed in parts (the pharmacy
-- had 20 of 30), so this is a separate row from the prescription and the
-- prescription's status follows the sum of these.
CREATE TABLE IF NOT EXISTS dispenses (
  id              TEXT PRIMARY KEY,
  prescription_id TEXT NOT NULL REFERENCES prescriptions(id),
  patient_mrn     TEXT NOT NULL REFERENCES patients(mrn),
  encounter_id    TEXT NOT NULL REFERENCES encounters(id),
  store_code      TEXT NOT NULL REFERENCES stores(code),
  -- What actually left the shelf. Differs from the prescribed product when a
  -- generic was substituted, and that difference is the point of the column.
  product_code    TEXT NOT NULL REFERENCES products(code),
  quantity        INTEGER NOT NULL,
  -- Required when the dispensed product is not the prescribed one.
  substitution_reason TEXT,
  counselling     TEXT NOT NULL DEFAULT '',
  dispensed_by    INTEGER REFERENCES users(id),
  dispenser_name  TEXT NOT NULL,
  dispenser_licence TEXT,
  device_code     TEXT,
  dispensed_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dispense_rx ON dispenses(prescription_id);

-- Which batches went into one dispensing event. A patient asking "what did I
-- take" and a recall asking "who got this batch" are the same query.
CREATE TABLE IF NOT EXISTS dispense_batches (
  dispense_id TEXT NOT NULL REFERENCES dispenses(id),
  batch_id    TEXT NOT NULL REFERENCES stock_batches(id),
  quantity    INTEGER NOT NULL,
  PRIMARY KEY (dispense_id, batch_id)
);

-- ==================================================== M22 ORDERS (CPOE)

-- A request from a clinician for something to be done and reported back. The
-- loop this table exists to close is: ordered → collected → resulted →
-- ACKNOWLEDGED. A result nobody read is the failure mode that kills people, and
-- it is invisible unless acknowledgement is a recorded state.
CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY,
  encounter_id     TEXT NOT NULL REFERENCES encounters(id),
  patient_mrn      TEXT NOT NULL REFERENCES patients(mrn),
  kind             TEXT NOT NULL CHECK (kind IN ('lab','imaging','procedure')),
  service_code     TEXT NOT NULL REFERENCES services(code),
  service_name     TEXT NOT NULL,
  priority         TEXT NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine','urgent','stat')),
  -- What the clinician is actually asking. A lab asked "FBC" cannot tell it
  -- matters; asked "rule out sepsis" it can.
  clinical_question TEXT NOT NULL DEFAULT '',
  ordered_by       INTEGER REFERENCES users(id),
  orderer_name     TEXT NOT NULL,
  -- Pinned like the encounter's: a claim cites the ordering licence.
  orderer_licence  TEXT,
  status           TEXT NOT NULL CHECK (status IN
                     ('ordered','collected','in_progress','resulted','acknowledged','cancelled')),
  cancelled_reason TEXT,
  device_code      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  resulted_at      TEXT,
  acknowledged_at  TEXT,
  acknowledged_by  INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_order_encounter ON orders(encounter_id);
CREATE INDEX IF NOT EXISTS idx_order_status ON orders(status, created_at);

-- ==================================================== M30 LABORATORY (LIS)

-- What was collected, when, and by whom. A specimen can be rejected before any
-- analysis happens — haemolysed, wrong tube, unlabelled — and saying so is the
-- point: a re-bleed today beats a wrong result tomorrow.
CREATE TABLE IF NOT EXISTS specimens (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  kind          TEXT NOT NULL,
  collected_by  INTEGER REFERENCES users(id),
  collector_name TEXT NOT NULL,
  collected_at  TEXT NOT NULL,
  received_at   TEXT,
  rejected_at   TEXT,
  rejection_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_specimen_order ON specimens(order_id);

-- What a result should look like for this kind of person. Held as data rather
-- than in code because ranges differ by sex, by age, and by the analyser the
-- facility actually runs.
CREATE TABLE IF NOT EXISTS reference_ranges (
  id          INTEGER PRIMARY KEY,
  analyte     TEXT NOT NULL,
  unit        TEXT NOT NULL,
  -- '' means any. Ranges are matched most-specific-first.
  sex         TEXT NOT NULL DEFAULT '',
  min_age_years INTEGER NOT NULL DEFAULT 0,
  max_age_years INTEGER NOT NULL DEFAULT 200,
  -- Stored in THOUSANDTHS of the unit, as integers: 11.2 g/dL is 11200. Binary
  -- floating point has no business anywhere near a clinical decision.
  low_milli   INTEGER,
  high_milli  INTEGER,
  -- Outside these, somebody must be telephoned. Not a formatting decision.
  panic_low_milli  INTEGER,
  panic_high_milli INTEGER,
  source      TEXT NOT NULL DEFAULT '',
  UNIQUE (analyte, sex, min_age_years, max_age_years)
);

-- One measured value. Append-only in the same way notes are: a corrected result
-- supersedes its predecessor and both stay readable, because somebody acted on
-- the first one.
CREATE TABLE IF NOT EXISTS lab_results (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders(id),
  patient_mrn  TEXT NOT NULL REFERENCES patients(mrn),
  analyte      TEXT NOT NULL,
  -- Numeric results in thousandths; qualitative ones ('positive') in value_text.
  value_milli  INTEGER,
  value_text   TEXT NOT NULL DEFAULT '',
  unit         TEXT NOT NULL DEFAULT '',
  low_milli    INTEGER,
  high_milli   INTEGER,
  flag         TEXT NOT NULL DEFAULT 'normal'
                 CHECK (flag IN ('normal','low','high','panic_low','panic_high','abnormal')),
  status       TEXT NOT NULL CHECK (status IN ('preliminary','final','corrected','superseded')),
  entered_by   INTEGER REFERENCES users(id),
  entered_by_name TEXT NOT NULL,
  -- Only a licensed technologist releases a result. Until then it is not a
  -- result, it is a reading.
  released_by  INTEGER REFERENCES users(id),
  releaser_name TEXT,
  releaser_licence TEXT,
  released_at  TEXT,
  supersedes   TEXT REFERENCES lab_results(id),
  superseded_at TEXT,
  correction_reason TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_result_order ON lab_results(order_id, superseded_at);
CREATE INDEX IF NOT EXISTS idx_result_patient ON lab_results(patient_mrn, created_at);

-- ==================================================== M13 SCHEDULING

-- A bookable period of somebody's time. Slots are generated from a pattern and
-- then booked individually, so a clinician cancelling one morning does not
-- require unpicking a recurrence rule at the moment a patient is on the phone.
CREATE TABLE IF NOT EXISTS slots (
  id           TEXT PRIMARY KEY,
  facility_id  INTEGER NOT NULL REFERENCES facilities(id),
  provider_id  INTEGER NOT NULL REFERENCES users(id),
  department   TEXT NOT NULL DEFAULT 'outpatient',
  -- Local clinic date and time, not UTC: a clinic runs on the wall clock, and
  -- a 9 a.m. slot must stay 9 a.m. whatever the server thinks.
  slot_date    TEXT NOT NULL,
  start_time   TEXT NOT NULL,
  minutes      INTEGER NOT NULL DEFAULT 15,
  -- More than one for a group session or an over-booked clinic.
  capacity     INTEGER NOT NULL DEFAULT 1,
  blocked      INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0,1)),
  block_reason TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (provider_id, slot_date, start_time)
);
CREATE INDEX IF NOT EXISTS idx_slot_day ON slots(facility_id, slot_date, start_time);

CREATE TABLE IF NOT EXISTS appointments (
  id           TEXT PRIMARY KEY,
  slot_id      TEXT NOT NULL REFERENCES slots(id),
  patient_mrn  TEXT NOT NULL REFERENCES patients(mrn),
  reason       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL CHECK (status IN ('booked','arrived','completed','cancelled','did_not_attend')),
  -- The visit it turned into, so "booked" and "actually seen" can be compared.
  visit_id     TEXT REFERENCES visits(id),
  booked_by    INTEGER REFERENCES users(id),
  booker_name  TEXT NOT NULL,
  cancelled_reason TEXT,
  reminded_at  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appt_slot ON appointments(slot_id, status);
CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_mrn, status);

-- ==================================================== M24 INPATIENT & WARD

CREATE TABLE IF NOT EXISTS wards (
  code        TEXT PRIMARY KEY,
  facility_id INTEGER NOT NULL REFERENCES facilities(id),
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('general','maternity','paediatric','isolation','hdu')),
  -- Which sex the ward admits, '' for mixed. A bed a patient cannot occupy is
  -- not an empty bed, and a bed board that pretends otherwise sends a porter
  -- up three floors for nothing.
  admits_sex  TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS beds (
  code        TEXT PRIMARY KEY,
  ward_code   TEXT NOT NULL REFERENCES wards(code),
  label       TEXT NOT NULL,
  -- Out of service: broken, being cleaned, or closed for infection control.
  out_of_service INTEGER NOT NULL DEFAULT 0 CHECK (out_of_service IN (0,1)),
  out_reason  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bed_ward ON beds(ward_code, out_of_service);

-- An admission is an encounter with a bed and a length of stay. The encounter
-- carries the clinical record; this carries where the patient is.
CREATE TABLE IF NOT EXISTS admissions (
  id            TEXT PRIMARY KEY,
  encounter_id  TEXT NOT NULL REFERENCES encounters(id),
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  ward_code     TEXT NOT NULL REFERENCES wards(code),
  bed_code      TEXT NOT NULL REFERENCES beds(code),
  admitted_by   INTEGER REFERENCES users(id),
  admitter_name TEXT NOT NULL,
  admitter_licence TEXT,
  reason        TEXT NOT NULL DEFAULT '',
  admitted_at   TEXT NOT NULL,
  discharged_at TEXT,
  discharged_by INTEGER REFERENCES users(id),
  discharge_type TEXT CHECK (discharge_type IN
                   ('home','referred','absconded','against_advice','died')),
  device_code   TEXT
);
CREATE INDEX IF NOT EXISTS idx_admission_open ON admissions(ward_code, discharged_at);

-- One patient per bed, enforced by the database rather than by looking first.
--
-- It has to be a PARTIAL index. `UNIQUE (bed_code, discharged_at)` looks like
-- it would do this and does not: SQLite treats NULLs as distinct, so two open
-- admissions to the same bed both have (bed, NULL) and both are allowed. The
-- `WHERE discharged_at IS NULL` clause is what makes it real, and it still lets
-- the same bed be reused by every patient who ever occupies it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bed_one_occupant
  ON admissions(bed_code) WHERE discharged_at IS NULL;

-- Every move of a patient between beds. Append-only: "which bed was he in on
-- Tuesday" is an infection-control question with a real answer.
CREATE TABLE IF NOT EXISTS bed_movements (
  id           INTEGER PRIMARY KEY,
  admission_id TEXT NOT NULL REFERENCES admissions(id),
  from_bed     TEXT REFERENCES beds(code),
  to_bed       TEXT NOT NULL REFERENCES beds(code),
  reason       TEXT NOT NULL DEFAULT '',
  by_user_id   INTEGER REFERENCES users(id),
  by_user_name TEXT NOT NULL,
  at           TEXT NOT NULL
);

-- A daily bed charge is raised by a job, not by remembering. Recorded per
-- night so a run twice on the same day cannot double-bill.
CREATE TABLE IF NOT EXISTS bed_nights (
  admission_id TEXT NOT NULL REFERENCES admissions(id),
  night_date   TEXT NOT NULL,
  charge_id    TEXT REFERENCES charges(id),
  billed_at    TEXT NOT NULL,
  PRIMARY KEY (admission_id, night_date)
);

-- Ward observations and drug administration. Separate from triage vitals
-- because the questions differ: a ward round asks about trend, not admission.
CREATE TABLE IF NOT EXISTS ward_observations (
  id           INTEGER PRIMARY KEY,
  admission_id TEXT NOT NULL REFERENCES admissions(id),
  patient_mrn  TEXT NOT NULL REFERENCES patients(mrn),
  temp_tenths_c   INTEGER,
  systolic_mmhg   INTEGER,
  diastolic_mmhg  INTEGER,
  pulse_bpm       INTEGER,
  resp_rate       INTEGER,
  spo2_percent    INTEGER,
  -- The aggregate early-warning score, computed and stored so a ward round can
  -- see a trend without recomputing history under a changed scoring table.
  news2_score  INTEGER,
  note         TEXT NOT NULL DEFAULT '',
  recorded_by  INTEGER REFERENCES users(id),
  recorder_name TEXT NOT NULL,
  recorded_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obs_admission ON ward_observations(admission_id, recorded_at);

-- The medication administration record. A prescription says what should
-- happen; this says what did.
CREATE TABLE IF NOT EXISTS medication_administrations (
  id              TEXT PRIMARY KEY,
  admission_id    TEXT NOT NULL REFERENCES admissions(id),
  prescription_id TEXT NOT NULL REFERENCES prescriptions(id),
  patient_mrn     TEXT NOT NULL REFERENCES patients(mrn),
  due_at          TEXT NOT NULL,
  given_at        TEXT,
  -- A dose not given is as important as one given, and must say why.
  omitted_reason  TEXT,
  given_by        INTEGER REFERENCES users(id),
  giver_name      TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mar_admission ON medication_administrations(admission_id, due_at);

-- ==================================================== M70 MOH RETURNS

-- A return that has been produced, with its figures frozen.
--
-- Frozen deliberately. A return submitted in March and re-run in June gives
-- different numbers — late entries, corrections, a merged duplicate — and the
-- facility must be able to show what it actually sent. The variance between
-- the two is itself a finding, not an embarrassment to be hidden by always
-- recomputing.
CREATE TABLE IF NOT EXISTS moh_returns (
  id            TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  form          TEXT NOT NULL,
  -- ISO month, e.g. '2026-08'.
  period        TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('draft','submitted','accepted','rejected')),
  -- The figures as sent, JSON, keyed by data element.
  values_json   TEXT NOT NULL DEFAULT '{}',
  generated_at  TEXT NOT NULL,
  generated_by  INTEGER REFERENCES users(id),
  submitted_at  TEXT,
  reference     TEXT,
  last_error    TEXT,
  UNIQUE (facility_id, form, period)
);

-- Notifiable diseases. The Public Health Act requires these to be reported to
-- the county health office, and the clock runs from diagnosis, not from when
-- somebody got round to the monthly return.
CREATE TABLE IF NOT EXISTS notifiable_events (
  id           TEXT PRIMARY KEY,
  facility_id  INTEGER NOT NULL REFERENCES facilities(id),
  patient_mrn  TEXT NOT NULL REFERENCES patients(mrn),
  encounter_id TEXT NOT NULL REFERENCES encounters(id),
  condition_code TEXT NOT NULL,
  condition_term TEXT NOT NULL,
  detected_at  TEXT NOT NULL,
  notified_at  TEXT,
  notified_by  INTEGER REFERENCES users(id),
  reference    TEXT,
  UNIQUE (encounter_id, condition_code)
);
CREATE INDEX IF NOT EXISTS idx_notifiable_open ON notifiable_events(facility_id, notified_at);
