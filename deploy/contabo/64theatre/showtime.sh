#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 64theatre — can we sell tickets today?
#
#   bash showtime.sh          check everything, exit 1 if anything is wrong
#   bash showtime.sh --quiet  same, output only on failure (for cron)
#
# WHY THIS EXISTS, and how it differs from status.sh. status.sh answers "are
# the containers up" across the whole box. That can be entirely green while
# this app cannot take a single shilling: the gateway pointed at a sandbox, no
# performance on sale, the service wallet empty, the scheduler never installed.
# Those are the failures that are invisible until an audience is holding their
# phones.
#
# Every check here is a READ. It starts nothing, stops nothing, changes no
# setting and writes nothing outside /tmp.
#
# Exit 0 only when a real buyer could complete a real purchase right now.
# ---------------------------------------------------------------------------
set -uo pipefail

COMPOSE=${COMPOSE:-/srv/64theatre/compose.yml}
CONTAINER=${CONTAINER:-64theatre}
PUBLIC_URL=${PUBLIC_URL:-https://tickets.64theatre.art}

QUIET=no
[ "${1:-}" = "--quiet" ] && QUIET=yes

FAILURES=0
WARNINGS=0

say()  { [ "$QUIET" = yes ] || printf '%s\n' "$*"; }
hdr()  { [ "$QUIET" = yes ] || printf '\n\033[1;36m== %s\033[0m\n' "$1"; }
ok()   { [ "$QUIET" = yes ] || printf '  \033[1;32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$1"; WARNINGS=$((WARNINGS + 1)); }
bad()  { printf '  \033[1;31m×\033[0m %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

# Runs PHP inside the container and prints the result. Everything that needs
# to ask the application rather than the operating system goes through here.
#
# LOCAL_APP_DIR runs it against a checkout instead of a container, so the
# script can be dry-run on a laptop before it is trusted on the box. The
# container checks are skipped in that mode and say so.
if [ -n "${LOCAL_APP_DIR:-}" ]; then
  app() { (cd "$LOCAL_APP_DIR" && php artisan tinker --execute="$1" 2>/dev/null | tail -1); }
else
  app() { docker exec "$CONTAINER" php artisan tinker --execute="$1" 2>/dev/null | tail -1; }
fi

# --- 1. is it even running -------------------------------------------------
hdr "THE CONTAINER"
if [ -n "${LOCAL_APP_DIR:-}" ]; then
  warn "LOCAL_APP_DIR is set — checking a checkout, not the live container. Container, site and backup checks are skipped."
elif ! docker ps --format '{{.Names}}' 2>/dev/null | grep -Fqx "$CONTAINER"; then
  bad "$CONTAINER is not running. Nothing below can be checked."
  echo
  printf '\033[1;31mNOT READY — the app is not running.\033[0m\n'
  exit 1
else
  # Only claimed when it was actually checked. In local mode this line used
  # to print anyway, which is the kind of reassurance that is worse than
  # silence on a page somebody reads before a show.
  ok "$CONTAINER is running"
fi

if [ -z "${LOCAL_APP_DIR:-}" ]; then
HEALTH=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null)
case "$HEALTH" in
  healthy) ok "health check passing" ;;
  none)    warn "no health check configured" ;;
  *)       bad "health check says: $HEALTH" ;;
esac

RESTARTS=$(docker inspect -f '{{.RestartCount}}' "$CONTAINER" 2>/dev/null)
[ "${RESTARTS:-0}" -gt 3 ] \
  && warn "restarted ${RESTARTS} times — something is crashing" \
  || ok "not crash-looping"
fi

# --- 2. the public site ----------------------------------------------------
hdr "THE PUBLIC SITE"
if [ -n "${LOCAL_APP_DIR:-}" ]; then
  say "  skipped (local mode)"
else
for path in "/" "/my-tickets"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -H 'Accept: text/html' --max-time 15 "$PUBLIC_URL$path" 2>/dev/null)
  [ "$CODE" = "200" ] && ok "$path → 200" || bad "$path → ${CODE:-no answer} (buyers cannot reach the site)"
done

# The ?ref[]= crash. Harmless to send, and if the site 500s on it then patch
# 0029 is deployed without 0031 and anybody can take the site down with a URL.
REF_CODE=$(curl -s -o /dev/null -w '%{http_code}' -H 'Accept: text/html' --max-time 15 "$PUBLIC_URL/?ref%5B%5D=X" 2>/dev/null)
if [ "$REF_CODE" = "500" ]; then
  bad "the site 500s on /?ref[]=X — patch 0029 is deployed WITHOUT 0031. Anyone can take the site down with a URL. Apply 0031 now."
