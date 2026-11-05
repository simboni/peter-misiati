#!/usr/bin/env bash
#
# Publish TallyPay through edge-caddy — the last step, after the container
# already answers privately.
#
# What this changes: it creates ONE file, /srv/edge/sites/tallypay.caddy, and
# reloads Caddy. It never edits another site's file, never touches
# /srv/edge/Caddyfile, and never restarts edge-caddy — a reload is a graceful,
# atomic config swap that drops no connections (rules 4 and 5).
#
# One hostname: tallypay.smp.co.ke. The old tallypay.co.ke is retired with the
# Cloudflare deployment; the Android app is rebuilt against this host.
#
# DNS is checked against this box BEFORE the reload. Caddy asks Let's Encrypt
# on first request for a hostname, and failed validations are rate-limited — so
# publishing a host that points elsewhere does not just fail, it burns attempts.
#
#   bash publish.sh              do it
#   bash publish.sh --unpublish  remove the site file and reload
set -euo pipefail

SITE=${SITE:-/srv/edge/sites/tallypay.caddy}
HOST=${HOST:-tallypay.smp.co.ke}
UPSTREAM=${UPSTREAM:-tallypay:3000}
COMPOSE=${COMPOSE:-/srv/tallypay/compose.yml}

say()  { printf '\n\033[1;32m== %s\033[0m\n' "$1"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31m×  %s\033[0m\n' "$1" >&2; exit 1; }

# Hostnames edge-caddy is ACTUALLY serving, read from the adapted config rather
# than by grepping the Caddyfile. /srv/edge/Caddyfile is only `import` lines, so
# grepping it finds no hostnames at all and a before/after check built that way
# passes vacuously. State machine: 0 scanning, 1 saw "host", 2 inside the array.
served_hosts() {
  docker exec edge-caddy caddy adapt --config /etc/caddy/Caddyfile 2>/dev/null | awk '
  {
    line = $0
    while (length(line) > 0) {
      if (state == 0) {
        p = index(line, "\"host\"")
        if (p == 0) break
        line = substr(line, p + 6); state = 1
      }
      if (state == 1) {
        b = index(line, "[")
        if (b == 0) break
        line = substr(line, b + 1); state = 2
      }
      e = index(line, "]")
      seg = (e > 0) ? substr(line, 1, e - 1) : line
      n = split(seg, part, "\"")
      for (i = 2; i <= n; i += 2) if (part[i] != "") print part[i]
      if (e > 0) { line = substr(line, e + 1); state = 0 } else { line = "" }
    }
  }' | sort -u
}

# Ask the way a visitor's browser asks. curl already prints 000 when it cannot
# connect, so do NOT add a `|| echo 000` fallback.
probe() {
  local c
  c=$(curl -sS -o /dev/null -m 15 -H 'Accept: text/html' \
        -w '%{http_code}' "https://$1/" 2>/dev/null) || true
  echo "${c:-000}"
}

reload() {
  docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null || return 1
  docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null
}

# ---------------------------------------------------------------- unpublish --
if [ "${1:-}" = "--unpublish" ]; then
  [ -f "$SITE" ] || die "$SITE does not exist — nothing to unpublish."
  mv "$SITE" "/root/tallypay.caddy.unpublished-$(date -u +%F_%H%M)"
  reload || die "Caddy refused the config WITHOUT the site file. Nothing reloaded; the running config is untouched."
  say "Unpublished. The file is in /root if you want it back."
  exit 0
fi

# ----------------------------------------------------------------- preflight --
say "PREFLIGHT"
docker ps --format '{{.Names}}' | grep -qx edge-caddy || die "edge-caddy is not running."
[ -f "$SITE" ] && die "$SITE already exists. Edit it by hand, or --unpublish first."
docker ps --format '{{.Names}}' | grep -qx tallypay \
  || die "The tallypay container is not running. 'docker compose -f $COMPOSE up -d --build' first."

# The upstream must serve HTML. Without the Accept header a healthy Next.js app
# can answer 404 to curl's default */*, and a silent probe is then
# indistinguishable from a broken deploy. That cost a day on StackUp.
docker exec edge-caddy wget -qO- --header='Accept: text/html' "http://$UPSTREAM/" 2>/dev/null \
  | grep -qi '<html' \
  || die "TallyPay did not serve HTML on http://$UPSTREAM/. Check: docker compose -f $COMPOSE logs --tail=50 app"
echo "  upstream $UPSTREAM: serving HTML"

ips=$(getent ahostsv4 "$HOST" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')
me=$(curl -sS -m 10 https://api.ipify.org 2>/dev/null || true)
printf '  %-22s resolves to: %s\n' "$HOST" "${ips:-<nothing>}"
[ -n "$ips" ] || die "$HOST does not resolve. Add an A record for it on the smp.co.ke zone pointing at this box, then run this again."
if [ -n "$me" ] && ! printf '%s' "$ips" | grep -q "$me"; then
  die "$HOST resolves to $ips but this box is $me. Fix DNS first, or Let's Encrypt will rate-limit the failed validations."
fi

say "SITES SERVING NOW  (these must all still answer afterwards)"
before=$(served_hosts)
[ -n "$before" ] || die "Could not read any hostname from the adapted config. Refusing to touch a config I cannot verify."
declare -A was
while read -r h; do
  [ -n "$h" ] || continue
  c=$(probe "$h"); was["$h"]=$c
  printf '  %-36s %s\n' "$h" "$c"
done <<< "$before"

# ------------------------------------------------------------------ publish --
say "WRITING $SITE"
cat > "$SITE" <<EOF
# $HOST — TallyPay, self-hosted billing platform.
# Written by deploy/contabo/tallypay/publish.sh

$HOST {
	reverse_proxy $UPSTREAM
}
EOF
cat "$SITE"

if ! reload; then
  rm -f "$SITE"
  die "Caddy refused the config. The file has been removed and nothing was reloaded — the running config is exactly as it was."
fi
echo "  validated and reloaded"

# Confirm the new file is actually in force. If /srv/edge/Caddyfile imports site
# files one by one instead of globbing, a new file is inert and everything above
# would still have "succeeded".
if ! served_hosts | grep -qx "$HOST"; then
  rm -f "$SITE"; reload || true
  die "$HOST is not in the adapted config, so /srv/edge/Caddyfile does not import this file. Add an import for sites/tallypay.caddy, then run this again. Rolled back."
fi

say "DID ANYTHING ELSE MOVE?"
regressed=0
while read -r h; do
  [ -n "$h" ] || continue
  now=$(probe "$h"); then_=${was[$h]}
  flag=""
  case "$then_" in 2*|3*) case "$now" in 2*|3*) ;; *) flag=" <-- REGRESSED"; regressed=1 ;; esac ;; esac
  printf '  %-36s %s -> %s%s\n' "$h" "$then_" "$now" "$flag"
done <<< "$before"

if [ "$regressed" = 1 ]; then
  warn "A site that worked before has stopped. Rolling back."
  rm -f "$SITE"
  reload || die "ROLLBACK FAILED. Config file removed but reload failed — investigate NOW."
  die "Rolled back. Nothing is published and the other sites are as they were."
fi

say "TALLYPAY"
sleep 5   # first request triggers certificate issuance
printf '  https://%-28s %s\n' "$HOST" "$(probe "$HOST")"
echo
echo "A 000 on the first try is usually the certificate still being issued."
echo "Wait 30s and re-probe:  curl -sI https://$HOST | head -3"
echo
echo "Still to do, in the same sitting:"
echo "  1. Point Kopo Kopo's webhook at https://$HOST/api/mpesa/kopokopo"
echo "  2. Upload the rebuilt Android app (versionCode 6) to Play — the"
echo "     published build still points at the retired tallypay.co.ke."
echo "  3. Add TallyPay to the nightly backup (README step 9) — this is real"
echo "     money data on a box with no provider backups."
