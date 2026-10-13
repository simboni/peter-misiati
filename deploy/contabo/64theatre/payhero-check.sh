#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# payhero-check.sh — prove the PayHero credentials work, find the payment
# channel the money should land in, and discover the two endpoint shapes their
# published reference does not document.
#
#   bash payhero-check.sh                     check credentials and channels
#   bash payhero-check.sh 0712345678 1        ...and send a real 1 KES prompt
#
# The second form MOVES REAL MONEY — one shilling, to the configured channel.
# That is the point: it is the only way to see a genuine callback body, and
# the callback body is the half of this integration that is still guesswork.
#
# Reads /srv/64theatre/.env. Changes nothing. The password is never printed.
# ---------------------------------------------------------------------------
set -uo pipefail

ENV_FILE=${ENV_FILE:-/srv/64theatre/.env}
TEST_PHONE=${1:-}
TEST_AMOUNT=${2:-1}

bold() { printf '\n\033[1;32m== %s\033[0m\n' "$1"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$1"; }
bad()  { printf '  \033[1;31m×\033[0m %s\n' "$1"; }

[ -f "$ENV_FILE" ] || { bad "$ENV_FILE not found. Set ENV_FILE."; exit 1; }
set -a; . "$ENV_FILE"; set +a

BASE=${PAYHERO_BASE_URL:-https://backend.payhero.co.ke}
BASE=${BASE%/}
USER_=${PAYHERO_USERNAME:-}
PASS=${PAYHERO_PASSWORD:-}
CHAN=${PAYHERO_CHANNEL_ID:-}

bold "WHAT IS CONFIGURED"
printf '  %-22s %s\n' PAYHERO_BASE_URL "$BASE"
printf '  %-22s %s\n' PAYHERO_USERNAME "${USER_:-<unset>}"
printf '  %-22s %s\n' PAYHERO_PASSWORD "$([ -n "$PASS" ] && printf '%d chars' "${#PASS}" || echo '<unset>')"
printf '  %-22s %s\n' PAYHERO_CHANNEL_ID "${CHAN:-<unset>}"
printf '  %-22s %s\n' PAYHERO_WEBHOOK_SECRET "$([ -n "${PAYHERO_WEBHOOK_SECRET:-}" ] && echo set || echo '<unset> — callbacks will be verified by status query')"

if [ -z "$USER_" ] || [ -z "$PASS" ]; then
  bad "No API credentials. PayHero dashboard -> API, then put them in $ENV_FILE."
  exit 1
fi

AUTH=$(printf '%s:%s' "$USER_" "$PASS" | base64 -w0)
req() { # req METHOD PATH [JSON]
  curl -sS -m 25 -o /tmp/ph.body -w '%{http_code}' -X "$1" \
    -H "Authorization: Basic $AUTH" -H 'Accept: application/json' \
    ${3:+-H 'Content-Type: application/json' -d "$3"} \
    "$BASE/$(printf '%s' "$2" | sed 's#^/##')" 2>/dev/null || echo 000
}
show() { head -c 700 /tmp/ph.body; echo; }

# --- discovery -------------------------------------------------------------
# PayHero documents POST /api/v2/payments and little else. Rather than hard-code
# a guess for the rest, try the candidates and report which answer. Whatever
# responds goes in PAYHERO_STATUS_PATH — no code change needed.
bold "WHICH ENDPOINTS ANSWER THESE CREDENTIALS"
printf '  %-6s %-42s %s\n' CODE PATH NOTE
for path in \
  "api/v2/payment_channels" \
  "api/v2/channels" \
  "api/v2/wallets" \
  "api/v2/wallet-balance" \
  "api/v2/account-balance" \
  "api/v2/transactions" \
  "api/v2/transaction-status" \
  "api/v2/payments"
do
  code=$(req GET "$path")
  case "$code" in
    200|201) note="answers" ;;
    401|403) note="auth rejected" ;;
    404)     note="no such endpoint" ;;
    405)     note="exists, needs another method" ;;
    000)     note="unreachable" ;;
    *)       note="" ;;
  esac
  printf '  %-6s %-42s %s\n' "$code" "/$path" "$note"
  case "$code" in 200|201) cp /tmp/ph.body "/tmp/ph-$(echo "$path" | tr / _).json" ;; esac
done

bold "AUTHENTICATION"
if ls /tmp/ph-*.json >/dev/null 2>&1; then
  ok "Credentials accepted by at least one endpoint."
else
  bad "Nothing accepted these credentials. Check API Username and Password in"
  bad "the PayHero dashboard — they are NOT your login email and password."
  exit 1
fi

bold "SERVICE WALLET  (this is what sends the prompts)"
# PayHero charges each STK request against a prepaid SERVICE wallet, which is
# NOT the money being collected. When it empties, every prompt is refused while
# the credentials, the channel and the callback all still look perfect — so it
# reads as a flaky network and costs a day of blaming Safaricom.
if [ -f /tmp/ph-api_v2_wallets.json ]; then
  if command -v python3 >/dev/null; then
    python3 - /tmp/ph-api_v2_wallets.json <<'PY'
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: print("  (not JSON)"); raise SystemExit

# Shape confirmed against a live account: each wallet is an object tagged
# wallet_type, holding available_balance — NOT a flat *_balance key, which is
# what the first guess looked for and why this read "could not read".
rows = d if isinstance(d, list) else (d.get("data") or d.get("wallets") or [d])
if isinstance(rows, dict): rows = [rows]

