-- Riziki Industrial Chemicals — database schema
--
-- Design rules (these are load-bearing; read before changing anything):
--
--  1. MONEY is INTEGER cents of KES. Never a float. `_cents` suffix always.
--  2. QUANTITY is INTEGER thousandths ("milli") of the canonical unit.
--     A chemical's canonical unit is kg or L; 1.5 kg == 1500. `_milli` suffix always.
--     This gives exact 3-decimal arithmetic with no floating point drift.
--  3. STOCK IS A LEDGER. `stock_movements` is append-only: never UPDATE or DELETE a
--     row. Current stock is the SUM of its deltas. Every movement records who did it
--     and why, so shrinkage is always attributable.
--  4. SALES ARE IMMUTABLE. Correcting a sale means voiding it (status + reason +
--     compensating stock movements) and entering a new one. The original always
--     stays visible.
--  5. FORMULAS ARE VERSIONED. A batch pins the formula_version it used, so editing a
--     recipe never rewrites the cost or composition of past production.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- people & audit

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  role        TEXT    NOT NULL CHECK (role IN ('owner', 'staff')),
  pin_hash    TEXT    NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Append-only. Records anything worth disputing later: price edits, voids,
-- manual stock adjustments, logins, role changes.
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  at         TEXT    NOT NULL DEFAULT (datetime('now')),
  user_id    INTEGER REFERENCES users(id),
  action     TEXT    NOT NULL,
  entity     TEXT    NOT NULL,
  entity_id  INTEGER,
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

-- ------------------------------------------------------------ chemicals & items

-- The substance itself ("Ungerol"), independent of what size it is packed in.
CREATE TABLE IF NOT EXISTS chemicals (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL UNIQUE,
  canonical_unit  TEXT    NOT NULL CHECK (canonical_unit IN ('kg', 'L', 'pcs')),
  aliases         TEXT    NOT NULL DEFAULT '',   -- comma separated, powers search
  perishable      INTEGER NOT NULL DEFAULT 0 CHECK (perishable IN (0, 1)),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

-- A stock-keeping row: one (chemical, pack size) combination, or a finished
-- product, or a packaging material.
--
--   kind = 'bulk'      a drum or bag as delivered      (Ungerol drum, 170 kg)
--   kind = 'pack'      a repacked portion for resale   (Ungerol 20 kg pack)
--   kind = 'finished'  a product Riziki mixed          (Laundry Soap 1 L bottle)
--   kind = 'packaging' bottles, caps, labels           (5 L jerrican, 1 pcs)
--
-- size_milli is how much of the canonical unit ONE unit of this item holds.
-- Stock (in stock_movements) is always counted in milli of the canonical unit,
-- NOT in unit count — so 15 packs of 20 kg is stored as 300000 (300 kg).
-- Unit count for display = qty_milli / size_milli.
CREATE TABLE IF NOT EXISTS items (
  id                  INTEGER PRIMARY KEY,
  chemical_id         INTEGER REFERENCES chemicals(id),
  name                TEXT    NOT NULL,
  kind                TEXT    NOT NULL CHECK (kind IN ('bulk', 'pack', 'finished', 'packaging')),
  canonical_unit      TEXT    NOT NULL CHECK (canonical_unit IN ('kg', 'L', 'pcs')),
  size_milli          INTEGER NOT NULL CHECK (size_milli > 0),
  unit_label          TEXT    NOT NULL DEFAULT 'unit',   -- drum, bag, pack, bottle, jerrican
  sellable            INTEGER NOT NULL DEFAULT 1 CHECK (sellable IN (0, 1)),
  retail_cents        INTEGER NOT NULL DEFAULT 0 CHECK (retail_cents >= 0),
  wholesale_cents     INTEGER NOT NULL DEFAULT 0 CHECK (wholesale_cents >= 0),
  floor_cents         INTEGER NOT NULL DEFAULT 0 CHECK (floor_cents >= 0), -- below this needs owner PIN
  cost_cents          INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),  -- weighted average, per ONE unit
  reorder_level_milli INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level_milli >= 0),
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_items_chemical ON items(chemical_id);
CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind);

