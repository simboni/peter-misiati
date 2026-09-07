#!/bin/sh
# Zero every number, keep everything you typed. Run on the server, from
# apps/riziki-pos:
#
#   sh deploy/zero-the-numbers.sh
#
# What you get afterwards: your catalogue exactly as it stands — every product,
# price, size, recipe, supplier and customer — with every number back to zero.
# No stock, no sales, no batches, no jerrican counts, no purchases, no expenses,
# no day closes, no quotes, no price history. The shelves are empty and the
# books are blank; what you sell and what it costs the customer is untouched.
#
# This is the third of three, and the differences are the whole reason all
# three exist:
#
#   zero-the-numbers.sh  keeps YOUR catalogue and zeroes the numbers.
#                        For a shop that has entered its own products and has
#                        been testing on top of them.
#   reset-test-data.sh   REPLACES the catalogue with the delivered one and
#                        zeroes the numbers. For learning the system on the
#                        product names it shipped with.
#   start-fresh.sh       throws the catalogue away too, and you retype it.
#
# Read that middle one again before reaching for it: it calls seed(), which
# writes the catalogue this system was DELIVERED with. A shop that has typed in
# its own products would lose them.
#
# What carries across, in full:
#   users and their PINs, shop settings, chemicals, products and their prices,
#   the sizes each is sold in, whether it is counted in containers, recipes with
#   every version and ingredient, what each recipe makes, customers, suppliers.
#
# What does not:
#   stock movements, sales, sale lines, payments, batches and their lines,
#   jerrican counts, purchases, expenses, day closes, quotes, price history,
#   and the audit log. Cost prices go to zero with them — a weighted average is
#   a fact about purchases, and there are none left to average.
#
# Why this rebuilds the database rather than deleting rows: sales, sale_lines,
# stock_movements, price_changes and pack_moves are all trigger-guarded
# append-only on this system, on purpose — the database refuses to delete them
# even for its owner, because that is what makes the audit trail worth anything.
# A row that cannot be deleted has to never be written.
#
# Columns are copied by name, read from both databases at run time rather than
# listed here. A column added to the schema next month is carried across without
# anybody remembering to edit this file, and a column removed does not break it.
#
# The database is backed up before anything is touched, and the old file is
# moved aside rather than deleted, so this is reversible.

set -eu

COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$COMPOSE_DIR"
DATA_DIR="$COMPOSE_DIR/data"

echo "==> Working in $COMPOSE_DIR"

if ! docker compose exec -T pos true >/dev/null 2>&1; then
  echo "The pos container is not running here. cd to apps/riziki-pos and run"
  echo "'docker compose up -d' first, or run this from the right directory."
  exit 1
fi

echo "==> Backing up the database before anything is touched"
docker compose exec -T pos npm run backup

echo
echo "==> What is in the database now"
docker compose exec -T pos node --experimental-strip-types -e '
const { get } = await import("./src/lib/db.ts");
const n = (t) => { try { return get(`SELECT COUNT(*) AS n FROM ${t}`).n; } catch { return 0; } };
console.log("    KEEPING");
for (const t of ["chemicals", "items", "bundles", "formulas", "customers", "suppliers"]) {
  console.log(`      ${t.padEnd(18)} ${n(t)}`);
}
console.log("    CLEARING");
for (const t of ["stock_movements", "sales", "sale_lines", "batches", "pack_moves",
                 "purchases", "expenses", "quotes", "price_changes"]) {
  console.log(`      ${t.padEnd(18)} ${n(t)}`);
}
'

echo
echo "This keeps every product, price, size, recipe, customer and supplier you"
echo "have entered, and sets every number back to zero: no stock, no sales, no"
echo "batches, no jerrican counts, no purchases, no history."
echo
printf "Type ZERO THE NUMBERS to continue: "
read -r confirm
if [ "$confirm" != "ZERO THE NUMBERS" ]; then
  echo "Not confirmed — nothing was touched."
  exit 1
fi

echo "==> Reading out everything that is being kept"
docker compose exec -T pos node --experimental-strip-types -e '
const { all } = await import("./src/lib/db.ts");
const { writeFileSync } = await import("node:fs");

/*
  Parents before children: the new database has foreign keys on, so a formula
  version cannot land before its formula, and a bundle cannot land before the
  item it prices.
*/
const KEEP = [
  "users", "settings", "chemicals", "items", "bundles",
  "formulas", "formula_versions", "formula_items",
  "customers", "suppliers",
];

const out = {};
for (const t of KEEP) {
  try { out[t] = all(`SELECT * FROM ${t}`); } catch { out[t] = []; }
}
writeFileSync("/app/data/.zero-carry.json", JSON.stringify(out));
for (const t of KEEP) console.log(`    ${t.padEnd(18)} ${out[t].length}`);
'

