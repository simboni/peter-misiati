#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# capacity.sh — READ-ONLY capacity report for the Contabo box.
#
# Answers: how much CPU, RAM and disk is actually spare, what each app really
# costs, which containers could run away with the machine, how fast the data
# is growing, and how many more apps would comfortably fit.
#
# It starts nothing, stops nothing, changes nothing.
#
#   bash capacity.sh
# ---------------------------------------------------------------------------
set -uo pipefail
line() { printf '\n\033[1;32m== %s\033[0m\n' "$1"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$1"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

line "CPU"
CORES=$(nproc 2>/dev/null || echo "?")
echo "cores: $CORES"
grep -m1 "model name" /proc/cpuinfo 2>/dev/null | sed 's/^/model: /' || true
read -r l1 l5 l15 _ < /proc/loadavg
echo "load average: ${l1} (1m)  ${l5} (5m)  ${l15} (15m)"
if [ "$CORES" != "?" ]; then
  awk -v l="$l5" -v c="$CORES" 'BEGIN{
    printf "cpu in use (5m avg): %.1f%% of %d cores  ->  %.1f cores idle\n", (l/c)*100, c, c-l
  }'
fi

line "MEMORY"
free -h 2>/dev/null
echo
awk '/MemTotal|MemAvailable|SwapTotal|SwapFree/{printf "%-14s %8.2f GB\n", $1, $2/1048576}' /proc/meminfo
SWAP_KB=$(awk '/SwapTotal/{print $2}' /proc/meminfo)
echo
if [ "${SWAP_KB:-0}" -eq 0 ]; then
  warn "NO SWAP. With none, a memory spike does not slow the box down — the"
  warn "kernel kills whichever process it picks, which may be another client's"
  warn "database rather than the thing that spiked. A 2-4 GB swapfile is cheap"
  warn "insurance and costs nothing while unused."
else
  ok "swap present"
fi

line "DISK"
df -h / 2>/dev/null
echo
echo "docker's own usage:"
docker system df 2>/dev/null || echo "  (needs docker access)"
echo
echo "reclaimable without touching an image, container or volume:"
docker system df --format '{{.Type}}\t{{.Reclaimable}}' 2>/dev/null \
  | awk -F'\t' '$1=="Build Cache"{print "  build cache: " $2}' \
  || true
echo "  (clear it with: docker builder prune -f)"

line "DATA VOLUMES  (this is the part that cannot be rebuilt)"
if have docker; then
  for v in $(docker volume ls -q 2>/dev/null); do
    mp=$(docker volume inspect "$v" --format '{{.Mountpoint}}' 2>/dev/null)
    [ -d "$mp" ] || continue
    sz=$(du -sh "$mp" 2>/dev/null | cut -f1)
    printf "  %-34s %8s\n" "$v" "${sz:-?}"
  done | sort -k2 -h -r
else
  echo "  docker not available"
fi

line "PER-CONTAINER USAGE  (one snapshot, no streaming)"
if have docker; then
  docker stats --no-stream \
    --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' 2>/dev/null \
    || echo "  (needs docker access)"
fi

line "MEMORY CAPS  (an uncapped container can take the whole box)"
if have docker; then
  printf "  %-26s %12s\n" "CONTAINER" "LIMIT"
  uncapped=0
  for c in $(docker ps --format '{{.Names}}' 2>/dev/null); do
    lim=$(docker inspect "$c" --format '{{.HostConfig.Memory}}' 2>/dev/null)
    if [ "${lim:-0}" = "0" ]; then
      printf "  %-26s %12s\n" "$c" "none"
      uncapped=$((uncapped+1))
    else
      printf "  %-26s %11.0fM\n" "$c" "$((lim/1048576))"
    fi
  done
  echo
  if [ "$uncapped" -gt 0 ]; then
    warn "$uncapped container(s) have no memory limit. One leak there and the"
    warn "kernel starts killing neighbours. Add mem_limit to their compose file."
  else
    ok "every running container has a memory limit"
  fi
fi

line "RESTART CHURN  (an app restarting in a loop eats capacity quietly)"
docker ps -a --format '{{.Names}}\t{{.Status}}' 2>/dev/null \
  | grep -iE "restarting|unhealthy|exited" \
  || echo "  none — all containers stable"

line "BACKUPS  (capacity is worthless if the data is not recoverable)"
if [ -d /var/backups ]; then
  found=$(find /var/backups -maxdepth 2 -type f \( -name '*.sql.gz' -o -name '*.dump' \) -mtime -7 2>/dev/null | wc -l)
  if [ "$found" -gt 0 ]; then
    ok "$found database backup(s) in the last 7 days"
    find /var/backups -maxdepth 2 -type f \( -name '*.sql.gz' -o -name '*.dump' \) -printf '  %TY-%Tm-%Td %10s  %p\n' 2>/dev/null | sort -r | head -5
  else
    warn "no database backup newer than 7 days under /var/backups."
    warn "Several client databases live in Docker volumes on this one disk."
  fi
else
  warn "/var/backups does not exist — nothing is being backed up on this box."
fi

line "VERDICT"
AVAIL_GB=$(awk '/MemAvailable/{printf "%.1f", $2/1048576}' /proc/meminfo)
TOTAL_GB=$(awk '/MemTotal/{printf "%.1f", $2/1048576}' /proc/meminfo)
DISK_GB=$(df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9')
DISK_PCT=$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9')
echo "RAM   : ${AVAIL_GB} GB available of ${TOTAL_GB} GB"
echo "disk  : ${DISK_GB} GB free (${DISK_PCT}% used)"
echo "cores : $CORES   (5m load ${l5})"
echo
echo "What a new app costs on this stack:"
echo "  static site (caddy)          ~  10-30 MB    negligible disk"
echo "  Next.js app, no database     ~ 150-400 MB   ~1 GB image"
echo "  Next.js + Postgres           ~ 400-700 MB   ~1.5 GB + data"
echo "  PHP/Laravel + SQLite         ~ 250-500 MB   ~1 GB + data"
echo
awk -v ram="$AVAIL_GB" -v disk="${DISK_GB:-0}" 'BEGIN{
  # Keep 20% of RAM and 25% of disk as headroom, then see what fits.
  usable_ram = ram - 1.5
  if (usable_ram < 0) usable_ram = 0
  printf "Room after keeping ~1.5 GB RAM in reserve: %.1f GB\n", usable_ram
  printf "  -> roughly %d more Next.js+Postgres apps, or %d more static sites\n", int(usable_ram/0.7), int(usable_ram/0.03)
  if (disk < 15) print "  !  disk is the tighter constraint — under 15 GB free"
}'

line "DONE — nothing was changed."
