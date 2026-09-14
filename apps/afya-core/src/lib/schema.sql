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
