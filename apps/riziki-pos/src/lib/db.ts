/**
 * Database access. Node's built-in SQLite — no external service to configure,
 * so the shop's data lives in one file that can be copied, backed up or emailed.
 *
 * Everything that changes stock goes through `postMovement` or a transaction
 * that calls it, so the ledger can never be bypassed.
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export type Role = "owner" | "staff";

export interface User {
  id: number;
  name: string;
  role: Role;
  active: number;
}

/**
 * What an item's price columns mean. See the `items` table in schema.sql —
 * 'unit' is a price per kilogram or litre and the customer names the quantity;
 * 'pack' is a price for one whole thing.
 */
export type PriceBasis = "pack" | "unit";

export interface Item {
  id: number;
  chemical_id: number | null;
  name: string;
  kind: "bulk" | "pack" | "finished" | "packaging";
  canonical_unit: "kg" | "L" | "pcs";
  size_milli: number;
  unit_label: string;
  sellable: number;
  price_basis: PriceBasis;
  retail_cents: number;
  wholesale_cents: number;
  floor_cents: number;
  cost_cents: number;
  reorder_level_milli: number;
  active: number;
}

export interface StockRow extends Item {
  qty_milli: number;
}

export type MovementReason =
  | "opening"
  | "purchase"
  | "sale"
  | "sale_void"
  | "repack_out"
  | "repack_in"
  | "repack_loss"
  | "batch_consume"
  | "batch_output"
  | "adjustment"
  | "stocktake";

const DB_PATH = process.env.RIZIKI_DB ?? join(process.cwd(), "data", "riziki.db");

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (_db) return _db;

  mkdirSync(dirname(DB_PATH), { recursive: true });

  const conn = new DatabaseSync(DB_PATH);
  conn.exec("PRAGMA journal_mode = WAL");
  conn.exec("PRAGMA foreign_keys = ON");

  const schema = readFileSync(join(process.cwd(), "src", "lib", "schema.sql"), "utf8");
  conn.exec(schema);
  migrate(conn);

  _db = conn;
  return conn;
}

/**
 * Columns added to tables that already exist in the shop's file.
 *
 * `CREATE TABLE IF NOT EXISTS` builds a new database correctly and does exactly
 * nothing to an old one, so a column added to schema.sql would be present on a
 * developer's fresh copy and missing on the till — the worst possible split,
 * because everything would work here and fail there. Each entry below is
 * therefore stated twice: in schema.sql for a new file, and here for the file
 * the shop has been trading on since March.
 *
 * Adding a column is the only migration this list may hold. Anything that
 * rewrites existing rows belongs in a script the owner runs deliberately, not in
 * a code path that opens the database.
 */
const ADDED_COLUMNS: Array<{ table: string; column: string; definition: string }> = [
  {
    table: "items",
    column: "price_basis",
    definition: "TEXT NOT NULL DEFAULT 'pack' CHECK (price_basis IN ('pack', 'unit'))",
  },
  { table: "sale_lines", column: "rate_cents", definition: "INTEGER NOT NULL DEFAULT 0 CHECK (rate_cents >= 0)" },
  {
    table: "sale_lines",
    column: "list_price_cents",
    definition: "INTEGER NOT NULL DEFAULT 0 CHECK (list_price_cents >= 0)",
  },
  {
    table: "quote_lines",
    column: "list_price_cents",
    definition: "INTEGER NOT NULL DEFAULT 0 CHECK (list_price_cents >= 0)",
  },
  { table: "quote_lines", column: "qty_milli", definition: "INTEGER NOT NULL DEFAULT 0 CHECK (qty_milli >= 0)" },
  { table: "quote_lines", column: "rate_cents", definition: "INTEGER NOT NULL DEFAULT 0 CHECK (rate_cents >= 0)" },
];

function migrate(conn: DatabaseSync): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.length) continue; // table not created yet — schema.sql owns it
    if (columns.some((c) => c.name === column)) continue;
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/** Reset the module-level handle — used by tests that swap the database file. */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// --------------------------------------------------------------- primitives

/**
 * node:sqlite hands back rows with a null prototype. React refuses to serialise
 * those from a Server Component to a Client Component ("Classes or null
 * prototypes are not supported"), so every row is copied into a plain object
 * here — once, centrally — rather than leaving each screen to remember.
 */
function plain<T>(row: unknown): T {
  return Object.assign({}, row) as T;
}

export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  const rows = db()
    .prepare(sql)
    .all(...(params as never[]));
  return rows.map((r) => plain<T>(r));
}

