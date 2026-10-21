#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 64theatre — bring the box up to date, in one command.
#
#   bash apply-patches.sh --status   what the box has, and what is on the branch
#   bash apply-patches.sh            rebuild the checkout from scratch and deploy
#   bash apply-patches.sh --dry-run  say what it would do and change nothing
#
# WHY THIS EXISTS. The app's changes ship as numbered patch files in the
# portfolio repo, applied in order to the 64theatre checkout. That is thirty-odd
# `git apply` lines typed by hand, and it does not work:
#
#   · `git pull` in /srv/64theatre/repo brings NOTHING, because the changes are
#     not in that repo — they are patch files in the other one. This is the
#     mistake that looks exactly like "I deployed and nothing changed".
#   · one patch skipped or applied out of order and every later one fails
#   · `docker compose up -d` without --build reuses the old image, because the
#     code is baked in at build time. The summary says "Running" rather than
#     "Started" and nothing has changed.
#
# HOW IT WORKS, and why it is not clever about it. It resets the checkout to
# the upstream commit the patches were cut from and applies ALL of them, every
# time. No attempt to work out which are already in: patches are cumulative, so
# an early one stops reversing cleanly the moment a later one touches the same
# lines, and any detection built on that is wrong in exactly the cases that
# matter. Rebuilding from the base is deterministic — the tree afterwards is
# byte-for-byte the one the patches were tested against — and it is idempotent,
# so running it twice is harmless.
#
# WHAT IT TOUCHES: the 64theatre checkout and the 64theatre compose project.
# Nothing else. It does NOT check out a branch in the portfolio repo — that
# repo serves a live site, and switching its branch to read a file would be a
# side effect nobody asked for; the patches are read straight out of the
# fetched ref.
#
# THE RESET DISCARDS HAND EDITS in /srv/64theatre/repo. A diff is saved first,
# and the path is printed. Edit the patches, not the box.
# ---------------------------------------------------------------------------
set -uo pipefail

KIT=${KIT:-/srv/smp-portfolio/repo}
APP=${APP:-/srv/64theatre/repo}
COMPOSE=${COMPOSE:-/srv/64theatre/compose.yml}
BRANCH=${BRANCH:-claude/portfolio-design-plan-9ol8sb}
PATCH_DIR=deploy/contabo/64theatre/patches
CONTAINER=${CONTAINER:-64theatre}
BACKUP_DIR=${BACKUP_DIR:-/srv/64theatre/before-deploy}
# Only these are cleaned of stray files, so an unexpected vendor/ or a stray
# .env beside the code is never deleted by a deploy.
CLEAN_PATHS=(app database resources routes tests config bootstrap deploy)

MODE=apply
PULL_BASE=0
for arg in "$@"; do
  case "$arg" in
    --status)    MODE=status ;;
    --dry-run)   MODE=dry ;;
    --pull-base) PULL_BASE=1 ;;
    *) echo "Unknown option: $arg"
       echo "Use --status, --dry-run, --pull-base, or no option."; exit 2 ;;
  esac
done

red() { printf '\033[1;31m%s\033[0m\n' "$*"; }
grn() { printf '\033[1;32m%s\033[0m\n' "$*"; }
ylw() { printf '\033[1;33m%s\033[0m\n' "$*"; }
hdr() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

for d in "$KIT" "$APP"; do
  # Asked of git rather than testing for a .git directory: in a worktree .git
  # is a file, and the directory test rejects a perfectly good checkout.
  git -C "$d" rev-parse --git-dir >/dev/null 2>&1 || { red "Not a git checkout: $d"; exit 1; }
done

# --- 1. the patches, without disturbing the portfolio checkout -------------
hdr "FETCHING THE PATCHES"
if ! git -C "$KIT" fetch --quiet origin "$BRANCH" 2>/dev/null; then
  red "Could not fetch $BRANCH from the portfolio repo."
  red "Check the box can reach GitHub, then run this again."
  exit 1
fi
REF=$(git -C "$KIT" rev-parse --short "origin/$BRANCH")
grn "origin/$BRANCH is at $REF"

mapfile -t PATCHES < <(git -C "$KIT" ls-tree --name-only "origin/$BRANCH" "$PATCH_DIR/" | sort)
[ "${#PATCHES[@]}" -gt 0 ] || { red "No patches found at $PATCH_DIR on $BRANCH."; exit 1; }
echo "${#PATCHES[@]} patches to apply"

# --- 2. what the box is running right now ----------------------------------
hdr "WHAT THE BOX HAS NOW"
git -C "$APP" fetch --quiet origin 2>/dev/null || ylw "Could not fetch the app repo; using what is already here."
BASE=$(git -C "$APP" rev-parse --short origin/HEAD 2>/dev/null || git -C "$APP" rev-parse --short HEAD)
echo "base commit:     $BASE"
CHANGED=$(git -C "$APP" status --porcelain | wc -l)
echo "modified files:  $CHANGED  (patches applied previously, or hand edits)"

