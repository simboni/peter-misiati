#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# smp-developers.com — build and publish the portfolio, in one command.
#
#   bash deploy-portfolio.sh --status           what is live, what is on the branch
#   bash deploy-portfolio.sh --dry-run          say what it would do, change nothing
#   bash deploy-portfolio.sh                    build and publish
#   BRANCH=some/branch bash deploy-portfolio.sh publish a different branch
#
# HOW THE SITE IS SERVED. A `caddy:2-alpine` container called `smp-portfolio`
# bind-mounts this repo's `out/` directory read-only and serves it on port 80
# inside the `edge` network; edge-caddy terminates TLS and proxies to it by
# container name. So "deploying" means regenerating `out/` — there is no
# registry, no image to build, and nothing else on the box is touched.
#
# THE TRAP THIS EXISTS FOR. `next build` does not write into `out/`; it
# DELETES the directory and makes a new one. A bind mount follows the inode,
# not the path, so after a rebuild the container is serving a directory that
# no longer exists — the old site, or nothing, with no error anywhere. The
# deploy looks like it worked and the site does not change. Verified: the
# inode changes on every build. Hence --force-recreate at the end, which is
# not optional and is the whole reason this is a script.
#
# WHAT IT TOUCHES: this checkout and the `smp-portfolio` compose project.
# Nothing else on the server.
# ---------------------------------------------------------------------------
set -uo pipefail

APP=${APP:-/srv/smp-portfolio/repo}
BRANCH=${BRANCH:-claude/portfolio-design-plan-9ol8sb}
COMPOSE_DIR="$APP/deploy/contabo"
CONTAINER=${CONTAINER:-smp-portfolio}
EDGE=${EDGE:-edge-caddy}
BACKUP_DIR=${BACKUP_DIR:-/srv/smp-portfolio/before-deploy}

MODE=apply
case "${1:-}" in
  --status)  MODE=status ;;
  --dry-run) MODE=dry ;;
  "")        ;;
  *) echo "Unknown option: $1"; echo "Use --status, --dry-run, or no option."; exit 2 ;;
esac

red() { printf '\033[1;31m%s\033[0m\n' "$*"; }
grn() { printf '\033[1;32m%s\033[0m\n' "$*"; }
ylw() { printf '\033[1;33m%s\033[0m\n' "$*"; }
hdr() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

git -C "$APP" rev-parse --git-dir >/dev/null 2>&1 || { red "Not a git checkout: $APP"; exit 1; }
[ -f "$COMPOSE_DIR/compose.yml" ] || { red "No compose.yml in $COMPOSE_DIR"; exit 1; }

# --- 1. can this box build at all? -----------------------------------------
hdr "WHAT THIS BOX HAS"
if ! command -v node >/dev/null 2>&1; then
  red "node is not installed, and a Next.js static export has to be built."
  echo "Either install Node 20+ here, or build elsewhere and copy out/ across."
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
echo "node:   $(node -v)"
[ "$NODE_MAJOR" -ge 20 ] || { red "Node 20+ is required; this is $(node -v)."; exit 1; }
# The build is the heaviest thing that will run on this shared box all day.
FREE_MB=$(free -m | awk '/^Mem:/ {print $7}')
echo "free:   ${FREE_MB}MB available"
[ "${FREE_MB:-0}" -lt 700 ] && ylw "Under 700MB free — the build may be killed. Consider doing it at a quiet time."

# --- 2. what is live, and what is on the branch ----------------------------
git -C "$APP" fetch --quiet origin "$BRANCH" 2>/dev/null \
  || { red "Could not fetch $BRANCH. Check the box can reach GitHub."; exit 1; }
LIVE=$(git -C "$APP" rev-parse --short HEAD)
WANT=$(git -C "$APP" rev-parse --short "origin/$BRANCH")
echo "checkout: $APP"
echo "live:     $LIVE  $(git -C "$APP" log -1 --format=%s HEAD | cut -c1-60)"
echo "branch:   $WANT  $(git -C "$APP" log -1 --format=%s "origin/$BRANCH" | cut -c1-60)"
if [ -d "$APP/out" ]; then
  echo "out/:     built $(date -r "$APP/out" '+%Y-%m-%d %H:%M')"
else
  ylw "out/:     missing — the site has never been built here"
fi

if [ "$LIVE" = "$WANT" ] && [ -d "$APP/out" ]; then
  grn "Already on $WANT."
  echo "Rebuild anyway if out/ is stale; otherwise there is nothing to do."
fi

[ "$MODE" = status ] && { echo; echo "Run without --status to publish."; exit 0; }
[ "$MODE" = dry ] && { echo; ylw "--dry-run: would reset to $WANT, npm ci, npm run build, recreate $CONTAINER."; exit 0; }

