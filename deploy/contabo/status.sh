#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# status.sh — is everything on this box actually working?
#
#   bash status.sh                 check everything, print a report
#   bash status.sh --quiet         print only failures (for cron)
#   bash status.sh --install-cron  check every 15 minutes, mail on failure
#
# WHY THIS EXISTS. Twenty-odd containers serving six clients, and the only way
# to learn that one is down has been to look at it. StackUp sat unhealthy for
# twenty hours because nobody happened to open it. This is the command that
# answers "is everything fine" in one screen, and the exit code a cron job can
# act on.
#
# WHAT IT TOUCHES: nothing. Every check is a read or an HTTP GET. It starts,
# stops and restarts nothing, and writes nothing outside /tmp.
#
# Exit 0 when everything passed, 1 when anything failed. That is the contract
# cron depends on — do not make it exit 0 on a warning.
# ---------------------------------------------------------------------------
set -uo pipefail

QUIET=no
[ "${1:-}" = "--quiet" ] && QUIET=yes

FAILURES=0
WARNINGS=0
FAIL_TEXT=""

say()  { [ "$QUIET" = yes ] || printf '%s\n' "$*"; }
head_() { [ "$QUIET" = yes ] || printf '\n\033[1;36m== %s\033[0m\n' "$1"; }
ok()   { [ "$QUIET" = yes ] || printf '  \033[1;32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$1"; WARNINGS=$((WARNINGS + 1)); }
bad()  { printf '  \033[1;31m×\033[0m %s\n' "$1"; FAILURES=$((FAILURES + 1)); FAIL_TEXT="${FAIL_TEXT}- $1
"; }

# --- alerting --------------------------------------------------------------
#
# This box has no MTA, so cron's own mail goes nowhere — a monitor that cannot
# reach anybody is not a monitor. Mail is sent here instead, over SMTP with
# curl, using the same Brevo relay the apps already use.
#
# Credentials come from ALERT_ENV_FILE (default /etc/contabo-alert.env):
#
#   SMTP_HOST=smtp-relay.brevo.com
#   SMTP_PORT=587
#   SMTP_USER=<Brevo SMTP login, the generated ...@smtp-brevo.com>
#   SMTP_PASS=<an SMTP key, xsmtpsib-...>
#   ALERT_FROM="Box monitor <info@fitgenerationsgym.com>"
#   ALERT_TO=you@example.com
#
# chmod 600 it: this file is a working mail credential.
ALERT_ENV_FILE=${ALERT_ENV_FILE:-/etc/contabo-alert.env}
STATE_DIR=${STATE_DIR:-/var/lib/contabo-status}
# Same failures, at most one mail every 6 hours. Checking every 15 minutes and
# mailing every time would be 96 messages a day about one dead container, and
# the next real alert would arrive in a folder nobody opens.
REALERT_SECONDS=${REALERT_SECONDS:-21600}

send_alert() {
  local subject="$1" body="$2"
  [ -f "$ALERT_ENV_FILE" ] || return 1
  # shellcheck disable=SC1090
  set -a; . "$ALERT_ENV_FILE"; set +a
  [ -n "${SMTP_USER:-}" ] && [ -n "${SMTP_PASS:-}" ] && [ -n "${ALERT_TO:-}" ] || return 1
  command -v curl >/dev/null || return 1

  local msg; msg=$(mktemp)
  {
    printf 'From: %s\n' "${ALERT_FROM:-$SMTP_USER}"
    printf 'To: %s\n' "$ALERT_TO"
    printf 'Subject: %s\n' "$subject"
    printf 'Content-Type: text/plain; charset=utf-8\n\n'
    printf '%s\n' "$body"
  } > "$msg"

  curl --silent --show-error --ssl-reqd \
    --url "smtp://${SMTP_HOST:-smtp-relay.brevo.com}:${SMTP_PORT:-587}" \
    --user "$SMTP_USER:$SMTP_PASS" \
    --mail-from "$(printf '%s' "${ALERT_FROM:-$SMTP_USER}" | sed -E 's/.*<(.*)>.*/\1/')" \
    --mail-rcpt "$ALERT_TO" \
    --upload-file "$msg" >/dev/null 2>&1
  local rc=$?
  rm -f "$msg"
  return $rc
}

# --- install the cron job and exit ----------------------------------------
if [ "${1:-}" = "--install-cron" ]; then
  SELF=$(readlink -f "$0")
  LINE="*/15 * * * * /usr/bin/env bash $SELF --quiet"
  if crontab -l 2>/dev/null | grep -Fq "$SELF --quiet"; then
    echo "Already installed:"
    crontab -l | grep -F "$SELF"
  else
    ( crontab -l 2>/dev/null; echo "$LINE" ) | crontab -
    echo "Installed: checks every 15 minutes."
  fi

  if [ -f "$ALERT_ENV_FILE" ]; then
    echo "Alert config found at $ALERT_ENV_FILE — testing it now."
    if send_alert "Box monitor: test" "If you are reading this, alerts work. $(date -u +%FT%TZ)"; then
      echo "Test message accepted by the relay. Check your inbox and spam."
    else
      echo "COULD NOT SEND. Fix $ALERT_ENV_FILE — until then nothing will reach you."
      exit 1
    fi
  else
    echo
    echo "NO ALERT CONFIG. The check will run and tell nobody."
    echo "There is no MTA on this box, so cron mail goes nowhere."
    echo "Create $ALERT_ENV_FILE (chmod 600) with SMTP_USER, SMTP_PASS and"
    echo "ALERT_TO, then re-run this to send a test. See OPERATIONS.md."
    exit 1
  fi
  exit 0
fi

if [ "${1:-}" = "--test-alert" ]; then
  send_alert "Box monitor: test" "Test from $(hostname -f 2>/dev/null || hostname) at $(date -u +%FT%TZ)" \
    && echo "Accepted by the relay — check your inbox." \
    || { echo "Failed. Check $ALERT_ENV_FILE."; exit 1; }
  exit 0
fi

command -v docker >/dev/null || { echo "docker not found"; exit 1; }

# --- 1. containers ---------------------------------------------------------
head_ "CONTAINERS"

# Anything that exists but is not serving. Restarting is the dangerous one: a
# crash-looping container shows as running in `docker ps` for a second at a
# time, and "unhealthy" while running is how StackUp sat broken for 20 hours.
#
# The restart policy is what separates a fault from a decision. A container set
# to `unless-stopped` that has exited is broken; one with no restart policy is
# a one-shot job that finished, and a deliberately stopped container is not an
# incident. Reporting those would make this noisy, and a noisy check is one
# nobody reads — which is the same as having no check at all.
while IFS=$'\t' read -r name state status; do
  [ -z "$name" ] && continue

  case "$state" in
    running)
      case "$status" in
        *unhealthy*) bad "$name is UNHEALTHY — $status" ;;
        *Restarting*) bad "$name is restarting in a loop — $status" ;;
      esac
      ;;
    restarting)
      bad "$name is restarting in a loop"
      ;;
    exited|dead)
      policy=$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$name" 2>/dev/null)
      case "$policy" in
        always|unless-stopped) bad "$name is $state but should be running — $status" ;;
        *) : ;;   # a job that ran and finished
      esac
      ;;
    paused)
      warn "$name is paused"
      ;;
  esac