if [ "$MODE" = status ]; then
  echo
  echo "This box will be rebuilt from $BASE with all ${#PATCHES[@]} patches."
  echo "Run without --status to do it."
  exit 0
fi

if [ "$MODE" = dry ]; then
  echo
  ylw "--dry-run: would reset to $BASE, apply ${#PATCHES[@]} patches, rebuild, migrate."
  exit 0
fi

# --- 3. save whatever is there, then reset ---------------------------------
if [ "$CHANGED" -gt 0 ]; then
  mkdir -p "$BACKUP_DIR"
  STAMP="$BACKUP_DIR/$(date -u +%Y%m%dT%H%M%SZ).diff"
  git -C "$APP" diff > "$STAMP" 2>/dev/null
  echo "saved the current diff to $STAMP"
fi

hdr "RESETTING TO $BASE"
git -C "$APP" reset --hard "$BASE" >/dev/null || { red "Reset failed."; exit 1; }
# Patches create files, which are untracked after a reset and would make the
# next `git apply` fail with "already exists". Only the source directories are
# cleaned, so nothing else on disk is at risk.
for p in "${CLEAN_PATHS[@]}"; do
  [ -e "$APP/$p" ] && git -C "$APP" clean -qfd "$p"
done
grn "clean at $BASE"

# --- 4. apply, in order ----------------------------------------------------
hdr "APPLYING ${#PATCHES[@]} PATCHES"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
N=0
for p in "${PATCHES[@]}"; do
  name=$(basename "$p")
  f="$TMP/$name"
  git -C "$KIT" show "origin/$BRANCH:$p" > "$f" 2>/dev/null || { red "Could not read $name"; exit 1; }

  if git -C "$APP" apply "$f"; then
    N=$((N + 1))
    printf '  \033[1;32m✓\033[0m %s\n' "$name"
  else
    red "  × $name FAILED"
    echo
    red "Patches are cumulative, so nothing after this one can go on either."
    red "The checkout is part-patched. Nothing has been rebuilt, so the site is"
    red "still serving the old image and is not broken."
    exit 1
  fi
done
grn "$N patches applied"

# --- 5. rebuild. the code is baked into the image --------------------------
hdr "REBUILDING"
echo "The code is copied into the image at build time, so a plain 'up -d' would"
echo "keep serving the old one. This forces a rebuild."

# --pull-base re-pulls the FROM image before building.
#
# Off by default, deliberately. The Dockerfile tracks a floating tag
# (serversideup/php:8.4-fpm-nginx), so pulling it turns every routine deploy
# into an unannounced PHP upgrade — the version could move under a deploy that
# was only meant to ship a patch, and nobody would know which build changed it.
#
# But WITHOUT it, a rebuild cannot pick up a PHP security fix at all: Docker
# reuses the cached base layer, the app is rebuilt on the same vulnerable PHP,
# and the deploy looks like it worked. That is how a patched CVE stays
# unpatched. So it is a flag, used on purpose:
#
#     bash apply-patches.sh --pull-base
#
if [ "$PULL_BASE" = 1 ]; then
  ylw "--pull-base: re-pulling the base image; the PHP version may change."
  if ! docker compose -f "$COMPOSE" build --pull; then
    red "Base pull or build failed. The patches ARE applied; nothing was recreated,"
    red "so the site is still serving the old image."
    exit 1
  fi
fi

if ! docker compose -f "$COMPOSE" up -d --build --force-recreate; then
  red "Build or start failed. The patches ARE applied; fix the build and run:"
  red "    docker compose -f $COMPOSE up -d --build --force-recreate"
  exit 1
fi

if [ "$PULL_BASE" = 1 ]; then
  echo "PHP now in the container: $(docker exec "$CONTAINER" php -v 2>/dev/null | head -1)"
fi

# --- 6. migrate ------------------------------------------------------------
hdr "MIGRATIONS"
docker compose -f "$COMPOSE" exec -T app php artisan migrate --force || {
  red "Migrations failed. The site may be serving code expecting columns that"
  red "do not exist. Read the output above before walking away."
  exit 1
}

# --- 7. prove it came back -------------------------------------------------
hdr "CHECKING IT CAME BACK"
for i in $(seq 1 10); do
  sleep 3
  if docker exec "$CONTAINER" curl -fsS http://127.0.0.1:8080/up >/dev/null 2>&1; then
    grn "✓ $CONTAINER is serving"
    echo
    grn "Done — $N patches, from kit $REF onto base $BASE."
    echo "Hard-refresh the admin (ctrl-shift-R): the browser caches the old assets."
    exit 0
  fi
done

red "× $CONTAINER did not answer /up after 30 seconds."
echo "The patches are applied and the image is built. Read the logs:"
echo "    docker compose -f $COMPOSE logs --tail 50 app"
exit 1
