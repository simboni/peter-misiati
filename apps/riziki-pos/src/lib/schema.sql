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

-- A stock-keeping row: a chemical as it is delivered and stored, a finished
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
--
-- ONE price, and a band it may be argued inside.
--
--   price_cents    what the shop asks for one unit of this
--   floor_cents    the least it may go for; under it needs the owner
--   ceiling_cents  the most it may go for; over it needs the owner too
--
-- There used to be a retail price and a wholesale price, and the counter had a
-- switch between them. Two prices for one thing is one price too many: the
-- attendant had to decide which tier a walk-in buying forty kilos belonged to
-- before quoting, and the answer was neither — it was a number between the two,
-- which the switch could not express. The band expresses it exactly, and the
-- price actually agreed is snapshotted onto the sale line beside the asking one.
--
-- A zero floor means "no floor set" and a zero ceiling means "no ceiling set";
-- neither is a limit of nothing.
--
-- price_basis says what the price above MEANS, and it is the hinge the whole
-- shop turns on:
--
--   'unit'  price_cents is the price of ONE canonical unit — one kilogram, one
--           litre, one piece. The customer names a quantity and pays for exactly
--           that, so 1 kg of Ungerol at 50 makes half a kilo 25 and ten kilos
--           500. This is every row the shop sells.
--   'pack'  price_cents is the price of ONE whole row — the old way, where a
--           chemical had a row per size. Legacy only: nothing creates these, and
--           the catalogue screen offers to move any that remain.
--
-- 'unit' is how chemicals are actually sold across the counter, and it is what
-- removed the need to pre-pack anything: a drum on the floor is stock in kg, and
-- any quantity can come out of it. 'pack' remains right for things that only
-- exist whole — a jerrican, a bottle of finished product.
--
-- kind = 'pack' rows are legacy. They existed only to say "this chemical, at
-- this size, for this price", which is now one number on the bulk row. Nothing
-- creates them any more; the ones already on file are retired, not deleted, so
-- the sales that reference them still read correctly.
CREATE TABLE IF NOT EXISTS items (
  id                  INTEGER PRIMARY KEY,
  chemical_id         INTEGER REFERENCES chemicals(id),
  name                TEXT    NOT NULL,
  kind                TEXT    NOT NULL CHECK (kind IN ('bulk', 'pack', 'finished', 'packaging')),
  canonical_unit      TEXT    NOT NULL CHECK (canonical_unit IN ('kg', 'L', 'pcs')),
  size_milli          INTEGER NOT NULL CHECK (size_milli > 0),
  unit_label          TEXT    NOT NULL DEFAULT 'unit',   -- drum, bag, pack, bottle, jerrican
  sellable            INTEGER NOT NULL DEFAULT 1 CHECK (sellable IN (0, 1)),
  price_basis         TEXT    NOT NULL DEFAULT 'pack' CHECK (price_basis IN ('pack', 'unit')),
  price_cents         INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  floor_cents         INTEGER NOT NULL DEFAULT 0 CHECK (floor_cents >= 0),   -- never below, without the owner
  ceiling_cents       INTEGER NOT NULL DEFAULT 0 CHECK (ceiling_cents >= 0), -- never beyond, without the owner
  cost_cents          INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),  -- weighted average, per ONE unit
  reorder_level_milli INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level_milli >= 0),
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_items_chemical ON items(chemical_id);
CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind);

-- ---------------------------------------------------------------------- bundles