done < <(docker ps -a --format '{{.Names}}\t{{.State}}\t{{.Status}}')

RUNNING=$(docker ps -q | wc -l)
ok "$RUNNING containers running, none unhealthy"

# --- 2. the sites themselves ----------------------------------------------
head_ "SITES"

# The authoritative list is what Caddy is actually serving, not a list kept by
# hand in this file — a hand-kept list is wrong the first time a site is added
# and nobody notices it stopped being checked.
served_hosts() {
  docker exec edge-caddy caddy adapt --config /etc/caddy/Caddyfile 2>/dev/null | awk '
  {
    line = $0
    while (length(line) > 0) {
      if (state == 0) {
        p = index(line, "\"host\"")
        if (p == 0) break
        line = substr(line, p + 6)
        state = 1
      }
      if (state == 1) {
        b = index(line, "[")
        if (b == 0) break
        line = substr(line, b + 1)
        state = 2
      }
      e = index(line, "]")
      seg = (e > 0) ? substr(line, 1, e - 1) : line
      n = split(seg, part, "\"")
      for (i = 2; i <= n; i += 2) if (part[i] != "") print part[i]
      if (e > 0) { line = substr(line, e + 1); state = 0 } else { line = "" }
    }
  }' | sort -u
}

HOSTS=$(served_hosts)