else
  ok "no ?ref[] crash (got ${REF_CODE:-no answer})"
fi
fi

# --- 3. can somebody actually buy ------------------------------------------
hdr "IS ANYTHING ON SALE"
ONSALE=$(app 'echo App\Models\TicketType::whereHas("performance", fn($q) => $q->where("status","on_sale")->where("starts_at",">",now()))->whereColumn("quantity_sold","<","quantity_total")->count();')
if [ "${ONSALE:-0}" -gt 0 ] 2>/dev/null; then
  ok "$ONSALE ticket categor$([ "$ONSALE" = 1 ] && echo y || echo ies) on sale with tickets left"
else
  bad "NOTHING is on sale. Either no upcoming performance is set to 'on sale', or every category is sold out."
fi

NEXT=$(app 'echo optional(App\Models\Performance::where("starts_at",">",now())->orderBy("starts_at")->first())->starts_at?->format("D j M Y g:ia") ?: "none";')
[ "$NEXT" = "none" ] && bad "no upcoming performance at all" || ok "next performance: $NEXT"

# --- 4. taking money -------------------------------------------------------
hdr "TAKING MONEY"
ONLINE=$(app 'echo App\Support\PaymentSettings::onlineEnabled() ? "yes" : "no";')
[ "$ONLINE" = "yes" ] && ok "online checkout is ON" || bad "online checkout is OFF — nobody can pay on the website"

GATEWAY=$(app 'echo App\Support\PaymentSettings::gateway();')
CREDS=$(app 'echo App\Support\PaymentSettings::credentialsPresent(App\Support\PaymentSettings::gateway()) ? "yes" : "no";')
SANDBOX=$(app 'echo App\Support\PaymentSettings::isSandbox(App\Support\PaymentSettings::gateway()) ? "yes" : "no";')

case "$GATEWAY" in
  fake) bad "gateway is FAKE — it issues real tickets for no money. Set a real provider." ;;
  "")   bad "no payment gateway configured" ;;
  *)    ok "gateway: $GATEWAY" ;;
esac
[ "$CREDS" = "yes" ] && ok "credentials present" || bad "credentials for $GATEWAY are MISSING — every checkout will fail"
[ "$SANDBOX" = "yes" ] && bad "$GATEWAY is pointed at its TEST environment — payments will look fine and no money will move" || ok "pointed at live, not sandbox"

# PayHero spends a prepaid wallet to SEND each prompt. Empty, and every
# prompt is refused while the credentials and channel still look perfect.
if [ "$GATEWAY" = "payhero" ]; then
  WALLET=$(app 'echo App\Support\PayHeroWallet::service()["balance_cents"] ?? "unknown";')
  FLOOR=$(app 'echo App\Support\ServiceFeeSettings::walletFloorCents();')
  if [ "$WALLET" = "unknown" ]; then
    warn "could not read the PayHero service wallet — check it by hand before the doors open"
  elif [ "${WALLET:-0}" -lt "${FLOOR:-20000}" ] 2>/dev/null; then
    bad "PayHero service wallet is KES $((WALLET / 100)) — below your warning level. Every STK prompt is refused when it runs out. Top it up."
  else
    ok "PayHero service wallet: KES $((WALLET / 100))"
  fi
fi

# --- 5. getting the ticket to the buyer ------------------------------------
hdr "DELIVERING TICKETS"
MAILER=$(app 'echo config("mail.default");')
if [ "$MAILER" = "log" ]; then
  bad "email is set to 'log' — ticket emails go to the container log and reach NOBODY"
else
  ok "email goes out through $MAILER"
fi

QUEUE=$(app 'echo config("queue.default");')
if [ "$QUEUE" = "sync" ]; then
  ok "jobs run inline (no worker needed)"
else
  warn "queue is '$QUEUE' — a worker must be running or tickets are never delivered"
fi

# --- 6. the work that runs on a timer --------------------------------------
hdr "SCHEDULED WORK"
STUCK=$(app 'echo App\Models\Order::where("status","awaiting_payment")->where("expires_at","<",now())->count();')
if [ "${STUCK:-0}" -gt 0 ] 2>/dev/null; then
  bad "$STUCK abandoned checkouts are still holding their seats off sale. The scheduler is not running: bash deploy/contabo/64theatre/scheduler.sh --install-cron"
else
  ok "no expired orders holding seats"
fi

