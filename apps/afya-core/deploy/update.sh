#!/usr/bin/env bash
#
# Update Afya Core on a facility's server.
#
#   cd /srv/afya/apps/afya-core && ./deploy/update.sh
#
# The order below is the whole point, so it is worth saying plainly:
#
#   snapshot → pull → BUILD → stop → start → verify
#
# The build happens while the old version is still serving. A build that fails
# — a bad pull, a full disk, a dependency that moved — leaves the clinic running
# on what it had, and this script exits having changed nothing but the checkout.
# Building after stopping would take a clinic down to find out whether the new
# version compiles.
#
# Nothing here migrates the database. The schema is CREATE TABLE IF NOT EXISTS
# throughout and new columns are added on boot by db.ts, guarded by what the
# table actually has. An update is additive or it is not deployed.
#
# Exit codes: 0 updated (or already current), 1 refused before anything
# changed, 2 something failed after the new version started — read the message,
# it names the snapshot to go back to.

set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$PWD"
COMPOSE="docker compose"
SERVICE="afya"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m%s\033[0m\n' "$*" >&2; exit "${2:-1}"; }

# ---------------------------------------------------------------- refusals
#
# All of these run before anything is touched. A server is not a place to be
# discovering that git has local edits halfway through a deployment.

command -v docker >/dev/null || die "docker is not installed on this machine."
$COMPOSE version >/dev/null 2>&1 || die "docker compose is not available (this needs Compose v2)."

if [ -n "$(git status --porcelain -- "$APP_DIR")" ]; then
  git status --short -- "$APP_DIR"
  die "There are uncommitted changes in this checkout.

A server is not a place to edit code: whatever is above will be lost by the
pull, or will silently become part of what the clinic runs. Commit it and push
it from where it was written, then run this again."
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" != "HEAD" ] || die "This checkout is on a detached HEAD, so there is nothing to pull.
Check out the branch this server should follow first."

BEFORE="$(git rev-parse HEAD)"

# ----------------------------------------------------------------- snapshot
#
# Before the pull, not after. If the pull or the build goes wrong, the snapshot
# taken here is of the database as it was when the clinic was last known good.

say "Taking a snapshot before anything changes"
if [ -f data/afya.db ]; then
  # Through the running container, because it is the process holding the file.
  $COMPOSE exec -T "$SERVICE" npm run backup \
    || die "The snapshot failed, so the update stopped. Nothing has changed.

A facility's database is the record of care given. Read the error above —
usually a full disk (check data/backups/) — and fix that first."
  SNAPSHOT="$($COMPOSE exec -T "$SERVICE" sh -c 'ls -1t data/backups/*.db 2>/dev/null | head -1' | tr -d '\r')"
else
  say "No database yet — this looks like a first deployment."
  SNAPSHOT=""
fi

# --------------------------------------------------------------------- pull

say "Fetching $BRANCH"
git pull --ff-only origin "$BRANCH" \
  || die "The pull was not a fast-forward, so it was refused. Nothing has changed.

This server's checkout has commits that the branch does not, or the branch was
rewritten. Sort that out deliberately rather than letting a deployment script
guess: 'git log HEAD..origin/$BRANCH' and 'git log origin/$BRANCH..HEAD'."

AFTER="$(git rev-parse HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then
  say "Already on the latest commit ($(git log -1 --format='%h %s'))."
  say "Nothing to do. The snapshot above is still worth having."
  exit 0
fi

printf '\n'
git --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/  /'

# -------------------------------------------------------------------- build
#
# While the old version is still serving. This is the step that fails.

say "Building the new version (the clinic is still on the old one)"
$COMPOSE build "$SERVICE" || {
  git reset --hard "$BEFORE" >/dev/null
  die "The build failed, so nothing was deployed.

The clinic is still running the version it was on, and this checkout has been
put back to $(git rev-parse --short "$BEFORE"). Read the build output above."
}

# ------------------------------------------------------------------- deploy

say "Starting it"
$COMPOSE up -d "$SERVICE"

say "Waiting for it to answer"
for i in $(seq 1 60); do
  if $COMPOSE exec -T "$SERVICE" wget -qO /dev/null http://127.0.0.1:3200/sign-in 2>/dev/null; then
    printf 'up after %ss.\n' "$i"
    break
  fi
  [ "$i" -lt 60 ] || die "It did not answer within 60 seconds.

  Logs:     $COMPOSE logs --tail=50 $SERVICE
  Go back:  git reset --hard $BEFORE && $COMPOSE up -d --build $SERVICE
${SNAPSHOT:+  The database as it was: $SNAPSHOT (see DEPLOY.md to restore it)}" 2
  sleep 1
done

# ------------------------------------------------------------------- verify
#
# A running server is not a correct one. This asks the two questions that
# matter about a clinical record: can SQLite still read its file, and has
# anything been altered behind the application's back.

say "Checking the database"
$COMPOSE exec -T "$SERVICE" npm run check || die "The new version is up, but the database did not pass its checks.

Read the message above before deciding what to do — a broken audit chain is not
a bad deployment, it is a record that was altered outside the application, and
rolling the code back will not address it.
${SNAPSHOT:+
  The snapshot from before this update: $SNAPSHOT}" 2

say "Updated $(git rev-parse --short "$BEFORE") → $(git rev-parse --short "$AFTER") and verified."
