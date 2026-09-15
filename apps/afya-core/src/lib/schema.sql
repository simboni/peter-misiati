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