-- ------------------------------------------------------------------ stock ledger

-- APPEND ONLY. delta_milli is positive for stock in, negative for stock out.
CREATE TABLE IF NOT EXISTS stock_movements (
  id           INTEGER PRIMARY KEY,
  at           TEXT    NOT NULL DEFAULT (datetime('now')),
  item_id      INTEGER NOT NULL REFERENCES items(id),
  delta_milli  INTEGER NOT NULL CHECK (delta_milli <> 0),
  reason       TEXT    NOT NULL CHECK (reason IN (
                 'opening', 'purchase', 'sale', 'sale_void', 'repack_out', 'repack_in',
                 'repack_loss', 'batch_consume', 'batch_output', 'adjustment', 'stocktake')),
  ref_type     TEXT,
  ref_id       INTEGER,
  user_id      INTEGER REFERENCES users(id),
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_move_item ON stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_move_at ON stock_movements(at);
CREATE INDEX IF NOT EXISTS idx_move_ref ON stock_movements(ref_type, ref_id);

-- Guard rails: the ledger must never be rewritten.
CREATE TRIGGER IF NOT EXISTS stock_movements_no_update
BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements is append-only: post a correcting movement instead');
END;

CREATE TRIGGER IF NOT EXISTS stock_movements_no_delete
BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements is append-only: post a correcting movement instead');
END;

-- Current stock per item, derived from the ledger.
CREATE VIEW IF NOT EXISTS v_stock AS
SELECT
  i.id                                   AS item_id,
  i.name                                 AS item_name,
  i.kind                                 AS kind,
  i.chemical_id                          AS chemical_id,
  i.canonical_unit                       AS canonical_unit,
  i.size_milli                           AS size_milli,
  i.unit_label                           AS unit_label,
  i.reorder_level_milli                  AS reorder_level_milli,
  COALESCE(SUM(m.delta_milli), 0)        AS qty_milli
FROM items i
LEFT JOIN stock_movements m ON m.item_id = i.id
GROUP BY i.id;

-- ----------------------------------------------------------------- formulas

CREATE TABLE IF NOT EXISTS formulas (
  id       INTEGER PRIMARY KEY,
  name     TEXT    NOT NULL UNIQUE,
  active   INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

-- Immutable once batches reference it. Editing a recipe inserts a new version.
CREATE TABLE IF NOT EXISTS formula_versions (
  id             INTEGER PRIMARY KEY,
  formula_id     INTEGER NOT NULL REFERENCES formulas(id),
  version        INTEGER NOT NULL,
  ref_size_milli INTEGER NOT NULL CHECK (ref_size_milli > 0),  -- litres the quantities are stated for
  steps          TEXT    NOT NULL DEFAULT '',
  note           TEXT    NOT NULL DEFAULT '',
  is_current     INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by     INTEGER REFERENCES users(id),
  UNIQUE (formula_id, version)
);

CREATE TABLE IF NOT EXISTS formula_items (
  id                 INTEGER PRIMARY KEY,
  formula_version_id INTEGER NOT NULL REFERENCES formula_versions(id),
  chemical_id        INTEGER NOT NULL REFERENCES chemicals(id),
  qty_milli          INTEGER NOT NULL CHECK (qty_milli > 0),  -- per ref_size_milli
  sort_order         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fitems_version ON formula_items(formula_version_id);

-- ----------------------------------------------------------------- production

CREATE TABLE IF NOT EXISTS batches (
  id                 INTEGER PRIMARY KEY,
  at                 TEXT    NOT NULL DEFAULT (datetime('now')),
  formula_version_id INTEGER NOT NULL REFERENCES formula_versions(id),
  batch_no           TEXT    NOT NULL UNIQUE,           -- printed on labels (KEBS traceability)
  target_milli       INTEGER NOT NULL CHECK (target_milli > 0),
  actual_milli       INTEGER CHECK (actual_milli IS NULL OR actual_milli >= 0),
  cost_cents         INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  status             TEXT    NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
  user_id            INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS batch_lines (
  id          INTEGER PRIMARY KEY,
  batch_id    INTEGER NOT NULL REFERENCES batches(id),
  chemical_id INTEGER NOT NULL REFERENCES chemicals(id),
  qty_milli   INTEGER NOT NULL CHECK (qty_milli > 0),
  cost_cents  INTEGER NOT NULL DEFAULT 0
);

-- Breaking a drum/bag into smaller packs. kg in must equal kg out; the
-- difference is recorded as loss rather than silently disappearing.
CREATE TABLE IF NOT EXISTS repacks (
  id           INTEGER PRIMARY KEY,
  at           TEXT    NOT NULL DEFAULT (datetime('now')),
  from_item_id INTEGER NOT NULL REFERENCES items(id),
  in_milli     INTEGER NOT NULL CHECK (in_milli > 0),
  out_milli    INTEGER NOT NULL CHECK (out_milli >= 0),
  loss_milli   INTEGER NOT NULL DEFAULT 0,
  user_id      INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS repack_lines (
  id        INTEGER PRIMARY KEY,
  repack_id INTEGER NOT NULL REFERENCES repacks(id),
  item_id   INTEGER NOT NULL REFERENCES items(id),
  units     INTEGER NOT NULL CHECK (units > 0),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0)
);

-- What one unit of a finished product is packed into: a bottle, a cap, a label.
-- Without this, packaging is bought and counted but never consumed, so the
-- jerrican count never falls and a fifth of the cost of a small bottle is
-- missing from its margin.
CREATE TABLE IF NOT EXISTS item_packaging (
  id                 INTEGER PRIMARY KEY,
  item_id            INTEGER NOT NULL REFERENCES items(id),
  packaging_item_id  INTEGER NOT NULL REFERENCES items(id),
  qty_per_unit       INTEGER NOT NULL CHECK (qty_per_unit > 0),
  UNIQUE (item_id, packaging_item_id)
);

-- ------------------------------------------------------------ customers & sales

CREATE TABLE IF NOT EXISTS customers (
  id                 INTEGER PRIMARY KEY,
  name               TEXT    NOT NULL,
  phone              TEXT    NOT NULL DEFAULT '',
  kind               TEXT    NOT NULL DEFAULT 'retail' CHECK (kind IN ('retail', 'wholesale')),
  credit_limit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit_cents >= 0),
  -- Wholesale buyers increasingly need an eTIMS invoice to claim the purchase as
  -- an expense, and that invoice must carry their KRA PIN.
  kra_pin            TEXT    NOT NULL DEFAULT '',
  active             INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS sales (
  id            INTEGER PRIMARY KEY,
  client_uuid   TEXT    NOT NULL UNIQUE,   -- generated on the device; makes offline replay idempotent
  at            TEXT    NOT NULL DEFAULT (datetime('now')),
  user_id       INTEGER REFERENCES users(id),
  customer_id   INTEGER REFERENCES customers(id),
  tier          TEXT    NOT NULL DEFAULT 'retail' CHECK (tier IN ('retail', 'wholesale')),
  total_cents   INTEGER NOT NULL CHECK (total_cents >= 0),
  paid_cents    INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  status        TEXT    NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
  void_reason   TEXT,
  voided_by     INTEGER REFERENCES users(id),
  voided_at     TEXT,
  invoice_no    TEXT UNIQUE,
  note          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sales_at ON sales(at);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);

CREATE TRIGGER IF NOT EXISTS sales_no_delete
BEFORE DELETE ON sales
BEGIN
  SELECT RAISE(ABORT, 'sales are immutable: void the sale instead of deleting it');
END;

-- Prices are SNAPSHOT here. Reports must never re-join to items for price,
-- or changing a price would rewrite history.
CREATE TABLE IF NOT EXISTS sale_lines (
  id               INTEGER PRIMARY KEY,
  sale_id          INTEGER NOT NULL REFERENCES sales(id),
  item_id          INTEGER REFERENCES items(id),
  name_snapshot    TEXT    NOT NULL,
  units            INTEGER NOT NULL CHECK (units > 0),
  qty_milli        INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  cost_cents       INTEGER NOT NULL DEFAULT 0,   -- owner-only in the UI
  is_kit           INTEGER NOT NULL DEFAULT 0 CHECK (is_kit IN (0, 1)),
  formula_version_id INTEGER REFERENCES formula_versions(id)
);
CREATE INDEX IF NOT EXISTS idx_slines_sale ON sale_lines(sale_id);

-- One sale can have several tenders: 300 cash + 500 M-Pesa + the rest on credit.
CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY,
  sale_id      INTEGER NOT NULL REFERENCES sales(id),
  at           TEXT    NOT NULL DEFAULT (datetime('now')),
  method       TEXT    NOT NULL CHECK (method IN ('cash', 'mpesa', 'credit')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  mpesa_code   TEXT,
  user_id      INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_pay_sale ON payments(sale_id);
-- An M-Pesa code can only be used once — blocks the same SMS paying twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_mpesa ON payments(mpesa_code) WHERE mpesa_code IS NOT NULL;

-- --------------------------------------------------------- suppliers & purchases

CREATE TABLE IF NOT EXISTS suppliers (
  id     INTEGER PRIMARY KEY,
  name   TEXT    NOT NULL UNIQUE,
  phone  TEXT    NOT NULL DEFAULT '',
  note   TEXT    NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS purchases (
  id           INTEGER PRIMARY KEY,
  at           TEXT    NOT NULL DEFAULT (datetime('now')),
  supplier_id  INTEGER REFERENCES suppliers(id),
  total_cents  INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  transport_cents INTEGER NOT NULL DEFAULT 0 CHECK (transport_cents >= 0),
  ref          TEXT    NOT NULL DEFAULT '',
  user_id      INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS purchase_lines (
  id          INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  item_id     INTEGER NOT NULL REFERENCES items(id),
  units       INTEGER NOT NULL CHECK (units > 0),
  qty_milli   INTEGER NOT NULL CHECK (qty_milli > 0),
  cost_cents  INTEGER NOT NULL CHECK (cost_cents >= 0)   -- total for the line
);

-- ------------------------------------------------------------------- expenses

-- Without this the monthly report shows revenue, not profit.
CREATE TABLE IF NOT EXISTS expenses (
  id           INTEGER PRIMARY KEY,
  at           TEXT    NOT NULL DEFAULT (datetime('now')),
  category     TEXT    NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method       TEXT    NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'mpesa')),
  note         TEXT    NOT NULL DEFAULT '',
  user_id      INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_exp_at ON expenses(at);

-- --------------------------------------------------------------- day close

CREATE TABLE IF NOT EXISTS day_closes (
  id                INTEGER PRIMARY KEY,
  business_date     TEXT    NOT NULL UNIQUE,
  expected_cash_cents INTEGER NOT NULL DEFAULT 0,
  counted_cash_cents  INTEGER NOT NULL DEFAULT 0,
  variance_cents      INTEGER NOT NULL DEFAULT 0,
  mpesa_cents         INTEGER NOT NULL DEFAULT 0,
  credit_cents        INTEGER NOT NULL DEFAULT 0,
  note              TEXT    NOT NULL DEFAULT '',
  closed_by         INTEGER REFERENCES users(id),
  closed_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Small key/value settings: business name, KRA PIN, and the cash float the day
-- close expects to find in the drawer.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
