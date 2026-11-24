#!/usr/bin/env bash
#
# Upgrade the running TallyPay on the Contabo box to the current branch.
#
#   ssh root@169.58.127.122
#   cd /srv/tallypay/repo && git pull && bash deploy/upgrade.sh
#
# What this does, in order:
#   1. Backs the database up and PROVES the backup is readable
#   2. Records the running image so a rollback is one command
#   3. Pulls, rebuilds, restarts (the entrypoint applies migrations)
#   4. Verifies schema, data and HTTP; rolls back automatically if unhealthy
#   5. Wires CRON_SECRET into compose if it is missing
#
# Safe to run twice. Every step is idempotent and nothing is destructive:
# migrations 0014 and 0015 only ADD columns and a table, so the previous image
# runs happily against the upgraded database. That is what makes rollback real.
#
#   bash deploy/upgrade.sh              upgrade
#   bash deploy/upgrade.sh --rollback   go back to the previous image
set -euo pipefail

DIR=${DIR:-/srv/tallypay}
REPO=${REPO:-$DIR/repo}
COMPOSE=${COMPOSE:-$DIR/compose.yml}
VOLUME=${VOLUME:-tallypay_tallypay-data}
DB=${DB:-/data/tallypay.db}
HOST=${HOST:-tallypay.smp.co.ke}
BACKUPS=${BACKUPS:-/root/tallypay-backups}
STAMP=$(date -u +%F_%H%M%S)

