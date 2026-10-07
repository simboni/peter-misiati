#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# preflight.sh — before adding an app, prove the names it wants are free.
#
#   bash preflight.sh <app-name> [public-hostname]
#
#   bash preflight.sh keysa keysa.or.ke
#
# Checks the container name, compose project, volume, directory, Caddy site
# file and hostname for collisions with anything already on this box, and
# confirms the shared `edge` network is present.
#
# READ-ONLY. It creates, starts, stops and changes nothing.
# ---------------------------------------------------------------------------
set -uo pipefail

APP="${1:?usage: preflight.sh <app-name> [public-hostname]}"
HOSTNAME_WANTED="${2:-}"
FAIL=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=1; }
note() { printf '  \033[33m•\033[0m %s\n' "$1"; }

echo
echo "Preflight for app: $APP"
echo "------------------------------------------------------------"

echo "Container name"
docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$APP" \
  && bad "a container named '$APP' already exists" \
  || ok "'$APP' is free"

echo "Compose project"
docker ps -a --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | sort -u | grep -qx "$APP" \
  && bad "compose project '$APP' already exists" \
  || ok "project '$APP' is free"

echo "Volume"
docker volume ls --format '{{.Name}}' 2>/dev/null | grep -q "^${APP}_" \
  && bad "volumes already exist with the '${APP}_' prefix" \
  || ok "no '${APP}_' volumes yet"

echo "Directory"
[ -e "/srv/$APP" ] \
  && bad "/srv/$APP already exists" \
  || ok "/srv/$APP is free"

echo "Caddy site file"
[ -e "/srv/edge/sites/$APP.caddy" ] \
  && bad "/srv/edge/sites/$APP.caddy already exists" \
  || ok "no site file for '$APP' yet"

echo "Shared edge network"
docker network ls --format '{{.Name}}' 2>/dev/null | grep -qx edge \
  && ok "the 'edge' network is present" \
  || bad "no 'edge' network — do not proceed, edge-caddy owns it"

if [ -n "$HOSTNAME_WANTED" ]; then
  echo "Hostname $HOSTNAME_WANTED"
  if grep -rqs --include='*.caddy' -- "$HOSTNAME_WANTED" /srv/edge/ 2>/dev/null; then
    bad "$HOSTNAME_WANTED is already served by another site file"
  else
    ok "not claimed by any existing site"
  fi
  resolved=$(getent hosts "$HOSTNAME_WANTED" 2>/dev/null | awk '{print $1}' | tr '\n' ' ')
  if [ -n "$resolved" ]; then
    note "resolves to: $resolved"
    note "this box is: $(curl -s --max-time 6 https://api.ipify.org 2>/dev/null)"
    note "they must match before Caddy can get a certificate"
  else
    note "does not resolve yet — point an A record at this server first,"
    note "or use <name>.<ip-with-dashes>.sslip.io for real HTTPS with no domain"
  fi
fi

echo "Room on the box"
avail=$(awk '/MemAvailable/{printf "%.1f", $2/1048576}' /proc/meminfo)
disk=$(df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9')
note "RAM available: ${avail} GB   ·   disk free: ${disk} GB"

echo "------------------------------------------------------------"
if [ "$FAIL" = 0 ]; then
  echo "Clear to proceed."
else
  echo "STOP — resolve the ✗ items first. Reusing a name can adopt or"
  echo "destroy another project's containers and volumes."
fi
echo
exit "$FAIL"
