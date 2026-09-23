#!/bin/sh
# Deploy by itself, overnight, only when there is something to deploy.
#
#   sh deploy/auto-update.sh          run it now, the way cron will
#   sh deploy/auto-update.sh --check  say what it WOULD do, change nothing
#
# WHY THIS EXISTS. Deploying meant a laptop, a terminal, an ssh password and a
# typed command, and the shop went eleven builds behind because every one of
# those is a thing that can go wrong at 9pm. Fixed bugs that sit on a branch
# help nobody.
#
# So: cron runs this at 3am. If the branch has not moved it does nothing at all
# and says so. If it has, it takes a database snapshot, deploys, waits for the
# shop to answer, and writes what happened to a log. Nobody is selling at 3am,
# which is the whole reason for the hour.
#
# WHAT IT WILL NOT DO. It never rolls back on its own: a failed deploy is left
# exactly as it is, loudly, with the previous commit written in the log, because
# an automatic rollback at 3am with nobody watching can undo a database change
# it does not understand. The shop wakes up to a clear line in the log and one
# command to run:
#
#   cd /root/peter-misiati && git checkout <the commit in the log>
#   cd apps/riziki-pos && docker compose up -d --build
#
# Set it up once:
#
#   crontab -e
#   0 3 * * * cd /root/peter-misiati/apps/riziki-pos && sh deploy/auto-update.sh >> /var/log/riziki-deploy.log 2>&1
#
# And read it whenever you wonder what the shop is running:
#
#   tail -40 /var/log/riziki-deploy.log

set -eu

COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$COMPOSE_DIR"
REPO="$(cd "$COMPOSE_DIR/../.." && pwd)"
BRANCH="${RIZIKI_BRANCH:-claude/detergent-mixing-pos-2p5ndu}"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

say() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M %Z')" "$1"; }

cd "$REPO"

# Fetch only. Nothing is checked out until we know there is a reason to.
if ! git fetch origin "$BRANCH" --quiet 2>/dev/null; then
  say "could not reach GitHub — leaving the shop exactly as it is"
  exit 0
fi

HERE="$(git rev-parse HEAD)"
THERE="$(git rev-parse "origin/$BRANCH")"

if [ "$HERE" = "$THERE" ]; then
  say "already on $(git rev-parse --short HEAD) — nothing to deploy"
  exit 0
fi

BEHIND="$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo "?")"
say "$BEHIND commit(s) behind. Going to $(git rev-parse --short "origin/$BRANCH"):"
git log --oneline "HEAD..origin/$BRANCH" 2>/dev/null | sed 's/^/          /' || true

if [ "$CHECK_ONLY" = "1" ]; then
  say "--check: nothing was deployed"
  exit 0
fi

# The database first, always. A deploy has never lost one — but the one time it
# does is the time there was no snapshot from five minutes before it.
cd "$COMPOSE_DIR"
if docker compose exec -T pos npm run backup >/dev/null 2>&1; then
  say "database snapshot taken"
else
  say "WARNING: could not take a snapshot (is the app running?) — deploying anyway"
fi

say "was on $HERE"
say "deploying…"

if sh deploy/update.sh >/dev/null 2>&1; then
  say "deployed $(git -C "$REPO" rev-parse --short HEAD)"
else
  say "DEPLOY FAILED. The shop may be down. To go back to what was running:"
  say "  cd $REPO && git checkout $HERE && cd apps/riziki-pos && docker compose up -d --build"
  exit 1
fi

# Prove the shop answers, rather than assuming the build said so.
i=0
while [ $i -lt 20 ]; do
  if curl -fsS --max-time 10 https://pos.rizikichemicals.co.ke/build.txt >/dev/null 2>&1; then
    say "the shop is answering: $(curl -fsS https://pos.rizikichemicals.co.ke/build.txt 2>/dev/null | tr '\n' ' ')"
    exit 0
  fi
  i=$((i + 1))
  sleep 3
done

say "WARNING: deployed, but the public address did not answer within a minute."
say "  Check: docker compose ps  ·  docker compose logs --tail 50 pos"
say "  To go back: cd $REPO && git checkout $HERE && cd apps/riziki-pos && docker compose up -d --build"
exit 1
