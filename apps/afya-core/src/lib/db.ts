/**
 * Database access.
 *
 * Node's built-in SQLite. A Level 2 clinic has no database administrator and
 * often no reliable power, so the facility's records live in one file that can
 * be copied, backed up or carried out on a stick. This is also what makes the
 * system genuinely offline-first: there is no server to be unable to reach.
 *
 * The cloud tier (a network running branches, Phase 4) syncs these files
 * upstream rather than replacing them — the facility node stays authoritative
 * for its own care, which is the only arrangement that keeps a clinic working
 * through an outage.
 *
 * Everything that must be attributable goes through `audit()`, which maintains
 * the hash chain. Writing to `audit_log` by any other route breaks it.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const DB_PATH = process.env.AFYA_DB ?? join(process.cwd(), "data", "afya.db");

/** Baseline migration id. Later phases append rather than edit this one. */
export const BASELINE = "0001-phase0-platform-identity-audit";

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (_db) return _db;

  mkdirSync(dirname(DB_PATH), { recursive: true });

  const conn = new DatabaseSync(DB_PATH);
  // WAL keeps reads working while a write is in flight — a clinic has the
  // receptionist registering while the clinician is saving a consultation.
  conn.exec("PRAGMA journal_mode = WAL");
  conn.exec("PRAGMA foreign_keys = ON");

  const schemaPath = process.env.AFYA_SCHEMA ?? join(process.cwd(), "src", "lib", "schema.sql");
  conn.exec(readFileSync(schemaPath, "utf8"));

  addColumns(conn);

  _db = conn;

  const applied = conn
    .prepare(`SELECT version FROM schema_migrations WHERE version = ?`)
    .get(BASELINE);
  if (!applied) {
    conn
      .prepare(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`)
      .run(BASELINE, now());
  }

  return conn;
}

/**
 * Columns added after a facility's database already existed.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that is already there,
 * so a new column would never reach an installed clinic. These run every start,
 * guarded by what the table actually has — there is no downtime and no dump and
 * reload, which matters when the database is a file on a clinic's one machine.
 *
 * Additive only: a column is added with a default, never dropped or retyped.
 * Anything that cannot be expressed this way needs a numbered migration.
 */
function addColumns(conn: DatabaseSync): void {
  const additions: { table: string; column: string; ddl: string }[] = [
    { table: "benefit_rules", column: "required_documents", ddl: "TEXT NOT NULL DEFAULT ''" },
  ];

  for (const a of additions) {
    const present = conn
      .prepare(`SELECT name FROM pragma_table_info(?) WHERE name = ?`)
      .get(a.table, a.column);
    if (!present) conn.exec(`ALTER TABLE ${a.table} ADD COLUMN ${a.column} ${a.ddl}`);
  }
}

/** Reset the module-level handle — used by tests that swap the database file. */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ------------------------------------------------------------------- time

/**
 * The single source of "now", as UTC ISO-8601.
 *
 * Centralised so tests can freeze it and so the 7-day claim clock, licence
 * expiry and session timeout all agree. Never call `new Date()` directly in a
 * service module.
 */
export function now(): string {
  return new Date().toISOString();
}

/** Today as a UTC ISO date (YYYY-MM-DD), for comparing against expiry dates. */
export function today(): string {
  return now().slice(0, 10);
}

// -------------------------------------------------------------- query helpers

type Param = string | number | bigint | null | Uint8Array;

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]): { lastInsertRowid: number; changes: number } {
  const r = db().prepare(sql).run(...params);
  return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) };
}

let txDepth = 0;

/**
 * Run `fn` in a transaction, rolling back if it throws.
 *
 * SQLite has no nested transactions, so a nested call JOINS the outer one
 * rather than opening its own: the outermost `tx` decides whether everything
 * commits. This matters because service functions compose — closing an
 * encounter signs the note, requesting a pre-authorisation records the payer's
 * answer — and neither caller should have to know whether it is already inside
 * a transaction.
 *
 * The consequence is deliberate and is the behaviour you want: if the outer
 * unit of work fails, the inner writes go too. A consultation that did not
 * close must not leave a signature behind saying it did.
 */
export function tx<T>(fn: () => T): T {
  const conn = db();

  if (txDepth > 0) {
    // Already inside one. A throw propagates and the outermost frame rolls the
    // whole thing back, so there is nothing to do here but run.
    txDepth++;
    try {
      return fn();
    } finally {
      txDepth--;
    }
  }

  conn.exec("BEGIN");
  txDepth = 1;
  try {
    const result = fn();
    txDepth = 0;
    conn.exec("COMMIT");
    return result;
  } catch (err) {
    txDepth = 0;
    conn.exec("ROLLBACK");
    throw err;
  }
}

// --------------------------------------------------------------- audit chain

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | number | null;
  /** Set whenever the entry concerns an identifiable patient — reads included. */
  patientId?: string | null;
  /** Why the data was touched. Defaults to treatment. */
  purpose?: "treatment" | "billing" | "claim" | "audit" | "support" | "administration";
  actorId?: number | null;
  actorName?: string;
  facilityId?: number | null;
  deviceCode?: string | null;
  /** Must never carry a secret. See `SECRET_KEYS`. */
  detail?: Record<string, unknown>;
}

/**
 * Keys that must never reach the audit log. The log is the artefact most likely
 * to be exported, emailed to an auditor and read by someone with no business
 * seeing a credential, so this is enforced rather than documented.
 */
const SECRET_KEYS = /^(password|pin|passwordHash|pin_hash|password_hash|token|secret|mfa|mfa_secret|otp)$/i;

export class AuditError extends Error {}

function canonical(parts: (string | number | null | undefined)[]): string {
  // Tab-joined with nulls as the empty string. Fixed field order, so the digest
  // is reproducible by anyone verifying an exported log.
  return parts.map((p) => (p === null || p === undefined ? "" : String(p))).join("\t");
}

function digest(prevHash: string, row: (string | number | null | undefined)[]): string {
  return createHash("sha256").update(prevHash).update("\n").update(canonical(row)).digest("hex");
}

/**
 * Append one entry to the audit log and extend the hash chain.
 *
 * Call inside the same transaction as the change it describes, so a change can
 * never commit without its audit entry.
 */
export function audit(entry: AuditEntry): number {
  const detail = entry.detail ?? {};
  for (const key of Object.keys(detail)) {
    if (SECRET_KEYS.test(key)) {
      throw new AuditError(`refusing to write secret-bearing key "${key}" to the audit log`);
    }
  }

  const prev = get<{ hash: string }>(`SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1`);
  const prevHash = prev?.hash ?? "";

  const at = now();
  // 0 is never a valid rowid, so a caller passing it means "no user" — a seed,
  // a migration, a scheduled job. Coerced rather than rejected because the
  // alternative is a foreign-key error that rolls back the real work and tells
  // nobody why.
  const actorId = entry.actorId ? entry.actorId : null;
  const actorName = entry.actorName ?? "system";
  const facilityId = entry.facilityId ?? null;
  const entityId = entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId);
  const patientId = entry.patientId ?? null;
  const purpose = entry.purpose ?? "treatment";
  const deviceCode = entry.deviceCode ?? null;
  const detailJson = JSON.stringify(detail);

  const hash = digest(prevHash, [
    at,
    facilityId,
    actorId,
    actorName,
    entry.action,
    entry.entity,
    entityId,
    patientId,
    purpose,
    deviceCode,
    detailJson,
  ]);

  const { lastInsertRowid } = run(
    `INSERT INTO audit_log
       (at, facility_id, actor_id, actor_name, action, entity, entity_id,
        patient_id, purpose, device_code, detail, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    at,
    facilityId,
    actorId,
    actorName,
    entry.action,
    entry.entity,
    entityId,
    patientId,
    purpose,
    deviceCode,
    detailJson,
    prevHash,
    hash,
  );
  return lastInsertRowid;
}

export interface AuditRow {
  id: number;
  at: string;
  facility_id: number | null;
  actor_id: number | null;
  actor_name: string;
  action: string;
  entity: string;
  entity_id: string | null;
  patient_id: string | null;
  purpose: string;
  device_code: string | null;
  detail: string;
  prev_hash: string;
  hash: string;
}

export type ChainResult =
  | { ok: true; checked: number }
  | { ok: false; checked: number; failedAtId: number; reason: "content-altered" | "chain-broken" | "row-missing" };

/**
 * Walk the audit log and confirm nobody has edited or removed history.
 *
 * Recomputes each row's digest from its own fields and its predecessor's hash.
 * An altered row fails on its own content; a deleted row breaks its successor's
 * link. This is what turns "immutable" into something demonstrable to an
 * inspector, and it is cheap enough to run on every audit-pack export.
 */
export function verifyAuditChain(): ChainResult {
  const rows = all<AuditRow>(`SELECT * FROM audit_log ORDER BY id ASC`);

  let prevHash = "";
  let previousId = 0;

  for (const row of rows) {
    if (row.prev_hash !== prevHash) {
      // The link does not point at the row we actually have before it: either a
      // row was removed, or one was spliced in.
      return {
        ok: false,
        checked: row.id,
        failedAtId: row.id,
        reason: previousId === 0 || row.id === previousId + 1 ? "chain-broken" : "row-missing",
      };
    }

    const expected = digest(prevHash, [
      row.at,
      row.facility_id,
      row.actor_id,
      row.actor_name,
      row.action,
      row.entity,
      row.entity_id,
      row.patient_id,
      row.purpose,
      row.device_code,
      row.detail,
    ]);

    if (expected !== row.hash) {
      return { ok: false, checked: row.id, failedAtId: row.id, reason: "content-altered" };
    }

    prevHash = row.hash;
    previousId = row.id;
  }

  return { ok: true, checked: rows.length };
}
