#!/bin/sh
# Who serves what on this box, and where two containers answer to one name.
#
# WHY THIS EXISTS. Riziki's domain spent weeks serving other clients' websites
# — St Stephen's, SMP Developers, KEYSA — a different one on each refresh. The
# cause was one word. Its route said `reverse_proxy web:80`, and `web` is a
# compose SERVICE name, which Docker publishes as a network alias on every
# network that container joins. The shared proxy is attached to every project's
# network at once, so from inside it `web` belonged to four or five containers,
# and Docker's resolver answers an ambiguous name with ALL of them, in turn.
#
# Nothing about that is specific to Riziki. Any site on this box pointing at a
# bare `web`, `app`, `api` or `db` has the same exposure and will show it the
# day a second project picks the same word.
#
# It also checks a second thing, which cost more time than the first: whether
# the config the proxy is RUNNING still matches the files on disk. Caddy reads
# its config once at startup and never looks at the files again. Riziki's route
# was corrected, committed, pulled and deployed — and stayed broken for a week,
# because nothing reloaded the proxy. The files were right and the process was
# serving something else.
#
# Read-only. It changes nothing, starts nothing and stops nothing.
#
#   sh edge-audit.sh            # audits the proxy named edge-caddy
#   sh edge-audit.sh my-proxy   # or another one

set -u
EDGE="${1:-edge-caddy}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
problems=0

say()  { printf '%s\n' "$*"; }
head2() { printf '\n%s\n' "$*"; printf '%s\n' "------------------------------------------------------------"; }
bad()  { printf '  !! %s\n' "$*"; problems=$((problems + 1)); }
ok()   { printf '  ok  %s\n' "$*"; }

if ! docker inspect "$EDGE" >/dev/null 2>&1; then
  say "No container called '$EDGE'. Pass its name as the first argument."
  exit 1
fi

# ------------------------------------------------------------------ 1. names
#
# Every alias, on every network the proxy can see, and which container owns it.
# Taken from Docker itself rather than from inside the proxy, because busybox
# images have no getent and this has to work on any of them.

head2 "1. Names that answer to more than one container"

nets=$(docker inspect "$EDGE" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null)
say "  The proxy is attached to: $(echo "$nets" | tr -s ' ')"
say ""

for n in $nets; do
  for c in $(docker network inspect "$n" --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null); do
    # The container's own name is always resolvable, and so is every alias it
    # was given on this network — the service name among them.
    printf '%s\t%s\n' "$c" "$c" >> "$WORK/names"
    for a in $(docker inspect "$c" \
        --format "{{with index .NetworkSettings.Networks \"$n\"}}{{range .Aliases}}{{.}} {{end}}{{end}}" 2>/dev/null); do
      printf '%s\t%s\n' "$a" "$c" >> "$WORK/names"
    done
  done
done

[ -f "$WORK/names" ] || { say "  (no networks to read)"; exit 1; }
sort -u "$WORK/names" > "$WORK/uniq"

# An alias owned by two or more DIFFERENT containers is ambiguous.
cut -f1 "$WORK/uniq" | sort | uniq -d > "$WORK/shared"
if [ -s "$WORK/shared" ]; then
  while IFS= read -r a; do
    owners=$(awk -F'\t' -v a="$a" '$1 == a { printf "%s ", $2 }' "$WORK/uniq")
    bad "\"$a\" is claimed by: $owners"
  done < "$WORK/shared"
  say ""
  say "  Any route pointing at one of those names serves a different site each"
  say "  time. Point it at a container name instead — those are unique."
else
  ok "every name the proxy can resolve belongs to exactly one container"
fi

# ------------------------------------------------- 2. what the routes point at

head2 "2. What each route actually points at"

running=$(docker exec "$EDGE" wget -qO- http://127.0.0.1:2019/config/ 2>/dev/null)
if [ -z "$running" ]; then
  bad "could not read the running config from the proxy's admin API"
else
  printf '%s' "$running" | grep -o '"dial":"[^"]*"' | sed 's/.*:"//; s/"$//' | sort -u > "$WORK/dials"
  while IFS= read -r d; do
    host=${d%:*}
    if grep -q "^$host	" "$WORK/uniq" 2>/dev/null; then
      n=$(awk -F'\t' -v h="$host" '$1 == h { c++ } END { print c + 0 }' "$WORK/uniq")
      if [ "$n" -gt 1 ]; then
        bad "$d  -> AMBIGUOUS, $n containers answer to \"$host\""
      else
        ok "$d"
      fi
    else
      bad "$d  -> nothing on the proxy's networks answers to \"$host\" (this route is dead)"
    fi
  done < "$WORK/dials"
fi

# ------------------------------------------- 3. is the running config current?

head2 "3. Is the proxy running the config that is on disk?"

if [ -z "$running" ]; then
  bad "cannot tell — the admin API did not answer"
else
  # The same extraction, from the files the proxy would load if restarted.
  if docker exec "$EDGE" caddy adapt --config /etc/caddy/Caddyfile >"$WORK/adapted" 2>/dev/null; then
    grep -o '"dial":"[^"]*"' "$WORK/adapted" | sed 's/.*:"//; s/"$//' | sort -u > "$WORK/ondisk"
    if diff -q "$WORK/dials" "$WORK/ondisk" >/dev/null 2>&1; then
      ok "the running config matches the files"
    else
      bad "THE FILES AND THE RUNNING PROXY DISAGREE."
      say ""
      say "    on disk but not running:"
      comm -13 "$WORK/dials" "$WORK/ondisk" | sed 's/^/      /'
      say "    running but no longer on disk:"
      comm -23 "$WORK/dials" "$WORK/ondisk" | sed 's/^/      /'
      say ""
      say "    Caddy reads its config once and never re-reads the files. Fix:"
      say "      docker exec $EDGE caddy validate --config /etc/caddy/Caddyfile"
      say "      docker exec $EDGE caddy reload   --config /etc/caddy/Caddyfile"
    fi
  else
    bad "the files on disk do not even parse — no reload can succeed until that is fixed"
    say "    docker exec $EDGE caddy validate --config /etc/caddy/Caddyfile"
  fi
fi

# ------------------------------------------------------ 4. what each site says

head2 "4. What each public hostname serves"

if [ -n "$running" ]; then
  printf '%s' "$running" | grep -o '"host":\["[^]]*\]' | sed 's/.*\["//; s/"\]//; s/","/ /g' \
    | tr ' ' '\n' | sed '/^$/d' | sort -u > "$WORK/hosts"
  while IFS= read -r h; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -L --max-time 12 "https://$h/" 2>/dev/null)
    stamp=$(curl -s -L --max-time 12 "https://$h/build.txt" 2>/dev/null | sed -n 's/^commit=//p' | head -1)
    if [ -n "$stamp" ]; then
      printf '  %-34s %s  commit=%s\n' "$h" "${code:-???}" "$stamp"
    else
      printf '  %-34s %s\n' "$h" "${code:-???}"
    fi
  done < "$WORK/hosts"
  say ""
  say "  A site serving a commit it should not, or a 200 from the wrong brand,"
  say "  is the fault in section 1 reaching the public."
fi

head2 "Summary"
if [ "$problems" -eq 0 ]; then
  say "  Nothing ambiguous, nothing dead, nothing unreloaded."
else
  say "  $problems thing(s) to look at, marked !! above."
fi
exit 0
