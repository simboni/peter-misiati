#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Fit Generations — is it safe to move this box onto the tested tree?
#
#   bash review-boxstate.sh            check only, change nothing
#   bash review-boxstate.sh --go-live  check, and if clean, deploy it
#
# WHY. Patches 0008-0012 were cut against a RECONSTRUCTION of this box, built
# by replaying 0001-0007 locally. That reconstruction is not byte-identical to
# what is actually deployed — 0009 proved it by failing to apply. So rather
# than patch forward, the plan is to move the checkout straight onto the
# commit that was tested in a browser.
#
# That is only safe if this box has nothing the tested tree lacks. A file this
# box has and the tested tree does not would be silently reverted, and the
# candidates are not cosmetic: docker-compose.behind-proxy.yml carries the
# PayHero and SMTP variables patch 0001 added. Reverting that file would stop
# payments and email while every test still passed.
#
# So: anything the two trees disagree on is listed, split into files patches
# 0008-0012 are SUPPOSED to change and files they are not. The second list is
# the one that matters. This script only reads; it changes nothing.
# ---------------------------------------------------------------------------
set -uo pipefail

GO_LIVE=0
for arg in "$@"; do
  case "$arg" in
    --go-live) GO_LIVE=1 ;;
    *) echo "Unknown option: $arg"; echo "Use --go-live, or no option."; exit 2 ;;
  esac
done

APP=${APP:-/root/fit-generations-gym}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.behind-proxy.yml}
WEB=${WEB:-fitgen-web}
DB=${DB:-fitgen-db}
BACKUP_DIR=${BACKUP_DIR:-/srv/fitgen/before-deploy}
BOX=${BOX:-boxstate-20261021}
TESTED=${TESTED:-origin/fitgen-tested}

red() { printf '\033[1;31m%s\033[0m\n' "$*"; }
grn() { printf '\033[1;32m%s\033[0m\n' "$*"; }
ylw() { printf '\033[1;33m%s\033[0m\n' "$*"; }
hdr() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

git -C "$APP" rev-parse --git-dir >/dev/null 2>&1 || { red "Not a git checkout: $APP"; exit 1; }

hdr "FETCHING THE TESTED TREE"
git -C "$APP" fetch --quiet origin fitgen-tested 2>/dev/null \
  || { red "Could not fetch fitgen-tested. Does this box have read access?"; exit 1; }
git -C "$APP" rev-parse --verify --quiet "$BOX" >/dev/null \
  || { red "No branch $BOX on this box. Was the state captured?"; exit 1; }
grn "box:    $(git -C "$APP" rev-parse --short "$BOX")  ($BOX)"
grn "tested: $(git -C "$APP" rev-parse --short "$TESTED")  ($TESTED)"

# Files patches 0008-0012 are meant to change. Anything else differing is a
# place the reconstruction and reality disagree.
EXPECTED=$(cat <<'EOF'
public/gallery/g5.jpg
public/trainers/emmanuel-manu.jpg
src/app/(portal)/layout.tsx
src/app/(portal)/portal/invoices/[id]/page.tsx
src/app/(portal)/portal/login/page.tsx
src/app/(portal)/portal/page.tsx
src/app/(portal)/portal/plans/page.tsx
src/app/(portal)/portal/signup/page.tsx
src/app/(site)/gallery/page.tsx
src/app/(site)/page.tsx
src/app/(site)/pricing/page.tsx
src/app/admin/expenses/[id]/page.tsx
src/app/admin/expenses/page.tsx
src/app/admin/page.tsx
src/app/admin/settings/page.tsx
src/app/api/portal/invoices/[id]/status/route.ts
src/components/admin/period-picker.tsx
src/components/cta-band.tsx
src/components/portal/pay-amount.tsx
src/components/portal/payment-stage.tsx
src/components/pricing.tsx
src/components/workout-tabs.tsx
src/lib/admin.ts
src/lib/admin/actions.ts
src/lib/admin/module-actions.ts
src/lib/auth/actions.ts
src/lib/auth/current-member.ts
src/lib/auth/member-actions.ts
src/lib/auth/permissions.ts
src/lib/db/repo.ts
src/lib/db/schema.ts
src/lib/db/seed.ts
src/lib/gym.ts
src/lib/public-assets.ts
src/lib/services/billing.ts
src/lib/services/expenses.ts
src/lib/services/public-pricing.ts
src/lib/services/service-fees.ts
src/lib/services/settings.ts
EOF
)

mapfile -t CHANGED < <(git -C "$APP" diff --name-only "$BOX" "$TESTED")

# Files that differ but cannot change how the app behaves. The container reads
# .env, which is gitignored and untouched by a checkout; .env.example is
# documentation for a human.
BENIGN=$(cat <<'EOF'
.env.example
EOF
)

EXPECTED_N=$(grep -c . <<<"$EXPECTED")
EXPECTED_HITS=()
BENIGN_HITS=()
SURPRISES=()
for f in ${CHANGED+"${CHANGED[@]}"}; do
  if grep -qxF "$f" <<<"$EXPECTED"; then EXPECTED_HITS+=("$f")
  elif grep -qxF "$f" <<<"$BENIGN"; then BENIGN_HITS+=("$f")
  else SURPRISES+=("$f"); fi
done

hdr "FILES THE NEW WORK IS SUPPOSED TO CHANGE"
echo "${#EXPECTED_HITS[@]} of $EXPECTED_N — these are the five patches, as expected."
if [ "${#BENIGN_HITS[@]}" -gt 0 ]; then
  echo
  echo "Also differing, but documentation only — the container reads .env,"
  echo "which a checkout never touches:"
  for f in "${BENIGN_HITS[@]}"; do echo "  · $f"; done
