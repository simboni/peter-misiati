#!/usr/bin/env bash
#
# Publish StackUp through edge-caddy — the last step, after the API and the
# web app already answer privately.
#
# What this changes: it creates ONE file, /srv/edge/sites/stackup.caddy, and
# reloads Caddy. It never edits another site's file, never touches
# /srv/edge/Caddyfile, and never restarts edge-caddy — a reload is a graceful,
# atomic config swap that drops no connections. Restarting would drop every
# site on the box at once.
#
# If any hostname that answered before stops answering, it puts everything
# back without asking.
#
#   bash publish.sh                 do it
#   bash publish.sh --allow-empty   publish even with no users in the database
#   bash publish.sh --unpublish     remove the site file and reload
set -euo pipefail

# Overridable only so this script can be exercised against stubs off-box.
# On the server, leave every one of them alone.
SITE=${SITE:-/srv/edge/sites/stackup.caddy}
HOST=${HOST:-stackup.co.ke}
UPSTREAM=${UPSTREAM:-stackup-api:3000}
ENV_FILE=${ENV_FILE:-/srv/stackup/.env}
COMPOSE=${COMPOSE:-/srv/stackup/compose.yml}

say()  { printf '\n\033[1;32m== %s\033[0m\n' "$1"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31m×  %s\033[0m\n' "$1" >&2; exit 1; }

# Hostnames edge-caddy is ACTUALLY serving, read from the adapted config rather
# than by grepping the Caddyfile. /srv/edge/Caddyfile is only `import` lines,
# so grepping it finds no hostnames at all and a before/after check built that
# way passes vacuously — it proves nothing while looking rigorous.
#
# The parser is a state machine, not a `sed '/"host": \[/,/\]/p'` range. That
# range re-opens at the next "host" and swallows everything between, so it
# emits "handler", "reverse_proxy" and upstream dial addresses as if they were
# hostnames. Those all probe as 000 before AND after, so nothing regresses and
# the check still prints a confident table — vacuous in a way that is hard to
# notice. Verified against pretty-printed and single-line adapt output.
#   0 scanning   1 saw "host", waiting for [   2 inside the array
served_hosts() {
  docker exec edge-caddy caddy adapt --config /etc/caddy/Caddyfile 2>/dev/null | awk '
  {
    line = $0
    while (length(line) > 0) {
      if (state == 0) {
        p = index(line, "\"host\"")
        if (p == 0) break
        line = substr(line, p + 6)
        state = 1
      }
      if (state == 1) {
        b = index(line, "[")
        if (b == 0) break
        line = substr(line, b + 1)
        state = 2
      }
      e = index(line, "]")
      seg = (e > 0) ? substr(line, 1, e - 1) : line
      n = split(seg, part, "\"")
      for (i = 2; i <= n; i += 2) if (part[i] != "") print part[i]
      if (e > 0) { line = substr(line, e + 1); state = 0 } else { line = "" }
    }
  }' | sort -u
}

# Ask the way a visitor's browser asks.
#
# Without `Accept: text/html` this reported StackUp as 404 on a deployment
# that was serving perfectly — the same trap as the healthcheck and the README
# verification step, in the one place left that still had it. This API serves
# the web export only to requests asking for text/html, so that page routes
# cannot shadow API routes, and curl's default `*/*` falls through to the
# router and takes a 404. The question here is "does a visitor get a page", so
# send what a visitor sends.
#
# curl already prints 000 when it cannot connect, so do NOT add a `|| echo 000`
# fallback — on failure you get "000" twice and every comparison below breaks.
probe() {
  local c
  c=$(curl -sS -o /dev/null -m 15 -H 'Accept: text/html' \
        -w '%{http_code}' "https://$1/" 2>/dev/null) || true
  echo "${c:-000}"
}

reload() {
  docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null \
    || return 1
  docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null
}

# ---------------------------------------------------------------- unpublish --
if [ "${1:-}" = "--unpublish" ]; then
  [ -f "$SITE" ] || die "$SITE does not exist — nothing to unpublish."
  mv "$SITE" "/root/stackup.caddy.unpublished-$(date -u +%F_%H%M)"
  reload || die "Caddy refused the config WITHOUT the site file. Nothing reloaded; the running config is untouched."
  say "Unpublished. The file is in /root if you want it back."
  exit 0
fi

ALLOW_EMPTY=no
[ "${1:-}" = "--allow-empty" ] && ALLOW_EMPTY=yes

# ------------------------------------------------------------------ preflight --
say "PREFLIGHT"

docker ps --format '{{.Names}}' | grep -qx edge-caddy || die "edge-caddy is not running."
[ -f "$SITE" ] && die "$SITE already exists. Edit it by hand, or --unpublish first."

# The upstream must answer. Note the Accept header: this API serves the web
# export only to requests asking for text/html, so that page routes cannot
# shadow API routes. Without it a healthy app returns 404 and this reads as a
# failed deploy — the mistake that cost a day here already.
health=$(docker exec edge-caddy wget -qO- "http://$UPSTREAM/health" 2>/dev/null || true)
case "$health" in
  *'"db":true'*)  printf '  api + database: %s\n' "$health" ;;
  *'"db":false'*) die "The API is up but cannot reach PostgreSQL: $health" ;;
  *)              die "No usable answer from http://$UPSTREAM/health — got: ${health:-<nothing>}" ;;