# From here on the app is DOWN, and it must not be left that way.
#
# `set -e` plus a stop on one line and a start a hundred lines later is a shop
# with no till if anything in between fails — which is how this script took the
# counter down with a customer at it. Whatever happens now, the app comes back:
# on the new database if the swap finished, on the old one if it did not. Both
# are a working till, which is the only thing that matters at that moment.
APP_IS_DOWN=1
trap 'if [ "${APP_IS_DOWN:-0}" = "1" ]; then
        echo
        echo "!! Something failed. Bringing the app back up on whichever database is in place."
        docker compose up -d pos || true
        echo "!! The shop can trade. Nothing was deleted — the backup is in data/backups/."
      fi' EXIT INT TERM

echo "==> Stopping the app"
docker compose stop pos

echo "==> Building a fresh database and putting the catalogue back into it"
docker compose run --rm --no-deps \
  -e RIZIKI_DB=/app/data/.zero.db \
  pos node --experimental-strip-types -e '
const { run, get, all, tx, closeDb } = await import("./src/lib/db.ts");
const { ensureSettingsSchema } = await import("./src/lib/print-settings.ts");
const { readFileSync } = await import("node:fs");

// Importing db.ts has already run schema.sql, which is all an empty shop needs.
// seed() is deliberately NOT called: it would write the delivered catalogue on
// top of the one being carried across.
ensureSettingsSchema();

const carried = JSON.parse(readFileSync("/app/data/.zero-carry.json", "utf8"));

if (!carried.users?.some((u) => u.role === "owner" && u.active)) {
  console.error("REFUSED: no active owner account to carry across — you would be locked out.");
  process.exit(1);
}

/*
  Copy by column name, worked out at run time from both sides.

  Listing the columns in this file would mean editing it every time the schema
  grows, and forgetting to is a silent loss of whatever was added. The
  intersection of what the old row has and what the new table accepts is
  exactly what can be carried, and nothing else needs to be known here.
*/
function columnsOf(table) {
  return all(`PRAGMA table_info(${table})`).map((c) => c.name);
}

const ORDER = [
  "users", "settings", "chemicals", "items", "bundles",
  "formulas", "formula_versions", "formula_items",
  "customers", "suppliers",
];

tx(() => {
  for (const table of ORDER) {
    const rows = carried[table] ?? [];
    if (!rows.length) continue;
    const accepted = new Set(columnsOf(table));
    const cols = Object.keys(rows[0]).filter((c) => accepted.has(c));
    if (!cols.length) continue;
    const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    for (const row of rows) run(sql, ...cols.map((c) => row[c]));
  }

  /*
    A cost price is a weighted average of what was paid, and every purchase has
    just gone. Leaving the old average would put a figure on the profit of the
    first sale after this that nothing in the books supports.
  */
  run(`UPDATE items SET cost_cents = 0`);
});

console.log(`Carried across: ${ORDER.map((t) => `${(carried[t] ?? []).length} ${t}`).join(", ")}.`);

// Prove it rather than assume it: a reset that quietly left numbers behind is
// the whole problem being solved.
const MUST_BE_EMPTY = [
  "stock_movements", "pack_moves", "sales", "sale_lines", "payments",
  "batches", "batch_lines", "repacks", "repack_lines", "purchases",
  "purchase_lines", "expenses", "day_closes", "quotes", "quote_lines",
  "price_changes", "audit_log", "sessions",
];
const leftover = [];
for (const t of MUST_BE_EMPTY) {
  let n = 0;
  try { n = get(`SELECT COUNT(*) AS n FROM ${t}`).n; } catch { n = 0; }
  if (n > 0) leftover.push(`${t}=${n}`);
}
if (leftover.length) {
  console.error("NOT ZERO: " + leftover.join(", "));
  process.exit(1);
}

// And prove the catalogue actually arrived, or a "successful" reset would hand
// the shop an empty system it did not ask for.
const items = get(`SELECT COUNT(*) AS n FROM items`).n;
if (carried.items?.length && !items) {
  console.error("REFUSED: the catalogue did not carry across.");
  process.exit(1);
}
console.log(`Verified: ${items} product(s) on the list, every number at zero.`);
closeDb();
'

echo "==> Swapping the fresh database into place"
rm -f "$DATA_DIR/.zero.db-shm" "$DATA_DIR/.zero.db-wal"
mkdir -p "$DATA_DIR/backups"
mv "$DATA_DIR/riziki.db" "$DATA_DIR/backups/riziki.db.superseded-$(date -u +%Y%m%dT%H%M%SZ).bak"
rm -f "$DATA_DIR/riziki.db-shm" "$DATA_DIR/riziki.db-wal"
mv "$DATA_DIR/.zero.db" "$DATA_DIR/riziki.db"
rm -f "$DATA_DIR/.zero-carry.json"

echo "==> Starting the app"
docker compose up -d pos
APP_IS_DOWN=0

echo
echo "==> Done. Sign in with the PIN you already use — it still works."
echo
echo "    Everything you typed is still there. What is gone is every number."
echo "    Put the real ones in, in this order:"
echo "      1. Purchases  →  record what you actually bought, so the cost"
echo "         prices are right before anything is sold."
echo "      2. Stock  →  a stock take for anything already on the shelf that"
echo "         did not arrive through a delivery."
echo "      3. Mixing board  →  mix what is standing mixed, and say how many"
echo "         jerricans it is poured into."
echo
echo "    The previous database is in data/backups/ if this needs undoing."
