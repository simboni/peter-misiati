#!/bin/sh
# Clear pre-launch test data before the client starts testing for real. Run
# this on the server, from apps/riziki-pos:
#
#   sh deploy/reset-test-data.sh
#
# Why this cannot be a simple DELETE: sales, sale_lines and stock_movements
# are permanently immutable on this system, by design — triggers block even
# an UPDATE or DELETE from the database owner. That is not a bug to route
# around; it is the whole point of an audit trail (see DEPLOY.md, "If
# something goes wrong": "every correction has an in-app path"). So the only
# way to get a genuinely empty sales history is a fresh database file, the
# same way `docker compose stop; cp a backup over data/riziki.db; start`
# already works for restoring a snapshot (also documented in DEPLOY.md).
#
# The one thing a plain fresh reseed would lose is real: if the owner has
# already changed their PIN away from the shipped demo one, that lives in the
# same database file. So this script carries the CURRENT users table forward
# across the rebuild — the owner's real PIN survives; only the sales, stock
# and shop history reset to zero. Settings (shop name/phone/KRA PIN) carry
# forward the same way, in case those were filled in for real already too.
#
# What ends up fresh (never existed until now, by definition):
#   sales, sale_lines, payments, batches, batch_lines, repacks, repack_lines,
#   expenses, day_closes, purchases, purchase_lines, customers, audit_log,
#   sessions, stock_movements (rebuilt as: the catalogue's original opening
#   count from the client's stock sheet, then the later physical-count
#   correction applied on top of it — the same real numbers already checked
#   into this repo's own reset, nothing invented here).
#
# What survives the rebuild unchanged:
#   users (so the owner's real PIN is not lost), settings (if anything in
#   there was filled in for real), the catalogue, chemicals and formulas
#   (these were never demo data to begin with — see seed.ts's own sourcing
#   notes).

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
echo "This rebuilds the database from scratch: every sale, batch, repack,"
echo "customer, expense, purchase and day close on this server will be gone"
echo "for good, and stock resets to the client's original counted numbers."
echo "The owner's PIN and shop settings are carried forward, not lost."
printf "Type CLEAR to continue: "
read -r confirm
if [ "$confirm" != "CLEAR" ]; then
  echo "Not confirmed — nothing was touched."
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Saving the current users and settings tables"
docker compose exec -T pos node --experimental-strip-types -e '
const { all } = await import("./src/lib/db.ts");
console.log(JSON.stringify({
  users: all("SELECT name, role, pin_hash, active FROM users"),
  settings: all("SELECT key, value FROM settings"),
}));
' > "$WORK/carry-forward.json"

echo "==> Stopping the app"
docker compose stop pos

echo "==> Building a fresh database"
docker compose run --rm --no-deps \
  -e RIZIKI_DB=/app/data/.reset-fresh.db \
  pos node --experimental-strip-types -e '
const { seed } = await import("./src/lib/seed.ts");
console.log(seed());
'

echo "==> Restoring the owner account, shop settings, and the real stock count"
CARRY_FORWARD_JSON="$(cat "$WORK/carry-forward.json")" \
docker compose run --rm --no-deps \
  -e RIZIKI_DB=/app/data/.reset-fresh.db \
  -e CARRY_FORWARD_JSON="$CARRY_FORWARD_JSON" \
  pos node --experimental-strip-types -e '
const { run, get, tx, closeDb } = await import("./src/lib/db.ts");
const { performStocktake } = await import("./src/lib/stock-service.ts");

const carried = JSON.parse(process.env.CARRY_FORWARD_JSON);