seen = {}
for w in rows:
    if isinstance(w, dict) and w.get("wallet_type"):
        seen[w["wallet_type"]] = w

for kind, label in (("service_wallet", "service wallet"), ("payment_wallet", "payment wallet")):
    w = seen.get(kind)
    if not w:
        print("  %-15s %s" % (label+":", "not returned"))
        continue
    bal = w.get("available_balance")
    st = w.get("wallet_status") or ""
    print("  %-15s %s %s" % (
        label+":",
        ("KES %s" % bal) if bal is not None else "balance not reported",
        ("· status %s" % st) if st else ""))

svc = (seen.get("service_wallet") or {}).get("available_balance")
status = (seen.get("service_wallet") or {}).get("wallet_status")

if status and str(status).upper() != "ACTIVE":
    print()
    print("  !  The service wallet is %s, not ACTIVE." % status)
    print("     A balance that is not yet usable spends like an empty one:")
    print("     every prompt is refused while everything else looks healthy.")
    print("     Ask PayHero what clears it before relying on this in a show.")

if svc is not None and isinstance(svc, (int, float)) and svc < 20:
    print()
    print("  !  LOW. Prompts will start failing, and the failure looks like a")
    print("     network problem rather than an empty wallet. Top up in the")
    print("     PayHero dashboard before going on sale.")
PY
  else
    head -c 400 /tmp/ph-api_v2_wallets.json; echo
  fi
else
  warn "The wallets endpoint did not answer — read the balance off the dashboard."
fi

bold "PAYMENT CHANNELS  (which one is the bank?)"
for f in /tmp/ph-api_v2_payment_channels.json /tmp/ph-api_v2_channels.json; do
  [ -f "$f" ] || continue
  if command -v python3 >/dev/null; then
    python3 - "$f" <<'PY'
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: print("  (not JSON)"); raise SystemExit
rows = d if isinstance(d,list) else (d.get("channels") or d.get("data") or d.get("payment_channels") or [])
if not isinstance(rows,list) or not rows:
    print("  "+json.dumps(d)[:600]); raise SystemExit
print("  %-8s %-28s %-14s %s" % ("ID","NAME","TYPE","DESTINATION"))
for c in rows[:25]:
    if not isinstance(c,dict): continue
    print("  %-8s %-28s %-14s %s" % (
        c.get("id") or c.get("channel_id") or "?",
        str(c.get("name") or c.get("channel_name") or "")[:28],
        str(c.get("type") or c.get("channel_type") or c.get("provider") or "")[:14],
        str(c.get("account_number") or c.get("account") or c.get("destination") or "")[:30]))
print()
print("  Use the id of the BANK channel as PAYHERO_CHANNEL_ID.")
print("  A wallet channel means takings sit in PayHero instead of the bank.")
PY
  else
    show
  fi
  break
done
[ -f /tmp/ph-api_v2_payment_channels.json ] || [ -f /tmp/ph-api_v2_channels.json ] || \
  warn "No channel listing endpoint answered — read the id off the dashboard, under Payment Channels."

# --- live prompt -----------------------------------------------------------
if [ -z "$TEST_PHONE" ]; then
  bold "NEXT"
  echo "  To see a real callback body — the part their docs do not describe —"
  echo "  send one shilling to your own number:"
  echo "      bash payhero-check.sh 07XXXXXXXX 1"
  echo "  then: docker logs 64theatre 2>&1 | grep payhero.callback"
  exit 0
fi

[ -n "$CHAN" ] || { bad "PAYHERO_CHANNEL_ID is unset — nothing to charge into."; exit 1; }

bold "SENDING A REAL $TEST_AMOUNT KES PROMPT TO $TEST_PHONE"
REF="payhero-check-$(date -u +%s)"
# Overridable, because this probe now serves more than one app and each has
# its own callback path. The default is the theatre's; a callback that lands
# somewhere harmless is fine for a name or wallet test, since the reference is
# synthetic and matches no order either way.
CB=${CALLBACK_URL:-https://tickets.64theatre.art/webhooks/payhero}
echo "  callback: $CB"
code=$(req POST "api/v2/payments" "$(printf '{"amount":%s,"phone_number":"%s","channel_id":%s,"provider":"m-pesa","external_reference":"%s","callback_url":"%s"}' \
  "$TEST_AMOUNT" "$TEST_PHONE" "$CHAN" "$REF" "$CB")")
printf '  HTTP %s\n  ' "$code"; show

# HTTP 200 with success:false is a refusal wearing a success code — the exact
# trap the gateway guards against. Say so here too.
if grep -q '"success"[[:space:]]*:[[:space:]]*false' /tmp/ph.body; then
  bad "Refused: success=false despite HTTP $code. Read error_message above."
  exit 1
fi

case "$code" in
  200|201) ok "Queued. Approve the prompt on $TEST_PHONE." ;;
  *)       bad "Not queued. See the body above."; exit 1 ;;
esac

bold "NOW CAPTURE THE CALLBACK"
cat <<EOF
  Approve (or cancel — a cancellation body is just as useful) the prompt, then:

      docker logs 64theatre 2>&1 | grep -A40 payhero.callback | tail -60

  Send me that, plus the endpoint table above. Two things get fixed from it:
    · PAYHERO_STATUS_PATH, if a different path answered
    · the callback field names, if they differ from what we assumed
  Both are config and a small edit, not a rewrite — that is why they were
  kept out of the gateway's logic.

  external_reference used for this test: $REF
EOF