SCHED_LOG=/var/log/64theatre-schedule.log
if [ -f "$SCHED_LOG" ]; then
  AGE=$(( $(date +%s) - $(stat -c %Y "$SCHED_LOG" 2>/dev/null || echo 0) ))
  [ "$AGE" -lt 600 ] && ok "scheduler ran ${AGE}s ago" || bad "scheduler last ran ${AGE}s ago — it is installed but not working"
else
  bad "the scheduler has never run. Abandoned checkouts will hold seats permanently: bash deploy/contabo/64theatre/scheduler.sh --install-cron"
fi

# --- 7. the door -----------------------------------------------------------
hdr "THE DOOR"
GATE=$(app 'echo App\Models\User::whereIn("role",["gate_staff","super_admin","finance","event_manager","organiser_admin"])->count();')
[ "${GATE:-0}" -gt 0 ] 2>/dev/null && ok "$GATE staff account(s) can work the door" || bad "no staff accounts — nobody can scan at the gate"

DEFAULT_PW=$(app 'echo App\Models\User::where("email","like","%@%")->get()->filter(fn($u) => Hash::check("change-me-on-first-login", $u->password))->count();')
[ "${DEFAULT_PW:-0}" -gt 0 ] 2>/dev/null \
  && bad "$DEFAULT_PW account(s) still use the default password 'change-me-on-first-login'" \
  || ok "no default passwords in use"

# --- 8. the database holding up under a rush -------------------------------
hdr "UNDER LOAD"
BUSY=$(app 'echo config("database.connections.sqlite.busy_timeout") ?: 0;')
JOURNAL=$(app 'echo config("database.connections.sqlite.journal_mode") ?: "default";')
TXMODE=$(app 'echo config("database.connections.sqlite.transaction_mode") ?: "DEFERRED";')
[ "${BUSY:-0}" -ge 5000 ] 2>/dev/null && ok "busy_timeout ${BUSY}ms" || bad "busy_timeout is ${BUSY:-unset} — under a rush SQLite refuses buyers instantly instead of waiting (patch 0023)"
[ "$JOURNAL" = "WAL" ] && ok "journal_mode WAL" || bad "journal_mode is $JOURNAL, not WAL — readers block writers (patch 0023)"
[ "$TXMODE" = "IMMEDIATE" ] && ok "transaction_mode IMMEDIATE" || bad "transaction_mode is $TXMODE — two buyers can deadlock (patch 0023)"

MEM=$([ -n "${LOCAL_APP_DIR:-}" ] && echo 0 || docker inspect -f '{{.HostConfig.Memory}}' "$CONTAINER" 2>/dev/null)
if [ "${MEM:-0}" -gt 0 ] 2>/dev/null; then
  MB=$((MEM / 1024 / 1024))
  [ "$MB" -ge 1024 ] && ok "memory limit ${MB}MB" || warn "memory limit is only ${MB}MB — about 8 simultaneous buyers before workers are killed"
else
  warn "no memory limit set"
fi

# --- 9. if it goes wrong ---------------------------------------------------
hdr "IF SOMETHING GOES WRONG"
BACKUP_DIR=${BACKUP_DIR:-/var/backups/contabo}
if [ -n "${LOCAL_APP_DIR:-}" ]; then
  say "  skipped (local mode)"
elif [ -d "$BACKUP_DIR" ] && find "$BACKUP_DIR" -type f -mtime -2 2>/dev/null | grep -q .; then
  ok "a backup was written in the last 48 hours"
else
  bad "no recent backup. If the database is lost today, every ticket sold is lost with it."
fi

OFFLINE=$(app 'echo App\Support\PaymentSettings::offlineEnabled() ? "yes" : "no";')
[ "$OFFLINE" = "yes" ] \
  && ok "Pay Bill details are shown when a prompt fails (reconciled by hand)" \
  || warn "Pay Bill fallback is off — a buyer whose STK prompt fails has no other way to pay"

# --- verdict ---------------------------------------------------------------
echo
if [ "$FAILURES" -gt 0 ]; then
  printf '\033[1;31mNOT READY — %s problem(s), %s warning(s).\033[0m\n' "$FAILURES" "$WARNINGS"
  echo "Fix the × lines above. Each one names what a buyer would hit."
  exit 1
fi

if [ "$WARNINGS" -gt 0 ]; then
  printf '\033[1;33mREADY, with %s warning(s) worth reading.\033[0m\n' "$WARNINGS"
  exit 0
fi

printf '\033[1;32mREADY. A buyer can complete a purchase right now.\033[0m\n'
exit 0
