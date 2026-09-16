#!/bin/sh
# Put a backup back. Run on the server, from apps/riziki-pos:
#
#   sh deploy/restore-backup.sh                 list the snapshots and pick one
#   sh deploy/restore-backup.sh data/backups/riziki-2026-09-14.db
#
# This is the "we have lost today's figures" procedure, and the one you would
# use after a disk failure once the server is back. It stops the shop system,
# swaps the database file, proves the new one opens and passes its integrity
# check, and starts the shop again.
#
# THREE THINGS IT DOES THAT DOING IT BY HAND DOES NOT:
#
#  1. It moves the current database aside instead of deleting it, so a restore
#     to the wrong day can itself be undone. The old file is left beside the
#     new one with the time in its name.
#  2. It deletes the -wal and -shm files that sit beside the database. SQLite
#     keeps recent writes in that write-ahead log; leaving an old one next to a
#     restored file mixes two different days of the shop's books together, and
#     nothing warns you.
#  3. It brings the app back up even if something fails halfway. A restore that
#     leaves the shop down is worse than the problem it was fixing.

set -eu

COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$COMPOSE_DIR"
DATA_DIR="$COMPOSE_DIR/data"
LIVE="$DATA_DIR/riziki.db"

APP_IS_DOWN=0
bring_it_back() {
  if [ "$APP_IS_DOWN" = "1" ]; then
    echo
    echo "==> Bringing the shop system back up"
    docker compose up -d pos || true
  fi
}
trap bring_it_back EXIT INT TERM

if ! docker compose ps >/dev/null 2>&1; then
  echo "docker compose will not run here. cd to apps/riziki-pos first."
  exit 1
fi

SNAPSHOT="${1:-}"

if [ -z "$SNAPSHOT" ]; then
  echo "Snapshots on this server, newest first:"
  echo
  ls -1t "$DATA_DIR"/backups/*.db 2>/dev/null | head -30 | sed 's/^/  /' || {
    echo "  (none — there is nothing to restore from)"
    exit 1
  }
  echo
  echo "Run it again with the one you want:"
  echo "  sh deploy/restore-backup.sh data/backups/riziki-YYYY-MM-DD.db"
  exit 0
fi

# The container can only see what is mounted, and the only mount is ./data. So
# the snapshot has to be named relative to apps/riziki-pos and live under data/
# — which every snapshot this system writes does.
case "$SNAPSHOT" in
  "$COMPOSE_DIR"/*) REL="${SNAPSHOT#"$COMPOSE_DIR"/}" ;;
  ./*)              REL="${SNAPSHOT#./}" ;;
  /*)               echo "Give the path as it sits under apps/riziki-pos, e.g."
                    echo "  sh deploy/restore-backup.sh data/backups/riziki-2026-09-14.db"
                    exit 1 ;;
  *)                REL="$SNAPSHOT" ;;
esac

case "$REL" in
  data/*) : ;;
  *) echo "The file has to be under data/ — that is the only directory the shop"
     echo "system can see. Copy it into data/backups/ first."
     exit 1 ;;
esac

SNAPSHOT="$COMPOSE_DIR/$REL"
if [ ! -f "$SNAPSHOT" ]; then
  echo "No such file: $SNAPSHOT"
  exit 1
fi

echo "==> Checking that snapshot before trusting it with the shop's books"
docker compose exec -T -e SNAP="/app/$REL" pos node --experimental-strip-types -e "
const { DatabaseSync } = await import('node:sqlite');
/*
  A damaged file throws on the first read rather than answering the integrity
  check, so both endings have to be caught — otherwise the person restoring
  after a disk failure gets a stack trace at the exact moment they need a
  sentence.
*/
try {
  const db = new DatabaseSync(process.env.SNAP, { readOnly: true });
  const check = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const sales = db.prepare('SELECT COUNT(*) AS n, MAX(at) AS last FROM sales').get();
  const items = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  db.close();
  if (check !== 'ok') {
    console.error('    REFUSED: that file is damaged (' + check + '). Try an older snapshot.');
    process.exit(1);
  }
  console.log('    integrity: ok');
  console.log(\`    it holds \${items} product(s) and \${sales.n} sale(s), the last on \${sales.last ?? 'never'} UTC\`);
} catch (e) {
  console.error('    REFUSED: that file will not open as a database (' + e.message + ').');
  console.error('    Try an older snapshot from data/backups/.');
  process.exit(1);
}
"

echo
echo "This will replace the shop's live database with that file."
echo "Everything recorded since that snapshot was taken will be gone from the"
echo "books: sales, deliveries, stock movements, payments, expenses."
echo
echo "The current database is not deleted — it is moved aside, so this is"
echo "reversible if you pick the wrong day."
echo
printf "Type RESTORE to continue: "
read -r confirm
if [ "$confirm" != "RESTORE" ]; then
  echo "Not confirmed — nothing was touched."
  exit 1
fi

echo "==> Taking a snapshot of the CURRENT database first"
docker compose exec -T pos npm run backup || echo "    (could not snapshot — continuing, the file is moved aside below)"

echo "==> Stopping the shop system"
APP_IS_DOWN=1
docker compose stop pos

STAMP="$(date '+%Y%m%d-%H%M%S')"
if [ -f "$LIVE" ]; then
  echo "==> Moving the current database aside as riziki.db.replaced-$STAMP"
  mv "$LIVE" "$LIVE.replaced-$STAMP"
fi
# The write-ahead log belongs to the file that has just been moved. Left here it
# would be replayed on top of the restored one.
rm -f "$LIVE-wal" "$LIVE-shm"

echo "==> Putting $SNAPSHOT in its place"
cp "$SNAPSHOT" "$LIVE"

echo "==> Starting the shop system"
docker compose up -d pos
APP_IS_DOWN=0

echo "==> Waiting for it to answer"
i=0
while [ $i -lt 30 ]; do
  if docker compose exec -T pos true >/dev/null 2>&1; then break; fi
  i=$((i + 1))
  sleep 2
done

docker compose exec -T pos node --experimental-strip-types -e '
const { get } = await import("./src/lib/db.ts");
const sales = get("SELECT COUNT(*) AS n, MAX(at) AS last FROM sales");
console.log(`    the shop is back with ${sales.n} sale(s), the last on ${sales.last ?? "never"} UTC`);
' || echo "    (could not read it back — check: docker compose logs --tail 50 pos)"

echo
echo "Restored. The database you replaced is at:"
echo "  $LIVE.replaced-$STAMP"
echo "Keep it until you are sure this was the right snapshot."
