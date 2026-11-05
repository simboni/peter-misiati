#!/usr/bin/env bash
#
# Move StackUp to a new primary domain, and redirect the old one to it.
#
#   bash move-domain.sh --check      what it would do; changes nothing
#   bash move-domain.sh              do it
#   bash move-domain.sh --rollback   put back the file it replaced
#
# By default: stackup.smp.co.ke becomes the address StackUp loads at, and
# stackup.co.ke and www.stackup.co.ke answer with a permanent redirect to it,
# path and query kept — so old bookmarks, shared links and the links in
# emails already sent still land in the right place.
#
# What this changes: ONE file, /srv/edge/sites/stackup.caddy (the one
# publish.sh wrote), and a graceful Caddy reload. It never touches another
# site's file or /srv/edge/Caddyfile, and never restarts edge-caddy — a
# restart drops every site on the box at once; a reload drops nothing.
#
# The same safety net as publish.sh: it reads the hostnames Caddy is really
# serving (from `caddy adapt`, not by grepping), probes them all before and
# after, and if any site that answered stops answering, it puts the old file
# back and reloads, without asking.
#
# Nothing in StackUp itself needs to change: the app and its API share one
# origin, and shareable links follow the address the app is opened at.
#
# One thing visitors will notice: the browser keeps a sign-in per address, so
# everybody signs in once more on the new domain. Nothing is lost — it is the
# same server and the same accounts.
set -euo pipefail

# Overridable only so this can be exercised against stubs off-box.
NEW=${NEW:-stackup.smp.co.ke}
OLD=${OLD:-stackup.co.ke}
SITE=${SITE:-/srv/edge/sites/stackup.caddy}
UPSTREAM=${UPSTREAM:-stackup-api:3000}
BACKUP_DIR=${BACKUP_DIR:-/root}

say()  { printf '\n\033[1;32m== %s\033[0m\n' "$1"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31m×  %s\033[0m\n' "$1" >&2; exit 1; }

MODE=apply
case "${1:-}" in
  --check)    MODE=check ;;
  --rollback) MODE=rollback ;;
  "")         ;;
  *) die "Unknown option: $1 (use --check, --rollback, or nothing)" ;;
esac

# Hostnames edge-caddy is actually serving — the same state-machine parser as
# publish.sh, for the same reason (see the comment there).
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

# As a visitor's browser asks: StackUp serves its pages only to requests that
# accept text/html (see publish.sh). curl prints 000 when it cannot connect.
probe() {
  local c
  c=$(curl -sS -o /dev/null -m 15 -H 'Accept: text/html' \
        -w '%{http_code}' "https://$1/" 2>/dev/null) || true
  echo "${c:-000}"
}
# Where a redirect points, for the old names.
location_of() {
  curl -sS -o /dev/null -m 15 -H 'Accept: text/html' -w '%{redirect_url}' "https://$1/x?y=1" 2>/dev/null || true
}

reload() {
  docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null \
    || return 1
  docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null
}

resolves_here() {
  local ips
  ips=$(getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')
  [ -n "$ips" ] && [ -n "$ME" ] && printf '%s' "$ips" | grep -qw "$ME"
}

# ----------------------------------------------------------------- rollback --
if [ "$MODE" = rollback ]; then
  last=$(ls -1t "$BACKUP_DIR"/stackup.caddy.before-move-* 2>/dev/null | head -1 || true)
  [ -n "$last" ] || die "No saved file in $BACKUP_DIR to roll back to."
  cp "$last" "$SITE"
  reload || die "Caddy refused the restored file. $SITE now holds $last — investigate."
  say "Rolled back to $last. StackUp is on its previous address again."
  exit 0
fi

# ---------------------------------------------------------------- preflight --
say "PREFLIGHT"
docker ps --format '{{.Names}}' | grep -qx edge-caddy || die "edge-caddy is not running."
[ -f "$SITE" ] || die "$SITE does not exist — StackUp was never published. Run publish.sh (HOST=$NEW) instead."

health=$(docker exec edge-caddy wget -qO- "http://$UPSTREAM/health" 2>/dev/null || true)
case "$health" in
  *'"db":true'*) printf '  api + database: ok\n' ;;
  *) die "StackUp is not healthy behind Caddy (got: ${health:-nothing}). Fix that first; moving a broken site helps nobody." ;;
esac

