#!/bin/sh
# Empty the shop system completely, so the real catalogue can be typed in.
# Run on the server, from apps/riziki-pos:
#
#   sh deploy/start-fresh.sh
#
# What you get afterwards: NOTHING on the shelves. No chemicals, no products,
# no recipes, no bundles, no stock, no sales, no customers, no suppliers, no
# purchases, no history of any kind. Products & prices opens on "Nothing on the
# list yet. Add the first one below", and the owner builds the catalogue from
# what is actually in the shop.
#
# This is the difference between this script and reset-test-data.sh, and it is
# the whole reason both exist:
#
#   reset-test-data.sh  keeps the delivered catalogue and zeroes every number.
#                       For learning the system on real product names.
#   start-fresh.sh      throws the delivered catalogue away too.
#                       For a shop that is going to enter its own.
#
# The catalogue this system was delivered with was transcribed from the client's
# sheets before anybody had walked the shelves. Where it is right it is worth
# keeping — and where it is right, it should be CORRECTED rather than retyped:
# every product row and every recipe can now be edited in full, name and unit
# and container included. Use this only when the answer is genuinely "start
# again", because what it throws away cannot be typed back in an afternoon.
#
# Two things carry across from the current database, because they are real and
# would be painful to lose:
#   - every user account, with its current PIN (the owner has already changed
#     theirs away from the shipped demo one — that must not be undone here);
#   - the settings table (shop name, phone, KRA PIN, cash float, printer).
#
# Why this rebuilds the database rather than deleting rows: sales, sale_lines
# and stock_movements are trigger-guarded append-only on this system, on purpose
# — the database refuses to delete them even for its owner, because that is what
# makes the audit trail worth anything. A row that cannot be deleted has to
# never be written.
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
for (const t of ["chemicals", "items", "formulas", "sales", "stock_movements",
                 "customers", "purchases"]) {
  console.log(`    ${t.padEnd(18)} ${n(t)}`);
}
'

echo
echo "This removes the ENTIRE CATALOGUE — every chemical, every product, every"
echo "recipe — along with all stock, sales and history. The system is left with"
echo "nothing on the shelves at all. Your user accounts and their PINs stay, and"
echo "so do the shop settings."
echo
echo "If any of the delivered catalogue is worth keeping, stop here: a product"
echo "row and a recipe can both be corrected in full instead."
printf "Type ERASE EVERYTHING to continue: "
read -r confirm
if [ "$confirm" != "ERASE EVERYTHING" ]; then
  echo "Not confirmed — nothing was touched."
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Saving the current user accounts and shop settings"
docker compose exec -T pos node --experimental-strip-types -e '
const { all } = await import("./src/lib/db.ts");
const settings = () => { try { return all("SELECT key, value FROM settings"); } catch { return []; } };
console.log(JSON.stringify({
  users: all("SELECT name, role, pin_hash, active FROM users ORDER BY id"),
  settings: settings(),
}));
' > "$WORK/carry-forward.json"

CARRY_FORWARD_JSON="$(cat "$WORK/carry-forward.json")"
echo "    saved $(printf '%s' "$CARRY_FORWARD_JSON" | tr ',' '\n' | grep -c '"name"') account(s)"

echo "==> Stopping the app"
docker compose stop pos

echo "==> Building an empty database (schema only — no catalogue at all)"
docker compose run --rm --no-deps \
  -e RIZIKI_DB=/app/data/.start-fresh.db \
  -e CARRY_FORWARD_JSON="$CARRY_FORWARD_JSON" \
  pos node --experimental-strip-types -e '
const { run, get, tx, closeDb } = await import("./src/lib/db.ts");
const { ensureSettingsSchema } = await import("./src/lib/print-settings.ts");

// `seed()` is deliberately NOT called. It writes the delivered catalogue and
// the two demo accounts together, and the catalogue is the thing being thrown
// away here. Importing db.ts has already run schema.sql, which is all an empty
// shop needs; the settings table belongs to another module and is created the
// same idempotent way it always is.
ensureSettingsSchema();

const carried = JSON.parse(process.env.CARRY_FORWARD_JSON);
if (!carried.users.some((u) => u.role === "owner" && u.active)) {
  console.error("REFUSED: no active owner account to carry across — you would be locked out.");
  process.exit(1);
}

tx(() => {
  for (const u of carried.users) {
    run("INSERT INTO users (name, role, pin_hash, active) VALUES (?, ?, ?, ?)",
      u.name, u.role, u.pin_hash, u.active);
  }
  for (const s of carried.settings) {
    run("INSERT INTO settings (key, value) VALUES (?, ?)", s.key, s.value);
  }
});
console.log(`Carried across: ${carried.users.length} account(s), ${carried.settings.length} setting(s).`);

// Prove it is actually empty rather than assuming it, and fail loudly if not:
// a reset that quietly left data behind is the whole problem being solved.
const TABLES = ["chemicals", "items", "formulas", "formula_versions", "formula_items",
  "bundles", "stock_movements", "sales", "sale_lines", "payments", "batches",
  "customers", "suppliers", "expenses", "purchases", "purchase_lines",
  "day_closes", "quotes", "quote_lines", "price_changes"];
const leftover = [];
for (const t of TABLES) {
  let n = 0;
  try { n = get(`SELECT COUNT(*) AS n FROM ${t}`).n; } catch { n = 0; }
  if (n > 0) leftover.push(`${t}=${n}`);
}
if (leftover.length) {
  console.error("NOT EMPTY: " + leftover.join(", "));
  process.exit(1);
}
console.log("Verified empty: nothing on the shelves, and no history.");
closeDb();
'

echo "==> Swapping the empty database into place"
rm -f "$DATA_DIR/.start-fresh.db-shm" "$DATA_DIR/.start-fresh.db-wal"
mkdir -p "$DATA_DIR/backups"
mv "$DATA_DIR/riziki.db" "$DATA_DIR/backups/riziki.db.superseded-$(date -u +%Y%m%dT%H%M%SZ).bak"
rm -f "$DATA_DIR/riziki.db-shm" "$DATA_DIR/riziki.db-wal"
mv "$DATA_DIR/.start-fresh.db" "$DATA_DIR/riziki.db"

echo "==> Starting the app"
docker compose start pos

echo
echo "==> Done. Sign in with the PIN you already set — it still works."
echo
echo "    Build the catalogue in this order, because each step needs the one"
echo "    before it:"
echo "      1. Products & prices  →  Add something. Each chemical, its unit,"
echo "         its price per kg or L, and the sizes it is sold in."
echo "      2. Recipes  →  New recipe. Mixed products, out of the chemicals"
echo "         from step 1, with the sizes they are sold in."
echo "      3. Stock  →  record what is actually on the shelf today."
echo
echo "    The previous database is in data/backups/ if this needs undoing."