fi

hdr "ANYTHING ELSE"
if [ "${#SURPRISES[@]}" -eq 0 ]; then
  grn "None. The two trees agree everywhere outside the new work."
  if [ "$GO_LIVE" = 0 ]; then
    echo
    grn "SAFE TO SWITCH. To do it:"
    echo "  bash $0 --go-live"
    exit 0
  fi
else
  if [ "$GO_LIVE" = 1 ]; then
    red "${#SURPRISES[@]} file(s) differ that the new work should not touch — NOT deploying."
    for f in "${SURPRISES[@]}"; do echo "  · $f"; done
    echo
    ylw "Their diffs follow. Send them to Claude; nothing has been changed."
    echo
    for f in "${SURPRISES[@]}"; do
      printf '\033[1;36m---- %s ----\033[0m\n' "$f"
      git -C "$APP" diff "$BOX" "$TESTED" -- "$f" | head -80
      echo
    done
    exit 1
  fi
fi

if [ "$GO_LIVE" = 0 ]; then

  red "${#SURPRISES[@]} file(s) differ that the new work should not be touching."
  echo "Switching would overwrite this box's version of each:"
  for f in "${SURPRISES[@]}"; do echo "  · $f"; done
  echo
  ylw "Their diffs follow (box on the left, tested on the right)."
  ylw "Send these to Claude before switching anything."
  echo
  for f in "${SURPRISES[@]}"; do
    printf '\033[1;36m---- %s ----\033[0m\n' "$f"
    git -C "$APP" diff --stat "$BOX" "$TESTED" -- "$f" | tail -1
    git -C "$APP" diff "$BOX" "$TESTED" -- "$f" | head -80
    echo
  done
  exit 1
fi

# ---------------------------------------------------------------------------
# --go-live, and the review came back clean.
# ---------------------------------------------------------------------------
hdr "SAVING A WAY BACK"
mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
echo "box state is the commit $BOX ($(git -C "$APP" rev-parse --short "$BOX")) — that is the way back"
if docker image inspect "$WEB" >/dev/null 2>&1; then
  docker tag "$WEB" "$WEB:before-$STAMP" && echo "current image kept as $WEB:before-$STAMP"
fi
if docker ps --format '{{.Names}}' | grep -qx "$DB"; then
  if docker exec "$DB" pg_dump -U fitgen -d fitgen > "$BACKUP_DIR/$STAMP.sql" 2>/dev/null; then
    echo "database dump:     $BACKUP_DIR/$STAMP.sql ($(du -h "$BACKUP_DIR/$STAMP.sql" | cut -f1))"
  else
    ylw "pg_dump failed — no database backup for this deploy."
    rm -f "$BACKUP_DIR/$STAMP.sql"
  fi
fi

hdr "SWITCHING TO THE TESTED TREE"
if ! git -C "$APP" checkout -B deployed "$TESTED"; then
  red "Checkout failed. Nothing rebuilt; the site is still serving the old image."
  exit 1
fi
grn "checkout is now $(git -C "$APP" rev-parse --short HEAD) — the tree that was tested"

hdr "REBUILDING"
echo "The Dockerfile does COPY . . then npm run build, so a plain 'up -d' would"
echo "restart the old code and this would look like it did nothing."
if ! docker compose -f "$APP/$COMPOSE_FILE" --project-directory "$APP" up -d --build --force-recreate; then
  red "Build or start failed. To go back:"
  red "    cd $APP && git checkout -B deployed $BOX"
  red "    docker tag $WEB:before-$STAMP $WEB"
  red "    docker compose -f $COMPOSE_FILE up -d --force-recreate"
  exit 1
fi

hdr "CHECKING IT CAME BACK"
ok=0
for i in $(seq 1 15); do
  sleep 3
  if docker exec "$WEB" node -e \
    'fetch("http://127.0.0.1:3000/api/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
    >/dev/null 2>&1; then ok=1; break; fi
done
[ "$ok" = 1 ] || { red "× $WEB did not answer /api/health after 45s."
  echo "    docker compose -f $COMPOSE_FILE logs --tail 50 $WEB"; exit 1; }
grn "✓ serving"

# /pricing reads the plan catalog now; a health check that only proves the
# process is up would not notice that read failing.
docker exec "$WEB" node -e \
  'fetch("http://127.0.0.1:3000/pricing").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
  >/dev/null 2>&1 \
  && grn "✓ /pricing renders from the plan catalog" \
  || { red "× /pricing did not render."; exit 1; }

# Proof the NEW code is the code running: this route did not exist before.
code=$(docker exec "$WEB" node -e \
  'fetch("http://127.0.0.1:3000/admin/expenses",{redirect:"manual"}).then(r=>{console.log(r.status)}).catch(()=>console.log("ERR"))' 2>/dev/null)
if [ "$code" = "404" ] || [ "$code" = "ERR" ]; then
  red "× /admin/expenses answers $code — the new code is NOT running."
  exit 1
fi
grn "✓ /admin/expenses exists (answers $code) — the new code is live"

echo
grn "LIVE."
echo
echo "Part payment: sign in to the member portal, open an unpaid invoice."
echo "You should see 'Pay in full' and 'Pay part of it'. Access still only"
echo "starts when the invoice is CLEARED — that is deliberate."
echo
echo "Also new: Expenses under Money in the admin sidebar, a working period"
echo "picker on the dashboard, and /pricing now follows Membership Plans."
echo
echo "If anything is wrong, go back with:"
echo "    cd $APP && git checkout -B deployed $BOX"
echo "    docker tag $WEB:before-$STAMP $WEB"
echo "    docker compose -f $COMPOSE_FILE up -d --force-recreate"
