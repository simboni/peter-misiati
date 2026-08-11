#!/bin/sh
# Reset the shop system to an empty training state. Run on the server, from
# apps/riziki-pos:
#
#   sh deploy/reset-test-data.sh
#
# What you get afterwards: the shelves, empty. Every product, pack size and
# chemical is there and correctly named, every formula is there, and every
# single number is zero — no stock, no sales, no batches, no repacks, no
# customers, no suppliers, no expenses, no purchases, no day closes, no
# history of any kind. The team learns the system by putting the first real
# numbers in themselves.
#
# Two things carry across from the current database, because they are real
# and would be painful to lose:
#   - every user account, with its current PIN (the owner has already changed
#     theirs away from the shipped demo one — that must not be undone here);
#   - the settings table (shop name, phone, KRA PIN, cash float), in case any
#     of it has been filled in for real already.
#
# Why this rebuilds the database rather than deleting rows: sales, sale_lines
# and stock_movements are all trigger-guarded append-only on this system, on
# purpose — the database refuses to delete them even for its owner, because
# that is what makes the audit trail worth anything (DEPLOY.md, "If something
# goes wrong": every correction has an in-app path). Opening stock therefore
# cannot be removed after the fact; it has to never be written, which is what
# seed({ openingStock: false }) does.
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
echo "This empties the system completely: no stock, no sales, no batches, no"
echo "customers, no history — the catalogue and formulas stay, every number"
echo "goes to zero. User accounts (with their PINs) and shop settings are"
echo "carried across."
printf "Type CLEAR to continue: "
read -r confirm
if [ "$confirm" != "CLEAR" ]; then
  echo "Not confirmed — nothing was touched."
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Saving the current user accounts and shop settings"
docker compose exec -T pos node --experimental-strip-types -e '
const { all } = await import("./src/lib/db.ts");
console.log(JSON.stringify({
  users: all("SELECT name, role, pin_hash, active FROM users"),
  settings: all("SELECT key, value FROM settings"),
}));
' > "$WORK/carry-forward.json"

CARRY_FORWARD_JSON="$(cat "$WORK/carry-forward.json")"
echo "    saved $(printf '%s' "$CARRY_FORWARD_JSON" | tr ',' '\n' | grep -c '"name"') account(s)"

echo "==> Stopping the app"
docker compose stop pos

echo "==> Building an empty database (catalogue and formulas, all counts zero)"
docker compose run --rm --no-deps \
  -e RIZIKI_DB=/app/data/.reset-fresh.db \
  -e CARRY_FORWARD_JSON="$CARRY_FORWARD_JSON" \
  pos node --experimental-strip-types -e '
const { seed } = await import("./src/lib/seed.ts");
const { run, get, all, tx, closeDb } = await import("./src/lib/db.ts");

const counts = seed({ openingStock: false });
console.log(`Catalogue: ${counts.chemicals} chemicals, ${counts.items} items, ${counts.formulas} formulas.`);

const carried = JSON.parse(process.env.CARRY_FORWARD_JSON);

tx(() => {
  // The two seeded accounts are updated in place rather than deleted and
  // reinserted: seed() has already written formula_versions rows whose
  // created_by points at the fresh owner user id, and deleting that row
  // first breaks the foreign key. Any accounts the shop added beyond those
  // two are inserted alongside, so nobody loses their login.
  const taken = [];
  const leftovers = [];
  for (const u of carried.users) {
    const existing = get(
      "SELECT id FROM users WHERE role = ? AND id NOT IN (SELECT value FROM json_each(?))",
      u.role,
      JSON.stringify(taken),
    );
    if (existing) {
      taken.push(existing.id);
      run("UPDATE users SET name = ?, pin_hash = ?, active = ? WHERE id = ?",
        u.name, u.pin_hash, u.active, existing.id);
    } else {
      leftovers.push(u);
    }
  }
  for (const u of leftovers) {
    run("INSERT INTO users (name, role, pin_hash, active) VALUES (?, ?, ?, ?)",
      u.name, u.role, u.pin_hash, u.active);
  }

  run("DELETE FROM settings");
  for (const s of carried.settings) {
    run("INSERT INTO settings (key, value) VALUES (?, ?)", s.key, s.value);
  }
});
console.log(`Carried across: ${carried.users.length} account(s), ${carried.settings.length} setting(s).`);

// Prove it is actually empty rather than assuming it, and fail loudly if not:
// a reset that quietly left data behind is the whole problem being solved.
const TABLES = ["stock_movements", "sales", "sale_lines", "payments", "batches",
  "batch_lines", "repacks", "repack_lines", "customers", "suppliers",
  "expenses", "purchases", "purchase_lines", "day_closes"];
const leftover = [];
for (const t of TABLES) {
  const n = get(`SELECT COUNT(*) AS n FROM ${t}`).n;
  if (n > 0) leftover.push(`${t}=${n}`);
}
const stocked = all("SELECT item_name FROM v_stock WHERE qty_milli != 0");
if (stocked.length) leftover.push(`${stocked.length} item(s) with non-zero stock`);
if (leftover.length) {
  console.error("NOT EMPTY: " + leftover.join(", "));
  process.exit(1);
}
console.log("Verified empty: every count above is zero.");
closeDb();
'

echo "==> Swapping the empty database into place"
rm -f "$DATA_DIR/.reset-fresh.db-shm" "$DATA_DIR/.reset-fresh.db-wal"
mkdir -p "$DATA_DIR/backups"
mv "$DATA_DIR/riziki.db" "$DATA_DIR/backups/riziki.db.superseded-$(date -u +%Y%m%dT%H%M%SZ).bak"
rm -f "$DATA_DIR/riziki.db-shm" "$DATA_DIR/riziki.db-wal"
mv "$DATA_DIR/.reset-fresh.db" "$DATA_DIR/riziki.db"

echo "==> Starting the app"
docker compose start pos

echo
echo "==> Done. Sign in with the PIN you already set — it still works."
echo "    Everything reads zero; the team fills it in from here."
echo "    The previous database is in data/backups/ if this needs undoing."
