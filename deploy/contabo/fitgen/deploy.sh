#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Fit Generations — put the pending patches on the box, in one command.
#
#   bash deploy.sh --status    what is on the box, what is waiting
#   bash deploy.sh --dry-run   say what it would do and change nothing
#   bash deploy.sh             apply, rebuild, check it came back
#
# WHY THIS IS NOT THE 64THEATRE SCRIPT. Over there, deploying means resetting
# the checkout to the upstream commit and applying every patch from scratch —
# deterministic, idempotent, and it does not have to work out what is already
# in. That is not possible here: patches 0005 and 0007 do not reapply to a
# rebuilt baseline, so this checkout cannot be reconstructed from its base.
# Patches have to go on FORWARD ONLY, in order, once each.
#
# That makes "which ones are already on?" a question this script must answer
# correctly, and `git apply --reverse --check` is not a safe way to ask it: an
# early patch stops reversing cleanly the moment a later one touches the same
# lines, so the answer is wrong in exactly the cases that matter. So the box
# keeps a LEDGER instead — one patch name per line — and
# that file, not a guess, decides what runs. It lives in /srv/fitgen, outside
# the checkout, so a git clean or a rebuild cannot take it with them.
#
# FIRST RUN. The ledger will not exist. 0001-0007 were applied by hand from
# README sections 1-8, so the script seeds the ledger with them and says so
# loudly. If your box is actually missing one of those, the first patch that
# depends on it fails its --check, the script stops, and nothing is rebuilt.
#
# WHAT IT TOUCHES: the fit-generations-gym checkout and the fitgen compose
# project. Nothing else on the box. It does not switch branches in the
# portfolio repo — that repo serves a live site — and reads the patches
# straight out of the fetched ref.
# ---------------------------------------------------------------------------
set -uo pipefail

KIT=${KIT:-/srv/smp-portfolio/repo}
APP=${APP:-/root/fit-generations-gym}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.behind-proxy.yml}
BRANCH=${BRANCH:-claude/portfolio-design-plan-9ol8sb}
PATCH_DIR=deploy/contabo/fitgen/patches
WEB=${WEB:-fitgen-web}
DB=${DB:-fitgen-db}
# Deliberately OUTSIDE the checkout. Inside it, the ledger would be copied
# into the Docker image by `COPY . .`, show up in every `git status`, and be
# deleted by any `git clean` — losing the one record of what is on this box.
STATE_DIR=${STATE_DIR:-/srv/fitgen/deploy-state}
LEDGER="$STATE_DIR/applied.txt"
BACKUP_DIR=${BACKUP_DIR:-/srv/fitgen/before-deploy}
# Applied by hand, from README sections 1-8, before this script existed.
SEED=(0001 0002 0003 0004 0005 0006 0007)

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

for d in "$KIT" "$APP"; do
  git -C "$d" rev-parse --git-dir >/dev/null 2>&1 || { red "Not a git checkout: $d"; exit 1; }
done
[ -f "$APP/$COMPOSE_FILE" ] || { red "No $COMPOSE_FILE in $APP"; exit 1; }

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

# --- 2. the ledger ---------------------------------------------------------
# Worked out in memory first, so --status and --dry-run report exactly what a
# real run would do. Only an apply writes the file.
APPLIED=()
if [ -f "$LEDGER" ]; then
  mapfile -t APPLIED < <(grep -v '^[[:space:]]*$' "$LEDGER")
else
  ylw "No deploy ledger on this box — this is the first run of this script."
  echo "Treating ${SEED[*]} as already applied, because README sections 1-8"
  echo "put them on by hand. If one of those is actually missing, the first"
  echo "patch that needs it will fail its check and nothing will be rebuilt."
  for n in "${SEED[@]}"; do
    for p in "${PATCHES[@]}"; do
      case "$(basename "$p")" in "$n"-*) APPLIED+=("$(basename "$p")") ;; esac
    done
  done
  # NOT written yet. A run that aborts at the check stage says "nothing has
  # been changed", and leaving a new file behind would make that a lie. It is
  # written below, once the whole run is known to apply.
  SEED_LEDGER=1
