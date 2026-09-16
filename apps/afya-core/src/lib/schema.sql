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
  -- 'biometric' is its own purpose rather than part of treatment: the Data
  -- Protection Act treats biometric data as a special category, and consent to
  -- be treated is not consent to have your fingerprint taken.
  purpose      TEXT NOT NULL CHECK (purpose IN ('treatment','billing','claim','research','data_sharing','biometric')),
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

-- ==================================================== M56 REMITTANCE

-- A payment advice from a payer: "we are paying you X for these claims".
-- Imported as a whole, then reconciled line by line, because the total a payer
-- says they sent and the total the facility expected are almost never equal and
-- the difference is the entire point of this module.
CREATE TABLE IF NOT EXISTS remittances (
  id            TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  payer_code    TEXT NOT NULL REFERENCES payers(code),
  -- The payer's own reference for the advice. Two advices with the same one is
  -- the same advice imported twice.
  reference     TEXT NOT NULL,
  advice_date   TEXT NOT NULL,
  -- What the payer says they sent, as stated on the advice.
  stated_total_cents INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('imported','reconciled','disputed')),
  imported_by   INTEGER REFERENCES users(id),
  imported_at   TEXT NOT NULL,
  reconciled_at TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  UNIQUE (payer_code, reference)
);

-- One line of the advice, against one claim.
--
-- `paid_cents` is what arrived; `claimed_cents` is what was asked for. The
-- variance between them is the number a facility owner has never been able to
-- see, because reconciling a payment advice by hand against a paper claim file
-- is a week of work nobody has.
CREATE TABLE IF NOT EXISTS remittance_lines (
  id             INTEGER PRIMARY KEY,
  remittance_id  TEXT NOT NULL REFERENCES remittances(id),
  -- Null when the payer paid for something this facility has no claim for,
  -- which happens and must be visible rather than dropped.
  claim_id       TEXT REFERENCES claims(id),
  -- The payer's own claim reference, as it appears on the advice.
  payer_reference TEXT NOT NULL DEFAULT '',
  claimed_cents  INTEGER NOT NULL DEFAULT 0,
  paid_cents     INTEGER NOT NULL DEFAULT 0,
  -- Why the payer paid less than was claimed. This is the asset: it is what
  -- turns a rejection into a scrubber rule.
  reason_code    TEXT,
  reason         TEXT NOT NULL DEFAULT '',
  -- How this line was matched to a claim, so a wrong match can be found later.
  matched_by     TEXT NOT NULL DEFAULT 'unmatched'
                   CHECK (matched_by IN ('reference','claim_id','manual','unmatched')),
  disputed_at    TEXT,
  dispute_reason TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_remit_line ON remittance_lines(remittance_id);
CREATE INDEX IF NOT EXISTS idx_remit_claim ON remittance_lines(claim_id);

-- ==================================================== M27 PROGRAMME REGISTERS

-- A programme is a long-running course of care with its own register, its own
-- reporting, and its own donor. HIV, TB and the NCD clinics are the three a
-- Kenyan facility runs; each has cohort reporting the county and the programme
-- both ask for, and neither can be produced from ordinary encounter data alone.
CREATE TABLE IF NOT EXISTS programmes (
  code         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  -- What the programme reports on: a cohort is followed from enrolment.
  cohort_months INTEGER NOT NULL DEFAULT 12,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);

-- One patient's enrolment in one programme.
--
-- `programme_number` is the number the PROGRAMME knows them by — a CCC number,
-- a TB register number — which is not the facility's file number and is what
-- appears on every return and every transfer letter.
CREATE TABLE IF NOT EXISTS enrolments (
  id             TEXT PRIMARY KEY,
  programme_code TEXT NOT NULL REFERENCES programmes(code),
  patient_mrn    TEXT NOT NULL REFERENCES patients(mrn),
  programme_number TEXT NOT NULL,
  enrolled_on    TEXT NOT NULL,
  -- The cohort a patient belongs to for reporting: the month they started.
  cohort         TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN
                   ('active','transferred_out','lost','stopped','completed','died')),
  outcome_on     TEXT,
  outcome_note   TEXT,
  enrolled_by    INTEGER REFERENCES users(id),
  device_code    TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE (programme_code, patient_mrn),
  UNIQUE (programme_code, programme_number)
);
CREATE INDEX IF NOT EXISTS idx_enrol_cohort ON enrolments(programme_code, cohort, status);

