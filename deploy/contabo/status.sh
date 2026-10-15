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

say()  { [ "$QUIET" = yes ] || printf '%s\n' "$*"; }
head_() { [ "$QUIET" = yes ] || printf '\n\033[1;36m== %s\033[0m\n' "$1"; }
ok()   { [ "$QUIET" = yes ] || printf '  \033[1;32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$1"; WARNINGS=$((WARNINGS + 1)); }
bad()  { printf '  \033[1;31m×\033[0m %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

# --- install the cron job and exit ----------------------------------------
if [ "${1:-}" = "--install-cron" ]; then
  SELF=$(readlink -f "$0")
  LINE="*/15 * * * * /usr/bin/env bash $SELF --quiet"
  if crontab -l 2>/dev/null | grep -Fq "$SELF --quiet"; then
    echo "Already installed:"
    crontab -l | grep -F "$SELF"
    exit 0
  fi
  # --quiet prints nothing when everything passes, so cron stays silent and
  # mails only when there is something wrong. A job that mails every run is a
  # job whose mail gets filtered, and then nobody sees the one that matters.
  ( crontab -l 2>/dev/null; echo "$LINE" ) | crontab -
  echo "Installed. Checks every 15 minutes; mails root only on failure."
  echo "Make sure root's mail actually reaches you, or this is a tree falling in a forest."
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

# --- verdict ---------------------------------------------------------------
if [ "$FAILURES" -gt 0 ]; then
  printf '\n\033[1;31m%s failure(s), %s warning(s) — %s\033[0m\n' "$FAILURES" "$WARNINGS" "$(hostname -f 2>/dev/null || hostname)"
  exit 1
fi

if [ "$WARNINGS" -gt 0 ]; then
  [ "$QUIET" = yes ] || printf '\n\033[1;33mEverything is serving. %s warning(s) worth looking at.\033[0m\n' "$WARNINGS"
  exit 0
fi

say ""
say "$(printf '\033[1;32mEverything is serving.\033[0m')"
exit 0
