#!/bin/sh
# What this server is spending its disk, memory and CPU on.
#
# One box carries sixteen sites. Nothing here changes anything: it reads, and
# where there is something to reclaim it PRINTS the command rather than running
# it, because "docker system prune" on a shared box is not a thing to run from
# a script somebody pasted.
#
# Two things it looks hardest at, because they are what actually kills a small
# VPS, and neither announces itself until the disk is full:
#
#   CONTAINER LOGS. Docker's default driver writes JSON to disk and NEVER
#   rotates it. A chatty container can reach tens of gigabytes over a year.
#   Not one compose file on this box sets a limit.
#
#   BUILD CACHE AND OLD IMAGES. Every deploy builds a new image and orphans
#   the one before it. Sixteen projects deploying occasionally is a lot of
#   dead layers.
#
#   sh server-resources.sh

set -u
say()  { printf '%s\n' "$*"; }
head2() { printf '\n%s\n' "$*"; printf '%s\n' "------------------------------------------------------------"; }
warn() { printf '  !! %s\n' "$*"; }

head2 "Load and memory"
uptime 2>/dev/null | sed 's/^/  /'
# A load average means nothing without the core count: 3.0 is half idle on
# eight cores and a queue on two.
cores=$(nproc 2>/dev/null || echo "?")
say "  cores: $cores"
if [ "$cores" != "?" ]; then
  five=$(uptime | sed 's/.*load average: *//' | cut -d, -f2 | tr -d ' ')
  busy=$(awk -v l="$five" -v c="$cores" 'BEGIN { printf "%.2f", l / c }' 2>/dev/null)
  say "  five-minute load per core: $busy  (around 1.00 is fully busy)"
  over=$(awk -v b="$busy" 'BEGIN { print (b > 1.5) ? 1 : 0 }' 2>/dev/null)
  [ "$over" = "1" ] && warn "work is queueing — everything on this box is waiting on everything else"
fi
say ""
free -h 2>/dev/null | sed 's/^/  /'
swaps=$(free -m 2>/dev/null | awk '/^Swap:/ {print $2}')
[ "${swaps:-0}" = "0" ] && warn "no swap: a memory spike kills a container rather than slowing it down"

head2 "Disk"
df -h / /var 2>/dev/null | sed 's/^/  /'
say ""
say "  inodes (a disk can be 'full' with space left):"
df -i / 2>/dev/null | sed 's/^/    /'
use=$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9')
[ -n "${use:-}" ] && [ "$use" -ge 80 ] && warn "root filesystem is ${use}% full"

head2 "Docker's own accounting"
# First, because it is instant and usually answers the question on its own.
docker system df 2>/dev/null | sed 's/^/  /'

head2 "Where the space has gone"
say "  Walking the disk. On a full filesystem this takes a few minutes and"
say "  prints nothing while it works — it has not hung."
say ""
for d in /var/lib/docker /srv /root /home /var/log; do
  [ -d "$d" ] && du -sh "$d" 2>/dev/null | sed 's/^/  /'
done
say ""
say "  biggest ten directories outside Docker:"
du -xh --max-depth=3 /srv /root /home 2>/dev/null | sort -rh | head -10 | sed 's/^/    /'

head2 "Container logs — the ones that never rotate"
total=0
printf '  %-26s %10s  %s\n' "CONTAINER" "LOG" "LIMIT SET?"
for c in $(docker ps -a --format '{{.Names}}' 2>/dev/null); do
  lp=$(docker inspect "$c" --format '{{.LogPath}}' 2>/dev/null)
  [ -n "$lp" ] && [ -f "$lp" ] || continue
  bytes=$(stat -c %s "$lp" 2>/dev/null || echo 0)
  total=$((total + bytes))
  human=$(numfmt --to=iec --suffix=B "$bytes" 2>/dev/null || echo "${bytes}B")
  cap=$(docker inspect "$c" --format '{{index .HostConfig.LogConfig.Config "max-size"}}' 2>/dev/null)
  [ -n "$cap" ] && capped="$cap" || capped="NO LIMIT"
  printf '  %-26s %10s  %s\n' "$c" "$human" "$capped"
done
say ""
say "  total in container logs: $(numfmt --to=iec --suffix=B "$total" 2>/dev/null || echo "${total}B")"
[ "$total" -gt 1073741824 ] && warn "over a gigabyte of logs, and nothing rotates them"

head2 "Memory and CPU, per container"
docker stats --no-stream --format '  {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}' 2>/dev/null \
  | sort -t'	' -k3 -rh | head -25

head2 "Containers with no memory cap"
none=0
for c in $(docker ps --format '{{.Names}}' 2>/dev/null); do
  lim=$(docker inspect "$c" --format '{{.HostConfig.Memory}}' 2>/dev/null)
  if [ "${lim:-0}" = "0" ]; then
    say "  $c"
    none=$((none + 1))
  fi
done
[ "$none" -gt 0 ] && warn "$none container(s) may take the whole machine; one runaway stops every site"
[ "$none" -eq 0 ] && say "  (every container has one)"

head2 "Anything restarting in a loop"
docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.RestartCount}}' 2>/dev/null \
  | awk -F'\t' '$3 > 3 { printf "  !! %s  restarted %s times — %s\n", $1, $3, $2 }'
say "  (nothing listed means nothing is flapping)"

head2 "What could be reclaimed, and the command to do it"
say "  Read the numbers under RECLAIMABLE above first. Then, in order of safety:"
say ""
say "  1. Dead build layers. Safe — rebuilds just take longer next time."
say "       docker builder prune -f"
say ""
say "  2. Images no container uses. Safe on this box, because every project"
say "     builds from source and can rebuild."
say "       docker image prune -a -f"
say ""
say "  3. Truncate the logs, keeping the containers running. Do this if the"
say "     table above showed gigabytes:"
say "       for c in \$(docker ps -aq); do : > \$(docker inspect --format='{{.LogPath}}' \$c); done"
say ""
say "  4. STOP AND THINK before 'docker volume prune'. The shop's database,"
say "     StackUp's Postgres and the certificates all live in volumes. A"
say "     volume that looks unused may belong to a container that is merely"
say "     stopped. Do not run it to free space."
say ""
say "  And the lasting fix for the logs, which is a change to each compose"
say "  file rather than a command:"
say "       logging:"
say "         driver: json-file"
say "         options: { max-size: \"10m\", max-file: \"3\" }"