fi

applied() {
  local x
  for x in ${APPLIED+"${APPLIED[@]}"}; do [ "$x" = "$1" ] && return 0; done
  return 1
}

PENDING=()
for p in "${PATCHES[@]}"; do
  name=$(basename "$p")
  applied "$name" || PENDING+=("$p")
done

hdr "WHAT THE BOX HAS NOW"
echo "checkout:       $APP"
echo "patches on box: $(( ${#PATCHES[@]} - ${#PENDING[@]} )) of ${#PATCHES[@]}"
echo "modified files: $(git -C "$APP" status --porcelain | wc -l)"
if [ "${#PENDING[@]}" -eq 0 ]; then
  grn "Nothing to apply — the box is up to date."
  exit 0
fi
echo "waiting:"
for p in "${PENDING[@]}"; do echo "  · $(basename "$p")"; done

if [ "$MODE" = status ]; then
  echo; echo "Run without --status to apply them."; exit 0
fi

# --- 3. check every pending patch BEFORE changing anything -----------------
# All or nothing. A half-applied chain is the state that is hard to get out
# of, and it is avoidable: every patch is checked against the tree it will
# actually land on, in order, using a throwaway copy of the index.
hdr "CHECKING ${#PENDING[@]} PATCHES"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
for p in "${PENDING[@]}"; do
  name=$(basename "$p")
  git -C "$KIT" show "origin/$BRANCH:$p" > "$TMP/$name" 2>/dev/null \
    || { red "Could not read $name from the kit."; exit 1; }
done

# A sequence has to be checked as a sequence: `git apply --check a b c` does
# NOT feed each patch the previous one's result, so a later patch is tested
# against a tree that does not exist yet and fails for the wrong reason.
#
# So the run is rehearsed in a THROWAWAY INDEX. The real index is copied, the
# working tree is staged into the copy, and each patch is applied --cached to
# it in turn. State accumulates exactly as it will for real, and the working
# tree, the real index and node_modules are never touched or copied.
TMPIDX="$TMP/index"
cp "$(git -C "$APP" rev-parse --git-path index)" "$TMPIDX" 2>/dev/null || : > "$TMPIDX"
if ! GIT_INDEX_FILE="$TMPIDX" git -C "$APP" add -A 2>"$TMP/err"; then
  red "Could not stage the working tree into a scratch index to rehearse against."
  sed 's/^/      /' "$TMP/err"
  exit 1
fi
for p in "${PENDING[@]}"; do
  name=$(basename "$p")
  if GIT_INDEX_FILE="$TMPIDX" git -C "$APP" apply --cached "$TMP/$name" 2>"$TMP/err"; then
    printf '  \033[1;32m✓\033[0m %s\n' "$name"
  else
    red "  × $name does NOT apply"
    sed 's/^/      /' "$TMP/err"
    echo
    red "Nothing has been changed and nothing rebuilt. The site is still up."
    red "Most likely this box is missing an earlier patch, or someone edited"
    red "these files by hand. Check: bash deploy.sh --status"
    exit 1
  fi
done
grn "all ${#PENDING[@]} apply cleanly"

if [ "$MODE" = dry ]; then
  echo; ylw "--dry-run: would apply ${#PENDING[@]} patches and rebuild. Nothing changed."
  exit 0
fi

# --- 4. a way back ---------------------------------------------------------
hdr "SAVING A WAY BACK"
mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
git -C "$APP" diff > "$BACKUP_DIR/$STAMP.diff" 2>/dev/null
echo "working tree diff: $BACKUP_DIR/$STAMP.diff"
# The image is replaced by the rebuild, so keep the one that is working.
if docker image inspect "$WEB" >/dev/null 2>&1; then
  docker tag "$WEB" "$WEB:before-$STAMP" && echo "current image kept as $WEB:before-$STAMP"
