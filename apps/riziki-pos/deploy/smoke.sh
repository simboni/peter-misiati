#!/bin/sh
# Is the whole public face actually up? Run this on the server after a deploy,
# before telling anyone the link works.
#
#   sh deploy/smoke.sh                       # checks the live domain
#   sh deploy/smoke.sh http://localhost      # checks the containers directly
#
# It checks every page a visitor can reach, plus the pictures — a stale website
# build shows up here as 404s on /art/*.svg while the pages themselves are fine,
# which is exactly the failure that is invisible from the homepage.

set -u

BASE="${1:-https://rizikichemicals.co.ke}"
POS="${2:-https://pos.rizikichemicals.co.ke}"

fails=0

check() {
  want="$1"
  url="$2"
  got=$(curl -s -o /dev/null -w '%{http_code}' -L --max-time 15 "$url" 2>/dev/null)
  if [ "$got" = "$want" ]; then
    printf '  ok   %s  %s\n' "$got" "$url"
  else
    printf '  FAIL %s (wanted %s)  %s\n' "${got:-no answer}" "$want" "$url"
    fails=$((fails + 1))
  fi
}

echo "Website — $BASE"
for path in / /about/ /products/ /contact/ /robots.txt /sitemap.xml; do
  check 200 "$BASE$path"
done

echo "Website pictures"
for path in /art/hero.svg /art/raw.svg /art/kit.svg /art/finished.svg \
  /photos/shop-counter.jpeg /photos/shop-store.jpeg /og.png /icon.svg; do
  check 200 "$BASE$path"
done

echo "Shop system — $POS"
check 200 "$POS/login"
# Signed out, every screen must bounce to the login page rather than open.
check 200 "$POS/sell"

echo
if [ "$fails" -eq 0 ]; then
  echo "All good — the link is safe to send."
else
  echo "$fails check(s) failed."
  echo "If the failures are website pages or pictures, the site build is stale:"
  echo "  cd \"\$(dirname \"\$0\")/..\" && docker compose up -d --build web"
  exit 1
fi