# --- 3. a way back ---------------------------------------------------------
hdr "SAVING A WAY BACK"
mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
echo "$LIVE" > "$BACKUP_DIR/$STAMP.commit"
echo "the commit now live is $LIVE (saved to $BACKUP_DIR/$STAMP.commit)"
# The built site, not just the source: if a later build fails, this is what
# gets the site back without needing a working toolchain.
if [ -d "$APP/out" ]; then
  tar -czf "$BACKUP_DIR/$STAMP-out.tgz" -C "$APP" out 2>/dev/null \
    && echo "the site as served:  $BACKUP_DIR/$STAMP-out.tgz ($(du -h "$BACKUP_DIR/$STAMP-out.tgz" | cut -f1))"
fi

# --- 4. the source ---------------------------------------------------------
hdr "UPDATING THE CHECKOUT"
if [ -n "$(git -C "$APP" status --porcelain)" ]; then
  git -C "$APP" diff > "$BACKUP_DIR/$STAMP.diff" 2>/dev/null
  ylw "hand edits here were saved to $BACKUP_DIR/$STAMP.diff, then discarded"
fi
git -C "$APP" checkout -q -B deployed "origin/$BRANCH" || { red "Checkout failed."; exit 1; }
grn "checkout is now $(git -C "$APP" rev-parse --short HEAD)"

# --- 5. build --------------------------------------------------------------
hdr "BUILDING"
cd "$APP" || exit 1
# npm ci only when the lockfile actually moved — it is the slow half, and on a
# box this size there is no reason to pay for it on a copy-change deploy.
if [ ! -d node_modules ] || ! git diff --quiet "$LIVE" HEAD -- package-lock.json 2>/dev/null; then
  echo "dependencies changed (or are missing) — running npm ci"
  npm ci || { red "npm ci failed. Nothing was recreated; the site is still up."; exit 1; }
else
  echo "package-lock.json unchanged — skipping npm ci"
fi

if ! npm run build; then
  red "Build failed. Nothing was recreated, so the site is still serving the old"
  red "out/ — but note that directory is now whatever the failed build left."
  red "If the site looks wrong, restore it with:"
  red "    tar -xzf $BACKUP_DIR/$STAMP-out.tgz -C $APP"
  red "    cd $COMPOSE_DIR && docker compose up -d --force-recreate"
  exit 1
fi
[ -f "$APP/out/index.html" ] || { red "Build finished but out/index.html is missing."; exit 1; }
grn "built — $(find "$APP/out" -type f | wc -l) files, $(du -sh "$APP/out" | cut -f1)"

# --- 6. republish. THIS is the step that is easy to miss -------------------
hdr "RECREATING THE CONTAINER"
echo "next build deletes out/ and makes a new one. A bind mount follows the"
echo "inode, not the path, so without this the container keeps serving the"
echo "directory that was deleted — and the deploy silently changes nothing."
cd "$COMPOSE_DIR" || exit 1
if ! docker compose up -d --force-recreate; then
  red "Could not recreate $CONTAINER. The new out/ is built but not being served."
  red "    cd $COMPOSE_DIR && docker compose up -d --force-recreate"
  exit 1
fi

# --- 7. prove it ------------------------------------------------------------
hdr "CHECKING IT CAME BACK"
ok=0
for _ in $(seq 1 10); do
  sleep 2
  if docker exec "$EDGE" wget -qO- "http://$CONTAINER/" >/dev/null 2>&1; then ok=1; break; fi
done
[ "$ok" = 1 ] || { red "× edge-caddy cannot reach $CONTAINER."
  echo "    docker compose -f $COMPOSE_DIR/compose.yml logs --tail 50"; exit 1; }
grn "✓ edge-caddy can reach $CONTAINER"

# Serving SOMETHING is not the same as serving the NEW something. Look for a
# string that only exists in this build.
if docker exec "$EDGE" wget -qO- "http://$CONTAINER/" 2>/dev/null | grep -q "Not mockups"; then
  grn "✓ the new home page is live (the picture wall is in the HTML)"
else
  ylw "! served, but the new home page markup was not found."
  ylw "  If you are publishing an older branch this is expected; otherwise the"
  ylw "  container may still be on the previous out/."
fi

echo
grn "Done — $(git -C "$APP" rev-parse --short HEAD) is live."
echo "Hard-refresh the browser (ctrl-shift-R); _next/static is cached for a year"
echo "by design, and the HTML revalidates, so a normal reload can look stale."
echo
echo "To go back:"
echo "    tar -xzf $BACKUP_DIR/$STAMP-out.tgz -C $APP"
echo "    cd $COMPOSE_DIR && docker compose up -d --force-recreate"