fi
# These patches add fields but no migration. The dump is cheap and the one
# time it is wanted is the time it was skipped.
if docker ps --format '{{.Names}}' | grep -qx "$DB"; then
  if docker exec "$DB" pg_dump -U fitgen -d fitgen > "$BACKUP_DIR/$STAMP.sql" 2>/dev/null; then
    echo "database dump:     $BACKUP_DIR/$STAMP.sql ($(du -h "$BACKUP_DIR/$STAMP.sql" | cut -f1))"
  else
    ylw "pg_dump failed — carrying on, but there is no database backup for this deploy."
    rm -f "$BACKUP_DIR/$STAMP.sql"
  fi
else
  ylw "$DB is not running; no database dump taken."
fi

# --- 5. apply, for real ----------------------------------------------------
hdr "APPLYING"
if [ "${SEED_LEDGER:-0}" = 1 ]; then
  mkdir -p "$STATE_DIR"
  printf '%s\n' ${APPLIED+"${APPLIED[@]}"} > "$LEDGER"
  echo "ledger started at $LEDGER"
fi
N=0
for p in "${PENDING[@]}"; do
  name=$(basename "$p")
  if git -C "$APP" apply "$TMP/$name"; then
    echo "$name" >> "$LEDGER"
    N=$((N + 1))
    printf '  \033[1;32m✓\033[0m %s\n' "$name"
  else
    # Should be unreachable: step 3 proved the whole run applies.
    red "  × $name FAILED after passing its check."
    red "The checkout is part-patched at $name. Nothing has been rebuilt, so"
    red "the site is still serving the old image. Restore with:"
    red "    cd $APP && git checkout . && git apply $BACKUP_DIR/$STAMP.diff"
    exit 1
  fi
done
grn "$N patches applied"

# --- 6. rebuild. the code is baked into the image --------------------------
hdr "REBUILDING"
echo "The Dockerfile does COPY . . then npm run build, so a plain 'up -d'"
echo "would restart the old code and the deploy would look like it did nothing."
if ! docker compose -f "$APP/$COMPOSE_FILE" --project-directory "$APP" up -d --build --force-recreate; then
  red "Build or start failed. The patches ARE applied. Fix it and run:"
  red "    cd $APP && docker compose -f $COMPOSE_FILE up -d --build --force-recreate"
  red "Or go back to the image that was working:"
  red "    docker tag $WEB:before-$STAMP $WEB && docker compose -f $COMPOSE_FILE up -d --force-recreate"
  exit 1
fi

# --- 7. prove it came back -------------------------------------------------
hdr "CHECKING IT CAME BACK"
for i in $(seq 1 15); do
  sleep 3
  if docker exec "$WEB" node -e \
    'fetch("http://127.0.0.1:3000/api/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
    >/dev/null 2>&1; then
    grn "✓ $WEB is serving"

    # The pricing page now reads the plan catalog. If that read is broken the
    # homepage 500s, and a health endpoint that only proves the process is up
    # would not notice.
    if docker exec "$WEB" node -e \
      'fetch("http://127.0.0.1:3000/pricing").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
      >/dev/null 2>&1; then
      grn "✓ /pricing renders from the plan catalog"
    else
      red "× /pricing did not render. The app is up but the pricing page is not."
      red "    docker compose -f $COMPOSE_FILE logs --tail 50 $WEB"
      exit 1
    fi

    echo
    grn "Done — $N patches, from kit $REF."
    echo
    echo "Worth a look now:"
    echo "  · Expenses is a new section under Money in the admin sidebar."
    echo "  · The dashboard has a working period picker, top right."
    echo "  · Change a price under Membership Plans, then load /pricing in a"
    echo "    private window — it should follow."
    exit 0
  fi
done

red "× $WEB did not answer /api/health after 45 seconds."
echo "The patches are applied and the image is built. Read the logs:"
echo "    docker compose -f $COMPOSE_FILE logs --tail 50 $WEB"
echo "To go back to the image that was working:"
echo "    docker tag $WEB:before-$STAMP $WEB"
echo "    cd $APP && docker compose -f $COMPOSE_FILE up -d --force-recreate"
exit 1