say()  { printf '\n\033[1;32m== %s\033[0m\n' "$1"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$1"; }
ok()   { printf '  \033[1;32m+\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31m×  %s\033[0m\n' "$1" >&2; exit 1; }

# Run sqlite against the live volume from a throwaway container, so the box
# needs no sqlite3 installed and the app keeps running throughout.
sqlite_ro() {
  docker run --rm -v "$VOLUME":/data alpine:3 sh -c \
    "apk add --no-cache sqlite >/dev/null 2>&1; sqlite3 -noheader $DB \"$1\""
}

# ------------------------------------------------------------------ rollback --
if [ "${1:-}" = "--rollback" ]; then
  [ -f "$DIR/.last-image" ] || die "No $DIR/.last-image — nothing recorded to roll back to."
  prev=$(cat "$DIR/.last-image")
  say "ROLLING BACK to $prev"
  docker tag "$prev" tallypay:local
  docker compose -f "$COMPOSE" up -d --no-build
  sleep 10
  docker compose -f "$COMPOSE" ps
  echo
  echo "The database keeps the new columns. That is fine — the old code ignores"
  echo "them. To restore the data too, see the restore command printed below:"
  ls -1t "$BACKUPS"/pre-upgrade-*.db 2>/dev/null | head -1 | sed 's/^/  /'
  exit 0
fi

# ----------------------------------------------------------------- preflight --
say "PREFLIGHT"
[ -d "$REPO/.git" ] || die "$REPO is not a git clone. Is this the right box?"
[ -f "$COMPOSE" ]   || die "$COMPOSE not found."
[ -f "$DIR/.env" ]  || die "$DIR/.env not found — the app cannot start without it."
docker ps --format '{{.Names}}' | grep -qx tallypay \
  || die "The tallypay container is not running. Start it first, then upgrade."
ok "container running, compose and .env present"

mkdir -p "$BACKUPS"

before_invoices=$(sqlite_ro "select count(*) from invoice;")
before_orgs=$(sqlite_ro "select count(*) from organization;")
before_payments=$(sqlite_ro "select count(*) from payment;")
ok "live data: $before_orgs orgs, $before_invoices invoices, $before_payments payments"
[ "$before_invoices" -gt 0 ] || die "Zero invoices in the live database. Refusing to touch it — investigate first."

# ------------------------------------------------------------------- backup --
# Before a migration, always. `.backup` is consistent on a live database;
# a plain cp of an open SQLite file is not.
say "BACKUP"
BK="$BACKUPS/pre-upgrade-$STAMP.db"
docker run --rm -v "$VOLUME":/data -v "$BACKUPS":/b alpine:3 sh -c \
  "apk add --no-cache sqlite >/dev/null 2>&1; sqlite3 $DB \".backup /b/pre-upgrade-$STAMP.db\""
[ -s "$BK" ] || die "Backup file is empty or missing. STOPPING — nothing has been changed."

# A file that exists is not a backup. Read it back before trusting it.
bk_invoices=$(docker run --rm -v "$BACKUPS":/b alpine:3 sh -c \
  "apk add --no-cache sqlite >/dev/null 2>&1; sqlite3 -noheader /b/pre-upgrade-$STAMP.db 'select count(*) from invoice;'")
[ "$bk_invoices" = "$before_invoices" ] \
  || die "Backup has $bk_invoices invoices but live has $before_invoices. STOPPING — nothing changed."
ok "$BK ($(du -h "$BK" | cut -f1)) verified: $bk_invoices invoices readable"

# Keep a rollback target.
docker image inspect tallypay:local >/dev/null 2>&1 && {
  docker tag tallypay:local "tallypay:prev-$STAMP"
  echo "tallypay:prev-$STAMP" > "$DIR/.last-image"
  ok "previous image tagged tallypay:prev-$STAMP"
}

# ------------------------------------------------------------ CRON_SECRET ----
# /api/cron/reminders fails CLOSED without this, so the nightly sweep would
# 503 forever and nobody would notice until invoices went unchased.
say "CRON SECRET"
if ! grep -q '^CRON_SECRET=' "$DIR/.env"; then
  printf '\n# Guards /api/cron/* — the nightly reminder sweep.\nCRON_SECRET=%s\n' \
    "$(openssl rand -hex 32)" >> "$DIR/.env"
  ok "generated CRON_SECRET and appended it to $DIR/.env"
else
  ok "CRON_SECRET already in .env"
fi

if ! grep -q 'CRON_SECRET' "$COMPOSE"; then
  cp "$COMPOSE" "$COMPOSE.bak-$STAMP"
  # Insert alongside the other environment entries, after OWNER_EMAILS.
  sed -i 's|^\( *\)OWNER_EMAILS: .*|&\n\1# Guards /api/cron/* — the nightly reminder sweep.\n\1CRON_SECRET: ${CRON_SECRET:-}|' "$COMPOSE"
  grep -q 'CRON_SECRET' "$COMPOSE" \
    || die "Could not add CRON_SECRET to $COMPOSE. Add it by hand under environment:, then re-run."
  ok "added CRON_SECRET to compose (backup at $COMPOSE.bak-$STAMP)"
else
  ok "CRON_SECRET already wired into compose"
fi

# -------------------------------------------------------------------- build --
say "PULL AND REBUILD"
git -C "$REPO" pull --ff-only
echo "  now at: $(git -C "$REPO" log --oneline -1)"
docker compose -f "$COMPOSE" up -d --build

say "WAITING FOR HEALTH"
healthy=0
for i in $(seq 1 30); do
  st=$(docker inspect -f '{{.State.Health.Status}}' tallypay 2>/dev/null || echo unknown)
  printf '\r  attempt %-2s: %s   ' "$i" "$st"
  [ "$st" = "healthy" ] && { healthy=1; break; }
  sleep 5
done
echo
if [ "$healthy" != 1 ]; then
  warn "Container did not become healthy. Last 40 log lines:"
  docker compose -f "$COMPOSE" logs --tail=40 app
  die "Unhealthy after upgrade. Roll back with: bash deploy/upgrade.sh --rollback"
fi
ok "container healthy"

# ------------------------------------------------------------------- verify --
say "VERIFY"
applied=$(sqlite_ro "select count(*) from d1_migrations;")
echo "  migrations applied: $applied"
sqlite_ro "select name from d1_migrations order by id desc limit 2;" | sed 's/^/    /'

for col in reminders_enabled reminder_schedule reminder_max_age; do
  n=$(sqlite_ro "select count(*) from pragma_table_info('org_profile') where name='$col';")
  [ "$n" = "1" ] || die "Column org_profile.$col is missing — the migration did not apply. Roll back."
  ok "org_profile.$col present"
done
n=$(sqlite_ro "select count(*) from sqlite_master where type='table' and name='invoice_reminder';")
[ "$n" = "1" ] || die "Table invoice_reminder is missing. Roll back."
ok "invoice_reminder table present"

after_invoices=$(sqlite_ro "select count(*) from invoice;")
after_orgs=$(sqlite_ro "select count(*) from organization;")
[ "$after_invoices" = "$before_invoices" ] \
  || die "Invoice count changed: $before_invoices -> $after_invoices. STOP and restore from $BK."
ok "data intact: $after_orgs orgs, $after_invoices invoices"

# The whole point of migration 0015: nobody gets chased without opting in.
enabled=$(sqlite_ro "select count(*) from org_profile where reminders_enabled=1;")
total=$(sqlite_ro "select count(*) from org_profile;")
if [ "$enabled" = "0" ]; then
  ok "reminders OFF for all $total existing workspaces — no client will be emailed until a vendor opts in"
else
  warn "$enabled of $total workspaces have reminders ON. If this is an upgrade of existing data that is WRONG — check migration 0015 ran."
fi

say "HTTP"
code=$(curl -sS -o /dev/null -m 20 -H 'Accept: text/html' -w '%{http_code}' "https://$HOST/" || echo 000)
echo "  https://$HOST/  -> $code"
case "$code" in 2*|3*) ok "site responding" ;; *) warn "Site did not answer 2xx/3xx. Check: docker compose -f $COMPOSE logs --tail=40 app" ;; esac

secret=$(grep '^CRON_SECRET=' "$DIR/.env" | cut -d= -f2-)
cron_code=$(curl -sS -o /dev/null -m 60 -w '%{http_code}' \
  -H "Authorization: Bearer $secret" "https://$HOST/api/cron/reminders" || echo 000)
echo "  /api/cron/reminders -> $cron_code  (200 = sweep ran; 401 = secret mismatch; 503 = not wired)"

say "DONE"
cat <<EOF
  Backup:   $BK
  Rollback: bash deploy/upgrade.sh --rollback

  Reminders are OFF for every existing workspace. Each vendor turns them on in
  Settings, where the form tells them how many overdue invoices will be chased.
  Turn them on for your own workspace first and watch one real reminder land
  before telling anyone else about it.

  Still outstanding, separately:
    - nightly cron:    bash deploy/install-cron.sh
    - Kopo Kopo webhook -> https://$HOST/api/mpesa/kopokopo
EOF
