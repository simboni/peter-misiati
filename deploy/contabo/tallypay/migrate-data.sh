#!/usr/bin/env bash
#
# Import the production Cloudflare D1 data into the self-hosted SQLite volume.
#
# D1 *is* SQLite, and both sides run the same 14 migrations, so this is a
# straight load — no schema translation. The dump also carries the
# `d1_migrations` table, which is why the container's migration runner sees the
# imported database as already up to date instead of trying to re-create tables.
#
# Produce the dump first, from a machine logged into Cloudflare:
#
#     npx wrangler d1 export billing-db --remote --output=tallypay-data.sql
#
# then copy it to the box and run:
#
#     bash migrate-data.sh /srv/tallypay/import/tallypay-data.sql
#
# Nothing is destroyed: the current volume contents are backed up first, and
# the import is built in a temp file and only swapped in once it verifies.
set -euo pipefail

DUMP=${1:-}
VOLUME=${VOLUME:-tallypay_tallypay-data}
COMPOSE=${COMPOSE:-/srv/tallypay/compose.yml}
BACKUP_DIR=${BACKUP_DIR:-/root/tallypay-backups}

say()  { printf '\n\033[1;32m== %s\033[0m\n' "$1"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31m×  %s\033[0m\n' "$1" >&2; exit 1; }

# Run a command against the data volume in a throwaway container that has
# sqlite3. Nothing is installed on the host.
in_vol() {
  docker run --rm \
    -v "$VOLUME":/data \
    -v "$(dirname "$DUMP")":/import:ro \
    -v "$BACKUP_DIR":/backup \
    alpine:3 sh -c "apk add --no-cache sqlite >/dev/null 2>&1; $1"
}

# ------------------------------------------------------------------ preflight --
say "PREFLIGHT"
[ -n "$DUMP" ] || die "Usage: bash migrate-data.sh /path/to/tallypay-data.sql"
[ -f "$DUMP" ] || die "$DUMP does not exist."
[ -s "$DUMP" ] || die "$DUMP is empty."

docker volume inspect "$VOLUME" >/dev/null 2>&1 \
  || die "Volume $VOLUME does not exist. Run 'docker compose up -d' once first so it is created."

for t in invoice invoice_line payment organization; do
  grep -qi "INSERT INTO .\?$t" "$DUMP" || grep -qi "CREATE TABLE .\?$t" "$DUMP" \
    || die "The dump has no sign of the '$t' table — is this really a TallyPay D1 export?"
done
printf '  dump: %s (%s)\n' "$DUMP" "$(du -h "$DUMP" | cut -f1)"

# Row counts straight from the dump, so we can prove nothing was dropped.
dump_rows() { grep -c "INSERT INTO .\?$1" "$DUMP" 2>/dev/null || echo 0; }
printf '  dump contains: %s invoice INSERTs, %s invoice_line INSERTs, %s payment INSERTs\n' \
  "$(dump_rows invoice)" "$(dump_rows invoice_line)" "$(dump_rows payment)"

mkdir -p "$BACKUP_DIR"

# ------------------------------------------------------- stop writes + back up --
say "FREEZING WRITES"
if docker ps --format '{{.Names}}' | grep -qx tallypay; then
  docker compose -f "$COMPOSE" stop app
  echo "  tallypay stopped — no writes can land during the import"
else
  echo "  tallypay is not running; nothing to stop"
fi

say "BACKING UP WHAT IS THERE NOW"
STAMP=$(date -u +%F_%H%M%S)
in_vol "if [ -f /data/tallypay.db ]; then sqlite3 /data/tallypay.db \".backup /backup/pre-import-$STAMP.db\" && echo backed-up; else echo 'no existing database'; fi"
printf '  %s/pre-import-%s.db\n' "$BACKUP_DIR" "$STAMP"

# ------------------------------------------------------------------- import --
say "IMPORTING"
BASE=$(basename "$DUMP")
in_vol "rm -f /data/.incoming.db && sqlite3 /data/.incoming.db < /import/$BASE" \
  || die "The dump failed to load. /data/tallypay.db is untouched and the backup is in $BACKUP_DIR."

say "VERIFYING THE IMPORT"
counts=$(in_vol "sqlite3 -noheader /data/.incoming.db \"
  select 'orgs='||(select count(*) from organization)
    ||' clients='||(select count(*) from client)
    ||' invoices='||(select count(*) from invoice)
    ||' lines='||(select count(*) from invoice_line)
    ||' payments='||(select count(*) from payment)
    ||' users='||(select count(*) from user)
    ||' migrations='||(select count(*) from d1_migrations);\"" | tr -d '\r')
money=$(in_vol "sqlite3 -noheader /data/.incoming.db \"
  select 'invoiced='||coalesce(sum(total),0)||' paid='||coalesce(sum(amount_paid),0) from invoice;\"" | tr -d '\r')
printf '  %s\n  %s  (integer KES cents)\n' "$counts" "$money"

echo "$counts" | grep -q 'migrations=0' \
  && warn "No d1_migrations rows — the container will re-run all migrations on this database."

# An import that produced a database with no invoices is almost certainly wrong.
if echo "$counts" | grep -qE 'invoices=0'; then
  warn "The imported database has zero invoices."
  warn "Refusing to swap it in. The old database and the backup are both intact."
  in_vol "rm -f /data/.incoming.db"
  die "Nothing was changed. Check the dump, then run this again."
fi

say "SWAPPING IT IN"
in_vol "mv /data/.incoming.db /data/tallypay.db && chown 1000:1000 /data/tallypay.db"
echo "  /data/tallypay.db replaced"

say "STARTING TALLYPAY"
docker compose -f "$COMPOSE" up -d app
echo
echo "Compare the numbers above against production D1 before you cut DNS over:"
echo
echo "  npx wrangler d1 execute billing-db --remote --command \\"
echo "    \"select (select count(*) from invoice) invoices, (select count(*) from invoice_line) lines,"
echo "            (select count(*) from payment) payments, (select sum(total) from invoice) invoiced;\""
echo
echo "They must match exactly. If they do not, restore with:"
echo "  docker compose -f $COMPOSE stop app"
echo "  docker run --rm -v $VOLUME:/data -v $BACKUP_DIR:/backup alpine:3 \\"
echo "    sh -c 'apk add --no-cache sqlite >/dev/null; cp /backup/pre-import-$STAMP.db /data/tallypay.db'"
echo "  docker compose -f $COMPOSE up -d app"
