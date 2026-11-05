#!/bin/sh
# Container entrypoint: bring the database up to date, then serve.
#
# Migrations run on every start and are idempotent — the runner records applied
# filenames in `d1_migrations` (the same bookkeeping wrangler used on D1), so a
# database imported from a D1 export is recognised as already migrated and
# nothing is re-applied.
#
# If migration fails the container exits instead of serving: a half-migrated
# schema behind a live invoice form is worse than being briefly down.
set -e

echo "==> TallyPay: applying database migrations"
node scripts/migrate.mjs

echo "==> TallyPay: starting server on ${HOSTNAME}:${PORT}"
exec node server.js
