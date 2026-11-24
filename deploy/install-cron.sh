#!/usr/bin/env bash
#
# Install the nightly jobs for TallyPay: the reminder sweep and a database
# backup. Run once, on the box.
#
#   cd /srv/tallypay/repo && bash deploy/install-cron.sh
#
# Two jobs:
#   06:17 UTC (09:17 EAT) — send reminders that have come due
#   01:40 UTC (04:40 EAT) — back the database up, keep 30 days
#
# Reminders go out mid-morning Kenyan time on purpose. A payment chase that
# arrives at 3am reads as automated, and an invoice is a relationship.
#
# Idempotent: re-running replaces the TallyPay lines and leaves other cron
# entries alone.
set -euo pipefail

DIR=${DIR:-/srv/tallypay}
HOST=${HOST:-tallypay.smp.co.ke}
VOLUME=${VOLUME:-tallypay_tallypay-data}
BACKUPS=${BACKUPS:-/root/tallypay-backups}
KEEP_DAYS=${KEEP_DAYS:-30}

say() { printf '\n\033[1;32m== %s\033[0m\n' "$1"; }
ok()  { printf '  \033[1;32m+\033[0m %s\n' "$1"; }
die() { printf '\n\033[1;31m×  %s\033[0m\n' "$1" >&2; exit 1; }

[ -f "$DIR/.env" ] || die "$DIR/.env not found. Run deploy/upgrade.sh first."
grep -q '^CRON_SECRET=' "$DIR/.env" || die "No CRON_SECRET in $DIR/.env. Run deploy/upgrade.sh first."

mkdir -p "$BACKUPS"

# ---- the reminder sweep ----------------------------------------------------
# A wrapper rather than a one-line crontab entry, so the secret stays in .env
# and never appears in `crontab -l` or in the process list of other users.
say "WRITING $DIR/run-reminders.sh"
cat > "$DIR/run-reminders.sh" <<EOF
#!/usr/bin/env bash
# Nightly reminder sweep. Written by deploy/install-cron.sh — do not edit here.
set -euo pipefail
secret=\$(grep '^CRON_SECRET=' $DIR/.env | cut -d= -f2-)
[ -n "\$secret" ] || { echo "\$(date -u +%FT%TZ) no CRON_SECRET"; exit 1; }
out=\$(curl -sS -m 300 -H "Authorization: Bearer \$secret" \\
      "https://$HOST/api/cron/reminders" 2>&1) || out="curl failed: \$out"
echo "\$(date -u +%FT%TZ) \$out"
EOF
chmod 700 "$DIR/run-reminders.sh"
ok "created (mode 700 — the secret is read at run time, not baked in)"

# ---- the backup ------------------------------------------------------------
say "WRITING $DIR/run-backup.sh"
cat > "$DIR/run-backup.sh" <<EOF
#!/usr/bin/env bash
# Nightly database backup. Written by deploy/install-cron.sh.
# sqlite3 .backup is consistent on a live database; plain cp is not.
set -euo pipefail
d=\$(date -u +%F)
docker run --rm -v $VOLUME:/data -v $BACKUPS:/b alpine:3 sh -c \\
  "apk add --no-cache sqlite >/dev/null 2>&1; sqlite3 /data/tallypay.db '.backup /b/tallypay-\$d.db'"
# A file that exists is not a backup — read it back before trusting it.
n=\$(docker run --rm -v $BACKUPS:/b alpine:3 sh -c \\
  "apk add --no-cache sqlite >/dev/null 2>&1; sqlite3 -noheader /b/tallypay-\$d.db 'select count(*) from invoice;'" 2>/dev/null || echo ERR)
if [ "\$n" = "ERR" ] || [ -z "\$n" ]; then
  echo "\$(date -u +%FT%TZ) BACKUP UNREADABLE — keeping it for inspection"; exit 1
fi
echo "\$(date -u +%FT%TZ) backed up, \$n invoices"
find $BACKUPS -name 'tallypay-*.db' -mtime +$KEEP_DAYS -delete
EOF
chmod 700 "$DIR/run-backup.sh"
ok "created, keeping $KEEP_DAYS days"

# ---- crontab ---------------------------------------------------------------
say "INSTALLING CRONTAB ENTRIES"
tmp=$(mktemp)
crontab -l 2>/dev/null | grep -v '# tallypay:' > "$tmp" || true
cat >> "$tmp" <<EOF
17 6 * * * $DIR/run-reminders.sh >> /var/log/tallypay-reminders.log 2>&1 # tallypay: reminders
40 1 * * * $DIR/run-backup.sh >> /var/log/tallypay-backup.log 2>&1 # tallypay: backup
EOF
crontab "$tmp"
rm -f "$tmp"
crontab -l | grep '# tallypay:' | sed 's/^/  /'

# ---- prove both work now, rather than finding out in the morning -----------
say "RUNNING BOTH ONCE"
"$DIR/run-backup.sh"
"$DIR/run-reminders.sh"

say "DONE"
cat <<EOF
  Reminders: 06:17 UTC / 09:17 EAT   log /var/log/tallypay-reminders.log
  Backup:    01:40 UTC / 04:40 EAT   log /var/log/tallypay-backup.log, files in $BACKUPS

  The sweep sends nothing for a workspace that has not opted in, so it is safe
  to leave running from today.

  Restore (stops the app, swaps the file, starts it):
    docker compose -f $DIR/compose.yml stop app
    docker run --rm -v $VOLUME:/data -v $BACKUPS:/b alpine:3 \\
      sh -c 'cp /b/tallypay-YYYY-MM-DD.db /data/tallypay.db'
    docker compose -f $DIR/compose.yml start app
EOF