if [ -z "$HOSTS" ]; then
  bad "Could not read the served hostnames from edge-caddy — is it running?"
else
  COUNT=0
  for h in $HOSTS; do
    COUNT=$((COUNT + 1))
    # Accept: text/html is NOT optional. Several of these apps serve a static
    # export only to something that asks for HTML and answer 404 to curl's
    # default */*, which reads as a dead site and is not one. This has fooled
    # us before.
    code=$(curl -sS -o /dev/null -m 20 -L -H 'Accept: text/html' -w '%{http_code}' "https://$h/" 2>/dev/null)
    case "${code:-000}" in
      2*|3*) [ "$QUIET" = yes ] || printf '  \033[1;32m✓\033[0m %-34s %s\n' "$h" "$code" ;;
      401|403) [ "$QUIET" = yes ] || printf '  \033[1;32m✓\033[0m %-34s %s (protected)\n' "$h" "$code" ;;
      000) bad "$h did not answer at all (DNS, TLS or the proxy)" ;;
      *) bad "$h returned $code" ;;
    esac
  done
  ok "$COUNT hostnames checked"
fi

# --- 3. certificates -------------------------------------------------------
head_ "CERTIFICATES"

# Caddy renews these by itself, and that is exactly why a failure is silent:
# renewal needs the DNS record to still point here, so a certificate quietly
# stops renewing when somebody changes DNS, and nobody finds out until it
# expires and every browser refuses the site.
if [ -n "$HOSTS" ]; then
  SOON=0
  for h in $HOSTS; do
    end=$(echo | timeout 15 openssl s_client -servername "$h" -connect "$h:443" 2>/dev/null \
      | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
    [ -z "$end" ] && continue
    end_s=$(date -d "$end" +%s 2>/dev/null) || continue
    days=$(( (end_s - $(date +%s)) / 86400 ))
    if [ "$days" -lt 0 ]; then
      bad "$h certificate EXPIRED $(( -days )) days ago"
    elif [ "$days" -lt 14 ]; then
      warn "$h certificate expires in $days days and has not renewed"
      SOON=$((SOON + 1))
    fi
  done
  [ "$SOON" = 0 ] && ok "no certificate expiring within 14 days"
fi

# --- 4. the machine --------------------------------------------------------
head_ "MACHINE"

DISK_PCT=$(df --output=pcent / | tail -1 | tr -dc '0-9')
DISK_FREE=$(df -h --output=avail / | tail -1 | tr -d ' ')
if [ "${DISK_PCT:-0}" -ge 90 ]; then
  bad "disk ${DISK_PCT}% full, only $DISK_FREE left"
elif [ "${DISK_PCT:-0}" -ge 80 ]; then
  warn "disk ${DISK_PCT}% full, $DISK_FREE left — prune the build cache"
else
  ok "disk ${DISK_PCT}% used, $DISK_FREE free"
fi

MEM_AVAIL_MB=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
if [ "${MEM_AVAIL_MB:-0}" -lt 512 ]; then
  bad "only ${MEM_AVAIL_MB}MB memory available and there is no swap"
elif [ "${MEM_AVAIL_MB:-0}" -lt 1024 ]; then
  warn "${MEM_AVAIL_MB}MB memory available — tight, with no swap to fall back on"
else
  ok "${MEM_AVAIL_MB}MB memory available"
fi

# Docker's build cache is the thing that actually fills this disk: it reached
# 31GB on its own and nothing trims it.
CACHE=$(docker system df 2>/dev/null | awk '/Build Cache/ {print $NF}')
case "$CACHE" in
  *GB) n=${CACHE%GB}; n=${n%%.*}
       if [ "${n:-0}" -ge 15 ]; then
         warn "build cache is $CACHE reclaimable — run: docker builder prune -f"
       else
         ok "build cache $CACHE reclaimable"
       fi ;;
  *) ok "build cache ${CACHE:-negligible} reclaimable" ;;
esac

# A container with no memory limit cannot be contained when it leaks, and with
# no swap the kernel kills whatever it likes — possibly another client's
# database rather than the process at fault.
UNCAPPED=$(docker ps -q | xargs -r docker inspect --format '{{.Name}} {{.HostConfig.Memory}}' 2>/dev/null \
  | awk '$2 == 0 {print substr($1,2)}' | tr '\n' ' ')