-- A programme visit: the review a patient comes back for, and the appointment
-- for the next one. Missing one is what "lost to follow-up" is counted from,
-- and it is the single number these programmes are judged on.
CREATE TABLE IF NOT EXISTS programme_visits (
  id            TEXT PRIMARY KEY,
  enrolment_id  TEXT NOT NULL REFERENCES enrolments(id),
  encounter_id  TEXT REFERENCES encounters(id),
  visit_date    TEXT NOT NULL,
  -- When they are expected back. The whole follow-up system hangs on this.
  next_due      TEXT,
  -- Programme-specific findings, as JSON: viral load, sputum result, BP, HbA1c.
  findings      TEXT NOT NULL DEFAULT '{}',
  note          TEXT NOT NULL DEFAULT '',
  seen_by       INTEGER REFERENCES users(id),
  seen_by_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pvisit_due ON programme_visits(enrolment_id, next_due);

-- ==================================================== M26 MATERNITY & CHILD HEALTH

-- A pregnancy, followed from booking to delivery to six weeks after.
--
-- Kept separately from the encounter record because the questions are
-- longitudinal: how many antenatal contacts has this woman had, is the
-- pregnancy dated, is she due. None of that can be reconstructed from a pile of
-- consultations afterwards.
CREATE TABLE IF NOT EXISTS pregnancies (
  id              TEXT PRIMARY KEY,
  patient_mrn     TEXT NOT NULL REFERENCES patients(mrn),
  -- The payer's own reference for this pregnancy's maternity cover, when there
  -- is one — a SHA authorisation, a scheme's antenatal booking reference. There
  -- is deliberately no Linda Mama column: that scheme ended with NHIF when SHA
  -- took over, and maternity is now a benefit inside the SHA package claimed
  -- against the mother's SHA number on her patient record, not a separate
  -- registration. Keep this free-text — every payer numbers it differently.
  cover_ref       TEXT,
  -- Last menstrual period. The expected date is derived from it, never stored
  -- independently, so the two can never disagree.
  lmp             TEXT,
  -- When a scan dates the pregnancy differently, the scan wins and says so.
  edd_override    TEXT,
  edd_source      TEXT NOT NULL DEFAULT 'lmp' CHECK (edd_source IN ('lmp','scan','unknown')),
  gravida         INTEGER,
  para            INTEGER,
  booked_on       TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('booked','delivered','miscarried','terminated','transferred','lost')),
  outcome_on      TEXT,
  outcome_note    TEXT,
  booked_by       INTEGER REFERENCES users(id),
  device_code     TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_preg_patient ON pregnancies(patient_mrn, status);

-- One antenatal contact. WHO counts contacts, not "visits", and the count is
-- what the return and the quality measure are both built on.
CREATE TABLE IF NOT EXISTS anc_contacts (
  id            TEXT PRIMARY KEY,
  pregnancy_id  TEXT NOT NULL REFERENCES pregnancies(id),
  encounter_id  TEXT REFERENCES encounters(id),
  contact_number INTEGER NOT NULL,
  contact_date  TEXT NOT NULL,
  -- Gestation in WEEKS at this contact, computed and stored: recomputing it
  -- later against a changed date would rewrite what was known at the time.
  gestation_weeks INTEGER,
  -- Integers in fixed units, like every other observation in the system.
  weight_grams    INTEGER,
  systolic_mmhg   INTEGER,
  diastolic_mmhg  INTEGER,
  fundal_height_cm INTEGER,
  haemoglobin_milli INTEGER,
  -- The interventions the return counts, each a plain yes or no.
  tt_given        INTEGER NOT NULL DEFAULT 0 CHECK (tt_given IN (0,1)),
  iptp_given      INTEGER NOT NULL DEFAULT 0 CHECK (iptp_given IN (0,1)),
  iron_given      INTEGER NOT NULL DEFAULT 0 CHECK (iron_given IN (0,1)),
  llin_given      INTEGER NOT NULL DEFAULT 0 CHECK (llin_given IN (0,1)),
  hiv_tested      INTEGER NOT NULL DEFAULT 0 CHECK (hiv_tested IN (0,1)),
  -- Danger signs found. Free text, because the list is long and a clinician
  -- writing "reduced fetal movements" must not be forced into a checkbox.
  danger_signs    TEXT NOT NULL DEFAULT '',
  next_due        TEXT,
  note            TEXT NOT NULL DEFAULT '',
  seen_by         INTEGER REFERENCES users(id),
  seen_by_name    TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE (pregnancy_id, contact_number)
);

-- The delivery itself.
CREATE TABLE IF NOT EXISTS deliveries (
  id              TEXT PRIMARY KEY,
  pregnancy_id    TEXT NOT NULL REFERENCES pregnancies(id),
  encounter_id    TEXT REFERENCES encounters(id),
  admission_id    TEXT REFERENCES admissions(id),
  delivered_at    TEXT NOT NULL,
  mode            TEXT NOT NULL CHECK (mode IN
                    ('spontaneous_vertex','assisted','caesarean','breech','other')),
  place           TEXT NOT NULL DEFAULT 'facility' CHECK (place IN ('facility','home','in_transit','other')),
  gestation_weeks INTEGER,
  -- Recorded because it drives the postnatal schedule and the claim.
  blood_loss_ml   INTEGER,
  complications   TEXT NOT NULL DEFAULT '',
  mother_outcome  TEXT NOT NULL DEFAULT 'alive' CHECK (mother_outcome IN ('alive','died')),
  attended_by     INTEGER REFERENCES users(id),
  attendant_name  TEXT NOT NULL,
  attendant_licence TEXT,
  device_code     TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delivery_preg ON deliveries(pregnancy_id);

-- A baby. One row per baby, because twins are not an edge case.
--
-- `patient_mrn` is the baby's OWN record, registered at birth. A newborn with
-- no record of their own cannot be immunised, weighed or treated, and giving
-- them one at birth is the single thing that makes child health work.
CREATE TABLE IF NOT EXISTS births (
  id            TEXT PRIMARY KEY,
  delivery_id   TEXT NOT NULL REFERENCES deliveries(id),
  patient_mrn   TEXT REFERENCES patients(mrn),
  birth_order   INTEGER NOT NULL DEFAULT 1,
  sex           TEXT NOT NULL CHECK (sex IN ('male','female','unknown')),
  birth_weight_grams INTEGER,
  -- Apgar at one and five minutes.
  apgar_1       INTEGER,
  apgar_5       INTEGER,
  outcome       TEXT NOT NULL CHECK (outcome IN ('live','stillbirth_fresh','stillbirth_macerated','died')),
  -- The birth notification number, which is what a birth certificate is got with.
  notification_no TEXT,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  UNIQUE (delivery_id, birth_order)
);

-- A postnatal contact, for the mother and the baby together — which is how they
-- are actually seen.
CREATE TABLE IF NOT EXISTS pnc_contacts (
  id            TEXT PRIMARY KEY,
  delivery_id   TEXT NOT NULL REFERENCES deliveries(id),
  encounter_id  TEXT REFERENCES encounters(id),
  contact_date  TEXT NOT NULL,
  -- Which of the scheduled contacts this is, in hours or days after birth.
  scheduled_at  TEXT NOT NULL,
  mother_findings TEXT NOT NULL DEFAULT '',
  baby_findings   TEXT NOT NULL DEFAULT '',
  danger_signs  TEXT NOT NULL DEFAULT '',
  next_due      TEXT,
  seen_by       INTEGER REFERENCES users(id),
  seen_by_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- Immunisation given. The schedule itself is data, so a change to the national
-- schedule is a data load rather than a release.
CREATE TABLE IF NOT EXISTS immunisation_schedule (
  code          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  -- Age in weeks at which it is due. 0 is at birth.
  due_weeks     INTEGER NOT NULL,
  sequence      INTEGER NOT NULL DEFAULT 1,
  source        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS immunisations (
  id            TEXT PRIMARY KEY,
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  vaccine_code  TEXT NOT NULL REFERENCES immunisation_schedule(code),
  given_on      TEXT NOT NULL,
  -- The batch matters: a recall names one, exactly as it does for medicine.
  batch_id      TEXT REFERENCES stock_batches(id),
  batch_number  TEXT NOT NULL DEFAULT '',
  site          TEXT NOT NULL DEFAULT '',
  given_by      INTEGER REFERENCES users(id),
  giver_name    TEXT NOT NULL,
  device_code   TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (patient_mrn, vaccine_code)
);
CREATE INDEX IF NOT EXISTS idx_imm_patient ON immunisations(patient_mrn);

-- ============================================================================
-- M28 Emergency & Casualty
--
-- A casualty attendance is deliberately NOT a visit row with a flag on it. The
-- questions asked of a casualty department — how long until a red patient was
-- seen, how many people left without being seen, who came in from which road
-- crash — cannot be answered from a queue that was designed for an outpatient
-- clinic, and bolting them onto `visits` would make every one of them a
-- special case.
-- ============================================================================

CREATE TABLE IF NOT EXISTS emergency_attendances (
  id            TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  -- The clinical record, once somebody opens one. Null while the patient is
  -- still being resuscitated: care starts before paperwork does.
  encounter_id  TEXT REFERENCES encounters(id),
  visit_id      TEXT REFERENCES visits(id),
  -- Set when the patient arrived without a name. Cleared when they are
  -- identified, which is a merge, not an edit.
  unidentified  INTEGER NOT NULL DEFAULT 0,
  arrival_mode  TEXT NOT NULL DEFAULT 'walk_in'
                CHECK (arrival_mode IN ('walk_in','ambulance','police','referred','carried','other')),
  arrived_at    TEXT NOT NULL,
  presenting    TEXT NOT NULL DEFAULT '',
  -- The current triage colour, stamped from the latest assessment. Kept here
  -- rather than joined so the board is one read: a casualty board that is slow
  -- is a board nobody looks at.
  triage        TEXT CHECK (triage IN ('red','orange','yellow','green','blue')),
  triaged_at    TEXT,
  -- When the clinician actually laid hands on them. The gap between this and
  -- `triaged_at` is the number the department is judged on.
  seen_at       TEXT,
  seen_by       INTEGER REFERENCES users(id),
  disposition   TEXT CHECK (disposition IN
                  ('admitted','discharged','referred','died','dead_on_arrival',
                   'left_without_being_seen','absconded','theatre')),
  disposition_at   TEXT,
  disposition_note TEXT NOT NULL DEFAULT '',
  admission_id  TEXT REFERENCES admissions(id),
  -- A mass-casualty incident reference, when this arrival is one of many.
  incident_ref  TEXT,
  opened_by     INTEGER REFERENCES users(id),
  opener_name   TEXT NOT NULL,
  device_code   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ed_open ON emergency_attendances(facility_id, disposition);
CREATE INDEX IF NOT EXISTS idx_ed_patient ON emergency_attendances(patient_mrn);
CREATE INDEX IF NOT EXISTS idx_ed_incident ON emergency_attendances(incident_ref);

-- Every triage assessment, not just the latest. A patient who deteriorates in
-- the waiting area is re-triaged, and the first score is evidence of what was
-- known at the time — it is never overwritten.
CREATE TABLE IF NOT EXISTS triage_assessments (
  id            TEXT PRIMARY KEY,
  attendance_id TEXT NOT NULL REFERENCES emergency_attendances(id),
  sequence      INTEGER NOT NULL,
  assessed_at   TEXT NOT NULL,
  -- The Triage Early Warning Score components, each stored as recorded.
  mobility      TEXT CHECK (mobility IN ('walking','with_help','stretcher')),
  resp_rate     INTEGER,
  pulse_bpm     INTEGER,
  systolic_mmhg INTEGER,
  temp_tenths_c INTEGER,
  avpu          TEXT CHECK (avpu IN ('alert','voice','pain','unresponsive')),
  trauma        INTEGER NOT NULL DEFAULT 0,
  tews          INTEGER NOT NULL,
  -- A discriminator can only ever raise the colour, never lower it.
  discriminator TEXT NOT NULL DEFAULT '',
  triage        TEXT NOT NULL CHECK (triage IN ('red','orange','yellow','green','blue')),
  -- What the score alone would have given, kept so an upgrade is visible.
  triage_by_score TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  assessed_by   INTEGER REFERENCES users(id),
  assessor_name TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE (attendance_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_triage_attendance ON triage_assessments(attendance_id);

-- A police case. Kept separate from the clinical record because it is
-- disclosed separately: a P3 form goes to the police, the notes do not.
CREATE TABLE IF NOT EXISTS medicolegal_cases (
  id            TEXT PRIMARY KEY,
  attendance_id TEXT NOT NULL REFERENCES emergency_attendances(id),
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  kind          TEXT NOT NULL CHECK (kind IN
                  ('assault','road_traffic','gunshot','stabbing','burns','poisoning',
                   'sexual_violence','child_abuse','death_in_custody','other')),
  police_station TEXT NOT NULL DEFAULT '',
  ob_number     TEXT NOT NULL DEFAULT '',
  p3_issued     INTEGER NOT NULL DEFAULT 0,
  p3_issued_at  TEXT,
  p3_issued_to  TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  opened_by     INTEGER REFERENCES users(id),
  opener_name   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlc_attendance ON medicolegal_cases(attendance_id);

-- A mass-casualty incident. One row, many attendances, so "how many came from
-- the Thika Road crash and where are they now" is one query rather than a
-- memory of which names were involved.
CREATE TABLE IF NOT EXISTS mci_incidents (
  reference     TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  kind          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  declared_at   TEXT NOT NULL,
  stood_down_at TEXT,
  declared_by   INTEGER REFERENCES users(id),
  declarer_name TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- ============================================================================
-- M29 Referrals
--
-- The referral, and the half of it that never happens: the letter coming back.
-- ============================================================================

-- Where a patient can be sent. A local directory rather than free text, because
-- a destination typed by hand cannot be counted, cannot be telephoned, and
-- cannot tell you it has no bed. Seeded from KMHFL; a facility not in the list
-- can still be used, recorded as `external_name` on the referral itself.
CREATE TABLE IF NOT EXISTS referral_facilities (
  kmhfl_code    TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  level         INTEGER NOT NULL CHECK (level BETWEEN 2 AND 6),
  county        TEXT NOT NULL DEFAULT '',
  -- What this destination can actually take. Free text by design: a facility's
  -- real capability is not an enum, and pretending it is sends patients to
  -- places that cannot help them.
  services      TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reffac_level ON referral_facilities(level, county);

CREATE TABLE IF NOT EXISTS referrals (
  id            TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  encounter_id  TEXT REFERENCES encounters(id),
  attendance_id TEXT REFERENCES emergency_attendances(id),
  admission_id  TEXT REFERENCES admissions(id),
  -- 'out' is this facility sending a patient away; 'in' is one arriving with a
  -- letter from somewhere else. Both are kept, because a facility that only
  -- records what it sends cannot show what it receives.
  direction     TEXT NOT NULL CHECK (direction IN ('out','in')),
  -- The other end. One of these is set: a code from the directory, or a name
  -- for somewhere that is not in it.
  counterpart_code TEXT REFERENCES referral_facilities(kmhfl_code),
  external_name TEXT NOT NULL DEFAULT '',
  urgency       TEXT NOT NULL CHECK (urgency IN ('emergency','urgent','routine')),
  reason        TEXT NOT NULL,
  -- What was already done here. A referral upwards that cannot say what was
  -- tried is how a referral system gets flooded.
  treatment_given TEXT NOT NULL DEFAULT '',
  clinical_summary TEXT NOT NULL DEFAULT '',
  -- The specialty or service being asked for.
  service_needed TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL CHECK (status IN
                  ('raised','accepted','declined','departed','arrived','completed','cancelled')),
  raised_at     TEXT NOT NULL,
  -- Acceptance is the gate. A patient must not be put in a vehicle towards a
  -- hospital that has not said it has a bed.
  accepted_at   TEXT,
  accepted_by_name TEXT NOT NULL DEFAULT '',
  decline_reason TEXT NOT NULL DEFAULT '',
  departed_at   TEXT,
  transport     TEXT NOT NULL DEFAULT '',
  escort        TEXT NOT NULL DEFAULT '',
  arrived_at    TEXT,
  -- The counter-referral: what the receiving facility did and what the origin
  -- is asked to continue. The half of the loop that is almost never closed.
  outcome       TEXT CHECK (outcome IN ('treated_returned','admitted_there','died','absconded','not_seen','other')),
  outcome_note  TEXT NOT NULL DEFAULT '',
  outcome_at    TEXT,
  outcome_by_name TEXT NOT NULL DEFAULT '',
  cancel_reason TEXT NOT NULL DEFAULT '',
  raised_by     INTEGER REFERENCES users(id),
  raiser_name   TEXT NOT NULL,
  device_code   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ref_open ON referrals(facility_id, direction, status);
CREATE INDEX IF NOT EXISTS idx_ref_patient ON referrals(patient_mrn);

-- Every state change on a referral, with who and when. A referral is a handover
-- between two organisations, and the only defence against "we never received
-- it" is a timeline nobody can quietly edit.
CREATE TABLE IF NOT EXISTS referral_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  referral_id   TEXT NOT NULL REFERENCES referrals(id),
  at            TEXT NOT NULL,
  from_status   TEXT NOT NULL,
  to_status     TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  by_user_id    INTEGER REFERENCES users(id),
  by_name       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refev_referral ON referral_events(referral_id, at);

-- ============================================================================
-- M25 Theatre
--
-- The operating list, the WHO Surgical Safety Checklist, and the count.
-- ============================================================================

CREATE TABLE IF NOT EXISTS theatres (
  code          TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  name          TEXT NOT NULL,
  -- Free text by design: what a theatre can actually do is not an enum, and
  -- pretending it is books a caesarean into a minor-ops room.
  capability    TEXT NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS theatre_cases (
  id            TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  theatre_code  TEXT REFERENCES theatres(code),
  encounter_id  TEXT REFERENCES encounters(id),
  admission_id  TEXT REFERENCES admissions(id),
  -- Where the case came from. A casualty patient sent to theatre and an
  -- elective booking are the same operation and completely different logistics.
  source        TEXT NOT NULL DEFAULT 'elective'
                CHECK (source IN ('elective','casualty','ward','maternity','referral')),
  attendance_id TEXT REFERENCES emergency_attendances(id),
  urgency       TEXT NOT NULL CHECK (urgency IN ('immediate','urgent','expedited','elective')),
  -- The procedure as consented. If what was actually done differs, that is a
  -- deviation and is recorded as one, never by editing this.
  procedure_planned TEXT NOT NULL,
  procedure_code TEXT,
  laterality    TEXT CHECK (laterality IN ('left','right','bilateral','not_applicable')),
  surgeon_id    INTEGER REFERENCES users(id),
  surgeon_name  TEXT NOT NULL DEFAULT '',
  anaesthetist_name TEXT NOT NULL DEFAULT '',
  anaesthesia   TEXT CHECK (anaesthesia IN ('general','spinal','regional','local','sedation')),
  scheduled_for TEXT,
  estimated_minutes INTEGER,
  status        TEXT NOT NULL CHECK (status IN
                  ('booked','sent_for','in_theatre','anaesthetised','incised','closed',
                   'in_recovery','completed','cancelled')),
  -- The three WHO checklist stages, each stamped when it was completed. Null is
  -- not an oversight to be tidied up later: it is the state that blocks the
  -- next step.
  sign_in_at    TEXT,
  time_out_at   TEXT,
  sign_out_at   TEXT,
  incision_at   TEXT,
  closed_at     TEXT,
  -- What actually happened.
  procedure_performed TEXT NOT NULL DEFAULT '',
  findings      TEXT NOT NULL DEFAULT '',
  blood_loss_ml INTEGER,
  specimen      TEXT NOT NULL DEFAULT '',
  implant       TEXT NOT NULL DEFAULT '',
  complications TEXT NOT NULL DEFAULT '',
  asa_grade     INTEGER CHECK (asa_grade BETWEEN 1 AND 6),
  -- Cancellation is a first-class outcome. Theatre utilisation is what a
  -- hospital is judged on, and a cancelled list with no reason teaches nobody
  -- anything.
  cancel_reason TEXT NOT NULL DEFAULT '',
  cancel_category TEXT CHECK (cancel_category IN
                  ('no_theatre_time','no_surgeon','no_anaesthetist','no_bed','patient_unfit',
                   'patient_did_not_attend','no_blood','no_equipment','no_consent','other')),
  cancelled_at  TEXT,
  booked_by     INTEGER REFERENCES users(id),
  booker_name   TEXT NOT NULL,
  device_code   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_case_list ON theatre_cases(facility_id, scheduled_for, status);
CREATE INDEX IF NOT EXISTS idx_case_patient ON theatre_cases(patient_mrn);

-- Each answer on the WHO checklist, kept individually rather than as a boolean
-- "checklist done". A checklist recorded as one tick is a checklist nobody
-- read out.
CREATE TABLE IF NOT EXISTS checklist_answers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       TEXT NOT NULL REFERENCES theatre_cases(id),
  stage         TEXT NOT NULL CHECK (stage IN ('sign_in','time_out','sign_out')),
  item_code     TEXT NOT NULL,
  answer        TEXT NOT NULL CHECK (answer IN ('yes','no','not_applicable')),
  note          TEXT NOT NULL DEFAULT '',
  answered_by   INTEGER REFERENCES users(id),
  answerer_name TEXT NOT NULL,
  answered_at   TEXT NOT NULL,
  UNIQUE (case_id, stage, item_code)
);

-- The count. Swabs, instruments and needles, counted in and counted out. A
-- mismatch is a never-event and blocks sign-out.
CREATE TABLE IF NOT EXISTS theatre_counts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       TEXT NOT NULL REFERENCES theatre_cases(id),
  item          TEXT NOT NULL,
  counted_in    INTEGER NOT NULL,
  counted_out   INTEGER,
  -- Set when a discrepancy was resolved, with how. Never by editing the counts.
  resolution    TEXT NOT NULL DEFAULT '',
  counted_by    INTEGER REFERENCES users(id),
  counter_name  TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (case_id, item)
);

-- Who was in the room. An operation note that cannot name the scrub nurse is
-- not a record anybody can rely on afterwards.
CREATE TABLE IF NOT EXISTS theatre_team (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       TEXT NOT NULL REFERENCES theatre_cases(id),
  role          TEXT NOT NULL,
  person_name   TEXT NOT NULL,
  user_id       INTEGER REFERENCES users(id),
  UNIQUE (case_id, role, person_name)
);

-- ============================================================================
-- M32 Radiology
--
-- Built on the same `orders` row the laboratory uses, because an imaging
-- request IS an order and duplicating that would give a facility two worklists
-- and two ideas of what is outstanding. What is added here is everything that
-- makes imaging different from a blood test: a dose, a justification, and a
-- question nobody can un-ask once the exposure has happened.
-- ============================================================================

CREATE TABLE IF NOT EXISTS imaging_studies (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  -- The number the images are filed under. Unique because two studies sharing
  -- an accession is how one patient's film ends up on another's report.
  accession     TEXT NOT NULL UNIQUE,
  modality      TEXT NOT NULL CHECK (modality IN ('xray','ultrasound','ct','mri','fluoroscopy','mammography')),
  body_part     TEXT NOT NULL,
  laterality    TEXT CHECK (laterality IN ('left','right','bilateral','not_applicable')),
  -- Why this exposure is justified. Required for anything ionising: the
  -- Radiation Protection Act and the IAEA standards both put justification
  -- before the exposure, not in a file afterwards.
  justification TEXT NOT NULL DEFAULT '',
  justified_by  INTEGER REFERENCES users(id),
  justifier_name TEXT NOT NULL DEFAULT '',
  -- The pregnancy question, asked before any ionising exposure of a woman who
  -- could be pregnant. 'not_applicable' is an answer and says why.
  pregnancy_check TEXT CHECK (pregnancy_check IN ('not_pregnant','possible','pregnant','not_applicable','declined')),
  pregnancy_note TEXT NOT NULL DEFAULT '',
  -- Dose area product in µGy·m², the quantity an X-ray unit actually reports.
  -- Integer, like every other measurement here.
  dose_ugy_m2   INTEGER,
  -- Effective dose in microsieverts, where the equipment or a conversion gives
  -- one. This is what a cumulative total is meaningfully summed in.
  dose_usv      INTEGER,
  images        INTEGER,
  repeat_of     TEXT REFERENCES imaging_studies(id),
  repeat_reason TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL CHECK (status IN
                  ('requested','justified','scheduled','performed','reported','verified','cancelled')),
  performed_at  TEXT,
  performed_by  INTEGER REFERENCES users(id),
  radiographer_name TEXT NOT NULL DEFAULT '',
  equipment     TEXT NOT NULL DEFAULT '',
  cancel_reason TEXT NOT NULL DEFAULT '',
  device_code   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_study_order ON imaging_studies(order_id);
CREATE INDEX IF NOT EXISTS idx_study_patient ON imaging_studies(patient_mrn);
CREATE INDEX IF NOT EXISTS idx_study_status ON imaging_studies(status);

-- The safety screening for a modality that has one. MRI is the reason this
-- exists: a pacemaker or a ferromagnetic implant in an MRI scanner is fatal,
-- and the screening is a different set of questions from the pregnancy check.
CREATE TABLE IF NOT EXISTS imaging_safety_checks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  study_id      TEXT NOT NULL REFERENCES imaging_studies(id),
  item_code     TEXT NOT NULL,
  answer        TEXT NOT NULL CHECK (answer IN ('yes','no','unknown')),
  note          TEXT NOT NULL DEFAULT '',
  answered_by   INTEGER REFERENCES users(id),
  answerer_name TEXT NOT NULL,
  answered_at   TEXT NOT NULL,
  UNIQUE (study_id, item_code)
);

-- Reports. A provisional read and a final one are both kept: the provisional is
-- what the ward acted on overnight, and if the final disagrees that difference
-- is the most useful thing in the whole module.
CREATE TABLE IF NOT EXISTS imaging_reports (
  id            TEXT PRIMARY KEY,
  study_id      TEXT NOT NULL REFERENCES imaging_studies(id),
  kind          TEXT NOT NULL CHECK (kind IN ('provisional','final','addendum')),
  findings      TEXT NOT NULL,
  impression    TEXT NOT NULL,
  -- A finding that cannot wait for somebody to open the report. Communicated
  -- to a named person at a recorded time, exactly as a panic laboratory value
  -- is: "it was in the report" is not communication.
  critical      INTEGER NOT NULL DEFAULT 0,
  communicated_to TEXT NOT NULL DEFAULT '',
  communicated_at TEXT,
  -- Set on a final report that disagrees with the provisional one.
  discrepancy   INTEGER NOT NULL DEFAULT 0,
  discrepancy_note TEXT NOT NULL DEFAULT '',
  reported_by   INTEGER REFERENCES users(id),
  reporter_name TEXT NOT NULL,
  reporter_licence TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_study ON imaging_reports(study_id, created_at);

-- ============================================================================
-- M42 Procurement
--
-- Requisition, approval, purchase order, goods received note, invoice, and the
-- three-way match between the last three. The match is the whole module: it is
-- what makes it impossible to pay for more than was ordered, at more than the
-- agreed price, for goods nobody can show arrived.
-- ============================================================================

CREATE TABLE IF NOT EXISTS suppliers (
  code          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  -- The KRA PIN. Without it there is no valid tax invoice and no withholding,
  -- and a supplier with no PIN is a supplier the facility cannot pay lawfully.
  kra_pin       TEXT,
  -- Pharmacy and Poisons Board licence. A supplier without a current one must
  -- not supply medicines, whatever they are selling them for.
  ppb_licence   TEXT,
  ppb_expires_on TEXT,
  -- Access to Government Procurement Opportunities category, where the
  -- facility is a public entity with a reservation to meet.
  agpo_category TEXT CHECK (agpo_category IN ('youth','women','pwd','none')),
  agpo_certificate TEXT,
  phone         TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  -- Set when the facility has stopped buying from them, with why.
  blocked       INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requisitions (
  id            TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  store_code    TEXT REFERENCES stores(code),
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('raised','approved','rejected','ordered','cancelled')),
  -- Who raised it, and who approved it. These must be different people: the
  -- oldest control in procurement and the one that is quietly dropped first.
  raised_by     INTEGER REFERENCES users(id),
  raiser_name   TEXT NOT NULL,
  raised_at     TEXT NOT NULL,
  approved_by   INTEGER REFERENCES users(id),
  approver_name TEXT NOT NULL DEFAULT '',
  approved_at   TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  device_code   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_req_status ON requisitions(facility_id, status);

CREATE TABLE IF NOT EXISTS requisition_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id TEXT NOT NULL REFERENCES requisitions(id),
  product_code  TEXT NOT NULL REFERENCES products(code),
  product_name  TEXT NOT NULL,
  quantity      INTEGER NOT NULL,
  -- What the store had when this was raised. Kept so an approver can see
  -- whether a requisition was justified without going to look.
  on_hand_then  INTEGER,
  note          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_reqline_req ON requisition_lines(requisition_id);

-- Quotations against a requisition. Three of them is the rule most facilities
-- work to, and for a public entity it is the law below the tender threshold.
CREATE TABLE IF NOT EXISTS quotations (
  id            TEXT PRIMARY KEY,
  requisition_id TEXT NOT NULL REFERENCES requisitions(id),
  supplier_code TEXT NOT NULL REFERENCES suppliers(code),
  total_cents   INTEGER NOT NULL,
  lead_days     INTEGER,
  note          TEXT NOT NULL DEFAULT '',
  -- Set on the one that won, with why. "Cheapest" is a reason; so is "only
  -- one with stock", and recording which is how a facility defends itself.
  selected      INTEGER NOT NULL DEFAULT 0,
  selection_reason TEXT NOT NULL DEFAULT '',
  received_at   TEXT NOT NULL,
  recorded_by   INTEGER REFERENCES users(id),
  recorder_name TEXT NOT NULL,
  UNIQUE (requisition_id, supplier_code)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id            TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  requisition_id TEXT REFERENCES requisitions(id),
  supplier_code TEXT NOT NULL REFERENCES suppliers(code),
  store_code    TEXT NOT NULL REFERENCES stores(code),
  reference     TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL CHECK (status IN ('issued','part_received','received','closed','cancelled')),
  expected_on   TEXT,
  total_cents   INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT NOT NULL DEFAULT '',
  issued_by     INTEGER REFERENCES users(id),
  issuer_name   TEXT NOT NULL,
  issued_at     TEXT NOT NULL,
  device_code   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(facility_id, status);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id         TEXT NOT NULL REFERENCES purchase_orders(id),
  product_code  TEXT NOT NULL REFERENCES products(code),
  product_name  TEXT NOT NULL,
  quantity      INTEGER NOT NULL,
  -- The agreed price. Integer cents, like all money here. Receiving at a
  -- different price is a variance, never a correction to this.
  unit_cost_cents INTEGER NOT NULL,
  UNIQUE (po_id, product_code)
);

-- The goods received note. What actually arrived, counted at the door.
CREATE TABLE IF NOT EXISTS goods_received (
  id            TEXT PRIMARY KEY,
  po_id         TEXT NOT NULL REFERENCES purchase_orders(id),
  reference     TEXT NOT NULL,
  delivery_note TEXT NOT NULL DEFAULT '',
  received_by   INTEGER REFERENCES users(id),
  receiver_name TEXT NOT NULL,
  received_at   TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  device_code   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grn_po ON goods_received(po_id);

CREATE TABLE IF NOT EXISTS goods_received_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  grn_id        TEXT NOT NULL REFERENCES goods_received(id),
  product_code  TEXT NOT NULL REFERENCES products(code),
  quantity      INTEGER NOT NULL,
  batch_number  TEXT NOT NULL,
  expires_on    TEXT NOT NULL,
  -- The batch this became in the store, so a recall reaches the delivery and
  -- the delivery reaches the supplier.
  batch_id      TEXT REFERENCES stock_batches(id),
  -- Quantity rejected at the door, and why. Short-dated stock refused on the
  -- day is a supplier problem; accepted, it is the facility's.
  rejected      INTEGER NOT NULL DEFAULT 0,
  reject_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_grnline_grn ON goods_received_lines(grn_id);

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id            TEXT PRIMARY KEY,
  po_id         TEXT NOT NULL REFERENCES purchase_orders(id),
  supplier_code TEXT NOT NULL REFERENCES suppliers(code),
  invoice_no    TEXT NOT NULL,
  invoice_date  TEXT NOT NULL,
  total_cents   INTEGER NOT NULL,
  -- The supplier's own eTIMS control number, where they issue one. Its absence
  -- is worth seeing: an invoice without one may not be claimable against tax.
  etims_number  TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL CHECK (status IN ('received','matched','queried','approved','paid','rejected')),
  query_note    TEXT NOT NULL DEFAULT '',
  approved_by   INTEGER REFERENCES users(id),
  approver_name TEXT NOT NULL DEFAULT '',
  approved_at   TEXT,
  paid_at       TEXT,
  payment_ref   TEXT NOT NULL DEFAULT '',
  recorded_by   INTEGER REFERENCES users(id),
  recorder_name TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE (supplier_code, invoice_no)
);
CREATE INDEX IF NOT EXISTS idx_sinv_status ON supplier_invoices(status);

CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    TEXT NOT NULL REFERENCES supplier_invoices(id),
  product_code  TEXT NOT NULL REFERENCES products(code),
  quantity      INTEGER NOT NULL,
  unit_cost_cents INTEGER NOT NULL,
  UNIQUE (invoice_id, product_code)
);

-- ============================================================================
-- M61 Accounting
--
-- A double-entry general ledger that the rest of the system posts into. The
-- point is not that a facility gets a ledger — it is that the ledger and the
-- operational record are the same facts, so they cannot drift apart and
-- nobody has to type anything twice.
-- ============================================================================

CREATE TABLE IF NOT EXISTS accounts (
  code          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('asset','liability','equity','income','expense')),
  -- Which side increases this account. Stored rather than derived from `kind`
  -- so a contra account (accumulated depreciation, an allowance) can be
  -- defined without a special case running through every report.
  normal_side   TEXT NOT NULL CHECK (normal_side IN ('debit','credit')),
  parent_code   TEXT REFERENCES accounts(code),
  -- A cash or bank account the operational side can be reconciled against.
  reconcilable  INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

-- An accounting period. Once closed it takes no postings: a late entry goes to
-- the open period carrying a reference to what it is about, which is what
-- actually happens in a real ledger.
CREATE TABLE IF NOT EXISTS periods (
  code          TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  starts_on     TEXT NOT NULL,
  ends_on       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('open','closed')),
  closed_at     TEXT,
  closed_by     INTEGER REFERENCES users(id),
  closer_name   TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journals (
  id            TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  period_code   TEXT NOT NULL REFERENCES periods(code),
  entry_date    TEXT NOT NULL,
  narrative     TEXT NOT NULL,
  -- What in the operational record this journal is the accounting for. The
  -- pair is UNIQUE, which is what makes posting idempotent: running the
  -- posting job twice cannot double-count anything.
  source_kind   TEXT NOT NULL DEFAULT 'manual',
  source_ref    TEXT,
  -- A reversal points at what it reverses. A posted journal is never edited.
  reverses      TEXT REFERENCES journals(id),
  reversal_reason TEXT NOT NULL DEFAULT '',
  posted_by     INTEGER REFERENCES users(id),
  poster_name   TEXT NOT NULL,
  posted_at     TEXT NOT NULL,
  device_code   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_source
  ON journals(source_kind, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_period ON journals(period_code, entry_date);

CREATE TABLE IF NOT EXISTS journal_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id    TEXT NOT NULL REFERENCES journals(id),
  account_code  TEXT NOT NULL REFERENCES accounts(code),
  -- One of these is zero. Kept as two columns rather than one signed amount
  -- because a trial balance is read in two columns, and a ledger that has to
  -- decide what a negative debit means has already gone wrong.
  debit_cents   INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents  INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  memo          TEXT NOT NULL DEFAULT '',
  CHECK ((debit_cents = 0) <> (credit_cents = 0))
);
CREATE INDEX IF NOT EXISTS idx_jline_journal ON journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_jline_account ON journal_lines(account_code);

-- ============================================================================
-- M62 Payroll
--
-- The most Kenya-specific module here, and the one most certain to be wrong if
-- its rates are compiled in. PAYE bands, NSSF tiers, SHIF and the housing levy
-- all change by Act of Parliament, usually in July and sometimes in between. So
-- every rate is a row with a date it took effect, and a payslip is computed
-- from the rates in force on ITS pay date rather than today's.
-- ============================================================================

CREATE TABLE IF NOT EXISTS employees (
  id            TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  -- The system user, where they have one. A cleaner has no login; a clinician
  -- does, and the two must be the same person in the payroll.
  user_id       INTEGER REFERENCES users(id),
  payroll_no    TEXT NOT NULL,
  given_name    TEXT NOT NULL,
  family_name   TEXT NOT NULL,
  national_id   TEXT,
  -- Without a KRA PIN there is no PAYE return. Without an NSSF or SHIF number
  -- the contribution cannot be credited to the person it was deducted from.
  kra_pin       TEXT,
  nssf_no       TEXT,
  shif_no       TEXT,
  job_title     TEXT NOT NULL DEFAULT '',
  department    TEXT NOT NULL DEFAULT '',
  employment    TEXT NOT NULL DEFAULT 'permanent'
                CHECK (employment IN ('permanent','contract','locum','intern','casual')),
  basic_cents   INTEGER NOT NULL DEFAULT 0,
  bank_name     TEXT NOT NULL DEFAULT '',
  bank_account  TEXT NOT NULL DEFAULT '',
  started_on    TEXT NOT NULL,
  ended_on      TEXT,
  end_reason    TEXT NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  UNIQUE (facility_id, payroll_no)
);
CREATE INDEX IF NOT EXISTS idx_emp_active ON employees(facility_id, active);

-- A recurring allowance or deduction that is not statutory: house allowance,
-- a SACCO deduction, a salary advance being recovered.
CREATE TABLE IF NOT EXISTS pay_items (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees(id),
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('allowance','deduction')),
  amount_cents  INTEGER NOT NULL,
  -- Whether PAYE is charged on this allowance. Getting it wrong is the
  -- commonest payroll error there is, so it is explicit rather than assumed.
  taxable       INTEGER NOT NULL DEFAULT 1,
  starts_on     TEXT NOT NULL,
  ends_on       TEXT,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payitem_emp ON pay_items(employee_id);

-- Statutory rates, each with the date it took effect. Nothing here is a
-- constant in code, because a payroll whose rates are compiled in is a payroll
-- that is wrong the month after every Finance Act.
CREATE TABLE IF NOT EXISTS statutory_rates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL CHECK (kind IN ('paye_band','personal_relief','nssf','shif','housing_levy')),
  effective_from TEXT NOT NULL,
  -- For a PAYE band: the lower bound in cents and the rate in basis points.
  -- For the rest: whatever that deduction needs, named in `label`.
  lower_cents   INTEGER,
  upper_cents   INTEGER,
  rate_bp       INTEGER,
  amount_cents  INTEGER,
  min_cents     INTEGER,
  max_cents     INTEGER,
  label         TEXT NOT NULL DEFAULT '',
  -- Where this figure came from. An auditor will ask, and so will the next
  -- person to change it.
  source        TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_kind ON statutory_rates(kind, effective_from);
-- One row per rate per date. Loading the rates twice must not double everybody's
-- deductions, and a plain UNIQUE would not stop it: the non-band rates have a
-- null lower bound, and SQLite treats nulls as distinct. Hence the COALESCE.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_key
  ON statutory_rates(kind, effective_from, COALESCE(lower_cents, -1));

CREATE TABLE IF NOT EXISTS payroll_runs (
  id            TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  period        TEXT NOT NULL,
  pay_date      TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('draft','approved','paid','cancelled')),
  -- Prepared by one person, approved by another. The same control as
  -- procurement, and for the same reason.
  prepared_by   INTEGER REFERENCES users(id),
  preparer_name TEXT NOT NULL,
  prepared_at   TEXT NOT NULL,
  approved_by   INTEGER REFERENCES users(id),
  approver_name TEXT NOT NULL DEFAULT '',
  approved_at   TEXT,
  paid_at       TEXT,
  payment_ref   TEXT NOT NULL DEFAULT '',
  cancel_reason TEXT NOT NULL DEFAULT '',
  device_code   TEXT,
  created_at    TEXT NOT NULL
);
-- One run per period, but a CANCELLED run does not hold the period: a run
-- abandoned before approval has to be repeatable. A plain UNIQUE would block
-- that, so this is partial.
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_period
  ON payroll_runs(facility_id, period) WHERE status <> 'cancelled';

-- A payslip, with the computation stored rather than recomputed. Reprinting a
-- payslip from two years ago must show what was actually paid, not what
-- today's rates would give.
CREATE TABLE IF NOT EXISTS payslips (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES payroll_runs(id),
  employee_id   TEXT NOT NULL REFERENCES employees(id),
  basic_cents   INTEGER NOT NULL,
  allowances_cents INTEGER NOT NULL DEFAULT 0,
  gross_cents   INTEGER NOT NULL,
  nssf_cents    INTEGER NOT NULL DEFAULT 0,
  shif_cents    INTEGER NOT NULL DEFAULT 0,
  housing_levy_cents INTEGER NOT NULL DEFAULT 0,
  taxable_cents INTEGER NOT NULL DEFAULT 0,
  paye_cents    INTEGER NOT NULL DEFAULT 0,
  relief_cents  INTEGER NOT NULL DEFAULT 0,
  other_deductions_cents INTEGER NOT NULL DEFAULT 0,
  net_cents     INTEGER NOT NULL,
  -- What the employer pays on top, which never appears on the payslip but is
  -- a real cost and belongs in the ledger.
  employer_nssf_cents INTEGER NOT NULL DEFAULT 0,
  employer_housing_cents INTEGER NOT NULL DEFAULT 0,
  -- The working, kept as JSON so a payslip can show how it was arrived at.
  workings      TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  UNIQUE (run_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_payslip_run ON payslips(run_id);
CREATE INDEX IF NOT EXISTS idx_payslip_emp ON payslips(employee_id);

-- ============================================================================
-- M60 Human Resources
--
-- Built on the payroll's `employees` and the access module's
-- `practitioner_licences` rather than a third list of staff. What is added here
-- is contracts, leave, and the question a clinical HR module exists to ask:
-- if this person is away, who covers them?
-- ============================================================================

CREATE TABLE IF NOT EXISTS contracts (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees(id),
  kind          TEXT NOT NULL CHECK (kind IN ('permanent','fixed_term','locum','internship','probation')),
  starts_on     TEXT NOT NULL,
  -- Null for permanent. For anything else, the date somebody is working
  -- without a contract if nobody notices.
  ends_on       TEXT,
  notice_days   INTEGER,
  terms         TEXT NOT NULL DEFAULT '',
  signed_on     TEXT,
  superseded_by TEXT REFERENCES contracts(id),
  created_by    INTEGER REFERENCES users(id),
  creator_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contract_emp ON contracts(employee_id, starts_on);

-- Statutory leave entitlements, as data with an effective date — the same
-- pattern as the payroll rates, and for the same reason. The Employment Act
-- sets minimums; a facility may be more generous and its own figures go here.
CREATE TABLE IF NOT EXISTS leave_types (
  code          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  -- Days a year. Null where the entitlement is per event rather than annual,
  -- like maternity or compassionate leave.
  annual_days   INTEGER,
  per_event_days INTEGER,
  paid          INTEGER NOT NULL DEFAULT 1,
  -- Whether unused days roll into next year. Annual leave usually does, in
  -- part; sick leave does not.
  carries_over  INTEGER NOT NULL DEFAULT 0,
  max_carry_days INTEGER,
  effective_from TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees(id),
  leave_code    TEXT NOT NULL REFERENCES leave_types(code),
  starts_on     TEXT NOT NULL,
  ends_on       TEXT NOT NULL,
  -- Working days, computed at request time and stored. Recomputing later under
  -- a changed calendar would change what somebody was charged.
  days          INTEGER NOT NULL,
  reason        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL CHECK (status IN ('requested','approved','declined','cancelled','taken')),
  -- Who is covering the work. Null is allowed, but it is recorded as a null
  -- rather than left unasked: a department with nobody covering is a fact the
  -- approver should have seen.
  cover_employee_id TEXT REFERENCES employees(id),
  cover_note    TEXT NOT NULL DEFAULT '',
  -- Set when the approver went ahead knowing nobody holds the same
  -- registration. The acknowledgement is the record.
  uncovered_ack TEXT NOT NULL DEFAULT '',
  decided_by    INTEGER REFERENCES users(id),
  decider_name  TEXT NOT NULL DEFAULT '',
  decided_at    TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  requested_by  INTEGER REFERENCES users(id),
  requester_name TEXT NOT NULL,
  requested_at  TEXT NOT NULL,
  device_code   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leave_emp ON leave_requests(employee_id, starts_on);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status, starts_on);

-- An adjustment to a leave balance that is not a request: an opening balance,
-- days bought out, days forfeited at year end. Kept separate so a balance is
-- always the sum of rows rather than a number somebody edited.
CREATE TABLE IF NOT EXISTS leave_adjustments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   TEXT NOT NULL REFERENCES employees(id),
  leave_code    TEXT NOT NULL REFERENCES leave_types(code),
  year          INTEGER NOT NULL,
  days          INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  by_user_id    INTEGER REFERENCES users(id),
  by_name       TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leaveadj_emp ON leave_adjustments(employee_id, year);

-- A disciplinary or grievance record. Kept because due process has dates, and
-- a facility that cannot show it followed them loses at the tribunal whatever
-- actually happened.
CREATE TABLE IF NOT EXISTS hr_cases (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees(id),
  kind          TEXT NOT NULL CHECK (kind IN ('disciplinary','grievance','performance')),
  summary       TEXT NOT NULL,
  raised_on     TEXT NOT NULL,
  -- The Employment Act requires notice and a hearing at which the employee may
  -- be accompanied. These dates are the proof it happened.
  notified_on   TEXT,
  heard_on      TEXT,
  accompanied_by TEXT NOT NULL DEFAULT '',
  outcome       TEXT CHECK (outcome IN
                  ('no_action','counselled','written_warning','final_warning','dismissed','upheld','not_upheld','withdrawn')),
  outcome_on    TEXT,
  outcome_note  TEXT NOT NULL DEFAULT '',
  opened_by     INTEGER REFERENCES users(id),
  opener_name   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hrcase_emp ON hr_cases(employee_id);

-- ============================================================================
-- M63 Assets & Maintenance
--
-- An asset register is the boring half. The half that matters is that some of
-- this equipment must not be used when a check is overdue, and one of it — the
-- vaccine fridge — can ruin everything inside it without anybody noticing.
-- ============================================================================

CREATE TABLE IF NOT EXISTS assets (
  id            TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  tag           TEXT NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'equipment'
                CHECK (category IN ('equipment','vehicle','furniture','building','it','cold_chain')),
  -- Where it is, in the words the facility uses. Free text because a theatre
  -- is called different things in different buildings.
  location      TEXT NOT NULL DEFAULT '',
  -- The store this asset holds stock for, where it is a fridge or a cabinet.
  -- Set on cold chain assets so a temperature excursion can reach the batches.
  store_code    TEXT REFERENCES stores(code),
  serial_no     TEXT NOT NULL DEFAULT '',
  manufacturer  TEXT NOT NULL DEFAULT '',
  model         TEXT NOT NULL DEFAULT '',
  -- Equipment whose failure stops clinical work. An overdue check on one of
  -- these is refused rather than warned about.
  critical      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'in_service'
                CHECK (status IN ('in_service','out_of_service','under_repair','disposed')),
  status_reason TEXT NOT NULL DEFAULT '',
  acquired_on   TEXT,
  cost_cents    INTEGER,
  -- Straight line, in months. Null where the facility does not depreciate it.
  useful_life_months INTEGER,
  supplier_code TEXT REFERENCES suppliers(code),
  warranty_until TEXT,
  service_contract TEXT NOT NULL DEFAULT '',
  disposed_on   TEXT,
  disposal_note TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  UNIQUE (facility_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_asset_status ON assets(facility_id, status);

-- What has to be done to an asset, how often, and what it is for. Calibration,
-- a pressure-vessel test, a radiation QA survey and an oil change are the same
-- shape; only the consequence of missing one differs.
CREATE TABLE IF NOT EXISTS maintenance_schedules (
  id            TEXT PRIMARY KEY,
  asset_id      TEXT NOT NULL REFERENCES assets(id),
  kind          TEXT NOT NULL CHECK (kind IN ('service','calibration','safety_test','inspection','licence')),
  name          TEXT NOT NULL,
  every_days    INTEGER NOT NULL,
  -- Who does it, and under what authority. A radiation QA survey has a
  -- regulator behind it; a filter change does not.
  regulator     TEXT NOT NULL DEFAULT '',
  -- When missing it stops the asset being used, rather than merely being late.
  blocks_use    INTEGER NOT NULL DEFAULT 0,
  last_done_on  TEXT,
  next_due_on   TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sched_due ON maintenance_schedules(next_due_on, active);

CREATE TABLE IF NOT EXISTS maintenance_records (
  id            TEXT PRIMARY KEY,
  asset_id      TEXT NOT NULL REFERENCES assets(id),
  schedule_id   TEXT REFERENCES maintenance_schedules(id),
  kind          TEXT NOT NULL,
  done_on       TEXT NOT NULL,
  -- A check that was done and FAILED is the most important row in this table,
  -- and a system that only records successful maintenance hides it.
  passed        INTEGER NOT NULL DEFAULT 1,
  findings      TEXT NOT NULL DEFAULT '',
  certificate   TEXT NOT NULL DEFAULT '',
  performed_by  TEXT NOT NULL DEFAULT '',
  cost_cents    INTEGER,
  created_by    INTEGER REFERENCES users(id),
  creator_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_maint_asset ON maintenance_records(asset_id, done_on);

-- A breakdown. Downtime is measured from when it was reported, not from when
-- somebody got round to writing a work order.
CREATE TABLE IF NOT EXISTS work_orders (
  id            TEXT PRIMARY KEY,
  asset_id      TEXT NOT NULL REFERENCES assets(id),
  fault         TEXT NOT NULL,
  reported_at   TEXT NOT NULL,
  reported_by   INTEGER REFERENCES users(id),
  reporter_name TEXT NOT NULL,
  -- Whether the asset is unusable while this is open. A noisy fan is not the
  -- same as a dead autoclave.
  out_of_service INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL CHECK (status IN ('open','in_progress','fixed','beyond_repair','cancelled')),
  assigned_to   TEXT NOT NULL DEFAULT '',
  -- Under warranty or a service contract, a bill is money the facility should
  -- not have paid.
  under_warranty INTEGER NOT NULL DEFAULT 0,
  cost_cents    INTEGER,
  resolution    TEXT NOT NULL DEFAULT '',
  closed_at     TEXT,
  device_code   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wo_asset ON work_orders(asset_id, status);

-- Cold chain readings. A vaccine fridge that went out of range for six hours
-- overnight has ruined what is inside it, and the only way anybody finds out
-- is if the reading is recorded and compared against a range.
CREATE TABLE IF NOT EXISTS temperature_readings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id      TEXT NOT NULL REFERENCES assets(id),
  -- Tenths of a degree, like every other temperature here.
  reading_tenths INTEGER NOT NULL,
  taken_at      TEXT NOT NULL,
  in_range      INTEGER NOT NULL,
  -- Set when this excursion caused the stock to be quarantined.
  excursion_action TEXT NOT NULL DEFAULT '',
  taken_by      INTEGER REFERENCES users(id),
  taker_name    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_temp_asset ON temperature_readings(asset_id, taken_at);

-- ============================================================ M64 Mortuary
--
-- The table that matters here is `bodies`, and the column that matters in it
-- is `tag_no`. A body is identified by its tag, and names are attached to tags
-- rather than the other way round: two men called John Mwangi arriving on the
-- same night is not a hypothetical, and the mistake it produces cannot be
-- undone after the burial.

-- A bay. One body each, because a system that lets two be recorded in the same
-- drawer is a system that has already lost one of them.
CREATE TABLE IF NOT EXISTS mortuary_units (
  code          TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  name          TEXT NOT NULL,
  -- The fridge itself, on the asset register, so its service schedule and its
  -- faults live where every other piece of equipment's do.
  asset_id      TEXT REFERENCES assets(id),
  bays          INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bodies (
  id            TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  -- Sequential per facility per year, painted on the tag that goes on the body.
  tag_no        TEXT NOT NULL,
  -- Present when the deceased was a patient here. Absent for a body brought in
  -- from outside, which is most of them in a Level 2 clinic.
  patient_mrn   TEXT REFERENCES patients(mrn),
  given_name    TEXT NOT NULL DEFAULT '',
  family_name   TEXT NOT NULL DEFAULT '',
  sex           TEXT CHECK (sex IN ('female','male','unknown')),
  age_years     INTEGER,
  -- confirmed: somebody who knew them has viewed and signed.
  -- provisional: a name was given at the door and nobody has confirmed it.
  -- unknown: nobody knows who this is.
  identity      TEXT NOT NULL DEFAULT 'provisional'
                CHECK (identity IN ('confirmed','provisional','unknown')),
  source        TEXT NOT NULL CHECK (source IN ('ward','casualty','theatre','maternity','brought_in','transferred_in')),
  died_at       TEXT,
  place_of_death TEXT NOT NULL DEFAULT '',
  received_at   TEXT NOT NULL,
  received_by   INTEGER REFERENCES users(id),
  receiver_name TEXT NOT NULL,
  unit_code     TEXT REFERENCES mortuary_units(code),
  -- A death that is a police matter. The body is evidence, and it is not
  -- released to anybody on the strength of a relative asking.
  medico_legal  INTEGER NOT NULL DEFAULT 0,
  police_ob_no  TEXT NOT NULL DEFAULT '',
  investigating_officer TEXT NOT NULL DEFAULT '',
  postmortem_required INTEGER NOT NULL DEFAULT 0,
  postmortem_at TEXT,
  pathologist   TEXT NOT NULL DEFAULT '',
  postmortem_findings TEXT NOT NULL DEFAULT '',
  cause_of_death TEXT NOT NULL DEFAULT '',
  cause_code    TEXT,
  certified_by  TEXT NOT NULL DEFAULT '',
  certified_at  TEXT,
  -- The reference on the death notification (Cap 149). The family needs it to
  -- get a burial permit, and a facility that cannot produce it has made the
  -- next fortnight of somebody's grief much worse.
  notification_ref TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'in_store'
                CHECK (status IN ('in_store','released','transferred_out','disposed')),
  released_at   TEXT,
  released_to_name TEXT NOT NULL DEFAULT '',
  released_to_id TEXT NOT NULL DEFAULT '',
  released_to_relationship TEXT NOT NULL DEFAULT '',
  release_authority TEXT NOT NULL DEFAULT '',
  released_by   INTEGER REFERENCES users(id),
  releaser_name TEXT NOT NULL DEFAULT '',
  -- Set when a release went ahead without a notification reference. It is
  -- allowed, and it is never silent.
  release_override TEXT NOT NULL DEFAULT '',
  fee_cents     INTEGER NOT NULL DEFAULT 0,
  waived_cents  INTEGER NOT NULL DEFAULT 0,
  waiver_reason TEXT NOT NULL DEFAULT '',
  paid_cents    INTEGER NOT NULL DEFAULT 0,
  device_code   TEXT,
  created_at    TEXT NOT NULL
);
-- The tag is unique per facility, and a released body keeps its tag: a tag
-- number is a permanent reference to one body, not a reusable slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_body_tag ON bodies(facility_id, tag_no);
CREATE INDEX IF NOT EXISTS idx_body_status ON bodies(facility_id, status, received_at);
-- One body per bay, and only while it is in store.
CREATE INDEX IF NOT EXISTS idx_body_unit ON bodies(unit_code, status);

-- Everything that happened to a body, in order. A viewing, a postmortem, an
-- embalming, a release. Append-only: the register a coroner or a family's
-- advocate asks for is the one nobody could edit.
CREATE TABLE IF NOT EXISTS body_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  body_id       TEXT NOT NULL REFERENCES bodies(id),
  kind          TEXT NOT NULL,
  detail        TEXT NOT NULL DEFAULT '',
  -- Who was present and who they said they were. On a viewing this is the
  -- identification itself.
  person_name   TEXT NOT NULL DEFAULT '',
  person_id     TEXT NOT NULL DEFAULT '',
  relationship  TEXT NOT NULL DEFAULT '',
  happened_at   TEXT NOT NULL,
  recorded_by   INTEGER REFERENCES users(id),
  recorder_name TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_body_event ON body_events(body_id, happened_at);

-- =============================================== M12 Biometric Verification
--
-- Biometric data is a special category under the Data Protection Act 2019.
-- Two things follow, and both are structural rather than procedural:
--
--   NO IMAGE IS EVER STORED. What is kept is a reference to a template the
--   reader produced, and the format it is in. A fingerprint image in a hospital
--   database is a liability nobody needs and a breach nobody can remediate —
--   a person cannot be issued with a new thumb.
--
--   MATCHING HAPPENS ON THE READER. This system records the score the device
--   returned and the threshold it was set to. It does not implement matching,
--   and a score here is evidence of what a device said, not a claim this
--   software can verify.

CREATE TABLE IF NOT EXISTS biometric_readers (
  code          TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  label         TEXT NOT NULL,
  make          TEXT NOT NULL DEFAULT '',
  model         TEXT NOT NULL DEFAULT '',
  -- The template format and the matching algorithm the device uses. A template
  -- captured on one vendor's reader does not match on another's, and a facility
  -- that changes vendor re-enrols everybody. Writing it down is how that is
  -- discovered before the contract is signed rather than after.
  template_format TEXT NOT NULL DEFAULT '',
  algorithm     TEXT NOT NULL DEFAULT '',
  -- The score at or above which this device calls it a match, as configured.
  threshold     INTEGER NOT NULL DEFAULT 40,
  -- 'demo' means no hardware: captures are simulated and every verification it
  -- produces is marked as such and can never be cited as evidence.
  mode          TEXT NOT NULL DEFAULT 'demo' CHECK (mode IN ('demo','live')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS biometric_enrolments (
  id            TEXT PRIMARY KEY,
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  finger        TEXT NOT NULL,
  -- An opaque reference to the template, never an image and never a raw
  -- template. It is deliberately useless to anybody who copies this table.
  template_ref  TEXT NOT NULL,
  template_format TEXT NOT NULL DEFAULT '',
  algorithm     TEXT NOT NULL DEFAULT '',
  -- What the reader said about the capture, 0-100. A poor capture enrolled is a
  -- patient who fails verification every visit afterwards.
  quality       INTEGER,
  reader_code   TEXT REFERENCES biometric_readers(code),
  -- Captured on a reader in demo mode. Never usable as evidence.
  demo          INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','withdrawn')),
  withdrawn_at  TEXT,
  withdrawn_reason TEXT NOT NULL DEFAULT '',
  captured_at   TEXT NOT NULL,
  captured_by   INTEGER REFERENCES users(id),
  capturer_name TEXT NOT NULL,
  device_code   TEXT,
  created_at    TEXT NOT NULL
);
-- One active enrolment per finger. A re-capture supersedes rather than
-- duplicates, so there is never a question of which template is current.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bio_finger
  ON biometric_enrolments(patient_mrn, finger) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_bio_patient ON biometric_enrolments(patient_mrn, status);

-- Every attempt, matched or not. The failures are the important rows: a patient
-- who fails verification three visits running has a bad enrolment, and nobody
-- finds that out from a table that only keeps the successes.
CREATE TABLE IF NOT EXISTS biometric_verifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  purpose       TEXT NOT NULL,
  enrolment_id  TEXT REFERENCES biometric_enrolments(id),
  finger        TEXT NOT NULL DEFAULT '',
  reader_code   TEXT REFERENCES biometric_readers(code),
  matched       INTEGER NOT NULL,
  score         INTEGER,
  threshold     INTEGER,
  demo          INTEGER NOT NULL DEFAULT 0,
  -- How identity was established when the finger did not do it. Care is never
  -- refused for a failed match.
  fallback      TEXT NOT NULL DEFAULT '',
  attempted_at  TEXT NOT NULL,
  attempted_by  INTEGER REFERENCES users(id),
  attempter_name TEXT NOT NULL,
  device_code   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bio_verif ON biometric_verifications(patient_mrn, attempted_at);

-- Why this patient has no fingerprint on file. An infant, a mason whose ridges
-- are worn flat, an amputee, somebody with leprosy, or somebody who said no.
-- A system that requires a fingerprint denies care to exactly the people least
-- able to argue with it, so the exception is a first-class record rather than
-- a blank row.
CREATE TABLE IF NOT EXISTS biometric_exceptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  reason        TEXT NOT NULL CHECK (reason IN ('infant','worn_ridges','amputation','disease','refused','no_reader','other')),
  note          TEXT NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  recorded_at   TEXT NOT NULL,
  recorded_by   INTEGER REFERENCES users(id),
  recorder_name TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bio_exception ON biometric_exceptions(patient_mrn, active);

-- ==================================================== M31 Analyser Interface
--
-- A laboratory analyser is the one device in a clinic that generates clinical
-- facts by itself. Three things follow from that, and all three are in the
-- shape of these tables:
--
--   THE RAW MESSAGE IS KEPT VERBATIM. When a result is disputed months later,
--   the question is what the machine actually said, and a parsed row cannot
--   answer it.
--
--   A RESULT FOR A SPECIMEN NOBODY ORDERED IS HELD, NOT FILED. It is not
--   discarded either — it is somebody's blood.
--
--   NOTHING THE MACHINE SENDS IS RELEASED. It arrives preliminary and a
--   licensed technologist turns it into a result, exactly as if it had been
--   typed.

CREATE TABLE IF NOT EXISTS analysers (
  code          TEXT PRIMARY KEY,
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  name          TEXT NOT NULL,
  make          TEXT NOT NULL DEFAULT '',
  model         TEXT NOT NULL DEFAULT '',
  -- 'astm' (E1381/E1394) or 'hl7' (v2.x ORU^R01). Everything else is a driver
  -- that has not been written.
  protocol      TEXT NOT NULL CHECK (protocol IN ('astm','hl7')),
  -- Where it is plugged in, as a note. No serial port is opened from here.
  connection    TEXT NOT NULL DEFAULT '',
  -- The asset register entry for the machine itself, so its service schedule
  -- and its faults live where every other piece of equipment's do.
  asset_id      TEXT REFERENCES assets(id),
  -- 'demo' means no machine: messages are ones somebody pasted in or the
  -- simulator produced, and every result it files says so.
  mode          TEXT NOT NULL DEFAULT 'demo' CHECK (mode IN ('demo','live')),
  active        INTEGER NOT NULL DEFAULT 1,
  last_seen_at  TEXT,
  created_at    TEXT NOT NULL
);

-- What the analyser calls a test, and what this system calls it. Without this
-- mapping every message is an exception, and it is the single thing that takes
-- longest to get right when an analyser is installed.
CREATE TABLE IF NOT EXISTS analyser_tests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  analyser_code TEXT NOT NULL REFERENCES analysers(code),
  -- The code in the machine's own message.
  their_code    TEXT NOT NULL,
  -- The analyte in this system.
  analyte       TEXT NOT NULL,
  -- The unit the machine reports in. A result in different units silently
  -- accepted is how a glucose of 5.5 becomes a glucose of 99.
  their_unit    TEXT NOT NULL DEFAULT '',
  -- Multiply the machine's number by this to get our unit. 1 means the same
  -- unit; null means no conversion is known and results are held.
  factor        REAL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_analyser_test
  ON analyser_tests(analyser_code, their_code) WHERE active = 1;

CREATE TABLE IF NOT EXISTS analyser_messages (
  id            TEXT PRIMARY KEY,
  analyser_code TEXT NOT NULL REFERENCES analysers(code),
  direction     TEXT NOT NULL CHECK (direction IN ('in','out')),
  -- Exactly what came off the wire. Never rewritten, never normalised.
  raw           TEXT NOT NULL,
  -- 'accepted', 'held' (something needs a person), 'rejected' (bad frame).
  status        TEXT NOT NULL CHECK (status IN ('accepted','held','rejected')),
  note          TEXT NOT NULL DEFAULT '',
  results       INTEGER NOT NULL DEFAULT 0,
  held          INTEGER NOT NULL DEFAULT 0,
  received_at   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analyser_msg ON analyser_messages(analyser_code, received_at);

-- A reading the interface could not file. It is not discarded — it is
-- somebody's blood, and the commonest cause is a specimen barcode typed wrong
-- at the bench, which a person can fix in ten seconds if they are told.
CREATE TABLE IF NOT EXISTS analyser_exceptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id    TEXT NOT NULL REFERENCES analyser_messages(id),
  analyser_code TEXT NOT NULL REFERENCES analysers(code),
  specimen_ref  TEXT NOT NULL DEFAULT '',
  their_code    TEXT NOT NULL DEFAULT '',
  analyte       TEXT NOT NULL DEFAULT '',
  value_text    TEXT NOT NULL DEFAULT '',
  unit          TEXT NOT NULL DEFAULT '',
  reason        TEXT NOT NULL,
  resolved_at   TEXT,
  resolution    TEXT NOT NULL DEFAULT '',
  resolved_by   INTEGER REFERENCES users(id),
  resolver_name TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analyser_exception ON analyser_exceptions(analyser_code, resolved_at);

-- Quality control readings. A control is not a patient and must never be filed
-- against one, so it has its own table rather than a flag on a result.
CREATE TABLE IF NOT EXISTS analyser_qc (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  analyser_code TEXT NOT NULL REFERENCES analysers(code),
  message_id    TEXT REFERENCES analyser_messages(id),
  control_ref   TEXT NOT NULL,
  analyte       TEXT NOT NULL,
  value_milli   INTEGER,
  unit          TEXT NOT NULL DEFAULT '',
  -- What the control is supposed to read, and how far out it may be.
  target_milli  INTEGER,
  tolerance_milli INTEGER,
  in_range      INTEGER,
  run_at        TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analyser_qc ON analyser_qc(analyser_code, run_at);

-- =============================================== M73 Patient Portal (SMS/USSD)
--
-- Most patients at a Level 2 clinic in Nairobi have a feature phone, and data
-- costs money they would rather spend on something else. A portal that needs a
-- smartphone and a browser serves the patients who need it least, so what is
-- modelled here is content short enough to be a text message, reached with a
-- code sent to the phone already on the record.

CREATE TABLE IF NOT EXISTS portal_accounts (
  patient_mrn   TEXT PRIMARY KEY REFERENCES patients(mrn),
  -- Normalised the same way the patient index normalises it, so the number the
  -- clinic already has is the number that works.
  phone         TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','ussd','web')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  -- Preferred language for what is sent. English and Kiswahili are what a
  -- Nairobi clinic needs first.
  language      TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','sw')),
  enrolled_at   TEXT NOT NULL,
  enrolled_by   INTEGER REFERENCES users(id),
  enroller_name TEXT NOT NULL,
  revoked_at    TEXT,
  revoked_reason TEXT NOT NULL DEFAULT '',
  last_seen_at  TEXT,
  created_at    TEXT NOT NULL
);

-- One-time codes. Never stored in the clear: a table of live codes is a table
-- that opens every patient record in the clinic if it is ever copied.
CREATE TABLE IF NOT EXISTS portal_codes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  code_hash     TEXT NOT NULL,
  sent_to       TEXT NOT NULL,
  issued_at     TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  used_at       TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portal_code ON portal_codes(patient_mrn, expires_at);

-- Somebody else reading a patient's record with permission: a mother for a
-- small child, a son for an elderly parent. Time-limited and revocable, and
-- never open-ended.
CREATE TABLE IF NOT EXISTS portal_proxies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  proxy_name    TEXT NOT NULL,
  proxy_phone   TEXT NOT NULL,
  proxy_id_no   TEXT NOT NULL DEFAULT '',
  relationship  TEXT NOT NULL,
  granted_until TEXT NOT NULL,
  granted_at    TEXT NOT NULL,
  granted_by    INTEGER REFERENCES users(id),
  granter_name  TEXT NOT NULL,
  revoked_at    TEXT,
  revoked_reason TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portal_proxy ON portal_proxies(patient_mrn, revoked_at);

-- What the patient was actually shown, and when. The audit log records the
-- read; this is the part the patient can be shown about their own record, which
-- is a different thing and a right under the Act.
CREATE TABLE IF NOT EXISTS portal_views (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  section       TEXT NOT NULL,
  by_proxy      INTEGER NOT NULL DEFAULT 0,
  proxy_name    TEXT NOT NULL DEFAULT '',
  items         INTEGER NOT NULL DEFAULT 0,
  withheld      INTEGER NOT NULL DEFAULT 0,
  viewed_at     TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portal_view ON portal_views(patient_mrn, viewed_at);

-- ===================================================== M74 Telemedicine
--
-- A remote consultation is a consultation. It hangs off the same encounter, is
-- written in the same notes, needs the same coded diagnosis and goes on the
-- same claim — because a parallel record is how one patient ends up with two
-- histories and a clinician reads the wrong one.
--
-- What this table adds is the part that is different: how the person at the
-- other end was identified, whether they agreed to be seen this way, whether
-- the call held up, and whether what was found should have been seen in person.

CREATE TABLE IF NOT EXISTS tele_sessions (
  id            TEXT PRIMARY KEY,
  encounter_id  TEXT NOT NULL REFERENCES encounters(id),
  patient_mrn   TEXT NOT NULL REFERENCES patients(mrn),
  appointment_id TEXT REFERENCES appointments(id),
  clinician_id  INTEGER REFERENCES users(id),
  clinician_name TEXT NOT NULL,
  -- The registration the clinician held on the day, copied here the same way an
  -- encounter copies it: a claim cites it, and a council asks about it.
  clinician_licence TEXT NOT NULL DEFAULT '',
  channel       TEXT NOT NULL CHECK (channel IN ('video','voice','chat')),
  -- Which third-party service carried it. No video is carried by this system.
  platform      TEXT NOT NULL DEFAULT '',
  -- How the person at the other end was shown to be who they said they were.
  identity_method TEXT NOT NULL,
  identity_note TEXT NOT NULL DEFAULT '',
  -- Consent to being seen remotely is its own consent, recorded per session
  -- because the answer can be no today and yes next week.
  consent_at    TEXT,
  consent_by    TEXT NOT NULL DEFAULT '',
  scheduled_at  TEXT,
  started_at    TEXT,
  ended_at      TEXT,
  -- What the clinician says of the line. A consultation conducted through a
  -- call that kept breaking is a consultation with gaps in it.
  quality       TEXT CHECK (quality IN ('good','poor','failed')),
  outcome       TEXT CHECK (outcome IN ('completed','patient_absent','failed_connection','converted_to_visit','cancelled')),
  outcome_note  TEXT NOT NULL DEFAULT '',
  -- A presenting complaint this system says should be seen in person, and what
  -- the clinician did about it.
  red_flag      TEXT NOT NULL DEFAULT '',
  red_flag_action TEXT NOT NULL DEFAULT '',
  device_code   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tele_patient ON tele_sessions(patient_mrn, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tele_encounter ON tele_sessions(encounter_id);

-- ============================================== M75 Configuration Studio
--
-- Half the ⚠️ and 🔴 rows in the clinical review register are not "this is
-- wrong", they are "nobody has confirmed this". The most valuable thing this
-- table holds is therefore not a changed value — it is a record that a named
-- clinician looked at a seeded convention and said yes.

CREATE TABLE IF NOT EXISTS config_values (
  key           TEXT PRIMARY KEY,
  -- Always a string on the way in and out. The registry says what it means.
  value         TEXT NOT NULL,
  -- Where the facility got the number. Required for anything clinical: a
  -- threshold changed without a source is a threshold nobody can defend.
  source        TEXT NOT NULL DEFAULT '',
  reason        TEXT NOT NULL DEFAULT '',
  set_at        TEXT NOT NULL,
  set_by        INTEGER REFERENCES users(id),
  setter_name   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- "A clinician read this and kept it as it is" — a state of its own, and the
-- one the review register is actually asking for most of the time.
CREATE TABLE IF NOT EXISTS config_reviews (
  key           TEXT PRIMARY KEY,
  -- The value that was reviewed. If it changes afterwards, the review is stale
  -- and says so rather than quietly vouching for a number nobody read.
  reviewed_value TEXT NOT NULL,
  reviewer_name TEXT NOT NULL,
  reviewer_role TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  reviewed_at   TEXT NOT NULL,
  reviewed_by   INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL
);

-- Append-only. A threshold that was 40 last year is what a case from last year
-- was judged against, and a register that only holds today's number cannot
-- answer the question anybody will actually ask.
CREATE TABLE IF NOT EXISTS config_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('changed','reviewed','reset')),
  old_value     TEXT NOT NULL DEFAULT '',
  new_value     TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT '',
  reason        TEXT NOT NULL DEFAULT '',
  actor_name    TEXT NOT NULL,
  actor_id      INTEGER REFERENCES users(id),
  happened_at   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_config_history ON config_history(key, happened_at);

-- What a room or a modality cannot work without.
--
-- `usable()` answers "may this asset be used" and, until this table existed,
-- nothing asked it — which made an overdue pressure test a screen rather than a
-- control. A theatre names the autoclave it depends on, an imaging modality
-- names the machine, and the worklist for each asks before it says a case is
-- ready.
CREATE TABLE IF NOT EXISTS equipment_dependencies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 'theatre' with a theatre code, or 'modality' with an imaging modality.
  kind          TEXT NOT NULL CHECK (kind IN ('theatre','modality','store')),
  ref           TEXT NOT NULL,
  asset_id      TEXT NOT NULL REFERENCES assets(id),
  -- What it is needed for, in the words the list would use.
  why           TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_dep ON equipment_dependencies(kind, ref, asset_id);