ME=$(curl -sS -m 10 https://api.ipify.org 2>/dev/null || true)
[ -n "$ME" ] || die "Could not work out this box's public IP, so DNS cannot be checked. Try again."
printf '  this box:       %s\n' "$ME"

# The new name MUST point here before Caddy is told about it: the first
# request makes Caddy ask Let's Encrypt for a certificate, and failed
# validations are rate-limited.
new_ips=$(getent ahostsv4 "$NEW" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')
printf '  %-15s %s\n' "$NEW" "${new_ips:-<does not resolve>}"
resolves_here "$NEW" || die "$NEW does not point at this box yet. In the DNS panel for ${NEW#*.}, add:  A  ${NEW%%.${NEW#*.}}  $ME  — wait for it to resolve, then run this again."

# The old names are only kept (as redirects) if they still point here; asking
# Caddy for certificates on names that do not would just fail, again and again.
REDIRECTS=()
for h in "$OLD" "www.$OLD"; do
  if resolves_here "$h"; then REDIRECTS+=("$h"); printf '  %-15s points here — will redirect to %s\n' "$h" "$NEW"
  else warn "$h does not point at this box — left out (nothing to redirect)"; fi
done

# ------------------------------------------------------------- the new file --
TMP=$(mktemp)
{
  echo "# StackUp — one container serves the API and the web app."
  echo "# Primary address: $NEW. Written by deploy/contabo/stackup/move-domain.sh"
  echo
  echo "$NEW {"
  echo "	reverse_proxy $UPSTREAM {"
  echo "		# Server-Sent Events: never buffer, never time out the stream."
  echo "		# StackUp's realtime bus and presence are SSE; a buffering proxy"
  echo "		# does not break them loudly — live updates just silently stop."
  echo "		flush_interval -1"
  echo "	}"
  echo "}"
  if [ "${#REDIRECTS[@]}" -gt 0 ]; then
    echo
    echo "# The old address. Permanent, path and query kept, so bookmarks, shared"
    echo "# links and links in emails already sent still arrive."
    echo "$(IFS=,; echo "${REDIRECTS[*]}" | sed 's/,/, /g') {"
    echo "	redir https://$NEW{uri} permanent"
    echo "}"
  fi
} > "$TMP"

say "THE NEW $SITE"
cat "$TMP"

if [ "$MODE" = check ]; then
  rm -f "$TMP"
  say "--check: nothing changed. Run without --check to apply."
  exit 0
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

# ------------------------------------------------------------------- apply --
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
SAVED="$BACKUP_DIR/stackup.caddy.before-move-$STAMP"
cp "$SITE" "$SAVED"
say "SAVED THE CURRENT FILE AS $SAVED"

put_back() {
  cp "$SAVED" "$SITE"
  reload || die "ROLLBACK FAILED: $SITE was restored from $SAVED but Caddy would not reload — investigate NOW."
}

cp "$TMP" "$SITE"; rm -f "$TMP"
# Validate first, on its own: if Caddy rejects the new file, nothing has been
# loaded yet, so putting the file back is the whole repair — no reload needed.
if ! docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null; then
  cp "$SAVED" "$SITE"
  die "Caddy rejected the new config before loading it. The previous file is back; the running sites never changed."
fi
docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null \
  || { put_back; die "Caddy would not reload the new config. The previous file is back and reloaded."; }
echo "  validated and reloaded"

served_hosts | grep -qx "$NEW" || { put_back; die "$NEW is not in the adapted config after the reload. Put the previous file back."; }

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
  warn "A site that answered before has stopped. Putting the previous file back."
  put_back
  die "Rolled back. StackUp is on its old address and every other site is as it was."
fi

say "STACKUP ON ITS NEW ADDRESS"
# The first request for a new name triggers its certificate; give it a moment.
sleep 5
code=$(probe "$NEW")
[ "$code" = 000 ] && { sleep 20; code=$(probe "$NEW"); }
printf '  https://%-32s %s\n' "$NEW" "$code"
for h in "${REDIRECTS[@]}"; do
  printf '  https://%-32s %s -> %s\n' "$h" "$(probe "$h")" "$(location_of "$h")"
done
case "$code" in
  2*) say "Done. StackUp loads at https://$NEW" ;;
  *)  warn "Not answering 200 yet ($code). Usually the certificate is still being issued — re-check in a minute:"
      echo "    curl -sI -H 'Accept: text/html' https://$NEW | head -3"
      echo "  If it stays broken:  bash $(basename "$0") --rollback" ;;
esac
