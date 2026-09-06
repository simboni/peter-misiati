/**
 * Opening the file the shop has been trading on.
 *
 * Every other test in this suite starts from an empty database, which is the
 * one shape that cannot catch a migration bug: a fresh file gets its columns
 * from `CREATE TABLE`, so anything schema.sql says about them is true by the
 * time it is read. The shop's file is the opposite — its tables already exist,
 * `CREATE TABLE IF NOT EXISTS` does nothing to them, and only `migrate()` can
 * change their shape.
 *
 * That gap took the whole POS down for the length of one deploy: an index in
 * schema.sql named a column that ADDED_COLUMNS had not yet created, SQLite
 * refused the statement, the exec threw, and every screen answered 500 — on the
 * shop's file only, while a developer's copy worked perfectly.
 *
 * So this file builds a database WITHOUT the newer columns and opens it the way
 * the container does on boot.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = mkdtempSync(join(tmpdir(), "mig-"));
process.env.RIZIKI_DB = join(DIR, "t.db");

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const { db, closeDb } = await import("../src/lib/db.ts");

/** Every column ADDED_COLUMNS is responsible for, as `table.column`. */
const ADDED: Array<[string, string]> = [
  ["items", "price_basis"],
  ["items", "ceiling_cents"],
  ["sale_lines", "rate_cents"],
  ["sale_lines", "list_price_cents"],
  ["sale_lines", "bundle_id"],
  ["quote_lines", "list_price_cents"],
  ["quote_lines", "qty_milli"],
  ["quote_lines", "rate_cents"],
  ["quote_lines", "bundle_id"],
  ["purchase_lines", "size_milli"],
  ["formula_versions", "ref_unit"],
  ["formulas", "output_item_id"],
  ["batches", "output_item_id"],
  ["batch_lines", "item_id"],
];

/**
 * A database as it stood before any of those columns existed.
 *
 * Built by opening normally — which creates everything — and then dropping the
 * migration's own columns back off. What is left is the shape a till that has
 * not been updated in months is actually carrying.
 */
function buildOldShape(path: string): Array<[string, string]> {
  const fresh = new DatabaseSync(path);
  fresh.exec(readFileSync(join(process.cwd(), "src/lib/schema.sql"), "utf8"));

  const removed: Array<[string, string]> = [];
  for (const [table, column] of ADDED) {
    const cols = (fresh.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
      .map((c) => c.name);
    if (!cols.includes(column)) continue;
    // An index on the column has to go first, or the drop is refused.
    const idx = fresh
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`)
      .all(table) as Array<{ name: string; sql: string | null }>;
    for (const i of idx) {
      if (i.sql && i.sql.includes(column)) fresh.exec(`DROP INDEX IF EXISTS ${i.name}`);
    }
    try {
      fresh.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      removed.push([table, column]);
    } catch {
      /*
        SQLite will not drop a column from a table an append-only trigger
        guards — it re-parses the trigger body and gives up. `sale_lines` and
        `price_changes` are in that position.

        Not a problem for what this test is for: the columns that caused the
        outage are on `formulas`, `batches` and `batch_lines`, none of which
        carry triggers, and those come off cleanly. The assertion below only
        claims what was actually taken away.
      */
    }
  }
  fresh.close();
  return removed;
}

test("a database missing the migrated columns still opens", () => {
  const path = join(DIR, "old.db");
  const removed = buildOldShape(path);

  const before = new DatabaseSync(path);
  const has = (t: string, c: string) =>
    (before.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>)
      .some((r) => r.name === c);
  // The three that took the shop down, specifically.
  assert.equal(has("formulas", "output_item_id"), false, "the old shape really is old");
  assert.equal(has("batches", "output_item_id"), false);
  assert.equal(has("batch_lines", "item_id"), false);
  before.close();

  // The moment of truth: this is what the container does on boot.
  process.env.RIZIKI_DB = path;
  closeDb();
  const conn = db();

  for (const [table, column] of removed) {
    const cols = (conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
      .map((c) => c.name);
    assert.ok(cols.includes(column), `${table}.${column} should have been added back on open`);
  }
});

test("the indexes on migrated columns are created too", () => {
  const conn = db();
  const names = (
    conn.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as Array<{ name: string }>
  ).map((r) => r.name);

  for (const wanted of ["idx_formulas_output", "idx_batches_output", "idx_batch_lines_item"]) {
    assert.ok(names.includes(wanted), `${wanted} should exist after migrating`);
  }
});

test("opening the same file twice changes nothing and throws nothing", () => {
  // Idempotency is what makes a container restart safe.
  closeDb();
  const conn = db();
  const count = (
    conn.prepare(`SELECT COUNT(*) AS n FROM sqlite_master`).get() as { n: number }
  ).n;
  closeDb();
  const again = db();
  const count2 = (
    again.prepare(`SELECT COUNT(*) AS n FROM sqlite_master`).get() as { n: number }
  ).n;
  assert.equal(count2, count, "a second open must add nothing and drop nothing");
});

test("no index in schema.sql names a column that only the migration creates", () => {
  /*
    The check that would have caught the outage before it shipped, read straight
    off the source rather than off a database: schema.sql runs before migrate(),
    so an index in it may only name columns its own CREATE TABLE carries.
  */
  const schema = readFileSync(join(process.cwd(), "src/lib/schema.sql"), "utf8");

  const offenders: string[] = [];
  for (const m of schema.matchAll(/CREATE INDEX[^;]*?ON\s+(\w+)\s*\(([^)]*)\)/gi)) {
    const [, table, cols] = m;
    for (const [t, c] of ADDED) {
      if (t !== table) continue;
      if (new RegExp(`\\b${c}\\b`).test(cols)) offenders.push(`${table}(${c})`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `schema.sql indexes a column the migration adds later: ${offenders.join(", ")}. ` +
      `Move it to ADDED_INDEXES in db.ts.`,
  );
});
