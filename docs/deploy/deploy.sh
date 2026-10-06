#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# deploy.sh — publish the portfolio to the Contabo VPS as static files.
#
# Run this from your LOCAL machine, inside the repo:
#
#   SERVER=root@203.0.113.10 bash docs/deploy/deploy.sh
#
# What it does:
#   1. builds the static export locally (out/)
#   2. uploads it to a NEW timestamped release directory on the server
#   3. flips a `current` symlink to it — atomic, instant, zero downtime
#
# What it deliberately does NOT do:
#   - it never touches ports 80/443
#   - it never restarts, stops or reconfigures any other app or container
#   - it never edits the reverse proxy (you do that ONCE, by hand — see README)
#
# Roll back at any time:  SERVER=... bash docs/deploy/deploy.sh --rollback
# ---------------------------------------------------------------------------
set -euo pipefail

SERVER="${SERVER:?Set SERVER, e.g. SERVER=root@203.0.113.10}"
BASE="${BASE:-/srv/smp-portfolio}"        # owned entirely by this site
KEEP="${KEEP:-5}"                          # releases to retain

ssh_() { ssh -o StrictHostKeyChecking=accept-new "$SERVER" "$@"; }

if [ "${1:-}" = "--rollback" ]; then
  echo "==> Rolling back to the previous release"
  ssh_ bash -se <<EOF
set -euo pipefail
cd "$BASE/releases"
prev=\$(ls -1dt */ | sed -n '2p' | tr -d '/')
[ -n "\$prev" ] || { echo "No previous release to roll back to."; exit 1; }
ln -sfn "$BASE/releases/\$prev" "$BASE/current.tmp"
mv -Tf "$BASE/current.tmp" "$BASE/current"
echo "Rolled back to \$prev"
EOF
  exit 0
fi

REL="$(date -u +%Y%m%d-%H%M%S)"
echo "==> 1/3  Building static export locally"
npm run build >/dev/null 2>&1 || npx next build
[ -d out ] || { echo "ERROR: out/ not produced — is output:'export' still set in next.config.ts?"; exit 1; }
echo "    out/ ready ($(find out -type f | wc -l) files)"

echo "==> 2/3  Uploading release $REL"
ssh_ "mkdir -p '$BASE/releases/$REL'"
# -a archive, -z compress, --delete so a release dir exactly matches out/
rsync -az --delete out/ "$SERVER:$BASE/releases/$REL/"

echo "==> 3/3  Activating (atomic symlink swap)"
ssh_ bash -se <<EOF
set -euo pipefail
ln -sfn "$BASE/releases/$REL" "$BASE/current.tmp"
mv -Tf "$BASE/current.tmp" "$BASE/current"
# prune old releases, keeping the newest \$KEEP
cd "$BASE/releases" && ls -1dt */ | tail -n +$((KEEP+1)) | xargs -r rm -rf
echo "    live: \$(readlink -f "$BASE/current")"
EOF

echo
echo "Done. No other app on this server was touched."
echo "If this is the FIRST deploy, add the proxy block once — see docs/deploy/README.md"
