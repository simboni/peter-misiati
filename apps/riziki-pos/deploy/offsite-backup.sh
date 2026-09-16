#!/bin/sh
# Send a copy of the shop's database somewhere that is NOT this server.
# Run on the server, from apps/riziki-pos:
#
#   sh deploy/offsite-backup.sh
#
# WHY THIS EXISTS. The nightly snapshots in data/backups/ sit on the same disk
# as the database they are copies of. They protect against a mistake — a bad
# stock take, a restore to the wrong day — and against nothing else. A dead
# server, a lost provider account or a wiped disk takes the shop's whole history
# with it, snapshots and all.
#
# The provider's own backup product is one answer, and it is charged monthly.
# This is the other one, and it is free, because of a fact about this shop's
# data: the entire database, compressed, is about twenty kilobytes. A year of
# trading will not make it a megabyte. Backing it up is not a storage problem —
# it is a "copy a small file somewhere else every night" problem, which any free
# account already does.
#
# WHERE IT SENDS. Whichever of these is configured, in deploy/offsite.env (which
# is not in the repository, because it names your account):
#
#   RIZIKI_OFFSITE_RCLONE="gdrive:riziki-backups"     Google Drive, Dropbox,
#                                                     Backblaze, any of the 70
#                                                     rclone speaks. Free tiers
#                                                     are far larger than needed.
#   RIZIKI_OFFSITE_SCP="peter@192.168.1.5:/Users/peter/riziki-backups"
#                                                     Another machine over ssh —
#                                                     a laptop, a second VPS.
#
# Set one, or set both and it sends to both. RUNBOOK.md has the ten-minute
# rclone setup.
#
# WHAT IT LEAVES BEHIND. data/offsite-last.txt, naming the file, the size, the
# destination and the time. `health.sh` reads it, so "when did a copy last leave
# this server" is answerable without logging into anything.

set -eu

COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$COMPOSE_DIR"
DATA_DIR="$COMPOSE_DIR/data"
OUT_DIR="$DATA_DIR/backups/outgoing"
STATE="$DATA_DIR/offsite-last.txt"
CONFIG="$COMPOSE_DIR/deploy/offsite.env"

if [ -f "$CONFIG" ]; then
  # shellcheck disable=SC1090
  . "$CONFIG"
fi

RCLONE_DEST="${RIZIKI_OFFSITE_RCLONE:-}"
SCP_DEST="${RIZIKI_OFFSITE_SCP:-}"

if [ -z "$RCLONE_DEST" ] && [ -z "$SCP_DEST" ]; then
  cat <<'SETUP'
Nothing is configured to receive the backup, so nothing was sent.

Write deploy/offsite.env with ONE of these lines (or both):

  RIZIKI_OFFSITE_RCLONE="gdrive:riziki-backups"
  RIZIKI_OFFSITE_SCP="you@your-laptop:/Users/you/riziki-backups"

For Google Drive — free, and you already have the account:

  apt-get install -y rclone        (once)
  rclone config                    (once: n, name it gdrive, pick drive,
                                    accept the defaults, paste the code it
                                    gives you into a browser)
  rclone mkdir gdrive:riziki-backups

Then run this script again. RUNBOOK.md, section 8, has the same steps with
more words around them.
SETUP
  exit 1
fi

echo "==> Taking a fresh snapshot"
docker compose exec -T pos npm run backup

NEWEST="$(ls -1t "$DATA_DIR"/backups/*.db 2>/dev/null | head -1 || true)"
if [ -z "$NEWEST" ]; then
  echo "No snapshot to send — is the app running? 'docker compose up -d'."
  exit 1
fi

mkdir -p "$OUT_DIR"
BASE="$(basename "$NEWEST" .db)"
GZ="$OUT_DIR/$BASE.db.gz"

echo "==> Compressing $(basename "$NEWEST")"
gzip -c "$NEWEST" > "$GZ"
SIZE="$(ls -lh "$GZ" | awk '{print $5}')"
echo "    $SIZE"

SENT=""

if [ -n "$RCLONE_DEST" ]; then
  if command -v rclone >/dev/null 2>&1; then
    echo "==> Sending to $RCLONE_DEST"
    if rclone copy "$GZ" "$RCLONE_DEST" --stats-one-line; then
      SENT="$SENT $RCLONE_DEST"
      # Ninety days of nightly copies is a few megabytes. Older than that is
      # not a backup, it is a museum.
      rclone delete "$RCLONE_DEST" --min-age 90d >/dev/null 2>&1 || true
    else
      echo "    FAILED to send to $RCLONE_DEST"
    fi
  else
    echo "    rclone is not installed on this server: apt-get install -y rclone"
  fi
fi

if [ -n "$SCP_DEST" ]; then
  echo "==> Sending to $SCP_DEST"
  if scp -q -o BatchMode=yes -o ConnectTimeout=20 "$GZ" "$SCP_DEST"; then
    SENT="$SENT $SCP_DEST"
  else
    echo "    FAILED to send to $SCP_DEST"
    echo "    (needs an ssh key on that machine — a password prompt cannot be answered by cron)"
  fi
fi

# Local copies of the compressed file are kept for a month, so a failed send can
# be retried by hand without waiting for tomorrow's snapshot.
find "$OUT_DIR" -name '*.db.gz' -mtime +30 -delete 2>/dev/null || true

if [ -z "$SENT" ]; then
  echo
  echo "Nothing left this server. The copy is still here: $GZ"
  echo "Fix the destination and run it again — or, until then, download the"
  echo "backup from the Reports screen onto your phone."
  exit 1
fi

printf '%s  %s  %s  sent to:%s\n' "$(date '+%Y-%m-%d %H:%M %Z')" "$BASE.db.gz" "$SIZE" "$SENT" > "$STATE"

echo
echo "Off the server:$SENT"
echo "Recorded in data/offsite-last.txt, which health.sh reads."