tx(() => {
  // The two seeded accounts are updated in place rather than deleted and
  // reinserted: seed() has already written formula_versions rows whose
  // created_by points at the fresh owner user id, and deleting that row
  // first breaks the foreign key. Any accounts the shop added beyond those
  // two (extra attendants, a second owner) are inserted alongside, so
  // nobody loses their login.
  const takenIds = new Set();
  const leftovers = [];
  for (const u of carried.users) {
    const existing = get(
      "SELECT id FROM users WHERE role = ? AND id NOT IN (SELECT value FROM json_each(?))",
      u.role,
      JSON.stringify([...takenIds]),
    );
    if (existing) {
      takenIds.add(existing.id);
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
console.log(`Carried forward ${carried.users.length} user(s), ${carried.settings.length} setting(s).`);

// The same physical-count correction already checked into this session,
// applied on top of the fresh seed opening stock — real numbers, not invented.
const COUNTS = [
  ["Ungerol — 20 kg", 19], ["Ungerol — 5 kg", 6], ["Ungerol — 1 kg", 14], ["Ungerol — 500 g", 33], ["Ungerol — 250 g", 30],
  ["Ufacid — 20 kg", 2], ["Ufacid — 5 kg", 18], ["Ufacid — 500 g", 12], ["Ufacid — 250 g", 14], ["Ufacid — 125 g", 12],
  ["Salt — 50 kg bag", 10], ["Salt — 1 kg", 24], ["Salt — 500 g", 12], ["Salt — 250 g", 26],
  ["H.C.L — 40 kg drum", 5], ["H.C.L — 1 kg", 11], ["H.C.L — 500 g", 8],
  ["Hypo — 23 L drum", 1], ["Hypo — 5 L", 5], ["Hypo — 1 L", 2],
  ["Chlorine — 45 kg drum", 20], ["Chlorine — 20 kg", 1], ["Chlorine — 1 kg", 40],
  ["Caustic Soda — 25 kg bag", 5], ["Caustic Soda — 1 kg", 19],
  ["Magadi — 50 kg bag", 15], ["Magadi — 1 kg", 45],
  ["Finesalt — 50 kg bag", 4], ["Finesalt — 1 kg", 55],
  ["C.D.E — 20 kg drum", 7], ["C.D.E — 5 kg", 5],
  ["DOD — 20 kg drum", 7], ["DOD — 5 kg", 6], ["DOD — 1 kg", 2],
  ["Blue Colour — 1 kg tub", 34], ["Green Colour — 1 kg tub", 46],
  ["C.M.C — 25 kg bag", 3], ["C.M.C — 1 kg", 42],
  ["S.T.P.P — 25 kg bag", 21], ["S.T.P.P — 1 kg", 21],
  ["Simet — 25 kg bag", 2], ["Simet — 1 kg", 22],
  ["Conditioner Base — 25 kg bag", 1], ["Conditioner Base — 1 kg", 29],
  ["Peroxide — 30 kg drum", 5], ["Peroxide — 5 kg", 6],
  ["White Oil — 20 L drum", 6], ["White Oil — 5 L", 2],
  ["I.P.A — 20 L drum", 2], ["I.P.A — 5 L", 6],
];
const owner = get("SELECT id FROM users WHERE role = \x27owner\x27 LIMIT 1");
const counts = [];
for (const [name, countedUnits] of COUNTS) {
  const item = get("SELECT id FROM items WHERE name = ? AND active = 1", name);
  if (item) counts.push({ itemId: item.id, countedUnits });
}
const result = performStocktake({
  counts,
  reason: "Physical count sheet (PARTICULARS), applied to the fresh database ahead of client testing.",
  userId: owner ? owner.id : null,
});
console.log(`Stock: posted ${result.posted} of ${result.countedItems} counted corrections.`);
closeDb();
'

echo "==> Swapping the fresh database into place"
docker compose exec -T pos rm -f /app/data/.reset-fresh.db-shm /app/data/.reset-fresh.db-wal
mv "$DATA_DIR/riziki.db" "$DATA_DIR/backups/riziki.db.superseded-$(date -u +%Y%m%dT%H%M%SZ).bak"
rm -f "$DATA_DIR/riziki.db-shm" "$DATA_DIR/riziki.db-wal"
mv "$DATA_DIR/.reset-fresh.db" "$DATA_DIR/riziki.db"

echo "==> Starting the app"
docker compose start pos

echo
echo "==> Done. Sign in with the owner PIN you already set and confirm it"
echo "    still works. The pre-reset database is saved in data/backups/ if"
echo "    anything here needs to be undone."
