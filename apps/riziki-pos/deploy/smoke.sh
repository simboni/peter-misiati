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

# What the shop system is actually running. The most common "the deploy did
# nothing" is a stale image, and this is the line that says so: if the commit
# here is not the one you just pushed, the build did not take.
echo
echo "Running version"

# Each half says what it is, separately. They are two images built from one
# commit, and either can go stale on its own — the shop system updating while
# the website does not is the exact failure this whole file exists to catch,
# and for a long time the only clue was a 404 on a picture.
read_stamp() {
  curl -s -L --max-time 15 "$1/build.txt" 2>/dev/null
}
commit_of() {
  echo "$1" | sed -n 's/^commit=//p' | head -1
}

pos_stamp=$(read_stamp "$POS")
web_stamp=$(read_stamp "$BASE")

echo "  Shop system"
if echo "$pos_stamp" | grep -q '^commit='; then
  echo "$pos_stamp" | sed 's/^/    /'
else
  echo "    (no build stamp — built before stamping, or by hand)"
fi

echo "  Website"
if echo "$web_stamp" | grep -q '^commit='; then
  echo "$web_stamp" | sed 's/^/    /'
else
  # Two very different faults look identical from here, and saying only the
  # milder one cost this shop weeks: the site was serving ANOTHER COMPANY'S
  # WEBSITE, and the advice on screen said "the site build is stale".
  echo "    NO BUILD STAMP. Either this site was built before stamping, or —"
  echo "    check this first — the domain is not reaching our container at all."
  echo "    Prove which, by asking the proxy what the name resolves to:"
  echo "      docker exec edge-caddy getent hosts riziki-pos-web-1"
  echo "      docker exec edge-caddy wget -qO- http://riziki-pos-web-1/build.txt"
  echo "    If the second prints a commit, the container is fine and the route"
  echo "    is wrong: the edge is serving a config it loaded before the route"
  echo "    was corrected. Caddy never re-reads a file on its own —"
  echo "      docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile"
  fails=$((fails + 1))
fi

pos_commit=$(commit_of "$pos_stamp")
web_commit=$(commit_of "$web_stamp")
drift=""
if [ -n "$pos_commit" ] && [ -n "$web_commit" ] && [ "$pos_commit" != "$web_commit" ]; then
  echo
  echo "  The two halves are NOT from the same commit:"
  echo "    shop system $pos_commit, website $web_commit"
  drift="yes"
  fails=$((fails + 1))
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "All good — the link is safe to send."
else
  echo "$fails check(s) failed."
  if [ -n "$drift" ] || [ -z "$web_commit" ]; then
    echo
    echo "The website is not the commit that is checked out. Rebuild it:"
    echo "  cd \"\$(dirname \"\$0\")/..\" && docker compose up -d --build web"
    echo
    echo "If that changes nothing, the build was served from cache — which is"
    echo "what a stale image looks like from the outside. Force it:"
    echo "  docker compose build --no-cache web && docker compose up -d web"
  else
    echo "If the failures are website pages or pictures, either the site build is"
    echo "stale or the domain is reaching somebody else's container. Check which"
    echo "way round before rebuilding anything — the stamp section above says how."
    echo "  cd \"\$(dirname \"\$0\")/..\" && docker compose up -d --build web"
  fi
  exit 1
fi
