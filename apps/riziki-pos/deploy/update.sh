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

# And the WEBSITE, stamped the same way and for a sharper reason.
#
# The shop system has said what commit it is running for a while; the website
# has never said anything. So a stale site is invisible from the outside — the
# pages that existed when it was last built still answer 200, and the only
# symptom is a 404 on a picture nobody loads on purpose. That is exactly how
# the site sat months behind with everybody believing the deploy had worked.
# `public/` is copied into the image, so the stamp travels with the files it
# describes: if /build.txt is old, everything beside it is old.
{
  echo "commit=$(git -C "$REPO" rev-parse --short HEAD)"
  echo "branch=$BRANCH"
  echo "built=$(date -u '+%Y-%m-%d %H:%M UTC')"
  echo "subject=$(git -C "$REPO" log -1 --pretty=%s)"
} > "$REPO/apps/riziki-web/public/build.txt"
echo "==> Stamped build: $(git -C "$REPO" rev-parse --short HEAD)  (shop system and website)"

echo
echo "==> Building and starting: shop system, website, HTTPS"
docker compose up -d --build

# deploy/Caddyfile is mounted read-only INTO THE SHARED EDGE as
# /etc/caddy/riziki.caddy — see the header of that file. So a hostname change
# here is live on the edge, but only once the edge re-reads its config.
#
# Validate first, and never force it. That one config is sixteen sites: a
# reload it refuses leaves the running config alone, which is the safe
# outcome, and shouting about it here is better than a deploy that quietly
# took the server's other fifteen sites with it.
if docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
  docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
    && echo "==> Shared edge reloaded — this project's hostnames are current" \
    || echo "==> Shared edge would not reload. The old routes are still live; see DEPLOY.md"
else
  echo "==> WARNING: the shared edge's config does not validate."
  echo "    Not reloading it. The routes now live are the last good ones."
  echo "    Find the bad file before anything else — while it is there, NO site"
  echo "    on this server can have its routes changed:"
  echo "      docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile"
fi

echo
echo "==> Waiting for the containers to answer"
sleep 8
docker compose ps

echo
sh deploy/smoke.sh
