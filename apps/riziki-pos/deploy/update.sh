#!/bin/sh
# The whole deploy, in one command. Run it on the server:
#
#   sh /root/peter-misiati/apps/riziki-pos/deploy/update.sh
#
# It pins the branch on purpose. A plain `git pull` updates whatever branch the
# server happens to be sitting on, and a server quietly parked on the wrong
# branch looks exactly like a server that is up to date: the POS restarts, the
# build succeeds, and none of the work you just pushed is anywhere on the disk.
# That cost this shop a broken public website nobody could account for.

set -eu

BRANCH="${RIZIKI_BRANCH:-claude/detergent-mixing-pos-2p5ndu}"
REPO="${RIZIKI_REPO:-/root/peter-misiati}"

cd "$REPO"

echo "==> Repository: $REPO"
echo "==> Branch:     $BRANCH  (currently on $(git rev-parse --abbrev-ref HEAD))"

git fetch origin "$BRANCH"

# The server is a deploy target, not a workspace: nothing should ever be edited
# here, and a stray edit must not be able to block a deploy. Say what is being
# thrown away, then throw it away. (`data/` — the shop's database — is
# gitignored, so it is never touched by any of this.)
if [ -n "$(git status --porcelain)" ]; then
  echo "==> Discarding local edits on the server:"
  git status --short | sed 's/^/    /'
fi

git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
echo "==> Now at $(git log --oneline -1)"

cd "$REPO/apps/riziki-pos"

# Stamp the build with the commit it came from, BEFORE the image is built, so
# the running system can say what it is. Without this a server sitting on a
# stale image looks exactly like one that is up to date: the deploy runs, the
# containers restart, the smoke test passes, and the screens are unchanged
# because the old build came back up. `public/` is copied into the image, so
# the stamp travels with the build rather than needing a .git the container
# does not have.
{
  echo "commit=$(git -C "$REPO" rev-parse --short HEAD)"
  echo "branch=$BRANCH"
  echo "built=$(date -u '+%Y-%m-%d %H:%M UTC')"
  echo "subject=$(git -C "$REPO" log -1 --pretty=%s)"
} > public/build.txt
echo "==> Stamped build: $(git -C "$REPO" rev-parse --short HEAD)"

echo
echo "==> Building and starting: shop system, website, HTTPS"
docker compose up -d --build

# A Caddyfile edit on its own does not change the caddy container's definition,
# so compose would leave it running with the old config. Ask it to reload.
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true

echo
echo "==> Waiting for the containers to answer"
sleep 8
docker compose ps

echo
sh deploy/smoke.sh
