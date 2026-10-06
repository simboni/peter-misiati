#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# update.sh — rebuild and publish the portfolio ON the Contabo server.
#
#   cd /root/peter-misiati && bash deploy/contabo/update.sh
#
# Builds the static export inside a throwaway Node container (so the host
# needs no Node), then restarts ONLY the smp-portfolio container.
#
# It never touches edge-caddy, smpcredits, riziki, fitgen, cosdep or talithakum.
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/../.."          # repo root
ROOT="$PWD"
echo "==> Repo: $ROOT"

echo "==> 1/3  Pulling latest code"
git pull --ff-only

echo "==> 2/3  Building the static export (in a container — no Node needed on the host)"
docker run --rm \
  -v "$ROOT":/app -w /app \
  -e CI=1 \
  node:22-alpine \
  sh -c "npm ci --no-audit --no-fund && npm run build"

[ -d "$ROOT/out" ] || { echo "ERROR: out/ was not produced. Is output:'export' still set in next.config.ts?"; exit 1; }
echo "    out/ ready — $(find "$ROOT/out" -type f | wc -l) files"

echo "==> 3/3  Restarting only the portfolio container"
cd "$ROOT/deploy/contabo"
docker compose up -d

echo
docker ps --filter name=smp-portfolio --format '    {{.Names}}  {{.Status}}'
echo
echo "Done. Other sites on this server were not touched."
echo "First time only: add the site block to /srv/edge/Caddyfile, then:"
echo "    docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile"