esac

docker exec edge-caddy wget -qO- --header='Accept: text/html' "http://$UPSTREAM/" 2>/dev/null \
  | grep -qi '<html' \
  || die "The API did not serve the web app. The static export is probably missing from the image — rebuild with --build."
echo "  web app: serving HTML"

# DNS, before the reload. Caddy asks Let's Encrypt on first request for a
# hostname, and failed validations are rate-limited — so a reload with wrong
# DNS does not just fail, it burns attempts.
ips=$(getent ahostsv4 "$HOST" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')
me=$(curl -sS -m 10 https://api.ipify.org 2>/dev/null || true)
printf '  %s resolves to: %s\n' "$HOST" "${ips:-<nothing>}"
[ -n "$ips" ] || die "$HOST does not resolve. Point an A record at this box first."
if [ -n "$me" ] && ! printf '%s' "$ips" | grep -q "$me"; then
  die "$HOST resolves to $ips but this box is $me. Fix DNS before reloading, or Let's Encrypt will rate-limit the failures."
fi

# Is the database actually populated? An empty StackUp served publicly is
# worse than one that is briefly unreachable, and Neon is still the rollback.
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
  counts=$(docker compose -f "$COMPOSE" exec -T db psql -U stackup_migrator -d stackup -At \
    -c "select (select count(*) from users)||' users, '||(select count(*) from workspaces)||' workspaces, '||(select count(*) from tasks)||' tasks';" 2>/dev/null | tr -d '\r' || true)
  printf '  data: %s\n' "${counts:-<could not read>}"
  if [ "$ALLOW_EMPTY" = no ] && printf '%s' "$counts" | grep -q '^0 users'; then
    die "The database has no users — the Neon restore has not run. Do step 3 of the README first, or pass --allow-empty if this is deliberate."
  fi
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
# $HOST — StackUp. One container serves the API and the web app.
# Written by deploy/contabo/stackup/publish.sh

www.$HOST {
	redir https://$HOST{uri} permanent
}

$HOST {
	reverse_proxy $UPSTREAM {
		# Server-Sent Events: never buffer, never time out the stream.
		# StackUp's realtime bus and presence are SSE. A buffering proxy
		# does not break them loudly — live updates just silently stop.
		flush_interval -1
	}
}
EOF
cat "$SITE"

if ! reload; then
  rm -f "$SITE"
  die "Caddy refused the config. The file has been removed and nothing was reloaded — the running config is exactly as it was."
fi
echo "  validated and reloaded"

# Confirm the new file is actually in force. If /srv/edge/Caddyfile imports
# site files one by one instead of globbing sites/, a new file is inert and
# everything above would still have "succeeded".
if ! served_hosts | grep -qx "$HOST"; then
  rm -f "$SITE"
  reload || true
  die "$HOST is not in the adapted config, so /srv/edge/Caddyfile does not import this file. Add an import line for sites/stackup.caddy (or a glob), then run this again. Rolled back."
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

say "STACKUP"
# First request triggers certificate issuance; give it a moment.
sleep 5
printf '  https://%-30s %s\n' "$HOST" "$(probe "$HOST")"
printf '  https://www.%-26s %s\n' "$HOST" "$(probe "www.$HOST")"
echo
echo "A 000 on the first try is usually the certificate still being issued."
echo "Wait 30s and re-probe:  curl -sI https://$HOST | head -3"
echo
echo "Still to do, in the same sitting (README step 7): the nightly backup."
echo "This is real data on a box with no provider backups."
