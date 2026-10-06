#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# capacity.sh — READ-ONLY capacity report for the Contabo box.
#
# Answers: how much CPU, RAM and disk is actually spare, what each app is
# really consuming, and how many more apps would comfortably fit.
#
# It starts nothing, stops nothing, changes nothing.
#
#   bash capacity.sh
# ---------------------------------------------------------------------------
set -uo pipefail
line() { printf '\n\033[1;32m== %s\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

line "CPU"
CORES=$(nproc 2>/dev/null || echo "?")
echo "cores: $CORES"
grep -m1 "model name" /proc/cpuinfo 2>/dev/null | sed 's/^/model: /' || true
read -r l1 l5 l15 _ < /proc/loadavg
echo "load average: ${l1} (1m)  ${l5} (5m)  ${l15} (15m)"
if [ "$CORES" != "?" ]; then
  awk -v l="$l5" -v c="$CORES" 'BEGIN{
    pct = (l/c)*100
    printf "cpu in use (5m avg): %.1f%% of %d cores  ->  %.1f cores idle\n", pct, c, c-l
  }'
fi

line "MEMORY"
free -h 2>/dev/null
echo
awk '/MemTotal|MemAvailable|SwapTotal|SwapFree/{printf "%-14s %8.2f GB\n", $1, $2/1048576}' /proc/meminfo

line "DISK"
df -h / 2>/dev/null
echo
echo "docker's own usage:"
docker system df 2>/dev/null || echo "  (needs docker access)"

line "PER-CONTAINER USAGE  (one snapshot, no streaming)"
if have docker; then
  docker stats --no-stream \
    --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' 2>/dev/null \
    || echo "  (needs docker access)"
else
  echo "  docker not available"
fi

line "MEMORY BY PROJECT  (which app costs what)"
if have docker; then
  docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' 2>/dev/null \
  | awk '{
      name=$1; mem=$2
      # normalise MiB / GiB to MiB
      v=mem+0
      if (mem ~ /GiB/) v=v*1024
      split(name, p, "-"); proj=p[1]
      tot[proj]+=v
    }
    END{
      printf "%-22s %10s\n", "PROJECT", "MiB"
      for (k in tot) printf "%-22s %10.0f\n", k, tot[k]
    }' | sort -k2 -nr
fi

line "TOP 8 PROCESSES BY MEMORY"
ps -eo pmem,rss,comm --sort=-rss 2>/dev/null | head -9 \
  | awk 'NR==1{print "  %MEM     RSS_MB  COMMAND"; next}{printf "  %-6s %8.0f  %s\n", $1, $2/1024, $3}'

line "RESTART CHURN  (an app restarting in a loop eats capacity quietly)"
docker ps -a --format '{{.Names}}\t{{.Status}}' 2>/dev/null | grep -iE "restart|unhealthy|exited" \
  || echo "  none — all containers stable"

line "VERDICT INPUTS"
AVAIL_GB=$(awk '/MemAvailable/{printf "%.1f", $2/1048576}' /proc/meminfo)
DISK_GB=$(df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9')
echo "RAM available : ${AVAIL_GB} GB"
echo "disk free     : ${DISK_GB} GB"
echo "cores         : $CORES   (5m load ${l5})"
echo
echo "Rules of thumb for this stack:"
echo "  a Next.js app container      ~ 150-400 MB"
echo "  a Postgres container         ~ 150-300 MB (more under load)"
echo "  a static site (caddy)        ~ 10-30 MB"
echo "  keep 20% of RAM and 25% of disk free as headroom"

line "DONE — nothing was changed."