-- A size the shop sells something in, at a price of its own.
--
-- Ungerol is priced per kilogram and weighed out to whatever the customer asks
-- for. It is ALSO sold as a 5 kg, a 10 kg and a 20 kg — and those are cheaper
-- per kilogram, which is the entire point: the bundle is a bulk price, not a
-- convenience.
--
-- This is deliberately NOT a row in `items`. The catalogue used to hold a
-- separate item per pack size, each with its own stock, and it was retired
-- because stock kept splitting between the drum and the packs and had to be
-- moved across by hand. A bundle is a PRICE ON THE PARENT, nothing more:
-- selling a 20 kg bundle of Ungerol takes 20 kg off the one Ungerol drum, and
-- there is never a second pile to reconcile.
--
-- Owned by an item or by a formula, never both and never neither — the CHECK
-- says so. An item bundle is a size of a thing on the shelf; a formula bundle
-- is a size of something mixed to order, where the ingredients are what
-- actually leave the store.
CREATE TABLE IF NOT EXISTS bundles (
  id          INTEGER PRIMARY KEY,
  item_id     INTEGER REFERENCES items(id),
  formula_id  INTEGER REFERENCES formulas(id),
  size_milli  INTEGER NOT NULL CHECK (size_milli > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  -- Never below, without the owner's PIN — the same promise the per-unit price
  -- carries, made separately because a bundle is already a discounted rate and
  -- the item's floor would be the wrong line to hold it to.
  floor_cents INTEGER NOT NULL DEFAULT 0 CHECK (floor_cents >= 0),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  CHECK ((item_id IS NULL) <> (formula_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bundles_item ON bundles(item_id, size_milli)
  WHERE item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bundles_formula ON bundles(formula_id, size_milli)
  WHERE formula_id IS NOT NULL;

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
-- Covering index: current stock is SUM(delta_milli) per item, read on every Sell
-- and Stock load. Including delta_milli makes it an index-only scan — measured
-- 16-20x faster at 200k movements, and this is the one cost that grows forever.
CREATE INDEX IF NOT EXISTS idx_move_item ON stock_movements(item_id, delta_milli);
CREATE INDEX IF NOT EXISTS idx_move_at ON stock_movements(at);
CREATE INDEX IF NOT EXISTS idx_move_ref ON stock_movements(ref_type, ref_id);
-- Shrinkage report groups losses by Nairobi month; a plain index can't serve the
-- date() expression, so index the expression itself over just the loss rows.
CREATE INDEX IF NOT EXISTS idx_move_shrink_ym
  ON stock_movements(strftime('%Y-%m', at, '+3 hours'), item_id, delta_milli)
  WHERE reason IN ('stocktake', 'repack_loss');

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
  -- The product this recipe MAKES, when it is mixed in advance rather than
  -- billed at the counter. This one column is the switch between the two ways
  -- a recipe can work, and they are mutually exclusive on purpose:
  --
  --   NULL  -- mixed to order. The counter sells a size and the ingredients
  --            come off the shelf at that moment. The shop holds no stock of
  --            the mix. This is every recipe the system had before mixing.
  --   set   -- mixed in advance. The mixing board takes the ingredients and
  --            puts the result on the shelf as real counted stock, which is
  --            then sold like any other product.
  --
  -- Both at once would take the concentrate twice: once when the batch was
  -- mixed, again when the mix was sold. So a recipe with an output product is
  -- not offered at the counter at all -- see the sell screen's recipe feed.
  output_item_id INTEGER REFERENCES items(id),
  active   INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
-- The index on output_item_id lives in db.ts, not here: this file runs BEFORE
-- the column is added to a database that already exists. See ADDED_INDEXES.

-- Immutable once batches reference it. Editing a recipe inserts a new version.
CREATE TABLE IF NOT EXISTS formula_versions (
  id             INTEGER PRIMARY KEY,
  formula_id     INTEGER NOT NULL REFERENCES formulas(id),
  version        INTEGER NOT NULL,
  ref_size_milli INTEGER NOT NULL CHECK (ref_size_milli > 0),  -- how much the quantities are stated for
  -- What that batch is measured in. Litres for a liquid the shop mixes, but a
  -- diluted powder is made and sold by the kilogram, and a recipe that could
  -- only say "makes 23 litres" of something weighed was a recipe lying about
  -- the shelf. Only ever a label — `ref_size_milli` is thousandths either way.
  ref_unit       TEXT    NOT NULL DEFAULT 'L' CHECK (ref_unit IN ('kg', 'L')),
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

-- One mixing run: what was made, out of what, and what it cost.
--
-- Written only for a recipe that has been given an OUTPUT PRODUCT — see
-- `formulas.output_item_id`. A recipe without one is still billed as its
-- ingredients at the moment of sale and never comes through here.
--
-- `target_milli` is what the recipe said the batch would make; `actual_milli`
-- is what came out of the drum. They differ, and the second is the one the
-- ledger believes: the shop dilutes by eye with a hosepipe, and a system that
-- insists on the arithmetic is a system that gets lied to.
CREATE TABLE IF NOT EXISTS batches (
  id                 INTEGER PRIMARY KEY,
  at                 TEXT    NOT NULL DEFAULT (datetime('now')),
  formula_version_id INTEGER NOT NULL REFERENCES formula_versions(id),
  batch_no           TEXT    NOT NULL UNIQUE,           -- printed on labels (KEBS traceability)
  -- What the run put on the shelf. Null only on rows written before mixing
  -- existed; every batch this system writes names its output.
  output_item_id     INTEGER REFERENCES items(id),
  target_milli       INTEGER NOT NULL CHECK (target_milli > 0),
  actual_milli       INTEGER CHECK (actual_milli IS NULL OR actual_milli >= 0),
  cost_cents         INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  status             TEXT    NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
  user_id            INTEGER REFERENCES users(id)
);
-- Index on output_item_id: see ADDED_INDEXES in db.ts, for the reason above.

-- What went in. The chemical says WHAT, the item says WHICH ROW it came off —
-- a recipe names a substance, but stock only ever moves against an item.
CREATE TABLE IF NOT EXISTS batch_lines (
  id          INTEGER PRIMARY KEY,
  batch_id    INTEGER NOT NULL REFERENCES batches(id),
  chemical_id INTEGER NOT NULL REFERENCES chemicals(id),
  item_id     INTEGER REFERENCES items(id),
  qty_milli   INTEGER NOT NULL CHECK (qty_milli > 0),
  cost_cents  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_batch_lines_batch ON batch_lines(batch_id);
-- Index on item_id: see ADDED_INDEXES in db.ts, for the reason above.

-- Breaking a drum/bag into smaller packs. kg in must equal kg out; the
-- difference is recorded as loss rather than silently disappearing.
CREATE TABLE IF NOT EXISTS repacks (
  id           INTEGER PRIMARY KEY,
  at           TEXT    NOT NULL DEFAULT (datetime('now')),
  from_item_id INTEGER NOT NULL REFERENCES items(id),
  in_milli     INTEGER NOT NULL CHECK (in_milli > 0),
  out_milli    INTEGER NOT NULL CHECK (out_milli >= 0),
  loss_milli   INTEGER NOT NULL DEFAULT 0,
  status       TEXT    NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
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
-- Business-date filters wrap `at` in date(at,'+3 hours'), which the plain index
-- can't serve; index the expression so the dashboard and day close stop scanning.
CREATE INDEX IF NOT EXISTS idx_sales_bizdate ON sales(date(at, '+3 hours'));
-- The debtors book and "owed to you" only ever want sales still owing.
CREATE INDEX IF NOT EXISTS idx_sales_debt ON sales(customer_id)
  WHERE status = 'completed' AND total_cents > paid_cents;

CREATE TRIGGER IF NOT EXISTS sales_no_delete
BEFORE DELETE ON sales
BEGIN
  SELECT RAISE(ABORT, 'sales are immutable: void the sale instead of deleting it');
END;

-- The ledger blocks UPDATE at the database; sale money did not. paid_cents,
-- status/void fields and the later-issued invoice_no legitimately change, but the
-- charged total, the device id, the time and the tier are fixed the moment the
-- sale is taken. Guard them here so the file being copyable can't mean the money
-- being editable.
CREATE TRIGGER IF NOT EXISTS sales_no_money_update
BEFORE UPDATE ON sales
WHEN OLD.total_cents <> NEW.total_cents
   OR OLD.client_uuid <> NEW.client_uuid
   OR OLD.at <> NEW.at
   OR OLD.tier <> NEW.tier
BEGIN
  SELECT RAISE(ABORT, 'a sale''s total, time and tier are fixed: void it and enter a new one');
END;


-- Prices are SNAPSHOT here. Reports must never re-join to items for price,
-- or changing a price would rewrite history.
--
-- A line is one of two shapes, and `rate_cents` is what tells them apart:
--
--   rate_cents = 0   sold whole. `units` of them at `unit_price_cents` each,
--                    and units × unit_price_cents = line_total_cents exactly.
--
--   rate_cents > 0   sold by quantity. `qty_milli` of the substance at
--                    `rate_cents` per kg / L / pcs. `units` is 1 — a weighed
--                    line is one scoop, not a count of anything — and both
--                    unit_price_cents and line_total_cents hold the amount
--                    charged, so every total in the system still comes out of
--                    line_total_cents without knowing which shape it read.
--
-- Keeping the rate rather than deriving it back out of amount ÷ quantity means
-- a receipt reprinted next year still says "KES 50/kg" and not "KES 49.98/kg".
--
-- `list_price_cents` is what the shop was ASKING when the line was rung up, in
-- the same terms as the price beside it — per pack, or per kilogram.
--
-- Haggling is normal here, so an attendant may sell Ungerol at 80 when the
-- shelf says 100, and until this column existed the only trace of that was a
-- sentence in the audit log. That is enough to catch somebody out and not
-- enough to run a shop: the customer's receipt could not say what they had
-- saved, and the owner could not ask what a month of discounting had cost him.
-- The asking price is a fact about the moment of sale, so it is snapshotted
-- here beside the price actually charged, and the difference is arithmetic
-- anybody can check rather than a number somebody has to be trusted about.
--
-- Zero means "not recorded" — every line written before this column existed.
-- Those lines are not discounts of the full amount, and every reader of this
-- column has to treat zero as unknown rather than as a list price of nothing.
CREATE TABLE IF NOT EXISTS sale_lines (
  id               INTEGER PRIMARY KEY,
  sale_id          INTEGER NOT NULL REFERENCES sales(id),
  item_id          INTEGER REFERENCES items(id),
  name_snapshot    TEXT    NOT NULL,
  units            INTEGER NOT NULL CHECK (units > 0),
  qty_milli        INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  rate_cents       INTEGER NOT NULL DEFAULT 0 CHECK (rate_cents >= 0),
  list_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (list_price_cents >= 0),
  cost_cents       INTEGER NOT NULL DEFAULT 0,   -- owner-only in the UI
  is_kit           INTEGER NOT NULL DEFAULT 0 CHECK (is_kit IN (0, 1)),
  formula_version_id INTEGER REFERENCES formula_versions(id),
  -- Which bundle this was sold as, when it was sold as one. NULL for a loose
  -- weight or a plain whole unit. The money and the quantity are already on the
  -- row above; this is here so a report can ask "how much do we move in 20 kg
  -- bundles" without inferring it from the size.
  bundle_id        INTEGER REFERENCES bundles(id)
);
CREATE INDEX IF NOT EXISTS idx_slines_sale ON sale_lines(sale_id);
-- Dead-stock and profit-per-product look up sales by item; without this the
-- dead-stock query walked all sales once per item (measured 115ms -> 25ms).
CREATE INDEX IF NOT EXISTS idx_slines_item ON sale_lines(item_id, sale_id);

-- Sale lines are written once with the sale and never edited (defined here,
-- after the table exists).
CREATE TRIGGER IF NOT EXISTS sale_lines_no_update
BEFORE UPDATE ON sale_lines
BEGIN
  SELECT RAISE(ABORT, 'sale lines are immutable: void the sale instead');
END;
CREATE TRIGGER IF NOT EXISTS sale_lines_no_delete
BEFORE DELETE ON sale_lines
BEGIN
  SELECT RAISE(ABORT, 'sale lines are immutable: void the sale instead');
END;

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
-- Day close groups the day's tenders by Nairobi date; index the expression.
CREATE INDEX IF NOT EXISTS idx_pay_bizdate ON payments(date(at, '+3 hours'));

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
  -- What ONE container on this delivery held. Ufacid comes in 250 kg drums and
  -- in 200 kg drums, so this is a fact about the delivery, not about the
  -- substance: multiplying units by the item's single container size booked the
  -- wrong weight the moment a different drum turned up. The item still carries a
  -- usual size, and it is what pre-fills this.
  size_milli  INTEGER NOT NULL DEFAULT 0 CHECK (size_milli >= 0),
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

-- ---------------------------------------------------------------- quotations
--
-- A quote is the document that exists before there is a sale: prices offered,
-- nothing committed. It moves no stock, touches no ledger and creates no debt,
-- which is precisely what distinguishes it from everything else in this file.
--
-- It is deliberately NOT an invoice table. An invoice here is a sale — the
-- sales/sale_lines/payments trio already carries totals, credit, part-payments
-- and the printed document at /invoice/[id]. Quoting is the only genuinely new
-- idea, so it is the only new table; approving a quote writes a sale through
-- the same recordSale() every counter sale goes through, and from that moment
-- the money behaves identically whether it started as a quote or a walk-in.
--
-- Lines are mutable, unlike sale_lines: haggling is the point of a quote, and
-- until it is accepted nothing downstream depends on the numbers.
CREATE TABLE IF NOT EXISTS quotes (
  id            INTEGER PRIMARY KEY,
  quote_no      TEXT    NOT NULL UNIQUE,
  customer_id   INTEGER REFERENCES customers(id),
  -- Kept alongside customer_id so a quote for someone not yet on the books
  -- still prints with a name on it.
  customer_name TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'sent', 'approved', 'declined', 'invoiced')),
  note          TEXT    NOT NULL DEFAULT '',
  valid_until   TEXT    NOT NULL DEFAULT '',
  -- Set once the quote becomes a sale; the link is what stops a quote being
  -- invoiced twice.
  sale_id       INTEGER REFERENCES sales(id),
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  decided_at    TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS quote_lines (
  id               INTEGER PRIMARY KEY,
  quote_id         INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  item_id          INTEGER NOT NULL REFERENCES items(id),
  -- Whole units, as sold. A quote says "3 jerricans", not "15000".
  units            INTEGER NOT NULL CHECK (units > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  -- The same two shapes as sale_lines: rate_cents > 0 means the line is a
  -- quantity of substance (qty_milli) at a price per kg / L, and `units` is 1.
  -- A wholesale buyer asking for 400 kg of caustic must be quotable for 400 kg,
  -- not for "8 × the biggest bag we happen to have a row for".
  qty_milli        INTEGER NOT NULL DEFAULT 0 CHECK (qty_milli >= 0),
  rate_cents       INTEGER NOT NULL DEFAULT 0 CHECK (rate_cents >= 0),
  -- What the shop was asking when the quote was written, so the discount the
  -- customer was offered stays true after the shelf price moves. Same meaning
  -- and the same zero-is-unknown rule as `sale_lines.list_price_cents`.
  list_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (list_price_cents >= 0),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  -- The bundle this line was quoted as, when it was one. See `bundles`.
  bundle_id        INTEGER REFERENCES bundles(id)
);

CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON quote_lines(quote_id);

-- ------------------------------------------------------------- price changes

/*
  Every price the shop has ever charged, and who set it.

  Chemical prices move with the supplier — sometimes weekly — and the shop needs
  three things from that which a single `items.price_cents` column cannot give:

    - what it used to be, when a customer says "last week it was 900";
    - when it last moved, so the attendant opening the shop knows which prices
      are stale and which were set this morning;
    - who moved it, because an attendant may now change prices and the owner
      must be able to see what they did.

  Append-only. A correction is another row, never an edit — the same rule the
  stock ledger follows, and for the same reason.
*/
CREATE TABLE IF NOT EXISTS price_changes (
  id             INTEGER PRIMARY KEY,
  at             TEXT    NOT NULL DEFAULT (datetime('now')),
  item_id        INTEGER NOT NULL REFERENCES items(id),
  old_price      INTEGER NOT NULL,
  new_price      INTEGER NOT NULL,
  user_id        INTEGER REFERENCES users(id),
  -- Where the change was made: 'counter' = agreed with a customer at the till
  -- and kept, 'admin' = the owner's catalogue screen, 'check' = the start-of-day
  -- sweep that used to have a screen of its own.
  source         TEXT    NOT NULL DEFAULT 'check' CHECK (source IN ('check', 'admin', 'counter')),
  note           TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_price_changes_item ON price_changes(item_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_price_changes_at ON price_changes(at DESC);

CREATE TRIGGER IF NOT EXISTS price_changes_no_update
BEFORE UPDATE ON price_changes
BEGIN
  SELECT RAISE(ABORT, 'price history is append-only: record a new change instead');
END;

CREATE TRIGGER IF NOT EXISTS price_changes_no_delete
BEFORE DELETE ON price_changes
BEGIN
  SELECT RAISE(ABORT, 'price history is append-only: record a new change instead');
END;
