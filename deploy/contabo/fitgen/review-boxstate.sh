#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Fit Generations — is it safe to move this box onto the tested tree?
#
#   bash review-boxstate.sh
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

APP=${APP:-/root/fit-generations-gym}
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

EXPECTED_HITS=()
SURPRISES=()
for f in ${CHANGED+"${CHANGED[@]}"}; do
  if grep -qxF "$f" <<<"$EXPECTED"; then EXPECTED_HITS+=("$f"); else SURPRISES+=("$f"); fi
done

hdr "FILES THE NEW WORK IS SUPPOSED TO CHANGE"
echo "${#EXPECTED_HITS[@]} of 38 — these are the five patches, as expected."

hdr "ANYTHING ELSE"
if [ "${#SURPRISES[@]}" -eq 0 ]; then
  grn "None. The two trees agree everywhere outside the new work."
  echo
  grn "SAFE TO SWITCH."
  echo "  cd $APP"
  echo "  git checkout -B deployed $TESTED"
  echo "  docker compose -f docker-compose.behind-proxy.yml up -d --build --force-recreate"
  exit 0
fi

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