export function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  const row = db()
    .prepare(sql)
    .get(...(params as never[]));
  return row === undefined ? undefined : plain<T>(row);
}

export function run(sql: string, ...params: unknown[]): { lastInsertRowid: number; changes: number } {
  const r = db()
    .prepare(sql)
    .run(...(params as never[]));
  return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) };
}

/**
 * Run `fn` inside a transaction. Any throw rolls the whole thing back — which is
 * what keeps a half-recorded sale (money taken, stock not moved) from existing.
 */
export function tx<T>(fn: () => T): T {
  const conn = db();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    conn.exec("COMMIT");
    return result;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}

// ------------------------------------------------------------- stock ledger

export interface MovementInput {
  itemId: number;
  deltaMilli: number;
  reason: MovementReason;
  refType?: string | null;
  refId?: number | null;
  userId?: number | null;
  note?: string | null;
}

/**
 * The only supported way to change stock. Writing to `stock_movements` directly
 * elsewhere is fine, but going through here keeps the audit fields consistent.
 */
export function postMovement(m: MovementInput): number {
  if (m.deltaMilli === 0) throw new Error("a stock movement of zero is not a movement");
  const { lastInsertRowid } = run(
    `INSERT INTO stock_movements (item_id, delta_milli, reason, ref_type, ref_id, user_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    m.itemId,
    m.deltaMilli,
    m.reason,
    m.refType ?? null,
    m.refId ?? null,
    m.userId ?? null,
    m.note ?? null,
  );
  return lastInsertRowid;
}

export function stockOf(itemId: number): number {
  const row = get<{ qty: number }>(
    `SELECT COALESCE(SUM(delta_milli), 0) AS qty FROM stock_movements WHERE item_id = ?`,
    itemId,
  );
  return row?.qty ?? 0;
}

/** Total stock of a substance across every pack size, in its canonical unit. */
export function chemicalStock(chemicalId: number): number {
  const row = get<{ qty: number }>(
    `SELECT COALESCE(SUM(m.delta_milli), 0) AS qty
       FROM stock_movements m
       JOIN items i ON i.id = m.item_id
      WHERE i.chemical_id = ?`,
    chemicalId,
  );
  return row?.qty ?? 0;
}

export function stockRows(kinds?: string[]): StockRow[] {
  if (kinds && kinds.length) {
    const marks = kinds.map(() => "?").join(",");
    return all<StockRow>(
      `SELECT i.*, COALESCE(SUM(m.delta_milli), 0) AS qty_milli
         FROM items i
         LEFT JOIN stock_movements m ON m.item_id = i.id
        WHERE i.active = 1 AND i.kind IN (${marks})
        GROUP BY i.id
        ORDER BY i.kind, i.name`,
      ...kinds,
    );
  }
  return all<StockRow>(
    `SELECT i.*, COALESCE(SUM(m.delta_milli), 0) AS qty_milli
       FROM items i
       LEFT JOIN stock_movements m ON m.item_id = i.id
      WHERE i.active = 1
      GROUP BY i.id
      ORDER BY i.kind, i.name`,
  );
}

// ------------------------------------------------------------------- audit

export function audit(
  userId: number | null,
  action: string,
  entity: string,
  entityId?: number | null,
  detail?: string,
): void {
  run(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, detail)
     VALUES (?, ?, ?, ?, ?)`,
    userId,
    action,
    entity,
    entityId ?? null,
    detail ?? null,
  );
}

// ------------------------------------------------------------------ costing

/**
 * Weighted-average cost, recalculated whenever stock is bought.
 *
 * Chosen over FIFO layers deliberately: with imported chemicals repricing every
 * few weeks, an always-current average keeps selling prices honest, and it is one
 * column rather than a layer table.
 */
export function updateAverageCost(itemId: number, incomingUnits: number, incomingCostCents: number): void {
  const item = get<Item>(`SELECT * FROM items WHERE id = ?`, itemId);
  if (!item) throw new Error(`unknown item ${itemId}`);

  const onHandMilli = stockOf(itemId);
  const onHandUnits = item.size_milli > 0 ? onHandMilli / item.size_milli : 0;

  const existingValue = Math.round(onHandUnits * item.cost_cents);
  const totalUnits = onHandUnits + incomingUnits;
  const newCost = totalUnits > 0 ? Math.round((existingValue + incomingCostCents) / totalUnits) : item.cost_cents;

  run(`UPDATE items SET cost_cents = ? WHERE id = ?`, newCost, itemId);
}
