#!/usr/bin/env bash
# One-command sandbox without Docker: builds the app, starts it, and opens a
# free Cloudflare quick tunnel so you get a real HTTPS URL — no domain, no
# account. Run from apps/riziki-pos:
#
#   bash scripts/sandbox.sh
#
# Needs Node 22+ (node:sqlite is built in from 22). Ctrl-C stops everything.
set -euo pipefail

cd "$(dirname "$0")/.."

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 22 ]; then
  echo "Node 22 or newer is required (found $(node --version)) — the database is Node's built-in SQLite." >&2
  exit 1
fi

[ -d node_modules ] || npm ci
[ -d .next ] || npx next build

# First run seeds the shop automatically when the login page loads.
npx next start --port 3100 &
POS_PID=$!
trap 'kill $POS_PID 2>/dev/null || true' EXIT

for i in $(seq 1 20); do
  curl -sf -o /dev/null http://localhost:3100/login && break
  sleep 1
done
echo
echo "POS is running on http://localhost:3100 — opening the tunnel..."
echo

# Fetch cloudflared once, next to the repo but out of git's sight.
BIN=".sandbox/cloudflared"
if [ ! -x "$BIN" ]; then
  mkdir -p .sandbox
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)  ASSET=cloudflared-linux-amd64 ;;
    Linux-aarch64) ASSET=cloudflared-linux-arm64 ;;
    Darwin-arm64)  ASSET=cloudflared-darwin-arm64.tgz ;;
    Darwin-x86_64) ASSET=cloudflared-darwin-amd64.tgz ;;
    *) echo "Download cloudflared for your platform from https://github.com/cloudflare/cloudflared/releases and put it at $BIN" >&2; exit 1 ;;
  esac
  URL="https://github.com/cloudflare/cloudflared/releases/latest/download/$ASSET"
  case "$ASSET" in
    *.tgz) curl -sL "$URL" | tar -xz -C .sandbox cloudflared ;;
    *)     curl -sL -o "$BIN" "$URL" ;;
  esac
  chmod +x "$BIN"
fi

# The https://….trycloudflare.com line it prints is your sandbox URL.
# Open it on a phone, sign in as Owner (PIN 1234), and test everything.
exec "$BIN" tunnel --no-autoupdate --url http://localhost:3100
