#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# discover.sh — READ-ONLY audit of the Contabo VPS before deploying anything.
#
# This script does not install, start, stop, edit or delete ANYTHING.
# It only looks. Run it on the server, then send the output back.
#
#   bash discover.sh
#
# ---------------------------------------------------------------------------
set -uo pipefail

line() { printf '\n\033[1;32m== %s\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

line "HOST"
hostname; uname -sr; cat /etc/os-release 2>/dev/null | grep -E '^(PRETTY_NAME)=' || true
echo "uptime:$(uptime -p 2>/dev/null)"

line "RESOURCES (is there room for another site?)"
free -h 2>/dev/null | head -2
df -h / /srv /var/lib/docker 2>/dev/null | grep -v "^Filesystem" | sort -u

line "WHO OWNS PORTS 80 / 443  (the thing we must not disturb)"
if have ss; then
  ss -tlnp 2>/dev/null | grep -E ':(80|443)\b' || echo "  nothing listening on 80/443"
elif have netstat; then
  netstat -tlnp 2>/dev/null | grep -E ':(80|443)\b' || echo "  nothing listening on 80/443"
elif have lsof; then
  lsof -nP -iTCP:80 -iTCP:443 -sTCP:LISTEN 2>/dev/null || echo "  nothing listening on 80/443"
else
  echo "  (no ss/netstat/lsof — run: apt-get install -y iproute2, then re-run)"
fi
# Docker publishes ports without them always showing in ss inside containers:
if have docker; then
  echo "  docker port bindings on 80/443:"
  docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null | grep -E ':(80|443)->' | sed 's/^/    /' \
    || echo "    (none, or docker needs sudo)"
fi

line "ALL LISTENING PORTS (so we pick a free internal one)"
if have ss; then ss -tlnp 2>/dev/null | awk 'NR>1{print $4}' | sort -u; fi

line "DOCKER — running containers (NOT touching them)"
if have docker; then
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' 2>/dev/null || echo "  (docker present, cannot query — try with sudo)"
  echo
  echo "compose projects:"
  docker ps --format '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null | sort -u | grep -v '^\s*$' || true
  echo
  echo "networks:"
  docker network ls 2>/dev/null
else
  echo "  docker not installed"
fi

line "REVERSE PROXY — what is already there?"
for svc in caddy nginx apache2 httpd traefik; do
  if have systemctl && systemctl list-unit-files 2>/dev/null | grep -q "^${svc}\."; then
    echo "  systemd unit: ${svc} -> $(systemctl is-active "$svc" 2>/dev/null)"
  fi
done
have caddy  && echo "  caddy binary:  $(caddy version 2>/dev/null)"
have nginx  && echo "  nginx binary:  $(nginx -v 2>&1)"

echo
echo "  candidate config files:"
for f in /etc/caddy/Caddyfile /etc/nginx/nginx.conf; do
  [ -f "$f" ] && echo "    $f ($(wc -l < "$f") lines)"
done
ls -1 /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/* 2>/dev/null | sed 's/^/    /' || true
# Caddyfiles that live inside a compose project (e.g. the Riziki stack)
find /root /home /srv /opt -maxdepth 4 -iname 'Caddyfile*' -not -path '*/node_modules/*' 2>/dev/null | sed 's/^/    /' | head -20

line "EXISTING SITES / DOMAINS ALREADY SERVED"
grep -rhoE '^[[:space:]]*[a-z0-9.-]+\.[a-z]{2,}([[:space:]]*,[[:space:]]*[a-z0-9.-]+\.[a-z]{2,})*[[:space:]]*\{' \
  /etc/caddy/Caddyfile 2>/dev/null | tr -d '{' | sed 's/^/    caddy: /' || true
grep -rhoE 'server_name[^;]+;' /etc/nginx 2>/dev/null | sed 's/^/    nginx: /' | head -20 || true
find /root /home /srv /opt -maxdepth 4 -iname 'Caddyfile*' -not -path '*/node_modules/*' 2>/dev/null \
  | while read -r f; do
      echo "    --- $f"
      grep -oE '^[a-z0-9.*-]+\.[a-z]{2,}.*\{' "$f" 2>/dev/null | sed 's/^/        /'
    done | head -40

line "WHAT THIS SERVER'S PUBLIC IP IS (for the DNS A record)"
curl -s --max-time 8 https://api.ipify.org 2>/dev/null || ip -4 addr show scope global 2>/dev/null | grep -oP 'inet \K[\d.]+' | head -2
echo

line "DONE — nothing was changed. Send this whole output back."
