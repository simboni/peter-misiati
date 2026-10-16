#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 64theatre — run Laravel's scheduler.
#
#   bash scheduler.sh                 run the due tasks once, show the output
#   bash scheduler.sh --install-cron  run it every minute from the host crontab
#   bash scheduler.sh --status        is it installed, and did it run lately
#
# WHY THIS EXISTS. The app has scheduled tasks and NOTHING WAS RUNNING THEM.
# The container is nginx + PHP-FPM; there is no cron inside it and no worker
# beside it, so `routes/console.php` has been a list of things that never
# happened:
#
#   · release-expired-orders (every minute) — an abandoned checkout holds its
#     seats until this runs. Without it, every buyer who starts paying and
#     walks away takes those seats off sale permanently. On a show that sells
#     out, that is money lost quietly and with no error anywhere.
#
#   · promote-referral-commission (hourly) — moves commission from "earned" to
#     "ready to pay" once the show has happened. Without it, nothing ever
#     becomes payable and the sellers' pages stay at zero owed.
#
# WHAT IT TOUCHES: the 64theatre container and nothing else. The container is
# named explicitly on every call, so this cannot act on another client's app
# even if run from the wrong directory.
#
# Laravel's own guidance is one cron entry per minute; the scheduler itself
# decides what is actually due, so adding a task to routes/console.php needs no
# change here.
# ---------------------------------------------------------------------------
set -uo pipefail

CONTAINER=64theatre
LOG=/var/log/64theatre-schedule.log
SELF=$(readlink -f "$0")
CRON_LINE="* * * * * /usr/bin/env bash $SELF --quiet >> $LOG 2>&1"

QUIET=no
[ "${1:-}" = "--quiet" ] && QUIET=yes

say() { [ "$QUIET" = yes ] || printf '%s\n' "$*"; }

# --- is it installed, and is it actually working ---------------------------
if [ "${1:-}" = "--status" ]; then
  if crontab -l 2>/dev/null | grep -Fq "$SELF"; then
    echo "✓ cron entry installed:"
    crontab -l | grep -F "$SELF" | sed 's/^/    /'
  else
    echo "✗ NOT installed. Expired orders are holding their seats and no"
    echo "  commission will ever become payable. Run: bash $SELF --install-cron"
    exit 1
  fi

  # Installed is not the same as running. A log that has not been written to
  # in the last five minutes means the entry exists and is failing.
  if [ -f "$LOG" ]; then
    AGE=$(( $(date +%s) - $(stat -c %Y "$LOG") ))
    if [ "$AGE" -lt 300 ]; then
      echo "✓ last ran ${AGE}s ago"
    else
      echo "✗ log last written ${AGE}s ago — the entry exists but is not working."
      echo "  Run it by hand to see why:  bash $SELF"
      exit 1
    fi
  else
    echo "⚠ $LOG does not exist yet. Wait a minute and check again."
  fi
  exit 0
fi

# --- install -------------------------------------------------------------
if [ "${1:-}" = "--install-cron" ]; then
  if crontab -l 2>/dev/null | grep -Fq "$SELF"; then
    echo "Already installed:"
    crontab -l | grep -F "$SELF"
  else
    # Appends. Never rewrites the crontab wholesale — the box monitor and the
    # backups live in there too.
    ( crontab -l 2>/dev/null; echo "$CRON_LINE" ) | crontab -
    echo "Installed: the scheduler now runs every minute."
  fi

  touch "$LOG" 2>/dev/null || echo "Could not create $LOG — run this as root."
  echo
  echo "Proving it works now, rather than waiting a minute:"
  exec /usr/bin/env bash "$SELF"
fi

# --- run ------------------------------------------------------------------
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -Fqx "$CONTAINER"; then
  # Not an error worth shouting about from cron every minute during a
  # rebuild, but it must not look like success either.
  say "$(date -u +%FT%TZ) container $CONTAINER is not running — skipped"
  exit 0
fi

OUT=$(docker exec "$CONTAINER" php artisan schedule:run 2>&1)
CODE=$?

if [ "$CODE" -ne 0 ]; then
  printf '%s FAILED (exit %s)\n%s\n' "$(date -u +%FT%TZ)" "$CODE" "$OUT"
  exit "$CODE"
fi

# "No scheduled commands are ready to run." is the usual answer and is not
# worth a line in the log every minute of every day.
if printf '%s' "$OUT" | grep -q 'No scheduled commands are ready'; then
  say "$(date -u +%FT%TZ) nothing due"
  exit 0
fi

printf '%s\n%s\n' "$(date -u +%FT%TZ)" "$OUT"
