#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# restore-from-neon.sh — copy the live StackUp data from Neon into the
# container database, then PROVE the copy matches row for row.
#
#   NEON_URL='postgresql://neondb_owner:PW@ep-xxx.aws.neon.tech/neondb?sslmode=require' \
#     bash /srv/stackup/restore-from-neon.sh
#
# Do this with nobody using StackUp.
#
# Safety:
#   - Neon is only ever READ from. Nothing is written or dropped there.
#   - Writes only into the `stackup` database inside the `stackup-db`
#     container. It cannot reach smpcredits, fitgen or riziki.
#   - pg_dump/psql run in a throwaway container, so nothing is installed on
#     the host.
#   - Refuses to run if the target already holds data, unless FORCE=1.
# ---------------------------------------------------------------------------
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE="docker compose -f $DIR/compose.yml"
DUMP_HOST_DIR="${DUMP_DIR:-/srv/stackup/dumps}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
DUMP="stackup-neon-$STAMP.dump"
PG_IMAGE="postgres:16-alpine"

: "${NEON_URL:?Set NEON_URL to the Neon OWNER connection string}"
[ -f "$DIR/.env" ] || { echo "ERROR: $DIR/.env not found."; exit 1; }
# shellcheck disable=SC1091
set -a; . "$DIR/.env"; set +a
: "${STACKUP_MIGRATOR_PASSWORD:?missing in .env}"

# Counts every table in public, exactly (not the approximate planner stats).
COUNT_SQL="SELECT table_name || ' ' ||
  (xpath('/row/cnt/text()', query_to_xml(
     format('select count(*) as cnt from %I.%I', table_schema, table_name),
     false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema='public' AND table_type='BASE TABLE'
ORDER BY table_name;"

mkdir -p "$DUMP_HOST_DIR"

echo "==> 1/5  Reading row counts from Neon (read-only)"
docker run --rm "$PG_IMAGE" psql -d "$NEON_URL" -At -c "$COUNT_SQL" \
  > "$DUMP_HOST_DIR/counts-neon-$STAMP.txt"
echo "    $(wc -l < "$DUMP_HOST_DIR/counts-neon-$STAMP.txt") tables on Neon"

echo "==> 2/5  Checking the target is empty"
EXISTING=$($COMPOSE exec -T -e PGPASSWORD="$STACKUP_MIGRATOR_PASSWORD" db \
  psql -U stackup_migrator -d stackup -At -c \
  "select coalesce(sum(n_live_tup),0) from pg_stat_user_tables;" | tr -dc '0-9')
if [ "${EXISTING:-0}" != "0" ] && [ "${FORCE:-}" != "1" ]; then
  echo "ERROR: target already holds ~$EXISTING rows."
  echo "       Re-run with FORCE=1 only if you intend to load on top of that."
  exit 1
fi

echo "==> 3/5  Dumping Neon -> $DUMP_HOST_DIR/$DUMP"
docker run --rm -v "$DUMP_HOST_DIR":/out "$PG_IMAGE" \
  pg_dump --no-owner --no-privileges --format=custom -d "$NEON_URL" -f "/out/$DUMP"
ls -lh "$DUMP_HOST_DIR/$DUMP"

echo "==> 4/5  Restoring into the container database (data only)"
docker cp "$DUMP_HOST_DIR/$DUMP" stackup-db:/tmp/restore.dump
# --data-only: migrate.sh already built the schema, policies and grants.
# --disable-triggers: lets rows load regardless of FK insertion order.
$COMPOSE exec -T -e PGPASSWORD="$STACKUP_MIGRATOR_PASSWORD" db \
  pg_restore --no-owner --no-privileges --data-only --disable-triggers \
    -U stackup_migrator -d stackup /tmp/restore.dump \
  || echo "    (pg_restore reported warnings — the comparison below is what matters)"
$COMPOSE exec -T db rm -f /tmp/restore.dump

echo "==> 5/5  Comparing row counts"
$COMPOSE exec -T -e PGPASSWORD="$STACKUP_MIGRATOR_PASSWORD" db \
  psql -U stackup_migrator -d stackup -At -c "$COUNT_SQL" \
  > "$DUMP_HOST_DIR/counts-local-$STAMP.txt"

echo
if diff -u "$DUMP_HOST_DIR/counts-neon-$STAMP.txt" "$DUMP_HOST_DIR/counts-local-$STAMP.txt"; then
  echo "MATCH — every table has the same row count as Neon."
  echo
  echo "Next: restart the API, then verify through edge-caddy:"
  echo "  docker compose -f $DIR/compose.yml restart api"
  echo "  docker exec edge-caddy wget -qO- http://stackup-api:3000/ | head -20"
else
  echo
  echo "MISMATCH — lines starting '-' are Neon, '+' are local."
  echo "Do NOT cut DNS. Neon is untouched and remains live."
  exit 1
fi
