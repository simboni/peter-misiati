#!/bin/sh
# Is the shop system all right? One command, one screen of answers. Run on the
# server, from apps/riziki-pos:
#
#   sh deploy/health.sh
#
# Written to be run by somebody who does not know this system and is not going
# to read the code: every line says what it found and, where it matters, what
# "good" looks like. Nothing here changes anything — it is safe to run at any
# time, including while the shop is selling.
#
# Read it top to bottom. The first line that is not OK is the one to act on,
# and RUNBOOK.md has the procedure for each.

set -u

COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$COMPOSE_DIR"

ok()   { printf '  OK    %s\n' "$1"; }
bad()  { printf '  !!    %s\n' "$1"; }
note() { printf '        %s\n' "$1"; }

echo "Riziki POS — health check"
echo "$(date '+%Y-%m-%d %H:%M %Z')  ·  $COMPOSE_DIR"
echo

# ------------------------------------------------------------ the containers
echo "Containers"
if ! docker compose ps >/dev/null 2>&1; then
  bad "docker compose will not run here."
  note "Are you in apps/riziki-pos, and is Docker running? 'docker ps' to check."
  exit 1
fi
docker compose ps --format '  {{.Service}}\t{{.State}}\t{{.Status}}' 2>/dev/null || docker compose ps
echo
for svc in pos web caddy; do
  state=$(docker compose ps --status running --services 2>/dev/null | grep -c "^${svc}$")
  if [ "$state" = "1" ]; then ok "$svc is running"; else bad "$svc is NOT running  ->  docker compose up -d"; fi
done

# ------------------------------------------------------------ what is serving
echo
echo "The shop system"
if docker compose exec -T pos true >/dev/null 2>&1; then
  ok "the app container answers"
else
  bad "the app container does not answer  ->  docker compose logs --tail 50 pos"
fi

stamp=$(curl -fsS --max-time 10 https://pos.rizikichemicals.co.ke/build.txt 2>/dev/null)
if [ -n "$stamp" ]; then
  ok "https://pos.rizikichemicals.co.ke is answering"
  echo "$stamp" | sed 's/^/        /'
else
  bad "the public address did not answer  ->  docker compose logs --tail 50 caddy"
  note "The shop can still sell on the local network if the container is up."
fi

# ------------------------------------------------------- the database itself
echo
echo "The database"
docker compose exec -T pos node --experimental-strip-types -e '
const { get, all } = await import("./src/lib/db.ts");
const n = (t) => { try { return get(`SELECT COUNT(*) AS n FROM ${t}`).n; } catch { return "?"; } };
const integrity = get("PRAGMA integrity_check")?.integrity_check ?? "unknown";
console.log(`  ${integrity === "ok" ? "OK   " : "!!   "} integrity check: ${integrity}`);
console.log(`        items ${n("items")} · sales ${n("sales")} · movements ${n("stock_movements")} · users ${n("users")}`);
const today = get("SELECT COALESCE(SUM(total_cents),0) AS t, COUNT(*) AS n FROM sales WHERE status = \x27completed\x27 AND date(at, \x27+3 hours\x27) = date(\x27now\x27, \x27+3 hours\x27)");
console.log(`        today: ${today.n} sale(s), KES ${(today.t / 100).toLocaleString("en-KE")}`);
const last = get("SELECT MAX(at) AS at FROM sales");
console.log(`        last sale recorded: ${last?.at ?? "none yet"} (UTC)`);
const owners = get("SELECT COUNT(*) AS n FROM users WHERE role = \x27owner\x27 AND active = 1").n;
console.log(`  ${owners > 0 ? "OK   " : "!!   "} active owner accounts: ${owners}`);
const books = get("SELECT value FROM settings WHERE key = \x27books_start\x27")?.value ?? "";
console.log(`        books start: ${books || "not set — reports count everything"}`);
' 2>/dev/null || bad "could not read the database  ->  docker compose logs --tail 50 pos"

# ------------------------------------------------------------------ backups
echo
echo "Backups"
BACKUPS="$COMPOSE_DIR/data/backups"
if [ -d "$BACKUPS" ]; then
  latest=$(ls -1t "$BACKUPS"/*.db 2>/dev/null | head -1)
  count=$(ls -1 "$BACKUPS"/*.db 2>/dev/null | wc -l | tr -d ' ')
  if [ -n "$latest" ]; then
    age_days=$(( ( $(date +%s) - $(date -r "$latest" +%s) ) / 86400 ))
    if [ "$age_days" -le 1 ]; then
      ok "$count snapshot(s), newest $(basename "$latest") — $age_days day(s) old"
    else
      bad "$count snapshot(s), newest is $age_days days old: $(basename "$latest")"
      note "The nightly job may have stopped. 'crontab -l' to check it is still there."
    fi
  else
    bad "no snapshots at all in data/backups"
    note "Run one now: docker compose exec -T pos npm run backup"
  fi
else
  bad "data/backups does not exist"
  note "Run one now: docker compose exec -T pos npm run backup"
fi
if crontab -l 2>/dev/null | grep -q "npm run backup"; then
  ok "the nightly backup is in crontab"
else
  bad "no nightly backup in crontab  ->  see RUNBOOK.md, 'Backups'"
fi

# The snapshots above are on the same disk as the database. This is the line
# that says whether a copy has left the building.
STATE="$COMPOSE_DIR/data/offsite-last.txt"
if [ -f "$STATE" ]; then
  off_days=$(( ( $(date +%s) - $(date -r "$STATE" +%s) ) / 86400 ))
  if [ "$off_days" -le 7 ]; then
    ok "a copy left this server $off_days day(s) ago"
  else
    bad "the last copy off this server was $off_days days old"
  fi
  sed 's/^/        /' "$STATE"
else
  bad "no copy has ever left this server  ->  sh deploy/offsite-backup.sh"
  note "A dead server loses everything if the only copies are on it."
fi

# --------------------------------------------------------------------- disk
echo
echo "Disk"
avail=$(df -Pk . | awk 'NR==2 {print $4}')
pct=$(df -Pk . | awk 'NR==2 {print $5}')
avail_mb=$(( avail / 1024 ))
if [ "$avail_mb" -lt 500 ]; then
  bad "only ${avail_mb} MB free (${pct} used)  ->  see RUNBOOK.md, 'The disk is full'"
else
  ok "${avail_mb} MB free (${pct} used)"
fi

echo
echo "Done. Anything marked !! has a procedure in RUNBOOK.md."