[ -n "$UNCAPPED" ] && warn "no memory limit set: $UNCAPPED"

# --- 5. backups ------------------------------------------------------------
head_ "BACKUPS"

BACKUP_DIR=${BACKUP_DIR:-/var/backups/contabo}
if [ ! -d "$BACKUP_DIR" ]; then
  bad "no backup directory at $BACKUP_DIR — nothing on this box is backed up"
else
  NEWEST=$(find "$BACKUP_DIR" -type f -mtime -2 2>/dev/null | head -1)
  if [ -z "$NEWEST" ]; then
    bad "no backup written in the last 48 hours"
  else
    ok "backups are current ($(find "$BACKUP_DIR" -type f | wc -l) files)"
  fi
fi

# --- 6. scheduled work -----------------------------------------------------
# A container can be green, serving and healthy while the work it is supposed
# to do on a timer has not run for weeks. 64theatre's expired-order release is
# the case that proved it: nothing ran the Laravel scheduler at all, so
# abandoned checkouts held their seats off sale with no error anywhere.
#
# Checked by the freshness of the log, not by the crontab: an entry that
# exists and fails every minute reads as healthy from the crontab alone.
head_ "SCHEDULED WORK"

SCHED_LOG=/var/log/64theatre-schedule.log
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -Fqx 64theatre; then
  say "  64theatre is not on this box — skipped"
elif [ ! -f "$SCHED_LOG" ]; then
  bad "64theatre's scheduler has never run — expired orders are holding seats off sale. Install it: bash deploy/contabo/64theatre/scheduler.sh --install-cron"
else
  SCHED_AGE=$(( $(date +%s) - $(stat -c %Y "$SCHED_LOG" 2>/dev/null || echo 0) ))
  if [ "$SCHED_AGE" -gt 600 ]; then
    bad "64theatre's scheduler last ran ${SCHED_AGE}s ago (should be under 60) — run it by hand to see why: bash deploy/contabo/64theatre/scheduler.sh"
  else
    ok "64theatre scheduler ran ${SCHED_AGE}s ago"
  fi
fi

# --- verdict ---------------------------------------------------------------
HOST=$(hostname -f 2>/dev/null || hostname)
mkdir -p "$STATE_DIR" 2>/dev/null
STAMP="$STATE_DIR/last-alert"
# The alert is keyed on WHAT is wrong, not on the fact that something is. A new
# failure appearing while an old one is still open must not be swallowed by the
# re-alert window, or the first fault masks every one after it.
FINGERPRINT=$(printf '%s' "$FAIL_TEXT" | cksum | tr -d ' ')

if [ "$FAILURES" -gt 0 ]; then
  printf '\n\033[1;31m%s failure(s), %s warning(s) — %s\033[0m\n' "$FAILURES" "$WARNINGS" "$HOST"

  prev_fp=""; prev_at=0
  [ -f "$STAMP" ] && read -r prev_fp prev_at < "$STAMP" 2>/dev/null
  now=$(date +%s)
  age=$((now - ${prev_at:-0}))

  if [ "$FINGERPRINT" != "${prev_fp:-}" ] || [ "$age" -ge "$REALERT_SECONDS" ]; then
    if send_alert "[$HOST] $FAILURES failing" "$FAIL_TEXT
Checked $(date -u +%FT%TZ)

This repeats at most every $((REALERT_SECONDS / 3600))h while unchanged.
Run on the box for detail:  bash $(readlink -f "$0")"; then
      printf '%s %s\n' "$FINGERPRINT" "$now" > "$STAMP"
    fi
  fi
  exit 1
fi

# Recovered: say so once, then forget. Silence after an alert is ambiguous —
# it reads the same as the check having died.
if [ -f "$STAMP" ]; then
  send_alert "[$HOST] recovered" "Everything is serving again as of $(date -u +%FT%TZ)." && rm -f "$STAMP"
fi

if [ "$WARNINGS" -gt 0 ]; then
  [ "$QUIET" = yes ] || printf '\n\033[1;33mEverything is serving. %s warning(s) worth looking at.\033[0m\n' "$WARNINGS"
  exit 0
fi

say ""
say "$(printf '\033[1;32mEverything is serving.\033[0m')"
exit 0
