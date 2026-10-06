#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# migrate.sh — apply StackUp's schema migrations.
#
#   bash /srv/stackup/migrate.sh
#
# Runs db/migrate.ts inside the API container as the stackup_migrator role.
# Safe to re-run: the runner records applied files in schema_migrations and
# skips them. Touches only the `stackup` database in the `stackup-db` container.
# ---------------------------------------------------------------------------
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE="docker compose -f $DIR/compose.yml"

[ -f "$DIR/.env" ] || { echo "ERROR: $DIR/.env not found."; exit 1; }
# shellcheck disable=SC1091
set -a; . "$DIR/.env"; set +a

: "${STACKUP_MIGRATOR_PASSWORD:?missing in .env}"

echo "==> Waiting for the database to be healthy"
for i in $(seq 1 30); do
  if $COMPOSE exec -T db pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 2
  [ "$i" = 30 ] && { echo "ERROR: database never became ready."; exit 1; }
done

echo "==> Applying migrations"
$COMPOSE exec -T \
  -e ADMIN_DB_URL="postgres://stackup_migrator:${STACKUP_MIGRATOR_PASSWORD}@db:5432/stackup" \
  api sh -c 'cd /app && ./node_modules/.bin/tsx db/migrate.ts'

echo
echo "==> Tables now present"
$COMPOSE exec -T -e PGPASSWORD="$STACKUP_MIGRATOR_PASSWORD" db \
  psql -U stackup_migrator -d stackup -At -c \
  "select count(*) || ' tables' from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE';"

echo
echo "Done. Nothing outside the stackup project was touched."
